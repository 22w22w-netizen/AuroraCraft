'use strict';

/**
 * 纯 JS zip 解压（不依赖子进程 / 原生模块）
 * 支持 store(0) 与 deflate(8)，读取中央目录，跳过目录与危险路径。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/** 列表读取单个 zip 条目 */
function readEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('无效的 zip 文件（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CEN) break;
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const nameRaw = buf.slice(ptr + 46, ptr + 46 + nameLen);
    const utf8 = (flags & 0x800) !== 0;
    let name;
    try {
      name = utf8 ? nameRaw.toString('utf8') : nameRaw.toString('utf8');
    } catch (e) {
      name = nameRaw.toString('latin1');
    }
    entries.push({ name, method, compSize, uncompSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 解压单个条目数据 */
function readEntryData(buf, entry) {
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('损坏的 zip 条目: ' + entry.name);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩算法 ' + entry.method + '：' + entry.name);
}

/** 防止 zip slip */
function safeJoin(destDir, name) {
  const norm = String(name).replace(/\\/g, '/');
  const target = path.resolve(destDir, norm);
  const root = path.resolve(destDir);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * 解压 zip 到目录
 * @returns {Promise<{files:number, skipped:number}>}
 */
async function extractZipToDir(zipPath, destDir, onProgress) {
  const buf = fs.readFileSync(zipPath);
  const entries = readEntries(buf);
  fs.mkdirSync(destDir, { recursive: true });

  const fileEntries = entries.filter((e) => !e.name.endsWith('/'));
  let files = 0;
  let skipped = 0;
  let lastReport = 0;

  // 先建目录，再逐个写文件（慢盘环境下一次性建目录开销更可控）
  for (const entry of entries) {
    if (!entry.name.endsWith('/')) continue;
    const dir = safeJoin(destDir, entry.name);
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  for (const entry of fileEntries) {
    const target = safeJoin(destDir, entry.name);
    if (!target) {
      skipped += 1;
      continue;
    }
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const data = readEntryData(buf, entry);
    // 先写临时文件再重命名，避免慢盘下留下半截文件
    const tmp = target + '.part';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
    files += 1;

    const now = Date.now();
    if (onProgress && now - lastReport > 500) {
      lastReport = now;
      onProgress({ done: files, total: fileEntries.length, current: path.basename(entry.name) });
    }
  }
  if (onProgress) onProgress({ done: files, total: fileEntries.length, current: '' });
  return { files, skipped };
}

/** 仅列出 zip 中某前缀下的文件名 */
function listZipFiles(zipPath, prefix = '') {
  const buf = fs.readFileSync(zipPath);
  return readEntries(buf)
    .filter((e) => !e.name.endsWith('/') && e.name.startsWith(prefix))
    .map((e) => e.name);
}

module.exports = { extractZipToDir, listZipFiles, readEntries, readEntryData };
