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
    const sso = cfg.sso || {};
    res.json({
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      username: cfg.username,
      hasSecret: !!cfg.secret,
      hasFixedToken: !!cfg.fixedToken,
      secretMasked: oa.maskCredential(cfg.secret),
      fixedTokenMasked: oa.maskCredential(cfg.fixedToken),
      sso: {
        mode: sso.mode || 'whitelist',
        requireSign: !!sso.requireSign,
        hasSignSecret: !!sso.signSecret,
        signSecretMasked: oa.maskCredential(sso.signSecret || ''),
        trustedIps: Array.isArray(sso.trustedIps) ? sso.trustedIps : [],
        whitelist: Array.isArray(sso.whitelist) ? sso.whitelist : [],
        count: Array.isArray(sso.whitelist) ? sso.whitelist.length : 0,
      },
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
      // 保留已有 SSO 白名单配置，避免保存连接信息时误清空
      sso: existing.sso,
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

// ============ SSO 单点登录白名单管理 ============
// 读取白名单配置（脱敏签名密钥）
router.get('/whitelist', (req, res) => {
  try {
    const cfg = oa.loadOAConfig();
    const sso = cfg.sso || {};
    res.json({
      mode: sso.mode || 'whitelist',
      requireSign: !!sso.requireSign,
      hasSignSecret: !!sso.signSecret,
      signSecretMasked: oa.maskCredential(sso.signSecret || ''),
      trustedIps: Array.isArray(sso.trustedIps) ? sso.trustedIps : [],
      whitelist: Array.isArray(sso.whitelist) ? sso.whitelist : [],
      count: Array.isArray(sso.whitelist) ? sso.whitelist.length : 0,
      ssoUrl: '/api/auth/sso/oa',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增白名单条目（单个/批量/整体覆盖）或修改模式、签名、IP 白名单
router.post('/whitelist', (req, res) => {
  try {
    const cfg = oa.loadOAConfig();
    const sso = cfg.sso || {};
    const { employeeId, employeeIds, mode, requireSign, signSecret, trustedIps, whitelist } = req.body || {};
    if (mode) sso.mode = mode === 'open' ? 'open' : 'whitelist';
    if (typeof requireSign === 'boolean') sso.requireSign = requireSign;
    if (signSecret && String(signSecret).trim()) sso.signSecret = String(signSecret).trim();
    if (Array.isArray(trustedIps)) sso.trustedIps = trustedIps.map(String).map(s => s.trim()).filter(Boolean);
    let list = Array.isArray(sso.whitelist) ? sso.whitelist.slice() : [];
    if (Array.isArray(whitelist)) {
      list = Array.from(new Set(list.concat(whitelist.map(String).map(s => s.trim()).filter(Boolean))));
    }
    if (employeeId) {
      const e = String(employeeId).trim();
      if (e && !list.includes(e)) list.push(e);
    }
    if (Array.isArray(employeeIds)) {
      for (const e of employeeIds) { const s = String(e).trim(); if (s && !list.includes(s)) list.push(s); }
    }
    sso.whitelist = list;
    oa.saveOAConfig(Object.assign({}, cfg, { sso }));
    res.json({ success: true, count: list.length, whitelist: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除白名单条目
router.delete('/whitelist/:employeeId', (req, res) => {
  try {
    const cfg = oa.loadOAConfig();
    const sso = cfg.sso || {};
    const e = decodeURIComponent(req.params.employeeId);
    const list = (Array.isArray(sso.whitelist) ? sso.whitelist : []).filter(x => String(x) !== e);
    sso.whitelist = list;
    oa.saveOAConfig(Object.assign({}, cfg, { sso }));
    res.json({ success: true, count: list.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 一键导入全部 OA 同步人员工号到白名单
router.post('/whitelist/sync-all', async (req, res) => {
  try {
    const members = await oa.getAllOrgMembers();
    const ids = (members || []).map(m => m.code).filter(Boolean).map(String).map(s => s.trim());
    const cfg = oa.loadOAConfig();
    const sso = cfg.sso || {};
    const before = Array.isArray(sso.whitelist) ? sso.whitelist.length : 0;
    sso.whitelist = Array.from(new Set((sso.whitelist || []).concat(ids)));
    oa.saveOAConfig(Object.assign({}, cfg, { sso }));
    res.json({ success: true, count: sso.whitelist.length, added: sso.whitelist.length - before });
  } catch (e) {
    res.json({ success: false, error: e.message });
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
          // 仅当 OA 返回有效登录名（非 oa_ 兜底）时才更新，避免把已有真实账号退化回兜底名
          username: (rec.username && !String(rec.username).startsWith('oa_')) ? rec.username : exist.username,
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
