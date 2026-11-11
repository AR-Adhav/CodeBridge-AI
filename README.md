# CodeBridge AI

A beginner-friendly hackathon MVP for first-time coders:
- Job discovery (starter sample opportunities)
- Portfolio project recommendations
- Hiring signal analysis from job descriptions

## Requirements
- Python 3.11+
- Node.js 20+
- Gemini API key (optional for demo; AI analysis falls back to a sample response)

## Run locally

### 1. Backend (Flask)
```bash
cd backend
python -m venv venv
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python app.py
```
Backend runs at http://127.0.0.1:5000

### 2. Frontend (React + Vite)
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the URL Vite prints (usually http://
1localhost:5173).

## Next steps
This is a starter MVP. Add verified current opportunities, authentication, and persistent storage before production.
Never put API keys in frontend code. Keep secrets in backend `.env`.
