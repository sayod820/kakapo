@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
pause
