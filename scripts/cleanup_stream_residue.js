// 清理流式输出 e2e 测试残留数据（一次性工具）
// 运行：node scripts/cleanup_stream_residue.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MEM_DIR = path.join(ROOT, 'data', 'dialogue-memory');
const CONV_FILE = path.join(ROOT, 'data', 'conversations.json');
const SESSION_MARK = 'e2e_stream';

let changed = 0;

// 1) 删除流式 e2e 直接创建的会话记忆文件
['e2e_stream_1784603717049.json', 'e2e_stream_1784603717049-embeddings.json'].forEach((f) => {
  const p = path.join(MEM_DIR, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('[删]', f); changed++; }
  else console.log('[跳过] 不存在', f);
});

// 2) user_001.json：移除 e2e_stream 会话的 round
const u = path.join(MEM_DIR, 'user_001.json');
if (fs.existsSync(u)) {
  const arr = JSON.parse(fs.readFileSync(u, 'utf8'));
  const filtered = arr.filter((r) =>
    !String(r.sessionId || '').includes(SESSION_MARK) &&
    !String(r.roundId || '').includes(SESSION_MARK)
  );
  if (filtered.length !== arr.length) {
    fs.writeFileSync(u, JSON.stringify(filtered, null, 2));
    console.log(`[清] user_001.json: ${arr.length} -> ${filtered.length} 条`);
    changed++;
  } else {
    console.log('[无需] user_001.json 无残留');
  }
}

// 3) conversations.json：移除 e2e_stream 会话
if (fs.existsSync(CONV_FILE)) {
  const obj = JSON.parse(fs.readFileSync(CONV_FILE, 'utf8'));
  let removed = 0;
  if (Array.isArray(obj.conversations)) {
    const before = obj.conversations.length;
    obj.conversations = obj.conversations.filter((x) => !String(x.session_id || '').includes(SESSION_MARK));
    removed += before - obj.conversations.length;
  }
  if (Array.isArray(obj.faq_logs)) {
    const before = obj.faq_logs.length;
    obj.faq_logs = obj.faq_logs.filter((x) => !String(x.session_id || '').includes(SESSION_MARK));
    removed += before - obj.faq_logs.length;
  }
  if (removed > 0) {
    fs.writeFileSync(CONV_FILE, JSON.stringify(obj, null, 2));
    console.log(`[清] conversations.json: 移除 ${removed} 条 e2e_stream`);
    changed++;
  } else {
    console.log('[无需] conversations.json 无残留');
  }
}

console.log(changed > 0 ? `\n✅ 已清理 ${changed} 处残留` : '\n✅ 无残留，数据已干净');
