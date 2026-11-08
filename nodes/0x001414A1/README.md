# 视频转序列帧节点 (videoFrameNode)

> 节点 ID：`0x001414A1` ｜ 作者：詹康明 ｜ 版本：1.0.0

## 简介

Maya 原生只支持图片序列（`file` 节点的 `<f>` 帧扩展）。本插件提供一个 DG 节点
`videoFrameNode`：把任意格式的视频（mp4 / mov / mkv / avi / webm / gif / flv /
wmv / m4v / ts / mxf …，取决于本机 ffmpeg 的解码器）**实时抽成 PNG / JPG 序列帧**
缓存，并输出 Maya 能直接识别的 `<f>` 序列帧路径与帧号。

输出接到 `file` 纹理或 `imagePlane` 上，就能像播放普通序列帧一样在视口和渲染器里
播放视频——走的是 Maya 原生序列帧机制（有缓存、可渲染），而不是每帧换文件名硬刷新。

## 功能特性

- **任意视频格式**：依赖 ffmpeg 解码，支持 mp4 / mov / mkv / avi / webm / gif 等。
- **实时抽帧**：按当前时间把视频对应帧抽成 PNG/JPG 写入缓存，按需生成。
- **后台预取**：播放时后台线程提前抽后面的帧，避免卡顿。
- **整段预转码**：一键把整段视频转成序列帧缓存，播放完全流畅。
- **播放控制**：起始帧、帧偏移、播放速度、循环、超出保持首末帧、倒放。
- **分辨率缩放**：可按倍率缩放缓存分辨率，降低磁盘占用。
- **PNG / JPG**：PNG 无损；JPG 可调质量（1 最好，31 最差）。
- **视频帧率自动探测**：默认自动读取视频 fps，也可手动指定。
- **状态输出**：节点输出当前状态、是否有效、宽高、帧率、总帧数。
- **自带 GUI**：`cmds.openVideoFrame()` 打开操作窗口，浏览视频、设置参数、创建纹理/图像平面、预转码、清缓存。

## 依赖

需要本机安装 **ffmpeg** 和 **ffprobe**。查找顺序：

1. 环境变量 `MAYA_VIDEO_FFMPEG`（可指向 ffmpeg.exe 或其所在目录）
2. 环境变量 `VIDEO_FRAME_FFMPEG`、`MAYA_VIDEO_FFMPEG_DIR`、`VIDEO_FRAME_FFMPEG_DIR`
3. 插件目录及其 `bin/`、`tools/`、`tools/ffmpeg/bin/` 子目录
4. 系统 `PATH`
5. Windows winget 链接目录（`%LOCALAPPDATA%\Microsoft\WinGet\Links`）
6. 常见安装路径：`C:\ffmpeg\bin`、`C:\Program Files\ffmpeg\bin`、`/usr/local/bin` 等

找不到时节点的 `outStatus` 会提示，GUI 里也会报错。

安装 ffmpeg（Windows）：

```
winget install ffmpeg
```

或从 https://www.gyan.dev/ffmpeg/builds/ 下载，把 `bin` 目录加入 PATH，或设置
`MAYA_VIDEO_FFMPEG` 环境变量指向 `ffmpeg.exe`。

## 安装

在节点插件市场里点「安装」即可。安装后市场会自动加载插件。

手动加载：

```python
import maya.cmds as cmds
cmds.loadPlugin(r".../nodes/0x001414A1/video_frame_node.py")
```

## 使用方法

### 1. 图形界面（推荐）

```python
import maya.cmds as cmds
cmds.openVideoFrame()
```

在窗口里：
1. 点「浏览…」选择视频文件（自动探测分辨率 / 帧率 / 帧数）。
2. 设置起始帧、偏移、速度、格式、分辨率、循环等参数。
3. 点「创建文件纹理」或「创建图像平面」。
4. （可选）点「预转码整段」把整段视频转成缓存，播放最流畅。

### 2. 脚本创建 file 纹理

```python
import videoFrameNode
result = videoFrameNode.create_video_texture(
    r"D:/ref/action.mp4",
    name="videoFrame1",
    loop=True, hold=True, speed=1.0, format="png", resolution=1.0,
)
# result = {"node": 节点, "file": file节点, "place2d": place2d节点}
# 把 file 节点的 outColor 接到材质即可
```

### 3. 脚本创建图像平面

```python
result = videoFrameNode.create_video_image_plane(r"D:/ref/action.mp4")
# result = {"node": 节点, "imagePlane": 图像平面, "transform": 变换}
```

### 4. 只创建节点

```python
node = videoFrameNode.create_video_node(r"D:/ref/action.mp4", loop=True)
```

## 节点接线原理

```
time1.outTime ──────────────────► videoFrameNode.time
videoFrameNode.outFile ─────────► file.fileTextureName  (或 imagePlane.imageName)
videoFrameNode.outFrame ────────► file.frameExtension   (或 imagePlane.frameExtension)
                                  并打开 useFrameExtension
```

`outFile` 输出固定的 `.../f.<f>.png` 序列帧路径；`outFrame` 输出当前视频帧号。
目标节点走 Maya 原生序列帧机制。

## 节点属性

### 输入属性

| 属性 | 短名 | 类型 | 默认 | 说明 |
|------|------|------|------|------|
| `videoPath` | `vp` | string | "" | 视频文件路径 |
| `cacheRoot` | `cr` | string | 临时目录 | 缓存根目录 |
| `time` | `tm` | double | 0 | 当前时间（接 time1.outTime） |
| `startFrame` | `sf` | long | 1 | 起始帧 |
| `offset` | `off` | long | 0 | 帧偏移 |
| `videoFps` | `vfp` | double | 0 | 视频帧率，0=自动探测 |
| `speed` | `spd` | double | 1.0 | 播放速度 |
| `loop` | `lp` | bool | 关 | 循环 |
| `holdLast` | `hl` | bool | 开 | 超出范围时保持首/末帧 |
| `reverse` | `rev` | bool | 关 | 倒放 |
| `format` | `fmt` | enum | PNG | 缓存格式：PNG / JPG |
| `jpegQuality` | `jq` | long | 2 | JPG 质量，1 最好 31 最差 |
| `resolution` | `res` | double | 1.0 | 分辨率倍率（0.05–4.0） |
| `preload` | `pld` | bool | 开 | 后台预取 |
| `prefetchFrames` | `pfn` | long | 8 | 预取帧数（0–120） |

### 输出属性

| 属性 | 短名 | 类型 | 说明 |
|------|------|------|------|
| `outFile` | `of` | string | 序列帧路径 `f.<f>.<fmt>` |
| `outFrame` | `ofr` | double | 当前视频帧号 |
| `outWidth` | `ow` | long | 视频宽度 |
| `outHeight` | `oh` | long | 视频高度 |
| `outFps` | `ofp` | double | 视频帧率 |
| `outFrameCount` | `ofc` | long | 总帧数 |
| `outStatus` | `ost` | string | 状态信息 |
| `outValid` | `ovd` | bool | 是否有效 |

## 缓存机制

- 缓存目录：`{cacheRoot}/{sha1(视频路径|修改时间|大小|格式|质量|分辨率)}/`
- 帧文件名：`f.<帧号>.<格式>`
- 不同视频或不同参数会生成独立缓存目录，互不干扰。
- 已抽过的帧直接命中，不会重复抽。
- 「预转码整段」用 ffmpeg 一次性输出全部帧，比逐帧抽快得多。

## API 函数

| 函数 | 说明 |
|------|------|
| `find_tool(name)` | 定位 ffmpeg / ffprobe |
| `probe_video(path)` | 探测视频信息（带缓存） |
| `create_video_node(video, name, **kwargs)` | 创建节点并接好时间 |
| `create_video_texture(video, name, **kwargs)` | 创建节点 + file 纹理 + place2d |
| `create_video_image_plane(video, camera, name, **kwargs)` | 创建节点 + 图像平面 |
| `precache_all(node, progress_cb)` | 整段预转码 |
| `clear_cache(node)` | 清理当前参数的缓存 |
| `open_window()` | 打开 GUI 窗口 |

`**kwargs` 支持：`start_frame`、`offset`、`video_fps`、`speed`、`loop`、
`hold`、`reverse`、`format`（0=PNG, 1=JPG）、`quality`、`resolution`、
`preload`、`prefetch`、`cache_root`。

## 常见问题

**Q：提示找不到 ffmpeg？**
A：安装 ffmpeg 并加入 PATH，或设置环境变量 `MAYA_VIDEO_FFMPEG` 指向 `ffmpeg.exe`。

**Q：视频播放卡顿？**
A：用 GUI 里的「预转码整段」把整段视频转成缓存，或调大 `prefetchFrames`。

**Q：帧率对不上、播放速度不对？**
A：确保场景帧率和视频帧率一致；`create_video_texture` 前先设好场景帧率
（`cmds.currentUnit(time="25fps")` 之类）。`time1.outTime` 连接建立时 Maya 会
固化帧率换算，之后再改场景帧率映射会错位。

**Q：缓存占磁盘？**
A：缓存默认在系统临时目录 `maya_video_frame_cache` 下。可用 `clear_cache(node)`
清单个节点的缓存，或手动删整个目录。

**Q：支持哪些视频格式？**
A：取决于 ffmpeg 编译时的解码器。常见的 mp4(H.264/H.265)、mov、mkv、avi、webm、
gif、flv、wmv、m4v、ts、mxf 都支持。

## 自测版本

自测通过的 Maya 版本：**Maya 2025**。

其他版本（2022–2026 等）可能也能运行，但未逐一测试，部分功能可能失效。
本节点使用 `maya.OpenMaya` / `maya.OpenMayaMPx`（旧版 Python API），不依赖
PySide 之外的第三方库。
