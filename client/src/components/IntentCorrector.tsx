/**
 * 意图纠错表单（共享组件）
 * 用于：聊天界面内联纠错 + 后台「意图纠错」管理页
 * 提交时回调 onSubmit({ correctedIntent:{level1,level2}, note, makeRule })
 */

import React, { useState, useEffect } from 'react';

// 与后端 INTENT_TAXONOMY 保持一致（前端展示用）
const INTENT_TAXONOMY: Record<string, string[]> = {
  query: ['policy', 'operation', 'data', 'contact'],
  process: ['apply', 'approve', 'execute', 'query_status'],
  complaint: ['quality', 'delay', 'service', 'other'],
  suggestion: ['improve', 'new_feature', 'optimization'],
  greeting: ['hello', 'thanks', 'goodbye', 'other'],
};

const INTENT_LABELS: Record<string, string> = {
  query: '信息查询', process: '流程咨询', complaint: '问题投诉',
  suggestion: '建议反馈', greeting: '闲聊问候',
  policy: '政策类', operation: '操作类', data: '数据类', contact: '联系方式',
  apply: '申请', approve: '审批', execute: '执行', query_status: '查询进度',
  quality: '质量', delay: '时效', service: '服务', suggestion_other: '其他',
  improve: '改进', new_feature: '新功能', optimization: '优化',
  hello: '问候', thanks: '感谢', goodbye: '告别',
};

const LEVEL1_LIST = ['query', 'process', 'complaint', 'suggestion', 'greeting'];

interface IntentCorrectorProps {
  // 当前（被纠错的）意图，作为默认值
  currentLevel1?: string | null;
  currentLevel2?: string | null;
  // 提交回调；返回 Promise，resolve 表示成功
  onSubmit: (payload: { correctedIntent: { level1: string; level2: string | null }; note: string; makeRule: boolean }) => Promise<void> | void;
  onCancel?: () => void;
  compact?: boolean; // 紧凑模式（聊天内联）
  submitLabel?: string;
}

export default function IntentCorrector({
  currentLevel1, currentLevel2, onSubmit, onCancel, compact, submitLabel = '提交纠错'
}: IntentCorrectorProps) {
  const [level1, setLevel1] = useState<string>(currentLevel1 || 'query');
  const [level2, setLevel2] = useState<string | null>(currentLevel2 || null);
  const [note, setNote] = useState('');
  const [makeRule, setMakeRule] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 当 currentLevel 变化时同步（例如同一会话里多次打开）
  useEffect(() => {
    setLevel1(currentLevel1 || 'query');
    setLevel2(currentLevel2 || null);
  }, [currentLevel1, currentLevel2]);

  const level2Options = INTENT_TAXONOMY[level1] || [];

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ correctedIntent: { level1, level2 }, note: note.trim(), makeRule });
      setNote('');
      setMakeRule(false);
    } catch (e: any) {
      setError(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`intent-corrector ${compact ? 'compact' : ''}`}>
      <div className="ic-row">
        <label>一级意图</label>
        <select value={level1} onChange={e => { setLevel1(e.target.value); setLevel2(null); }}>
          {LEVEL1_LIST.map(l1 => (
            <option key={l1} value={l1}>{INTENT_LABELS[l1] || l1}</option>
          ))}
        </select>
      </div>
      <div className="ic-row">
        <label>二级意图</label>
        <select value={level2 || ''} onChange={e => setLevel2(e.target.value || null)}>
          <option value="">（无）</option>
          {level2Options.map(l2 => (
            <option key={l2} value={l2}>{INTENT_LABELS[l2] || l2}</option>
          ))}
        </select>
      </div>
      {!compact && (
        <div className="ic-row">
          <label>备注</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="可选，说明纠错原因"
          />
        </div>
      )}
      <div className="ic-row ic-check">
        <label className="ic-check-label">
          <input type="checkbox" checked={makeRule} onChange={e => setMakeRule(e.target.checked)} />
          沉淀为确定性规则（命中即高置信，绕过 LLM）
        </label>
      </div>
      {error && <div className="ic-error">❌ {error}</div>}
      <div className="ic-actions">
        <button className="ic-btn ic-submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '提交中...' : submitLabel}
        </button>
        {onCancel && (
          <button className="ic-btn ic-cancel" onClick={onCancel} disabled={submitting}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}
