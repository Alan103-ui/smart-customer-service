@echo off
chcp 65001 > nul
echo ================================================
echo   bge-reranker-v2-m3 安装检查脚本（远程）
echo   目标服务器：172.17.6.18:8000
echo ================================================
echo.

REM 检查1：远程服务是否在运行
echo [检查1/2] 检查远程 Rerank 服务 (172.17.6.18:8000)...
curl -s --connect-timeout 5 http://172.17.6.18:8000/health > temp_health.txt 2>&1
if %errorlevel% == 0 (
    echo ✅ Rerank 服务正在运行
    echo.
    echo 响应内容：
    type temp_health.txt
) else (
    echo ❌ Rerank 服务未运行（或未安装）
    echo    可能原因：
    echo    1. 服务未启动
    echo    2. 防火墙阻止了 8000 端口
    echo    3. 服务启动失败
)
del temp_health.txt > nul 2>&1
echo.

REM 检查2：测试 Rerank API
echo [检查2/2] 测试 Rerank API...
curl -s --connect-timeout 5 -X POST http://172.17.6.18:8000/rerank ^
  -H "Content-Type: application/json" ^
  -d "{\"query\": \"测试\", \"documents\": [\"文档1\", \"文档2\"]}" > temp_rerank.txt 2>&1

if %errorlevel% == 0 (
    echo ✅ Rerank API 正常
    echo.
    echo 响应内容：
    type temp_rerank.txt
) else (
    echo ❌ Rerank API 调用失败
)
del temp_rerank.txt > nul 2>&1
echo.

echo ================================================
echo 检查完成！
echo ================================================
echo.
echo 结果说明：
echo ✅ 如果两个检查都通过，说明 Rerank 服务已安装并正常运行
echo ❌ 如果检查失败，需要在 172.17.6.18 上安装 Rerank 服务
echo.
echo 安装方法：
echo 1. 登录 172.17.6.18
echo 2. 运行 install-rerank-service.bat
echo 3. 等待安装完成（约10-20分钟）
echo.
pause
