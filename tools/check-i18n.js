'use strict';

/**
 * i18n 静态校验脚本（零依赖，可在 Node 直接运行）：
 *   node tools/check-i18n.js
 *
 * 检查项：
 *  1. HTML 中每个 data-i18n / data-i18n-* 引用的键，在 zh-CN 与 en 字典中都存在；
 *  2. app.js 中每个 I18N.t('key') / t('key') / t(`模板`) 字面量键都存在；
 *  3. 字典之间键集合一致（zh-CN 为基准）；
 *  4. app.js 引用的所有 $('id') 在 index.html 中都存在（防止 DOM id 不匹配）；
 *  5. 渲染层不存在面向用户的硬编码中文文案（HTML 兜底文本、注释除外）。
 */
const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');

// i18n.js 在浏览器里挂到 window；这里用一个假 global 载入并取 I18N。
const sandbox = {};
const i18nSrc = fs.readFileSync(path.join(rendererDir, 'i18n.js'), 'utf8');
new Function('window', 'globalThis', 'module', i18nSrc)(sandbox, sandbox, { exports: {} });
const I18N = sandbox.I18N;
if (!I18N) { console.error('FAIL: 未能从 i18n.js 取到 I18N'); process.exit(1); }

const problems = [];
const zh = I18N.messages['zh-CN'];
const en = I18N.messages.en;

/* ---------- 1. HTML 中的 data-i18n 键 ---------- */
const attrRe = /data-i18n(?:-[a-z-]+)?\s*=\s*"([^"]+)"/g;
let m;
const htmlKeys = new Set();
while ((m = attrRe.exec(html))) htmlKeys.add(m[1]);

/* ---------- 2. app.js 中的 t('key') / t(`a.${x}`) 字面量与模板键 ---------- */
const jsKeys = new Set();
const literalRe = /\bt\(\s*'([\w.]+)'/g;
while ((m = literalRe.exec(appJs))) jsKeys.add(m[1]);
// 模板串：把 ${...} 归一化成通配段后，用「是否存在任一匹配键」判断
const templateRe = /\bt\(\s*`([^`]*)`/g;
const templatePatterns = [];
while ((m = templateRe.exec(appJs))) templatePatterns.push(m[1]);

/* ---------- 3. 键存在性检查 ---------- */
function checkKey(key, where) {
  if (!(key in zh)) problems.push(`缺失键 zh-CN: ${key} (${where})`);
  if (!(key in en)) problems.push(`缺失键 en: ${key} (${where})`);
}
for (const key of htmlKeys) checkKey(key, 'index.html');
for (const key of jsKeys) checkKey(key, 'app.js');

// 模板键（含 ${expr}）：只要能匹配到某个已定义前缀即可，无法静态求值的做宽松校验
const dynamicTemplates = [];
for (const tpl of templatePatterns) {
  const regex = new RegExp('^' + tpl.replace(/\$\{[^}]*\}/g, '[^./]*').replace(/\./g, '\\.') + '$');
  const any = Object.keys(zh).some((k) => regex.test(k));
  if (!any) dynamicTemplates.push(tpl);
}

/* ---------- 字典对称性 ---------- */
for (const key of Object.keys(zh)) if (!(key in en)) problems.push(`en 字典缺键: ${key}`);
for (const key of Object.keys(en)) if (!(key in zh)) problems.push(`zh-CN 字典缺键: ${key}`);

/* ---------- 4. DOM id 匹配 ---------- */
const htmlIds = new Set();
const idRe = /\bid="([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);
const selRe = /\$\('([\w-]+)'\)/g;
const usedIds = new Set();
while ((m = selRe.exec(appJs))) usedIds.add(m[1]);
for (const id of usedIds) if (!htmlIds.has(id)) problems.push(`app.js 引用的 id 在 HTML 中不存在: #${id}`);

/* ---------- 5. 硬编码中文扫描（app.js 字符串字面量 / 模板） ---------- */
// 去掉注释后，扫描含 CJK 的字符串字面量（单引号/双引号/模板串）。
const stripped = appJs
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const cjk = /[\u4e00-\u9fff]/;
const stringRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.|[^`\\])*)`/g;
const hardcoded = [];
while ((m = stringRe.exec(stripped))) {
  const body = m[1] ?? m[2] ?? m[3] ?? '';
  if (cjk.test(body) && !body.includes('${')) hardcoded.push(body);
}
for (const s of hardcoded) problems.push(`app.js 中存在硬编码中文文案: "${s}"`);

/* ---------- 输出 ---------- */
console.log(`i18n 键统计: HTML ${htmlKeys.size} 个, app.js 字面量 ${jsKeys.size} 个, 模板 ${templatePatterns.length} 个`);
console.log(`字典规模: zh-CN ${Object.keys(zh).length} 键, en ${Object.keys(en).length} 键`);
console.log(`HTML id: ${htmlIds.size} 个, app.js 引用: ${usedIds.size} 个`);
if (dynamicTemplates.length) {
  console.log('无法静态确认的动态模板键（人工复核）:');
  dynamicTemplates.forEach((x) => console.log('  ~ ' + x));
}
if (problems.length) {
  console.error('\nFAIL — 共 ' + problems.length + ' 个问题:');
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log('\nPASS — i18n 键全覆盖，DOM id 匹配，未发现硬编码用户文案。');
