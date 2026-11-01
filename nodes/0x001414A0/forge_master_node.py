# -*- coding: utf-8 -*-
"""锻剑纳贡（锻造大师）-> 节点插件市场的节点入口。

节点只负责“被市场识别 + 提供运行入口”，真正的游戏在 ./game/index.html。
点市场卡片上的「运行」会：
  1. 卸载本插件并重新加载（由市场统一完成）；
  2. 执行 NODE_INFO.run -> cmds.openForgeMaster()；
  3. 用系统默认浏览器打开本地的游戏页面。
"""

NODE_INFO = {
    "name": "锻剑纳贡",
    "description": "锻剑纳贡（锻造大师）小游戏：在契约日内锻造兵器、应对敌袭、向城主纳贡。用系统默认浏览器打开本地 HTML5 游戏。",
    "author": "詹康明",
    "version": "1.0.0",
    "node": "forgeMasterNode",
    "node_id": "0x001414A0",
    "run": "cmds.openForgeMaster()",
    "tags": ["游戏", "锻造", "休闲"],
    "github": "https://github.com/MengXingXiaoMing",
}

import inspect
import os
import sys
import webbrowser


def maya_useNewAPI():
    pass


import maya.api.OpenMaya as om
import maya.cmds as cmds

try:
    _THIS_FILE = os.path.abspath(__file__)
except NameError:
    # Maya 用 exec 加载 Python 插件时不一定提供 __file__
    _THIS_FILE = os.path.abspath(inspect.getsourcefile(lambda: 0))

PLUGIN_DIR = os.path.dirname(_THIS_FILE)
GAME_DIR = os.path.join(PLUGIN_DIR, "game")
GAME_INDEX = os.path.join(GAME_DIR, "index.html")


def open_forge_master():
    """用系统默认浏览器打开锻造大师游戏页面。"""
    if not os.path.isfile(GAME_INDEX):
        cmds.warning(u"锻造大师游戏文件不存在：%s" % GAME_INDEX)
        return None
    url = "file:///" + GAME_INDEX.replace("\\", "/")
    webbrowser.open(url, new=2)
    return url


class ForgeMasterNode(om.MPxNode):
    kNodeName = "forgeMasterNode"
    kNodeId = om.MTypeId(0x001414A0)

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
