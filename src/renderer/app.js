'use strict';

/* 极光启动器 — 渲染层 */
const API = window.api;
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const S = {
  info: null, cfg: {}, manifest: null, versions: [], localVersions: [],
  selectedVersion: null, versionFilter: '', versionType: 'release',
  javas: [], instances: [], currentLoader: 'fabric', loaderVersions: [],
  source: 'auto', sources: [], gameRunning: false, busy: false, logs: [],
};

const SVGIcons = {
  check: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5 6.2 11.7 13 4.8" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" stroke-width="2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.4" fill="none" stroke="#818cf8" stroke-width="1.6"/><path d="M8 7v4M8 5.1v.9" stroke="#818cf8" stroke-width="1.6" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2.4 14.6 13.6H1.4z" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.4v3.2M8 11.4v.8" stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round"/></svg>',
  spinner: '<svg class="spin" viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6" fill="none" stroke="rgba(129,140,248,0.25)" stroke-width="2"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round"/></svg>',
};

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  } catch (e) { return String(iso); }
}

function toast(message, type, timeout) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  const icon = type === 'success' ? SVGIcons.check : type === 'error' ? SVGIcons.cross : type === 'warn' ? SVGIcons.warn : SVGIcons.info;
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span>' + esc(message) + '</span>';
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, timeout || 3200);
}

function pushLog(line) {
  const time = (line.time || new Date().toISOString()).slice(11, 19);
  const level = line.level || 'info';
  S.logs.push({ time: time, level: level, message: line.message });
  if (S.logs.length > 1200) S.logs.shift();
  const box = $('console');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'ln-' + level;
  div.innerHTML = '<span class="ln-time">' + esc(time) + '</span>' + esc(line.message);
  box.appendChild(div);
  while (box.childElementCount > 600) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
  $('titleStatus').textContent = String(line.message || '').slice(0, 90);
}

function openModal(title, bodyHtml, footHtml) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalFoot').innerHTML = footHtml || '<button class="btn ghost" data-modal-close>关闭</button>';
  $('modalMask').classList.add('show');
}
function closeModal() { $('modalMask').classList.remove('show'); }

function switchView(view) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'versions' && !S.manifest) loadManifest(true);
  if (view === 'java') detectJava();
  if (view === 'instances') renderInstances();
  if (view === 'settings') { renderSourceCards(); loadSizes(); }
  if (view === 'loader') refreshLoaderMcVersions();
  if (view === 'store') initStore();
}

async function init() {
  $('btnMin').onclick = () => API.window.minimize();
  $('btnMax').onclick = () => API.window.maximize();
  $('btnClose').onclick = () => API.window.close();
  API.window.onState((st) => {
    $('btnMax').innerHTML = st.maximized
      ? '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="5.5" height="5.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M4.5 2.5V1.5h6v6H9.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
      : '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  });

  $$('.nav-item').forEach((btn) => { btn.onclick = () => switchView(btn.dataset.view); });
  $('modalClose').onclick = closeModal;
  $('modalMask').onclick = (e) => { if (e.target === $('modalMask')) closeModal(); };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-modal-close]')) closeModal(); });

  API.onLog(pushLog);
  API.onDownloadProgress(onDownloadProgress);
  API.onDownloadStage((st) => {
    $('stageText').textContent = st.text || st.stage;
    $('titleStatus').textContent = st.text || st.stage;
  });
  API.onGameOutput(onGameOutput);
  API.onGameExit(onGameExit);

  S.info = await API.appInfo();
  S.sources = S.info.sources || [];
  $('appVer').textContent = 'v' + S.info.version;
  S.cfg = await API.configGet();
  S.source = S.cfg.source || 'auto';

  bindHomeEvents(); bindVersionEvents(); bindLoaderEvents();
  bindJavaEvents(); bindInstanceEvents(); bindSettingsEvents();
  applyConfigToUI();

  await Promise.all([loadInstances(), detectJava(), refreshLocalVersions()]);
  updateStats();

  pushLog({ level: 'info', message: 'AuroraCraft 已启动 · Electron ' + S.info.electron + ' · Node ' + S.info.node });
  pushLog({ level: 'debug', message: '游戏目录：' + S.info.paths.gameDir });

  loadManifest(true).catch(() => {});
  refreshGameState();
}

function applyConfigToUI() {
  const c = S.cfg;
  $('inpUsername').value = c.username || 'Steve';
  $('inpMemMin').value = c.minMemory || 1024;
  $('inpMemMax').value = c.maxMemory || 4096;
  $('setThreads').value = c.threads || 16;
  $('setGameDir').value = c.minecraftDir || '';
  $('setJvmArgs').value = c.jvmArgs || '';
  $('setGameArgs').value = c.gameArgs || '';
  $('setWidth').value = c.width || 854;
  $('setHeight').value = c.height || 480;
  $('setJavaPath').value = c.javaPath || '';
  $('setAutoJava').checked = c.autoJava !== false;
  updateSourceUI();
  updateUuidHint();
}

function updateSourceUI() {
  const src = S.sources.find((s) => s.id === S.source) || { name: '自动测速', color: '#a855f7' };
  $('sourceLabel').textContent = src.name;
  $('sourceDot').style.background = src.color;
  $('sourceDot').style.color = src.color;
  $('launchChannelBadge').textContent = src.name;
  renderSourceCards();
}

async function updateUuidHint() {
  const name = $('inpUsername').value.trim();
  if (!name) { $('uuidHint').textContent = '—'; return; }
  try {
    const acc = await API.accountOffline(name);
    $('uuidHint').textContent = acc.ok ? acc.account.uuid : '名称无效';
    $('uuidHint').title = acc.ok ? '离线 UUID：' + acc.account.uuid : acc.message;
  } catch (e) { $('uuidHint').textContent = '—'; }
}

function bindHomeEvents() {
  $('selInstance').onchange = () => {
    const inst = S.instances.find((i) => i.id === $('selInstance').value);
    if (!inst) return;
    if (inst.version) $('selVersion').value = inst.version;
    $('inpMemMin').value = inst.minMemory || 1024;
    $('inpMemMax').value = inst.maxMemory || 4096;
    if (inst.javaPath) $('selJava').value = inst.javaPath;
    API.configSet({ selectedInstance: inst.id }).catch(() => {});
  };
  let uuidTimer = null;
  $('inpUsername').addEventListener('input', () => { clearTimeout(uuidTimer); uuidTimer = setTimeout(updateUuidHint, 220); });
  $('btnLaunch').onclick = doLaunch;
  $('btnVerify').onclick = doVerify;
  $('btnKillGame').onclick = async () => { await API.gameKill(); toast('已请求结束游戏进程', 'warn'); };
  $('btnClearLog').onclick = () => { S.logs = []; $('console').innerHTML = ''; toast('控制台已清空'); };
  $('btnCopyLog').onclick = async () => {
    const text = S.logs.map((l) => '[' + l.time + '] ' + l.message).join('\n');
    try { await navigator.clipboard.writeText(text); toast('日志已复制', 'success'); } catch (e) { toast('复制失败', 'error'); }
  };
  $('sourceChip').onclick = () => switchView('settings');
}

async function doLaunch() {
  if (S.busy) return;
  const version = $('selVersion').value;
  if (!version) { toast('请先选择要启动的版本', 'warn'); return; }
  const username = $('inpUsername').value.trim();
  const memMin = Number($('inpMemMin').value) || 1024;
  const memMax = Number($('inpMemMax').value) || 4096;
  if (memMax < memMin) { toast('最大内存不能小于最小内存', 'warn'); return; }

  S.busy = true;
  $('btnLaunch').disabled = true;
  setLaunchStatus('正在启动…', '');
  $('titleStatus').textContent = '启动中…';

  try {
    await API.configSet({ username: username, minMemory: memMin, maxMemory: memMax, javaPath: $('selJava').value || '' });
    const res = await API.gameLaunch({
      version: version, username: username, minMemory: memMin, maxMemory: memMax,
      javaPath: $('selJava').value || '', instanceId: $('selInstance').value || '', source: S.source,
    });
    if (!res.ok) {
      setLaunchStatus('启动失败：' + res.error, 'err');
      toast('启动失败：' + res.error, 'error', 5000);
      return;
    }
    setLaunchStatus('已启动 PID ' + res.pid + ' · ' + res.versionId + ' · Java ' + res.javaVersion + ' · 账户 ' + res.username, 'ok');
    toast('游戏已启动', 'success');
    setGameRunning(true);
  } catch (e) {
    setLaunchStatus('启动异常：' + e.message, 'err');
    toast('启动异常：' + e.message, 'error');
  } finally {
    S.busy = false;
    $('btnLaunch').disabled = S.gameRunning;
  }
}

async function doVerify() {
  const version = $('selVersion').value;
  if (!version) { toast('请先选择要验证的版本', 'warn'); return; }
  openModal('无头验证', '<div style="display:flex;align-items:center;gap:9px">' + SVGIcons.spinner + '<span>正在检查依赖完整性…</span></div>');
  try {
    const res = await API.gameVerify({ version: version, username: $('inpUsername').value.trim() });
    const items = (res.checks || []).map((c) =>
      '<div class="check-item ' + (c.ok ? 'ok' : 'fail') + '">' +
      '<span class="ci-icon">' + (c.ok ? SVGIcons.check : SVGIcons.cross) + '</span>' +
      '<div style="min-width:0"><div class="ci-name">' + esc(c.name) + '</div>' +
      (c.detail ? '<div class="ci-detail">' + esc(c.detail) + '</div>' : '') + '</div></div>').join('');
    const summary = res.ok
      ? '<div style="margin-bottom:13px;color:#6ee7b7;display:flex;gap:8px;align-items:center">' + SVGIcons.check + '全部检查通过，可以启动</div>'
      : '<div style="margin-bottom:13px;color:#fca5a5;display:flex;gap:8px;align-items:center">' + SVGIcons.cross + '存在未通过的检查项</div>';
    const cmd = res.command
      ? '<div style="margin-top:14px"><div style="font-size:12px;color:var(--txt-2);margin-bottom:6px">启动命令（预览）</div><pre>' + esc(res.command) + '</pre></div>'
      : '';
    openModal('无头验证 — ' + esc(version), summary + '<div class="check-list">' + items + '</div>' + cmd);
    $('modalFoot').innerHTML = '<button class="btn ghost" data-modal-close>关闭</button><button class="btn primary" id="modalGoLaunch">' + (res.ok ? '直接启动' : '仍要尝试') + '</button>';
    const btn = $('modalGoLaunch');
    if (btn) btn.onclick = () => { closeModal(); doLaunch(); };
    toast(res.ok ? '验证通过' : '验证未通过', res.ok ? 'success' : 'error');
  } catch (e) {
    openModal('无头验证', '<div style="color:#fca5a5">验证失败：' + esc(e.message) + '</div>');
  }
}

function setLaunchStatus(text, cls) {
  const el = $('launchStatus');
  el.textContent = text;
  el.className = 'launch-status' + (cls ? ' ' + cls : '');
}
function setGameRunning(running) {
  S.gameRunning = running;
  $('btnKillGame').disabled = !running;
  $('btnLaunch').disabled = running;
}
async function refreshGameState() {
  try { const st = await API.gameIsRunning(); setGameRunning(!!st.running); } catch (e) { /* noop */ }
}
function onGameOutput(ev) {
  const level = ev.stream === 'stderr' ? 'warn' : 'debug';
  for (const line of String(ev.text).split(/\r?\n/)) if (line.trim()) pushLog({ level: level, message: line });
}
function onGameExit(ev) {
  setGameRunning(false);
  if (ev.error) {
    setLaunchStatus('游戏进程启动失败：' + ev.error, 'err');
    toast('游戏进程启动失败：' + ev.error, 'error');
  } else {
    setLaunchStatus('游戏已退出（代码 ' + ev.code + (ev.playtime ? '，时长 ' + ev.playtime + 's' : '') + '）', ev.code === 0 ? 'ok' : 'warn');
    toast('游戏已退出（代码 ' + ev.code + '）', ev.code === 0 ? 'success' : 'warn');
  }
}

function onDownloadProgress(p) {
  const pct = Math.round((p.ratio || 0) * 100);
  const C = 2 * Math.PI * 52;
  const ring = $('ringFg');
  ring.style.strokeDasharray = String(C);
  ring.style.strokeDashoffset = String(C * (1 - (p.ratio || 0)));
  ring.style.stroke = pct >= 100 ? '#34d399' : '#818cf8';
  $('ringPct').textContent = pct + '%';
  $('ringSub').textContent = p.label || '下载中';
  $('progFiles').textContent = (p.done || 0) + '/' + (p.total || 0);
  $('progBytes').textContent = fmtBytes(p.bytes);
  $('progSpeed').textContent = fmtBytes(p.speed) + '/s';
  $('currentFiles').innerHTML = (p.current || []).map((f) => '<div>' + esc(f) + '</div>').join('') || '<div style="opacity:.5">—</div>';
  $('titleStatus').textContent = p.label ? p.label + ' ' + pct + '%' : pct + '%';
}

function bindVersionEvents() {
  $('btnRefreshManifest').onclick = () => loadManifest(false, true);
  $('btnSpeedTest').onclick = runSpeedTest;
  $('btnSpeedTest2').onclick = runSpeedTest;
  $('inpFilter').addEventListener('input', () => { S.versionFilter = $('inpFilter').value.trim().toLowerCase(); renderVersionList(); });
  $('segVersionType').onclick = (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    $$('#segVersionType .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    S.versionType = btn.dataset.type;
    renderVersionList();
  };
}

async function loadManifest(silent, force) {
  try {
    if (!silent) $('titleStatus').textContent = '加载版本清单…';
    const data = await API.manifestGet(S.source, force ? { force: true } : {});
    S.manifest = data;
    S.versions = data.versions || [];
    if (data.stale && !silent) toast('网络异常，已使用缓存清单', 'warn');
    renderVersionList();
    updateStats();
  } catch (e) {
    if (!silent) toast('获取版本清单失败：' + e.message, 'error', 5000);
    if (!S.manifest) $('versionsList').innerHTML = '<div class="empty-state">获取清单失败：' + esc(e.message) + '</div>';
  }
}

function renderVersionList() {
  const list = $('versionsList');
  if (S.versionType === 'installed') {
    if (!S.localVersions.length) { list.innerHTML = '<div class="empty-state">还没有已安装的版本</div>'; return; }
    list.innerHTML = S.localVersions.map((v) =>
      '<div class="v-row ' + (S.selectedVersion && S.selectedVersion.id === v.id ? 'active' : '') + '" data-vid="' + esc(v.id) + '" data-local="1">' +
      '<span class="v-id">' + esc(v.id) + '</span><span class="v-type ' + esc(v.type) + '">' + esc(v.type) + '</span>' +
      '<span class="v-installed">' + (v.hasJar ? '✓ 已安装' : '⚠ 缺 JAR') + '</span>' +
      '<span class="v-time">' + esc(fmtDate(v.time)) + '</span></div>').join('');
    bindVersionRows(); return;
  }
  let items = S.versions;
  if (S.versionType === 'release') items = items.filter((v) => v.type === 'release');
  else if (S.versionType === 'snapshot') items = items.filter((v) => v.type === 'snapshot');
  if (S.versionFilter) items = items.filter((v) => v.id.toLowerCase().includes(S.versionFilter));
  if (!items.length) { list.innerHTML = '<div class="empty-state">没有匹配的版本</div>'; return; }
  const installed = new Set(S.localVersions.map((v) => v.id));
  list.innerHTML = items.slice(0, 500).map((v) =>
    '<div class="v-row ' + (S.selectedVersion && S.selectedVersion.id === v.id ? 'active' : '') + '" data-vid="' + esc(v.id) + '">' +
    '<span class="v-id">' + esc(v.id) + '</span>' +
    '<span class="v-type ' + esc(v.type) + '">' + esc(v.type === 'release' ? '正式' : v.type === 'snapshot' ? '快照' : v.type) + '</span>' +
    (installed.has(v.id) ? '<span class="v-installed">✓ 已安装</span>' : '') +
    '<span class="v-time">' + esc(fmtDate(v.releaseTime)) + '</span></div>').join('');
  bindVersionRows();
}

function bindVersionRows() {
  $$('#versionsList .v-row').forEach((row) => { row.onclick = () => selectVersion(row.dataset.vid, row.dataset.local === '1'); });
}

async function selectVersion(id, isLocal) {
  const local = isLocal ? S.localVersions.find((v) => v.id === id) : null;
  const entry = S.versions.find((v) => v.id === id);
  S.selectedVersion = local ? Object.assign({}, local, { id: id }) : (entry || { id: id });
  renderVersionList();
  renderVersionDetail(S.selectedVersion);
}

function renderVersionDetail(v) {
  const detail = $('versionDetail');
  const isInstalled = S.localVersions.some((l) => l.id === v.id);
  const remote = S.versions.find((x) => x.id === v.id);
  detail.innerHTML =
    '<div class="detail-title">' + esc(v.id) + '</div>' +
    '<div class="detail-sub">' + (isInstalled ? '已安装到本地' : '尚未安装') + '</div>' +
    '<div class="kv"><span class="k">类型</span><span class="v">' + esc(v.type || '—') + '</span></div>' +
    '<div class="kv"><span class="k">发布时间</span><span class="v">' + esc(fmtDate(v.time || (remote && remote.releaseTime))) + '</span></div>' +
    (v.mainClass ? '<div class="kv"><span class="k">主类</span><span class="v" style="font-size:10.5px">' + esc(v.mainClass) + '</span></div>' : '') +
    (v.inheritsFrom ? '<div class="kv"><span class="k">继承自</span><span class="v">' + esc(v.inheritsFrom) + '</span></div>' : '') +
    '<div class="kv"><span class="k">状态</span><span class="v" style="color:' + (isInstalled ? '#6ee7b7' : '#fcd34d') + '">' + (isInstalled ? '已安装' : '未安装') + '</span></div>' +
    '<div class="detail-actions">' +
    (!isInstalled && remote ? '<button class="btn primary" id="btnInstallVersion">下载并安装</button>' : '') +
    (isInstalled ? '<button class="btn ghost" id="btnVerifyVersion">无头验证</button>' : '') +
    (isInstalled ? '<button class="btn ghost" id="btnLaunchVersion">启动此版本</button>' : '') +
    '</div>';
  const bInst = $('btnInstallVersion');
  if (bInst) bInst.onclick = () => installVersion(remote, bInst);
  const bVer = $('btnVerifyVersion');
  if (bVer) bVer.onclick = () => { $('selVersion').value = v.id; doVerify(); };
  const bLaunch = $('btnLaunchVersion');
  if (bLaunch) bLaunch.onclick = () => { $('selVersion').value = v.id; switchView('home'); setTimeout(doLaunch, 120); };
}

async function installVersion(entry, btn) {
  if (!entry) return;
  if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
  toast('开始安装 ' + entry.id, 'info');
  try {
    const res = await API.downloadVersion({ entry: entry, source: S.source });
    if (!res.ok) {
      toast('安装失败：' + res.error, 'error', 6000);
      if (btn) { btn.disabled = false; btn.textContent = '下载并安装'; }
      return;
    }
    toast(res.versionId + ' 安装完成', 'success');
    await refreshLocalVersions();
    renderVersionDetail(S.selectedVersion);
    renderVersionList();
    updateStats();
  } catch (e) {
    toast('安装异常：' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '下载并安装'; }
  }
}

async function refreshLocalVersions() {
  try { S.localVersions = await API.versionsLocal(); populateVersionSelect(); } catch (e) { /* noop */ }
}

function populateVersionSelect() {
  const sel = $('selVersion');
  const prev = sel.value;
  const opts = [];
  if (S.localVersions.length) {
    opts.push('<option value="">— 选择已安装版本 —</option>');
    for (const v of S.localVersions) opts.push('<option value="' + esc(v.id) + '">' + esc(v.id) + (v.hasJar ? '' : '（缺 JAR）') + '</option>');
  } else {
    opts.push('<option value="">— 暂无已安装版本，请先在版本库下载 —</option>');
  }
  sel.innerHTML = opts.join('');
  if (prev && S.localVersions.some((v) => v.id === prev)) sel.value = prev;
  else if (S.localVersions.length) sel.value = S.localVersions[0].id;
}

function updateStats() {
  $('statVersions').textContent = S.versions.length || '—';
  $('statLocal').textContent = S.localVersions.length || 0;
  $('statJava').textContent = S.javas.length || 0;
}

async function runSpeedTest() {
  toast('开始测速…', 'info');
  const res = await API.sourceTest();
  renderSpeedResults(res.results);
  const best = res.results.find((r) => r.ok);
  if (best) toast('最快渠道：' + best.name + '（' + best.ms + 'ms）', 'success');
  else toast('所有渠道均不可用', 'error');
  return res;
}

function renderSpeedResults(results) {
  if (!results || !results.length) { $('speedResults').innerHTML = ''; return; }
  const max = Math.max.apply(null, results.map((r) => r.ms).concat([1]));
  $('speedResults').innerHTML = results.map((r) =>
    '<div class="speed-row"><span style="width:86px">' + esc(r.name) + '</span>' +
    '<div class="speed-bar"><div class="speed-fill ' + (r.ok ? '' : 'err') + '" style="width:' + (r.ok ? Math.max(8, 100 - (r.ms / max) * 80) : 100) + '%"></div></div>' +
    '<span style="width:66px;text-align:right">' + (r.ok ? r.ms + 'ms' : '失败') + '</span></div>').join('');
}

function renderSourceCards() {
  const box = $('sourceCards');
  if (!box) return;
  box.innerHTML = S.sources.map((s) =>
    '<div class="source-card ' + (S.source === s.id ? 'active' : '') + '" data-src="' + esc(s.id) + '">' +
    '<span class="src-dot" style="background:' + esc(s.color) + ';color:' + esc(s.color) + '"></span>' +
    '<div class="src-info"><div class="src-name">' + esc(s.name) + '</div><div class="src-desc">' + esc(s.desc) + '</div></div></div>').join('');
  $$('#sourceCards .source-card').forEach((card) => {
    card.onclick = async () => {
      S.source = card.dataset.src;
      await API.configSet({ source: S.source });
      updateSourceUI();
      S.manifest = null;
      loadManifest(true);
      const s = S.sources.find((x) => x.id === S.source) || {};
      toast('已切换渠道：' + s.name, 'success');
    };
  });
}

function bindLoaderEvents() {
  $('loaderTabs').onclick = (e) => {
    const tab = e.target.closest('.loader-tab');
    if (!tab) return;
    $$('#loaderTabs .loader-tab').forEach((t) => t.classList.toggle('active', t === tab));
    S.currentLoader = tab.dataset.loader;
    S.loaderVersions = [];
    $('selLoaderVersion').innerHTML = '<option value="">请点击「加载」获取版本</option>';
  };
  $('btnLoadLoaderVersions').onclick = loadLoaderVersions;
  $('btnInstallLoader').onclick = installLoader;
}

function refreshLoaderMcVersions() {
  const sel = $('selLoaderMc');
  const prev = sel.value;
  const base = S.localVersions.filter((v) => !/^(fabric|forge|neoforge|quilt)/i.test(v.id));
  const list = base.length ? base : S.localVersions;
  sel.innerHTML = list.length
    ? list.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.id) + '</option>').join('')
    : '<option value="">— 请先安装基础游戏版本 —</option>';
  if (prev && list.some((v) => v.id === prev)) sel.value = prev;
}

async function loadLoaderVersions() {
  const mc = $('selLoaderMc').value;
  if (!mc) { toast('请先安装基础游戏版本', 'warn'); return; }
  $('loaderStatus').textContent = '加载加载器版本列表…';
  $('loaderStatus').className = 'launch-status';
  const res = await API.loaderList(S.currentLoader, mc);
  if (!res.ok) {
    $('loaderStatus').textContent = '加载失败：' + res.error;
    $('loaderStatus').className = 'launch-status err';
    return;
  }
  S.loaderVersions = res.items || [];
  $('selLoaderVersion').innerHTML = S.loaderVersions.length
    ? S.loaderVersions.map((it) => '<option value="' + esc(it.version) + '">' + esc(it.version) + (it.stable === false ? '（不稳定）' : '') + '</option>').join('')
    : '<option value="">无可用版本</option>';
  $('loaderStatus').textContent = '共 ' + S.loaderVersions.length + ' 个版本';
  $('loaderStatus').className = 'launch-status ok';
}

async function installLoader() {
  const mc = $('selLoaderMc').value;
  const version = $('selLoaderVersion').value;
  if (!mc) { toast('请先安装基础游戏版本', 'warn'); return; }
  if (!version) { toast('请选择加载器版本', 'warn'); return; }
  const btn = $('btnInstallLoader');
  btn.disabled = true;
  $('loaderStatus').textContent = '正在安装 ' + S.currentLoader + ' ' + version + ' …';
  $('loaderStatus').className = 'launch-status';
  try {
    const res = await API.loaderInstall({ loader: S.currentLoader, mcVersion: mc, version: version });
    if (!res.ok) {
      $('loaderStatus').textContent = '安装失败：' + res.error;
      $('loaderStatus').className = 'launch-status err';
      toast('加载器安装失败：' + res.error, 'error', 6000);
      return;
    }
    $('loaderStatus').textContent = '安装完成：' + (res.versionId || '');
    $('loaderStatus').className = 'launch-status ok';
    toast(S.currentLoader + ' 安装完成', 'success');
    await refreshLocalVersions();
    refreshLoaderMcVersions();
    updateStats();
  } catch (e) {
    $('loaderStatus').textContent = '安装异常：' + e.message;
    $('loaderStatus').className = 'launch-status err';
  } finally {
    btn.disabled = false;
  }
}

function bindJavaEvents() {
  $('btnDetectJava').onclick = detectJava;
  $('btnListAdoptium').onclick = listAdoptium;
  $('btnListMojang').onclick = listMojang;
  $('javaSourceTabs').onclick = (e) => {
    const tab = e.target.closest('.tab-mini');
    if (!tab) return;
    $$('#javaSourceTabs .tab-mini').forEach((t) => t.classList.toggle('active', t === tab));
    const pane = tab.dataset.src;
    $('paneAdoptium').style.display = pane === 'adoptium' ? '' : 'none';
    $('paneMojang').style.display = pane === 'mojang' ? '' : 'none';
  };
}

async function detectJava() {
  $('javaList').innerHTML = '<div class="empty-state">正在检测系统 Java…</div>';
  try {
    S.javas = await API.javaDetect();
    renderJavaList(); populateJavaSelect(); updateStats();
  } catch (e) {
    $('javaList').innerHTML = '<div class="empty-state">检测失败：' + esc(e.message) + '</div>';
  }
}

function renderJavaList() {
  const box = $('javaList');
  $('javaCount').textContent = S.javas.length;
  if (!S.javas.length) { box.innerHTML = '<div class="empty-state">未找到 Java，请从右侧下载</div>'; return; }
  box.innerHTML = S.javas.map((j) =>
    '<div class="java-item"><div class="java-badge">' + esc(j.major || '?') + '</div>' +
    '<div class="java-info"><div class="java-ver">Java ' + esc(j.version) +
    (j.managed ? ' <span class="tag managed">启动器安装</span>' : ' <span class="tag">系统</span>') + '</div>' +
    '<div class="java-path" title="' + esc(j.path) + '">' + esc(j.path) + '</div></div></div>').join('');
}

function populateJavaSelect() {
  const sel = $('selJava');
  const prev = sel.value;
  sel.innerHTML = '<option value="">自动选择（推荐）</option>' +
    S.javas.map((j) => '<option value="' + esc(j.path) + '">Java ' + esc(j.version) + ' — ' + esc(j.path) + '</option>').join('');
  if (prev && S.javas.some((j) => j.path === prev)) sel.value = prev;
}

async function listAdoptium() {
  const major = Number($('selAdoptiumMajor').value);
  const type = $('selAdoptiumType').value;
  $('adoptiumList').innerHTML = '<div class="empty-state">查询 Adoptium ' + major + ' ' + type.toUpperCase() + '…</div>';
  const res = await API.javaListAdoptium(major, type);
  if (!res.ok) { $('adoptiumList').innerHTML = '<div class="empty-state">查询失败：' + esc(res.error) + '</div>'; return; }
  if (!res.items.length) { $('adoptiumList').innerHTML = '<div class="empty-state">没有可用版本</div>'; return; }
  $('adoptiumList').innerHTML = res.items.map((it, idx) =>
    '<div class="java-item"><div class="java-badge">' + esc(it.major) + '</div>' +
    '<div class="java-info"><div class="java-ver">' + esc(it.name) + ' <span class="tag">' + esc(String(it.imageType || '').toUpperCase()) + '</span></div>' +
    '<div class="java-path">' + esc(it.semver || '') + ' · ' + esc(fmtBytes(it.size)) + '</div></div>' +
    '<button class="mini-btn" data-adoptium="' + idx + '">下载</button></div>').join('');
  $$('#adoptiumList [data-adoptium]').forEach((btn) => {
    btn.onclick = () => installAdoptium(res.items[Number(btn.dataset.adoptium)], btn);
  });
}

async function installAdoptium(item, btn) {
  btn.disabled = true; btn.textContent = '下载中';
  toast('开始下载 ' + item.name, 'info');
  const res = await API.javaInstallAdoptium(item);
  btn.disabled = false; btn.textContent = '下载';
  if (!res.ok) { toast('下载失败：' + res.error, 'error', 6000); return; }
  toast('Java ' + res.version + ' 安装完成', 'success');
  await detectJava();
}

async function listMojang() {
  $('mojangList').innerHTML = '<div class="empty-state">加载 Mojang 运行时…</div>';
  const res = await API.javaListMojang();
  if (!res.ok) { $('mojangList').innerHTML = '<div class="empty-state">加载失败：' + esc(res.error) + '</div>'; return; }
  if (!res.items.length) { $('mojangList').innerHTML = '<div class="empty-state">没有适用于本平台的运行时</div>'; return; }
  const seen = new Set();
  const items = res.items.filter((it) => { const k = it.component + it.name; if (seen.has(k)) return false; seen.add(k); return true; });
  $('mojangList').innerHTML = items.map((it, idx) => {
    const num = (it.component.match(/(\d+)$/) || [])[1] || 'J';
    return '<div class="java-item"><div class="java-badge">' + esc(num) + '</div>' +
      '<div class="java-info"><div class="java-ver">' + esc(it.component) + ' <span class="tag">' + esc(it.name) + '</span></div>' +
      '<div class="java-path">' + esc(fmtDate(it.released)) + '</div></div>' +
      '<button class="mini-btn" data-mojang="' + idx + '">下载</button></div>';
  }).join('');
  $$('#mojangList [data-mojang]').forEach((btn) => {
    btn.onclick = () => installMojang(items[Number(btn.dataset.mojang)], btn);
  });
}

async function installMojang(entry, btn) {
  btn.disabled = true; btn.textContent = '下载中';
  toast('开始下载 ' + entry.component + ' ' + entry.name, 'info');
  const res = await API.javaInstallMojang(entry);
  btn.disabled = false; btn.textContent = '下载';
  if (!res.ok) { toast('下载失败：' + res.error, 'error', 6000); return; }
  toast('Java ' + res.version + ' 安装完成', 'success');
  await detectJava();
}

function bindInstanceEvents() {
  $('btnCreateInstance').onclick = async () => {
    const name = $('inpNewInstance').value.trim();
    await API.instancesCreate(name || undefined);
    $('inpNewInstance').value = '';
    await loadInstances();
    toast('实例已创建', 'success');
  };
}

async function loadInstances() {
  S.instances = await API.instancesList();
  renderInstanceSelect();
  renderInstances();
  populateVersionSelect();
}

function renderInstanceSelect() {
  const sel = $('selInstance');
  const prev = sel.value || S.cfg.selectedInstance;
  sel.innerHTML = '<option value="">（不使用实例）</option>' +
    S.instances.map((i) => '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('');
  if (prev && S.instances.some((i) => i.id === prev)) sel.value = prev;
}

function renderInstances() {
  const box = $('instancesGrid');
  if (!box) return;
  if (!S.instances.length) { box.innerHTML = '<div class="empty-state">还没有实例</div>'; return; }
  const versionOpts = (sel) => S.localVersions.map((v) => '<option value="' + esc(v.id) + '" ' + (v.id === sel ? 'selected' : '') + '>' + esc(v.id) + '</option>').join('');
  const javaOpts = (sel) => '<option value="">自动</option>' + S.javas.map((j) => '<option value="' + esc(j.path) + '" ' + (j.path === sel ? 'selected' : '') + '>Java ' + esc(j.major || j.version) + '</option>').join('');
  box.innerHTML = S.instances.map((i) =>
    '<div class="inst-card" data-inst="' + esc(i.id) + '" style="--inst-color:' + esc(i.iconColor || '#6366f1') + '">' +
    '<div class="inst-head"><span class="inst-name">' + esc(i.name) + '</span>' +
    '<button class="inst-close" data-del="' + esc(i.id) + '" title="删除实例"><svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>' +
    '<div class="inst-fields">' +
    '<div class="inst-field"><label>版本</label><select class="input" data-field="version">' + versionOpts(i.version) + '</select></div>' +
    '<div class="inst-field"><label>Java</label><select class="input" data-field="javaPath">' + javaOpts(i.javaPath) + '</select></div>' +
    '<div class="inst-field"><label>内存</label><input class="input small" type="number" data-field="minMemory" value="' + (i.minMemory || 1024) + '" step="256"><span class="unit">–</span>' +
    '<input class="input small" type="number" data-field="maxMemory" value="' + (i.maxMemory || 4096) + '" step="256"><span class="unit">MB</span></div>' +
    '<div class="inst-field"><label>窗口</label><input class="input small" type="number" data-field="width" value="' + (i.width || 854) + '"><span class="unit">×</span>' +
    '<input class="input small" type="number" data-field="height" value="' + (i.height || 480) + '"></div>' +
    '</div>' +
    '<div class="inst-foot"><button class="mini-btn" data-play="' + esc(i.id) + '">启动</button><button class="mini-btn" data-save="' + esc(i.id) + '">保存</button></div></div>').join('');

  $$('#instancesGrid [data-del]').forEach((b) => {
    b.onclick = async () => { await API.instancesRemove(b.dataset.del); await loadInstances(); toast('实例已删除', 'warn'); };
  });
  $$('#instancesGrid [data-save]').forEach((b) => { b.onclick = async () => saveInstance(b.dataset.save); });
  $$('#instancesGrid [data-play]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.play;
      await saveInstance(id);
      const inst = S.instances.find((i) => i.id === id);
      switchView('home');
      $('selInstance').value = id;
      if (inst && inst.version) $('selVersion').value = inst.version;
      setTimeout(doLaunch, 150);
    };
  });
}

async function saveInstance(id) {
  const card = document.querySelector('[data-inst="' + id + '"]');
  if (!card) return;
  const val = (f) => { const el = card.querySelector('[data-field="' + f + '"]'); return el ? el.value : undefined; };
  await API.instancesUpdate(id, {
    version: val('version'), javaPath: val('javaPath'),
    minMemory: Number(val('minMemory')) || 1024, maxMemory: Number(val('maxMemory')) || 4096,
    width: Number(val('width')) || 854, height: Number(val('height')) || 480,
  });
  await loadInstances();
  toast('实例已保存', 'success');
}

function bindSettingsEvents() {
  $('btnSaveSettings').onclick = async () => {
    S.cfg = await API.configSet({
      threads: Math.max(1, Math.min(32, Number($('setThreads').value) || 16)),
      minecraftDir: $('setGameDir').value.trim(),
      jvmArgs: $('setJvmArgs').value.trim(),
      gameArgs: $('setGameArgs').value.trim(),
      width: Number($('setWidth').value) || 854,
      height: Number($('setHeight').value) || 480,
      javaPath: $('setJavaPath').value.trim(),
      autoJava: $('setAutoJava').checked,
    });
    toast('设置已保存', 'success');
    pushLog({ level: 'success', message: '设置已保存' });
  };
  $('btnPickGameDir').onclick = async () => { const dir = await API.pickDir(); if (dir) $('setGameDir').value = dir; };
  $('btnPickJava').onclick = async () => { const p = await API.pickFile(); if (p) $('setJavaPath').value = p; };
  $('btnClearCache').onclick = async () => {
    const r = await API.clearCache();
    toast(r.ok ? '缓存已清空' : '清空失败：' + r.error, r.ok ? 'success' : 'error');
  };
  $$('[data-open]').forEach((b) => { b.onclick = () => API.openPath(b.dataset.open); });
}

async function loadSizes() {
  try {
    const s = await API.sizes();
    $('sizeList').innerHTML = [['游戏目录总计', s.game], ['库文件', s.libraries], ['资源文件', s.assets], ['Java 运行时', s.java]]
      .map((r) => '<div class="size-row"><span class="k">' + r[0] + '</span><span class="v">' + fmtBytes(r[1]) + '</span></div>').join('');
  } catch (e) { $('sizeList').innerHTML = '<div class="empty-state">统计失败</div>'; }
  const info = S.info || {};
  const about = [
    ['启动器版本', info.version], ['Electron', info.electron], ['Node', info.node], ['Chromium', info.chrome],
    ['平台', info.platform + ' ' + info.arch],
    ['游戏目录', info.paths && info.paths.gameDir], ['启动器目录', info.paths && info.paths.launcherRoot],
  ];
  $('aboutList').innerHTML = about.map((r) =>
    '<div class="about-row"><span class="k">' + esc(r[0]) + '</span><span class="v" title="' + esc(r[1]) + '">' + esc(r[1]) + '</span></div>').join('');
}

/* =========================================================
 * 资源中心（Modrinth）
 * =======================================================*/
const storeState = { items: [], loading: false, inited: false, kind: 'mod', gameVersion: '1.20.1', loader: '' };

function storeKindLabel(kind) {
  return ({ mod: '模组', shader: '光影', resourcepack: '资源包', modpack: '整合包', zhcn: '汉化包' })[kind] || '资源';
}

function fmtDownloads(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return String(v);
}

function initStore() {
  if (storeState.inited) return;
  storeState.inited = true;

  const verInput = $('storeVersion');
  const firstLocal = (S.local && S.local[0] && (S.local[0].id || S.local[0].version)) || '1.20.1';
  if (verInput && !verInput.value) verInput.value = firstLocal;
  storeState.gameVersion = (verInput && verInput.value) || '1.20.1';

  $('btnStoreSearch').onclick = () => runStoreSearch();
  $('storeQuery').onkeydown = (e) => { if (e.key === 'Enter') runStoreSearch(); };
  $('storeKind').onchange = () => { storeState.kind = $('storeKind').value; runStoreSearch(); };
  $('storeLoader').onchange = () => { storeState.loader = $('storeLoader').value; runStoreSearch(); };
  $('btnStoreHelp').onclick = showStoreHelp;
  $('storeGrid').onclick = onStoreGridClick;

  runStoreSearch();
}

function showStoreHelp() {
  modal('资源来源说明', `
    <ul class="help-list">
      <li><b>模组 / 光影 / 资源包 / 整合包</b>：来自 Modrinth 公共 API，无需密钥，可直接下载安装到当前游戏目录。</li>
      <li><b>中文汉化包</b>：以「汉化 / 简体中文 / Chinese translation」检索社区汉化资源包，安装到 resourcepacks。</li>
      <li><b>MCBBS</b> 已于 2024 年关停，域名无法解析，无法作为下载源。</li>
      <li><b>MC百科</b> 无公开下载 API；点击「MC百科」按钮会打开其搜索页，用于查中文译名与资料。</li>
      <li>光影需搭配 Iris（Fabric/Quilt）或 OptiFine（Forge）才能生效。</li>
    </ul>`);
}

async function runStoreSearch() {
  if (storeState.loading) return;
  const kindSel = $('storeKind').value;
  const rawQuery = $('storeQuery').value.trim();
  const gameVersion = ($('storeVersion').value || '').trim();
  const loader = $('storeLoader').value;
  storeState.kind = kindSel;
  storeState.loader = loader;
  storeState.gameVersion = gameVersion || '1.20.1';

  if (kindSel === 'zhcn' && !rawQuery) $('storeQuery').value = '汉化';
  const effectiveQuery = (kindSel === 'zhcn' && !rawQuery) ? '汉化' : rawQuery;

  storeState.loading = true;
  $('storeCount').textContent = '搜索中…';
  $('storeGrid').innerHTML = '<div class="store-loading">正在从 Modrinth 获取资源…</div>';
  $('storeEmpty').classList.add('hidden');

  try {
    const res = await API.storeSearch({
      kind: kindSel,
      query: effectiveQuery,
      gameVersion: kindSel === 'shader' ? '' : gameVersion,
      loader: (kindSel === 'mod' || kindSel === 'modpack') ? loader : '',
      limit: 24,
    });
    if (!res || !res.ok) throw new Error((res && res.error) || '搜索失败');
    storeState.items = res.items || [];
    $('storeCount').textContent = '共 ' + res.total + ' 个结果 · ' + storeKindLabel(kindSel) + (gameVersion ? ' · ' + gameVersion : '');
    renderStoreGrid();
  } catch (e) {
    $('storeGrid').innerHTML = '';
    $('storeEmpty').classList.remove('hidden');
    $('storeCount').textContent = '搜索失败';
    toast('搜索失败：' + e.message, 'error');
  } finally {
    storeState.loading = false;
  }
}

function renderStoreGrid() {
  const g = $('storeGrid');
  if (!storeState.items.length) {
    g.innerHTML = '';
    $('storeEmpty').classList.remove('hidden');
    return;
  }
  $('storeEmpty').classList.add('hidden');
  g.innerHTML = storeState.items.map((it, i) => {
    const icon = it.icon ? '<img src="' + esc(it.icon) + '" alt="" loading="lazy">' : '<span>◇</span>';
    const tags = (it.categories || []).slice(0, 2).map((c) => '<span class="store-tag">' + esc(c) + '</span>').join('');
    return '<article class="store-card">'
      + '<div class="store-icon">' + icon + '</div>'
      + '<div class="store-body">'
      + '<div class="store-title" title="' + esc(it.title) + '">' + esc(it.title) + '</div>'
      + '<div class="store-desc">' + esc(it.description || '') + '</div>'
      + '<div class="store-meta"><span class="store-dl">↓ ' + fmtDownloads(it.downloads) + '</span>' + tags + '</div>'
      + '<div class="store-actions">'
      + '<button class="btn btn-secondary btn-sm" data-store-install="' + i + '">安装</button>'
      + '<button class="btn ghost btn-sm" data-store-mcmod="' + i + '">MC百科</button>'
      + '</div></div></article>';
  }).join('');
}

async function onStoreGridClick(e) {
  const modBtn = e.target.closest('[data-store-mcmod]');
  if (modBtn) {
    const it = storeState.items[Number(modBtn.dataset.storeMcmod)];
    if (it) await API.storeMcmod(it.title);
    return;
  }
  const instBtn = e.target.closest('[data-store-install]');
  if (!instBtn) return;
  const it = storeState.items[Number(instBtn.dataset.storeInstall)];
  if (it) await installStoreItem(it, instBtn);
}

async function installStoreItem(it, btn) {
  const kind = storeState.kind;
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '安装中…';
  try {
    let res;
    if (kind === 'modpack') {
      res = await API.storeInstallModpack({ slug: it.slug, gameVersion: storeState.gameVersion });
      if (res && res.ok) {
        toast('整合包「' + res.name + '」已安装到 ' + res.instanceDir, 'success', 8000);
      }
    } else {
      res = await API.storeInstall({
        kind: kind === 'zhcn' ? 'resourcepack' : kind,
        slug: it.slug,
        gameVersion: storeState.gameVersion,
        loader: storeState.loader,
      });
      if (res && res.ok) {
        toast(res.label + '「' + it.title + '」已安装：' + res.file, 'success', 6000);
      }
    }
    if (!res || !res.ok) throw new Error((res && res.error) || '安装失败');
  } catch (err) {
    toast('安装失败：' + err.message, 'error', 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => { console.error(e); toast('初始化失败：' + e.message, 'error', 8000); });
});
