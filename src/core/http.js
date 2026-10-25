'use strict';

/**
 * HTTP 工具：带超时 / 重试 / 本地缓存的 JSON 请求
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TIMEOUT = 30000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fileExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

function readJsonSafe(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function sha1Hex(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * 发起请求并返回完整响应体（Buffer）。支持超时、重试、重定向。
 */
async function request(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, retries = 2, method = 'GET', headers = {}, signal } = options;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const onOuterAbort = () => ac.abort();
    if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'User-Agent': 'AuroraCraft-Launcher/1.0.0', 'Cache-Control': 'no-cache', ...headers },
      });
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status + ' ' + url);
        err.status = res.status;
if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        return { buf, status: res.status, url: res.url, headers: res.headers };
      }
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
    if (attempt < retries) await sleep(400 * (attempt + 1));
  }
  throw lastErr || new Error('请求失败: ' + url);
}

async function getJson(url, options = {}) {
  const { buf } = await request(url, options);
  return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
}

async function getText(url, options = {}) {
  const { buf } = await request(url, options);
  return buf.toString('utf8');
}

module.exports = { DEFAULT_TIMEOUT, sleep, fileExists, readJsonSafe, writeJsonSafe, sha1Hex, request, getJson, getText };