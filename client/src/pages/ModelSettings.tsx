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
              <h4 className="ms-form-title">{t.icon} {t.label}</h4>
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
