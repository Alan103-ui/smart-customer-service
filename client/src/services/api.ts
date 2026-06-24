/**
 * 广康集团 AI 智能知识助手 - API 服务
 * 处理所有后端 API 调用
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// 类型定义
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: any[];
}

export interface FAQItem {
  id?: number;
  question: string;
  answer: string;
  category?: string;
}

export interface Conversation {
  session_id: string;
  title?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface SendMessageRequest {
  message: string;
  session_id: string;
}

export interface SendMessageResponse {
  response: string;
  sources?: any[];
  intent?: string;
}

// 获取认证请求头
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = localStorage.getItem('cs_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// API 服务类
class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // 发送消息（通过 WebSocket，此方法保留兼容）
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取对话列表（管理后台）
  async getConversations(): Promise<Conversation[]> {
    const response = await fetch(`${this.baseUrl}/api/admin/conversations`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取单个对话（管理后台）
  async getConversation(sessionId: string): Promise<{ messages: Message[] }> {
    const response = await fetch(`${this.baseUrl}/api/admin/conversations/${sessionId}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取 FAQ 列表（管理后台）
  async getFAQ(): Promise<FAQItem[]> {
    const response = await fetch(`${this.baseUrl}/api/admin/faq`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const result = await response.json();
    return result.data || result; // 兼容 {success, data} 格式和纯数组格式
  }

  // 创建 FAQ（管理后台）
  async createFAQ(faq: FAQItem): Promise<FAQItem> {
    const response = await fetch(`${this.baseUrl}/api/admin/faq`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(faq),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 更新 FAQ（管理后台）
  async updateFAQ(id: number | string, faq: FAQItem): Promise<FAQItem> {
    const response = await fetch(`${this.baseUrl}/api/admin/faq/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(faq),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 删除 FAQ（管理后台）
  async deleteFAQ(id: number | string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/admin/faq/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
  }

  // 获取统计信息（管理后台）
  async getStats(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/stats`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }
}

// 导出单例
export const apiService = new ApiService(API_BASE_URL);
