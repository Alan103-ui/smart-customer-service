'use strict';
/**
 * 致远 OA（seeyon / A8）基础信息管理 - 后端管理路由
 * 挂载路径：/api/admin/oa
 * 能力：配置读写、连接测试、实时拉取组织架构/人员、同步组织到本地、按 OA ID 导入人员。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const oa = require('./oa-client');

// ---- 本地数据存储（自包含，避免依赖 data.js 的导出细节）----
const DATA_DIR = path.join(__dirname, '../data');
const ORG_PATH = path.join(DATA_DIR, 'org_structure.json');
const PERSONNEL_PATH = path.join(DATA_DIR, 'personnel.json');

function loadOrg() {
  if (!fs.existsSync(ORG_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(ORG_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}
function saveOrg(list) {
  fs.writeFileSync(ORG_PATH, JSON.stringify(list, null, 2));
}
function loadPersonnel() {
  if (!fs.existsSync(PERSONNEL_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(PERSONNEL_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}
function savePersonnel(list) {
  fs.writeFileSync(PERSONNEL_PATH, JSON.stringify(list, null, 2));
}

// ============ 配置读取（脱敏）============
router.get('/config', (req, res) => {
  try {
    const cfg = oa.loadOAConfig();
    res.json({
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      username: cfg.username,
      hasSecret: !!cfg.secret,
      hasFixedToken: !!cfg.fixedToken,
      secretMasked: oa.maskCredential(cfg.secret),
      fixedTokenMasked: oa.maskCredential(cfg.fixedToken),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 配置保存 ============
router.post('/config', (req, res) => {
  try {
    const { enabled, baseUrl, username, secret, fixedToken } = req.body || {};
    const existing = oa.loadOAConfig();
    // secret / fixedToken 留空表示不修改（保留原值），避免脱敏值回写覆盖
    const saved = oa.saveOAConfig({
      enabled: enabled !== undefined ? !!enabled : existing.enabled,
      baseUrl: (baseUrl && String(baseUrl).trim()) ? String(baseUrl).trim() : existing.baseUrl,
      username: (username && String(username).trim()) ? String(username).trim() : existing.username,
      secret: secret && String(secret).trim() ? String(secret).trim() : existing.secret,
      fixedToken:
        fixedToken && String(fixedToken).trim() ? String(fixedToken).trim() : existing.fixedToken,
    });
    oa.clearTokenCache(); // 配置变更后强制刷新 token
    res.json({
      success: true,
      data: {
        enabled: saved.enabled,
        baseUrl: saved.baseUrl,
        username: saved.username,
        hasSecret: !!saved.secret,
        hasFixedToken: !!saved.fixedToken,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 测试连接 ============
router.post('/test', async (req, res) => {
  try {
    const token = await oa.getToken(true);
    const accounts = await oa.getOrgAccounts();
    res.json({
      success: true,
      message: '连接成功',
      tokenMasked: oa.maskCredential(token),
      orgCount: accounts.length,
      sampleAccount: accounts[0] ? { name: accounts[0].name, code: accounts[0].code } : null,
    });
  } catch (e) {
    res.json({ success: false, message: '连接失败：' + e.message });
  }
});

// ============ 实时拉取组织架构 ============
router.get('/org-accounts', async (req, res) => {
  try {
    const list = await oa.getOrgAccounts();
    res.json({ success: true, data: list });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 实时拉取某组织单位下的全部人员（预览）============
router.get('/members', async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ error: '缺少 accountId' });
    const list = await oa.getOrgMembersByAccount(accountId);
    res.json({
      success: true,
      total: list.length,
      data: list.map((m) => ({
        oaId: m.oaId,
        name: m.name,
        code: m.code,
        orgDepartmentName: m.raw.orgDepartmentName || '',
        orgPostName: m.raw.orgPostName || '',
        orgLevelName: m.raw.orgLevelName || '',
        email: m.email,
        phone: m.phone,
        isActive: m.enabled,
      })),
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 按 OA ID 实时查询人员 ============
router.get('/member', async (req, res) => {
  try {
    const { memberId } = req.query;
    if (!memberId) return res.status(400).json({ error: '缺少 memberId' });
    const m = await oa.getOrgMember(memberId);
    res.json({ success: true, data: m });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 同步组织架构到本地 ============
router.post('/sync-org', async (req, res) => {
  try {
    const accounts = await oa.getOrgAccounts();
    const local = loadOrg();
    const manual = local.filter((o) => o.source !== 'oa'); // 保留手工条目
    const merged = manual.slice();
    let added = 0;
    let updated = 0;
    for (const a of accounts) {
      const idx = merged.findIndex((o) => o.oaId === a.oaId);
      const node = {
        id: idx >= 0 ? merged[idx].id : 'org_oa_' + a.oaId,
        name: a.name,
        parentId: a.parentId ? 'org_oa_' + a.parentId : null,
        sortOrder: idx >= 0 ? merged[idx].sortOrder : merged.length,
        description: a.shortName ? 'OA:' + a.shortName : '致远OA同步',
        isActive: a.enabled,
        oaId: a.oaId,
        oaCode: a.code,
        source: 'oa',
        createdAt: idx >= 0 ? merged[idx].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) {
        merged[idx] = node;
        updated++;
      } else {
        merged.push(node);
        added++;
      }
    }
    saveOrg(merged);
    res.json({
      success: true,
      message: `同步完成：新增 ${added} 个、更新 ${updated} 个组织单元`,
      total: merged.length,
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 按 OA ID 导入/更新人员到本地 ============
router.post('/import-member', async (req, res) => {
  try {
    const { memberId } = req.body || {};
    if (!memberId) return res.status(400).json({ error: '缺少 memberId' });
    const m = await oa.getOrgMember(memberId);
    const rec = oa.oaMemberToPersonnel(m);
    const local = loadPersonnel();
    const exist = local.find((p) => p.oaId === rec.oaId || p.username === rec.username);
    if (exist) {
      Object.assign(exist, {
        name: rec.name,
        orgName: rec.orgName || '',
        postName: rec.postName || '',
        levelName: rec.levelName || '',
        email: rec.email,
        phone: rec.phone,
        isActive: rec.isActive,
        oaAccountId: rec.oaAccountId,
        updatedAt: rec.updatedAt,
      });
      savePersonnel(local);
      return res.json({ success: true, message: '人员已更新', updated: true, data: exist });
    }
    const newRec = Object.assign({ id: 'user_oa_' + rec.oaId, passwordHash: null }, rec);
    local.push(newRec);
    savePersonnel(local);
    res.json({ success: true, message: '人员已导入（密码请通过SSO或重置密码设置）', data: newRec });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 批量按 ID 列表导入人员 ============
router.post('/batch-import', async (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: '缺少 memberIds 数组' });
    }

    const results = await oa.batchGetMembers(memberIds, {
      concurrency: 3,
      onProgress: (done, total, item) => {
        // SSE 不适用（Express 非 streaming），进度通过最终结果返回
      },
    });

    // 将成功的写入本地 personnel.json
    const local = loadPersonnel();
    let added = 0;
    let updated = 0;
    const imported = [];

    for (const m of results.successes) {
      const rec = oa.oaMemberToPersonnel(m);
      const exist = local.find((p) => p.oaId === rec.oaId || p.username === rec.username);
      if (exist) {
        Object.assign(exist, {
          name: rec.name,
          orgName: rec.orgName || '',
          postName: rec.postName || '',
          levelName: rec.levelName || '',
          email: rec.email,
          phone: rec.phone,
          isActive: rec.isActive,
          oaAccountId: rec.oaAccountId,
          updatedAt: rec.updatedAt,
        });
        updated++;
        imported.push({ name: rec.name, action: 'updated', username: exist.username });
      } else {
        const newRec = Object.assign({ id: 'user_oa_' + rec.oaId, passwordHash: null }, rec);
        local.push(newRec);
        added++;
        imported.push({ name: rec.name, action: 'added', username: rec.username });
      }
    }

    if (results.successes.length > 0) {
      savePersonnel(local);
    }

    res.json({
      success: true,
      message: `批量导入完成：成功 ${results.successes.length} 个（新增 ${added}、更新 ${updated}）、失败 ${results.failures.length} 个`,
      summary: {
        totalRequested: memberIds.length,
        successCount: results.successes.length,
        failCount: results.failures.length,
        added,
        updated,
      },
      imported,
      failures: results.failures,
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ 一键同步 OA 全部人员 ============
router.post('/sync-members', async (req, res) => {
  try {
    const { accountId } = req.body || {};
    // 拉取 OA 全量人员（指定单位或全部单位）
    let members;
    let byAccount = {};
    if (accountId) {
      members = await oa.getOrgMembersByAccount(accountId);
      byAccount[accountId] = members.length;
    } else {
      const r = await oa.fetchAllMembers();
      members = r.members;
      byAccount = r.byAccount;
    }

    const local = loadPersonnel();
    let added = 0;
    let updated = 0;
    const imported = [];
    for (const m of members) {
      const rec = oa.oaMemberToPersonnel(m);
      const exist = local.find((p) => p.oaId === rec.oaId || p.username === rec.username);
      if (exist) {
        Object.assign(exist, {
          name: rec.name,
          orgName: rec.orgName || '',
          postName: rec.postName || '',
          levelName: rec.levelName || '',
          email: rec.email,
          phone: rec.phone,
          isActive: rec.isActive,
          oaAccountId: rec.oaAccountId,
          updatedAt: rec.updatedAt,
        });
        updated++;
        imported.push({ name: rec.name, action: 'updated', username: exist.username });
      } else {
        const newRec = Object.assign({ id: 'user_oa_' + rec.oaId, passwordHash: null }, rec);
        local.push(newRec);
        added++;
        imported.push({ name: rec.name, action: 'added', username: rec.username });
      }
    }
    savePersonnel(local);

    res.json({
      success: true,
      message: `OA 人员同步完成：共 ${members.length} 人（新增 ${added}、更新 ${updated}）`,
      summary: { total: members.length, added, updated, byAccount },
      imported: imported.slice(0, 50), // 预览前 50 条，避免响应过大
      importedCount: imported.length,
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
