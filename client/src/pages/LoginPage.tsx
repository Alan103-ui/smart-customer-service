import React, { useState } from 'react';
import { useSoftwareInfo, useAnnouncement, ANNOUNCEMENT_COLORS } from '../services/softwareInfo';

interface LoginPageProps {
  onLogin: (user: { id: string; username: string; name: string; role: string }) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function LoginPage({ onLogin }: LoginPageProps) {
  const sw = useSoftwareInfo();
  const ann = useAnnouncement();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 如果已登录，自动回调 onLogin（由 App.tsx 处理跳转）
  React.useEffect(() => {
    const token = localStorage.getItem('cs_token');
    if (!token) return;
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(u => { if (u.id) onLogin(u); })
      .catch(() => localStorage.removeItem('cs_token'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登录失败');
        return;
      }
      // 保存 token 和用户信息
      localStorage.setItem('cs_token', data.token);
      localStorage.setItem('cs_user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err: any) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 检查URL中是否有SSO回调的token（SSO登录成功后后端重定向带回token）
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      // 移除URL中的token参数（安全考虑）
      window.history.replaceState({}, document.title, window.location.pathname);

      // 用token获取用户信息并自动登录
      fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(u => {
          if (u.id) {
            localStorage.setItem('cs_token', token);
            localStorage.setItem('cs_user', JSON.stringify(u));
            onLogin(u);
          } else {
            setError('SSO登录失败：无法获取用户信息');
          }
        })
        .catch(() => {
          setError('SSO登录失败：网络错误');
        });
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-2xl shadow-lg">
        {/* 系统公告 Banner */}
        {ann.enabled && (ann.title || ann.content) && (
          <div style={{ background: ANNOUNCEMENT_COLORS[ann.level]?.bg || '#e6f7ff', border: '1px solid ' + (ANNOUNCEMENT_COLORS[ann.level]?.border || '#91d5ff'), color: ANNOUNCEMENT_COLORS[ann.level]?.color || '#0958d9', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
            {ann.title && <div style={{ fontWeight: 600, marginBottom: ann.content ? 4 : 0 }}>{ann.title}</div>}
            {ann.content && <div style={{ whiteSpace: 'pre-wrap' }}>{ann.content}</div>}
          </div>
        )}
        {/* Logo / 标题 */}
        <div className="text-center">
          {sw.loginImage ? (
            <img
              src={sw.loginImage}
              alt={sw.softwareName}
              style={{ maxHeight: 96, maxWidth: '100%', objectFit: 'contain', margin: '0 auto 8px' }}
            />
          ) : (
            <div className="text-4xl mb-2">🤖</div>
          )}
          <h1 className="text-2xl font-bold text-gray-800">{sw.softwareName || '智能客服系统'}</h1>
          <p className="mt-1 text-sm text-gray-500">登录后使用 AI 智能问答</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              ❌ {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoFocus
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {/* 底部提示 */}
        <p className="text-center text-xs text-gray-400">
          仅支持企业内网访问 · 请联系管理员获取账号
        </p>
      </div>
    </div>
  );
}
