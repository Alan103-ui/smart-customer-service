import { useState, useEffect } from 'react';
import { getAuthHeaders } from '../services/api';

// ==================== 模型设置组件 ====================
// 功能：
//  1) 展示「已配置模型」概览（当前生效模型 + 健康状态 + 服务地址）
//  2) 提供可编辑表单，动态配置 embedding / llm / reranker 的主备模型、超时、服务地址
//  3) 保存后写入 data/model-config.json 并热生效（后端 /api/admin/models/config）

type NoticeType = 'success' | 'error' | 'info';
interface Notice { type: NoticeType; text: string }

const TYPES: { key: 'embedding' | 'llm' | 'reranker'; label: string; icon: string }[] = [
  { key: 'embedding', label: '嵌入模型', icon: '🔢' },
  { key: 'llm', label: 'LLM 大模型', icon: '🤖' },
  { key: 'reranker', label: 'Rerank 重排序', icon: '🔄' },
];

export default function ModelSettings() {
  const [config, setConfig] = useState<any>(null);   // 可编辑配置（表单）
  const [status, setStatus] = useState<any>(null);    // 已配置模型概览（含健康）
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});   // 字段级校验错误
  const [testing, setTesting] = useState<string | null>(null);         // 正在测试连接的模型类型
  const [testResults, setTestResults] = useState<Record<string, { available: boolean; error: string | null; responseTime: number }>>({});  // 各模型测试连接结果
  const [diagnose, setDiagnose] = useState<any>(null);                  // 一键诊断结果（进页自动检测）
  const [diagLoading, setDiagLoading] = useState(false);                // 诊断进行中

  const showNotice = (text: string, type: NoticeType = 'info') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(n => (n && n.text === text ? null : n)), 4000);
  };

  // ============ 加载配置与已配置概览 ============
  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfgRes, stRes] = await Promise.all([
        fetch('/api/admin/models/config', { headers: getAuthHeaders() }),
        fetch('/api/admin/models/status', { headers: getAuthHeaders() }),
      ]);
      const cfgData = await cfgRes.json();
      const stData = await stRes.json();
      if (cfgData.success && cfgData.config) {
        // 深拷贝，避免直接修改接口返回引用
        setConfig(JSON.parse(JSON.stringify(cfgData.config)));
      } else {
        showNotice('加载模型配置失败: ' + (cfgData.error || '未知错误'), 'error');
      }
      if (stData.success) {
        setStatus(stData);
      }
    } catch (err: any) {
      showNotice('加载失败: ' + (err?.message || '未知错误'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  // ============ 一键诊断（进页自动检测 + 手动重跑）============
  // 探测所有模型主/备可达性与 Ollama 模型是否已拉取，给出整体结论与可操作建议
  const runDiagnose = async () => {
    setDiagLoading(true);
    try {
      const res = await fetch('/api/admin/models/diagnose', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) {
        setDiagnose(data);
      } else {
        setDiagnose({ overall: 'critical', items: [], issues: [{ level: 'error', title: '诊断失败', detail: data.error || '未知错误', suggestion: '请检查后端服务是否运行' }] });
      }
    } catch (err: any) {
      setDiagnose({ overall: 'critical', items: [], issues: [{ level: 'error', title: '无法连接后端', detail: err?.message || '网络错误', suggestion: '请检查服务是否运行、网络是否可达' }] });
    }
    setDiagLoading(false);
  };

  // 进入页面即自动诊断一次（进页自动检测连接）
  useEffect(() => {
    runDiagnose();
  }, []);

  // ============ 表单字段更新 ============
  const updateField = (type: 'embedding' | 'llm' | 'reranker', field: string, value: string | number | null) => {
    setConfig((prev: any) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      next[type] = next[type] || {};
      next[type][field] = value;
      return next;
    });
    // 实时清除该字段的错误提示
    setErrors((prev) => {
      const n = { ...prev };
      delete n[`${type}.${field}`];
      return n;
    });
  };

  // ============ 表单校验 ============
  // 规则：① 主模型必填且只允许字母/数字/._:-  ② 备用模型可空，有值须合法
  //       ③ 超时须为 ≥1000 整数(ms)  ④ reranker 服务地址须为合法 http(s) URL
  //       ⑤ Ollama 服务地址须为合法 http(s) URL
  const validate = (cfg: any): Record<string, string> => {
    const errs: Record<string, string> = {};
    const isModelName = (s: any) =>
      typeof s === 'string' && s.trim().length > 0 && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(s.trim());
    const isHttpUrl = (s: any) => typeof s === 'string' && /^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/.test(s.trim());
    // Ollama 服务地址（embedding / llm 共用）
    const ob = cfg?.ollama?.baseUrl;
    if (ob === undefined || ob === null || String(ob).trim() === '') {
      errs['ollama.baseUrl'] = 'Ollama 服务地址不能为空';
    } else if (!isHttpUrl(ob)) {
      errs['ollama.baseUrl'] = '格式应为 http(s)://host:port';
    }
    TYPES.forEach((t) => {
      const blk = cfg?.[t.key] || {};
      if (!isModelName(blk.primary)) {
        errs[`${t.key}.primary`] = '主模型不能为空，且只能含字母/数字/._:- 字符';
      }
      if (blk.fallback !== undefined && blk.fallback !== null && String(blk.fallback).trim() !== '') {
        if (!isModelName(blk.fallback)) errs[`${t.key}.fallback`] = '备用模型名格式不合法';
      }
      if (t.key !== 'reranker' && blk.timeout !== undefined && blk.timeout !== null) {
        const to = Number(blk.timeout);
        if (!Number.isFinite(to) || to < 1000 || !Number.isInteger(to)) {
          errs[`${t.key}.timeout`] = '超时须为 ≥1000 的整数(ms)';
        }
      }
      if (t.key === 'reranker' && blk.serviceUrl !== undefined && blk.serviceUrl !== null) {
        const url = String(blk.serviceUrl).trim();
        if (!url) errs[`${t.key}.serviceUrl`] = '服务地址不能为空';
        else if (!/^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/.test(url)) {
          errs[`${t.key}.serviceUrl`] = '格式应为 http(s)://host:port/path';
        }
      }
    });
    return errs;
  };

  // ============ 保存配置 ============
  const handleSave = async () => {
    if (!config) return;
    // 提交前校验，有错则拦截并提示
    const errs = validate(config);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      showNotice('请先修正表单中的错误再保存', 'error');
      return;
    }
    if (!confirm('确定保存模型配置？\n保存后将写入配置文件并热生效（无需重启）。')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice('模型配置已保存并热生效 ✅', 'success');
        // 重新拉取概览，确保「已配置模型」面板展示最新生效状态
        await loadAll();
      } else {
        showNotice('保存失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showNotice('保存失败: ' + (err?.message || '未知错误'), 'error');
    }
    setSaving(false);
  };

  // ============ 恢复默认配置 ============
  const handleReset = async () => {
    if (!confirm('确定恢复为默认模型配置？\n将清除本页所有自定义修改并回到系统默认值，热生效（无需重启）。')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/models/config/reset', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        showNotice('已恢复为默认模型配置 ✅', 'success');
        await loadAll();
      } else {
        showNotice('恢复失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showNotice('恢复失败: ' + (err?.message || '未知错误'), 'error');
    }
    setSaving(false);
  };

  // ============ 测试连接（按当前表单值实时探测该模型是否可达） ============
  const handleTest = async (type: 'embedding' | 'llm' | 'reranker') => {
    if (!config) return;
    const blk = config[type] || {};
    const body: any = { type };
    body.primary = blk.primary;
    if (type === 'reranker') {
      body.serviceUrl = blk.serviceUrl;
      body.timeout = blk.timeout;
    } else {
      body.baseUrl = config.ollama?.baseUrl;
    }
    setTesting(type);
    try {
      const res = await fetch('/api/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setTestResults(prev => ({ ...prev, [type]: { available: data.available, error: data.error, responseTime: data.responseTime } }));
      } else {
        setTestResults(prev => ({ ...prev, [type]: { available: false, error: data.error || '测试失败', responseTime: 0 } }));
      }
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [type]: { available: false, error: err?.message || '网络错误', responseTime: 0 } }));
    } finally {
      setTesting(null);
    }
  };

  const healthBadge = (type: string) => {
    const h = status?.health?.[type];
    if (!h) return <span className="ms-badge ms-badge-warn">未知</span>;
    return h.available
      ? <span className="ms-badge ms-badge-ok">✅ 正常</span>
      : <span className="ms-badge ms-badge-err">⚠️ 异常</span>;
  };

  return (
    <div className="rag-tab-content">
      {notice && (
        <div className={`toast toast-${notice.type}`} style={{ marginBottom: 16 }}>
          {notice.type === 'success' && '✅ '}
          {notice.type === 'error' && '❌ '}
          {notice.type === 'info' && 'ℹ️ '}
          {notice.text}
        </div>
      )}

      {loading && !config && <div className="rag-loading">加载中...</div>}

      {/* ===== 一键诊断（进页自动检测连接） ===== */}
      <div className="rag-card ms-diagnose-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="rag-card-title">🔍 模型连通性诊断</h3>
          <button onClick={runDiagnose} className="rag-btn rag-btn-secondary" disabled={diagLoading}>
            {diagLoading ? '诊断中...' : '🔄 重新诊断'}
          </button>
        </div>
        <p className="rag-card-desc">进入本页自动探测 Ollama / Rerank 服务与各模型主备可达性，并校验模型是否已拉取。异常项给出可操作修复建议。</p>

        {diagLoading && !diagnose && <div className="rag-loading">正在诊断模型连通性...</div>}

        {diagnose && (
          <>
            <div className={`ms-diag-summary ms-diag-${diagnose.overall}`}>
              <span className="ms-diag-summary-icon">
                {diagnose.overall === 'healthy' ? '✅' : diagnose.overall === 'degraded' ? '⚠️' : '❌'}
              </span>
              <span>
                {diagnose.overall === 'healthy' && '所有模型连接正常'}
                {diagnose.overall === 'degraded' && '部分模型已切换备用模型兜底'}
                {diagnose.overall === 'critical' && '存在不可用模型，请检查配置与服务'}
              </span>
              {diagnose.timestamp && (
                <span className="ms-diag-time">（诊断于 {new Date(diagnose.timestamp).toLocaleTimeString()}）</span>
              )}
            </div>

            <div className="ms-diag-items">
              {diagnose.items.map((it: any) => (
                <div key={it.type} className="ms-diag-item">
                  <div className="ms-diag-item-head">
                    <span className="ms-diag-item-label">{it.label}</span>
                    <span className={`ms-badge ${it.status === 'ok' ? 'ms-badge-ok' : it.status === 'fallback_active' ? 'ms-badge-warn' : 'ms-badge-err'}`}>
                      {it.status === 'ok' ? '✅ 正常' : it.status === 'fallback_active' ? '⚠️ 备用兜底' : '❌ 异常'}
                    </span>
                  </div>
                  <div className="ms-diag-item-row">
                    <span className="ms-diag-k">主模型 {it.primary.name}</span>
                    <span className={it.primary.available ? 'ms-ok' : 'ms-err'}>
                      {it.primary.available ? `可达 ${it.primary.responseTime}ms` : `不可达${it.primary.error ? '：' + it.primary.error : ''}`}
                    </span>
                  </div>
                  {!it.isReranker && (
                    <div className="ms-diag-item-row">
                      <span className="ms-diag-k">Ollama 是否已拉取</span>
                      <span className={it.primary.exists ? 'ms-ok' : it.primary.exists === false ? 'ms-err' : 'ms-muted'}>
                        {it.primary.exists ? '✅ 已安装' : it.primary.exists === false ? '❌ 未拉取' : '—'}
                      </span>
                    </div>
                  )}
                  {it.fallback && (
                    <div className="ms-diag-item-row">
                      <span className="ms-diag-k">备用 {it.fallback.name}</span>
                      <span className={it.fallback.available ? 'ms-ok' : 'ms-err'}>
                        {it.fallback.available ? `可达 ${it.fallback.responseTime}ms` : '不可达'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {diagnose.issues && diagnose.issues.length > 0 && (
              <div className="ms-diag-issues">
                <div className="ms-diag-issues-title">⚠️ 诊断建议</div>
                {diagnose.issues.map((iss: any, i: number) => (
                  <div key={i} className={`ms-diag-issue ms-diag-issue-${iss.level}`}>
                    <div className="ms-diag-issue-title">
                      [{iss.level === 'error' ? '错误' : iss.level === 'warning' ? '警告' : '提示'}] {iss.title}
                    </div>
                    <div className="ms-diag-issue-detail">{iss.detail}</div>
                    <div className="ms-diag-issue-suggestion">💡 {iss.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== 已配置模型概览 ===== */}
      <div className="rag-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="rag-card-title">⚙️ 已配置模型概览</h3>
          <button onClick={loadAll} className="rag-btn rag-btn-secondary" disabled={loading}>
            🔄 刷新
          </button>
        </div>
        <p className="rag-card-desc">以下为当前系统实际生效的模型配置与健康状态（含通过配置文件或本页保存的修改）。</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {TYPES.map(t => (
            <div key={t.key} className="ms-overview-card">
              <div className="ms-overview-head">
                <span className="ms-overview-icon">{t.icon}</span>
                <span className="ms-overview-title">{t.label}</span>
                {healthBadge(t.key)}
              </div>
              <div className="ms-overview-row">
                <span className="ms-overview-key">当前生效</span>
                <span className="ms-overview-val">{status?.currentModels?.[t.key] || '-'}</span>
              </div>
              <div className="ms-overview-row">
                <span className="ms-overview-key">主模型</span>
                <span className="ms-overview-val">{config?.[t.key]?.primary || '-'}</span>
              </div>
              <div className="ms-overview-row">
                <span className="ms-overview-key">备用模型</span>
                <span className="ms-overview-val">{config?.[t.key]?.fallback || '（无）'}</span>
              </div>
              {t.key === 'reranker' ? (
                <>
                  <div className="ms-overview-row">
                    <span className="ms-overview-key">服务地址</span>
                    <span className="ms-overview-val" style={{ fontSize: 13 }}>{config?.[t.key]?.serviceUrl || '-'}</span>
                  </div>
                  <div className="ms-overview-row">
                    <span className="ms-overview-key">超时</span>
                    <span className="ms-overview-val">{config?.[t.key]?.timeout ? `${config[t.key].timeout}ms` : '-'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="ms-overview-row">
                    <span className="ms-overview-key">服务地址</span>
                    <span className="ms-overview-val" style={{ fontSize: 13 }}>{config?.ollama?.baseUrl || '-'}</span>
                  </div>
                  <div className="ms-overview-row">
                    <span className="ms-overview-key">超时</span>
                    <span className="ms-overview-val">{config?.[t.key]?.timeout ? `${config[t.key].timeout}ms` : '-'}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ===== 编辑配置表单 ===== */}
      {config && (
        <div className="rag-card" style={{ marginTop: 20 }}>
          <h3 className="rag-card-title">✏️ 配置模型（热生效）</h3>
          <p className="rag-card-desc">
            修改主/备模型、超时时间、Rerank 服务地址或 Ollama 服务地址后点击「保存配置」即可生效，无需重启服务。
            留空备用模型表示不启用主备自动切换。Ollama 服务地址为嵌入模型与 LLM 共用。
          </p>

          {TYPES.map(t => (
            <div key={t.key} className="ms-form-block">
              <div className="ms-form-title-row">
                <h4 className="ms-form-title">{t.icon} {t.label}</h4>
                <button
                  type="button"
                  className="rag-btn rag-btn-sm rag-btn-secondary"
                  onClick={() => handleTest(t.key)}
                  disabled={testing === t.key || saving}
                >
                  {testing === t.key ? '测试中...' : '🔌 测试连接'}
                </button>
              </div>
              {testResults[t.key] && (
                <div className={`ms-test-result ${testResults[t.key].available ? 'ms-test-ok' : 'ms-test-err'}`}>
                  {testResults[t.key].available
                    ? `✅ 连接成功（响应 ${testResults[t.key].responseTime}ms）`
                    : `❌ 连接失败：${testResults[t.key].error}`}
                </div>
              )}
              <div className="rag-form-row">
                <div className="rag-form-group">
                  <label className="rag-label">主模型 (primary)</label>
                  <input
                    className={`rag-input ${errors[`${t.key}.primary`] ? 'rag-input-error' : ''}`}
                    value={config[t.key]?.primary ?? ''}
                    onChange={e => updateField(t.key, 'primary', e.target.value)}
                    placeholder="例如 bge-m3:latest"
                  />
                  {errors[`${t.key}.primary`] && <div className="ms-field-error">{errors[`${t.key}.primary`]}</div>}
                </div>
                <div className="rag-form-group">
                  <label className="rag-label">备用模型 (fallback)</label>
                  <input
                    className={`rag-input ${errors[`${t.key}.fallback`] ? 'rag-input-error' : ''}`}
                    value={config[t.key]?.fallback ?? ''}
                    onChange={e => updateField(t.key, 'fallback', e.target.value || null)}
                    placeholder="例如 qwen2.5:7b（可留空）"
                  />
                  {errors[`${t.key}.fallback`] && <div className="ms-field-error">{errors[`${t.key}.fallback`]}</div>}
                </div>
              </div>
              <div className="rag-form-row">
                {t.key === 'reranker' ? (
                  <div className="rag-form-group" style={{ flex: 1 }}>
                    <label className="rag-label">服务地址 (serviceUrl)</label>
                    <input
                      className={`rag-input ${errors[`${t.key}.serviceUrl`] ? 'rag-input-error' : ''}`}
                      value={config[t.key]?.serviceUrl ?? ''}
                      onChange={e => updateField(t.key, 'serviceUrl', e.target.value)}
                      placeholder="http://172.17.6.18:8000/rerank"
                    />
                    {errors[`${t.key}.serviceUrl`] && <div className="ms-field-error">{errors[`${t.key}.serviceUrl`]}</div>}
                  </div>
                ) : (
                  <div className="rag-form-group">
                    <label className="rag-label">超时 (timeout，毫秒)</label>
                    <input
                      className={`rag-input rag-input-small ${errors[`${t.key}.timeout`] ? 'rag-input-error' : ''}`}
                      type="number"
                      value={config[t.key]?.timeout ?? ''}
                      onChange={e => updateField(t.key, 'timeout', e.target.value ? Number(e.target.value) : null)}
                      min={1000}
                      step={1000}
                    />
                    {errors[`${t.key}.timeout`] && <div className="ms-field-error">{errors[`${t.key}.timeout`]}</div>}
                  </div>
                )}
              </div>
              {t.key !== 'reranker' && (
                <div className="rag-form-row">
                  <div className="rag-form-group" style={{ flex: 1 }}>
                    <label className="rag-label">🔗 Ollama 服务地址 (embedding / LLM 共用)</label>
                    <input
                      className={`rag-input ${errors['ollama.baseUrl'] ? 'rag-input-error' : ''}`}
                      value={config.ollama?.baseUrl ?? ''}
                      onChange={e => updateField('ollama', 'baseUrl', e.target.value)}
                      placeholder="http://172.17.6.18:11434"
                    />
                    {errors['ollama.baseUrl'] && <div className="ms-field-error">{errors['ollama.baseUrl']}</div>}
                  </div>
                </div>
              )}
              {t.key === 'reranker' && (
                <div className="rag-form-row">
                  <div className="rag-form-group">
                    <label className="rag-label">超时 (timeout，毫秒)</label>
                    <input
                      className={`rag-input rag-input-small ${errors[`${t.key}.timeout`] ? 'rag-input-error' : ''}`}
                      type="number"
                      value={config[t.key]?.timeout ?? ''}
                      onChange={e => updateField(t.key, 'timeout', e.target.value ? Number(e.target.value) : null)}
                      min={1000}
                      step={1000}
                    />
                    {errors[`${t.key}.timeout`] && <div className="ms-field-error">{errors[`${t.key}.timeout`]}</div>}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="rag-actions" style={{ marginTop: 16 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`rag-btn rag-btn-primary ${saving ? 'rag-btn-disabled' : ''}`}
            >
              {saving ? '保存中...' : '💾 保存配置'}
            </button>
            <button onClick={loadAll} className="rag-btn rag-btn-secondary" style={{ marginLeft: 8 }} disabled={saving}>
              ↩️ 撤销修改
            </button>
            <button
              onClick={handleReset}
              disabled={saving}
              className="rag-btn rag-btn-danger"
              style={{ marginLeft: 8 }}
            >
              🔄 恢复默认配置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
