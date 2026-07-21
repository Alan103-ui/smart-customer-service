import { useState, useEffect, useRef } from 'react';
import { getAuthHeaders } from '../services/api';
import IntentUnderstanding from './IntentUnderstanding';

// ==================== Toast 通知组件 ====================
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastIdCounter = 0;

// ==================== RAG 管理组件 ====================
export default function RAGManagement() {
  const [activeTab, setActiveTab] = useState<'stats' | 'test' | 'eval' | 'intent' | 'rewrite' | 'performance' | 'memory'>('stats');
  const [loading, setLoading] = useState(false);
  
  // Toast 通知
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // 统计信息
  const [vectorStats, setVectorStats] = useState<any>(null);
  const [bm25Enabled, setBm25Enabled] = useState(false);
  
  // 测试搜索
  const [testQuery, setTestQuery] = useState('');
  const [testMode, setTestMode] = useState<'hybrid' | 'vector' | 'bm25'>('hybrid');
  const [testTopK, setTestTopK] = useState(5);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [testLoading, setTestLoading] = useState(false);
  
  // 评估
  const [evalK, setEvalK] = useState(5);
  const [evalMode, setEvalMode] = useState<'hybrid' | 'vector' | 'bm25'>('hybrid');
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalReport, setEvalReport] = useState<any>(null);
  const [evalReportPath, setEvalReportPath] = useState<string>('');
  
  // 答案改写
  const [rewriteInput, setRewriteInput] = useState('');
  const [rewriteTone, setRewriteTone] = useState('亲切友好');
  const [rewriteResult, setRewriteResult] = useState('');
  const [rewriteLoading, setRewriteLoading] = useState(false);
  
  // 性能监控
  const [perfLoading, setPerfLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [performanceReport, setPerformanceReport] = useState<any>(null);
  const [selectedPerfType, setSelectedPerfType] = useState<'embedding' | 'reranker'>('embedding');
  const [perfRefreshTimer, setPerfRefreshTimer] = useState<NodeJS.Timeout | null>(null);

  // 记忆管理
  const [memoryStats, setMemoryStats] = useState<any>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  
  const API_BASE = '/api/admin';

  // ==================== Toast 通知函数 ====================
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // ==================== 获取记忆统计 ====================
  const fetchMemoryStats = async () => {
    if (memoryLoading) return;
    setMemoryLoading(true);
    try {
      const res = await fetch('/api/chat/memory-stats', { headers: getAuthHeaders() });
      if (!res.ok) { showToast('获取记忆统计失败: ' + res.status, 'error'); setMemoryStats(null); }
      else { setMemoryStats(await res.json()); }
    } catch (err: any) { showToast('获取记忆统计失败: ' + (err?.message || '未知错误'), 'error'); setMemoryStats(null); }
    finally { setMemoryLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'memory') fetchMemoryStats();
  }, [activeTab]);

  // ==================== 获取统计信息 ====================
  const fetchStats = async () => {
    setLoading(true);
    try {
      // 向量库统计
      const vectorRes = await fetch(`${API_BASE}/vector-stats`, { headers: getAuthHeaders() });
      setVectorStats(await vectorRes.json());

      // BM25 索引状态
      try {
        const bm25Res = await fetch(`${API_BASE}/bm25-stats`, { headers: getAuthHeaders() });
        const bm25Data = await bm25Res.json();
        setBm25Enabled(bm25Data.enabled);
      } catch (e) {
        setBm25Enabled(false);
      }
      
      showToast('统计信息已刷新', 'success');
    } catch (err: any) {
      showToast('获取统计信息失败: ' + err.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // ==================== 测试搜索 ====================
  const handleTestSearch = async () => {
    if (!testQuery.trim()) {
      showToast('请输入查询文本', 'error');
      return;
    }
    setTestLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rag-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ query: testQuery, mode: testMode, topK: testTopK })
      });
      const data = await res.json();
      if (data.success) {
        setTestResults(data.results || []);
        showToast(`搜索完成，找到 ${data.results?.length || 0} 条结果`, 'success');
      } else {
        showToast('搜索失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('搜索失败: ' + err.message, 'error');
    }
    setTestLoading(false);
  };

  // ==================== 运行评估 ====================
  const handleRunEval = async () => {
    if (!confirm(`确定运行 RAG 评估？\n模式: ${evalMode}\nK值: ${evalK}\n\n评估可能需要几分钟，请耐心等待...`)) return;
    
    setEvalRunning(true);
    setEvalReport(null);
    try {
      const res = await fetch(`${API_BASE}/rag-eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ k: evalK, mode: evalMode })
      });
      const data = await res.json();
      if (data.success) {
        showToast('评估任务已启动，正在运行...', 'info');
        // 轮询评估报告和向量库统计
        pollEvalReport();
      } else {
        showToast('评估启动失败: ' + (data.error || '未知错误'), 'error');
        setEvalRunning(false);
      }
    } catch (err: any) {
      showToast('评估启动失败: ' + err.message, 'error');
      setEvalRunning(false);
    }
  };

  const pollEvalReport = async () => {
    // 简单轮询：每5秒检查一次，最多12次（1分钟）
    let attempts = 0;
    const maxAttempts = 12;
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        showToast('评估超时，请手动查看报告文件', 'error');
        setEvalRunning(false);
        return;
      }
      
      attempts++;
      
      try {
        // 尝试获取评估报告（假设保存在 data/rag-eval-latest.json）
        const token = localStorage.getItem('cs_token');
        const res = await fetch('/api/admin/eval-report-latest', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const report = await res.json();
          setEvalReport(report);
          setEvalRunning(false);
          showToast('评估完成！', 'success');
          return;
        }
      } catch (e) {
        // 报告尚未生成，继续轮询
      }
      
      // 继续轮询
      setTimeout(poll, 5000);
    };
    
    poll();
  };

  // ==================== 答案改写 ====================
  const handleRewrite = async () => {
    if (!rewriteInput.trim()) {
      showToast('请输入要改写的答案', 'error');
      return;
    }
    setRewriteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rewrite-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ answer: rewriteInput, tone: rewriteTone })
      });
      const data = await res.json();
      if (data.success) {
        setRewriteResult(data.rewritten);
        showToast('答案改写成功', 'success');
      } else {
        showToast('改写失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('改写失败: ' + err.message, 'error');
    }
    setRewriteLoading(false);
  };

  const handleRewriteBatch = async () => {
    if (!rewriteInput.trim()) {
      showToast('请输入要批量改写的答案（每行一个）', 'error');
      return;
    }
    setRewriteLoading(true);
    try {
      const answers = rewriteInput.split('\n').filter(a => a.trim());
      const res = await fetch(`${API_BASE}/rewrite-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ answers, tone: rewriteTone })
      });
      const data = await res.json();
      if (data.success) {
        setRewriteResult(data.results?.map((r: any) => r.rewritten).join('\n\n') || '');
        showToast(`批量改写完成，共 ${data.total} 条`, 'success');
      } else {
        showToast('批量改写失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('批量改写失败: ' + err.message, 'error');
    }
    setRewriteLoading(false);
  };

  // ==================== 性能监控 ====================
  const fetchModelStatus = async () => {
    setPerfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/models/status`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) {
        setModelStatus(data);
        showToast('模型状态已刷新', 'success');
      } else {
        showToast('获取模型状态失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('获取模型状态失败: ' + err.message, 'error');
    }
    setPerfLoading(false);
  };

  const fetchPerformanceReport = async (type?: 'embedding' | 'reranker') => {
    try {
      const url = type ? `${API_BASE}/models/performance?type=${type}` : `${API_BASE}/models/performance`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) {
        setPerformanceReport(data.report);
      } else {
        showToast('获取性能报告失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('获取性能报告失败: ' + err.message, 'error');
    }
  };

  const handleResetPerformance = async (type?: 'embedding' | 'reranker') => {
    if (!confirm(`确定重置${type ? type : '所有'}性能统计？`)) return;
    try {
      const res = await fetch(`${API_BASE}/models/performance/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (data.success) {
        showToast('性能统计已重置', 'success');
        fetchModelStatus();
        fetchPerformanceReport(selectedPerfType);
      } else {
        showToast('重置失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err: any) {
      showToast('重置失败: ' + err.message, 'error');
    }
  };

  // 自动刷新性能数据
  useEffect(() => {
    if (activeTab === 'performance') {
      fetchModelStatus();
      fetchPerformanceReport(selectedPerfType);
      
      // 每120秒自动刷新
      const timer = setInterval(() => {
        fetchModelStatus();
        fetchPerformanceReport(selectedPerfType);
      }, 120000);
      
      return () => clearInterval(timer);
    }
  }, [activeTab, selectedPerfType]);

  // ==================== UI 渲染 ====================
  return (
    <div className="rag-management">
      {/* Toast 通知容器 */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.type === 'success' && '✅ '}
            {toast.type === 'error' && '❌ '}
            {toast.type === 'info' && 'ℹ️ '}
            {toast.message}
          </div>
        ))}
      </div>

      <h2 className="rag-title">🤖 RAG 管理</h2>

      {/* Tab 切换 */}
      <div className="ui-tabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'stats', label: '📊 统计信息' },
          { key: 'test', label: '🔍 测试搜索' },
          { key: 'eval', label: '📈 效果评估' },
          { key: 'intent', label: '🧠 意图理解' },
          { key: 'rewrite', label: '✏️ 答案改写' },
          { key: 'performance', label: '⚡ 性能监控' },
          { key: 'memory', label: '🧠 记忆管理' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`ui-tab ${activeTab === tab.key ? 'ui-tab--active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 统计信息 Tab */}
      {activeTab === 'stats' && (
        <div className="rag-tab-content">
          {loading ? (
            <div className="rag-loading">加载中...</div>
          ) : (
            <div>
              {/* 向量库统计 */}
              <div className="rag-card">
                <h3 className="rag-card-title">📊 向量库统计</h3>
                {vectorStats ? (
                  <div className="rag-stats-grid">
                    <StatCard label="总向量数" value={vectorStats.totalChunks} />
                    <StatCard label="唯一文档数" value={vectorStats.uniqueDocs} />
                    <StatCard label="嵌入模型" value={vectorStats.embeddingModel} />
                    <StatCard label="更新时间" value={vectorStats.updatedAt ? new Date(vectorStats.updatedAt).toLocaleString() : 'N/A'} />
                    {vectorStats.chunkTypes && Object.entries(vectorStats.chunkTypes).map(([type, count]) => (
                      <StatCard key={type} label={`分块类型: ${type}`} value={count as number} />
                    ))}
                  </div>
                ) : (
                  <div className="rag-empty">暂无数据</div>
                )}
              </div>

              {/* BM25 索引状态 */}
              <div className="rag-card">
                <h3 className="rag-card-title">🔤 BM25 关键词索引</h3>
                <div className="rag-bm25-status">
                  <span className={`rag-status-dot ${bm25Enabled ? 'rag-status-ok' : 'rag-status-warn'}`} />
                  <span className="rag-status-text">
                    {bm25Enabled ? '✅ BM25 索引已构建' : '⚠️ BM25 索引未构建（将自动构建）'}
                  </span>
                </div>
                <div className="rag-card-desc">
                  BM25 索引用于混合检索（Hybrid Search），结合向量相似度和关键词匹配，提升检索精度。
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="rag-actions">
                <button onClick={fetchStats} className="rag-btn rag-btn-secondary">
                  🔄 刷新统计
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 测试搜索 Tab */}
      {activeTab === 'test' && (
        <div className="rag-tab-content">
          <div className="rag-card">
            <h3 className="rag-card-title">🔍 测试 RAG 检索</h3>
            
            {/* 搜索表单 */}
            <div className="rag-form">
              <div className="rag-form-group">
                <label className="rag-label">查询文本</label>
                <input
                  type="text"
                  value={testQuery}
                  onChange={e => setTestQuery(e.target.value)}
                  placeholder="输入测试查询..."
                  className="rag-input"
                />
              </div>
              
              <div className="rag-form-row">
                <div className="rag-form-group">
                  <label className="rag-label">检索模式</label>
                  <select
                    value={testMode}
                    onChange={e => setTestMode(e.target.value as any)}
                    className="rag-select"
                  >
                    <option value="hybrid">混合检索（BM25 + 向量）</option>
                    <option value="vector">仅向量检索</option>
                    <option value="bm25">仅 BM25 关键词检索</option>
                  </select>
                </div>
                
                <div className="rag-form-group">
                  <label className="rag-label">返回数量 (Top K)</label>
                  <input
                    type="number"
                    value={testTopK}
                    onChange={e => setTestTopK(Number(e.target.value))}
                    min={1}
                    max={20}
                    className="rag-input rag-input-small"
                  />
                </div>
              </div>
              
              <button
                onClick={handleTestSearch}
                disabled={testLoading || !testQuery.trim()}
                className={`rag-btn rag-btn-primary ${testLoading || !testQuery.trim() ? 'rag-btn-disabled' : ''}`}
              >
                {testLoading ? '搜索中...' : '🔍 测试搜索'}
              </button>
            </div>
          </div>

          {/* 搜索结果 */}
          {testResults.length > 0 && (
            <div className="rag-card" style={{ marginTop: 20 }}>
              <h3 className="rag-card-title">📋 搜索结果（共 {testResults.length} 条）</h3>
              <div className="rag-results">
                {testResults.map((result, idx) => (
                  <div key={idx} className="rag-result-item">
                    <div className="rag-result-header">
                      <span className="rag-result-rank">#{idx + 1}</span>
                      <span className="rag-result-score">
                        相关度: {(result.score * 100)?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="rag-result-question">
                      <strong>问题：</strong>{result.question}
                    </div>
                    <div className="rag-result-category">
                      <strong>分类：</strong>{result.category || '未分类'}
                    </div>
                    <div className="rag-result-content">
                      <strong>答案：</strong>{result.content?.slice(0, 200) || '无内容'}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 效果评估 Tab */}
      {activeTab === 'eval' && (
        <div className="rag-tab-content">
          <div className="rag-card">
            <h3 className="rag-card-title">📈 RAG 效果评估</h3>
            <p className="rag-card-desc">
              运行评估脚本，量化 RAG 检索效果。评估指标包括：Precision@K、Recall@K、MRR、NDCG。
            </p>
            
            <div className="rag-form-row">
              <div className="rag-form-group">
                <label className="rag-label">评估模式</label>
                <select
                  value={evalMode}
                  onChange={e => setEvalMode(e.target.value as any)}
                  className="rag-select"
                >
                  <option value="hybrid">混合检索（BM25 + 向量）</option>
                  <option value="vector">仅向量检索</option>
                  <option value="bm25">仅 BM25 关键词检索</option>
                </select>
              </div>
              
              <div className="rag-form-group">
                <label className="rag-label">K 值</label>
                <input
                  type="number"
                  value={evalK}
                  onChange={e => setEvalK(Number(e.target.value))}
                  min={1}
                  max={20}
                  className="rag-input rag-input-small"
                />
              </div>
            </div>
            
            <button
              onClick={handleRunEval}
              disabled={evalRunning}
              className={`rag-btn rag-btn-success ${evalRunning ? 'rag-btn-disabled' : ''}`}
            >
              {evalRunning ? '评估中...' : '📈 运行评估'}
            </button>
          </div>

          {/* 评估说明 */}
          <div className="rag-card rag-card-info">
            <h4 className="rag-card-title">💡 评估说明</h4>
            <ul className="rag-eval-list">
              <li><strong>Precision@K</strong>：Top-K 结果中有多少是相关的？</li>
              <li><strong>Recall@K</strong>：相关文档有多少在 Top-K 中？</li>
              <li><strong>MRR</strong>：第一个相关文档的排名的倒数</li>
              <li><strong>NDCG</strong>：考虑相关文档位置的归一化累积增益</li>
            </ul>
          </div>

          {/* 评估结果 */}
          {evalReport && (
            <div className="rag-card">
              <h3 className="rag-card-title">📊 评估结果</h3>
              
              {/* 指标卡片 */}
              <div className="rag-stats-grid" style={{ marginBottom: 20 }}>
                <div className="rag-stat-card" style={{ borderLeft: '4px solid #1890ff' }}>
                  <div className="rag-stat-label">Precision@{evalReport.config?.k || 3}</div>
                  <div className="rag-stat-value">{(evalReport.metrics?.avgPrecision * 100)?.toFixed(1)}%</div>
                </div>
                <div className="rag-stat-card" style={{ borderLeft: '4px solid #52c41a' }}>
                  <div className="rag-stat-label">Recall@{evalReport.config?.k || 3}</div>
                  <div className="rag-stat-value">{(evalReport.metrics?.avgRecall * 100)?.toFixed(1)}%</div>
                </div>
                <div className="rag-stat-card" style={{ borderLeft: '4px solid #faad14' }}>
                  <div className="rag-stat-label">MRR</div>
                  <div className="rag-stat-value">{evalReport.metrics?.avgMrr?.toFixed(3)}</div>
                </div>
                <div className="rag-stat-card" style={{ borderLeft: '4px solid #f5222d' }}>
                  <div className="rag-stat-label">NDCG@{evalReport.config?.k || 3}</div>
                  <div className="rag-stat-value">{evalReport.metrics?.avgNdcg?.toFixed(3)}</div>
                </div>
              </div>

              {/* 配置信息 */}
              <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
                评估模式：<strong>{evalReport.config?.mode}</strong> | 
                K值：<strong>{evalReport.config?.k}</strong> | 
                测试查询数：<strong>{evalReport.config?.totalQueries}</strong> | 
                找到率：<strong>{(evalReport.metrics?.foundRate * 100)?.toFixed(1)}%</strong>
              </div>

              {/* 详细评估结果表格 */}
              <h4 style={{ marginBottom: 12, fontSize: 16 }}>详细评估结果</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>#</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>查询</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Precision</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Recall</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>MRR</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>找到</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>最高分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalReport.details?.map((detail: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e8e8e8', background: detail.found ? '#f6ffed' : '#fff2f0' }}>
                        <td style={{ padding: '8px 12px' }}>{idx + 1}</td>
                        <td style={{ padding: '8px 12px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail.query}>
                          {detail.query}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <span style={{ color: detail.precision > 0.5 ? '#52c41a' : '#f5222d', fontWeight: 500 }}>
                            {(detail.precision * 100)?.toFixed(1)}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <span style={{ color: detail.recall > 0.5 ? '#52c41a' : '#f5222d', fontWeight: 500 }}>
                            {(detail.recall * 100)?.toFixed(1)}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{detail.mrr?.toFixed(3)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {detail.found ? '✅' : '❌'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                          {detail.topScore?.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 错误列表 */}
              {evalReport.errors && evalReport.errors.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ marginBottom: 12, fontSize: 16, color: '#f5222d' }}>错误</h4>
                  <ul style={{ color: '#f5222d', fontSize: 13 }}>
                    {evalReport.errors.map((err: string, idx: number) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 意图理解 Tab（由原独立页面合并而来，复用带纠错闭环的 IntentUnderstanding 组件） */}
      {activeTab === 'intent' && <IntentUnderstanding />}

      {/* 答案改写 Tab */}
      {activeTab === 'rewrite' && (
        <div className="rag-tab-content">
          <div className="rag-card">
            <h3 className="rag-card-title">✏️ 答案改写</h3>
            
            {/* 单个答案改写 */}
            <div className="rag-form">
              <div className="rag-form-group">
                <label className="rag-label">输入答案</label>
                <textarea
                  value={rewriteInput}
                  onChange={e => setRewriteInput(e.target.value)}
                  placeholder="输入要改写的答案..."
                  className="rag-textarea"
                  rows={4}
                />
              </div>
              <div className="rag-form-row">
                <div className="rag-form-group">
                  <label className="rag-label">改写语气</label>
                  <select
                    value={rewriteTone}
                    onChange={e => setRewriteTone(e.target.value)}
                    className="rag-select"
                  >
                    <option value="亲切友好">亲切友好</option>
                    <option value="专业严谨">专业严谨</option>
                    <option value="简洁明了">简洁明了</option>
                    <option value="幽默风趣">幽默风趣</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleRewrite}
                disabled={rewriteLoading || !rewriteInput.trim()}
                className={`rag-btn rag-btn-primary ${rewriteLoading || !rewriteInput.trim() ? 'rag-btn-disabled' : ''}`}
              >
                {rewriteLoading ? '改写中...' : '✏️ 改写答案'}
              </button>
            </div>

            {/* 改写结果 */}
            {rewriteResult && !Array.isArray(rewriteResult) && (
              <div style={{ marginTop: 20, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                <h4 style={{ marginBottom: 12 }}>改写结果</h4>
                <div style={{ whiteSpace: 'pre-wrap' }}>{rewriteResult}</div>
              </div>
            )}
          </div>

          {/* 批量答案改写 */}
          <div className="rag-card" style={{ marginTop: 20 }}>
            <h3 className="rag-card-title">📋 批量答案改写</h3>
            <div className="rag-form">
              <div className="rag-form-group">
                <label className="rag-label">输入答案（每行一个）</label>
                <textarea
                  value={rewriteInput}
                  onChange={e => setRewriteInput(e.target.value)}
                  placeholder="输入要批量改写的答案，每行一个..."
                  className="rag-textarea"
                  rows={6}
                />
              </div>
              <div className="rag-form-row">
                <div className="rag-form-group">
                  <label className="rag-label">改写语气</label>
                  <select
                    value={rewriteTone}
                    onChange={e => setRewriteTone(e.target.value)}
                    className="rag-select"
                  >
                    <option value="亲切友好">亲切友好</option>
                    <option value="专业严谨">专业严谨</option>
                    <option value="简洁明了">简洁明了</option>
                    <option value="幽默风趣">幽默风趣</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleRewriteBatch}
                disabled={rewriteLoading || !rewriteInput.trim()}
                className={`rag-btn rag-btn-primary ${rewriteLoading || !rewriteInput.trim() ? 'rag-btn-disabled' : ''}`}
              >
                {rewriteLoading ? '改写中...' : '📋 批量改写'}
              </button>
            </div>

            {/* 批量改写结果 */}
            {rewriteResult && Array.isArray(rewriteResult) && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ marginBottom: 12 }}>批量改写结果（共 {rewriteResult.length} 条）</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>#</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>原答案</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>改写后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rewriteResult.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #e8e8e8' }}>
                          <td style={{ padding: '8px 12px' }}>{idx + 1}</td>
                          <td style={{ padding: '8px 12px', maxWidth: 300 }}>{r.original || r.answer}</td>
                          <td style={{ padding: '8px 12px', maxWidth: 300 }}>{r.rewritten || r.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 性能监控 Tab */}
      {activeTab === 'performance' && (
        <div className="rag-tab-content">
          {perfLoading ? (
            <div className="rag-loading">加载中...</div>
          ) : (
            <div>
              {/* 模型状态卡片 */}
              <div className="rag-card">
                <h3 className="rag-card-title">⚡ 模型状态</h3>
                {modelStatus ? (
                  <div>
                    {/* Ollama 模型状态 */}
                    <div style={{ marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 16 }}>🤖 Ollama 嵌入模型</h4>
                      <div className="rag-stats-grid">
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #1890ff' }}>
                          <div className="rag-stat-label">当前主模型</div>
                          <div className="rag-stat-value">{modelStatus.currentModels?.embedding || '-'}</div>
                        </div>
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #52c41a' }}>
                          <div className="rag-stat-label">备用模型</div>
                          <div className="rag-stat-value">{modelStatus.config?.embedding?.fallback || '-'}</div>
                        </div>
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #faad14' }}>
                          <div className="rag-stat-label">健康状态</div>
                          <div className="rag-stat-value">
                            {modelStatus.health?.embedding?.available ? '✅ 正常' : '⚠️ 异常'}
                          </div>
                        </div>
                      </div>
                      
                      {/* 模型健康详情 */}
                      {modelStatus.health?.embedding && (
                        <div style={{ marginTop: 12 }}>
                          <h5 style={{ marginBottom: 8, fontSize: 14 }}>模型健康详情</h5>
                          <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span>模型名称: {modelStatus.currentModels?.embedding}</span>
                              <span>状态: {modelStatus.health?.embedding?.available ? '✅' : '⚠️'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span>响应时间: {modelStatus.health?.embedding?.lastResponseTime ? `${modelStatus.health.embedding.lastResponseTime}ms` : '-'}</span>
                              <span>最后检查: {modelStatus.health?.embedding?.lastCheck ? new Date(modelStatus.health.embedding.lastCheck).toLocaleTimeString() : '-'}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Rerank 服务状态 */}
                    <div style={{ marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 16 }}>🔄 Rerank 重排序服务</h4>
                      <div className="rag-stats-grid">
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #1890ff' }}>
                          <div className="rag-stat-label">服务地址</div>
                          <div className="rag-stat-value" style={{ fontSize: 14 }}>{modelStatus.config?.reranker?.serviceUrl || '-'}</div>
                        </div>
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #52c41a' }}>
                          <div className="rag-stat-label">健康状态</div>
                          <div className="rag-stat-value">
                            {modelStatus.health?.reranker?.available ? '✅ 正常' : '⚠️ 异常'}
                          </div>
                        </div>
                        <div className="rag-stat-card" style={{ borderLeft: '4px solid #faad14' }}>
                          <div className="rag-stat-label">响应时间</div>
                          <div className="rag-stat-value">
                            {modelStatus.health?.reranker?.lastResponseTime ? `${modelStatus.health.reranker.lastResponseTime}ms` : '-'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rag-empty">暂无数据，请点击"刷新状态"</div>
                )}
                
                <div className="rag-actions" style={{ marginTop: 16 }}>
                  <button onClick={fetchModelStatus} className="rag-btn rag-btn-secondary" disabled={perfLoading}>
                    🔄 刷新状态
                  </button>
                </div>
              </div>

              {/* 性能指标卡片 */}
              <div className="rag-card" style={{ marginTop: 20 }}>
                <h3 className="rag-card-title">📊 性能指标</h3>
                
                {/* 选择性能类型 */}
                <div className="rag-form-row" style={{ marginBottom: 16 }}>
                  <div className="rag-form-group">
                    <label className="rag-label">查看性能数据</label>
                    <select
                      value={selectedPerfType}
                      onChange={e => setSelectedPerfType(e.target.value as 'embedding' | 'reranker')}
                      className="rag-select"
                    >
                      <option value="embedding">Ollama 嵌入模型</option>
                      <option value="reranker">Rerank 重排序服务</option>
                    </select>
                  </div>
                  <div className="rag-form-group">
                    <button onClick={() => fetchPerformanceReport(selectedPerfType)} className="rag-btn rag-btn-secondary">
                      🔄 刷新数据
                    </button>
                    <button onClick={() => handleResetPerformance(selectedPerfType)} className="rag-btn rag-btn-danger" style={{ marginLeft: 8 }}>
                      🗑️ 重置统计
                    </button>
                  </div>
                </div>

                {performanceReport ? (
                  <div>
                    {/* 性能摘要 */}
                    <div className="rag-stats-grid" style={{ marginBottom: 20 }}>
                      <div className="rag-stat-card" style={{ borderLeft: '4px solid #1890ff' }}>
                        <div className="rag-stat-label">平均响应时间</div>
                        <div className="rag-stat-value">
                          {performanceReport.avgResponseTime || '-'}
                        </div>
                      </div>
                      <div className="rag-stat-card" style={{ borderLeft: '4px solid #52c41a' }}>
                        <div className="rag-stat-label">成功率</div>
                        <div className="rag-stat-value">
                          {performanceReport.successRate || '-'}
                        </div>
                      </div>
                      <div className="rag-stat-card" style={{ borderLeft: '4px solid #faad14' }}>
                        <div className="rag-stat-label">总请求数</div>
                        <div className="rag-stat-value">{performanceReport.totalRequests || 0}</div>
                      </div>
                      <div className="rag-stat-card" style={{ borderLeft: '4px solid #f5222d' }}>
                        <div className="rag-stat-label">失败请求数</div>
                        <div className="rag-stat-value">{performanceReport.failedRequests || 0}</div>
                      </div>
                    </div>

                    {/* 响应时间详情 */}
                    <div className="rag-card" style={{ marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 16 }}>⏱️ 响应时间详情</h4>
                      <div className="rag-stats-grid">
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">最小响应时间</div>
                          <div className="rag-stat-value">{performanceReport.minResponseTime || '-'}</div>
                        </div>
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">最大响应时间</div>
                          <div className="rag-stat-value">{performanceReport.maxResponseTime || '-'}</div>
                        </div>
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">最后响应时间</div>
                          <div className="rag-stat-value">{performanceReport.lastResponseTime || '-'}</div>
                        </div>
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">每分钟请求数</div>
                          <div className="rag-stat-value">{performanceReport.requestsPerMinute || 0}</div>
                        </div>
                      </div>
                    </div>

                    {/* 健康状态 */}
                    <div className="rag-card" style={{ marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 16 }}>💚 健康状态</h4>
                      <div className="rag-stats-grid">
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">健康状态</div>
                          <div className="rag-stat-value">{performanceReport.healthStatus || '-'}</div>
                        </div>
                        <div className="rag-stat-card">
                          <div className="rag-stat-label">最后健康检查</div>
                          <div className="rag-stat-value" style={{ fontSize: 14 }}>{performanceReport.lastHealthCheck || '-'}</div>
                        </div>
                      </div>
                    </div>

                    {/* 最近请求记录 */}
                    {performanceReport.recentRequests && performanceReport.recentRequests.length > 0 && (
                      <div>
                        <h4 style={{ marginBottom: 12, fontSize: 16 }}>📋 最近请求记录（共 {performanceReport.recentRequests.length} 条）</h4>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>时间</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center' }}>响应时间</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center' }}>状态</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>错误</th>
                              </tr>
                            </thead>
                            <tbody>
                              {performanceReport.recentRequests.slice(0, 10).map((req: any, idx: number) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #e8e8e8', background: req.success ? '#f6ffed' : '#fff2f0' }}>
                                  <td style={{ padding: '8px 12px', fontSize: 12 }}>
                                    {new Date(req.timestamp).toLocaleTimeString()}
                                  </td>
                                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                    {req.responseTime}ms
                                  </td>
                                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                    {req.success ? '✅' : '❌'}
                                  </td>
                                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#f5222d' }}>
                                    {req.error || '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rag-empty">暂无性能数据，请点击"刷新数据"</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

          {activeTab === 'memory' && (
            <div className="rag-tab-content">
              <div className="faq-toolbar">
                <h3>🧠 记忆管理</h3>
                <button className="btn-primary" onClick={fetchMemoryStats} disabled={memoryLoading}>
                  刷新统计
                </button>
              </div>

              {memoryLoading ? (
                <div className="rag-loading">加载中...</div>
              ) : memoryStats ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, padding: 16 }}>
                  <div style={{ background: '#e6f7ff', padding: 20, borderRadius: 8, borderLeft: '4px solid #1890ff' }}>
                    <h4>📊 总体统计</h4>
                    <p><strong>总记忆数：</strong>{memoryStats.total_memories || 0}</p>
                    <p><strong>活跃会话：</strong>{memoryStats.active_sessions || 0}</p>
                    <p><strong>记忆命中率：</strong>{((memoryStats.hit_rate || 0) * 100).toFixed(1)}%</p>
                  </div>

                  <div style={{ background: '#f6ffed', padding: 20, borderRadius: 8, borderLeft: '4px solid #52c41a' }}>
                    <h4>👤 用户记忆</h4>
                    {(() => {
                      const list = memoryStats.user_memories_list && memoryStats.user_memories_list.length > 0
                        ? memoryStats.user_memories_list
                        : (memoryStats.user_memories && Object.keys(memoryStats.user_memories).length > 0
                          ? Object.entries(memoryStats.user_memories).map(([userId, count]: [string, any]) => ({ userId, user_name: userId, username: '', count }))
                          : []);
                      if (list.length === 0) {
                        return <div style={{ color: '#999', padding: '4px 0' }}>暂无用户记忆</div>;
                      }
                      return list.map((u: any) => (
                        <div key={u.userId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span>
                            {u.user_name}
                            {u.username && u.username !== u.user_name ? `（${u.username}）` : ''}
                          </span>
                          <span>{u.count} 条记忆</span>
                        </div>
                      ));
                    })()}
                  </div>

                  <div style={{ background: '#fff7e6', padding: 20, borderRadius: 8, borderLeft: '4px solid #fa8c16' }}>
                    <h4>🏷️ 记忆类型分布</h4>
                    {memoryStats.memory_types && Object.entries(memoryStats.memory_types).map(([type, count]: [string, any]) => (
                      <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span>{type}</span>
                        <span>{count} 条</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rag-empty">暂无数据，点击"刷新统计"按钮加载</div>
              )}
            </div>
          )}

    </div>
  );
}

// ==================== 统计卡片组件 ====================
function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rag-stat-card">
      <div className="rag-stat-label">{label}</div>
      <div className="rag-stat-value">{String(value)}</div>
    </div>
  );
}
