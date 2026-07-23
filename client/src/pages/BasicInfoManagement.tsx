import { useState, useEffect, useRef } from 'react';

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

// 字节格式化
function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// ============ 通用适配配置结构化表单辅助组件 ============

// 前端默认通用模板（与后端 defaultGenericConfig 对应，切换类型且未配置时使用）
const DEFAULT_GENERIC: any = {
  authType: 'token_url',
  tokenEndpoint: { method: 'GET', path: '/api/auth/token', query: {}, body: {}, headers: {}, usernameField: 'username', passwordField: 'password', responsePath: 'token' },
  staticToken: '',
  apiKey: { headerName: 'X-API-Key', valuePrefix: '', in: 'header' },
  basicAuth: { username: '', password: '' },
  orgAccountsEndpoint: { method: 'GET', path: '/api/org/accounts', query: {}, body: {}, headers: {}, responsePath: 'data', paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 } },
  orgDepartmentsEndpoint: { method: 'GET', path: '/api/org/departments', query: {}, body: {}, headers: {}, responsePath: 'data', accountIdParam: 'accountId', paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 } },
  orgMembersEndpoint: { method: 'GET', path: '/api/org/members', query: {}, body: {}, headers: {}, responsePath: 'data', accountIdParam: 'accountId', paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 } },
  fieldMapping: {
    orgAccount: { id: 'id', name: 'name', code: 'code', shortName: 'shortName', isGroup: 'isGroup', parentId: 'parentId', enabled: 'enabled', path: 'path' },
    orgDepartment: { id: 'id', name: 'name', code: 'code', superior: 'superior', superiorName: 'superiorName', orgAccountId: 'orgAccountId', orgAccountName: 'orgAccountName', enabled: 'enabled', isDeleted: 'isDeleted' },
    member: { id: 'id', orgAccountId: 'orgAccountId', name: 'name', code: 'code', loginName: 'loginName', orgDepartmentId: 'orgDepartmentId', orgPostId: 'orgPostId', email: 'email', gender: 'gender', phone: 'phone', telNumber: 'telNumber', officeNum: 'officeNum', isLoginable: 'isLoginable', enabled: 'enabled', properties: 'properties' },
  },
};

// 编辑一个 JSON 对象（query/body/headers），非法时不向上传递，避免输入框抖动
function ObjJsonField({ label, value, onValid }: { label: string; value: any; onValid: (v: any) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [err, setErr] = useState('');
  const lastJson = useRef(JSON.stringify(value || {}));
  useEffect(() => {
    const cur = JSON.stringify(value || {});
    if (cur !== lastJson.current) { lastJson.current = cur; setText(cur); setErr(''); }
  }, [value]);
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ fontSize: 12 }}>{label}</label>
      <textarea
        className="ui-input"
        style={{ width: '100%', minHeight: 70, fontFamily: 'monospace', fontSize: 12 }}
        value={text}
        spellCheck={false}
        onChange={e => {
          const t = e.target.value;
          setText(t);
          try { onValid(JSON.parse(t)); setErr(''); } catch (err) { setErr('JSON 格式错误'); }
        }}
      />
      {err && <div className="ui-alert ui-alert--error" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}

// 单个端点编辑器（组织单位 / 部门 / 人员）
function EndpointEditor({ title, ep, onChange }: { title: string; ep: any; onChange: (v: any) => void }) {
  const update = (patch: any) => onChange(Object.assign({}, ep || {}, patch));
  const paging = (ep && ep.paging) || {};
  const updatePaging = (patch: any) => update({ paging: Object.assign({}, paging, patch) });
  return (
    <div className="ui-card" style={{ background: 'var(--color-bg-tertiary)', marginTop: 12 }}>
      <div className="ui-card__header"><span className="ui-card__title">{title}</span></div>
      <div className="ui-card__body">
        <div className="ui-form-row ui-form-row--inline">
          <label>请求方法</label>
          <select className="ui-select" value={(ep && ep.method) || 'GET'} onChange={e => update({ method: e.target.value })}>
            <option>GET</option><option>POST</option><option>PUT</option>
          </select>
          <label>路径</label>
          <input className="ui-input" style={{ minWidth: 280 }} value={(ep && ep.path) || ''} onChange={e => update({ path: e.target.value })} placeholder="/api/org/accounts" />
        </div>
        <div className="ui-form-row"><label>响应数组路径</label><input className="ui-input" value={(ep && ep.responsePath) || ''} onChange={e => update({ responsePath: e.target.value })} placeholder="data / data.list，留空取根" /></div>
        <div className="ui-form-row ui-form-row--inline">
          <label>accountId 参数名</label>
          <input className="ui-input" value={(ep && ep.accountIdParam) || ''} onChange={e => update({ accountIdParam: e.target.value })} placeholder="仅部门/人员端点" />
          <label style={{ minWidth: 'auto' }}><input type="checkbox" checked={!!paging.enabled} onChange={e => updatePaging({ enabled: e.target.checked })} /> 启用分页</label>
        </div>
        {paging.enabled && (
          <div className="ui-form-row ui-form-row--inline">
            <label>页号参数</label><input className="ui-input" value={paging.pageParam || 'page'} onChange={e => updatePaging({ pageParam: e.target.value })} />
            <label>页大小参数</label><input className="ui-input" value={paging.sizeParam || 'size'} onChange={e => updatePaging({ sizeParam: e.target.value })} />
            <label>默认大小</label><input className="ui-input" value={paging.defaultSize || 100} onChange={e => updatePaging({ defaultSize: Number(e.target.value) })} />
          </div>
        )}
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>高级：query / body / headers</summary>
          <ObjJsonField label="query" value={ep && ep.query} onValid={v => update({ query: v })} />
          <ObjJsonField label="body" value={ep && ep.body} onValid={v => update({ body: v })} />
          <ObjJsonField label="headers" value={ep && ep.headers} onValid={v => update({ headers: v })} />
        </details>
      </div>
    </div>
  );
}

// 字段映射编辑器（系统字段 → 远端字段名）
const MAPPING_KEYS: Record<string, string[]> = {
  orgAccount: ['id', 'name', 'code', 'shortName', 'isGroup', 'parentId', 'enabled', 'path'],
  orgDepartment: ['id', 'name', 'code', 'superior', 'superiorName', 'orgAccountId', 'orgAccountName', 'enabled', 'isDeleted'],
  member: ['id', 'orgAccountId', 'name', 'code', 'loginName', 'orgDepartmentId', 'orgPostId', 'email', 'gender', 'phone', 'telNumber', 'officeNum', 'isLoginable', 'enabled', 'properties'],
};
function MappingEditor({ title, groupKey, mapping, onChange }: { title: string; groupKey: string; mapping: any; onChange: (v: any) => void }) {
  const setField = (k: string, v: string) => onChange(Object.assign({}, mapping || {}, { [k]: v }));
  const keys = MAPPING_KEYS[groupKey] || Object.keys(mapping || {});
  return (
    <div className="ui-card" style={{ background: 'var(--color-bg-tertiary)', marginTop: 12 }}>
      <div className="ui-card__header"><span className="ui-card__title">{title}</span></div>
      <div className="ui-card__body">
        {keys.map((k: string) => (
          <div key={k} className="ui-form-row ui-form-row--inline">
            <label style={{ minWidth: 150 }}>{k}</label>
            <input className="ui-input" value={(mapping && mapping[k]) || ''} onChange={e => setField(k, e.target.value)} placeholder={k} />
          </div>
        ))}
      </div>
    </div>
  );
}

// 通用适配配置主表单（结构化，替代裸 JSON）
function GenericConfigForm({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const g = value || DEFAULT_GENERIC;
  const setG = (mut: (d: any) => void) => onChange((() => { const next = JSON.parse(JSON.stringify(g)); mut(next); return next; })());
  const authType = g.authType || 'token_url';
  return (
    <div className="ui-card" style={{ marginTop: 12, background: 'var(--color-bg-tertiary)' }}>
      <div className="ui-card__header"><span className="ui-card__title">⚙️ 通用适配配置</span></div>
      <div className="ui-card__body">
        <div className="ui-form-row ui-form-row--inline">
          <label>认证方式</label>
          <select className="ui-select" value={authType} onChange={e => setG(d => { d.authType = e.target.value; })} style={{ minWidth: 200 }}>
            <option value="token_url">动态令牌（token_url）</option>
            <option value="fixed_token">固定 Token</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic 认证</option>
            <option value="api_key">API Key</option>
          </select>
          <span className="ui-tag">填完可直接「测试连接」（无需先保存）</span>
        </div>

        {authType === 'token_url' && (
          <EndpointEditor title="获取令牌端点" ep={g.tokenEndpoint} onChange={v => setG(d => { d.tokenEndpoint = v; })} />
        )}
        {authType === 'basic' && (
          <div className="ui-card" style={{ background: 'var(--color-bg-tertiary)', marginTop: 12 }}>
            <div className="ui-card__header"><span className="ui-card__title">Basic 认证凭据</span></div>
            <div className="ui-card__body">
              <div className="ui-form-row"><label>账号</label><input className="ui-input" value={(g.basicAuth && g.basicAuth.username) || ''} onChange={e => setG(d => { d.basicAuth = Object.assign({}, d.basicAuth, { username: e.target.value }); })} /></div>
              <div className="ui-form-row"><label>密码</label><input className="ui-input" type="text" value={(g.basicAuth && g.basicAuth.password) || ''} onChange={e => setG(d => { d.basicAuth = Object.assign({}, d.basicAuth, { password: e.target.value }); })} /></div>
            </div>
          </div>
        )}
        {authType === 'api_key' && (
          <div className="ui-card" style={{ background: 'var(--color-bg-tertiary)', marginTop: 12 }}>
            <div className="ui-card__header"><span className="ui-card__title">API Key 设置</span></div>
            <div className="ui-card__body">
              <div className="ui-form-row ui-form-row--inline">
                <label>Header 名</label><input className="ui-input" value={(g.apiKey && g.apiKey.headerName) || 'X-API-Key'} onChange={e => setG(d => { d.apiKey = Object.assign({}, d.apiKey, { headerName: e.target.value }); })} />
                <label>前缀</label><input className="ui-input" value={(g.apiKey && g.apiKey.valuePrefix) || ''} onChange={e => setG(d => { d.apiKey = Object.assign({}, d.apiKey, { valuePrefix: e.target.value }); })} placeholder="如 Bearer " />
                <label>位置</label>
                <select className="ui-select" value={(g.apiKey && g.apiKey.in) || 'header'} onChange={e => setG(d => { d.apiKey = Object.assign({}, d.apiKey, { in: e.target.value }); })}>
                  <option value="header">Header</option><option value="query">Query</option>
                </select>
              </div>
              <p className="ui-text" style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>密钥取值：上方「API 密钥」字段。</p>
            </div>
          </div>
        )}
        {(authType === 'fixed_token' || authType === 'bearer') && (
          <p className="ui-text" style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
            {authType === 'fixed_token' ? 'Token 取值：上方「固定 Token」字段。' : 'Bearer Token 取值：上方「API 密钥」字段。'}
          </p>
        )}

        <EndpointEditor title="组织单位端点" ep={g.orgAccountsEndpoint} onChange={v => setG(d => { d.orgAccountsEndpoint = v; })} />
        <EndpointEditor title="部门端点" ep={g.orgDepartmentsEndpoint} onChange={v => setG(d => { d.orgDepartmentsEndpoint = v; })} />
        <EndpointEditor title="人员端点" ep={g.orgMembersEndpoint} onChange={v => setG(d => { d.orgMembersEndpoint = v; })} />

        <MappingEditor title="组织单位字段映射" groupKey="orgAccount" mapping={g.fieldMapping && g.fieldMapping.orgAccount} onChange={v => setG(d => { d.fieldMapping = Object.assign({}, d.fieldMapping, { orgAccount: v }); })} />
        <MappingEditor title="部门字段映射" groupKey="orgDepartment" mapping={g.fieldMapping && g.fieldMapping.orgDepartment} onChange={v => setG(d => { d.fieldMapping = Object.assign({}, d.fieldMapping, { orgDepartment: v }); })} />
        <MappingEditor title="人员字段映射" groupKey="member" mapping={g.fieldMapping && g.fieldMapping.member} onChange={v => setG(d => { d.fieldMapping = Object.assign({}, d.fieldMapping, { member: v }); })} />

        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888', marginTop: 12 }}>高级：查看 / 编辑原始 JSON</summary>
          <ObjJsonField label="generic 原始配置" value={g} onValid={onChange} />
        </details>
      </div>
    </div>
  );
}

// 按修改日期分组（每组一行）：日期 / 文件数 / 总大小 / 文件名清单
function groupByDate(files: any[]): { date: string; count: number; total: number; names: string }[] {
  const map = new Map<string, any[]>();
  for (const f of files || []) {
    const d = new Date(f.mtime);
    if (isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString('zh-CN');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return Array.from(map.entries()).map(([date, arr]) => ({
    date,
    count: arr.length,
    total: arr.reduce((s: number, f: any) => s + (f.size || 0), 0),
    names: arr.map((f: any) => f.name).sort().join('、'),
  })).sort((a, b) => b.date.localeCompare(a.date));
}


type SubTab = 'org' | 'personnel' | 'permissions' | 'oa' | 'software' | 'config' | 'sso' | 'dict' | 'announcement' | 'backup';

// 权限目录（本地兜底，后端 /api/admin/permissions/catalog 返回权威版本）
const PERM_GROUPS_LOCAL: { group: string; items: { code: string; label: string }[] }[] = [
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
const PERM_LABELS: Record<string, string> = Object.fromEntries(
  PERM_GROUPS_LOCAL.flatMap(g => g.items.map(i => [i.code, i.label]))
);
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
  const [collapsedOrg, setCollapsedOrg] = useState<Set<string>>(new Set()); // 树形折叠的节点 id
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null); // 当前选中的组织树节点
  const [orgSearch, setOrgSearch] = useState(''); // 组织树搜索关键字
  const [orgFormType, setOrgFormType] = useState<'org' | 'dept'>('org'); // 新增/编辑弹窗的节点类型

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
  const [permCatalog, setPermCatalog] = useState<{ group: string; items: { code: string; label: string }[] }[]>(PERM_GROUPS_LOCAL);

  // 致远 OA / 通用 API
  const [oa, setOa] = useState<any>({ enabled: false, baseUrl: '', username: '', secret: '', fixedToken: '' });
  const [oaApiType, setOaApiType] = useState<'seeyon' | 'generic'>('seeyon');
  const [oaGeneric, setOaGeneric] = useState<any>(null);
  const [oaDeptRule, setOaDeptRule] = useState<any>({ nameKw: '', codePre: '', oaId: '' });
  const [oaTest, setOaTest] = useState<any>(null);
  const [oaMsg, setOaMsg] = useState('');
  const [oaSecretVisible, setOaSecretVisible] = useState(false);
  const [oaTokenVisible, setOaTokenVisible] = useState(false);
  // 软件信息（可编辑品牌/名称/欢迎语/界面图片）
  const [software, setSoftware] = useState<any>({ companyName: '', softwareName: '', assistantName: '', knowledgeBaseName: '', welcomeMessage: '', loginImage: '', chatImage: '' });
  const [softwareMsg, setSoftwareMsg] = useState('');
  const [uploadingImg, setUploadingImg] = useState<'' | 'loginImage' | 'chatImage'>('');

  // 致远 OA SSO 白名单
  const [oaSso, setOaSso] = useState<any>({ mode: 'whitelist', requireSign: false, hasSignSecret: false, signSecretMasked: '', trustedIps: [], whitelist: [], count: 0, ssoUrl: '/api/auth/sso/oa' });
  const [oaSsoSecret, setOaSsoSecret] = useState('');
  const [oaSsoNewIp, setOaSsoNewIp] = useState('');
  const [oaSsoNewId, setOaSsoNewId] = useState('');
  const [oaSsoMsg, setOaSsoMsg] = useState('');

  // ==================== 数据获取 ====================
  const loadOrg = () => safeFetch<any[]>(API + '/org').then((list: any[]) => { setOrgList(list); setDeptList(list.filter((n: any) => n.type === 'dept')); }).catch(e => { console.error('加载组织失败:', e); setOrgList([]); setDeptList([]); });
  const loadP = () => safeFetch<any[]>(API + '/personnel').then(setPList).catch(e => { console.error('加载人员失败:', e); setPList([]); });
  const loadPerm = () => {
    safeFetch<any[]>(API + '/categories').then(setCats).catch(() => {});
    safeFetch<any[]>(API + '/permissions').then(setPermList).catch(console.error);
    // 拉取后端权威权限目录（若失败则用本地兜底）
    fetch(API + '/permissions/catalog', { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { if (d && d.success && Array.isArray(d.data) && d.data.length) setPermCatalog(d.data); })
      .catch(() => {});
  };
  const loadOA = () => fetch(API + '/oa/config', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : {}).then((d: any) => {
    setOa({ enabled: !!d.enabled, baseUrl: d.baseUrl || '', username: d.username || '', secret: d.secret || '', fixedToken: d.fixedToken || '' });
    setOaApiType(d.apiType === 'generic' ? 'generic' : 'seeyon');
    setOaGeneric(d.generic || null);
    const r = d.orgDeptRule || {};
    const j = (arr: any) => Array.isArray(arr) ? arr.join(',') : (arr ? String(arr) : '');
    setOaDeptRule({ nameKw: j(r.byNameKeyword), codePre: j(r.byCode), oaId: j(r.byOaId) });
  }).catch(() => {});
  const loadSoftware = () => fetch(API + '/software-info', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : {}).then((d: any) => { const s = d.data || d; setSoftware({ companyName: s.companyName || '', softwareName: s.softwareName || '', assistantName: s.assistantName || '', knowledgeBaseName: s.knowledgeBaseName || '', welcomeMessage: s.welcomeMessage || '', loginImage: s.loginImage || '', chatImage: s.chatImage || '' }); }).catch(() => {});

  // ==================== 统一系统配置 ====================
  const [config, setConfig] = useState<any>({
    chat: { temperature: 0.7, topP: 0.9, maxTokens: 1024 },
    retrieval: { topK: 5, scoreThreshold: 0.35, enableRerank: true },
    conversation: { timeoutMs: 60000, enableRewrite: true, enableMemory: true },
    ui: { pageSize: 20 }, multiDeptEnabled: false, defaultDepartment: ''
  });
  const [configMsg, setConfigMsg] = useState('');
  const loadConfig = () => fetch(API + '/config', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { data: {} }).then((d: any) => { if (d.data) setConfig(d.data); }).catch(() => {});
  const saveConfig = async () => {
    const res = await fetch(API + '/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(config) });
    const d = await res.json();
    if (d.success) { setConfigMsg('系统配置已保存'); loadConfig(); } else setConfigMsg('保存失败：' + (d.error || ''));
  };

  // ==================== SSO 白名单 ====================
  const [ssoList, setSsoList] = useState<any[]>([]);
  const [ssoAccount, setSsoAccount] = useState('');
  const [ssoName, setSsoName] = useState('');
  const [ssoNote, setSsoNote] = useState('');
  const [ssoMsg, setSsoMsg] = useState('');
  const [ssoSearch, setSsoSearch] = useState('');
  const [ssoSelected, setSsoSelected] = useState<string[]>([]);
  const loadSsoWhitelist = (q?: string) => {
    const url = API + '/sso-whitelist' + (q && q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '');
    return fetch(url, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : { data: [] })
      .then((d: any) => { setSsoList(Array.isArray(d.data) ? d.data : []); return d; })
      .catch(() => {});
  };
  const addSSO = async () => {
    if (!ssoAccount.trim()) { setSsoMsg('账号(工号)必填'); return; }
    const res = await fetch(API + '/sso-whitelist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ account: ssoAccount.trim(), name: ssoName.trim(), note: ssoNote.trim() }) });
    const d = await res.json();
    if (d.success) { setSsoAccount(''); setSsoName(''); setSsoNote(''); setSsoMsg('已添加'); loadSsoWhitelist(ssoSearch); } else setSsoMsg('添加失败：' + (d.error || ''));
  };
  const delSSO = async (acc: string) => {
    if (!confirm('从白名单移除 ' + acc + '？')) return;
    const res = await fetch(API + '/sso-whitelist/' + encodeURIComponent(acc), { method: 'DELETE', headers: getAuthHeaders() });
    const d = await res.json();
    if (d.success) { setSsoSelected(prev => prev.filter(a => a !== acc)); loadSsoWhitelist(ssoSearch); } else alert(d.error || '删除失败');
  };
  const toggleSsoSelect = (acc: string) => setSsoSelected(prev => prev.includes(acc) ? prev.filter(a => a !== acc) : [...prev, acc]);
  const allSsoSelected = ssoList.length > 0 && ssoList.every(x => ssoSelected.includes(x.account));
  const toggleSelectAllSso = () => {
    if (allSsoSelected) setSsoSelected(prev => prev.filter(a => !ssoList.some(x => x.account === a)));
    else setSsoSelected(prev => Array.from(new Set([...prev, ...ssoList.map(x => x.account)])));
  };
  const batchDelSSO = async () => {
    if (!ssoSelected.length) return;
    if (!confirm('确定批量移除选中的 ' + ssoSelected.length + ' 个账号？')) return;
    const res = await fetch(API + '/sso-whitelist/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ accounts: ssoSelected }) });
    const d = await res.json();
    if (d.success) { setSsoMsg('已批量移除 ' + (d.removed || ssoSelected.length) + ' 个账号'); setSsoSelected([]); loadSsoWhitelist(ssoSearch); } else alert(d.error || '批量移除失败');
  };

  // ==================== 同义词 / 停用词 ====================
  const [synList, setSynList] = useState<any[]>([]);
  const [synWords, setSynWords] = useState('');
  const [synNote, setSynNote] = useState('');
  const [stopList, setStopList] = useState<string[]>([]);
  const [stopWord, setStopWord] = useState('');
  const [dictMsg, setDictMsg] = useState('');
  const loadDict = () => {
    fetch(API + '/synonyms', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { data: [] }).then((d: any) => setSynList(Array.isArray(d.data) ? d.data : [])).catch(() => {});
    fetch(API + '/stopwords', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { data: [] }).then((d: any) => setStopList(Array.isArray(d.data) ? d.data : [])).catch(() => {});
  };
  const addSyn = async () => {
    const words = synWords.split(/[\s,，;；]+/).map(s => s.trim()).filter(Boolean);
    if (words.length < 2) { setDictMsg('同义词至少 2 个，用逗号或空格分隔'); return; }
    const res = await fetch(API + '/synonyms', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ words, note: synNote.trim() }) });
    const d = await res.json();
    if (d.success) { setSynWords(''); setSynNote(''); setDictMsg('同义词组已添加'); loadDict(); } else setDictMsg('添加失败：' + (d.error || ''));
  };
  const delSyn = async (id: string) => { const r = await fetch(API + '/synonyms/' + id, { method: 'DELETE', headers: getAuthHeaders() }); const d = await r.json(); if (d.success) loadDict(); else alert(d.error || '删除失败'); };
  const addStop = async () => {
    if (!stopWord.trim()) { setDictMsg('停用词必填'); return; }
    const res = await fetch(API + '/stopwords', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ word: stopWord.trim() }) });
    const d = await res.json();
    if (d.success) { setStopWord(''); setDictMsg('停用词已添加'); loadDict(); } else setDictMsg('添加失败：' + (d.error || ''));
  };
  const delStop = async (w: string) => { const r = await fetch(API + '/stopwords/' + encodeURIComponent(w), { method: 'DELETE', headers: getAuthHeaders() }); const d = await r.json(); if (d.success) loadDict(); else alert(d.error || '删除失败'); };

  // ==================== 部门（已并入组织树，type==='dept'）====================
  // deptList 由 loadOrg 从统一组织树中按 type==='dept' 派生，不再单独请求 /departments
  const [deptList, setDeptList] = useState<any[]>([]);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptParent, setDeptParent] = useState('');
  const [deptMsg, setDeptMsg] = useState('');
  const saveDept = async () => {
    if (!deptName.trim()) { setDeptMsg('部门名称必填'); return; }
    const res = await fetch(API + '/org', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ type: 'dept', name: deptName.trim(), code: deptCode.trim(), parentId: deptParent || null }) });
    const d = await res.json();
    if (d.success) { setDeptName(''); setDeptCode(''); setDeptParent(''); setDeptMsg('部门已添加'); loadOrg(); } else setDeptMsg('保存失败：' + (d.error || ''));
  };
  const delDept = async (id: string) => { if (!confirm('删除该部门？')) return; const r = await fetch(API + '/org/' + id, { method: 'DELETE', headers: getAuthHeaders() }); const d = await r.json(); if (d.success) loadOrg(); else alert(d.error || '删除失败'); };

  // ==================== 系统公告 ====================
  const [ann, setAnn] = useState<any>({ enabled: false, title: '', content: '', level: 'info' });
  const [annMsg, setAnnMsg] = useState('');
  const loadAnnouncement = () => fetch(API + '/announcement', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { data: {} }).then((d: any) => { if (d.data) setAnn(d.data); }).catch(() => {});
  const saveAnnouncement = async () => {
    const res = await fetch(API + '/announcement', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(ann) });
    const d = await res.json();
    if (d.success) { setAnnMsg('公告已保存'); loadAnnouncement(); } else setAnnMsg('保存失败：' + (d.error || ''));
  };

  // ==================== 数据备份 ====================
  const [backupFiles, setBackupFiles] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [backupConfig, setBackupConfig] = useState<any>({ enabled: false, retention: 30, lastRun: null, nextRun: null });
  const [backupMsg, setBackupMsg] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const loadBackupFiles = () => fetch(API + '/backup/files', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { files: [] }).then((d: any) => setBackupFiles(Array.isArray(d.files) ? d.files : [])).catch(() => setBackupFiles([]));
  const loadBackups = () => fetch(API + '/backup/list', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { backups: [], config: {} }).then((d: any) => { setBackups(Array.isArray(d.backups) ? d.backups : []); if (d.config) setBackupConfig(d.config); }).catch(() => {});

  const doBackup = async () => {
    if (!confirm('确定立即备份当前全部业务数据？')) return;
    setBackupBusy(true); setBackupMsg('');
    try {
      const r = await fetch(API + '/backup/create', { method: 'POST', headers: getAuthHeaders() }).then(x => x.json());
      if (r.success) { setBackupMsg('备份成功：' + (r.manifest?.id || '') + '（' + (r.manifest?.files?.length || 0) + ' 文件）'); loadBackups(); loadBackupFiles(); }
      else setBackupMsg('失败：' + (r.error || ''));
    } catch (e: any) { setBackupMsg('失败：' + e.message); }
    finally { setBackupBusy(false); }
  };

  const doRestore = async (id: string) => {
    if (!confirm('恢复到该备份点将覆盖当前数据，确定继续？')) return;
    setRestoreBusy(true); setBackupMsg('');
    try {
      const r = await fetch(API + '/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ id }) }).then(x => x.json());
      if (r.success) setBackupMsg('已恢复 ' + r.count + ' 个文件（来自 ' + id + '）。建议刷新页面查看最新数据。');
      else setBackupMsg('恢复失败：' + (r.error || ''));
    } catch (e: any) { setBackupMsg('恢复失败：' + e.message); }
    finally { setRestoreBusy(false); }
  };

  const saveBackupCfg = async () => {
    const r = await fetch(API + '/backup/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ enabled: backupConfig.enabled, retention: backupConfig.retention }) }).then(x => x.json());
    if (r.success) { setBackupConfig(r.config); setBackupMsg('自动备份配置已保存（' + (r.config.enabled ? '已启用' : '已停用') + '，保留 ' + r.config.retention + ' 份）'); }
    else setBackupMsg('配置保存失败：' + (r.error || ''));
  };

  // 操作审计已迁移至「日志管理」标签页（见 AdminDashboard 日志管理子页）

  useEffect(() => {
    if (subTab === 'org') { loadOrg(); }
    if (subTab === 'personnel') loadP();
    if (subTab === 'permissions') loadPerm();
    if (subTab === 'oa') { loadOA(); loadSSO(); }
    if (subTab === 'software') loadSoftware();
    if (subTab === 'config') { loadConfig(); loadOrg(); }
    if (subTab === 'sso') loadSsoWhitelist();
    if (subTab === 'dict') loadDict();
    if (subTab === 'announcement') loadAnnouncement();
    if (subTab === 'backup') { loadBackupFiles(); loadBackups(); }
  }, [subTab]);

  // ==================== 组织架构保存 ====================
  const saveOrg = async () => {
    const body = { type: orgFormType, name: orgName, parentId: orgParent || null, description: orgDesc, isActive: orgActive };
    const url = editingOrg ? (API + '/org/' + editingOrg.id) : (API + '/org');
    const method = editingOrg ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { setShowOrgModal(false); resetOrgForm(); loadOrg(); }
    else alert(data.error || '保存失败');
  };
  const resetOrgForm = () => { setOrgName(''); setOrgParent(''); setOrgDesc(''); setOrgActive(true); setOrgFormType('org'); setEditingOrg(null); };
  const editOrg = (o: any) => { setEditingOrg(o); setOrgFormType(o.type === 'dept' ? 'dept' : 'org'); setOrgName(o.name); setOrgParent(o.parentId || ''); setOrgDesc(o.description || ''); setOrgActive(o.isActive); setShowOrgModal(true); };
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
    if (oaApiType === 'generic' && (!oaGeneric || typeof oaGeneric !== 'object')) {
      setOaMsg('保存失败：通用适配配置不是合法 JSON'); return;
    }
    const toArr = (s: string) => String(s || '').split(/[,，;；]/).map(x => x.trim()).filter(Boolean);
    const deptRule = { byNameKeyword: toArr(oaDeptRule.nameKw), byCode: toArr(oaDeptRule.codePre), byOaId: toArr(oaDeptRule.oaId) };
    const payload: any = Object.assign({}, oa, { apiType: oaApiType, orgDeptRule: deptRule });
    if (oaApiType === 'generic' && oaGeneric) payload.generic = oaGeneric;
    const r = await fetch(API + '/oa/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(payload) }).then(r => r.json());
    if (r.success) { setOaMsg('配置已保存'); loadOA(); } else setOaMsg('保存失败：' + (r.error || ''));
  };
  const saveSoftware = async () => {
    const r = await fetch(API + '/software-info', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(software) }).then(r => r.json());
    if (r.success) { setSoftwareMsg('软件信息已保存，前端界面将自动应用'); loadSoftware(); } else setSoftwareMsg('保存失败：' + (r.error || ''));
  };
  // 上传界面图片（登录/聊天），成功后写入对应字段（需再点"保存软件信息"落库）
  const uploadSoftwareImage = async (field: 'loginImage' | 'chatImage', file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setSoftwareMsg('请选择图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { setSoftwareMsg('图片不能超过 5MB'); return; }
    setUploadingImg(field);
    setSoftwareMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('originalName', file.name);
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('cs_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(API + '/upload-media', { method: 'POST', headers, body: fd });
      const r = await res.json();
      if (r.success && r.url) {
        setSoftware((s: any) => ({ ...s, [field]: r.url }));
        setSoftwareMsg('图片已上传，请点击"保存软件信息"使其生效');
      } else {
        setSoftwareMsg('上传失败：' + (r.error || ''));
      }
    } catch (e: any) {
      setSoftwareMsg('上传异常：' + (e?.message || String(e)));
    } finally {
      setUploadingImg('');
    }
  };
  const testOA = async () => {
    setOaTest(null); setOaMsg('');
    // 实时诊断：用当前表单值探测，无需先保存
    const liveConfig: any = {
      apiType: oaApiType,
      baseUrl: oa.baseUrl,
      username: oa.username,
      secret: oa.secret,
      fixedToken: oa.fixedToken,
    };
    if (oaApiType === 'generic' && oaGeneric) liveConfig.generic = oaGeneric;
    const r = await fetch(API + '/oa/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ liveConfig }) }).then(r => r.json());
    setOaTest(r);
    setOaMsg(r.success ? (`连接成功，组织数：${r.orgCount || 0}，耗时 ${r.totalMs || 0}ms`) : ('连接失败：' + (r.message || '')));
  };
  const sourceLabel = oaApiType === 'generic' ? 'API' : '致远OA';
  const syncOAOrg = async () => {
    if (!confirm(`确定从${sourceLabel}同步组织架构到本地？`)) return;
    setOaMsg('同步中...');
    const r = await fetch(API + '/oa/sync-org', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json());
    setOaMsg(r.success ? r.message : ('同步失败：' + (r.error || '')));
    if (r.success) loadOrg();
  };
  const syncOAMembers = async () => {
    if (!confirm(`确定从${sourceLabel}同步全部人员到本地？将拉取所有组织单位的人员档案（可能数百人，请耐心等待）。`)) return;
    setOaMsg(`正在从 ${sourceLabel} 拉取全部人员，请稍候...`);
    try {
      const r = await fetch(API + '/oa/sync-members', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) }).then(r => r.json());
      setOaMsg(r.success ? r.message : ('同步失败：' + (r.error || '')));
      if (r.success) loadP();
    } catch (e) { setOaMsg('请求异常：' + String(e)); }
  };

  // ==================== 致远 OA SSO 白名单 ====================
  const loadSSO = () => fetch(API + '/oa/whitelist', { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : {}).then((d: any) => {
    if (d && d.whitelist) setOaSso({ mode: d.mode || 'whitelist', requireSign: !!d.requireSign, hasSignSecret: !!d.hasSignSecret, signSecretMasked: d.signSecretMasked || '', trustedIps: d.trustedIps || [], whitelist: d.whitelist || [], count: d.count || 0, ssoUrl: d.ssoUrl || '/api/auth/sso/oa' });
  }).catch(() => {});
  const saveSSO = async (patch: any) => {
    const r = await fetch(API + '/oa/whitelist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(patch) }).then(r => r.json());
    if (r.success) { setOaSsoMsg('已保存'); setOaSso(s => ({ ...s, ...patch, count: r.count != null ? r.count : s.count, whitelist: r.whitelist || s.whitelist })); }
    else setOaSsoMsg('保存失败：' + (r.error || ''));
  };
  const addSsoId = async () => {
    const e = oaSsoNewId.trim();
    if (!e) return;
    const r = await fetch(API + '/oa/whitelist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ employeeId: e }) }).then(r => r.json());
    if (r.success) { setOaSsoNewId(''); setOaSso(s => ({ ...s, count: r.count, whitelist: r.whitelist })); setOaSsoMsg('已添加 ' + e); }
    else setOaSsoMsg('添加失败：' + (r.error || ''));
  };
  const removeSsoId = async (e: string) => {
    const r = await fetch(API + '/oa/whitelist/' + encodeURIComponent(e), { method: 'DELETE', headers: getAuthHeaders() }).then(r => r.json());
    if (r.success) { setOaSso(s => ({ ...s, count: r.count, whitelist: s.whitelist.filter((x: string) => x !== e) })); setOaSsoMsg('已移除 ' + e); }
    else setOaSsoMsg('移除失败：' + (r.error || ''));
  };
  const syncAllSso = async () => {
    if (!confirm('确定将 OA 同步的全部人员工号导入到 SSO 白名单？')) return;
    const r = await fetch(API + '/oa/whitelist/sync-all', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json());
    if (r.success) { setOaSso(s => ({ ...s, count: r.count, whitelist: s.whitelist })); setOaSsoMsg('已导入 ' + (r.added || 0) + ' 个工号'); }
    else setOaSsoMsg('导入失败：' + (r.error || ''));
  };

  // ==================== 渲染 ====================
  return (
    <div>
      <h2>基础信息管理</h2>
      <div className="ui-tabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {(['org', 'personnel', 'permissions', 'oa', 'software', 'config', 'sso', 'dict', 'announcement', 'backup'] as SubTab[]).map(k => (
          <button key={k} className={`ui-tab ${subTab === k ? 'ui-tab--active' : ''}`} onClick={() => setSubTab(k)}>{k === 'org' ? '组织与部门' : k === 'personnel' ? '人员信息' : k === 'permissions' ? '权限管理' : k === 'oa' ? '接口设置' : k === 'software' ? '软件信息' : k === 'config' ? '系统配置' : k === 'sso' ? 'SSO白名单' : k === 'dict' ? '同义词/停用词' : k === 'announcement' ? '系统公告' : '数据备份'}</button>
        ))}
      </div>

      {/* 组织与部门（合并为一个管理功能） */}
      {subTab === 'org' && (
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {/* 左：组织树 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ui-toolbar" style={{ marginBottom: 12 }}>
                <button className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { resetOrgForm(); setOrgFormType('org'); setShowOrgModal(true); }}>新增组织</button>
                <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setCollapsedOrg(new Set())}>展开全部</button>
                <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setCollapsedOrg(new Set(orgList.filter((n: any) => orgList.some((c: any) => c.parentId === n.id)).map((n: any) => n.id)))}>折叠全部</button>
                <input className="ui-input" style={{ width: 200 }} placeholder="搜索组织/部门..." value={orgSearch} onChange={e => setOrgSearch(e.target.value)} />
                {orgSearch.trim() && (() => { const q = orgSearch.trim().toLowerCase(); const c = orgList.filter((x: any) => x.name && x.name.toLowerCase().includes(q)).length; return <span className="ui-tag" style={{ color: 'var(--color-primary-600)' }}>命中 {c} 个</span>; })()}
                <span className="ui-tag">共 {orgList.length} 节点（组织 {orgList.filter((n: any) => n.type !== 'dept').length} / 部门 {orgList.filter((n: any) => n.type === 'dept').length}）</span>
              </div>
              <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                <table className="ui-table ui-table--compact">
                  <thead><tr><th style={{ textAlign: 'left' }}>名称</th><th>类型</th><th>编码</th><th>上级</th><th>状态</th></tr></thead>
                  <tbody>
                    {(() => {
                      const allNodes: any[] = orgList; // 统一组织树：组织(type=org) + 部门(type=dept)
                      const nameMap: Record<string, string> = {};
                      const idSet = new Set<string>();
                      allNodes.forEach((n: any) => { nameMap[n.id] = n.name; idSet.add(n.id); });
                      // 1) 按 parentId 建 children 映射（同级按 sortOrder、再按 name 排序）
                      const childrenMap: Record<string, any[]> = {};
                      const roots: any[] = [];
                      allNodes.forEach((n: any) => {
                        const pid = n.parentId && idSet.has(n.parentId) ? n.parentId : '__root__';
                        if (pid === '__root__') roots.push(n);
                        else (childrenMap[pid] = childrenMap[pid] || []).push(n);
                      });
                      const sortFn = (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh');
                      roots.sort(sortFn);
                      Object.values(childrenMap).forEach((arr) => arr.sort(sortFn));
                      // 2) 搜索过滤：保留命中节点及其祖先；过滤态下强制展开
                      const q = orgSearch.trim().toLowerCase();
                      const filterMode = q !== '';
                      const matched = new Set(filterMode ? allNodes.filter((n: any) => n.name && n.name.toLowerCase().includes(q)).map((n: any) => n.id) : []);
                      const keepSet = new Set<string>();
                      const computeKeep = (node: any): boolean => {
                        const kids = childrenMap[node.id] || [];
                        const childKept = kids.some((k: any) => computeKeep(k));
                        if (matched.has(node.id) || childKept) { keepSet.add(node.id); return true; }
                        return false;
                      };
                      if (filterMode) roots.forEach(computeKeep);
                      const highlight = (name: string) => {
                        if (!filterMode) return name;
                        const idx = name.toLowerCase().indexOf(q);
                        if (idx < 0) return name;
                        return (<>{name.slice(0, idx)}<span style={{ background: '#ffe58f' }}>{name.slice(idx, idx + q.length)}</span>{name.slice(idx + q.length)}</>);
                      };
                      // 3) DFS 展平为带层级的行
                      const rows: { node: any; depth: number; hasChildren: boolean }[] = [];
                      const walk = (node: any, depth: number) => {
                        if (filterMode && !keepSet.has(node.id)) return;
                        const kids = (childrenMap[node.id] || []).filter((k: any) => !filterMode || keepSet.has(k.id));
                        rows.push({ node, depth, hasChildren: kids.length > 0 });
                        if (kids.length && (!collapsedOrg.has(node.id) || filterMode)) kids.forEach((k: any) => walk(k, depth + 1));
                      };
                      roots.forEach((r: any) => walk(r, 0));
                      return rows.map(({ node: n, depth, hasChildren }) => {
                        const isDept = n.type === 'dept'; // 缺省 type 的节点按组织渲染（兼容旧数据）
                        const collapsed = collapsedOrg.has(n.id);
                        const selected = selectedOrgId === n.id;
                        return (
                          <tr key={n.id} onClick={() => setSelectedOrgId(n.id)} style={{ cursor: 'pointer', background: selected ? '#e6f7ff' : undefined }}>
                            <td style={{ textAlign: 'left' }}>
                              <span style={{ display: 'inline-block', width: depth * 20 }} />
                              {hasChildren ? (
                                <span
                                  onClick={(e) => { e.stopPropagation(); setCollapsedOrg((prev) => { const s = new Set(prev); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; }); }}
                                  style={{ cursor: 'pointer', display: 'inline-block', width: 16, userSelect: 'none', color: '#888' }}
                                >{collapsed && !filterMode ? '▶' : '▼'}</span>
                              ) : (
                                <span style={{ display: 'inline-block', width: 16 }} />
                              )}
                              <span style={{ marginRight: 4 }}>{isDept ? '📁' : '🏢'}</span>
                              {highlight(n.name)}
                              {hasChildren && !filterMode && <span style={{ fontSize: 11, color: '#bbb', marginLeft: 6 }}>{(childrenMap[n.id] || []).length}</span>}
                            </td>
                            <td style={{ textAlign: 'center' }}><span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: isDept ? '#f6ffed' : '#e6f7ff', color: isDept ? '#52c41a' : '#1890ff' }}>{isDept ? '部门' : '组织'}</span></td>
                            <td style={{ textAlign: 'center' }}>{n.code || '-'}</td>
                            <td>{nameMap[n.parentId] || '-'}</td>
                            <td style={{ textAlign: 'center' }}>{isDept ? '-' : (n.isActive ? '启用' : '禁用')}</td>
                          </tr>
                        );
                      });
                    })()}
                    {orgList.length === 0 && <tr><td colSpan={5}>暂无数据</td></tr>}
                  </tbody>
                </table>
              </div>

              <h3 style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 16 }}>新增部门（多部门隔离基础）</h3>
              <div>名称：<input value={deptName} onChange={e => setDeptName(e.target.value)} />
                编码：<input value={deptCode} onChange={e => setDeptCode(e.target.value)} />
                上级：<select value={deptParent} onChange={e => setDeptParent(e.target.value)}><option value="">-- 无 --</option>{deptList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                <button style={{ marginLeft: 8 }} onClick={saveDept}>添加部门</button>
              </div>
              {deptMsg && <div style={{ color: '#52c41a', marginTop: 8 }}>{deptMsg}</div>}
            </div>

            {/* 右：选中节点详情/编辑 */}
            <div style={{ width: 320, flexShrink: 0, border: '1px solid #eee', borderRadius: 6, padding: 16, alignSelf: 'stretch' }}>
              {(() => {
                const nm: Record<string, string> = {};
                orgList.forEach((x: any) => { nm[x.id] = x.name; });
                const sel = orgList.find((n: any) => n.id === selectedOrgId);
                if (!sel) return (<div style={{ color: '#999', fontSize: 13, lineHeight: 1.8 }}>👈 点击左侧任意节点<br />查看与编辑详情<br /><br />· 搜索框可定位组织/部门<br />· 点击三角展开/折叠<br />· 点击行选中后在右侧编辑</div>);
                const isDept = sel.type === 'dept';
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 22 }}>{isDept ? '📁' : '🏢'}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{sel.name}</div>
                        <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: isDept ? '#f6ffed' : '#e6f7ff', color: isDept ? '#52c41a' : '#1890ff' }}>{isDept ? '部门' : '组织'}</span>
                      </div>
                    </div>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr><td style={{ color: '#888', padding: '5px 0', width: 96 }}>编码</td><td>{sel.code || '-'}</td></tr>
                        <tr><td style={{ color: '#888', padding: '5px 0' }}>上级</td><td>{nm[sel.parentId] || '-'}</td></tr>
                        <tr><td style={{ color: '#888', padding: '5px 0', verticalAlign: 'top' }}>上级ID</td><td style={{ wordBreak: 'break-all' }}>{sel.superior || '-'}</td></tr>
                        <tr><td style={{ color: '#888', padding: '5px 0', verticalAlign: 'top' }}>OA ID</td><td style={{ wordBreak: 'break-all' }}>{sel.oaId || '-'}</td></tr>
                        <tr><td style={{ color: '#888', padding: '5px 0' }}>来源</td><td>{sel.source || '-'}</td></tr>
                        <tr><td style={{ color: '#888', padding: '5px 0' }}>状态</td><td>{isDept ? '-' : (sel.isActive ? '启用' : '禁用')}</td></tr>
                        {sel.description ? (<tr><td style={{ color: '#888', padding: '5px 0', verticalAlign: 'top' }}>描述</td><td>{sel.description}</td></tr>) : null}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => editOrg(sel)}>编辑</button>
                      <button onClick={async () => { if (sel.type === 'dept') await delDept(sel.id); else await delOrg(sel.id); setSelectedOrgId(null); }}>删除</button>
                      <button onClick={() => { resetOrgForm(); setOrgFormType('org'); setOrgParent(sel.id); setShowOrgModal(true); }}>新增子组织</button>
                      <button onClick={() => { resetOrgForm(); setOrgFormType('dept'); setOrgParent(sel.id); setShowOrgModal(true); }}>新增子部门</button>
                      <button onClick={() => setSelectedOrgId(null)} style={{ marginLeft: 'auto' }}>取消选中</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 人员信息 */}
      {subTab === 'personnel' && (
        <div className="ui-card">
          <div className="ui-card__header">
            <span className="ui-card__title">人员信息</span>
            <button className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { resetPForm(); setShowPModal(true); }}>＋ 新增人员</button>
          </div>
          <div className="ui-card__body ui-card__body--flush">
            <table className="ui-table">
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
                      <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => editP(p)}>编辑</button>
                      <button className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginLeft: 8 }} onClick={() => { setResetPwdPersonId(p.id); setResetPwdNew(''); setResetPwdConfirm(''); setShowResetPwdModal(true); }}>重置密码</button>
                      <button className="ui-btn ui-btn--danger ui-btn--sm" style={{ marginLeft: 8 }} onClick={() => delP(p.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 权限管理 */}
      {subTab === 'permissions' && (
        <div className="ui-card">
          <div className="ui-card__header">
            <span className="ui-card__title">权限管理</span>
            <button className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { resetPermForm(); setShowPermModal(true); }}>＋ 新增角色</button>
          </div>
          <div className="ui-card__body ui-card__body--flush">
            <table className="ui-table">
              <thead><tr><th>角色</th><th>可访问分类</th><th>权限</th><th>操作</th></tr></thead>
              <tbody>
                {permList.map(r => (
                <tr key={r.id}>
                  <td>{r.roleName}{r.isSystem && <span className="ui-tag">系统</span>}</td>
                  <td>{r.categoryName || '全部'}</td>
                  <td>
                    <span className="ui-badge ui-badge--primary" style={{ marginRight: 6 }}>{ (r.permissions || []).length } 项</span>
                    <span style={{ color: '#666', fontSize: 13 }}>{formatPerms(r.permissions || [])}</span>
                  </td>
                  <td>
                    {!r.isSystem && (
                      <>
                        <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => editPerm(r)}>编辑</button>
                        <button className="ui-btn ui-btn--danger ui-btn--sm" style={{ marginLeft: 8 }} onClick={() => delPerm(r.id)}>删除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 致远 OA / 通用 API 对接 */}
      {subTab === 'oa' && (
        <div className="ui-card">
          <div className="ui-card__header">
            <span className="ui-card__title">{oaApiType === 'generic' ? '通用 API 对接' : '致远 OA 对接'}</span>
            <span className="ui-tag">连接状态：{oaTest ? (oaTest.success ? '✅ 已连通' : '❌ 失败') : '未测试'}</span>
          </div>
          <div className="ui-card__body">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={oa.enabled} onChange={e => setOa({ ...oa, enabled: e.target.checked })} /> 启用{oaApiType === 'generic' ? '通用 API' : '致远 OA'}对接
            </label>

            <div className="ui-form-row ui-form-row--inline">
              <label>接口类型</label>
              <select className="ui-select" value={oaApiType} onChange={e => setOaApiType(e.target.value as any)} style={{ minWidth: 200 }}>
                <option value="seeyon">致远 OA（内置适配）</option>
                <option value="generic">通用 REST API</option>
              </select>
              <span className="ui-tag">切换类型不影响基础字段；通用模式需在下方配置端点与字段映射</span>
            </div>

            <div className="ui-form-row"><label>服务地址</label><input className="ui-input" value={oa.baseUrl} onChange={e => setOa({ ...oa, baseUrl: e.target.value })} placeholder="http://IP:端口" /></div>
            <div className="ui-form-row"><label>API 账号</label><input className="ui-input" value={oa.username} onChange={e => setOa({ ...oa, username: e.target.value })} placeholder={oaApiType === 'generic' ? '账号 / Client ID' : 'OA 接口账号'} /></div>
            <div className="ui-form-row"><label>API 密钥</label><div style={{ display: 'flex', gap: 6, flex: 1 }}><input className="ui-input" type={oaSecretVisible ? 'text' : 'password'} value={oa.secret} onChange={e => setOa({ ...oa, secret: e.target.value })} placeholder="OA 接口密钥" autoComplete="off" style={{ flex: 1, minWidth: 0 }} /><button type="button" className="ui-btn ui-btn--sm" onClick={() => setOaSecretVisible(v => !v)} title={oaSecretVisible ? '隐藏密钥' : '显示密钥'}>{oaSecretVisible ? '🙈' : '👁'}</button></div></div>
            {oaApiType === 'generic' && (
              <div className="ui-form-row"><label>固定 Token</label><div style={{ display: 'flex', gap: 6, flex: 1 }}><input className="ui-input" type={oaTokenVisible ? 'text' : 'password'} value={oa.fixedToken} onChange={e => setOa({ ...oa, fixedToken: e.target.value })} placeholder="fixed_token 认证方式使用，留空表示不使用" autoComplete="off" style={{ flex: 1, minWidth: 0 }} /><button type="button" className="ui-btn ui-btn--sm" onClick={() => setOaTokenVisible(v => !v)} title={oaTokenVisible ? '隐藏 Token' : '显示 Token'}>{oaTokenVisible ? '🙈' : '👁'}</button></div></div>
            )}

            {oaApiType === 'generic' && (
              <GenericConfigForm value={oaGeneric || DEFAULT_GENERIC} onChange={setOaGeneric} />
            )}

            <div className="ui-toolbar">
              <button className="ui-btn ui-btn--primary" onClick={saveOA}>保存配置</button>
              <button className="ui-btn ui-btn--secondary" onClick={testOA}>测试连接</button>
              <button className="ui-btn ui-btn--secondary" onClick={syncOAOrg}>同步组织架构</button>
              <button className="ui-btn ui-btn--primary" onClick={syncOAMembers}>🔄 同步全部人员</button>
            </div>

            {oaTest && (
              <div className="ui-card" style={{ marginTop: 16, borderColor: oaTest.success ? '#52c41a' : '#ff4d4f' }}>
                <div className="ui-card__header">
                  <span className="ui-card__title">🔍 连接诊断{oaTest.success ? '（通过）' : '（失败）'}</span>
                  <span className="ui-tag">{oaTest.apiType === 'generic' ? '通用 REST' : '致远 OA'} · {oaTest.authType}{oaTest.totalMs != null ? ` · 总耗时 ${oaTest.totalMs}ms` : ''}</span>
                </div>
                <div className="ui-card__body">
                  {(oaTest.steps || []).map((s: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #eee' }}>
                      <span style={{ fontSize: 16 }}>{s.ok ? '✅' : '❌'}</span>
                      <span style={{ minWidth: 160, fontWeight: 600 }}>{s.name}</span>
                      <span style={{ color: '#888', fontSize: 12 }}>{s.latencyMs != null ? `${s.latencyMs}ms` : ''}</span>
                      <span style={{ flex: 1, fontSize: 13, color: s.ok ? '#333' : '#c0392b' }}>{s.detail}</span>
                    </div>
                  ))}
                  {oaTest.success && oaTest.sampleAccounts && oaTest.sampleAccounts.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <b>组织示例：</b>{oaTest.sampleAccounts.map((a: any) => `${a.name}${a.code ? `（${a.code}）` : ''}`).join('、')}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="ui-card" style={{ marginTop: 16 }}>
              <div className="ui-card__header"><span className="ui-card__title">部门识别规则</span></div>
              <div className="ui-card__body">
                <p className="ui-text" style={{ fontSize: 13, color: '#888', marginTop: 0, marginBottom: 12 }}>部门（中心/组/部等）现由 OA 的 orgDepartments 接口自动同步为「部门」并保留上下级关系；下方规则仅用于把某个组织单位（Account）强制识别为部门（可选）。多个值用逗号分隔。</p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="ui-form-row"><label>名称含</label><input className="ui-input" value={oaDeptRule.nameKw} onChange={e => setOaDeptRule(s => ({ ...s, nameKw: e.target.value }))} placeholder="如 部门,科,组" /></div>
                  <div className="ui-form-row"><label>编码前缀</label><input className="ui-input" value={oaDeptRule.codePre} onChange={e => setOaDeptRule(s => ({ ...s, codePre: e.target.value }))} placeholder="如 D,DEP" /></div>
                  <div className="ui-form-row"><label>oaId</label><input className="ui-input" value={oaDeptRule.oaId} onChange={e => setOaDeptRule(s => ({ ...s, oaId: e.target.value }))} placeholder="如 123,456" /></div>
                  <button className="ui-btn ui-btn--primary" onClick={saveOA}>保存规则</button>
                </div>
              </div>
            </div>

            {/* SSO 单点登录白名单 */}
            <div className="ui-card" style={{ marginTop: 16 }}>
              <div className="ui-card__header"><span className="ui-card__title">🔑 OA 单点登录（SSO）白名单</span></div>
              <div className="ui-card__body">
                <p className="ui-text" style={{ fontSize: 13, color: '#555', marginTop: 0, marginBottom: 12 }}>
                  OA 在用户登录后调用下方接口，RAG 校验工号是否在清单中，在则放行、不在则拒绝。<br />
                  提供给 OA 的接口地址：<code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>{oaSso.ssoUrl}</code>
                </p>

                <div className="ui-form-row ui-form-row--inline">
                  <label>模式</label>
                  <select className="ui-select" value={oaSso.mode} onChange={e => { const mode = e.target.value; setOaSso(s => ({ ...s, mode })); saveSSO({ mode }); }}>
                    <option value="whitelist">白名单模式（仅允许清单内工号）</option>
                    <option value="open">放开模式（允许任意已同步 OA 人员）</option>
                  </select>
                  <label style={{ minWidth: 'auto' }}><input type="checkbox" checked={oaSso.requireSign} onChange={e => { const requireSign = e.target.checked; setOaSso(s => ({ ...s, requireSign })); saveSSO({ requireSign }); }} /> 启用签名校验（HMAC-SHA256，防伪造）</label>
                </div>

                <div className="ui-form-row ui-form-row--inline">
                  <label>签名密钥</label>
                  <input className="ui-input" type="password" value={oaSsoSecret} onChange={e => setOaSsoSecret(e.target.value)} placeholder={oaSso.hasSignSecret ? ('已配置（' + (oaSso.signSecretMasked || '') + '），留空不改') : '未配置'} style={{ flex: 1, minWidth: 240 }} />
                  <button className="ui-btn ui-btn--secondary" onClick={async () => { await saveSSO({ signSecret: oaSsoSecret }); setOaSsoSecret(''); }}>保存密钥</button>
                </div>

                <div className="ui-form-row">
                  <label>信任来源 IP（留空=信任全部，建议填 OA 服务器 IP）</label>
                  <div>
                    {(oaSso.trustedIps || []).map((ip: string) => (
                      <span key={ip} className="ui-tag" style={{ marginRight: 6, marginBottom: 6, cursor: 'default' }}>
                        {ip} <span style={{ cursor: 'pointer', color: '#f5222d', marginLeft: 4 }} onClick={async () => { const ips = oaSso.trustedIps.filter((x: string) => x !== ip); await saveSSO({ trustedIps: ips }); setOaSso(s => ({ ...s, trustedIps: ips })); }}>✕</span>
                      </span>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <input className="ui-input" value={oaSsoNewIp} onChange={e => setOaSsoNewIp(e.target.value)} placeholder="如 172.17.6.4" />
                      <button className="ui-btn ui-btn--secondary" onClick={async () => { const ip = oaSsoNewIp.trim(); if (!ip) return; const ips = [...(oaSso.trustedIps || []), ip]; await saveSSO({ trustedIps: ips }); setOaSso(s => ({ ...s, trustedIps: ips })); setOaSsoNewIp(''); }}>添加 IP</button>
                    </div>
                  </div>
                </div>

                <div className="ui-form-row">
                  <label>允许登录工号清单（<span className="ui-badge ui-badge--primary">{oaSso.count || 0}</span> 个）</label>
                  <div>
                    <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={syncAllSso}>一键导入全部 OA 人员工号</button>
                    <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 6, marginTop: 8, background: 'var(--color-bg-secondary)' }}>
                      {(oaSso.whitelist || []).length === 0 && <span style={{ color: '#999' }}>清单为空，所有工号均无法 SSO 登录（请添加或一键导入）</span>}
                      {(oaSso.whitelist || []).map((id: string) => (
                        <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                          <span style={{ fontFamily: 'monospace' }}>{id}</span>
                          <span style={{ cursor: 'pointer', color: '#f5222d' }} onClick={() => removeSsoId(id)}>移除</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input className="ui-input" value={oaSsoNewId} onChange={e => setOaSsoNewId(e.target.value)} placeholder="输入工号后点击添加" onKeyDown={e => { if (e.key === 'Enter') addSsoId(); }} />
                      <button className="ui-btn ui-btn--primary" onClick={addSsoId}>添加工号</button>
                    </div>
                  </div>
                </div>

                <p className="ui-text" style={{ fontSize: 12, color: '#888', marginBottom: 0 }}>
                  签名算法（供 OA 侧配置）：HMAC-SHA256，消息 = <code>工号|时间戳(秒)</code>，密钥 = 上方签名密钥；RAG 校验签名且时间戳 5 分钟内有效。
                </p>
                {oaSsoMsg && <div className="ui-alert ui-alert--info" style={{ marginTop: 12 }}>{oaSsoMsg}</div>}
              </div>
            </div>

            {oaMsg && <div className="ui-alert ui-alert--info" style={{ marginTop: 12 }}>{oaMsg}</div>}
            {oaTest && (
              <div className={`ui-alert ${oaTest.success ? 'ui-alert--success' : 'ui-alert--error'}`} style={{ marginTop: 12 }}>
                连接测试：{oaTest.success ? '成功' : '失败'}{oaTest.tokenMasked ? '（token ' + oaTest.tokenMasked + '）' : ''}
                {oaTest.sampleAccount ? ' ｜ 示例组织：' + oaTest.sampleAccount.name : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 软件信息 */}
      {subTab === 'software' && (
        <div className="ui-card">
          <div className="ui-card__header"><span className="ui-card__title">软件信息</span></div>
          <div className="ui-card__body">
            <div className="ui-form-row"><label>公司名称</label><input className="ui-input" value={software.companyName} onChange={e => setSoftware({ ...software, companyName: e.target.value })} /></div>
            <div className="ui-form-row"><label>软件名称</label><input className="ui-input" value={software.softwareName} onChange={e => setSoftware({ ...software, softwareName: e.target.value })} /></div>
            <div className="ui-form-row"><label>助手名称</label><input className="ui-input" value={software.assistantName} onChange={e => setSoftware({ ...software, assistantName: e.target.value })} /></div>
            <div className="ui-form-row"><label>知识库名称</label><input className="ui-input" value={software.knowledgeBaseName} onChange={e => setSoftware({ ...software, knowledgeBaseName: e.target.value })} /></div>
            <div className="ui-form-row"><label>欢迎语</label>
              <textarea className="ui-textarea" value={software.welcomeMessage} onChange={e => setSoftware({ ...software, welcomeMessage: e.target.value })} rows={3} style={{ maxWidth: 560 }} />
            </div>

            <div className="ui-section-title">界面图片</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {([
                { field: 'loginImage', label: '登录界面图片', hint: '显示在登录页顶部（建议正方形或横向 Logo，PNG/JPG，≤5MB）' },
                { field: 'chatImage', label: '聊天界面图片', hint: '聊天页助手头像 / Logo（建议正方形，PNG/JPG，≤5MB）' },
              ] as { field: 'loginImage' | 'chatImage'; label: string; hint: string }[]).map(({ field, label, hint }) => (
                <div key={field} className="ui-card" style={{ width: 300 }}>
                  <div className="ui-card__body">
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>{hint}</div>
                    <div style={{
                      width: '100%', height: 130, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      background: 'var(--color-bg-tertiary)', marginBottom: 10
                    }}>
                      {software[field]
                        ? <img src={software[field]} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        : <span style={{ color: '#bbb', fontSize: 13 }}>暂无图片</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginBottom: 0 }}>
                        {uploadingImg === field ? '上传中…' : '选择图片'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          disabled={uploadingImg === field}
                          onChange={e => { uploadSoftwareImage(field, e.target.files?.[0] || null); e.target.value = ''; }}
                        />
                      </label>
                      {software[field] && (
                        <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setSoftware((s: any) => ({ ...s, [field]: '' }))}>移除</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="ui-toolbar">
              <button className="ui-btn ui-btn--primary" onClick={saveSoftware}>保存软件信息</button>
            </div>
            {softwareMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{softwareMsg}</div>}
          </div>
        </div>
      )}

      {/* 系统配置 */}
      {subTab === 'config' && (
        <div className="ui-card">
          <div className="ui-card__header"><span className="ui-card__title">统一系统配置</span></div>
          <div className="ui-card__body">
            <div className="ui-grid ui-grid--3">
              <div className="ui-card">
                <div className="ui-card__header"><span className="ui-card__title">对话生成</span></div>
                <div className="ui-card__body">
                  <div className="ui-form-row ui-form-row--inline"><label>模型温度</label><input className="ui-input" type="number" step="0.1" value={config.chat?.temperature ?? 0} onChange={e => setConfig({ ...config, chat: { ...config.chat, temperature: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>TopP</label><input className="ui-input" type="number" step="0.1" value={config.chat?.topP ?? 0} onChange={e => setConfig({ ...config, chat: { ...config.chat, topP: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>最大 Token</label><input className="ui-input" type="number" value={config.chat?.maxTokens ?? 0} onChange={e => setConfig({ ...config, chat: { ...config.chat, maxTokens: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                </div>
              </div>
              <div className="ui-card">
                <div className="ui-card__header"><span className="ui-card__title">检索</span></div>
                <div className="ui-card__body">
                  <div className="ui-form-row ui-form-row--inline"><label>召回 TopK</label><input className="ui-input" type="number" value={config.retrieval?.topK ?? 0} onChange={e => setConfig({ ...config, retrieval: { ...config.retrieval, topK: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>相似度阈值</label><input className="ui-input" type="number" step="0.05" value={config.retrieval?.scoreThreshold ?? 0} onChange={e => setConfig({ ...config, retrieval: { ...config.retrieval, scoreThreshold: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>启用重排序</label><input type="checkbox" checked={!!config.retrieval?.enableRerank} onChange={e => setConfig({ ...config, retrieval: { ...config.retrieval, enableRerank: e.target.checked } })} /></div>
                </div>
              </div>
              <div className="ui-card">
                <div className="ui-card__header"><span className="ui-card__title">会话</span></div>
                <div className="ui-card__body">
                  <div className="ui-form-row ui-form-row--inline"><label>超时(ms)</label><input className="ui-input" type="number" value={config.conversation?.timeoutMs ?? 0} onChange={e => setConfig({ ...config, conversation: { ...config.conversation, timeoutMs: Number(e.target.value) } })} style={{ maxWidth: 120 }} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>答案口语化</label><input type="checkbox" checked={!!config.conversation?.enableRewrite} onChange={e => setConfig({ ...config, conversation: { ...config.conversation, enableRewrite: e.target.checked } })} /></div>
                  <div className="ui-form-row ui-form-row--inline"><label>对话记忆</label><input type="checkbox" checked={!!config.conversation?.enableMemory} onChange={e => setConfig({ ...config, conversation: { ...config.conversation, enableMemory: e.target.checked } })} /></div>
                </div>
              </div>
            </div>

            <div className="ui-card" style={{ marginTop: 16 }}>
              <div className="ui-card__header"><span className="ui-card__title">多部门隔离</span></div>
              <div className="ui-card__body">
                <div className="ui-form-row ui-form-row--inline"><label>启用</label><input type="checkbox" checked={!!config.multiDeptEnabled} onChange={e => setConfig({ ...config, multiDeptEnabled: e.target.checked })} /><span className="ui-tag">开启后，人员/对话列表可按部门过滤</span></div>
                <div className="ui-form-row ui-form-row--inline"><label>默认部门</label>
                  <select className="ui-select" value={config.defaultDepartment || ''} onChange={e => setConfig({ ...config, defaultDepartment: e.target.value })} style={{ minWidth: 240 }}>
                    <option value="">-- 无 --</option>
                    {deptList.map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.code ? '（' + d.code + '）' : ''}</option>)}
                  </select>
                  <span className="ui-tag">部门即组织树中 type=部门 的节点</span>
                </div>
              </div>
            </div>

            <div className="ui-toolbar">
              <button className="ui-btn ui-btn--primary" onClick={saveConfig}>保存配置</button>
              <button className="ui-btn ui-btn--secondary" onClick={async () => { const r = await fetch(API + '/config/export', { headers: getAuthHeaders() }); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'system-config-backup.json'; a.click(); }}>导出配置备份</button>
              <label className="ui-btn ui-btn--secondary">导入备份<input type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e: any) => {
                const f = e.target.files?.[0]; if (!f) return;
                const text = await f.text();
                try { const bundle = JSON.parse(text); const r = await fetch(API + '/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ bundle }) }); const d = await r.json(); if (d.success) { setConfigMsg('已恢复：' + (d.imported || []).join(',')); loadConfig(); } else setConfigMsg('恢复失败：' + (d.error || '')); } catch (err: any) { setConfigMsg('解析失败：' + err.message); }
              }} /></label>
            </div>
            {configMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{configMsg}</div>}
          </div>
        </div>
      )}

      {/* SSO 白名单 */}
      {subTab === 'sso' && (
        <div className="ui-card">
          <div className="ui-card__header">
            <span className="ui-card__title">SSO 登录白名单</span>
          </div>
          <div className="ui-card__body">
            <p className="ui-text" style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 12 }}>本页为「系统 SSO 登录白名单」（账号存于 data/sso-whitelist.json，控制谁可用 SSO 登录系统）。与「接口设置」页里的 SSO 白名单（控制 OA 跳转登录工号）相互独立，注意区分。</p>
            <div className="ui-toolbar">
              <input className="ui-input" value={ssoAccount} onChange={e => setSsoAccount(e.target.value)} placeholder="账号(工号) 如 GK88888" />
              <input className="ui-input" value={ssoName} onChange={e => setSsoName(e.target.value)} placeholder="姓名" />
              <input className="ui-input" value={ssoNote} onChange={e => setSsoNote(e.target.value)} placeholder="备注" />
              <button className="ui-btn ui-btn--primary" onClick={addSSO}>添加</button>
            </div>
            <div className="ui-toolbar">
              <input className="ui-input" value={ssoSearch} onChange={e => setSsoSearch(e.target.value)} placeholder="搜索账号/姓名/部门/添加人" style={{ minWidth: 260 }} onKeyDown={e => { if (e.key === 'Enter') loadSsoWhitelist(ssoSearch); }} />
              <button className="ui-btn ui-btn--primary" onClick={() => loadSsoWhitelist(ssoSearch)}>查询</button>
              <button className="ui-btn ui-btn--secondary" onClick={() => { setSsoSearch(''); loadSsoWhitelist(''); }}>重置</button>
              <button className="ui-btn ui-btn--danger" style={{ marginLeft: 'auto' }} onClick={batchDelSSO} disabled={!ssoSelected.length}>
                批量移除{ssoSelected.length ? '（' + ssoSelected.length + '）' : ''}
              </button>
            </div>
            {ssoMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{ssoMsg}</div>}
            <div className="ui-table__scroll" style={{ maxHeight: 380, marginTop: 12 }}>
              <table className="ui-table">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-tertiary)' }}><tr><th><input type="checkbox" checked={allSsoSelected} onChange={toggleSelectAllSso} /></th><th>账号</th><th>姓名</th><th>部门</th><th>备注</th><th>添加人</th><th>添加时间</th><th>操作</th></tr></thead>
                <tbody>
                  {ssoList.map((x: any) => (
                    <tr key={x.account}>
                      <td><input type="checkbox" checked={ssoSelected.includes(x.account)} onChange={() => toggleSsoSelect(x.account)} /></td>
                      <td>{x.account}</td><td>{x.name || '-'}</td><td>{x.department || '-'}</td><td>{x.note || '-'}</td><td>{x.addedBy || '-'}</td><td>{x.addedAt ? x.addedAt.slice(0, 19).replace('T', ' ') : '-'}</td><td><button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => delSSO(x.account)}>移除</button></td>
                    </tr>
                  ))}
                  {ssoList.length === 0 && <tr><td colSpan={8}>暂无白名单</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="ui-text" style={{ color: '#999', fontSize: 12, marginTop: 8, marginBottom: 0 }}>白名单变更已自动同步至 OA 配置并写入审计日志。勾选后可批量移除，支持按账号 / 姓名 / 部门查询。</p>
          </div>
        </div>
      )}

      {/* 同义词 / 停用词 */}
      {subTab === 'dict' && (
        <div className="ui-card">
          <div className="ui-card__header"><span className="ui-card__title">同义词 / 停用词</span></div>
          <div className="ui-card__body">
            <div className="ui-grid ui-grid--2">
              <div className="ui-card">
                <div className="ui-card__header"><span className="ui-card__title">同义词组</span></div>
                <div className="ui-card__body">
                  <div className="ui-form-row"><label>词语（逗号或空格分隔，至少 2 个）</label><input className="ui-input" value={synWords} onChange={e => setSynWords(e.target.value)} placeholder="如：发票, 票据, 发飘" /></div>
                  <div className="ui-form-row"><label>备注</label><input className="ui-input" value={synNote} onChange={e => setSynNote(e.target.value)} placeholder="可选" /></div>
                  <button className="ui-btn ui-btn--primary" onClick={addSyn}>添加同义词组</button>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    {synList.map((s: any) => (
                      <span key={s.id} className="ui-tag" style={{ cursor: 'default' }}>
                        {s.words.join(' / ')}{s.note ? '（' + s.note + '）' : ''}
                        <span style={{ cursor: 'pointer', color: '#f5222d', marginLeft: 4 }} onClick={() => delSyn(s.id)}>✕</span>
                      </span>
                    ))}
                    {synList.length === 0 && <span className="ui-empty__text">暂无同义词组</span>}
                  </div>
                </div>
              </div>
              <div className="ui-card">
                <div className="ui-card__header"><span className="ui-card__title">停用词</span></div>
                <div className="ui-card__body">
                  <div className="ui-toolbar">
                    <input className="ui-input" value={stopWord} onChange={e => setStopWord(e.target.value)} placeholder="输入停用词" />
                    <button className="ui-btn ui-btn--primary" onClick={addStop}>添加</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    {stopList.map((w: string) => (
                      <span key={w} className="ui-tag" style={{ cursor: 'default' }}>
                        {w}
                        <span style={{ cursor: 'pointer', color: '#f5222d', marginLeft: 4 }} onClick={() => delStop(w)}>✕</span>
                      </span>
                    ))}
                    {stopList.length === 0 && <span className="ui-empty__text">暂无停用词</span>}
                  </div>
                </div>
              </div>
            </div>
            {dictMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{dictMsg}</div>}
          </div>
        </div>
      )}

      {/* 系统公告 */}
      {subTab === 'announcement' && (
        <div className="ui-card">
          <div className="ui-card__header"><span className="ui-card__title">系统公告 / Banner</span></div>
          <div className="ui-card__body">
            <div className="ui-form-row ui-form-row--inline"><label>启用公告</label><input type="checkbox" checked={!!ann.enabled} onChange={e => setAnn({ ...ann, enabled: e.target.checked })} /></div>
            <div className="ui-form-row ui-form-row--inline"><label>级别</label>
              <select className="ui-select" value={ann.level} onChange={e => setAnn({ ...ann, level: e.target.value })}>
                <option value="info">普通(info)</option><option value="warning">警告(warning)</option><option value="success">成功(success)</option><option value="error">错误(error)</option>
              </select>
            </div>
            <div className="ui-form-row"><label>标题</label><input className="ui-input" value={ann.title} onChange={e => setAnn({ ...ann, title: e.target.value })} /></div>
            <div className="ui-form-row"><label>内容</label><textarea className="ui-textarea" value={ann.content} onChange={e => setAnn({ ...ann, content: e.target.value })} rows={4} style={{ maxWidth: 600 }} /></div>
            <div className="ui-toolbar">
              <button className="ui-btn ui-btn--primary" onClick={saveAnnouncement}>保存公告</button>
            </div>
            {annMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{annMsg}</div>}
          </div>
        </div>
      )}

      {/* 数据备份 */}
      {subTab === 'backup' && (
        <div>
          {/* 自动备份配置 */}
          <div className="ui-card" style={{ marginBottom: 16 }}>
            <div className="ui-card__header"><span className="ui-card__title">备份策略</span></div>
            <div className="ui-card__body">
              <div className="ui-form-row ui-form-row--inline">
                <label>每日自动备份</label>
                <input type="checkbox" checked={!!backupConfig.enabled} onChange={e => setBackupConfig({ ...backupConfig, enabled: e.target.checked })} />
                <span className="ui-tag">每天凌晨 02:00 自动快照</span>
              </div>
              <div className="ui-form-row ui-form-row--inline">
                <label>保留份数</label>
                <input className="ui-input" type="number" min={1} max={365} style={{ width: 90 }} value={backupConfig.retention} onChange={e => setBackupConfig({ ...backupConfig, retention: parseInt(e.target.value) || 30 })} />
                <span className="ui-tag">超过将自动清理最旧的备份</span>
                <button className="ui-btn ui-btn--primary ui-btn--sm" disabled={backupBusy} onClick={saveBackupCfg}>保存策略</button>
              </div>
              {(backupConfig.lastRun || backupConfig.nextRun) && (
                <div className="ui-muted" style={{ marginTop: 8 }}>
                  上次备份：{backupConfig.lastRun ? new Date(backupConfig.lastRun).toLocaleString('zh-CN') : '无'} ｜ 下次：{backupConfig.nextRun ? new Date(backupConfig.nextRun).toLocaleString('zh-CN') : '-'}
                </div>
              )}
            </div>
          </div>

          {/* 当前数据文件 + 立即备份 */}
          <div className="ui-card" style={{ marginBottom: 16 }}>
            <div className="ui-card__header">
              <span className="ui-card__title">当前业务数据（待备份 {backupFiles.length} 个文件）</span>
              <button className="ui-btn ui-btn--primary ui-btn--sm" disabled={backupBusy} onClick={doBackup}>💾 立即备份</button>
            </div>
            <div className="ui-card__body">
              {backupFiles.length === 0 ? <div className="ui-muted">暂无可备份的数据文件</div> : (
                <table className="ui-table ui-table--compact">
                  <thead><tr><th style={{ textAlign: 'left' }}>修改日期</th><th>文件数</th><th>总大小</th><th style={{ textAlign: 'left' }}>文件清单</th></tr></thead>
                  <tbody>
                    {groupByDate(backupFiles).map((g) => (
                      <tr key={g.date}>
                        <td style={{ textAlign: 'left' }}>{g.date}</td>
                        <td>{g.count}</td>
                        <td>{fmtBytes(g.total)}</td>
                        <td style={{ textAlign: 'left' }} className="ui-muted">{g.names}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 备份历史 */}
          <div className="ui-card">
            <div className="ui-card__header"><span className="ui-card__title">备份历史（{backups.length}）</span></div>
            <div className="ui-card__body">
              {backups.length === 0 ? <div className="ui-muted">暂无备份，点击「立即备份」创建第一个快照</div> : (
                <table className="ui-table ui-table--compact">
                  <thead><tr><th style={{ textAlign: 'left' }}>备份时间</th><th>文件数</th><th>大小</th><th>操作</th></tr></thead>
                  <tbody>
                    {backups.map((b: any) => (
                      <tr key={b.id}>
                        <td style={{ textAlign: 'left' }}>{new Date(b.createdAt).toLocaleString('zh-CN')}</td>
                        <td>{b.files}</td>
                        <td>{b.sizeText}</td>
                        <td>
                          <button className="ui-btn ui-btn--secondary ui-btn--sm" disabled={restoreBusy} onClick={() => doRestore(b.id)}>恢复</button>
                          <button className="ui-btn ui-btn--ghost ui-btn--sm" disabled={restoreBusy} style={{ marginLeft: 6 }} onClick={async () => { if (!confirm('删除该备份？此操作不可恢复')) return; const r = await fetch(API + '/backup/' + encodeURIComponent(b.id), { method: 'DELETE', headers: getAuthHeaders() }).then(x => x.json()); if (r.success) { setBackupMsg('已删除备份 ' + b.id); loadBackups(); } else setBackupMsg('删除失败：' + (r.error || '')); }}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {backupMsg && <div className="ui-alert ui-alert--success" style={{ marginTop: 12 }}>{backupMsg}</div>}
        </div>
      )}

      {/* 组织架构弹窗 */}
      {showOrgModal && (
        <div className="ui-modal__backdrop" onClick={() => setShowOrgModal(false)}>
          <div className="ui-modal" onClick={e => e.stopPropagation()}>
            <div className="ui-modal__header">
              <span>{editingOrg ? ('编辑' + (orgFormType === 'dept' ? '部门' : '组织')) : (orgFormType === 'dept' ? '新增部门' : '新增组织')}</span>
              <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShowOrgModal(false)}>✕</button>
            </div>
            <div className="ui-modal__body">
              <div className="ui-form-row ui-form-row--inline"><label>类型</label>
                <select className="ui-select" value={orgFormType} onChange={e => setOrgFormType(e.target.value as 'org' | 'dept')}>
                  <option value="org">组织</option>
                  <option value="dept">部门</option>
                </select>
              </div>
              <div className="ui-form-row"><label>名称</label><input className="ui-input" value={orgName} onChange={e => setOrgName(e.target.value)} /></div>
              <div className="ui-form-row"><label>上级</label>
                <select className="ui-select" value={orgParent} onChange={e => setOrgParent(e.target.value)} style={{ maxWidth: 320 }}>
                  <option value="">-- 无 --</option>
                  {(() => {
                    const cm: Record<string, string[]> = {};
                    orgList.forEach((o: any) => { if (o.parentId) (cm[o.parentId] = cm[o.parentId] || []).push(o.id); });
                    const forbid = new Set<string>();
                    if (editingOrg) {
                      const stack = [editingOrg.id];
                      while (stack.length) { const cur = stack.pop()!; (cm[cur] || []).forEach((c: string) => { if (!forbid.has(c)) { forbid.add(c); stack.push(c); } }); }
                    }
                    const parentOf: Record<string, string> = {};
                    orgList.forEach((o: any) => { if (o.parentId) parentOf[o.id] = o.parentId; });
                    const depthOf = (id: string) => { let d = 0; let cur = parentOf[id]; while (cur) { d++; cur = parentOf[cur]; } return d; };
                    return orgList.filter((o: any) => o.id !== (editingOrg?.id) && !forbid.has(o.id)).map((o: any) => <option key={o.id} value={o.id}>{'\u00A0'.repeat(depthOf(o.id) * 2)}{o.name}</option>);
                  })()}
                </select>
              </div>
              <div className="ui-form-row"><label>描述</label><input className="ui-input" value={orgDesc} onChange={e => setOrgDesc(e.target.value)} /></div>
              <div className="ui-form-row ui-form-row--inline"><label>状态</label>
                <select className="ui-select" value={orgActive ? 'true' : 'false'} onChange={e => setOrgActive(e.target.value === 'true')}>
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </select>
              </div>
            </div>
            <div className="ui-modal__footer">
              <button className="ui-btn ui-btn--secondary" onClick={() => setShowOrgModal(false)}>取消</button>
              <button className="ui-btn ui-btn--primary" onClick={saveOrg}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 人员弹窗 */}
      {showPModal && (
        <div className="ui-modal__backdrop" onClick={() => setShowPModal(false)}>
          <div className="ui-modal" onClick={e => e.stopPropagation()}>
            <div className="ui-modal__header">
              <span>{editingP ? '编辑人员' : '新增人员'}</span>
              <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShowPModal(false)}>✕</button>
            </div>
            <div className="ui-modal__body">
              <div className="ui-form-row"><label>姓名</label><input className="ui-input" value={pName} onChange={e => setPName(e.target.value)} /></div>
              <div className="ui-form-row"><label>用户名</label><input className="ui-input" value={pUser} onChange={e => setPUser(e.target.value)} /></div>
              <div className="ui-form-row"><label>密码{editingP ? '（留空不修改）' : ''}</label><input className="ui-input" type="password" value={pPass} onChange={e => setPPass(e.target.value)} /></div>
              <div className="ui-form-row"><label>组织</label>
                <select className="ui-select" value={pOrgId} onChange={e => setPOrgId(e.target.value)}>
                  <option value="">-- 无 --</option>
                  {orgList.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="ui-form-row"><label>角色</label><input className="ui-input" value={pRole} onChange={e => setPRole(e.target.value)} /></div>
              <div className="ui-form-row ui-form-row--inline"><label>状态</label>
                <select className="ui-select" value={pActive ? 'true' : 'false'} onChange={e => setPActive(e.target.value === 'true')}>
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </select>
              </div>
            </div>
            <div className="ui-modal__footer">
              <button className="ui-btn ui-btn--secondary" onClick={() => setShowPModal(false)}>取消</button>
              <button className="ui-btn ui-btn--primary" onClick={saveP}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 */}
      {showResetPwdModal && (
        <div className="ui-modal__backdrop" onClick={() => setShowResetPwdModal(false)}>
          <div className="ui-modal" onClick={e => e.stopPropagation()}>
            <div className="ui-modal__header">
              <span>重置密码</span>
              <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShowResetPwdModal(false)}>✕</button>
            </div>
            <div className="ui-modal__body">
              <div className="ui-form-row"><label>新密码</label><input className="ui-input" type="password" value={resetPwdNew} onChange={e => setResetPwdNew(e.target.value)} /></div>
              <div className="ui-form-row"><label>确认密码</label><input className="ui-input" type="password" value={resetPwdConfirm} onChange={e => setResetPwdConfirm(e.target.value)} /></div>
            </div>
            <div className="ui-modal__footer">
              <button className="ui-btn ui-btn--secondary" onClick={() => setShowResetPwdModal(false)}>取消</button>
              <button className="ui-btn ui-btn--primary" onClick={resetPassword}>重置</button>
            </div>
          </div>
        </div>
      )}

      {/* 权限弹窗 */}
      {showPermModal && (
        <div className="ui-modal__backdrop" onClick={() => setShowPermModal(false)}>
          <div className="ui-modal ui-modal--lg" onClick={e => e.stopPropagation()}>
            <div className="ui-modal__header">
              <span>{editingPerm ? '编辑角色' : '新增角色'}</span>
              <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShowPermModal(false)}>✕</button>
            </div>
            <div className="ui-modal__body">
              <div className="ui-form-row"><label>角色名称</label><input className="ui-input" value={permName} onChange={e => setPermName(e.target.value)} /></div>
              <div className="ui-form-row"><label>可访问分类</label>
                <select className="ui-select" value={permCatId} onChange={e => { const c = cats.find((x: any) => x.id === e.target.value); setPermCatId(e.target.value); setPermCatName(c?.name || '全部'); }}>
                  <option value="">-- 全部 --</option>
                  {cats.filter((c: any) => !c.parentId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="ui-form-row">
                <label>权限</label>
                <div>
                  <div className="ui-toolbar" style={{ marginBottom: 8 }}>
                    <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setPermArr([...permCatalog.flatMap(g => g.items.map(i => i.code))])}>全选</button>
                    <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setPermArr([])}>清空</button>
                  </div>
                  <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                    {permCatalog.map(g => {
                      const groupCodes = g.items.map(i => i.code);
                      const allChecked = groupCodes.every(c => (permArr || []).includes(c));
                      const toggleGroup = () => setPermArr(allChecked ? permArr.filter(c => !groupCodes.includes(c)) : [...new Set([...permArr, ...groupCodes])]);
                      return (
                        <div key={g.group} style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                              <input type="checkbox" checked={allChecked} onChange={toggleGroup} />
                              {g.group}
                            </label>
                            <span style={{ color: '#999', fontSize: 12, fontWeight: 400 }}>({groupCodes.filter(c => (permArr || []).includes(c)).length}/{groupCodes.length})</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingLeft: 20 }}>
                            {g.items.map(i => (
                              <label key={i.code} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, minWidth: 120 }}>
                                <input type="checkbox" checked={(permArr || []).includes(i.code)} onChange={e => {
                                  const next = e.target.checked ? [...permArr, i.code] : permArr.filter((c: string) => c !== i.code);
                                  setPermArr(next);
                                }} />
                                {i.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="ui-modal__footer">
              <button className="ui-btn ui-btn--secondary" onClick={() => setShowPermModal(false)}>取消</button>
              <button className="ui-btn ui-btn--primary" onClick={savePerm}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
