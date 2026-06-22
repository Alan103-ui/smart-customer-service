# Rerank 服务安装指南（for 172.17.6.18）

## 安装步骤（远程桌面操作）

### 步骤 1：打开命令提示符
1. 按 `Win + R`
2. 输入 `cmd`
3. 按 `Enter`

### 步骤 2：进入服务目录
```bash
cd D:\Clow\projects\smart-customer-service\server
```

### 步骤 3：运行一键安装脚本
```bash
install-rerank-service.bat
```

### 步骤 4：等待安装完成
- 脚本会自动安装依赖（约 5-10 分钟）
- 首次运行会自动下载 bge-reranker-v2-m3 模型（约 1.2GB，10-20 分钟）
- **请耐心等待，不要关闭窗口**

### 步骤 5：验证安装
- 打开浏览器，访问：`http://localhost:8000/health`
- 正常响应：`{"status": "ok", "model": "bge-reranker-v2-m3"}`

---

## 安装后配置（可选）

### 开机自启动
1. 按 `Win + R`
2. 输入 `shell:startup`
3. 将 `start-rerank-server.bat` 快捷方式放到打开的文件夹

---

## 故障排查

### 问题 1：端口 8000 被占用
```bash
# 查看占用端口的进程
netstat -ano | findstr :8000

# 结束进程（假设 PID 是 1234）
taskkill /PID 1234 /F
```

### 问题 2：模型下载失败
- 检查网络连接
- 设置代理：`set HTTPS_PROXY=http://proxy:port`
- 手动下载模型放到 `~/.cache/huggingface/hub/`

### 问题 3：CUDA out of memory
- 修改 `rerank-server.py`，添加 `device='cpu'`：
```python
reranker = CrossEncoder('BAAI/bge-reranker-v2-m3', device='cpu')
```

---

## 验证服务是否正常工作

### 方法 1：浏览器访问
```
<INTERNAL_LINK_REMOVED>
```

### 方法 2：命令行测试
```bash
curl http://localhost:8000/health
```

### 方法 3：测试 Rerank API
```bash
curl -X POST http://localhost:8000/rerank ^
  -H "Content-Type: application/json" ^
  -d "{\"query\": \"如何报销\", \"documents\": [\"报销流程...\", \"付款流程...\"]}"
```

---

## 联系支持
如有问题，请联系 **Alan**（项目负责人）。
