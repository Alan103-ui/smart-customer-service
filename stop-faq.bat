@echo off
chcp 65001 >nul 2>&1
echo Stopping node.exe...
taskkill /IM node.exe /F >nul 2>&1
echo Done.
ping 127.0.0.1 -n 2 >nul
