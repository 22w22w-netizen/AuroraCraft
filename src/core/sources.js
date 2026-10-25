'use strict';

/**
 * 下载源 / 镜像管理
 *
 * 三档渠道：
 *  - mojang   官方（piston-meta / libraries.minecraft.net / resources.download.minecraft.net）
 *  - bmcl     BMCLAPI 镜像（bmclapi2.bangbang93.com），国内推荐
 *  - bangbang BangBang 加速（bmclapi2 通道）
 *  - auto     自动测速择优
 */

const BMCL = 'https://bmclapi2.bangbang93.com/';

const BMCL_PROFILE = {
  versionManifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  fabric: { meta: 'https://bmclapi2.bangbang93.com/fabric-meta', maven: 'https://bmclapi2.bangbang93.com/maven/' },
  quilt: { meta: 'https://meta.quiltmc.org', maven: 'https://maven.quiltmc.org/repository/release/' },
  forge: { metadata: 'https://bmclapi2.bangbang93.com/forge/maven-metadata.xml' },
  neoforge: { metadata: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml' },
  libraryBase: 'https://bmclapi2.bangbang93.com/maven/',
  assetsBase: 'https://bmclapi2.bangbang93.com/assets/',
};

const SOURCES = {
  mojang: {
    id: 'mojang',
    name: 'Mojang 官方',
    desc: '官方源，全球通用；国内访问可能较慢',
    color: '#22c55e',
    versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    fabric: { meta: 'https://meta.fabricmc.net', maven: 'https://maven.fabricmc.net/' },
    quilt: { meta: 'https://meta.quiltmc.org', maven: 'https://maven.quiltmc.org/repository/release/' },
    forge: { metadata: 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml' },
    neoforge: { metadata: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml' },
    libraryBase: 'https://libraries.minecraft.net/',
    assetsBase: 'https://resources.download.minecraft.net/',
  },
  bmcl: {
    id: 'bmcl',
    name: 'BMCLAPI 镜像',
    desc: '社区镜像，支持版本清单 / 库 / 资源 / Fabric 元数据',
    color: '#3b82f6',
    ...BMCL_PROFILE,
  },
  bangbang: {
    id: 'bangbang',
    name: 'BangBang 加速',
    desc: 'BMCLAPI 加速通道，适合国内网络',
    color: '#f59e0b',
    ...BMCL_PROFILE,
  },
  auto: {
    id: 'auto',
    name: '自动测速',
    desc: '启动时测速并选择最快的可用渠道',
    color: '#a855f7',
    ...BMCL_PROFILE,
  },
};

/** 官方 URL 前缀 -> BMCLAPI 相对前缀 */
const MIRROR_MAP = [
  ['https://piston-data.mojang.com/v1/objects/', 'objects/'],
  ['https://launcher.mojang.com/v1/objects/', 'objects/'],
  ['https://piston-meta.mojang.com/', ''],
  ['https://launchermeta.mojang.com/', ''],
  ['https://resources.download.minecraft.net/', 'assets/'],
  ['https://libraries.minecraft.net/', 'maven/'],
  ['https://files.minecraftforge.net/maven/', 'maven/'],
  ['https://maven.minecraftforge.net/', 'maven/'],
  ['https://maven.fabricmc.net/', 'maven/'],
  ['https://meta.fabricmc.net/', 'fabric-meta/'],
];

/**
 * 计算某个官方 URL 在镜像站上的等价地址
 * @param {string} url 官方 URL
 * @param {string} [mirrorBase] 镜像根（默认 BMCLAPI）
 * @returns {string|null} 镜像 URL；无法映射返回 null
 */
function toMirrorUrl(url, mirrorBase) {
  if (!url || typeof url !== 'string') return null;
  for (const [from, rel] of MIRROR_MAP) {
    if (url.startsWith(from)) {
      return (mirrorBase || BMCL) + rel + url.slice(from.length);
    }
  }
  return null;
}

/** 获取渠道配置；未知渠道回退 mojang */
function getSource(id) {
  return SOURCES[id] || SOURCES.mojang;
}

/** 可测速的渠道列表 */
const TESTABLE = ['mojang', 'bmcl', 'bangbang'];

/** 同一份清单测速，返回可用于界面择优的耗时。 */
async function speedTest(timeout = 6000) {
  return Promise.all(TESTABLE.map(async (id) => {
    const url = SOURCES[id].versionManifest;
    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'AuroraCraft/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!Array.isArray(json.versions)) throw new Error('清单格式错误');
      return { id, name: SOURCES[id].name, url, ok: true, ms: Date.now() - started };
    } catch (e) {
      return { id, name: SOURCES[id].name, url, ok: false, ms: null, error: e.message };
    } finally { clearTimeout(timer); }
  }));
}
module.exports = { SOURCES, TESTABLE, MIRROR_MAP, BMCL, toMirrorUrl, getSource, speedTest };
