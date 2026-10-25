'use strict';

/**
 * 下载源测速
 * 对三档渠道并发测速：测量延迟与吞吐，返回排序结果
 */

const SPEED_TARGETS = [
  {
    id: 'mojang',
    name: 'Mojang 官方',
    url: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  },
  {
    id: 'bmcl',
    name: 'BMCLAPI 镜像',
    url: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  },
  {
    id: 'bangbang',
    name: 'BangBang 加速',
    url: 'https://bmclapi2.bangbang93.com/assets/',
  },
];

/**
 * 测量单个 URL 的延迟与下载速度
 * @returns {Promise<{id,name,url,ok,status,ms,bytes,speed,error}>}
 */
async function testOne(target, timeout = 8000) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(target.url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AuroraCraft-Launcher/1.0.0', Range: 'bytes=0-262143' },
    });
    let bytes = 0;
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (reader) {
      let guard = 0;
      while (guard++ < 64) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value ? value.length : 0;
        if (bytes > 262144) break;
        if (Date.now() - started > timeout) break;
      }
      try { await reader.cancel(); } catch (e) { /* ignore */ }
    }
    const ms = Math.max(1, Date.now() - started);
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: res.ok,
      status: res.status,
      ms,
      bytes,
      speed: bytes / (ms / 1000),
      error: null,
    };
  } catch (e) {
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      bytes: 0,
      speed: 0,
      error: String((e && e.message) || e).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对所有渠道并发测速，返回排序结果（可用优先，其次延迟低）
 */
async function testAll(targets = SPEED_TARGETS, timeout = 8000) {
  const results = await Promise.all(targets.map((t) => testOne(t, timeout)));
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.ms - b.ms;
  });
  return results;
}

/** 测速并给出最佳源 id */
async function pickBest(timeout = 8000) {
  const results = await testAll(SPEED_TARGETS, timeout);
  const best = results.find((r) => r.ok);
  return { results, best: best ? best.id : 'mojang' };
}

module.exports = { SPEED_TARGETS, testOne, testAll, pickBest };
