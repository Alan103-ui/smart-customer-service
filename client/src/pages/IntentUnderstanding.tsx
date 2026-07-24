/**
 * 智能意图理解测试组件
 * 功能：输入问题 → 查看意图识别结果（一级/二级分类、实体、隐含需求）
 */

import React, { useState } from 'react';
import IntentCorrector from '../components/IntentCorrector';
import './IntentUnderstanding.css';

interface IntentResult {
  primaryIntent: {
    level1: string;
    level2: string | null;
    confidence: number;
  };
  subIntents: Array<{
    level1: string;
    level2?: string;
    confidence: number;
  }>;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  implicitNeeds?: Array<{
    need: string;
    confidence: number;
    evidence: string;
  }>;
  disambiguation: any;
  needClarification: boolean;
  suggestedActions?: string[];
  isFallback?: boolean;
  rawResponse?: string;
}

const INTENT_LABELS: Record<string, string> = {
  // 一级分类
  query: '信息查询',
  process: '流程咨询',
  complaint: '问题投诉',
  suggestion: '建议反馈',
  greeting: '闲聊问候',
  // 二级分类 - query
  policy: '政策类',
  operation: '操作类',
  data: '数据类',
  contact: '联系方式',
  // 二级分类 - process
  apply: '申请',
  approve: '审批',
  execute: '执行',
  query_status: '查询进度',
  // 二级分类 - complaint
  quality: '质量',
  delay: '时效',
  service: '服务',
  complaint_other: '其他',
  // 二级分类 - suggestion
  improve: '改进',
  new_feature: '新功能',
  optimization: '优化',
  // 二级分类 - greeting（不设置other，避免歧义）
  hello: '问候',
  thanks: '感谢',
  goodbye: '告别'
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: '人物',
  org: '组织',
  policy: '政策',
  amount: '金额',
  time: '时间',
  location: '地点',
  contact: '联系方式',
  other: '其他'
};

export default function IntentUnderstanding() {
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntentResult | null>(null);
  const [error, setError] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [batchQueries, setBatchQueries] = useState('');
  const [batchResults, setBatchResults] = useState<IntentResult[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // ===== 意图纠错闭环 =====
  const [corrMode, setCorrMode] = useState(false); // 第三个 Tab：意图纠错
  const [recognitions, setRecognitions] = useState<any[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recCorrectingId, setRecCorrectingId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [corrListLoading, setCorrListLoading] = useState(false);
  const [feedbackStats, setFeedbackStats] = useState<any>(null);
  const [applying, setApplying] = useState(false);

  // ===== 规则导入 / 导出 =====
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'overwrite'>('append');
  const [importing, setImporting] = useState(false);

  function authHeaders() {
    const token = localStorage.getItem('cs_token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function loadRecognitions() {
    setRecLoading(true);
    try {
      const res = await fetch('/api/admin/intent-recognitions?limit=50', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setRecognitions(data.items || []);
    } catch (e) { /* ignore */ } finally { setRecLoading(false); }
  }

  async function loadCorrections() {
    setCorrListLoading(true);
    try {
      const res = await fetch('/api/admin/intent-corrections?limit=200', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setCorrections(data.items || []);
    } catch (e) { /* ignore */ } finally { setCorrListLoading(false); }
  }

  async function loadFeedbackStats() {
    try {
      const res = await fetch('/api/admin/intent-feedback/stats', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setFeedbackStats(data.stats);
    } catch (e) { /* ignore */ }
  }

  // 进入纠错 Tab 时加载数据
  React.useEffect(() => {
    if (corrMode) { loadRecognitions(); loadCorrections(); loadFeedbackStats(); }
  }, [corrMode]);

  async function submitRecCorrection(rec: any, payload: { correctedIntent: { level1: string; level2: string | null }; note: string; makeRule: boolean }) {
    const res = await fetch('/api/admin/intent-correct', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        userMessage: rec.question,
        originalIntent: { level1: rec.intent, level2: rec.intentLevel2 || null, confidence: rec.confidence },
        correctedIntent: payload.correctedIntent,
        note: payload.note, makeRule: payload.makeRule
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '提交失败');
    setRecCorrectingId(null);
    await Promise.all([loadRecognitions(), loadCorrections(), loadFeedbackStats()]);
    showToast('已提交纠错', 'success');
  }

  async function deleteCorrection(id: string) {
    const res = await fetch(`/api/admin/intent-corrections/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (data.success) { await Promise.all([loadCorrections(), loadFeedbackStats()]); showToast('已删除', 'success'); }
    else showToast(data.error || '删除失败', 'error');
  }

  async function applyFeedback() {
    setApplying(true);
    try {
      const res = await fetch('/api/admin/intent-feedback/apply', { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setFeedbackStats(prev => ({ ...prev, feedback: data.stats, lastAppliedAt: new Date().toISOString() }));
        await loadCorrections();
        showToast(`已沉淀：${data.stats.fewShotCount} 条样例 / ${data.stats.ruleCount} 条规则`, 'success');
      } else showToast(data.error || '沉淀失败', 'error');
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setApplying(false); }
  }

  async function handleExport(format: 'json' | 'csv') {
    try {
      const token = localStorage.getItem('cs_token');
      const res = await fetch(`/api/admin/intent-feedback/export?format=${format}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || '导出失败'); }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'csv' ? `intent-rules-${Date.now()}.csv` : `intent-feedback-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      showToast('已导出', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  }

  async function handleImport() {
    if (!importFile) { showToast('请先选择文件', 'error'); return; }
    if (importMode === 'overwrite') {
      if (!window.confirm('覆盖模式将清空现有全部纠错规则，仅保留本次导入，且导入前已自动快照。确认继续？')) return;
    }
    setImporting(true);
    try {
      const token = localStorage.getItem('cs_token');
      const form = new FormData();
      form.append('file', importFile);
      form.append('mode', importMode);
      const res = await fetch('/api/admin/intent-feedback/import', {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form
      });
      const data = await res.json();
      if (data.success) {
        showToast(`导入完成：新增 ${data.added} 条，跳过 ${data.skipped} 条，现有规则 ${data.rules} 条`, 'success');
        await Promise.all([loadCorrections(), loadFeedbackStats()]);
        setImportFile(null);
      } else {
        showToast((data.error || '导入失败') + (data.details ? '：' + JSON.stringify(data.details) : ''), 'error');
      }
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setImporting(false); }
  }

  async function handleParse() {
    if (!query.trim()) {
      showToast('请输入测试问题', 'error');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const contextObj = context.trim() ? JSON.parse(context) : {};
      const token = localStorage.getItem('cs_token');
      const res = await fetch('/api/admin/intent-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          query: query.trim(),
          context: contextObj
        })
      });

      const data = await res.json();

      if (data.success) {
        setResult(data);
        showToast('意图理解完成', 'success');
      } else {
        setError(data.error || '解析失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchParse() {
    const queries = batchQueries
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0);

    if (queries.length === 0) {
      showToast('请输入至少一个问题', 'error');
      return;
    }

    if (queries.length > 20) {
      showToast('批量解析最多支持20条', 'error');
      return;
    }

    setBatchLoading(true);
    setBatchResults([]);
    setError('');

    try {
      const token = localStorage.getItem('cs_token');
      const res = await fetch('/api/admin/intent-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ queries })
      });

      const data = await res.json();

      if (data.success) {
        setBatchResults(data.results);
        showToast(`批量解析完成，共${data.total}条`, 'success');
      } else {
        setError(data.error || '批量解析失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBatchLoading(false);
    }
  }

  function renderIntentBadge(level1: string, level2: string | null, confidence: number) {
    const color = confidence > 0.8 ? '#67c23a' : confidence > 0.5 ? '#e6a23c' : '#f56c6c';
    const label1 = INTENT_LABELS[level1] || level1;
    const label2 = level2 ? (INTENT_LABELS[level2] || level2) : '';

    return (
      <span className="intent-badge" style={{ backgroundColor: color + '20', color, border: `1px solid ${color}` }}>
        {label1}{label2 && ` / ${label2}`} ({Math.round(confidence * 100)}%)
      </span>
    );
  }

  function renderEntityTag(entity: any) {
    const typeLabel = ENTITY_TYPE_LABELS[entity.type] || entity.type;
    return (
      <span key={`${entity.type}-${entity.value}`} className="entity-tag">
        {typeLabel}: {entity.value} ({Math.round(entity.confidence * 100)}%)
      </span>
    );
  }

  return (
    <div className="intent-understanding">
      <div className="intent-header">
        <h2>🧠 智能意图理解</h2>
        <p>深层语义解析 · 模糊表达消歧 · 多意图拆分 · 隐含需求推断</p>
      </div>

      <div className="intent-tabs">
        <button
          className={`tab-btn ${!batchMode && !corrMode ? 'active' : ''}`}
          onClick={() => { setBatchMode(false); setCorrMode(false); }}
        >
          单条测试
        </button>
        <button
          className={`tab-btn ${batchMode ? 'active' : ''}`}
          onClick={() => { setBatchMode(true); setCorrMode(false); }}
        >
          批量测试
        </button>
        <button
          className={`tab-btn ${corrMode ? 'active' : ''}`}
          onClick={() => { setBatchMode(false); setCorrMode(true); }}
        >
          🔁 意图纠错
        </button>
      </div>

      {!batchMode ? (
        /* 单条测试 */
        <div className="intent-single-test">
          <div className="input-group">
            <label>测试问题</label>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="输入用户问题，如：报销需要什么材料？"
              rows={3}
            />
          </div>

          <div className="input-group">
            <label>对话上下文（可选，JSON格式）</label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder='{"previousIntents": ["query"], "sessionTopic": "报销"}'
              rows={2}
              className="context-input"
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleParse}
            disabled={loading}
          >
            {loading ? '理解中...' : '🧠 解析意图'}
          </button>

          {/* 结果展示 */}
          {result && (
            <div className="intent-result">
              <h3>📊 理解结果</h3>

              {result.isFallback && (
                <div className="fallback-warning">
                  ⚠️ 使用降级模式（LLM调用失败，基于关键词匹配）
                </div>
              )}

              {/* 主意图 */}
              <div className="result-section">
                <h4>主意图</h4>
                <div className="intent-main">
                  {renderIntentBadge(
                    result.primaryIntent.level1,
                    result.primaryIntent.level2,
                    result.primaryIntent.confidence
                  )}
                </div>
              </div>

              {/* 子意图（多意图） */}
              {result.subIntents && result.subIntents.length > 0 && (
                <div className="result-section">
                  <h4>子意图（多意图拆分）</h4>
                  <div className="intent-subs">
                    {result.subIntents.map((si, i) => (
                      <div key={i} className="intent-sub-item">
                        {renderIntentBadge(si.level1, si.level2 || null, si.confidence)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 实体提取 */}
              <div className="result-section">
                <h4>实体提取</h4>
                {result.entities.length > 0 ? (
                  <div className="entities-list">
                    {result.entities.map((e, i) => renderEntityTag(e))}
                  </div>
                ) : (
                  <p className="no-data">未提取到实体</p>
                )}
              </div>

              {/* 隐含需求 */}
              {result.implicitNeeds && result.implicitNeeds.length > 0 && (
                <div className="result-section">
                  <h4>隐含需求推断</h4>
                  <div className="implicit-needs">
                    {result.implicitNeeds.map((need, i) => (
                      <div key={i} className="need-item">
                        <span className="need-text">{need.need}</span>
                        <span className="need-confidence">
                          置信度: {Math.round(need.confidence * 100)}%
                        </span>
                        {need.evidence && (
                          <span className="need-evidence">证据: {need.evidence}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 消歧 */}
              {result.needClarification && result.disambiguation && (
                <div className="result-section">
                  <h4>⚠️ 需要消歧</h4>
                  <div className="disambiguation">
                    <p>歧义术语: <strong>{result.disambiguation.ambiguousTerm}</strong></p>
                    <p>候选含义:</p>
                    <ul>
                      {result.disambiguation.candidates.map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* 建议动作 */}
              {result.suggestedActions && result.suggestedActions.length > 0 && (
                <div className="result-section">
                  <h4>建议动作</h4>
                  <ul className="suggested-actions">
                    {result.suggestedActions.map((action, i) => (
                      <li key={i}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 原始响应（调试用） */}
          {result?.rawResponse && (
            <details className="raw-response">
              <summary>原始LLM响应（调试）</summary>
              <pre>{result.rawResponse}</pre>
            </details>
          )}
        </div>
      ) : (
        /* 批量测试 */
        <div className="intent-batch-test">
          <div className="input-group">
            <label>批量问题（每行一条）</label>
            <textarea
              value={batchQueries}
              onChange={e => setBatchQueries(e.target.value)}
              placeholder={"请输入多个问题，每行一条：\n报销需要什么材料？\n预算申请流程是啥？\n投诉产品质量问题"}
              rows={8}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleBatchParse}
            disabled={batchLoading}
          >
            {batchLoading ? '解析中...' : '🧠 批量解析意图'}
          </button>

          {/* 批量结果 */}
          {batchResults.length > 0 && (
            <div className="batch-results">
              <h3>📊 批量结果（共{batchResults.length}条）</h3>
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>问题</th>
                    <th>主意图</th>
                    <th>置信度</th>
                    <th>实体数</th>
                    <th>子意图</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="query-cell">{batchQueries.split('\n')[i]}</td>
                      <td>
                        {INTENT_LABELS[r.primaryIntent.level1] || r.primaryIntent.level1}
                        {r.primaryIntent.level2 && (
                          <span className="level2">
                            / {INTENT_LABELS[r.primaryIntent.level2] || r.primaryIntent.level2}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`confidence ${r.primaryIntent.confidence > 0.8 ? 'high' : r.primaryIntent.confidence > 0.5 ? 'medium' : 'low'}`}>
                          {Math.round(r.primaryIntent.confidence * 100)}%
                        </span>
                      </td>
                      <td>{r.entities.length}</td>
                      <td>{r.subIntents?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {corrMode && (
        <div className="intent-correction-panel">
          {/* 规则导入 / 导出 */}
          <div className="corr-section">
            <h3>💾 规则导入 / 导出（备份与迁移）</h3>
            <div className="io-toolbar">
              <button className="btn" onClick={() => handleExport('json')}>⬇️ 导出 JSON（全量）</button>
              <button className="btn" onClick={() => handleExport('csv')}>⬇️ 导出规则 CSV</button>
              <span className="io-divider" />
              <label className="file-label">
                📂 选择文件
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={e => setImportFile(e.target.files && e.target.files.length ? e.target.files[0] : null)}
                />
              </label>
              <select value={importMode} onChange={e => setImportMode(e.target.value as 'append' | 'overwrite')} title="追加：保留现有；覆盖：清空后导入（导入前自动快照，可恢复）">
                <option value="append">➕ 追加（保留现有）</option>
                <option value="overwrite">♻️ 覆盖（清空后导入）</option>
              </select>
              <button className="btn btn-primary" onClick={handleImport} disabled={!importFile || importing}>
                {importing ? '导入中...' : '⬆️ 导入'}
              </button>
              {importFile && <span className="file-name">{importFile.name}</span>}
            </div>
            <p className="io-hint">导出含全部纠错记录与沉淀规则；导入支持本系统导出的 JSON（全量包或数组）或规则 CSV。覆盖模式导入前自动快照，可从「数据备份」页一键恢复。</p>
          </div>

          {/* 反馈沉淀统计 */}
          <div className="corr-section">
            <h3>📈 反馈沉淀</h3>
            {feedbackStats ? (
              <div className="feedback-stats">
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.totalCorrections}</div>
                  <div className="stat-label">累计纠错</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.appliedCorrections}</div>
                  <div className="stat-label">已沉淀</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.feedback?.fewShotCount ?? 0}</div>
                  <div className="stat-label">few-shot 样例</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.feedback?.ruleCount ?? 0}</div>
                  <div className="stat-label">确定性规则</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.bySource?.chat ?? 0}</div>
                  <div className="stat-label">聊天端</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{feedbackStats.bySource?.admin ?? 0}</div>
                  <div className="stat-label">后台</div>
                </div>
              </div>
            ) : <p className="no-data">加载中...</p>}
            <button className="btn btn-primary" onClick={applyFeedback} disabled={applying}>
              {applying ? '沉淀中...' : '🔁 一键沉淀为样例/规则（反哺分类器）'}
            </button>
            {feedbackStats?.lastAppliedAt && (
              <span className="last-applied">上次沉淀：{new Date(feedbackStats.lastAppliedAt).toLocaleString('zh-CN')}</span>
            )}
          </div>

          {/* 在线识别记录 */}
          <div className="corr-section">
            <h3>🧾 在线意图识别记录（可纠错）</h3>
            {recLoading ? <p className="no-data">加载中...</p> :
              recognitions.length === 0 ? <p className="no-data">暂无识别记录（去聊天里问几个问题就会有）</p> :
              <table className="batch-table corr-table">
                <thead>
                  <tr>
                    <th>用户问题</th>
                    <th>识别意图</th>
                    <th>置信度</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recognitions.map((r, i) => (
                    <React.Fragment key={r.id || i}>
                      <tr>
                        <td className="query-cell">{r.question}</td>
                        <td>
                          {r.intent ? (
                            <span className="intent-badge-sm">
                              {INTENT_LABELS[r.intent] || r.intent}
                              {r.intentLevel2 && <span className="lv2"> / {INTENT_LABELS[r.intentLevel2] || r.intentLevel2}</span>}
                            </span>
                          ) : <span className="no-intent">未识别</span>}
                        </td>
                        <td>
                          {typeof r.confidence === 'number' ? (
                            <span className={`confidence ${r.confidence > 0.8 ? 'high' : r.confidence > 0.5 ? 'medium' : 'low'}`}>
                              {Math.round(r.confidence * 100)}%
                            </span>
                          ) : '-'}
                        </td>
                        <td className="time-cell">{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '-'}</td>
                        <td>
                          <button className="corr-btn" onClick={() => setRecCorrectingId(prev => prev === (r.id || i) ? null : (r.id || i))}>
                            {recCorrectingId === (r.id || i) ? '收起' : '纠错'}
                          </button>
                        </td>
                      </tr>
                      {recCorrectingId === (r.id || i) && (
                        <tr className="corr-edit-row">
                          <td colSpan={5}>
                            <IntentCorrector
                              currentLevel1={r.intent}
                              currentLevel2={r.intentLevel2 || null}
                              onSubmit={(p) => submitRecCorrection(r, p)}
                              onCancel={() => setRecCorrectingId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            }
          </div>

          {/* 纠错记录 */}
          <div className="corr-section">
            <h3>🗂 纠错记录</h3>
            {corrListLoading ? <p className="no-data">加载中...</p> :
              corrections.length === 0 ? <p className="no-data">暂无纠错记录</p> :
              <table className="batch-table corr-table">
                <thead>
                  <tr>
                    <th>用户问题</th>
                    <th>原意图</th>
                    <th>纠正为</th>
                    <th>来源</th>
                    <th>状态</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((c, i) => (
                    <tr key={c.id || i}>
                      <td className="query-cell">{c.userMessage}</td>
                      <td>
                        {c.originalIntent?.level1 ? (
                          <span className="intent-badge-sm old">
                            {INTENT_LABELS[c.originalIntent.level1] || c.originalIntent.level1}
                            {c.originalIntent.level2 && <span className="lv2"> / {INTENT_LABELS[c.originalIntent.level2] || c.originalIntent.level2}</span>}
                          </span>
                        ) : <span className="no-intent">-</span>}
                      </td>
                      <td>
                        <span className="intent-badge-sm new">
                          {INTENT_LABELS[c.correctedIntent?.level1] || c.correctedIntent?.level1}
                          {c.correctedIntent?.level2 && <span className="lv2"> / {INTENT_LABELS[c.correctedIntent.level2] || c.correctedIntent.level2}</span>}
                        </span>
                      </td>
                      <td>{c.source === 'chat' ? '聊天端' : '后台'}</td>
                      <td>{c.applied ? <span className="applied-tag">已沉淀</span> : <span className="pending-tag">待沉淀</span>}</td>
                      <td className="time-cell">{c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN') : '-'}</td>
                      <td><button className="corr-del-btn" onClick={() => deleteCorrection(c.id)}>删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          </div>
        </div>
      )}
    </div>
  );
}

/* Toast 通知 */
let toastTimer: number;
function showToast(message: string, type: 'success' | 'error' | 'info') {
  const existing = document.querySelector('.intent-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `intent-toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.remove(), 3000);
}
