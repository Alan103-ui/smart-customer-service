import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { Message } from '../types';
import BasicInfoManagement from './BasicInfoManagement';
import RAGManagement from './RAGManagement';
import DataStatistics from './DataStatistics';
import { useSoftwareInfo } from '../services/softwareInfo';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import { IDomEditor, IEditorConfig } from '@wangeditor/editor';

// ==================== 富文本编辑器配置 ====================
const createEditorConfig = (onChangeHtml: (html: string) => void): Partial<IEditorConfig> => ({
  placeholder: '请输入答案内容（支持富文本格式）...',
  MENU_CONF: {
    uploadImage: {
      server: '/api/admin/upload/editor-image',
      fieldName: 'file',
      maxFileSize: 5 * 1024 * 1024, // 5MB
      allowedFileTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      customInsert: (res: any, insertFn: any) => {
        if (res.errno === 0) {
          const url = res.data.url;
          insertFn(url, 'image', url);
        }
      }
    }
  },
  // 正确的 onChange 用法：参数是 editor 对象
  onChange(editor: IDomEditor) {
    const html = editor.getHtml();
    onChangeHtml(html);
  }
});

// ==================== 日志查看器辅助 ====================
const LOG_LEVELS = [
  { key: 'ALL', label: '全部', color: '#666', bg: '#f5f5f5' },
  { key: 'ERROR', label: 'ERROR', color: '#cf1322', bg: '#fff1f0' },
  { key: 'WARN', label: 'WARN', color: '#d46b08', bg: '#fff7e6' },
  { key: 'INFO', label: 'INFO', color: '#0958d9', bg: '#e6f4ff' },
  { key: 'AUDIT', label: 'AUDIT', color: '#531dab', bg: '#f9f0ff' },
  { key: 'PERF', label: 'PERF', color: '#08979c', bg: '#e6fffb' },
];
const LOG_LEVEL_META: Record<string, { color: string; bg: string }> = LOG_LEVELS.reduce(
  (acc, l) => { acc[l.key] = { color: l.color, bg: l.bg }; return acc; },
  {} as Record<string, { color: string; bg: string }>
);

function fmtBytes(n: number): string {
  if (!n && n !== 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toTimeString().slice(0, 8);
}

// 日期分组标签（今天 / 昨天 / 更早）
function getDateGroupLabel(dateStr?: string): string {
  if (!dateStr) return '未知日期';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '未知日期';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const fileDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (fileDate.getTime() === today.getTime()) return '今天';
  if (fileDate.getTime() === yesterday.getTime()) return '昨天';
  // 超过7天显示具体日期
  const diffDays = Math.floor((today.getTime() - fileDate.getTime()) / 86400000);
  if (diffDays <= 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// 格式化修改时间
function fmtMtime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return '今天 ' + d.toTimeString().slice(0, 5);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + d.toTimeString().slice(0, 5);
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + d.toTimeString().slice(0, 5);
}

// 日志文件类型识别
function getLogType(filename: string): 'app' | 'server' | 'raw' {
  if (filename.startsWith('server-')) return 'server';
  if (/^\d{4}-\d{2}-\d{2}\.log$/.test(filename)) return 'app';
  return 'raw';
}
const LOG_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  app: { label: '应用', color: '#0958d9', bg: '#e6f4ff' },
  server: { label: '服务', color: '#595959', bg: '#f5f5f5' },
  raw: { label: '原始', color: '#8c8c8c', bg: '#fafafa' },
};

// 从文件名提取日期（用于排序和分组）
function extractDateFromFilename(name: string): Date | null {
  // 匹配 server-2026-07-09.log 或 2026-07-09.log 格式
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

// 级别对应的整行底色（轻微着色，便于快速区分）
const LEVEL_ROW_BG: Record<string, string> = {
  ERROR: '#fff5f5',
  WARN: '#fffbe6',
  INFO: '#f0f7ff',
  AUDIT: '#f9f0ff',
  PERF: '#e6fffb',
  DEBUG: '#f6ffed',
  RAW: '#fafafa',
};

// 关键词高亮
function HighlightText({ text, kw }: { text: string; kw: string }) {
  if (!kw) return <>{text}</>;
  const lower = text.toLowerCase();
  const k = kw.toLowerCase();
  const nodes: ReactNode[] = [];
  let i = 0, idx = lower.indexOf(k, i), key = 0;
  while (idx !== -1) {
    if (idx > i) nodes.push(<span key={key++}>{text.slice(i, idx)}</span>);
    nodes.push(
      <mark key={key++} style={{ background: '#ffe58f', color: '#000', padding: '0 1px', borderRadius: 2 }}>
        {text.slice(idx, idx + k.length)}
      </mark>
    );
    i = idx + k.length;
    idx = lower.indexOf(k, i);
  }
  if (i < text.length) nodes.push(<span key={key++}>{text.slice(i)}</span>);
  return <>{nodes}</>;
}

// 单条日志行（行号 + 级别底色 + 时间列 + 关键词高亮 + 可展开详情）
function LogRow({ entry, index, kw, openByDefault }: { entry: any; index: number; kw: string; openByDefault: boolean }) {
  const [open, setOpen] = useState(openByDefault);
  const meta = LOG_LEVEL_META[entry.level] || { color: '#8c8c8c', bg: '#f5f5f5' };
  const detail = { ...entry };
  delete (detail as any).timestamp;
  delete (detail as any).level;
  delete (detail as any).message;
  const detailKeys = Object.keys(detail);
  const isRaw = entry.level === 'RAW';
  const rowBg = open ? '#f7f7f7' : (LEVEL_ROW_BG[entry.level] || '#fff');
  return (
    <div
      style={{
        display: 'flex',
        borderLeft: `3px solid ${meta.color}`,
        background: rowBg,
        borderBottom: '1px solid #f0f0f0',
        fontSize: 12.5,
        cursor: detailKeys.length ? 'pointer' : 'default'
      }}
      onClick={() => detailKeys.length && setOpen(o => !o)}
    >
      <span style={{ width: 44, flexShrink: 0, textAlign: 'right', padding: '6px 8px 6px 0', color: '#bbb', userSelect: 'none', fontSize: 11 }}>
        {index + 1}
      </span>
      <div style={{ flex: 1, minWidth: 0, padding: '6px 10px 6px 0', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ background: meta.bg, color: meta.color, padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 11, minWidth: 52, textAlign: 'center', flexShrink: 0 }}>
            {entry.level}
          </span>
          <span style={{ color: '#999', minWidth: 66, flexShrink: 0 }}>{fmtTime(entry.timestamp)}</span>
          <span style={{ color: '#222', flex: 1, wordBreak: 'break-all', lineHeight: 1.5 }}>
            {isRaw
              ? <span style={{ whiteSpace: 'pre-wrap' }}>{entry.message}</span>
              : <HighlightText text={String(entry.message || '')} kw={kw} />}
          </span>
          {detailKeys.length > 0 && (
            <span style={{ color: '#bbb', fontSize: 11, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
        {open && detailKeys.length > 0 && (
          <pre style={{ margin: '6px 0 2px', background: '#fff', border: '1px solid #eee', padding: 8, borderRadius: 4, fontSize: 11.5, color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ==================== 类型定义 ====================
interface Conversation {
  id: string;
  session_id: string;
  user_id?: string | null;
  user_name?: string;
  username?: string;
  messages: Message[];
  intent: string | null;
  resolved: number;
  created_at: string;
  updated_at: string;
}

interface AdminDashboardProps {
  onBack?: () => void;
  user?: { id: string; username: string; name: string; role: string };
  onLogout?: () => void;
}

interface Stats {
  totalConversations: number;
  resolvedCount: number;
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
  attachments?: any[];
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
  const sw = useSoftwareInfo();
  const [tab, setTab] = useState<'stats' | 'faq' | 'categories' | 'basicInfo' | 'rag' | 'conversations' | 'logs'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  // 日志管理状态
  const [logFiles, setLogFiles] = useState<any[]>([]);
  const [logEntries, setLogEntries] = useState<any[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<string>('');
  const [logLoading, setLogLoading] = useState(false);
  const [logLevelFilter, setLogLevelFilter] = useState<string>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');
  const [logLimit, setLogLimit] = useState<number>(200);
  const [logSort, setLogSort] = useState<'time' | 'durDesc' | 'durAsc'>('time');
  const [logDateFrom, setLogDateFrom] = useState<string>('');
  const [logDateTo, setLogDateTo] = useState<string>('');
  const [logAutoRefresh, setLogAutoRefresh] = useState<boolean>(false);
  const [logExpandAll, setLogExpandAll] = useState<boolean>(false);
  const [logHint, setLogHint] = useState<string>('');
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const logHintTimer = useRef<number | null>(null);
  const logRefreshTimer = useRef<number | null>(null);

  // 短暂提示（复制/下载成功后）
  const flashLogHint = (msg: string) => {
    setLogHint(msg);
    if (logHintTimer.current) window.clearTimeout(logHintTimer.current);
    logHintTimer.current = window.setTimeout(() => setLogHint(''), 2000);
  };

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
  const [faqForm, setFaqForm] = useState({ id: '', question: '', keywords: '', answer: '', intent: '', category: '', knowledgeBaseId: '', attachments: [] as any[] });
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

  // 获取认证头
  function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = localStorage.getItem('cs_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  // 知识库数据获取
  const fetchKnowledgeBases = async () => {
    try {
      const res = await fetch(`${API_BASE}/knowledge-bases`, { headers: getAuthHeaders() });
      const data = await res.json();
      setKnowledgeBases(data.filter((kb: any) => kb.isActive));
    } catch (err) { console.error('获取知识库失败', err); }
  };

  // 分类数据获取
  const fetchCategories = async () => {
    setCatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/categories`, { headers: getAuthHeaders() });
      setCategories(await res.json());
    } catch (err) { console.error('获取分类失败', err); }
    setCatLoading(false);
  };

  // FAQ 数据获取
  const fetchFAQ = async () => {
    setFaqLoading(true);
    try {
      const res = await fetch(`${API_BASE}/faq`, { headers: getAuthHeaders() });
      const json = await res.json();
      // API 返回 {success, data} 格式，需要解包取 data 数组
      setFaqList(Array.isArray(json) ? json : (json.data || []));
    } catch (err) { console.error('获取 FAQ 失败', err); }
    setFaqLoading(false);
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`, { headers: getAuthHeaders() });
      setStats(await res.json());
    } catch (err) { console.error('获取统计数据失败', err); }
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/conversations`, { headers: getAuthHeaders() });
      if (!res.ok) { console.error('获取对话列表失败:', res.status); setConversations([]); setLoading(false); return; }
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (err) { console.error('获取对话列表失败', err); setConversations([]); setLoading(false); }
  };

  // 获取日志文件列表（附带级别统计）
  const fetchLogs = async () => {
    setLogLoading(true);
    try {
      const res = await fetch(`${API_BASE}/logs?summary=true`, { headers: getAuthHeaders() });
      if (!res.ok) { console.error('获取日志文件列表失败:', res.status); setLogFiles([]); }
      else {
        const result = await res.json();
        const files = Array.isArray(result) ? result : (result.data || []);
        setLogFiles(files);
      }
    } catch (err) { console.error('获取日志文件列表失败', err); setLogFiles([]); }
    finally { setLogLoading(false); }
  };

  // 读取日志文件内容（结构化条目，支持级别/搜索/条数过滤）
  const fetchLogEntries = async (filename: string) => {
    if (!filename) return;
    setLogLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(logLimit));
      if (logLevelFilter !== 'ALL') params.set('level', logLevelFilter);
      if (logSearch.trim()) params.set('search', logSearch.trim());
      const res = await fetch(`${API_BASE}/logs/${encodeURIComponent(filename)}?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) { console.error('读取日志文件失败:', res.status); setLogEntries([]); }
      else {
        const result = await res.json();
        setLogEntries(Array.isArray(result.data) ? result.data : []);
        setSelectedLogFile(filename);
        if (logBodyRef.current) logBodyRef.current.scrollTop = 0;
      }
    } catch (err) { console.error('读取日志文件失败', err); setLogEntries([]); }
    finally { setLogLoading(false); }
  };

  // 切换文件/筛选条件变化时重新加载
  const reloadLogEntries = () => {
    if (selectedLogFile) fetchLogEntries(selectedLogFile);
  };

  // 把当前条目拼成可读文本（用于复制/下载）
  const buildLogText = (): string => {
    return logEntries.map((e) => {
      const meta = { ...e };
      delete (meta as any).timestamp;
      delete (meta as any).level;
      delete (meta as any).message;
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `[${e.level}] ${e.timestamp || ''} ${e.message || ''}${metaStr}`;
    }).join('\n');
  };

  const copyLogText = () => {
    const text = buildLogText();
    if (!text) { flashLogHint('暂无内容可复制'); return; }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flashLogHint('已复制当前日志到剪贴板'))
        .catch(() => flashLogHint('复制失败，请手动选择'));
    } else {
      flashLogHint('当前环境不支持自动复制');
    }
  };

  const downloadLogText = () => {
    const text = buildLogText();
    if (!text) { flashLogHint('暂无内容可下载'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLogFile || 'log'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flashLogHint('已下载当前日志');
  };

  // 实时刷新（每 3 秒轮询当前文件）
  useEffect(() => {
    if (logAutoRefresh && selectedLogFile) {
      logRefreshTimer.current = window.setInterval(() => fetchLogEntries(selectedLogFile), 3000);
      return () => {
        if (logRefreshTimer.current) window.clearInterval(logRefreshTimer.current);
      };
    }
  }, [logAutoRefresh, selectedLogFile, logLevelFilter, logSearch, logLimit]);

  // 级别 / 条数筛选变化即重新查询（搜索需手动点“查询”，避免逐字请求）
  useEffect(() => {
    if (selectedLogFile && !logAutoRefresh) {
      fetchLogEntries(selectedLogFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLevelFilter, logLimit]);

  // 删除单个对话
  const deleteConversation = async (sessionId: string) => {
    if (!confirm('确定要删除这个对话吗？')) return;
    try {
      const res = await fetch(`${API_BASE}/conversations/${sessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) { alert('删除成功'); fetchConversations(); }
      else { alert('删除失败：' + res.status); }
    } catch (err) { console.error('删除对话失败', err); alert('删除失败'); }
  };

  // 批量删除对话
  const batchDeleteConversations = async () => {
    if (selectedSessionIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedSessionIds.size} 个对话吗？`)) return;
    try {
      const res = await fetch(`${API_BASE}/conversations/batch-delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: Array.from(selectedSessionIds) })
      });
      if (res.ok) { alert('批量删除成功'); setSelectedSessionIds(new Set()); fetchConversations(); }
      else { alert('批量删除失败：' + res.status); }
    } catch (err) { console.error('批量删除失败', err); alert('批量删除失败'); }
  };

  useEffect(() => {
    fetchStats();
    fetchConversations();
    fetchCategories();
    fetchKnowledgeBases();
    const timer = setInterval(() => { fetchStats(); fetchConversations(); }, 60000); // 60秒刷新一次
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab === 'faq') { fetchFAQ(); fetchCategories(); fetchKnowledgeBases(); }
    if (tab === 'categories') { fetchCategories(); fetchKnowledgeBases(); }
    if (tab === 'conversations') { fetchConversations(); }
    if (tab === 'logs') { fetchLogs(); }
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
      const res = await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(payload) });
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
      await fetch(`${API_BASE}/categories/${cat.id}`, { method: 'DELETE', headers: getAuthHeaders() });
      fetchCategories();
      fetchFAQ();
    } catch (err) { alert('删除失败'); }
  };

  // ==================== FAQ 操作 ====================
  const openAddFaq = () => { setEditingFaq(null); setFaqForm({ id: '', question: '', keywords: '', answer: '', intent: '', category: '', knowledgeBaseId: '', attachments: [] }); setFaqFormLevel1Cat(''); setShowFaqModal(true); };
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
    
    // 修复：确保 answer 是字符串，如果是纯文本则转为 HTML
    let answerHtml = faq.answer || '';
    // 如果答案不是 HTML（不包含 < 标签），则包裹 <p> 标签
    if (answerHtml && !answerHtml.includes('<p>') && !answerHtml.includes('<div>')) {
      answerHtml = `<p>${answerHtml}</p>`;
    }
    
    setFaqForm({
      id: faq.id || '',
      question: faq.question,
      keywords: (faq.keywords || []).join(', '),
      answer: answerHtml,
      intent: faq.intent || '',
      category: faq.category || '',
      knowledgeBaseId: faq.knowledgeBaseId || '',
      attachments: faq.attachments || [],
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
      const res = await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      closeFaqModal();
      fetchFAQ();
    } catch (err: any) { alert('保存失败：' + err.message); }
  };

  const deleteFaq = async (id: string) => {
    if (!confirm('确定删除该 FAQ 条目？')) return;
    try {
      await fetch(`${API_BASE}/faq/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
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
      const res = await fetch(url, { method: 'POST', headers: getAuthHeaders({}), body: formData });
      const data = await res.json();
      if (data.success) { alert(`文件解析完成！新增 ${data.added} 条 FAQ，当前共 ${data.total} 条。`); fetchFAQ(); }
      else alert('上传失败：' + (data.error || '未知错误'));
    } catch (err) { alert('上传失败，请检查文件格式（支持 .txt/.md/.pdf/.doc/.docx/.xls/.xlsx）'); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectedConv = Array.isArray(conversations) ? conversations.find(c => c.session_id === selectedSession) : undefined;

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
          <h1>🤖 {sw.softwareName} - 管理后台</h1>
        </div>
        <div className="admin-tabs">
          <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>📈 数据统计</button>
          <button className={`tab-btn ${tab === 'faq' ? 'active' : ''}`} onClick={() => setTab('faq')}>📚 知识库内容</button>
          <button className={`tab-btn ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>🏷️ 分类管理</button>
          <button className={`tab-btn ${tab === 'basicInfo' ? 'active' : ''}`} onClick={() => setTab('basicInfo')}>🏢 基础信息</button>
          <button className={`tab-btn ${tab === 'rag' ? 'active' : ''}`} onClick={() => setTab('rag')}>🤖 RAG 管理</button>
          <button className={`tab-btn ${tab === 'conversations' ? 'active' : ''}`} onClick={() => setTab('conversations')}>💬 对话管理</button>
          <button className={`tab-btn ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>📝 日志管理</button>
        </div>
      </div>

      <div className="tab-scroll">
      {tab === 'stats' && <DataStatistics />}

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
                        headers: getAuthHeaders(),
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

      {/* 对话管理 */}
      {tab === 'conversations' && (
        <div className="conversation-management" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>💬 对话管理</h3>
            <div>
              <button className="btn-danger" onClick={batchDeleteConversations} disabled={selectedSessionIds.size === 0}>
                批量删除({selectedSessionIds.size})
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
          ) : conversations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无对话记录</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}><input type="checkbox" checked={selectedSessionIds.size > 0 && selectedSessionIds.size === conversations.length} onChange={(e) => { if (e.target.checked) setSelectedSessionIds(new Set(conversations.map((c: Conversation) => c.session_id))); else setSelectedSessionIds(new Set()); }} /></th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>会话ID</th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>咨询人</th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>消息数</th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>状态</th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>时间</th>
                  <th style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'left' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => {
                  let msgCount = 0;
                  try {
                    const msgs = typeof conv.messages === 'string'
                      ? JSON.parse(conv.messages || '[]')
                      : (Array.isArray(conv.messages) ? conv.messages : []);
                    msgCount = msgs.length;
                  } catch(e) { console.error('解析消息数失败', e); }
                  return (
                    <tr key={conv.session_id}>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5' }}>
                        <input type="checkbox" checked={selectedSessionIds.has(conv.session_id)} onChange={(e) => {
                          const s = new Set(selectedSessionIds);
                          if (e.target.checked) s.add(conv.session_id); else s.delete(conv.session_id);
                          setSelectedSessionIds(s);
                        }} />
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5', fontSize: 12, fontFamily: 'monospace' }}>{conv.session_id.substring(0, 16)}...</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5' }}>
                        <div style={{ fontWeight: 600 }}>{conv.user_name || conv.username || '匿名用户'}</div>
                        {conv.username && <div style={{ fontSize: 12, color: '#999' }}>@{conv.username}</div>}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5' }}>{msgCount}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5' }}>{conv.resolved ? '✅ 已解决' : '⏳ 进行中'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>{new Date(conv.created_at).toLocaleString('zh-CN')}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f5f5f5' }}>
                        <button onClick={() => setSelectedSession(conv.session_id)} style={{ marginRight: 4, cursor: 'pointer' }}>查看</button>
                        <button onClick={() => deleteConversation(conv.session_id)} style={{ color: '#ff4d4f', cursor: 'pointer', border: 'none', background: 'none' }}>删除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {selectedSession && (() => {
            const conv = conversations.find(c => c.session_id === selectedSession);
            if (!conv) return null;
            let msgs: any[] = [];
            try {
              msgs = typeof conv.messages === 'string'
                ? JSON.parse(conv.messages || '[]')
                : (Array.isArray(conv.messages) ? conv.messages : []);
            } catch(e) { console.error('解析对话消息失败', e); }
            return (
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setSelectedSession(null)}>
                <div style={{ background: '#fff', borderRadius: 8, maxWidth: 800, width: '90%', maxHeight: 500, display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0', fontSize: 16, fontWeight: 600 }}>
                    对话详情
                    <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 400, color: '#1890ff' }}>
                      👤 {conv.user_name || conv.username || '匿名用户'}{conv.username ? `（@${conv.username}）` : ''}
                    </span>
                  </div>
                  <div style={{ overflowY: 'auto', padding: 16, flex: 1 }}>
                    {msgs.length === 0 ? <div style={{ textAlign: 'center', color: '#999' }}>无消息</div> : msgs.map((m, i) => (
                      <div key={i} style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: m.role === 'user' ? '#e6f7ff' : '#f6ffed', borderLeft: m.role === 'user' ? '4px solid #1890ff' : '4px solid #52c41a' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.role === 'user' ? '👤 用户' : '🤖 AI'}</div>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', textAlign: 'right' }}>
                    <button onClick={() => setSelectedSession(null)} style={{ padding: '6px 20px', cursor: 'pointer' }}>关闭</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 日志管理 */}
      {tab === 'logs' && (() => {
        // ===== 派生数据：统计 + 日期分组 + 排序 =====
        // 日期范围筛选（基于文件名日期或 modifiedAt）
        const fromTs = logDateFrom ? new Date(logDateFrom + 'T00:00:00').getTime() : null;
        const toTs = logDateTo ? new Date(logDateTo + 'T23:59:59.999').getTime() : null;
        const fileDateTs = (f: any): number | null => {
          const d = extractDateFromFilename(f.filename) || (f.modifiedAt ? new Date(f.modifiedAt) : null);
          return d ? d.getTime() : null;
        };
        const dateFiltered = logFiles.filter(f => {
          if (fromTs === null && toTs === null) return true;
          const ts = fileDateTs(f);
          if (ts === null) return false; // 无日期文件在启用筛选时隐藏
          if (fromTs !== null && ts < fromTs) return false;
          if (toTs !== null && ts > toTs) return false;
          return true;
        });
        const dateFilterActive = fromTs !== null || toTs !== null;

        const totalErrors = dateFiltered.reduce((s, f) => s + ((f.levelCounts || {}).ERROR || 0), 0);
        const totalWarns = dateFiltered.reduce((s, f) => s + ((f.levelCounts || {}).WARN || 0), 0);
        const totalSize = dateFiltered.reduce((s, f) => s + (f.size || 0), 0);
        const totalLines = dateFiltered.reduce((s, f) => s + (f.lines || 0), 0);

        // 按日期分组（按文件名中的日期或 mtime）
        const grouped = dateFiltered.slice().sort((a, b) => {
          const da = extractDateFromFilename(a.filename) || (a.modifiedAt ? new Date(a.modifiedAt) : new Date(0));
          const db = extractDateFromFilename(b.filename) || (b.modifiedAt ? new Date(b.modifiedAt) : new Date(0));
          return db.getTime() - da.getTime(); // 最新的在前
        }).reduce((groups, f) => {
          const dateKey = getDateGroupLabel(f.modifiedAt) || getDateGroupLabel(f.filename);
          if (!groups[dateKey]) groups[dateKey] = [];
          groups[dateKey].push(f);
          return groups;
        }, {} as Record<string, any[]>);

        const groupOrder = Object.keys(grouped);
        const todayStr = '今天';

        // 条目排序（按耗时）
        const sortedEntries = (() => {
          if (logSort === 'time') return logEntries;
          const durOf = (e: any) => {
            const v = Number(e.durationMs ?? e.duration ?? null);
            return isNaN(v) ? null : v;
          };
          const arr = logEntries.slice();
          if (logSort === 'durDesc') {
            arr.sort((a, b) => {
              const da = durOf(a), db = durOf(b);
              if (da === null && db === null) return 0;
              if (da === null) return 1;   // 无耗时沉底
              if (db === null) return -1;
              return db - da;
            });
          } else {
            arr.sort((a, b) => {
              const da = durOf(a), db = durOf(b);
              if (da === null && db === null) return 0;
              if (da === null) return 1;
              if (db === null) return -1;
              return da - db;
            });
          }
          return arr;
        })();

        return (
        <div style={{ padding: 16, background: '#fff', minHeight: 300 }}>
          {/* 顶部：标题 + 刷新 + 统计概览 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>📝 日志管理</h3>
            <button onClick={fetchLogs} disabled={logLoading}
              style={{ padding: '5px 14px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff' }}>
              {logLoading ? '加载中…' : '↻ 刷新'}
            </button>
          </div>

          {/* 统计概览条 */}
          {dateFiltered.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
              {[
                { label: '文件数', value: dateFiltered.length, icon: '📁', color: '#1890ff' },
                { label: '总大小', value: fmtBytes(totalSize), icon: '💾', color: '#722ed1' },
                { label: '总行数', value: totalLines.toLocaleString(), icon: '📃', color: '#13c2c2' },
                ...(totalErrors > 0 ? [{ label: '错误', value: totalErrors, icon: '❌', color: '#cf1322' }] : []),
                ...(totalWarns > 0 ? [{ label: '警告', value: totalWarns, icon: '⚠️', color: '#d46b08' }] : []),
              ].map(s => (
                <div key={s.label} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: `${s.color}08`, border: `1px solid ${s.color}22`,
                  padding: '6px 12px', borderRadius: 6, fontSize: 12.5
                }}>
                  <span>{s.icon}</span>
                  <span style={{ color: '#666' }}>{s.label}</span>
                  <strong style={{ color: s.color }}>{s.value}</strong>
                </div>
              ))}
            </div>
          )}

          {/* 日期范围筛选栏 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>
            <span style={{ fontSize: 12.5, color: '#666' }}>📅 日期范围：</span>
            <input type="date" value={logDateFrom} onChange={e => setLogDateFrom(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }} />
            <span style={{ fontSize: 12.5, color: '#999' }}>至</span>
            <input type="date" value={logDateTo} onChange={e => setLogDateTo(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }} />
            {dateFilterActive && (
              <button onClick={() => { setLogDateFrom(''); setLogDateTo(''); }}
                style={{ padding: '4px 10px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', fontSize: 12 }}>
                清除筛选
              </button>
            )}
            {dateFilterActive && (
              <span style={{ fontSize: 12, color: '#1890ff' }}>
                筛选中：{dateFiltered.length} / {logFiles.length} 个文件
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* 左侧：文件列表（日期分组 + 卡片式） */}
            <div style={{ width: 370, flexShrink: 0 }}>
              {/* 文件列表标题 + 日志类型图例 */}
              <div style={{ padding: '10px 12px', border: '1px solid #e8e8e8', borderRadius: '8px 8px 0 0', background: '#fff', borderBottom: 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>📁 日志文件</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#888' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#0958d9' }} />
                    应用日志
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#595959' }} />
                    服务/启动日志
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#8c8c8c' }} />
                    其他原始日志
                  </span>
                </div>
              </div>
              <div style={{ border: '1px solid #e8e8e8', borderRadius: '0 0 8px 8px', maxHeight: 640, overflow: 'auto', background: '#fafbfc' }}>
                {dateFiltered.length === 0 && (
                  <div style={{ padding: 30, color: '#999', textAlign: 'center' }}>
                    {logFiles.length === 0 ? '暂无日志文件' : '该日期范围内无日志文件'}
                  </div>
                )}
                {groupOrder.map(groupLabel => (
                  <div key={groupLabel}>
                    {/* 分组标题 */}
                    <div style={{
                    padding: '6px 14px', fontSize: 11.5, fontWeight: 600,
                    color: groupLabel === todayStr ? '#1890ff' : '#888',
                    background: groupLabel === todayStr ? '#e6f4ff20' : '#f0f0f0',
                    borderBottom: '1px solid #eee',
                    position: 'sticky', top: 0, zIndex: 1
                  }}>
                    {groupLabel === todayStr ? '📅 ' : ''}{groupLabel} · {grouped[groupLabel].length} 个文件
                  </div>
                  {grouped[groupLabel].map((f) => {
                    const active = f.filename === selectedLogFile;
                    const lc = f.levelCounts || {};
                    const isTodayGroup = groupLabel === todayStr;
                    const fileDate = extractDateFromFilename(f.filename);
                    const isVeryRecent = fileDate && (Date.now() - fileDate.getTime() < 86400000); // 24h内
                    const logType = getLogType(f.filename);
                    const typeMeta = LOG_TYPE_META[logType];

                    // 级别标签（定宽，便于整列对齐）
                    const badges = [];
                    if (lc.ERROR > 0) badges.push(<span key="err" style={{ width: 40, textAlign: 'center', background: '#fff1f0', color: '#cf1322', fontSize: 10, padding: '1px 0', borderRadius: 3, fontWeight: 600 }}>E {lc.ERROR}</span>);
                    if (lc.WARN > 0) badges.push(<span key="warn" style={{ width: 40, textAlign: 'center', background: '#fff7e6', color: '#d46b08', fontSize: 10, padding: '1px 0', borderRadius: 3, fontWeight: 600 }}>W {lc.WARN}</span>);
                    if (lc.PERF > 0) badges.push(<span key="perf" style={{ width: 40, textAlign: 'center', background: '#e6fffb', color: '#08979c', fontSize: 10, padding: '1px 0', borderRadius: 3 }}>P {lc.PERF}</span>);

                    return (
                      <div
                        key={f.filename}
                        onClick={() => fetchLogEntries(f.filename)}
                        style={{
                          padding: '9px 12px',
                          borderBottom: '1px solid #f0f0f0',
                          cursor: 'pointer',
                          background: active ? '#e6f7ff' : '#fff',
                          borderLeft: active ? '3px solid #1890ff' : (isVeryRecent && !active ? '3px solid #91d5ff' : '3px solid transparent'),
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                        title={`${logType === 'app' ? '应用运行日志' : logType === 'server' ? '服务/启动日志' : '原始日志'}：${f.filename}`}
                      >
                        {/* 第一行：类型标签 + 文件名 + 大小 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 600, color: typeMeta.color, background: typeMeta.bg,
                              padding: '1px 5px', borderRadius: 3, flexShrink: 0, border: `1px solid ${typeMeta.color}22`
                            }}>
                              {typeMeta.label}
                            </span>
                            <span style={{
                              fontFamily: 'monospace', fontWeight: active ? 700 : 600, fontSize: 12.5,
                              color: active ? '#0958d9' : '#333',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }} title={f.filename}>{f.filename}</span>
                          </div>
                          <span style={{ color: '#aaa', fontSize: 10.5, flexShrink: 0 }}>{fmtBytes(f.size)}</span>
                        </div>
                        {/* 第二行：固定列宽，保证整列对齐 */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                          <span style={{ width: 52, color: '#bbb', fontSize: 10.5, textAlign: 'right' }}>{(f.lines || 0).toLocaleString()} 行</span>
                          <span style={{ width: 110, color: '#bbb', fontSize: 10.5, textAlign: 'left' }}>{f.modifiedAt ? fmtMtime(f.modifiedAt) : '-'}</span>
                          <span style={{ flex: 1, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>{badges}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

            {/* 右侧：日志内容 */}
            <div style={{ flex: 1, minWidth: 0, border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              {!selectedLogFile ? (
                <div style={{ padding: 70, color: '#bbb', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 36 }}>📋</span>
                  <span>从左侧选择日志文件查看内容</span>
                  {logFiles.length > 0 && (
                    <button onClick={() => {
                      // 自动选最新的文件
                      const newest = logFiles.slice().sort((a, b) => {
                        const da = extractDateFromFilename(a.filename) || (a.modifiedAt ? new Date(a.modifiedAt) : new Date(0));
                        const db = extractDateFromFilename(b.filename) || (b.modifiedAt ? new Date(b.modifiedAt) : new Date(0));
                        return db.getTime() - da.getTime();
                      })[0];
                      if (newest) fetchLogEntries(newest.filename);
                    }}
                    style={{ padding: '6px 18px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#1890ff', color: '#fff', fontSize: 12 }}>
                      打开最新日志 →
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* 工具栏：标题 + 级别分布 + 操作 */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #eee', background: '#fafafa' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{selectedLogFile}</strong>
                      <span style={{ color: '#999', fontSize: 12 }}>共 {logEntries.length} 条</span>
                      {/* 级别分布统计 */}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {LOG_LEVELS.filter(l => l.key !== 'ALL').map(l => {
                          const c = logEntries.filter(e => e.level === l.key).length;
                          if (!c) return null;
                          return (
                            <span key={l.key} title={`${l.label} 数量`}
                              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: l.bg, color: l.color, border: '1px solid ' + l.color }}>
                              {l.label} {c}
                            </span>
                          );
                        })}
                      </div>
                      <div style={{ flex: 1 }} />
                      {logHint && <span style={{ color: '#389e0d', fontSize: 12 }}>{logHint}</span>}
                      <button onClick={() => setLogExpandAll(v => !v)}
                        style={{ padding: '4px 10px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', fontSize: 12 }}>
                        {logExpandAll ? '折叠全部' : '展开全部'}
                      </button>
                      <button onClick={copyLogText}
                        style={{ padding: '4px 10px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', fontSize: 12 }}>
                        复制
                      </button>
                      <button onClick={downloadLogText}
                        style={{ padding: '4px 10px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', fontSize: 12 }}>
                        下载
                      </button>
                    </div>
                    {/* 筛选行 */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {LOG_LEVELS.map(l => (
                          <button key={l.key} onClick={() => setLogLevelFilter(l.key)}
                            style={{
                              fontSize: 11, padding: '3px 9px', cursor: 'pointer', borderRadius: 12, border: '1px solid',
                              borderColor: logLevelFilter === l.key ? l.color : '#d9d9d9',
                              background: logLevelFilter === l.key ? l.bg : '#fff',
                              color: logLevelFilter === l.key ? l.color : '#666'
                            }}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                      <input
                        placeholder="搜索关键词…"
                        value={logSearch}
                        onChange={e => setLogSearch(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') reloadLogEntries(); }}
                        style={{ flex: 1, minWidth: 140, padding: '5px 10px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }}
                      />
                      <select value={logLimit} onChange={e => setLogLimit(Number(e.target.value))}
                        style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }}>
                        <option value={100}>最近100</option>
                        <option value={200}>最近200</option>
                        <option value={500}>最近500</option>
                        <option value={1000}>最近1000</option>
                        <option value={999999}>全部</option>
                      </select>
                      <select value={logSort} onChange={e => setLogSort(e.target.value as any)}
                        title="排序方式"
                        style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }}>
                        <option value="time">按时间</option>
                        <option value="durDesc">按耗时(长→短)</option>
                        <option value="durAsc">按耗时(短→长)</option>
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#666', cursor: 'pointer' }}>
                        <input type="checkbox" checked={logAutoRefresh} onChange={e => setLogAutoRefresh(e.target.checked)} />
                        实时
                      </label>
                      <button onClick={reloadLogEntries} disabled={logLoading}
                        style={{ padding: '5px 12px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', fontSize: 12 }}>
                        {logLoading ? '…' : '查询'}
                      </button>
                    </div>
                  </div>
                  {/* 日志条目 */}
                  <div ref={logBodyRef} style={{ maxHeight: 588, overflow: 'auto' }}>
                    {sortedEntries.length === 0 ? (
                      <div style={{ padding: 40, color: '#999', textAlign: 'center' }}>无匹配日志</div>
                    ) : (
                      sortedEntries.map((entry, i) => (
                        <LogRow key={`${i}-${logExpandAll}`} entry={entry} index={i} kw={logSearch.trim()} openByDefault={logExpandAll} />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );})()}

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
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
                <Editor
                  value={faqForm.answer}
                  defaultConfig={createEditorConfig((html: string) => {
                    setFaqForm(f => ({ ...f, answer: html }));
                  })}
                  mode="default"
                />
              </div>
            </div>
            <div className="form-group">
              <label>附件上传（最多5个）</label>
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md"
                onChange={async e => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  if (files.length > 5) { alert('最多上传5个附件'); return; }
                  const formData = new FormData();
                  for (const file of files) formData.append('files', file);
                  try {
                    const res = await fetch(`${API_BASE}/faq/${editingFaq?.id || faqForm.id}/attachments`, {
                      method: 'POST',
                      headers: getAuthHeaders({}),
                      body: formData
                    });
                    const data = await res.json();
                    if (data.success) {
                      setFaqForm(f => ({ ...f, attachments: data.attachments }));
                      alert(`成功上传${data.attachments.length}个附件`);
                    }
                  } catch (err: any) { alert('上传失败：' + err.message); }
                }}
                style={{ marginTop: 8 }}
              />
              {faqForm.attachments && faqForm.attachments.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>已上传附件：</div>
                  {faqForm.attachments.map((att: any) => (
                    <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <span style={{ flex: 1 }}>{att.originalName}（{(att.size / 1024).toFixed(1)} KB）</span>
                      <button className="btn-sm btn-danger" onClick={async () => {
                        if (!confirm('确定删除该附件？')) return;
                        try {
                          const res = await fetch(`${API_BASE}/faq/${editingFaq?.id || faqForm.id}/attachments/${att.id}`, { method: 'DELETE', headers: getAuthHeaders() });
                          if ((await res.json()).success) {
                            setFaqForm(f => ({ ...f, attachments: f.attachments.filter((a: any) => a.id !== att.id) }));
                          }
                        } catch (err: any) { alert('删除失败：' + err.message); }
                      }}>删除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={saveFaq}>保存</button>
              <button className="btn-secondary" onClick={closeFaqModal}>取消</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
