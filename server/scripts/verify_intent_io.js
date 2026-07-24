// 验证意图纠错「导入/导出」核心链路（不依赖 HTTP / multer）
// 1) isValidIntent 校验（导入归一化用到）
// 2) 追加一条 makeRule 纠错 -> save -> applyFeedback -> 规则生成
// 3) 导出 CSV 格式与导入 CSV 解析对称（round-trip）
// 4) overwrite 快照调用（验证 createBackup 可被调用，不真正清库）
// 运行前自动备份数据文件，运行后原样恢复，不影响运行中的服务。

const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const INTENT_FB = require('../intent-feedback');
const dataBackup = require('../data-backup');

const DATA_DIR = path.join(__dirname, '../data');
const cPath = path.join(DATA_DIR, 'intent-corrections.json');
const fPath = path.join(DATA_DIR, 'intent-feedback.json');
const backupC = fs.existsSync(cPath) ? fs.readFileSync(cPath, 'utf8') : null;
const backupF = fs.existsSync(fPath) ? fs.readFileSync(fPath, 'utf8') : null;

// —— 与 rag-admin.js 完全一致的 CSV 解析 / 转义（用于格式对称验证）——
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r/g, '').replace(/\n/g, ' ') + '"';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name); }
}

try {
  console.log('— 1) isValidIntent 校验 —');
  check('合法意图 query/null 通过', INTENT_FB.isValidIntent('query', null) === true);
  check('非法意图 bogus 拒绝', INTENT_FB.isValidIntent('bogus', null) === false);

  console.log('— 2) 追加纠错 -> 沉淀为规则 —');
  const before = INTENT_FB._loadCorrections().length;
  const testCorr = {
    id: 'rule_imp_test_' + uuid(),
    source: 'import', sessionId: null, messageId: null,
    userMessage: '单元测试导入的纠错问题XYZ',
    originalIntent: null,
    correctedIntent: { level1: 'query', level2: null },
    correctedBy: 'import', note: 'test', makeRule: true, applied: false,
    createdAt: new Date().toISOString()
  };
  const list = INTENT_FB._loadCorrections();
  list.push(testCorr);
  INTENT_FB._saveCorrections(list);
  const stats = INTENT_FB.applyFeedback();
  const rules = INTENT_FB.getCorrectionRules();
  const found = rules.some(r => (r.keyword || '').includes('单元测试导入的纠错问题XYZ'));
  check('纠错数 +1', stats.totalCorrections === before + 1);
  check('生成规则含导入项', found === true);
  check('ruleCount >= 1', stats.ruleCount >= 1);

  console.log('— 3) 导出 CSV 与导入解析对称 —');
  // 模拟导出规则 CSV（与路由同款 esc）
  const cols = ['keyword', 'level1', 'level2', 'confidence', 'fromCorrectionId'];
  const sampleRule = { keyword: '测试,带逗号"引号', level1: 'query', level2: '', confidence: 0.97, fromCorrectionId: 'cid1' };
  const csv = '﻿' + [cols.map(esc).join(','),
    [sampleRule.keyword, sampleRule.level1, sampleRule.level2, sampleRule.confidence, sampleRule.fromCorrectionId].map(esc).join(',')].join('\n');
  // 模拟导入解析
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length);
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const idxKeyword = header.indexOf('keyword') >= 0 ? header.indexOf('keyword') : header.indexOf('usermessage');
  const idxL1 = header.indexOf('level1');
  const idxL2 = header.indexOf('level2');
  const cells = splitCsvLine(lines[1]);
  const parsed = {
    keyword: idxKeyword >= 0 ? (cells[idxKeyword] || '').trim() : '',
    level1: (cells[idxL1] || '').trim(),
    level2: idxL2 >= 0 ? (cells[idxL2] || '').trim() : ''
  };
  check('CSV 逗号/引号转义正确还原', parsed.keyword === '测试,带逗号"引号');
  check('CSV level1 解析正确', parsed.level1 === 'query');
  check('CSV level2 解析正确', parsed.level2 === '');
  check('解析结果通过 isValidIntent', INTENT_FB.isValidIntent(parsed.level1, parsed.level2 || null) === true);

  console.log('— 4) overwrite 快照可调用 —');
  let snapOk = false;
  try { dataBackup.createBackup(); snapOk = true; } catch (e) { snapOk = false; console.log('  (快照异常被容忍):', e.message); }
  check('createBackup 可被调用（覆盖前保护）', snapOk === true);

  console.log('\n结果:', pass, '通过 /', fail, '失败');
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  if (backupC !== null) fs.writeFileSync(cPath, backupC);
  if (backupF !== null) fs.writeFileSync(fPath, backupF);
  console.log('已恢复原始数据文件（不影响运行中的服务）');
}
