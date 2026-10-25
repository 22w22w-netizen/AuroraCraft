'use strict';

/**
 * 下载管理器
 * - 多线程并发下载
 * - 断点续传（HTTP Range）
 * - 失败重试 + 官方/镜像自动回退
 * - SHA1 校验（校验失败自动重新下载）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sleep, sha1Hex } = require('./http');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function isAborted(signal) {
  return !!(signal && signal.aborted);
}

/**
 * 将 URL 流式写入文件，支持 Range 断点续传。
 *
 * timeout 语义为「停滞超时」：只要持续有数据到达就不会超时，
 * 避免大文件在慢速链路上被误判失败。
 */
async function fetchToFile(url, dest, o) {
  const { resume, timeout, signal, onBytes } = o;
  const part = dest + '.part';
  let start = 0;
  if (resume && fs.existsSync(part)) {
    try { start = fs.statSync(part).size; } catch (e) { start = 0; }
  } else {
    try { fs.rmSync(part, { force: true }); } catch (e) { /* ignore */ }
  }

  const ac = new AbortController();
  let timer = null;
  const armTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ac.abort(), timeout);
  };
  const link = () => ac.abort();
  if (signal) signal.addEventListener('abort', link, { once: true });
  armTimer();

  try {
    const headers = { 'User-Agent': 'AuroraCraft-Launcher/1.0.0' };
    if (start > 0) headers.Range = 'bytes=' + start + '-';
    const res = await fetch(url, { headers, redirect: 'follow', signal: ac.signal });
    const status = res.status;
    if (status === 416 && start > 0) {
      try { fs.renameSync(part, dest); } catch (e) { /* ignore */ }
      return;
    }
    if (!res.ok) {
      const err = new Error('HTTP ' + status + ' ' + url);
      err.fatal = status === 404 || status === 403;
      throw err;
    }
    if (start > 0 && status !== 206) {
      start = 0;
      try { fs.rmSync(part, { force: true }); } catch (e) { /* ignore */ }
    }
    const cl = Number(res.headers.get('content-length'));
    const total = Number.isFinite(cl) ? cl + start : 0;
    if (total && start >= total) {
      try { fs.renameSync(part, dest); } catch (e) { /* ignore */ }
      return;
    }

    const ws = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
    // 超时/取消时流会被 destroy，吞掉延迟到达的 error，避免进程崩溃。
    ws.on('error', () => {});
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimer();
        if (onBytes) onBytes(value.length);
        if (!ws.write(Buffer.from(value))) {
          await new Promise((resolve, reject) => {
            const cleanup = () => {
              ws.removeListener('drain', ok);
              ws.removeListener('error', fail);
              ac.signal.removeEventListener('abort', abort);
            };
            const ok = () => { cleanup(); resolve(); };
            const fail = (e) => { cleanup(); reject(e); };
            const abort = () => { cleanup(); reject(new Error('下载停滞超时')); };
            ws.once('drain', ok);
            ws.once('error', fail);
            if (ac.signal.aborted) abort();
            else ac.signal.addEventListener('abort', abort, { once: true });
            armTimer();
          });
        }
      }
      await new Promise((resolve, reject) => {
        ws.on('error', reject);
        ws.on('finish', resolve);
        ws.end();
      });
    } catch (e) {
      try { ws.destroy(); } catch (err) { /* ignore */ }
      throw e;
    }
    fs.renameSync(part, dest);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', link);
  }
}

/**
 * 下载单个文件（带重试与校验）
 */
async function downloadOne(task, opts = {}) {
  const { resume = true, retries = 3, timeout = 45000, signal, onBytes } = opts;
  if (task.sha1 && fs.existsSync(task.dest)) {
    try {
      if ((await sha1File(task.dest)).toLowerCase() === String(task.sha1).toLowerCase()) return true;
      fs.rmSync(task.dest, { force: true });
    } catch (_) { /* 损坏文件重新下载 */ }
  }
  const urls = task.urls && task.urls.length ? task.urls.filter(Boolean) : [task.url].filter(Boolean);
  ensureDir(path.dirname(task.dest));
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (isAborted(signal)) throw Object.assign(new Error('已取消'), { cancelled: true });
    const url = urls[Math.min(attempt, urls.length - 1)];
    try {
      await fetchToFile(url, task.dest, { resume, timeout, signal, onBytes });
      if (task.sha1) {
        const got = await sha1File(task.dest);
        if (got.toLowerCase() !== String(task.sha1).toLowerCase()) {
          try { fs.rmSync(part, { force: true }); fs.rmSync(task.dest, { force: true }); } catch (_) { /* ignore */ }
          throw new Error('SHA1 校验失败: ' + path.basename(task.dest));
        }
      }
      return true;
    } catch (e) {
      lastErr = e;
      if (isAborted(signal)) throw Object.assign(new Error('已取消'), { cancelled: true });
      if (e && e.fatal && attempt >= urls.length - 1) break;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr || new Error('下载失败: ' + task.dest);
}

/**
 * 批量下载调度器
 * @param {object[]} tasks {url, urls?, dest, sha1?, size?, name?}
 * @param {object} opts {threads, onProgress(info), signal, retries}
 */
async function downloadMany(tasks, opts = {}) {
  const threads = Math.max(1, Math.min(32, Number(opts.threads) || 8));
  const { signal, onProgress, retries = 3 } = opts;
  const totalCount = tasks.length;
  let totalBytes = 0;
  for (const t of tasks) totalBytes += Number(t.size) || 0;

  const inflight = new Map();
  let done = 0;
  let failed = 0;
  let bytes = 0;
  let unknownBytes = 0;
  const errors = [];
  const startTime = Date.now();
  let lastEmit = 0;

  const emit = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const elapsed = Math.max(0.001, (now - startTime) / 1000);
    const totalNow = bytes + unknownBytes;
    onProgress({
      total: totalCount,
      done,
      failed,
      bytes: totalNow,
      totalBytes,
      ratio: totalCount ? (done + failed) / totalCount : 0,
      byteRatio: totalBytes ? Math.min(1, totalNow / totalBytes) : Math.min(1, totalCount ? (done + failed) / totalCount : 0),
      speed: totalNow / elapsed,
      elapsed,
      current: [...inflight.values()].slice(0, 8),
    });
  };

  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      const task = tasks[idx];
      if (isAborted(signal)) return;
      inflight.set(idx, task.name || path.basename(task.dest));
      emit(true);
      try {
        await downloadOne(task, {
          retries,
          signal,
          onBytes: (n) => {
            bytes += n;
            emit(false);
          },
        });
        done += 1;
        if (!task.size) {
          try { unknownBytes += fs.statSync(task.dest).size; } catch (e) { /* ignore */ }
        }
      } catch (e) {
        if (e && e.cancelled) return;
        failed += 1;
        errors.push({ name: task.name || path.basename(task.dest), url: task.url, message: e.message });
        if (opts.onTaskError) opts.onTaskError(task, e);
      } finally {
        inflight.delete(idx);
        emit(true);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(threads, tasks.length); i++) workers.push(worker());
  await Promise.all(workers);
  emit(true);
  return { total: totalCount, done, failed, errors, bytes: bytes + unknownBytes, totalBytes, elapsed: (Date.now() - startTime) / 1000 };
}
module.exports = { sha1File, ensureDir, fetchToFile, downloadOne, downloadMany };
