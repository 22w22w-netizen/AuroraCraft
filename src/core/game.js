'use strict';

/**
 * 游戏安装与启动
 * - 解析版本 JSON（含 inheritsFrom 继承链合并）
 * - 生成客户端 / 库 / 资源 / 原生库下载任务
 * - 构建启动命令行（JVM 参数 + 游戏参数 + 占位符替换）
 * - 生成并写入 log4j 配置
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { SOURCES, toMirrorUrl } = require('./sources');
const { readJsonSafe, writeJsonSafe, getJson, fileExists } = require('./http');
const { downloadMany, downloadOne, ensureDir } = require('./downloader');
const vm = require('./version-model');

/* ============ 版本 JSON 读取 & 继承合并 ============ */

function readVersionJson(versionsDir, versionId) {
  const file = path.join(versionsDir, versionId, versionId + '.json');
  const json = readJsonSafe(file);
  if (!json) throw new Error(`未找到版本 ${versionId}（缺少 ${file}）`);
  return json;
}

/**
 * 合并继承链：子版本覆盖父版本
 */
function resolveFullVersion(versionsDir, versionId, depth = 0) {
  if (depth > 8) throw new Error('版本继承链过深');
  const json = readVersionJson(versionsDir, versionId);
  const parentId = Array.isArray(json.inheritsFrom) ? json.inheritsFrom[0] : json.inheritsFrom;
  if (!parentId) {
    return { ...json, libraries: json.libraries || [] };
  }
  const parent = resolveFullVersion(versionsDir, parentId, depth + 1);

  const libKeys = new Set();
  const merged = [];
  for (const l of parent.libraries || []) {
    const key = l.name;
    if (libKeys.has(key)) continue;
    libKeys.add(key);
    merged.push(l);
  }
  for (const l of json.libraries || []) {
    if (libKeys.has(l.name)) {
      const idx = merged.findIndex((x) => x.name === l.name);
      merged[idx] = l;
    } else {
      libKeys.add(l.name);
      merged.push(l);
    }
  }

  const jvmArgs = [];
  if (Array.isArray(parent.arguments && parent.arguments.jvm)) jvmArgs.push(...parent.arguments.jvm);
  if (Array.isArray(json.arguments && json.arguments.jvm)) jvmArgs.push(...json.arguments.jvm);
  // 旧版 minecraftArguments
  const legacy = [parent.minecraftArguments, json.minecraftArguments].filter(Boolean).join(' ');

  return {
    ...parent,
    ...json,
    id: json.id,
    libraries: merged,
    arguments: { jvm: jvmArgs, game: dedupeArgs([...(parent.arguments && parent.arguments.game) || [], ...(json.arguments && json.arguments.game) || []]) },
    minecraftArguments: legacy || parent.minecraftArguments || json.minecraftArguments,
    assetIndex: json.assetIndex || parent.assetIndex,
    downloads: { ...(parent.downloads || {}), ...(json.downloads || {}) },
    mainClass: json.mainClass || parent.mainClass,
    jar: json.jar || parent.jar || parent.id,
  };
}

function dedupeArgs(args) {
  // 保留顺序，去重完全相同的字符串项（继承链常重复）
  const out = [];
  const seen = new Set();
  for (const a of args) {
    if (typeof a === 'string') {
      if (seen.has(a)) continue;
      seen.add(a);
    }
    out.push(a);
  }
  return out;
}

/* ============ 下载任务构建 ============ */

function mirrorUrl(url, sourceId) {
  if (!url) return url;
  if (sourceId === 'mojang') return url;
  const m = toMirrorUrl(url, 'https://bmclapi2.bangbang93.com/');
  return m || url;
}

/**
 * 构建完整安装任务清单
 * @returns {{tasks: object[], missing: object[], versionJson: object, natives: object[]}}
 */
function buildInstallPlan(paths, versionJson, sourceId, options = {}) {
  const tasks = [];
  const { skipAssets = false } = options;

  // 1) 客户端 jar（继承版本可能没有自己的 jar，用父版本 jar）
  const jarId = versionJson.jar || versionJson.id;
  if (versionJson.downloads && versionJson.downloads.client && jarId === versionJson.id) {
    const c = versionJson.downloads.client;
    const target = versionJson.id;
    const parentJar = path.join(paths.versionsDir, jarId, jarId + '.jar');
    tasks.push({
      url: mirrorUrl(c.url, sourceId),
      dest: path.join(paths.versionsDir, versionJson.id, versionJson.id + '.jar'),
      sha1: c.sha1,
      size: c.size,
      name: versionJson.id + '.jar',
      optionalIfParent: jarId !== versionJson.id ? parentJar : null,
    });
  }

  // 2) 库与原生库
  const { libraries, natives } = vm.resolveLibraries(versionJson, {});
  for (const lib of libraries) {
    if (!lib.url) continue;
    tasks.push({
      url: mirrorUrl(lib.url, sourceId),
      dest: path.join(paths.librariesDir, lib.path),
      sha1: lib.sha1,
      size: lib.size,
      name: lib.path,
    });
  }

  // 3) 资源索引 + 资源对象
  const assetPlan = buildAssetTasks(paths, versionJson, sourceId, skipAssets);
  tasks.push(...assetPlan.tasks);

  // 4) 日志配置（客户端自带）
  if (versionJson.logging && versionJson.logging.client && versionJson.logging.client.file) {
    const lf = versionJson.logging.client.file;
    tasks.push({
      url: mirrorUrl(lf.url, sourceId),
      dest: path.join(paths.logConfigDir, lf.id),
      sha1: lf.sha1,
      size: lf.size,
      name: lf.id,
    });
  }

  return { tasks, natives, versionJson, assetIndexId: assetPlan.assetIndexId };
}

function buildAssetTasks(paths, versionJson, sourceId, skipAssets) {
  const tasks = [];
  if (!versionJson.assetIndex || skipAssets) {
    return { tasks, assetIndexId: versionJson.assetIndex ? versionJson.assetIndex.id : null };
  }
  const ai = versionJson.assetIndex;
  const indexFile = path.join(paths.indexesDir, ai.id + '.json');
  tasks.push({
    url: mirrorUrl(ai.url, sourceId),
    dest: indexFile,
    sha1: ai.sha1,
    size: ai.size,
    name: 'assets-index-' + ai.id,
    isIndex: true,
  });
  return { tasks, assetIndexId: ai.id, pendingIndex: true };
}

/**
 * 由已下载的 asset index 生成资源对象任务
 */
function buildAssetObjectTasks(paths, assetIndexId, sourceId) {
  const indexFile = path.join(paths.indexesDir, assetIndexId + '.json');
  const index = readJsonSafe(indexFile);
  if (!index) return [];
  const tasks = [];
  const objs = index.objects || {};
  for (const [name, obj] of Object.entries(objs)) {
    if (!obj || !obj.hash) continue;
    const sub = obj.hash.slice(0, 2);
    tasks.push({
      url: mirrorUrl(SOURCES.mojang.assetsBase + sub + '/' + obj.hash, sourceId),
      dest: path.join(paths.objectsDir, sub, obj.hash),
      sha1: obj.hash,
      size: obj.size,
      name: 'assets/' + name,
    });
  }
  return tasks;
}

/* ============ 原生库解压 ============ */

/**
 * 解压原生库到 natives 目录（跳过 META-INF）
 */
async function extractNatives(paths, versionId, natives) {
  const destDir = path.join(paths.nativesCacheDir, versionId);
  ensureDir(destDir);
  const skipped = [];
  for (const n of natives) {
    const jar = path.join(paths.librariesDir, n.path);
    if (!fileExists(jar)) {
      skipped.push(n.path);
      continue;
    }
    const exclude = (n.extract && n.extract.exclude) || ['META-INF/'];
    try {
      await extractZipEntries(jar, destDir, exclude);
    } catch (e) {
      skipped.push(n.path + ' (' + e.message + ')');
    }
  }
  return { destDir, skipped };
}

/**
 * 最小化 zip 解压实现（读取中央目录，支持 deflate/store）
 */
function extractZipEntries(zipPath, destDir, excludes) {
  const buf = fs.readFileSync(zipPath);
  const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdIdx < 0) throw new Error('无效的 zip 文件');
  const total = buf.readUInt16LE(eocdIdx + 10);
  let ptr = buf.readUInt32LE(eocdIdx + 16);
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (excludes.some((ex) => name.startsWith(ex) || name.includes('.git'))) continue;

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) {
      try { out = zlib.inflateRawSync(data); } catch (e) { continue; }
    } else continue;

    const target = path.join(destDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
  }
}

/* ============ 参数构建 ============ */

/**
 * 构建启动参数
 */
function buildLaunchCommand(ctx) {
  const {
    paths,
    versionJson,
    javaPath,
    account,
    gameDir,
    jvmArgs = '',
    gameArgs = '',
    minMemory = 1024,
    maxMemory = 4096,
    width = 0,
    height = 0,
    features = {},
    serverAddress = '',
    serverPort = '',
  } = ctx;

  const nativesDir = path.join(paths.nativesCacheDir, versionJson.id);
  const { libraries } = vm.resolveLibraries(versionJson, features);

  // 从当前平台的原生库 jar 中提取实际 dll/so（现代版本以普通 artifact 提供）。
  const nativeLibraries = libraries.filter((l) => /natives-/.test(l.name || l.path) || l.isNative);
  const nativeDir = path.join(paths.nativesCacheDir, versionJson.id);
  ensureDir(nativeDir);
  for (const lib of nativeLibraries) {
    const jar = path.join(paths.librariesDir, lib.path);
    if (fileExists(jar)) {
      try { extractZipEntries(jar, nativeDir, ['META-INF/']); } catch (_) { /* 非原生 jar 无影响 */ }
    }
  }

  const classpath = [];
  const jarId = versionJson.jar || versionJson.id;
  let clientJar = path.join(paths.versionsDir, jarId, jarId + '.jar');
  // Forge 1.17+ / NeoForge 使用 BootstrapLauncher，其 -DignoreList 中包含 `${version_name}.jar`。
  // 若把父版本原版 jar（如 1.20.1.jar）直接加入类路径，它会被识别为自动模块 `_1._20._1`，
  // 与 forge 的 minecraft 模块产生包冲突（ResolutionException: Module minecraft contains package ...）。
  // 因此这里把原版 jar 以「本版本名」复制一份，使其正好命中 ignoreList。
  const isBootstrap = /bootstraplauncher/i.test(String(versionJson.mainClass || ''));
  if (isBootstrap && jarId !== versionJson.id) {
    const ownJar = path.join(paths.versionsDir, versionJson.id, versionJson.id + '.jar');
    if (!fileExists(ownJar) && fileExists(clientJar)) {
      try { fs.copyFileSync(clientJar, ownJar); } catch (e) { /* 复制失败则退回原路径 */ }
    }
    if (fileExists(ownJar)) clientJar = ownJar;
  }
  for (const lib of libraries) {
    const p = path.join(paths.librariesDir, lib.path);
    if (fileExists(p)) classpath.push(p);
  }
  if (fileExists(clientJar)) classpath.push(clientJar);

  const vars = {
    auth_player_name: account.username,
    version_name: versionJson.id,
    game_directory: gameDir,
    assets_root: paths.assetsDir,
    game_assets: paths.assetsDir,
    assets_index_name: versionJson.assetIndex ? versionJson.assetIndex.id : 'legacy',
    auth_uuid: account.uuid || account.uuidBare,
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken || '0',
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '',
    user_type: account.userType || 'legacy',
    version_type: versionJson.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'AuroraCraft',
    launcher_version: '1.0.0',
    classpath: classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: paths.librariesDir,
    resolution_width: width || 0,
    resolution_height: height || 0,
    user_properties: '{}',
    auth_client_id: account.clientId || '',
  };

  const args = [javaPath];

  // 内存
  const memMax = Math.max(512, Number(maxMemory) || 4096);
  const memMin = Math.max(256, Math.min(Number(minMemory) || 1024, memMax));
  args.push(`-Xms${memMin}M`, `-Xmx${memMax}M`);

  // 版本自带 JVM 参数
  let versionJvm = [];
  if (versionJson.arguments && Array.isArray(versionJson.arguments.jvm)) {
    versionJvm = vm.expandArgs(versionJson.arguments.jvm, features);
  } else {
    versionJvm = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  }
  for (const a of versionJvm) args.push(vm.substitute(a, vars));

  // 用户自定义 JVM 参数
  for (const a of String(jvmArgs || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    args.push(a.replace(/^"|"$/g, ''));
  }

  // 若版本未带 -cp，则补充
  if (!args.some((a) => a === '-cp' || a === '-classpath')) {
    args.push('-cp', vars.classpath);
  }
  if (!args.some((a) => a.startsWith('-Djava.library.path'))) {
    args.push('-Djava.library.path=' + nativesDir);
  }

  args.push(versionJson.mainClass);

  // 游戏参数
  let gameList = [];
  if (versionJson.arguments && Array.isArray(versionJson.arguments.game)) {
    gameList = vm.expandArgs(versionJson.arguments.game, features);
  } else if (versionJson.minecraftArguments) {
    gameList = String(versionJson.minecraftArguments).split(/\s+/).filter(Boolean);
  }
  if (serverAddress) {
    gameList = gameList.concat(['--server', serverAddress]);
    if (serverPort) gameList = gameList.concat(['--port', String(serverPort)]);
  }
  for (const a of gameList) args.push(vm.substitute(a, vars));

  // 用户自定义游戏参数
  for (const a of String(gameArgs || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    args.push(a.replace(/^"|"$/g, ''));
  }

  return { args, classpath, nativesDir, vars };
}

/** 生成 log4j 配置文件（从版本 logging 配置改写为写入 logs 目录） */
function prepareLog4jConfig(paths, versionJson) {
  if (!versionJson.logging || !versionJson.logging.client) return null;
  const lc = versionJson.logging.client;
  const src = path.join(paths.logConfigDir, lc.file.id);
  if (!fileExists(src)) return null;
  try {
    let content = fs.readFileSync(src, 'utf8');
    // Mojang 客户端默认用 LegacyXMLLayout 把日志以 XML 事件流写到 stdout；
    // 启动器需要可读文本，故替换为普通 PatternLayout。
    content = content.replace(/<LegacyXMLLayout\s*\/>/g, '<PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level] [%logger]: %msg%n" />');
    // 日志文件统一落到启动器日志目录，避免多实例互相覆盖
    content = content.replace(/fileName="[^"]*"/, 'fileName="' + path.join(paths.logDir, 'game.log').replace(/\\/g, '/') + '"');
    content = content.replace(/filePattern="[^"]*"/, 'filePattern="' + path.join(paths.logDir, 'game-%d{yyyy-MM-dd}-%i.log.gz').replace(/\\/g, '/') + '"');
    const outName = 'log4j2-' + versionJson.id.replace(/[^\w.-]/g, '_') + '.xml';
    const outPath = path.join(paths.logConfigDir, outName);
    fs.writeFileSync(outPath, content, 'utf8');
    return outPath;
  } catch (e) {
    return null;
  }
}

module.exports = {
  readVersionJson,
  resolveFullVersion,
  buildInstallPlan,
  buildAssetObjectTasks,
  extractNatives,
  extractZipEntries,
  buildLaunchCommand,
  prepareLog4jConfig,
  mirrorUrl,
};
