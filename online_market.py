# -*- coding: utf-8 -*-
"""在线节点插件目录：拉取 GitHub 索引、缓存、安装和更新。

索引仓库：https://github.com/MengXingXiaoMing/maya-node-plugin-index
市场只读取一份 catalog.json；安装时下载作者仓库的 zip，校验节点序号后
复制到 nodes/<node_id>/，不会碰收藏、缓存和设置。
"""

from __future__ import absolute_import, unicode_literals

import hashlib
import io
import json
import os
import re
import shutil
import tarfile
import tempfile
import time
import zipfile

try:
    from urllib.request import Request as UrlRequest, urlopen
except ImportError:  # Python 2
    from urllib2 import Request as UrlRequest, urlopen

import node_market

INDEX_OWNER = "MengXingXiaoMing"
INDEX_REPO = "maya-node-plugin-index"
INDEX_BRANCH = "main"
INDEX_URL = "https://github.com/%s/%s" % (INDEX_OWNER, INDEX_REPO)
CACHE_VERSION = 1
USER_AGENT = "MayaNodeMarket/2.5"


class Cancelled(Exception):
    pass


def catalog_urls():
    """GitHub API 最实时；jsDelivr 对 @main 有 12 小时缓存，作为备用。"""
    stamp = int(time.time())
    return [
        {
            "url": "https://api.github.com/repos/%s/%s/contents/catalog.json?ref=%s" % (
                INDEX_OWNER, INDEX_REPO, INDEX_BRANCH),
            "headers": {"Accept": "application/vnd.github.raw"},
            "label": "GitHub API",
        },
        {
            "url": "https://cdn.jsdelivr.net/gh/%s/%s@%s/catalog.json?t=%d" % (
                INDEX_OWNER, INDEX_REPO, INDEX_BRANCH, stamp),
            "headers": {},
            "label": "jsDelivr",
        },
        {
            "url": "https://raw.githubusercontent.com/%s/%s/%s/catalog.json?t=%d" % (
                INDEX_OWNER, INDEX_REPO, INDEX_BRANCH, stamp),
            "headers": {},
            "label": "GitHub Raw",
        },
    ]


def _read_url(url, timeout, headers=None):
    merged = {"User-Agent": USER_AGENT}
    if headers:
        merged.update(headers)
    request = UrlRequest(url, headers=merged)
    response = urlopen(request, timeout=timeout)
    try:
        return response.read()
    finally:
        response.close()


def fetch_catalog(timeout=15):
    errors = []
    for source in catalog_urls():
        try:
            raw = _read_url(source["url"], timeout, source.get("headers"))
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("plugins"), list):
                raise ValueError("目录缺少 plugins 列表")
            data["_source_url"] = source["url"]
            data["_source_label"] = source.get("label") or "在线目录"
            data["_fetched_at"] = time.time()
            return data
        except Exception as exc:
            errors.append("%s\n  %s" % (source["url"], exc))
    raise IOError("无法获取在线目录：\n" + "\n".join(errors))


def load_catalog_cache(path):
    if not path or not os.path.isfile(path):
        return None, 0
    try:
        with io.open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if payload.get("version") != CACHE_VERSION:
            return None, 0
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("plugins"), list):
            return None, 0
        return data, float(payload.get("fetched_at") or 0)
    except Exception:
        return None, 0


def save_catalog_cache(path, data):
    if not path:
        return
    try:
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "version": CACHE_VERSION,
                "fetched_at": time.time(),
                "data": data,
            }, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        pass


def category_label(categories, category):
    value = (categories or {}).get(category)
    if isinstance(value, dict):
        return value.get("zh") or value.get("en") or category
    if isinstance(value, str):
        return value
    return category or ""


class CatalogEntry(object):
    """把 catalog 里的一个条目包装成市场卡片能用的对象。"""

    def __init__(self, raw, categories=None):
        self.raw = raw or {}
        self.categories = categories or {}
        self.node_id = node_market.normalize_node_id(
            self.raw.get("node_id") or self.raw.get("id"))
        self.node_id_text = node_market.node_id_hex(self.node_id)
        self.title = node_market.to_text(self.raw.get("name") or self.node_id_text)
        self.description = node_market.to_text(self.raw.get("description"))
        self.author = node_market.to_text(self.raw.get("author"))
        self.version = node_market.to_text(self.raw.get("version"))
        self.node_name = node_market.to_text(self.raw.get("node_name"))
        self.category = node_market.to_text(self.raw.get("category"))
        self.category_label = category_label(self.categories, self.category)
        self.tags = [node_market.to_text(tag) for tag in (self.raw.get("tags") or [])
                     if node_market.to_text(tag).strip()]
        self.all_tags = []
        for tag in [self.category_label] + self.tags:
            if tag and tag not in self.all_tags:
                self.all_tags.append(tag)
        self.repo = node_market.to_text(self.raw.get("repo"))
        self.subpath = node_market.to_text(self.raw.get("subpath")).strip("/\\")
        self.entry = node_market.to_text(self.raw.get("entry"))
        self.branch = node_market.to_text(self.raw.get("branch")) or INDEX_BRANCH
        self.asset = node_market.to_text(self.raw.get("asset") or self.raw.get("tarball"))
        self.sha256 = node_market.to_text(self.raw.get("sha256") or self.raw.get("digest"))
        self.icon = node_market.to_text(self.raw.get("icon"))
        self.run = node_market.to_text(self.raw.get("run"))
        self.github = node_market.to_text(self.raw.get("github")) or (
            "https://github.com/%s" % self.repo if self.repo else "")
        self.maya_versions = [node_market.to_text(v) for v in (self.raw.get("maya_versions") or [])]
        self.added = node_market.to_text(self.raw.get("added"))
        self.updated = node_market.to_text(
            self.raw.get("updated") or self.raw.get("modified") or self.raw.get("added"))
        self.path = ""
        self.commands = []

    @property
    def key(self):
        return self.node_id_text

    def search_text(self):
        return " ".join([
            self.title, self.description, self.author, self.node_name,
            self.node_id_text, self.category_label, " ".join(self.tags),
        ]).lower()


def entries_from_catalog(catalog):
    entries = []
    seen = set()
    categories = (catalog or {}).get("categories") or {}
    for raw in (catalog or {}).get("plugins") or []:
        try:
            entry = CatalogEntry(raw, categories)
        except Exception:
            continue
        if entry.node_id is None or entry.node_id in seen:
            continue
        if not entry.repo and not entry.asset:
            continue
        seen.add(entry.node_id)
        entries.append(entry)
    return entries


def version_tuple(value):
    """1.0 和 1.0.0 视为同一个版本，避免位数不同导致误判可更新。"""
    parts = [int(part) for part in re.findall(r"\d+", str(value or ""))[:4]]
    parts += [0] * (4 - len(parts))
    return tuple(parts)


def is_newer(new_version, old_version):
    return version_tuple(new_version) > version_tuple(old_version)


def maya_major(version_text):
    match = re.search(r"20\d{2}", str(version_text or ""))
    return match.group(0) if match else ""


def supports_maya(entry, version_text):
    """条目没写 maya_versions 时视为不限制版本。"""
    wanted = maya_major(version_text)
    if not entry.maya_versions or not wanted:
        return True
    return any(wanted == maya_major(item) for item in entry.maya_versions)


BACKUP_KEEP = 5


def _prune_backups(backup_root, node_id_text, keep=BACKUP_KEEP):
    try:
        names = sorted(
            (name for name in os.listdir(backup_root)
             if name.startswith(node_id_text + "-")), reverse=True)
    except OSError:
        return
    for name in names[keep:]:
        shutil.rmtree(os.path.join(backup_root, name), ignore_errors=True)


def backup_plugin_folder(target, node_id_text):
    """把旧版本挪到 nodes/.backup/<序号>-<时间>，保留最近几份方便回退。"""
    backup_root = os.path.join(os.path.dirname(target), ".backup")
    if not os.path.isdir(backup_root):
        os.makedirs(backup_root)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(backup_root, "%s-%s" % (node_id_text, stamp))
    index = 1
    while os.path.exists(path):
        index += 1
        path = os.path.join(backup_root, "%s-%s-%d" % (node_id_text, stamp, index))
    shutil.move(target, path)
    _prune_backups(backup_root, node_id_text)
    return path


def human_bytes(value):
    try:
        value = int(value)
    except Exception:
        return "0 B"
    if value >= 1024 * 1024:
        return "%.1f MB" % (value / (1024.0 * 1024.0))
    if value >= 1024:
        return "%.1f KB" % (value / 1024.0)
    return "%d B" % value


MARKET_REPO = "maya-node-plugin-market"


def fetch_remote_version(timeout=10):
    """读取市场仓库的 version.json，用来提示客户端有新版本。"""
    stamp = int(time.time())
    sources = [
        {
            "url": "https://api.github.com/repos/%s/%s/contents/version.json?ref=main" % (
                INDEX_OWNER, MARKET_REPO),
            "headers": {"Accept": "application/vnd.github.raw"},
        },
        {
            "url": "https://cdn.jsdelivr.net/gh/%s/%s@main/version.json?t=%d" % (
                INDEX_OWNER, MARKET_REPO, stamp),
            "headers": {},
        },
        {
            "url": "https://raw.githubusercontent.com/%s/%s/main/version.json" % (
                INDEX_OWNER, MARKET_REPO),
            "headers": {},
        },
    ]
    for source in sources:
        try:
            data = json.loads(_read_url(
                source["url"], timeout, source.get("headers")).decode("utf-8"))
            version = node_market.to_text((data or {}).get("version"))
            if version:
                return version
        except Exception:
            continue
    return ""


def fetch_repo_stars(repos, timeout=8, limit=12):
    """匿名查 GitHub star 数，作为插件热度参考；失败就跳过。"""
    stars = {}
    for repo in list(repos)[:limit]:
        try:
            data = json.loads(_read_url(
                "https://api.github.com/repos/%s" % repo, timeout).decode("utf-8"))
            stars[repo] = int(data.get("stargazers_count") or 0)
        except Exception:
            continue
    return stars


def sha256_of(path):
    digest = hashlib.sha256()
    with io.open(path, "rb") as handle:
        while True:
            chunk = handle.read(128 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _report(report, stage, message, percent=None, detail=""):
    if report is not None:
        report(stage, message, percent, detail)


def _download(url, target, report=None):
    request = UrlRequest(url, headers={"User-Agent": USER_AGENT})
    response = urlopen(request, timeout=60)
    try:
        total = 0
        try:
            total = int(response.headers.get("Content-Length") or 0)
        except Exception:
            total = 0
        downloaded = 0
        with io.open(target, "wb") as handle:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                downloaded += len(chunk)
                percent = None
                if total > 0:
                    percent = 5 + 50.0 * downloaded / total
                detail = "已下载 %s" % human_bytes(downloaded)
                if total > 0:
                    detail += " / %s" % human_bytes(total)
                _report(report, "download", "正在下载插件包...", percent, detail)
    finally:
        response.close()
    if not os.path.isfile(target) or os.path.getsize(target) < 16:
        raise IOError("下载到的插件包为空")


def _safe_zip_extract(archive, destination):
    base = os.path.abspath(destination)
    for info in archive.infolist():
        target = os.path.abspath(os.path.join(destination, info.filename))
        if target != base and not target.startswith(base + os.sep):
            continue
        archive.extract(info, destination)


def _safe_tar_extract(archive, destination):
    base = os.path.abspath(destination)
    for member in archive.getmembers():
        if not (member.isfile() or member.isdir()):
            continue
        target = os.path.abspath(os.path.join(destination, member.name))
        if target != base and not target.startswith(base + os.sep):
            continue
        archive.extract(member, destination)


def _find_subpath_dir(root, subpath):
    if not subpath:
        return None
    direct = os.path.join(root, subpath.replace("/", os.sep))
    if os.path.isdir(direct):
        return direct
    wanted = subpath.replace("\\", "/")
    for base, dirs, files in os.walk(root):
        normalized = base.replace("\\", "/")
        if normalized.endswith("/" + wanted):
            return base
    return None


def _find_entry_file(folder, entry):
    if not folder or not os.path.isdir(folder):
        return ""
    if entry.entry:
        candidate = os.path.join(folder, entry.entry.replace("/", os.sep))
        if os.path.isfile(candidate):
            return candidate
    for base, dirs, files in os.walk(folder):
        for name in files:
            if not name.lower().endswith(".py") or name.startswith("_"):
                continue
            path = os.path.join(base, name)
            try:
                plugins = node_market.parse_plugin_file(path, entry.node_id)
            except Exception:
                continue
            if plugins:
                return path
    return ""


def _extract_package(archive_path, entry, temp_dir):
    extract_dir = os.path.join(temp_dir, "extract")
    if not os.path.isdir(extract_dir):
        os.makedirs(extract_dir)

    with io.open(archive_path, "rb") as handle:
        magic = handle.read(4)
    if magic[:2] == b"PK":
        with zipfile.ZipFile(archive_path) as archive:
            _safe_zip_extract(archive, extract_dir)
    elif magic[:2] == b"\x1f\x8b":
        with tarfile.open(archive_path, "r:gz") as archive:
            _safe_tar_extract(archive, extract_dir)
    else:
        raise IOError("不支持的插件包格式，只支持 zip / tar.gz")

    folder = _find_subpath_dir(extract_dir, entry.subpath)
    if folder is None:
        # 没有 subpath 时：先找以节点序号命名的目录，再找含入口文件的目录
        candidates = []
        for base, dirs, files in os.walk(extract_dir):
            if os.path.basename(base).lower() == entry.node_id_text.lower():
                candidates.append(base)
        for base in candidates:
            if _find_entry_file(base, entry):
                folder = base
                break
        if folder is None:
            for base, dirs, files in os.walk(extract_dir):
                if _find_entry_file(base, entry):
                    folder = base
                    break
    if folder is None:
        raise IOError("插件包里找不到节点目录：%s" % (entry.subpath or entry.node_id_text))
    if _find_entry_file(folder, entry) == "":
        raise IOError("插件包里找不到入口文件：%s" % (entry.entry or "*.py"))
    return folder


def validate_package(folder, entry):
    path = _find_entry_file(folder, entry)
    if not path:
        raise IOError("找不到节点入口文件")
    plugins = node_market.parse_plugin_file(path, entry.node_id)
    if not plugins:
        raise IOError("节点序号与目录不匹配，或没有识别到 registerNode")
    plugin = plugins[0]
    if entry.node_name and plugin.node_name and plugin.node_name != entry.node_name:
        raise IOError("节点类型不匹配：目录是 %s，条目是 %s" % (plugin.node_name, entry.node_name))
    return plugin


def write_install_manifest(target, entry, archive_path):
    """记录安装来源和摘要，方便以后核对本地版本是不是被改过。"""
    try:
        payload = {
            "node_id": entry.node_id_text,
            "version": entry.version,
            "updated": entry.updated,
            "source": entry.repo or entry.asset,
            "subpath": entry.subpath,
            "entry": entry.entry,
            "sha256": entry.sha256 or sha256_of(archive_path),
            "installed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        path = os.path.join(target, ".market.json")
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, indent=2))
    except Exception:
        pass


def install_entry(entry, nodes_dir, report=None):
    """下载并安装一个目录条目，返回安装目录。

    report(stage, message, percent, detail) 用于进度页；percent 为 0-100，
    None 表示当前阶段无法计算百分比。
    """
    if entry.node_id is None:
        raise ValueError("条目缺少 node_id")
    if not nodes_dir:
        raise ValueError("本地插件目录为空")
    if not os.path.isdir(nodes_dir):
        os.makedirs(nodes_dir)

    temp_dir = tempfile.mkdtemp(prefix="zkm_online_")
    try:
        archive_path = os.path.join(temp_dir, "package")
        if entry.asset:
            source_label = "GitHub Release: %s" % entry.asset
            source_url = entry.asset
        elif entry.repo:
            source_label = "GitHub 仓库: %s%s" % (
                entry.repo, ("/" + entry.subpath) if entry.subpath else "")
            source_url = "https://codeload.github.com/%s/zip/refs/heads/%s" % (
                entry.repo, entry.branch or INDEX_BRANCH)
        else:
            raise ValueError("条目缺少 repo 或 asset")

        _report(report, "prepare", "正在连接 GitHub...", 2, "来源：" + source_label)
        _download(source_url, archive_path, report)
        _report(report, "download", "插件包下载完成", 58,
                "已下载 %s" % human_bytes(os.path.getsize(archive_path)))

        if entry.sha256:
            actual = sha256_of(archive_path)
            if actual.lower() != entry.sha256.lower():
                raise IOError("插件包校验失败：sha256 不匹配（%s…）" % actual[:12])
            _report(report, "verify", "插件包校验通过", 61, "sha256：%s…" % actual[:16])

        _report(report, "extract", "正在解压插件包...", 64, source_label)
        source_dir = _extract_package(archive_path, entry, temp_dir)

        _report(report, "validate", "正在校验节点序号和 NODE_INFO...", 74,
                "节点：%s · %s" % (entry.node_name, entry.node_id_text))
        validate_package(source_dir, entry)

        target = os.path.join(nodes_dir, entry.node_id_text)
        backup_path = ""
        if os.path.isdir(target):
            backup_path = backup_plugin_folder(target, entry.node_id_text)
            _report(report, "backup", "正在备份本地旧版本...", 82, backup_path)
        else:
            _report(report, "backup", "本地没有旧版本，跳过备份", 82, target)

        try:
            _report(report, "write", "正在写入本地 nodes 目录...", 90, target)
            shutil.copytree(
                source_dir, target,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"))
            validate_package(target, entry)
        except Exception:
            shutil.rmtree(target, ignore_errors=True)
            if backup_path and os.path.isdir(backup_path):
                shutil.move(backup_path, target)
            raise
        write_install_manifest(target, entry, archive_path)
        _report(report, "done", "安装完成", 100, target)
        return target
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
