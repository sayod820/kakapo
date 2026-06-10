@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File scripts\start-frontend.ps1
pause
