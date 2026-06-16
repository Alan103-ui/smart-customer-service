/**
 * 广康集团 AI 智能知识助手 - 知识库管理组件
 * 管理所有知识库（Knowledge Base）
 */

import React, { useState, useEffect } from 'react';
import './KnowledgeBaseManager.css';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
  isActive: boolean;
}

const KnowledgeBaseManager: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [kbList, setKbList] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  const loadKnowledgeBases = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3001/api/admin/knowledge-bases');
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      const data = await response.json();
      setKbList(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || '加载知识库失败');
      console.error('加载知识库失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`http://localhost:3001/api/admin/knowledge-bases/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !currentStatus }),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      
      alert(`知识库 ${!currentStatus ? '启用' : '禁用'}成功`);
      loadKnowledgeBases();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个知识库吗？此操作不可恢复！')) {
      return;
    }
    
    try {
      const response = await fetch(`http://localhost:3001/api/admin/knowledge-bases/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      
      alert('知识库删除成功');
      loadKnowledgeBases();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="kb-manager">
        <div className="kb-manager__header">
          <button className="btn btn--secondary" onClick={onBack}>← 返回</button>
          <h2>知识库管理</h2>
        </div>
        <div className="kb-manager__loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kb-manager">
        <div className="kb-manager__header">
          <button className="btn btn--secondary" onClick={onBack}>← 返回</button>
          <h2>知识库管理</h2>
        </div>
        <div className="kb-manager__error">
          <p>❌ {error}</p>
          <button className="btn btn--primary" onClick={loadKnowledgeBases}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="kb-manager">
      <div className="kb-manager__header">
        <button className="btn btn--secondary" onClick={onBack}>← 返回</button>
        <h2>知识库管理</h2>
        <button className="btn btn--primary">+ 新建知识库</button>
      </div>

      <div className="kb-manager__content">
        {kbList.length === 0 ? (
          <div className="kb-manager__empty">
            <p>📚 暂无知识库，点击"新建知识库"创建</p>
          </div>
        ) : (
          <div className="kb-list">
            {kbList.map(kb => (
              <div key={kb.id} className={`kb-card ${!kb.isActive ? 'kb-card--inactive' : ''}`}>
                <div className="kb-card__header">
                  <h3 className="kb-card__title">
                    {kb.isDefault && <span className="kb-badge">默认</span>}
                    {!kb.isActive && <span className="kb-badge kb-badge--inactive">已禁用</span>}
                    {kb.name}
                  </h3>
                  <span className="kb-card__date">
                    创建: {new Date(kb.createdAt).toLocaleDateString()}
                  </span>
                </div>
                
                <div className="kb-card__body">
                  <p className="kb-card__desc">{kb.description}</p>
                  <p className="kb-card__meta">
                    更新: {new Date(kb.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="kb-card__footer">
                  <button 
                    className={`btn btn--small ${kb.isActive ? 'btn--warning' : 'btn--success'}`}
                    onClick={() => handleToggleActive(kb.id, kb.isActive)}
                  >
                    {kb.isActive ? '禁用' : '启用'}
                  </button>
                  <button className="btn btn--small btn--secondary">
                    编辑
                  </button>
                  {!kb.isDefault && (
                    <button 
                      className="btn btn--small btn--danger"
                      onClick={() => handleDelete(kb.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeBaseManager;
