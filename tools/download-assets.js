#!/usr/bin/env node
'use strict';
/** 资源对象补全工具：只下载缺失/损坏的 assets objects，优先 BMCL，失败回退官方。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPaths } = require('../src/core/paths');

const VERSION = (process.argv.find((a) => a.startsWith('--version=')) || '').split('=')[1] || '1.20.1';
const INDEX = (process.argv.find((a) => a.startsWith('--index=')) || '').split('=')[1] || '5';
const THREADS = Number((process.argv.find((a) => a.startsWith('--threads=')) || '').split('=')[1]) || 24;
const paths = buildPaths();
const indexPath = path.join(paths.indexesDir, INDEX + '.json');
if (!fs.existsSync(indexPath)) throw new Error('找不到资源索引: ' + indexPath);
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const tasks = Object.entries(index.objects || {}).map(([name, o]) => ({ name, hash: o.hash, size: o.size }));
const target = (hash) => path.join(paths.objectsDir, hash.slice(0, 2), hash);
function sha1(file) {
  const h = crypto.createHash('sha1'); const b = fs.readFileSync(file); h.update(b); return h.digest('hex');
}
const pending = tasks.filter((t) => {
  const file = target(t.hash);
  try {
    if (!fs.existsSync(file)) return true;
    return fs.statSync(file).size !== t.size || sha1(file) !== t.hash;
  } catch (_) { return true; }
});
console.log(`版本 ${VERSION}，资源索引 ${INDEX}：共 ${tasks.length}，需下载 ${pending.length}`);
let done = 0; let failed = 0; let bytes = 0; let cursor = 0;
const started = Date.now();
function progress() {
  if (Date.now() - progress.last < 2000) return;
  progress.last = Date.now();
  const speed = bytes / Math.max(0.1, (Date.now() - started) / 1000);
  console.log(`  ${done + failed}/${pending.length}，${(bytes / 1048576).toFixed(1)} MB，${(speed / 1048576).toFixed(2)} MB/s`);
}
progress.last = 0;
async function fetchOne(url, dest, timeout = 25000) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'AuroraCraft/1.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally { clearTimeout(timer); }
}
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= pending.length) return;
    const task = pending[i];
    const dest = target(task.hash);
    const rel = task.hash.slice(0, 2) + '/' + task.hash;
    const urls = [`https://bmclapi2.bangbang93.com/assets/${rel}`, `https://resources.download.minecraft.net/${rel}`];
    let ok = false;
    for (const url of urls) {
      const tmp = dest + '.tmp' + process.pid + '-' + i;
      try {
        const n = await fetchOne(url, tmp);
        if (n !== task.size || sha1(tmp) !== task.hash) throw new Error('SHA1/大小不匹配');
        fs.renameSync(tmp, dest);
        bytes += n; ok = true; break;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      }
    }
    if (ok) done++; else { failed++; console.error('失败', task.name); }
    progress();
  }
}
(async () => {
  await Promise.all(Array.from({ length: Math.min(THREADS, pending.length) }, worker));
  console.log(`完成：成功 ${done}，失败 ${failed}，用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (failed) process.exitCode = 1;
})();
