#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跨平台打包：在 Windows 上生成 Linux 与 macOS 的可分发产物。

要点：
- Electron 的 darwin 包内含 framework 符号链接，Windows 无法创建真实符号链接，
  因此这里直接把符号链接条目写进 tar/zip（Unix mode + linkname），
  在 macOS/Linux 上解压时会被正确还原。
- .deb 为 ar 归档 + control.tar.gz + data.tar.gz，手工构造，符合 dpkg 规范。
"""
import io
import os
import sys
import stat
import gzip
import time
import shutil
import struct
import tarfile
import zipfile
import hashlib
import plistlib
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "electron")
OUT = os.path.join(ROOT, "release", "multi")
WORK = os.path.join(ROOT, ".work")

APP_NAME = "AuroraCraft"
APP_NAME_CN = "极光启动器"
VERSION = "1.0.0"
BUNDLE_ID = "com.auroracraft.launcher"

APP_FILES = ["package.json", "README.md"]
APP_DIRS = ["src", "tools"]

NOW = int(time.time())


def log(msg):
    print(msg, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def clean(p):
    if os.path.isdir(p):
        shutil.rmtree(p, ignore_errors=True)
    elif os.path.exists(p):
        os.remove(p)


# ---------------------------------------------------------------- 解压
def extract_zip(src, dest):
    """解压 zip；符号链接条目只记录，不落地（Windows 无法创建）。"""
    clean(dest)
    os.makedirs(dest, exist_ok=True)
    links = {}
    with zipfile.ZipFile(src) as z:
        for info in z.infolist():
            mode = (info.external_attr >> 16) & 0xFFFF
            is_link = stat.S_ISLNK(mode)
            name = info.filename
            if name.endswith("/"):
                os.makedirs(os.path.join(dest, name), exist_ok=True)
                continue
            target = os.path.join(dest, name.replace("/", os.sep))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            data = z.read(info)
            if is_link:
                links[name.rstrip("/")] = data.decode("utf-8", "replace")
                continue
            with open(target, "wb") as f:
                f.write(data)
            if mode & 0o111:
                try:
                    os.chmod(target, 0o755)
                except OSError:
                    pass
    return links


# ---------------------------------------------------------------- 应用代码
def copy_app(dest_resources):
    app_dir = os.path.join(dest_resources, "app")
    clean(app_dir)
    os.makedirs(app_dir, exist_ok=True)
    for f in APP_FILES:
        src = os.path.join(ROOT, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(app_dir, f))
    for d in APP_DIRS:
        src = os.path.join(ROOT, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(app_dir, d),
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules", ".git"))
    return app_dir


def walk_files(base):
    """返回 [(相对路径, 绝对路径, 是否可执行)]"""
    out = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames.sort()
        for fn in sorted(filenames):
            ap = os.path.join(dirpath, fn)
            rp = os.path.relpath(ap, base).replace(os.sep, "/")
            ex = bool(os.stat(ap).st_mode & 0o111)
            out.append((rp, ap, ex))
    return out


# ---------------------------------------------------------------- tar.gz
def build_tar_gz(base, out_path, links=None, prefix="", exec_names=(), dir_mode=0o755,
                 file_mode=0o644, extra_modes=None, dot_prefix=False):
    links = links or {}
    extra_modes = extra_modes or {}
    dp = "./" if dot_prefix else ""
    wrote = 0
    with tarfile.open(out_path, "w:gz", format=tarfile.GNU_FORMAT) as tar:
        tar.add = tar.add  # noqa
        if prefix:
            ti = tarfile.TarInfo((dp + prefix).rstrip("/"))
            ti.type = tarfile.DIRTYPE
            ti.mode = dir_mode
            ti.mtime = NOW
            tar.addfile(ti)
        # 目录
        for dirpath, dirnames, _ in os.walk(base):
            dirnames.sort()
            for dn in dirnames:
                ap = os.path.join(dirpath, dn)
                rp = os.path.relpath(ap, base).replace(os.sep, "/")
                ti = tarfile.TarInfo((dp + prefix + rp).rstrip("/"))
                ti.type = tarfile.DIRTYPE
                ti.mode = dir_mode
                ti.mtime = NOW
                tar.addfile(ti)
        # 文件
        for rp, ap, ex in walk_files(base):
            name = dp + prefix + rp
            mode = extra_modes.get(rp, 0o755 if (ex or rp in exec_names) else file_mode)
            ti = tarfile.TarInfo(name)
            ti.size = os.path.getsize(ap)
            ti.mode = mode
            ti.mtime = NOW
            with open(ap, "rb") as f:
                tar.addfile(ti, f)
            wrote += 1
        # 符号链接
        for rp, target in sorted(links.items()):
            ti = tarfile.TarInfo(dp + prefix + rp)
            ti.type = tarfile.SYMTYPE
            ti.linkname = target
            ti.mode = 0o777
            ti.mtime = NOW
            tar.addfile(ti)
    return wrote


# ---------------------------------------------------------------- zip (保留符号链接)
def build_zip_preserving_links(base, out_path, links=None, prefix="", exec_names=(), extra_modes=None):
    links = links or {}
    extra_modes = extra_modes or {}
    n = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rp, ap, ex in walk_files(base):
            mode = extra_modes.get(rp, 0o755 if (ex or rp in exec_names) else 0o644)
            zi = zipfile.ZipInfo(prefix + rp)
            zi.create_system = 3
            zi.external_attr = (mode | stat.S_IFREG) << 16
            zi.date_time = time.localtime(NOW)[:6]
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(ap, "rb") as f:
                z.writestr(zi, f.read())
            n += 1
        for rp, target in sorted(links.items()):
            zi = zipfile.ZipInfo(prefix + rp)
            zi.create_system = 3
            zi.external_attr = (0o777 | stat.S_IFLNK) << 16
            zi.date_time = time.localtime(NOW)[:6]
            zi.compress_type = zipfile.ZIP_STORED
            z.writestr(zi, target.encode("utf-8"))
            n += 1
    return n


# ---------------------------------------------------------------- ar (.deb)
def make_ar(members, out_path):
    """members: [(name, bytes)]"""
    with open(out_path, "wb") as f:
        f.write(b"!<arch>\n")
        for name, data in members:
            hdr = "{:<16}{:<12}{:<6}{:<6}{:<8}{:<10}`\n".format(
                name, str(NOW), "0", "0", "100644", str(len(data))).encode("ascii")
            assert len(hdr) == 60, len(hdr)
            f.write(hdr)
            f.write(data)
            if len(data) % 2 == 1:
                f.write(b"\n")


# ---------------------------------------------------------------- icns
def make_icns(png_path, out_path):
    img = Image.open(png_path).convert("RGBA")
    chunks = []
    for ctype, size in (("ic08", 256), ("ic09", 512), ("ic10", 1024)):
        buf = io.BytesIO()
        img.resize((size, size), Image.LANCZOS).save(buf, format="PNG")
        data = buf.getvalue()
        chunks.append(ctype.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    with open(out_path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


# ---------------------------------------------------------------- Linux
def build_linux():
    log("\n===== Linux x64 =====")
    src = os.path.join(CACHE, "electron-v45.0.0-linux-x64.zip")
    stage = os.path.join(WORK, "linux", "AuroraCraft-linux-x64")
    links = extract_zip(src, stage)
    log("  解压完成, 符号链接 %d 个" % len(links))

    # 重命名可执行文件
    old = os.path.join(stage, "electron")
    new = os.path.join(stage, "auroracraft")
    if os.path.exists(old):
        os.rename(old, new)
    copy_app(os.path.join(stage, "resources"))
    log("  已注入应用代码")

    os.makedirs(OUT, exist_ok=True)
    tgz = os.path.join(OUT, "AuroraCraft-%s-linux-x64.tar.gz" % VERSION)
    n = build_tar_gz(os.path.dirname(stage), tgz, links={}, prefix="",
                     exec_names=("AuroraCraft-linux-x64/auroracraft",),
                     extra_modes={"AuroraCraft-linux-x64/auroracraft": 0o755,
                                  "AuroraCraft-linux-x64/chrome-sandbox": 0o4755})
    log("  tar.gz: %d 条目 -> %s (%.1f MB)" % (n, os.path.basename(tgz), os.path.getsize(tgz) / 1048576))

    # ---------------- .deb
    log("  构造 .deb ...")
    pkg = os.path.join(WORK, "debpkg")
    clean(pkg)
    optdir = os.path.join(pkg, "opt", "auroracraft")
    os.makedirs(optdir, exist_ok=True)
    for rp, ap, ex in walk_files(stage):
        dst = os.path.join(optdir, rp)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(ap, dst)
    # usr/bin 启动脚本
    bindir = os.path.join(pkg, "usr", "bin")
    os.makedirs(bindir, exist_ok=True)
    with open(os.path.join(bindir, "auroracraft"), "w", newline="\n") as f:
        f.write('#!/bin/sh\nexec /opt/auroracraft/auroracraft "$@"\n')
    # .desktop
    appsdir = os.path.join(pkg, "usr", "share", "applications")
    os.makedirs(appsdir, exist_ok=True)
    with open(os.path.join(appsdir, "auroracraft.desktop"), "w", encoding="utf-8", newline="\n") as f:
        f.write("[Desktop Entry]\nType=Application\nName=%s\nName[zh_CN]=%s\n"
                "Comment=Minecraft Launcher\nExec=/opt/auroracraft/auroracraft %%U\n"
                "Icon=auroracraft\nTerminal=false\nCategories=Game;\n"
                "StartupWMClass=AuroraCraft\n" % (APP_NAME, APP_NAME_CN))
    # 图标
    icodir = os.path.join(pkg, "usr", "share", "icons", "hicolor", "256x256", "apps")
    os.makedirs(icodir, exist_ok=True)
    Image.open(os.path.join(ROOT, "build", "icon-1024.png")).convert("RGBA").resize(
        (256, 256), Image.LANCZOS).save(os.path.join(icodir, "auroracraft.png"), "PNG")

    data_tar = os.path.join(WORK, "data.tar.gz")
    build_tar_gz(pkg, data_tar, extra_modes={"usr/bin/auroracraft": 0o755}, dot_prefix=True)

    # control
    ctrl = os.path.join(WORK, "ctrldir")
    clean(ctrl)
    os.makedirs(ctrl, exist_ok=True)
    installed = sum(os.path.getsize(p) for p, _, _ in
                    [(os.path.join(dp, f), 0, 0) for dp, _, fs in os.walk(pkg) for f in fs])
    control = (
        "Package: auroracraft\n"
        "Version: %s\n"
        "Section: games\n"
        "Priority: optional\n"
        "Architecture: amd64\n"
        "Maintainer: AuroraCraft <support@auroracraft.local>\n"
        "Installed-Size: %d\n"
        "Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libsecret-1-0\n"
        "Description: AuroraCraft Minecraft Launcher\n"
        " 极光启动器 - 支持多镜像下载、Java 自动补全、\n"
        " 多加载器安装与资源中心的中文 Minecraft 启动器。\n"
        % (VERSION, max(1, installed // 1024))
    )
    with open(os.path.join(ctrl, "control"), "w", encoding="utf-8", newline="\n") as f:
        f.write(control)
    # md5sums
    lines = []
    for rp, ap, _ in walk_files(pkg):
        h = hashlib.md5(open(ap, "rb").read()).hexdigest()
        lines.append("%s  %s" % (h, rp))
    with open(os.path.join(ctrl, "md5sums"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    control_tar = os.path.join(WORK, "control.tar.gz")
    with tarfile.open(control_tar, "w:gz", format=tarfile.GNU_FORMAT) as tar:
        for fn in ("control", "md5sums"):
            ap = os.path.join(ctrl, fn)
            ti = tarfile.TarInfo("./" + fn)
            ti.size = os.path.getsize(ap)
            ti.mode = 0o644
            ti.mtime = NOW
            with open(ap, "rb") as fh:
                tar.addfile(ti, fh)

    deb = os.path.join(OUT, "AuroraCraft-%s-amd64.deb" % VERSION)
    make_ar([("debian-binary", b"2.0\n"),
             ("control.tar.gz", open(control_tar, "rb").read()),
             ("data.tar.gz", open(data_tar, "rb").read())], deb)
    log("  deb: %s (%.1f MB)" % (os.path.basename(deb), os.path.getsize(deb) / 1048576))


# ---------------------------------------------------------------- macOS
def build_mac(arch):
    log("\n===== macOS %s =====" % arch)
    src = os.path.join(CACHE, "electron-v45.0.0-darwin-%s.zip" % arch)
    stage = os.path.join(WORK, "mac-" + arch)
    links = extract_zip(src, stage)
    log("  解压完成, 符号链接 %d 个" % len(links))

    app_src = os.path.join(stage, "Electron.app")
    app_dst = os.path.join(stage, "AuroraCraft.app")
    if not os.path.isdir(app_src):
        # 有时顶层目录名不同
        cands = [d for d in os.listdir(stage) if d.endswith(".app")]
        app_src = os.path.join(stage, cands[0])
    if os.path.exists(app_dst):
        shutil.rmtree(app_dst)
    os.rename(app_src, app_dst)

    # 重命名可执行文件（连同符号链接映射一起修正）
    macos_dir = os.path.join(app_dst, "Contents", "MacOS")
    exe_old = os.path.join(macos_dir, "Electron")
    exe_new = os.path.join(macos_dir, "AuroraCraft")
    if os.path.exists(exe_old):
        os.rename(exe_old, exe_new)
    fixed_links = {}
    for rp, tg in links.items():
        rp2 = rp
        tg2 = tg
        if rp.startswith("Electron.app/"):
            rp2 = "AuroraCraft.app/" + rp[len("Electron.app/"):]
        if tg == "Electron" and rp2.endswith("/MacOS/Electron"):
            tg2 = "AuroraCraft"
        fixed_links[rp2] = tg2
    links = fixed_links

    # Info.plist
    plist_path = os.path.join(app_dst, "Contents", "Info.plist")
    try:
        with open(plist_path, "rb") as f:
            pl = plistlib.load(f)
    except Exception:
        pl = {}
    pl.update({
        "CFBundleExecutable": "AuroraCraft",
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME_CN,
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "CFBundleIconFile": "auroracraft.icns",
        "LSMinimumSystemVersion": "10.15",
        "NSHighResolutionCapable": True,
        "LSApplicationCategoryType": "public.app-category.games",
        "NSHumanReadableCopyright": "Copyright © 2026 AuroraCraft",
    })
    with open(plist_path, "wb") as f:
        plistlib.dump(pl, f, fmt=plistlib.FMT_XML)

    # 图标
    make_icns(os.path.join(ROOT, "build", "icon-1024.png"),
              os.path.join(app_dst, "Contents", "Resources", "auroracraft.icns"))

    # 应用代码
    copy_app(os.path.join(app_dst, "Contents", "Resources"))

    out = os.path.join(OUT, "AuroraCraft-%s-mac-%s.zip" % (VERSION, arch))
    n = build_zip_preserving_links(
        stage, out, links=links, prefix="",
        exec_names=("AuroraCraft.app/Contents/MacOS/AuroraCraft",),
        extra_modes={"AuroraCraft.app/Contents/MacOS/AuroraCraft": 0o755})
    log("  zip: %d 条目 -> %s (%.1f MB)" % (n, os.path.basename(out), os.path.getsize(out) / 1048576))


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    build_linux()
    build_mac("x64")
    build_mac("arm64")

    log("\n===== 校验和 =====")
    sums = []
    for fn in sorted(os.listdir(OUT)):
        if fn.endswith(".sha256"):
            continue
        p = os.path.join(OUT, fn)
        h = sha256(p)
        sums.append("%s  %s" % (h, fn))
        log("  %s  %s" % (h[:16] + "...", fn))
    with open(os.path.join(OUT, "SHA256SUMS.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(sums) + "\n")
    log("\n完成，输出目录: %s" % OUT)


if __name__ == "__main__":
    main()
