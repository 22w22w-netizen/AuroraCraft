'use strict';

/**
 * Java 管理服务
 * - 检测系统 Java（PATH、JAVA_HOME、常见安装目录、启动器自建目录）
 * - 从 TUNA Adoptium 镜像下载 JDK/JRE（失败自动回退官方 Adoptium）
 * - 从 Mojang 官方获取 Java 运行时（java-runtime manifest）
 * - 解压 zip / tar.gz 并定位 java 可执行文件
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { getJson, getText, fileExists } = require('./http');
const { downloadOne, ensureDir } = require('./downloader');
const { launcherRoot } = require('./paths');

const JAVA_DIR = path.join(launcherRoot(), 'java');
const JAVA_EXE = process.platform === 'win32' ? 'java.exe' : 'java';
/** 清华 TUNA Adoptium 归档根目录 */
const TUNA_BASE = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/';

function osKey() {
  const p = process.platform;
  return p === 'win32' ? 'windows' : p === 'darwin' ? 'mac' : 'linux';
}

function archKey() {
  const a = process.arch;
  if (a === 'x64' || a === 'amd64') return 'x64';
  if (a === 'arm64') return 'aarch64';
  if (a === 'ia32') return 'x86';
  return a;
}

/** 从 JDK/JRE 的 release 文件读取版本，无需启动子进程（受限环境亦可用）。 */
function versionFromReleaseFile(javaPath) {
  try {
    const home = path.dirname(path.dirname(javaPath));
    const text = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const m = text.match(/^JAVA_VERSION="?([^"\r\n]+)"?/m);
    if (!m) return null;
    const parts = m[1].split('.');
    const major = parts[0] === '1' ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
    return { version: m[1], major: Number.isFinite(major) ? major : null };
  } catch (_) { return null; }
}

/** 执行 java -version；子进程不可用时回退读取 release 文件。 */
function getJavaVersion(javaPath) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const child = execFile(javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
        const out = String(stderr || '') + String(stdout || '');
        const m = out.match(/version "([^"]+)"/);
        if (!m) return finish(versionFromReleaseFile(javaPath) || { version: null, major: null, raw: out.slice(0, 200) });
        const parts = m[1].split('.');
        const major = parts[0] === '1' ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
        finish({ version: m[1], major: Number.isFinite(major) ? major : null });
      });
      child.on('error', () => finish(versionFromReleaseFile(javaPath) || { version: null, major: null }));
    } catch (e) {
      finish(versionFromReleaseFile(javaPath) || { version: null, major: null });
    }
  });
}

function javaExeIn(dir) {
  if (!dir) return null;
  const p = path.join(dir, 'bin', JAVA_EXE);
  return fileExists(p) ? p : null;
}

function scanDirForJava(root, depth, out, seen) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return;
  }
  const exe = javaExeIn(root);
  if (exe && !seen.has(path.resolve(exe))) {
    seen.add(path.resolve(exe));
    out.push(exe);
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    scanDirForJava(path.join(root, ent.name), depth - 1, out, seen);
  }
}

/** 扫描启动器自己的 java 目录（下载的运行时） */
function scanLauncherJava() {
  const out = [];
  if (!fileExists(JAVA_DIR)) return out;
  scanDirForJava(JAVA_DIR, 5, out, new Set());
  return out;
}

/** 检测系统 Java 候选路径（未验证版本） */
function detectSystemJava() {
  const candidates = [];
  const seen = new Set();
  const push = (p) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    candidates.push(abs);
  };

  for (const envKey of ['JAVA_HOME', 'JDK_HOME', 'JRE_HOME']) {
    if (process.env[envKey]) push(javaExeIn(process.env[envKey]));
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) push(javaExeIn(dir));
  }

  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\BellSoft',
    'C:\\Program Files\\Semeru',
    'D:\\Program Files\\Java',
    'D:\\Program Files\\Eclipse Adoptium',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
    path.join(os.homedir(), '.gradle', 'jdks'),
    path.join(os.homedir(), '.jdks'),
    path.join(os.homedir(), '.jvm'),
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
    '/opt/java',
    '/opt/homebrew/opt',
  ].filter(Boolean);

  for (const root of roots) {
    if (!fileExists(root)) continue;
    const found = [];
    scanDirForJava(root, 3, found, new Set());
    for (const f of found) push(f);
  }

  for (const f of scanLauncherJava()) push(f);
  return candidates;
}

/** 检测并验证 Java（带版本号） */
async function detectJavaVerified() {
  const cands = detectSystemJava();
  const list = await Promise.all(cands.map(async (p) => ({ path: p, ...(await getJavaVersion(p)) })));
  const results = [];
  for (const item of list) {
    if (item.version) results.push({ ...item, managed: item.path.toLowerCase().startsWith(JAVA_DIR.toLowerCase()) });
  }
  results.sort((a, b) => (b.major || 0) - (a.major || 0));
  return results;
}

/**
 * 列出 Adoptium 可选版本。
 * 优先使用 TUNA 镜像归档目录（国内直连、可达性最好），
 * 失败再回退 API（TUNA → USTC → 官方）。
 * 统一返回 { items, endpoint }，items: {name, semver, major, imageType, size, link}
 */
async function listAdoptium(major, imageType = 'jdk') {
  // 1) TUNA 归档目录（下载源同样在 TUNA，最稳）
  try {
    const archives = await listTunaArchives(major, imageType);
    if (archives.length) {
      const items = archives.map((a) => ({
        id: a.name,
        name: a.name,
        semver: '',
        major: a.major,
        imageType: a.imageType,
        size: a.size,
        link: a.url,
        checksum: '',
        releaseTime: '',
      }));
      return { items, data: items, endpoint: 'TUNA 镜像' };
    }
  } catch (e) { /* 继续尝试 API */ }

  // 2) Adoptium API（TUNA → USTC → 官方）
  const q = `architecture=${archKey()}&heap_size=normal&image_type=${imageType}&os=${osKey()}&vendor=eclipse&jvm_impl=hotspot`;
  const apis = [
    { url: `https://mirrors.tuna.tsinghua.edu.cn/adoptium/api/v3/assets/feature_releases/${major}/ga?${q}`, label: 'TUNA API' },
    { url: `https://mirrors.ustc.edu.cn/adoptium/api/v3/assets/feature_releases/${major}/ga?${q}`, label: 'USTC API' },
    { url: `https://api.adoptium.net/v3/assets/feature_releases/${major}/ga?${q}`, label: 'Adoptium 官方' },
  ];

  let lastErr = null;
  for (const api of apis) {
    try {
      const data = await getJson(api.url, { timeout: 20000, retries: 0 });
      if (!Array.isArray(data) || !data.length) continue;
      const items = data.map(normalizeAdoptium).filter((x) => x.link);
      if (items.length) return { items, data: items, endpoint: api.label };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('无法获取 Adoptium 版本列表');
}

/**
 * 直接从 TUNA 目录页解析 Adoptium 归档（不依赖 API，国内命中率高）
 * 目录形如 /Adoptium/{major}/{jdk|jre}/{arch}/{os}/
 */
async function listTunaArchives(major, imageType = 'jdk') {
  const arch = archKey();
  const osSeg = osKey() === 'mac' ? 'mac' : osKey();
  const dirUrl = TUNA_BASE + major + '/' + imageType + '/' + arch + '/' + osSeg + '/';
  const html = await getText(dirUrl, { timeout: 20000, retries: 1 });
  const names = new Set();
  const re = /href="([^"]+\.(?:zip|tar\.gz))"/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    const name = raw.split('/').pop();
    if (name) names.add(name);
  }
  const out = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    // 形如 OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip
    // 只保留目标类型（jdk / jre），排除 debug / symbols / testimage 等附件
    if (!lower.includes('-' + imageType + '_')) continue;
    if (lower.includes('debugimage') || lower.includes('symbols') || lower.includes('testimage')) continue;
    if (!/openjdk(\d+)u?-/.test(lower) && !lower.includes('_' + String(major) + '.')) continue;
    out.push({
      name,
      major,
      imageType,
      source: 'tuna',
      url: dirUrl + name,
      size: 0,
      checksum: null,
      label: '清华镜像 · ' + name,
    });
  }
  out.sort((a, b) => versionKey(b.name) - versionKey(a.name));
  return out;
}

/** 从文件名中提取可比较的版本数值（如 OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip） */
function versionKey(name) {
  const m = String(name).match(/_(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?([_.]([\d.]+))?\.(?:zip|tar\.gz)$/i);
  if (!m) return 0;
  return (
    (parseInt(m[1], 10) || 0) * 1e9 +
    (parseInt(m[2], 10) || 0) * 1e6 +
    (parseInt(m[3], 10) || 0) * 1e3 +
    (parseInt(m[4], 10) || 0)
  );
}

/**
 * 归一化 Adoptium 资产条目。
 * Adoptium v3 返回两种结构：
 *   - 旧：{ binary: { package: {...} } }
 *   - 新：{ binaries: [ { package: {...} } ], version_data: {...} }
 */
function normalizeAdoptium(asset) {
  const binaries = asset.binaries || (asset.binary ? [asset.binary] : []);
  const bin = binaries[0] || {};
  const pkg = bin.package || {};
  const vd = asset.version_data || asset.version || {};
  return {
    id: asset.id != null ? asset.id : asset.release_name,
    name: asset.release_name || '',
    semver: vd.semver || '',
    major: vd.major != null ? vd.major : null,
    imageType: bin.image_type || '',
    size: pkg.size || 0,
    link: pkg.link || '',
    checksum: pkg.checksum || '',
    releaseTime: asset.timestamp || '',
  };
}

/** 下载 Adoptium 分发包（zip / tar.gz） */
async function downloadAdoptium(item, onBytes) {
  if (!item.link) throw new Error('该 Adoptium 条目没有下载链接');
  const id = String(item.id != null ? item.id : item.name || Date.now());
  const destDir = path.join(JAVA_DIR, 'adoptium-' + id);
  ensureDir(destDir);
  let ext = '.zip';
  try { ext = path.extname(new URL(item.link).pathname) || ext; } catch (e) { /* ignore */ }
  const dest = path.join(destDir, 'archive' + ext);
  // Adoptium 的 checksum 是 SHA-256；downloader 只做 SHA-1 校验，故此处不传
  await downloadOne(
    { url: item.link, urls: [item.link], dest, size: item.size, name: item.name || id },
    { resume: true, retries: 3, timeout: 600000, onBytes }
  );
  return { destDir, archive: dest, name: item.name, major: item.major };
}

/** Mojang 官方 Java 运行时清单 */
const MOJANG_RUNTIME_MANIFEST = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

async function listMojangRuntimes() {
  const data = await getJson(MOJANG_RUNTIME_MANIFEST, { timeout: 20000, retries: 1 });
  const platformKey = `${osKey()}-${archKey()}`;
  const plat = data[platformKey] || data[`${osKey()}-x64`] || {};
  const out = [];
  for (const [component, versions] of Object.entries(plat)) {
    for (const v of versions || []) {
      out.push({
        component,
        name: (v.version && v.version.name) || '',
        released: (v.version && v.version.released) || '',
        url: v.manifest && v.manifest.url,
        manifestSha1: v.manifest && v.manifest.sha1,
        size: v.manifest && v.manifest.size,
      });
    }
  }
  return out;
}

/** 依据 Mojang 运行时 manifest 下载全部文件 */
async function downloadMojangRuntime(entry, onProgress) {
  const manifest = await getJson(entry.url, { timeout: 20000, retries: 1 });
  const destDir = path.join(JAVA_DIR, 'mojang-' + entry.component + '-' + String(entry.name).replace(/[^\w.-]/g, '_'));
  ensureDir(destDir);
  const tasks = [];
  for (const [rel, file] of Object.entries(manifest.files || {})) {
    if (file.type === 'directory') continue;
    if (!file.downloads || !file.downloads.raw) continue;
    if (file.downloads.raw.url === 'https://error.invalid/mojang') continue;
    tasks.push({
      url: file.downloads.raw.url,
      dest: path.join(destDir, rel),
      sha1: file.downloads.raw.sha1,
      size: file.downloads.raw.size,
      name: rel,
      executable: !!file.executable,
    });
  }
  const { downloadMany } = require('./downloader');
  const result = await downloadMany(tasks, { threads: 8, onProgress });
  if (osKey() !== 'windows') {
    for (const t of tasks) {
      if (t.executable) {
        try { fs.chmodSync(t.dest, 0o755); } catch (e) { /* ignore */ }
      }
    }
  }
  return { destDir, result, manifest };
}

/** 在目录中找到 java 可执行文件路径 */
function findJavaIn(dir, depth = 4) {
  if (!fileExists(dir) || depth < 0) return null;
  const direct = osKey() === 'mac'
    ? path.join(dir, 'Contents', 'Home', 'bin', JAVA_EXE)
    : path.join(dir, 'bin', JAVA_EXE);
  if (fileExists(direct)) return direct;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const found = findJavaIn(path.join(dir, ent.name), depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * 解压归档。
 * zip 使用内置纯 JS 实现（不依赖子进程，兼容受限环境）；
 * tar.gz 回退到系统 tar。
 */
async function extractArchive(archive, destDir) {
  ensureDir(destDir);
  const lower = archive.toLowerCase();
  if (lower.endsWith('.zip')) {
    const { extractZipToDir } = require('./unzip');
    return extractZipToDir(archive, destDir);
  }
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', destDir], { windowsHide: true, timeout: 900000 }, (err) => {
      if (err) reject(new Error('解压失败: ' + err.message));
      else resolve(true);
    });
  });
}

module.exports = {
  JAVA_DIR,
  TUNA_BASE,
  osKey,
  archKey,
  detectSystemJava,
  detectJavaVerified,
  getJavaVersion,
  listAdoptium,
  listTunaArchives,
  downloadAdoptium,
  listMojangRuntimes,
  downloadMojangRuntime,
  extractArchive,
  findJavaIn,
};
