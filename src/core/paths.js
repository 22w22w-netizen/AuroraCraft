'use strict';

/**
 * 极光启动器 (AuroraCraft Launcher) — 路径与常量
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_NAME = 'AuroraCraft';
const APP_VERSION = '1.0.0';
const LAUNCHER_BRAND = 'AuroraCraftLauncher';
const USER_AGENT = 'AuroraCraft-Launcher/1.0.0';

function launcherRoot() {
  if (process.env.AC_DATA_DIR && process.env.AC_DATA_DIR.trim()) {
    return path.resolve(process.env.AC_DATA_DIR.trim());
  }
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, '.auroracraft');
}

function resolveMinecraftDir() {
  const cfgFile = path.join(launcherRoot(), 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (cfg && typeof cfg.minecraftDir === 'string' && cfg.minecraftDir.trim()) {
      return path.resolve(cfg.minecraftDir.trim());
    }
  } catch (e) {
    /* 配置文件不存在时使用默认值 */
  }
  return path.join(launcherRoot(), 'minecraft');
}

function buildPaths(minecraftDir) {
  const gameDir = minecraftDir || resolveMinecraftDir();
  return {
    launcherRoot: launcherRoot(),
    gameDir,
    versionsDir: path.join(gameDir, 'versions'),
    librariesDir: path.join(gameDir, 'libraries'),
    assetsDir: path.join(gameDir, 'assets'),
    indexesDir: path.join(gameDir, 'assets', 'indexes'),
    objectsDir: path.join(gameDir, 'assets', 'objects'),
    nativesCacheDir: path.join(gameDir, 'natives-cache'),
    logConfigDir: path.join(gameDir, 'log_configs'),
    modsDir: path.join(gameDir, 'mods'),
    javaDir: path.join(launcherRoot(), 'java'),
    cacheDir: path.join(launcherRoot(), 'cache'),
    metaCacheDir: path.join(launcherRoot(), 'cache', 'meta'),
    configFile: path.join(launcherRoot(), 'config.json'),
    logDir: path.join(launcherRoot(), 'logs'),
  };
}

function ensureDirs(p) {
  const keys = ['gameDir', 'versionsDir', 'librariesDir', 'assetsDir', 'indexesDir', 'objectsDir', 'nativesCacheDir', 'logConfigDir', 'javaDir', 'metaCacheDir', 'logDir'];
  for (const k of keys) {
    try { fs.mkdirSync(p[k], { recursive: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = { APP_NAME, APP_VERSION, LAUNCHER_BRAND, USER_AGENT, launcherRoot, resolveMinecraftDir, buildPaths, ensureDirs };