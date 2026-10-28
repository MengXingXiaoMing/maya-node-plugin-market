# -*- coding: utf-8 -*-
"""节点插件市场（Maya）

把原来的「自定义命令」文件树改成以 Maya 节点为单位的插件市场：
- 默认扫描工具目录下的 nodes/；
- 每个插件文件夹以节点注册序号命名；
- 识别到节点注册就生成一张插件卡片和启动按钮；
- 卡片悬停显示作者写在 NODE_INFO 里的详情。

入口保持 window.show() 不变，旧的架子按钮/菜单命令仍然可用。
"""

from __future__ import absolute_import, unicode_literals

import importlib
import inspect
import io
import json
import os
import sys
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
importlib.reload(node_market)

TOOL_VERSION = "2.2"
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
    "install.py",
    "open_window.py",
    "custom_commands_lcon.png",
)
SETTINGS_PATH = os.path.join(FILE_DIR, "market_settings.json")
STATE_PATH = os.path.join(FILE_DIR, "market_state.json")
CACHE_PATH = os.path.join(FILE_DIR, "market_cache.json")
ICON_PATH = os.path.join(FILE_DIR, "custom_commands_lcon.png")
DEFAULT_NODES_DIR = os.path.join(FILE_DIR, "nodes")

COLORS = ["#4a86e8", "#8a6cf0", "#2fa79a", "#d08a3e", "#c95f7c", "#5a8fb8"]

QSS = """
QMainWindow, #marketRoot { background: #1f2126; }
#header { background: #24262c; border-bottom: 1px solid #34373f; }
#appTitle { color: #f2f4f8; font-size: 23px; font-weight: 700; }
#appSubtitle { color: #9aa1ad; font-size: 12px; }
#appAuthor { color: #8f96a2; font-size: 11px; }
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
QLineEdit#pathEdit {
    background: #1b1d22; border: 1px solid #3a3d46; border-radius: 8px;
    padding: 6px 10px; color: #dfe3ea; font-size: 12px;
}
QLineEdit#pathEdit:focus { border-color: #5b9dff; }
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
"""


# ---------------------------------------------------------------------------
# 设置
# ---------------------------------------------------------------------------
def load_settings():
    default = {"nodes_dir": DEFAULT_NODES_DIR, "github_url": MARKET_GITHUB_URL}
    try:
        with io.open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            default.update({k: v for k, v in data.items() if v})
    except Exception:
        pass
    if not default.get("nodes_dir") or not os.path.isdir(default.get("nodes_dir")):
        default["nodes_dir"] = DEFAULT_NODES_DIR
    return default


def save_settings(data):
    try:
        with io.open(SETTINGS_PATH, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2))
        return True
    except Exception as exc:
        cmds.warning("保存市场设置失败：%s" % exc)
        return False


def load_state():
    default = {"favorites": []}
    try:
        with io.open(STATE_PATH, "r", encoding="utf-8") as handle:
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
        with io.open(STATE_PATH, "w", encoding="utf-8") as handle:
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
class PluginCard(QtWidgets.QFrame):
    def __init__(self, plugin, parent, on_primary, on_detail, on_menu,
                 on_favorite=None, is_favorite=False):
        super(PluginCard, self).__init__(parent)
        self.plugin = plugin
        self._on_primary = on_primary
        self._on_detail = on_detail
        self._on_menu = on_menu
        self._on_favorite = on_favorite
        self._favorite = bool(is_favorite)
        self._hovered = False

        self.setObjectName("pluginCard")
        self.setFixedWidth(320)
        self.setMinimumHeight(190)
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
        super(PluginCard, self).mouseDoubleClickEvent(event)

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
        if node_market.plugin_loaded(self.plugin.path):
            menu.addSeparator()
            menu.addAction("卸载插件", lambda: self._on_menu("unload", self.plugin))
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
# 详情弹窗
# ---------------------------------------------------------------------------
class DetailDialog(QtWidgets.QDialog):
    def __init__(self, plugin, parent, on_primary):
        super(DetailDialog, self).__init__(parent)
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


# ---------------------------------------------------------------------------
# 主窗口
# ---------------------------------------------------------------------------
class MarketWindow(MayaQWidgetDockableMixin, QtWidgets.QMainWindow):
    def __init__(self):
        super(MarketWindow, self).__init__()
        self.setObjectName("zkmNodeMarketWindow")
        self.setWindowTitle("节点插件市场")
        if os.path.isfile(ICON_PATH):
            self.setWindowIcon(QtGui.QIcon(ICON_PATH))
        self.resize(1080, 700)
        self.setMinimumSize(720, 520)

        settings = load_settings()
        self.nodes_dir = settings.get("nodes_dir") or DEFAULT_NODES_DIR
        self.github_url = settings.get("github_url") or MARKET_GITHUB_URL
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
        self.active_tag = None
        self.scan_folders = 0
        self.scan_files = 0
        self.scan_cache_hits = 0
        self.scan_parsed_files = 0
        self._columns = 3

        self._build_ui()
        self.refresh()
        self.switch_tab(0)

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
        for index, label in enumerate(("发现", "收藏", "已加载", "设置")):
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

        # 标签栏：识别到的 NODE_INFO.tags 自动加入这里
        self.tag_buttons = []
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
        header_layout.addWidget(self.tag_bar)
        outer.addWidget(header)

        # 内容
        self.stack = QtWidgets.QStackedWidget()
        outer.addWidget(self.stack, 1)

        self.discover_page = self._build_discover_page()
        self.favorites_page = self._build_favorites_page()
        self.loaded_page = self._build_loaded_page()
        self.settings_page = self._build_settings_page()
        self.stack.addWidget(self.discover_page)
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
            "收藏保存在 market_state.json；节点解析结果缓存在 market_cache.json，"
            "文件改动或版本更新后会自动重载。"
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

        self.build_tag_bar()
        self.build_cards()
        self.build_favorites()
        self.build_loaded()
        self.update_settings()
        self.update_status()
        self.apply_filter(self.search_box.text())

    def hard_refresh(self):
        self.refresh(hard=True)
        self.notify("已清除 JSON 缓存，重新识别到 %d 个节点" % len(self.plugins), True)

    def build_tag_bar(self):
        while self.tag_layout.count():
            item = self.tag_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.tag_buttons = []

        counts = {}
        for plugin in self.plugins:
            for tag in set(plugin.tags):
                counts[tag] = counts.get(tag, 0) + 1
        if self.active_tag and self.active_tag not in counts:
            self.active_tag = None

        if not counts:
            self.tag_bar.setVisible(False)
            return

        def add_chip(label, tag, count):
            button = QtWidgets.QPushButton(label)
            button.setObjectName("tagChip")
            button.setCheckable(True)
            button.setChecked(tag == self.active_tag)
            button.setCursor(Qt.PointingHandCursor)
            button.setProperty("tagValue", tag if tag is not None else "")
            if tag is None:
                button.setToolTip("显示全部标签")
            else:
                button.setToolTip("%s：%d 个插件" % (tag, count))
            button.clicked.connect(lambda checked=False, t=tag: self.set_tag(t))
            self.tag_layout.addWidget(button)
            self.tag_buttons.append(button)

        add_chip("全部", None, len(self.plugins))
        for tag in sorted(counts, key=lambda item: (-counts[item], item)):
            add_chip(tag, tag, counts[tag])
        self.tag_host.adjustSize()
        self.tag_bar.setVisible(self.stack.currentIndex() in (0, 1))

    def set_tag(self, tag):
        self.active_tag = tag
        for button in self.tag_buttons:
            value = button.property("tagValue") or ""
            button.setChecked((value or None) == tag)
        self.apply_filter(self.search_box.text())

    def build_cards(self):
        while self.grid.count():
            item = self.grid.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.cards = []

        for plugin in self.plugins:
            card = PluginCard(plugin, self.grid_host, self.run_plugin,
                              self.show_detail, self.card_menu_action,
                              self.toggle_favorite, self.is_favorite(plugin))
            self.cards.append(card)
            self.grid.addWidget(card)

        self.empty_card.setVisible(not bool(self.plugins))
        self.empty_path.setText(self.nodes_dir)
        self.grid_host.setVisible(bool(self.plugins))
        self._update_columns(force=True)

    def build_favorites(self):
        while self.favorites_grid.count():
            item = self.favorites_grid.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
        self.favorite_cards = []

        favorite_plugins = [plugin for plugin in self.plugins if self.is_favorite(plugin)]
        for plugin in favorite_plugins:
            card = PluginCard(plugin, self.favorites_grid_host, self.run_plugin,
                              self.show_detail, self.card_menu_action,
                              self.toggle_favorite, True)
            self.favorite_cards.append(card)
            self.favorites_grid.addWidget(card)

        self.favorites_empty.setVisible(not bool(favorite_plugins))
        self.favorites_grid_host.setVisible(bool(favorite_plugins))
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
        for card in list(self.cards) + list(self.favorite_cards):
            if card.plugin.node_id_text == key:
                card.set_favorite(key in self.favorites)
        self.build_favorites()
        self.apply_filter(self.search_box.text())
        self.update_status()
        self.notify("%s：%s" % (plugin.title, message), True)

    def _update_columns(self, force=False):
        try:
            viewport = self.discover_scroll.viewport().width()
        except Exception:
            viewport = 0
        if viewport <= 0:
            viewport = self.width() - 44
        columns = max(1, min(4, int((viewport - 44 + 14) / (320 + 14))))
        if force or columns != self._columns:
            self._columns = columns
            self.reflow()
            self._reflow_favorites()

    def reflow(self):
        while self.grid.count():
            self.grid.takeAt(0)
        visible = [card for card in self.cards if not card.isHidden()]
        for index, card in enumerate(visible):
            row = index // self._columns
            column = index % self._columns
            self.grid.addWidget(card, row, column, Qt.AlignTop | Qt.AlignLeft)
        for column in range(4):
            self.grid.setColumnStretch(column, 0)
        self.grid.setColumnStretch(self._columns, 1)

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
        for column in range(4):
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
            if match and self.active_tag and self.active_tag not in plugin.tags:
                match = False
            card.setVisible(match)
            if match:
                visible_count += 1
        no_result.setVisible(bool(cards) and visible_count == 0)

    def apply_filter(self, text):
        text = (text or "").strip().lower()
        index = self.stack.currentIndex()
        if index == 0:
            self._filter_cards(self.cards, text, self.no_result)
            self.reflow()
        elif index == 1:
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
        self.path_edit.setText(self.nodes_dir)
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
        self.tag_bar.setVisible(index in (0, 1) and bool(self.tag_buttons))
        if index == 1:
            self.build_favorites()
        if index == 2:
            self.build_loaded()
        if index == 3:
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

    def card_menu_action(self, action, plugin=None):
        if action == "refresh":
            self.refresh()
        elif action == "unload" and plugin is not None:
            self.unload_plugin(plugin)

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

        progress = QtWidgets.QProgressDialog(
            "正在从 GitHub 下载最新版...", "", 0, 0, self)
        progress.setWindowTitle("市场更新")
        progress.setWindowModality(Qt.WindowModal)
        progress.setCancelButton(None)
        progress.setMinimumDuration(0)
        progress.show()
        QtWidgets.QApplication.processEvents()

        try:
            copied = self._download_market_update()
        except Exception as exc:
            progress.close()
            QtWidgets.QMessageBox.warning(
                self, "更新失败", "无法从 GitHub 下载更新：\n%s" % exc)
            cmds.warning("插件市场更新失败：%s" % exc)
            return
        progress.close()

        self.notify("市场已更新：%s" % ", ".join(copied), True)
        QtWidgets.QMessageBox.information(
            self, "更新完成",
            "市场代码已覆盖更新：\n%s\n\n关闭并重新打开市场后生效。" % "\n".join(copied))

    def _download_market_update(self):
        request = UrlRequest(
            UPDATE_ZIP_URL,
            headers={"User-Agent": "MayaNodeMarket/%s" % TOOL_VERSION})
        response = urlopen(request, timeout=30)
        try:
            data = response.read()
        finally:
            response.close()
        if not data or len(data) < 512:
            raise IOError("GitHub 返回的更新包为空")

        archive = zipfile.ZipFile(io.BytesIO(data))
        sources = {}
        try:
            for info in archive.infolist():
                name = os.path.basename(info.filename)
                if name in UPDATE_FILES:
                    sources[name] = archive.read(info.filename)
        finally:
            archive.close()

        missing = [name for name in ("custom_commands_window.py", "node_market.py")
                   if name not in sources]
        if missing:
            raise IOError("更新包缺少文件：%s" % ", ".join(missing))

        backup = {}
        for name in sources:
            target = os.path.join(FILE_DIR, name)
            if os.path.isfile(target):
                backup[name] = io.open(target, "rb").read()

        written = []
        try:
            for name, content in sources.items():
                target = os.path.join(FILE_DIR, name)
                with io.open(target, "wb") as handle:
                    handle.write(content)
                written.append(name)
        except Exception:
            for name, content in backup.items():
                try:
                    with io.open(os.path.join(FILE_DIR, name), "wb") as handle:
                        handle.write(content)
                except Exception:
                    pass
            raise
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
    def resizeEvent(self, event):
        super(MarketWindow, self).resizeEvent(event)
        if hasattr(self, "discover_scroll"):
            QtCore.QTimer.singleShot(0, self._update_columns)


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
        # 先处理掉待删除的旧窗口，避免复用一个马上会被销毁的实例
        try:
            QtCore.QCoreApplication.sendPostedEvents(None, QtCore.QEvent.DeferredDelete)
        except Exception:
            pass
        window = find_existing_window()
        if window is None:
            # 清掉旧版停靠窗口留下的 workspaceControl，避免重名
            try:
                if cmds.workspaceControl(WORKSPACE_CONTROL, query=True, exists=True):
                    cmds.deleteUI(WORKSPACE_CONTROL)
            except Exception:
                pass
            window = MarketWindow()
            window.show()
        else:
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
