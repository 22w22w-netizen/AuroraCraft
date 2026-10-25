#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 Linux / macOS 产物结构与权限。"""
import os
import io
import stat
import struct
import tarfile
import zipfile
import plistlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "release", "multi")
ok_all = True


def chk(cond, label, detail=""):
    global ok_all
    if not cond:
        ok_all = False
    print(("  OK   " if cond else "  FAIL ") + label + (("  :: " + detail) if detail else ""))


print("===== Linux tar.gz =====")
tgz = os.path.join(OUT, "AuroraCraft-1.0.0-linux-x64.tar.gz")
with tarfile.open(tgz, "r:gz") as t:
    members = t.getmembers()
    names = {m.name: m for m in members}
print("  条目数:", len(members))
exe = names.get("AuroraCraft-linux-x64/auroracraft")
chk(exe is not None, "可执行文件存在", "AuroraCraft-linux-x64/auroracraft")
if exe:
    chk((exe.mode & 0o777) == 0o755, "可执行权限 0755", oct(exe.mode))
sandbox = names.get("AuroraCraft-linux-x64/chrome-sandbox")
if sandbox:
    chk((sandbox.mode & 0o4777) == 0o4755, "chrome-sandbox 4755(setuid)", oct(sandbox.mode))
chk("AuroraCraft-linux-x64/resources/app/package.json" in names, "resources/app/package.json 存在")
chk("AuroraCraft-linux-x64/resources/app/src/main/main.js" in names, "主进程代码存在")
chk(any(n.endswith("resources/app/src/renderer/index.html") for n in names), "渲染层 index.html 存在")
chk("AuroraCraft-linux-x64/icudtl.dat" in names, "Electron 运行时资源存在")

print("\n===== .deb =====")
deb = os.path.join(OUT, "AuroraCraft-1.0.0-amd64.deb")
raw = open(deb, "rb").read()
chk(raw[:8] == b"!<arch>\n", "ar 魔数正确")
# 解析 ar
members = []
p = 8
while p + 60 <= len(raw):
    hdr = raw[p:p + 60]
    name = hdr[0:16].decode("ascii").strip()
    size = int(hdr[48:58].decode("ascii").strip())
    data = raw[p + 60:p + 60 + size]
    members.append((name, data))
    p += 60 + size + (size % 2)
print("  ar 成员:", [m[0] for m in members])
chk([m[0] for m in members] == ["debian-binary", "control.tar.gz", "data.tar.gz"], "成员顺序符合规范")
chk(members[0][1] == b"2.0\n", "debian-binary = 2.0")
with tarfile.open(fileobj=io.BytesIO(members[1][1]), mode="r:gz") as t:
    cn = [m.name for m in t.getmembers()]
    ctrl = t.extractfile("./control").read().decode("utf-8")
print("  control 成员:", cn)
chk("Package: auroracraft" in ctrl, "control: Package 字段")
chk("Architecture: amd64" in ctrl, "control: Architecture=amd64")
chk("Version: 1.0.0" in ctrl, "control: Version")
with tarfile.open(fileobj=io.BytesIO(members[2][1]), mode="r:gz") as t:
    dn = {m.name: m for m in t.getmembers()}
print("  data 条目数:", len(dn))
chk("./opt/auroracraft/auroracraft" in dn, "data: /opt/auroracraft 可执行文件")
chk("./usr/bin/auroracraft" in dn, "data: /usr/bin 启动脚本")
chk("./usr/share/applications/auroracraft.desktop" in dn, "data: .desktop 菜单项")
chk("./usr/share/icons/hicolor/256x256/apps/auroracraft.png" in dn, "data: 应用图标")
bi = dn.get("./usr/bin/auroracraft")
if bi:
    chk((bi.mode & 0o777) == 0o755, "/usr/bin/auroracraft 0755", oct(bi.mode))

print("\n===== macOS zip =====")
for arch in ("x64", "arm64"):
    z = os.path.join(OUT, "AuroraCraft-1.0.0-mac-%s.zip" % arch)
    print("  --- %s ---" % arch)
    with zipfile.ZipFile(z) as zf:
        infos = {i.filename: i for i in zf.infolist()}
        links = {n: i for n, i in infos.items() if stat.S_ISLNK((i.external_attr >> 16) & 0xFFFF)}
        print("    条目数: %d, 符号链接: %d" % (len(infos), len(links)))
        exe = infos.get("AuroraCraft.app/Contents/MacOS/AuroraCraft")
        chk(exe is not None, "Contents/MacOS/AuroraCraft 存在")
        if exe:
            chk(((exe.external_attr >> 16) & 0o777) == 0o755, "  可执行权限 0755",
                oct((exe.external_attr >> 16) & 0o777))
        pl = infos.get("AuroraCraft.app/Contents/Info.plist")
        chk(pl is not None, "Info.plist 存在")
        if pl:
            d = plistlib.loads(zf.read(pl))
            chk(d.get("CFBundleExecutable") == "AuroraCraft", "  CFBundleExecutable", d.get("CFBundleExecutable", ""))
            chk(d.get("CFBundleIdentifier") == "com.auroracraft.launcher", "  CFBundleIdentifier", d.get("CFBundleIdentifier", ""))
            chk(d.get("CFBundleIconFile") == "auroracraft.icns", "  CFBundleIconFile")
        chk("AuroraCraft.app/Contents/Resources/app/package.json" in infos, "resources/app 已注入")
        chk(any(n.endswith("Contents/Resources/app/src/renderer/index.html") for n in infos), "渲染层已注入")
        chk(any(n.endswith("auroracraft.icns") for n in infos), "icns 图标存在")
        fw = any("Electron Framework.framework" in n for n in infos)
        chk(fw, "Electron Framework 存在")
        # 符号链接目标检查
        bad = 0
        for n, i in links.items():
            tgt = zf.read(i).decode("utf-8", "replace")
            if not tgt or tgt.startswith("/"):
                bad += 1
        chk(bad == 0, "  符号链接均为相对路径", "异常 %d" % bad)
        sample = [n.split("AuroraCraft.app/")[-1] for n in list(links)[:3]]
        print("    符号链接示例:", sample)

print("\n" + ("===== 全部校验通过 =====" if ok_all else "===== 存在失败项 ====="))
