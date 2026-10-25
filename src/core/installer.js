'use strict';
/** 完整原版安装：客户端、库、日志配置、资源索引及全部资源对象。 */
const fs = require('fs');
const path = require('path');
const { downloadMany, sha1File } = require('./downloader');
const { resolveFullVersion, buildAssetObjectTasks, mirrorUrl } = require('./game');
const vm = require('./version-model');
const { SOURCES, BMCL, toMirrorUrl } = require('./sources');
const { writeJsonSafe } = require('./http');
const { parseLibrary } = vm;

function sourceUrls(url, source, kind) {
  if (!url) return [];
  const official = url;
  const mirror = toMirrorUrl(url, BMCL);
  if (source === 'mojang') return [official];
  return mirror ? [mirror, official] : [official];
}
async function valid(file, sha1) {
  if (!fs.existsSync(file)) return false;
  if (!sha1) return true;
  try { return (await sha1File(file)).toLowerCase() === sha1.toLowerCase(); }
  catch (_) { return false; }
}
async function installVersion(paths, baseJson, options = {}) {
  const source = options.source || 'auto';
  const onProgress = options.onProgress || (() => {});
  const onLog = options.onLog || (() => {});
  const json = resolveFullVersion(paths.versionsDir, baseJson.id);
  writeJsonSafe(path.join(paths.versionsDir, baseJson.id, `${baseJson.id}.json`), baseJson);
  const tasks = [];
  if (json.downloads && json.downloads.client) {
    const c = json.downloads.client;
    tasks.push({ urls: sourceUrls(c.url, source), url: c.url, dest: path.join(paths.versionsDir, baseJson.id, `${baseJson.id}.jar`), sha1: c.sha1, size: c.size, name: '游戏客户端' });
  }
  for (const lib of vm.resolveLibraries(json, {}).libraries) {
    let urls = sourceUrls(lib.url, source);
    if (!urls.length && lib.name) {
      const rel = parseLibrary({ name: lib.name }).path;
      urls = source === 'mojang'
        ? ['https://libraries.minecraft.net/' + rel, 'https://maven.fabricmc.net/' + rel, 'https://maven.minecraftforge.net/' + rel]
        : [BMCL + 'maven/' + rel, 'https://libraries.minecraft.net/' + rel, 'https://maven.fabricmc.net/' + rel, 'https://maven.minecraftforge.net/' + rel];
      lib.path = rel;
    }
    tasks.push({ url: urls[0], urls, dest: path.join(paths.librariesDir, lib.path), sha1: lib.sha1, size: lib.size, name: lib.path });
  }
  if (json.logging && json.logging.client && json.logging.client.file) {
    const f = json.logging.client.file;
    tasks.push({ url: f.url, urls: sourceUrls(f.url, source), dest: path.join(paths.logConfigDir, f.id), sha1: f.sha1, size: f.size, name: '日志配置' });
  }
  let assetIndex = null;
  if (json.assetIndex && !options.skipAssets) {
    assetIndex = json.assetIndex;
    tasks.push({ url: assetIndex.url, urls: sourceUrls(assetIndex.url, source), dest: path.join(paths.indexesDir, `${assetIndex.id}.json`), sha1: assetIndex.sha1, size: assetIndex.size, name: '资源索引' });
  }
  const pending = [];
  for (const task of tasks) if (!(await valid(task.dest, task.sha1))) pending.push(task);
  onLog(`客户端与库：共 ${tasks.length} 项，需下载 ${pending.length} 项`);
  const first = await downloadMany(pending, { threads: options.threads || 16, timeout: 180000, retries: 4, onProgress });
  if (first.failed) throw new Error(`客户端或库下载失败 ${first.failed} 项：${first.errors.slice(0, 3).map(e => e.name + ' ' + e.message).join('；')}`);
  let assets = { total: 0, done: 0, failed: 0, errors: [] };
  if (assetIndex) {
    const objects = buildAssetObjectTasks(paths, assetIndex.id, 'mojang').map((t) => {
      const rel = t.url.replace('https://resources.download.minecraft.net/', '');
      const mirror = `${BMCL}assets/${rel}`;
      // 资源 CDN 在多数网络下比 BMCLAPI 的 assets 通道稳定；镜像作为回退。
      const urls = [t.url, mirror];
      return { ...t, url: urls[0], urls };
    });
    const needed = [];
    for (const task of objects) if (!(await valid(task.dest, task.sha1))) needed.push(task);
    onLog(`游戏资源：共 ${objects.length} 项，需下载 ${needed.length} 项`);
    assets = await downloadMany(needed, { threads: options.threads || 16, timeout: 120000, retries: 4, onProgress });
    if (assets.failed) throw new Error(`资源下载失败 ${assets.failed} 项，请重试安装`);
  }
  return { version: json.id, core: first, assets, complete: true };
}
module.exports = { installVersion, sourceUrls, valid };