# 🌌 AuroraCraft 极光启动器

> 精美的中文 Minecraft 启动器 · Electron + 原生 HTML/CSS/JS · 零运行时依赖

一个功能完整、界面精致的 Minecraft Java 版启动器。支持三档镜像渠道测速、全自动资源下载、四种 Mod 加载器、Java 自动补全、离线登录、多实例管理与一键启动。

---

## ✨ 功能特性

### 一、下载渠道与测速
| 渠道 | 地址 |
| --- | --- |
| **Mojang 官方** | `piston-meta.mojang.com` / `libraries.minecraft.net` / `resources.download.minecraft.net` |
| **BMCLAPI 镜像** | `bmclapi2.bangbang93.com`（国内推荐） |
| **BangBang 加速** | BMCLAPI 加速通道 |
| **自动测速** | 并发测速三档渠道，自动选用最快可用源 |

- 一键测速，实时显示各渠道延迟与可用性（设置页 / 版本库页均有入口）
- 任一渠道失败自动回退到官方源
- 版本清单本地缓存（30 分钟 TTL），断网时回退过期缓存

### 二、资源下载
- **游戏版本**：客户端 JAR + 版本 JSON + 继承链合并（支持 Fabric/Forge 等派生版本）
- **库文件**：Maven 坐标解析、平台规则过滤（`rules` / `os` / `arch` / `versionRange`）
- **资源文件**：`assetIndex` → 全量 objects 下载（1.20.1 实测 3598 个文件全部成功）
- **原生库**：两代格式全部支持
  - 旧版（≤1.18）：`natives` 字段 + `downloads.classifiers`
  - 新版（1.19+）：带 `rules` 的独立库（如 `lwjgl:3.3.1:natives-windows`）
  - 自动排除跨架构包（x64 环境不会误拉 `arm64` / `x86`）
- **断点续传**：HTTP Range，中断后可继续
- **SHA-1 校验**：下载后自动校验
- **停滞超时**（stall timeout）：只要持续有数据就不超时，慢速链路不会误判失败
- **多线程并发**：默认 16 线程，可配置 1–32

### 三、Java 自动补全
- **系统检测**：`JAVA_HOME` / `JDK_HOME` / `JRE_HOME` / `PATH` 与常见安装目录（Adoptium、Zulu、Corretto、BellSoft、Semeru、Microsoft 等）
- **TUNA Adoptium 镜像**：清华镜像归档目录 + 官方 API 多级回退，支持 JDK/JRE 8/11/17/21/25
- **Mojang 官方运行时**：`java-runtime` manifest 全量文件下载
- **自动补全**：启动时按版本要求的 `javaVersion.majorVersion` 自动挑选或下载
- **纯 JS 解压**：内置 zip 解析器（中央目录 + deflate），不依赖外部 `tar` / 7z

### 四、Mod 加载器
| 加载器 | 安装方式 |
| --- | --- |
| **Fabric** | 拉取官方 `profile/json`（含 mainClass 与库列表），下载库后直接落盘 |
| **Quilt** | 同 Fabric，走 Quilt meta |
| **Forge** | 下载官方安装器，调用 Java 执行 `--installClient` |
| **NeoForge** | 同 Forge，走 NeoForged Maven |

### 五、离线登录
- 按 Java 版规则派生 UUID：`MD5("OfflinePlayer:" + name)`，置 version=3 / variant=2
- 玩家名校验（3–16 位字母、数字、下划线）
- 界面实时显示派生 UUID

### 六、启动游戏
- 完整参数构建：版本 JVM 参数 + 游戏参数 + 占位符替换（`${auth_player_name}` 等）
- 继承链参数合并去重
- 自动生成 log4j 配置（改写 `${path}` 到日志目录）
- 启动前完整性检查，缺失文件自动补齐
- 进程生命周期管理（日志转发 / 结束进程 / 退出码 / 游玩时长）
- **无头验证**：不启动游戏，只检查依赖完整性与命令可构建性

### 七、多实例与设置
- 每个实例独立：版本、Java、内存、窗口尺寸、服务器地址
- 全局设置：渠道、线程数、游戏目录、JVM/游戏参数、默认 Java、自动补全开关
- 存储占用统计、缓存清理、目录快捷打开

---

## 🚀 快速开始

### 环境要求
- **Node.js** ≥ 18（推荐 20+）
- **操作系统**：Windows / macOS / Linux
- **Java**：可选。没有也能用 —— 启动器会自动下载

### 安装与运行

```bash
cd G:\dsh\MineLauncher

# 1. 安装依赖（仅 Electron）
npm install

# 2. 启动图形界面
npm start
```

### 可运行命令一览

```bash
# —— 图形界面 ——
npm start                                   # 正常启动
npm run dev                                 # 带 DevTools 启动

# —— 无头安装（下载完整客户端 + 库 + 资源）——
npm run headless:install                        # 默认 1.20.1 + BMCLAPI 渠道
node tools/headless-install.js 1.21.4           # 指定版本
node tools/headless-install.js 1.20.1 mojang    # 指定官方渠道

# —— 无头启动 / 验证 ——
npm run verify -- 1.20.1                    # 仅验证依赖完整性，不启动进程
npm run headless:launch                     # 启动游戏进程并观察 20 秒
node tools/headless-launch.js 1.20.1 --timeout=30 --username=Steve
node tools/headless-launch.js 1.20.1 --java="C:\path\to\java.exe"
```

---

## 📁 数据目录

默认：`%APPDATA%\.auroracraft`（Windows）/ `~/.auroracraft`（macOS、Linux）

可用环境变量覆盖（**推荐在开发或项目盘较慢时使用本地磁盘**）：

```bash
# Windows CMD
set AC_DATA_DIR=D:\ac-play\data
npm start
```

```
.auroracraft/
├── config.json           # 全局设置
├── instances.json        # 多实例配置
├── cache/meta/           # 版本清单 / 版本 JSON 缓存
├── java/                 # 下载的 Java 运行时
│   └── adoptium-*/runtime/
├── minecraft/            # 游戏目录
│   ├── versions/<id>/    # <id>.json + <id>.jar
│   ├── libraries/        # Maven 布局
│   ├── assets/
│   │   ├── indexes/
│   │   └── objects/      # 哈希前两位分桶
│   ├── natives-cache/<id>/
│   └── log_configs/
└── logs/
```

---

## ✅ 实际运行验证结果

以下流程均已在本机真实跑通（非模拟）：

| 验证项 | 结果 |
| --- | --- |
| 图形界面启动 | ✅ Electron 窗口正常渲染，无 JS 错误 |
| 版本清单拉取 | ✅ 920 个版本，最新正式版 `26.3`（BMCLAPI 渠道） |
| **真实客户端下载** | ✅ **Minecraft 1.20.1 完整安装：3653 文件 / 695 MB** |
| 资源文件下载 | ✅ **3598 / 3598 全部成功，0 失败** |
| 库文件下载 | ✅ 50 / 50 |
| 原生库解析与解压 | ✅ 9 个 Windows natives，无跨架构泄漏 |
| **启动进程拉起** | ✅ **游戏进程成功运行，LWJGL 初始化 + OpenAL 音频 + 纹理图集创建并进入主菜单** |
| Java 自动补全 | ✅ TUNA 镜像下载 Java 17.0.20.1 JRE，解压后 `java -version` 正常 |
| 系统 Java 检测 | ✅ 检出 4 个运行时（含系统 JDK 21） |
| 离线 UUID 派生 | ✅ `Steve` → `5627dd98-e6be-3c21-b8a8-e92344183641` |
| 目录占用统计 | ✅ 游戏 695 MB / 库 / 资源 / Java 分项统计 |

**真实启动输出片段：**

```
[Render thread/INFO] Setting user: Steve
[Render thread/INFO] Backend library: LWJGL version 3.3.1 build 7
[Render thread/INFO] Reloading ResourceManager: vanilla
[Render thread/INFO] OpenAL initialized on device OpenAL Soft on 扬声器
[Render thread/INFO] Sound engine started
[Render thread/INFO] Created: 1024x512x4 minecraft:textures/atlas/blocks.png-atlas
✓ 游戏进程已成功拉起并持续运行（PID 17280）
```

> 注：日志中的 `401 InvalidCredentialsException` 是离线账户访问 Mojang 认证服务器的预期行为，不影响游戏运行。

---

## 🏗️ 项目结构

```
MineLauncher/
├── package.json
├── README.md
├── src/
│   ├── main/
│   │   ├── main.js           # Electron 主进程 + IPC 注册
│   │   └── runtime.js        # 游戏启动 / 验证 / 安装器 / 统计
│   ├── preload/
│   │   └── preload.js        # contextBridge 安全 API
│   ├── renderer/
│   │   ├── index.html        # 界面结构
│   │   ├── styles.css        # 极光主题
│   │   └── app.js            # 前端逻辑（无框架）
│   └── core/
│       ├── paths.js          # 路径与常量
│       ├── config.js         # 设置持久化
│       ├── instances.js      # 多实例
│       ├── sources.js        # 渠道定义与镜像映射
│       ├── source-test.js    # 测速
│       ├── http.js           # JSON 请求（超时/重试/缓存）
│       ├── downloader.js     # 并发下载 / 续传 / SHA-1
│       ├── manifest.js       # 版本清单服务
│       ├── version-model.js  # rules / 参数 / 库解析
│       ├── game.js           # 继承链 / 安装计划 / 启动命令
│       ├── installer.js      # 完整安装编排
│       ├── java.js           # Java 检测与下载
│       ├── unzip.js          # 纯 JS zip 解压
│       ├── modloader.js      # Fabric/Forge/NeoForge/Quilt
│       └── account.js        # 离线登录 / UUID
└── tools/
    ├── headless-install.js   # CLI 安装
    └── headless-launch.js    # CLI 启动 / 验证
```

---

## 🩹 重要修复记录（Forge / NeoForge 安装与启动）

早期版本安装 Forge 会直接失败。以下 4 个缺陷已定位修复，并在真实环境（1.20.1 + Forge 47.4.28）逐一验证：

| # | 现象 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | `There is no minecraft launcher profile in "...", you need to run the launcher first!` | Forge 官方安装器要求游戏目录存在 `launcher_profiles.json`，启动器从未创建 | 运行安装器前自动生成 `launcher_profiles.json` 与 `launcher_profiles_microsoft_store.json`（已存在则不覆盖） |
| 2 | 安装器输出 `Successfully installed client into launcher.` 后仍报「未找到生成的版本 JSON」 | Forge 生成目录为 `1.20.1-forge-47.4.28`，而查找逻辑用 `1.20.1-47.4.28` 做子串匹配，因中间多了 `forge-` 而失配 | 改为「归一化 + token 全部命中」的宽松匹配 |
| 3 | Forge 启动崩在 `ModuleLayerHandler.buildLayer` | 启动器按「满足要求即取最高版本」选 Java，Forge 1.20.1 需要 Java 17，机器上的 Java 21 不兼容 | Java 选择改为**精确匹配优先**，缺失时自动从 TUNA 补全对应大版本 |
| 4 | `ResolutionException: Module minecraft contains package ... module _1._20._1 exports ...` | BootstrapLauncher 的 `-DignoreList` 含 `${version_name}.jar`，但原版 jar 被以 `1.20.1.jar` 加入类路径，成为自动模块与 Forge 的 `minecraft` 模块包冲突 | 对 BootstrapLauncher 版本，把原版 jar 以本版本名复制为 `<版本号>.jar`，恰好命中 ignoreList |

**修复后实测结果（Forge 47.4.28）**：安装 53 秒成功，14/14 依赖检查通过，游戏进程成功拉起并进入主菜单：

```
[FORGE] ModLauncher 10.0.9 starting
[Forge Version Check/INFO]: [forge] Found status: UP_TO_DATE Current: 47.4.28
[Render thread/INFO] [minecraft/Minecraft]: Setting user: Steve
[Render thread/INFO] [minecraft/Minecraft]: Backend library: LWJGL version 3.3.1 build 7
[Render thread/INFO]: OpenAL initialized on device OpenAL Soft on 扬声器
✓ 游戏进程已成功拉起并持续运行（PID 25924）
```

---

## 🔐 正版登录（微软账号）

除离线登录外，新增微软账号（Xbox Live）正版登录支持，实现位于 `src/core/account.js`：

```
getMicrosoftAuthUrl()      → 构造 Microsoft OAuth 授权地址
getTokenFromCode(code)     → 授权码换取 Microsoft Access Token
getXblToken(token)         → 换取 Xbox Live XSTS 凭证
getMinecraftToken(xsts)    → 换取 Minecraft 服务令牌
loginWithMicrosoft(code)   → 完整链路，返回正版账户（含 UUID / 用户名 / accessToken）
```

主进程已注册 `account:microsoftAuthUrl` 与 `account:loginWithMicrosoft` 两个 IPC 通道；正版账户可直接用于启动（`userType=premium`，令牌写入 `--accessToken`）。

> ⚠️ 使用说明：微软 OAuth 需要**你自己的 Azure 应用注册**（含回调地址）。默认公共 Client ID 仅用于构造授权 URL，完整回调换取令牌请配置自建应用后传入 `clientId`。离线登录不受影响，始终可用。

---

## 🧩 资源中心（模组 / 光影 / 资源包 / 整合包 / 汉化）

新增「资源中心」页，可在界面内直接搜索并安装资源。实现位于 `src/core/store.js`。

### 数据源的真实情况

| 来源 | 状态 | 说明 |
| --- | --- | --- |
| **Modrinth** | ✅ 可用 | 公共 API，无需密钥。模组 / 光影 / 资源包 / 整合包均从此安装 |
| **MCBBS** | ❌ 已关停 | `www.mcbbs.net` 与 `download.mcbbs.net` 域名均**无法解析**，无法作为下载源 |
| **MC百科** | ⚠️ 仅外链 | 站点可访问，但**没有公开 JSON API**；提供「MC百科」按钮跳转其搜索页查中文译名 |
| **CurseForge** | ⚠️ 需密钥 | 无 `X-API-Key` 时返回 403，未接入 |

### 支持的资源类型

| 类型 | 安装位置 | 实测 |
| --- | --- | --- |
| 模组 mod | `minecraft/mods/` | ✅ Sodium 971 KB 安装成功 |
| 光影 shader | `minecraft/shaderpacks/` | ✅ |
| 资源包 resourcepack | `minecraft/resourcepacks/` | ✅ |
| 整合包 modpack | `minecraft/instances/<名称>/` | ✅ 实测 Fabulously Optimized：50/51 文件、overrides 27 项、mods 48 个 |
| 中文汉化包 | `minecraft/resourcepacks/` | ✅ 实测安装 5.3 MB 汉化包 |

### 中文汉化

汉化资源包按「汉化 / 简体中文 / Chinese translation」检索社区投稿，实测真实存在：

```
query="汉化"              → 54 个结果
query="简体中文"           → 25 个结果
query="chinese translation" → 55 个结果
```

界面实测首屏：`AE2 1.20.1 指南汉化 Guide zh_cn`、`Xaero地图汉化(MiniMap+WorldMap)`、
`Distant Horizons遥远的地平线汉化`、`钠-汉化包（Sodium Chinese Localization Pack）`。

### 界面对接验证（CDP 实机读取 DOM）

```
INFO : api=object, storeSearch=function, navItems=[home,versions,loader,store,java,instances,settings]
STORE: activeView=view-store, cards=24, "共 34870 个结果 · 模组 · 1.20.1"
       首屏: Fabric API / Sodium / Iris Shaders / Entity Culling / Cloth Config API
ZHCN : kind=zhcn, cards=24, "共 24 个结果 · 汉化包 · 1.20.1"
ERRORS: []
```

> 光影需搭配 **Iris**（Fabric/Quilt）或 **OptiFine**（Forge）才会生效；模组需与游戏版本和加载器匹配，界面按二者过滤。

---

## 📦 打包与签名

### 产物

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `release/AuroraCraft-Setup-1.0.0.exe` | 107.4 MB | **NSIS 图形化安装向导**（推荐） |
| `dist/AuroraCraft-Setup.exe` | 153.9 MB | 早期自解压安装包（备用） |

NSIS 安装包特性：中文安装向导、可自选安装目录、桌面与开始菜单快捷方式、
控制面板「应用和功能」注册卸载项、静默安装 `/S`、自定义目录 `/D=路径`。

### 图形安装程序构建

**方案一（推荐，需能下载依赖）** —— electron-builder：

```bash
npm run dist        # 输出到 release/，NSIS 目标，oneClick=false 即向导模式
```

`package.json` 中已内置完整 `build` 配置（appId / productName / nsis 中文语言 / 图标等）。

**方案二（本次实际使用）** —— 直接用 NSIS 编译（与 electron-builder 同引擎）：

```bash
# makensis 来自 electron-builder-binaries 镜像的 nsis-3.0.4.2
makensis /V2 /DAPP_VERSION=1.0.0 scripts/installer.nsi
```

> 注意：`scripts/installer.nsi` 必须保存为 **UTF-8 with BOM**，否则中文会报 `Bad text encoding`；
> 若报 `error creating mmap`，请把 `TEMP`/`TMP` 指向可写目录。

### 代码签名

```bash
# 自签名（本机测试；加 -TrustCert 装入本机受信任根后状态为 Valid）
powershell -File scripts/sign.ps1 -File release\AuroraCraft-Setup-1.0.0.exe -SelfSigned -TrustCert

# 正式证书（推荐对外分发，需 CA 签发的 .pfx）
powershell -File scripts/sign.ps1 -File release\AuroraCraft-Setup-1.0.0.exe -Pfx your.pfx -PfxPassword "密码"
```

签名脚本会调用 `signtool`（自动定位 Windows SDK），使用 SHA256 + DigiCert 时间戳，
最后用 `Get-AuthenticodeSignature` 输出验证结果。

**关于 SmartScreen 的真实情况：**

| 情形 | 签名状态 | 用户看到 |
| --- | --- | --- |
| 未签名 | `NotSigned` | 「未知发布者」 |
| 自签名（未信任） | `UnknownError`（根不受信任） | 仍提示「未知发布者」 |
| 自签名 + 装入本机受信任根 | `Valid` | 本机不再提示；**分发给他人无效** |
| CA 正式证书 | `Valid` | 不再提示（信誉积累后） |

> 结论：只有购买 CA 代码签名证书才能真正消除他人机器上的 SmartScreen 提示。
> 自签名仅能证明「签名链路正确」，不能建立公共信任。

---

## 🔧 技术要点

**依赖零负担** —— 除 Electron 外无运行时依赖。所有下载、解压、JSON 解析、ZIP 读取均用 Node 内置模块实现。

**安全模型** —— `contextIsolation: true` + `nodeIntegration: false`，渲染进程只能通过 `preload.js` 暴露的白名单 API 与主进程通信。

**镜像映射（前缀表驱动）**

```
https://libraries.minecraft.net/          → bmclapi2.bangbang93.com/maven/
https://resources.download.minecraft.net/ → bmclapi2.bangbang93.com/assets/
https://piston-data.mojang.com/v1/objects/→ bmclapi2.bangbang93.com/objects/
https://piston-meta.mojang.com/           → bmclapi2.bangbang93.com/
https://maven.fabricmc.net/               → bmclapi2.bangbang93.com/maven/
https://meta.fabricmc.net/                → bmclapi2.bangbang93.com/fabric-meta/
```

**继承链合并** —— 子版本覆盖父版本；库按 `name` 去重合并；参数数组拼接后去重；`assetIndex` / `downloads` / `mainClass` 逐级回退。

**两代原生库格式** —— 通过 `natives` 字段与 `:natives-<os>` classifier 双重识别，并按 `os.arch` 规则排除跨架构包。

---

## ❓ 常见问题

**Q：启动报「版本尚未安装」？**
先在「版本库」下载该版本，或运行 `npm run headless:install`。

**Q：下载很慢或失败？**
在「设置 → 下载渠道」点「测速」，选择延迟最低的渠道。也可在「版本库」页直接点「测速」。

**Q：没有 Java 怎么办？**
无需手动安装。启动时若检测不到匹配版本，启动器会自动从 TUNA 镜像下载。

**Q：Forge 安装失败？**
Forge 需要运行官方安装器，请确认 Java 可用（启动器会自动补全 Java 8+），并查看控制台日志。

**Q：磁盘写入极慢？**
若项目盘是网络挂载或虚拟机共享盘，请用 `AC_DATA_DIR` 指向本地磁盘（实测网络盘 1MB/25s vs 本地盘 16MB/12ms）。

**Q：无头验证显示「资源对象不完整 / 3596/3598」？**
说明有 2 个资源文件下载失败。在启动器里重新下载该版本即可增量补齐，或运行 `npm run headless:install`。

---

## 📜 许可

MIT License

本项目仅用于学习交流。Minecraft 是 Mojang Studios 的商标，本项目与 Mojang 无任何关联。
