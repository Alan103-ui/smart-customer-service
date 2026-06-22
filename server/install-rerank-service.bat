@echo off
chcp 65001 > nul
echo ================================================
echo    Rerank 服务一键部署脚本（for 172.17.6.18）
echo ================================================
echo.

REM 检查 Python 是否安装
python --version > nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    echo 下载地址：<ADDRESS_REMOVED>
    pause
    exit /b 1
)
echo [✓] Python 已安装
python --version

REM 检查 pip 是否可用
python -m pip --version > nul 2>&1
if errorlevel 1 (
    echo [错误] pip 不可用，请检查 Python 安装
    pause
    exit /b 1
)
echo [✓] pip 可用

REM 安装依赖
echo [1/3] 安装依赖（flask, flask-cors, sentence-transformers, torch）...
echo          这可能需要 5-10 分钟，请耐心等待...
python -m pip install flask flask-cors sentence-transformers torch -i https://pypi.tuna.tsinghua.edu.cn/simple

if errorlevel 1 (
    echo [错误] 依赖安装失败，尝试使用阿里云镜像...
    python -m pip install flask flask-cors sentence-transformers torch -i https://mirrors.aliyun.com/pypi/simple/
)

echo [✓] 依赖安装完成

REM 检查 rerank-server.py 是否存在
if not exist "rerank-server.py" (
    echo [错误] 未找到 rerank-server.py，请确保此脚本在 server 目录下运行
    pause
    exit /b 1
)

REM 启动服务
echo [2/3] 启动 Rerank 服务...
echo.
echo   ==============================================
echo   服务地址：<ADDRESS_REMOVED>
echo   健康检查：http://localhost:8000/health
echo   停止服务：按 Ctrl+C
echo   ==============================================
echo.

python rerank-server.py

pause
