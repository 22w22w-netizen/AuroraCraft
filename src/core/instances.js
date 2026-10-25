'use strict';

/**
 * 多实例（配置档）管理
 * 每个实例拥有独立名称、游戏版本、Java、内存、窗口尺寸、Mod 加载器等
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { launcherRoot } = require('./paths');
const { readJsonSafe, writeJsonSafe } = require('./http');

function instancesFile() {
  return path.join(launcherRoot(), 'instances.json');
}

function defaults(name) {
  return {
    id: 'inst-' + crypto.randomBytes(4).toString('hex'),
    name: name || '新实例',
    version: '',
    gameDir: '',
    javaPath: '',
    minMemory: 1024,
    maxMemory: 4096,
    jvmArgs: '',
    gameArgs: '',
    width: 854,
    height: 480,
    fullscreen: false,
    mods: [],
    serverAddress: '',
    serverPort: '',
    iconColor: '#3b82f6',
    created: Date.now(),
    lastPlayed: 0,
    totalPlaytime: 0,
  };
}

function load() {
  const data = readJsonSafe(instancesFile());
  if (data && Array.isArray(data.instances)) return data.instances;
  return [];
}

function save(list) {
  writeJsonSafe(instancesFile(), { instances: list });
  return list;
}

function list() {
  let items = load();
  if (items.length === 0) {
    const first = defaults('默认实例');
    items = [first];
    save(items);
  }
  return items;
}

function create(name) {
  const items = list();
  const inst = defaults(name || '实例 ' + (items.length + 1));
  items.push(inst);
  save(items);
  return inst;
}

function update(id, patch) {
  const items = list();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error('实例不存在: ' + id);
  items[idx] = { ...items[idx], ...patch, id };
  save(items);
  return items[idx];
}

function remove(id) {
  const items = list().filter((i) => i.id !== id);
  save(items);
  return items;
}

function get(id) {
  return list().find((i) => i.id === id) || null;
}

module.exports = { instancesFile, defaults, load, save, list, create, update, remove, get };
