# -*- coding: utf-8 -*-
"""检测当前 Maya 场景依赖、但本地没有安装的节点插件。

Maya 打开场景时，如果注册节点的插件不存在，会把节点降级成 unknown，
并把插件名记录在 cmds.unknownPlugin 里。这里把插件名映射到在线目录条目，
交给市场提示并一键安装。

约定：不写启动项、不往场景里塞数据；只在市场窗口打开的这一会话里注册回调。
"""

from __future__ import absolute_import, unicode_literals

import re

import maya.cmds as cmds

_SUFFIX_RE = re.compile(r"\.(py|mll|bundle|so|pyd)$", re.I)
_UNKNOWN_TYPES = ("unknown", "unknownDag", "unknownTransform")


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


def match_requirements(plugin_names, entries, local_plugins=None):
    """把缺失插件名匹配到在线条目 / 本地插件。

    返回 (entries, local, unmatched)：
      entries   目录里有、可以直接安装的条目
      local     本地 nodes/ 里已有、只是没加载的插件
      unmatched 两边都没匹配上的插件名
    """
    index = {}
    for entry in entries or []:
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
        for key in (normalize_plugin_name(plugin.path),
                    normalize_plugin_name(getattr(plugin, "plugin_name", "")),
                    normalize_plugin_name(plugin.node_name)):
            if key:
                local_index.setdefault(key, plugin)

    matched, local, unmatched = [], [], []
    seen = set()
    for name in plugin_names:
        key = normalize_plugin_name(name)
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
        unmatched.append(name)
    return matched, local, unmatched


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
