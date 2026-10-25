'use strict';

/**
 * 资源中心：模组 / 光影 / 资源包 / 整合包 / 中文汉化包
 *
 * 数据源：Modrinth 公共 API（无需 Key，实测可用）
 * 说明：MCBBS 已于 2024 年关停，域名无法解析，不能作为下载源；
 *      MC百科（mcmod.cn）无可用的公开 JSON API，仅提供「在 MC百科 搜索」的外链跳转。
 */
const path = require('path');
const fs = require('fs');
const { getJson, request, fileExists } = require('./http');
const { downloadOne, ensureDir } = require('./downloader');
const { extractZipToDir } = require('./unzip');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'AuroraCraft-Launcher/1.0.0 (minecraft launcher)' };

/** 资源类型定义：Modrinth project_type -> 中文名 + 安装目录 */
const KINDS = {
  mod: { id: 'mod', label: '模组', dir: 'mods', ext: '.jar' },
  shader: { id: 'shader', label: '光影', dir: 'shaderpacks', ext: '.zip' },
  resourcepack: { id: 'resourcepack', label: '资源包', dir: 'resourcepacks', ext: '.zip' },
  modpack: { id: 'modpack', label: '整合包', dir: '', ext: '.mrpack' },
  datapack: { id: 'datapack', label: '数据包', dir: 'datapacks', ext: '.zip' },
};

/** 加载器候选（用于按版本过滤） */
const LOADERS = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge', 'forge'],
  vanilla: [],
};

function enc(v) {
  // 仅供需要自行拼接 URL 的场景；URLSearchParams 会再编码一次，故那里直接传 JSON 字符串。
  return encodeURIComponent(JSON.stringify(v));
}

/**
 * 搜索资源
 * @param {object} o {kind, query, gameVersion, loader, limit, offset, sortBy}
 */
async function search(o = {}) {
  const kind = KINDS[o.kind] ? o.kind : 'mod';
  const facets = [[`project_type:${kind}`]];
  if (o.gameVersion) facets.push([`versions:${o.gameVersion}`]);
  const tags = o.loader && LOADERS[o.loader];
  if (tags && tags.length) {
    // 加载器为多选 OR 关系：把同一组放在一个数组内
    facets.push(tags.map((t) => `categories:${t}`));
  }
  if (o.category) facets.push([`categories:${o.category}`]);

  const params = new URLSearchParams({
    limit: String(Math.min(50, o.limit || 20)),
    offset: String(o.offset || 0),
    index: o.sortBy || 'relevance',
    facets: JSON.stringify(facets),
  });
  if (o.query) params.set('query', o.query);

  const data = await getJson(`${API}/search?${params.toString()}`, { headers: UA, timeout: 25000, retries: 2 });
  return {
    total: data.total_hits || 0,
    items: (data.hits || []).map((h) => ({
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      downloads: h.downloads,
      follows: h.follows,
      icon: h.icon_url,
      categories: h.categories || [],
      versions: h.versions || [],
      kind,
    })),
  };
}

/**
 * 查询某项目在指定版本/加载器下可用的文件
 */
async function getVersions(slug, o = {}) {
  const params = new URLSearchParams();
  if (o.gameVersion) params.set('game_versions', JSON.stringify([o.gameVersion]));
  const tags = o.loader && LOADERS[o.loader];
  if (tags && tags.length) params.set('loaders', JSON.stringify(tags));
  const url = `${API}/project/${encodeURIComponent(slug)}/version${params.toString() ? '?' + params.toString() : ''}`;
  const list = await getJson(url, { headers: UA, timeout: 25000, retries: 2 });
  return (Array.isArray(list) ? list : []).map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    channel: v.version_type,
    loaders: v.loaders || [],
    gameVersions: v.game_versions || [],
    date: v.date_published,
    downloads: v.downloads,
    files: (v.files || []).map((f) => ({
      url: f.url,
      filename: f.filename,
      size: f.size,
      primary: !!f.primary,
      sha1: f.hashes && f.hashes.sha1,
    })),
    dependencies: v.dependencies || [],
  }));
}

/** 选取最合适的一个文件 */
function pickFile(files) {
  if (!files || !files.length) return null;
  const primary = files.find((f) => f.primary);
  return primary || files[0];
}

/**
 * 安装单个资源（模组 / 光影 / 资源包 / 数据包）
 * @returns {{ok, file, target, bytes}}
 */
async function install(kind, slug, opts = {}) {
  const meta = KINDS[kind];
  if (!meta) throw new Error('未知资源类型: ' + kind);

  const versions = await getVersions(slug, { gameVersion: opts.gameVersion, loader: opts.loader });
  if (!versions.length) {
    const tip = opts.gameVersion
      ? `该资源没有适配 ${opts.gameVersion}${opts.loader ? ' / ' + opts.loader : ''} 的版本`
      : '该资源暂无可用版本';
    throw new Error(tip);
  }
  const ver = opts.versionId ? versions.find((v) => v.id === opts.versionId) || versions[0] : versions[0];
  const file = pickFile(ver.files);
  if (!file) throw new Error('该版本没有可下载文件');

  const dir = path.join(opts.gameDir, meta.dir);
  ensureDir(dir);
  let filename = file.filename;
  // 光影/资源包必须是 zip
  if ((kind === 'shader' || kind === 'resourcepack') && !/\.zip$/i.test(filename)) {
    filename = path.basename(filename).replace(/\.[^.]+$/, '') + '.zip';
  }
  const target = path.join(dir, filename);

  await downloadOne(
    { url: file.url, dest: target, sha1: file.sha1, size: file.size, name: filename },
    { resume: true, retries: 3, timeout: 300000, onBytes: opts.onBytes }
  );

  return {
    ok: true,
    kind,
    label: meta.label,
    slug,
    version: ver.versionNumber,
    loaders: ver.loaders,
    gameVersions: ver.gameVersions,
    file: filename,
    target,
    bytes: file.size || 0,
    dependencies: ver.dependencies || [],
    resourcePackDir: meta.dir,
  };
}

/**
 * 安装整合包（.mrpack）
 * 步骤：下载 mrpack → 解析 modrinth.index.json → 下载全部 files → 解压 overrides
 * @returns {{ok, files, dir}}
 */
async function installModpack(slug, opts = {}) {
  const versions = await getVersions(slug, { gameVersion: opts.gameVersion });
  if (!versions.length) throw new Error('该整合包没有适配当前游戏版本的版本');
  const ver = opts.versionId ? versions.find((v) => v.id === opts.versionId) || versions[0] : versions[0];
  const file = pickFile(ver.files);
  if (!file) throw new Error('整合包缺少可下载文件');

  ensureDir(opts.cacheDir);
  const packPath = path.join(opts.cacheDir, `${slug}-${file.filename}`);
  await downloadOne(
    { url: file.url, dest: packPath, sha1: file.sha1, size: file.size, name: file.filename },
    { resume: true, retries: 3, timeout: 600000, onBytes: opts.onBytes }
  );

  // 读取 index（不解压全量，先取 manifest）
  const destDir = opts.instanceDir || path.join(opts.gameDir, 'instances', `${slug}-${ver.versionNumber}`);
  ensureDir(destDir);

  const tmp = path.join(opts.cacheDir, `${slug}-extract`);
  await extractZipToDir(packPath, tmp);

  const indexPath = path.join(tmp, 'modrinth.index.json');
  let index = null;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error('整合包缺少 modrinth.index.json，无法安装');
  }

  const files = Array.isArray(index.files) ? index.files : [];
  const tasks = [];
  for (const f of files) {
    if (f.env && f.env.client === 'unsupported') continue;
    const dl = (f.downloads || [])[0];
    if (!dl) continue;
    tasks.push({
      url: dl,
      dest: path.join(destDir, f.path),
      sha1: f.hashes && f.hashes.sha1,
      size: f.fileSize || 0,
      name: f.path,
    });
  }

  const { downloadMany } = require('./downloader');
  const res = await downloadMany(tasks, { threads: opts.threads || 16, onProgress: opts.onProgress });

  // 解压 overrides（若有）
  const overridesDir = path.join(tmp, 'overrides');
  let overridesCopied = 0;
  if (fileExists(overridesDir)) {
    overridesCopied = copyDir(overridesDir, destDir);
  }

  return {
    ok: res.failed === 0,
    slug,
    name: index.name || slug,
    versionId: ver.versionNumber,
    instanceDir: destDir,
    files: { total: tasks.length, done: res.done, failed: res.failed },
    overridesCopied,
    mcVersion: (index.dependencies && index.dependencies.minecraft) || opts.gameVersion || '',
    loader: index.dependencies || {},
    errors: (res.errors || []).slice(0, 5),
  };
}

function copyDir(src, dest) {
  let n = 0;
  const walk = (s, d) => {
    let ents = [];
    try { ents = fs.readdirSync(s, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const from = path.join(s, e.name);
      const to = path.join(d, e.name);
      if (e.isDirectory()) {
        ensureDir(to);
        walk(from, to);
      } else {
        try {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
          n += 1;
        } catch (err) { /* ignore */ }
      }
    }
  };
  walk(src, dest);
  return n;
}

/** MC百科 搜索外链（中文译名/资料查询） */
function mcmodSearchUrl(name) {
  return 'https://search.mcmod.cn/s?key=' + encodeURIComponent(String(name || ''));
}

module.exports = {
  KINDS,
  LOADERS,
  search,
  getVersions,
  install,
  installModpack,
  mcmodSearchUrl,
};