// 数据备份模块：对 /data 下的核心业务数据做快照备份、历史管理、恢复与自动备份
// 备份目录：data/backups/<时间戳>/{manifest.json, 各数据文件}
// 配置：data/backup-config.json { enabled, retention, lastRun, nextRun }

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CONFIG_PATH = path.join(DATA_DIR, 'backup-config.json');

// 需要备份的核心数据文件（排除 rag-eval-* 等瞬时评估产物与 backups 自身）
const CORE_DATA_FILES = [
  'faq.json', 'categories.json', 'conversations.json', 'personnel.json', 'org_structure.json',
  'permissions.json', 'users.json', 'system-config.json', 'software-info.json', 'a8_config.json',
  'oa-config.json', 'sso-whitelist.json', 'knowledge_bases.json', 'announcement.json',
  'intent-corrections.json', 'intent-feedback.json', 'synonyms.json', 'stopwords.json', 'vector-store.json'
];

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  const mb = kb / 1024;
  if (mb < 1024) return mb.toFixed(2) + ' MB';
  return (mb / 1024).toFixed(2) + ' GB';
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  // 默认开启自动备份（每日凌晨2:00，保留30天）：避免部署后遗漏导致数据无备份。
  // 若运维显式将 enabled 设为 false，此兜底不覆盖其意图。
  catch (e) { return { enabled: true, retention: 30, lastRun: null, nextRun: null }; }
}

function saveConfig(cfg) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// 当前待备份的数据文件清单（含大小/修改时间）
function listSourceFiles() {
  ensureDir(DATA_DIR);
  return CORE_DATA_FILES
    .filter(f => fs.existsSync(path.join(DATA_DIR, f)))
    .map(f => {
      const st = fs.statSync(path.join(DATA_DIR, f));
      return { name: f, size: st.size, sizeText: fmtSize(st.size), mtime: st.mtime.toISOString() };
    });
}

// 备份历史（按时间倒序）
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const dirs = fs.readdirSync(BACKUP_DIR).filter(d => {
    try { return fs.statSync(path.join(BACKUP_DIR, d)).isDirectory(); } catch (e) { return false; }
  });
  const list = dirs.map(d => {
    const mp = path.join(BACKUP_DIR, d, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { /* 损坏清单忽略 */ }
    return {
      id: d,
      createdAt: manifest ? manifest.createdAt : d,
      files: manifest ? manifest.files.length : 0,
      size: manifest ? manifest.totalSize : 0,
      sizeText: manifest ? fmtSize(manifest.totalSize) : '-'
    };
  });
  list.sort((a, b) => b.id.localeCompare(a.id));
  return list;
}

// 创建一次备份
function createBackup() {
  ensureDir(BACKUP_DIR);
  const id = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const dir = path.join(BACKUP_DIR, id);
  ensureDir(dir);
  const files = [];
  let total = 0;
  for (const f of CORE_DATA_FILES) {
    const src = path.join(DATA_DIR, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dir, f));
    const sz = fs.statSync(src).size;
    files.push({ name: f, size: sz });
    total += sz;
  }
  const manifest = { id, createdAt: new Date().toISOString(), files, totalSize: total };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // 写入触发备份的标记，便于知道来源
  const removed = pruneBackups(loadConfig().retention || 30);
  const cfg = loadConfig();
  cfg.lastRun = manifest.createdAt;
  cfg.nextRun = nextRunISO();
  saveConfig(cfg);
  console.log(`[Backup] 创建备份 ${id}（${files.length} 文件, ${fmtSize(total)}），清理旧备份 ${removed} 份`);
  return { manifest, removed };
}

// 从备份恢复（覆盖回 data/）
function restoreBackup(id) {
  const dir = path.join(BACKUP_DIR, id);
  if (!fs.existsSync(dir)) throw new Error('备份不存在: ' + id);
  const mp = path.join(dir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); }
  catch (e) { throw new Error('备份清单损坏: ' + id); }
  const restored = [];
  for (const f of (manifest.files || [])) {
    const src = path.join(dir, f.name);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(DATA_DIR, f.name)); restored.push(f.name); }
  }
  console.log(`[Backup] 恢复备份 ${id}（${restored.length} 文件）`);
  return { id, restored, count: restored.length };
}

// 保留最近 retain 份，其余删除
function pruneBackups(retain) {
  retain = Math.max(1, parseInt(retain) || 30);
  const list = listBackups(); // 已倒序
  const toRemove = list.slice(retain);
  for (const b of toRemove) {
    try { fs.rmSync(path.join(BACKUP_DIR, b.id), { recursive: true, force: true }); }
    catch (e) { console.error('[Backup] 删除旧备份失败', b.id, e.message); }
  }
  return toRemove.length;
}

// 删除指定备份
function deleteBackup(id) {
  const dir = path.join(BACKUP_DIR, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[Backup] 删除备份 ${id}`);
  return true;
}

// 计算下次自动备份时间（每天凌晨 2:00）
function nextRunISO() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

// ============ 自动备份（每日凌晨 2:00）============
let _timer = null;
function startAutoBackup() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  scheduleNext();
}
function scheduleNext() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const delay = new Date(nextRunISO()).getTime() - Date.now();
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    try { createBackup(); } catch (e) { console.error('[Backup] 自动备份失败:', e.message); }
    scheduleNext();
  }, delay);
  console.log(`[Backup] 自动备份已排程，下次执行 ${nextRunISO()}`);
}
function stopAutoBackup() { if (_timer) { clearTimeout(_timer); _timer = null; } }

module.exports = {
  listSourceFiles, listBackups, createBackup, restoreBackup, pruneBackups, deleteBackup,
  loadConfig, saveConfig, startAutoBackup, stopAutoBackup, fmtSize
};
