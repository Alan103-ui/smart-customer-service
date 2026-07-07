'use strict';
/**
 * 致远 OA（seeyon / A8）REST 客户端
 * ---------------------------------------------------------------
 * 该 OA 版本（V8_1SP1）实际可用的接口仅有以下三个（已实测）：
 *   1) 获取 Token : GET  {baseUrl}/seeyon/rest/token/{username}/{secret}
 *                     -> 响应体为纯文本 UUID（非 JSON）
 *   2) 组织架构   : GET  {baseUrl}/seeyon/rest/orgAccounts?token={token}
 *                     -> JSON 数组，元素为组织单位（集团 / 公司）
 *   3) 人员信息   : GET  {baseUrl}/seeyon/rest/orgMembers/{id}?token={token}
 *                     -> JSON 数组，取 [0] 为人员对象
 *  注意：该版本不支持 orgMembers 的 GET 列表查询（?orgAccountId= 会返回异常页面），
 *        批量人员需由调用方按需逐个查询。
 *
 * 配置来源：环境变量优先，其次 data/oa-config.json（本地文件，已被 .gitignore 排除，不入库）。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
// 致远 OA 的 id 为超长整数（如 -5476327415902942726），超出 JS 安全整数范围，
// 用 json-bigint 解析并 storeAsString，避免 JSON.parse 转 Number 时精度丢失。
const JSONBig = require('json-bigint')({ storeAsString: true });

const OA_CONFIG_PATH = path.join(__dirname, '../data/oa-config.json');

// ============ 配置读写 ============
function loadOAConfig() {
  const env = {
    enabled: process.env.OA_ENABLED === '1',
    baseUrl: process.env.OA_BASE_URL || '',
    username: process.env.OA_API_USERNAME || '',
    secret: process.env.OA_API_SECRET || '',
    fixedToken: process.env.OA_TOKEN || '',
  };
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(OA_CONFIG_PATH, 'utf8')) || {};
  } catch (e) {
    local = {};
  }
  return {
    enabled: env.enabled || !!local.enabled,
    baseUrl: env.baseUrl || local.baseUrl || '',
    username: env.username || local.username || '',
    secret: env.secret || local.secret || '',
    fixedToken: env.fixedToken || local.fixedToken || '',
  };
}

function saveOAConfig(cfg) {
  const safe = {
    enabled: !!cfg.enabled,
    baseUrl: (cfg.baseUrl || '').trim(),
    username: (cfg.username || '').trim(),
    secret: cfg.secret || '',
    fixedToken: cfg.fixedToken || '',
  };
  fs.writeFileSync(OA_CONFIG_PATH, JSON.stringify(safe, null, 2));
  return safe;
}

// 凭证脱敏：仅展示首尾，避免泄露
function maskCredential(t) {
  if (!t) return '';
  if (t.length <= 8) return '********';
  return t.slice(0, 8) + '****' + t.slice(-4);
}

// ============ 底层 HTTP ============
function requestText(urlStr, { timeout = 15000, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('非法 URL: ' + urlStr));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { Accept: 'application/json' },
      timeout,
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const status = res.statusCode;
        if (status < 200 || status >= 300) {
          return reject(new Error('OA HTTP ' + status));
        }
        resolve(data);
      });
    });
    req.on('error', (e) => reject(new Error('OA 网络错误: ' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OA 请求超时'));
    });
    req.end();
  });
}

// 解析 OA 返回：检测异常 HTML 页面，解析 JSON
function parseOAJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('OA 返回为空');
  if (trimmed.startsWith('<')) throw new Error('OA 返回异常页面（接口不可用或参数错误）');
  try {
    return JSONBig.parse(trimmed);
  } catch (e) {
    throw new Error('OA 返回非 JSON: ' + trimmed.slice(0, 80));
  }
}

// ============ Token 管理 ============
let tokenCache = { token: null, ts: 0 };
const TOKEN_TTL = 50 * 60 * 1000; // 50 分钟，留余量防过期

async function getToken(force = false) {
  const cfg = loadOAConfig();
  // 固定 token 优先（配置中已存在且未强制刷新）
  if (cfg.fixedToken && !force) return cfg.fixedToken;
  // 内存缓存
  if (tokenCache.token && !force && Date.now() - tokenCache.ts < TOKEN_TTL) {
    return tokenCache.token;
  }
  if (!cfg.baseUrl || !cfg.username || !cfg.secret) {
    throw new Error('OA 未配置（缺少 baseUrl / username / secret）');
  }
  const url = `${cfg.baseUrl}/seeyon/rest/token/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.secret)}`;
  const text = await requestText(url);
  const trimmed = text.trim();
  let token = '';
  // 致远 OA 的 token 接口：Accept 为 application/json 时返回 {id: "uuid", ...}，
  // 否则返回纯文本 uuid。两种都兼容。
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      token = j.id || j.token || j.ticket || j.accessToken || '';
    } catch (e) {
      /* 解析失败时退回纯文本处理 */
    }
  }
  if (!token) token = trimmed;
  if (!token) throw new Error('OA 返回空 token');
  tokenCache = { token, ts: Date.now() };
  return token;
}

// 清除 token 缓存（配置变更后调用）
function clearTokenCache() {
  tokenCache = { token: null, ts: 0 };
}

// ============ 组织架构 ============
async function getOrgAccounts() {
  const token = await getToken();
  const url = `${loadOAConfig().baseUrl}/seeyon/rest/orgAccounts?token=${encodeURIComponent(token)}`;
  const data = await requestText(url);
  const arr = parseOAJson(data);
  if (!Array.isArray(arr)) throw new Error('orgAccounts 返回格式异常');
  return arr.map((m) => ({
    oaId: String(m.id),
    name: m.name || '',
    shortName: m.shortName || '',
    code: m.code || '',
    isGroup: !!m.isGroup,
    // superior === -1 表示根节点
    parentId:
      m.superior !== undefined && m.superior !== null && m.superior !== -1
        ? String(m.superior)
        : null,
    path: m.path || '',
    enabled: m.enabled !== false,
    raw: m,
  }));
}

// ============ 人员 ============
async function getOrgMember(memberId) {
  if (memberId === undefined || memberId === null || String(memberId).trim() === '') {
    throw new Error('缺少人员 ID');
  }
  const token = await getToken();
  const url = `${loadOAConfig().baseUrl}/seeyon/rest/orgMembers/${encodeURIComponent(String(memberId))}?token=${encodeURIComponent(token)}`;
  const data = await requestText(url);
  const arr = parseOAJson(data);
  const m = Array.isArray(arr) ? arr[0] : null;
  if (!m) throw new Error('未找到该 OA 人员');
  const p = m.properties || {};
  return {
    oaId: String(m.id),
    oaAccountId: String(m.orgAccountId),
    name: m.name || '',
    code: m.code || '', // 工号
    orgDepartmentId: m.orgDepartmentId != null ? String(m.orgDepartmentId) : null,
    orgPostId: m.orgPostId != null ? String(m.orgPostId) : null,
    email: p.emailaddress || '',
    gender: p.gender,
    phone: p.telnumber || p.officenumber || '',
    isLoginable: !!m.isLoginable,
    enabled: m.enabled !== false,
    raw: m,
  };
}

// 将 OA 人员映射为系统 personnel 记录（不含密码，登录走 SSO 或管理员重置）
function oaMemberToPersonnel(m) {
  const username = (m.code && String(m.code).trim()) || 'oa_' + m.oaId;
  return {
    oaId: m.oaId,
    oaAccountId: m.oaAccountId,
    name: m.name,
    username,
    orgId: null,
    orgName: '',
    roleId: 'perm_003', // 默认普通用户
    roleName: '普通用户',
    email: m.email,
    phone: m.phone,
    isActive: m.enabled,
    source: 'oa',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
  };
}

module.exports = {
  loadOAConfig,
  saveOAConfig,
  maskCredential,
  getToken,
  clearTokenCache,
  getOrgAccounts,
  getOrgMember,
  oaMemberToPersonnel,
};
