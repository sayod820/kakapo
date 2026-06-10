@echo off
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
echo KAKAPO Backend: http://localhost:8000
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
