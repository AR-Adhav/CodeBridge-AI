
# CodeBridge AI

AI-powered career guidance and opportunity platform.

CodeBridge AI helps students and beginners explore career opportunities, improve their skills, and plan their learning journey.

## Features

- AI-powered career guidance
- Job and internship opportunities
- Personalized learning roadmaps
- Profile and progress tracking
- Recruiter verification requests
- AI-based analysis of job descriptions

## Technologies Used

### Frontend
- React.js
- Vite
- CSS

### Backend
- Python
- Flask
- SQLite
- Gemini API

## Requirements

- Python 3.11+
- Node.js 20+
- Gemini API key

## Run Locally

### 1. Backend Setup

Open a terminal:

```bash
cd backend
python -m venv .venv
```

Activate the environment on Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create a `.env` file inside the backend folder and configure your environment variables.

Start the backend:

```bash
python app.py
```

Backend URL: http://127.0.0.1:5000

### 2. Frontend Setup

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL shown by Vite, usually:

http://localhost:5173

## Security

- Never upload `.env` files.
- Never expose API keys or passwords.
- Keep sensitive credentials in environment variables.
- Do not commit database files containing private user information.

## Project Status

Developed as a hackathon project.
