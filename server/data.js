/**
 * 数据共享模块 - 供 index.js 和 rag-admin.js 使用
 * 包含所有数据访问函数（分类、FAQ、组织架构、人员、权限、A8配置等）
 */

const fs = require('fs');
const path = require('path');

// ============ 路径配置 ============
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CATEGORIES_PATH = path.join(__dirname, '../data/categories.json');
const FAQ_PATH = path.join(__dirname, '../data/faq.json');
const ORG_PATH = path.join(__dirname, '../data/org_structure.json');
const PERSONNEL_PATH = path.join(__dirname, '../data/personnel.json');
const PERMISSIONS_PATH = path.join(__dirname, '../data/permissions.json');
const A8_CONFIG_PATH = path.join(__dirname, '../data/a8_config.json');
const SOFTWARE_INFO_PATH = path.join(__dirname, '../data/software-info.json');
const KNOWLEDGE_BASES_PATH = path.join(__dirname, '../data/knowledge_bases.json');
const DB_PATH = path.join(__dirname, '../data/conversations.db');
const SYSTEM_CONFIG_PATH = path.join(__dirname, '../data/system-config.json');
const SYNONYMS_PATH = path.join(__dirname, '../data/synonyms.json');
const STOPWORDS_PATH = path.join(__dirname, '../data/stopwords.json');
const ANNOUNCEMENT_PATH = path.join(__dirname, '../data/announcement.json');
const SSO_WHITELIST_PATH = path.join(__dirname, '../data/sso-whitelist.json');
const DEPARTMENTS_PATH = path.join(__dirname, '../data/departments.json');

// ============ FAQ 知识库（带缓存） ============
let FAQ_KNOWLEDGE_BASE = [];
let CATEGORIES_CACHE = null;

function loadFAQ() {
  if (!fs.existsSync(FAQ_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
  } catch (e) {
    console.error('[data] FAQ 文件读取失败：', e.message);
    return [];
  }
}

function saveFAQ(data) {
  fs.writeFileSync(FAQ_PATH, JSON.stringify(data, null, 2));
}

// 每次读取 FAQ 时重新加载（支持热更新）
function getFAQ() {
  FAQ_KNOWLEDGE_BASE = loadFAQ();
  return FAQ_KNOWLEDGE_BASE;
}

function getFAQByCategory(category) {
  const list = getFAQ();
  if (!category || category === '全部' || category === 'all') return list;
  return list.filter(f => f.category === category);
}

// 兼容旧 FAQ 数据：为没有 category 字段的条目补充默认值
function normalizeFAQCategories() {
  const faqList = loadFAQ();
  let changed = false;
  for (const f of faqList) {
    if (!f.category) { f.category = '常见问题'; changed = true; }
  }
  if (changed) saveFAQ(faqList);
}

// ============ 分类管理（支持二级分类） ============
function loadCategories() {
  if (!fs.existsSync(CATEGORIES_PATH)) {
    const defaultCats = [
      { id: 'cat_default', name: '常见问题', description: '默认分类', parentId: null, sortOrder: 0, isDefault: true, knowledgeBaseId: 'kb_default' },
      { id: 'cat_after_sale', name: '售后服务', description: '退货退款等售后问题', parentId: null, sortOrder: 1, isDefault: false, knowledgeBaseId: 'kb_default' },
      { id: 'cat_shipping', name: '配送物流', description: '配送、物流、快递相关问题', parentId: null, sortOrder: 2, isDefault: false, knowledgeBaseId: 'kb_default' },
      { id: 'cat_payment', name: '支付相关', description: '支付、付款、发票相关问题', parentId: null, sortOrder: 3, isDefault: false, knowledgeBaseId: 'kb_default' }
    ];
    saveCategories(defaultCats);
    return defaultCats;
  }
  try { return JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8')); } catch (e) { return []; }
}

function saveCategories(data) {
  fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(data, null, 2));
}

// ============ 组织架构 ============
function loadOrg() {
  if (!fs.existsSync(ORG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(ORG_PATH, 'utf8')); } catch (e) { return []; }
}

function saveOrg(data) {
  fs.writeFileSync(ORG_PATH, JSON.stringify(data, null, 2));
}

// ============ 人员信息 ============
function loadPersonnel() {
  if (!fs.existsSync(PERSONNEL_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PERSONNEL_PATH, 'utf8')); } catch (e) { return []; }
}

function savePersonnel(data) {
  fs.writeFileSync(PERSONNEL_PATH, JSON.stringify(data, null, 2));
}

// ============ 权限管理 ============
// 权限目录（后端权威定义）：覆盖所有后端功能模块。
// 前端权限管理 UI 通过 GET /api/admin/permissions/catalog 拉取此目录动态渲染。
const PERMISSION_CATALOG = [
  { group: '知识库', items: [
    { code: 'faq:read', label: 'FAQ查看' },
    { code: 'faq:write', label: 'FAQ编辑' },
    { code: 'faq:delete', label: 'FAQ删除' },
    { code: 'category:manage', label: '分类管理' },
  ]},
  { group: '基础信息', items: [
    { code: 'org:manage', label: '组织管理' },
    { code: 'personnel:manage', label: '人员管理' },
    { code: 'user:manage', label: '用户账号管理' },
    { code: 'permission:manage', label: '权限管理' },
  ]},
  { group: 'RAG引擎', items: [
    { code: 'rag:manage', label: 'RAG配置' },
    { code: 'rag:test', label: '检索测试' },
    { code: 'rag:eval', label: '批量评估' },
    { code: 'vector:rebuild', label: '向量库重建' },
  ]},
  { group: '答案与意图', items: [
    { code: 'rewrite:manage', label: '答案改写' },
    { code: 'intent:manage', label: '意图识别' },
  ]},
  { group: '对话与记忆', items: [
    { code: 'conversation:view', label: '对话查看' },
    { code: 'conversation:delete', label: '对话删除' },
    { code: 'memory:view', label: '记忆查看' },
  ]},
  { group: '数据统计', items: [
    { code: 'stats:view', label: '数据统计' },
    { code: 'feedback:view', label: '满意度查看' },
  ]},
  { group: '日志', items: [
    { code: 'log:view', label: '日志查看' },
    { code: 'log:clean', label: '日志清理' },
  ]},
  { group: '致远OA', items: [
    { code: 'oa:manage', label: 'OA对接管理' },
    { code: 'oa:sso', label: 'OA单点登录' },
  ]},
  { group: '系统', items: [
    { code: 'upload:manage', label: '文件上传' },
    { code: 'model:manage', label: '模型管理' },
    { code: 'a8:config', label: 'A8配置' },
  ]},
  { group: '前端', items: [
    { code: 'chat:access', label: '前端聊天' },
  ]},
];
const ALL_PERMISSION_CODES = PERMISSION_CATALOG.flatMap(g => g.items.map(i => i.code));

function loadPermissions() {
  if (!fs.existsSync(PERMISSIONS_PATH)) {
    // 种子数据：管理员 + 普通用户
    const seed = [
      {
        id: 'perm_001',
        roleName: '管理员',
        roleKey: 'admin',
        categoryId: null,
        categoryName: '全部',
        permissions: [...ALL_PERMISSION_CODES],
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'perm_003',
        roleName: '普通用户',
        roleKey: 'user',
        categoryId: null,
        categoryName: '全部',
        permissions: ['chat:access'],
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    savePermissions(seed);
    return seed;
  }
  try { return JSON.parse(fs.readFileSync(PERMISSIONS_PATH, 'utf8')); } catch (e) { return []; }
}

function savePermissions(data) {
  fs.writeFileSync(PERMISSIONS_PATH, JSON.stringify(data, null, 2));
}

// ============ 软件信息（可编辑品牌/名称配置） ============
const DEFAULT_SOFTWARE_INFO = {
  companyName: '广康集团',
  softwareName: '广康生化',
  assistantName: '小智',
  knowledgeBaseName: '广康集团知识库',
  welcomeMessage: '您好！我是广康集团AI助手，很高兴为您服务😊',
  loginImage: '',   // 登录界面图片 URL（如 /uploads/xxx.png），为空则用默认样式
  chatImage: ''     // 聊天界面头像/Logo 图片 URL，为空则用默认 /logo.jpg
};

function loadSoftwareInfo() {
  if (!fs.existsSync(SOFTWARE_INFO_PATH)) {
    saveSoftwareInfo(DEFAULT_SOFTWARE_INFO);
    return { ...DEFAULT_SOFTWARE_INFO };
  }
  try {
    const data = JSON.parse(fs.readFileSync(SOFTWARE_INFO_PATH, 'utf8'));
    // 补齐缺失字段，避免前端读取到 undefined
    return { ...DEFAULT_SOFTWARE_INFO, ...data };
  } catch (e) {
    console.error('[data] 软件信息读取失败：', e.message);
    return { ...DEFAULT_SOFTWARE_INFO };
  }
}

function saveSoftwareInfo(data) {
  const merged = { ...DEFAULT_SOFTWARE_INFO, ...(data || {}) };
  fs.writeFileSync(SOFTWARE_INFO_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ============ A8 配置 ============
function loadA8Config() {
  if (!fs.existsSync(A8_CONFIG_PATH)) {
    const defaultConfig = { enabled: false, orgApiUrl: '', personnelApiUrl: '', syncInterval: 3600, lastSyncTime: null, auth: { type: 'basic', username: '', password: '' } };
    saveA8Config(defaultConfig);
    return defaultConfig;
  }
  try { return JSON.parse(fs.readFileSync(A8_CONFIG_PATH, 'utf8')); } catch (e) { return { enabled: false }; }
}

function saveA8Config(data) {
  fs.writeFileSync(A8_CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ============ 知识库管理 ============
let KNOWLEDGE_BASES_CACHE = null;

function loadKnowledgeBases() {
  if (!fs.existsSync(KNOWLEDGE_BASES_PATH)) {
    const defaultKB = [{ id: 'kb_default', name: DEFAULT_SOFTWARE_INFO.knowledgeBaseName, description: '默认知识库', isDefault: true, createdAt: new Date().toISOString() }];
    saveKnowledgeBases(defaultKB);
    return defaultKB;
  }
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_BASES_PATH, 'utf8')); } catch (e) { return []; }
}

function saveKnowledgeBases(data) {
  fs.writeFileSync(KNOWLEDGE_BASES_PATH, JSON.stringify(data, null, 2));
}

function getKnowledgeBases() {
  KNOWLEDGE_BASES_CACHE = loadKnowledgeBases();
  return KNOWLEDGE_BASES_CACHE;
}

// ============ 对话数据存储 ============
function readDB() {
  const fp = DB_PATH.replace('.db', '.json');
  if (!fs.existsSync(fp)) return { conversations: [], faq_logs: [] };
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (!raw.trim()) return { conversations: [], faq_logs: [] };
    return JSON.parse(raw);
  } catch (e) {
    console.error('[data] 读取数据文件失败（将使用空数据）:', e.message);
    return { conversations: [], faq_logs: [] };
  }
}

function writeDB(data) {
  const fp = DB_PATH.replace('.db', '.json');
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// ============ 统一系统配置 ============
const DEFAULT_SYSTEM_CONFIG = {
  chat: {
    temperature: 0.7,    // 模型温度
    topP: 0.9,
    maxTokens: 1024
  },
  retrieval: {
    topK: 5,             // 召回条数
    scoreThreshold: 0.35, // 相似度阈值
    enableRerank: true   // 是否启用重排序
  },
  conversation: {
    timeoutMs: 60000,    // 单次回答超时
    enableRewrite: true, // 答案口语化改写
    enableMemory: true   // 启用对话记忆
  },
  ui: {
    pageSize: 20         // 后台默认分页大小
  },
  multiDeptEnabled: false, // 多部门数据隔离开关
  defaultDepartment: ''    // 默认部门（未分配人员归入此项）
};

function loadSystemConfig() {
  if (!fs.existsSync(SYSTEM_CONFIG_PATH)) {
    saveSystemConfig(DEFAULT_SYSTEM_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_SYSTEM_CONFIG));
  }
  try {
    const data = JSON.parse(fs.readFileSync(SYSTEM_CONFIG_PATH, 'utf8'));
    return deepMergeConfig(DEFAULT_SYSTEM_CONFIG, data);
  } catch (e) {
    console.error('[data] 系统配置读取失败：', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_SYSTEM_CONFIG));
  }
}

function saveSystemConfig(data) {
  const merged = deepMergeConfig(DEFAULT_SYSTEM_CONFIG, data || {});
  fs.writeFileSync(SYSTEM_CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// 深层合并，确保缺省字段补齐
function deepMergeConfig(def, src) {
  const out = Array.isArray(def) ? [] : {};
  if (Array.isArray(def)) return Array.isArray(src) ? src : def;
  for (const k of Object.keys(def)) {
    if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) {
      out[k] = deepMergeConfig(def[k], (src && src[k]) || {});
    } else {
      out[k] = (src && src[k] !== undefined) ? src[k] : def[k];
    }
  }
  // 保留 src 中多余字段（兼容未来扩展）
  if (src && typeof src === 'object') {
    for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  }
  return out;
}

// ============ 同义词 ============
function loadSynonyms() {
  if (!fs.existsSync(SYNONYMS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(SYNONYMS_PATH, 'utf8')); } catch (e) { return []; }
}
function saveSynonyms(data) {
  fs.writeFileSync(SYNONYMS_PATH, JSON.stringify(data, null, 2));
}

// ============ 停用词 ============
function loadStopwords() {
  if (!fs.existsSync(STOPWORDS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(STOPWORDS_PATH, 'utf8')); } catch (e) { return []; }
}
function saveStopwords(data) {
  fs.writeFileSync(STOPWORDS_PATH, JSON.stringify(data, null, 2));
}

// ============ 系统公告 / Banner ============
const DEFAULT_ANNOUNCEMENT = { enabled: false, title: '', content: '', level: 'info', updatedAt: null, updatedBy: '' };
function loadAnnouncement() {
  if (!fs.existsSync(ANNOUNCEMENT_PATH)) return { ...DEFAULT_ANNOUNCEMENT };
  try {
    const data = JSON.parse(fs.readFileSync(ANNOUNCEMENT_PATH, 'utf8'));
    return { ...DEFAULT_ANNOUNCEMENT, ...data };
  } catch (e) { return { ...DEFAULT_ANNOUNCEMENT }; }
}
function saveAnnouncement(data) {
  const merged = { ...DEFAULT_ANNOUNCEMENT, ...(data || {}) };
  fs.writeFileSync(ANNOUNCEMENT_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ============ SSO 白名单（独立数据源，带审计元数据）============
function loadSSOWhitelist() {
  if (!fs.existsSync(SSO_WHITELIST_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(SSO_WHITELIST_PATH, 'utf8')); } catch (e) { return []; }
}
function saveSSOWhitelist(data) {
  fs.writeFileSync(SSO_WHITELIST_PATH, JSON.stringify(data, null, 2));
}

// ============ 部门目录（多部门隔离基础）============
function loadDepartments() {
  if (!fs.existsSync(DEPARTMENTS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(DEPARTMENTS_PATH, 'utf8')); } catch (e) { return []; }
}
function saveDepartments(data) {
  fs.writeFileSync(DEPARTMENTS_PATH, JSON.stringify(data, null, 2));
}

// ============ 初始化 ============
// 初始化时执行一次（规范化FAQ分类）
setTimeout(() => { try { normalizeFAQCategories(); } catch(e) {} }, 1000);

// ============ 导出 ============
module.exports = {
  // FAQ
  loadFAQ,
  saveFAQ,
  getFAQ,
  getFAQByCategory,
  normalizeFAQCategories,
  
  // 分类
  loadCategories,
  saveCategories,
  
  // 组织架构
  loadOrg,
  saveOrg,
  
  // 人员
  loadPersonnel,
  savePersonnel,
  
  // 权限
  loadPermissions,
  savePermissions,
  PERMISSION_CATALOG,
  ALL_PERMISSION_CODES,

  // 软件信息（可编辑品牌/名称）
  loadSoftwareInfo,
  saveSoftwareInfo,

  // A8配置
  loadA8Config,
  saveA8Config,

  // 知识库
  loadKnowledgeBases,
  saveKnowledgeBases,
  getKnowledgeBases,

  // 对话数据
  readDB,
  writeDB,

  // 统一系统配置
  loadSystemConfig,
  saveSystemConfig,

  // 同义词 / 停用词
  loadSynonyms,
  saveSynonyms,
  loadStopwords,
  saveStopwords,

  // 公告
  loadAnnouncement,
  saveAnnouncement,

  // SSO 白名单
  loadSSOWhitelist,
  saveSSOWhitelist,

  // 部门
  loadDepartments,
  saveDepartments,

  // 路径常量（供其他模块使用）
  CATEGORIES_PATH,
  FAQ_PATH,
  ORG_PATH,
  PERSONNEL_PATH,
  PERMISSIONS_PATH,
  A8_CONFIG_PATH,
  SOFTWARE_INFO_PATH,
  KNOWLEDGE_BASES_PATH,
  DB_PATH,
  SYSTEM_CONFIG_PATH,
  SYNONYMS_PATH,
  STOPWORDS_PATH,
  ANNOUNCEMENT_PATH,
  SSO_WHITELIST_PATH,
  DEPARTMENTS_PATH
};
