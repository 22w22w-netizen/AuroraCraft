'use strict';

/**
 * 无头安装：下载一个完整的 Minecraft 版本（客户端 + 库 + 资源 + 原生库）
 *
 * 用法：
 *   node tools/headless-install.js [版本] [--source=auto|mojang|bmcl|bangbang]
 * 示例：
 *   node tools/headless-install.js 1.20.1 --source=bmcl
 *
 * 数据目录：$AC_DATA_DIR 或 <项目>/.acdata
 */
const path = require('path');
const fs = require('fs');

const { buildPaths, ensureDirs } = require('../src/core/paths');
const { ManifestService } = require('../src/core/manifest');
const installer = require('../src/core/installer');
const game = require('../src/core/game');
const runtime = require('../src/main/runtime');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const getFlag = (name, def) => {
  const hit = flags.find((f) => f.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const VERSION = positional[0] || '1.20.1';
const SOURCE = getFlag('source', 'bmcl');
const SKIP_ASSETS = flags.includes('--no-assets');

function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(1) + ' ' + u[i];
}

function progressLine(p) {
  const pct = Math.round((p.ratio || 0) * 100);
  const bar = '█'.repeat(Math.floor(pct / 4)).padEnd(25, '░');
  process.stdout.write(`\r  ${bar} ${String(pct).padStart(3)}%  ${p.done || 0}/${p.total || 0}  ${fmtBytes(p.bytes || 0)}  ${fmtBytes(p.speed || 0)}/s   `);
}

(async () => {
  const paths = buildPaths();
  ensureDirs(paths);

  console.log('════════════════════════════════════════════════════════');
  console.log('  AuroraCraft 无头安装');
  console.log('  版本      :', VERSION);
  console.log('  渠道      :', SOURCE);
  console.log('  游戏目录  :', paths.gameDir);
  console.log('════════════════════════════════════════════════════════');

  const started = Date.now();
  const ms = new ManifestService(paths);

  console.log('\n[1/5] 获取版本清单…');
  const manifest = await ms.getManifest(SOURCE);
  const entry = manifest.versions.find((v) => v.id === VERSION);
  if (!entry) {
    console.error(`  ✗ 清单中找不到版本 ${VERSION}`);
    process.exit(1);
  }
  console.log(`  ✓ 找到 ${entry.id}（${entry.type}）`);

  console.log('\n[2/5] 获取版本 JSON…');
  const vjson = await ms.getVersionJson(entry, SOURCE);
  const vdir = path.join(paths.versionsDir, vjson.id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, vjson.id + '.json'), JSON.stringify(vjson, null, 2), 'utf8');
  console.log(`  ✓ Java ${vjson.javaVersion ? vjson.javaVersion.majorVersion : '?'}，主类 ${vjson.mainClass}`);

  console.log('\n[3/5] 下载客户端 / 库 / 资源…');
  let logs = 0;
  const result = await installer.installVersion(paths, vjson, {
    source: SOURCE,
    threads: 16,
    skipAssets: SKIP_ASSETS,
    onProgress: progressLine,
    onLog: (m) => { logs += 1; if (logs < 20) console.log('\n  · ' + m); },
  });
  console.log('');
  console.log(`  ✓ 客户端与库：${result.core.done}/${result.core.total}，失败 ${result.core.failed}`);
  console.log(`  ✓ 资源对象  ：${result.assets.done}/${result.assets.total}，失败 ${result.assets.failed}`);

  console.log('\n[4/5] 解压原生库…');
  const full = game.resolveFullVersion(paths.versionsDir, vjson.id);
  const plan = game.buildInstallPlan(paths, full, SOURCE);
  const natives = await game.extractNatives(paths, vjson.id, plan.natives);
  let count = 0;
  try { count = fs.readdirSync(natives.destDir).length; } catch (e) { count = 0; }
  console.log(`  ✓ ${count} 个原生库文件 -> ${natives.destDir}`);
  if (natives.skipped.length) console.log('  ! 跳过：', natives.skipped.join(', '));

  console.log('\n[5/5] 构建启动命令（不启动）…');
  const account = require('../src/core/account').buildOfflineAccount('Steve');
  const java = await runtime.findJava({}, (vjson.javaVersion && vjson.javaVersion.majorVersion) || 8, '');
  const built = game.buildLaunchCommand({
    paths,
    versionJson: full,
    javaPath: (java && java.javaPath) || 'java',
    account: account.account,
    gameDir: paths.gameDir,
    jvmArgs: '',
    gameArgs: '',
    minMemory: 1024,
    maxMemory: 2048,
    width: 854,
    height: 480,
  });
  console.log(`  ✓ 参数 ${built.args.length} 个，类路径 ${built.classpath.length} 项`);
  console.log('  Java:', java ? `${java.javaPath}（${java.version}）` : '未检测到');

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n════════════════════════════════════════════════════════');
  console.log(`  安装完成：${vjson.id}  用时 ${elapsed}s`);
  console.log('  下一步：node tools/headless-launch.js ' + vjson.id);
  console.log('════════════════════════════════════════════════════════\n');
})().catch((e) => {
  console.error('\n✗ 安装失败：', e.message);
  process.exit(1);
});
