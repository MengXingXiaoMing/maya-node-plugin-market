# -*- coding: utf-8 -*-
"""节点插件市场（Maya）

把原来的「自定义命令」文件树改成以 Maya 节点为单位的插件市场：
- 默认扫描工具目录下的 nodes/；
- 每个插件文件夹以节点注册序号命名；
- 识别到节点注册就生成一张插件卡片和启动按钮；
- 卡片悬停显示作者写在 NODE_INFO 里的详情。

入口：install.py 是唯一的安装/启动文件（创建架子按钮并打开窗口）；
本模块保持 window.show() 不变，旧的架子按钮/菜单命令仍然可用。
"""

from __future__ import absolute_import, unicode_literals

import importlib
import inspect
import io
import json
import os
import subprocess
import sys
import threading
import time
import zipfile

try:
    from urllib.request import Request as UrlRequest, urlopen
except ImportError:  # Python 2
    from urllib2 import Request as UrlRequest, urlopen

import maya.cmds as cmds

# 文件路径 / 插件根路径（沿用旧工具的相对位置算法）
FILE_DIR = os.path.join(
    "\\".join(os.path.abspath(inspect.getsourcefile(lambda: 0)).split("\\")[:-1]))
ROOT_DIR = os.path.join(
    "\\".join(os.path.abspath(inspect.getsourcefile(lambda: 0)).split("\\")[:-4]))

_maya_version = int(cmds.about(version=True))
for _offset in range(30):
    _version_dir = os.path.join(ROOT_DIR, str(_maya_version - _offset))
    if os.path.isdir(_version_dir):
        if _version_dir not in sys.path:
            sys.path.append(_version_dir)
        break

if FILE_DIR not in sys.path:
    sys.path.insert(0, FILE_DIR)

try:
    import general_settings
    from general_settings import *  # noqa: F401,F403
    importlib.reload(general_settings)
except Exception:
    # 独立运行模式：不依赖 ZKM 主插件的 general_settings
    try:
        from PySide6 import QtWidgets, QtCore, QtGui
        from PySide6.QtCore import Qt
    except ImportError:
        from PySide2 import QtWidgets, QtCore, QtGui
        from PySide2.QtCore import Qt
    from maya.app.general.mayaMixin import MayaQWidgetDockableMixin

import node_market
import online_market
import scene_requirements
importlib.reload(node_market)
importlib.reload(online_market)
importlib.reload(scene_requirements)

TOOL_VERSION = "3.1.6"
AUTHOR_NAME = "詹康明"
AUTHOR_NAME_EN = "Kangming Zhan"
GITHUB_OWNER = "MengXingXiaoMing"
GITHUB_REPO = "maya-node-plugin-market"
GITHUB_BRANCH = "main"
MARKET_GITHUB_URL = "https://github.com/%s/%s" % (GITHUB_OWNER, GITHUB_REPO)
UPDATE_ZIP_URL = "https://codeload.github.com/%s/%s/zip/refs/heads/%s" % (
    GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH)
UPDATE_FILES = (
    "custom_commands_window.py",
    "node_market.py",
    "online_market.py",
    "scene_requirements.py",
    "install.py",
    "custom_commands_lcon.png",
)
SETTINGS_PATH = os.path.join(FILE_DIR, "market_settings.json")
STATE_PATH = os.path.join(FILE_DIR, "market_state.json")
CACHE_PATH = os.path.join(FILE_DIR, "market_cache.json")
CATALOG_CACHE_PATH = os.path.join(FILE_DIR, "market_catalog_cache.json")
ICON_PATH = os.path.join(FILE_DIR, "custom_commands_lcon.png")
DEFAULT_NODES_DIR = os.path.join(FILE_DIR, "nodes")

# 自动加载（随 Maya 启动加载勾选的节点插件）。
# 注意：Maya 启动时没有登录上下文，所以清单存共享文件、并记录插件绝对路径，
# 启动时按路径直接加载，不依赖按用户的设置，也不需要重新扫描目录。
AUTOLOAD_PATH = os.path.join(FILE_DIR, "market_autoload.json")
AUTOLOAD_BEGIN = "# >>> zkm-node-market-autoload >>>"
AUTOLOAD_END = "# <<< zkm-node-market-autoload <<<"


def load_autoload_entries():
    try:
        with open(AUTOLOAD_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [e for e in data if isinstance(e, dict) and e.get("path")]
    except Exception:
        return []


def save_autoload_entries(entries):
    try:
        with open(AUTOLOAD_PATH, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def is_autoload(node_id_text):
    key = str(node_id_text or "").strip().lower()
    return any(str(e.get("node_id", "")).strip().lower() == key
               for e in load_autoload_entries())


def set_autoload(plugin, enabled):
    key = str(plugin.node_id_text or "").strip().lower()
    entries = [e for e in load_autoload_entries()
               if str(e.get("node_id", "")).strip().lower() != key]
    if enabled:
        entries.append({
            "node_id": plugin.node_id_text,
            "path": os.path.abspath(plugin.path),
            "name": plugin.title,
        })
    save_autoload_entries(entries)
    sync_autoload_startup()


def _usersetup_path():
    return os.path.join(cmds.internalVar(userScriptDir=True), "userSetup.py")


def _autoload_block():
    # 生成写进 userSetup.py 的启动代码：读取清单，逐个加载还没加载的插件。
    return (
        AUTOLOAD_BEGIN + "\n"
        "def _zkm_node_market_autoload():\n"
        "    try:\n"
        "        import os, sys, json\n"
        "        _d = %r\n"
        "        if _d not in sys.path:\n"
        "            sys.path.insert(0, _d)\n"
        "        import maya.utils as _mu\n"
        "        def _do():\n"
        "            try:\n"
        "                import node_market as _nm\n"
        "                _f = os.path.join(_d, 'market_autoload.json')\n"
        "                if not os.path.isfile(_f):\n"
        "                    return\n"
        "                for _e in json.load(open(_f)):\n"
        "                    _p = _e.get('path')\n"
        "                    if _p and os.path.isfile(_p) and not _nm.plugin_loaded(_p):\n"
        "                        _nm.load_plugin_file(_p)\n"
        "            except Exception:\n"
        "                pass\n"
        "        _mu.executeDeferred(_do)\n"
        "    except Exception:\n"
        "        pass\n"
        "_zkm_node_market_autoload()\n"
        + AUTOLOAD_END + "\n"
    ) % FILE_DIR


def _strip_autoload_block(text):
    out, skip = [], False
    for line in text.splitlines():
        s = line.strip()
        if s == AUTOLOAD_BEGIN:
            skip = True
            continue
        if s == AUTOLOAD_END:
            skip = False
            continue
        if not skip:
            out.append(line)
    return "\n".join(out).strip("\n")


def sync_autoload_startup():
    """按当前清单，把启动块写进 userSetup.py（有勾选）或移除（没勾选）。

    只动带标记的那一段，用户自己在 userSetup.py 里的其它内容原样保留。
    """
    try:
        path = _usersetup_path()
    except Exception:
        return
    existing = ""
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                existing = f.read()
        except Exception:
            existing = ""
    existing = _strip_autoload_block(existing)
    entries = load_autoload_entries()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if entries:
            new = existing
            if new and not new.endswith("\n"):
                new += "\n"
            new += "\n" + _autoload_block()
            with open(path, "w", encoding="utf-8") as f:
                f.write(new)
        else:
            if existing.strip():
                with open(path, "w", encoding="utf-8") as f:
                    f.write(existing + "\n")
            elif os.path.isfile(path):
                os.remove(path)
    except Exception as exc:
        cmds.warning("同步自动加载启动项失败：%s" % exc)


# ---------------------------------------------------------------------------
# 启动环境检查
# 启动时校验运行所需的 Python 包；缺失的会弹出环境检查对话框，
# 支持一键自动安装（调用当前 Maya 的 mayapy -m pip）和手动下载链接。
# required=True 的依赖缺失会阻塞启动，required=False 仅提示不阻塞。
# ---------------------------------------------------------------------------
ENV_DEPENDENCIES = (
    {
        "import_name": "PySide6",
        "pip_name": "PySide6",
        "display": u"PySide6（Qt 界面）",
        "required": True,
        "description": u"Maya 2025+ 自带，用于绘制市场窗口界面。",
        "download_url": "https://pypi.org/project/PySide6/",
    },
    {
        "import_name": "PySide2",
        "pip_name": "PySide2",
        "display": u"PySide2（Qt 界面）",
        "required": True,
        "description": u"Maya 2022-2024 自带，用于绘制市场窗口界面。",
        "download_url": "https://pypi.org/project/PySide2/",
    },
    {
        "import_name": "requests",
        "pip_name": "requests",
        "display": u"requests（在线市场）",
        "required": False,
        "description": u"推荐安装，用于更稳定地访问在线插件目录；缺失时自动使用内置 urllib。",
        "download_url": "https://pypi.org/project/requests/",
    },
)


def _try_import(name):
    """尝试导入模块，成功返回 True。"""
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def check_environment():
    """返回缺失的依赖列表。

    PySide6/PySide2 同属 Qt 界面家族，只要有一个可用就算通过；
    两者都缺失时只返回 PySide6 这一条（避免两条重复提示）。
    """
    missing = []
    pyside_ok = _try_import("PySide6") or _try_import("PySide2")
    pyside_reported = False
    for dep in ENV_DEPENDENCIES:
        if dep["import_name"] in ("PySide6", "PySide2"):
            if pyside_ok:
                continue
            if pyside_reported:
                continue
            # 两者都缺失：只加 PySide6 这一条（Maya 2025+ 推荐）
            missing.append(next(d for d in ENV_DEPENDENCIES if d["import_name"] == "PySide6"))
            pyside_reported = True
            continue
        if not _try_import(dep["import_name"]):
            missing.append(dep)
    return missing


def pip_install_package(pip_name):
    """用当前 Maya 的解释器执行 pip install，返回 (success, output)。"""
    mayapy = sys.executable
    if not mayapy:
        return False, u"找不到 Maya Python 解释器。"
    try:
        proc = subprocess.Popen(
            [mayapy, "-m", "pip", "install", pip_name],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        out, _ = proc.communicate()
        try:
            text = out.decode("utf-8", errors="replace")
        except Exception:
            text = str(out)
        return proc.returncode == 0, text
    except Exception as exc:
        return False, u"调用 pip 失败：%s" % exc


# ---------------------------------------------------------------------------
# 多用户数据隔离
# 节点插件(nodes/)、解析缓存(market_cache.json)、在线目录缓存 保持共享；
# 个人设置(market_settings.json)、收藏(market_state.json) 按用户名隔离，
# 存放在 FILE_DIR/user_data/<用户名>/ 下。
# 本地登录信息（自动登录用户名）存放在系统当前用户的应用数据目录。
# ---------------------------------------------------------------------------
USER_DATA_ROOT = os.path.join(FILE_DIR, "user_data")


def _local_login_path():
    """本地登录信息文件路径（系统当前用户私有，用于自动登录）。"""
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(appdata, "ZKMNodeMarket", "login.json")


def _default_user_name():
    return os.environ.get("USERNAME") or os.environ.get("USER") or "user"


def _sanitize_user_name(name):
    """把用户名转成可用于目录名的安全字符串。"""
    name = (name or "").strip()
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe.strip() or "user"


_CURRENT_USER = None


def get_current_user():
    """返回当前登录的用户名；若没有自动登录记录则返回 None。"""
    global _CURRENT_USER
    if _CURRENT_USER:
        return _CURRENT_USER
    try:
        with io.open(_local_login_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and data.get("auto_login") and data.get("user"):
            _CURRENT_USER = _sanitize_user_name(data["user"])
            return _CURRENT_USER
    except Exception:
        pass
    return None


def set_current_user(name, auto_login=False):
    """设置当前用户并写入本地登录信息；同时确保其个人数据目录存在。"""
    global _CURRENT_USER
    _CURRENT_USER = _sanitize_user_name(name)
    try:
        folder = os.path.dirname(_local_login_path())
        if not os.path.isdir(folder):
            os.makedirs(folder)
        with io.open(_local_login_path(), "w", encoding="utf-8") as handle:
            json.dump(
                {"user": _CURRENT_USER, "auto_login": bool(auto_login)},
                handle, ensure_ascii=False, indent=2)
    except Exception as exc:
        cmds.warning("保存登录信息失败：%s" % exc)
    user_dir = os.path.join(USER_DATA_ROOT, _CURRENT_USER)
    if not os.path.isdir(user_dir):
        try:
            os.makedirs(user_dir)
        except Exception:
            pass
    return _CURRENT_USER


def user_dir(name=None):
    name = _sanitize_user_name(name) if name else (get_current_user() or _default_user_name())
    return os.path.join(USER_DATA_ROOT, name)


def user_settings_path():
    return os.path.join(user_dir(), "settings.json")


def user_state_path():
    return os.path.join(user_dir(), "state.json")


def _migrate_shared_to_user(name):
    """首次登录时，把旧版共享的 settings/state 复制给该用户作为初始数据。"""
    target_dir = user_dir(name)
    if not os.path.isdir(target_dir):
        try:
            os.makedirs(target_dir)
        except Exception:
            pass
    for shared, per_user in ((SETTINGS_PATH, user_settings_path()),
                             (STATE_PATH, user_state_path())):
        if os.path.isfile(shared) and not os.path.isfile(per_user):
            try:
                import shutil
                shutil.copyfile(shared, per_user)
            except Exception:
                pass


COLORS = ["#4a86e8", "#8a6cf0", "#2fa79a", "#d08a3e", "#c95f7c", "#5a8fb8"]

# 卡片固定宽度与网格间距：用于计算响应式列数（最高支持 6 列）
CARD_WIDTH = 280
GRID_SPACING = 14
GRID_MARGIN = 44
MAX_COLUMNS = 6

QSS = """
QMainWindow, #marketRoot { background: #1f2126; }
#header { background: #24262c; border-bottom: 1px solid #34373f; }
#appTitle { color: #f2f4f8; font-size: 23px; font-weight: 700; }
#appSubtitle { color: #9aa1ad; font-size: 12px; }
#appAuthor { color: #8f96a2; font-size: 11px; }
QPushButton#winCtrl {
    background: transparent; border: none; border-radius: 6px;
    color: #9aa1ad; font-size: 13px; padding: 0px;
    min-width: 30px; min-height: 24px;
}
QPushButton#winCtrl:hover { background: #34373f; color: #e8eaf0; }
QPushButton#winClose {
    background: transparent; border: none; border-radius: 6px;
    color: #9aa1ad; font-size: 13px; padding: 0px;
    min-width: 30px; min-height: 24px;
}
QPushButton#winClose:hover { background: #e81123; color: white; }
#badge {
    background: rgba(91, 157, 255, 0.14); color: #9cc4ff;
    border: 1px solid rgba(91, 157, 255, 0.35);
    border-radius: 9px; padding: 2px 9px; font-size: 11px;
}
QLineEdit#searchBox {
    background: #1b1d22; border: 1px solid #3a3d46; border-radius: 9px;
    padding-left: 12px; padding-right: 12px; color: #e8eaf0; font-size: 12px;
    selection-background-color: #3b6fd4;
}
QLineEdit#searchBox:focus { border-color: #5b9dff; }
QLineEdit#tagSearch {
    background: #1b1d22; border: 1px solid #343842; border-radius: 8px;
    padding-left: 9px; padding-right: 9px; color: #dfe3ea; font-size: 11px;
    selection-background-color: #3b6fd4;
}
QLineEdit#tagSearch:focus { border-color: #5b9dff; }
QCheckBox#filterCheck { color: #aab1bd; font-size: 11px; spacing: 6px; }
QCheckBox#filterCheck::indicator {
    width: 14px; height: 14px; border-radius: 4px;
    border: 1px solid #3a3e48; background: #1b1d22;
}
QCheckBox#filterCheck::indicator:checked {
    background: #4a86e8; border-color: #4a86e8;
}
QComboBox#sortBox {
    background: #1b1d22; color: #dfe3ea; border: 1px solid #3a3e48;
    border-radius: 7px; padding: 3px 8px; font-size: 11px; min-width: 88px;
}
QComboBox#sortBox::drop-down { border: none; width: 16px; }
QComboBox#sortBox QAbstractItemView {
    background: #22252b; color: #dfe3ea; border: 1px solid #3a3e48;
    selection-background-color: #3b6fd4;
}
QMenu {
    background: #22252b; color: #dfe3ea;
    border: 1px solid #3a3e48; border-radius: 8px;
    padding: 5px; font-size: 12px;
}
QMenu::item {
    background: transparent; color: #dfe3ea;
    padding: 6px 24px; border-radius: 5px; margin: 1px 3px;
}
QMenu::item:selected {
    background: rgba(91, 157, 255, 0.18); color: #eaf1ff;
}
QMenu::item:disabled { color: #5a616d; }
QMenu::separator { height: 1px; background: #34373f; margin: 5px 10px; }
QMenu::indicator {
    width: 14px; height: 14px; border-radius: 4px;
    border: 1px solid #3a3e48; background: #1b1d22;
}
QMenu::indicator:checked { background: #4a86e8; border-color: #4a86e8; }
QLineEdit#pathEdit {
    background: #1b1d22; border: 1px solid #3a3d46; border-radius: 8px;
    padding: 6px 10px; color: #dfe3ea; font-size: 12px;
}
QLineEdit#pathEdit:focus { border-color: #5b9dff; }
QLineEdit#submitEdit {
    background: #1b1d22; border: 1px solid #3a3d46; border-radius: 8px;
    padding: 6px 10px; color: #dfe3ea; font-size: 12px;
}
QLineEdit#submitEdit:focus { border-color: #5b9dff; }
QPlainTextEdit#submitPreview {
    background: #1b1d22; border: 1px solid #333640; border-radius: 8px;
    color: #9fb6d8; font-family: Consolas, "Cascadia Mono", monospace;
    font-size: 11px; padding: 8px;
}
#tabs { background: #1b1d22; border: 1px solid #333640; border-radius: 10px; }
QPushButton#tabButton {
    background: transparent; color: #9aa1ad; border: none;
    border-radius: 7px; padding: 6px 18px; font-size: 12px;
}
QPushButton#tabButton:hover { color: #e8eaf0; background: #282b32; }
QPushButton#tabButton:checked {
    color: #cfe0ff; background: rgba(91, 157, 255, 0.18);
}
#pluginCard {
    background: #272a30; border: 1px solid #343842; border-radius: 12px;
}
#pluginCard[hovered="true"] {
    background: #2c3038; border-color: #4a6ea8;
}
#cardTitle { color: #eef1f6; font-size: 14px; font-weight: 600; }
#cardMeta { color: #9299a5; font-size: 11px; }
#cardDesc { color: #a8aeba; font-size: 12px; }
#mono {
    color: #9fb6d8; font-family: Consolas, "Cascadia Mono", monospace; font-size: 11px;
}
#pill {
    background: #21242a; color: #9aa1ad; border: 1px solid #3a3e48;
    border-radius: 8px; padding: 1px 7px;
    font-family: Consolas, "Cascadia Mono", monospace; font-size: 10px;
}
#loadedText { color: #63c98d; font-size: 11px; }
#unloadedText { color: #8c93a0; font-size: 11px; }
#updateText { color: #e0b25a; font-size: 11px; }
QDialog#taskDialog { background: #24272e; }
#taskTitle { color: #f2f4f8; font-size: 18px; font-weight: 700; }
#taskName { color: #cfe0ff; font-size: 13px; }
#taskStep { color: #9aa1ad; font-size: 12px; }
#taskDetail { color: #7f8794; font-size: 11px; }
QProgressBar {
    background: #1d2025; color: #dfe5ee; border: 1px solid #3a3e48;
    border-radius: 6px; min-height: 18px; text-align: center; font-size: 10px;
}
QProgressBar::chunk {
    border-radius: 5px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #4a86e8, stop:1 #8a6cf0);
}
QPushButton#tagChip {
    background: #24262c; color: #9aa1ad; border: 1px solid #363a44;
    border-radius: 10px; padding: 3px 10px; font-size: 11px;
}
QPushButton#tagChip:hover { color: #e6e9ef; border-color: #4a4f5b; background: #2b2f37; }
QPushButton#tagChip:checked {
    color: #cfe0ff; border-color: rgba(91, 157, 255, 0.55);
    background: rgba(91, 157, 255, 0.18);
}
#tagBar { background: transparent; border: none; }
#tagHost { background: transparent; }
QPushButton#starButton {
    background: transparent; color: #8f96a2; border: 1px solid #3a3e48;
    border-radius: 7px; font-size: 14px; padding: 0px;
}
QPushButton#starButton:hover { color: #ffcf5c; border-color: #6b5a2e; background: #2c3038; }
QPushButton#starButton[active="true"] { color: #ffcf5c; border-color: #6b5a2e; }
QPushButton#primaryButton {
    background: #4a86e8; color: white; border: none; border-radius: 8px;
    padding: 5px 14px; font-size: 12px; font-weight: 600;
}
QPushButton#primaryButton:hover { background: #5b94f0; }
QPushButton#primaryButton:pressed { background: #3d73c9; }
QPushButton#primaryButton:disabled { background: #3a3e47; color: #7e8592; }
QPushButton#ghostButton {
    background: transparent; color: #aab1bd; border: 1px solid #3a3e48;
    border-radius: 8px; padding: 5px 12px; font-size: 12px;
}
QPushButton#ghostButton:hover { background: #2c3038; color: #e6e9ef; border-color: #4a4f5b; }
QPushButton#ghostButton[update="true"] {
    background: #2f4f86; color: #eaf1ff; border-color: #4a86e8;
}
QPushButton#ghostButton[update="true"]:hover {
    background: #3a62a5; color: #ffffff; border-color: #6aa2f5;
}
QPushButton#linkButton {
    background: #24262c; color: #a9c8f5; border: 1px solid #363a44;
    border-radius: 10px; padding: 10px 14px; text-align: left; font-size: 12px;
}
QPushButton#linkButton:hover { background: #2b2f37; border-color: #4a6ea8; }
#statusBar { background: #23252a; border-top: 1px solid #34373f; }
#statusText { color: #8f96a2; font-size: 11px; }
#statusMessage { color: #8fd3a8; font-size: 11px; }
#settingsCard {
    background: #26282e; border: 1px solid #343842; border-radius: 12px;
}
#sectionTitle { color: #e8ebf2; font-size: 13px; font-weight: 600; }
#hint { color: #8f96a2; font-size: 11px; }
#ruleText { color: #a8aeba; font-size: 11px; }
#emptyTitle { color: #cfd4dd; font-size: 14px; font-weight: 600; }
#emptyHint { color: #868d99; font-size: 11px; }
#emptyCard {
    background: #23252b; border: 1px dashed #3d414c; border-radius: 14px;
}
#listRow {
    background: #272a30; border: 1px solid #343842; border-radius: 10px;
}
QScrollArea { background: transparent; border: none; }
QScrollBar:vertical { background: transparent; width: 10px; margin: 2px; }
QScrollBar::handle:vertical {
    background: #3f434d; border-radius: 4px; min-height: 30px;
}
QScrollBar::handle:vertical:hover { background: #525866; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
QScrollBar:horizontal { background: transparent; height: 10px; margin: 2px; }
QScrollBar::handle:horizontal {
    background: #3f434d; border-radius: 4px; min-width: 30px;
}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; }
QDialog#detailDialog { background: #22242a; }
#dialogTitle { color: #f2f4f8; font-size: 18px; font-weight: 700; }
#dialogDesc {
    background: #1e2025; border: 1px solid #343842; border-radius: 10px;
    padding: 12px; color: #c3c9d4; font-size: 12px;
}
#fieldLabel { color: #8b93a0; font-size: 11px; }
#fieldValue { color: #dfe3ea; font-size: 12px; }

QDialog#envDialog { background: #1f2126; }
#envHeader { background: #24262c; border-bottom: 1px solid #34373f; }
#envTitle { color: #f2f4f8; font-size: 15px; font-weight: 600; }
#envTip { color: #9aa1ad; font-size: 12px; }
#envRow {
    background: #272a30; border: 1px solid #343842; border-radius: 8px;
}
#envRowTitle { color: #eef1f6; font-size: 13px; font-weight: 600; }
#envRowDesc { color: #9aa1ad; font-size: 11px; }
#envRowStatus { font-size: 11px; }
QPushButton#envInstall {
    background: #4a86e8; color: white; border: none; border-radius: 6px;
    padding: 5px 14px; font-size: 12px; font-weight: 600;
}
QPushButton#envInstall:hover { background: #5b94f0; }
QPushButton#envInstall:pressed { background: #3d73c9; }
QPushButton#envInstall:disabled { background: #3a3e47; color: #7e8592; }
QPushButton#envDl {
    background: transparent; color: #aab1bd; border: 1px solid #3a3e48;
    border-radius: 6px; padding: 5px 12px; font-size: 12px;
}
QPushButton#envDl:hover { background: #2c3038; color: #e6e9ef; border-color: #4a4f5b; }
"""


# ---------------------------------------------------------------------------
# 设置
# ---------------------------------------------------------------------------
def load_settings():
    default = {
        "nodes_dir": DEFAULT_NODES_DIR,
        "github_url": MARKET_GITHUB_URL,
        "scene_check": True,
        "skip_env_optional": False,
    }
    try:
        with io.open(user_settings_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            for key, value in data.items():
                if value is None:
                    continue
                if isinstance(value, str) and not value:
                    continue
                default[key] = value
    except Exception:
        pass
    if not default.get("nodes_dir") or not os.path.isdir(default.get("nodes_dir")):
        default["nodes_dir"] = DEFAULT_NODES_DIR
    return default


def save_settings(data):
    try:
        path = user_settings_path()
        folder = os.path.dirname(path)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2))
        return True
    except Exception as exc:
        cmds.warning("保存市场设置失败：%s" % exc)
        return False


def load_state():
    default = {"favorites": []}
    try:
        with io.open(user_state_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            favorites = data.get("favorites") or []
            if isinstance(favorites, list):
                default["favorites"] = [str(item) for item in favorites if item]
    except Exception:
        pass
    return default


def save_state(data):
    try:
        path = user_state_path()
        folder = os.path.dirname(path)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2))
        return True
    except Exception as exc:
        cmds.warning("保存市场收藏失败：%s" % exc)
        return False


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------
def html_escape(text):
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def icon_color(plugin):
    value = plugin.node_id or 0
    return COLORS[value % len(COLORS)]


def tooltip_html(plugin):
    rows = []
    rows.append('<div style="max-width: 380px; white-space: normal;">')
    rows.append('<b style="font-size:13px;">%s</b>' % html_escape(plugin.title))
    if plugin.version:
        rows.append(' <span style="color:#9aa1ad;">v%s</span>' % html_escape(plugin.version))
    rows.append("<br>")
    if plugin.author:
        rows.append('<span style="color:#9aa1ad;">作者：%s</span><br>' % html_escape(plugin.author))
    rows.append('<span style="color:#9aa1ad;">节点：</span>%s<br>' % html_escape(plugin.node_name or "—"))
    rows.append('<span style="color:#9aa1ad;">序号：</span>%s' % html_escape(plugin.node_id_text))
    if plugin.description:
        rows.append('<br><br>%s' % html_escape(plugin.description))
    if plugin.tags:
        rows.append('<br><br><span style="color:#9aa1ad;">标签：%s</span>' % html_escape(" / ".join(plugin.tags)))
    rows.append("</div>")
    return "".join(rows)


def apply_icon(label, plugin, size=44):
    label.setFixedSize(size, size)
    label.setAlignment(Qt.AlignCenter)
    if plugin.icon and os.path.isfile(plugin.icon):
        pixmap = QPixmap(plugin.icon)
        if not pixmap.isNull():
            label.setPixmap(pixmap.scaled(
                size, size, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation))
            label.setStyleSheet("background: transparent; border-radius: %dpx;" % (size // 5))
            return
    label.setText((plugin.title or "?")[:1].upper())
    label.setStyleSheet(
        "background: %s; color: #ffffff; border-radius: %dpx;"
        "font-size: %dpx; font-weight: 700;" % (icon_color(plugin), size // 5, size // 2 - 2))


def exec_menu(menu, position):
    handler = getattr(menu, "exec", None) or getattr(menu, "exec_", None)
    if handler is not None:
        handler(position)


def exec_dialog(dialog):
    handler = getattr(dialog, "exec", None) or getattr(dialog, "exec_", None)
    if handler is not None:
        return handler()


def pump_events():
    """安装/更新过程中泵事件：只处理绘制和定时器，屏蔽用户输入。

    直接 processEvents() 会让用户在安装途中点击别的卡片，重入安装流程、
    销毁正在使用的对话框，这是窗口崩溃的来源之一。
    """
    flags = getattr(QtCore.QEventLoop, "ExcludeUserInputEvents", None)
    try:
        if flags is None:
            QtWidgets.QApplication.processEvents()
        else:
            QtWidgets.QApplication.processEvents(flags)
    except Exception:
        pass


# 后台线程注册表：线程不挂在窗口下面，窗口被销毁时不会连带销毁还在运行的
# QThread（Qt 对这种情况会 qFatal 直接中止进程）。
_BG_THREADS = set()


def keep_thread(thread):
    """让线程脱离窗口生命周期，结束后自动解除引用。"""
    _BG_THREADS.add(thread)

    def _drop():
        try:
            _BG_THREADS.discard(thread)
        except Exception:
            pass

    thread.finished.connect(_drop)
    return thread


def open_url(url):
    if not url:
        return
    try:
        QtGui.QDesktopServices.openUrl(QtCore.QUrl(url))
    except Exception:
        import webbrowser
        webbrowser.open(url)


# ---------------------------------------------------------------------------
# 插件卡片
# ---------------------------------------------------------------------------
class AnimatedSwitch(QtWidgets.QWidget):
    """滑动开关：点击切换，滑块位置/轨道颜色用属性动画平滑过渡。"""

    toggled = QtCore.Signal(bool)

    def __init__(self, parent=None, checked=False):
        super().__init__(parent)
        self._checked = bool(checked)
        self._offset = 1.0 if self._checked else 0.0
        self.setFixedSize(38, 20)
        self.setCursor(Qt.PointingHandCursor)
        self._anim = QtCore.QPropertyAnimation(self, b"offset", self)
        self._anim.setDuration(180)
        self._anim.setEasingCurve(QtCore.QEasingCurve.InOutCubic)

    def get_offset(self):
        return self._offset

    def set_offset(self, value):
        self._offset = value
        self.update()

    offset = QtCore.Property(float, get_offset, set_offset)

    def isChecked(self):
        return self._checked

    def setChecked(self, checked, animate=True):
        checked = bool(checked)
        if checked == self._checked:
            return
        self._checked = checked
        self._anim.stop()
        self._anim.setStartValue(self._offset)
        self._anim.setEndValue(1.0 if checked else 0.0)
        if animate:
            self._anim.start()
        else:
            self._offset = 1.0 if checked else 0.0
            self.update()
        self.toggled.emit(self._checked)

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.setChecked(not self._checked)
        super().mouseReleaseEvent(event)

    def paintEvent(self, event):
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
        w, h = float(self.width()), float(self.height())
        radius = (h - 2) / 2.0
        off = self._offset
        # 轨道颜色随滑块位置在灰/蓝之间渐变
        c_off, c_on = QtGui.QColor("#3a3e48"), QtGui.QColor("#4a86e8")
        track = QtGui.QColor(
            int(c_off.red() + (c_on.red() - c_off.red()) * off),
            int(c_off.green() + (c_on.green() - c_off.green()) * off),
            int(c_off.blue() + (c_on.blue() - c_off.blue()) * off))
        painter.setPen(Qt.NoPen)
        painter.setBrush(track)
        painter.drawRoundedRect(QtCore.QRectF(0, 1, w, h - 2), radius, radius)
        # 滑块
        margin = 3.0
        d = h - 2 - 2 * margin
        x = margin + off * (w - 2 * margin - d)
        painter.setBrush(QtGui.QColor("#f2f4f8"))
        painter.drawEllipse(QtCore.QRectF(x, 1 + margin, d, d))
        painter.end()


class PluginCard(QtWidgets.QFrame):
    def __init__(self, plugin, parent, on_primary, on_detail, on_menu,
                 on_favorite=None, is_favorite=False):
        super().__init__(parent)
        self.plugin = plugin
        self._on_primary = on_primary
        self._on_detail = on_detail
        self._on_menu = on_menu
        self._on_favorite = on_favorite
        self._favorite = bool(is_favorite)
        self._hovered = False

        self.setObjectName("pluginCard")
        self.setFixedWidth(CARD_WIDTH)
        self.setMinimumHeight(216)
        self.setAttribute(Qt.WA_Hover, True)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_menu)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(14, 13, 14, 12)
        layout.setSpacing(8)

        top = QtWidgets.QHBoxLayout()
        top.setSpacing(10)
        self.icon_label = QtWidgets.QLabel()
        apply_icon(self.icon_label, plugin)
        top.addWidget(self.icon_label, 0, Qt.AlignTop)

        title_box = QtWidgets.QVBoxLayout()
        title_box.setSpacing(2)
        self.title_label = QtWidgets.QLabel(node_market.shorten(plugin.title, 18))
        self.title_label.setObjectName("cardTitle")
        meta = plugin.author or "未署名"
        if plugin.version:
            meta += "  ·  v%s" % plugin.version
        self.meta_label = QtWidgets.QLabel(node_market.shorten(meta, 28))
        self.meta_label.setObjectName("cardMeta")
        title_box.addWidget(self.title_label)
        title_box.addWidget(self.meta_label)
        top.addLayout(title_box, 1)

        self.state_label = QtWidgets.QLabel()
        self.state_label.setAlignment(Qt.AlignRight | Qt.AlignTop)
        top.addWidget(self.state_label, 0, Qt.AlignTop)
        layout.addLayout(top)

        node_row = QtWidgets.QHBoxLayout()
        node_row.setSpacing(6)
        self.node_label = QtWidgets.QLabel(plugin.node_name or "未命名节点")
        self.node_label.setObjectName("mono")
        self.id_label = QtWidgets.QLabel(plugin.node_id_text)
        self.id_label.setObjectName("pill")
        node_row.addWidget(self.node_label, 1)
        node_row.addWidget(self.id_label, 0)
        layout.addLayout(node_row)

        self.desc_label = QtWidgets.QLabel(node_market.shorten(plugin.description or "作者没有填写详情。", 48))
        self.desc_label.setObjectName("cardDesc")
        self.desc_label.setWordWrap(True)
        self.desc_label.setFixedHeight(38)
        self.desc_label.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        layout.addWidget(self.desc_label)

        autoload_row = QtWidgets.QHBoxLayout()
        autoload_row.setSpacing(7)
        autoload_tip = "勾选后，下次启动 Maya 会自动加载这个节点插件，\n打开用到它的场景时节点不会再变成 unknown。"
        self.autoload_switch = AnimatedSwitch(self, checked=is_autoload(plugin.node_id_text))
        self.autoload_switch.setToolTip(autoload_tip)
        autoload_label = QtWidgets.QLabel("开机自动加载")
        autoload_label.setObjectName("cardMeta")
        autoload_label.setCursor(Qt.PointingHandCursor)
        autoload_label.setToolTip(autoload_tip)
        autoload_label.mouseReleaseEvent = (
            lambda e: self.autoload_switch.setChecked(not self.autoload_switch.isChecked()))
        self.autoload_switch.toggled.connect(
            lambda checked: self._on_menu("autoload", self.plugin, checked))
        autoload_row.addWidget(self.autoload_switch)
        autoload_row.addWidget(autoload_label)
        autoload_row.addStretch(1)
        layout.addLayout(autoload_row)

        footer = QtWidgets.QHBoxLayout()
        footer.setSpacing(6)
        self.star_button = QtWidgets.QPushButton("☆")
        self.star_button.setObjectName("starButton")
        self.star_button.setFixedSize(28, 26)
        self.star_button.setCursor(Qt.PointingHandCursor)
        self.star_button.clicked.connect(self._favorite_clicked)
        self.detail_button = QtWidgets.QPushButton("详情")
        self.detail_button.setObjectName("ghostButton")
        self.detail_button.setCursor(Qt.PointingHandCursor)
        self.detail_button.clicked.connect(lambda: self._on_detail(self.plugin))
        self.folder_button = QtWidgets.QPushButton("文件夹")
        self.folder_button.setObjectName("ghostButton")
        self.folder_button.setCursor(Qt.PointingHandCursor)
        self.folder_button.setToolTip("打开插件所在文件夹：\n%s" % plugin.folder)
        self.folder_button.clicked.connect(lambda: node_market.open_in_explorer(self.plugin.path))
        self.primary_button = QtWidgets.QPushButton("加载")
        self.primary_button.setObjectName("primaryButton")
        self.primary_button.setCursor(Qt.PointingHandCursor)
        self.primary_button.clicked.connect(self._primary_clicked)
        footer.addWidget(self.star_button)
        footer.addWidget(self.detail_button)
        footer.addWidget(self.folder_button)
        footer.addStretch(1)
        footer.addWidget(self.primary_button)
        layout.addLayout(footer)

        tip = tooltip_html(plugin)
        self.setToolTip(tip)
        for child in self.findChildren(QtWidgets.QWidget):
            if not isinstance(child, QtWidgets.QPushButton):
                child.setToolTip(tip)
                child.installEventFilter(self)
        self.installEventFilter(self)

        self.set_favorite(self._favorite)
        self.refresh_state()

    def mouseDoubleClickEvent(self, event):
        self._on_detail(self.plugin)
        super().mouseDoubleClickEvent(event)

    def _primary_clicked(self):
        self._on_primary(self.plugin)

    def _favorite_clicked(self):
        if self._on_favorite is not None:
            self._on_favorite(self.plugin)

    def set_favorite(self, favorite):
        self._favorite = bool(favorite)
        self.star_button.setText("★" if self._favorite else "☆")
        self.star_button.setToolTip("取消收藏" if self._favorite else "收藏插件")
        self.star_button.setProperty("active", "true" if self._favorite else "false")
        self.star_button.style().unpolish(self.star_button)
        self.star_button.style().polish(self.star_button)

    def _show_menu(self, position):
        menu = QtWidgets.QMenu(self)
        menu.addAction("打开所在文件夹", lambda: node_market.open_in_explorer(self.plugin.path))
        menu.addAction("复制节点序号", lambda: QtWidgets.QApplication.clipboard().setText(
            self.plugin.node_id_text))
        menu.addAction("复制插件路径", lambda: QtWidgets.QApplication.clipboard().setText(
            self.plugin.path))
        menu.addAction("取消收藏" if self._favorite else "收藏插件",
                       lambda: self._favorite_clicked())
        menu.addAction("重新扫描", lambda: self._on_menu("refresh"))
        menu.addSeparator()
        menu.addAction("投稿到在线目录（无需 Token）",
                       lambda: self._on_menu("submit", self.plugin))
        if node_market.plugin_loaded(self.plugin.path):
            menu.addSeparator()
            menu.addAction("卸载插件", lambda: self._on_menu("unload", self.plugin))
        menu.addSeparator()
        menu.addAction("删除插件（移到备份）", lambda: self._on_menu("delete", self.plugin))
        exec_menu(menu, QtGui.QCursor.pos())

    def eventFilter(self, obj, event):
        if event.type() in (QtCore.QEvent.Enter, QtCore.QEvent.Leave):
            QtCore.QTimer.singleShot(0, self._sync_hover)
        return False

    def _sync_hover(self):
        try:
            inside = self.rect().contains(self.mapFromGlobal(QtGui.QCursor.pos()))
        except Exception:
            return
        if inside != self._hovered:
            self._hovered = inside
            self.setProperty("hovered", "true" if inside else "false")
            self.style().unpolish(self)
            self.style().polish(self)
            self.update()

    def refresh_state(self):
        loaded = node_market.plugin_loaded(self.plugin.path)
        if loaded:
            self.state_label.setText("● 已加载")
            self.state_label.setObjectName("loadedText")
        else:
            self.state_label.setText("● 未加载")
            self.state_label.setObjectName("unloadedText")
        self.state_label.style().unpolish(self.state_label)
        self.state_label.style().polish(self.state_label)
        if not loaded:
            self.primary_button.setText("加载")
            self.primary_button.setEnabled(True)
        elif self.plugin.is_runnable():
            self.primary_button.setText("运行")
            self.primary_button.setEnabled(True)
        else:
            self.primary_button.setText("已加载")
            self.primary_button.setEnabled(False)


# ---------------------------------------------------------------------------
# 在线目录
# ---------------------------------------------------------------------------
class CatalogWorker(QtCore.QObject):
    done = QtCore.Signal(bool, object, str)

    def run(self):
        try:
            data = online_market.fetch_catalog()
        except Exception as exc:
            self.done.emit(False, None, str(exc))
            return
        self.done.emit(True, data, "")


class StarsWorker(QtCore.QObject):
    done = QtCore.Signal(object)

    def __init__(self, repos):
        super().__init__()
        self.repos = list(repos)

    def run(self):
        try:
            stars = online_market.fetch_repo_stars(self.repos)
        except Exception:
            stars = {}
        self.done.emit(stars)


class VersionWorker(QtCore.QObject):
    done = QtCore.Signal(str)

    def run(self):
        try:
            version = online_market.fetch_remote_version()
        except Exception:
            version = ""
        self.done.emit(version)


class MarketUpdateWorker(QtCore.QObject):
    """后台下载/覆盖市场代码，界面在主线程里更新，不会再白屏。"""

    progress = QtCore.Signal(str, object, str)
    done = QtCore.Signal(bool, object, str)

    def __init__(self, task, cancel_event):
        super().__init__()
        self._task = task
        self._cancel = cancel_event

    def run(self):
        def report(stage, message, percent=None, detail=""):
            self.progress.emit(message, percent, detail)
            if self._cancel.is_set():
                raise online_market.Cancelled()

        try:
            copied = self._task(report)
        except online_market.Cancelled:
            self.done.emit(False, None, "cancelled")
        except Exception as exc:
            self.done.emit(False, None, str(exc))
        else:
            self.done.emit(True, copied, "")


class OnlineCard(QtWidgets.QFrame):
    def __init__(self, entry, installed, parent, on_install, on_detail,
                 on_favorite, is_favorite=False):
        super().__init__(parent)
        self.entry = entry
        self.plugin = entry
        self._installed = installed
        self._on_install = on_install
        self._on_detail = on_detail
        self._on_favorite = on_favorite
        self._favorite = bool(is_favorite)
        self._hovered = False

        self.setObjectName("pluginCard")
        self.setFixedWidth(CARD_WIDTH)
        self.setMinimumHeight(216)
        self.setAttribute(Qt.WA_Hover, True)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_menu)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(14, 13, 14, 12)
        layout.setSpacing(8)

        top = QtWidgets.QHBoxLayout()
        top.setSpacing(10)
        self.icon_label = QtWidgets.QLabel()
        apply_icon(self.icon_label, entry)
        top.addWidget(self.icon_label, 0, Qt.AlignTop)

        title_box = QtWidgets.QVBoxLayout()
        title_box.setSpacing(2)
        self.title_label = QtWidgets.QLabel(node_market.shorten(entry.title, 18))
        self.title_label.setObjectName("cardTitle")
        meta_parts = [entry.author or "未署名"]
        if entry.category_label:
            meta_parts.append(entry.category_label)
        if entry.version:
            meta_parts.append("v%s" % entry.version)
        self.meta_label = QtWidgets.QLabel(node_market.shorten("  ·  ".join(meta_parts), 30))
        self.meta_label.setObjectName("cardMeta")
        title_box.addWidget(self.title_label)
        title_box.addWidget(self.meta_label)
        top.addLayout(title_box, 1)

        self.state_label = QtWidgets.QLabel()
        self.state_label.setAlignment(Qt.AlignRight | Qt.AlignTop)
        top.addWidget(self.state_label, 0, Qt.AlignTop)
        layout.addLayout(top)

        node_row = QtWidgets.QHBoxLayout()
        node_row.setSpacing(6)
        self.node_label = QtWidgets.QLabel(entry.node_name or "未命名节点")
        self.node_label.setObjectName("mono")
        self.id_label = QtWidgets.QLabel(entry.node_id_text)
        self.id_label.setObjectName("pill")
        node_row.addWidget(self.node_label, 1)
        node_row.addWidget(self.id_label, 0)
        layout.addLayout(node_row)

        self._date_text = ("更新于 %s" % entry.updated) if entry.updated else ""
        self.date_label = QtWidgets.QLabel(self._date_text)
        self.date_label.setObjectName("cardMeta")
        self.date_label.setVisible(bool(entry.updated))
        layout.addWidget(self.date_label)

        self.desc_label = QtWidgets.QLabel(node_market.shorten(entry.description or "作者没有填写详情。", 52))
        self.desc_label.setObjectName("cardDesc")
        self.desc_label.setWordWrap(True)
        self.desc_label.setFixedHeight(38)
        self.desc_label.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        layout.addWidget(self.desc_label)

        footer = QtWidgets.QHBoxLayout()
        footer.setSpacing(6)
        self.star_button = QtWidgets.QPushButton("☆")
        self.star_button.setObjectName("starButton")
        self.star_button.setFixedSize(28, 26)
        self.star_button.setCursor(Qt.PointingHandCursor)
        self.star_button.clicked.connect(self._favorite_clicked)
        self.detail_button = QtWidgets.QPushButton("详情")
        self.detail_button.setObjectName("ghostButton")
        self.detail_button.setCursor(Qt.PointingHandCursor)
        self.detail_button.clicked.connect(lambda: self._on_detail(self.entry))
        self.folder_button = QtWidgets.QPushButton("文件夹")
        self.folder_button.setObjectName("ghostButton")
        self.folder_button.setCursor(Qt.PointingHandCursor)
        self.folder_button.clicked.connect(lambda: node_market.open_in_explorer(self.entry.path))
        self.primary_button = QtWidgets.QPushButton("安装")
        self.primary_button.setObjectName("primaryButton")
        self.primary_button.setCursor(Qt.PointingHandCursor)
        self.primary_button.clicked.connect(lambda: self._on_install(self.entry))
        footer.addWidget(self.star_button)
        footer.addWidget(self.detail_button)
        footer.addWidget(self.folder_button)
        footer.addStretch(1)
        footer.addWidget(self.primary_button)
        layout.addLayout(footer)

        tip = tooltip_html(entry)
        self.setToolTip(tip)
        for child in self.findChildren(QtWidgets.QWidget):
            if not isinstance(child, QtWidgets.QPushButton):
                child.setToolTip(tip)
                child.installEventFilter(self)
        self.installEventFilter(self)

        self.set_favorite(self._favorite)
        self.set_installed(installed)

    @property
    def node_id_text(self):
        return self.entry.node_id_text

    def mouseDoubleClickEvent(self, event):
        self._on_detail(self.entry)
        super().mouseDoubleClickEvent(event)

    def _favorite_clicked(self):
        if self._on_favorite is not None:
            self._on_favorite(self.entry)

    def set_favorite(self, favorite):
        self._favorite = bool(favorite)
        self.star_button.setText("★" if self._favorite else "☆")
        self.star_button.setToolTip("取消收藏" if self._favorite else "收藏插件")
        self.star_button.setProperty("active", "true" if self._favorite else "false")
        self.star_button.style().unpolish(self.star_button)
        self.star_button.style().polish(self.star_button)

    def set_installed(self, plugin):
        self._installed = plugin
        self.entry.path = plugin.path if plugin else ""
        self.folder_button.setToolTip(
            "打开已安装目录：\n%s" % plugin.path if plugin and plugin.path
            else "安装后可以打开本地目录")
        self.folder_button.setVisible(bool(plugin and plugin.path))
        if plugin is None:
            self.state_label.setText("未安装")
            self.state_label.setObjectName("unloadedText")
            self.state_label.setToolTip("")
            self.primary_button.setText("安装")
            self.primary_button.setEnabled(True)
            self.primary_button.setToolTip("")
        elif online_market.is_newer(self.entry.version, plugin.version):
            self.state_label.setText("可更新 → v%s" % self.entry.version)
            self.state_label.setObjectName("updateText")
            self.state_label.setToolTip("")
            self.primary_button.setText("更新")
            self.primary_button.setEnabled(True)
            self.primary_button.setToolTip("")
        else:
            self.state_label.setText("已安装 v%s" % (plugin.version or ""))
            self.state_label.setObjectName("loadedText")
            self.state_label.setToolTip("")
            self.primary_button.setText("已安装")
            self.primary_button.setEnabled(False)
            self.primary_button.setToolTip("")
        self.state_label.style().unpolish(self.state_label)
        self.state_label.style().polish(self.state_label)

    def refresh_state(self):
        self.set_installed(self._installed)

    def set_stars(self, count):
        """count < 0 表示还没查到，保持原样。"""
        if count is None or count < 0:
            self.date_label.setText(self._date_text)
            self.date_label.setVisible(bool(self._date_text))
            return
        suffix = "★ %d" % count
        text = ("%s  ·  %s" % (self._date_text, suffix)) if self._date_text else suffix
        self.date_label.setText(text)
        self.date_label.setToolTip("GitHub 仓库 star 数")
        self.date_label.setVisible(True)

    def _show_menu(self, position):
        menu = QtWidgets.QMenu(self)
        menu.addAction("复制节点序号", lambda: QtWidgets.QApplication.clipboard().setText(
            self.entry.node_id_text))
        if self.entry.repo:
            menu.addAction("复制仓库地址", lambda: QtWidgets.QApplication.clipboard().setText(
                "https://github.com/%s" % self.entry.repo))
        menu.addAction("取消收藏" if self._favorite else "收藏插件",
                       lambda: self._favorite_clicked())
        if self.entry.github:
            menu.addAction("打开 GitHub", lambda: open_url(self.entry.github))
        if self.entry.path:
            menu.addAction("打开本地文件夹", lambda: node_market.open_in_explorer(self.entry.path))
        else:
            menu.addAction("安装到本地", lambda: self._on_install(self.entry))
        exec_menu(menu, QtGui.QCursor.pos())

    def eventFilter(self, obj, event):
        if event.type() in (QtCore.QEvent.Enter, QtCore.QEvent.Leave):
            QtCore.QTimer.singleShot(0, self._sync_hover)
        return False

    def _sync_hover(self):
        try:
            inside = self.rect().contains(self.mapFromGlobal(QtGui.QCursor.pos()))
        except Exception:
            return
        if inside != self._hovered:
            self._hovered = inside
            self.setProperty("hovered", "true" if inside else "false")
            self.style().unpolish(self)
            self.style().polish(self)
            self.update()


# ---------------------------------------------------------------------------
# 详情弹窗
# ---------------------------------------------------------------------------
class DetailDialog(QtWidgets.QDialog):
    def __init__(self, plugin, parent, on_primary):
        super().__init__(parent)
        self.plugin = plugin
        self.setObjectName("detailDialog")
        self.setWindowTitle(plugin.title)
        self.setMinimumWidth(560)
        self.setWindowFlags(self.windowFlags() | Qt.WindowTitleHint | Qt.WindowCloseButtonHint)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 16)
        layout.setSpacing(12)

        head = QtWidgets.QHBoxLayout()
        head.setSpacing(12)
        icon = QtWidgets.QLabel()
        apply_icon(icon, plugin, 54)
        head.addWidget(icon, 0, Qt.AlignTop)
        title_box = QtWidgets.QVBoxLayout()
        title_box.setSpacing(3)
        title = QtWidgets.QLabel(plugin.title)
        title.setObjectName("dialogTitle")
        meta = "  ·  ".join([x for x in [
            ("作者 " + plugin.author) if plugin.author else "",
            ("v" + plugin.version) if plugin.version else "",
            plugin.node_id_text,
        ] if x])
        meta_label = QtWidgets.QLabel(meta)
        meta_label.setObjectName("hint")
        title_box.addWidget(title)
        title_box.addWidget(meta_label)
        head.addLayout(title_box, 1)
        layout.addLayout(head)

        desc = QtWidgets.QLabel(plugin.description or "作者没有填写详情。")
        desc.setObjectName("dialogDesc")
        desc.setWordWrap(True)
        desc.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        desc.setMinimumHeight(96)
        layout.addWidget(desc)

        fields = [
            ("节点类型", plugin.node_name or "—"),
            ("注册序号", plugin.node_id_text),
            ("插件文件", plugin.path),
            ("注册命令", ", ".join(plugin.commands) if plugin.commands else "—"),
            ("标签", " / ".join(plugin.tags) if plugin.tags else "—"),
        ]
        grid = QtWidgets.QGridLayout()
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(7)
        for row, (key, value) in enumerate(fields):
            key_label = QtWidgets.QLabel(key)
            key_label.setObjectName("fieldLabel")
            value_label = QtWidgets.QLabel(node_market.shorten(value, 74))
            value_label.setObjectName("fieldValue")
            value_label.setToolTip(value)
            value_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
            grid.addWidget(key_label, row, 0, Qt.AlignTop)
            grid.addWidget(value_label, row, 1)
        grid.setColumnStretch(1, 1)
        layout.addLayout(grid)

        layout.addStretch(1)
        buttons = QtWidgets.QHBoxLayout()
        folder_button = QtWidgets.QPushButton("打开文件夹")
        folder_button.setObjectName("ghostButton")
        folder_button.clicked.connect(lambda: node_market.open_in_explorer(plugin.path))
        copy_button = QtWidgets.QPushButton("复制序号")
        copy_button.setObjectName("ghostButton")
        copy_button.clicked.connect(lambda: QtWidgets.QApplication.clipboard().setText(plugin.node_id_text))
        buttons.addWidget(folder_button)
        buttons.addWidget(copy_button)
        if plugin.github:
            github_button = QtWidgets.QPushButton("GitHub")
            github_button.setObjectName("ghostButton")
            github_button.clicked.connect(lambda: open_url(plugin.github))
            buttons.addWidget(github_button)
        buttons.addStretch(1)
        run_button = QtWidgets.QPushButton("运行" if node_market.plugin_loaded(plugin.path) else "加载")
        run_button.setObjectName("primaryButton")
        run_button.clicked.connect(lambda: (self.accept(), on_primary(plugin)))
        buttons.addWidget(run_button)
        layout.addLayout(buttons)

        self.setStyleSheet(QSS)


class OnlineDetailDialog(QtWidgets.QDialog):
    def __init__(self, entry, installed, parent, on_primary):
        super().__init__(parent)
        self.entry = entry
        self.setObjectName("detailDialog")
        self.setWindowTitle(entry.title)
        self.setMinimumWidth(560)
        self.setWindowFlags(self.windowFlags() | Qt.WindowTitleHint | Qt.WindowCloseButtonHint)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 16)
        layout.setSpacing(12)

        head = QtWidgets.QHBoxLayout()
        head.setSpacing(12)
        icon = QtWidgets.QLabel()
        apply_icon(icon, entry, 54)
        head.addWidget(icon, 0, Qt.AlignTop)
        title_box = QtWidgets.QVBoxLayout()
        title_box.setSpacing(3)
        title = QtWidgets.QLabel(entry.title)
        title.setObjectName("dialogTitle")
        meta = "  ·  ".join([item for item in [
            ("作者 " + entry.author) if entry.author else "",
            entry.category_label,
            ("v" + entry.version) if entry.version else "",
            entry.node_id_text,
        ] if item])
        meta_label = QtWidgets.QLabel(meta)
        meta_label.setObjectName("hint")
        title_box.addWidget(title)
        title_box.addWidget(meta_label)
        head.addLayout(title_box, 1)
        layout.addLayout(head)

        desc = QtWidgets.QLabel(entry.description or "作者没有填写详情。")
        desc.setObjectName("dialogDesc")
        desc.setWordWrap(True)
        desc.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        desc.setMinimumHeight(96)
        layout.addWidget(desc)

        if installed is None:
            state_text = "未安装"
        elif online_market.is_newer(entry.version, installed.version):
            state_text = "已安装 v%s，可更新到 v%s" % (installed.version, entry.version)
        else:
            state_text = "已安装 v%s" % (installed.version or "")
        fields = [
            ("节点类型", entry.node_name or "—"),
            ("注册序号", entry.node_id_text),
            ("分类", entry.category_label or "—"),
            ("仓库", entry.repo or "—"),
            ("子目录", entry.subpath or "—"),
            ("Maya 版本", ", ".join(entry.maya_versions) if entry.maya_versions else "—"),
            ("更新时间", entry.updated or "—"),
            ("本地状态", state_text),
        ]
        grid = QtWidgets.QGridLayout()
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(7)
        for row, (key, value) in enumerate(fields):
            key_label = QtWidgets.QLabel(key)
            key_label.setObjectName("fieldLabel")
            value_label = QtWidgets.QLabel(node_market.shorten(value, 74))
            value_label.setObjectName("fieldValue")
            value_label.setToolTip(value)
            value_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
            grid.addWidget(key_label, row, 0, Qt.AlignTop)
            grid.addWidget(value_label, row, 1)
        grid.setColumnStretch(1, 1)
        layout.addLayout(grid)

        layout.addStretch(1)
        buttons = QtWidgets.QHBoxLayout()
        if entry.github:
            github_button = QtWidgets.QPushButton("GitHub")
            github_button.setObjectName("ghostButton")
            github_button.clicked.connect(lambda: open_url(entry.github))
            buttons.addWidget(github_button)
        if installed is not None:
            folder_button = QtWidgets.QPushButton("打开文件夹")
            folder_button.setObjectName("ghostButton")
            folder_button.clicked.connect(lambda: node_market.open_in_explorer(installed.path))
            buttons.addWidget(folder_button)
        copy_button = QtWidgets.QPushButton("复制序号")
        copy_button.setObjectName("ghostButton")
        copy_button.clicked.connect(lambda: QtWidgets.QApplication.clipboard().setText(entry.node_id_text))
        buttons.addWidget(copy_button)
        buttons.addStretch(1)
        if installed is not None and not online_market.is_newer(entry.version, installed.version):
            action_text = "已安装"
            enabled = False
        elif installed is not None:
            action_text = "更新"
            enabled = True
        else:
            action_text = "安装"
            enabled = True
        action = QtWidgets.QPushButton(action_text)
        action.setObjectName("primaryButton")
        action.setEnabled(enabled)
        action.clicked.connect(lambda: (self.accept(), on_primary(entry)))
        buttons.addWidget(action)
        layout.addLayout(buttons)

        self.setStyleSheet(QSS)


class TaskProgressDialog(QtWidgets.QDialog):
    """安装 / 更新的二级进度页：阶段说明 + 进度条 + 详情 + 取消。"""

    def __init__(self, title, task, parent=None):
        super().__init__(parent)
        self.setObjectName("taskDialog")
        self.setWindowTitle(title)
        self.setWindowModality(Qt.WindowModal)
        self.setWindowFlags(self.windowFlags() | Qt.WindowTitleHint | Qt.WindowCloseButtonHint)
        self.setMinimumWidth(540)
        self.resize(580, 220)
        self._running = True
        self._cancelled = False

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(22, 18, 22, 16)
        layout.setSpacing(9)

        self.title_label = QtWidgets.QLabel(title)
        self.title_label.setObjectName("taskTitle")
        self.task_label = QtWidgets.QLabel(task)
        self.task_label.setObjectName("taskName")
        self.step_label = QtWidgets.QLabel("准备中...")
        self.step_label.setObjectName("taskStep")
        self.step_label.setWordWrap(True)
        self.bar = QtWidgets.QProgressBar()
        self.bar.setRange(0, 0)
        self.bar.setFormat("")
        self.detail_label = QtWidgets.QLabel("")
        self.detail_label.setObjectName("taskDetail")
        self.detail_label.setWordWrap(True)
        self.detail_label.setMinimumHeight(34)
        self.detail_label.setTextInteractionFlags(Qt.TextSelectableByMouse)

        layout.addWidget(self.title_label)
        layout.addWidget(self.task_label)
        layout.addSpacing(4)
        layout.addWidget(self.step_label)
        layout.addWidget(self.bar)
        layout.addWidget(self.detail_label)
        layout.addStretch(1)

        footer = QtWidgets.QHBoxLayout()
        footer.addStretch(1)
        self.cancel_button = QtWidgets.QPushButton("取消")
        self.cancel_button.setObjectName("ghostButton")
        self.cancel_button.setCursor(Qt.PointingHandCursor)
        self.cancel_button.clicked.connect(self.request_cancel)
        footer.addWidget(self.cancel_button)
        layout.addLayout(footer)

        self.setStyleSheet(QSS)

    def set_stage(self, message, percent=None, detail=""):
        self.step_label.setText(message)
        if percent is None:
            if self.bar.maximum() != 0:
                self.bar.setRange(0, 0)
                self.bar.setFormat("")
        else:
            if self.bar.maximum() == 0:
                self.bar.setRange(0, 100)
                self.bar.setFormat("%p%")
            self.bar.setValue(max(0, min(100, int(percent))))
        if detail:
            self.detail_label.setText(detail)

    def set_detail(self, detail):
        self.detail_label.setText(detail)

    def was_cancelled(self):
        return self._cancelled

    def request_cancel(self):
        if not self._running:
            return
        self._cancelled = True
        self.cancel_button.setEnabled(False)
        self.step_label.setText("正在取消，请稍候...")

    def reject(self):
        self.request_cancel()

    def closeEvent(self, event):
        if self._running:
            self.request_cancel()
            event.ignore()
            return
        event.accept()

    def finish(self):
        self._running = False
        self.close()


class SceneRequirementsDialog(QtWidgets.QDialog):
    """打开文件后提示：这个场景缺少哪些节点插件，可以一键安装。"""

    def __init__(self, scene_path, entries, local_plugins, unmatched, parent=None):
        super().__init__(parent)
        self.setObjectName("detailDialog")
        self.setWindowTitle("当前文件缺少节点插件")
        self.setMinimumWidth(560)
        self.setWindowFlags(self.windowFlags() | Qt.WindowTitleHint | Qt.WindowCloseButtonHint)
        self._local_plugins = list(local_plugins or [])
        self.wants_load_local = False
        self.checkboxes = []

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 16)
        layout.setSpacing(9)

        title = QtWidgets.QLabel("当前文件缺少节点插件")
        title.setObjectName("dialogTitle")
        layout.addWidget(title)

        scene_name = os.path.basename(scene_path) if scene_path else "未保存的场景"
        hint = QtWidgets.QLabel(
            "「%s」用到了本机没有安装的节点。继续保存可能丢失这些节点的数据。" % scene_name)
        hint.setObjectName("dialogDesc")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        # 1) 优先：本地已下载、只差加载 —— 最快路径，提示一键开启
        if self._local_plugins:
            sec = QtWidgets.QLabel("本地已下载，勾选后一键加载（不用重新安装）：")
            sec.setObjectName("fieldLabel")
            layout.addWidget(sec)
            names = "、".join(plugin.title for plugin in self._local_plugins)
            self.local_box = QtWidgets.QCheckBox(node_market.shorten(names, 40))
            self.local_box.setObjectName("filterCheck")
            self.local_box.setChecked(True)
            self.local_box.setToolTip(
                "这些插件已经下载到本地，只是没有加载。\n勾选后点下面按钮即可一键加载。")
            self.local_box.toggled.connect(self._refresh_action)
            layout.addWidget(self.local_box)
        else:
            self.local_box = None

        # 2) 其次：需要在线安装的
        if entries:
            label = QtWidgets.QLabel("在线目录里可以安装：")
            label.setObjectName("fieldLabel")
            layout.addWidget(label)
            for entry in entries:
                text = "%s   v%s   %s" % (
                    entry.title, entry.version or "—", entry.author or "未署名")
                box = QtWidgets.QCheckBox(node_market.shorten(text, 54))
                box.setObjectName("filterCheck")
                box.setChecked(True)
                box.setToolTip("%s\n节点：%s · %s" % (
                    entry.description or "", entry.node_name, entry.node_id_text))
                box.toggled.connect(self._refresh_action)
                layout.addWidget(box)
                self.checkboxes.append((box, entry))

        if unmatched:
            warn = QtWidgets.QLabel(
                "以下插件本地和在线目录都没找到：%s\n请联系文件作者获取插件后再打开。" % (
                    "、".join(unmatched[:8])))
            warn.setObjectName("hint")
            warn.setWordWrap(True)
            layout.addWidget(warn)

        layout.addStretch(1)
        buttons = QtWidgets.QHBoxLayout()
        later = QtWidgets.QPushButton("稍后")
        later.setObjectName("ghostButton")
        later.clicked.connect(self.reject)
        buttons.addWidget(later)
        buttons.addStretch(1)
        self.action_button = QtWidgets.QPushButton("")
        self.action_button.setObjectName("primaryButton")
        self.action_button.clicked.connect(self.accept)
        buttons.addWidget(self.action_button)
        layout.addLayout(buttons)

        self.setStyleSheet(QSS)
        self._refresh_action()

    def _refresh_action(self):
        """根据勾选情况动态决定主按钮文案和可用状态。"""
        if not hasattr(self, "action_button"):
            return
        to_install = bool(self.selected_entries())
        to_load = bool(self.local_box and self.local_box.isChecked())
        if to_install and to_load:
            text = "安装并加载，重开文件"
        elif to_install:
            text = "安装并重开文件"
        elif to_load:
            text = "一键加载并重开文件"
        else:
            text = "重开文件"
        self.action_button.setText(text)
        self.action_button.setEnabled(to_install or to_load)

    def selected_entries(self):
        return [entry for box, entry in self.checkboxes if box.isChecked()]

    def accept(self):
        self.wants_load_local = bool(self.local_box and self.local_box.isChecked())
        super().accept()


# ---------------------------------------------------------------------------
# 投稿到在线目录（无需 Token）
# ---------------------------------------------------------------------------
def _valid_repo(text):
    """校验 owner/repo 格式，和服务端 validate_pr.py 的规则保持一致。"""
    parts = (text or "").strip().split("/")
    if len(parts) != 2:
        return False
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
    for part in parts:
        if not part or part in (".", ".."):
            return False
        if any(ch not in allowed for ch in part):
            return False
    return True


class SubmissionDialog(QtWidgets.QDialog):
    """把本地节点投稿到在线目录。

    不碰 git、不需要 Token：生成好 plugins/<node_id>.json，打开 GitHub 网页的
    「新建文件」地址并把内容预填进去，登录状态下点两次就自动开 PR，Actions
    校验通过后自动合并。
    """

    def __init__(self, plugin, parent=None):
        super().__init__(parent)
        self.plugin = plugin
        self.entry = online_market.build_submission_entry(plugin)
        self.setObjectName("envDialog")
        self.setWindowTitle(u"投稿到在线目录")
        self.setWindowFlags(
            self.windowFlags() | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setMinimumWidth(600)
        self.setMouseTracking(True)
        self._dragging = False
        self._drag_pos = QtCore.QPoint()
        self._build_ui()
        self.setStyleSheet(QSS)
        self._refresh()

    # ---------------- 无边框拖动 ----------------
    def _in_header(self, pos):
        return getattr(self, "_header_geom", QtCore.QRect()).contains(pos)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton and self._in_header(event.pos()):
            self._dragging = True
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()
        else:
            super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._dragging and event.buttons() & Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()
        else:
            super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._dragging = False
        super().mouseReleaseEvent(event)

    # ---------------- 界面 ----------------
    def _build_ui(self):
        outer = QtWidgets.QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        header = QtWidgets.QFrame()
        header.setObjectName("envHeader")
        header.setFixedHeight(44)
        header_layout = QtWidgets.QHBoxLayout(header)
        header_layout.setContentsMargins(18, 0, 12, 0)
        header_layout.setSpacing(10)

        icon = QtWidgets.QLabel()
        icon.setFixedSize(18, 18)
        icon.setStyleSheet(
            "background:#4a86e8;border-radius:4px;color:white;"
            "font-weight:bold;font-size:10px;padding-left:4px;")
        icon.setText(u"↑")
        header_layout.addWidget(icon, 0, Qt.AlignVCenter)

        title = QtWidgets.QLabel(u"投稿到在线目录")
        title.setObjectName("envTitle")
        header_layout.addWidget(title, 0, Qt.AlignVCenter)
        header_layout.addStretch(1)

        close_btn = QtWidgets.QPushButton(u"×")
        close_btn.setObjectName("winClose")
        close_btn.setFixedSize(30, 24)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setToolTip(u"关闭")
        close_btn.clicked.connect(self.reject)
        header_layout.addWidget(close_btn, 0, Qt.AlignVCenter)

        outer.addWidget(header)
        self._header_geom = QtCore.QRect(0, 0, self.width(), header.height())

        body = QtWidgets.QWidget()
        body_layout = QtWidgets.QVBoxLayout(body)
        body_layout.setContentsMargins(18, 14, 18, 14)
        body_layout.setSpacing(10)

        tip = QtWidgets.QLabel(
            u"无需 Token：点「打开 GitHub 提交页」会把条目内容预填进网页，"
            u"登录状态下点两次即可自动提 PR。")
        tip.setObjectName("envTip")
        tip.setWordWrap(True)
        body_layout.addWidget(tip)

        self.repo_edit = self._add_field(body_layout, u"你的 GitHub 仓库（owner/repo）",
                                        self.entry.get("repo", ""))
        self.subpath_edit = self._add_field(body_layout, u"插件所在目录（可留空）",
                                           self.entry.get("subpath", ""))
        self.entry_edit = self._add_field(body_layout, u"入口文件（注册节点的 .py）",
                                         self.entry.get("entry", ""))

        self.preview = QtWidgets.QPlainTextEdit()
        self.preview.setObjectName("submitPreview")
        self.preview.setReadOnly(True)
        self.preview.setFixedHeight(150)
        body_layout.addWidget(self.preview)

        self.status_label = QtWidgets.QLabel("")
        self.status_label.setObjectName("envTip")
        self.status_label.setWordWrap(True)
        body_layout.addWidget(self.status_label)

        buttons = QtWidgets.QHBoxLayout()
        copy_btn = QtWidgets.QPushButton(u"复制 JSON")
        copy_btn.setObjectName("ghostButton")
        copy_btn.clicked.connect(self._copy_json)
        buttons.addWidget(copy_btn)
        buttons.addStretch(1)
        self.open_btn = QtWidgets.QPushButton(u"打开 GitHub 提交页")
        self.open_btn.setObjectName("primaryButton")
        self.open_btn.clicked.connect(self._open_page)
        buttons.addWidget(self.open_btn)
        body_layout.addLayout(buttons)

        outer.addWidget(body, 1)

    def _add_field(self, layout, label_text, value):
        label = QtWidgets.QLabel(label_text)
        label.setObjectName("fieldLabel")
        layout.addWidget(label)
        edit = QtWidgets.QLineEdit(value or "")
        edit.setObjectName("submitEdit")
        edit.textChanged.connect(self._refresh)
        layout.addWidget(edit)
        return edit

    # ---------------- 逻辑 ----------------
    def current_entry(self):
        entry = dict(self.entry)
        entry["repo"] = self.repo_edit.text().strip()
        entry["subpath"] = self.subpath_edit.text().strip()
        entry["entry"] = self.entry_edit.text().strip()
        return entry

    def _refresh(self):
        if not hasattr(self, "preview"):
            return
        entry = self.current_entry()
        self.preview.setPlainText(json.dumps(entry, ensure_ascii=False, indent=2))
        if not _valid_repo(entry["repo"]):
            self.status_label.setText(
                u"仓库必须填你自己的公开仓库，格式 owner/repo"
                u"（owner 要和你的 GitHub 账号一致，否则自动合并会驳回）。")
            self.open_btn.setEnabled(False)
        elif not entry["entry"]:
            self.status_label.setText(u"请填写入口文件（注册节点的 .py 文件名）。")
            self.open_btn.setEnabled(False)
        else:
            self.status_label.setText(
                u"提交前请确认插件代码已经上传到该仓库，否则校验会失败。")
            self.open_btn.setEnabled(True)

    def _copy_json(self):
        QtWidgets.QApplication.clipboard().setText(self.preview.toPlainText())
        self.status_label.setText(u"已复制到剪贴板。")

    def _open_page(self):
        entry = self.current_entry()
        if not _valid_repo(entry["repo"]):
            return
        open_url(online_market.submission_url(entry))
        self.status_label.setText(u"已在浏览器打开 GitHub 提交页，登录后确认即可。")


# ---------------------------------------------------------------------------
# 主窗口
# ---------------------------------------------------------------------------
class MarketWindow(MayaQWidgetDockableMixin, QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setObjectName("zkmNodeMarketWindow")
        self.setWindowTitle("节点插件市场")
        if os.path.isfile(ICON_PATH):
            self.setWindowIcon(QtGui.QIcon(ICON_PATH))
        self.resize(1080, 700)
        self.setMinimumSize(720, 520)

        # 无边框：用自定义标题栏统一深色风格，避免原生浅色标题栏与暗色 UI 割裂
        self.setWindowFlags(self.windowFlags() | Qt.FramelessWindowHint)
        self.setMouseTracking(True)
        self._dragging = False
        self._drag_pos = QtCore.QPoint()
        self._resize_mode = None
        self._resize_start_geom = None
        self._resize_start_pos = None
        self._resize_margin = 8

        # 登录：有自动登录记录则直接使用，否则弹窗让用户填写个人名称
        user = get_current_user()
        if not user:
            name, auto_login = self._prompt_login()
            user = set_current_user(name, auto_login)
            _migrate_shared_to_user(user)
        else:
            _migrate_shared_to_user(user)
        self.user_name = user

        settings = load_settings()
        self.nodes_dir = settings.get("nodes_dir") or DEFAULT_NODES_DIR
        self.github_url = settings.get("github_url") or MARKET_GITHUB_URL
        self.scene_check = bool(settings.get("scene_check", True))
        if not os.path.isdir(self.nodes_dir):
            try:
                os.makedirs(self.nodes_dir)
            except Exception:
                pass

        self.plugins = []
        self.cards = []
        self.favorite_cards = []
        self.favorites = set(load_state().get("favorites") or [])
        self.warnings = []
        self.active_tags = set()
        self.tag_query = ""
        self.tag_source = "local"
        self.scan_folders = 0
        self.scan_files = 0
        self.scan_cache_hits = 0
        self.scan_parsed_files = 0
        self._columns = 3

        self.online_catalog = None
        self.online_entries = []
        self.online_cards = []
        self.online_fetched_at = 0
        self.online_error = ""
        self.online_loading = False
        self._catalog_worker = None
        self.online_page_index = 0
        self.online_page_size = 24
        self.online_sort_key = "updated"
        self.online_stars = {}
        self._stars_worker = None
        self._update_worker = None
        self._update_cancel = None
        self.market_update_available = ""
        self._version_checked_at = 0.0
        # 后台线程登记表：关闭窗口前统一 quit + wait，
        # 避免 QThread 还在运行时被销毁（Qt 会直接中止进程）。
        self._bg_threads = []
        self.scene_hook_ids = []
        self.scene_save_id = None
        self._scene_prompted = set()
        self._scene_reopen_guard = False
        cached, cached_at = online_market.load_catalog_cache(CATALOG_CACHE_PATH)
        if cached:
            self.online_catalog = cached
            self.online_entries = online_market.entries_from_catalog(cached)
            self.online_fetched_at = cached_at

        self._build_ui()
        self.refresh()
        self.switch_tab(0)
        QtCore.QTimer.singleShot(0, self.fetch_online_catalog)
        QtCore.QTimer.singleShot(400, self.check_market_version)
        self._initial_scene_checked = False
        self.register_scene_hook()

    # ------------------------------------------------------------------
    # 建界面
    # ------------------------------------------------------------------
    def _build_ui(self):
        central = QtWidgets.QWidget()
        central.setObjectName("marketRoot")
        self.setCentralWidget(central)
        outer = QtWidgets.QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # 顶部
        header = QtWidgets.QFrame()
        header.setObjectName("header")
        header_layout = QtWidgets.QVBoxLayout(header)
        header_layout.setContentsMargins(22, 16, 22, 13)
        header_layout.setSpacing(10)

        title_row = QtWidgets.QHBoxLayout()
        title_row.setSpacing(10)
        title = QtWidgets.QLabel("节点插件市场")
        title.setObjectName("appTitle")
        badge = QtWidgets.QLabel("v%s · 节点驱动" % TOOL_VERSION)
        badge.setObjectName("badge")
        title_row.addWidget(title)
        title_row.addWidget(badge, 0, Qt.AlignVCenter)
        author = QtWidgets.QLabel("作者 %s" % AUTHOR_NAME)
        author.setObjectName("appAuthor")
        author.setToolTip("%s (%s)" % (AUTHOR_NAME, AUTHOR_NAME_EN))
        title_row.addWidget(author, 0, Qt.AlignVCenter)
        title_row.addStretch(1)
        self.import_button = QtWidgets.QPushButton("导入插件")
        self.import_button.setObjectName("ghostButton")
        self.import_button.setCursor(Qt.PointingHandCursor)
        import_menu = QtWidgets.QMenu(self.import_button)
        import_menu.addAction("导入节点文件 (.py)", self.import_plugin_file)
        import_menu.addAction("导入插件文件夹", self.import_plugin_folder)
        self.import_button.setMenu(import_menu)
        self.update_button = QtWidgets.QPushButton("更新")
        self.update_button.setObjectName("ghostButton")
        self.update_button.setCursor(Qt.PointingHandCursor)
        self.update_button.setToolTip("从 GitHub 下载最新版市场代码并覆盖安装")
        self.update_button.clicked.connect(self.update_market)
        self.refresh_button = QtWidgets.QPushButton("刷新")
        self.refresh_button.setObjectName("ghostButton")
        self.refresh_button.setCursor(Qt.PointingHandCursor)
        self.refresh_button.setToolTip("使用解析缓存刷新")
        self.refresh_button.clicked.connect(lambda: self.refresh())
        self.clear_cache_button = QtWidgets.QPushButton("清缓存")
        self.clear_cache_button.setObjectName("ghostButton")
        self.clear_cache_button.setCursor(Qt.PointingHandCursor)
        self.clear_cache_button.setToolTip("清除 JSON 缓存，重新识别节点和标签")
        self.clear_cache_button.clicked.connect(self.hard_refresh)
        title_row.addWidget(self.import_button)
        title_row.addWidget(self.update_button)
        title_row.addWidget(self.refresh_button)
        title_row.addWidget(self.clear_cache_button)

        # 窗口控制按钮（自定义标题栏）
        sep = QtWidgets.QFrame()
        sep.setFixedSize(1, 18)
        sep.setStyleSheet("background: #3a3e48;")
        title_row.addWidget(sep, 0, Qt.AlignVCenter)
        self.min_button = QtWidgets.QPushButton("\u2013")
        self.min_button.setObjectName("winCtrl")
        self.min_button.setCursor(Qt.PointingHandCursor)
        self.min_button.setToolTip("最小化")
        self.min_button.clicked.connect(self.showMinimized)
        self.max_button = QtWidgets.QPushButton("\u25a1")
        self.max_button.setObjectName("winCtrl")
        self.max_button.setCursor(Qt.PointingHandCursor)
        self.max_button.setToolTip("最大化")
        self.max_button.clicked.connect(self._toggle_maximize)
        self.close_button = QtWidgets.QPushButton("\u2715")
        self.close_button.setObjectName("winClose")
        self.close_button.setCursor(Qt.PointingHandCursor)
        self.close_button.setToolTip("关闭")
        self.close_button.clicked.connect(self.close)
        title_row.addWidget(self.min_button)
        title_row.addWidget(self.max_button)
        title_row.addWidget(self.close_button)
        header_layout.addLayout(title_row)

        subtitle = QtWidgets.QLabel(
            "以 Maya 节点为单位的插件市集  ·  识别插件目录里的节点，自动生成启动按钮")
        subtitle.setObjectName("appSubtitle")
        header_layout.addWidget(subtitle)

        tools_row = QtWidgets.QHBoxLayout()
        tools_row.setSpacing(12)
        self.search_box = QtWidgets.QLineEdit()
        self.search_box.setObjectName("searchBox")
        self.search_box.setPlaceholderText("搜索插件 / 节点 / 作者 / 序号")
        self.search_box.setClearButtonEnabled(True)
        self.search_box.setFixedHeight(36)
        self.search_box.textChanged.connect(self.apply_filter)
        tools_row.addWidget(self.search_box, 1)

        tabs = QtWidgets.QFrame()
        tabs.setObjectName("tabs")
        tabs_layout = QtWidgets.QHBoxLayout(tabs)
        tabs_layout.setContentsMargins(3, 3, 3, 3)
        tabs_layout.setSpacing(2)
        self.tab_buttons = []
        self.tab_group = QtWidgets.QButtonGroup(self)
        self.tab_group.setExclusive(True)
        for index, label in enumerate(("发现", "在线", "收藏", "已加载", "设置")):
            button = QtWidgets.QPushButton(label)
            button.setObjectName("tabButton")
            button.setCheckable(True)
            button.setCursor(Qt.PointingHandCursor)
            button.clicked.connect(lambda checked=False, i=index: self.switch_tab(i))
            tabs_layout.addWidget(button)
            self.tab_buttons.append(button)
            self.tab_group.addButton(button)
        self.tab_buttons[0].setChecked(True)
        tools_row.addWidget(tabs)
        header_layout.addLayout(tools_row)

        # 标签栏：识别到的 NODE_INFO.tags 自动加入这里，可多选，可搜索
        self.tag_buttons = []
        self.tag_row = QtWidgets.QHBoxLayout()
        self.tag_row.setSpacing(8)
        self.tag_search = QtWidgets.QLineEdit()
        self.tag_search.setObjectName("tagSearch")
        self.tag_search.setPlaceholderText("搜索标签")
        self.tag_search.setClearButtonEnabled(True)
        self.tag_search.setFixedSize(136, 28)
        self.tag_search.textChanged.connect(self.on_tag_query)
        self.tag_row.addWidget(self.tag_search, 0, Qt.AlignVCenter)
        self.tag_bar = QtWidgets.QScrollArea()
        self.tag_bar.setObjectName("tagBar")
        self.tag_bar.setFrameShape(QtWidgets.QFrame.NoFrame)
        self.tag_bar.setWidgetResizable(False)
        self.tag_bar.setFixedHeight(40)
        self.tag_bar.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.tag_bar.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.tag_host = QtWidgets.QWidget()
        self.tag_host.setObjectName("tagHost")
        self.tag_layout = QtWidgets.QHBoxLayout(self.tag_host)
        self.tag_layout.setContentsMargins(0, 0, 0, 0)
        self.tag_layout.setSpacing(6)
        self.tag_bar.setWidget(self.tag_host)
        self.tag_bar.setVisible(False)
        self.tag_row.addWidget(self.tag_bar, 1)
        header_layout.addLayout(self.tag_row)
        outer.addWidget(header)

        # 内容
        self.stack = QtWidgets.QStackedWidget()
        outer.addWidget(self.stack, 1)

        self.discover_page = self._build_discover_page()
        self.online_page = self._build_online_page()
        self.favorites_page = self._build_favorites_page()
        self.loaded_page = self._build_loaded_page()
        self.settings_page = self._build_settings_page()
        self.stack.addWidget(self.discover_page)
        self.stack.addWidget(self.online_page)
        self.stack.addWidget(self.favorites_page)
        self.stack.addWidget(self.loaded_page)
        self.stack.addWidget(self.settings_page)

        # 底部状态条
        status = QtWidgets.QFrame()
        status.setObjectName("statusBar")
        status_layout = QtWidgets.QHBoxLayout(status)
        status_layout.setContentsMargins(18, 6, 18, 6)
        status_layout.setSpacing(10)
        self.status_text = QtWidgets.QLabel()
        self.status_text.setObjectName("statusText")
        self.status_message = QtWidgets.QLabel()
        self.status_message.setObjectName("statusMessage")
        open_dir = QtWidgets.QPushButton("打开插件目录")
        open_dir.setObjectName("ghostButton")
        open_dir.setCursor(Qt.PointingHandCursor)
        open_dir.clicked.connect(lambda: node_market.open_in_explorer(self.nodes_dir))
        status_layout.addWidget(self.status_text, 1)
        status_layout.addWidget(self.status_message)
        status_layout.addWidget(open_dir)
        outer.addWidget(status)

        self.setStyleSheet(QSS)

    # ------------------------------------------------------------------
    # 自定义标题栏：拖动 / 双击最大化 / 状态同步
    # ------------------------------------------------------------------
    def _header_widget(self):
        return self.findChild(QtWidgets.QFrame, "header")

    def _in_header(self, pos):
        header = self._header_widget()
        if header is None:
            return False
        top_left = header.mapTo(self, QtCore.QPoint(0, 0))
        rect = QtCore.QRect(top_left, header.size())
        return rect.contains(pos)

    def _makeMayaStandaloneWindow(self):
        # MayaQWidgetDockableMixin.show() 在窗口首次显示且 parent() 为 None 时，
        # 会调用本方法把窗口 reparent 到 Maya 主窗口，并对非 QDockWidget 的窗口
        # 直接执行 setWindowFlags(Qt.Window)——这会把 __init__ 里设置的
        # FramelessWindowHint 整个清掉，且 setWindowFlags 会顺带隐藏窗口。
        # 这里在调用完父类逻辑后立即把无边框标志加回来，保证第一次 setVisible(True)
        # 时窗口就是无边框的，避免走 showEvent 里改标志→隐藏→再显示的不可靠路径。
        super()._makeMayaStandaloneWindow()
        self.setWindowFlags(self.windowFlags() | Qt.FramelessWindowHint)

    def showEvent(self, event):
        super().showEvent(event)
        # 这里不再改 windowFlags：setWindowFlags 会先隐藏窗口再显示，
        # 表现就是「打开插件时闪一下」。无边框已在 _makeMayaStandaloneWindow
        # 里一次设好，显示过程中不动窗口标志。

    def _edge_at(self, pos):
        # 返回鼠标所在的边缘/角，用于无边框窗口缩放；最大化时禁用缩放
        if self.isMaximized():
            return None
        m = self._resize_margin
        w, h = self.width(), self.height()
        x, y = pos.x(), pos.y()
        top = y <= m
        bottom = y >= h - m
        left = x <= m
        right = x >= w - m
        if top and left:
            return "topleft"
        if top and right:
            return "topright"
        if bottom and left:
            return "bottomleft"
        if bottom and right:
            return "bottomright"
        if top:
            return "top"
        if bottom:
            return "bottom"
        if left:
            return "left"
        if right:
            return "right"
        return None

    _EDGE_CURSORS = {
        "top": Qt.SizeVerCursor,
        "bottom": Qt.SizeVerCursor,
        "left": Qt.SizeHorCursor,
        "right": Qt.SizeHorCursor,
        "topleft": Qt.SizeFDiagCursor,
        "bottomright": Qt.SizeFDiagCursor,
        "topright": Qt.SizeBDiagCursor,
        "bottomleft": Qt.SizeBDiagCursor,
    }

    def _apply_cursor(self, pos):
        edge = self._edge_at(pos)
        if edge:
            self.setCursor(self._EDGE_CURSORS[edge])
        else:
            self.unsetCursor()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            edge = self._edge_at(event.pos())
            if edge:
                self._resize_mode = edge
                self._resize_start_geom = self.geometry()
                self._resize_start_pos = event.globalPos()
                event.accept()
                return
            if self._in_header(event.pos()):
                self._dragging = True
                self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
                event.accept()
                return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._resize_mode and event.buttons() & Qt.LeftButton:
            self._do_resize(event.globalPos())
            event.accept()
            return
        if self._dragging and event.buttons() & Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()
            return
        # 无按钮按下时，根据所在边缘更新光标
        if not (event.buttons() & Qt.LeftButton):
            self._apply_cursor(event.pos())
        super().mouseMoveEvent(event)

    def _do_resize(self, global_pos):
        mode = self._resize_mode
        g = QtCore.QRect(self._resize_start_geom)
        min_w = self.minimumWidth() or 720
        min_h = self.minimumHeight() or 520
        dx = global_pos.x() - self._resize_start_pos.x()
        dy = global_pos.y() - self._resize_start_pos.y()

        if "right" in mode:
            new_w = max(min_w, g.width() + dx)
            g.setWidth(new_w)
        if "left" in mode:
            new_w = max(min_w, g.width() - dx)
            g.setLeft(g.right() - new_w + 1)
            g.setWidth(new_w)
        if "bottom" in mode:
            new_h = max(min_h, g.height() + dy)
            g.setHeight(new_h)
        if "top" in mode:
            new_h = max(min_h, g.height() - dy)
            g.setTop(g.bottom() - new_h + 1)
            g.setHeight(new_h)

        self.setGeometry(g)

    def mouseReleaseEvent(self, event):
        self._dragging = False
        self._resize_mode = None
        self._resize_start_geom = None
        self._resize_start_pos = None
        super().mouseReleaseEvent(event)

    def mouseDoubleClickEvent(self, event):
        if self._in_header(event.pos()):
            self._toggle_maximize()
            return
        super().mouseDoubleClickEvent(event)

    def _toggle_maximize(self):
        if self.isMaximized():
            self.showNormal()
        else:
            self.showMaximized()

    def _update_max_button(self):
        # 最大化时显示还原图标，否则显示最大化图标
        if self.isMaximized():
            self.max_button.setText("\u2750")
            self.max_button.setToolTip("还原")
        else:
            self.max_button.setText("\u25a1")
            self.max_button.setToolTip("最大化")

    def changeEvent(self, event):
        super().changeEvent(event)
        if event.type() == QtCore.QEvent.WindowStateChange:
            self._update_max_button()

    # ------------------------------------------------------------------
    # 用户登录 / 切换
    # ------------------------------------------------------------------
    def _prompt_login(self):
        """首次启动或切换用户时，弹出登录框让用户填写个人名称。返回 (name, auto_login)。"""
        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle("节点插件市场 · 登录")
        dialog.setObjectName("taskDialog")
        dialog.setMinimumWidth(380)
        dialog.setWindowFlags(dialog.windowFlags() | Qt.WindowTitleHint | Qt.WindowCloseButtonHint)
        layout = QtWidgets.QVBoxLayout(dialog)
        layout.setContentsMargins(22, 20, 22, 18)
        layout.setSpacing(12)

        title = QtWidgets.QLabel("请输入你的个人名称")
        title.setObjectName("taskTitle")
        layout.addWidget(title)

        hint = QtWidgets.QLabel(
            "用于在服务器上区分你和其他用户的个人数据（收藏、设置）。\n"
            "节点插件和在线目录是所有用户共享的。")
        hint.setObjectName("taskStep")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        name_edit = QtWidgets.QLineEdit(_default_user_name())
        name_edit.setObjectName("pathEdit")
        name_edit.setPlaceholderText("个人名称")
        name_edit.selectAll()
        layout.addWidget(name_edit)

        auto_check = QtWidgets.QCheckBox("自动登录（下次不再询问）")
        auto_check.setObjectName("filterCheck")
        auto_check.setChecked(True)
        auto_check.setCursor(Qt.PointingHandCursor)
        layout.addWidget(auto_check)

        btns = QtWidgets.QHBoxLayout()
        btns.addStretch(1)
        cancel = QtWidgets.QPushButton("取消")
        cancel.setObjectName("ghostButton")
        cancel.setCursor(Qt.PointingHandCursor)
        ok = QtWidgets.QPushButton("确认")
        ok.setObjectName("primaryButton")
        ok.setCursor(Qt.PointingHandCursor)
        ok.setDefault(True)
        btns.addWidget(cancel)
        btns.addWidget(ok)
        layout.addLayout(btns)

        ok.clicked.connect(dialog.accept)
        cancel.clicked.connect(dialog.reject)

        name = _default_user_name()
        auto = True
        if dialog.exec_() == QtWidgets.QDialog.Accepted:
            text = name_edit.text().strip()
            if text:
                name = text
            auto = auto_check.isChecked()
        return name, auto

    def switch_user(self):
        """切换到另一个用户：重新登录并加载该用户的个人数据。"""
        name, auto_login = self._prompt_login()
        user = set_current_user(name, auto_login)
        _migrate_shared_to_user(user)
        self.user_name = user
        # 重新加载该用户的个人设置与收藏
        settings = load_settings()
        self.nodes_dir = settings.get("nodes_dir") or DEFAULT_NODES_DIR
        self.github_url = settings.get("github_url") or MARKET_GITHUB_URL
        self.scene_check = bool(settings.get("scene_check", True))
        self.favorites = set(load_state().get("favorites") or [])
        self.refresh()
        self.notify("已切换到用户：%s" % user, True)
        self.update_user_info()

    def update_user_info(self):
        """刷新设置页里的当前用户显示。"""
        if hasattr(self, "user_name_label"):
            self.user_name_label.setText("当前用户：%s" % self.user_name)

    def _build_discover_page(self):
        page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        scroll.viewport().setAutoFillBackground(False)
        host = QtWidgets.QWidget()
        host.setObjectName("scrollHost")
        host_layout = QtWidgets.QVBoxLayout(host)
        host_layout.setContentsMargins(22, 18, 22, 20)
        host_layout.setSpacing(14)

        self.empty_card = QtWidgets.QFrame()
        self.empty_card.setObjectName("emptyCard")
        empty_layout = QtWidgets.QVBoxLayout(self.empty_card)
        empty_layout.setContentsMargins(28, 30, 28, 30)
        empty_layout.setSpacing(8)
        empty_title = QtWidgets.QLabel("还没有可用的节点插件")
        empty_title.setObjectName("emptyTitle")
        empty_title.setAlignment(Qt.AlignCenter)
        empty_hint = QtWidgets.QLabel(
            "把插件文件夹放进下方目录，并把文件夹名改成节点的注册序号（例如 0x00141488）。\n"
            "也可以点右上角「导入插件」，自动按节点序号归档。")
        empty_hint.setObjectName("emptyHint")
        empty_hint.setAlignment(Qt.AlignCenter)
        empty_hint.setWordWrap(True)
        self.empty_path = QtWidgets.QLabel()
        self.empty_path.setObjectName("mono")
        self.empty_path.setAlignment(Qt.AlignCenter)
        self.empty_path.setTextInteractionFlags(Qt.TextSelectableByMouse)
        empty_layout.addWidget(empty_title)
        empty_layout.addWidget(empty_hint)
        empty_layout.addWidget(self.empty_path)
        host_layout.addWidget(self.empty_card)

        self.grid_host = QtWidgets.QWidget()
        self.grid = QtWidgets.QGridLayout(self.grid_host)
        self.grid.setContentsMargins(0, 0, 0, 0)
        self.grid.setHorizontalSpacing(14)
        self.grid.setVerticalSpacing(14)
        host_layout.addWidget(self.grid_host)

        self.no_result = QtWidgets.QLabel("没有匹配的插件")
        self.no_result.setObjectName("emptyHint")
        self.no_result.setAlignment(Qt.AlignCenter)
        self.no_result.setVisible(False)
        host_layout.addWidget(self.no_result)
        host_layout.addStretch(1)

        scroll.setWidget(host)
        layout.addWidget(scroll)
        self.discover_scroll = scroll
        return page

    def _build_online_page(self):
        page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        host = QtWidgets.QWidget()
        host_layout = QtWidgets.QVBoxLayout(host)
        host_layout.setContentsMargins(22, 16, 22, 20)
        host_layout.setSpacing(12)

        toolbar = QtWidgets.QHBoxLayout()
        toolbar.setSpacing(8)
        self.online_summary = QtWidgets.QLabel("正在加载在线目录...")
        self.online_summary.setObjectName("hint")
        toolbar.addWidget(self.online_summary, 1)
        self.online_refresh_button = QtWidgets.QPushButton("刷新在线目录")
        self.online_refresh_button.setObjectName("ghostButton")
        self.online_refresh_button.setCursor(Qt.PointingHandCursor)
        self.online_refresh_button.clicked.connect(self.fetch_online_catalog)
        self.online_source_button = QtWidgets.QPushButton("索引仓库")
        self.online_source_button.setObjectName("ghostButton")
        self.online_source_button.setCursor(Qt.PointingHandCursor)
        self.online_source_button.setToolTip(online_market.INDEX_URL)
        self.online_source_button.clicked.connect(lambda: open_url(online_market.INDEX_URL))
        toolbar.addWidget(self.online_refresh_button)
        toolbar.addWidget(self.online_source_button)
        host_layout.addLayout(toolbar)

        # 过滤 / 排序 / 批量更新
        filters = QtWidgets.QHBoxLayout()
        filters.setSpacing(8)
        self.online_hide_installed = QtWidgets.QCheckBox("只看未安装")
        self.online_hide_installed.setObjectName("filterCheck")
        self.online_hide_installed.setCursor(Qt.PointingHandCursor)
        self.online_hide_installed.toggled.connect(self.on_online_filter_changed)
        filters.addWidget(self.online_hide_installed)
        sort_label = QtWidgets.QLabel("排序")
        sort_label.setObjectName("hint")
        filters.addWidget(sort_label)
        self.online_sort = QtWidgets.QComboBox()
        self.online_sort.setObjectName("sortBox")
        self.online_sort.addItem("最近更新", "updated")
        self.online_sort.addItem("名称", "name")
        self.online_sort.addItem("节点序号", "id")
        self.online_sort.currentIndexChanged.connect(self.on_online_filter_changed)
        filters.addWidget(self.online_sort)
        filters.addStretch(1)
        self.online_update_all_button = QtWidgets.QPushButton("更新全部")
        self.online_update_all_button.setObjectName("ghostButton")
        self.online_update_all_button.setCursor(Qt.PointingHandCursor)
        self.online_update_all_button.setToolTip("更新所有已安装且版本较旧的插件")
        self.online_update_all_button.clicked.connect(self.update_all_online)
        filters.addWidget(self.online_update_all_button)
        host_layout.addLayout(filters)

        self.online_empty = QtWidgets.QFrame()
        self.online_empty.setObjectName("emptyCard")
        empty_layout = QtWidgets.QVBoxLayout(self.online_empty)
        empty_layout.setContentsMargins(28, 28, 28, 26)
        empty_layout.setSpacing(8)
        self.online_empty_title = QtWidgets.QLabel("正在加载在线目录")
        self.online_empty_title.setObjectName("emptyTitle")
        self.online_empty_title.setAlignment(Qt.AlignCenter)
        self.online_empty_hint = QtWidgets.QLabel(
            "在线目录来自 GitHub 索引仓库；首次打开需要联网，加载过一次后会缓存到本地。")
        self.online_empty_hint.setObjectName("emptyHint")
        self.online_empty_hint.setAlignment(Qt.AlignCenter)
        self.online_empty_hint.setWordWrap(True)
        self.online_retry_button = QtWidgets.QPushButton("重试")
        self.online_retry_button.setObjectName("primaryButton")
        self.online_retry_button.setCursor(Qt.PointingHandCursor)
        self.online_retry_button.clicked.connect(self.fetch_online_catalog)
        retry_row = QtWidgets.QHBoxLayout()
        retry_row.addStretch(1)
        retry_row.addWidget(self.online_retry_button)
        retry_row.addStretch(1)
        empty_layout.addWidget(self.online_empty_title)
        empty_layout.addWidget(self.online_empty_hint)
        empty_layout.addLayout(retry_row)
        host_layout.addWidget(self.online_empty)

        self.online_grid_host = QtWidgets.QWidget()
        self.online_grid = QtWidgets.QGridLayout(self.online_grid_host)
        self.online_grid.setContentsMargins(0, 0, 0, 0)
        self.online_grid.setHorizontalSpacing(14)
        self.online_grid.setVerticalSpacing(14)
        host_layout.addWidget(self.online_grid_host)

        self.online_pager = QtWidgets.QWidget()
        pager_layout = QtWidgets.QHBoxLayout(self.online_pager)
        pager_layout.setContentsMargins(0, 0, 0, 0)
        pager_layout.setSpacing(8)
        pager_layout.addStretch(1)
        self.online_prev_button = QtWidgets.QPushButton("上一页")
        self.online_prev_button.setObjectName("ghostButton")
        self.online_prev_button.setCursor(Qt.PointingHandCursor)
        self.online_prev_button.clicked.connect(lambda: self.change_online_page(-1))
        self.online_page_label = QtWidgets.QLabel("")
        self.online_page_label.setObjectName("hint")
        self.online_next_button = QtWidgets.QPushButton("下一页")
        self.online_next_button.setObjectName("ghostButton")
        self.online_next_button.setCursor(Qt.PointingHandCursor)
        self.online_next_button.clicked.connect(lambda: self.change_online_page(1))
        pager_layout.addWidget(self.online_prev_button)
        pager_layout.addWidget(self.online_page_label)
        pager_layout.addWidget(self.online_next_button)
        pager_layout.addStretch(1)
        self.online_pager.setVisible(False)
        host_layout.addWidget(self.online_pager)

        self.online_no_result = QtWidgets.QLabel("没有匹配的在线插件")
        self.online_no_result.setObjectName("emptyHint")
        self.online_no_result.setAlignment(Qt.AlignCenter)
        self.online_no_result.setVisible(False)
        host_layout.addWidget(self.online_no_result)
        host_layout.addStretch(1)

        scroll.setWidget(host)
        layout.addWidget(scroll)
        self.online_scroll = scroll
        return page

    def _build_favorites_page(self):
        page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        host = QtWidgets.QWidget()
        host_layout = QtWidgets.QVBoxLayout(host)
        host_layout.setContentsMargins(22, 18, 22, 20)
        host_layout.setSpacing(14)

        self.favorites_empty = QtWidgets.QFrame()
        self.favorites_empty.setObjectName("emptyCard")
        empty_layout = QtWidgets.QVBoxLayout(self.favorites_empty)
        empty_layout.setContentsMargins(28, 30, 28, 30)
        empty_layout.setSpacing(8)
        empty_title = QtWidgets.QLabel("还没有收藏的插件")
        empty_title.setObjectName("emptyTitle")
        empty_title.setAlignment(Qt.AlignCenter)
        empty_hint = QtWidgets.QLabel(
            "点卡片左下角的 ☆ 收藏；收藏会保存在本地，不随版本更新丢失。")
        empty_hint.setObjectName("emptyHint")
        empty_hint.setAlignment(Qt.AlignCenter)
        empty_hint.setWordWrap(True)
        empty_layout.addWidget(empty_title)
        empty_layout.addWidget(empty_hint)
        host_layout.addWidget(self.favorites_empty)

        self.favorites_grid_host = QtWidgets.QWidget()
        self.favorites_grid = QtWidgets.QGridLayout(self.favorites_grid_host)
        self.favorites_grid.setContentsMargins(0, 0, 0, 0)
        self.favorites_grid.setHorizontalSpacing(14)
        self.favorites_grid.setVerticalSpacing(14)
        host_layout.addWidget(self.favorites_grid_host)

        self.fav_no_result = QtWidgets.QLabel("没有匹配的收藏")
        self.fav_no_result.setObjectName("emptyHint")
        self.fav_no_result.setAlignment(Qt.AlignCenter)
        self.fav_no_result.setVisible(False)
        host_layout.addWidget(self.fav_no_result)
        host_layout.addStretch(1)

        scroll.setWidget(host)
        layout.addWidget(scroll)
        self.favorites_scroll = scroll
        return page

    def _build_loaded_page(self):
        page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        host = QtWidgets.QWidget()
        host_layout = QtWidgets.QVBoxLayout(host)
        host_layout.setContentsMargins(22, 18, 22, 20)
        host_layout.setSpacing(10)
        self.loaded_host = QtWidgets.QWidget()
        self.loaded_layout = QtWidgets.QVBoxLayout(self.loaded_host)
        self.loaded_layout.setContentsMargins(0, 0, 0, 0)
        self.loaded_layout.setSpacing(10)
        host_layout.addWidget(self.loaded_host)
        host_layout.addStretch(1)
        scroll.setWidget(host)
        layout.addWidget(scroll)
        self.loaded_scroll = scroll
        return page

    def _build_settings_page(self):
        page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        host = QtWidgets.QWidget()
        host_layout = QtWidgets.QVBoxLayout(host)
        host_layout.setContentsMargins(22, 18, 22, 20)
        host_layout.setSpacing(12)

        # 当前用户
        user_card = self._settings_card(
            "当前用户",
            "个人数据（收藏、设置）按此名称隔离存放；节点插件和在线目录为所有用户共享。")
        user_row = QtWidgets.QHBoxLayout()
        user_row.setSpacing(8)
        self.user_name_label = QtWidgets.QLabel("当前用户：%s" % self.user_name)
        self.user_name_label.setObjectName("fieldValue")
        user_row.addWidget(self.user_name_label, 1)
        switch_user_btn = QtWidgets.QPushButton("切换用户")
        switch_user_btn.setObjectName("ghostButton")
        switch_user_btn.setCursor(Qt.PointingHandCursor)
        switch_user_btn.setToolTip("用另一个个人名称登录，加载该用户的收藏和设置")
        switch_user_btn.clicked.connect(self.switch_user)
        user_row.addWidget(switch_user_btn)
        user_card.layout().addLayout(user_row)
        user_data_hint = QtWidgets.QLabel("个人数据目录：%s" % user_dir(self.user_name))
        user_data_hint.setObjectName("mono")
        user_data_hint.setToolTip(user_dir(self.user_name))
        user_card.layout().addWidget(user_data_hint)
        host_layout.addWidget(user_card)

        # 目录
        dir_card = self._settings_card("插件目录",
                                       "市场默认扫描这个目录；每个子文件夹名就是节点的注册序号。")
        dir_row = QtWidgets.QHBoxLayout()
        dir_row.setSpacing(8)
        self.path_edit = QtWidgets.QLineEdit()
        self.path_edit.setObjectName("pathEdit")
        dir_row.addWidget(self.path_edit, 1)
        browse = QtWidgets.QPushButton("浏览")
        browse.setObjectName("ghostButton")
        browse.clicked.connect(self.browse_nodes_dir)
        save = QtWidgets.QPushButton("保存并扫描")
        save.setObjectName("primaryButton")
        save.clicked.connect(self.save_nodes_dir)
        dir_row.addWidget(browse)
        dir_row.addWidget(save)
        dir_card.layout().addLayout(dir_row)

        # 快捷入口
        links_card = self._settings_card("快捷入口",
                                        "常用官方入口，方便作者申请节点序号、查看本插件仓库。")
        self.node_id_button = QtWidgets.QPushButton(
            "Maya 官方节点序号申请  →  adn.autodesk.io/maya")
        self.node_id_button.setObjectName("linkButton")
        self.node_id_button.setCursor(Qt.PointingHandCursor)
        self.node_id_button.clicked.connect(
            lambda: open_url(node_market.MAYA_NODE_ID_URL))
        self.github_button = QtWidgets.QPushButton()
        self.github_button.setObjectName("linkButton")
        self.github_button.setCursor(Qt.PointingHandCursor)
        self.github_button.clicked.connect(lambda: open_url(self.github_url))
        links_card.layout().addWidget(self.node_id_button)
        links_card.layout().addWidget(self.github_button)

        # 场景依赖检测
        scene_card = self._settings_card(
            "场景依赖检测",
            "保存时把用到的节点写进文件；打开文件时发现缺少的插件会提示并支持一键安装。只在市场窗口打开的这一会话生效。")
        self.scene_check_box = QtWidgets.QCheckBox("打开文件时检测缺失节点")
        self.scene_check_box.setObjectName("filterCheck")
        self.scene_check_box.setCursor(Qt.PointingHandCursor)
        self.scene_check_box.setChecked(self.scene_check)
        self.scene_check_box.toggled.connect(self.on_scene_check_toggled)
        self.scene_check_button = QtWidgets.QPushButton("立即检查当前文件")
        self.scene_check_button.setObjectName("ghostButton")
        self.scene_check_button.setCursor(Qt.PointingHandCursor)
        self.scene_check_button.setToolTip("检查当前场景缺少哪些节点插件")
        self.scene_check_button.clicked.connect(
            lambda: self.check_scene_requirements(auto=False))
        scene_row = QtWidgets.QHBoxLayout()
        scene_row.setSpacing(8)
        scene_row.addWidget(self.scene_check_box)
        scene_row.addStretch(1)
        scene_row.addWidget(self.scene_check_button)
        scene_card.layout().addLayout(scene_row)

        # 环境检查跳过开关
        env_row = QtWidgets.QHBoxLayout()
        env_row.setSpacing(8)
        self.env_skip_box = QtWidgets.QCheckBox(
            "启动时跳过可选依赖的环境检查提示")
        self.env_skip_box.setObjectName("filterCheck")
        self.env_skip_box.setCursor(Qt.PointingHandCursor)
        self.env_skip_box.setChecked(
            bool(load_settings().get("skip_env_optional", False)))
        self.env_skip_box.setToolTip(
            "仅当缺失依赖全是可选的（如 requests）时才生效；"
            "必需依赖缺失时仍会弹窗提示。")
        self.env_skip_box.toggled.connect(self.on_env_skip_toggled)
        env_row.addWidget(self.env_skip_box)
        env_row.addStretch(1)
        scene_card.layout().addLayout(env_row)

        # 规则
        rule_card = self._settings_card("命名与加载规则", "市场不识别文件夹本身，只识别节点。")
        rule_text = QtWidgets.QLabel(
            "1. 插件文件夹名必须等于节点的注册序号，例如 0x00141488，用来防止节点和插件重名。\n"
            "2. 文件夹里放插件 .py 文件；插件通过 registerNode 注册节点，识别到节点就生成卡片和按钮。\n"
            "3. 作者在插件文件里写 NODE_INFO，卡片悬停和详情弹窗显示的就是这里的内容：\n"
            "    NODE_INFO = {\"name\": \"...\", \"description\": \"...\", \"node_id\": \"0x...\", "
            "\"tags\": [\"绑定\"], \"run\": \"cmds.xxx()\"}\n"
            "4. 点「加载」会 loadPlugin；点「运行」会先尝试卸载并重新加载插件，再按 NODE_INFO.run → 注册命令 → 创建节点的顺序执行。\n"
            "5. NODE_INFO.tags 会自动加入顶部标签栏；收藏按节点序号保存在本地，不随版本更新丢失。\n"
            "6. 解析结果按文件修改时间缓存，右上角「清缓存」会删除 JSON 缓存并重新识别标签。\n"
            "7. 首次从市场加载插件时 Maya 会弹出安全提示，建议勾选「Apply to all plugins in this location」后点「允许」，之后同一目录不再提示。")
        rule_text.setObjectName("ruleText")
        rule_text.setWordWrap(True)
        rule_card.layout().addWidget(rule_text)

        # 扫描状态
        status_card = self._settings_card("扫描状态", "")
        self.scan_summary = QtWidgets.QLabel()
        self.scan_summary.setObjectName("fieldValue")
        self.scan_warnings = QtWidgets.QLabel()
        self.scan_warnings.setObjectName("hint")
        self.scan_warnings.setWordWrap(True)
        self.scan_warnings.setTextInteractionFlags(Qt.TextSelectableByMouse)
        status_card.layout().addWidget(self.scan_summary)
        status_card.layout().addWidget(self.scan_warnings)
        cache_row = QtWidgets.QHBoxLayout()
        cache_row.setSpacing(8)
        self.cache_button = QtWidgets.QPushButton("清除缓存并重新识别")
        self.cache_button.setObjectName("ghostButton")
        self.cache_button.setCursor(Qt.PointingHandCursor)
        self.cache_button.setToolTip("删除 market_cache.json，重新解析节点和 NODE_INFO.tags")
        self.cache_button.clicked.connect(self.hard_refresh)
        self.cache_path_label = QtWidgets.QLabel("缓存文件：market_cache.json")
        self.cache_path_label.setObjectName("mono")
        self.cache_path_label.setToolTip(CACHE_PATH)
        cache_row.addWidget(self.cache_button)
        cache_row.addWidget(self.cache_path_label, 1)
        status_card.layout().addLayout(cache_row)

        about_card = self._settings_card("关于", "")
        about_text = QtWidgets.QLabel(
            "作者：%s (%s)\n"
            "市场版本：v%s · 节点驱动\n"
            "GitHub：%s\n"
            "个人数据（收藏、设置）按用户名隔离在 user_data/<用户名>/ 下；"
            "节点解析结果缓存在 market_cache.json（共享），文件改动或版本更新后会自动重载。"
            % (AUTHOR_NAME, AUTHOR_NAME_EN, TOOL_VERSION, MARKET_GITHUB_URL))
        about_text.setObjectName("ruleText")
        about_text.setWordWrap(True)
        about_card.layout().addWidget(about_text)
        self.settings_update_button = QtWidgets.QPushButton("从 GitHub 更新市场")
        self.settings_update_button.setObjectName("primaryButton")
        self.settings_update_button.setCursor(Qt.PointingHandCursor)
        self.settings_update_button.setToolTip("下载最新版并覆盖市场代码，不会动 nodes/、收藏和缓存")
        self.settings_update_button.clicked.connect(self.update_market)
        about_card.layout().addWidget(self.settings_update_button)

        host_layout.addWidget(dir_card)
        host_layout.addWidget(links_card)
        host_layout.addWidget(scene_card)
        host_layout.addWidget(rule_card)
        host_layout.addWidget(status_card)
        host_layout.addWidget(about_card)
        host_layout.addStretch(1)
        scroll.setWidget(host)
        layout.addWidget(scroll)
        self.settings_scroll = scroll
        return page

    def _settings_card(self, title, hint):
        card = QtWidgets.QFrame()
        card.setObjectName("settingsCard")
        layout = QtWidgets.QVBoxLayout(card)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(9)
        title_label = QtWidgets.QLabel(title)
        title_label.setObjectName("sectionTitle")
        layout.addWidget(title_label)
        if hint:
            hint_label = QtWidgets.QLabel(hint)
            hint_label.setObjectName("hint")
            hint_label.setWordWrap(True)
            layout.addWidget(hint_label)
        return card

    # ------------------------------------------------------------------
    # 扫描与刷新
    # ------------------------------------------------------------------
    def refresh(self, hard=False):
        self.path_edit.setText(self.nodes_dir)
        try:
            result = node_market.scan_market(
                self.nodes_dir, cache_path=CACHE_PATH, clear_cache=hard)
            self.plugins = result.plugins
            self.warnings = result.warnings
            self.scan_folders = result.folders
            self.scan_files = result.node_files
            self.scan_cache_hits = result.cache_hits
            self.scan_parsed_files = result.parsed_files
        except Exception as exc:
            self.plugins = []
            self.warnings = ["扫描失败：%s" % exc]
            self.scan_folders = 0
            self.scan_files = 0
            self.scan_cache_hits = 0
            self.scan_parsed_files = 0
            cmds.warning("节点插件市场扫描失败：%s" % exc)

        self.build_tag_bar(self.tag_source)
        self.build_cards()
        self.build_online_cards()
        self.build_favorites()
        self.build_loaded()
        self.update_settings()
        self.update_status()
        self.apply_filter(self.search_box.text())

    def hard_refresh(self):
        self.refresh(hard=True)
        self.notify("已清除 JSON 缓存，重新识别到 %d 个节点" % len(self.plugins), True)

    def build_tag_bar(self, source=None):
        if source is not None:
            self.tag_source = source
        while self.tag_layout.count():
            item = self.tag_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.tag_buttons = []

        counts = {}
        total = 0
        if self.tag_source == "online":
            for entry in self.online_entries:
                total += 1
                for tag in set(entry.all_tags):
                    counts[tag] = counts.get(tag, 0) + 1
        else:
            for plugin in self.plugins:
                total += 1
                for tag in set(plugin.all_tags):
                    counts[tag] = counts.get(tag, 0) + 1

        # 切页后当前页没有的标签自动取消，避免一直筛出空结果
        self.active_tags &= set(counts)

        if not counts:
            self.tag_bar.setVisible(False)
            self.tag_search.setVisible(False)
            return
        self.tag_search.setVisible(self.stack.currentIndex() in (0, 1, 2))

        def add_chip(label, tag, count):
            button = QtWidgets.QPushButton(label)
            button.setObjectName("tagChip")
            button.setCheckable(True)
            button.setChecked(tag in self.active_tags)
            button.setCursor(Qt.PointingHandCursor)
            button.setProperty("tagValue", tag if tag is not None else "")
            if tag is None:
                button.setToolTip("清空已选标签")
            else:
                button.setToolTip("%s：%d 个插件\n点击可多选，再点一次取消" % (tag, count))
            button.clicked.connect(lambda checked=False, t=tag: self.toggle_tag(t))
            self.tag_layout.addWidget(button)
            self.tag_buttons.append(button)

        add_chip("全部", None, total)
        query = (self.tag_query or "").strip().lower()
        for tag in sorted(counts, key=lambda item: (-counts[item], item)):
            if query and query not in tag.lower() and tag not in self.active_tags:
                continue
            add_chip(tag, tag, counts[tag])
        QtCore.QTimer.singleShot(0, self._resize_tag_host)
        self.tag_bar.setVisible(self.stack.currentIndex() in (0, 1, 2))
        self.set_tag_summary()

    def _resize_tag_host(self):
        if not hasattr(self, "tag_host") or not self.tag_buttons:
            return
        hint = self.tag_layout.sizeHint()
        if hint.width() > 0 and hint.height() > 0:
            self.tag_host.setFixedSize(hint)

    def on_tag_query(self, text):
        self.tag_query = text or ""
        self.build_tag_bar()
        self.apply_filter(self.search_box.text())

    def toggle_tag(self, tag):
        if tag is None:
            self.active_tags.clear()
        elif tag in self.active_tags:
            self.active_tags.discard(tag)
        else:
            self.active_tags.add(tag)
        for button in self.tag_buttons:
            value = button.property("tagValue") or ""
            button.setChecked(bool(value) and value in self.active_tags)
        self.set_tag_summary()
        self.apply_filter(self.search_box.text())

    def set_tag_summary(self):
        if self.active_tags:
            self.tag_search.setPlaceholderText(
                "搜索标签（已选 %d 个）" % len(self.active_tags))
        else:
            self.tag_search.setPlaceholderText("搜索标签")

    def build_cards(self):
        while self.grid.count():
            item = self.grid.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.cards = []

        self.empty_card.setVisible(not bool(self.plugins))
        self.empty_path.setText(self.nodes_dir)
        self.grid_host.setVisible(bool(self.plugins))

        for plugin in self.plugins:
            card = PluginCard(plugin, self.grid_host, self.run_plugin,
                              self.show_detail, self.card_menu_action,
                              self.toggle_favorite, self.is_favorite(plugin))
            card.show()
            self.cards.append(card)
            self.grid.addWidget(card)

        self._update_columns(force=True)

    def build_online_cards(self):
        # 冻结绘制，避免「清空→逐张重建→重排」的中间过程被渲染出来造成闪烁。
        host = getattr(self, "online_grid_host", None)
        if host is not None:
            host.setUpdatesEnabled(False)
        try:
            while self.online_grid.count():
                item = self.online_grid.takeAt(0)
                widget = item.widget()
                if widget is not None:
                    widget.setParent(None)
                    widget.deleteLater()
            self.online_cards = []

            local_by_id = {}
            for plugin in self.plugins:
                local_by_id[plugin.node_id_text] = plugin

            entries = self.filtered_online_entries()
            total = len(entries)
            pages = max(1, (total + self.online_page_size - 1) // self.online_page_size)
            if self.online_page_index >= pages:
                self.online_page_index = pages - 1
            if self.online_page_index < 0:
                self.online_page_index = 0
            start = self.online_page_index * self.online_page_size
            page_entries = entries[start:start + self.online_page_size]

            has_page = bool(page_entries)
            # 必须在创建卡片之前让宿主可见，否则卡片 isHidden() 为 True，
            # _reflow_online 会把它们全部过滤掉（Qt 的 show 事件是异步的）。
            self.online_grid_host.setVisible(has_page)
            self.online_empty.setVisible(not self.online_entries)
            self.online_no_result.setVisible(bool(self.online_entries) and not has_page)
            if self.online_entries and not has_page:
                self.online_no_result.setText(self.online_no_result_text())

            for entry in page_entries:
                card = OnlineCard(
                    entry, local_by_id.get(entry.node_id_text), self.online_grid_host,
                    self.install_online_entry, self.show_online_detail,
                    self.toggle_favorite, self.is_favorite(entry))
                if entry.repo:
                    card.set_stars(self.online_stars.get(entry.repo, -1))
                card.show()
                self.online_cards.append(card)
                self.online_grid.addWidget(card)

            self.online_pager.setVisible(total > self.online_page_size)
            if total:
                self.online_page_label.setText(
                    "第 %d / %d 页 · 共 %d 个" % (self.online_page_index + 1, pages, total))
                self.online_prev_button.setEnabled(self.online_page_index > 0)
                self.online_next_button.setEnabled(self.online_page_index + 1 < pages)

            self._reflow_online()
            self.update_online_summary()
            self.update_update_all_button()
        finally:
            if host is not None:
                host.setUpdatesEnabled(True)

    def filtered_online_entries(self):
        """搜索 + 标签 + 只看未安装 + 排序，返回当前应展示的条目。"""
        text = (self.search_box.text() or "").strip().lower()
        local_ids = set(plugin.node_id_text for plugin in self.plugins)
        items = []
        hide_installed = self.online_hide_installed_check()
        for entry in self.online_entries:
            if hide_installed and entry.node_id_text in local_ids:
                continue
            if text and text not in entry.search_text():
                continue
            if self.active_tags and not self.active_tags.issubset(set(entry.all_tags)):
                continue
            items.append(entry)

        if self.online_sort_key == "name":
            items.sort(key=lambda e: (e.title or "").lower())
        elif self.online_sort_key == "id":
            items.sort(key=lambda e: e.node_id or 0)
        else:
            items.sort(key=lambda e: (e.updated or "", (e.title or "").lower()), reverse=True)
        return items

    def online_no_result_text(self):
        if self.active_tags:
            return "没有同时满足所选标签的插件，试试少选几个标签"
        if self.online_hide_installed_check():
            return "全部插件都已安装，取消「只看未安装」可以看到它们"
        return "没有匹配的在线插件"

    def on_online_filter_changed(self, *args):
        data = self.online_sort.currentData()
        self.online_sort_key = data or "updated"
        self.online_page_index = 0
        self.build_online_cards()

    def online_hide_installed_check(self):
        widget = getattr(self, "online_hide_installed", None)
        try:
            return bool(widget.isChecked())
        except Exception:
            return False

    def change_online_page(self, delta):
        self.online_page_index = max(0, self.online_page_index + delta)
        self.build_online_cards()
        try:
            self.online_scroll.verticalScrollBar().setValue(0)
        except Exception:
            pass

    def update_update_all_button(self):
        if not hasattr(self, "online_update_all_button"):
            return
        local_by_id = dict((plugin.node_id_text, plugin) for plugin in self.plugins)
        pending = 0
        for entry in self.online_entries:
            plugin = local_by_id.get(entry.node_id_text)
            if plugin is None:
                continue
            if online_market.is_newer(entry.version, plugin.version):
                pending += 1
        self.online_update_all_button.setText(
            "更新全部（%d）" % pending if pending else "更新全部")
        self.online_update_all_button.setEnabled(bool(pending))

    def _track_thread(self, thread, *attributes):
        """登记后台线程，结束后自动解除引用；关窗时由 _stop_threads 统一收尾。"""
        if not isinstance(getattr(self, "_bg_threads", None), list):
            self._bg_threads = []
        self._bg_threads.append(thread)

        def _cleanup():
            try:
                if thread in self._bg_threads:
                    self._bg_threads.remove(thread)
            except Exception:
                pass
            for name in attributes:
                try:
                    if getattr(self, name, None) is thread:
                        setattr(self, name, None)
                except Exception:
                    pass

        thread.finished.connect(_cleanup)
        return thread

    def _stop_threads(self):
        """关窗时让后台线程收尾，但绝不阻塞界面。

        线程不再挂在窗口下面，即使还有网络请求没返回，窗口关闭/销毁也不会
        连带销毁运行中的 QThread；这里只发退出请求，等它们自己结束。
        """
        for thread in list(getattr(self, "_bg_threads", []) or []):
            try:
                if thread.isRunning():
                    thread.quit()
            except Exception:
                continue
        self._bg_threads = []
        for name in ("_catalog_thread", "_stars_thread", "_version_thread",
                     "_update_thread", "_catalog_worker", "_stars_worker",
                     "_version_worker", "_update_worker"):
            try:
                setattr(self, name, None)
            except Exception:
                pass

    def start_star_fetch(self):
        repos = sorted(set(
            entry.repo for entry in self.online_entries
            if entry.repo and entry.repo not in self.online_stars))
        if not repos:
            return
        worker = StarsWorker(repos)
        thread = keep_thread(QtCore.QThread())
        worker.moveToThread(thread)
        worker.done.connect(self._on_stars_loaded)
        worker.done.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.started.connect(worker.run)
        self._stars_worker = worker
        self._stars_thread = thread
        self._track_thread(thread, "_stars_thread")
        thread.start()

    def _on_stars_loaded(self, stars):
        if not isinstance(stars, dict) or not stars:
            return
        self.online_stars.update(stars)
        for card in list(self.online_cards):
            if card.entry.repo in stars:
                card.set_stars(stars[card.entry.repo])

    def check_market_version(self):
        self._version_checked_at = time.time()
        worker = VersionWorker()
        thread = keep_thread(QtCore.QThread())
        worker.moveToThread(thread)
        worker.done.connect(self._on_version_checked)
        worker.done.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.started.connect(worker.run)
        self._version_worker = worker
        self._version_thread = thread
        self._track_thread(thread, "_version_thread")
        thread.start()

    def _maybe_check_version(self, interval=300):
        """启动时检查过一次后，切到「在线」页时隔一段时间再补查一次。"""
        if time.time() - self._version_checked_at < interval:
            return
        if getattr(self, "_version_thread", None) is not None:
            try:
                if self._version_thread.isRunning():
                    return
            except Exception:
                pass
        self.check_market_version()

    def _set_update_available(self, version):
        """有新版本时把「更新」按钮高亮 + 显示版本号，没有就恢复原样。"""
        self.market_update_available = version or ""
        if version:
            self.update_button.setText("更新 · v%s" % version)
            self.update_button.setToolTip(
                "有新版本 v%s，点这里从 GitHub 更新市场代码" % version)
        else:
            self.update_button.setText("更新")
            self.update_button.setToolTip("从 GitHub 下载最新版市场代码并覆盖安装")
        self.update_button.setProperty("update", bool(version))
        style = self.update_button.style()
        style.unpolish(self.update_button)
        style.polish(self.update_button)

    def _on_version_checked(self, version):
        if not version:
            return
        if online_market.is_newer(version, TOOL_VERSION):
            self._set_update_available(version)
            self.notify("插件市场有新版本 v%s，可点右上角「更新」" % version, True)
        else:
            self._set_update_available("")

    def update_all_online(self):
        local_by_id = {}
        for plugin in self.plugins:
            local_by_id[plugin.node_id_text] = plugin

        pending = []
        for entry in self.online_entries:
            plugin = local_by_id.get(entry.node_id_text)
            if plugin is None:
                continue
            if online_market.is_newer(entry.version, plugin.version):
                pending.append((entry, plugin))
        if not pending:
            self.notify("没有需要更新的插件", True)
            return

        lines = []
        for entry, plugin in pending[:8]:
            lines.append("· %s  v%s → v%s" % (
                entry.title, plugin.version or "—", entry.version or "—"))
        if len(pending) > 8:
            lines.append("… 共 %d 个" % len(pending))
        reply = QtWidgets.QMessageBox.question(
            self, "更新全部插件",
            "将更新 %d 个插件：\n%s\n\n每个都会先备份到 nodes/.backup。继续？" % (
                len(pending), "\n".join(lines)),
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.Yes)
        if reply != QtWidgets.QMessageBox.Yes:
            return

        dialog = TaskProgressDialog(
            "更新全部插件", "共 %d 个插件" % len(pending), self)
        dialog.set_stage("准备更新...", 1, "")
        dialog.show()
        pump_events()

        finished = []
        failed = []
        for index, (entry, plugin) in enumerate(pending, 1):
            def report(stage, message, percent=None, detail="", i=index, e=entry):
                dialog.set_stage(
                    message, percent,
                    "%s（%d/%d）\n%s" % (e.title, i, len(pending), detail))
                pump_events()
                if stage != "done" and dialog.was_cancelled():
                    raise online_market.Cancelled()

            try:
                online_market.install_entry(entry, self.nodes_dir, report)
                finished.append(entry.title)
            except online_market.Cancelled:
                break
            except Exception as exc:
                failed.append("%s：%s" % (entry.title, exc))

        dialog.finish()
        self.refresh()
        message = "已更新 %d 个插件" % len(finished)
        if failed:
            message += "，%d 个失败" % len(failed)
            cmds.warning("批量更新失败：\n" + "\n".join(failed))
        self.notify(message, not failed)

    def delete_plugin(self, plugin):
        reply = QtWidgets.QMessageBox.question(
            self, "删除插件",
            "把「%s」从本地 nodes 目录移除？\n\n"
            "会先备份到 nodes/.backup，需要时可以手动恢复。\n路径：%s" % (
                plugin.title, plugin.folder),
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.No)
        if reply != QtWidgets.QMessageBox.Yes:
            return
        if node_market.plugin_loaded(plugin.path):
            node_market.unload_plugin_file(plugin.path)
        try:
            backup = online_market.backup_plugin_folder(plugin.folder, plugin.node_id_text)
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "删除失败", str(exc))
            return
        # 同步从开机自动加载清单里移除
        set_autoload(plugin, False)
        self.refresh()
        self.notify("%s：已移除（备份在 %s）" % (plugin.title, backup), True)

    def update_online_summary(self):
        if self.online_loading:
            text = "正在刷新在线目录..." if self.online_entries else "正在加载在线目录..."
        elif self.online_entries:
            source = ""
            if self.online_catalog:
                source_url = self.online_catalog.get("_source_url") or ""
                source = self.online_catalog.get("_source_label") or ""
                if not source:
                    source = "jsDelivr" if "jsdelivr" in source_url else (
                        "GitHub" if "github" in source_url else "本地缓存")
            when = ""
            if self.online_fetched_at:
                when = time.strftime("%Y-%m-%d %H:%M", time.localtime(self.online_fetched_at))
            text = "在线目录：%d 个插件" % len(self.online_entries)
            if when:
                text += "  ·  更新于 %s" % when
            if source:
                text += "  ·  %s" % source
            if self.online_error:
                text += "（离线缓存）"
        elif self.online_error:
            first_line = str(self.online_error).strip().splitlines()[0]
            text = "在线目录加载失败：%s" % node_market.shorten(first_line, 60)
        else:
            text = "在线目录为空"
        self.online_summary.setText(text)
        tip = online_market.INDEX_URL
        if self.online_catalog and self.online_catalog.get("_source_url"):
            tip += "\n" + str(self.online_catalog.get("_source_url"))
        if self.online_error:
            tip += "\n" + self.online_error
        self.online_summary.setToolTip(tip)

        if not self.online_entries:
            if self.online_loading:
                self.online_empty_title.setText("正在加载在线目录")
                self.online_empty_hint.setText(
                    "在线目录来自 GitHub 索引仓库；首次打开需要联网，加载过一次后会缓存到本地。")
                self.online_retry_button.setVisible(False)
            elif self.online_error:
                self.online_empty_title.setText("在线目录加载失败")
                self.online_empty_hint.setText(node_market.shorten(self.online_error, 240))
                self.online_retry_button.setVisible(True)
            else:
                self.online_empty_title.setText("在线目录为空")
                self.online_empty_hint.setText("索引仓库里还没有可用的插件条目。")
                self.online_retry_button.setVisible(True)

    def build_favorites(self):
        while self.favorites_grid.count():
            item = self.favorites_grid.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.favorite_cards = []

        favorite_plugins = [plugin for plugin in self.plugins if self.is_favorite(plugin)]
        local_ids = set(plugin.node_id_text for plugin in self.plugins)
        favorite_online = [entry for entry in self.online_entries
                           if self.is_favorite(entry) and entry.node_id_text not in local_ids]

        has_favorites = bool(favorite_plugins or favorite_online)
        self.favorites_empty.setVisible(not has_favorites)
        self.favorites_grid_host.setVisible(has_favorites)

        for plugin in favorite_plugins:
            card = PluginCard(plugin, self.favorites_grid_host, self.run_plugin,
                              self.show_detail, self.card_menu_action,
                              self.toggle_favorite, True)
            card.show()
            self.favorite_cards.append(card)
            self.favorites_grid.addWidget(card)
        for entry in favorite_online:
            card = OnlineCard(
                entry, None, self.favorites_grid_host,
                self.install_online_entry, self.show_online_detail,
                self.toggle_favorite, True)
            card.show()
            self.favorite_cards.append(card)
            self.favorites_grid.addWidget(card)

        self._reflow_favorites()

    def is_favorite(self, plugin):
        return plugin.node_id_text in self.favorites

    def toggle_favorite(self, plugin):
        key = plugin.node_id_text
        if key in self.favorites:
            self.favorites.discard(key)
            message = "已取消收藏"
        else:
            self.favorites.add(key)
            message = "已收藏"
        save_state({"favorites": sorted(self.favorites)})
        for card in list(self.cards) + list(self.online_cards) + list(self.favorite_cards):
            if card.plugin.node_id_text == key:
                card.set_favorite(key in self.favorites)
        self.build_favorites()
        self.apply_filter(self.search_box.text())
        self.update_status()
        self.notify("%s：%s" % (plugin.title, message), True)

    def _active_scroll(self):
        # 返回当前标签页对应的滚动区，避免在非「发现」页时读取到隐藏页的过期视口宽度
        index = self.stack.currentIndex() if hasattr(self, "stack") else 0
        mapping = {
            0: getattr(self, "discover_scroll", None),
            1: getattr(self, "online_scroll", None),
            2: getattr(self, "favorites_scroll", None),
            3: getattr(self, "loaded_scroll", None),
            4: getattr(self, "settings_scroll", None),
        }
        scroll = mapping.get(index)
        if scroll is None:
            scroll = getattr(self, "discover_scroll", None)
        return scroll

    def _update_columns(self, force=False):
        scroll = self._active_scroll()
        try:
            viewport = scroll.viewport().width() if scroll is not None else 0
        except Exception:
            viewport = 0
        if viewport <= 0:
            viewport = self.width() - GRID_MARGIN
        columns = max(1, min(MAX_COLUMNS, int((viewport - GRID_MARGIN + GRID_SPACING) / (CARD_WIDTH + GRID_SPACING))))
        if force or columns != self._columns:
            self._columns = columns
            self.reflow()
            self._reflow_online()
            self._reflow_favorites()

    def reflow(self):
        while self.grid.count():
            self.grid.takeAt(0)
        visible = [card for card in self.cards if not card.isHidden()]
        for index, card in enumerate(visible):
            row = index // self._columns
            column = index % self._columns
            self.grid.addWidget(card, row, column, Qt.AlignTop | Qt.AlignLeft)
        for column in range(MAX_COLUMNS + 2):
            self.grid.setColumnStretch(column, 0)
        self.grid.setColumnStretch(self._columns, 1)

    def _reflow_online(self):
        if not hasattr(self, "online_grid"):
            return
        while self.online_grid.count():
            self.online_grid.takeAt(0)
        visible = [card for card in self.online_cards if not card.isHidden()]
        for index, card in enumerate(visible):
            row = index // self._columns
            column = index % self._columns
            self.online_grid.addWidget(card, row, column, Qt.AlignTop | Qt.AlignLeft)
        for column in range(MAX_COLUMNS + 2):
            self.online_grid.setColumnStretch(column, 0)
        self.online_grid.setColumnStretch(self._columns, 1)
        self.online_grid.invalidate()
        self.online_grid.activate()
        if visible:
            self.online_grid_host.setMinimumHeight(self.online_grid.sizeHint().height())
        else:
            self.online_grid_host.setMinimumHeight(0)
        self.online_grid_host.updateGeometry()

    def _reflow_favorites(self):
        if not hasattr(self, "favorites_grid"):
            return
        while self.favorites_grid.count():
            self.favorites_grid.takeAt(0)
        visible = [card for card in self.favorite_cards if not card.isHidden()]
        for index, card in enumerate(visible):
            row = index // self._columns
            column = index % self._columns
            self.favorites_grid.addWidget(card, row, column, Qt.AlignTop | Qt.AlignLeft)
        for column in range(MAX_COLUMNS + 2):
            self.favorites_grid.setColumnStretch(column, 0)
        self.favorites_grid.setColumnStretch(self._columns, 1)
        # 收藏页第一次显示时布局还没激活，补一次高度计算，否则会出现空白页
        self.favorites_grid.invalidate()
        self.favorites_grid.activate()
        if visible:
            self.favorites_grid_host.setMinimumHeight(self.favorites_grid.sizeHint().height())
        else:
            self.favorites_grid_host.setMinimumHeight(0)
        self.favorites_grid_host.updateGeometry()

    def _filter_cards(self, cards, text, no_result):
        visible_count = 0
        for card in cards:
            plugin = card.plugin
            match = not text or text in plugin.search_text()
            tags = getattr(plugin, "all_tags", None) or plugin.tags
            if match and self.active_tags and not self.active_tags.issubset(set(tags)):
                match = False
            card.setVisible(match)
            if match:
                visible_count += 1
        no_result.setVisible(bool(cards) and visible_count == 0)
        if cards and visible_count == 0 and self.active_tags:
            no_result.setText("没有同时满足所选标签的插件，试试少选几个标签")
        elif cards and visible_count == 0:
            no_result.setText("没有匹配的插件")

    def apply_filter(self, text):
        text = (text or "").strip().lower()
        index = self.stack.currentIndex()
        if index == 0:
            self._filter_cards(self.cards, text, self.no_result)
            self.reflow()
        elif index == 1:
            # 仅当「搜索词 + 已选标签」都没变且卡片已建好时才跳过，
            # 避免切回在线页时无谓的整套重建/闪烁；改词或点标签仍会正常重建。
            state = (text, frozenset(self.active_tags))
            last = getattr(self, "_last_online_filter_state", None)
            self._last_online_filter_state = state
            if state != last or not getattr(self, "online_cards", None):
                self.online_page_index = 0
                self.build_online_cards()
        elif index == 2:
            self._filter_cards(self.favorite_cards, text, self.fav_no_result)
            self._reflow_favorites()

    def _visible_plugins(self):
        return [plugin for plugin in self.plugins if node_market.plugin_loaded(plugin.path)]

    def build_loaded(self):
        while self.loaded_layout.count():
            item = self.loaded_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()

        loaded = self._visible_plugins()
        if not loaded:
            empty = QtWidgets.QLabel("还没有已加载的节点插件。到「发现」里点一下「加载」即可。")
            empty.setObjectName("emptyHint")
            empty.setAlignment(Qt.AlignCenter)
            empty.setContentsMargins(0, 40, 0, 0)
            self.loaded_layout.addWidget(empty)
            return

        for plugin in loaded:
            self.loaded_layout.addWidget(self._loaded_row(plugin))
        self.loaded_layout.addStretch(1)

    def _loaded_row(self, plugin):
        row = QtWidgets.QFrame()
        row.setObjectName("listRow")
        layout = QtWidgets.QHBoxLayout(row)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(12)

        icon = QtWidgets.QLabel()
        apply_icon(icon, plugin, 36)
        layout.addWidget(icon, 0, Qt.AlignVCenter)

        info = QtWidgets.QVBoxLayout()
        info.setSpacing(2)
        title = QtWidgets.QLabel(plugin.title)
        title.setObjectName("cardTitle")
        detail = QtWidgets.QLabel("%s  ·  %s  ·  %s" % (
            plugin.node_name or "—", plugin.node_id_text, plugin.plugin_name))
        detail.setObjectName("cardMeta")
        info.addWidget(title)
        info.addWidget(detail)
        layout.addLayout(info, 1)

        path_label = QtWidgets.QLabel(node_market.shorten(plugin.path, 46))
        path_label.setObjectName("mono")
        path_label.setToolTip(plugin.path)
        layout.addWidget(path_label, 0)

        run = QtWidgets.QPushButton("运行" if plugin.is_runnable() else "已加载")
        run.setObjectName("primaryButton")
        run.setEnabled(plugin.is_runnable())
        run.clicked.connect(lambda checked=False, p=plugin: self.run_plugin(p))
        layout.addWidget(run)

        unload = QtWidgets.QPushButton("卸载")
        unload.setObjectName("ghostButton")
        unload.clicked.connect(lambda checked=False, p=plugin: self.unload_plugin(p))
        layout.addWidget(unload)

        folder = QtWidgets.QPushButton("文件夹")
        folder.setObjectName("ghostButton")
        folder.clicked.connect(lambda: node_market.open_in_explorer(plugin.path))
        layout.addWidget(folder)
        return row

    def update_status(self):
        loaded_count = len(self._visible_plugins())
        self.status_text.setText(
            "插件目录：%s    ·    %d 个节点    ·    %d 个已加载    ·    %d 个收藏" % (
                node_market.shorten(self.nodes_dir, 58), len(self.plugins),
                loaded_count, len(self.favorites)))
        self.status_text.setToolTip(self.nodes_dir)

    def update_settings(self):
        if not hasattr(self, "scan_summary"):
            return
        self.update_user_info()
        self.path_edit.setText(self.nodes_dir)
        if hasattr(self, "scene_check_box"):
            self.scene_check_box.setChecked(self.scene_check)
        self.github_button.setText("插件市场 GitHub 仓库  →  %s" % self.github_url)
        self.scan_summary.setText(
            "已识别 %d 个节点插件  ·  扫描 %d 个文件夹  ·  %d 个节点文件  ·  "
            "缓存命中 %d  ·  重新解析 %d" % (
                len(self.plugins), self.scan_folders, self.scan_files,
                self.scan_cache_hits, self.scan_parsed_files))
        if self.warnings:
            lines = ["· " + item for item in self.warnings[:8]]
            if len(self.warnings) > 8:
                lines.append("· 其余 %d 条省略" % (len(self.warnings) - 8))
            self.scan_warnings.setText("\n".join(lines))
            self.scan_warnings.setVisible(True)
        else:
            self.scan_warnings.setText("没有发现问题。")
            self.scan_warnings.setVisible(True)

    def notify(self, message, ok=True):
        self.status_message.setText(message)
        self.status_message.setStyleSheet(
            "color: %s; font-size: 11px;" % ("#8fd3a8" if ok else "#e5818b"))
        QtCore.QTimer.singleShot(6000, lambda: self.status_message.setText(""))

    # ------------------------------------------------------------------
    # 交互
    # ------------------------------------------------------------------
    def switch_tab(self, index):
        self.stack.setCurrentIndex(index)
        for i, button in enumerate(self.tab_buttons):
            button.setChecked(i == index)
        if index in (0, 1, 2):
            self.build_tag_bar("online" if index == 1 else "local")
        self.tag_bar.setVisible(index in (0, 1, 2) and bool(self.tag_buttons))
        self.tag_search.setVisible(index in (0, 1, 2) and bool(self.tag_buttons))
        if index == 1:
            if not self.online_catalog and not self.online_loading:
                self.fetch_online_catalog()
            self._maybe_check_version()
        if index == 2:
            self.build_favorites()
        if index == 3:
            self.build_loaded()
        if index == 4:
            self.update_settings()
        self.apply_filter(self.search_box.text())

    def run_plugin(self, plugin):
        ok, message = node_market.run_node_plugin(plugin)
        self.notify("%s：%s" % (plugin.title, message), ok)
        if not ok:
            cmds.warning("运行插件失败（%s）：%s" % (plugin.title, message))
        for card in list(self.cards) + list(self.favorite_cards):
            card.refresh_state()
        self.build_loaded()
        self.update_status()
        self.update_settings()

    def unload_plugin(self, plugin):
        ok, message = node_market.unload_plugin_file(plugin.path)
        self.notify("%s：%s" % (plugin.title, message), ok)
        if not ok:
            cmds.warning("卸载插件失败（%s）：%s" % (plugin.title, message))
        for card in list(self.cards) + list(self.favorite_cards):
            card.refresh_state()
        self.build_loaded()
        self.update_status()
        self.update_settings()

    def show_detail(self, plugin):
        dialog = DetailDialog(plugin, self, self.run_plugin)
        exec_dialog(dialog)

    def card_menu_action(self, action, plugin=None, checked=None):
        if action == "refresh":
            self.refresh()
        elif action == "unload" and plugin is not None:
            self.unload_plugin(plugin)
        elif action == "delete" and plugin is not None:
            self.delete_plugin(plugin)
        elif action == "autoload" and plugin is not None:
            self.toggle_autoload(plugin, bool(checked))
        elif action == "submit" and plugin is not None:
            self.submit_to_catalog(plugin)

    def submit_to_catalog(self, plugin):
        """把节点投稿到在线目录：不碰 git、不需要 Token。"""
        dialog = SubmissionDialog(plugin, self)
        dialog.exec_()

    def toggle_autoload(self, plugin, enabled):
        set_autoload(plugin, enabled)
        if enabled:
            tip = "已加入开机自动加载，下次启动 Maya 会自动加载"
            if not node_market.plugin_loaded(plugin.path):
                ok, message = node_market.load_plugin_file(plugin.path)
                if ok:
                    tip = "已加载，并加入开机自动加载"
                else:
                    tip = "已加入开机自动加载（当前加载失败：%s）" % message
            self.notify("%s：%s" % (plugin.title, tip), True)
        else:
            self.notify("%s：已取消开机自动加载" % plugin.title, True)
        for card in list(self.cards) + list(self.favorite_cards):
            card.refresh_state()
        self.build_loaded()
        self.update_status()

    # ------------------------------------------------------------------
    # 在线目录
    # ------------------------------------------------------------------
    def fetch_online_catalog(self):
        if self.online_loading:
            return
        self.online_loading = True
        self.online_error = ""
        self.update_online_summary()
        if not self.online_entries:
            self.online_empty.setVisible(True)
        worker = CatalogWorker()
        thread = keep_thread(QtCore.QThread())
        worker.moveToThread(thread)
        worker.done.connect(self._on_catalog_loaded)
        worker.done.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.started.connect(worker.run)
        self._catalog_worker = worker
        self._catalog_thread = thread
        self._track_thread(thread, "_catalog_thread")
        thread.start()

    def _on_catalog_loaded(self, ok, data, error):
        self.online_loading = False
        if ok and isinstance(data, dict):
            self.online_catalog = data
            self.online_entries = online_market.entries_from_catalog(data)
            self.online_fetched_at = data.get("_fetched_at") or time.time()
            self.online_error = ""
            online_market.save_catalog_cache(CATALOG_CACHE_PATH, data)
            self.build_online_cards()
            self.start_star_fetch()
            self.build_favorites()
            if self.stack.currentIndex() == 1:
                self.build_tag_bar("online")
            self.apply_filter(self.search_box.text())
            self.notify("在线目录已更新：%d 个插件" % len(self.online_entries), True)
        else:
            self.online_error = error or "未知错误"
            self.build_online_cards()
            if self.online_entries:
                self.notify("在线目录刷新失败，继续使用本地缓存", False)
            else:
                self.notify("在线目录加载失败", False)

        # 市场打开时若已有场景加载，目录就绪后补做一次缺失节点检测；
        # 否则检测只在「下一次打开文件」的 kAfterOpen 回调里才触发，
        # 先开文件、后开市场的情况会漏检。只触发一次。
        if not self._initial_scene_checked:
            self._initial_scene_checked = True
            QtCore.QTimer.singleShot(
                300, lambda: self.check_scene_requirements(auto=True))

    def _local_plugin_for(self, entry):
        for plugin in self.plugins:
            if plugin.node_id_text == entry.node_id_text:
                return plugin
        return None

    def show_online_detail(self, entry):
        dialog = OnlineDetailDialog(entry, self._local_plugin_for(entry), self,
                                    self.install_online_entry)
        exec_dialog(dialog)

    def install_online_entry(self, entry):
        installed = self._local_plugin_for(entry)
        if installed is not None and not online_market.is_newer(entry.version, installed.version):
            self.notify("%s 已经是最新版本" % entry.title, True)
            return
        action = "更新" if installed is not None else "安装"
        reply = QtWidgets.QMessageBox.question(
            self, "%s在线插件" % action,
            "将从 GitHub 下载「%s」并%s到：\n%s/%s\n\n"
            "作者：%s　版本：v%s　更新于：%s\n"
            "如果本地已有同序号目录，会先备份到 nodes/.backup 再覆盖。\n继续？" % (
                entry.title, action, self.nodes_dir, entry.node_id_text,
                entry.author or "未署名", entry.version or "—", entry.updated or "—"),
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.Yes)
        if reply != QtWidgets.QMessageBox.Yes:
            return

        dialog = TaskProgressDialog(
            "安装在线插件" if action == "安装" else "更新在线插件",
            entry.title, self)
        dialog.set_stage(
            "准备下载插件包...", 1,
            "节点：%s · %s\n来源：%s%s" % (
                entry.node_name, entry.node_id_text, entry.repo,
                ("/" + entry.subpath) if entry.subpath else ""))
        dialog.show()
        pump_events()

        def report(stage, message, percent=None, detail=""):
            dialog.set_stage(message, percent, detail)
            pump_events()
            if stage != "done" and dialog.was_cancelled():
                raise online_market.Cancelled()

        try:
            online_market.install_entry(entry, self.nodes_dir, report)
        except online_market.Cancelled:
            dialog.finish()
            self.notify("已取消%s" % action, False)
            return
        except Exception as exc:
            dialog.finish()
            QtWidgets.QMessageBox.warning(
                self, "%s失败" % action,
                "无法安装「%s」：\n%s" % (entry.title, exc))
            cmds.warning("在线插件%s失败（%s）：%s" % (action, entry.title, exc))
            return
        dialog.finish()
        self.refresh()
        suffix = "，点「运行」重新加载即可生效" if installed is not None else ""
        self.notify("%s：%s成功%s" % (entry.title, action, suffix), True)

    def update_market(self):
        reply = QtWidgets.QMessageBox.question(
            self, "更新插件市场",
            "将从 GitHub 下载最新版市场代码并覆盖本地文件：\n%s\n\n"
            "不会覆盖 nodes/ 插件、收藏、缓存和设置。\n"
            "更新完成后需要关闭并重新打开市场才会生效。\n\n继续？" % MARKET_GITHUB_URL,
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.Yes)
        if reply != QtWidgets.QMessageBox.Yes:
            return

        dialog = TaskProgressDialog("更新插件市场", "节点插件市场", self)
        dialog.set_stage("准备从 GitHub 下载市场更新包...", None, MARKET_GITHUB_URL)
        dialog.show()
        pump_events()

        self._update_cancel = threading.Event()
        dialog.cancel_button.clicked.connect(self._update_cancel.set)

        worker = MarketUpdateWorker(self._download_market_update, self._update_cancel)
        thread = keep_thread(QtCore.QThread())
        worker.moveToThread(thread)
        worker.progress.connect(dialog.set_stage)
        worker.done.connect(
            lambda ok, copied, error: self._on_market_update_done(
                dialog, ok, copied, error))
        worker.done.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.started.connect(worker.run)
        self._update_worker = worker
        self._update_thread = thread
        self._track_thread(thread, "_update_thread")
        thread.start()

    def _on_market_update_done(self, dialog, ok, copied, error):
        dialog.finish()
        self._update_worker = None
        self._update_cancel = None
        if error == "cancelled":
            self.notify("已取消市场更新", False)
            return
        if not ok:
            QtWidgets.QMessageBox.warning(
                self, "更新失败", "无法从 GitHub 下载更新：\n%s" % error)
            cmds.warning("插件市场更新失败：%s" % error)
            return
        self.notify("市场已更新：%s" % ", ".join(copied), True)
        self._set_update_available("")
        QtWidgets.QMessageBox.information(
            self, "更新完成",
            "市场代码已覆盖更新：\n%s\n\n关闭并重新打开市场后生效。" % "\n".join(copied))

    def _download_market_update(self, report=None):
        request = UrlRequest(
            UPDATE_ZIP_URL,
            headers={"User-Agent": "MayaNodeMarket/%s" % TOOL_VERSION})
        response = urlopen(request, timeout=30)
        chunks = []
        try:
            total = 0
            try:
                total = int(response.headers.get("Content-Length") or 0)
            except Exception:
                total = 0
            downloaded = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
                downloaded += len(chunk)
                percent = None
                if total > 0:
                    percent = 3 + 55.0 * downloaded / total
                detail = "已下载 %s" % online_market.human_bytes(downloaded)
                if total > 0:
                    detail += " / %s" % online_market.human_bytes(total)
                if report is not None:
                    report("download", "正在下载市场更新包...", percent, detail)
        finally:
            response.close()
        data = b"".join(chunks)
        if not data or len(data) < 512:
            raise IOError("GitHub 返回的更新包为空")

        if report is not None:
            report("verify", "正在校验更新包...", 65,
                   "更新包：%s" % online_market.human_bytes(len(data)))
        archive = zipfile.ZipFile(io.BytesIO(data))
        sources = {}
        try:
            for info in archive.infolist():
                name = os.path.basename(info.filename)
                if name in UPDATE_FILES:
                    sources[name] = archive.read(info.filename)
        finally:
            archive.close()

        missing = [name for name in (
            "custom_commands_window.py", "node_market.py", "online_market.py")
                   if name not in sources]
        if missing:
            raise IOError("更新包缺少文件：%s" % ", ".join(missing))

        backup = {}
        for name in sources:
            target = os.path.join(FILE_DIR, name)
            if os.path.isfile(target):
                backup[name] = io.open(target, "rb").read()

        if report is not None:
            report("backup", "正在备份本地市场代码...", 78,
                   "将覆盖 %d 个文件" % len(sources))
        written = []
        try:
            for name, content in sources.items():
                target = os.path.join(FILE_DIR, name)
                with io.open(target, "wb") as handle:
                    handle.write(content)
                written.append(name)
                if report is not None:
                    report("write", "正在覆盖市场代码...", 88,
                           "已写入 %s" % name)
        except Exception:
            for name, content in backup.items():
                try:
                    with io.open(os.path.join(FILE_DIR, name), "wb") as handle:
                        handle.write(content)
                except Exception:
                    pass
            raise
        if report is not None:
            report("done", "市场代码更新完成", 100,
                   "共更新 %d 个文件" % len(written))
        return sorted(written)

    def import_plugin_file(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "选择节点插件文件", self.nodes_dir, "Maya Python 插件 (*.py)")
        if not path:
            return
        try:
            targets = node_market.install_plugin_file(self.nodes_dir, path)
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "导入失败", str(exc))
            return
        self.notify("已导入 %d 个节点插件" % len(targets), True)
        self.refresh()
        self.switch_tab(0)

    def import_plugin_folder(self):
        path = QtWidgets.QFileDialog.getExistingDirectory(self, "选择插件文件夹", self.nodes_dir)
        if not path:
            return
        try:
            targets = node_market.install_plugin_folder(self.nodes_dir, path)
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "导入失败", str(exc))
            return
        self.notify("已导入 %d 个节点插件" % len(targets), True)
        self.refresh()
        self.switch_tab(0)

    def browse_nodes_dir(self):
        path = QtWidgets.QFileDialog.getExistingDirectory(self, "选择插件目录", self.nodes_dir)
        if path:
            self.path_edit.setText(path)

    def save_nodes_dir(self):
        path = self.path_edit.text().strip()
        if not path:
            return
        if not os.path.isdir(path):
            try:
                os.makedirs(path)
            except Exception as exc:
                QtWidgets.QMessageBox.warning(self, "目录不可用", str(exc))
                return
        self.nodes_dir = path
        data = load_settings()
        data["nodes_dir"] = path
        data["github_url"] = self.github_url
        save_settings(data)
        self.refresh()
        self.notify("插件目录已更新", True)

    # ------------------------------------------------------------------
    # 场景依赖检测
    # ------------------------------------------------------------------
    def register_scene_hook(self):
        if not self.scene_check or self.scene_hook_ids:
            return
        self.scene_hook_ids = scene_requirements.add_scene_callback(self.on_scene_opened)
        self.scene_save_id = scene_requirements.add_save_callback(self.on_before_save)

    def unregister_scene_hook(self):
        scene_requirements.remove_scene_callbacks(self.scene_hook_ids)
        self.scene_hook_ids = []
        if self.scene_save_id is not None:
            scene_requirements.remove_scene_callbacks([self.scene_save_id])
            self.scene_save_id = None

    def on_before_save(self, *args):
        """保存前把当前场景用到的节点插件写进 fileInfo。"""
        try:
            scene_requirements.save_requirements(self.plugins)
        except Exception as exc:
            cmds.warning("写入场景插件清单失败：%s" % exc)

    def on_scene_opened(self, *args):
        if self._scene_reopen_guard:
            return
        # 文件打开回调里不能直接弹窗：Maya 这时还在收尾，模态对话框
        # 会让它重入。这里先排进 Maya 的空闲队列，再确认场景没被切换。
        scene = scene_requirements.current_scene()

        def _deferred():
            if self._scene_reopen_guard:
                return
            if scene_requirements.current_scene() != scene:
                return
            QtCore.QTimer.singleShot(
                300, lambda: self.check_scene_requirements(auto=True))

        try:
            cmds.evalDeferred(_deferred, lowestPriority=True)
        except Exception:
            QtCore.QTimer.singleShot(600, lambda: self.check_scene_requirements(auto=True))

    def on_scene_check_toggled(self, checked):
        self.scene_check = bool(checked)
        data = load_settings()
        data["scene_check"] = self.scene_check
        save_settings(data)
        if self.scene_check:
            self.register_scene_hook()
        else:
            self.unregister_scene_hook()

    def on_env_skip_toggled(self, checked):
        """设置页「跳过可选依赖提示」开关。"""
        try:
            data = load_settings()
            data["skip_env_optional"] = bool(checked)
            save_settings(data)
        except Exception as exc:
            cmds.warning(u"保存设置失败：%s" % exc)

    def scene_catalog_entries(self):
        if self.online_entries:
            return self.online_entries
        cached, _ = online_market.load_catalog_cache(CATALOG_CACHE_PATH)
        if cached:
            return online_market.entries_from_catalog(cached)
        return []

    def check_scene_requirements(self, auto=True):
        if auto and not self.scene_check:
            return
        # 已经有模态对话框（例如正在安装）时不要叠加，隔一会儿再试，
        # 否则会形成嵌套模态，安装中途弹窗是崩溃的高发路径。
        if QtWidgets.QApplication.activeModalWidget() is not None:
            if auto:
                QtCore.QTimer.singleShot(
                    2000, lambda: self.check_scene_requirements(auto=True))
            return
        missing = scene_requirements.missing_plugins()
        requirement_ids = scene_requirements.requirement_node_ids()
        if not missing and not requirement_ids:
            if not auto:
                self.notify("当前文件没有缺失的节点插件", True)
            return

        entries = self.scene_catalog_entries()
        if not entries and not auto:
            try:
                entries = online_market.entries_from_catalog(online_market.fetch_catalog())
            except Exception as exc:
                self.notify("在线目录加载失败：%s" % exc, False)
                return

        matched, local, unmatched = scene_requirements.match_requirements(
            missing, entries, self.plugins, requirement_ids)
        # 已经装好、已经加载的不再提示
        matched = [entry for entry in matched if self._local_plugin_for(entry) is None]
        local = [plugin for plugin in local if not node_market.plugin_loaded(plugin.path)]
        if not matched and not local and not unmatched:
            if not auto:
                self.notify("场景需要的插件都已就绪", True)
            return

        scene_path = scene_requirements.current_scene()
        signature = (scene_path, tuple(sorted(missing)), tuple(sorted(requirement_ids)))
        if auto and signature in self._scene_prompted:
            return
        self._scene_prompted.add(signature)

        dialog = SceneRequirementsDialog(scene_path, matched, local, unmatched, self)
        if not exec_dialog(dialog):
            return
        if dialog.wants_load_local:
            for plugin in local:
                node_market.load_plugin_file(plugin.path)
        chosen = dialog.selected_entries()
        if chosen:
            self.install_scene_entries(chosen)
        elif dialog.wants_load_local and local:
            self.ask_reopen_scene()

    def install_scene_entries(self, entries):
        dialog = TaskProgressDialog(
            "安装场景所需插件", "共 %d 个插件" % len(entries), self)
        dialog.set_stage("准备安装...", 1, "")
        dialog.show()
        pump_events()

        failed = []
        for index, entry in enumerate(entries, 1):
            def report(stage, message, percent=None, detail="", i=index, e=entry):
                dialog.set_stage(
                    message, percent,
                    "%s（%d/%d）\n%s" % (e.title, i, len(entries), detail))
                pump_events()
                if stage != "done" and dialog.was_cancelled():
                    raise online_market.Cancelled()

            try:
                online_market.install_entry(entry, self.nodes_dir, report)
            except online_market.Cancelled:
                break
            except Exception as exc:
                failed.append("%s：%s" % (entry.title, exc))

        dialog.finish()
        self.refresh()
        if failed:
            cmds.warning("场景插件安装失败：\n" + "\n".join(failed))
            self.notify("有 %d 个插件安装失败" % len(failed), False)
        # 关键：装完立刻加载。否则重开文件时插件仍未加载，节点依旧 unknown。
        self._load_scene_plugins(entries)
        self.ask_reopen_scene()

    def _load_scene_plugins(self, entries):
        """把刚装好（或本地已有）的所需插件加载进 Maya，返回成功加载的数量。"""
        wanted = set(str(e.node_id_text).lower()
                     for e in entries if getattr(e, "node_id_text", ""))
        loaded = 0
        for plugin in self.plugins:
            if str(plugin.node_id_text).lower() not in wanted:
                continue
            if node_market.plugin_loaded(plugin.path):
                continue
            try:
                ok, _msg = node_market.load_plugin_file(plugin.path)
                if ok:
                    loaded += 1
            except Exception:
                continue
        return loaded

    def ask_reopen_scene(self):
        reply = QtWidgets.QMessageBox.question(
            self, "需要重新打开文件",
            "插件已经安装/加载，但 Maya 不会把已经变成 unknown 的节点自动恢复。\n"
            "现在重新打开当前文件？未保存的修改会丢失。",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.Yes)
        if reply == QtWidgets.QMessageBox.Yes:
            self.reopen_scene()

    def reopen_scene(self):
        path = scene_requirements.current_scene()
        if not path:
            self.notify("当前文件还没保存过，请手动重新打开", False)
            return
        self._scene_reopen_guard = True
        try:
            cmds.file(path, open=True, force=True)
        except Exception as exc:
            self.notify("重新打开失败：%s" % exc, False)
        finally:
            self._scene_reopen_guard = False

    def closeEvent(self, event):
        self.unregister_scene_hook()
        self._stop_threads()
        super().closeEvent(event)

    # ------------------------------------------------------------------
    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "discover_scroll"):
            # 直接重算列数，保证拖拽缩放时卡片实时重排；
            # 再用 singleShot(0) 兜底一次，处理布局尚未稳定的情况。
            self._update_columns()
            QtCore.QTimer.singleShot(0, self._update_columns)


# ---------------------------------------------------------------------------
# 启动环境检查对话框
# 列出缺失的依赖，支持一键自动安装（pip）和跳转下载链接手动安装。
# ---------------------------------------------------------------------------
class _InstallWorker(QtCore.QObject):
    finished = QtCore.Signal(bool, str)

    def __init__(self, pip_name):
        super(_InstallWorker, self).__init__()
        self._pip_name = pip_name

    def run(self):
        ok, out = pip_install_package(self._pip_name)
        self.finished.emit(ok, out)


class EnvironmentCheckDialog(QtWidgets.QDialog):
    """环境检查对话框：无边框、深色风格与 MarketWindow 保持一致。"""

    def __init__(self, missing, parent=None):
        super().__init__(parent)
        self.setObjectName("envDialog")
        self.setWindowTitle(u"节点插件市场 — 环境检查")
        self.setMinimumWidth(560)
        self.setMinimumHeight(360)
        self.resize(600, 440)
        # 无边框 + 置顶：避免原生浅色标题栏
        self.setWindowFlags(
            self.windowFlags() | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        self.setMouseTracking(True)
        self._dragging = False
        self._drag_pos = QtCore.QPoint()
        self._missing = list(missing)
        self._rows = {}
        self._install_threads = []
        self._build_ui()
        self.setStyleSheet(QSS)

    # ------------------------------------------------------------------
    # 无边框拖动
    # ------------------------------------------------------------------
    def _in_header(self, pos):
        if not hasattr(self, "_header_geom"):
            return False
        return self._header_geom.contains(pos)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton and self._in_header(event.pos()):
            self._dragging = True
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()
        else:
            super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._dragging and event.buttons() & Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()
        else:
            super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._dragging = False
        super().mouseReleaseEvent(event)

    def mouseDoubleClickEvent(self, event):
        # 双击标题栏也允许触发（与主窗口一致）
        if self._in_header(event.pos()):
            if self.isMaximized():
                self.showNormal()
            else:
                self.showMaximized()
            event.accept()
        else:
            super().mouseDoubleClickEvent(event)

    # ------------------------------------------------------------------
    # 界面
    # ------------------------------------------------------------------
    def _build_ui(self):
        outer = QtWidgets.QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # 顶部自定义标题栏
        header = QtWidgets.QFrame()
        header.setObjectName("envHeader")
        header.setFixedHeight(44)
        header_layout = QtWidgets.QHBoxLayout(header)
        header_layout.setContentsMargins(18, 0, 12, 0)
        header_layout.setSpacing(10)

        icon = QtWidgets.QLabel()
        icon.setFixedSize(18, 18)
        icon.setStyleSheet(
            "background:#4a86e8;border-radius:4px;color:white;"
            "font-weight:bold;font-size:11px;padding-left:5px;")
        icon.setText(u"!")
        header_layout.addWidget(icon, 0, Qt.AlignVCenter)

        title = QtWidgets.QLabel(u"环境检查")
        title.setObjectName("envTitle")
        header_layout.addWidget(title, 0, Qt.AlignVCenter)
        header_layout.addStretch(1)

        close_btn = QtWidgets.QPushButton(u"×")
        close_btn.setObjectName("winClose")
        close_btn.setFixedSize(30, 24)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setToolTip(u"取消")
        close_btn.clicked.connect(self.reject)
        header_layout.addWidget(close_btn, 0, Qt.AlignVCenter)

        outer.addWidget(header)
        self._header_geom = QtCore.QRect(0, 0, self.width(), header.height())

        # 内容区
        body = QtWidgets.QWidget()
        body_layout = QtWidgets.QVBoxLayout(body)
        body_layout.setContentsMargins(18, 14, 18, 14)
        body_layout.setSpacing(10)

        tip = QtWidgets.QLabel(
            u"检测到以下运行依赖缺失——点击「一键安装」可自动用当前 Maya 的 pip 安装；"
            u"也可点「下载」手动获取后自行安装。")
        tip.setObjectName("envTip")
        tip.setWordWrap(True)
        body_layout.addWidget(tip)

        self._list = QtWidgets.QWidget()
        list_layout = QtWidgets.QVBoxLayout(self._list)
        list_layout.setContentsMargins(0, 0, 0, 0)
        list_layout.setSpacing(8)

        for dep in self._missing:
            list_layout.addWidget(self._make_row(dep))
        list_layout.addStretch(1)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        scroll.setWidget(self._list)
        body_layout.addWidget(scroll, 1)

        # 忽略勾选（仅在没有必需依赖缺时才显得有意义）
        all_optional = all(not d["required"] for d in self._missing)
        self._skip_check = QtWidgets.QCheckBox(u"下次启动忽略可选依赖提示")
        self._skip_check.setObjectName("filterCheck")
        self._skip_check.setCursor(Qt.PointingHandCursor)
        self._skip_check.setEnabled(all_optional)
        self._skip_check.setChecked(
            bool(load_settings().get("skip_env_optional", False)) and all_optional)
        self._skip_check.setToolTip(
            u"勾选后，当缺失的全是可选依赖时，下次启动不再弹窗提示；"
            u"可在设置里随时重新开启。")
        body_layout.addWidget(self._skip_check)

        # 底部按钮
        btn_row = QtWidgets.QHBoxLayout()
        btn_row.addStretch(1)
        self._cancel_btn = QtWidgets.QPushButton(u"取消")
        self._cancel_btn.setObjectName("ghostButton")
        self._cancel_btn.clicked.connect(self.reject)
        self._continue_btn = QtWidgets.QPushButton(u"继续启动")
        self._continue_btn.setObjectName("primaryButton")
        self._continue_btn.clicked.connect(self._on_continue)
        btn_row.addWidget(self._cancel_btn)
        btn_row.addWidget(self._continue_btn)
        body_layout.addLayout(btn_row)

        outer.addWidget(body, 1)
        self._refresh_continue_state()

    def resizeEvent(self, event):
        # 让标题栏几何随窗口尺寸更新（拖动 hit-test 需要）
        super().resizeEvent(event)
        if hasattr(self, "_header_geom"):
            self._header_geom = QtCore.QRect(0, 0, self.width(), 44)

    def _make_row(self, dep):
        card = QtWidgets.QFrame()
        card.setObjectName("envRow")
        v = QtWidgets.QVBoxLayout(card)
        v.setContentsMargins(12, 10, 12, 10)
        v.setSpacing(6)

        # 第一行：名称 + 必需/可选标签
        header = QtWidgets.QHBoxLayout()
        name = QtWidgets.QLabel(dep["display"])
        name.setObjectName("envRowTitle")
        header.addWidget(name)
        tag = QtWidgets.QLabel((u"必需" if dep["required"] else u"可选"))
        tag.setObjectName("badge")
        tag.setStyleSheet(
            "background:rgba(232,17,35,0.14);color:#ffb7bf;"
            "border:1px solid rgba(232,17,35,0.35);border-radius:9px;"
            "padding:2px 9px;font-size:11px;" if dep["required"] else
            "background:rgba(91,157,255,0.14);color:#9cc4ff;"
            "border:1px solid rgba(91,157,255,0.35);border-radius:9px;"
            "padding:2px 9px;font-size:11px;")
        header.addWidget(tag)
        header.addStretch(1)
        v.addLayout(header)

        desc = QtWidgets.QLabel(dep.get("description", ""))
        desc.setObjectName("envRowDesc")
        desc.setWordWrap(True)
        v.addWidget(desc)

        # 按钮行
        btns = QtWidgets.QHBoxLayout()
        install_btn = QtWidgets.QPushButton(u"一键安装")
        install_btn.setObjectName("envInstall")
        install_btn.setCursor(Qt.PointingHandCursor)
        install_btn.clicked.connect(
            lambda _=False, d=dep, b=install_btn: self._install_one(d, b))
        dl_btn = QtWidgets.QPushButton(u"下载")
        dl_btn.setObjectName("envDl")
        dl_btn.setCursor(Qt.PointingHandCursor)
        dl_btn.clicked.connect(lambda _=False, d=dep: self._open_download(d))
        status = QtWidgets.QLabel(u"")
        status.setObjectName("envRowStatus")
        status.setStyleSheet("color:#9aa1ad;")
        btns.addWidget(install_btn)
        btns.addWidget(dl_btn)
        btns.addStretch(1)
        btns.addWidget(status)
        v.addLayout(btns)

        self._rows[dep["import_name"]] = {
            "status": status, "install_btn": install_btn, "dep": dep}
        return card

    def _open_download(self, dep):
        url = dep.get("download_url")
        if url:
            QtGui.QDesktopServices.openUrl(QtCore.QUrl(url))

    def _install_one(self, dep, install_btn):
        install_btn.setEnabled(False)
        install_btn.setText(u"安装中…")
        row = self._rows[dep["import_name"]]
        row["status"].setText(u"正在通过 pip 安装 %s…" % dep["pip_name"])
        row["status"].setStyleSheet("color:#cfe0ff;")

        thread = keep_thread(QtCore.QThread())
        worker = _InstallWorker(dep["pip_name"])
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(
            lambda ok, out, d=dep, w=worker, t=thread:
                self._on_install_done(d, ok, out, w, t))
        self._install_threads.append(thread)
        thread.start()

    def _on_install_done(self, dep, ok, out, worker, thread):
        row = self._rows[dep["import_name"]]
        install_btn = row["install_btn"]
        if ok:
            install_btn.setText(u"已安装")
            install_btn.setEnabled(False)
            row["status"].setText(u"%s 安装成功。" % dep["pip_name"])
            row["status"].setStyleSheet("color:#4caf50;")
            self._missing = [
                d for d in self._missing if d["import_name"] != dep["import_name"]]
        else:
            install_btn.setText(u"一键安装")
            install_btn.setEnabled(True)
            row["status"].setText(u"安装失败，请点「下载」手动安装。")
            row["status"].setStyleSheet("color:#e81123;")
            cmds.warning(u"安装 %s 失败：%s" % (dep["pip_name"], out))
        try:
            worker.deleteLater()
        except Exception:
            pass
        thread.quit()
        thread.wait()
        if thread in self._install_threads:
            self._install_threads.remove(thread)
        self._refresh_continue_state()

    def _wait_for_installs(self):
        # 关闭对话框前等待仍在运行的 pip 安装线程结束，
        # 否则对话框销毁会连带销毁其子 QThread，导致
        # “QThread: Destroyed while thread is still running” 崩溃。
        for thread in list(self._install_threads):
            try:
                if thread.isRunning():
                    thread.quit()
                    thread.wait()
            except Exception:
                pass
        self._install_threads = []

    def accept(self):
        self._wait_for_installs()
        super().accept()

    def reject(self):
        self._wait_for_installs()
        super().reject()

    def closeEvent(self, event):
        self._wait_for_installs()
        super().closeEvent(event)

    def _refresh_continue_state(self):
        has_required = any(d["required"] for d in self._missing)
        self._continue_btn.setEnabled(not has_required)
        if has_required:
            self._continue_btn.setToolTip(u"仍有必需依赖未安装，无法继续启动。")
        else:
            self._continue_btn.setToolTip(u"")

    def _on_continue(self):
        # 把忽略勾选写入用户设置，下次启动跳过。
        try:
            data = load_settings()
            data["skip_env_optional"] = bool(self._skip_check.isChecked())
            save_settings(data)
        except Exception:
            pass
        self.accept()


# ---------------------------------------------------------------------------
# 入口（沿用旧写法：window.show()）
# ---------------------------------------------------------------------------
def find_existing_window():
    for widget in QtWidgets.QApplication.topLevelWidgets():
        try:
            if widget.objectName() == "zkmNodeMarketWindow":
                return widget
        except RuntimeError:
            continue
    return None


WORKSPACE_CONTROL = "zkmNodeMarketWindowWorkspaceControl"


class WindowHandle(object):
    def __init__(self):
        self._window = None

    def show(self):
        # 先看有没有已经建好的窗口：有就直接显示，不再做环境检查、
        # 不再重建界面。这样重复点击工具架按钮是「秒开」，也不会闪。
        # 注意：不要用 sendPostedEvents(None, DeferredDelete) 清理旧窗口，
        # 那会冲刷整个应用的延迟删除队列，把 Maya 自身 UI 提前删掉导致段错误。
        window = find_existing_window()
        if window is not None:
            window.show()
            self._window = window
            window.raise_()
            window.activateWindow()
            return window

        # 只有真正要新建窗口时才做环境检查；缺失依赖会弹出对话框，
        # 必需依赖未安装时用户无法继续，可选依赖仅提示不阻塞。
        # 用户勾选过「忽略可选依赖」后，如果当前缺失全是可选的，
        # 直接跳过对话框进入主窗口。
        missing = check_environment()
        if missing:
            all_optional = all(not d["required"] for d in missing)
            skip_env = bool(load_settings().get("skip_env_optional", False))
            if not (all_optional and skip_env):
                dlg = EnvironmentCheckDialog(missing)
                if dlg.exec_() != QtWidgets.QDialog.Accepted:
                    return None
        # 清掉旧版停靠窗口留下的 workspaceControl，避免重名
        try:
            if cmds.workspaceControl(WORKSPACE_CONTROL, query=True, exists=True):
                cmds.deleteUI(WORKSPACE_CONTROL)
        except Exception:
            pass
        window = MarketWindow()
        window.show()
        self._window = window
        window.raise_()
        window.activateWindow()
        return window


window = WindowHandle()

# 兼容旧代码里的 Window 名字
Window = MarketWindow

if __name__ == "__main__":
    window.show()
