import { useState, useEffect, useRef } from 'react';

// ==================== Toast 通知组件 ====================
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastIdCounter = 0;

// ==================== RAG 管理组件 ====================
export default function RAGManagement() {
  const [activeTab, setActiveTab] = useState<'stats' | 'test' | 'eval'>('stats');
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
  
  const API_BASE = '/api/admin';

  // ==================== Toast 通知函数 ====================
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // ==================== 获取统计信息 ====================
  const fetchStats = async () => {
    setLoading(true);
    try {
      // 向量库统计
      const vectorRes = await fetch(`${API_BASE}/vector-stats`);
      setVectorStats(await vectorRes.json());
      
      // BM25 索引状态
      try {
        const bm25Res = await fetch(`${API_BASE}/bm25-stats`);
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        const res = await fetch('/api/admin/eval-report-latest');
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
      <div className="rag-tabs">
        {[
          { key: 'stats', label: '📊 统计信息' },
          { key: 'test', label: '🔍 测试搜索' },
          { key: 'eval', label: '📈 效果评估' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`rag-tab ${activeTab === tab.key ? 'rag-tab-active' : ''}`}
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
