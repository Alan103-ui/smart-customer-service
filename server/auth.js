/**
 * 用户认证模块
 * 支持：账号密码登录、SSO单点登录、JWT Token认证、用户CRUD
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const oa = require('./oa-client'); // 致远OA REST 客户端（rest/token + rest/orgMembers）
const { auditLog } = require('./logger');

// ============ 配置 ============
const JWT_SECRET = process.env.JWT_SECRET || 'smart-cs-secret-key-2026';
const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const USERS_PATH = path.join(__dirname, '../data/users.json');
const PERSONNEL_PATH = path.join(__dirname, '../data/personnel.json');

// ============ SSO 配置（通过环境变量配置）============
const SSO_ENABLED = process.env.SSO_ENABLED === '1';
const SSO_PROVIDER = process.env.SSO_PROVIDER || 'oa';  // oa, a8, generic
const SSO_LOGIN_URL = process.env.SSO_LOGIN_URL || '';  // OA系统登录地址
const SSO_VERIFY_URL = process.env.SSO_VERIFY_URL || '';  // OA系统验证ticket地址
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SSO_CALLBACK_PATH = '/api/auth/sso/callback';  // 回调路径（相对路径）

// A8专用配置
const A8_SERVER_URL = process.env.A8_SERVER_URL || '';
const A8_CAS_SERVER_URL = process.env.A8_CAS_SERVER_URL || '';
const A8_API_USERNAME = process.env.A8_API_USERNAME || '';
const A8_API_PASSWORD = process.env.A8_API_PASSWORD || '';
const A8_SSO_TRUST_MODE = process.env.A8_SSO_TRUST_MODE === '1';

// 回调完整URL（自动拼接当前服务地址）
function getSSOCallbackURL(req) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3001';
  return `${protocol}://${host}${SSO_CALLBACK_PATH}`;
}

// ============ 配置验证 ============
/**
 * 验证SSO配置是否正确
 * 在服务器启动时调用，输出警告信息
 */
function validateSSOConfig() {
  const errors = [];
  const warnings = [];
  
  console.log('\n[SSO] 验证SSO配置...');
  console.log('='.repeat(60));
  
  if (!SSO_ENABLED) {
    console.log('[SSO] ℹ️  SSO登录已禁用（SSO_ENABLED=0）');
    console.log('='.repeat(60) + '\n');
    return { valid: true, errors: [], warnings: [] };
  }
  
  console.log(`[SSO] 提供商: ${SSO_PROVIDER}`);
  console.log(`[SSO] 状态: ✅ 已启用`);
  
  // 通用验证
  if (!JWT_SECRET || JWT_SECRET === 'smart-cs-secret-key-2026') {
    warnings.push('JWT_SECRET 使用默认值，生产环境请修改');
  }
  
  // 按提供商验证
  if (SSO_PROVIDER === 'a8') {
    console.log('\n[A8] 验证A8配置...');
    
    if (!A8_SERVER_URL) {
      errors.push('A8_SERVER_URL 未配置');
    } else {
      console.log(`[A8] ✅ A8_SERVER_URL: ${A8_SERVER_URL}`);
    }
    
    if (!A8_API_USERNAME || !A8_API_PASSWORD) {
      warnings.push('A8_API_USERNAME 或 A8_API_PASSWORD 未配置（自动创建用户功能将不可用）');
    } else {
      console.log(`[A8] ✅ API账号: ${A8_API_USERNAME}`);
    }
    
    if (A8_CAS_SERVER_URL) {
      console.log(`[A8] ✅ CAS服务器: ${A8_CAS_SERVER_URL}`);
    }
    
    if (A8_SSO_TRUST_MODE) {
      warnings.push('A8 SSO信任模式已启用（仅用于测试或内网环境）');
      console.log('[A8] ⚠️  信任模式已启用（跳过ticket验证）');
    }
    
  } else {
    console.log('\n[OAuth2] 验证OAuth2配置...');
    
    if (!SSO_LOGIN_URL) {
      errors.push('SSO_LOGIN_URL 未配置');
    } else {
      console.log(`[OAuth2] ✅ 登录地址: ${SSO_LOGIN_URL}`);
    }
    
    if (!SSO_VERIFY_URL) {
      errors.push('SSO_VERIFY_URL 未配置');
    } else {
      console.log(`[OAuth2] ✅ 验证地址: ${SSO_VERIFY_URL}`);
    }
    
    if (!SSO_CLIENT_ID || !SSO_CLIENT_SECRET) {
      warnings.push('SSO_CLIENT_ID 或 SSO_CLIENT_SECRET 未配置（OAuth2流程将无法完成）');
    } else {
      console.log(`[OAuth2] ✅ 客户端ID: ${SSO_CLIENT_ID}`);
      console.log(`[OAuth2] ✅ 客户端密钥: 已配置（长度: ${SSO_CLIENT_SECRET.length}）`);
    }
  }
  
  // 输出结果
  console.log('\n[SSO] 验证结果:');
  if (errors.length > 0) {
    console.error(`[SSO] ❌ 发现 ${errors.length} 个错误：`);
    errors.forEach((err, i) => console.error(`[SSO]    ${i + 1}. ${err}`));
  }
  
  if (warnings.length > 0) {
    console.warn(`[SSO] ⚠️  发现 ${warnings.length} 个警告：`);
    warnings.forEach((warn, i) => console.warn(`[SSO]    ${i + 1}. ${warn}`));
  }
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('[SSO] ✅ 配置验证通过！');
  }
  
  console.log('='.repeat(60) + '\n');
  
  return { valid: errors.length === 0, errors, warnings };
}

// 启动时自动验证配置
const ssoConfigValidation = validateSSOConfig();

// ============ SSO Ticket验证函数 ============

/**
 * 验证致远A8 OA的ticket（CAS协议）
 * A8 OA通常使用CAS协议，ticket需要到/serviceValidate验证
 */
async function verifyA4Ticket(ticket) {
  if (!SSO_VERIFY_URL) {
    throw new Error('SSO_VERIFY_URL未配置，无法验证A8 ticket');
  }
  
  const callbackURL = SSO_CALLBACK_PATH; // 相对路径，A8会拼接完整地址
  const verifyURL = `${SSO_VERIFY_URL}?service=${encodeURIComponent(callbackURL)}&ticket=${ticket}`;
  
  console.log(`[SSO] 验证A8 ticket: ${verifyURL}`);
  
  const response = await fetch(verifyURL, {
    method: 'GET',
    headers: { 'Accept': 'application/json, text/xml' }
  });
  
  if (!response.ok) {
    throw new Error(`A8 ticket验证失败: ${response.status} ${response.statusText}`);
  }
  
  const text = await response.text();
  
  // A8返回XML格式，解析XML获取用户信息
  // 成功格式：<cas:serviceResponse><cas:authenticationSuccess><cas:user>username</cas:user>...
  const userMatch = text.match(/<cas:user>(.*?)<\/cas:user>/) || text.match(/<user>(.*?)<\/user>/);
  const nameMatch = text.match(/<cas:attributes>.*?<cas:name>(.*?)<\/cas:name>.*?<\/cas:attributes>/s);
  
  if (!userMatch) {
    throw new Error('A8 ticket验证失败：无效的ticket或已过期');
  }
  
  return {
    username: userMatch[1],
    name: nameMatch ? nameMatch[1] : userMatch[1],
    role: 'user'
  };
}

/**
 * 验证通用OA系统的OAuth2 code
 * 用code换access_token，再用access_token换用户信息
 */
async function verifyOACode(code) {
  if (!SSO_VERIFY_URL || !SSO_CLIENT_SECRET) {
    throw new Error('SSO_VERIFY_URL或SSO_CLIENT_SECRET未配置，无法验证OAuth2 code');
  }
  
  // 1. 用code换access_token
  const tokenURL = SSO_VERIFY_URL;
  const tokenRes = await fetch(tokenURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
      code: code,
      redirect_uri: SSO_CALLBACK_PATH
    })
  });
  
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`OAuth2 code换token失败: ${errText}`);
  }
  
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  
  if (!accessToken) {
    throw new Error('OAuth2 code换token失败：未返回access_token');
  }
  
  // 2. 用access_token换用户信息
  const userInfoURL = process.env.SSO_USER_INFO_URL || `${SSO_VERIFY_URL}/userinfo`;
  const userRes = await fetch(userInfoURL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!userRes.ok) {
    const errText = await userRes.text();
    throw new Error(`获取用户信息失败: ${errText}`);
  }
  
  const userInfo = await userRes.json();
  
  return {
    username: userInfo.username || userInfo.user_name || userInfo.sub || userInfo.id,
    name: userInfo.name || userInfo.display_name || userInfo.username,
    role: userInfo.role || 'user'
  };
}

/**
 * 通用ticket验证（直接调用配置好的验证接口）
 */
async function verifySSOTicketGeneric(ticket) {
  if (!SSO_VERIFY_URL) {
    throw new Error('SSO_VERIFY_URL未配置，无法验证ticket');
  }
  
  const verifyURL = `${SSO_VERIFY_URL}?ticket=${ticket}`;
  
  console.log(`[SSO] 验证ticket: ${verifyURL}`);
  
  const response = await fetch(verifyURL, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  
  if (!response.ok) {
    throw new Error(`ticket验证失败: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // 支持多种返回格式
  if (data.success && data.user) {
    return data.user;
  } else if (data.username) {
    return data;
  } else if (data.data && data.data.username) {
    return data.data;
  } else {
    throw new Error('ticket验证失败：无效的响应格式');
  }
}

// ============ 致远OA REST 账号验证（账号打通式 SSO）============
/**
 * 基于致远OA REST 接口（rest/token + rest/orgMembers）验证账号。
 * 该 A8 版本未开放标准 CAS/OAuth 端点，采用"账号打通"：
 * 用户提交 OA 工号（及可选姓名），后端用集成凭证拉 OA 全量人员并匹配。
 */
async function verifyOARestAccount({ username, name } = {}) {
  const u = (username || '').toString().trim();
  if (!u) throw new Error('请输入 OA 工号');
  let members;
  try {
    members = await oa.getAllOrgMembers();
  } catch (e) {
    throw new Error('无法连接致远OA，请检查 OA 配置或服务：' + e.message);
  }
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('未从 OA 获取到人员数据');
  }
  let m = members.find(mm => mm.code && String(mm.code).trim() === u);
  if (!m) m = members.find(mm => mm.name && mm.name === u);
  if (!m) throw new Error('OA 中未找到该工号/姓名对应的人员');
  if (m.enabled === false) throw new Error('该 OA 账号已被禁用');
  const n = (name || '').toString().trim();
  if (n) {
    if (!m.name || m.name !== n) {
      throw new Error('姓名与 OA 记录不匹配，请核对');
    }
  }
  return m;
}

// ============ 人员数据操作（合并用户管理到人员信息） ============

function loadPersonnel() {
  if (!fs.existsSync(PERSONNEL_PATH)) return [];
  return JSON.parse(fs.readFileSync(PERSONNEL_PATH, 'utf8'));
}

function savePersonnel(personnel) {
  const dir = path.dirname(PERSONNEL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PERSONNEL_PATH, JSON.stringify(personnel, null, 2));
}

function findPersonnelByUsername(username) {
  const personnel = loadPersonnel();
  return personnel.find(p => p.username === username && p.isActive);
}

// ============ 用户数据操作 ============

function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) {
    const defaultAdmin = {
      id: 'user_' + Date.now(),
      username: 'admin',
      passwordHash: hashPassword('admin123'),
      name: '系统管理员',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    saveUsers([defaultAdmin]);
    return [defaultAdmin];
  }
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
}

function saveUsers(users) {
  const dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function findUserByUsername(username) {
  // 优先检查 personnel.json（人员信息是唯一数据源）
  const personnel = loadPersonnel();
  const person = personnel.find(p => p.username === username && p.isActive);
  if (person) {
    // 映射人员到用户格式
    return {
      id: person.id,
      username: person.username,
      passwordHash: person.passwordHash || '',
      name: person.name,
      role: person.roleName === '管理员' ? 'admin' : 'user',
      isActive: person.isActive,
      lastLoginAt: person.lastLoginAt
    };
  }
  
  // 如果没找到，再检查 users.json（兼容旧数据）
  const users = loadUsers();
  return users.find(u => u.username === username);
}

function findUserById(userId) {
  // 优先检查 personnel.json（人员信息是唯一数据源）
  const personnel = loadPersonnel();
  const person = personnel.find(p => p.id === userId && p.isActive);
  if (person) {
    // 映射人员到用户格式
    return {
      id: person.id,
      username: person.username,
      passwordHash: person.passwordHash || '',
      name: person.name,
      role: person.roleName === '管理员' ? 'admin' : 'user',
      isActive: person.isActive,
      lastLoginAt: person.lastLoginAt
    };
  }
  
  // 如果没找到，再检查 users.json（兼容旧数据）
  const users = loadUsers();
  return users.find(u => u.id === userId);
}

// ============ 密码处理 ============

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch (e) {
    return false;
  }
}

// ============ JWT Token ============

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ============ 中间件 ============

/**
 * 认证中间件：验证请求中的 JWT Token
 * 用法：app.get('/api/xxx', authMiddleware, (req, res) => {...})
 */
function authMiddleware(req, res, next) {
  // 跳过以下路径（无需认证）
  // 注意：此中间件仅用于 rag-admin.js 等子路由器内部
  // 公共路由 /api/categories, /api/* 等已在 index.js 中独立注册，不经过此中间件
  const skipPaths = [
    '/auth/login',
    '/auth/sso',
    '/health'
    // 注意：不要在此添加 /categories，否则 /api/admin/categories 也会被跳过认证！
    // 因为 Express Router 会剥离挂载前缀（/api/admin），导致 req.path 变为 /categories
  ];
  if (skipPaths.some(p => req.path.startsWith(p))) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录', code: 'UNAUTHORIZED' });
  }
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' });
  }

  // 验证用户是否仍然有效
  const user = findUserById(decoded.userId);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: '账号已被禁用', code: 'ACCOUNT_DISABLED' });
  }

  req.user = { userId: user.id, username: user.username, role: user.role, name: user.name };
  next();
}

/**
 * 管理员权限中间件
 */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限', code: 'FORBIDDEN' });
  }
  next();
}

// ============ 注册认证路由 ============

function setupAuthRoutes(app) {

  // ============ 用户登录 ============
  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码必填' });
      }

      const user = findUserByUsername(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }
      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      // 更新最后登录时间（根据数据源更新）
      const personnel = loadPersonnel();
      const personIdx = personnel.findIndex(p => p.id === user.id);
      if (personIdx !== -1) {
        // 人员数据
        personnel[personIdx].lastLoginAt = new Date().toISOString();
        savePersonnel(personnel);
      } else {
        // users.json 数据
        const users = loadUsers();
        const userIdx = users.findIndex(u => u.id === user.id);
        if (userIdx !== -1) {
          users[userIdx].lastLoginAt = new Date().toISOString();
          saveUsers(users);
        }
      }

      const token = generateToken(user);
      res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, name: user.name, role: user.role }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 获取当前登录用户信息 ============
  app.get('/api/auth/me', authMiddleware, (req, res) => {
    try {
      const user = findUserById(req.user.userId);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      res.json({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 致远OA 账号登录（账号打通式 SSO，适配未开放CAS/OAuth的A8）============
  /**
   * POST /api/auth/sso/oa-login
   * 用户提交 OA 工号（及可选姓名），后端用集成凭证校验 OA 人员后签发本系统 JWT。
   * 自动关联 personnel.json 中已有 OA 人员记录（按 oaId/username），否则自动创建。
   */
  app.post('/api/auth/sso/oa-login', async (req, res) => {
    try {
      const { username, name } = req.body || {};
      const m = await verifyOARestAccount({ username, name });

      const personnel = loadPersonnel();
      let person = personnel.find(p =>
        (p.oaId != null && String(p.oaId) === String(m.oaId)) ||
        (p.username && p.username === (m.code || m.name))
      );
      if (!person) {
        const rec = oa.oaMemberToPersonnel(m);
        person = Object.assign({ id: 'user_oa_' + m.oaId, passwordHash: null }, rec);
        personnel.push(person);
      }
      person.lastLoginAt = new Date().toISOString();
      const idx = personnel.findIndex(p => p.id === person.id);
      if (idx >= 0) personnel[idx] = person; else personnel.push(person);
      savePersonnel(personnel);

      const role = person.roleName === '管理员' ? 'admin' : 'user';
      const user = { id: person.id, username: person.username, name: person.name, role };
      const token = generateToken(user);
      res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, name: user.name, role: user.role }
      });
    } catch (e) {
      res.status(401).json({ success: false, error: e.message });
    }
  });

  // ============ 致远OA 单点登录（OA 调用 RAG 接口，按工号白名单放行）============
  /**
   * OA 在用户登录后调用本接口完成 SSO：携带登录工号，RAG 校验是否在允许清单（白名单）中，
   * 在则签发 JWT 放行，不在则拒绝。
   *   GET  /api/auth/sso/oa  —— OA 将用户浏览器重定向到本地址（门户单点跳转），写 localStorage 后进入应用
   *   POST /api/auth/sso/oa  —— OA 后端服务间调用，返回 JSON {allowed, token, user}
   * 安全加固（可选）：HMAC 签名（与 OA 共享 signSecret）+ 来源 IP 白名单（trustedIps）。
   */
  function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || '';
  }
  function computeOASSOSign(employeeId, ts, secret) {
    return crypto.createHmac('sha256', secret).update(`${employeeId}|${ts}`).digest('hex');
  }
  async function resolvePersonByEmployeeId(employeeId, name) {
    // 1) personnel.json 中已有记录（忽略 isActive，SSO 以白名单为准）
    const personnel = loadPersonnel();
    let person = personnel.find(p => p.username === employeeId);
    if (person) return person;
    // 2) 尝试从 OA 同步该人员档案（按工号 code 匹配）
    try {
      const members = await oa.getAllOrgMembers();
      const m = (members || []).find(mm => mm.code && String(mm.code).trim() === String(employeeId));
      if (m) {
        const rec = oa.oaMemberToPersonnel(m);
        return Object.assign({ id: 'user_oa_' + m.oaId, passwordHash: null }, rec);
      }
    } catch (e) { /* OA 不可达时降级为最小记录 */ }
    // 3) 最小记录
    return {
      id: 'user_oa_' + employeeId,
      oaId: null,
      username: employeeId,
      name: name || employeeId,
      roleId: 'perm_003',
      roleName: '普通用户',
      email: '',
      phone: '',
      orgName: '',
      postName: '',
      levelName: '',
      isActive: true,
      source: 'oa',
      passwordHash: null,
      createdAt: new Date().toISOString(),
    };
  }
  async function handleOASSO(req, res, format) {
    const cfg = oa.loadOAConfig();
    const sso = cfg.sso || {};
    const q = req.query || {};
    const b = req.body || {};
    const employeeId = String(b.employeeId != null ? b.employeeId : (q.employeeId || '')).trim();
    const name = String(b.name != null ? b.name : (q.name || '')).trim();
    const ts = String(b.ts != null ? b.ts : (q.ts || '')).trim();
    const sign = String(b.sign != null ? b.sign : (q.sign || '')).trim();
    const redirect = String(q.redirect || b.redirect || '/').trim() || '/';

    const deny = (error) => {
      if (format === 'json') return res.status(403).json({ allowed: false, error });
      const html = `<!doctype html><html><body style="font-family:sans-serif;padding:40px"><h2>单点登录被拒绝</h2><p>${error}</p><p><a href="/">返回首页</a></p></body></html>`;
      return res.status(403).type('html').send(html);
    };
    const allow = (token, user) => {
      if (format === 'json') return res.json({ allowed: true, token, user });
      // 浏览器跳转：仅写入 cs_token，前端启动时会自动拉取 /api/auth/me 补全用户信息
      const html = `<!doctype html><html><body><script>try{localStorage.setItem('cs_token',${JSON.stringify(token)});}catch(e){}location.href=${JSON.stringify(redirect)};</script></body></html>`;
      return res.type('html').send(html);
    };

    if (!employeeId) return deny('缺少工号(employeeId)');

    // 1) 来源 IP 白名单
    const trustedIps = Array.isArray(sso.trustedIps) ? sso.trustedIps : [];
    if (trustedIps.length > 0) {
      const ip = getClientIp(req);
      if (!trustedIps.includes(ip)) return deny(`来源 IP(${ip}) 不在信任列表`);
    }

    // 2) HMAC 签名校验
    if (sso.requireSign) {
      if (!sso.signSecret) return deny('SSO 签名密钥未配置');
      if (!sign) return deny('缺少签名(sign)');
      const expected = computeOASSOSign(employeeId, ts, sso.signSecret);
      let ok = false;
      try { ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sign)); } catch (e) { ok = false; }
      if (!ok) return deny('签名无效');
      if (ts) {
        const diff = Math.abs(Date.now() - Number(ts) * 1000);
        if (Number.isNaN(diff) || diff > 5 * 60 * 1000) return deny('签名已过期');
      }
    }

    // 3) 工号白名单校验
    if (sso.mode === 'open') {
      let exists = !!findPersonnelByUsername(employeeId);
      if (!exists) {
        try { exists = (await oa.getAllOrgMembers() || []).some(m => m.code && String(m.code).trim() === employeeId); } catch (e) {}
      }
      if (!exists) return deny('该工号未同步自 OA，不在允许范围');
    } else {
      const list = Array.isArray(sso.whitelist) ? sso.whitelist.map(String) : [];
      if (!list.includes(employeeId)) return deny('工号不在允许清单中');
    }

    // 4) 放行：关联/创建人员并签发 JWT
    try {
      const person = await resolvePersonByEmployeeId(employeeId, name);
      person.lastLoginAt = new Date().toISOString();
      person.isActive = true;
      const personnel = loadPersonnel();
      const idx = personnel.findIndex(p => p.id === person.id);
      if (idx >= 0) personnel[idx] = Object.assign(personnel[idx], person); else personnel.push(person);
      savePersonnel(personnel);
      const role = person.roleName === '管理员' ? 'admin' : 'user';
      const user = { id: person.id, username: person.username, name: person.name, role };
      const token = generateToken(user);
      return allow(token, user);
    } catch (e) {
      return deny('登录处理失败：' + e.message);
    }
  }
  app.get('/api/auth/sso/oa', (req, res) => handleOASSO(req, res, 'redirect'));
  app.post('/api/auth/sso/oa', (req, res) => handleOASSO(req, res, 'json'));

  // ============ SSO单点登录（A8/OA系统对接）============
  
  /**
   * SSO登录入口 - 重定向到OA系统登录页
   * GET /api/auth/sso/login
   */
  app.get('/api/auth/sso/login', (req, res) => {
    if (!SSO_ENABLED) {
      return res.status(501).json({ error: 'SSO登录未启用，请配置环境变量SSO_ENABLED=1' });
    }
    
    if (!SSO_LOGIN_URL) {
      return res.status(500).json({ error: 'SSO登录地址未配置，请设置SSO_LOGIN_URL环境变量' });
    }
    
    try {
      // 构建OA登录URL（不同OA系统格式可能不同）
      const callbackURL = getSSOCallbackURL(req);
      let oaLoginURL;
      
      if (SSO_PROVIDER === 'a8') {
        // 致远A8 OA SSO格式
        oaLoginURL = `${SSO_LOGIN_URL}?service=${encodeURIComponent(callbackURL)}`;
      } else if (SSO_PROVIDER === 'oa') {
        // 通用OA系统OAuth2格式
        oaLoginURL = `${SSO_LOGIN_URL}?client_id=${SSO_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackURL)}&response_type=code`;
      } else {
        // 通用格式：直接跳转，由OA系统处理回调
        oaLoginURL = `${SSO_LOGIN_URL}?redirect=${encodeURIComponent(callbackURL)}`;
      }
      
      console.log(`[SSO] 重定向到OA登录页: ${oaLoginURL}`);
      res.redirect(oaLoginURL);
    } catch (err) {
      res.status(500).json({ error: `SSO登录重定向失败: ${err.message}` });
    }
  });
  
  /**
   * SSO回调处理 - OA系统登录成功后回调此地址
   * GET /api/auth/sso/callback?ticket=xxx 或 ?code=xxx
   */
  app.get('/api/auth/sso/callback', async (req, res) => {
    try {
      const { ticket, code } = req.query;
      
      if (!ticket && !code) {
        return res.status(400).send('SSO回调参数错误：缺少ticket或code');
      }
      
      // 验证ticket/code并获取用户信息
      let userInfo = null;
      
      if (SSO_PROVIDER === 'a8') {
        // 致远A8 OA：验证ticket
        userInfo = await verifyA8Ticket(ticket || code);
      } else if (SSO_PROVIDER === 'oa') {
        // 通用OA：用code换token，再换用户信息
        userInfo = await verifyOACode(code);
      } else {
        // 通用：直接验证ticket
        userInfo = await verifySSOTicketGeneric(ticket || code);
      }
      
      if (!userInfo || !userInfo.username) {
        return res.status(401).send('SSO认证失败：无法获取用户信息');
      }
      
      // 自动创建或更新用户
      let user = findUserByUsername(userInfo.username);
      if (!user) {
        // 自动创建用户
        const users = loadUsers();
        user = {
          id: 'user_' + Date.now(),
          username: userInfo.username,
          passwordHash: '',
          name: userInfo.name || userInfo.username,
          role: userInfo.role || 'user',
          isActive: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          ssoProvider: SSO_PROVIDER
        };
        users.push(user);
        saveUsers(users);
        console.log(`[SSO] 自动创建用户: ${userInfo.username}`);
      } else {
        // 更新最后登录时间和姓名（如果OA返回了新姓名）
        const users = loadUsers();
        const idx = users.findIndex(u => u.id === user.id);
        users[idx].lastLoginAt = new Date().toISOString();
        if (userInfo.name && userInfo.name !== user.name) {
          users[idx].name = userInfo.name;
        }
        saveUsers(users);
      }
      
      // 生成JWT Token
      const token = generateToken(user);
      
      // 重定向到前端页面，并携带token（前端从URL参数中获取token自动登录）
      const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3001';
      const redirectURL = `${frontendURL}/?token=${token}`;
      
      console.log(`[SSO] 用户 ${userInfo.username} SSO登录成功，重定向到前端`);
      res.redirect(redirectURL);
      
    } catch (err) {
      console.error('[SSO] 回调处理失败:', err);
      res.status(500).send(`SSO登录失败: ${err.message}`);
    }
  });
  
  /**
   * SSO认证接口（兼容旧版，支持直接传递userInfo或ticket）
   * POST /api/auth/sso
   */
  app.post('/api/auth/sso', (req, res) => {
    try {
      const { ticket, code, userInfo } = req.body;

      // 方式1：直接携带用户信息（OA系统信任内网环境）
      if (userInfo && userInfo.username) {
        let user = findUserByUsername(userInfo.username);
        if (!user) {
          // 自动创建用户
          const users = loadUsers();
          user = {
            id: 'user_' + Date.now(),
            username: userInfo.username,
            passwordHash: '',
            name: userInfo.name || userInfo.username,
            role: userInfo.role || 'user',
            isActive: true,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            ssoProvider: userInfo.provider || 'oa'
          };
          users.push(user);
          saveUsers(users);
        } else {
          // 更新最后登录时间
          const users = loadUsers();
          const idx = users.findIndex(u => u.id === user.id);
          users[idx].lastLoginAt = new Date().toISOString();
          saveUsers(users);
        }

        const token = generateToken(user);
        return res.json({
          success: true,
          token,
          user: { id: user.id, username: user.username, name: user.name, role: user.role },
          isNewUser: !userInfo.username ? false : !findUserByUsername(userInfo.username)
        });
      }

      // 方式2：通过ticket验证
      if (ticket || code) {
        if (!SSO_ENABLED) {
          return res.status(501).json({ error: 'SSO ticket验证未启用，请配置环境变量SSO_ENABLED=1' });
        }
        
        // 异步验证ticket（返回202，让客户端轮询结果）
        res.status(202).json({ 
          success: false, 
          message: 'SSO ticket验证中，请使用GET /api/auth/sso/callback接口完成SSO登录' 
        });
        return;
      }

      return res.status(400).json({ error: '缺少SSO认证信息（ticket或userInfo）' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 管理员：获取用户列表 ============
  app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
    try {
      let users = loadUsers();
      // 不返回密码哈希
      const safeUsers = users.map(({ passwordHash, ...u }) => u);
      res.json(safeUsers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 管理员：新增用户 ============
  app.post('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
    try {
      const { username, password, name, role } = req.body;
      if (!username || !username.trim()) return res.status(400).json({ error: '用户名必填' });
      if (!password || password.length < 4) return res.status(400).json({ error: '密码至少4位' });

      const users = loadUsers();
      if (users.some(u => u.username === username.trim())) {
        return res.status(400).json({ error: '用户名已存在' });
      }

      const newUser = {
        id: 'user_' + Date.now(),
        username: username.trim(),
        passwordHash: hashPassword(password),
        name: name || username.trim(),
        role: (role === 'admin') ? 'admin' : 'user',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: null
      };
      users.push(newUser);
      saveUsers(users);
      auditLog('user_create', req.user ? req.user.username : 'unknown', { id: newUser.id, username: newUser.username, name: newUser.name });
      const { passwordHash, ...safeUser } = newUser;
      res.json({ success: true, data: safeUser });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 管理员：修改用户 ============
  app.put('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const { name, role, isActive } = req.body;
      const users = loadUsers();
      const idx = users.findIndex(u => u.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '用户不存在' });

      if (name !== undefined) users[idx].name = name;
      if (role !== undefined && ['admin', 'user'].includes(role)) users[idx].role = role;
      if (isActive !== undefined) users[idx].isActive = Boolean(isActive);
      users[idx].updatedAt = new Date().toISOString();

      saveUsers(users);
      auditLog('user_update', req.user ? req.user.username : 'unknown', { id: req.params.id, name: (name || '').trim(), role: (role || '').trim() });
      const { passwordHash, ...safeUser } = users[idx];
      res.json({ success: true, data: safeUser });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 管理员：重置用户密码 ============
  app.put('/api/admin/users/:id/reset-password', authMiddleware, adminOnly, (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: '新密码至少4位' });
      }
      const users = loadUsers();
      const idx = users.findIndex(u => u.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '用户不存在' });

      users[idx].passwordHash = hashPassword(newPassword);
      users[idx].updatedAt = new Date().toISOString();
      saveUsers(users);
      auditLog('user_reset_password', req.user ? req.user.username : 'unknown', { id: req.params.id });
      res.json({ success: true, message: '密码已重置' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ 管理员：删除用户 ============
  app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const users = loadUsers();
      const user = users.find(u => u.id === req.params.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (user.username === 'admin') return res.status(400).json({ error: '不能删除默认管理员账号' });

      const filtered = users.filter(u => u.id !== req.params.id);
      saveUsers(filtered);
      auditLog('user_delete', req.user ? req.user.username : 'unknown', { id: req.params.id, username: user.username });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  loadUsers,
  findUserById,
  findUserByUsername,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware,
  adminOnly,
  setupAuthRoutes,
  // SSO配置验证
  validateSSOConfig,
  ssoConfigValidation,
  SSO_ENABLED,
  SSO_PROVIDER,
  A8_SERVER_URL,
  A8_CAS_SERVER_URL,
  A8_SSO_TRUST_MODE
};
