# -*- coding: utf-8 -*-
"""卷轴插件 -> 节点插件市场的节点入口。

节点只负责“被市场识别 + 提供运行入口”，真正的窗口在 ./scroll/ 里。
点市场卡片上的「运行」会：
  1. 卸载本插件并重新加载（由市场统一完成）；
  2. 执行 NODE_INFO.run -> cmds.openScrollMarket()；
  3. 重新加载 ./scroll/scroll_window.py 并打开窗口。
"""

NODE_INFO = {
    "name": "通用附着版卷轴",
    "description": "打开通用附着版卷轴窗口。每次点「运行」都会先卸载、再重新加载插件和窗口模块，"
                   "改完脚本不用重启 Maya，也能稳定重新打开。",
    "author": "詹康明",
    "version": "1.0.0",
    "node": "scrollMarketNode",
    "node_id": "0x00151502",
    "run": "cmds.openScrollMarket()",
    "tags": ["卷轴", "附着", "窗口"],
    "github": "https://github.com/MengXingXiaoMing",
}

import inspect
import os
import sys


def maya_useNewAPI():
    pass


import maya.api.OpenMaya as om
import maya.cmds as cmds

try:
    from PySide6 import QtCore, QtWidgets
except ImportError:
    from PySide2 import QtCore, QtWidgets

try:
    _THIS_FILE = os.path.abspath(__file__)
except NameError:
    # Maya 用 exec 加载 Python 插件时不一定提供 __file__
    _THIS_FILE = os.path.abspath(inspect.getsourcefile(lambda: 0))

PLUGIN_DIR = os.path.dirname(_THIS_FILE)
SCROLL_DIR = os.path.join(PLUGIN_DIR, "scroll")
PLUGIN_ROOT = os.path.abspath(os.path.join(PLUGIN_DIR, "..", "..", "..", "..", ".."))


def _ensure_paths():
    if SCROLL_DIR not in sys.path:
        sys.path.insert(0, SCROLL_DIR)
    version = int(cmds.about(version=True))
    for offset in range(30):
        library = os.path.join(PLUGIN_ROOT, str(version - offset))
        if os.path.isdir(library):
            if library not in sys.path:
                sys.path.append(library)
            break


def _close_scroll_windows():
    """关掉上一份卷轴窗口，保证每次运行只有一个窗口。"""
    for widget in QtWidgets.QApplication.allWidgets():
        try:
            is_scroll = widget.objectName().startswith("ZKM_scroll_market_window")
            if not is_scroll:
                is_scroll = "卷轴" in (widget.windowTitle() or "")
            if is_scroll:
                widget.close()
                widget.setParent(None)
                widget.deleteLater()
        except Exception:
            pass
    try:
        QtCore.QCoreApplication.sendPostedEvents(None, QtCore.QEvent.DeferredDelete)
    except Exception:
        pass


def _load_scroll_module():
    """强制从节点文件夹里的副本加载，并关掉上一份窗口。"""
    _ensure_paths()
    _close_scroll_windows()
    sys.modules.pop("scroll_window", None)

    target = os.path.join(SCROLL_DIR, "scroll_window.py")
    if sys.version_info[0] < 3:
        import imp
        module = imp.load_source("scroll_window", target)
    else:
        import importlib.util
        spec = importlib.util.spec_from_file_location("scroll_window", target)
        module = importlib.util.module_from_spec(spec)
        sys.modules["scroll_window"] = module
        spec.loader.exec_module(module)
    return module


def open_scroll_window():
    module = _load_scroll_module()
    window = getattr(module, "window", None)
    if window is not None:
        window.show()
        window.raise_()
        window.activateWindow()
    return window


class ScrollMarketNode(om.MPxNode):
    kNodeName = "scrollMarketNode"
    kNodeId = om.MTypeId(0x00151502)

    def __init__(self):
        super(ScrollMarketNode, self).__init__()

    @staticmethod
    def creator():
        return ScrollMarketNode()

    @staticmethod
    def initialize():
        pass


class OpenScrollCommand(om.MPxCommand):
    kCommandName = "openScrollMarket"

    def __init__(self):
        super(OpenScrollCommand, self).__init__()

    @staticmethod
    def creator():
        return OpenScrollCommand()

    @staticmethod
    def newSyntax():
        return om.MSyntax()

    def doIt(self, args):
        open_scroll_window()

    def isUndoable(self):
        return False


def initializePlugin(mobject):
    plugin = om.MFnPlugin(mobject, "Kangming Zhan", "1.0.0", "Any")
    plugin.registerNode(
        ScrollMarketNode.kNodeName,
        ScrollMarketNode.kNodeId,
        ScrollMarketNode.creator,
        ScrollMarketNode.initialize,
    )
    plugin.registerCommand(
        OpenScrollCommand.kCommandName,
        OpenScrollCommand.creator,
        OpenScrollCommand.newSyntax,
    )


def uninitializePlugin(mobject):
    plugin = om.MFnPlugin(mobject)
    plugin.deregisterCommand(OpenScrollCommand.kCommandName)
    plugin.deregisterNode(ScrollMarketNode.kNodeId)
