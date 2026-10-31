# -*- coding: utf-8 -*-
"""检测当前 Maya 场景依赖、但本地没有安装的节点插件。

Maya 打开场景时，如果注册节点的插件不存在，会把节点降级成 unknown，
并把插件名记录在 cmds.unknownPlugin 里。这里把插件名映射到在线目录条目，
交给市场提示并一键安装。

约定：不写启动项；只在市场窗口打开的这一会话里注册回调。
保存时把用到的节点插件写进场景 fileInfo（跟文件一起走），
打开时先读清单、再结合 Maya 的 unknownPlugin 记录做兜底。
"""

from __future__ import absolute_import, unicode_literals

import json
import re

import maya.cmds as cmds

_SUFFIX_RE = re.compile(r"\.(py|mll|bundle|so|pyd)$", re.I)
_UNKNOWN_TYPES = ("unknown", "unknownDag", "unknownTransform")
REQUIREMENTS_KEY = "mayaMarketNodes"


def normalize_plugin_name(value):
    """selfIK.py / selfIK.mll / 带路径的名字，统一成 selfik。"""
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.replace("\\", "/").split("/")[-1]
    text = _SUFFIX_RE.sub("", text)
    return text.lower()


def missing_plugins():
    """Maya 记录的「场景需要但没有找到」的插件名。"""
    try:
        names = cmds.unknownPlugin(query=True, list=True) or []
    except Exception:
        return []
    return [str(name) for name in names if str(name).strip()]


def unknown_nodes():
    result = []
    for node_type in _UNKNOWN_TYPES:
        try:
            result.extend(list(cmds.ls(type=node_type) or []))
        except Exception:
            continue
    return result


def current_scene():
    try:
        return cmds.file(query=True, sceneName=True) or ""
    except Exception:
        return ""


def match_requirements(plugin_names, entries, local_plugins=None, requirement_ids=None):
    """把场景需要的插件匹配到在线条目 / 本地插件。

    requirement_ids 来自场景里写入的清单（最准，按节点序号匹配），
    plugin_names 来自 Maya 的 unknownPlugin 记录（兜底）。

    返回 (entries, local, unmatched)。
    """
    index = {}
    for entry in entries or []:
        # 目录里标记为「不含场景节点」的工具插件，永远不作为缺失项提示
        if not getattr(entry, "scene_node", True):
            continue
        keys = (
            normalize_plugin_name(entry.entry),
            normalize_plugin_name(entry.node_name),
            str(entry.node_id_text or "").lower(),
        )
        for key in keys:
            if key:
                index.setdefault(key, entry)

    local_index = {}
    for plugin in local_plugins or []:
        if not getattr(plugin, "scene_node", True):
            continue
        for key in (normalize_plugin_name(plugin.path),
                    normalize_plugin_name(getattr(plugin, "plugin_name", "")),
                    normalize_plugin_name(plugin.node_name),
                    str(plugin.node_id_text or "").lower()):
            if key:
                local_index.setdefault(key, plugin)

    wanted = []
    for value in requirement_ids or []:
        key = str(value or "").strip().lower()
        if key:
            wanted.append(key)
    for name in plugin_names or []:
        key = normalize_plugin_name(name)
        if key:
            wanted.append(key)

    matched, local, unmatched = [], [], []
    seen = set()
    for key in wanted:
        plugin = local_index.get(key)
        if plugin is not None:
            if plugin.node_id_text not in seen:
                local.append(plugin)
                seen.add(plugin.node_id_text)
            continue
        entry = index.get(key)
        if entry is not None:
            if entry.node_id_text not in seen:
                matched.append(entry)
                seen.add(entry.node_id_text)
            continue
        unmatched.append(key)
    return matched, local, unmatched


def collect_requirements(plugins):
    """当前场景里真实用到的市场插件。"""
    items = []
    for plugin in plugins or []:
        # 作者声明「节点不进场景文件」的工具类插件，不写进需求清单
        if not getattr(plugin, "scene_node", True):
            continue
        node_name = getattr(plugin, "node_name", "")
        if not node_name:
            continue
        # 没加载的插件在 Maya 里 ls(type=...) 会刷错误，先跳过
        try:
            import node_market
            if not node_market.plugin_loaded(plugin.path):
                continue
        except Exception:
            continue
        try:
            if not cmds.ls(type=node_name):
                continue
        except Exception:
            continue
        items.append({
            "node_id": plugin.node_id_text,
            "node": node_name,
            "name": plugin.title,
            "version": plugin.version,
        })
    return items


def save_requirements(plugins):
    """把「这个文件用到哪些节点插件」写进场景 fileInfo，随文件一起保存。"""
    items = collect_requirements(plugins)
    try:
        cmds.fileInfo(
            REQUIREMENTS_KEY,
            json.dumps(items, ensure_ascii=False) if items else "[]")
    except Exception:
        return []
    return items


def _parse_requirements(text):
    """Maya 的 fileInfo 会把双引号转义成 \\"，这里两种都试一次。"""
    candidates = [text]
    unescaped = text.replace('\\"', '"').replace("\\\\", "\\")
    if unescaped != text:
        candidates.append(unescaped)
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except Exception:
            continue
        if isinstance(data, list):
            return data
    return []


def read_requirements():
    """读取场景里记录的插件清单。"""
    try:
        values = cmds.fileInfo(REQUIREMENTS_KEY, query=True) or []
    except Exception:
        return []
    if isinstance(values, (list, tuple)):
        text = "".join(str(value) for value in values)
    else:
        text = str(values)
    text = text.strip()
    if not text:
        return []
    return _parse_requirements(text)


def requirement_node_ids():
    ids = []
    for item in read_requirements():
        if not isinstance(item, dict):
            continue
        value = str(item.get("node_id") or "").strip().lower()
        if value:
            ids.append(value)
    return ids


def add_scene_callback(callback):
    """注册「打开 / 新建场景后」的回调，返回 callback id 列表。"""
    ids = []
    try:
        import maya.api.OpenMaya as om
    except Exception:
        return ids
    try:
        ids.append(om.MSceneMessage.addCallback(om.MSceneMessage.kAfterOpen, callback))
        ids.append(om.MSceneMessage.addCallback(om.MSceneMessage.kAfterNew, callback))
    except Exception:
        pass
    return ids


def remove_scene_callbacks(ids):
    if not ids:
        return
    try:
        import maya.api.OpenMaya as om
    except Exception:
        return
    for callback_id in ids:
        try:
            om.MSceneMessage.removeCallback(callback_id)
        except Exception:
            continue


def add_save_callback(callback):
    """注册「保存前」回调，用来把插件清单写进场景。"""
    try:
        import maya.api.OpenMaya as om
    except Exception:
        return None
    try:
        return om.MSceneMessage.addCallback(om.MSceneMessage.kBeforeSave, callback)
    except Exception:
        return None
