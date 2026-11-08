# -*- coding: utf-8 -*-
"""梦星截屏 -> 节点插件市场的节点入口。

节点只负责「被市场识别 + 提供运行入口」：点市场卡片上的「运行」会
启动独立的「梦星截屏」程序（PyQt6 应用，用它自己 .venv 里的解释器）。

为什么不直接在 Maya 里 import：
  - 截屏软件用的是 PyQt6，和 Maya 自带的 PySide2/PySide6 是两个 Qt 绑定，
    同一个进程里混用会直接崩溃；
  - 它需要自己的 .venv 依赖（OCR / 翻译 / 录屏编码等），Maya 的解释器没有。

所以这里用独立子进程启动，效果等同于双击 main.py / 桌面快捷方式，
截屏软件原有的启动方式（main.py、梦星截屏.lnk）完全不受影响。
软件内部已做单实例互斥：重复点「运行」只会把已运行的窗口叫到前台。
"""

NODE_INFO = {
    "name": "梦星截屏",
    "description": "启动梦星截屏（录屏与离线翻译）。以独立进程运行，不占 Maya；"
                   "软件已做单实例，重复运行会把已有窗口叫到前台。",
    "author": "詹康明",
    "version": "1.0.0",
    "node": "screenRecordingNode",
    "node_id": "0x00141496",
    "run": "cmds.openScreenRecording()",
    "tags": ["截屏", "录屏", "工具"],
    "github": "https://github.com/MengXingXiaoMing/maya-node-plugin-market/tree/main/nodes/0x00141496",
    # 工具类插件：节点不进场景文件。保存场景时不写入 fileInfo 需求清单，
    # 别人打开文件也不会被提示安装它。
    "scene_node": False,
}

import os
import subprocess

import maya.api.OpenMaya as om
import maya.cmds as cmds


def maya_useNewAPI():
    pass


# 截屏软件的位置：优先读环境变量 SCREEN_RECORDER_DIR，方便换机器；
# 默认是本机当前路径。
DEFAULT_APP_DIR = r"E:\code\ai solo\ScreenRecording"


def _app_dir():
    path = os.environ.get("SCREEN_RECORDER_DIR", "").strip() or DEFAULT_APP_DIR
    return os.path.abspath(path)


def _launch_screen_recorder():
    """用截屏软件自带 .venv 的 pythonw 后台启动 main.py。

    返回 (ok, message)。pythonw 不带控制台窗口；DETACHED 让它完全脱离
    Maya 进程，Maya 关掉后截屏软件照常运行。
    """
    app_dir = _app_dir()
    main_py = os.path.join(app_dir, "main.py")
    if not os.path.isfile(main_py):
        return False, u"找不到截屏软件入口：%s（可设环境变量 SCREEN_RECORDER_DIR 指向安装目录）" % main_py

    pythonw = os.path.join(app_dir, ".venv", "Scripts", "pythonw.exe")
    if not os.path.isfile(pythonw):
        # 没有 venv 就退回系统 python（假定依赖装在系统环境里）
        pythonw = "pythonw.exe"

    flags = 0
    for name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
        flags |= getattr(subprocess, name, 0)

    try:
        subprocess.Popen(
            [pythonw, main_py],
            cwd=app_dir,
            creationflags=flags,
            close_fds=True,
        )
    except Exception as exc:
        return False, u"启动梦星截屏失败：%s" % exc
    return True, u"梦星截屏已启动"


def open_screen_recorder():
    ok, msg = _launch_screen_recorder()
    if ok:
        print(u"[节点插件市场] %s" % msg)
    else:
        cmds.warning(u"[节点插件市场] %s" % msg)
    return ok


class ScreenRecordingNode(om.MPxNode):
    kNodeName = "screenRecordingNode"
    kNodeId = om.MTypeId(0x00141496)

    def __init__(self):
        super(ScreenRecordingNode, self).__init__()

    @staticmethod
    def creator():
        return ScreenRecordingNode()

    @staticmethod
    def initialize():
        pass


class OpenScreenRecordingCommand(om.MPxCommand):
    kCommandName = "openScreenRecording"

    def __init__(self):
        super(OpenScreenRecordingCommand, self).__init__()

    @staticmethod
    def creator():
        return OpenScreenRecordingCommand()

    @staticmethod
    def newSyntax():
        return om.MSyntax()

    def doIt(self, args):
        open_screen_recorder()

    def isUndoable(self):
        return False


def initializePlugin(mobject):
    plugin = om.MFnPlugin(mobject, "Kangming Zhan", "1.0.0", "Any")
    plugin.registerNode(
        ScreenRecordingNode.kNodeName,
        ScreenRecordingNode.kNodeId,
        ScreenRecordingNode.creator,
        ScreenRecordingNode.initialize,
    )
    plugin.registerCommand(
        OpenScreenRecordingCommand.kCommandName,
        OpenScreenRecordingCommand.creator,
        OpenScreenRecordingCommand.newSyntax,
    )


def uninitializePlugin(mobject):
    plugin = om.MFnPlugin(mobject)
    plugin.deregisterCommand(OpenScreenRecordingCommand.kCommandName)
    plugin.deregisterNode(ScreenRecordingNode.kNodeId)
