import { useState, useEffect, useCallback } from 'react';
import type { User } from './types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UserForm {
  username: string;
  password: string;
  name: string;
  role: 'admin' | 'user';
}

export default function UserManagement({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>({ username: '', password: '', name: '', role: 'user' });
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` }
      });
      const data = await res.json();
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const token = localStorage.getItem('cs_token');
      const url = editingUser
        ? `${API_BASE}/api/admin/users/${editingUser.id}`
        : `${API_BASE}/api/admin/users`;
      const method = editingUser ? 'PUT' : 'POST';
      const body = editingUser
        ? { name: form.name, role: form.role, isActive: undefined }
        : { username: form.username, password: form.password, name: form.name, role: form.role };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');

      setShowForm(false);
      setEditingUser(null);
      setForm({ username: '', password: '', name: '', role: 'user' });
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleResetPassword = async (user: User) => {
    const newPassword = prompt(`请输入「${user.name}」的新密码（至少4位）：`);
    if (!newPassword || newPassword.length < 4) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重置失败');
      alert('密码已重置');
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`确定删除用户「${user.name}」？`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || '删除失败'); }
      loadUsers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-blue-600 hover:text-blue-800">← 返回</button>
            <h1 className="text-2xl font-bold text-gray-800">用户管理</h1>
          </div>
          <button
            onClick={() => { setEditingUser(null); setForm({ username: '', password: '', name: '', role: 'user' }); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            ＋ 新增用户
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>}

        {/* 用户列表 */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">用户名</th>
                  <th className="px-6 py-3">姓名</th>
                  <th className="px-6 py-3">角色</th>
                  <th className="px-6 py-3">状态</th>
                  <th className="px-6 py-3">最后登录</th>
                  <th className="px-6 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{u.username}</td>
                    <td className="px-6 py-3 text-gray-700">{u.name}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                        {u.role === 'admin' ? '管理员' : '普通用户'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`w-2 h-2 rounded-full inline-block mr-2 ${u.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {u.isActive ? '启用' : '禁用'}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2 text-sm">
                        <button onClick={() => { setEditingUser(u); setForm({ username: u.username, password: '', name: u.name, role: u.role as 'admin' | 'user' }); setShowForm(true); }} className="text-blue-600 hover:underline">编辑</button>
                        <button onClick={() => handleResetPassword(u)} className="text-orange-600 hover:underline">重置密码</button>
                        {u.username !== 'admin' && (
                          <button onClick={() => handleDelete(u)} className="text-red-600 hover:underline">删除</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增/编辑用户弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-4">{editingUser ? '编辑用户' : '新增用户'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!editingUser && (
                <>
                  <div>
                    <label className="block text-sm mb-1">用户名</label>
                    <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required
                      className="w-full px-3 py-2 border rounded-lg" placeholder="登录用户名" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">密码</label>
                    <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required={!editingUser}
                      className="w-full px-3 py-2 border rounded-lg" placeholder="至少4位" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm mb-1">姓名</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-3 py-2 border rounded-lg" placeholder="用户姓名" />
              </div>
              <div>
                <label className="block text-sm mb-1">角色</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              {editingUser && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={editingUser.isActive} onChange={e => setEditingUser({ ...editingUser!, isActive: e.target.checked })} />
                  <span className="text-sm">启用</span>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded-lg">{editingUser ? '保存' : '创建'}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditingUser(null); }} className="flex-1 py-2 border rounded-lg">取消</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
