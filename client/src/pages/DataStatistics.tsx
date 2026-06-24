import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

// ==================== 类型定义 ====================
interface DataStatisticsProps {
  onBack?: () => void;
}

interface TrendData {
  date?: string;
  week?: string;
  month?: string;
  count: number;
  resolved: number;
}

interface CategoryStat {
  id: string;
  name: string;
  faqCount: number;
  conversationCount: number;
}

interface KnowledgeBaseStat {
  id: string;
  name: string;
  faqCount: number;
}

interface RecentConversation {
  session_id: string;
  intent: string | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
  messageCount: number;
}

interface StatsOverview {
  totalFAQ: number;
  totalCategories: number;
  totalKnowledgeBases: number;
  totalConversations: number;
  resolvedConversations: number;
  resolutionRate: number;
  vectorStats: any;
}

interface StatsResponse {
  overview: StatsOverview;
  trends: {
    daily: TrendData[];
    weekly: TrendData[];
    monthly: TrendData[];
  };
  categoryStats: CategoryStat[];
  knowledgeBaseStats: KnowledgeBaseStat[];
  recentConversations: RecentConversation[];
}

// ==================== 主组件 ====================
export default function DataStatistics({ onBack }: DataStatisticsProps) {
  const [loading, setLoading] = useState(true);
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [trendType, setTrendType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [categorySortField, setCategorySortField] = useState<'name' | 'faqCount' | 'conversationCount'>('conversationCount');
  const [categorySortOrder, setCategorySortOrder] = useState<'asc' | 'desc'>('desc');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // ==================== 数据获取 ====================
  const API_BASE = '/api/admin';

  const fetchStats = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('cs_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/stats`, { headers });
      if (res.status === 401) {
        localStorage.removeItem('cs_token');
        localStorage.removeItem('cs_user');
        window.location.reload();
        return;
      }
      const data = await res.json();
      setStatsData(data);
    } catch (err) {
      console.error('获取统计数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const timer = setInterval(() => { fetchStats(); }, 30000); // 30秒刷新一次
    return () => clearInterval(timer);
  }, []);

  // ==================== 分类数据排序和筛选 ====================
  const filteredAndSortedCategories = useMemo(() => {
    if (!statsData) return [];
    let list = statsData.categoryStats;
    
    // 筛选
    if (categoryFilter) {
      list = list.filter(c => c.name.toLowerCase().includes(categoryFilter.toLowerCase()));
    }
    
    // 排序
    list = [...list].sort((a, b) => {
      const fieldA = a[categorySortField];
      const fieldB = b[categorySortField];
      if (typeof fieldA === 'string' && typeof fieldB === 'string') {
        return categorySortOrder === 'asc' 
          ? fieldA.localeCompare(fieldB, 'zh-CN')
          : fieldB.localeCompare(fieldA, 'zh-CN');
      }
      return categorySortOrder === 'asc' 
        ? (fieldA as number) - (fieldB as number)
        : (fieldB as number) - (fieldA as number);
    });
    
    return list;
  }, [statsData, categorySortField, categorySortOrder, categoryFilter]);

  // ==================== 数据导出 ====================
  const exportData = (type: 'overview' | 'categories' | 'trends' | 'conversations') => {
    if (!statsData) return;
    
    let csvContent = '';
    let filename = '';
    
    switch (type) {
      case 'overview':
        csvContent = '指标,数值\n';
        csvContent += `FAQ总数,${statsData.overview.totalFAQ}\n`;
        csvContent += `分类总数,${statsData.overview.totalCategories}\n`;
        csvContent += `知识库总数,${statsData.overview.totalKnowledgeBases}\n`;
        csvContent += `对话总数,${statsData.overview.totalConversations}\n`;
        csvContent += `已解决对话,${statsData.overview.resolvedConversations}\n`;
        csvContent += `解决率,${statsData.overview.resolutionRate}%\n`;
        filename = '概览数据.csv';
        break;
        
      case 'categories':
        csvContent = '分类ID,分类名称,FAQ数量,对话数量\n';
        filteredAndSortedCategories.forEach(cat => {
          csvContent += `${cat.id},${cat.name},${cat.faqCount},${cat.conversationCount}\n`;
        });
        filename = '分类统计.csv';
        break;
        
      case 'trends':
        csvContent = '时间,对话数量,已解决数量\n';
        const trendData = statsData.trends[trendType];
        trendData.forEach(item => {
          const timeLabel = item.date || item.week || item.month || '';
          csvContent += `${timeLabel},${item.count},${item.resolved}\n`;
        });
        filename = `${trendType}趋势数据.csv`;
        break;
        
      case 'conversations':
        csvContent = '会话ID,意图,是否解决,消息数量,创建时间,更新时间\n';
        statsData.recentConversations.forEach(conv => {
          csvContent += `${conv.session_id},${conv.intent || '无'},${conv.resolved ? '是' : '否'},${conv.messageCount},${conv.created_at},${conv.updated_at}\n`;
        });
        filename = '最近对话.csv';
        break;
    }
    
    // 添加BOM头以支持中文
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  // ==================== 渲染辅助函数 ====================
  const renderTrendChart = () => {
    if (!statsData) return null;
    
    const data = statsData.trends[trendType];
    const xAxisKey = trendType === 'daily' ? 'date' : trendType === 'weekly' ? 'week' : 'month';
    
    return (
      <div className="chart-container">
        <div className="chart-header">
          <h3>对话趋势（{trendType === 'daily' ? '按日' : trendType === 'weekly' ? '按周' : '按月'}）</h3>
          <div className="chart-actions">
            <button 
              className={trendType === 'daily' ? 'active' : ''} 
              onClick={() => setTrendType('daily')}
            >
              按日
            </button>
            <button 
              className={trendType === 'weekly' ? 'active' : ''} 
              onClick={() => setTrendType('weekly')}
            >
              按周
            </button>
            <button 
              className={trendType === 'monthly' ? 'active' : ''} 
              onClick={() => setTrendType('monthly')}
            >
              按月
            </button>
            <button onClick={() => exportData('trends')} className="export-btn">
              导出数据
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="count" stroke="#8884d8" name="对话数量" />
            <Line type="monotone" dataKey="resolved" stroke="#82ca9d" name="已解决" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderCategoryTable = () => {
    if (!statsData) return null;
    
    return (
      <div className="table-container">
        <div className="table-header">
          <h3>分类数据统计</h3>
          <div className="table-actions">
            <input
              type="text"
              placeholder="筛选分类名称..."
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="filter-input"
            />
            <button onClick={() => exportData('categories')} className="export-btn">
              导出数据
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => { setCategorySortField('name'); setCategorySortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                分类名称 {categorySortField === 'name' && (categorySortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => { setCategorySortField('faqCount'); setCategorySortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                FAQ数量 {categorySortField === 'faqCount' && (categorySortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => { setCategorySortField('conversationCount'); setCategorySortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                对话数量 {categorySortField === 'conversationCount' && (categorySortOrder === 'asc' ? '↑' : '↓')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedCategories.map(cat => (
              <tr key={cat.id}>
                <td>{cat.name}</td>
                <td>{cat.faqCount}</td>
                <td>{cat.conversationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ==================== 主渲染 ====================
  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  if (!statsData) {
    return <div className="error">获取数据失败</div>;
  }

  const { overview, recentConversations, knowledgeBaseStats } = statsData;

  return (
    <div className="data-statistics">
      <div className="page-header">
        <h2>数据统计</h2>
        <div className="header-actions">
          <button onClick={() => exportData('overview')} className="export-btn">
            导出概览
          </button>
          <button onClick={() => exportData('conversations')} className="export-btn">
            导出对话
          </button>
          {onBack && <button onClick={onBack} className="back-btn">返回</button>}
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="overview-cards">
        <div className="stat-card blue">
          <div className="stat-number">{overview.totalConversations}</div>
          <div className="stat-label">对话总数</div>
        </div>
        <div className="stat-card green">
          <div className="stat-number">{overview.resolvedConversations}</div>
          <div className="stat-label">已解决</div>
        </div>
        <div className="stat-card orange">
          <div className="stat-number">{overview.resolutionRate}<small>%</small></div>
          <div className="stat-label">解决率</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-number">{overview.totalFAQ}</div>
          <div className="stat-label">FAQ总数</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-number">{overview.totalCategories}</div>
          <div className="stat-label">分类总数</div>
        </div>
        <div className="stat-card navy">
          <div className="stat-number">{overview.totalKnowledgeBases}</div>
          <div className="stat-label">知识库总数</div>
        </div>
      </div>

      {/* 趋势图表 */}
      {renderTrendChart()}

      {/* 分类统计表格 */}
      {renderCategoryTable()}

      {/* 知识库统计 */}
      <div className="section">
        <h3>知识库统计</h3>
        <div className="kb-stats">
          {knowledgeBaseStats.map(kb => (
            <div key={kb.id} className="kb-stat-card">
              <div className="kb-name">{kb.name}</div>
              <div className="kb-faq-count">FAQ: {kb.faqCount}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 最近对话列表 */}
      <div className="section">
        <h3>最近对话（最近20条）</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>会话ID</th>
              <th>意图</th>
              <th>是否解决</th>
              <th>消息数</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {recentConversations.map(conv => (
              <tr key={conv.session_id}>
                <td>{conv.session_id.slice(0, 20)}...</td>
                <td>{conv.intent || '无'}</td>
                <td>{conv.resolved ? '✅' : '⏳'}</td>
                <td>{conv.messageCount}</td>
                <td>{new Date(conv.created_at).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}