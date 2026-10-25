## AuroraCraft 极光启动器 v1.0.0

精美的中文 Minecraft 启动器（Electron + 原生 HTML/CSS/JS，除 Electron 外无运行时依赖）。

### 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `AuroraCraft-Setup-1.0.0.exe` | NSIS 图形化安装向导（中文界面、可选安装目录） |
| Linux (Debian/Ubuntu) | `AuroraCraft-1.0.0-amd64.deb` | `sudo dpkg -i` 安装 |
| Linux (通用) | `AuroraCraft-1.0.0-linux-x64.tar.gz` | 解压即用便携版 |
| macOS Apple Silicon | `AuroraCraft-1.0.0-mac-arm64.zip` | .app 压缩包 |
| macOS Intel | `AuroraCraft-1.0.0-mac-x64.zip` | .app 压缩包 |

校验和见 `SHA256SUMS.txt`。

### 功能

- 三档下载渠道（Mojang 官方 / BMCLAPI / BangBang）与自动测速择优
- 完整资源下载：客户端、库、资源对象、原生库；断点续传 + SHA-1 校验
- Mod 加载器：Fabric / Quilt / Forge / NeoForge
- Java 自动补全：系统检测 + TUNA Adoptium 镜像 + Mojang 官方运行时
- 离线登录（MD5 UUID 派生）与微软账号正版登录（Xbox Live OAuth）
- 资源中心：从 Modrinth 安装模组 / 光影 / 资源包 / 整合包 / 中文汉化包

### 已验证

- Minecraft 1.20.1 与 Forge 47.4.28 均可完整下载、安装并启动进入主界面
- Windows 安装包实测安装成功，资源中心可正常搜索与安装

### 注意

- 所有产物**均未做代码签名**。Windows SmartScreen 与 macOS Gatekeeper 会提示，
  macOS 可右键 → 打开，或执行 `xattr -cr AuroraCraft.app`
- macOS 以 zip 形式分发（.dmg 需在 macOS 上构建），未做公证
- Linux / macOS 产物为结构校验通过，未在对应系统实机运行验证
