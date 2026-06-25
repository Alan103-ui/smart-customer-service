/**
 * 用户认证模块
 * 支持：账号密码登录、SSO单点登录、JWT Token认证、用户CRUD
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const JWT_SECRET = process.env.JWT_SECRET || 'smart-cs-secret-key-2026';
const TOKEN_EXPIRES_IN = '7d';
const USERS_PATH = path.join(__dirname, '../data/users.json');

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
  const users = loadUsers();
  return users.find(u => u.username === username);
}

function findUserById(userId) {
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
  const skipPaths = [
    '/api/auth/login',
    '/api/auth/sso',
    '/api/health',
    '/api/categories'  // 普通用户获取分类列表（仅一级分类，无敏感信息）
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

      // 更新最后登录时间
      const users = loadUsers();
      const idx = users.findIndex(u => u.id === user.id);
      users[idx].lastLoginAt = new Date().toISOString();
      saveUsers(users);

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

  // ============ SSO单点登录（A8/OA系统对接）============
  // 请求体：{ ticket?: string, code?: string, userInfo?: object }
  // 对接方式：OA系统跳转时携带用户身份信息，后端验证后自动创建/登录
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

      // 方式2：通过ticket验证（需配置A8/OA的SSO验证地址）
      if (ticket) {
        // TODO: 调用A8/OA的SSO验证接口验证ticket
        // const ssoResult = await verifySSOTicket(ticket);
        // 暂时返回未实现
        return res.status(501).json({ error: 'SSO ticket验证方式待配置A8/OA接口后启用' });
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
  setupAuthRoutes
};
