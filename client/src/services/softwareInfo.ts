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
