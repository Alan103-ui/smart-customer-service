@echo off
chcp 65001 > nul 2>&1
title Rerank Server
cd /d "%~dp0"
set HF_ENDPOINT=https://hf-mirror.com
set PYTHONIOENCODING=utf-8

echo ==============================================
echo   Rerank Server Starting...
echo ==============================================
echo.
python --version
if errorlevel 1 (
    echo [ERROR] Python not found!
    pause
    exit /b 1
)

echo [OK] Python ready
echo [Mirror] %HF_ENDPOINT%
echo.
echo [Starting] Rerank service...
echo   URL: http://0.0.0.0:8000
echo   Health: http://localhost:8000/health
echo   Stop: Ctrl+C
echo ==============================================
echo.

python rerank-server.py

echo.
echo [INFO] Service stopped.
pause
