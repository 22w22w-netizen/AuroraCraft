'use strict';

/**
 * 预加载脚本：通过 contextBridge 暴露受限 API
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function on(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  /* 窗口 */
  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onState: (cb) => on('window:state', cb),
  },

  /* 基础 */
  appInfo: () => invoke('app:info'),
  configGet: () => invoke('config:get'),
  configSet: (patch) => invoke('config:set', patch),
  pathsGet: () => invoke('paths:get'),
  pickDir: () => invoke('dialog:pickDir'),
  pickFile: (filters) => invoke('dialog:pickFile', filters),
  openPath: (p) => invoke('shell:openPath', p),
  openExternal: (url) => invoke('shell:openExternal', url),

  /* 渠道 */
  sourceTest: () => invoke('source:test'),
  sourcePickBest: () => invoke('source:pickBest'),

  /* 版本 */
  manifestGet: (source, opts) => invoke('manifest:get', source, opts),
  versionsLocal: () => invoke('versions:local'),
  downloadVersion: (payload) => invoke('download:version', payload),
  downloadTasks: (kind, payload) => invoke('download:tasks', kind, payload),

  /* Java */
  javaDetect: () => invoke('java:detect'),
  javaListAdoptium: (major, imageType) => invoke('java:listAdoptium', major, imageType),
  javaInstallAdoptium: (item) => invoke('java:installAdoptium', item),
  javaListMojang: () => invoke('java:listMojang'),
  javaInstallMojang: (entry) => invoke('java:installMojang', entry),
  javaEnsure: (versionId) => invoke('java:ensure', versionId),

  /* 加载器 */
  loaderList: (loader, mcVersion) => invoke('loader:list', loader, mcVersion),
  loaderInstall: (payload) => invoke('loader:install', payload),
  loaderRunInstaller: (payload) => invoke('loader:runInstaller', payload),

  /* 账户 */
  accountOffline: (username) => invoke('account:offline', username),
  accountUuid: (username) => invoke('account:uuid', username),
  accountMicrosoftAuthUrl: (clientId) => invoke('account:microsoftAuthUrl', clientId),
  accountLoginMicrosoft: (payload) => invoke('account:loginWithMicrosoft', payload),

  /* 资源中心 */
  storeSearch: (opts) => invoke('store:search', opts),
  storeVersions: (payload) => invoke('store:versions', payload),
  storeInstall: (payload) => invoke('store:install', payload),
  storeInstallModpack: (payload) => invoke('store:installModpack', payload),
  storeMcmod: (name) => invoke('store:mcmod', name),

  /* 实例 */
  instancesList: () => invoke('instances:list'),
  instancesCreate: (name) => invoke('instances:create', name),
  instancesUpdate: (id, patch) => invoke('instances:update', id, patch),
  instancesRemove: (id) => invoke('instances:remove', id),
  instancesGet: (id) => invoke('instances:get', id),

  /* 游戏 */
  gameLaunch: (options) => invoke('game:launch', options),
  gameVerify: (options) => invoke('game:verify', options),
  gameIsRunning: () => invoke('game:isRunning'),
  gameKill: () => invoke('game:kill'),

  /* 杂项 */
  clearCache: () => invoke('misc:clearCache'),
  sizes: () => invoke('misc:sizes'),

  /* 事件 */
  onLog: (cb) => on('log', cb),
  onDownloadProgress: (cb) => on('download:progress', cb),
  onDownloadStage: (cb) => on('download:stage', cb),
  onGameOutput: (cb) => on('game:output', cb),
  onGameExit: (cb) => on('game:exit', cb),
});
