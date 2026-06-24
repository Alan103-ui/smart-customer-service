/**
 * 智能意图理解测试组件
 * 功能：输入问题 → 查看意图识别结果（一级/二级分类、实体、隐含需求）
 */

import React, { useState } from 'react';
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
          className={`tab-btn ${!batchMode ? 'active' : ''}`}
          onClick={() => setBatchMode(false)}
        >
          单条测试
        </button>
        <button
          className={`tab-btn ${batchMode ? 'active' : ''}`}
          onClick={() => setBatchMode(true)}
        >
          批量测试
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
