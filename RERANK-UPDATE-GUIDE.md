# Rerank 服务更新指南

## 📋 更新步骤（在 172.17.6.18 服务器上操作）

### 方法一：直接替换文件（推荐）

1. **远程桌面连接到 172.17.6.18**

2. **停止当前运行的 Rerank 服务**
   - 在运行 `rerank-server.py` 的命令行窗口按 `Ctrl+C` 停止服务

3. **备份旧文件**（可选但推荐）
   ```bash
   cd D:\Clow\projects\smart-customer-service\server
   copy rerank-server.py rerank-server.py.backup
   ```

4. **替换文件**
   - 通过共享文件夹或远程桌面复制功能
   - 将本地（你的电脑）的 `rerank-server.py` 复制到服务器的相同位置
   - 文件路径：`D:\Clow\projects\smart-customer-service\server\rerank-server.py`

5. **重启 Rerank 服务**
   ```bash
   cd D:\Clow\projects\smart-customer-service\server
   python rerank-server.py
   ```

6. **验证服务正常**
   - 服务启动后应显示：
     ```
     正在加载 bge-reranker-v2-m3 模型...
     ✅ 模型加载成功
      * Running on all addresses (0.0.0.0)
      * Running on http://127.0.0.1:8000
     ```
   - 在服务器浏览器访问 `http://localhost:8000/health`
   - 应返回：`{"model":"bge-reranker-v2-m3","reranker_loaded":true,"status":"ok"}`

---

### 方法二：手动编辑文件（如果无法复制文件）

如果无法通过远程桌面复制文件，可以手动编辑：

1. **停止当前运行的 Rerank 服务**
   - 在运行 `rerank-server.py` 的命令行窗口按 `Ctrl+C`

2. **用记事本打开 `rerank-server.py`**
   ```bash
   cd D:\Clow\projects\smart-customer-service\server
   notepad rerank-server.py
   ```

3. **找到第 58 行左右的代码**
   - 查找：`try:`
   - 在 `try:` 的下一行添加：`start = time.time()  # 记录开始时间`

4. **修改前（约第 58-60 行）：**
   ```python
   try:
       data = request.get_json()
   ```

5. **修改后：**
   ```python
   try:
       start = time.time()  # 记录开始时间
       data = request.get_json()
   ```

6. **保存文件并重启 Rerank 服务**
   ```bash
   python rerank-server.py
   ```

---

## ✅ 验证更新成功

### 1. 健康检查
在服务器上运行：
```bash
curl http://localhost:8000/health
```
应返回：`{"model":"bge-reranker-v2-m3","reranker_loaded":true,"status":"ok"}`

### 2. 测试 Rerank API
在服务器上运行：
```bash
curl -X POST http://localhost:8000/rerank ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"如何报销\",\"documents\":[\"报销流程说明\",\"付款申请流程\",\"费用报销管理制度\"]}"
```
应返回 JSON 结果，包含 `results` 数组，按相关性排序。

### 3. 从你的电脑测试
在你的电脑（不是服务器）上运行：
```bash
curl http://172.17.6.18:8000/health
```
应返回：`{"model":"bge-reranker-v2-m3","reranker_loaded":true,"status":"ok"}`

---

## 🔧 故障排查

### 问题 1：端口 8000 已被占用
**错误信息**：`OSError: [WinError 10048] 通常每个套接字地址只允许使用一次`

**解决方法**：
```bash
# 查找占用端口的进程
netstat -ano | findstr :8000

# 结束进程（将 <PID> 替换为实际的进程 ID）
taskkill /F /PID <PID>

# 重新启动 Rerank 服务
python rerank-server.py
```

### 问题 2：模型加载失败
**错误信息**：`❌ 模型加载失败`

**解决方法**：
1. 检查是否已安装依赖：
   ```bash
   pip list | findstr sentence-transformers
   ```
2. 如果未安装，运行：
   ```bash
   pip install sentence-transformers torch flask flask-cors
   ```
3. 检查 HuggingFace 镜像是否配置：
   ```bash
   echo %HF_ENDPOINT%
   ```
   如果不是 `https://hf-mirror.com`，运行：
   ```bash
   set HF_ENDPOINT=https://hf-mirror.com
   python rerank-server.py
   ```

### 问题 3：防火墙阻止端口 8000
**症状**：从你的电脑无法访问 `http://172.17.6.18:8000/health`

**解决方法**：
1. 在服务器上打开"Windows Defender 防火墙"
2. 点击"高级设置" → "入站规则" → "新建规则"
3. 选择"端口" → "TCP" → "特定本地端口: 8000"
4. 选择"允许连接"
5. 完成向导

---

## 📞 需要帮助？

如果更新过程中遇到任何问题，请告诉我：
1. 错误信息（截图或文字）
2. 执行到哪一步失败了
3. 服务器上的 Python 版本（`python --version`）

我会协助你解决！
