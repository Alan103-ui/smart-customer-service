import { useState, useEffect, useCallback } from 'react';
import { getAuthHeaders } from '../services/api';

// ============================================================
// 全局连接状态横幅（进页自动检测连接）
//  - 挂载即探测后端可达性（公开 /api/health）与模型健康（/api/admin/models/status）
//  - 标签页重新可见 / 每 60s 自动重检，及时暴露「点了没反应」的根因
//  - 仅在有问题时展示醒目横幅，健康时不打扰
// ============================================================

const MODEL_LABELS: Record<string, string> = {
  embedding: '嵌入模型',
  llm: 'LLM 大模型',
  reranker: 'Rerank 重排序',
};

export default function ConnectionBanner() {
  const [backendDown, setBackendDown] = useState<boolean | null>(null); // null=首次检测中
  const [modelDown, setModelDown] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);

    // 1) 后端可达性（公开接口，无鉴权）
    let backendOk = false;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      backendOk = r.ok;
    } catch {
      backendOk = false;
    }
    setBackendDown(!backendOk);

    // 2) 模型健康（需鉴权；后端不可达时跳过，避免噪音）
    let downModels: string[] = [];
    if (backendOk) {
      try {
        const r = await fetch('/api/admin/models/status', { headers: getAuthHeaders() });
        const d = await r.json();
        if (d && d.success && d.health) {
          Object.keys(d.health).forEach((k) => {
            const h = d.health[k];
            if (h && h.available === false) downModels.push(MODEL_LABELS[k] || k);
          });
        }
      } catch {
        // 后端在但鉴权失败等情况：不计入模型异常，避免误报
      }
    }
    setModelDown(downModels);
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 60000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [check]);

  // 首次检测中不渲染，避免闪烁；健康时不打扰
  if (backendDown === null) return null;
  if (!backendDown && modelDown.length === 0) return null;

  const isBackendDown = backendDown === true;

  return (
    <div className={`conn-banner ${isBackendDown ? 'conn-banner-error' : 'conn-banner-warn'}`}>
      <span className="conn-banner-icon">{isBackendDown ? '⛔' : '⚠️'}</span>
      <span className="conn-banner-text">
        {isBackendDown
          ? '无法连接后端服务，功能将不可用。请确认服务已启动、网络可达（可尝试刷新页面）。'
          : `模型服务异常：${modelDown.join('、')} 当前不可达，问答 / 检索可能失败，请检查对应服务。`}
      </span>
      <button className="conn-banner-retry" onClick={check} disabled={checking}>
        {checking ? '检测中...' : '重试'}
      </button>
    </div>
  );
}
