'use strict';

/**
 * 无 Electron 的渲染层冒烟测试：用极简 DOM 桩件解析 index.html，跑 i18n.js + app.js，
 * 验证 i18n 装配、init() 独立预览分支与语言切换不抛异常。
 *   node tools/smoke-renderer.js
 */
const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const htmlSrc = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(rendererDir, 'i18n.js'), 'utf8');

/* ---------- 极简 DOM 桩件 ---------- */
const camel = (s) => s.replace(/-(\w)/g, (_x, c) => c.toUpperCase());

function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag, attributes: {}, children: [], options: [], style: {}, dataset: {},
    value: '', textContent: '', title: '', placeholder: '', disabled: false, selected: false,
    scrollTop: 0, scrollHeight: 0, listeners: {},
    _classes: new Set(),
    get className() { return [...this._classes].join(' '); },
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v); this.children = []; this.options = [];
      const opts = [...this._innerHTML.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)];
      for (const o of opts) { const oe = makeEl('option'); oe.value = o[1]; oe.textContent = o[2]; this.children.push(oe); this.options.push(oe); }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; },
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); if (c.tagName === 'option') this.options.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); this.options = this.options.filter((x) => x !== c); },
    addEventListener(type, cb) { (this.listeners[type] = this.listeners[type] || []).push(cb); },
    removeEventListener() {},
    querySelector(sel) {
      if (sel === '.task-icon') return makeEl('i');
      if (sel === '.list-item.selected') return null;
      if (sel.startsWith('.')) return this.children.find((c) => c._classes.has(sel.slice(1))) || null;
      return null;
    },
    querySelectorAll() { return []; },
    focus() {}, closest() { return null; },
  };
  el.classList = {
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    toggle: (c, on) => { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); } else { on ? el._classes.add(c) : el._classes.delete(c); } },
    contains: (c) => el._classes.has(c),
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') { el.className = v; continue; }
    el.attributes[k] = v;
    if (k.startsWith('data-')) el.dataset[camel(k.slice(5))] = v;
  }
  return el;
}

/* ---------- 解析 index.html 开标签 ---------- */
const byId = {};
const allEls = [];
const tagRe = /<([a-zA-Z0-9]+)((?:"[^"]*"|[^>])*)>/g;
const attrTok = /([^\s=]+)(?:="([^"]*)")?/g;
let m;
while ((m = tagRe.exec(htmlSrc))) {
  const tag = m[1].toLowerCase();
  const attrs = {};
  let a;
  attrTok.lastIndex = 0;
  while ((a = attrTok.exec(m[2]))) if (a[1]) attrs[a[1]] = a[2] !== undefined ? a[2] : '';
  const el = makeEl(tag, attrs);
  if (attrs.id) byId[attrs.id] = el;
  allEls.push(el);
}

const navButtons = allEls.filter((e) => e._classes.has('nav-item'));
const viewSections = allEls.filter((e) => e._classes.has('view'));
const logTabs = allEls.filter((e) => e.attributes['data-log-filter']);
const loaderCards = allEls.filter((e) => e.attributes['data-loader']);
const brandLink = allEls.find((e) => e._classes.has('brand'));
const statusDot = makeEl('span');
if (byId.bridgeStatus) byId.bridgeStatus.previousElementSibling = statusDot;

const documentEl = makeEl('html');
const document = {
  readyState: 'complete',
  documentElement: documentEl,
  title: '',
  body: makeEl('body'),
  getElementById: (id) => byId[id] || null,
  querySelector: (sel) => {
    if (sel === '.brand') return brandLink;
    if (sel === '.task-icon') return makeEl('i');
    return null;
  },
  querySelectorAll: (sel) => {
    const attrMatch = sel.match(/^\[(data-i18n[a-z-]*)\]$/);
    if (attrMatch) return allEls.filter((el) => el.getAttribute(attrMatch[1]) !== null);
    switch (sel) {
      case '.nav-item': return navButtons;
      case '.view': return viewSections;
      case '.log-tabs button': return logTabs;
      case '.loader-card': return loaderCards;
      case '.titlebar [data-window]': return [];
      default: return [];
    }
  },
  createElement: (tag) => makeEl(tag),
  addEventListener: () => {},
};

/* ---------- window 桩件 ---------- */
const listeners = {};
const navigatorStub = { language: 'zh-CN', clipboard: { writeText: async () => {} } };
const windowObj = {
  document,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: navigatorStub,
  location: { hash: '' },
  history: { replaceState: () => {} },
  addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
  dispatchEvent(ev) { (listeners[ev.type] || []).forEach((cb) => { try { cb(ev); } catch (e) { console.error('i18n:changed listener threw:', e.stack || e.message); process.exitCode = 1; } }); return true; },
  CustomEvent: class { constructor(type, o) { this.type = type; Object.assign(this, o || {}); } },
  confirm: () => false,
  setTimeout, clearTimeout,
  api: {}, // 无 preload → 走「独立预览模式」分支
};
windowObj.window = windowObj;

/* ---------- 载入 i18n.js（其 IIFE 以 window 为 global） ---------- */
new Function('window', 'globalThis', 'document', 'localStorage', 'navigator', 'CustomEvent', 'console',
  `${i18nSrc}\n`)(windowObj, windowObj, document, windowObj.localStorage, navigatorStub, windowObj.CustomEvent, console);

/* ---------- 载入并运行 app.js（裸 document/history/location 需绑定） ---------- */
new Function('window', 'document', 'location', 'history', 'navigator', 'localStorage', 'setTimeout', 'console', 'confirm',
  `${appSrc}\n`)(windowObj, document, windowObj.location, windowObj.history, navigatorStub, windowObj.localStorage, setTimeout, console, windowObj.confirm);

/* ---------- 断言 ---------- */
setTimeout(() => {
  const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
  try {
    const I = windowObj.I18N;
    if (!I) fail('I18N 未挂载到 window');
    const total = allEls.filter((el) => el.getAttribute('data-i18n')).length;
    if (document.title !== I.messages['zh-CN']['app.title']) fail('document.title 未被 i18n 设置: ' + document.title);
    const filled = allEls.filter((el) => el.getAttribute('data-i18n') && el.textContent);
    if (!filled.length) fail('没有任何 data-i18n 节点被填充');
    if (!byId.versionList || !byId.versionList.innerHTML.includes('window.api')) fail('独立预览提示未渲染');

    /* 切换到英文：静态节点应全部变成英文字典里的值（动态覆盖节点按插值模板匹配） */
    const matchers = (pack) => Object.values(pack).map((v) => new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\{[^]*?\\\}\\\}/g, '[\\s\\S]*') + '$'));
    I.setLocale('en');
    if (document.title !== I.messages.en['app.title']) fail('切英文后 title 错误: ' + document.title);
    const enMatch = matchers(I.messages.en);
    const bad = allEls.filter((el) => {
      const k = el.getAttribute('data-i18n');
      if (!k) return false;
      const want = I.messages.en[k];
      if (el.textContent === want) return false;
      return !enMatch.some((re) => re.test(el.textContent));
    });
    if (bad.length) fail('英文切换后未正确翻译的节点: ' + bad.map((b) => `${b.tagName}[${b.getAttribute('data-i18n')}]=${JSON.stringify(b.textContent)}`).join(', '));

    I.setLocale('zh-CN');
    const zhMatch = matchers(I.messages['zh-CN']);
    const bad2 = allEls.filter((el) => {
      const k = el.getAttribute('data-i18n');
      if (!k) return false;
      if (el.textContent === I.messages['zh-CN'][k]) return false;
      return !zhMatch.some((re) => re.test(el.textContent));
    });
    if (bad2.length) fail('切回中文后未正确翻译的节点: ' + bad2.map((b) => b.getAttribute('data-i18n')).join(', '));

    console.log(`PASS — 冒烟测试通过：init() 无异常，${total} 个 data-i18n 静态节点全部装配，zh↔en 双向切换正常。`);
  } catch (e) { fail(e.stack || e.message); }
}, 200);
