import { useState, useRef, useEffect } from 'react';
import type { Message, Candidate } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatWindow.design.css';

interface ChatWindowProps {
  messages: Message[];
  isTyping: boolean;
  onSendMessage: (content: string) => void;
  currentIntent: string | null;
  candidates: Candidate[];
  onSelectCandidate: (candidateId: string) => void;
  categories?: string[];
  selectedCategory?: string;
  onSelectCategory?: (cat: string) => void;
}

export default function ChatWindow({
  messages,
  isTyping,
  onSendMessage,
  currentIntent,
  candidates,
  onSelectCandidate,
  categories = [],
  selectedCategory = '全部',
  onSelectCategory
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, candidates]);

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
              <img src="/logo.jpg" alt="广康集团AI助手" />
            </div>
            <h2 className="welcome-title">您好！我是广康集团AI助手</h2>
            <p className="welcome-subtitle">请问有什么可以帮您？</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row-modern ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="avatar-modern assistant">
                <img src="/logo.jpg" alt="AI" />
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
                <span className="message-time-modern">
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.intent && (
                  <span className="message-intent-modern">意图：{msg.intent}</span>
                )}
                {msg.fallback && <span className="message-fallback-modern">FAQ匹配</span>}
              </div>
            </div>
            {msg.role === 'user' && (
              <div className="avatar-modern user">
                <span>👤</span>
              </div>
            )}
          </div>
        ))}

        {/* 候选问题展示 */}
        {candidates.length > 0 && (
          <div className="message-row-modern assistant">
            <div className="avatar-modern assistant">
              <img src="/logo.jpg" alt="AI" />
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
              <img src="/logo.jpg" alt="AI" />
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
