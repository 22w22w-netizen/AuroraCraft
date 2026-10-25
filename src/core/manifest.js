'use strict';

/**
 * 版本清单服务
 * - 获取 version_manifest_v2 并本地缓存（按渠道分文件）
 * - 获取单个版本 JSON 并缓存
 * - 自动渠道：镜像优先，失败回退官方
 */
const path = require('path');
const fs = require('fs');
const { SOURCES, toMirrorUrl } = require('./sources');
const { getJson, writeJsonSafe, readJsonSafe } = require('./http');

const CACHE_TTL = 30 * 60 * 1000; // 版本清单缓存 30 分钟

class ManifestService {
  constructor(paths) {
    this.paths = paths;
  }

  manifestFile(channel) {
    return path.join(this.paths.metaCacheDir, `manifest-${channel}.json`);
  }

  versionFile(versionId) {
    return path.join(this.paths.metaCacheDir, `version-${versionId}.json`);
  }

  /** 渠道 -> 规范化渠道 id */
  _channel(source) {
    const id = typeof source === 'string' ? source : 'auto';
    return SOURCES[id] ? id : 'auto';
  }

  /**
   * 获取版本清单
   * @param {string} source 渠道 id
   * @param {{force?: boolean}} opts
   */
  async getManifest(source, opts = {}) {
    const channel = this._channel(source);
    const file = this.manifestFile(channel);

    if (!opts.force) {
      const cached = readJsonSafe(file);
      if (cached && Array.isArray(cached.versions)) {
        const age = Date.now() - (cached._fetchedAt || 0);
        if (age < CACHE_TTL) return cached;
      }
    }

    const candidates = this._manifestCandidates(channel);
    let lastErr = null;
    for (const url of candidates) {
      try {
        const data = await getJson(url, { timeout: 20000, retries: 1 });
        if (!data || !Array.isArray(data.versions)) throw new Error('清单格式异常');
        data._fetchedAt = Date.now();
        data._channel = channel;
        writeJsonSafe(file, data);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    // 网络失败时回退过期缓存
    const stale = readJsonSafe(file);
    if (stale && Array.isArray(stale.versions)) return { ...stale, _stale: true };
    throw lastErr || new Error('无法获取版本清单');
  }

  _manifestCandidates(channel) {
    if (channel === 'mojang') {
      return ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'];
    }
    if (channel === 'auto') {
      return [SOURCES.bmcl.versionManifest, SOURCES.mojang.versionManifest];
    }
    return [SOURCES[channel].versionManifest, SOURCES.mojang.versionManifest];
  }

  /** 将版本 JSON 中的 URL 映射到渠道 URL */
  _channelUrl(url, channel) {
    if (!url) return url;
    if (channel === 'mojang') return url;
    return toMirrorUrl(url) || url;
  }

  /**
   * 获取版本 JSON
   * @param {{id:string,url:string}} entry 清单条目
   * @param {string} source 渠道
   */
  async getVersionJson(entry, source) {
    const channel = this._channel(source);
    const cached = readJsonSafe(this.versionFile(entry.id));
    if (cached && cached.id) return cached;

    const urls = [];
    if (channel !== 'mojang') {
      const m = this._channelUrl(entry.url, channel);
      if (m && m !== entry.url) urls.push(m);
    }
    urls.push(entry.url);

    let lastErr = null;
    for (const url of urls) {
      try {
        const data = await getJson(url, { timeout: 20000, retries: 1 });
        if (!data || !data.id) throw new Error('版本 JSON 格式异常');
        writeJsonSafe(this.versionFile(entry.id), data);
        // 游戏安装器统一从 versions/<id>/<id>.json 读取。
        writeJsonSafe(path.join(this.paths.versionsDir, entry.id, entry.id + '.json'), data);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('无法获取版本 JSON: ' + entry.id);
  }

  /** 已安装的版本（本地 versions 目录） */
  listLocalVersions() {
    const out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(this.paths.versionsDir, { withFileTypes: true });
    } catch (e) {
      return out;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const jsonFile = path.join(this.paths.versionsDir, ent.name, ent.name + '.json');
      const json = readJsonSafe(jsonFile);
      if (!json) continue;
      const jarFile = path.join(this.paths.versionsDir, ent.name, ent.name + '.jar');
      out.push({
        id: ent.name,
        type: json.type || 'release',
        mainClass: json.mainClass || '',
        inheritsFrom: json.inheritsFrom || null,
        time: json.releaseTime || json.time || null,
        hasJar: fs.existsSync(jarFile),
      });
    }
    out.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
    return out;
  }
}

module.exports = { ManifestService };
