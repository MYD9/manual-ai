@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo 请先按 README.md 安装 Python 依赖。
  pause
  exit /b 1
)
".venv\Scripts\python.exe" scripts\launcher.py start
if errorlevel 1 pause
