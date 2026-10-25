import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import package_multi as P

pkg = os.path.join(P.WORK, "debpkg")
if not os.path.isdir(pkg):
    print("ERROR: 缺少 %s，请先运行 package_multi.py" % pkg)
    sys.exit(1)

data_tar = os.path.join(P.WORK, "data.tar.gz")
n = P.build_tar_gz(pkg, data_tar, extra_modes={"usr/bin/auroracraft": 0o755}, dot_prefix=True)
print("data.tar.gz 重建完成, 条目:", n)

find = {}
for dp, _, fs in os.walk(pkg):
    for f in fs:
        find[os.path.join(dp, f)] = 1

control_tar = os.path.join(P.WORK, "control.tar.gz")
deb = os.path.join(P.OUT, "AuroraCraft-%s-amd64.deb" % P.VERSION)
P.make_ar([("debian-binary", b"2.0\n"),
           ("control.tar.gz", open(control_tar, "rb").read()),
           ("data.tar.gz", open(data_tar, "rb").read())], deb)
print("deb 重建完成: %s (%.1f MB)" % (os.path.basename(deb), os.path.getsize(deb) / 1048576))

# 更新校验和
sums = []
for fn in sorted(os.listdir(P.OUT)):
    if fn.endswith(".sha256") or fn == "SHA256SUMS.txt":
        continue
    sums.append("%s  %s" % (P.sha256(os.path.join(P.OUT, fn)), fn))
with open(os.path.join(P.OUT, "SHA256SUMS.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(sums) + "\n")
print("SHA256SUMS.txt 已更新")
