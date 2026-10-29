# Maya 节点插件市场

作者：**詹康明 (Kangming Zhan)**

一个以 Maya **节点**为单位的插件市场。它扫描插件目录里的节点注册信息，自动生成卡片和加载 / 运行按钮；支持收藏、标签分类、解析缓存，以及从 GitHub 一键更新。

![插件市场图标](custom_commands_lcon.png)

## 功能

- **节点驱动**：插件文件夹名 = 节点注册序号（如 `0x00141488`），市场只识别节点，不把文件夹当插件。
- **卡片详情**：悬停显示作者写在 `NODE_INFO` 里的内容；双击卡片打开详情。
- **收藏**：卡片星标收藏，「收藏」页集中展示，按节点序号保存在本地。
- **标签分类**：`NODE_INFO.tags` 自动汇总成顶部标签栏，标签、搜索、收藏可以叠加筛选。
- **在线市场**：从 GitHub 索引仓库拉取 `catalog.json`，按分类/标签浏览，一键安装或更新插件；安装和更新都会显示阶段进度、当前操作和下载量。
- **场景依赖检测**：保存时把用到的节点插件写进场景 `fileInfo`（跟文件一起走）；打开文件时结合清单和 `unknownPlugin` 检测，缺插件会列出并支持一键安装 + 重开文件，避免节点变成 unknown 后丢数据（可在设置里关闭）。
- **在线筛选**：在线页支持标签多选（同时满足）、标签搜索、「只看未安装」、按更新日期/名称/序号排序，以及每页 24 个的分页。
- **更新信息**：卡片上显示「更新于 YYYY-MM-DD」；本地版本较旧时显示「可更新 → vX」，也可以点「更新全部」批量更新。
- **安全安装**：条目带 `sha256` 时安装前校验摘要；每次安装写入 `nodes/<序号>/.market.json` 记录来源和版本。
- **可回退**：安装/更新/删除前会把旧版本备份到 `nodes/.backup/<序号>-<时间>`，保留最近 5 份。
- **市场版本提示**：启动时比对 `version.json`，有新版本会在右上角「更新」按钮上提示。
- **加载 / 运行**：点「运行」会先尝试卸载再重新加载插件，窗口类插件不会因为模块缓存打不开。
- **文件夹直达**：每张卡片都有「文件夹」按钮，直接打开插件所在目录。
- **解析缓存**：按文件修改时间缓存解析结果，第二次打开直接命中；右上角「清缓存」会重新识别所有标签。
- **GitHub 更新**：点「更新」从本仓库下载最新代码并覆盖，不会动 `nodes/`、收藏、缓存和设置。
- **独立运行**：不依赖 ZKM 主插件的 `general_settings`，整个文件夹可以单独使用。

## 环境要求

- Autodesk Maya（PySide2 或 PySide6 均可）
- 无第三方 Python 依赖

## 安装 / 启动

把整个仓库文件夹放到任意目录，然后在 Maya 的 **Script Editor → Python** 中运行：

```python
import sys
sys.path.append(r"D:/maya-node-plugin-market")
import custom_commands_window
custom_commands_window.window.show()
```

也可以：

- 运行 `open_window.py` 直接打开窗口；
- 运行 `install.py` 在当前工具架添加一个「节点插件市场」按钮。

第一次打开会自动创建 `nodes/` 目录。

## 插件目录约定

```
maya-node-plugin-market/
├─ nodes/
│  └─ 0x00141488/              文件夹名 = 节点的注册序号
│     ├─ my_plugin.py          通过 registerNode 注册节点的插件
│     ├─ icon.png              可选，卡片图标
│     └─ ...                   插件依赖的其它文件
├─ custom_commands_window.py   市场界面
├─ node_market.py              扫描 / 解析 / 加载 / 运行
├─ install.py                  工具架安装脚本
├─ open_window.py              独立启动脚本
└─ custom_commands_lcon.png    图标
```

- 文件夹名必须是节点的注册序号，用来防止节点和插件重名。
- 市场会识别 `.py` 里的 `registerNode` / `MTypeId` / `MFnPlugin`，没有 `NODE_INFO` 时自动从文档字符串和注册参数推导详情。
- `nodes/`、`market_state.json`、`market_cache.json`、`market_settings.json` 属于本地数据，不进入 git。

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
2. 只覆盖市场代码（`custom_commands_window.py`、`node_market.py`、`online_market.py`、`install.py`、`open_window.py`、图标）；
3. 不会覆盖 `nodes/` 插件、收藏、缓存和设置；
4. 关闭并重新打开市场后生效。

## 注意

- 首次从市场加载第三方插件时，Maya 会弹出 **Untrusted Plugin Loading** 安全提示；勾选「Apply to all plugins in this location」再点「允许」，之后同一目录不再提示。
- 插件是第三方代码，请只加载自己信任的来源。
