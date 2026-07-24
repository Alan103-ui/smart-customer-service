// 意图在线标注 / 纠错反馈闭环模块
// 职责：
//  1) 采集人工纠错（聊天内在线标注 + 后台纠错）
//  2) 把纠错沉淀为 few-shot 样例（反哺 LLM 分类器）与高频确定性规则（绕过 LLM 直出）
//  3) 提供统计与查询接口
//
// 与 intent-understanding.js 的关系：本模块被其 require，用于实时注入规则/样例。
// 为避免循环依赖导致的常量绑定失效，INTENT_TAXONOMY 通过 live lookup 访问。

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CORRECTIONS_PATH = path.join(DATA_DIR, 'intent-corrections.json');
const FEEDBACK_PATH = path.join(DATA_DIR, 'intent-feedback.json');

// 内存缓存（启动时加载，apply 后刷新）
let _correctionsCache = null;
let _feedbackCache = null;

function loadCorrections() {
  if (_correctionsCache) return _correctionsCache;
  if (!fs.existsSync(CORRECTIONS_PATH)) {
    _correctionsCache = [];
    return _correctionsCache;
  }
  try {
    _correctionsCache = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8'));
  } catch (e) {
    console.error('[IntentFeedback] 读取纠错文件失败:', e.message);
    _correctionsCache = [];
  }
  return _correctionsCache;
}

function saveCorrections(list) {
  _correctionsCache = list;
  fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(list, null, 2));
}

function loadFeedback() {
  if (_feedbackCache) return _feedbackCache;
  if (!fs.existsSync(FEEDBACK_PATH)) {
    _feedbackCache = { fewShot: [], rules: [], lastAppliedAt: null, stats: null };
    return _feedbackCache;
  }
  try {
    _feedbackCache = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8'));
  } catch (e) {
    console.error('[IntentFeedback] 读取反馈文件失败:', e.message);
    _feedbackCache = { fewShot: [], rules: [], lastAppliedAt: null, stats: null };
  }
  return _feedbackCache;
}

function saveFeedback(fb) {
  _feedbackCache = fb;
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(fb, null, 2));
}

// live lookup，避免循环依赖时取到未初始化的导出
function getTaxonomy() {
  try {
    const mod = require('./intent-understanding');
    return mod.INTENT_TAXONOMY || { level1: [], level2: {} };
  } catch (e) {
    return { level1: ['query', 'process', 'complaint', 'suggestion', 'greeting'], level2: {} };
  }
}

function isValidIntent(level1, level2) {
  const tax = getTaxonomy();
  if (!tax.level1.includes(level1)) return false;
  if (level2 && tax.level2[level1] && !tax.level2[level1].includes(level2)) return false;
  return true;
}

function normalize(text) {
  return (text || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

// ============ 纠错采集 ============
function addCorrection({
  source = 'admin',        // 'chat' | 'admin'
  sessionId = null,
  messageId = null,
  userMessage,
  originalIntent = null,   // { level1, level2, confidence }
  correctedIntent,         // { level1, level2 }
  correctedBy = 'unknown',
  note = '',
  makeRule = false
} = {}) {
  if (!userMessage || !userMessage.trim()) {
    throw new Error('userMessage 不能为空');
  }
  if (!correctedIntent || !correctedIntent.level1) {
    throw new Error('correctedIntent.level1 不能为空');
  }
  if (!isValidIntent(correctedIntent.level1, correctedIntent.level2)) {
    throw new Error('correctedIntent 不在意图分类体系内: ' + JSON.stringify(correctedIntent));
  }

  const list = loadCorrections();
  const record = {
    id: uuidv4(),
    source,
    sessionId,
    messageId,
    userMessage: userMessage.trim(),
    originalIntent: originalIntent || null,
    correctedIntent: {
      level1: correctedIntent.level1,
      level2: correctedIntent.level2 || null
    },
    correctedBy,
    note: note || '',
    makeRule: !!makeRule,
    applied: false,
    createdAt: new Date().toISOString()
  };
  list.push(record);
  saveCorrections(list);
  console.log('[IntentFeedback] 新增纠错:', record.id, userMessage, '->', JSON.stringify(record.correctedIntent));
  // 闭环：每条纠错立即重新沉淀为规则 / few-shot，使分类器实时生效（无需再手工点 apply）
  try {
    applyFeedback();
  } catch (e) {
    console.error('[IntentFeedback] 自动沉淀反馈失败:', e.message);
  }
  return record;
}

function listCorrections({ source, applied, limit = 100, offset = 0, search } = {}) {
  let list = loadCorrections();
  if (source) list = list.filter(c => c.source === source);
  if (applied !== undefined) list = list.filter(c => c.applied === applied);
  if (search) {
    const s = normalize(search);
    list = list.filter(c => normalize(c.userMessage).includes(s));
  }
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const total = list.length;
  const paged = list.slice(offset, offset + limit);
  return { total, items: paged };
}

function deleteCorrection(id) {
  const list = loadCorrections();
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveCorrections(list);
  return true;
}

// ============ 反馈沉淀（核心：把纠错反哺分类器）============
function applyFeedback() {
  const list = loadCorrections();
  const tax = getTaxonomy();

  // 1) few-shot 样例：每个有效纠错 -> 一条样例（按归一化问题去重，取最新）
  const fewShotMap = new Map();
  // 2) 规则：makeRule=true 或 同一问题被纠到同一意图 >=2 次 -> 确定性规则
  const ruleFreq = new Map(); // key: normQuery -> { target:{level1,level2}, count }

  for (const c of list) {
    if (!c.correctedIntent || !c.correctedIntent.level1) continue;
    if (!tax.level1.includes(c.correctedIntent.level1)) continue;

    const normQ = normalize(c.userMessage);
    // few-shot（去重：同一问题保留最新一条）
    if (!fewShotMap.has(normQ)) {
      fewShotMap.set(normQ, {
        query: c.userMessage.trim(),
        primaryIntent: {
          level1: c.correctedIntent.level1,
          level2: c.correctedIntent.level2 || null,
          confidence: 0.97
        },
        entities: []
      });
    }
    // 规则频次统计
    const key = normQ;
    if (!ruleFreq.has(key)) ruleFreq.set(key, { target: c.correctedIntent, count: 0 });
    if (ruleFreq.get(key).target.level1 === c.correctedIntent.level1 &&
        ruleFreq.get(key).target.level2 === (c.correctedIntent.level2 || null)) {
      ruleFreq.get(key).count += 1;
    }
  }

  const fewShot = Array.from(fewShotMap.values());

  // 生成规则
  const rules = [];
  const appliedIds = new Set();
  for (const c of list) {
    const normQ = normalize(c.userMessage);
    const freq = ruleFreq.get(normQ);
    if (!freq) continue;
    const shouldRule = c.makeRule === true || freq.count >= 2;
    if (!shouldRule) continue;
    // 去重（同一问题只生成一条规则，取最新）
    if (rules.some(r => normalize(r.keyword) === normQ)) continue;
    rules.push({
      id: 'rule_' + Buffer.from(normQ).toString('base64').replace(/=+$/, '').slice(0, 16),
      keyword: c.userMessage.trim(),
      level1: c.correctedIntent.level1,
      level2: c.correctedIntent.level2 || null,
      confidence: 0.97,
      fromCorrectionId: c.id
    });
    appliedIds.add(c.id);
  }

  // 标记已沉淀的纠错
  let appliedCount = 0;
  for (const c of list) {
    if (appliedIds.has(c.id)) {
      c.applied = true;
      appliedCount += 1;
    }
  }
  saveCorrections(list);

  const fb = {
    fewShot,
    rules,
    lastAppliedAt: new Date().toISOString(),
    stats: {
      totalCorrections: list.length,
      appliedCorrections: appliedCount,
      fewShotCount: fewShot.length,
      ruleCount: rules.length
    }
  };
  saveFeedback(fb);
  console.log('[IntentFeedback] 反馈沉淀完成: fewShot=', fewShot.length, 'rules=', rules.length, 'applied=', appliedCount);
  return fb.stats;
}

function getFewShotExamples() {
  return loadFeedback().fewShot || [];
}

function getCorrectionRules() {
  return loadFeedback().rules || [];
}

function getCorrectionStats() {
  const list = loadCorrections();
  const fb = loadFeedback();
  const bySource = { chat: 0, admin: 0 };
  for (const c of list) bySource[c.source] = (bySource[c.source] || 0) + 1;
  return {
    totalCorrections: list.length,
    appliedCorrections: list.filter(c => c.applied).length,
    bySource,
    feedback: fb.stats || { totalCorrections: 0, appliedCorrections: 0, fewShotCount: 0, ruleCount: 0 },
    lastAppliedAt: fb.lastAppliedAt || null
  };
}

// 在线识别记录（来自 faq_logs）
function getRecognitions({ limit = 50, offset = 0, search } = {}) {
  const DB_PATH = path.join(DATA_DIR, 'conversations.json');
  let logs = [];
  try {
    if (fs.existsSync(DB_PATH)) {
      const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      logs = db.faq_logs || [];
    }
  } catch (e) {
    logs = [];
  }
  // 倒序：最新的在前
  logs = logs.slice().reverse();
  if (search) {
    const s = normalize(search);
    logs = logs.filter(l => normalize(l.question).includes(s));
  }
  const total = logs.length;
  const paged = logs.slice(offset, offset + limit).map((l, i) => ({
    id: l.id || `rec_${total - offset - i}`,
    question: l.question,
    intent: l.intent || null,
    intentLevel2: l.intentLevel2 || null,
    confidence: (typeof l.intentConfidence === 'number') ? l.intentConfidence : (l.confidence || null),
    createdAt: l.created_at || null
  }));
  return { total, items: paged };
}

module.exports = {
  addCorrection,
  listCorrections,
  deleteCorrection,
  applyFeedback,
  getFewShotExamples,
  getCorrectionRules,
  getCorrectionStats,
  getRecognitions,
  isValidIntent,
  // 测试/运维辅助
  _loadCorrections: loadCorrections,
  _saveCorrections: saveCorrections,
  _loadFeedback: loadFeedback
};
