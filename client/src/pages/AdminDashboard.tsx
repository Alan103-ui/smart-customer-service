import { useState, useEffect, useRef, useMemo } from 'react';
import type { Message } from '../types';
import BasicInfoManagement from './BasicInfoManagement';
import RAGManagement from './RAGManagement';
import IntentUnderstanding from './IntentUnderstanding';
import AnswerRewriter from './AnswerRewriter';

// ==================== 类型定义 ====================
interface Conversation {
  id: string;
  session_id: string;
  messages: Message[];
  intent: string | null;
  resolved: number;
  satisfaction: number | null;
  created_at: string;
  updated_at: string;
}

interface AdminDashboardProps {
  onBack?: () => void;
}

interface Stats {
  totalConversations: number;
  resolvedCount: number;
  avgSatisfaction: number;
  recentConversations: Conversation[];
}

interface FAQItem {
  id: string;
  question: string;
  keywords: string[];
  answer: string;
  intent: string;
  category: string;
  knowledgeBaseId?: string;
}

interface CategoryItem {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  knowledgeBaseId: string;
  sortOrder: number;
  isDefault: boolean;
}

// ==================== 主组件 ====================
export default function AdminDashboard({ onBack }: AdminDashboardProps) {
  const [tab, setTab] = useState<'stats' | 'faq' | 'categories' | 'basicInfo' | 'rag' | 'intent' | 'rewrite'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  // 知识库状态（供分类和FAQ选择使用）
  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);

  // 分类管理状态
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catSubTab, setCatSubTab] = useState<'level1' | 'level2'>('level1');
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryItem | null>(null);
  const [catForm, setCatForm] = useState({ name: '', description: '', parentId: '', knowledgeBaseId: '' });

  // FAQ 管理状态
  const [faqList, setFaqList] = useState<FAQItem[]>([]);
  const [faqLoading, setFaqLoading] = useState(false);
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQItem | null>(null);
  const [faqForm, setFaqForm] = useState({ question: '', keywords: '', answer: '', intent: '', category: '', knowledgeBaseId: '' });
  const [faqFormLevel1Cat, setFaqFormLevel1Cat] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>('');
  const [uploadLevel1Cat, setUploadLevel1Cat] = useState<string>('');
  const [faqFilterCategory, setFaqFilterCategory] = useState<string>('');
  const [faqSearchKeyword, setFaqSearchKeyword] = useState<string>('');
  const [selectedFaqIds, setSelectedFaqIds] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({});
  const resizingRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==================== 数据获取 ====================
  const API_BASE = '/api/admin';

  // 知识库数据获取
  const fetchKnowledgeBases = async () => {
    try {
      const res = await fetch(`${API_BASE}/knowledge-bases`);
      const data = await res.json();
      setKnowledgeBases(data.filter((kb: any) => kb.isActive));
    } catch (err) { console.error('获取知识库失败', err); }
  };

  // 分类数据获取
  const fetchCategories = async () => {
    setCatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/categories`);
      setCategories(await res.json());
    } catch (err) { console.error('获取分类失败', err); }
    setCatLoading(false);
  };

  // FAQ 数据获取
  const fetchFAQ = async () => {
    setFaqLoading(true);
    try {
      const res = await fetch(`${API_BASE}/faq`);
      const json = await res.json();
      // API 返回 {success, data} 格式，需要解包取 data 数组
      setFaqList(Array.isArray(json) ? json : (json.data || []));
    } catch (err) { console.error('获取 FAQ 失败', err); }
    setFaqLoading(false);
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      setStats(await res.json());
    } catch (err) { console.error('获取统计数据失败', err); }
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/conversations`);
      setConversations(await res.json());
      setLoading(false);
    } catch (err) { console.error('获取对话列表失败', err); setLoading(false); }
  };

  useEffect(() => {
    fetchStats();
    fetchConversations();
    fetchCategories();
    fetchKnowledgeBases();
    const timer = setInterval(() => { fetchStats(); fetchConversations(); }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab === 'faq') { fetchFAQ(); fetchCategories(); fetchKnowledgeBases(); }
    if (tab === 'categories') { fetchCategories(); fetchKnowledgeBases(); }
  }, [tab]);

  // FAQ 列表筛选
  const filteredFaqList = useMemo(() => {
    let list = faqList;
    if (faqFilterCategory) list = list.filter(f => f.category === faqFilterCategory);
    if (faqSearchKeyword.trim()) {
      const kw = faqSearchKeyword.trim().toLowerCase();
      list = list.filter(f =>
        f.question.toLowerCase().includes(kw) ||
        f.answer.toLowerCase().includes(kw) ||
        f.keywords.some(k => k.toLowerCase().includes(kw))
      );
    }
    return list;
  }, [faqList, faqFilterCategory, faqSearchKeyword]);

  // ==================== 分类操作 ====================
  const openAddCat = () => {
    setEditingCat(null);
    const defaultKbId = knowledgeBases.find(kb => kb.isActive)?.id || '';
    setCatForm({
      name: '',
      description: '',
      parentId: catSubTab === 'level2' ? '' : '',
      knowledgeBaseId: defaultKbId
    });
    setShowCatModal(true);
  };
  const openEditCat = (cat: CategoryItem) => { setEditingCat(cat); setCatForm({ name: cat.name, description: cat.description || '', parentId: cat.parentId || '', knowledgeBaseId: cat.knowledgeBaseId || '' }); setShowCatModal(true); };
  const closeCatModal = () => { setShowCatModal(false); setEditingCat(null); };

  const saveCategory = async () => {
    if (!catForm.name.trim()) { alert('分类名称必填'); return; }
    if (!catForm.knowledgeBaseId) { alert('请选择所属知识库'); return; }
    if (catSubTab === 'level2' && !catForm.parentId) { alert('请选择上级分类'); return; }
    try {
      const url = editingCat ? `${API_BASE}/categories/${editingCat.id}` : `${API_BASE}/categories`;
      const method = editingCat ? 'PUT' : 'POST';
      const payload: any = { name: catForm.name.trim(), knowledgeBaseId: catForm.knowledgeBaseId };
      if (!editingCat) payload.description = catForm.description;
      else if (catForm.description !== undefined) payload.description = catForm.description;
      if (catForm.parentId) payload.parentId = catForm.parentId;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || '保存失败'); }
      closeCatModal();
      fetchCategories();
      fetchFAQ();
    } catch (err: any) { alert('保存失败：' + err.message); }
  };

  const deleteCategory = async (cat: CategoryItem) => {
    if (cat.isDefault) { alert('默认分类不可删除'); return; }
    if (!confirm(`确定删除分类「${cat.name}」？该分类下的 FAQ 将归入「常见问题」`)) return;
    try {
      await fetch(`${API_BASE}/categories/${cat.id}`, { method: 'DELETE' });
      fetchCategories();
      fetchFAQ();
    } catch (err) { alert('删除失败'); }
  };

  // ==================== FAQ 操作 ====================
  const openAddFaq = () => { setEditingFaq(null); setFaqForm({ question: '', keywords: '', answer: '', intent: '', category: '', knowledgeBaseId: '' }); setFaqFormLevel1Cat(''); setShowFaqModal(true); };
  const openEditFaq = (faq: FAQItem) => {
    setEditingFaq(faq);
    // 查找分类，判断是一级还是二级
    const cat = categories.find(c => c.name === faq.category);
    let level1Id = '';
    if (cat) {
      if (cat.parentId) {
        // 二级分类，找到其一级分类
        level1Id = cat.parentId;
      } else {
        // 一级分类
        level1Id = cat.id;
      }
    }
    setFaqFormLevel1Cat(level1Id);
    setFaqForm({
      question: faq.question,
      keywords: faq.keywords.join(', '),
      answer: faq.answer,
      intent: faq.intent || '',
      category: faq.category || '',
      knowledgeBaseId: faq.knowledgeBaseId || '',
    });
    setShowFaqModal(true);
  };
  const closeFaqModal = () => { setShowFaqModal(false); setEditingFaq(null); };

  const saveFaq = async () => {
    if (!faqForm.question.trim() || !faqForm.answer.trim()) { alert('问题和答案为必填项'); return; }
    const keywords = faqForm.keywords.split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean);
    const payload: any = {
      question: faqForm.question.trim(),
      keywords,
      answer: faqForm.answer.trim(),
      intent: faqForm.intent.trim() || 'custom',
      category: faqForm.category.trim() || '其他',
    };
    if (faqForm.knowledgeBaseId) payload.knowledgeBaseId = faqForm.knowledgeBaseId;
    try {
      const url = editingFaq ? `${API_BASE}/faq/${editingFaq.id}` : `${API_BASE}/faq`;
      const method = editingFaq ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      closeFaqModal();
      fetchFAQ();
    } catch (err: any) { alert('保存失败：' + err.message); }
  };

  const deleteFaq = async (id: string) => {
    if (!confirm('确定删除该 FAQ 条目？')) return;
    try {
      await fetch(`${API_BASE}/faq/${id}`, { method: 'DELETE' });
      fetchFAQ();
    } catch (err) { alert('删除失败'); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    let url = `${API_BASE}/faq/upload`;
    if (uploadCategory) url += `?category=${encodeURIComponent(uploadCategory)}`;
    try {
      const res = await fetch(url, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) { alert(`文件解析完成！新增 ${data.added} 条 FAQ，当前共 ${data.total} 条。`); fetchFAQ(); }
      else alert('上传失败：' + (data.error || '未知错误'));
    } catch (err) { alert('上传失败，请检查文件格式（支持 .txt/.md/.pdf/.doc/.docx/.xls/.xlsx）'); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectedConv = conversations.find(c => c.session_id === selectedSession);

  // ==================== 搜索关键词高亮 ====================
  const highlightKeyword = (text: string, keyword: string): React.ReactNode => {
    if (!keyword.trim()) return text;
    const lower = text.toLowerCase();
    const kw = keyword.toLowerCase();
    const idx = lower.indexOf(kw);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span style={{ background: '#fff3b0', color: '#333', borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + kw.length)}</span>
        {text.slice(idx + kw.length)}
      </>
    );
  };

  // ==================== FAQ 分类名称解析 ====================
  const getFaqCategoryNames = (categoryName: string) => {
    if (!categoryName) return { level1: '-', level2: '-' };
    const cat = categories.find(c => c.name === categoryName);
    if (!cat) return { level1: categoryName, level2: '-' };
    if (cat.parentId) {
      const parent = categories.find(p => p.id === cat.parentId);
      return { level1: parent?.name || '-', level2: cat.name };
    }
    return { level1: cat.name, level2: '-' };
  };

  const renderCategoryTds = (categoryName: string) => {
    const { level1, level2 } = getFaqCategoryNames(categoryName);
    return <>
      <td><span className="cat-tag">{level1}</span></td>
      <td><span className="cat-tag">{level2}</span></td>
    </>;
  };

  // ==================== 列宽拖动 ====================
  const handleResizerMouseDown = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;
    resizingRef.current = { colKey, startX, startWidth };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = e.clientX - resizingRef.current.startX;
      const newWidth = Math.max(50, resizingRef.current.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [resizingRef.current!.colKey]: newWidth }));
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // ==================== 渲染 ====================
  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack} style={{ marginRight: 16 }}>
            ← 返回前端
          </button>
          <h1>🤖 广康集团AI助手 - 管理后台</h1>
        </div>
        <div className="admin-tabs">
          <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>📈 数据统计</button>
          <button className={`tab-btn ${tab === 'faq' ? 'active' : ''}`} onClick={() => setTab('faq')}>📚 知识库内容</button>
          <button className={`tab-btn ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>🏷️ 分类管理</button>
          <button className={`tab-btn ${tab === 'basicInfo' ? 'active' : ''}`} onClick={() => setTab('basicInfo')}>🏢 基础信息</button>
          <button className={`tab-btn ${tab === 'rag' ? 'active' : ''}`} onClick={() => setTab('rag')}>🤖 RAG 管理</button>
          <button className={`tab-btn ${tab === 'intent' ? 'active' : ''}`} onClick={() => setTab('intent')}>🧠 意图理解</button>
          <button className={`tab-btn ${tab === 'rewrite' ? 'active' : ''}`} onClick={() => setTab('rewrite')}>✍️ 答案改写</button>
        </div>
      </div>

      {tab === 'stats' && (
        <div className="admin-content">
          {/* 统计卡片 */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-number">{stats?.totalConversations ?? '--'}</div>
              <div className="stat-label">总会话数</div>
            </div>
            <div className="stat-card green">
              <div className="stat-number">{stats ? Math.round(stats.resolvedCount / stats.totalConversations * 100) || 0 : '--'}<small>%</small></div>
              <div className="stat-label">解决率</div>
            </div>
            <div className="stat-card purple">
              <div className="stat-number">{stats ? (stats.avgSatisfaction || 0).toFixed(1) : '--'}<small>/5</small></div>
              <div className="stat-label">平均满意度</div>
            </div>
          </div>

          <div className="admin-content" style={{ marginTop: 20 }}>
            {/* 对话列表 */}
            <div className="conversation-list">
              <div className="conv-list-header">
                <h3>对话记录 ({conversations.length})</h3>
                {selectedSessionIds.size > 0 && (
                  <button className="btn-danger" style={{ marginLeft: 8 }}
                    onClick={async () => {
                      if (!confirm(`确定删除选中的 ${selectedSessionIds.size} 条对话记录？`)) return;
                      try {
                        const res = await fetch(`${API_BASE}/conversations/batch-delete`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ids: [...selectedSessionIds] })
                        });
                        const data = await res.json();
                        if (data.success) {
                          alert(`成功删除 ${data.deleted} 条对话记录`);
                          setSelectedSessionIds(new Set());
                          setSelectedSession(null);
                          fetchConversations();
                        } else alert('删除失败：' + (data.error || '未知错误'));
                      } catch (err: any) { alert('删除失败：' + err.message); }
                    }}
                  >🗑️ 删除选中（{selectedSessionIds.size}）</button>
                )}
              </div>
              <div className="conv-list-scroll">
                {conversations.map(conv => (
                  <div key={conv.session_id}
                    className={`conv-item ${selectedSession === conv.session_id ? 'active' : ''} ${selectedSessionIds.has(conv.session_id) ? 'conv-selected' : ''}`}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px' }}
                  >
                    <input
                        type="checkbox"
                        checked={selectedSessionIds.has(conv.session_id)}
                        onChange={e => {
                          const next = new Set(selectedSessionIds);
                          if (e.target.checked) next.add(conv.session_id);
                          else next.delete(conv.session_id);
                          setSelectedSessionIds(next);
                        }}
                        style={{ marginTop: 2, flexShrink: 0 }}
                        onClick={e => e.stopPropagation()}
                      />
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => {
                      setSelectedSession(conv.session_id);
                      setSelectedSessionIds(new Set());
                    }}>
                      <div className="conv-header">
                        <span className="conv-id">{conv.session_id.slice(0, 12)}...</span>
                        <span className="conv-time">{new Date(conv.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="conv-meta">
                        {conv.intent && <span className="meta-tag">{conv.intent}</span>}
                        {conv.satisfaction && <span className="meta-tag sat">★{conv.satisfaction}</span>}
                      </div>
                      <div className="conv-preview">{conv.messages[conv.messages.length - 1]?.content?.slice(0, 40) || '（无消息）'}...</div>
                    </div>
                    <button
                        className="btn-sm btn-danger"
                        style={{ flexShrink: 0, marginTop: 2 }}
                        onClick={async e => {
                          e.stopPropagation();
                          if (!confirm('确定删除该对话记录？')) return;
                          try {
                            const res = await fetch(`${API_BASE}/conversations/${conv.session_id}`, { method: 'DELETE' });
                            if ((await res.json()).success) {
                              fetchConversations();
                              if (selectedSession === conv.session_id) setSelectedSession(null);
                            }
                          } catch (err) { alert('删除失败'); }
                        }}
                    >删除</button>
                  </div>
                ))}
                {conversations.length === 0 && !loading && <div className="empty-state">暂无对话记录</div>}
              </div>
            </div>

            {/* 对话详情 */}
            <div className="conversation-detail">
              {selectedConv ? (
                <>
                  <div className="detail-header">
                    <h3>会话详情</h3>
                    <div className="detail-meta">
                      <span>意图：{selectedConv.intent || '未知'}</span>
                      <span>状态：{selectedConv.resolved ? '✅ 已解决' : '⏳ 进行中'}</span>
                      {selectedConv.satisfaction && <span>满意度：{'★'.repeat(selectedConv.satisfaction)}</span>}
                    </div>
                  </div>
                  <div className="detail-messages">
                    {selectedConv.messages.map((msg: Message, i: number) => (
                      <div key={i} className={`detail-msg ${msg.role}`}>
                        <div className="detail-role">{msg.role === 'user' ? '👤 用户' : '🤖 助手'}</div>
                        <div className="detail-content">{msg.content}</div>
                        <div className="detail-time">
                          {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
                          {msg.intent && <span className="msg-intent-badge">{msg.intent}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-detail">← 请选择左侧对话查看详情</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'categories' && (
        <div className="faq-management">
          <div className="faq-toolbar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {/* 子Tab 切换 */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
              <button
                style={{
                  padding: '5px 16px',
                  borderRadius: '6px 0 0 6px',
                  border: '1px solid #d9d9d9',
                  background: catSubTab === 'level1' ? '#1677ff' : '#fff',
                  color: catSubTab === 'level1' ? '#fff' : '#333',
                  fontWeight: catSubTab === 'level1' ? 600 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setCatSubTab('level1')}
              >一级大类</button>
              <button
                style={{
                  padding: '5px 16px',
                  borderRadius: '0 6px 6px 0',
                  border: '1px solid #d9d9d9',
                  borderLeft: 'none',
                  background: catSubTab === 'level2' ? '#1677ff' : '#fff',
                  color: catSubTab === 'level2' ? '#fff' : '#333',
                  fontWeight: catSubTab === 'level2' ? 600 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setCatSubTab('level2')}
              >二级分类</button>
            </div>
            <button className="btn-primary" onClick={openAddCat}>+ {catSubTab === 'level1' ? '新增一级大类' : '新增二级分类'}</button>
            <span style={{ marginLeft: 'auto', color: '#888', fontSize: 13 }}>
              {catSubTab === 'level1'
                ? `共 ${categories.filter(c => !c.parentId).length} 个一级大类`
                : `共 ${categories.filter(c => !!c.parentId).length} 个二级分类`}
            </span>
          </div>
          {catLoading ? <div className="empty-state">加载中...</div> : (
            <table className="faq-table">
              <thead>
                {catSubTab === 'level1' ? (
                  <tr>
                    <th style={{ width: 60 }}>序号</th>
                    <th>大类名称</th>
                    <th>描述</th>
                    <th style={{ width: 60 }}>默认</th>
                    <th style={{ width: 140 }}>操作</th>
                  </tr>
                ) : (
                  <tr>
                    <th style={{ width: 60 }}>序号</th>
                    <th>二级分类名称</th>
                    <th>所属一级大类</th>
                    <th>描述</th>
                    <th style={{ width: 60 }}>默认</th>
                    <th style={{ width: 140 }}>操作</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {catSubTab === 'level1' ? (
                  categories.filter(c => !c.parentId).map((cat, i) => (
                    <tr key={cat.id} style={{ background: '#f8f9fa' }}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{cat.name}</td>
                      <td className="faq-a">{cat.description || '-'}</td>
                      <td>{cat.isDefault ? '✅' : ''}</td>
                      <td>
                        <button className="btn-sm" onClick={() => openEditCat(cat)}>编辑</button>
                        <button className="btn-sm btn-danger" onClick={() => deleteCategory(cat)} style={{ marginLeft: 4 }} disabled={cat.isDefault}>删除</button>
                      </td>
                    </tr>
                  ))
                ) : (
                  categories.filter(c => !!c.parentId).map((sub, i) => {
                    const parent = categories.find(p => p.id === sub.parentId);
                    return (
                      <tr key={sub.id}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 400 }}>{sub.name}</td>
                        <td style={{ color: '#1677ff', fontWeight: 500 }}>{parent?.name || '-'}</td>
                        <td className="faq-a">{sub.description || '-'}</td>
                        <td></td>
                        <td>
                          <button className="btn-sm" onClick={() => openEditCat(sub)}>编辑</button>
                          <button className="btn-sm btn-danger" onClick={() => deleteCategory(sub)} style={{ marginLeft: 4 }}>删除</button>
                        </td>
                      </tr>
                    );
                  })
                )}
                {catSubTab === 'level1' && categories.filter(c => !c.parentId).length === 0 && (
                  <tr><td colSpan={5} className="empty-state">暂无一级大类，请点击「新增一级大类」</td></tr>
                )}
                {catSubTab === 'level2' && categories.filter(c => !!c.parentId).length === 0 && (
                  <tr><td colSpan={6} className="empty-state">暂无二级分类，请先添加一级大类后点击「新增二级分类」</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'faq' && (
        <div className="faq-management" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: '10px' }}>
          <div className="faq-toolbar">
            <button className="btn-primary" onClick={openAddFaq}>+ 新增 FAQ</button>
            <label className="btn-secondary" style={{ cursor: 'pointer' }}>
              📁 批量导入
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} />
            </label>
            {uploading && <span style={{ color: '#1890ff' }}>上传中...</span>}
            {/* 批量导入：一级分类 */}
            <select value={uploadLevel1Cat} onChange={e => { setUploadLevel1Cat(e.target.value); setUploadCategory(''); }} style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid #d9d9d9' }}>
              <option value="">-- 导入一级分类 --</option>
              {categories.filter(c => !c.parentId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* 批量导入：二级分类 */}
            <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} disabled={!uploadLevel1Cat} style={{ marginLeft: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid #d9d9d9' }}>
              <option value="">-- 导入二级分类 --</option>
              {categories.filter(c => c.parentId === uploadLevel1Cat).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <select value={faqFilterCategory} onChange={e => setFaqFilterCategory(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d9d9d9' }}>
                <option value="">全部分类</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <input
                type="text"
                placeholder="搜索问题/答案/关键词..."
                value={faqSearchKeyword}
                onChange={e => setFaqSearchKeyword(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d9d9d9', width: 200 }}
              />
            </div>
          </div>
          {faqLoading ? <div className="empty-state">加载中...</div> : (
            <>
              <div className="faq-table-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <table className="faq-table">
                <thead>
                  <tr>
                    <th style={{ width: columnWidths['checkbox'] || 50, position: 'relative' }}>
                      <input type="checkbox" onChange={e => setSelectedFaqIds(e.target.checked ? new Set(faqList.map(f => f.id)) : new Set())} />
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'checkbox')} />
                    </th>
                    <th style={{ width: columnWidths['index'] || 50, position: 'relative' }}>
                      #
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'index')} />
                    </th>
                    <th style={{ width: columnWidths['question'] || 200, position: 'relative' }}>
                      问题
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'question')} />
                    </th>
                    <th style={{ width: columnWidths['keywords'] || 150, position: 'relative' }}>
                      关键词
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'keywords')} />
                    </th>
                    <th style={{ width: columnWidths['catL1'] || 100, position: 'relative' }}>
                      一级分类
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'catL1')} />
                    </th>
                    <th style={{ width: columnWidths['catL2'] || 100, position: 'relative' }}>
                      二级分类
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'catL2')} />
                    </th>
                    <th style={{ width: columnWidths['intent'] || 100, position: 'relative' }}>
                      意图标签
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'intent')} />
                    </th>
                    <th style={{ width: columnWidths['answer'] || 300, position: 'relative' }}>
                      答案
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'answer')} />
                    </th>
                    <th style={{ width: columnWidths['actions'] || 120, position: 'relative' }}>
                      操作
                      <div className="resizer" onMouseDown={e => handleResizerMouseDown(e, 'actions')} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFaqList.map((faq, i) => (
                    <tr key={faq.id} className={selectedFaqIds.has(faq.id) ? 'faq-selected' : ''}>
                      <td><input type="checkbox" checked={selectedFaqIds.has(faq.id)} onChange={e => {
                        const next = new Set(selectedFaqIds);
                        if (e.target.checked) next.add(faq.id); else next.delete(faq.id);
                        setSelectedFaqIds(next);
                      }} /></td>
                      <td>{i + 1}</td>
                      <td className="faq-q">{faqSearchKeyword ? highlightKeyword(faq.question, faqSearchKeyword) : faq.question}</td>
                      <td className="faq-a">{(faq.keywords || []).map(k => <span key={k} className="cat-tag">{k}</span>)}</td>
                      {renderCategoryTds(faq.category)}
                      <td><span className="cat-tag">{faq.intent || '-'}</span></td>
                      <td className="faq-a" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={faq.answer}>{faq.answer || '-'}</td>
                      <td>
                        <button className="btn-sm" onClick={() => openEditFaq(faq)}>编辑</button>
                        <button className="btn-sm btn-danger" onClick={() => deleteFaq(faq.id)} style={{ marginLeft: 4 }}>删除</button>
                      </td>
                    </tr>
                  ))}
                  {filteredFaqList.length === 0 && (
                    <tr><td colSpan={9} className="empty-state">暂无 FAQ 数据，请点击「新增 FAQ」或「批量导入」</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              {selectedFaqIds.size > 0 && (
                <div style={{ padding: 12, background: '#e6f7ff', borderTop: '1px solid #91d5ff' }}>
                  <button className="btn-danger" onClick={async () => {
                    if (!confirm(`确定删除选中的 ${selectedFaqIds.size} 条 FAQ？`)) return;
                    try {
                      const res = await fetch(`${API_BASE}/faq/batch-delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: [...selectedFaqIds] })
                      });
                      const data = await res.json();
                      if (data.success) { alert(`成功删除 ${data.deleted} 条 FAQ`); setSelectedFaqIds(new Set()); fetchFAQ(); }
                      else alert('删除失败：' + (data.error || '未知错误'));
                    } catch (err: any) { alert('删除失败：' + err.message); }
                  }}>🗑️ 删除选中（{selectedFaqIds.size}）</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'basicInfo' && <BasicInfoManagement />}

      {tab === 'rag' && <RAGManagement />}

      {tab === 'intent' && <IntentUnderstanding />}

      {tab === 'rewrite' && <AnswerRewriter />}

      {/* 分类新增/编辑弹窗 */}
      {showCatModal && (
        <div className="modal-overlay" onClick={closeCatModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{editingCat ? (editingCat.parentId ? '编辑二级分类' : '编辑一级大类') : (catSubTab === 'level2' ? '新增二级分类' : '新增一级大类')}</h3>
            <div className="form-group">
              <label>所属知识库 *</label>
              <select
                value={catForm.knowledgeBaseId || ''}
                onChange={e => setCatForm(f => ({ ...f, knowledgeBaseId: e.target.value }))}
                disabled={!!editingCat?.isDefault}
              >
                <option value="">-- 请选择知识库 --</option>
                {knowledgeBases.map(kb => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>分类名称 *</label>
              <input
                type="text"
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                placeholder="例如：售后服务"
                disabled={!!editingCat?.isDefault}
              />
            </div>
            <div className="form-group">
              <label>描述</label>
              <input
                type="text"
                value={catForm.description}
                onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))}
                placeholder="可选：分类说明"
              />
            </div>
            {(catSubTab === 'level2' || editingCat?.parentId) && (
              <div className="form-group">
                <label>上级分类 *</label>
                <select
                  value={catForm.parentId || ''}
                  onChange={e => setCatForm(f => ({ ...f, parentId: e.target.value }))}
                >
                  <option value="">-- 一级分类 --</option>
                  {categories.filter(c => !c.parentId && (!c.knowledgeBaseId || c.knowledgeBaseId === catForm.knowledgeBaseId)).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-primary" onClick={saveCategory}>保存</button>
              <button className="btn-secondary" onClick={closeCatModal}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* FAQ 新增/编辑弹窗 */}
      {showFaqModal && (
        <div className="modal-overlay" onClick={closeFaqModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <h3>{editingFaq ? '编辑 FAQ' : '新增 FAQ'}</h3>
            <div className="form-group">
              <label>知识库</label>
              <select
                value={faqForm.knowledgeBaseId || ''}
                onChange={e => setFaqForm(f => ({ ...f, knowledgeBaseId: e.target.value, category: '' }))}
              >
                <option value="">-- 请选择知识库 --</option>
                {knowledgeBases.map(kb => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>
            {/* 一级分类选择器 */}
            <div className="form-group" style={{ flex: 1, display: faqForm.knowledgeBaseId ? 'block' : 'none' }}>
              <label>一级分类</label>
              <select
                value={faqFormLevel1Cat}
                onChange={e => { setFaqFormLevel1Cat(e.target.value); setFaqForm(f => ({ ...f, category: '' })); }}
                disabled={!faqForm.knowledgeBaseId}
              >
                <option value="">-- 请选择一级分类 --</option>
                {categories
                  .filter(c => !c.parentId && (!c.knowledgeBaseId || c.knowledgeBaseId === faqForm.knowledgeBaseId))
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
            {/* 二级分类选择器 */}
            <div className="form-group" style={{ flex: 1, display: faqFormLevel1Cat ? 'block' : 'none' }}>
              <label>二级分类</label>
              <select
                value={faqForm.category}
                onChange={e => setFaqForm(f => ({ ...f, category: e.target.value }))}
                disabled={!faqFormLevel1Cat}
              >
                <option value="">-- 请选择二级分类 --</option>
                {categories
                  .filter(c => c.parentId === faqFormLevel1Cat)
                  .map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>意图标签</label>
                <input type="text" value={faqForm.intent} onChange={e => setFaqForm(f => ({ ...f, intent: e.target.value }))} placeholder="例如：return_refund" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>分类</label>
                <select
                  value={faqForm.category}
                  onChange={e => setFaqForm(f => ({ ...f, category: e.target.value }))}
                  disabled={!faqForm.knowledgeBaseId}
                >
                  <option value="">-- 请选择分类 --</option>
                  {categories
                    .filter(c => !c.parentId && c.knowledgeBaseId === faqForm.knowledgeBaseId)
                    .map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  {categories
                    .filter(c => c.parentId && c.knowledgeBaseId === faqForm.knowledgeBaseId)
                    .map(c => {
                      const parent = categories.find(p => p.id === c.parentId);
                      return <option key={c.id} value={c.name}>　└ {c.name}（{parent?.name}）</option>;
                    })}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>问题 *</label>
              <input type="text" value={faqForm.question} onChange={e => setFaqForm(f => ({ ...f, question: e.target.value }))} placeholder="用户输入的问题" />
            </div>
            <div className="form-group">
              <label>关键词（逗号分隔）</label>
              <input type="text" value={faqForm.keywords} onChange={e => setFaqForm(f => ({ ...f, keywords: e.target.value }))} placeholder="例如：退货，退款，退货政策" />
            </div>
            <div className="form-group">
              <label>答案 *</label>
              <textarea value={faqForm.answer} onChange={e => setFaqForm(f => ({ ...f, answer: e.target.value }))} rows={5} placeholder="AI 的回答内容" />
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={saveFaq}>保存</button>
              <button className="btn-secondary" onClick={closeFaqModal}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
