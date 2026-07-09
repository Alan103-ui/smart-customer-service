import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ChatWindow from './components/ChatWindow';
import AdminDashboard from './pages/AdminDashboard';
import LoginPage from './pages/LoginPage';
import type { Message, WebSocketMessage, Candidate } from './types';
import { useSoftwareInfo } from './services/softwareInfo';
import './App.css';

// ============================================================
// 用户信息类型
// ============================================================
interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: string;
}

// ============================================================
// 认证包装器 - 处理登录/登出，不包含任何业务逻辑 hooks
// ============================================================
function AuthWrapper() {
  const [user, setUser] = useState<UserInfo | null>(() => {
    try {
      const saved = localStorage.getItem('cs_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cs_token');
    if (!token) {
      setAuthLoading(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(u => {
        setUser(u);
        localStorage.setItem('cs_user', JSON.stringify(u));
      })
      .catch(() => {
        localStorage.removeItem('cs_token');
        localStorage.removeItem('cs_user');
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = useCallback((u: UserInfo) => {
    setUser(u);
    localStorage.setItem('cs_user', JSON.stringify(u));
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('cs_token');
    localStorage.removeItem('cs_user');
    setUser(null);
  }, []);

  // 加载中
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <p className="text-gray-500">正在加载...</p>
        </div>
      </div>
    );
  }

  // 未登录 → 显示登录页
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 已登录 → 显示主界面（独立组件，避免 hooks 顺序问题）
  return <MainApp user={user} onLogout={handleLogout} />;
}

// ============================================================
// 主应用界面 - 所有业务逻辑都在这里，无 early return
// ============================================================
interface MainAppProps {
  user: UserInfo;
  onLogout: () => void;
}

function MainApp({ user, onLogout }: MainAppProps) {
  // =========== 所有状态声明（必须在最顶部）============
  const [sessionId, setSessionId] = useState<string>(() => {
    return localStorage.getItem('cs_session_id') || uuidv4();
  });
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentIntent, setCurrentIntent] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState<boolean>(() => {
    return window.location.pathname === '/admin';
  });
  const [showMyConversations, setShowMyConversations] = useState<boolean>(false);
  const [myConversations, setMyConversations] = useState<any[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState<boolean>(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('cs_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const wsRef = useRef<WebSocket | null>(null);

  // 软件信息（可编辑品牌/名称），后端实时读取
  const sw = useSoftwareInfo();

  // =========== 所有 effects ===========
  useEffect(() => { localStorage.setItem('cs_session_id', sessionId); }, [sessionId]);

  useEffect(() => {
    localStorage.setItem('cs_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // 同步 showAdmin 到 URL
  useEffect(() => {
    const currentPath = window.location.pathname;
    if (showAdmin && currentPath !== '/admin') {
      window.history.pushState(null, '', '/admin');
    } else if (!showAdmin && currentPath === '/admin') {
      window.history.pushState(null, '', '/');
    }
  }, [showAdmin]);

  useEffect(() => {
    const handlePopState = () => { setShowAdmin(window.location.pathname === '/admin'); };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 获取分类列表
  useEffect(() => {
    fetch('/api/categories', {
      headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
    })
      .then(res => res.json())
      .then(data => {
        const primaryCategories = data.filter((c: any) => !c.parentId);
        setCategories(primaryCategories.map((c: any) => c.name));
      })
      .catch(err => console.error('获取分类失败', err));
  }, []);

  // 加载用户的对话列表
  useEffect(() => {
    if (!showMyConversations) return;
    
    setConversationsLoading(true);
    fetch('/api/user/conversations', {
      headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setMyConversations(data.data || []);
        }
        setConversationsLoading(false);
      })
      .catch(err => {
        console.error('获取对话列表失败', err);
        setConversationsLoading(false);
      });
  }, [showMyConversations]);

  // =========== WebSocket 连接 ===========
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log('[WS] 正在连接:', wsUrl);

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('[WS] 连接成功');
      setConnected(true);
      const token = localStorage.getItem('cs_token');
      socket.send(JSON.stringify({
        type: 'init',
        sessionId,
        category: selectedCategory === '全部' ? null : selectedCategory,
        token,
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) { console.error('[WS] 消息解析失败:', e); }
    };

    socket.onclose = () => {
      console.log('[WS] 连接关闭');
      setConnected(false);
      if (wsRef.current === socket) wsRef.current = null;
    };
    socket.onerror = (e) => { console.error('[WS] 连接错误:', e); };

    return () => { socket.close(); wsRef.current = null; };
  }, [sessionId, selectedCategory]);

  // =========== 回调函数 ===========
  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  const handleMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case 'init':
        if (msg.sessionId) setSessionId(msg.sessionId);
        break;
      case 'error':
        alert(msg.message || '发生错误');
        // 如果是认证错误，跳转到登录页面
        if (msg.message && (msg.message.includes('登录') || msg.message.includes('请先'))) {
          localStorage.removeItem('cs_token');
          localStorage.removeItem('cs_user');
          window.location.reload();
        }
        break;
      case 'history':
        if (msg.messages) setMessages(msg.messages);
        break;
      case 'typing':
        setIsTyping(!!msg.status);
        break;
      case 'intent':
        setCurrentIntent(msg.intent || null);
        break;
      case 'candidates':
        if (msg.candidates && msg.candidates.length > 0) {
          setCandidates(msg.candidates);
          setIsTyping(false);
        }
        break;
      case 'message':
        if (msg.content) {
          const newMsg: Message = {
            role: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp || new Date().toISOString(),
            intent: msg.intent,
            confidence: msg.confidence,
            fallback: msg.fallback,
          };
          setMessages(prev => [...prev, newMsg]);
          setCandidates([]);
        }
        setIsTyping(false);
        break;
    }
  }, []);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] 连接未就绪');
      return;
    }
    const userMsg: Message = { role: 'user', content, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setCandidates([]);
    ws.send(JSON.stringify({ type: 'message', content }));
  }, []);

  const sendCandidateSelect = useCallback((candidateId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'candidate_select', candidateId }));
    setCandidates([]);
    setIsTyping(true);
  }, []);

  // =========== 渲染 ===========
  if (showAdmin) {
    if (user.role !== 'admin') {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">无权限访问</h2>
            <p className="text-gray-500 mb-4">仅管理员可访问管理后台</p>
            <button onClick={() => setShowAdmin(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
              返回聊天
            </button>
          </div>
        </div>
      );
    }
    return <AdminDashboard onBack={() => setShowAdmin(false)} user={user} onLogout={onLogout} />;
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <div className="header-left">
          <div className="logo">🤖</div>
          <div>
            <h1>{sw.softwareName}</h1>
            <span className={`status-dot ${connected ? 'online' : 'offline'}`}>
              {connected ? '在线' : '连接中...'}
            </span>
          </div>
        </div>
        <div className="header-right">
          {/* 用户信息 */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              {user.name?.charAt(0) || user.username.charAt(0)}
            </span>
            <span>{user.name || user.username}</span>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-400 hover:text-red-500 transition" title="退出登录">
            退出
          </button>
          <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'light' ? '深色模式' : '浅色模式'}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button className="history-btn" onClick={() => setShowMyConversations(true)}>
            📜 我的对话
          </button>
          {user.role === 'admin' && (
            <button className="admin-btn" onClick={() => setShowAdmin(true)}>
              📊 管理后台
            </button>
          )}
        </div>
      </div>

      <ChatWindow
        messages={messages}
        isTyping={isTyping}
        onSendMessage={sendMessage}
        currentIntent={currentIntent}
        candidates={candidates}
        onSelectCandidate={sendCandidateSelect}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        currentUser={{ name: user.name, username: user.username }}
      />

      {/* 我的对话模态框 */}
      {showMyConversations && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>我的对话记录</h2>
              <button onClick={() => setShowMyConversations(false)} style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            
            {conversationsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
            ) : myConversations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>暂无对话记录</div>
            ) : (
              <div>
                {myConversations.map((conv) => (
                  <div
                    key={conv.session_id}
                    onClick={async () => {
                      // 加载该对话的消息
                      try {
                        const res = await fetch(`/api/chat/history`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${localStorage.getItem('cs_token')}`
                          },
                          body: JSON.stringify({ sessionId: conv.session_id, limit: 100 })
                        });
                        const data = await res.json();
                        if (data.success) {
                          // 加载历史消息到当前会话
                          setMessages(data.history.reverse());
                          setSessionId(conv.session_id);
                          setShowMyConversations(false);
                        }
                      } catch (err) {
                        console.error('加载对话失败', err);
                      }
                    }}
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      hover: { backgroundColor: '#f5f5f5' }
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      对话 {conv.session_id.slice(0, 8)}...
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      消息数: {conv.messageCount} | 最后更新: {new Date(conv.updated_at).toLocaleString()}
                    </div>
                    {conv.lastMessage && (
                      <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                        最后消息: {conv.lastMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 导出 AuthWrapper 作为根组件 ============
export default function App() {
  return <AuthWrapper />;
}
