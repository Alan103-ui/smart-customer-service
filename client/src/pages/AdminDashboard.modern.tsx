/**
 * 广康集团 AI 智能知识助手 - 现代化管理后台组件
 * 设计风格：专业信赖风格
 */

import React, { useState, useEffect } from 'react';
import { apiService, FAQItem, Conversation } from '../services/api';
import KnowledgeBaseManager from './KnowledgeBaseManager';
import './AdminDashboard.modern.css';

const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'faq' | 'conversations' | 'knowledge-bases'>('dashboard');
  const [stats, setStats] = useState<any>(null);
  const [faqList, setFaqList] = useState<FAQItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [editingFAQ, setEditingFAQ] = useState<FAQItem | null>(null);
  const [showFAQEditor, setShowFAQEditor] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      if (activeTab === 'dashboard') {
        const statsData = await apiService.getStats();
        setStats(statsData);
        const convData = await apiService.getConversations();
        setConversations(convData);
      } else if (activeTab === 'faq') {
        const faqData = await apiService.getFAQ();
        setFaqList(faqData);
      } else if (activeTab === 'conversations') {
        const convData = await apiService.getConversations();
        setConversations(convData);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  };

  const handleSaveFAQ = async (faq: FAQItem) => {
    try {
      if (faq.id) {
        await apiService.updateFAQ(faq.id, faq);
      } else {
        await apiService.createFAQ(faq);
      }
      setShowFAQEditor(false);
      setEditingFAQ(null);
      loadData();
    } catch (error) {
      console.error('保存 FAQ 失败:', error);
    }
  };

  const handleDeleteFAQ = async (id: number) => {
    if (!window.confirm('确定要删除这个 FAQ 吗？')) return;
    
    try {
      await apiService.deleteFAQ(id);
      loadData();
    } catch (error) {
      console.error('删除 FAQ 失败:', error);
    }
  };

  return (
    <div className="admin-container">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header__left">
          <a href="/" className="admin-header__back">
            <span>←</span>
            <span>返回聊天</span>
          </a>
          <h1 className="admin-header__title">管理后台</h1>
        </div>
        <div className="admin-header__right">
          <button className="btn btn--primary">
            <span>📊</span>
            导出报表
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav className="admin-nav-container" style={{
        padding: 'var(--space-4) var(--space-8)',
        background: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)'
      }}>
        <div className="admin-nav">
          <button
            className={`admin-nav__item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 数据概览
          </button>
          <button
            className={`admin-nav__item ${activeTab === 'knowledge-bases' ? 'active' : ''}`}
            onClick={() => setActiveTab('knowledge-bases')}
          >
            📚 知识库管理
          </button>
          <button
            className={`admin-nav__item ${activeTab === 'conversations' ? 'active' : ''}`}
            onClick={() => setActiveTab('conversations')}
          >
            💬 对话记录
          </button>
        </div>
      </nav>

      {/* Content */}
      <main className="admin-content">
        {activeTab === 'dashboard' && (
          <>
            <div className="admin-content__header">
              <h2 className="admin-content__title">数据概览</h2>
              <p className="admin-content__subtitle">
                查看系统使用情况和关键指标
              </p>
            </div>

            {/* Stats Grid */}
            {stats && (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-card__header">
                    <div className="stat-card__icon">💬</div>
                    <div className="stat-card__trend stat-card__trend--up">
                      <span>↑</span>
                      <span>+12%</span>
                    </div>
                  </div>
                  <div className="stat-card__value">{stats.total_conversations || 0}</div>
                  <div className="stat-card__label">总会话数</div>
                </div>

                <div className="stat-card">
                  <div className="stat-card__header">
                    <div className="stat-card__icon">📝</div>
                    <div className="stat-card__trend stat-card__trend--up">
                      <span>↑</span>
                      <span>+8%</span>
                    </div>
                  </div>
                  <div className="stat-card__value">{stats.total_messages || 0}</div>
                  <div className="stat-card__label">总消息数</div>
                </div>

                <div className="stat-card">
                  <div className="stat-card__header">
                    <div className="stat-card__icon">📚</div>
                    <div className="stat-card__trend stat-card__trend--up">
                      <span>↑</span>
                      <span>+5</span>
                    </div>
                  </div>
                  <div className="stat-card__value">{stats.faq_count || 0}</div>
                  <div className="stat-card__label">FAQ 数量</div>
                </div>

                <div className="stat-card">
                  <div className="stat-card__header">
                    <div className="stat-card__icon">⚡</div>
                    <div className="stat-card__trend stat-card__trend--up">
                      <span>↑</span>
                      <span>+15%</span>
                    </div>
                  </div>
                  <div className="stat-card__value">
                    {stats.avg_response_time ? `${stats.avg_response_time}s` : '0s'}
                  </div>
                  <div className="stat-card__label">平均响应时间</div>
                </div>
              </div>
            )}

            {/* Charts Placeholder */}
            <div className="charts-grid">
              <div className="chart-card">
                <div className="chart-card__header">
                  <h3 className="chart-card__title">消息趋势</h3>
                </div>
                <div className="chart-card__body">
                  <p>📈 图表组件加载中...</p>
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-card__header">
                  <h3 className="chart-card__title">热门问题</h3>
                </div>
                <div className="chart-card__body">
                  <p>📊 图表组件加载中...</p>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'faq' && (
          <>
            <div className="admin-content__header">
              <h2 className="admin-content__title">FAQ 管理</h2>
              <p className="admin-content__subtitle">
                管理和维护 FAQ 知识库
              </p>
            </div>

            <div className="faq-manager">
              {/* FAQ List */}
              <div className="faq-list">
                <div className="faq-list__header">
                  <h3>FAQ 列表</h3>
                  <button
                    className="btn btn--primary"
                    onClick={() => {
                      setEditingFAQ({ question: '', answer: '' });
                      setShowFAQEditor(true);
                    }}
                  >
                    <span>＋</span>
                    新增
                  </button>
                </div>
                <div className="faq-list__items">
                  {faqList.map((faq) => (
                    <div
                      key={faq.id}
                      className={`faq-item ${editingFAQ?.id === faq.id ? 'active' : ''}`}
                      onClick={() => {
                        setEditingFAQ(faq);
                        setShowFAQEditor(true);
                      }}
                    >
                      <div className="faq-item__question">{faq.question}</div>
                      <div className="faq-item__meta">
                        <span>ID: {faq.id}</span>
                        <span>•</span>
                        <span>更新于 {new Date().toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* FAQ Editor */}
              {showFAQEditor && (
                <FAQEditor
                  faq={editingFAQ}
                  onSave={handleSaveFAQ}
                  onCancel={() => {
                    setShowFAQEditor(false);
                    setEditingFAQ(null);
                  }}
                  onDelete={editingFAQ?.id ? () => handleDeleteFAQ(editingFAQ.id!) : undefined}
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'conversations' && (
          <>
            <div className="admin-content__header">
              <h2 className="admin-content__title">对话记录</h2>
              <p className="admin-content__subtitle">
                查看所有用户对话记录
              </p>
            </div>

            <div className="data-table-wrapper">
              <div className="data-table-header">
                <h3 className="data-table-title">最近对话</h3>
                <div className="data-table-actions">
                  <div className="search-box">
                    <span className="search-box__icon">🔍</span>
                    <input
                      type="text"
                      className="search-box__input"
                      placeholder="搜索对话..."
                    />
                  </div>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>会话 ID</th>
                    <th>消息数</th>
                    <th>创建时间</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conv) => (
                    <tr key={conv.session_id}>
                      <td style={{ fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-sm)' }}>
                        {conv.session_id.substring(0, 16)}...
                      </td>
                      <td>
                        <span className="badge badge--primary">
                          {conv.message_count}
                        </span>
                      </td>
                      <td>{new Date(conv.created_at).toLocaleString('zh-CN')}</td>
                      <td>{new Date(conv.updated_at).toLocaleString('zh-CN')}</td>
                      <td>
                        <div className="data-table__actions">
                          <button className="btn btn--secondary" style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                            查看
                          </button>
                          <button className="btn btn--secondary" style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                            导出
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

// FAQ Editor Component
interface FAQEditorProps {
  faq: FAQItem | null;
  onSave: (faq: FAQItem) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const FAQEditor: React.FC<FAQEditorProps> = ({ faq, onSave, onCancel, onDelete }) => {
  const [question, setQuestion] = useState(faq?.question || '');
  const [answer, setAnswer] = useState(faq?.answer || '');

  const handleSave = () => {
    if (!question.trim() || !answer.trim()) {
      alert('请填写完整的问题和答案');
      return;
    }

    onSave({
      ...faq,
      question,
      answer
    });
  };

  return (
    <div className="faq-editor">
      <div className="faq-editor__header">
        <h3 className="faq-editor__title">
          {faq?.id ? '编辑 FAQ' : '新增 FAQ'}
        </h3>
      </div>
      <div className="faq-editor__body">
        <div className="faq-form__group">
          <label className="faq-form__label">问题</label>
          <input
            type="text"
            className="faq-form__input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="请输入问题"
          />
        </div>
        <div className="faq-form__group">
          <label className="faq-form__label">答案</label>
          <textarea
            className="faq-form__input faq-form__textarea"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="请输入答案"
          />
        </div>
      </div>
      <div className="faq-editor__footer">
        <button className="btn btn--secondary" onClick={onCancel}>
          取消
        </button>
        {onDelete && (
          <button className="btn" style={{
            background: 'var(--color-error)',
            color: 'var(--color-white)'
          }} onClick={onDelete}>
            删除
          </button>
        )}
        <button className="btn btn--primary" onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  );
};

export default AdminDashboard;
