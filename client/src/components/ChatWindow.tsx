import { useState, useRef, useEffect } from 'react';
import type { Message, Candidate } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSoftwareInfo, useAnnouncement, ANNOUNCEMENT_COLORS } from '../services/softwareInfo';
import IntentCorrector from './IntentCorrector';
import './ChatWindow.design.css';

const INTENT_LABELS: Record<string, string> = {
  query: '信息查询', process: '流程咨询', complaint: '问题投诉',
  suggestion: '建议反馈', greeting: '闲聊问候',
};

interface CorrectIntentPayload {
  messageId?: string;
  query?: string;
  originalIntent: { level1: string; level2: string | null; confidence?: number | null };
  correctedIntent: { level1: string; level2: string | null };
  note: string;
  makeRule: boolean;
}

interface ChatWindowProps {
  messages: Message[];
  isTyping: boolean;
  streaming?: string | null;
  onSendMessage: (content: string) => void;
  currentIntent: string | null;
  candidates: Candidate[];
  onSelectCandidate: (candidateId: string) => void;
  categories?: string[];
  selectedCategory?: string;
  onSelectCategory?: (cat: string) => void;
  currentUser?: { name: string; username: string };
  onCorrectIntent?: (payload: CorrectIntentPayload) => Promise<void> | void;
}

export default function ChatWindow({
  messages,
  isTyping,
  streaming,
  onSendMessage,
  currentIntent,
  candidates,
  onSelectCandidate,
  categories = [],
  selectedCategory = '全部',
  onSelectCategory,
  currentUser,
  onCorrectIntent
}: ChatWindowProps) {
  const sw = useSoftwareInfo();
  const chatAvatar = sw.chatImage || '/logo.jpg';
  const ann = useAnnouncement();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctedIds, setCorrectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, candidates, streaming]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-window-modern">
      {/* 系统公告 Banner */}
      {ann.enabled && (ann.title || ann.content) && (
        <div style={{ background: ANNOUNCEMENT_COLORS[ann.level]?.bg || '#e6f7ff', borderBottom: '1px solid ' + (ANNOUNCEMENT_COLORS[ann.level]?.border || '#91d5ff'), color: ANNOUNCEMENT_COLORS[ann.level]?.color || '#0958d9', padding: '8px 16px', fontSize: 13 }}>
          {ann.title && <span style={{ fontWeight: 600, marginRight: 8 }}>{ann.title}</span>}
          {ann.content && <span style={{ whiteSpace: 'pre-wrap' }}>{ann.content}</span>}
        </div>
      )}
      {/* 分类选择栏 */}
      {categories.length > 0 && (
        <div className="category-bar-modern">
          <div className="category-label">
            <span className="icon">📂</span>
            <span>知识分类</span>
          </div>
          <select
            className="category-select-modern"
            value={selectedCategory}
            onChange={e => onSelectCategory?.(e.target.value)}
          >
            <option value="全部">全部</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {/* 意图识别提示 */}
      {currentIntent && (
        <div className="intent-bar-modern">
          <span className="intent-icon">🎯</span>
          <span className="intent-text">识别意图：<strong>{currentIntent}</strong></span>
        </div>
      )}

      {/* 消息区域 */}
      <div className="messages-area-modern">
        {messages.length === 0 && candidates.length === 0 && (
          <div className="welcome-area-modern">
            <div className="welcome-avatar">
              <img src={chatAvatar} alt={sw.softwareName} />
            </div>
            <h2 className="welcome-title">{sw.welcomeMessage || ('您好！我是' + sw.softwareName)}</h2>
            <p className="welcome-subtitle">请问有什么可以帮您？</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row-modern ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="avatar-modern assistant">
                <img src={chatAvatar} alt="AI" />
              </div>
            )}
            <div className={`message-bubble-modern ${msg.role}`}>
              <div className="message-content-modern">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
              <div className="message-meta-modern">
                {msg.role === 'user' && currentUser && (
                  <span className="message-sender-modern">{currentUser.name || currentUser.username}</span>
                )}
                <span className="message-time-modern">
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.intent && (
                  <span className="message-intent-modern">
                    意图：{INTENT_LABELS[msg.intent] || msg.intent}
                    {msg.intentLevel2 ? ` / ${msg.intentLevel2}` : ''}
                    {typeof msg.confidence === 'number' && (
                      <em className="intent-conf">{(msg.confidence * 100).toFixed(0)}%</em>
                    )}
                  </span>
                )}
                {msg.fallback && <span className="message-fallback-modern">FAQ匹配</span>}
                {correctedIds.has(msg.id || '') && (
                  <span className="message-corrected-modern">✓ 已纠错</span>
                )}
                {msg.intent && onCorrectIntent && !correctedIds.has(msg.id || '') && (
                  <button
                    className="message-correct-btn"
                    onClick={() => setCorrectingId(prev => prev === (msg.id || '') ? null : (msg.id || ''))}
                    title="识别意图不对？点击纠错"
                  >意图纠错</button>
                )}
              </div>
              {correctingId === (msg.id || '') && msg.intent && (
                <div className="message-correct-panel">
                  <IntentCorrector
                    compact
                    currentLevel1={msg.intent}
                    currentLevel2={msg.intentLevel2 || null}
                    submitLabel="提交"
                    onCancel={() => setCorrectingId(null)}
                    onSubmit={async (p) => {
                      await onCorrectIntent!({
                        messageId: msg.id,
                        query: msg.query,
                        originalIntent: {
                          level1: msg.intent!,
                          level2: msg.intentLevel2 || null,
                          confidence: msg.confidence ?? null
                        },
                        correctedIntent: p.correctedIntent,
                        note: p.note,
                        makeRule: p.makeRule
                      });
                      setCorrectedIds(prev => new Set(prev).add(msg.id || ''));
                      setCorrectingId(null);
                    }}
                  />
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="avatar-modern user">
                <span>{currentUser?.name?.charAt(0) || currentUser?.username?.charAt(0) || '👤'}</span>
              </div>
            )}
          </div>
        ))}

        {/* 流式生成中的助手消息（逐字增长） */}
        {streaming != null && streaming.length > 0 && (
          <div className="message-row-modern assistant">
            <div className="avatar-modern assistant">
              <img src={chatAvatar} alt="AI" />
            </div>
            <div className="message-bubble-modern assistant">
              <div className="message-content-modern">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                <span className="stream-cursor-modern" />
              </div>
            </div>
          </div>
        )}

        {/* 候选问题展示 */}
        {candidates.length > 0 && (
          <div className="message-row-modern assistant">
            <div className="avatar-modern assistant">
              <img src={chatAvatar} alt="AI" />
            </div>
            <div className="message-bubble-modern assistant candidate-bubble-modern">
              <div className="candidate-prompt-modern">
                <span className="prompt-icon">💡</span>
                请您选择最相关的问题，我会为您解答：
              </div>
              <div className="candidate-list-modern">
                {candidates.map((c, i) => (
                  <button
                    key={c.id}
                    className="candidate-btn-modern"
                    onClick={() => onSelectCandidate(c.id)}
                    title={c.answer}
                  >
                    <span className="candidate-index-modern">{i + 1}</span>
                    <span className="candidate-question-modern">{c.question}</span>
                    <span className="candidate-confidence-modern">
                      <span className="confidence-bar" style={{ width: `${c.confidence * 100}%` }}></span>
                      {Math.round(c.confidence * 100)}%
                    </span>
                  </button>
                ))}
              </div>
              <div className="candidate-hint-modern">
                <span>💬</span> 以上都不是？请直接在输入框描述您的问题
              </div>
            </div>
          </div>
        )}

        {isTyping && (
          <div className="message-row-modern assistant">
            <div className="avatar-modern assistant">
              <img src={chatAvatar} alt="AI" />
            </div>
            <div className="message-bubble-modern assistant typing-bubble-modern">
              <div className="typing-indicator-modern">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="typing-text">AI正在思考...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="input-area-modern">
        <div className="input-wrapper-modern">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={candidates.length > 0 ? "以上都不是？请描述您的问题..." : "请输入您的问题..."}
            className="input-field-modern"
          />
          <button 
            onClick={handleSend} 
            disabled={!input.trim()}
            className="send-btn-modern"
          >
            <span className="send-icon">📤</span>
            <span>发送</span>
          </button>
        </div>
        <div className="input-hint-modern">
          <span>按 Enter 发送，Shift + Enter 换行</span>
        </div>
      </div>
    </div>
  );
}
