@echo off
chcp 65001 > nul
echo ==============================================
echo   Rerank 服务启动脚本（Windows - 172.17.6.18）
echo ==============================================
echo.

REM 检查 Python 是否安装
python --version > nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    echo 下载地址：<ADDRESS_REMOVED>
    pause
    exit /b 1
)

echo [1/4] Python 已安装
python --version

REM 检查依赖是否安装
echo [2/4] 检查依赖...
python -c "import flask, flask_cors, sentence_transformers" 2> nul
if errorlevel 1 (
    echo [安装] 正在安装依赖（可能需要 5-10 分钟）...
    pip install flask flask-cors sentence-transformers torch -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络连接
        echo 可尝试：pip install flask flask-cors sentence-transformers torch -i https://mirrors.aliyun.com/pypi/simple/
        pause
        exit /b 1
    )
)

echo [3/4] 依赖已安装

REM 检查模型是否已下载
if not exist "%USERPROFILE%\.cache\huggingface\hub\BAAI" (
    echo [下载] 首次运行会自动下载 bge-reranker-v2-m3 模型（约 1.2GB）
    echo          请耐心等待...
)

REM 设置环境变量（可选）
set PYTHONIOENCODING=utf-8

REM 启动服务
echo [4/4] 启动 Rerank 服务...
echo.
echo   服务地址: <ADDRESS_REMOVED>
echo   健康检查: http://localhost:8000/health
echo   Rerank API: http://localhost:8000/rerank
echo   停止服务: Ctrl+C
echo.
echo ==============================================
python rerank-server.py

pause
