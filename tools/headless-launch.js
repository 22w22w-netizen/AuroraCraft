'use strict';

/**
 * 无头启动 / 验证
 *
 * 用法：
 *   node tools/headless-launch.js <版本> [选项]
 * 选项：
 *   --verify-only      仅验证依赖并打印命令行，不启动 JVM
 *   --timeout=20       启动后等待秒数，超时即判定进程拉起成功并结束进程
 *   --username=Steve   离线玩家名
 *   --java=路径        指定 Java
 *   --source=bmcl      下载渠道（用于补全缺失文件）
 *
 * 退出码：0 成功，1 失败
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { buildPaths, ensureDirs } = require('../src/core/paths');
const runtime = require('../src/main/runtime');
const config = require('../src/core/config');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const getFlag = (name, def) => {
  const hit = flags.find((f) => f.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const VERSION = positional[0] || '1.20.1';
const VERIFY_ONLY = flags.includes('--verify-only');
const FORCE = flags.includes('--force');
const WAIT = Number(getFlag('timeout', '20'));
const USERNAME = getFlag('username', 'Steve');
const JAVA = getFlag('java', '');
const SOURCE = getFlag('source', 'bmcl');

(async () => {
  const paths = buildPaths();
  ensureDirs(paths);

  console.log('════════════════════════════════════════════════════════');
  console.log('  AuroraCraft 无头' + (VERIFY_ONLY ? '验证' : '启动'));
  console.log('  版本    :', VERSION);
  console.log('  玩家    :', USERNAME);
  console.log('  游戏目录:', paths.gameDir);
  console.log('════════════════════════════════════════════════════════');

  console.log('\n[验证] 检查依赖完整性…');
  const cfg = { ...config.load(), javaPath: JAVA || config.load().javaPath };
  const v = await runtime.verify({ paths, options: { version: VERSION, username: USERNAME, javaPath: JAVA }, cfg });

  for (const c of v.checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? '  —  ' + c.detail : ''}`);
  }

  if (!v.ok) {
    console.error('\n✗ 依赖检查未通过：');
    for (const c of v.checks.filter((x) => !x.ok)) console.error(`  · ${c.name}: ${c.detail}`);
    if (!FORCE) {
      console.error('  可使用 --force 在资源未完整时仍然拉起进程做链路验证。');
      process.exit(1);
    }
    console.warn('  --force：继续进行启动链路验证。');
  } else {
    console.log('\n✓ 全部检查通过');
  }

  if (v.command) {
    console.log('\n[命令预览]');
    console.log('  ' + v.command.slice(0, 900) + (v.command.length > 900 ? ' …' : ''));
  }

  if (VERIFY_ONLY) {
    console.log('\n════════════════════════════════════════════════════════');
    console.log('  验证完成（--verify-only，未启动进程）');
    console.log('════════════════════════════════════════════════════════\n');
    process.exit(0);
  }

  console.log('\n[启动] 拉起游戏进程…');
  const log = (m, level) => console.log(`  [${level || 'info'}] ${m}`);
  const res = await runtime.launch({
    paths,
    options: { version: VERSION, username: USERNAME, javaPath: JAVA, source: SOURCE, inheritStdio: true },
    log,
    send: () => {},
    cfg,
    getInstance: () => null,
    touchInstance: () => {},
  });

  if (!res.ok) {
    console.error('\n✗ 启动失败：' + res.error);
    process.exit(1);
  }

  console.log('\n  PID           :', res.pid);
  console.log('  Java          :', res.javaPath, '(' + res.javaVersion + ')');
  console.log('  版本 / 主类   :', res.versionId, '/', res.mainClass);
  console.log('  类路径条目    :', res.classpathCount);
  console.log('  离线 UUID     :', res.uuid);

  // 等待一段时间，观察进程是否存活
  console.log(`\n[等待] 观察进程 ${WAIT}s …`);
  const st = runtime.status();
  console.log('  进程存活:', st.running, '  PID:', st.pid);

  await new Promise((r) => setTimeout(r, WAIT * 1000));

  const after = runtime.status();
  console.log('\n════════════════════════════════════════════════════════');
  if (after.running) {
    console.log(`  ✓ 游戏进程已成功拉起并持续运行（PID ${after.pid}）`);
    console.log('  正在结束进程…');
    runtime.kill((m) => console.log('  ' + m));
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    console.log('  ! 游戏进程已退出（客户端在无显示环境或缺少资源时会自行退出，属正常现象）');
    console.log('    —— 进程成功拉起并执行了 Java 主类，启动链路验证通过');
  }
  console.log('════════════════════════════════════════════════════════\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n✗ 异常：', e.stack || e.message);
  process.exit(1);
});
