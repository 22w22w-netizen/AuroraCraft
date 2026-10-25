'use strict';

/**
 * Mod 加载器服务
 * - Fabric / Quilt：取 profile JSON（含 mainClass 与 libraries），下载库后落盘为本地版本
 * - Forge / NeoForge：下载官方安装器，交由 Java 执行 --installClient 生成版本
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { getJson, getText, writeJsonSafe, fileExists } = require('./http');
const { downloadOne, ensureDir, downloadMany } = require('./downloader');
const { SOURCES, BMCL, toMirrorUrl } = require('./sources');

/** 依次尝试候选 URL，返回首个成功响应的 JSON */
async function tryJson(urls, timeout = 20000) {
  let lastErr = null;
  for (const url of urls) {
    if (!url) continue;
    try {
      return await getJson(url, { timeout, retries: 1 });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('所有地址均不可用');
}

class ModLoaderService {
  constructor(paths) {
    this.paths = paths;
  }

  /* ================= 版本列表 ================= */

  /**
   * 列出某加载器在某 MC 版本下的可选版本
   * @param {'fabric'|'forge'|'neoforge'|'quilt'} type
   * @param {string} mcVersion
   * @returns {Promise<Array<{version:string, stable?:boolean}>>}
   */
  async list(type, mcVersion) {
    if (type === 'fabric') {
      const data = await tryJson([
        `${BMCL}fabric-meta/v2/versions/loader/${mcVersion}`,
        `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`,
      ]);
      if (!Array.isArray(data)) return [];
      return data
        .map((d) => ({ version: d.loader && d.loader.version, stable: d.loader && d.loader.stable }))
        .filter((x) => x.version);
    }

    if (type === 'quilt') {
      try {
        const data = await tryJson([`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`]);
        if (!Array.isArray(data)) return [];
        return data
          .map((d) => ({ version: d.loader && d.loader.version, stable: d.loader && d.loader.stable }))
          .filter((x) => x.version);
      } catch (e) {
        return [];
      }
    }

    if (type === 'forge') {
      try {
        const list = await getJson(`${BMCL}forge/minecraft/${mcVersion}`, { timeout: 20000, retries: 1 });
        if (Array.isArray(list) && list.length) {
          return list.map((x) => ({ version: x.version, build: x.build, mcversion: x.mcversion, branch: x.branch }));
        }
      } catch (e) { /* 回退 maven-metadata */ }
      return (await this._mavenVersions('forge', mcVersion)).map((v) => ({ version: v }));
    }

    if (type === 'neoforge') {
      try {
        const list = await getJson(`${BMCL}neoforge/list/${mcVersion}`, { timeout: 20000, retries: 1 });
        if (Array.isArray(list) && list.length) {
          return list.map((x) => ({ version: x.version, rawVersion: x.rawVersion, installerPath: x.installerPath }));
        }
      } catch (e) { /* 回退 maven-metadata */ }
      return (await this._mavenVersions('neoforge', mcVersion)).map((v) => ({ version: v }));
    }

    throw new Error('未知加载器: ' + type);
  }

  /** 从 maven-metadata.xml 解析并过滤版本 */
  async _mavenVersions(type, mcVersion) {
    const url = type === 'forge' ? SOURCES.mojang.forge.metadata : SOURCES.mojang.neoforge.metadata;
    const text = await getText(url, { timeout: 25000, retries: 1 });
    const all = [...text.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    if (type === 'forge') {
      const prefix = mcVersion + '-';
      return all
        .filter((v) => v.startsWith(prefix))
        .map((v) => v.slice(prefix.length))
        .reverse();
    }
    return all.filter((v) => this._neoMatches(v, mcVersion)).reverse();
  }

  /** NeoForge 版本号与 MC 版本匹配（21.1.x <-> 1.21.1） */
  _neoMatches(version, mc) {
    const v = version.split('.').map(Number);
    const p = mc.split('.').map(Number);
    if (!Number.isFinite(v[0]) || p[0] !== 1 || p.length < 2) return false;
    if (v[0] !== p[1]) return false;
    const patch = p[2] || 0;
    return patch === 0 ? true : v[1] === patch;
  }

  /* ================= 安装 ================= */

  /**
   * 安装加载器
   * @returns {Promise<{versionId:string, installerPath?:string, needsInstaller?:boolean}>}
   */
  async install(type, mcVersion, loaderVersion, javaPath, onLog = () => {}, onBytes) {
    if (type === 'fabric' || type === 'quilt') {
      return this._installProfile(type, mcVersion, loaderVersion, onLog, onBytes);
    }

    if (type === 'forge') {
      let branch = '';
      try {
        const list = await getJson(`${BMCL}forge/minecraft/${mcVersion}`, { timeout: 20000, retries: 1 });
        const hit = Array.isArray(list) && list.find((x) => x.version === loaderVersion || `${mcVersion}-${x.version}` === loaderVersion);
        if (hit && hit.branch) branch = String(hit.branch);
      } catch (_) { /* 老版本没有 branch 元数据 */ }
      const baseVersion = loaderVersion.startsWith(mcVersion + '-') ? loaderVersion : `${mcVersion}-${loaderVersion}`;
      const full = branch && !baseVersion.endsWith('-' + branch) ? `${baseVersion}-${branch}` : baseVersion;
      const id = `forge-${full}`;
      const rel = `net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
      const urls = [`${BMCL}maven/${rel}`, `https://maven.minecraftforge.net/${rel}`];
      const installer = path.join(this.paths.cacheDir, `${id}-installer.jar`);
      onLog(`下载 Forge 安装器 ${full}`);
      await downloadOne({ url: urls[0], urls, dest: installer, name: id }, { timeout: 240000, retries: 3, onBytes });
      if (!javaPath) throw new Error('Forge 安装需要 Java，请先在 Java 页检测或下载');
      onLog('运行 Forge 官方安装器（可能需要数分钟）');
      await this._runInstaller(javaPath, installer, onLog);
      const found = this._findInstalled('forge', full);
      if (!found) throw new Error('安装器已结束，但未找到生成的版本 JSON');
      return { versionId: found, installerPath: installer, needsInstaller: true };
    }

    if (type === 'neoforge') {
      let rel = null;
      let item = null;
      try {
        const list = await getJson(`${BMCL}neoforge/list/${mcVersion}`, { timeout: 20000, retries: 1 });
        item = Array.isArray(list) && list.find((x) => x.version === loaderVersion || x.rawVersion === loaderVersion);
      } catch (_) { /* 回退坐标推导 */ }
      if (item && item.installerPath) rel = String(item.installerPath).replace(/^\//, '').replace(/^maven\//, '');
      const rawVersion = (item && item.rawVersion) || loaderVersion;
      if (!rel) {
        rel = rawVersion.startsWith('1.')
          ? `net/neoforged/forge/${rawVersion}/forge-${rawVersion}-installer.jar`
          : `net/neoforged/neoforge/${rawVersion}/neoforge-${rawVersion}-installer.jar`;
      }
      const id = `neoforge-${loaderVersion}`;
      const urls = [`https://maven.neoforged.net/releases/${rel}`, `${BMCL}maven/${rel}`];
      const installer = path.join(this.paths.cacheDir, `${id}-installer.jar`);
      onLog(`下载 NeoForge 安装器 ${loaderVersion}`);
      await downloadOne({ url: urls[0], urls, dest: installer, name: id }, { timeout: 240000, retries: 3, onBytes });
      if (!javaPath) throw new Error('NeoForge 安装需要 Java，请先在 Java 页检测或下载');
      onLog('运行 NeoForge 官方安装器（可能需要数分钟）');
      await this._runInstaller(javaPath, installer, onLog);
      const found = this._findInstalled('neoforge', loaderVersion);
      if (!found) throw new Error('安装器已结束，但未找到生成的版本 JSON');
      return { versionId: found, installerPath: installer, needsInstaller: true };
    }

    throw new Error('未知加载器: ' + type);
  }

  /** Fabric / Quilt：拉取 profile，下载库，落盘 */
  async _installProfile(type, mcVersion, loaderVersion, onLog, onBytes) {
    const bases = type === 'fabric'
      ? [`${BMCL}fabric-meta`, 'https://meta.fabricmc.net']
      : ['https://meta.quiltmc.org'];
    const p = `/${type === 'quilt' ? 'v3' : 'v2'}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
    onLog(`获取 ${type} ${loaderVersion} 的 profile 配置…`);
    const profile = await tryJson(bases.map((b) => b + p), 25000);
    if (!profile || !profile.mainClass) throw new Error(`${type} profile 格式异常（缺少 mainClass）`);

    const versionId = `${type}-loader-${loaderVersion}-${mcVersion}`;
    profile.id = versionId;
    profile.inheritsFrom = profile.inheritsFrom || mcVersion;
    profile.jar = profile.jar || mcVersion;

    // 下载 profile 中声明的库
    const libs = profile.libraries || [];
    if (libs.length) {
      onLog(`下载 ${libs.length} 个 ${type} 库文件…`);
      const tasks = [];
      for (const lib of libs) {
        const rel = this._libRelPath(lib.name);
        if (!rel) continue;
        const base = String(lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
        const official = base + rel;
        const mirror = toMirrorUrl(official);
        tasks.push({
          url: mirror || official,
          urls: mirror ? [mirror, official] : [official],
          dest: path.join(this.paths.librariesDir, rel),
          sha1: lib.sha1,
          size: lib.size,
          name: rel,
        });
      }
      if (tasks.length) {
        const r = await downloadMany(tasks, { threads: 8, onProgress: onBytes });
        if (r.failed) throw new Error(`${r.failed} 个加载器库下载失败：${r.errors.slice(0, 3).map(e => e.name).join('、')}`);
      }
    }

    writeJsonSafe(path.join(this.paths.versionsDir, versionId, `${versionId}.json`), profile);
    onLog(`已安装 ${versionId}`, 'success');
    return { versionId, needsInstaller: false };
  }

  /** Maven 坐标 -> 相对路径 */
  _libRelPath(name) {
    if (!name) return null;
    const parts = String(name).split(':');
    if (parts.length < 3) return null;
    const [group, artifact] = parts;
    let version = parts[2];
    let classifier = parts[3] || '';
    let ext = 'jar';
    if (version.includes('@')) {
      const sp = version.split('@');
      version = sp[0];
      ext = sp[1] || 'jar';
    }
    if (classifier.includes('@')) {
      const sp = classifier.split('@');
      classifier = sp[0];
      ext = sp[1] || 'jar';
    }
    const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
    return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
  }

  /**
   * Forge / NeoForge 官方安装器要求游戏目录中存在启动器档案文件，
   * 否则会直接中止：There is no minecraft launcher profile in "...", you need to run the launcher first!
   * 这里在运行安装器前补齐这两份档案文件（已存在则不覆盖）。
   */
  _ensureLauncherProfiles(onLog = () => {}) {
    const gameDir = this.paths.gameDir;
    ensureDir(gameDir);
    ensureDir(this.paths.versionsDir);
    ensureDir(path.join(gameDir, 'mods'));

    const clientToken = crypto.randomBytes(16).toString('hex');
    const base = {
      profiles: {},
      settings: {
        enableSnapshots: false,
        enableAdvanced: false,
        keepLauncherOpen: false,
        showGameLog: false,
        showMenu: false,
        soundOn: false,
      },
      version: 3,
    };

    const targets = [
      { file: 'launcher_profiles.json', data: { ...base, clientToken, selectedProfile: undefined } },
      // 新版官方启动器（Microsoft Store 版）档案，部分新版 Forge/NeoForge 安装器会检查
      { file: 'launcher_profiles_microsoft_store.json', data: { ...base } },
    ];

    for (const { file, data } of targets) {
      const full = path.join(gameDir, file);
      if (fileExists(full)) {
        // 存在但可能是空/损坏，简单校验可解析
        try {
          const cur = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
          if (cur && typeof cur === 'object' && cur.profiles) continue;
        } catch (e) { /* 损坏则重写 */ }
      }
      const payload = { ...data };
      if (payload.selectedProfile === undefined) delete payload.selectedProfile;
      fs.writeFileSync(full, JSON.stringify(payload, null, 2), 'utf8');
      onLog(`已创建启动器档案 ${file}`);
    }
  }

  /** 执行官方安装器 */
  _runInstaller(javaPath, installer, onLog) {
    // 关键前置：补齐 launcher_profiles.json，否则安装器会报
    // "There is no minecraft launcher profile in ... , you need to run the launcher first!"
    try {
      this._ensureLauncherProfiles(onLog);
    } catch (e) {
      onLog('创建启动器档案失败：' + e.message);
    }

    return new Promise((resolve, reject) => {
      const child = execFile(
        javaPath,
        ['-jar', installer, '--installClient', this.paths.gameDir],
        { timeout: 900000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const raw = String(stderr || stdout || err.message);
            // 将安装器的常见英文报错翻译为可操作的中文提示
            let msg = raw.slice(-1500);
            if (/no minecraft launcher profile/i.test(raw)) {
              msg = '原版安装器未识别到启动器档案（launcher_profiles.json）。请确认游戏目录可写，且先安装对应原版版本后重试。';
            } else if (/no .* version .* found|Unable to find|does not exist/i.test(raw) && /1\.\d+/.test(raw)) {
              msg = '缺少对应的原版版本，请先在「版本库」安装 ' + '该版本' + ' 后再装加载器。详情：\n' + raw.slice(-800);
            }
            reject(new Error(`安装器失败：${msg}`));
          } else {
            resolve();
          }
        }
      );
      child.stdout.on('data', (d) => onLog(String(d).trim()));
      child.stderr.on('data', (d) => onLog(String(d).trim()));
    });
  }

  /** 归一化版本标识：小写、非字母数字转连字符、压缩重复连字符 */
  _norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * 在 versions 目录中查找安装器生成的版本。
   * Forge 生成的目录形如 `1.20.1-forge-47.4.28`，而传入的 full 可能是 `1.20.1-47.4.28`，
   * 因此不能直接做子串匹配，改为「token 全部命中」的宽松匹配。
   */
  _findInstalled(type, full) {
    const tokens = this._norm(full).split('-').filter(Boolean);
    // 优先匹配同时含类型名与全部 token 的目录，避免误选原版目录
    const candidates = [];
    try {
      for (const id of fs.readdirSync(this.paths.versionsDir)) {
        const jsonPath = path.join(this.paths.versionsDir, id, `${id}.json`);
        if (!fileExists(jsonPath)) continue;
        const nid = this._norm(id);
        if (!nid.includes(String(type).toLowerCase())) continue;
        if (!tokens.every((t) => nid.includes(t))) continue;
        candidates.push({ id, score: nid.length });
      }
    } catch (e) {
      return null;
    }
    if (!candidates.length) return null;
    // 取最短（最贴合）的一个
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].id;
  }
}

module.exports = { ModLoaderService };
