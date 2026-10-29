# -*- coding: utf-8 -*-
NODE_INFO = {
    "name": "动态包裹",
    "description": "动态包裹。旧版节点，使用 Maya Python 2 API，只适用于 Maya 2022 及更早。",
    "author": "詹康明",
    "version": "1.0.0",
    "node": "dynWrap",
    "node_id": "0x00141500",
    "category": "rigging",
    "tags": ["包裹", "变形器"],
    "maya_versions": ["2022"],
    "github": "https://github.com/MengXingXiaoMing",
}

"""
dynWrap —— 网格包裹变形器（自定义节点 / MPxDeformerNode）

作用
----
把「被驱动网格」按最近点绑定到「驱动网格」上。绑定之后，驱动网格发生任何形变
（蒙皮 / 骨骼 / 其它变形器 / 直接编辑），被驱动网格都会跟着一起动。

设计要点
--------
1. 绑定关系（驱动体序号 + 三角形 3 个顶点 + 重心坐标 + 绑定参考点 + 权重）在
   「绑定时」算好，序列化成 bindData(JSON) 存在节点上；
   每次求值只做「当前驱动三角形重心插值 − 绑定参考点」的偏移计算，避免每帧重算最近点。
2. 支持多个驱动网格，按距离加权融合（nearest / inverseDistance 两种模式）。
3. 不依赖 scipy，只用 OpenMaya + numpy。
4. 节点只负责「求值」；绑定（算最近点）由构建器 dyn_wrap_system 负责，保持 deform() 轻量。

用法
----
    import maya.cmds as cmds
    cmds.loadPlugin("dynWrap.py")     # 或 cmds.loadPlugin(r"完整路径/dynWrap.py")

之后交给构建器 / UI 建「包裹 + 多级细分 + 每级 BS」系统。
"""

import json
import sys

import maya.OpenMaya as om
import maya.OpenMayaMPx as ompx
import maya.cmds as cmds

try:
    import numpy as np
except ImportError:  # numpy 是 Maya 自带的，正常不会缺失
    np = None


class DynWrap(ompx.MPxDeformerNode):
    """网格包裹变形器：把被驱动网格按最近点绑定到驱动网格上。"""

    node_name = "dynWrap"
    # 用户区间内的自定义节点 ID（不要与同工程其它插件重复）
    type_id = om.MTypeId(0x00141500)

    # 驱动网格上限。这里刻意使用「固定数量的标量输入 driverMesh0..7」而不是
    # 数组输入：Maya 在并行求值（Evaluation Manager）下于 deform() 里读数组输入
    # MArrayDataHandle 会与求值产生竞争并卡死（本工程 rubikCube 已踩过同样的坑）。
    MAX_DRIVERS = 8

    # 绑定数据解析缓存：key = bindData 文本的哈希，避免每帧重新 json.loads
    _assoc_cache = {}
    _ASSOC_CACHE_MAX = 32

    def __init__(self):
        super(DynWrap, self).__init__()

    # ------------------------------------------------------------------ 工具
    @staticmethod
    def _read_assoc(txt):
        """把 bindData(JSON) 解析成 numpy 数组并缓存。"""
        key = hash(txt)
        cached = DynWrap._assoc_cache.get(key)
        if cached is not None:
            return cached

        d = json.loads(txt)
        assoc = {
            "nv": int(d.get("nv", 0)),
            "vi": np.asarray(d["vi"], dtype=np.int64),
            "di": np.asarray(d["di"], dtype=np.int64),
            "tri": np.asarray(d["tri"], dtype=np.int64).reshape(-1, 3),
            "bary": np.asarray(d["bary"], dtype=np.float64).reshape(-1, 3),
            "rest": np.asarray(d["rest"], dtype=np.float64).reshape(-1, 3),
            "wgt": np.asarray(d["wgt"], dtype=np.float64),
        }
        # 限制缓存规模，避免长时间会话内存膨胀
        if len(DynWrap._assoc_cache) >= DynWrap._ASSOC_CACHE_MAX:
            DynWrap._assoc_cache.pop(next(iter(DynWrap._assoc_cache)))
        DynWrap._assoc_cache[key] = assoc
        return assoc

    def _read_drivers(self, dataBlock):
        """读取所有驱动网格当前（已求值）的世界坐标点，返回 list[np.ndarray|None]。

        按 0..MAX_DRIVERS-1 顺序读标量输入，遇到空槽即停止（驱动器都从 0 开始连续填）。
        """
        drivers = []
        for i in range(self.MAX_DRIVERS):
            attr = getattr(self, "driverMesh{0}".format(i))
            mesh_obj = dataBlock.inputValue(attr).asMesh()
            if mesh_obj.isNull():
                break
            fn = om.MFnMesh(mesh_obj)
            pts = om.MPointArray()
            # 构建器把驱动接的是 worldMesh，取到的点已是世界坐标
            fn.getPoints(pts, om.MSpace.kWorld)
            n = pts.length()
            arr = np.empty((n, 3), dtype=np.float64)
            for k in range(n):
                p = pts[k]
                arr[k, 0] = p.x
                arr[k, 1] = p.y
                arr[k, 2] = p.z
            drivers.append(arr)
        return drivers

    # -------------------------------------------------------------- 核心求值
    def deform(self, dataBlock, geoIter, matrix, multiIndex):
        # 1) envelope 为 0 时直接跳过，尊重 Maya 标准「包迹」
        envelope = dataBlock.inputValue(ompx.cvar.MPxGeometryFilter_envelope).asFloat()
        if envelope <= 0.0:
            return

        # 2) 没有绑定数据就不做事（例如新加节点还没绑定）
        bind_txt = dataBlock.inputValue(self.bindData).asString()
        if not bind_txt:
            return

        try:
            assoc = self._read_assoc(bind_txt)
        except Exception as err:
            sys.stderr.write("[dynWrap] bindData 解析失败: {0}\n".format(err))
            return

        vi = assoc["vi"]
        if len(vi) == 0:
            return

        drivers = self._read_drivers(dataBlock)
        if not drivers:
            return

        # 3) 累加每个顶点在世界空间的偏移
        offsets = np.zeros((assoc["nv"], 3), dtype=np.float64)
        di, tri, bary, rest, wgt = (
            assoc["di"], assoc["tri"], assoc["bary"], assoc["rest"], assoc["wgt"],
        )
        for e in range(len(vi)):
            d = di[e]
            if d < 0 or d >= len(drivers):
                continue
            drv = drivers[d]
            if drv is None:
                continue
            t0, t1, t2 = tri[e]
            if t0 >= len(drv) or t1 >= len(drv) or t2 >= len(drv):
                continue
            b = bary[e]
            # 当前（已形变）驱动三角形上的对应点
            cur = drv[t0] * b[0] + drv[t1] * b[1] + drv[t2] * b[2]
            delta = (cur - rest[e]) * wgt[e]
            offsets[vi[e]] += delta
        offsets *= envelope

        # 4) 世界偏移换算回被驱动网格的本地空间再写回顶点
        inv = matrix.inverse()
        index = 0
        while not geoIter.isDone():
            pt = geoIter.position()
            if index < assoc["nv"]:
                v = om.MVector(offsets[index, 0], offsets[index, 1], offsets[index, 2])
                v_local = v * inv  # MVector*MMatrix 只取 3x3 线性部分，忽略平移
                geoIter.setPosition(
                    om.MPoint(pt.x + v_local.x, pt.y + v_local.y, pt.z + v_local.z)
                )
            index += 1
            geoIter.next()

    # ------------------------------------------------------------ 属性初始化
    @classmethod
    def nodeInitializer(cls):
        # 驱动网格：固定数量的标量输入 driverMesh0..7（不使用数组输入，见类注释）
        for i in range(cls.MAX_DRIVERS):
            t_attr = om.MFnTypedAttribute()
            attr = t_attr.create(
                "driverMesh{0}".format(i), "drvm{0}".format(i), om.MFnData.kMesh
            )
            t_attr.setStorable(False)
            t_attr.setConnectable(True)
            cls.addAttribute(attr)
            setattr(cls, "driverMesh{0}".format(i), attr)

        # 绑定数据（JSON 字符串）
        s_attr = om.MFnTypedAttribute()
        cls.bindData = s_attr.create("bindData", "bnd", om.MFnData.kString)
        s_attr.setStorable(True)
        s_attr.setConnectable(False)
        cls.addAttribute(cls.bindData)

        # 影响半径：0 表示不设上限（只在绑定时参与权重计算）
        n_attr = om.MFnNumericAttribute()
        cls.radius = n_attr.create("radius", "rad", om.MFnNumericData.kFloat, 0.0)
        n_attr.setMin(0.0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        cls.addAttribute(cls.radius)

        # 融合模式：nearest=只取最近驱动；inverseDistance=按距离反比加权
        e_attr = om.MFnEnumAttribute()
        cls.blendMode = e_attr.create("blendMode", "bmd", 1)
        e_attr.addField("nearest", 0)
        e_attr.addField("inverseDistance", 1)
        e_attr.setStorable(True)
        e_attr.setKeyable(True)
        cls.addAttribute(cls.blendMode)

        # 距离反比的指数（越大越偏向最近的那个驱动）
        n_attr = om.MFnNumericAttribute()
        cls.power = n_attr.create("power", "pwr", om.MFnNumericData.kFloat, 2.0)
        n_attr.setMin(0.0001)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        cls.addAttribute(cls.power)

        # 只有驱动网格与绑定数据真正影响输出
        out = ompx.cvar.MPxGeometryFilter_outputGeom
        for i in range(cls.MAX_DRIVERS):
            cls.attributeAffects(getattr(cls, "driverMesh{0}".format(i)), out)
        cls.attributeAffects(cls.bindData, out)

    @classmethod
    def nodeCreator(cls):
        return ompx.asMPxPtr(DynWrap())


# ------------------------------------------------------------------ 插件入口
def initializePlugin(plugin):
    m_plugin = ompx.MFnPlugin(plugin, "ZKM", "1.0", "Any")
    try:
        m_plugin.registerNode(
            DynWrap.node_name,
            DynWrap.type_id,
            DynWrap.nodeCreator,
            DynWrap.nodeInitializer,
            ompx.MPxNode.kDeformerNode,
        )
    except Exception as err:
        sys.stderr.write("[dynWrap] 注册节点失败: {0}\n".format(err))
        raise


def uninitializePlugin(plugin):
    m_plugin = ompx.MFnPlugin(plugin)
    try:
        m_plugin.deregisterNode(DynWrap.type_id)
    except Exception as err:
        sys.stderr.write("[dynWrap] 注销节点失败: {0}\n".format(err))
        raise