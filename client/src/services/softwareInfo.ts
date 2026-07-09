import { useState, useEffect } from 'react';

// 软件信息（可编辑品牌/名称/欢迎语），由后端 /api/public/software-info 提供
export interface SoftwareInfo {
  companyName: string;
  softwareName: string;
  assistantName: string;
  knowledgeBaseName: string;
  welcomeMessage: string;
  loginImage: string;   // 登录界面图片 URL
  chatImage: string;    // 聊天界面头像/Logo 图片 URL
}

const DEFAULT_SOFTWARE_INFO: SoftwareInfo = {
  companyName: '广康集团',
  softwareName: '广康生化',
  assistantName: '小智',
  knowledgeBaseName: '广康集团知识库',
  welcomeMessage: '您好！我是广康集团AI助手，很高兴为您服务😊',
  loginImage: '',
  chatImage: '',
};

let cache: SoftwareInfo | null = null;

export function getDefaultSoftwareInfo(): SoftwareInfo {
  return { ...DEFAULT_SOFTWARE_INFO };
}

export async function fetchSoftwareInfo(): Promise<SoftwareInfo> {
  try {
    const res = await fetch('/api/public/software-info');
    if (!res.ok) return { ...DEFAULT_SOFTWARE_INFO };
    const data = await res.json();
    if (data && data.success && data.data) {
      cache = { ...DEFAULT_SOFTWARE_INFO, ...data.data };
      return cache;
    }
    return { ...DEFAULT_SOFTWARE_INFO };
  } catch (e) {
    return { ...DEFAULT_SOFTWARE_INFO };
  }
}

// 组件内使用：挂载时拉取一次（带缓存，不重复请求）
export function useSoftwareInfo(): SoftwareInfo {
  const [info, setInfo] = useState<SoftwareInfo>(cache || DEFAULT_SOFTWARE_INFO);
  useEffect(() => {
    let alive = true;
    fetchSoftwareInfo().then(d => { if (alive) setInfo(d); });
    return () => { alive = false; };
  }, []);
  return info;
}

// ============ 系统公告 ============
export interface Announcement {
  enabled: boolean;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'success' | 'error';
  updatedAt: string | null;
  updatedBy: string;
}

const DEFAULT_ANNOUNCEMENT: Announcement = { enabled: false, title: '', content: '', level: 'info', updatedAt: null, updatedBy: '' };

export async function fetchAnnouncement(): Promise<Announcement> {
  try {
    const res = await fetch('/api/public/announcement');
    if (!res.ok) return { ...DEFAULT_ANNOUNCEMENT };
    const data = await res.json();
    if (data && data.success && data.data) return { ...DEFAULT_ANNOUNCEMENT, ...data.data };
    return { ...DEFAULT_ANNOUNCEMENT };
  } catch (e) {
    return { ...DEFAULT_ANNOUNCEMENT };
  }
}

export function useAnnouncement(): Announcement {
  const [ann, setAnn] = useState<Announcement>(DEFAULT_ANNOUNCEMENT);
  useEffect(() => {
    let alive = true;
    fetchAnnouncement().then(d => { if (alive) setAnn(d); });
    return () => { alive = false; };
  }, []);
  return ann;
}

// 公告条颜色（按级别）
export const ANNOUNCEMENT_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  info: { bg: '#e6f7ff', border: '#91d5ff', color: '#0958d9' },
  warning: { bg: '#fffbe6', border: '#ffe58f', color: '#ad6800' },
  success: { bg: '#f6ffed', border: '#b7eb8f', color: '#389e0d' },
  error: { bg: '#fff2f0', border: '#ffccc7', color: '#cf1322' },
};
