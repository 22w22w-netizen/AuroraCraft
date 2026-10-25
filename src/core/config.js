'use strict';
const fs = require('fs');
const path = require('path');
const { launcherRoot } = require('./paths');
const DEFAULTS = {
  source: 'auto', threads: 16, minecraftDir: '', username: 'Player', javaPath: '',
  autoJava: true, minMemory: 1024, maxMemory: 4096, jvmArgs: '', gameArgs: '',
  width: 1280, height: 720, fullscreen: false, selectedInstance: '', customSource: '',
  closeAfterLaunch: false, showLogs: true, showSnapshots: false, instances: [],
};
function configFile() { return path.join(launcherRoot(), 'config.json'); }
function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, '')) }; }
  catch (_) { return { ...DEFAULTS }; }
}
function save(cfg) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function set(key, val) {
  const cfg = load();
  if (typeof key === 'object' && key) Object.assign(cfg, key); else cfg[key] = val;
  save(cfg); return cfg;
}
module.exports = { DEFAULTS, load, save, get: (key) => key ? load()[key] : load(), set, configFile };