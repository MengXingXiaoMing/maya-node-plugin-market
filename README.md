# Maya 节点插件市场

作者：**詹康明 (Kangming Zhan)**

一个以 Maya **节点**为单位的插件市场。它扫描插件目录里的节点注册信息，自动生成卡片和加载 / 运行按钮；支持收藏、标签分类、解析缓存、多用户数据隔离，以及从 GitHub 一键更新。

![插件市场图标](custom_commands_lcon.png)

## 功能

- **节点驱动**：插件文件夹名 = 节点注册序号（如 `0x00141488`），市场只识别节点，不把文件夹当插件。
- **卡片详情**：悬停显示作者写在 `NODE_INFO` 里的内容；双击卡片打开详情。
- **收藏**：卡片星标收藏，「收藏」页集中展示，按节点序号保存。
- **标签分类**：`NODE_INFO.tags` 自动汇总成顶部标签栏，标签、搜索、收藏可以叠加筛选。
- **在线市场**：从 GitHub 索引仓库拉取 `catalog.json`，按分类/标签浏览，一键安装或更新插件；安装和更新都会显示阶段进度、当前操作和下载量。
- **场景依赖检测**：保存时把用到的节点插件写进场景 `fileInfo`（跟文件一起走）；打开文件时结合清单和 `unknownPlugin` 检测，缺插件会列出并支持一键安装 + 重开文件，避免节点变成 unknown 后丢数据（可在设置里关闭）。
- **在线筛选**：在线页支持标签多选（同时满足）、标签搜索、「只看未安装」、按更新日期/名称/序号排序，以及每页 24 个的分页。
- **更新信息**：卡片上显示「更新于 YYYY-MM-DD」；本地版本较旧时显示「可更新 → vX」，也可以点「更新全部」批量更新。
- **安全安装**：条目带 `sha256` 时安装前校验摘要；每次安装写入 `nodes/<序号>/.market.json` 记录来源和版本。
- **可回退**：安装/更新/删除前会把旧版本备份到 `nodes/.backup/<序号>-<时间>`，保留最近 5 份。
- **市场版本提示**：启动时比对 `version.json`，有新版本会在右上角「更新」按钮上提示。
- **多用户隔离**：个人设置（`settings.json`）与收藏（`state.json`）按用户名隔离在 `user_data/<用户名>/` 下，多人共用一台机器/服务器互不干扰；`nodes/`、解析缓存仍为共享。首次启动弹登录框（默认取系统用户名，可勾选自动登录），登录记录存在本机 `%APPDATA%/ZKMNodeMarket/login.json`；设置页可「切换用户」，旧的共享设置/收藏会自动迁移到首个登录用户名下。
- **启动环境检查**：打开市场前自动检测运行依赖。缺依赖时弹出与主窗口同款深色无边框的检查框，逐条列出，支持「一键安装」（后台调 `mayapy -m pip install`）和「下载」（浏览器打开 PyPI 页面）。必需依赖（PySide6/PySide2）未装好不能继续；可选依赖（如 `requests`，缺失时自动改用内置 urllib）仅提示。可勾选「下次忽略可选依赖」，设置页也有对应开关。
- **无边框窗口**：窗口为无边框 + 自定义深色标题栏，支持拖动标题栏移动、拖 8 个边/角缩放（最小 720×520）、双击标题栏最大化/还原，右上角有最小化/最大化/关闭按钮。
- **响应式网格**：卡片网格随窗口宽度在 1–6 列间实时重排；切换「在线」页不会因重建卡片而闪烁。
- **加载 / 运行**：点「运行」会先尝试卸载再重新加载插件，窗口类插件不会因为模块缓存打不开。
- **文件夹直达**：每张卡片都有「文件夹」按钮，直接打开插件所在目录。
- **解析缓存**：按文件修改时间缓存解析结果，第二次打开直接命中；右上角「清缓存」会重新识别所有标签。
- **GitHub 更新**：点「更新」从本仓库下载最新代码并覆盖，不会动 `nodes/`、收藏、缓存和各用户设置。
- **独立运行**：不依赖 ZKM 主插件的 `general_settings`，整个文件夹可以单独使用。

## 环境要求

- Autodesk Maya（PySide2 或 PySide6 均可）
- 可选：`requests`（在线市场加速；缺失时自动回退到内置 urllib）

## 安装 / 启动

只需一个文件：**`install.py`**。把它直接拖进 Maya 视窗即可——它会先做环境检查，然后在当前工具架创建一个「节点插件市场」按钮（用市场自带图标，已存在则不重复创建），并立即打开市场窗口。之后点工具架按钮即可再次打开。

也可以在 Script Editor → Python 中运行：

```python
import sys
sys.path.append(r"D:/maya-node-plugin-market")
import custom_commands_window
custom_commands_window.window.show()
```

第一次打开会自动创建 `nodes/` 目录。

## 插件目录约定

```
maya-node-plugin-market/
├─ install.py                唯一安装/启动入口（拖进 Maya 即可）
├─ nodes/
│  └─ 0x00141488/              文件夹名 = 节点的注册序号
│     ├─ my_plugin.py          通过 registerNode 注册节点的插件
│     ├─ icon.png              可选，卡片图标
│     └─ ...                   插件依赖的其它文件
├─ custom_commands_window.py   市场界面（发现 / 在线 / 收藏 / 已加载 / 设置）
├─ node_market.py              扫描 / 解析 / 加载 / 运行
├─ online_market.py            在线索引读取与下载安装
├─ scene_requirements.py       场景节点依赖检测
├─ custom_commands_lcon.png    图标
└─ user_data/<用户名>/         个人设置 settings.json 与收藏 state.json（按用户隔离）
```

- 文件夹名必须是节点的注册序号，用来防止节点和插件重名。
- 市场会识别 `.py` 里的 `registerNode` / `MTypeId` / `MFnPlugin`，没有 `NODE_INFO` 时自动从文档字符串和注册参数推导详情。
- `nodes/`、`user_data/`、`market_cache.json`、`market_catalog_cache.json` 属于本地数据，不进入 git。

## NODE_INFO

作者在插件文件顶部写 `NODE_INFO`，市场卡片悬停和详情弹窗显示的就是这里的内容：

```python
NODE_INFO = {
    "name": "魔方绑定",
    "description": "程序化生成任意尺寸的魔方绑定……",
    "author": "詹康明",
    "version": "2.0.0",
    "node": "rubikCubeNode",
    "node_id": "0x00141488",
    "run": "cmds.rubikCube()",
    "tags": ["绑定", "程序化"],
    "icon": "icon.png",
    "github": "https://github.com/...",
}
```

运行顺序：`NODE_INFO.run` → 注册命令 → 创建节点。

## 在线目录

在线目录来自单独的索引仓库：

https://github.com/MengXingXiaoMing/maya-node-plugin-index

市场打开时会优先从 jsDelivr 读取 `catalog.json`，失败时回退到 GitHub raw，并使用本地缓存。索引仓库里的一个插件对应一条 `plugins/<node_id>.json`，安装时下载作者仓库的 zip，校验节点序号和 `NODE_INFO` 后复制到 `nodes/<node_id>/`。

索引条目支持：

- `repo` + `subpath`：GitHub 源码安装
- `asset`：GitHub Release 预构建 zip/tgz
- `version`：市场用它判断安装 / 更新
- `category`、`tags`、`maya_versions`：分类和标签栏

## 更新

窗口右上角「更新」或设置页「从 GitHub 更新市场」：

1. 从本仓库下载最新 zip；
2. 只覆盖市场代码（`custom_commands_window.py`、`node_market.py`、`online_market.py`、`scene_requirements.py`、`install.py`、图标）；
3. 不会覆盖 `nodes/` 插件、收藏、缓存和各用户设置；
4. 关闭并重新打开市场后生效。

## 注意

- 首次从市场加载第三方插件时，Maya 会弹出 **Untrusted Plugin Loading** 安全提示；勾选「Apply to all plugins in this location」再点「允许」，之后同一目录不再提示。
- 插件是第三方代码，请只加载自己信任的来源。
