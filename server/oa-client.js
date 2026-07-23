'use strict';
/**
 * 通用组织/人员 API 客户端
 * ----------------------------------------------------------------
 * 同时支持：
 *   1) 致远 OA（seeyon / A8）内置适配器 —— 默认、向后兼容
 *   2) generic 通用 REST 适配器 —— 通过配置端点、认证方式、字段映射对接主流 API
 *
 * 配置来源：环境变量优先，其次 data/oa-config.json（本地文件，已被 .gitignore 排除）。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
// 致远 OA 的 id 为超长整数，用 json-bigint 解析并 storeAsString，避免精度丢失。
const JSONBig = require('json-bigint')({ storeAsString: true });

const OA_CONFIG_PATH = path.join(__dirname, '../data/oa-config.json');

// ============ 缺省通用模板（当用户未配时给出示例结构） ============
function defaultGenericConfig() {
  return {
    authType: 'token_url',          // token_url | fixed_token | bearer | basic | api_key
    // token_url 模式专用
    tokenEndpoint: {
      method: 'GET',
      path: '/api/auth/token',
      query: {},
      body: {},
      headers: {},
      usernameField: 'username',
      passwordField: 'password',
      responsePath: 'token',        // 支持 a.b.c
    },
    // 固定 token / bearer / api_key 模式使用的静态凭证
    staticToken: '',
    apiKey: { headerName: 'X-API-Key', valuePrefix: '', in: 'header' }, // in: header | query
    basicAuth: { username: '', password: '' },

    // 业务端点模板：{accountId} / {token} / {page} / {size} 等占位符可用
    orgAccountsEndpoint: {
      method: 'GET',
      path: '/api/org/accounts',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data',         // 空字符串表示根
      paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 },
    },
    orgDepartmentsEndpoint: {
      method: 'GET',
      path: '/api/org/departments',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data',
      accountIdParam: 'accountId',
      paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 },
    },
    orgMembersEndpoint: {
      method: 'GET',
      path: '/api/org/members',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data',
      accountIdParam: 'accountId',
      paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 },
    },

    // 字段映射：左侧是系统所需字段名，右侧是远端响应字段名（支持 a.b.c）
    fieldMapping: {
      orgAccount: {
        id: 'id', name: 'name', code: 'code', shortName: 'shortName',
        isGroup: 'isGroup', parentId: 'parentId', enabled: 'enabled', path: 'path',
      },
      orgDepartment: {
        id: 'id', name: 'name', code: 'code', superior: 'superior',
        superiorName: 'superiorName', orgAccountId: 'orgAccountId',
        orgAccountName: 'orgAccountName', enabled: 'enabled', isDeleted: 'isDeleted',
      },
      member: {
        id: 'id', orgAccountId: 'orgAccountId', name: 'name', code: 'code',
        loginName: 'loginName', orgDepartmentId: 'orgDepartmentId', orgPostId: 'orgPostId',
        email: 'emailAddress', gender: 'gender', phone: 'phone',
        telNumber: 'telNumber', officeNum: 'officeNum',
        isLoginable: 'isLoginable', enabled: 'enabled', properties: 'properties',
      },
    },
  };
}

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
  const localSso = (local && local.sso) || {};
  const envSsoMode = process.env.OA_SSO_MODE;
  const envRequireSign = process.env.OA_SSO_REQUIRE_SIGN;
  const envSignSecret = process.env.OA_SSO_SECRET;
  const envTrustedIps = process.env.OA_SSO_TRUSTED_IPS;
  const sso = {
    mode: envSsoMode || localSso.mode || 'whitelist',
    requireSign: envRequireSign != null ? envRequireSign === '1' : !!localSso.requireSign,
    signSecret: envSignSecret || localSso.signSecret || '',
    trustedIps: envTrustedIps
      ? String(envTrustedIps).split(',').map(s => s.trim()).filter(Boolean)
      : (Array.isArray(localSso.trustedIps) ? localSso.trustedIps : []),
    whitelist: Array.isArray(localSso.whitelist) ? localSso.whitelist : [],
  };

  // generic 配置：合并默认值 + 本地存储
  const generic = Object.assign({}, defaultGenericConfig(), local.generic || {});

  return {
    enabled: env.enabled || !!local.enabled,
    baseUrl: env.baseUrl || local.baseUrl || '',
    username: env.username || local.username || '',
    secret: env.secret || local.secret || '',
    fixedToken: env.fixedToken || local.fixedToken || '',
    apiType: local.apiType || env.OA_API_TYPE || 'seeyon', // 'seeyon' | 'generic'
    generic,
    sso,
    orgDeptRule: local.orgDeptRule || {},
  };
}

function saveOAConfig(cfg) {
  const ssoIn = (cfg && cfg.sso) || {};
  const genericIn = (cfg && cfg.generic) || {};
  const safe = {
    enabled: !!cfg.enabled,
    baseUrl: (cfg.baseUrl || '').trim(),
    username: (cfg.username || '').trim(),
    secret: cfg.secret || '',
    fixedToken: cfg.fixedToken || '',
    apiType: cfg.apiType === 'generic' ? 'generic' : 'seeyon',
    generic: Object.assign({}, defaultGenericConfig(), genericIn),
    sso: {
      mode: ssoIn.mode === 'open' ? 'open' : 'whitelist',
      requireSign: !!ssoIn.requireSign,
      signSecret: ssoIn.signSecret || '',
      trustedIps: Array.isArray(ssoIn.trustedIps)
        ? ssoIn.trustedIps.map(String).map(s => s.trim()).filter(Boolean)
        : [],
      whitelist: Array.isArray(ssoIn.whitelist)
        ? ssoIn.whitelist.map(String).map(s => s.trim()).filter(Boolean)
        : [],
    },
    orgDeptRule: cfg.orgDeptRule || {},
  };
  fs.writeFileSync(OA_CONFIG_PATH, JSON.stringify(safe, null, 2));
  return safe;
}

// 凭证脱敏
function maskCredential(t) {
  if (!t) return '';
  if (t.length <= 8) return '********';
  return t.slice(0, 8) + '****' + t.slice(-4);
}

// ============ 通用 HTTP 工具 ============
function buildUrl(baseUrl, pathTemplate, vars = {}, query = {}) {
  let p = pathTemplate;
  for (const [k, v] of Object.entries(vars)) {
    p = p.split(`{${k}}`).join(encodeURIComponent(String(v == null ? '' : v)));
  }
  const u = new URL(p, baseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u;
}

function requestText(urlStr, { timeout = 15000, method = 'GET', headers = {}, body } = {}) {
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
      method: String(method).toUpperCase(),
      headers: Object.assign({ Accept: 'application/json' }, headers),
      timeout,
    };
    if (body != null && typeof body === 'object' && !(body instanceof Buffer)) {
      const bodyJson = JSON.stringify(body);
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyJson);
    }
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const status = res.statusCode;
        if (status < 200 || status >= 300) {
          return reject(new Error('HTTP ' + status + (data ? ': ' + data.slice(0, 120) : '')));
        }
        resolve(data);
      });
    });
    req.on('error', (e) => reject(new Error('网络错误: ' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    if (body != null && typeof body === 'object' && !(body instanceof Buffer)) {
      req.write(JSON.stringify(body));
    } else if (body != null) {
      req.write(body);
    }
    req.end();
  });
}

function parseJson(text, { useBigInt = false } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('返回为空');
  if (trimmed.startsWith('<')) throw new Error('返回异常页面（接口不可用或参数错误）');
  try {
    return useBigInt ? JSONBig.parse(trimmed) : JSON.parse(trimmed);
  } catch (e) {
    throw new Error('返回非 JSON: ' + trimmed.slice(0, 80));
  }
}

function getPath(obj, pathExpr) {
  if (!pathExpr) return obj;
  return String(pathExpr).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function pickByMapping(raw, mapping) {
  const out = {};
  for (const [sysKey, remoteKey] of Object.entries(mapping || {})) {
    out[sysKey] = getPath(raw, remoteKey);
  }
  return out;
}

function normalizeBool(v, defaultValue = true) {
  if (typeof v === 'boolean') return v;
  if (v === 'false' || v === '0' || v === 0) return false;
  if (v === 'true' || v === '1' || v === 1) return true;
  return defaultValue;
}

// ============ Token 管理 ============
let tokenCache = { token: null, ts: 0 };
const TOKEN_TTL = 50 * 60 * 1000;

function clearTokenCache() {
  tokenCache = { token: null, ts: 0 };
}

async function fetchTokenByUrl(baseUrl, username, secret, cfg) {
  const ep = cfg.tokenEndpoint || {};
  const method = ep.method || 'GET';
  const body = Object.assign({}, ep.body || {});
  const query = Object.assign({}, ep.query || {});
  const headers = Object.assign({}, ep.headers || {});

  if (username) body[ep.usernameField || 'username'] = username;
  if (secret) body[ep.passwordField || 'password'] = secret;
  if (username) query[ep.usernameField || 'username'] = username;
  if (secret) query[ep.passwordField || 'password'] = secret;

  const url = buildUrl(baseUrl, ep.path || '/api/auth/token', {}, query);
  const text = await requestText(url.toString(), { method, headers, body: method === 'GET' ? undefined : body });
  const j = parseJson(text);
  const token = getPath(j, ep.responsePath || 'token');
  if (!token) throw new Error('未从 token 端点解析到凭证');
  return String(token);
}

async function getAuthHeaders(cfg) {
  const generic = cfg.generic || {};
  const authType = generic.authType || 'token_url';

  if (authType === 'fixed_token') {
    const t = cfg.fixedToken || generic.staticToken;
    if (!t) throw new Error('缺少 fixedToken / staticToken');
    return { Authorization: 'Bearer ' + t };
  }
  if (authType === 'bearer') {
    const t = cfg.secret || generic.staticToken;
    if (!t) throw new Error('缺少 bearer token');
    return { Authorization: 'Bearer ' + t };
  }
  if (authType === 'basic') {
    const u = cfg.username || generic.basicAuth.username;
    const p = cfg.secret || generic.basicAuth.password;
    if (!u || !p) throw new Error('缺少 basic auth 账号/密码');
    return { Authorization: 'Basic ' + Buffer.from(u + ':' + p).toString('base64') };
  }
  if (authType === 'api_key') {
    const key = cfg.secret || generic.staticToken;
    if (!key) throw new Error('缺少 api key');
    const k = generic.apiKey || {};
    if (k.in === 'query') return { _query: { [k.headerName || 'X-API-Key']: (k.valuePrefix || '') + key } };
    return { [k.headerName || 'X-API-Key']: (k.valuePrefix || '') + key };
  }
  // token_url：由 getToken 单独处理，不在这里
  return {};
}

// ============ 适配器基类 ============
class BaseAdapter {
  constructor(cfg) { this.cfg = cfg; }
  async getToken(force = false) { throw new Error('未实现'); }
  async getOrgAccounts() { throw new Error('未实现'); }
  async getOrgDepartments(accountId) { throw new Error('未实现'); }
  async getOrgMembersByAccount(accountId) { throw new Error('未实现'); }
}

// 致远 OA 内置适配器（保持原有行为）
class SeeyonAdapter extends BaseAdapter {
  async requestOA(path, { method = 'GET', query = {}, useBigInt = true } = {}) {
    const token = await this.getToken();
    const url = buildUrl(this.cfg.baseUrl, path, {}, Object.assign({ token }, query));
    const text = await requestText(url.toString(), { method, headers: { Accept: 'application/json' } });
    return parseJson(text, { useBigInt });
  }

  async getToken(force = false) {
    if (this.cfg.fixedToken && !force) return this.cfg.fixedToken;
    if (tokenCache.token && !force && Date.now() - tokenCache.ts < TOKEN_TTL) return tokenCache.token;
    if (!this.cfg.baseUrl || !this.cfg.username || !this.cfg.secret) {
      throw new Error('OA 未配置（缺少 baseUrl / username / secret）');
    }
    const url = `${this.cfg.baseUrl}/seeyon/rest/token/${encodeURIComponent(this.cfg.username)}/${encodeURIComponent(this.cfg.secret)}`;
    const text = await requestText(url);
    const trimmed = text.trim();
    let token = '';
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed);
        token = j.id || j.token || j.ticket || j.accessToken || '';
      } catch (e) {}
    }
    if (!token) token = trimmed;
    if (!token) throw new Error('OA 返回空 token');
    tokenCache = { token, ts: Date.now() };
    return token;
  }

  async getOrgAccounts() {
    const arr = await this.requestOA('/seeyon/rest/orgAccounts');
    if (!Array.isArray(arr)) throw new Error('orgAccounts 返回格式异常');
    return arr.map((m) => ({
      oaId: String(m.id),
      name: m.name || '',
      shortName: m.shortName || '',
      code: m.code || '',
      isGroup: !!m.isGroup,
      parentId: m.superior !== undefined && m.superior !== null && m.superior !== -1 ? String(m.superior) : null,
      path: m.path || '',
      enabled: m.enabled !== false,
      raw: m,
    }));
  }

  async getOrgDepartments(accountId) {
    if (!accountId) return [];
    const arr = await this.requestOA(`/seeyon/rest/orgDepartments/${encodeURIComponent(String(accountId))}`);
    if (!Array.isArray(arr)) return [];
    return arr.map((m) => ({
      oaId: String(m.id),
      name: m.name || '',
      code: m.code || '',
      superior: m.superior !== undefined && m.superior !== null ? String(m.superior) : null,
      superiorName: m.superiorName || '',
      orgAccountId: m.orgAccountId !== undefined && m.orgAccountId !== null ? String(m.orgAccountId) : null,
      orgAccountName: m.orgAccountName || '',
      enabled: m.enabled !== false && m.isDeleted !== true,
      raw: m,
    }));
  }

  async getOrgMembersByAccount(accountId) {
    if (!accountId) throw new Error('缺少组织单位ID');
    const arr = await this.requestOA(`/seeyon/rest/orgMembers/${encodeURIComponent(String(accountId))}`);
    if (!Array.isArray(arr)) throw new Error('orgMembers 返回格式异常');
    return arr.map((m) => this._mapMember(m));
  }

  _mapMember(m) {
    const p = m.properties || {};
    return {
      oaId: String(m.id),
      oaAccountId: String(m.orgAccountId),
      name: m.name || '',
      code: m.code || '',
      loginName: m.loginName || (p && p.loginName) || '',
      orgDepartmentId: m.orgDepartmentId != null ? String(m.orgDepartmentId) : null,
      orgPostId: m.orgPostId != null ? String(m.orgPostId) : null,
      email: m.emailAddress || p.emailaddress || '',
      gender: m.gender || p.gender || '',
      phone: m.telNumber || m.officeNum || p.telnumber || p.officenumber || '',
      isLoginable: !!m.isLoginable,
      enabled: m.enabled !== false,
      raw: m,
    };
  }
}

// 通用 REST 适配器
class GenericAdapter extends BaseAdapter {
  async request(endpointKey, vars = {}, { useBigInt = false } = {}) {
    const ep = this.cfg.generic[endpointKey] || {};
    if (!ep.path) throw new Error(`通用适配器未配置端点: ${endpointKey}`);

    const method = ep.method || 'GET';
    const query = Object.assign({}, ep.query || {});
    const body = Object.assign({}, ep.body || {});
    const headers = Object.assign({ Accept: 'application/json' }, ep.headers || {});

    // 认证：token_url 动态取 token，其余拼 header/query
    let token = null;
    const authType = this.cfg.generic.authType;
    if (authType === 'token_url') {
      token = await this.getToken();
      query.token = token;
    } else {
      const authHeaders = await getAuthHeaders(this.cfg);
      const queryFromAuth = authHeaders._query;
      if (queryFromAuth) Object.assign(query, queryFromAuth);
      else Object.assign(headers, authHeaders);
    }

    // 分页参数
    const paging = ep.paging || {};
    if (paging.enabled) {
      query[paging.pageParam || 'page'] = 1;
      query[paging.sizeParam || 'size'] = paging.defaultSize || 100;
    }

    // 路径/查询占位符
    const pathVars = Object.assign({}, vars);
    if (token != null) pathVars.token = token;
    const accountIdParam = ep.accountIdParam;
    if (accountIdParam && vars.accountId != null) query[accountIdParam] = vars.accountId;

    const url = buildUrl(this.cfg.baseUrl, ep.path, pathVars, query);
    const text = await requestText(url.toString(), { method, headers, body: method === 'GET' ? undefined : body });
    const j = parseJson(text, { useBigInt });
    const arr = getPath(j, ep.responsePath || '');
    if (!Array.isArray(arr)) throw new Error(`${endpointKey} 返回格式异常（responsePath=${ep.responsePath} 未解析到数组）`);

    // 简单翻页：如果返回数组长度等于 pageSize 且存在下一页参数，继续拉（这里仅支持常见 hasMore 或 total）
    // 当前版本仅拉取第一页；主流 OA/HR 通常单页可配置足够大，后续按需扩展。
    return arr;
  }

  async getToken(force = false) {
    const generic = this.cfg.generic || {};
    if (generic.authType !== 'token_url') {
      throw new Error('当前认证方式不是 token_url，无需获取动态 token');
    }
    if (tokenCache.token && !force && Date.now() - tokenCache.ts < TOKEN_TTL) return tokenCache.token;
    if (!this.cfg.baseUrl) throw new Error('未配置 baseUrl');
    const token = await fetchTokenByUrl(this.cfg.baseUrl, this.cfg.username, this.cfg.secret, generic);
    tokenCache = { token, ts: Date.now() };
    return token;
  }

  async getOrgAccounts() {
    const mapping = this.cfg.generic.fieldMapping.orgAccount || {};
    const list = await this.request('orgAccountsEndpoint');
    return list.map((m) => {
      const v = pickByMapping(m, mapping);
      return {
        oaId: String(v.id ?? ''),
        name: v.name || '',
        shortName: v.shortName || '',
        code: v.code || '',
        isGroup: !!v.isGroup,
        parentId: v.parentId !== undefined && v.parentId !== null && v.parentId !== -1 ? String(v.parentId) : null,
        path: v.path || '',
        enabled: normalizeBool(v.enabled, true),
        raw: m,
      };
    });
  }

  async getOrgDepartments(accountId) {
    if (!accountId) return [];
    const mapping = this.cfg.generic.fieldMapping.orgDepartment || {};
    const list = await this.request('orgDepartmentsEndpoint', { accountId });
    return list.map((m) => {
      const v = pickByMapping(m, mapping);
      return {
        oaId: String(v.id ?? ''),
        name: v.name || '',
        code: v.code || '',
        superior: v.superior !== undefined && v.superior !== null ? String(v.superior) : null,
        superiorName: v.superiorName || '',
        orgAccountId: v.orgAccountId !== undefined && v.orgAccountId !== null ? String(v.orgAccountId) : null,
        orgAccountName: v.orgAccountName || '',
        enabled: normalizeBool(v.enabled, true) && !normalizeBool(v.isDeleted, false),
        raw: m,
      };
    });
  }

  async getOrgMembersByAccount(accountId) {
    if (!accountId) throw new Error('缺少组织单位ID');
    const mapping = this.cfg.generic.fieldMapping.member || {};
    const list = await this.request('orgMembersEndpoint', { accountId });
    return list.map((m) => this._mapMember(m, mapping));
  }

  _mapMember(m, mapping) {
    const v = pickByMapping(m, mapping);
    const p = v.properties || {};
    return {
      oaId: String(v.id ?? ''),
      oaAccountId: v.orgAccountId != null ? String(v.orgAccountId) : '',
      name: v.name || '',
      code: v.code || '',
      loginName: v.loginName || p.loginName || '',
      orgDepartmentId: v.orgDepartmentId != null ? String(v.orgDepartmentId) : null,
      orgPostId: v.orgPostId != null ? String(v.orgPostId) : null,
      email: v.email || p.emailaddress || '',
      gender: v.gender || p.gender || '',
      phone: v.phone || v.telNumber || v.officeNum || p.telnumber || p.officenumber || '',
      isLoginable: !!v.isLoginable,
      enabled: normalizeBool(v.enabled, true),
      raw: m,
    };
  }
}

function getAdapter() {
  const cfg = loadOAConfig();
  return cfg.apiType === 'generic' ? new GenericAdapter(cfg) : new SeeyonAdapter(cfg);
}

// ============ 导出函数（签名不变，内部 dispatch 到适配器） ============
async function getToken(force = false) {
  const adapter = getAdapter();
  if (adapter.cfg.apiType === 'generic') {
    const g = adapter.cfg.generic || {};
    if (g.authType !== 'token_url') {
      // 非动态 token 模式：返回固定 token / bearer / api key（用于测试连接显示，不真正用于鉴权）
      const t = adapter.cfg.fixedToken || g.staticToken || adapter.cfg.secret || '';
      if (!t) throw new Error('当前认证方式缺少 token/secret');
      return t;
    }
  }
  return adapter.getToken(force);
}
async function getOrgAccounts() { return getAdapter().getOrgAccounts(); }
async function getOrgDepartments(accountId) { return getAdapter().getOrgDepartments(accountId); }
async function getOrgMembersByAccount(accountId) { return getAdapter().getOrgMembersByAccount(accountId); }

async function getAllOrgMembers() {
  const adapter = getAdapter();
  const accounts = await adapter.getOrgAccounts();
  const seen = new Set();
  const all = [];
  for (const acc of accounts) {
    const members = await adapter.getOrgMembersByAccount(acc.oaId);
    for (const m of members) {
      if (seen.has(m.oaId)) continue;
      seen.add(m.oaId);
      all.push(m);
    }
  }
  return all;
}

async function fetchAllMembers() {
  const adapter = getAdapter();
  const accounts = await adapter.getOrgAccounts();
  const seen = new Set();
  const members = [];
  const byAccount = {};
  for (const acc of accounts) {
    const list = await adapter.getOrgMembersByAccount(acc.oaId);
    byAccount[acc.oaId] = list.length;
    for (const m of list) {
      if (seen.has(m.oaId)) continue;
      seen.add(m.oaId);
      members.push(m);
    }
  }
  return { members, byAccount };
}

function oaMemberToPersonnel(m) {
  const raw = m.raw || {};
  const loginName = (m.loginName && String(m.loginName).trim()) || '';
  const username = loginName || (m.code && String(m.code).trim()) || 'oa_' + m.oaId;
  return {
    oaId: m.oaId,
    oaAccountId: m.oaAccountId,
    name: m.name,
    username,
    orgId: null,
    orgName: raw.orgDepartmentName || '',
    roleId: 'perm_003',
    roleName: '普通用户',
    postName: raw.orgPostName || '',
    levelName: raw.orgLevelName || '',
    email: m.email,
    phone: m.phone,
    gender: m.gender,
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
  getOrgDepartments,
  getOrgMembersByAccount,
  getAllOrgMembers,
  fetchAllMembers,
  oaMemberToPersonnel,
  // 通用化新增导出（供管理端/测试使用）
  defaultGenericConfig,
  getAdapter,
};
