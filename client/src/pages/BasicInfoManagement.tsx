import { useState, useEffect } from 'react';

// 统一获取认证头
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('cs_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 安全的 API 请求：自动带 Token + 状态检查 + 数组保护
async function safeFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) { console.error(`[BasicInfo] ${url} 返回 ${res.status}`); return [] as unknown as T; }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  console.warn(`[BasicInfo] ${url} 返回非数组:`, typeof data);
  return [] as unknown as T;
}

type SubTab = 'org' | 'personnel' | 'permissions' | 'oa';

const PERM_LABELS: Record<string, string> = {
  'faq:read': 'FAQ查看',
  'faq:write': 'FAQ编辑',
  'faq:delete': 'FAQ删除',
  'category:manage': '分类管理',
  'personnel:manage': '人员管理',
  'org:manage': '组织管理',
  'permission:manage': '权限管理',
  'a8:config': 'A8配置',
  'chat:access': '前端聊天',
};

function formatPerms(arr: string[]): string {
  return arr.map(p => PERM_LABELS[p] || p).join('、');
}

export default function BasicInfoManagement() {
  const [subTab, setSubTab] = useState<SubTab>('org');
  const API = '/api/admin';

  // 组织架构
  const [orgList, setOrgList] = useState<any[]>([]);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any>(null);
  const [orgName, setOrgName] = useState('');
  const [orgParent, setOrgParent] = useState('');
  const [orgDesc, setOrgDesc] = useState('');
  const [orgActive, setOrgActive] = useState(true);

  // 人员
  const [pList, setPList] = useState<any[]>([]);
  const [showPModal, setShowPModal] = useState(false);
  const [editingP, setEditingP] = useState<any>(null);
  const [pName, setPName] = useState('');
  const [pUser, setPUser] = useState('');
  const [pPass, setPPass] = useState('');
  const [pOrgId, setPOrgId] = useState('');
  const [pRole, setPRole] = useState('');
  const [pActive, setPActive] = useState(true);
  
  // 重置密码
  const [showResetPwdModal, setShowResetPwdModal] = useState(false);
  const [resetPwdPersonId, setResetPwdPersonId] = useState<string>('');
  const [resetPwdNew, setResetPwdNew] = useState('');
  const [resetPwdConfirm, setResetPwdConfirm] = useState('');

  // 权限
  const [permList, setPermList] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [showPermModal, setShowPermModal] = useState(false);
  const [editingPerm, setEditingPerm] = useState<any>(null);
  const [permName, setPermName] = useState('');
  const [permCatId, setPermCatId] = useState('');
  const [permCatName, setPermCatName] = useState('');
  const [permArr, setPermArr] = useState<string[]>([]);

  // 致远 OA
  const [oa, setOa] = useState<any>({ enabled: false, baseUrl: '', username: '', secret: '', fixedToken: '' });
  const [oaTest, setOaTest] = useState<any>(null);
  const [oaMsg, setOaMsg] = useState('');
  const [oaMemberId, setOaMemberId] = useState('');
  const [oaMember, setOaMember] = useState<any>(null);

  // ==================== 数据获取 ====================
  const loadOrg = () => safeFetch<any[]>(API + '/org').then(setOrgList).catch(e => { console.error('加载组织失败:', e); setOrgList([]); });
  const loadP = () => safeFetch<any[]>(API + '/personnel').then(setPList).catch(e => { console.error('加载人员失败:', e); setPList([]); });
  const loadPerm = () => Promise.all([safeFetch<any[]>(API + '/permissions'), safeFetch<any[]>(API + '/categories')]).then(([p, c]) => { setPermList(p); setCats(c); }).catch(console.error);
  const loadOA = () => fetch(API + '/oa/config', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : {}).then((d: any) => setOa({ enabled: !!d.enabled, baseUrl: d.baseUrl || '', username: d.username || '', secret: '', fixedToken: '' })).catch(() => {});

  useEffect(() => {
    if (subTab === 'org') loadOrg();
    if (subTab === 'personnel') loadP();
    if (subTab === 'permissions') loadPerm();
    if (subTab === 'oa') loadOA();
  }, [subTab]);

  // ==================== 组织架构保存 ====================
  const saveOrg = async () => {
    const body = { name: orgName, parentId: orgParent || null, description: orgDesc, isActive: orgActive };
    const url = editingOrg ? (API + '/org/' + editingOrg.id) : (API + '/org');
    const method = editingOrg ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowOrgModal(false); resetOrgForm(); loadOrg(); }
    else alert(data.error || '保存失败');
  };
  const resetOrgForm = () => { setOrgName(''); setOrgParent(''); setOrgDesc(''); setOrgActive(true); setEditingOrg(null); };
  const editOrg = (o: any) => { setEditingOrg(o); setOrgName(o.name); setOrgParent(o.parentId || ''); setOrgDesc(o.description || ''); setOrgActive(o.isActive); setShowOrgModal(true); };
  const delOrg = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/org/' + id, { method: 'DELETE', headers: getAuthHeaders() }).then(r => r.json()); if (r.success) loadOrg(); else alert(r.error); };

  // ==================== 人员保存 ====================
  const saveP = async () => {
    const body = { name: pName, username: pUser, password: pPass, orgId: pOrgId || null, orgName: Array.isArray(orgList) ? orgList.find((o: any) => o.id === pOrgId)?.name || '' : '', roleName: pRole, isActive: pActive };
    const url = editingP ? (API + '/personnel/' + editingP.id) : (API + '/personnel');
    const method = editingP ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowPModal(false); resetPForm(); loadP(); }
    else alert(data.error || '保存失败');
  };
  const resetPForm = () => { setPName(''); setPUser(''); setPPass(''); setPOrgId(''); setPRole(''); setPActive(true); setEditingP(null); };
  const editP = (p: any) => { setEditingP(p); setPName(p.name); setPUser(p.username); setPPass(''); setPOrgId(p.orgId || ''); setPRole(p.roleName || ''); setPActive(p.isActive); setShowPModal(true); };
  const delP = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/personnel/' + id, { method: 'DELETE', headers: getAuthHeaders() }).then(r => r.json()); if (r.success) loadP(); else alert(r.error); };
  const resetPassword = async () => {
    if (!resetPwdNew || resetPwdNew.length < 4) { alert('新密码至少4位'); return; }
    if (resetPwdNew !== resetPwdConfirm) { alert('两次密码不一致'); return; }
    const r = await fetch(API + '/personnel/' + resetPwdPersonId + '/reset-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ newPassword: resetPwdNew })
    }).then(r => r.json());
    if (r.success) { alert('密码已重置'); setShowResetPwdModal(false); }
    else alert(r.error || '重置失败');
  };

  // ==================== 权限保存 ====================
  const savePerm = async () => {
    const body = { roleName: permName, categoryId: permCatId || null, categoryName: permCatName || '全部', permissions: permArr };
    const url = editingPerm ? (API + '/permissions/' + editingPerm.id) : (API + '/permissions');
    const method = editingPerm ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowPermModal(false); resetPermForm(); loadPerm(); }
    else alert(data.error || '保存失败');
  };
  const resetPermForm = () => { setPermName(''); setPermCatId(''); setPermCatName(''); setPermArr([]); setEditingPerm(null); };
  const editPerm = (r: any) => { setEditingPerm(r); setPermName(r.roleName); setPermCatId(r.categoryId || ''); setPermCatName(r.categoryName || ''); setPermArr(r.permissions || []); setShowPermModal(true); };
  const delPerm = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/permissions/' + id, { method: 'DELETE', headers: getAuthHeaders() }).then(r => r.json()); if (r.success) loadPerm(); else alert(r.error); };

  // ==================== 致远 OA ====================
  const saveOA = async () => {
    const r = await fetch(API + '/oa/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(oa) }).then(r => r.json());
    if (r.success) { setOaMsg('配置已保存'); loadOA(); } else setOaMsg('保存失败：' + (r.error || ''));
  };
  const testOA = async () => {
    setOaTest(null); setOaMsg('');
    const r = await fetch(API + '/oa/test', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json());
    setOaTest(r);
    setOaMsg(r.success ? ('连接成功，组织数：' + (r.orgCount || 0)) : ('连接失败：' + (r.message || '')));
  };
  const syncOAOrg = async () => {
    if (!confirm('确定从致远OA同步组织架构到本地？')) return;
    const r = await fetch(API + '/oa/sync-org', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json());
    setOaMsg(r.success ? r.message : ('同步失败：' + (r.error || '')));
    if (r.success) loadOrg();
  };
  const queryOAMember = async () => {
    if (!oaMemberId.trim()) { setOaMsg('请输入 OA 人员 ID'); return; }
    const r = await fetch(API + '/oa/member?memberId=' + encodeURIComponent(oaMemberId.trim()), { headers: getAuthHeaders() }).then(r => r.json());
    if (r.success) setOaMember(r.data); else { setOaMember(null); setOaMsg('查询失败：' + (r.error || '')); }
  };
  const importOAMember = async () => {
    if (!oaMember) return;
    const r = await fetch(API + '/oa/import-member', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ memberId: oaMemberId.trim() }) }).then(r => r.json());
    setOaMsg(r.success ? r.message : ('导入失败：' + (r.error || '')));
    if (r.success) loadP();
  };

  // ==================== 渲染 ====================
  return (
    <div>
      <h2>基础信息管理</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['org', 'personnel', 'permissions', 'oa'] as SubTab[]).map(k => (
          <button key={k} onClick={() => setSubTab(k)} style={{ padding: '6px 16px', borderRadius: 4, border: '1px solid #d9d9d9', background: subTab === k ? '#1890ff' : '#fff', color: subTab === k ? '#fff' : '#333' }}>{k === 'org' ? '组织架构' : k === 'personnel' ? '人员信息' : k === 'permissions' ? '权限管理' : '致远OA对接'}</button>
        ))}
      </div>

      {/* 组织架构 */}
      {subTab === 'org' && (
        <div>
          <button onClick={() => { resetOrgForm(); setShowOrgModal(true); }}>新增组织</button>
          <table border={1} cellPadding={8} style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>名称</th><th>上级</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {orgList.map(o => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{orgList.find((p: any) => p.id === o.parentId)?.name || '-'}</td>
                  <td>{o.isActive ? '启用' : '禁用'}</td>
                  <td>
                    <button onClick={() => editOrg(o)}>编辑</button>
                    <button onClick={() => delOrg(o.id)} style={{ marginLeft: 8 }}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 人员信息 */}
      {subTab === 'personnel' && (
        <div>
          <button onClick={() => { resetPForm(); setShowPModal(true); }}>新增人员</button>
          <table border={1} cellPadding={8} style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>姓名</th><th>用户名</th><th>组织</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {pList.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.username}</td>
                  <td>{p.orgName || '-'}</td>
                  <td>{p.roleName || '-'}</td>
                  <td>{p.isActive ? '启用' : '禁用'}</td>
                  <td>
                    <button onClick={() => editP(p)}>编辑</button>
                    <button onClick={() => { setResetPwdPersonId(p.id); setResetPwdNew(''); setResetPwdConfirm(''); setShowResetPwdModal(true); }} style={{ marginLeft: 8 }}>重置密码</button>
                    <button onClick={() => delP(p.id)} style={{ marginLeft: 8 }}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 权限管理 */}
      {subTab === 'permissions' && (
        <div>
          <button onClick={() => { resetPermForm(); setShowPermModal(true); }}>新增角色</button>
          <table border={1} cellPadding={8} style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>角色</th><th>可访问分类</th><th>权限</th><th>操作</th></tr></thead>
            <tbody>
              {permList.map(r => (
                <tr key={r.id}>
                  <td>{r.roleName}</td>
                  <td>{r.categoryName || '全部'}</td>
                  <td>{formatPerms(r.permissions || [])}</td>
                  <td>
                    {!r.isSystem && (
                      <>
                        <button onClick={() => editPerm(r)}>编辑</button>
                        <button onClick={() => delPerm(r.id)} style={{ marginLeft: 8 }}>删除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 致远 OA 对接 */}
      {subTab === 'oa' && (
        <div style={{ maxWidth: 700 }}>
          <div style={{ background: '#f6f8fa', padding: 12, borderRadius: 6, marginBottom: 12 }}>
            <label><input type="checkbox" checked={oa.enabled} onChange={e => setOa({ ...oa, enabled: e.target.checked })} /> 启用致远OA对接</label>
          </div>
          <div style={{ marginTop: 8 }}>服务地址：<input value={oa.baseUrl} onChange={e => setOa({ ...oa, baseUrl: e.target.value })} placeholder="http://IP:端口" style={{ width: 380 }} /></div>
          <div style={{ marginTop: 8 }}>API账号：<input value={oa.username} onChange={e => setOa({ ...oa, username: e.target.value })} style={{ width: 240 }} /></div>
          <div style={{ marginTop: 8 }}>API密钥：<input type="password" value={oa.secret} onChange={e => setOa({ ...oa, secret: e.target.value })} placeholder="已配置则留空" style={{ width: 320 }} /></div>
          <div style={{ marginTop: 8 }}>固定Token(可选)：<input type="password" value={oa.fixedToken} onChange={e => setOa({ ...oa, fixedToken: e.target.value })} placeholder="已配置则留空" style={{ width: 320 }} /></div>
          <div style={{ marginTop: 16 }}>
            <button onClick={saveOA}>保存配置</button>
            <button onClick={testOA} style={{ marginLeft: 8 }}>测试连接</button>
            <button onClick={syncOAOrg} style={{ marginLeft: 8 }}>同步组织架构</button>
          </div>

          <div style={{ marginTop: 16, padding: 12, border: '1px solid #e8e8e8', borderRadius: 6 }}>
            <h4 style={{ margin: '0 0 8px' }}>按 OA ID 查询 / 导入人员</h4>
            <div>人员ID：<input value={oaMemberId} onChange={e => setOaMemberId(e.target.value)} placeholder="如 240467409362108676" style={{ width: 280 }} />
              <button onClick={queryOAMember} style={{ marginLeft: 8 }}>查询</button>
              {oaMember && <button onClick={importOAMember} style={{ marginLeft: 8 }}>导入到本地</button>}
            </div>
            {oaMember && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                姓名：{oaMember.name} ｜ 工号：{oaMember.code} ｜ 邮箱：{oaMember.email || '-'} ｜ OA ID：{oaMember.oaId}
              </div>
            )}
          </div>

          {oaMsg && <div style={{ marginTop: 12, color: '#1890ff' }}>{oaMsg}</div>}
          {oaTest && (
            <div style={{ marginTop: 12, color: oaTest.success ? '#52c41a' : '#f5222d' }}>
              连接测试：{oaTest.success ? '成功' : '失败'}{oaTest.tokenMasked ? '（token ' + oaTest.tokenMasked + '）' : ''}
              {oaTest.sampleAccount ? ' ｜ 示例组织：' + oaTest.sampleAccount.name : ''}
            </div>
          )}
        </div>
      )}

      {/* 组织架构弹窗 */}
      {showOrgModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowOrgModal(false)}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3>{editingOrg ? '编辑组织' : '新增组织'}</h3>
            <div style={{ marginTop: 12 }}>名称：<input value={orgName} onChange={e => setOrgName(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>上级：
              <select value={orgParent} onChange={e => setOrgParent(e.target.value)}>
                <option value="">-- 无 --</option>
                {orgList.filter((o: any) => !o.parentId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8 }}>描述：<input value={orgDesc} onChange={e => setOrgDesc(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>状态：
              <select value={orgActive ? 'true' : 'false'} onChange={e => setOrgActive(e.target.value === 'true')}>
                <option value="true">启用</option>
                <option value="false">禁用</option>
              </select>
            </div>
            <div style={{ marginTop: 16 }}>
              <button onClick={saveOrg}>保存</button>
              <button onClick={() => setShowOrgModal(false)} style={{ marginLeft: 8 }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 人员弹窗 */}
      {showPModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPModal(false)}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3>{editingP ? '编辑人员' : '新增人员'}</h3>
            <div style={{ marginTop: 12 }}>姓名：<input value={pName} onChange={e => setPName(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>用户名：<input value={pUser} onChange={e => setPUser(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>密码{editingP ? '(留空不修改)' : ''}：<input type="password" value={pPass} onChange={e => setPPass(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>组织：
              <select value={pOrgId} onChange={e => setPOrgId(e.target.value)}>
                <option value="">-- 无 --</option>
                {orgList.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8 }}>角色：<input value={pRole} onChange={e => setPRole(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>状态：
              <select value={pActive ? 'true' : 'false'} onChange={e => setPActive(e.target.value === 'true')}>
                <option value="true">启用</option>
                <option value="false">禁用</option>
              </select>
            </div>
            <div style={{ marginTop: 16 }}>
              <button onClick={saveP}>保存</button>
              <button onClick={() => setShowPModal(false)} style={{ marginLeft: 8 }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 */}
      {showResetPwdModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowResetPwdModal(false)}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3>重置密码</h3>
            <div style={{ marginTop: 12 }}>新密码：<input type="password" value={resetPwdNew} onChange={e => setResetPwdNew(e.target.value)} style={{ width: 200 }} /></div>
            <div style={{ marginTop: 8 }}>确认密码：<input type="password" value={resetPwdConfirm} onChange={e => setResetPwdConfirm(e.target.value)} style={{ width: 200 }} /></div>
            <div style={{ marginTop: 16 }}>
              <button onClick={resetPassword}>重置</button>
              <button onClick={() => setShowResetPwdModal(false)} style={{ marginLeft: 8 }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 权限弹窗 */}
      {showPermModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPermModal(false)}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3>{editingPerm ? '编辑角色' : '新增角色'}</h3>
            <div style={{ marginTop: 12 }}>角色名称：<input value={permName} onChange={e => setPermName(e.target.value)} /></div>
            <div style={{ marginTop: 8 }}>可访问分类：
              <select value={permCatId} onChange={e => { const c = cats.find((x: any) => x.id === e.target.value); setPermCatId(e.target.value); setPermCatName(c?.name || '全部'); }}>
                <option value="">-- 全部 --</option>
                {cats.filter((c: any) => !c.parentId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8 }}>权限：
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                {Object.entries(PERM_LABELS).map(([code, label]) => (
                  <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
                    <input type="checkbox" checked={(permArr || []).includes(code)} onChange={e => {
                      const next = e.target.checked
                        ? [...permArr, code]
                        : permArr.filter((c: string) => c !== code);
                      setPermArr(next);
                    }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button onClick={savePerm}>保存</button>
              <button onClick={() => setShowPermModal(false)} style={{ marginLeft: 8 }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
