# -*- coding: utf-8 -*-
"""节点插件市场 —— 唯一安装 / 启动入口

用法：
  把本文件拖入 Maya（脚本编辑器里执行，或拖入视口）即会：
    1. 在当前架子上创建「节点插件市场」按钮；
    2. 立即打开市场窗口。
  之后点击架子按钮即可随时打开。

注意：拖入 Maya 执行时不保证 __name__ == '__main__'，所以直接在模块
末尾调用 install()，与旧版 install.py 的行为一致。
"""
import os
import sys
import inspect
import importlib

import maya.cmds as cmds
import maya.mel as mel

# 当前文件所在目录（即 custom_commands 目录）
FILE_DIR = os.path.join(
    "\\".join(os.path.abspath(inspect.getsourcefile(lambda: 0)).split("\\")[:-1]))

if FILE_DIR not in sys.path:
    sys.path.insert(0, FILE_DIR)

SHELF_BUTTON_NAME = "zkmNodeMarketShelfBtn"


def create_shelf_button():
    """在当前架子上创建「节点插件市场」按钮（已存在则先删掉再重建）。"""
    gShelfTopLevel = mel.eval('string $my_gShelfTopLevel = $gShelfTopLevel')
    current_shelf = str(cmds.tabLayout(gShelfTopLevel, query=1, selectTab=1))
    cmds.setParent(current_shelf)

    label = u"节点插件市场"
    # 优先使用市场自己的图标，找不到再回退到 Maya 默认 Python 图标。
    custom_icon = os.path.join(FILE_DIR, "custom_commands_lcon.png")
    icon = custom_icon if os.path.isfile(custom_icon) else "pythonFamily.png"
    module = "custom_commands_window"

    # 先删除旧按钮，避免重复创建
    try:
        if cmds.control(SHELF_BUTTON_NAME, exists=True):
            cmds.deleteUI(SHELF_BUTTON_NAME)
    except Exception:
        pass

    cmd = (
        "import sys\n"
        "sys.path.insert(0, r'{path}')\n"
        "import {module}\n"
        "import importlib\n"
        "importlib.reload({module})\n"
        "from {module} import window\n"
        "window.show()"
    ).format(path=FILE_DIR, module=module)

    cmds.shelfButton(
        SHELF_BUTTON_NAME,
        sourceType="python",
        image=icon,
        label=label,
        iol="",
        command=cmd,
        image1=icon,
        annotation=label,
    )
    print(label + u" 架子按钮已安装。")


def launch():
    """导入并打开节点插件市场窗口。"""
    import custom_commands_window
    importlib.reload(custom_commands_window)
    from custom_commands_window import window
    return window.show()


def install():
    """安装架子按钮并立即打开窗口。

    架子按钮创建失败不影响窗口打开；错误会打印到脚本编辑器。
    """
    try:
        create_shelf_button()
    except Exception as exc:
        # 架子相关失败（没有当前架子、MEL 变量未就绪等）只警告，
        # 不能因此阻止市场窗口打开。
        cmds.warning(u"创建架子按钮失败（窗口仍会打开）：%s" % exc)
    return launch()


# 拖入 Maya 即执行（不依赖 __name__ == '__main__'）
install()
