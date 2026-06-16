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

// API 服务类
class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // 发送消息
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取对话列表
  async getConversations(): Promise<Conversation[]> {
    const response = await fetch(`${this.baseUrl}/api/conversations`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取单个对话
  async getConversation(sessionId: string): Promise<{ messages: Message[] }> {
    const response = await fetch(`${this.baseUrl}/api/conversations/${sessionId}`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 获取 FAQ 列表
  async getFAQ(): Promise<FAQItem[]> {
    const response = await fetch(`${this.baseUrl}/api/faq`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 创建 FAQ
  async createFAQ(faq: FAQItem): Promise<FAQItem> {
    const response = await fetch(`${this.baseUrl}/api/faq`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(faq),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 更新 FAQ
  async updateFAQ(id: number, faq: FAQItem): Promise<FAQItem> {
    const response = await fetch(`${this.baseUrl}/api/faq/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(faq),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // 删除 FAQ
  async deleteFAQ(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/faq/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
  }

  // 获取统计信息
  async getStats(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/stats`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }
}

// 导出单例
export const apiService = new ApiService(API_BASE_URL);
