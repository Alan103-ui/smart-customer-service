/**
 * 迁移脚本：将 personnel.json 中的明文密码转换为哈希格式
 * 运行：node migrate-personnel-password.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PERSONNEL_PATH = path.join(__dirname, '../data/personnel.json');

// 密码哈希函数（与 auth.js 和 rag-admin.js 保持一致）
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

// 读取人员数据
const personnel = JSON.parse(fs.readFileSync(PERSONNEL_PATH, 'utf8'));

console.log(`📋 开始迁移 ${personnel.length} 条人员记录...`);

let migratedCount = 0;

// 迁移密码
personnel.forEach(p => {
  if (p.password && !p.passwordHash) {
    // 有明文密码，且没有 passwordHash
    p.passwordHash = hashPassword(p.password);
    delete p.password;  // 删除明文密码
    migratedCount++;
    console.log(`  ✅ 已迁移：${p.name} (${p.username})`);
  } else if (p.passwordHash) {
    console.log(`  ⏭️  跳过（已有密码哈希）：${p.name} (${p.username})`);
  } else {
    console.log(`  ⚠️  警告（无密码）：${p.name} (${p.username})`);
  }
});

// 保存
fs.writeFileSync(PERSONNEL_PATH, JSON.stringify(personnel, null, 2));

console.log(`\n✅ 迁移完成！共迁移 ${migratedCount} 条记录。`);
console.log(`📁 文件已保存：${PERSONNEL_PATH}`);
