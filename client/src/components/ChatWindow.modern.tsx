/**
 * 广康集团 AI 智能知识助手 - 现代化聊天界面组件（兼容原版 API）
 * 设计风格：专业信赖风格
 */

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, Candidate } from '../types';
import { useSoftwareInfo } from '../services/softwareInfo';
import './ChatWindow.modern.css';

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

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isTyping,
  onSendMessage,
  currentIntent,
  candidates,
  onSelectCandidate,
  categories = [],
  selectedCategory = '全部',
  onSelectCategory
}) => {
  const sw = useSoftwareInfo();
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
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header__brand">
          <div className="chat-header__logo">AI</div>
          <div>
            <h1 className="chat-header__title">{sw.softwareName}</h1>
            <p className="chat-header__subtitle">企业级 RAG 知识管理系统</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="chat-main">
        {/* Chat Area */}
        <main className="chat-area">
          {messages.length === 0 && candidates.length === 0 ? (
            /* Welcome Screen */
            <div className="welcome-screen">
              <div className="welcome-icon">
                <span style={{ fontSize: '36px' }}>🤖</span>
              </div>
              <h2 className="welcome-title">{sw.welcomeMessage || ('欢迎使用' + sw.softwareName)}</h2>
              <p className="welcome-subtitle">
                我是您的 AI 知识助手，可以帮您快速查询企业知识库中的信息
              </p>
              <div className="welcome-features">
                <div className="welcome-feature">
                  <div className="welcome-feature__icon">📚</div>
                  <h3 className="welcome-feature__title">知识查询</h3>
                  <p className="welcome-feature__desc">
                    快速检索企业知识库，获取准确的答案和参考资料
                  </p>
                </div>
                <div className="welcome-feature">
                  <div className="welcome-feature__icon">💡</div>
                  <h3 className="welcome-feature__title">智能问答</h3>
                  <p className="welcome-feature__desc">
                    基于 RAG 技术，理解您的问题并提供精准回答
                  </p>
                </div>
                <div className="welcome-feature">
                  <div className="welcome-feature__icon">📊</div>
                  <h3 className="welcome-feature__title">数据分析</h3>
                  <p className="welcome-feature__desc">
                    支持数据分析和报表生成，助力业务决策
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Messages */
            <div className="chat-messages">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`message message--${msg.role === 'user' ? 'user' : 'bot'}`}
                >
                  <div className="message__avatar">
                    {msg.role === 'user' ? '我' : 'AI'}
                  </div>
                  <div className="message__content">
                    <div className="message__bubble">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    
                    <div className="message__meta">
                      <span>{new Date(msg.timestamp).toLocaleTimeString('zh-CN', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Typing Indicator */}
              {isTyping && (
                <div className="message message--bot">
                  <div className="message__avatar">AI</div>
                  <div className="typing-indicator">
                    <div className="typing-indicator__dot"></div>
                    <div className="typing-indicator__dot"></div>
                    <div className="typing-indicator__dot"></div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input Area */}
          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <input
                ref={inputRef}
                className="chat-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入您的问题...（按 Enter 发送）"
              />
              <div className="chat-input-actions">
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  title="发送消息"
                >
                  <span>➤</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ChatWindow;
