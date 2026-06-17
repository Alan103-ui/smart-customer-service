import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ChatWindow from './components/ChatWindow';
import AdminDashboard from './pages/AdminDashboard';
import type { Message, WebSocketMessage, Candidate } from './types';
import './App.css';

function App() {
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
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('cs_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem('cs_session_id', sessionId);
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem('cs_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // 同步 showAdmin 状态到 URL
  useEffect(() => {
    const currentPath = window.location.pathname;
    if (showAdmin && currentPath !== '/admin') {
      window.history.pushState(null, '', '/admin');
    } else if (!showAdmin && currentPath === '/admin') {
      window.history.pushState(null, '', '/');
    }
  }, [showAdmin]);

  // 监听浏览器前进/后退按钮
  useEffect(() => {
    const handlePopState = () => {
      setShowAdmin(window.location.pathname === '/admin');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    localStorage.setItem('cs_session_id', sessionId);
  }, [sessionId]);

  // 获取分类列表（聊天页面只显示一级分类）
  useEffect(() => {
    fetch('http://localhost:3001/api/admin/categories')
      .then(res => res.json())
      .then(data => {
        // 只保留一级分类（parentId 为 null 的）
        const primaryCategories = data.filter((c: any) => !c.parentId);
        setCategories(primaryCategories.map((c: any) => c.name));
      })
      .catch(err => console.error('获取分类失败', err));
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log('[WS] 正在连接:', wsUrl);

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('[WS] 连接成功');
      setConnected(true);
      socket.send(JSON.stringify({ type: 'init', sessionId, category: selectedCategory === '全部' ? null : selectedCategory }));
    };

    socket.onmessage = (event) => {
      console.log('[WS] 收到消息:', event.data);
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      } catch (e) {
        console.error('[WS] 消息解析失败:', e);
      }
    };

    socket.onclose = () => {
      console.log('[WS] 连接关闭');
      setConnected(false);
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };

    socket.onerror = (e) => {
      console.error('[WS] 连接错误:', e);
    };

    return () => {
      console.log('[WS] 关闭连接');
      socket.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const handleWebSocketMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case 'init':
        if (msg.sessionId) setSessionId(msg.sessionId);
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
            fallback: msg.fallback
          };
          setMessages(prev => [...prev, newMsg]);
          // 收到正式回复后清除候选列表
          setCandidates([]);
        }
        setIsTyping(false);
        break;
    }
  }, []);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] 连接未就绪，无法发送消息');
      return;
    }

    const userMsg: Message = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMsg]);
    setCandidates([]); // 发送新消息时清除候选

    console.log('[WS] 发送消息:', content);
    ws.send(JSON.stringify({ type: 'message', content }));
  }, []);

  const sendCandidateSelect = useCallback((candidateId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'candidate_select', candidateId }));
    setCandidates([]);
    setIsTyping(true);
  }, []);

  if (showAdmin) {
    return (
      <AdminDashboard onBack={() => setShowAdmin(false)} />
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <div className="header-left">
          <div className="logo">🤖</div>
          <div>
            <h1>广康集团AI助手</h1>
            <span className={`status-dot ${connected ? 'online' : 'offline'}`}>
              {connected ? '在线' : '连接中...'}
            </span>
          </div>
        </div>
        <div className="header-right">
          <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button className="admin-btn" onClick={() => setShowAdmin(true)}>
            📊 管理后台
          </button>
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
      />
    </div>
  );
}

export default App;
