'use strict';

/**
 * 运行时：游戏启动、进程管理、无头验证、安装器执行、目录统计
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const game = require('../core/game');
const Java = require('../core/java');
const account = require('../core/account');
const vm = require('../core/version-model');
const { ManifestService } = require('../core/manifest');
const { downloadMany } = require('../core/downloader');
const { fileExists, readJsonSafe } = require('../core/http');

let gameProcess = null;
let gameStartedAt = 0;

function status() {
  if (!gameProcess) return { running: false };
  return { running: gameProcess.exitCode === null, pid: gameProcess.pid, startedAt: gameStartedAt };
}

function kill(log) {
  if (gameProcess && gameProcess.exitCode === null) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(gameProcess.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' });
      } else {
        gameProcess.kill('SIGTERM');
      }
      if (log) log('已请求关闭游戏进程', 'warn');
    } catch (e) { /* ignore */ }
  }
  return true;
}

function buildCommandString(java, args) {
  return [java, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
}

/** 确保有可用 Java（不自动下载，仅检测） */
async function findJava(cfg, required, preferPath) {
  const candidates = [];
  if (preferPath && fileExists(preferPath)) candidates.push(preferPath);
  if (cfg.javaPath && fileExists(cfg.javaPath)) candidates.push(cfg.javaPath);
  // 明确指定且满足要求时，避免扫描整个系统目录。
  for (const explicit of [...new Set(candidates)]) {
    const version = await Java.getJavaVersion(explicit);
    if (version.version && (version.major || 0) >= required) {
      return { javaPath: explicit, ...version, meetsRequirement: true };
    }
  }
  const installed = await Java.detectJavaVerified();
  // 排序策略：优先「精确匹配 required」，其次「比 required 稍高」（越接近越好），最后才用更低版本。
  // 原因：Forge/NeoForge 等加载器对 Java 大版本很敏感（如 Forge 1.20.1 必须用 Java 17，Java 21 会在
  // ModuleLayerHandler.buildLayer 处崩溃），因此不能简单取最高版本。
  const score = (major) => {
    const m = major || 0;
    if (m === required) return 0; // 精确匹配最优
    if (m > required) return 100 + (m - required); // 高于要求，越接近越好
    return 10000 + (required - m); // 低于要求，最差
  };
  installed.sort((a, b) => score(a.major) - score(b.major));
  for (const j of installed) candidates.push(j.path);
  for (const c of candidates) {
    const v = await Java.getJavaVersion(c);
    if (v.version) return { javaPath: c, ...v, meetsRequirement: (v.major || 0) >= required };
  }
  return null;
}

/**
 * 启动游戏
 */
async function launch(ctx) {
  const { paths, options, log, send, cfg } = ctx;
  const inst = (options.instanceId && ctx.getInstance(options.instanceId)) || {};

  const versionId = options.version || inst.version;
  if (!versionId) return { ok: false, error: '未选择游戏版本' };

  // 账户
  const username = options.username || cfg.username || 'Steve';
  const acc = account.buildOfflineAccount(username);
  if (!acc.ok) return { ok: false, error: acc.message };
  const acct = acc.account;

  const channel = options.source || cfg.source || 'auto';

  try {
    const localVersions = new ManifestService(paths).listLocalVersions();
    if (!localVersions.find((v) => v.id === versionId)) {
      return { ok: false, error: `版本 ${versionId} 尚未安装，请先在「版本库」下载` };
    }

    const versionJson = game.resolveFullVersion(paths.versionsDir, versionId);
    const required = (versionJson.javaVersion && versionJson.javaVersion.majorVersion) || 8;

    // Java
    let java = null;
    const prefer = options.javaPath || inst.javaPath || cfg.javaPath;
    if (prefer && fileExists(prefer)) {
      const v = await Java.getJavaVersion(prefer);
      if (v.version) java = { javaPath: prefer, ...v, meetsRequirement: (v.major || 0) >= required };
    }
    if (!java) {
      if (cfg.autoJava === false) return { ok: false, error: '未配置可用 Java，请在设置中指定或开启自动补全' };
      java = await findJava(cfg, required, prefer);
    }
    if (!java) {
      log(`需要 Java ${required}+，正在自动补全 …`, 'warn');
      const ensured = await installAdoptium(required, log, () => {});
      if (!ensured.ok) return { ok: false, error: ensured.error };
      java = { javaPath: ensured.javaPath, version: ensured.version, major: ensured.major, meetsRequirement: true };
    } else if ((java.major || 0) < required) {
      log(`当前 Java ${java.version} 低于要求的 ${required}，尝试选择兼容运行时`, 'warn');
      const compatible = await findJava({ ...cfg, javaPath: '' }, required, '');
      if (compatible && compatible.meetsRequirement) java = compatible;
      else if (cfg.autoJava !== false) {
        const ensured = await installAdoptium(required, log, () => {});
        if (!ensured.ok) return { ok: false, error: ensured.error };
        java = { javaPath: ensured.javaPath, version: ensured.version, major: ensured.major, meetsRequirement: true };
      } else return { ok: false, error: `该版本需要 Java ${required}+，当前为 ${java.version}` };
    }

    // 大版本不精确匹配时（例如 Forge 1.20.1 需要 Java 17，而本机只有 Java 21），
    // 加载器（Forge/NeoForge）对 Java 大版本敏感，优先自动补全「精确版本」的 Java。
    const isModded = /forge|neoforge|fabric|quilt/i.test(versionId);
    if ((java.major || 0) !== required && cfg.autoJava !== false && (isModded || (java.major || 0) > required)) {
      const exact = (await Java.detectJavaVerified()).find((j) => (j.major || 0) === required);
      if (exact) {
        log(`切换到精确匹配的 Java ${exact.version}（该版本要求 ${required}）`, 'info');
        java = { javaPath: exact.path, version: exact.version, major: exact.major, meetsRequirement: true };
      } else if (isModded) {
        log(`该加载器版本要求 Java ${required}，本机为 Java ${java.major}，正在自动补全 Java ${required} …`, 'warn');
        const ensured = await installAdoptium(required, log, () => {});
        if (ensured.ok) {
          java = { javaPath: ensured.javaPath, version: ensured.version, major: ensured.major, meetsRequirement: true };
        } else {
          log(`自动补全 Java ${required} 失败，继续使用 Java ${java.major}（可能出现兼容性问题）`, 'warn');
        }
      }
    }
    log(`使用 Java ${java.version}：${java.javaPath}`);

    // 补齐文件
    const { libraries } = vm.resolveLibraries(versionJson, {});
    const missing = libraries
      .filter((l) => !fileExists(path.join(paths.librariesDir, l.path)))
      .map((l) => l.path);
    const jarId = versionJson.jar || versionJson.id;
    if (!fileExists(path.join(paths.versionsDir, jarId, jarId + '.jar'))) missing.push(jarId + '.jar');

    if (missing.length) {
      log(`启动前补齐 ${missing.length} 个缺失文件 …`, 'warn');
      const plan = game.buildInstallPlan(paths, versionJson, channel);
      const need = plan.tasks.filter((t) => missing.includes(t.name));
      const r = await downloadMany(need, { threads: Number(cfg.threads) || 16 });
      if (r.failed) return { ok: false, error: `启动失败：${r.failed} 个必要文件无法下载` };
    }

    // 原生库
    const nativesDir = path.join(paths.nativesCacheDir, versionJson.id);
    let nativeCount = 0;
    try { nativeCount = fs.readdirSync(nativesDir).length; } catch (e) { nativeCount = 0; }
    if (nativeCount === 0) {
      const plan = game.buildInstallPlan(paths, versionJson, channel);
      await game.extractNatives(paths, versionJson.id, plan.natives);
      // 现代版本将 natives-windows 等作为普通 artifact，而非 classifiers。
      for (const lib of libraries.filter(l => /natives-/.test(l.name || l.path))) {
        const jar = path.join(paths.librariesDir, lib.path);
        if (fileExists(jar)) {
          try { game.extractZipEntries(jar, nativesDir, ['META-INF/']); } catch (_) { /* 忽略无原生文件的库 */ }
        }
      }
    }

    const width = Number(options.width || inst.width || cfg.width) || 854;
    const height = Number(options.height || inst.height || cfg.height) || 480;
    const fullscreen = options.fullscreen !== undefined ? !!options.fullscreen : !!inst.fullscreen;

    const instanceGameDir = inst.gameDir ? path.resolve(inst.gameDir) : (inst.id ? path.join(paths.gameDir, 'instances', inst.id) : paths.gameDir);
    fs.mkdirSync(instanceGameDir, { recursive: true });
    const built = game.buildLaunchCommand({
      paths,
      versionJson,
      javaPath: java.javaPath,
      account: acct,
      gameDir: instanceGameDir,
      jvmArgs: options.jvmArgs != null ? options.jvmArgs : inst.jvmArgs || cfg.jvmArgs || '',
      gameArgs: options.gameArgs != null ? options.gameArgs : inst.gameArgs || cfg.gameArgs || '',
      minMemory: Number(options.minMemory || inst.minMemory || cfg.minMemory || 1024),
      maxMemory: Number(options.maxMemory || inst.maxMemory || cfg.maxMemory || 4096),
      width,
      height,
      features: { is_demo_user: false, has_custom_resolution: true },
      serverAddress: options.serverAddress || inst.serverAddress || '',
      serverPort: options.serverPort || inst.serverPort || '',
    });

    let args = built.args.slice(1);
    if (fullscreen) args.push('--fullscreen');

    const log4j = game.prepareLog4jConfig(paths, versionJson);
    if (log4j) args.splice(1, 0, '-Dlog4j.configurationFile=' + log4j);

    const command = buildCommandString(java.javaPath, args);
    fs.mkdirSync(paths.logDir, { recursive: true });
    const launchLog = path.join(paths.logDir, `game-${Date.now()}.log`);
    const logStream = fs.createWriteStream(launchLog, { flags: 'a' });
    logStream.write(`版本 ${versionId}\nJava ${java.javaPath}\n目录 ${instanceGameDir}\n命令 ${command}\n\n`);
    log(`启动 ${versionJson.id}：${acct.username} (${acct.uuid})`);
    log('命令行: ' + command, 'debug');

    fs.mkdirSync(paths.gameDir, { recursive: true });
    const inheritStdio = !!options.inheritStdio || process.env.AC_INHERIT_STDIO === '1';
    const child = spawn(java.javaPath, args, {
      cwd: instanceGameDir,
      windowsHide: false,
      env: { ...process.env },
      stdio: inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    gameProcess = child;
    gameStartedAt = Date.now();

    const MAX_LOG = 4000;
    const forward = (stream) => (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      send('game:output', { stream, text: text.slice(0, MAX_LOG) });
    };
    if (!inheritStdio) {
      child.stdout.on('data', forward('stdout'));
      child.stderr.on('data', forward('stderr'));
    }

    child.on('error', (err) => {
      logStream.end();
      gameProcess = null;
      send('game:exit', { code: -1, error: err.message });
      log('游戏进程启动失败: ' + err.message, 'error');
    });
    child.on('exit', (code, signal) => {
      logStream.end();
      const playtime = Math.round((Date.now() - gameStartedAt) / 1000);
      gameProcess = null;
      send('game:exit', { code, signal, playtime });
      log(`游戏进程已退出（代码 ${code}，时长 ${playtime}s）`, code === 0 ? 'success' : 'warn');
    });

    if (inst.id) ctx.touchInstance(inst.id);

    return {
      ok: true,
      pid: child.pid,
      javaPath: java.javaPath,
      javaVersion: java.version,
      command,
      classpathCount: built.classpath.length,
      versionId: versionJson.id,
      mainClass: versionJson.mainClass,
      username: acct.username,
      uuid: acct.uuid,
      logFile: launchLog,
      gameDir: instanceGameDir,
    };
  } catch (e) {
    log('启动失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
}

/**
 * 无头验证：检查依赖完整性并构建命令，但不启动 Java
 */
async function verify(ctx) {
  const { paths, options, cfg } = ctx;
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail: detail == null ? '' : String(detail) });

  const versionId = options.version;
  if (!versionId) return { ok: false, checks, error: '未指定版本' };

  try {
    const local = new ManifestService(paths).listLocalVersions().find((v) => v.id === versionId);
    push('版本已安装', !!local, versionId);
    if (!local) return { ok: false, checks };

    const versionJson = game.resolveFullVersion(paths.versionsDir, versionId);
    push('版本 JSON 可解析', !!versionJson.mainClass, versionJson.mainClass);

    const { libraries } = vm.resolveLibraries(versionJson, {});
    const missingLibs = libraries.filter((l) => !fileExists(path.join(paths.librariesDir, l.path)));
    push('库文件完整', missingLibs.length === 0, missingLibs.length ? `缺失 ${missingLibs.length} 个` : `${libraries.length} 个`);

    const jarId = versionJson.jar || versionJson.id;
    push('客户端 JAR 存在', fileExists(path.join(paths.versionsDir, jarId, jarId + '.jar')), jarId + '.jar');

    const assetIndex = versionJson.assetIndex && versionJson.assetIndex.id;
    const idxFile = assetIndex ? path.join(paths.indexesDir, assetIndex + '.json') : null;
    push('资源索引存在', !!idxFile && fileExists(idxFile), assetIndex || '无');

    let objectCount = 0;
    let missingObjects = 0;
    if (idxFile && fileExists(idxFile)) {
      const index = readJsonSafe(idxFile);
      const objs = Object.values((index && index.objects) || {});
      objectCount = objs.length;
      for (const o of objs) {
        if (!fileExists(path.join(paths.objectsDir, o.hash.slice(0, 2), o.hash))) missingObjects += 1;
      }
    }
    push('资源对象完整', missingObjects === 0, `${objectCount - missingObjects}/${objectCount}`);

    const nativesDir = path.join(paths.nativesCacheDir, versionJson.id);
    let nativeCount = 0;
    try { nativeCount = fs.readdirSync(nativesDir).length; } catch (e) { nativeCount = 0; }
    if (nativeCount === 0) {
      // 与启动流程保持一致：缺失时自动解压，避免 Forge 等独立 natives 目录被误判为失败
      try {
        fs.mkdirSync(nativesDir, { recursive: true });
        for (const lib of libraries.filter((l) => /natives-/.test(l.name || l.path))) {
          const jar = path.join(paths.librariesDir, lib.path);
          if (fileExists(jar)) {
            try { game.extractZipEntries(jar, nativesDir, ['META-INF/']); } catch (_) { /* 忽略无原生文件的库 */ }
          }
        }
        nativeCount = fs.readdirSync(nativesDir).length;
      } catch (e) { /* 保持 0 */ }
    }
    push('原生库已解压', nativeCount > 0, `${nativeCount} 个文件`);

    const acc = account.buildOfflineAccount(options.username || cfg.username);
    push('离线账户有效', acc.ok, acc.ok ? acc.account.uuid : acc.message);
    if (acc.ok) push('UUID 派生正确', acc.account.uuid.length === 36, acc.account.uuid);

    const required = (versionJson.javaVersion && versionJson.javaVersion.majorVersion) || 8;
    const java = await findJava(cfg, required, options.javaPath);
    push('Java 可用', !!java, java ? `Java ${java.version}（需要 ${required}+）` : '未找到');
    if (java) push('Java 版本满足要求', !!java.meetsRequirement, `需要 ${required}+，实际 ${java.major}`);

    let command = null;
    try {
      const built = game.buildLaunchCommand({
        paths,
        versionJson,
        javaPath: (java && java.javaPath) || 'java',
        account: acc.ok ? acc.account : account.buildOfflineAccount('Steve').account,
        gameDir: paths.gameDir,
        jvmArgs: cfg.jvmArgs,
        gameArgs: cfg.gameArgs,
        minMemory: cfg.minMemory,
        maxMemory: cfg.maxMemory,
        width: cfg.width,
        height: cfg.height,
        features: {},
      });
      command = buildCommandString((java && java.javaPath) || 'java', built.args.slice(1));
      push('启动参数可构建', built.args.length > 5, `${built.args.length} 个参数`);
      push('类路径非空', built.classpath.length > 0, `${built.classpath.length} 个条目`);
      push('主类已指定', !!versionJson.mainClass, versionJson.mainClass);
    } catch (e) {
      push('启动参数可构建', false, e.message);
    }

    return { ok: checks.every((c) => c.ok), checks, command, versionId };
  } catch (e) {
    push('验证过程', false, e.message);
    return { ok: false, checks, error: e.message };
  }
}

/** 运行 Forge / NeoForge / Quilt 安装器 */
async function runInstaller(paths, installerPath, log, send) {
  if (!installerPath || !fileExists(installerPath)) return { ok: false, error: '安装器不存在' };

  const java = await findJava({}, 8, '');
  if (!java) return { ok: false, error: '需要 Java 才能运行安装器，请在 Java 页安装' };
  log(`使用 ${java.javaPath} 运行安装器：${path.basename(installerPath)}`);

  return await new Promise((resolve) => {
    const child = spawn(java.javaPath, ['-jar', installerPath, '--installClient', paths.gameDir], {
      cwd: paths.gameDir,
      windowsHide: true,
    });
    let output = '';
    const relay = (stream) => (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) send('log', { time: new Date().toISOString(), level: 'debug', message: t.slice(0, 500) });
      }
    };
    child.stdout.on('data', relay('stdout'));
    child.stderr.on('data', relay('stderr'));
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('exit', (code) => {
      log(`安装器退出，代码 ${code}`, code === 0 ? 'success' : 'error');
      resolve({ ok: code === 0, code, output: output.slice(-6000) });
    });
  });
}

/** 安装 Adoptium JDK */
async function installAdoptium(major, log, onProgress) {
  try {
    log(`获取 Adoptium ${major} 下载地址 …`);
    const listed = await Java.listAdoptium(major, 'jdk');
    const asset = listed.data[0];
    if (!asset) throw new Error('Adoptium 无可用条目');
    log(`下载 ${asset.release_name} …`);
    const res = await Java.downloadAdoptium(asset, onProgress);
    log('解压 Java 运行时 …');
    const extractDir = path.join(res.destDir, 'runtime');
    await Java.extractArchive(res.archive, extractDir);
    const exe = Java.findJavaIn(extractDir, 5);
    if (!exe) throw new Error('未找到 java 可执行文件');
    const v = await Java.getJavaVersion(exe);
    log(`已安装 Java ${v.version}`, 'success');
    return { ok: true, javaPath: exe, version: v.version, major: v.major, source: 'auto-download' };
  } catch (e) {
    log('自动补全 Java 失败: ' + e.message, 'error');
    return { ok: false, error: '自动补全 Java 失败：' + e.message, required: major };
  }
}

/** 目录占用统计 */
function sizes(paths) {
  const sizeOf = (dir) => {
    let total = 0;
    const walk = (d) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          try { total += fs.statSync(p).size; } catch (err) { /* ignore */ }
        }
      }
    };
    walk(dir);
    return total;
  };
  return {
    game: sizeOf(paths.gameDir),
    libraries: sizeOf(paths.librariesDir),
    assets: sizeOf(paths.assetsDir),
    java: sizeOf(Java.JAVA_DIR),
  };
}

module.exports = { launch, verify, runInstaller, installAdoptium, sizes, status, kill, findJava };
