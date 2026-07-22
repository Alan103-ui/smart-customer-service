@echo off
chcp 65001 >nul
REM 创建 Windows 任务计划，实现“用户登录时”自动启动守护进程（崩溃自启由 daemon.js 负责）
REM 注意：/rl highest 需要以“管理员身份运行”本脚本，否则可能创建失败
echo 正在创建开机自启任务（需管理员权限）...
schtasks /create /tn "GuangKangAIDaemon" ^
  /tr "D:\Clow\projects\smart-customer-service\server\start-daemon.bat" ^
  /sc onlogon /rl highest /f
if "%errorlevel%"=="0" (
  echo ✅ 已创建任务，下次登录将自动启动守护进程
) else (
  echo ❌ 创建失败，请右键本文件“以管理员身份运行”
)
pause
