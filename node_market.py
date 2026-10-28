# -*- coding: utf-8 -*-
"""节点插件市场的扫描与运行核心。

约定：
- 插件根目录下**只识别节点**，不把文件夹本身当成插件；
- 每个节点插件放在以「节点注册序号（MTypeId）」命名的文件夹里；
- 文件夹内的 .py 插件文件通过 Maya 的 registerNode 注册节点；
- 作者可在插件文件里写 NODE_INFO 字典，内容就是市场卡片悬停时显示的详情。

NODE_INFO 示例（写在插件文件顶部即可）::

    NODE_INFO = {
        "name": "魔方绑定",
        "description": "程序化生成可自定义尺寸的魔方……",
        "author": "KangmingZhan",
        "version": "2.0.0",
        "node": "rubikCubeNode",
        "node_id": "0x00141488",
        "run": "cmds.rubikCube()",
        "tags": ["绑定", "程序化"],
        "icon": "icon.png",
        "github": "https://github.com/...",
    }

没有 NODE_INFO 时，会自动从模块文档字符串、MFnPlugin 的
vendor/version、registerNode/registerCommand 的参数里推导。
"""

from __future__ import absolute_import, unicode_literals

import ast
import io
import json
import os
import re
import shutil
import sys

import maya.cmds as cmds
import maya.mel as mel

MAYA_NODE_ID_URL = "https://adn.autodesk.io/maya"
DEFAULT_GITHUB_URL = "https://github.com/MengXingXiaoMing"
CACHE_VERSION = 1

META_NAMES = ("NODE_INFO", "NODE_META", "PLUGIN_INFO", "__NODE_INFO__", "__NODE_META__")
FOLDER_ID_RE = re.compile(r"^(0[xX][0-9a-fA-F]{1,8}|[0-9]{1,10})$")

try:
    STRING_TYPES = (basestring,)  # noqa: F821  (Python 2)
    INT_TYPES = (int, long)  # noqa: F821  (Python 2)
except NameError:
    STRING_TYPES = (str,)
    INT_TYPES = (int,)


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def read_text(path):
    """按常见编码读取源码，Maya 的老插件很多是 gbk。"""
    for encoding in ("utf-8-sig", "utf-8", "gbk", "latin-1"):
        try:
            with io.open(path, "r", encoding=encoding) as handle:
                return handle.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
        except IOError:
            return ""
    return ""


def normalize_node_id(value):
    """把 0x00141488 / 0x141488 / 1315976 统一成 int。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.lower().startswith("0x"):
            return int(text, 16)
        if text.isdigit():
            return int(text, 10)
    except ValueError:
        return None
    return None


def node_id_hex(value):
    if value is None:
        return ""
    return "0x%08X" % value


def _unique(values):
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _const(node):
    """取 ast 常量值（兼容 Python 2/3 的 ast 结构）。"""
    if node is None:
        return None
    if isinstance(node, getattr(ast, "Constant", ())):
        return node.value
    if isinstance(node, getattr(ast, "Str", ())):
        return node.s
    if isinstance(node, getattr(ast, "Num", ())):
        return node.n
    return None


def _call_name(node):
    if not isinstance(node, ast.Call):
        return ""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def to_text(value):
    if value is None:
        return ""
    if sys.version_info[0] >= 3 and isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, STRING_TYPES):
        return value
    return str(value)


def _humanize(name):
    """rubikCubeNode -> Rubik Cube；尽量保持可读。"""
    if not name:
        return ""
    cleaned = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    cleaned = cleaned.replace("_", " ").strip()
    if cleaned.lower().endswith(" node"):
        cleaned = cleaned[:-5]
    return cleaned[:1].upper() + cleaned[1:] if cleaned else name


def shorten(text, limit=86):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _int_value(node, names=None):
    """解析整数常量或简单算式，例如 0x00141480 + 6。"""
    if node is None:
        return None
    value = _const(node)
    if isinstance(value, INT_TYPES):
        return int(value)
    if isinstance(node, ast.UnaryOp):
        operand = _int_value(node.operand, names)
        if operand is None:
            return None
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
        return None
    if isinstance(node, ast.BinOp):
        left = _int_value(node.left, names)
        right = _int_value(node.right, names)
        if left is None or right is None:
            return None
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.FloorDiv) and right:
            return left // right
        if isinstance(node.op, ast.Mod) and right:
            return left % right
        return None
    if isinstance(node, ast.Name) and names:
        return names.get(node.id)
    return None


def _mtype_id_in(node, names=None):
    """递归找出 MTypeId(0x...) 里的数字。"""
    if node is None:
        return None
    if _call_name(node) == "MTypeId" and getattr(node, "args", None):
        return normalize_node_id(_int_value(node.args[0], names))
    for child in ast.iter_child_nodes(node):
        found = _mtype_id_in(child, names)
        if found is not None:
            return found
    return None


def parse_folder_id(folder_name):
    """文件夹名必须就是节点注册序号。"""
    if not FOLDER_ID_RE.match(folder_name or ""):
        return None
    return normalize_node_id(folder_name)


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------
class NodePlugin(object):
    def __init__(self):
        self.path = ""
        self.folder = ""
        self.folder_id = None
        self.title = ""
        self.description = ""
        self.author = ""
        self.version = ""
        self.node_name = ""
        self.node_id = None
        self.node_names = []
        self.commands = []
        self.tags = []
        self.run = ""
        self.icon = ""
        self.github = ""
        self.plugin_name = ""

    @property
    def node_id_text(self):
        return node_id_hex(self.node_id or self.folder_id)

    @property
    def key(self):
        return "%s|%s" % (self.node_id_text, self.node_name)

    def search_text(self):
        return " ".join([
            self.title, self.description, self.author, self.node_name,
            self.node_id_text, " ".join(self.tags), " ".join(self.commands),
        ]).lower()

    def is_loaded(self):
        return plugin_loaded(self.path)

    def is_runnable(self):
        return bool(self.run or self.commands or self.node_name)

    def to_dict(self):
        fields = (
            "path", "folder", "folder_id", "title", "description", "author", "version",
            "node_name", "node_id", "node_names", "commands", "tags", "run", "icon",
            "github", "plugin_name",
        )
        data = {}
        for name in fields:
            value = getattr(self, name)
            data[name] = list(value) if isinstance(value, list) else value
        return data

    @classmethod
    def from_dict(cls, data):
        item = cls()
        for name, value in (data or {}).items():
            if hasattr(item, name):
                setattr(item, name, value)
        if not isinstance(item.node_names, list):
            item.node_names = []
        if not isinstance(item.commands, list):
            item.commands = []
        if not isinstance(item.tags, list):
            item.tags = []
        return item


# ---------------------------------------------------------------------------
# 解析缓存
# ---------------------------------------------------------------------------
def load_parse_cache(cache_path):
    empty = {"version": CACHE_VERSION, "files": {}}
    if not cache_path or not os.path.isfile(cache_path):
        return empty
    try:
        with io.open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return empty
        if data.get("version") != CACHE_VERSION:
            return empty
        files = data.get("files")
        if not isinstance(files, dict):
            return empty
        return {"version": CACHE_VERSION, "files": files}
    except Exception:
        return empty


def save_parse_cache(cache_path, files):
    if not cache_path:
        return
    try:
        with io.open(cache_path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(
                {"version": CACHE_VERSION, "files": files},
                ensure_ascii=False, separators=(",", ":")))
    except Exception as exc:
        sys.stderr.write("[node_market] 缓存写入失败: %r\n" % (exc,))


def clear_parse_cache(cache_path):
    if not cache_path:
        return
    try:
        if os.path.isfile(cache_path):
            os.remove(cache_path)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 解析插件文件（不执行代码）
# ---------------------------------------------------------------------------
def parse_plugin_file(path, folder_id=None):
    """解析一个 .py 节点插件，返回 NodePlugin 列表。"""
    text = read_text(path)
    if not text:
        return []

    try:
        tree = ast.parse(text)
    except SyntaxError:
        tree = None

    meta = {}
    vendor = ""
    version = ""
    node_names = []
    node_ids = []
    commands = []
    doc = ""

    if tree is not None:
        doc = ast.get_docstring(tree) or ""
        int_constants = {}
        for stmt in getattr(tree, "body", []):
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name):
                        if target.id in META_NAMES:
                            value = None
                            try:
                                value = ast.literal_eval(stmt.value)
                            except Exception:
                                value = _const(stmt.value)
                            if isinstance(value, dict):
                                meta = value
                        int_value = _int_value(stmt.value, int_constants)
                        if int_value is not None:
                            int_constants[target.id] = int_value
        # 类里的整数常量（有些插件写成 BASE + 6）
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for stmt in node.body:
                if isinstance(stmt, ast.Assign):
                    for target in stmt.targets:
                        if isinstance(target, ast.Name):
                            int_value = _int_value(stmt.value, int_constants)
                            if int_value is not None:
                                int_constants[target.id] = int_value
        for node in ast.walk(tree):
            name = _call_name(node)
            if name == "MFnPlugin":
                args = getattr(node, "args", [])
                if len(args) >= 2:
                    vendor = _const(args[1]) or vendor
                if len(args) >= 3:
                    version = _const(args[2]) or version
            elif name == "registerNode":
                args = getattr(node, "args", [])
                if args:
                    node_name = _const(args[0])
                    if node_name:
                        node_names.append(node_name)
                    node_id = _mtype_id_in(args[1], int_constants) if len(args) > 1 else None
                    if node_id is not None:
                        node_ids.append(node_id)
            elif name == "registerCommand":
                args = getattr(node, "args", [])
                if args:
                    command = _const(args[0])
                    if command:
                        commands.append(command)
            elif name == "MTypeId":
                args = getattr(node, "args", [])
                if args:
                    node_id = _int_value(args[0], int_constants)
                    if node_id is not None and node_id not in node_ids:
                        node_ids.append(node_id)
        # 类属性 kNodeName / kNodeId
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for stmt in node.body:
                    if not isinstance(stmt, ast.Assign):
                        continue
                    for target in stmt.targets:
                        if not isinstance(target, ast.Name):
                            continue
                        if target.id in ("kNodeName", "kCommandName"):
                            value = _const(stmt.value)
                            if value:
                                if target.id == "kNodeName":
                                    node_names.insert(0, value)
                                else:
                                    commands.append(value)
                        elif target.id == "kNodeId":
                            node_id = _mtype_id_in(stmt.value, int_constants)
                            if node_id is not None:
                                node_ids.insert(0, node_id)

    # 去重但保持顺序
    node_names = _unique(node_names)
    node_ids = _unique(node_ids)
    commands = _unique(commands)

    if not node_names and not node_ids:
        return []

    meta_node = meta.get("node") or meta.get("node_name")
    meta_id = normalize_node_id(meta.get("node_id") or meta.get("nodeId") or meta.get("id"))
    if meta_node and meta_node not in node_names:
        node_names.insert(0, meta_node)
    if meta_id is not None and meta_id not in node_ids:
        node_ids.insert(0, meta_id)

    if not node_ids:
        return []

    # 配对：一个文件注册多个节点时，尽量让节点名与序号一一对应。
    pairs = []
    if len(node_names) == len(node_ids):
        pairs = list(zip(node_names, node_ids))
    else:
        for index, node_id in enumerate(node_ids):
            node_name = node_names[index] if index < len(node_names) else ""
            pairs.append((node_name, node_id))
        for node_name in node_names[len(node_ids):]:
            pairs.append((node_name, node_ids[0]))

    base = os.path.basename(path)
    stem = os.path.splitext(base)[0]
    plugins = []
    for node_name, node_id in pairs:
        if folder_id is not None and normalize_node_id(folder_id) != node_id:
            continue
        item = NodePlugin()
        item.path = path
        item.folder = os.path.dirname(path)
        item.folder_id = folder_id
        item.node_name = node_name or ""
        item.node_id = node_id
        item.node_names = [n for n in node_names if n] or ([node_name] if node_name else [])
        item.commands = list(commands)
        item.author = to_text(meta.get("author") or vendor).strip()
        item.version = to_text(meta.get("version") or version).strip()
        item.title = to_text(meta.get("name") or meta.get("title")).strip() \
            or _humanize(node_name) or stem
        item.description = to_text(meta.get("description") or meta.get("detail")).strip() \
            or (doc or "").strip()
        item.run = to_text(meta.get("run")).strip()
        item.github = to_text(meta.get("github") or meta.get("homepage")).strip()
        tags = meta.get("tags") or []
        if isinstance(tags, STRING_TYPES):
            tags = [tags]
        item.tags = [to_text(tag) for tag in tags if to_text(tag).strip()]
        icon = to_text(meta.get("icon")).strip()
        if icon:
            icon_path = icon
            if not os.path.isabs(icon_path):
                icon_path = os.path.join(item.folder, icon_path)
            if os.path.isfile(icon_path):
                item.icon = icon_path
        item.plugin_name = stem
        plugins.append(item)
    return plugins


# ---------------------------------------------------------------------------
# 扫描 / 安装
# ---------------------------------------------------------------------------
class ScanResult(object):
    def __init__(self):
        self.plugins = []
        self.warnings = []
        self.folders = 0
        self.node_files = 0
        self.cache_hits = 0
        self.parsed_files = 0


def scan_market(root, cache_path=None, use_cache=True, clear_cache=False):
    """扫描市场根目录。只把「节点」作为条目，不把文件夹作为条目。

    cache_path 不为空时，按「文件 mtime + size」缓存解析结果；文件没变就
    直接读缓存，文件改动（含版本更新）才重新解析。
    """
    result = ScanResult()
    if not root or not os.path.isdir(root):
        result.warnings.append("插件目录不存在：%s" % root)
        return result

    if clear_cache:
        clear_parse_cache(cache_path)
    cache = {"version": CACHE_VERSION, "files": {}}
    if use_cache and not clear_cache:
        cache = load_parse_cache(cache_path)
    cached_files = cache.get("files", {})
    new_files = {}
    seen_ids = {}

    for folder_name in sorted(os.listdir(root)):
        if folder_name.startswith("."):
            continue
        folder_path = os.path.join(root, folder_name)
        if not os.path.isdir(folder_path):
            continue
        result.folders += 1
        folder_id = parse_folder_id(folder_name)
        if folder_id is None:
            result.warnings.append(
                "跳过文件夹「%s」：文件夹名必须是节点的注册序号（如 0x00141488）" % folder_name)
            continue

        for file_name in sorted(os.listdir(folder_path)):
            if not file_name.lower().endswith(".py") or file_name.startswith("_"):
                continue
            file_path = os.path.join(folder_path, file_name)
            if not os.path.isfile(file_path):
                continue
            result.node_files += 1
            file_key = os.path.abspath(file_path)
            try:
                stat = os.stat(file_path)
            except OSError:
                stat = None

            plugins = None
            if stat is not None and use_cache and not clear_cache:
                entry = cached_files.get(file_key)
                if isinstance(entry, dict) \
                        and entry.get("mtime") == stat.st_mtime \
                        and entry.get("size") == stat.st_size:
                    cached_items = entry.get("plugins")
                    if not isinstance(cached_items, list):
                        cached_items = []
                    cached_plugins = [NodePlugin.from_dict(x) for x in cached_items]
                    if all(item.node_id == folder_id for item in cached_plugins):
                        plugins = cached_plugins
                        result.cache_hits += 1

            if plugins is None:
                try:
                    plugins = parse_plugin_file(file_path, folder_id)
                except Exception as exc:
                    result.warnings.append("解析失败「%s」：%s" % (file_name, exc))
                    continue
                result.parsed_files += 1

            if stat is not None:
                new_files[file_key] = {
                    "mtime": stat.st_mtime,
                    "size": stat.st_size,
                    "plugins": [item.to_dict() for item in plugins],
                }

            if not plugins:
                result.warnings.append(
                    "跳过「%s」：没有识别到节点，或节点序号与文件夹名不一致" % file_name)
                continue
            for plugin in plugins:
                key = plugin.node_id
                if key in seen_ids:
                    result.warnings.append(
                        "跳过「%s」：节点序号 %s 与「%s」重复" % (
                            file_name, plugin.node_id_text, seen_ids[key]))
                    continue
                seen_ids[key] = file_name
                result.plugins.append(plugin)

    save_parse_cache(cache_path, new_files)
    result.plugins.sort(key=lambda item: (not item.is_loaded(), item.title.lower()))
    return result


def install_plugin_file(root, source_file):
    """把一个节点插件文件按节点序号归档到市场目录。"""
    if not os.path.isfile(source_file):
        raise IOError("插件文件不存在：%s" % source_file)
    plugins = parse_plugin_file(source_file)
    if not plugins:
        raise ValueError("没有在文件里识别到节点注册信息")
    if not root:
        raise ValueError("插件目录为空")
    if not os.path.isdir(root):
        os.makedirs(root)

    installed = []
    for plugin in plugins:
        target_dir = os.path.join(root, plugin.node_id_text)
        if not os.path.isdir(target_dir):
            os.makedirs(target_dir)
        target = os.path.join(target_dir, os.path.basename(source_file))
        if os.path.abspath(source_file) != os.path.abspath(target):
            shutil.copy2(source_file, target)
        # 顺带把卡片图标复制过去
        if plugin.icon and os.path.isfile(plugin.icon):
            icon_target = os.path.join(target_dir, os.path.basename(plugin.icon))
            if os.path.abspath(plugin.icon) != os.path.abspath(icon_target):
                try:
                    shutil.copy2(plugin.icon, icon_target)
                except Exception:
                    pass
        installed.append(target)
    return installed


def install_plugin_folder(root, source_dir):
    """把作者打包好的插件文件夹按节点序号归档到市场目录。"""
    if not os.path.isdir(source_dir):
        raise IOError("插件文件夹不存在：%s" % source_dir)
    if not root:
        raise ValueError("插件目录为空")
    if not os.path.isdir(root):
        os.makedirs(root)

    plugins = []
    for name in sorted(os.listdir(source_dir)):
        if not name.lower().endswith(".py") or name.startswith("_"):
            continue
        try:
            plugins.extend(parse_plugin_file(os.path.join(source_dir, name)))
        except Exception:
            continue
    if not plugins:
        raise ValueError("没有在文件夹里识别到节点注册信息")

    targets = []
    done = set()
    for plugin in plugins:
        target_dir = os.path.join(root, plugin.node_id_text)
        if target_dir in done:
            continue
        done.add(target_dir)
        if not os.path.isdir(target_dir):
            os.makedirs(target_dir)
        for name in os.listdir(source_dir):
            if name in ("__pycache__", ".git", "node_modules", ".venv"):
                continue
            source = os.path.join(source_dir, name)
            target = os.path.join(target_dir, name)
            if os.path.abspath(source) == os.path.abspath(target):
                continue
            try:
                if os.path.isdir(source):
                    if not os.path.isdir(target):
                        shutil.copytree(source, target)
                else:
                    shutil.copy2(source, target)
            except Exception:
                pass
        targets.append(target_dir)
    return targets


# ---------------------------------------------------------------------------
# Maya 加载 / 运行
# ---------------------------------------------------------------------------
def plugin_loaded(path):
    base = os.path.basename(path or "")
    for name in (base, os.path.splitext(base)[0], path):
        if not name:
            continue
        try:
            if cmds.pluginInfo(name, query=True, loaded=True):
                return True
        except Exception:
            continue
    return False


def load_plugin_file(path):
    if plugin_loaded(path):
        return True, "已加载"
    try:
        cmds.loadPlugin(path, quiet=True)
        return True, "加载成功"
    except Exception as exc:
        return False, str(exc)


def unload_plugin_file(path):
    base = os.path.splitext(os.path.basename(path or ""))[0]
    if not plugin_loaded(path):
        return True, "未加载"
    try:
        cmds.unloadPlugin(base)
        return True, "已卸载"
    except Exception as exc:
        return False, str(exc)


def forget_plugin_modules(path):
    """清掉插件主模块的缓存，保证重新加载时执行的是磁盘上的新代码。"""
    plugin_dir = os.path.dirname(os.path.abspath(path))
    for name in list(sys.modules):
        module = sys.modules.get(name)
        filename = getattr(module, "__file__", None)
        if not filename:
            continue
        try:
            if os.path.dirname(os.path.abspath(filename)) == plugin_dir:
                sys.modules.pop(name, None)
        except Exception:
            continue


def run_node_plugin(plugin):
    """每次运行先尝试卸载再重新加载，然后按节点约定执行。"""
    note = ""
    was_loaded = plugin_loaded(plugin.path)
    need_load = not was_loaded

    if was_loaded:
        unloaded, message = unload_plugin_file(plugin.path)
        if unloaded:
            forget_plugin_modules(plugin.path)
            need_load = True
            note = "已卸载重载，"
        else:
            note = "卸载失败，"

    if need_load:
        loaded, message = load_plugin_file(plugin.path)
        if not loaded:
            return False, "重新加载失败：%s" % message

    try:
        if plugin.run:
            if sys.version_info[0] < 3:
                return False, "Python 2 不支持 run 表达式，请改用注册命令"
            namespace = {"cmds": cmds, "mel": mel, "__file__": plugin.path}
            exec(compile(plugin.run, plugin.path, "exec"), namespace)
            return True, note + "已运行"
        if plugin.commands:
            command = plugin.commands[0]
            func = getattr(cmds, command, None)
            if func is None:
                mel.eval(command)
            else:
                func()
            return True, note + "已运行 %s" % command
        if plugin.node_name:
            created = cmds.createNode(plugin.node_name)
            cmds.select(created, replace=True)
            return True, note + "已创建节点 %s" % created
        return True, note + "已加载"
    except Exception as exc:
        return False, str(exc)


def open_in_explorer(path):
    if not path:
        return
    if os.path.isfile(path):
        path = os.path.dirname(path)
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            import subprocess
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", path])
    except Exception:
        pass
