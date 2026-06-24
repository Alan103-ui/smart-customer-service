/**
 * LLM 智能改写答案测试组件
 * 功能：输入原始答案 → 选择语气 → 查看改写结果 + 质量评估
 */

import React, { useState } from 'react';
import './AnswerRewriter.css';

const TONE_OPTIONS = [
  { id: 'friendly', name: '亲切', description: '温和、友好、像朋友一样' },
  { id: 'professional', name: '专业', description: '正式、严谨、信息完整' },
  { id: 'concise', name: '简洁', description: '简短、直接、不啰嗦' },
  { id: 'detailed', name: '详细', description: '详细、全面、步骤清晰' }
];

function AnswerRewriter() {
  const [originalAnswer, setOriginalAnswer] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [tone, setTone] = useState('friendly');
  const [userName, setUserName] = useState('');
  const [isReturnUser, setIsReturnUser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | {
    success: boolean;
    original: string;
    rewritten: string;
    tone: string;
    quality: any;
  }>(null);
  const [error, setError] = useState('');

  // Toast 通知
  function showToast(message: string, type: 'success' | 'error' | 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  async function handleRewrite() {
    if (!originalAnswer.trim()) {
      showToast('请输入原始答案', 'error');
      return;
    }
    if (!userMessage.trim()) {
      showToast('请输入用户问题', 'error');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const token = localStorage.getItem('cs_token');
      const res = await fetch('/api/admin/rewrite-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          originalAnswer: originalAnswer.trim(),
          userMessage: userMessage.trim(),
          tone,
          userName: userName.trim(),
          isReturnUser
        })
      });

      const data = await res.json();

      if (data.success) {
        setResult(data);
        showToast('改写完成', 'success');
      } else {
        setError(data.error || '改写失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  }

  return (
    <div className="answer-rewriter">
      <div className="ar-header">
        <h2>✍️ LLM 智能改写答案</h2>
        <p className="ar-desc">
          输入原始答案 → 选择语气 → 查看改写结果 + 质量评估
        </p>
      </div>

      {error && (
        <div className="ar-error">{error}</div>
      )}

      <div className="ar-form">
        {/* 用户问题 */}
        <div className="ar-field">
          <label>用户问题（必填）</label>
          <input
            type="text"
            value={userMessage}
            onChange={e => setUserMessage(e.target.value)}
            placeholder="例如：报销需要什么材料？"
            className="ar-input"
          />
        </div>

        {/* 原始答案 */}
        <div className="ar-field">
          <label>原始答案（必填）</label>
          <textarea
            value={originalAnswer}
            onChange={e => setOriginalAnswer(e.target.value)}
            placeholder="输入FAQ的原始答案..."
            className="ar-textarea"
            rows={6}
          />
        </div>

        {/* 语气选择 */}
        <div className="ar-field">
          <label>改写语气</label>
          <div className="ar-tone-options">
            {TONE_OPTIONS.map(t => (
              <div
                key={t.id}
                className={`ar-tone-option ${tone === t.id ? 'active' : ''}`}
                onClick={() => setTone(t.id)}
              >
                <div className="ar-tone-name">{t.name}</div>
                <div className="ar-tone-desc">{t.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 个性化选项 */}
        <div className="ar-field">
          <label>个性化选项（可选）</label>
          <div className="ar-personalization">
            <div className="ar-personalization-row">
              <label>用户名：</label>
              <input
                type="text"
                value={userName}
                onChange={e => setUserName(e.target.value)}
                placeholder="例如：张三"
                className="ar-input ar-input-sm"
              />
            </div>
            <div className="ar-personalization-row">
              <label>
                <input
                  type="checkbox"
                  checked={isReturnUser}
                  onChange={e => setIsReturnUser(e.target.checked)}
                />
                老用户（简洁回复，不重复解释基础概念）
              </label>
            </div>
          </div>
        </div>

        {/* 改写按钮 */}
        <div className="ar-actions">
          <button
            className="ar-btn ar-btn-primary"
            onClick={handleRewrite}
            disabled={loading}
          >
            {loading ? '改写中...' : '✍️ 开始改写'}
          </button>
          <button
            className="ar-btn ar-btn-secondary"
            onClick={() => {
              setOriginalAnswer('');
              setUserMessage('');
              setResult(null);
              setError('');
            }}
          >
            🗑️ 清空
          </button>
        </div>
      </div>

      {/* 改写结果 */}
      {result && (
        <div className="ar-result">
          <h3>✅ 改写结果（语气：{TONE_OPTIONS.find(t => t.id === result.tone)?.name}）</h3>

          <div className="ar-result-grid">
            {/* 原始答案 */}
            <div className="ar-result-card">
              <div className="ar-result-card-header">
                <span>📄 原始答案</span>
                <button className="ar-copy-btn" onClick={() => handleCopy(result.original)}>
                  📋 复制
                </button>
              </div>
              <div className="ar-result-content">{result.original}</div>
            </div>

            {/* 改写后答案 */}
            <div className="ar-result-card ar-result-card-highlight">
              <div className="ar-result-card-header">
                <span>✍️ 改写后答案</span>
                <button className="ar-copy-btn" onClick={() => handleCopy(result.rewritten)}>
                  📋 复制
                </button>
              </div>
              <div className="ar-result-content">{result.rewritten}</div>
            </div>
          </div>

          {/* 质量评估 */}
          {result.quality && (
            <div className="ar-quality">
              <h4>📊 质量评估</h4>
              <div className="ar-quality-grid">
                <div className="ar-quality-item">
                  <div className="ar-quality-label">流畅度</div>
                  <div className="ar-quality-bar">
                    <div
                      className="ar-quality-fill"
                      style={{ width: `${ (result.quality.fluency || 0) * 100}%` }}
                    ></div>
                  </div>
                  <div className="ar-quality-score">{((result.quality.fluency || 0) * 100).toFixed(0)}%</div>
                </div>

                <div className="ar-quality-item">
                  <div className="ar-quality-label">自然度</div>
                  <div className="ar-quality-bar">
                    <div
                      className="ar-quality-fill ar-quality-fill-green"
                      style={{ width: `${ (result.quality.naturalness || 0) * 100}%` }}
                    ></div>
                  </div>
                  <div className="ar-quality-score">{((result.quality.naturalness || 0) * 100).toFixed(0)}%</div>
                </div>

                <div className="ar-quality-item">
                  <div className="ar-quality-label">信息保留率</div>
                  <div className="ar-quality-bar">
                    <div
                      className="ar-quality-fill ar-quality-fill-orange"
                      style={{ width: `${ (result.quality.infoRetention || 0) * 100}%` }}
                    ></div>
                  </div>
                  <div className="ar-quality-score">{((result.quality.infoRetention || 0) * 100).toFixed(0)}%</div>
                </div>

                <div className="ar-quality-item">
                  <div className="ar-quality-label">口语化程度</div>
                  <div className="ar-quality-bar">
                    <div
                      className="ar-quality-fill ar-quality-fill-purple"
                      style={{ width: `${ (result.quality.colloquialism || 0) * 100}%` }}
                    ></div>
                  </div>
                  <div className="ar-quality-score">{((result.quality.colloquialism || 0) * 100).toFixed(0)}%</div>
                </div>
              </div>

              {/* 综合评分 */}
              <div className="ar-quality-overall">
                综合评分：<strong>{((result.quality.overallScore || 0) * 100).toFixed(0)}%</strong>
              </div>

              {/* 改进建议 */}
              {result.quality.suggestions && result.quality.suggestions.length > 0 && (
                <div className="ar-quality-suggestions">
                  <div className="ar-quality-suggestions-title">💡 改进建议：</div>
                  <ul>
                    {result.quality.suggestions.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
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

export default AnswerRewriter;
