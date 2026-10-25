'use strict';

/**
 * 版本 JSON 模型：规则判定、参数展开、类路径 / 原生库解析
 */
const os = require('os');

const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch === 'ia32' ? 'x86' : process.arch;

function compareWindowsVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function matchOs(entry) {
  if (!entry.os) return true;
  if (entry.os.name && entry.os.name !== OS_NAME) return false;
  if (entry.os.arch) {
    const a = entry.os.arch;
    if (a === 'x86') {
      if (ARCH !== 'x86') return false;
    } else if (a === 'arm64') {
      if (ARCH !== 'arm64' && ARCH !== 'aarch64') return false;
    } else if (a !== ARCH) {
      return false;
    }
  }
  if (entry.os.versionRange) {
    if (OS_NAME !== 'windows') return false;
    const rel = os.release();
    const vr = entry.os.versionRange;
    if (vr.min && compareWindowsVersion(rel, vr.min) < 0) return false;
    if (vr.max && compareWindowsVersion(rel, vr.max) > 0) return false;
  } else if (entry.os.version) {
    if (OS_NAME !== 'windows') return false;
    const rel = os.release();
    const vr = entry.os.version;
    if (typeof vr === 'string') {
      // 老格式可能是 "^1.10" 之类的正则或前缀
      const clean = String(vr).replace(/^\^/, '');
      if (!rel.startsWith(clean) && compareWindowsVersion(rel, clean) < 0) return false;
    }
  }
  return true;
}

function matchRules(rules, features) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    const osOk = matchOs(rule);
    let featOk = true;
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) {
        const actual = !!(features && features[k]);
        if (actual !== v) featOk = false;
      }
    }
    if (osOk && featOk) {
      if (rule.action === 'allow') allowed = true;
      else if (rule.action === 'disallow') allowed = false;
    }
  }
  return allowed;
}

/** 解析 Maven 坐标 group:artifact:version[:classifier][@ext] */
function parseLibrary(lib) {
  const parts = String(lib.name).split(':');
  const group = parts[0];
  const artifact = parts[1];
  const version = parts[2] || '';
  let classifier = parts[3] || '';
  let ext = 'jar';
  if (classifier.includes('@')) {
    const [c, e] = classifier.split('@');
    classifier = c;
    ext = e || 'jar';
  }
  const pathName = group.replace(/\./g, '/') + '/' + artifact + '/' + version + '/' + artifact + '-' + version + (classifier ? '-' + classifier : '') + '.' + ext;
  return { group, artifact, version, classifier, ext, path: pathName };
}

function getLibraryDownload(lib) {
  if (lib.downloads && lib.downloads.artifact) return lib.downloads.artifact;
  return null;
}

/** 判断某个库名是否是原生库（按 classifier 命名） */
function isNativeLibrary(name) {
  const s = String(name || '').toLowerCase();
  return /natives-(windows|linux|osx|macos)/.test(s);
}

/**
 * 原生库是否匹配当前平台。
 * 规则本身已由 matchRules 过滤；这里额外排除跨架构的原生包
 * （C:\...\natives-windows-arm64 之类不能被 x64 加载）。
 */
function nativeMatchesArch(name) {
  const s = String(name || '').toLowerCase();
  const hasArch = /natives-[a-z0-9]+-(arm64|x86|aarch64)/.exec(s);
  if (!hasArch) return true;
  const want = ARCH === 'x64' ? 'x86_64' : ARCH;
  const got = hasArch[1];
  if (want === 'x86_64') return got !== 'arm64' && got !== 'aarch64' && got !== 'x86';
  if (want === 'x86') return got === 'x86';
  if (want === 'arm64') return got === 'arm64' || got === 'aarch64';
  return true;
}

/**
 * 解析出需要下载与加入类路径的库
 *
 * 两代格式：
 *  - 旧版（≤1.18）：库带 `natives: {windows: "natives-windows"}` + downloads.classifiers
 *  - 新版（1.19+）：原生库是带 rules 的独立库（如 org.lwjgl:lwjgl:3.3.1:natives-windows）
 * 两代都要解压到 natives 目录，且都不进 classpath。
 *
 * @returns {{libraries: object[], natives: object[]}}
 */
function resolveLibraries(versionJson, features) {
  const libraries = [];
  const natives = [];
  const seen = new Set();

  const addTask = (entry) => {
    if (!entry.path || seen.has(entry.path)) return false;
    seen.add(entry.path);
    libraries.push(entry);
    return true;
  };

  for (const lib of versionJson.libraries || []) {
    if (!lib.name) continue;
    if (!matchRules(lib.rules, features)) continue;

    const parsed = parseLibrary(lib);
    const artifact = lib.downloads && lib.downloads.artifact;
    const libPath = (artifact && artifact.path) || parsed.path;
    const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
    const url = (artifact && artifact.url) || base + libPath;
    const sha1 = (artifact && artifact.sha1) || lib.sha1;
    const size = (artifact && artifact.size) || lib.size;

    // 新版：原生库是独立库，按名字识别
    if (isNativeLibrary(lib.name)) {
      if (!nativeMatchesArch(lib.name)) continue;
      if (addTask({ name: lib.name, path: libPath, url, sha1, size, isNative: true })) {
        natives.push({ name: lib.name, path: libPath, extract: lib.extract });
      }
      continue;
    }

    // 旧版：库自身是 Java 库，原生包在 classifiers 里
    if (artifact || lib.name) {
      addTask({ name: lib.name, path: libPath, url, sha1, size });
    }

    if (lib.natives) {
      const key = lib.natives[OS_NAME];
      if (!key) continue;
      const classifier = key.replace('${arch}', ARCH === 'x86' ? '32' : '64');
      const cls = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      if (!cls) continue;
      const cPath = cls.path || `${parsed.group.replace(/\./g, '/')}/${parsed.artifact}/${parsed.version}/${parsed.artifact}-${parsed.version}-${classifier}.jar`;
      if (addTask({ name: lib.name, path: cPath, url: cls.url, sha1: cls.sha1, size: cls.size, isNative: true })) {
        natives.push({ name: lib.name, path: cPath, extract: lib.extract });
      }
    }
  }

  return { libraries, natives };
}

/**
 * 展开参数数组（支持 string / {rules, value} 混合）
 */
function expandArgs(args, features) {
  const out = [];
  if (!args) return out;
  for (const item of args) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && item.value !== undefined) {
      if (matchRules(item.rules, features)) {
        const vals = Array.isArray(item.value) ? item.value : [item.value];
        out.push(...vals);
      }
    }
  }
  return out;
}

function substitute(arg, vars) {
  if (typeof arg !== 'string') return arg;
  return arg.replace(/\$\{([^}]+)\}/g, (m, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

module.exports = { OS_NAME, ARCH, compareWindowsVersion, matchOs, matchRules, parseLibrary, resolveLibraries, expandArgs, substitute, isNativeLibrary };