# -*- coding: utf-8 -*-
u"""videoFrameNode 效果演示 / 自测脚本
=====================================

在 Maya 的脚本编辑器中运行（Python 标签页）：:

    exec(open(r".../nodes/0x001414A1/test_video_frame_node.py", encoding="utf-8").read())

也可以在节点插件市场里点本节点的「运行」按钮，会自动执行本脚本。

它会自动完成这些事：

1. 加载 videoFrameNode 插件（已加载则跳过）；
2. 你填了 VIDEO_PATH 就用你的视频，没填就用 ffmpeg 现生成一段
   4 秒 640x360 / 25fps 的测试视频（testsrc2 彩条，画面逐帧变化明显）；
3. 把视频整段预转码到缓存（播放不卡）；
4. 建一块 16:9 的屏幕，贴上视频纹理（也可改成图像平面）；
5. 场景帧率设成视频帧率、时间轴设成视频长度，并自动播放；
6. 在输出窗口打印关键校验信息（尺寸/帧率/帧号映射/抽出的帧文件）。

脚本结束时可以直接按空格停止播放；再用时间滑块拖动即可逐帧查看。
想用自己的视频：把下面的 VIDEO_PATH 改成视频绝对路径。

注意：为了让视频 1:1 播放，脚本会修改当前场景的**时间单位**和**时间轴范围**
（并删除上一次同名演示节点），请在空场景或测试场景里运行。
"""

import hashlib
import os
import subprocess
import sys
import tempfile

import maya.cmds as cmds

# ===========================================================================
# 可调参数
# ===========================================================================
VIDEO_PATH = u""            # 留空 = 自动生成测试视频；也可填 "D:/ref/action.mp4"
DEMO_SECONDS = 4.0          # 自动生成的测试视频时长（秒）
DEMO_FPS = 25.0             # 自动生成的测试视频帧率
DEMO_SIZE = (640, 360)      # 自动生成的测试视频分辨率

MAKE_SCREEN = True          # 建一块贴视频纹理的屏幕
MAKE_IMAGE_PLANE = False    # 再建一个图像平面（参考视频常用，和屏幕叠加会重复，按需打开）
AUTO_PLAY = True            # 建完后自动开始播放

# 插件所在目录（脚本编辑器里没有 __file__，用插件目录兜底）
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    # 手动 exec 时 __file__ 未定义，从已知的几种可能位置推导
    for _cand in (
        os.path.abspath(r"e:\code\my_code\IterativeVersion\Maya_PY3_plug-in_2025\ui\qt_ui\custom_commands\nodes\0x001414A1"),
        os.path.abspath(r"e:\code\my_code\IterativeVersion\Maya_PY3_plug-in_2025\2023\node"),
    ):
        if os.path.isfile(os.path.join(_cand, "video_frame_node.py")) or \
           os.path.isfile(os.path.join(_cand, "videoFrameNode.py")):
            HERE = _cand
            break
    else:
        HERE = os.getcwd()

PLUGIN_FILE = os.path.join(HERE, "video_frame_node.py")
if not os.path.isfile(PLUGIN_FILE):
    PLUGIN_FILE = os.path.join(HERE, "videoFrameNode.py")
# Maya 用文件名（去扩展名）作为 Python 插件的注册名
PLUGIN_NAME = os.path.splitext(os.path.basename(PLUGIN_FILE))[0]
NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def _log(msg):
    print(u"[videoFrameNode 演示] " + msg)


def _md5(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.md5(fh.read()).hexdigest()
    except Exception:
        return "-"


# ---------------------------------------------------------------------------
# 1. 插件
# ---------------------------------------------------------------------------
def ensure_plugin():
    if not os.path.isfile(PLUGIN_FILE):
        raise RuntimeError(u"找不到插件文件: %s" % PLUGIN_FILE)

    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    # 模块缓存会让 unloadPlugin 报 "still in use"，重载前必须清掉。
    # 新文件名是 video_frame_node.py（模块名 video_frame_node），
    # 旧文件名是 videoFrameNode.py（模块名 videoFrameNode），两个都清。
    for _modname in ("videoFrameNode", "video_frame_node"):
        sys.modules.pop(_modname, None)

    loaded = False
    try:
        loaded = bool(cmds.pluginInfo(PLUGIN_NAME, query=True, loaded=True))
    except Exception:
        loaded = False

    if loaded:
        # 已经加载过时尝试重载，保证跑的是磁盘上的最新代码
        try:
            cmds.unloadPlugin(PLUGIN_NAME)
            loaded = False
            _log(u"已卸载旧插件，重新加载最新代码")
        except Exception as err:
            _log(u"插件已在当前会话里加载，Maya 不允许热重载；若结果与预期不符，"
                 u"请重启 Maya 后重跑本脚本（%s）" % err)

    if not loaded:
        cmds.loadPlugin(PLUGIN_FILE)
        _log(u"插件已加载: %s" % PLUGIN_FILE)

    import importlib
    vfn = importlib.import_module(PLUGIN_NAME)
    return vfn


# ---------------------------------------------------------------------------
# 2. 测试视频
# ---------------------------------------------------------------------------
def prepare_video(vfn):
    if VIDEO_PATH:
        path = os.path.abspath(VIDEO_PATH)
        if not os.path.isfile(path):
            raise RuntimeError(u"VIDEO_PATH 指向的文件不存在: %s" % path)
        _log(u"使用指定视频: %s" % path)
        return path

    ffmpeg = vfn.find_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError(
            u"找不到 ffmpeg。装好 ffmpeg 后设置环境变量 MAYA_VIDEO_FFMPEG "
            u"指向 ffmpeg.exe，或在 VIDEO_PATH 里填一个视频文件。")

    folder = os.path.join(tempfile.gettempdir(), "maya_video_frame_demo")
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as err:
        raise RuntimeError(u"无法创建临时目录: %s" % err)

    path = os.path.join(
        folder, "demo_%dx%d_%gfps_%gs.mp4" % (
            DEMO_SIZE[0], DEMO_SIZE[1], DEMO_FPS, DEMO_SECONDS))
    if os.path.isfile(path) and os.path.getsize(path) > 1024:
        _log(u"复用已生成的测试视频: %s" % path)
        return path

    src = "testsrc2=size=%dx%d:rate=%g:duration=%g" % (
        DEMO_SIZE[0], DEMO_SIZE[1], DEMO_FPS, DEMO_SECONDS)
    attempts = (
        ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"],
        ["-c:v", "mpeg4", "-q:v", "3"],
    )
    for extra in attempts:
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
               "-f", "lavfi", "-i", src, "-pix_fmt", "yuv420p"] + extra + [path]
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL,
                           creationflags=NO_WINDOW, timeout=120)
        except Exception:
            pass
        if os.path.isfile(path) and os.path.getsize(path) > 1024:
            _log(u"已生成测试视频: %s" % path)
            return path
    raise RuntimeError(u"测试视频生成失败（ffmpeg 缺编码器？）请改用 VIDEO_PATH")


# ---------------------------------------------------------------------------
# 3. 场景装配
# ---------------------------------------------------------------------------
def clean_previous():
    """删掉上一次演示建的东西，重复运行不会越堆越多。"""
    targets = []
    for pattern in ("demoVideoFrame*", "demoVideoScreen*",
                    "demoVideoPlace2d", "demoVideoMat*",
                    "demoVideoPlane*"):
        targets += cmds.ls(pattern) or []
    if targets:
        cmds.delete(list(set(targets)))
        _log(u"已清理上次演示节点: %d 个" % len(set(targets)))


def force_textured_view():
    """让视口显示贴图，不然只能看到灰模。"""
    try:
        panels = cmds.getPanel(type="modelPanel") or []
        if not panels:
            return
        focus = cmds.getPanel(withFocus=True)
        panel = focus if focus in panels else panels[0]
        cmds.modelEditor(panel, edit=True,
                         displayTextures=True, displayLights="default")
    except Exception:
        pass


def make_screen(texture_attr, width, height):
    """建一块面向 persp 相机的屏幕，贴视频纹理。"""
    res = cmds.polyPlane(width=width, height=height,
                         subdivisionsX=1, subdivisionsY=1,
                         name="demoVideoScreen", ch=False)
    transform = res[0]
    shape = (cmds.listRelatives(transform, shapes=True) or [transform])[0]
    cmds.xform(transform, translation=(0, 0, -8), rotation=(90, 0, 0))

    shader = cmds.shadingNode("lambert", asShader=True, name="demoVideoMat")
    sg = cmds.sets(renderable=True, noSurfaceShader=True, empty=True,
                   name="demoVideoMatSG")
    cmds.connectAttr(shader + ".outColor", sg + ".surfaceShader", force=True)
    cmds.connectAttr(texture_attr, shader + ".color", force=True)
    cmds.sets(shape, edit=True, forceElement=sg)
    return transform


def make_image_plane(texture_attr):
    """建图像平面（相机视图里直接看视频）。"""
    created = cmds.imagePlane(camera="persp") or []
    plane = ""
    for item in cmds.ls(created, long=False) or created:
        try:
            if cmds.nodeType(item) == "imagePlane":
                plane = item
                break
        except Exception:
            continue
    if not plane:
        raise RuntimeError(u"图像平面创建失败")
    plane = cmds.rename(plane, "demoVideoPlaneShape")
    cmds.setAttr(plane + ".useFrameExtension", 1)
    cmds.connectAttr(texture_attr, plane + ".imageName", force=True)
    return plane


# ---------------------------------------------------------------------------
# 4. 时间轴
# ---------------------------------------------------------------------------
def set_scene_fps(fps):
    """把场景帧率对齐到视频帧率，保证 1:1 播放。"""
    for name in ("%gfps" % fps, ):
        try:
            cmds.currentUnit(time=name)
            return name
        except Exception:
            pass
    for name, value in (("pal", 25.0), ("film", 24.0),
                        ("ntsc", 30.0), ("60fps", 60.0)):
        if abs(value - fps) < 0.01:
            try:
                cmds.currentUnit(time=name)
                return name
            except Exception:
                pass
    return cmds.currentUnit(query=True, time=True)


def setup_timeline(scene_fps, duration):
    total = max(1, int(round(duration * scene_fps)))
    end = 1 + total - 1
    cmds.playbackOptions(minTime=1, maxTime=end,
                         animationStartTime=1, animationEndTime=end,
                         loop="continuous",
                         playbackSpeed=0)   # 0 = 每帧都播，不丢帧
    cmds.currentTime(1, edit=True)
    return 1, end


# ---------------------------------------------------------------------------
# 5. 校验：帧号映射 + 抽出的帧文件
# ---------------------------------------------------------------------------
def verify(vfn, node, fmt, times):
    folder = os.path.dirname(cmds.getAttr(node + ".outFile") or "")
    rows = []
    for t in times:
        cmds.currentTime(t, edit=True)
        frame = int(round(cmds.getAttr(node + ".outFrame")))
        target = os.path.join(folder, vfn.frame_filename(frame, fmt))
        exists = os.path.isfile(target)
        rows.append((t, frame, exists, _md5(target)[:8]))
    return rows


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    clean_previous()          # 先删掉上次的演示节点，插件才可能被卸载重载
    vfn = ensure_plugin()
    info = vfn.probe_video(prepare_video(vfn))
    if not info:
        raise RuntimeError(u"无法读取视频信息，检查 ffmpeg / 视频格式")
    video = info["path"]

    _log(u"视频信息: %dx%d  %.3f fps  %d 帧  %.2f 秒  codec=%s" % (
        info["width"], info["height"], info["fps"],
        info["frames"], info["duration"], info["codec"] or "?"))

    batch = cmds.about(batch=True)

    # 注意：场景帧率必须在建节点之前设好。time1.outTime 连到节点的 double
    # 输入时，Maya 会按"连接建立那一刻"的场景帧率固化一个单位换算，
    # 之后再改帧率映射就对不上了。
    unit = set_scene_fps(info["fps"])
    _log(u"场景帧率已设为: %s (%.3f fps)" % (unit, vfn._maya_fps()))

    # --- 视频节点 + file 纹理 ---
    result = vfn.create_video_texture(video, name="demoVideoFrame1",
                                      loop=True, hold=True)
    node, file_node, place2d = result["node"], result["file"], result["place2d"]
    cmds.rename(place2d, "demoVideoPlace2d")
    _log(u"节点: %s   纹理: %s" % (node, file_node))

    # 旧代码自检：当前会话若加载的是旧版插件（Maya 无法热重载），
    # 输出会全是 0（旧代码用 MDataHandle.setLong，会抛 AttributeError）。
    cmds.currentTime(1, edit=True)
    if int(cmds.getAttr(node + ".outWidth") or 0) <= 0:
        raise RuntimeError(
            u"当前 Maya 会话里注册的 videoFrameNode 是旧版本代码，只能重启 Maya "
            u"才能清掉（Python 插件创建过节点后无法热重载）。")

    # --- 整段预转码，播放才流畅 ---
    last = [0]

    def progress(done, total):
        if not total or done == last[0]:
            return
        if done == total or done - last[0] >= max(1, total // 4):
            last[0] = done
            _log(u"预转码 %d / %d 帧" % (done, total))

    ok, msg = vfn.precache_all(node, progress_cb=progress)
    _log(msg if ok else (u"预转码失败（不影响使用，只是播放会边抽边播）: " + msg))

    # --- 场景装配 ---
    width = 6.4
    height = 6.4 * float(info["height"]) / float(info["width"])
    if MAKE_SCREEN:
        screen = make_screen(file_node + ".outColor", width, height)
        _log(u"已创建视频屏幕: %s" % screen)
    if MAKE_IMAGE_PLANE:
        try:
            plane = make_image_plane(node + ".outFile")
            _log(u"已创建图像平面: %s" % plane)
        except Exception as err:
            _log(u"图像平面创建失败（可忽略）: %s" % err)

    # --- 时间轴 ---
    start, end = setup_timeline(vfn._maya_fps(), info["duration"])
    _log(u"时间轴: %d - %d" % (start, end))

    # --- 校验 ---
    fmt = "jpg" if int(cmds.getAttr(node + ".format")) == 1 else "png"
    samples = sorted({start, start + (end - start) // 4,
                      start + (end - start) // 2, end})
    rows = verify(vfn, node, fmt, samples)
    _log(u"帧号映射 / 抽帧结果：")
    for t, frame, exists, digest in rows:
        _log(u"    时间 %-4d -> 视频帧 %-4d  文件 %s  md5 %s" % (
            t, frame, u"命中" if exists else u"缺失", digest))
    digests = [d for _, _, ok, d in rows if ok]
    if len(digests) >= 2:
        _log(u"抽帧内容校验: %s" % (
            u"各帧画面不同（正常）" if len(set(digests)) == len(digests)
            else u"注意：有帧内容相同，请检查视频"))

    # --- 信息汇总 ---
    _log(u"outFile  = %s" % cmds.getAttr(node + ".outFile"))
    _log(u"outStatus= %s" % (cmds.getAttr(node + ".outStatus") or "-"))
    _log(u"outValid = %s" % cmds.getAttr(node + ".outValid"))
    _log(u"缓存目录 = %s" % os.path.dirname(cmds.getAttr(node + ".outFile")))

    force_textured_view()
    cmds.currentTime(start, edit=True)
    if not batch:
        cmds.select(clear=True)
        if AUTO_PLAY:
            cmds.play(forward=True)
            _log(u"已开始播放（空格暂停）。提示：视口按 6 可切换为着色+纹理显示。")
        else:
            _log(u"按播放键或拖动时间滑块即可看到视频逐帧播放。")
    else:
        _log(u"批处理模式，跳过播放。")

    _log(u"完成。想换成自己的视频：改脚本顶部的 VIDEO_PATH 后重跑本脚本。")


# 无论是脚本编辑器运行还是市场「运行」按钮 exec，都直接执行演示
main()
