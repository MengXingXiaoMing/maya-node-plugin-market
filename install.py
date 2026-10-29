# -*- coding: utf-8 -*-
"""节点插件市场 —— 安装到工具架并启动。

把本文件直接拖进 Maya 即可：
  1. 先清掉旧的「节点插件市场 / 权限窗口」工具架按钮，避免重复安装；
  2. 在当前工具架创建一个新的「节点插件市场」按钮；
  3. 打开市场窗口。
"""

import os
import sys
import importlib
import inspect

import maya.cmds as cmds
import maya.mel as mel

LABEL = u"节点插件市场"
LEGACY_LABELS = (u"权限窗口",)
LEGACY_NAMES = ("zkmNodeMarketShelfBtn",)
MODULE_NAME = "custom_commands_window"
ICON_NAME = "custom_commands_lcon.png"


def file_dir():
    """本文件所在目录。Maya 拖拽执行时 __file__ 可能不存在，退回代码对象文件名。"""
    path = globals().get("__file__")
    if not path:
        try:
            frame = inspect.currentframe()
            if frame is not None:
                path = frame.f_code.co_filename
        except Exception:
            path = None
    if not path:
        return os.getcwd()
    return os.path.dirname(os.path.abspath(path))


def _shelf_top():
    return mel.eval("string $tmpShelfTop = $gShelfTopLevel")


def remove_old_buttons():
    """删掉所有旧的同名按钮，解决重复安装。返回删除数量。"""
    removed = 0
    try:
        top = _shelf_top()
        shelves = cmds.tabLayout(top, query=True, childArray=True) or []
    except Exception:
        return 0
    wanted = (LABEL,) + LEGACY_LABELS
    for shelf in shelves:
        try:
            children = cmds.shelfLayout(shelf, query=True, childArray=True) or []
        except Exception:
            continue
        for child in children:
            try:
                if not cmds.objectType(child, isType="shelfButton"):
                    continue
                label = cmds.shelfButton(child, query=True, label=True)
            except Exception:
                continue
            if label in wanted or child in LEGACY_NAMES:
                try:
                    cmds.deleteUI(child)
                    removed += 1
                except Exception:
                    pass
    return removed


def create_shelf_button(directory):
    top = _shelf_top()
    current = str(cmds.tabLayout(top, query=True, selectTab=True))
    cmds.setParent(current)
    icon = os.path.join(directory, ICON_NAME)
    if not os.path.isfile(icon):
        icon = "pythonFamily.png"
    command = (
        "import sys\n"
        "sys.path.append(r'%s')\n"
        "import %s\n"
        "import importlib\n"
        "importlib.reload(%s)\n"
        "%s.window.show()\n"
    ) % (directory, MODULE_NAME, MODULE_NAME, MODULE_NAME)
    cmds.shelfButton(
        name=LEGACY_NAMES[0],
        sourceType="python",
        image=icon,
        image1=icon,
        label=LABEL,
        annotation=LABEL,
        iol="",
        command=command,
    )
    return icon


def launch(directory):
    if directory not in sys.path:
        sys.path.append(directory)
    module = sys.modules.get(MODULE_NAME)
    if module is not None:
        importlib.reload(module)
    else:
        module = __import__(MODULE_NAME)
    module.window.show()


def install():
    directory = file_dir()
    removed = remove_old_buttons()
    if removed:
        print(u"已清理 %d 个旧工具架按钮" % removed)
    try:
        create_shelf_button(directory)
        print(u"%s 已安装到工具架" % LABEL)
    except Exception as exc:
        cmds.warning(u"创建工具架按钮失败：%s" % exc)
    launch(directory)


install()
