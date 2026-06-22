# Rerank 服务安装说明（专业重排序模型）

## 功能说明
使用 **bge-reranker-v2-m3** 专业重排序模型，替代当前的 LLM 重排序（qwen2.5:14b），可将重排序延迟从 **3-5秒降低到 <1秒**。

## 部署步骤（在 172.17.6.18 服务器上）

### 1. 安装 Python 环境
```bash
# 检查 Python 版本（需要 3.8+）
python --version

# 如果没有安装，下载并安装 Python 3.10+
# 下载地址：<ADDRESS_REMOVED>
```

### 2. 安装依赖
```bash
# 安装 Flask + sentence-transformers（约 5-10 分钟）
pip install flask flask-cors sentence-transformers torch -i https://pypi.tuna.tsinghua.edu.cn/simple

# 如果下载慢，使用清华源
pip install flask flask-cors sentence-transformers torch -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 3. 启动服务
```bash
# 进入服务脚本所在目录
cd D:\Clow\projects\smart-customer-service\server

# 启动服务（首次运行会自动下载 bge-reranker-v2-m3 模型，约 1.2GB）
python rerank-server.py
```

### 4. 验证服务
```bash
# 在浏览器或使用 curl 测试
curl <ADDRESS_REMOVED>

# 正常响应：
# {"model": "bge-reranker-v2-m3", "reranker_loaded": true, "status": "ok"}
```

### 5. 测试重排序接口
```bash
curl -X POST <ADDRESS_REMOVED> \
  -H "Content-Type: application/json" \
  -d '{"query": "如何报销", "documents": ["报销流程...", "付款流程..."]}'
```

## 集成到 Node.js 后端

服务启动后，Node.js 后端会自动调用 `http://172.17.6.18:8000/rerank` 接口进行重排序。

如果服务不可用，会自动降级为：
1. LLM 重排序（qwen2.5:14b）
2. 软重排序（关键词重叠 + 答案质量）

## 性能对比

| 方案 | 延迟 | 准确性 | 备注 |
|------|------|--------|------|
| LLM 重排序（qwen2.5:14b） | 3-5秒 | 高 | 当前方案 |
| 专业 Rerank 模型（bge-reranker-v2-m3） | <1秒 | 高 | 推荐方案 |
| 软重排序（关键词） | <0.1秒 | 中 | 降级方案 |

## 故障排查

### 问题1：模型下载失败
**解决方案**：手动下载模型
```bash
# 设置代理（如果需要）
export HTTPS_PROXY=http://proxy:port

# 或者手动下载模型，放到 ~/.cache/huggingface/hub/
```

### 问题2：端口 8000 被占用
**解决方案**：修改 `rerank-server.py` 中的端口号
```python
app.run(host='0.0.0.0', port=8001, debug=False)  # 改为 8001
```

### 问题3：CUDA out of memory
**解决方案**：使用 CPU 模式（修改 `rerank-server.py`）
```python
reranker = CrossEncoder('BAAI/bge-reranker-v2-m3', device='cpu')
```

## 开机自启动（可选）

### Windows 开机自启动
1. 创建启动脚本 `start-rerank-server.bat`（已提供）
2. 将脚本放到 `shell:startup` 文件夹

### Linux 开机自启动（systemd）
创建 `/etc/systemd/system/rerank.service`：
```ini
[Unit]
Description=Rerank Service
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/server
ExecStart=/usr/bin/python rerank-server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

启用服务：
```bash
sudo systemctl enable rerank
sudo systemctl start rerank
```

## 联系支持
如有问题，请联系 Alan（项目负责人）。
