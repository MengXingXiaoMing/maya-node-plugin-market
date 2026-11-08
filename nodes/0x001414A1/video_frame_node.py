# -*- coding: utf-8 -*-
"""videoFrameNode —— 用任意格式视频代替序列帧的 Maya 节点
=========================================================

Maya 原生只支持图片序列（`file` 节点的 <f> 帧扩展）。本插件提供一个 DG 节点
`videoFrameNode`：把任意格式的视频（mp4 / mov / mkv / avi / webm / gif / flv /
wmv / m4v / ts / mxf …，取决于本机 ffmpeg 的解码器）实时抽成 PNG/JPG 序列帧
缓存，并输出 Maya 能直接识别的 `<f>` 序列帧路径与帧号。

使用方式
--------
1. 把本文件放到任意插件目录，加载：:

       import maya.cmds as cmds
       cmds.loadPlugin(r".../videoFrameNode.py")

2. 自动创建 file 纹理并接好（推荐）::

       import videoFrameNode
       videoFrameNode.create_video_texture(r"D:/ref/action.mp4")

   返回 dict：``{"node": 节点, "file": file节点, "place2d": 2d坐标节点}``，
   把 file 节点的 outColor 接到材质即可。

3. 或者创建图像平面（逐帧参考）::

       videoFrameNode.create_video_image_plane(r"D:/ref/action.mp4")

4. 图形界面::

       videoFrameNode.open_window()

节点接线原理
------------
- ``outFile`` 输出 ``.../f.<f>.png``（固定不变的序列帧路径）
  → 接到 ``file.fileTextureName`` 或 ``imagePlane.imageName``；
- ``outFrame`` 输出当前视频帧号
  → 接到 ``file.frameExtension`` / ``imagePlane.frameExtension``，
  并把目标节点的 ``useFrameExtension`` 打开。

这样目标节点走的是 Maya 原生序列帧机制（有缓存、可渲染），而不是每帧换
文件名硬刷新纹理。

依赖
----
需要本机有 ``ffmpeg`` / ``ffprobe``。查找顺序：环境变量
``MAYA_VIDEO_FFMPEG``（可指向 exe 或目录）、本插件目录及其 bin/tools 子目录、
系统 PATH、winget 链接目录、常见安装路径。找不到时节点会给出提示。
"""

NODE_INFO = {
    "name": "视频转序列帧节点",
    "description": (
        "把任意格式视频（mp4/mov/mkv/avi/webm/gif…）实时抽成 PNG/JPG 序列帧，"
        "输出 Maya 原生识别的 <f> 序列帧路径与帧号，接到 file 纹理或图像平面上。"
        "支持循环、倒放、变速、分辨率缩放、后台预取、整段预转码。"
        "需要本机安装 ffmpeg/ffprobe。"
    ),
    "author": "詹康明",
    "version": "1.0.0",
    "node": "videoFrameNode",
    "node_id": "0x001414A1",
    "run": "cmds.createVideoFrame()",
    "tags": ["视频", "序列帧", "工具", "ffmpeg", "贴图"],
    "github": "https://github.com/MengXingXiaoMing/maya-node-plugin-market/tree/main/nodes/0x001414A1",
}

import hashlib
import json
import math
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading

import maya.OpenMaya as om
import maya.OpenMayaMPx as ompx

kPluginNodeTypeName = "videoFrameNode"
kPluginNodeId = om.MTypeId(0x001414A1)

_IS_WIN = os.name == "nt"
_NO_WINDOW = 0x08000000 if _IS_WIN else 0
_CACHE_VERSION = "1"

# ---------------------------------------------------------------------------
# ffmpeg / ffprobe 定位
# ---------------------------------------------------------------------------
_TOOL_CACHE = {}


def _tool_exe(name):
    return name + (".exe" if _IS_WIN else "")


def find_tool(name):
    """定位 ffmpeg / ffprobe，返回可执行文件绝对路径；找不到返回空串。"""
    if name in _TOOL_CACHE:
        return _TOOL_CACHE[name]

    exe = _tool_exe(name)
    cands = []
    for env in ("MAYA_VIDEO_FFMPEG", "VIDEO_FRAME_FFMPEG"):
        val = os.environ.get(env)
        if not val:
            continue
        if os.path.isdir(val):
            cands.append(os.path.join(val, exe))
        else:
            cands.append(val)
    for env in ("MAYA_VIDEO_FFMPEG_DIR", "VIDEO_FRAME_FFMPEG_DIR"):
        val = os.environ.get(env)
        if val:
            cands.append(os.path.join(val, exe))

    try:
        base = os.path.dirname(os.path.abspath(__file__))
    except Exception:
        base = ""
    if base:
        cands += [
            os.path.join(base, exe),
            os.path.join(base, "bin", exe),
            os.path.join(base, "tools", exe),
            os.path.join(base, "tools", "ffmpeg", "bin", exe),
        ]

    found = shutil.which(name)
    if found:
        cands.append(found)

    local = os.environ.get("LOCALAPPDATA")
    if local:
        cands.append(os.path.join(local, "Microsoft", "WinGet", "Links", exe))
    for folder in (
        r"C:\ffmpeg\bin",
        r"C:\Program Files\ffmpeg\bin",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
    ):
        cands.append(os.path.join(folder, exe))

    result = ""
    for cand in cands:
        if cand and os.path.isfile(cand):
            result = cand
            break
    _TOOL_CACHE[name] = result
    return result


def _run_tool(cmd, timeout=30):
    try:
        return subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=_NO_WINDOW,
            timeout=timeout,
        )
    except Exception:
        return None


def _decode(data):
    if not data:
        return ""
    try:
        return data.decode("utf-8", "replace")
    except Exception:
        return str(data)


# ---------------------------------------------------------------------------
# 视频信息探测
# ---------------------------------------------------------------------------
_PROBE_CACHE = {}
_PROBE_LOCK = threading.Lock()


def _parse_rate(text):
    if not text:
        return 0.0
    try:
        if "/" in text:
            num, den = text.split("/", 1)
            den = float(den)
            return float(num) / den if den else 0.0
        return float(text)
    except Exception:
        return 0.0


def _to_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def _to_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _probe_with_ffprobe(tool, path):
    cmd = [
        tool, "-v", "error", "-select_streams", "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,codec_name"
        ":format=duration",
        "-of", "json", path,
    ]
    res = _run_tool(cmd, 25)
    if res is None or res.returncode != 0:
        return None
    try:
        data = json.loads(_decode(res.stdout) or "{}")
    except Exception:
        return None
    streams = data.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    fps = _parse_rate(stream.get("avg_frame_rate"))
    if fps <= 0.0:
        fps = _parse_rate(stream.get("r_frame_rate"))
    duration = _to_float(stream.get("duration"))
    if duration <= 0.0:
        duration = _to_float((data.get("format") or {}).get("duration"))
    frames = _to_int(stream.get("nb_frames"))
    if frames <= 0 and duration > 0.0 and fps > 0.0:
        frames = int(round(duration * fps))
    width = _to_int(stream.get("width"))
    height = _to_int(stream.get("height"))
    if width <= 0 or height <= 0 or fps <= 0.0:
        return None
    return {
        "width": width,
        "height": height,
        "fps": fps,
        "frames": max(1, frames),
        "duration": duration,
        "codec": stream.get("codec_name") or "",
    }


def _probe_with_ffmpeg(tool, path):
    """没有 ffprobe 时，用 ffmpeg -i 的 stderr 粗略解析。"""
    res = _run_tool([tool, "-hide_banner", "-i", path], 25)
    if res is None:
        return None
    text = _decode(res.stderr)
    match = re.search(
        r"Video:.*?(\d{2,5})x(\d{2,5}).*?([\d.]+)\s+fps", text)
    if not match:
        return None
    width = int(match.group(1))
    height = int(match.group(2))
    fps = float(match.group(3))
    dur_match = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", text)
    duration = 0.0
    if dur_match:
        duration = (int(dur_match.group(1)) * 3600 +
                    int(dur_match.group(2)) * 60 +
                    float(dur_match.group(3)))
    frames = int(round(duration * fps)) if duration > 0.0 else 1
    return {
        "width": width,
        "height": height,
        "fps": fps,
        "frames": max(1, frames),
        "duration": duration,
        "codec": "",
    }


def probe_video(path):
    """探测视频信息，带缓存。失败返回 None。"""
    if not path:
        return None
    path = os.path.abspath(path)
    try:
        stat = os.stat(path)
    except OSError:
        return None
    key = (path, stat.st_mtime_ns, stat.st_size)
    with _PROBE_LOCK:
        if key in _PROBE_CACHE:
            return _PROBE_CACHE[key]

    info = None
    ffprobe = find_tool("ffprobe")
    if ffprobe:
        info = _probe_with_ffprobe(ffprobe, path)
    if info is None:
        ffmpeg = find_tool("ffmpeg")
        if ffmpeg:
            info = _probe_with_ffmpeg(ffmpeg, path)
    if info:
        info["path"] = path
        with _PROBE_LOCK:
            _PROBE_CACHE[key] = info
    return info


def _maya_fps():
    """当前场景时间单位对应的帧率。"""
    try:
        unit = om.MTime.uiUnit()
        seconds = om.MTime(1.0, unit).asUnits(om.MTime.kSeconds)
        if seconds > 1e-9:
            return 1.0 / seconds
    except Exception:
        pass
    return 24.0


# ---------------------------------------------------------------------------
# 缓存目录 / 抽帧
# ---------------------------------------------------------------------------
def default_cache_root():
    return os.path.join(tempfile.gettempdir(), "maya_video_frame_cache")


def cache_folder(video, cache_root, fmt, quality, scale):
    """按视频路径 + 修改时间 + 抽帧参数生成独立缓存目录。"""
    try:
        stat = os.stat(video)
        stamp = "%d|%d" % (stat.st_mtime_ns, stat.st_size)
    except OSError:
        stamp = "0|0"
    raw = "%s|%s|%s|%s|%d|%.4f|%s" % (
        os.path.abspath(video), stamp, fmt, quality, int(quality), scale,
        _CACHE_VERSION)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_root, digest)


def frame_filename(index, fmt):
    return "f.%d.%s" % (int(index), fmt)


def frame_pattern(folder, fmt):
    return os.path.join(folder, "f.<f>." + fmt).replace("\\", "/")


_TARGET_LOCKS = {}
_TARGET_LOCKS_GUARD = threading.Lock()


def _target_lock(target):
    with _TARGET_LOCKS_GUARD:
        lock = _TARGET_LOCKS.get(target)
        if lock is None:
            lock = threading.Lock()
            _TARGET_LOCKS[target] = lock
        return lock


def extract_frame(video, index, target, fps, fmt, quality, scale):
    """把视频第 index 帧抽到 target（原子替换）。返回 (ok, err)。"""
    if os.path.isfile(target):
        return True, ""
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        return False, u"找不到 ffmpeg（可用环境变量 MAYA_VIDEO_FFMPEG 指定）"
    if fps <= 0.0:
        return False, u"视频帧率无效"

    folder = os.path.dirname(target)
    tmp_dir = os.path.join(folder, ".tmp")
    try:
        if not os.path.isdir(tmp_dir):
            os.makedirs(tmp_dir, exist_ok=True)
    except OSError as err:
        return False, u"无法创建缓存目录: %s" % err

    lock = _target_lock(target)
    with lock:
        if os.path.isfile(target):
            return True, ""
        tmp = os.path.join(
            tmp_dir, "f.%d.%d.%d_part.%s" % (
                int(index), os.getpid(), threading.get_ident() % 1000000, fmt))
        seconds = (int(index) + 0.5) / float(fps)
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-ss", "%.6f" % seconds, "-i", video,
            "-frames:v", "1", "-an", "-sn", "-dn",
        ]
        if abs(scale - 1.0) > 1e-6:
            cmd += ["-vf", "scale=trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2"
                    % (scale, scale)]
        if fmt == "jpg":
            cmd += ["-q:v", str(int(quality))]
        else:
            cmd += ["-compression_level", "1"]
        cmd.append(tmp)

        res = _run_tool(cmd, 60)
        try:
            if res is None:
                return False, u"ffmpeg 启动失败"
            if res.returncode != 0 or not os.path.isfile(tmp):
                return False, _decode(res.stderr).strip()[:300] or u"ffmpeg 抽帧失败"
            os.replace(tmp, target)
        finally:
            try:
                if os.path.isfile(tmp):
                    os.remove(tmp)
            except OSError:
                pass
    return True, ""


# ---------------------------------------------------------------------------
# 后台预取
# ---------------------------------------------------------------------------
_PREFETCH_QUEUE = queue.Queue(maxsize=120)
_PREFETCH_PENDING = set()
_PREFETCH_LOCK = threading.Lock()
_PREFETCH_WORKER = None
_PREFETCH_WORKER_LOCK = threading.Lock()


def _worker_loop():
    while True:
        task = _PREFETCH_QUEUE.get()
        try:
            if task is None:
                continue
            video, target, index, fps, fmt, quality, scale = task
            if not os.path.isfile(target):
                extract_frame(video, index, target, fps, fmt, quality, scale)
        except Exception:
            pass
        finally:
            if task:
                with _PREFETCH_LOCK:
                    _PREFETCH_PENDING.discard(task[1])
            _PREFETCH_QUEUE.task_done()


def _ensure_worker():
    global _PREFETCH_WORKER
    with _PREFETCH_WORKER_LOCK:
        if _PREFETCH_WORKER is None or not _PREFETCH_WORKER.is_alive():
            _PREFETCH_WORKER = threading.Thread(
                target=_worker_loop, name="videoFramePrefetch")
            _PREFETCH_WORKER.daemon = True
            _PREFETCH_WORKER.start()


def queue_prefetch(video, folder, indices, fps, fmt, quality, scale):
    tasks = []
    with _PREFETCH_LOCK:
        for index in indices:
            target = os.path.join(folder, frame_filename(index, fmt))
            if target in _PREFETCH_PENDING or os.path.isfile(target):
                continue
            _PREFETCH_PENDING.add(target)
            tasks.append((video, target, index, fps, fmt, quality, scale))
    if not tasks:
        return
    _ensure_worker()
    for task in tasks:
        try:
            _PREFETCH_QUEUE.put_nowait(task)
        except queue.Full:
            with _PREFETCH_LOCK:
                _PREFETCH_PENDING.discard(task[1])


# ---------------------------------------------------------------------------
# 核心求值：Maya 时间 -> 视频帧号 -> 缓存文件
# ---------------------------------------------------------------------------
def evaluate(video, cache_root, time_value, start, offset, fps_in, speed,
             loop, hold, reverse, fmt, quality, scale, preload, prefetch):
    """返回输出字典。纯逻辑 + 必要的抽帧副作用。"""
    out = {
        "file": "",
        "frame": 0.0,
        "width": 0,
        "height": 0,
        "fps": 0.0,
        "count": 0,
        "status": "",
        "valid": False,
    }
    if not video:
        out["status"] = u"未设置视频路径"
        return out
    if not os.path.isfile(video):
        out["status"] = u"找不到视频文件: %s" % video
        return out

    info = probe_video(video)
    if not info:
        if not find_tool("ffmpeg"):
            out["status"] = u"找不到 ffmpeg，无法解码视频"
        else:
            out["status"] = u"无法读取视频信息（格式可能不被支持）"
        return out

    fps = fps_in if fps_in > 0.0 else info["fps"]
    if fps <= 0.0:
        out["status"] = u"视频帧率无效"
        return out
    count = int(info["frames"])
    if count <= 0:
        count = 1

    out["width"] = info["width"]
    out["height"] = info["height"]
    out["fps"] = round(fps, 4)
    out["count"] = count

    maya_fps = _maya_fps()
    elapsed = float(time_value) - float(start)
    seconds = elapsed / maya_fps * float(speed)
    index = int(math.floor(seconds * fps + 0.5)) + int(offset)

    if loop:
        index %= count
    elif index < 0 or index >= count:
        if hold:
            index = 0 if index < 0 else count - 1
        else:
            out["frame"] = -1.0
            out["status"] = u"当前时间超出视频范围"
            return out
    if reverse:
        index = count - 1 - index

    root = cache_root or default_cache_root()
    folder = cache_folder(video, root, fmt, quality, scale)
    pattern = frame_pattern(folder, fmt)
    target = os.path.join(folder, frame_filename(index, fmt))

    ok, err = extract_frame(video, index, target, fps, fmt, quality, scale)
    if not ok:
        out["frame"] = float(index)
        out["status"] = u"抽帧失败: %s" % err
        return out

    out["file"] = pattern
    out["frame"] = float(index)
    out["valid"] = True
    out["status"] = u"就绪 %dx%d %.3ffps %d帧" % (
        info["width"], info["height"], fps, count)

    if preload and prefetch > 0:
        step = -1 if reverse else 1
        ahead = [index + step * n for n in range(1, int(prefetch) + 1)]
        ahead = [i for i in ahead if 0 <= i < count]
        if ahead:
            queue_prefetch(video, folder, ahead, fps, fmt, quality, scale)
    return out


# ---------------------------------------------------------------------------
# DG 节点
# ---------------------------------------------------------------------------
class VideoFrameNode(ompx.MPxNode):
    kNodeName = kPluginNodeTypeName

    aVideoPath = om.MObject()
    aCacheRoot = om.MObject()
    aTime = om.MObject()
    aStartFrame = om.MObject()
    aOffset = om.MObject()
    aVideoFps = om.MObject()
    aSpeed = om.MObject()
    aLoop = om.MObject()
    aHoldLast = om.MObject()
    aReverse = om.MObject()
    aFormat = om.MObject()
    aJpegQuality = om.MObject()
    aResolution = om.MObject()
    aPreload = om.MObject()
    aPrefetch = om.MObject()

    aOutFile = om.MObject()
    aOutFrame = om.MObject()
    aOutWidth = om.MObject()
    aOutHeight = om.MObject()
    aOutFps = om.MObject()
    aOutFrameCount = om.MObject()
    aOutStatus = om.MObject()
    aOutValid = om.MObject()

    _OUTPUTS = []

    def __init__(self):
        ompx.MPxNode.__init__(self)

    def compute(self, plug, data_block):
        matched = False
        for attr in self._OUTPUTS:
            if plug == attr:
                matched = True
                break
        if not matched:
            return ompx.MPxNode.kUnknownParameter

        video = data_block.inputValue(self.aVideoPath).asString()
        cache_root = data_block.inputValue(self.aCacheRoot).asString()
        time_value = data_block.inputValue(self.aTime).asDouble()
        start = data_block.inputValue(self.aStartFrame).asLong()
        offset = data_block.inputValue(self.aOffset).asLong()
        fps_in = data_block.inputValue(self.aVideoFps).asDouble()
        speed = data_block.inputValue(self.aSpeed).asDouble()
        loop = data_block.inputValue(self.aLoop).asBool()
        hold = data_block.inputValue(self.aHoldLast).asBool()
        reverse = data_block.inputValue(self.aReverse).asBool()
        fmt_index = data_block.inputValue(self.aFormat).asShort()
        quality = data_block.inputValue(self.aJpegQuality).asLong()
        scale = data_block.inputValue(self.aResolution).asDouble()
        preload = data_block.inputValue(self.aPreload).asBool()
        prefetch = data_block.inputValue(self.aPrefetch).asLong()

        fmt = "jpg" if int(fmt_index) == 1 else "png"

        try:
            result = evaluate(
                video, cache_root, time_value, start, offset, fps_in, speed,
                loop, hold, reverse, fmt, int(quality), float(scale),
                preload, int(prefetch))
        except Exception as err:
            result = {
                "file": "", "frame": 0.0, "width": 0, "height": 0, "fps": 0.0,
                "count": 0, "status": u"节点计算异常: %s" % err, "valid": False,
            }

        handle = data_block.outputValue(self.aOutFile)
        handle.setString(result["file"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutFrame)
        handle.setDouble(result["frame"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutWidth)
        handle.setInt(result["width"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutHeight)
        handle.setInt(result["height"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutFps)
        handle.setDouble(result["fps"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutFrameCount)
        handle.setInt(result["count"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutStatus)
        handle.setString(result["status"])
        handle.setClean()
        handle = data_block.outputValue(self.aOutValid)
        handle.setBool(result["valid"])
        handle.setClean()
        return None

    @classmethod
    def nodeCreator(cls):
        return ompx.asMPxPtr(cls())

    @classmethod
    def nodeInitializer(cls):
        n_attr = om.MFnNumericAttribute()
        t_attr = om.MFnTypedAttribute()
        e_attr = om.MFnEnumAttribute()

        def new_string(name, short, default=""):
            data = om.MFnStringData().create(default)
            attr = t_attr.create(name, short, om.MFnData.kString, data)
            return attr

        # ---- 输入 ----
        cls.aVideoPath = new_string("videoPath", "vp", "")
        t_attr.setStorable(True)
        t_attr.setKeyable(True)
        t_attr.setUsedAsFilename(True)
        t_attr.setNiceNameOverride(u"视频路径 (Video)")
        cls.addAttribute(cls.aVideoPath)

        cls.aCacheRoot = new_string("cacheRoot", "cr", default_cache_root())
        t_attr.setStorable(True)
        t_attr.setKeyable(False)
        t_attr.setUsedAsFilename(True)
        t_attr.setNiceNameOverride(u"缓存目录 (Cache Dir)")
        cls.addAttribute(cls.aCacheRoot)

        cls.aTime = n_attr.create("time", "tm", om.MFnNumericData.kDouble, 0.0)
        n_attr.setStorable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"时间 (Time)")
        cls.addAttribute(cls.aTime)

        cls.aStartFrame = n_attr.create(
            "startFrame", "sf", om.MFnNumericData.kLong, 1)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"起始帧 (Start Frame)")
        cls.addAttribute(cls.aStartFrame)

        cls.aOffset = n_attr.create(
            "offset", "off", om.MFnNumericData.kLong, 0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"帧偏移 (Offset)")
        cls.addAttribute(cls.aOffset)

        cls.aVideoFps = n_attr.create(
            "videoFps", "vfp", om.MFnNumericData.kDouble, 0.0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setMin(0.0)
        n_attr.setNiceNameOverride(u"视频帧率 0=自动 (Video FPS)")
        cls.addAttribute(cls.aVideoFps)

        cls.aSpeed = n_attr.create(
            "speed", "spd", om.MFnNumericData.kDouble, 1.0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setMin(0.0)
        n_attr.setNiceNameOverride(u"播放速度 (Speed)")
        cls.addAttribute(cls.aSpeed)

        cls.aLoop = n_attr.create(
            "loop", "lp", om.MFnNumericData.kBoolean, 0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"循环 (Loop)")
        cls.addAttribute(cls.aLoop)

        cls.aHoldLast = n_attr.create(
            "holdLast", "hl", om.MFnNumericData.kBoolean, 1)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"超出保持首末帧 (Hold)")
        cls.addAttribute(cls.aHoldLast)

        cls.aReverse = n_attr.create(
            "reverse", "rev", om.MFnNumericData.kBoolean, 0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"倒放 (Reverse)")
        cls.addAttribute(cls.aReverse)

        cls.aFormat = e_attr.create("format", "fmt", 0)
        e_attr.addField("PNG", 0)
        e_attr.addField("JPG", 1)
        e_attr.setStorable(True)
        e_attr.setKeyable(True)
        e_attr.setNiceNameOverride(u"缓存格式 (Format)")
        cls.addAttribute(cls.aFormat)

        cls.aJpegQuality = n_attr.create(
            "jpegQuality", "jq", om.MFnNumericData.kLong, 2)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setMin(1)
        n_attr.setMax(31)
        n_attr.setNiceNameOverride(u"JPG 质量 1最好 (JPG Quality)")
        cls.addAttribute(cls.aJpegQuality)

        cls.aResolution = n_attr.create(
            "resolution", "res", om.MFnNumericData.kDouble, 1.0)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setMin(0.05)
        n_attr.setMax(4.0)
        n_attr.setNiceNameOverride(u"分辨率倍率 (Resolution)")
        cls.addAttribute(cls.aResolution)

        cls.aPreload = n_attr.create(
            "preload", "pld", om.MFnNumericData.kBoolean, 1)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setNiceNameOverride(u"后台预取 (Preload)")
        cls.addAttribute(cls.aPreload)

        cls.aPrefetch = n_attr.create(
            "prefetchFrames", "pfn", om.MFnNumericData.kLong, 8)
        n_attr.setStorable(True)
        n_attr.setKeyable(True)
        n_attr.setMin(0)
        n_attr.setMax(120)
        n_attr.setNiceNameOverride(u"预取帧数 (Prefetch)")
        cls.addAttribute(cls.aPrefetch)

        # ---- 输出 ----
        cls.aOutFile = new_string("outFile", "of", "")
        t_attr.setStorable(False)
        t_attr.setWritable(False)
        t_attr.setKeyable(False)
        t_attr.setUsedAsFilename(True)
        t_attr.setNiceNameOverride(u"输出序列帧路径 (Out File)")
        cls.addAttribute(cls.aOutFile)

        cls.aOutFrame = n_attr.create(
            "outFrame", "ofr", om.MFnNumericData.kDouble, 0.0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"输出帧号 (Out Frame)")
        cls.addAttribute(cls.aOutFrame)

        cls.aOutWidth = n_attr.create(
            "outWidth", "ow", om.MFnNumericData.kLong, 0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"视频宽度 (Width)")
        cls.addAttribute(cls.aOutWidth)

        cls.aOutHeight = n_attr.create(
            "outHeight", "oh", om.MFnNumericData.kLong, 0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"视频高度 (Height)")
        cls.addAttribute(cls.aOutHeight)

        cls.aOutFps = n_attr.create(
            "outFps", "ofp", om.MFnNumericData.kDouble, 0.0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"视频帧率 (Out FPS)")
        cls.addAttribute(cls.aOutFps)

        cls.aOutFrameCount = n_attr.create(
            "outFrameCount", "ofc", om.MFnNumericData.kLong, 0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"总帧数 (Frames)")
        cls.addAttribute(cls.aOutFrameCount)

        cls.aOutStatus = new_string("outStatus", "ost", "")
        t_attr.setStorable(False)
        t_attr.setWritable(False)
        t_attr.setKeyable(False)
        t_attr.setNiceNameOverride(u"状态 (Status)")
        cls.addAttribute(cls.aOutStatus)

        cls.aOutValid = n_attr.create(
            "outValid", "ovd", om.MFnNumericData.kBoolean, 0)
        n_attr.setStorable(False)
        n_attr.setWritable(False)
        n_attr.setKeyable(False)
        n_attr.setNiceNameOverride(u"有效 (Valid)")
        cls.addAttribute(cls.aOutValid)

        cls._OUTPUTS = [
            cls.aOutFile, cls.aOutFrame, cls.aOutWidth, cls.aOutHeight,
            cls.aOutFps, cls.aOutFrameCount, cls.aOutStatus, cls.aOutValid,
        ]
        inputs = [
            cls.aVideoPath, cls.aCacheRoot, cls.aTime, cls.aStartFrame,
            cls.aOffset, cls.aVideoFps, cls.aSpeed, cls.aLoop, cls.aHoldLast,
            cls.aReverse, cls.aFormat, cls.aJpegQuality, cls.aResolution,
            cls.aPreload, cls.aPrefetch,
        ]
        for src in inputs:
            for dst in cls._OUTPUTS:
                cls.attributeAffects(src, dst)


# ---------------------------------------------------------------------------
# 便捷构建函数
# ---------------------------------------------------------------------------
def _apply_settings(node, kwargs):
    mapping = {
        "start_frame": "startFrame",
        "offset": "offset",
        "video_fps": "videoFps",
        "speed": "speed",
        "loop": "loop",
        "hold": "holdLast",
        "reverse": "reverse",
        "format": "format",
        "quality": "jpegQuality",
        "resolution": "resolution",
        "preload": "preload",
        "prefetch": "prefetchFrames",
        "cache_root": "cacheRoot",
    }
    for key, value in kwargs.items():
        attr = mapping.get(key)
        if not attr:
            continue
        if attr in ("loop", "holdLast", "reverse", "preload"):
            cmds_set_attr(node, attr, bool(value), "bool")
        elif attr in ("startFrame", "offset", "jpegQuality", "prefetchFrames"):
            cmds_set_attr(node, attr, int(value), "long")
        elif attr in ("format",):
            cmds_set_attr(node, attr, int(value), "long")
        elif attr in ("videoFps", "speed", "resolution"):
            cmds_set_attr(node, attr, float(value), "double")
        else:
            cmds_set_attr(node, attr, value, "string")


def cmds_set_attr(node, attr, value, kind):
    """延迟导入 cmds，避免插件模块导入期依赖。"""
    import maya.cmds as cmds
    if kind == "string":
        cmds.setAttr(node + "." + attr, value, type="string")
    elif kind == "bool":
        cmds.setAttr(node + "." + attr, 1 if value else 0)
    else:
        cmds.setAttr(node + "." + attr, value)


def _connect_time(node):
    import maya.cmds as cmds
    if not cmds.isConnected("time1.outTime", node + ".time"):
        cmds.connectAttr("time1.outTime", node + ".time", force=True)


def create_video_node(video_path="", name=None, **kwargs):
    """只创建 videoFrameNode 并接好时间、设置参数。"""
    import maya.cmds as cmds
    node = cmds.createNode(kPluginNodeTypeName, name=name or "videoFrame1")
    _connect_time(node)
    if kwargs:
        _apply_settings(node, kwargs)
    if video_path:
        cmds.setAttr(node + ".videoPath", video_path, type="string")
    return node


def create_video_texture(video_path="", name=None, **kwargs):
    """创建视频节点 + file 纹理 + place2dTexture，返回名字字典。"""
    import maya.cmds as cmds
    cmds.undoInfo(openChunk=True)
    try:
        node = create_video_node(video_path, name, **kwargs)
        file_node = cmds.createNode("file", name=node + "_file")
        cmds.setAttr(file_node + ".useFrameExtension", 1)
        cmds.connectAttr(node + ".outFile",
                         file_node + ".fileTextureName", force=True)
        cmds.connectAttr(node + ".outFrame",
                         file_node + ".frameExtension", force=True)

        place2d = cmds.shadingNode("place2dTexture", asUtility=True)
        pairs = (
            ("coverage", "coverage"),
            ("translateFrame", "translateFrame"),
            ("rotateFrame", "rotateFrame"),
            ("mirrorU", "mirrorU"),
            ("mirrorV", "mirrorV"),
            ("stagger", "stagger"),
            ("wrapU", "wrapU"),
            ("wrapV", "wrapV"),
            ("repeatUV", "repeatUV"),
            ("offset", "offset"),
            ("rotateUV", "rotateUV"),
            ("noiseUV", "noiseUV"),
        )
        for src, dst in pairs:
            cmds.connectAttr(place2d + "." + src, file_node + "." + dst)
        cmds.connectAttr(place2d + ".outUV", file_node + ".uvCoord")
        cmds.connectAttr(place2d + ".outUvFilterSize",
                         file_node + ".uvFilterSize")
        return {"node": node, "file": file_node, "place2d": place2d}
    finally:
        cmds.undoInfo(closeChunk=True)


def create_video_image_plane(video_path="", camera=None, name=None, **kwargs):
    """创建视频节点 + 图像平面，返回名字字典。"""
    import maya.cmds as cmds
    cmds.undoInfo(openChunk=True)
    try:
        node = create_video_node(video_path, name, **kwargs)
        if camera:
            created = cmds.imagePlane(camera=camera)
        else:
            created = cmds.imagePlane()
        created = cmds.ls(created, long=False) or created
        plane = ""
        for item in created:
            if cmds.nodeType(item) == "imagePlane":
                plane = item
                break
        if not plane:
            raise RuntimeError(u"创建图像平面失败")
        cmds.setAttr(plane + ".useFrameExtension", 1)
        cmds.connectAttr(node + ".outFile", plane + ".imageName",
                         force=True)
        cmds.connectAttr(node + ".outFrame", plane + ".frameExtension",
                         force=True)
        return {"node": node, "imagePlane": plane,
                "transform": cmds.listRelatives(plane, parent=True)[0]}
    finally:
        cmds.undoInfo(closeChunk=True)


def precache_all(node, progress_cb=None):
    """把整段视频一次性转成缓存帧序列（播放更流畅）。返回 (ok, message)。"""
    import maya.cmds as cmds
    video = cmds.getAttr(node + ".videoPath") or ""
    if not video or not os.path.isfile(video):
        return False, u"视频路径无效"
    info = probe_video(video)
    if not info:
        return False, u"无法读取视频信息"
    fmt = "jpg" if int(cmds.getAttr(node + ".format")) == 1 else "png"
    quality = int(cmds.getAttr(node + ".jpegQuality"))
    scale = float(cmds.getAttr(node + ".resolution"))
    root = cmds.getAttr(node + ".cacheRoot") or default_cache_root()
    folder = cache_folder(video, root, fmt, quality, scale)
    tmp_dir = os.path.join(folder, ".precache")
    try:
        if not os.path.isdir(tmp_dir):
            os.makedirs(tmp_dir, exist_ok=True)
    except OSError as err:
        return False, u"无法创建缓存目录: %s" % err

    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        return False, u"找不到 ffmpeg"

    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
           "-i", video, "-an", "-sn", "-dn", "-fps_mode", "passthrough"]
    if abs(scale - 1.0) > 1e-6:
        cmd += ["-vf", "scale=trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2"
                % (scale, scale)]
    if fmt == "jpg":
        cmd += ["-q:v", str(quality)]
    else:
        cmd += ["-compression_level", "1"]
    cmd += ["-start_number", "0",
            os.path.join(tmp_dir, "f.%d." + fmt), "-progress", "pipe:1",
            "-nostats"]

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW)
    except Exception as err:
        return False, u"ffmpeg 启动失败: %s" % err

    total = max(1, int(info["frames"]))
    try:
        for raw in proc.stdout:
            line = _decode(raw).strip()
            if line.startswith("frame="):
                done = _to_int(line.split("=", 1)[1], 0)
                if progress_cb:
                    try:
                        progress_cb(min(done, total), total)
                    except Exception:
                        pass
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()

    if proc.returncode != 0:
        return False, u"预转码失败（返回码 %s）" % proc.returncode

    moved = 0
    for fname in os.listdir(tmp_dir):
        if not fname.startswith("f."):
            continue
        src = os.path.join(tmp_dir, fname)
        dst = os.path.join(folder, fname)
        try:
            os.replace(src, dst)
            moved += 1
        except OSError:
            pass
    if progress_cb:
        try:
            progress_cb(total, total)
        except Exception:
            pass
    return True, u"预转码完成，共 %d 帧" % moved


def clear_cache(node):
    """删除该节点当前参数对应的缓存目录。"""
    import maya.cmds as cmds
    video = cmds.getAttr(node + ".videoPath") or ""
    if not video:
        return False, u"视频路径为空"
    fmt = "jpg" if int(cmds.getAttr(node + ".format")) == 1 else "png"
    quality = int(cmds.getAttr(node + ".jpegQuality"))
    scale = float(cmds.getAttr(node + ".resolution"))
    root = cmds.getAttr(node + ".cacheRoot") or default_cache_root()
    folder = cache_folder(video, root, fmt, quality, scale)
    if not os.path.isdir(folder):
        return True, u"缓存目录不存在"
    try:
        shutil.rmtree(folder)
    except OSError as err:
        return False, u"删除失败: %s" % err
    return True, u"已清理缓存: %s" % folder


# ---------------------------------------------------------------------------
# 简易窗口
# ---------------------------------------------------------------------------
_WINDOW = None


def open_window():
    """打开视频帧节点工具窗口。"""
    global _WINDOW

    try:
        from PySide6 import QtCore, QtWidgets
    except ImportError:
        from PySide2 import QtCore, QtWidgets

    try:
        from shiboken6 import wrapInstance
    except ImportError:
        from shiboken2 import wrapInstance

    from maya import OpenMayaUI as omui

    ptr = omui.MQtUtil.mainWindow()
    parent = wrapInstance(int(ptr), QtWidgets.QWidget) if ptr else None

    if _WINDOW is not None:
        try:
            _WINDOW.close()
            _WINDOW.deleteLater()
        except Exception:
            pass
        _WINDOW = None

    class PrecacheThread(QtCore.QThread):
        progress = QtCore.Signal(int, int)
        finished_msg = QtCore.Signal(str)

        def __init__(self, node_name):
            QtCore.QThread.__init__(self)
            self.node_name = node_name

        def run(self):
            try:
                ok, msg = precache_all(
                    self.node_name,
                    lambda current, total: self.progress.emit(current, total))
                self.finished_msg.emit(msg)
            except Exception as err:
                self.finished_msg.emit(u"预转码异常: %s" % err)

    class Window(QtWidgets.QDialog):
        def __init__(self, parent_widget):
            QtWidgets.QDialog.__init__(self, parent_widget)
            self.setWindowTitle(u"视频帧节点 (Video Frame)")
            self.setMinimumWidth(580)
            self._worker = None
            self._build_ui()

        def _build_ui(self):
            layout = QtWidgets.QVBoxLayout(self)

            row = QtWidgets.QHBoxLayout()
            row.addWidget(QtWidgets.QLabel(u"视频文件"))
            self.edit_path = QtWidgets.QLineEdit()
            row.addWidget(self.edit_path, 1)
            btn_browse = QtWidgets.QPushButton(u"浏览...")
            btn_browse.clicked.connect(self._browse)
            row.addWidget(btn_browse)
            layout.addLayout(row)

            self.label_info = QtWidgets.QLabel(u"未选择视频")
            self.label_info.setWordWrap(True)
            layout.addWidget(self.label_info)

            grid = QtWidgets.QGridLayout()
            self.spin_start = QtWidgets.QSpinBox()
            self.spin_start.setRange(-100000, 100000)
            self.spin_start.setValue(1)
            self.spin_offset = QtWidgets.QSpinBox()
            self.spin_offset.setRange(-100000, 100000)
            self.spin_speed = QtWidgets.QDoubleSpinBox()
            self.spin_speed.setRange(0.01, 16.0)
            self.spin_speed.setSingleStep(0.1)
            self.spin_speed.setValue(1.0)
            self.spin_fps = QtWidgets.QDoubleSpinBox()
            self.spin_fps.setRange(0.0, 240.0)
            self.spin_fps.setDecimals(3)
            self.spin_fps.setToolTip(u"0 = 自动读取视频帧率")
            grid.addWidget(QtWidgets.QLabel(u"起始帧"), 0, 0)
            grid.addWidget(self.spin_start, 0, 1)
            grid.addWidget(QtWidgets.QLabel(u"帧偏移"), 0, 2)
            grid.addWidget(self.spin_offset, 0, 3)
            grid.addWidget(QtWidgets.QLabel(u"播放速度"), 0, 4)
            grid.addWidget(self.spin_speed, 0, 5)
            grid.addWidget(QtWidgets.QLabel(u"视频帧率"), 0, 6)
            grid.addWidget(self.spin_fps, 0, 7)

            self.combo_fmt = QtWidgets.QComboBox()
            self.combo_fmt.addItems(["PNG", "JPG"])
            self.spin_quality = QtWidgets.QSpinBox()
            self.spin_quality.setRange(1, 31)
            self.spin_quality.setValue(2)
            self.combo_scale = QtWidgets.QComboBox()
            for text, value in (("100%", 1.0), ("75%", 0.75),
                                ("50%", 0.5), ("25%", 0.25)):
                self.combo_scale.addItem(text, value)
            grid.addWidget(QtWidgets.QLabel(u"缓存格式"), 1, 0)
            grid.addWidget(self.combo_fmt, 1, 1)
            grid.addWidget(QtWidgets.QLabel(u"JPG 质量"), 1, 2)
            grid.addWidget(self.spin_quality, 1, 3)
            grid.addWidget(QtWidgets.QLabel(u"分辨率"), 1, 4)
            grid.addWidget(self.combo_scale, 1, 5)
            layout.addLayout(grid)

            opts = QtWidgets.QHBoxLayout()
            self.chk_loop = QtWidgets.QCheckBox(u"循环")
            self.chk_hold = QtWidgets.QCheckBox(u"超出保持首末帧")
            self.chk_hold.setChecked(True)
            self.chk_reverse = QtWidgets.QCheckBox(u"倒放")
            self.chk_preload = QtWidgets.QCheckBox(u"后台预取")
            self.chk_preload.setChecked(True)
            for chk in (self.chk_loop, self.chk_hold,
                        self.chk_reverse, self.chk_preload):
                opts.addWidget(chk)
            opts.addStretch(1)
            layout.addLayout(opts)

            buttons = QtWidgets.QHBoxLayout()
            btn_tex = QtWidgets.QPushButton(u"创建文件纹理")
            btn_tex.clicked.connect(self._create_texture)
            btn_plane = QtWidgets.QPushButton(u"创建图像平面")
            btn_plane.clicked.connect(self._create_plane)
            self.btn_precache = QtWidgets.QPushButton(u"预转码整段")
            self.btn_precache.clicked.connect(self._precache)
            btn_clear = QtWidgets.QPushButton(u"清理缓存")
            btn_clear.clicked.connect(self._clear)
            for btn in (btn_tex, btn_plane, self.btn_precache, btn_clear):
                buttons.addWidget(btn)
            layout.addLayout(buttons)

            self.bar = QtWidgets.QProgressBar()
            self.bar.setValue(0)
            layout.addWidget(self.bar)

            self.log = QtWidgets.QPlainTextEdit()
            self.log.setReadOnly(True)
            self.log.setMinimumHeight(120)
            layout.addWidget(self.log, 1)

            self.edit_path.editingFinished.connect(self._refresh_info)

        def _log(self, text):
            self.log.appendPlainText(text)

        def _browse(self):
            path, _filter = QtWidgets.QFileDialog.getOpenFileName(
                self, u"选择视频",
                os.path.dirname(self.edit_path.text().strip()) or "",
                u"视频文件 (*.mp4 *.mov *.mkv *.avi *.webm *.gif *.m4v "
                u"*.flv *.wmv *.mxf *.ts *.m2ts *.mpg *.mpeg *.ogv);;"
                u"所有文件 (*.*)")
            if path:
                self.edit_path.setText(path.replace("\\", "/"))
                self._refresh_info()

        def _refresh_info(self):
            path = self.edit_path.text().strip()
            if not path:
                self.label_info.setText(u"未选择视频")
                return
            info = probe_video(path)
            if not info:
                self.label_info.setText(u"无法读取视频信息（检查路径 / ffmpeg）")
                return
            self.label_info.setText(
                u"%s  |  %dx%d  |  %.3f fps  |  %d 帧  |  %.2f 秒%s" % (
                    os.path.basename(path), info["width"], info["height"],
                    info["fps"], info["frames"], info["duration"],
                    (u"  |  " + info["codec"]) if info["codec"] else u""))
            self.spin_start.setValue(1)

        def _settings(self):
            return {
                "start_frame": self.spin_start.value(),
                "offset": self.spin_offset.value(),
                "video_fps": self.spin_fps.value(),
                "speed": self.spin_speed.value(),
                "loop": self.chk_loop.isChecked(),
                "hold": self.chk_hold.isChecked(),
                "reverse": self.chk_reverse.isChecked(),
                "format": self.combo_fmt.currentIndex(),
                "quality": self.spin_quality.value(),
                "resolution": self.combo_scale.currentData(),
                "preload": self.chk_preload.isChecked(),
            }

        def _video(self):
            return self.edit_path.text().strip().replace("\\", "/")

        def _create_texture(self):
            try:
                result = create_video_texture(self._video(), **self._settings())
                self._log(u"已创建 file 纹理: %s" % result["file"])
                self._log(u"  视频节点: %s" % result["node"])
                self._log(u"  把 %s.outColor 接到材质即可" % result["file"])
                self._watch(result["node"])
            except Exception as err:
                self._log(u"创建失败: %s" % err)

        def _create_plane(self):
            try:
                result = create_video_image_plane(
                    self._video(), **self._settings())
                self._log(u"已创建图像平面: %s" % result["imagePlane"])
                self._log(u"  视频节点: %s" % result["node"])
                self._watch(result["node"])
            except Exception as err:
                self._log(u"创建失败: %s" % err)

        def _watch(self, node):
            self._node = node
            self.btn_precache.setEnabled(True)

        def _precache(self):
            node = getattr(self, "_node", None)
            if not node:
                self._log(u"请先创建节点")
                return
            self.btn_precache.setEnabled(False)
            self.bar.setValue(0)
            worker = PrecacheThread(node)
            worker.progress.connect(self._on_progress)
            worker.finished_msg.connect(self._on_precache_done)
            worker.finished.connect(worker.deleteLater)
            self._worker = worker
            worker.start()
            self._log(u"开始预转码...")

        def _on_progress(self, current, total):
            self.bar.setMaximum(max(1, total))
            self.bar.setValue(min(current, total))

        def _on_precache_done(self, message):
            self._log(message)
            self.btn_precache.setEnabled(True)

        def _clear(self):
            node = getattr(self, "_node", None)
            if not node:
                self._log(u"请先创建节点")
                return
            ok, message = clear_cache(node)
            self._log(message)
            self.bar.setValue(0)

    _WINDOW = Window(parent)
    _WINDOW.show()
    return _WINDOW


# ---------------------------------------------------------------------------
# 运行命令（市场「运行」按钮 -> cmds.createVideoFrame()）
# 创建一个默认 videoFrameNode 节点并接好 time，选中让用户在属性面板设置视频。
# ---------------------------------------------------------------------------
class CreateVideoFrameCommand(ompx.MPxCommand):
    kCommandName = "createVideoFrame"

    def __init__(self):
        ompx.MPxCommand.__init__(self)

    def doIt(self, args):
        node = create_video_node()
        try:
            import maya.cmds as cmds
            cmds.select(node, replace=True)
            self.setResult(node)
        except Exception:
            self.setResult(node)

    def isUndoable(self):
        return False

    @staticmethod
    def creator():
        return ompx.asMPxPtr(CreateVideoFrameCommand())


# ---------------------------------------------------------------------------
# 插件注册
# ---------------------------------------------------------------------------
def initializePlugin(mobject):
    plugin = ompx.MFnPlugin(mobject, "KangmingZhan", "1.0.0", "Any")
    try:
        plugin_dir = os.path.dirname(os.path.abspath(__file__))
        if plugin_dir not in sys.path:
            sys.path.append(plugin_dir)
    except Exception:
        pass
    try:
        plugin.registerNode(
            VideoFrameNode.kNodeName,
            kPluginNodeId,
            VideoFrameNode.nodeCreator,
            VideoFrameNode.nodeInitializer,
        )
        plugin.registerCommand(
            CreateVideoFrameCommand.kCommandName,
            CreateVideoFrameCommand.creator,
        )
        print(u"成功注册节点: %s" % VideoFrameNode.kNodeName)
    except Exception as err:
        sys.stderr.write(u"注册节点失败: %s, 错误: %s\n"
                         % (VideoFrameNode.kNodeName, err))
        raise


def uninitializePlugin(mobject):
    plugin = ompx.MFnPlugin(mobject)
    try:
        plugin.deregisterCommand(CreateVideoFrameCommand.kCommandName)
        plugin.deregisterNode(kPluginNodeId)
        print(u"成功注销节点: %s" % VideoFrameNode.kNodeName)
    except Exception as err:
        sys.stderr.write(u"注销节点失败: %s, 错误: %s\n"
                         % (VideoFrameNode.kNodeName, err))
        raise
