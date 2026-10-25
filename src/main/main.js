'use strict';

/**
 * AuroraCraft 极光启动器 — Electron 主进程
 *
 * 职责：窗口管理 + IPC 注册（业务逻辑在 core/ 中）
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const { buildPaths, ensureDirs } = require('../core/paths');
const config = require('../core/config');
const instances = require('../core/instances');
const { ManifestService } = require('../core/manifest');
const { ModLoaderService } = require('../core/modloader');
const Java = require('../core/java');
const account = require('../core/account');
const sourceTest = require('../core/source-test');
const game = require('../core/game');
const store = require('../core/store');
const { SOURCES } = require('../core/sources');
const { downloadMany } = require('../core/downloader');
const { fileExists } = require('../core/http');
const runtime = require('./runtime');

let mainWindow = null;

/* ---------------------------------------------------------
 * 通用工具
 * -------------------------------------------------------*/
function getPaths() {
  const p = buildPaths();
  ensureDirs(p);
  return p;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function log(message, level = 'info') {
  send('log', { time: new Date().toISOString(), level, message: String(message) });
}

function progressEmitter(label) {
  let last = 0;
  return (p) => {
    const now = Date.now();
    if (now - last < 120 && p.ratio < 1) return;
    last = now;
    send('download:progress', { label, ...p });
  };
}

/** 根据版本 JSON 选择渠道后的 URL */
function channelUrl(url, channel) {
  const { toMirrorUrl } = require('../core/sources');
  if (!url || !channel || channel === 'mojang') return url;
  return toMirrorUrl(url) || url;
}

/* ---------------------------------------------------------
 * 窗口
 * -------------------------------------------------------*/
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#070b14',
    title: 'AuroraCraft 极光启动器',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => send('window:state', { maximized: false }));

  if (process.env.AC_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* =========================================================
 * 窗口控制
 * =======================================================*/
ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
ipcMain.handle('window:isMaximized', () => !!(mainWindow && mainWindow.isMaximized()));

/* =========================================================
 * 基础信息
 * =======================================================*/
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  arch: process.arch,
  paths: getPaths(),
  javaDir: Java.JAVA_DIR,
  sources: Object.values(SOURCES).map((s) => ({ id: s.id, name: s.name, desc: s.desc, color: s.color })),
}));

ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, patch) => config.set(patch));
ipcMain.handle('paths:get', () => getPaths());

ipcMain.handle('dialog:pickDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:pickFile', async (_e, filters) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: '可执行文件', extensions: ['exe', 'jar'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:openPath', (_e, p) => {
  if (!p) return false;
  const target = p === 'game' ? getPaths().gameDir
    : p === 'launcher' ? getPaths().launcherRoot
    : p === 'java' ? Java.JAVA_DIR
    : p === 'logs' ? getPaths().logDir
    : p;
  try { fs.mkdirSync(target, { recursive: true }); } catch (e) { /* ignore */ }
  return shell.openPath(target);
});

ipcMain.handle('shell:openExternal', (_e, url) => (/^https?:/.test(url) ? shell.openExternal(url) : false));

/* =========================================================
 * 渠道测速
 * =======================================================*/
ipcMain.handle('source:test', async () => {
  log('开始测速：Mojang 官方 / BMCLAPI / BangBang …');
  const results = await sourceTest.testAll();
  const best = results.find((r) => r.ok);
  if (best) log(`测速完成，最快渠道：${best.name}（${best.ms}ms）`, 'success');
  else log('测速完成，但所有渠道均不可用', 'error');
  return { results, best: best ? best.id : null };
});

ipcMain.handle('source:pickBest', async () => (await sourceTest.pickBest()).best);

/* =========================================================
 * 版本清单
 * =======================================================*/
ipcMain.handle('manifest:get', async (_e, source, opts) => {
  const cfg = config.load();
  const channel = source || cfg.source;
  const ms = new ManifestService(getPaths());
  log(`获取版本清单（渠道：${(SOURCES[channel] || SOURCES.auto).name}）…`);
  const data = await ms.getManifest(channel, opts || {});
  log(`已获取 ${data.versions.length} 个版本，最新正式版：${data.latest && data.latest.release}`, 'success');
  return { latest: data.latest, versions: data.versions, stale: !!data._stale, channel: data._channel };
});

ipcMain.handle('versions:local', () => new ManifestService(getPaths()).listLocalVersions());

/* =========================================================
 * 版本下载（客户端 / 库 / 资源 / 原生库）
 * =======================================================*/
ipcMain.handle('download:version', async (_e, payload) => {
  const paths = getPaths();
  const cfg = config.load();
  const channel = (payload && payload.source) || cfg.source;
  const threads = Number(cfg.threads) || 16;
  const entry = payload.entry;

  try {
    const ms = new ManifestService(paths);
    log(`准备安装版本 ${entry.id}（渠道：${(SOURCES[channel] || SOURCES.auto).name}）`);
    const rawJson = await ms.getVersionJson(entry, channel);

    // 写入版本 JSON（installer 会再做一次完整解析）
    const vdir = path.join(paths.versionsDir, rawJson.id);
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, rawJson.id + '.json'), JSON.stringify(rawJson, null, 2), 'utf8');

    const installer = require('../core/installer');
    const result = await installer.installVersion(paths, rawJson, {
      source: channel,
      threads,
      onProgress: progressEmitter(rawJson.id),
      onLog: (m) => log(m, 'debug'),
    });

    // 原生库解压
    const versionJson = game.resolveFullVersion(paths.versionsDir, rawJson.id);
    const plan = game.buildInstallPlan(paths, versionJson, channel);
    send('download:stage', { stage: 'natives', text: '解压原生库…' });
    const natives = await game.extractNatives(paths, versionJson.id, plan.natives);
    if (natives.skipped.length) log(`部分原生库缺失：${natives.skipped.join(', ')}`, 'warn');

    send('download:stage', { stage: 'done', text: '下载完成' });
    log(`${rawJson.id} 安装完成`, 'success');
    return {
      ok: true,
      versionId: rawJson.id,
      first: summarize(result.core),
      assets: summarize(result.assets),
    };
  } catch (e) {
    log('下载失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

function summarize(r) {
  if (!r) return null;
  return { total: r.total, done: r.done, failed: r.failed, bytes: r.bytes, elapsed: r.elapsed, errors: (r.errors || []).slice(0, 5) };
}

ipcMain.handle('download:tasks', async (_e, kind, payload) => {
  const paths = getPaths();
  const cfg = config.load();
  const threads = Number(cfg.threads) || 16;
  const channel = (payload && payload.source) || cfg.source;
  try {
    if (kind === 'assets') {
      const tasks = game.buildAssetObjectTasks(paths, payload.assetIndexId, channel);
      if (!tasks.length) return { ok: false, error: '未找到资源索引 ' + payload.assetIndexId };
      const r = await downloadMany(tasks, { threads, onProgress: progressEmitter('资源文件') });
      return { ok: r.failed === 0, ...summarize(r) };
    }
    if (kind === 'libraries') {
      const versionJson = game.resolveFullVersion(paths.versionsDir, payload.versionId);
      const plan = game.buildInstallPlan(paths, versionJson, channel);
      const libTasks = plan.tasks.filter((t) => !t.name.startsWith('assets'));
      const r = await downloadMany(libTasks, { threads, onProgress: progressEmitter('库文件') });
      return { ok: r.failed === 0, ...summarize(r) };
    }
    if (kind === 'client') {
      const versionJson = game.resolveFullVersion(paths.versionsDir, payload.versionId);
      const plan = game.buildInstallPlan(paths, versionJson, channel);
      const jarTasks = plan.tasks.filter((t) => t.name.endsWith('.jar') && t.dest.includes(path.sep + 'versions' + path.sep));
      const r = await downloadMany(jarTasks, { threads, onProgress: progressEmitter('客户端') });
      return { ok: r.failed === 0, ...summarize(r) };
    }
    return { ok: false, error: '未知下载类型: ' + kind };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* =========================================================
 * Java 管理
 * =======================================================*/
ipcMain.handle('java:detect', async () => {
  log('检测系统 Java …');
  const list = await Java.detectJavaVerified();
  log(list.length ? `发现 ${list.length} 个 Java 运行时` : '未发现可用 Java', list.length ? 'success' : 'warn');
  return list;
});

ipcMain.handle('java:listAdoptium', async (_e, major, imageType) => {
  try {
    const res = await Java.listAdoptium(major, imageType || 'jdk');
    return {
      ok: true,
      endpoint: res.endpoint,
      items: (res.items || res.data || []).map((a) => ({
        id: a.id,
        name: a.name || a.release_name,
        semver: a.semver || (a.version && a.version.semver) || '',
        major: a.major != null ? a.major : a.version && a.version.major,
        imageType: a.imageType || (a.binary && a.binary.image_type) || '',
        size: a.size || (a.binary && a.binary.package && a.binary.package.size) || 0,
        link: a.link || (a.binary && a.binary.package && a.binary.package.link) || '',
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('java:installAdoptium', async (_e, item) => {
  const paths = getPaths();
  try {
    log(`下载 TUNA Adoptium：${item.name} …`);
    const res = await Java.downloadAdoptium(item, progressEmitter('Java ' + item.major));
    log('下载完成，解压中…');
    const extractDir = path.join(res.destDir, 'runtime');
    await Java.extractArchive(res.archive, extractDir);
    const exe = Java.findJavaIn(extractDir, 5);
    if (!exe) throw new Error('解压后未找到 java 可执行文件');
    const ver = await Java.getJavaVersion(exe);
    log(`Java ${ver.version} 安装完成`, 'success');
    return { ok: true, javaPath: exe, version: ver.version, major: ver.major };
  } catch (e) {
    log('Java 下载失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('java:listMojang', async () => {
  try {
    const list = await Java.listMojangRuntimes();
    return { ok: true, items: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('java:installMojang', async (_e, entry) => {
  try {
    log(`下载 Mojang 官方运行时：${entry.component} ${entry.name} …`);
    const res = await Java.downloadMojangRuntime(entry, progressEmitter('Mojang Java'));
    const exe = Java.findJavaIn(res.destDir, 5);
    if (!exe) throw new Error('下载后未找到 java 可执行文件');
    const ver = await Java.getJavaVersion(exe);
    log(`Mojang 运行时安装完成：Java ${ver.version}`, 'success');
    return { ok: true, javaPath: exe, version: ver.version, major: ver.major };
  } catch (e) {
    log('Mojang 运行时下载失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

/** 自动补全 Java（按版本要求） */
ipcMain.handle('java:ensure', async (_e, versionId) => {
  const paths = getPaths();
  const cfg = config.load();
  let required = 8;
  try {
    const vj = game.resolveFullVersion(paths.versionsDir, versionId);
    if (vj.javaVersion && vj.javaVersion.majorVersion) required = vj.javaVersion.majorVersion;
  } catch (e) { /* 版本未安装 */ }

  if (cfg.javaPath && fileExists(cfg.javaPath)) {
    const v = await Java.getJavaVersion(cfg.javaPath);
    if ((v.major || 0) >= required) return { ok: true, javaPath: cfg.javaPath, version: v.version, major: v.major, source: 'settings' };
  }
  const installed = await Java.detectJavaVerified();
  const suitable = installed.filter((j) => (j.major || 0) >= required);
  if (suitable.length) {
    const pick = suitable[suitable.length - 1];
    log(`使用已安装 Java ${pick.version}（需要 ${required}+）`, 'success');
    return { ok: true, javaPath: pick.path, version: pick.version, major: pick.major, source: 'system' };
  }
  log(`需要 Java ${required}+，本机未找到，自动下载 Adoptium ${required} …`, 'warn');
  return await runtime.installAdoptium(required, log, progressEmitter);
});

/* =========================================================
 * Mod 加载器
 * =======================================================*/
ipcMain.handle('loader:list', async (_e, loader, mcVersion) => {
  const svc = new ModLoaderService(getPaths());
  try {
    const items = await svc.list(loader, mcVersion);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('loader:install', async (_e, payload) => {
  const paths = getPaths();
  const cfg = config.load();
  const svc = new ModLoaderService(paths);
  const { loader, mcVersion, version } = payload;

  try {
    // Forge / NeoForge 安装器需要 Java
    let javaPath = cfg.javaPath;
    if (loader === 'forge' || loader === 'neoforge') {
      const found = await runtime.findJava(cfg, 8, cfg.javaPath);
      if (!found) {
        log('运行安装器需要 Java，正在自动补全…', 'warn');
        const ensured = await runtime.installAdoptium(8, log, progressEmitter('Java 8'));
        if (!ensured.ok) return { ok: false, error: ensured.error };
        javaPath = ensured.javaPath;
      } else {
        javaPath = found.javaPath;
      }
    }

    const res = await svc.install(loader, mcVersion, version, javaPath, (m, level) => log(m, level || 'debug'), progressEmitter(loader));
    log(`${loader} 安装完成：${res.versionId}`, 'success');
    return { ok: true, versionId: res.versionId };
  } catch (e) {
    log(`${loader} 安装失败: ${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
});

/* =========================================================
 * 账户
 * =======================================================*/
ipcMain.handle('account:offline', (_e, username) => account.buildOfflineAccount(username));
ipcMain.handle('account:uuid', (_e, username) => account.offlineUuid(username));
ipcMain.handle('account:microsoftAuthUrl', () => account.getMicrosoftAuthUrl());
ipcMain.handle('account:loginWithMicrosoft', async (_e, payload) => {
  const { authorizationCode, clientId } = payload || {};
  try {
    log(`发起微软账号登录...`);
    const result = await account.loginWithMicrosoft(authorizationCode, clientId || '00000000402b5328');
    if (result.ok) {
      log(`✓ 微软账号登录成功：${result.account.username}`, 'success');
      return result;
    } else {
      throw new Error(result.steps?.join('\n') || '登录失败');
    }
  } catch (e) {
    log(`✗ 微软账号登录失败：${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
});

/* =========================================================
 * 实例
 * =======================================================*/
ipcMain.handle('instances:list', () => instances.list());
ipcMain.handle('instances:create', (_e, name) => instances.create(name));
ipcMain.handle('instances:update', (_e, id, patch) => instances.update(id, patch));
ipcMain.handle('instances:remove', (_e, id) => instances.remove(id));
ipcMain.handle('instances:get', (_e, id) => instances.get(id));

/* =========================================================
 * 启动游戏
 * =======================================================*/
ipcMain.handle('game:isRunning', () => runtime.status());
ipcMain.handle('game:kill', () => runtime.kill(log));

ipcMain.handle('game:launch', async (_e, options) =>
  runtime.launch({
    paths: getPaths(),
    options: options || {},
    log,
    send,
    cfg: config.load(),
    getInstance: (id) => instances.get(id),
    touchInstance: (id) => { try { instances.update(id, { lastPlayed: Date.now() }); } catch (e) { /* ignore */ } },
  })
);

ipcMain.handle('game:verify', async (_e, options) =>
  runtime.verify({ paths: getPaths(), options: options || {}, cfg: config.load() })
);

/* =========================================================
 * 资源中心（Modrinth）
 * =======================================================*/
ipcMain.handle('store:search', async (_e, opts) => {
  try {
    const paths = getPaths();
    const q = opts || {};
    log(`搜索资源：${q.kind || 'mod'}${q.query ? ' "' + q.query + '"' : ''}${q.gameVersion ? ' @' + q.gameVersion : ''}`);
    const r = await store.search({
      kind: q.kind === 'zhcn' ? 'resourcepack' : q.kind,
      query: q.kind === 'zhcn' && !q.query ? '汉化' : q.query,
      gameVersion: q.gameVersion,
      loader: q.loader,
      limit: q.limit || 24,
      offset: q.offset || 0,
      sortBy: q.sortBy,
    });
    log(`找到 ${r.total} 个结果`, 'success');
    return { ok: true, ...r, gameDir: paths.gameDir };
  } catch (e) {
    log('搜索失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('store:versions', async (_e, payload) => {
  try {
    const items = await store.getVersions(payload.slug, {
      gameVersion: payload.gameVersion,
      loader: payload.loader,
    });
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('store:install', async (_e, payload) => {
  const paths = getPaths();
  try {
    const kind = payload.kind;
    log(`开始安装 ${kind}：${payload.slug} …`);
    const res = await store.install(kind, payload.slug, {
      gameDir: paths.gameDir,
      gameVersion: payload.gameVersion,
      loader: payload.loader,
      versionId: payload.versionId,
      onBytes: (n) => { /* 可由 download:progress 汇总 */ },
    });
    log(`已安装 ${res.label} ${res.version} → ${res.resourcePackDir}/${res.file}`, 'success');
    if (res.dependencies && res.dependencies.length) {
      const deps = res.dependencies.filter((d) => d.project_id && d.dependency_type === 'required');
      if (deps.length) log(`该资源还需要 ${deps.length} 个前置模组，请一并安装`, 'warn');
    }
    return { ok: true, ...res };
  } catch (e) {
    log('安装失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('store:installModpack', async (_e, payload) => {
  const paths = getPaths();
  try {
    log(`开始安装整合包：${payload.slug} …`);
    const res = await store.installModpack(payload.slug, {
      gameDir: paths.gameDir,
      gameVersion: payload.gameVersion,
      cacheDir: paths.cacheDir,
      threads: Number(config.load().threads) || 16,
      onBytes: (n) => { /* 进度事件由 downloadMany 触发 */ },
    });
    log(`整合包 ${res.name} 安装完成：${res.files.done}/${res.files.total} 个文件 → ${res.instanceDir}`, 'success');
    return { ok: true, ...res };
  } catch (e) {
    log('整合包安装失败: ' + e.message, 'error');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('store:mcmod', (_e, name) => {
  const url = store.mcmodSearchUrl(name);
  shell.openExternal(url);
  return { ok: true, url };
});

/* =========================================================
 * 杂项
 * =======================================================*/
ipcMain.handle('misc:clearCache', async () => {
  const paths = getPaths();
  try {
    fs.rmSync(paths.metaCacheDir, { recursive: true, force: true });
    fs.mkdirSync(paths.metaCacheDir, { recursive: true });
    log('元数据缓存已清空', 'success');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('misc:sizes', async () => runtime.sizes(getPaths()));
