'use strict';

/**
 * 账户管理：离线登录 + 微软账号登录（Xbox Live OAuth）
 */
const crypto = require('crypto');

/* ==================== 离线登录模块 ==================== */

function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + String(name), 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function validateUsername(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return { ok: false, message: '玩家名不能为空' };
  if (!/^[A-Za-z0-9_]{3,16}$/.test(s)) return { ok: false, message: '玩家名须为 3-16 位字母、数字或下划线' };
  return { ok: true, value: s };
}

function buildOfflineAccount(name) {
  const v = validateUsername(name);
  if (!v.ok) return { ok: false, message: v.message };
  const uuid = offlineUuid(v.value);
  return {
    ok: true,
    account: {
      type: 'offline',
      username: v.value,
      uuid,
      accessToken: 'offline-' + uuid.replace(/-/g, '').slice(0, 16),
      userType: 'legacy',
      xuid: '0',
    },
  };
}

/* ==================== 微软账号登录（Xbox Live OAuth）模块 ==================== */

/**
 * 获取 Microsoft OAuth 授权 URL
 */
function getMicrosoftAuthUrl(clientId = '00000000402b5328') {
  const scopes = ['XboxServices.managed.Sandbox', 'XboxServices.profile'];
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: encodeURI(scopes.join(' ')),
    redirect_uri: 'https://auth.minecraft.net/login',
    state: crypto.randomBytes(32).toString('hex'),
    response_mode: 'query',
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/consumers/oauth2/v2.0/auth?${params.toString()}`;
}

/**
 * 通过授权码换取 Microsoft Access Token
 */
async function getTokenFromCode(code, clientId = '00000000402b5328') {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    client_id: clientId,
    scope: 'XboxServices.managed.Sandbox MinecraftService',
    redirect_uri: 'https://auth.minecraft.net/login',
  });
  
  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    
    const data = await tokenRes.json();
    return { 
      microsoftAccessToken: data.access_token,
      microsoftRefreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (e) {
    throw new Error(`Token exchange error: ${e.message}`);
  }
}

/**
 * 使用 Microsoft Token 获取 Xbox Live XSTS Token
 */
async function getXblToken(authToken) {
  const payload = JSON.stringify({
    Properties: {
      AuthType: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `RPt=${authToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-SKU': 'UAP',
      'x-client-ver': '5.7.0.0',
      'Accept': 'application/json',
    },
    body: payload,
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`XBox Auth Failed (${res.status}): ${text}`);
  }
  
  return await res.json();
}

/**
 * 从 XSTS Token 获取 Minecraft 访问令牌
 */
async function getMinecraftToken(xstsResponse) {
  if (!xstsResponse?.Token) throw new Error('No XSTS token received');
  
  const proofToken = xstsResponse.Token;
  
  const mcPayload = JSON.stringify({
    identityToken: `openid;${proofToken}`
  });
  
  const mcRes = await fetch('https://api.minecraftservices.com/authentication/enterprise/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Minecraft-Distro-Product': 'launcher',
    },
    body: mcPayload,
  });
  
  if (!mcRes.ok) {
    const text = await mcRes.text();
    throw new Error(`Minecraft token exchange failed: ${mcRes.status} - ${text}`);
  }
  
  return await mcRes.json();
}

/**
 * 完整的微软账号登录流程
 */
async function loginWithMicrosoft(authorizationCode, clientId = '00000000402b5328') {
  const logSteps = [];
  
  logSteps.push('Step 1: Exchanging authorization code for Microsoft token');
  const msToken = await getTokenFromCode(authorizationCode, clientId);
  logSteps.push(`  ✓ Microsoft token obtained (expires in ${msToken.expiresIn}s)`);
  
  logSteps.push('Step 2: Requesting XSTS authentication token from Xbox Live');
  const xsts = await getXblToken(msToken.microsoftAccessToken);
  logSteps.push(`  ✓ XSTS token obtained`);
  
  logSteps.push('Step 3: Exchanging XSTS token for Minecraft service token');
  const mcData = await getMinecraftToken(xsts);
  logSteps.push(`  ✓ Minecraft access token obtained`);
  
  // 拉取用户资料
  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { 'Authorization': `Bearer ${mcData.accessToken}` },
  });
  
  if (profileRes.ok) {
    const profile = await profileRes.json();
    return {
      ok: true,
      account: {
        type: 'microsoft',
        accessToken: mcData.accessToken,
        username: profile.name,
        uuid: profile.id,
        userType: 'premium',
        selectedProfile: { id: profile.id, name: profile.name },
      },
      steps: logSteps,
    };
  } else {
    throw new Error(`Failed to fetch Minecraft profile: ${profileRes.status}`);
  }
}

module.exports = {
  offlineUuid,
  validateUsername,
  buildOfflineAccount,
  getMicrosoftAuthUrl,
  getTokenFromCode,
  getXblToken,
  getMinecraftToken,
  loginWithMicrosoft,
};