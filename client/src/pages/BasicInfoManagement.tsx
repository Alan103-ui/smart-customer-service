import { useState, useEffect } from 'react';

type SubTab = 'org' | 'personnel' | 'permissions' | 'a8';

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

  // 权限
  const [permList, setPermList] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [showPermModal, setShowPermModal] = useState(false);
  const [editingPerm, setEditingPerm] = useState<any>(null);
  const [permName, setPermName] = useState('');
  const [permCatId, setPermCatId] = useState('');
  const [permCatName, setPermCatName] = useState('');
  const [permArr, setPermArr] = useState<string[]>([]);

  // A8
  const [a8, setA8] = useState<any>({ enabled: false, orgApiUrl: '', personnelApiUrl: '', syncInterval: 3600, auth: { type: 'basic', username: '', password: '' } });

  // ==================== 数据获取 ====================
  const loadOrg = () => fetch(API + '/org').then(r => r.json()).then(setOrgList).catch(console.error);
  const loadP = () => fetch(API + '/personnel').then(r => r.json()).then(setPList).catch(console.error);
  const loadPerm = () => Promise.all([fetch(API + '/permissions').then(r => r.json()), fetch(API + '/categories').then(r => r.json())]).then(([p, c]) => { setPermList(p); setCats(c); }).catch(console.error);
  const loadA8 = () => fetch(API + '/a8-config').then(r => r.json()).then(setA8).catch(console.error);

  useEffect(() => {
    if (subTab === 'org') loadOrg();
    if (subTab === 'personnel') loadP();
    if (subTab === 'permissions') loadPerm();
    if (subTab === 'a8') loadA8();
  }, [subTab]);

  // ==================== 组织架构保存 ====================
  const saveOrg = async () => {
    const body = { name: orgName, parentId: orgParent || null, description: orgDesc, isActive: orgActive };
    const url = editingOrg ? (API + '/org/' + editingOrg.id) : (API + '/org');
    const method = editingOrg ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowOrgModal(false); resetOrgForm(); loadOrg(); }
    else alert(data.error || '保存失败');
  };
  const resetOrgForm = () => { setOrgName(''); setOrgParent(''); setOrgDesc(''); setOrgActive(true); setEditingOrg(null); };
  const editOrg = (o: any) => { setEditingOrg(o); setOrgName(o.name); setOrgParent(o.parentId || ''); setOrgDesc(o.description || ''); setOrgActive(o.isActive); setShowOrgModal(true); };
  const delOrg = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/org/' + id, { method: 'DELETE' }).then(r => r.json()); if (r.success) loadOrg(); else alert(r.error); };

  // ==================== 人员保存 ====================
  const saveP = async () => {
    const body = { name: pName, username: pUser, password: pPass, orgId: pOrgId || null, orgName: orgList.find((o: any) => o.id === pOrgId)?.name || '', roleName: pRole, isActive: pActive };
    const url = editingP ? (API + '/personnel/' + editingP.id) : (API + '/personnel');
    const method = editingP ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowPModal(false); resetPForm(); loadP(); }
    else alert(data.error || '保存失败');
  };
  const resetPForm = () => { setPName(''); setPUser(''); setPPass(''); setPOrgId(''); setPRole(''); setPActive(true); setEditingP(null); };
  const editP = (p: any) => { setEditingP(p); setPName(p.name); setPUser(p.username); setPPass(''); setPOrgId(p.orgId || ''); setPRole(p.roleName || ''); setPActive(p.isActive); setShowPModal(true); };
  const delP = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/personnel/' + id, { method: 'DELETE' }).then(r => r.json()); if (r.success) loadP(); else alert(r.error); };

  // ==================== 权限保存 ====================
  const savePerm = async () => {
    const body = { roleName: permName, categoryId: permCatId || null, categoryName: permCatName || '全部', permissions: permArr };
    const url = editingPerm ? (API + '/permissions/' + editingPerm.id) : (API + '/permissions');
    const method = editingPerm ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowPermModal(false); resetPermForm(); loadPerm(); }
    else alert(data.error || '保存失败');
  };
  const resetPermForm = () => { setPermName(''); setPermCatId(''); setPermCatName(''); setPermArr([]); setEditingPerm(null); };
  const editPerm = (r: any) => { setEditingPerm(r); setPermName(r.roleName); setPermCatId(r.categoryId || ''); setPermCatName(r.categoryName || ''); setPermArr(r.permissions || []); setShowPermModal(true); };
  const delPerm = async (id: string) => { if (!confirm('确定？')) return; const r = await fetch(API + '/permissions/' + id, { method: 'DELETE' }).then(r => r.json()); if (r.success) loadPerm(); else alert(r.error); };

  // ==================== A8 ====================
  const saveA8 = async () => { const r = await fetch(API + '/a8-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a8) }).then(r => r.json()); if (r.success) alert('保存成功'); else alert(r.error); };
  const testA8 = async () => { const r = await fetch(API + '/a8-test', { method: 'POST' }).then(r => r.json()); if (r.success) alert('连接成功'); else alert(r.error); };
  const syncA8 = async () => { if (!confirm('确定同步？')) return; const r = await fetch(API + '/a8-sync', { method: 'POST' }).then(r => r.json()); if (r.success) { alert('同步成功'); loadOrg(); loadP(); } else alert(r.error); };

  // ==================== 渲染 ====================
  return (
    <div>
      <h2>基础信息管理</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['org', 'personnel', 'permissions', 'a8'] as SubTab[]).map(k => (
          <button key={k} onClick={() => setSubTab(k)} style={{ padding: '6px 16px', borderRadius: 4, border: '1px solid #d9d9d9', background: subTab === k ? '#1890ff' : '#fff', color: subTab === k ? '#fff' : '#333' }}>{k === 'org' ? '组织架构' : k === 'personnel' ? '人员信息' : k === 'permissions' ? '权限管理' : 'A8对接'}</button>
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

      {/* A8对接 */}
      {subTab === 'a8' && (
        <div style={{ maxWidth: 600 }}>
          <label><input type="checkbox" checked={a8.enabled} onChange={e => setA8({ ...a8, enabled: e.target.checked })} /> 启用A8集成</label>
          <div style={{ marginTop: 12 }}>
            <div>组织架构API：<input value={a8.orgApiUrl || ''} onChange={e => setA8({ ...a8, orgApiUrl: e.target.value })} style={{ width: 400 }} /></div>
            <div style={{ marginTop: 8 }}>人员API：<input value={a8.personnelApiUrl || ''} onChange={e => setA8({ ...a8, personnelApiUrl: e.target.value })} style={{ width: 400 }} /></div>
            <div style={{ marginTop: 8 }}>同步间隔(秒)：<input type="number" value={a8.syncInterval || 3600} onChange={e => setA8({ ...a8, syncInterval: Number(e.target.value) })} style={{ width: 120 }} /></div>
            <div style={{ marginTop: 8 }}>认证方式：
              <select value={a8.auth?.type || 'basic'} onChange={e => setA8({ ...a8, auth: { ...a8.auth, type: e.target.value } })}>
                <option value="basic">Basic</option>
                <option value="token">Token</option>
              </select>
            </div>
            {a8.auth?.type === 'basic' && (
              <div>
                <div style={{ marginTop: 8 }}>用户名：<input value={a8.auth?.username || ''} onChange={e => setA8({ ...a8, auth: { ...a8.auth, username: e.target.value } })} style={{ width: 200 }} /></div>
                <div style={{ marginTop: 8 }}>密码：<input type="password" value={a8.auth?.password || ''} onChange={e => setA8({ ...a8, auth: { ...a8.auth, password: e.target.value } })} style={{ width: 200 }} /></div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button onClick={saveA8}>保存配置</button>
              <button onClick={testA8} style={{ marginLeft: 8 }}>测试连接</button>
              <button onClick={syncA8} style={{ marginLeft: 8 }}>立即同步</button>
            </div>
          </div>
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
