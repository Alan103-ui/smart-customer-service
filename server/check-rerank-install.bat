@echo off
chcp 65001 > nul
echo ================================================
echo   bge-reranker-v2-m3 安装检查脚本
echo ================================================
echo.

REM 检查1：服务是否在运行
echo [检查1/4] 检查 Rerank 服务 (localhost:8000)...
curl -s --connect-timeout 3 http://localhost:8000/health > temp_health.txt 2>&1
if %errorlevel% == 0 (
    echo ✅ Rerank 服务正在运行
    type temp_health.txt
) else (
    echo ❌ Rerank 服务未运行（或未安装）
)
del temp_health.txt > nul 2>&1
echo.

REM 检查2：检查 Python 依赖
echo [检查2/4] 检查 Python 依赖（sentence-transformers）...
python -c "import sentence_transformers; print('✅ sentence-transformers 已安装')" 2>&1
if %errorlevel% == 0 (
    echo ✅ 依赖已安装
) else (
    echo ❌ sentence-transformers 未安装
)
echo.

REM 检查3：检查模型文件
echo [检查3/4] 检查模型文件（HuggingFace 缓存）...
set HF_CACHE=%USERPROFILE%\.cache\huggingface\hub
if exist "%HF_CACHE%\models--BAAI--bge-reranker-v2-m3" (
    echo ✅ 模型文件已下载
    dir "%HF_CACHE%\models--BAAI--bge-reranker-v2-m3" /a /s 2>&1 | findstr /C:"File(s)"
) else (
    echo ❌ 模型文件未下载
)
echo.

REM 检查4：检查端口 8000
echo [检查4/4] 检查端口 8000...
netstat -ano | findstr :8000
if %errorlevel% == 0 (
    echo ✅ 端口 8000 被占用（可能有服务在运行）
) else (
    echo ❌ 端口 8000 未被占用
)
echo.

echo ================================================
echo 检查完成！
echo ================================================
echo.
echo 下一步操作：
echo 1. 如果服务未运行，请运行：start-rerank-server.bat
echo 2. 如果依赖未安装，请运行：install-rerank-service.bat
echo 3. 如果模型未下载，首次运行会自动下载（约1.2GB）
echo.
pause
