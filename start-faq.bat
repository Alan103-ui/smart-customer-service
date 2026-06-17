@echo off
chcp 65001 >nul

echo ========================================
echo    Guangkang AI Assistant - Start
echo ========================================
echo.

echo [1/2] Stopping existing node...
taskkill /IM node.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Port 3001 released.

echo.
echo [2/2] Starting backend...
echo ========================================

cd /d "%~dp0"
start "GuangkangAI-Backend" cmd /k "node server\index.js"

echo [OK] Backend window opened.
echo.
echo Waiting 5s for startup...
timeout /t 5 /nobreak >nul

netstat -ano | findstr :3001 | findstr LISTEN
if %errorlevel%==0 (
  echo.
  echo ===== STARTUP SUCCESS! =====
  echo   Admin:  http://localhost:3001/admin
  echo   Chat:   http://localhost:3001/
  echo ==============================
) else (
  echo.
  echo [WARNING] Port 3001 not active yet.
  echo   Backend may still be starting - check backend window.
)
echo.
pause
