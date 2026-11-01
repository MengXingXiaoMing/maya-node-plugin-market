# -*- coding: utf-8 -*-
"""锻剑纳贡（锻造大师）-> 节点插件市场的节点入口。

游戏本体是纯 HTML/JS（E:\\code\\ai solo\\game\\forge-master），
本文件只是市场里的「启动卡片」：点「运行」用系统默认浏览器打开游戏。

游戏目录里的文件一行不动，原有打开方式（直接双击 index.html）不受影响。
"""

NODE_INFO = {
    "name": "锻剑纳贡",
    "description": "打开网页游戏「锻剑纳贡」（锻造大师）：在默认浏览器里启动，"
                   "不占 Maya。游戏文件保持原样，这里只是一个启动入口。",
    "author": "詹康明",
    "version": "1.0.0",
    "node": "forgeMasterNode",
    "node_id": "0x00141497",
    "run": "cmds.openForgeMaster()",
    "tags": ["游戏", "娱乐"],
    "github": "https://github.com/MengXingXiaoMing",
    # 工具类插件：节点不进场景文件，不写入 fileInfo 需求清单
    "scene_node": False,
}

import os
import webbrowser

import maya.api.OpenMaya as om
import maya.cmds as cmds


def maya_useNewAPI():
    pass


# 游戏目录：优先读环境变量 FORGE_MASTER_DIR，方便换机器
DEFAULT_GAME_DIR = r"E:\code\ai solo\game\forge-master"


def _game_index():
    game_dir = os.environ.get("FORGE_MASTER_DIR", "").strip() or DEFAULT_GAME_DIR
    return os.path.join(os.path.abspath(game_dir), "index.html")


def open_forge_master():
    index = _game_index()
    if not os.path.isfile(index):
        cmds.warning(
            u"[节点插件市场] 找不到游戏入口：%s（可设环境变量 FORGE_MASTER_DIR 指向游戏目录）" % index)
        return False
    try:
        os.startfile(index)  # Windows：用默认浏览器打开
    except Exception:
        try:
            webbrowser.open("file:///" + index.replace("\\", "/"))
        except Exception as exc:
            cmds.warning(u"[节点插件市场] 启动锻剑纳贡失败：%s" % exc)
            return False
    print(u"[节点插件市场] 锻剑纳贡已在浏览器打开")
    return True


class ForgeMasterNode(om.MPxNode):
    kNodeName = "forgeMasterNode"
    kNodeId = om.MTypeId(0x00141497)

    def __init__(self):
        super(ForgeMasterNode, self).__init__()

    @staticmethod
    def creator():
        return ForgeMasterNode()

    @staticmethod
    def initialize():
        pass


class OpenForgeMasterCommand(om.MPxCommand):
    kCommandName = "openForgeMaster"

    def __init__(self):
        super(OpenForgeMasterCommand, self).__init__()

    @staticmethod
    def creator():
        return OpenForgeMasterCommand()

    @staticmethod
    def newSyntax():
        return om.MSyntax()

    def doIt(self, args):
        open_forge_master()

    def isUndoable(self):
        return False


def initializePlugin(mobject):
    plugin = om.MFnPlugin(mobject, "Kangming Zhan", "1.0.0", "Any")
    plugin.registerNode(
        ForgeMasterNode.kNodeName,
        ForgeMasterNode.kNodeId,
        ForgeMasterNode.creator,
        ForgeMasterNode.initialize,
    )
    plugin.registerCommand(
        OpenForgeMasterCommand.kCommandName,
        OpenForgeMasterCommand.creator,
        OpenForgeMasterCommand.newSyntax,
    )


def uninitializePlugin(mobject):
    plugin = om.MFnPlugin(mobject)
    plugin.deregisterCommand(OpenForgeMasterCommand.kCommandName)
    plugin.deregisterNode(ForgeMasterNode.kNodeId)
