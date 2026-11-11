import os
import re
import json
import time
import ssl
import logging
import sqlite3
from functools import wraps
import smtplib
from email.message import EmailMessage

from datetime import date, timedelta
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash

from google import genai
from google.genai import types
from google.genai.errors import ServerError, ClientError


# ==================================================
# CONFIGURATION
# ==================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_PATH = os.path.join(BASE_DIR, "codebridge.db")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173"
)

app = Flask(__name__)

app.config.update(
    SECRET_KEY=os.getenv("FLASK_SECRET_KEY"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv(
        "SESSION_COOKIE_SECURE",
        "False"
    ).lower() == "true",
    SESSION_COOKIE_NAME="codebridge_session",
)

if not app.config["SECRET_KEY"]:
    raise RuntimeError(
        "FLASK_SECRET_KEY is missing from backend/.env"
    )

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                FRONTEND_URL,
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]
        }
    },
    supports_credentials=True,
)

app.logger.setLevel(logging.INFO)

client = (
    genai.Client(api_key=GEMINI_API_KEY)
    if GEMINI_API_KEY
    else None
)

MAX_ATTEMPTS = 2
ROADMAP_ATTEMPTS = 3
ROADMAP_MAX_OUTPUT_TOKENS = 8192
MAX_ROADMAP_WEEKS = 12


# ==================================================
# DATABASE
# ==================================================

def get_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    connection = get_db()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (
                role IN ('job_seeker', 'recruiter', 'admin')
            ),
            recruiter_status TEXT DEFAULT 'not_applicable',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recruiter_id INTEGER,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            type TEXT NOT NULL,
            level TEXT NOT NULL,
            location TEXT,
            salary TEXT,
            description TEXT,
            skills TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS roadmap_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task_id TEXT NOT NULL,
            task_text TEXT NOT NULL,
            week_number INTEGER NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, task_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS profile_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            visit_date TEXT NOT NULL,
            UNIQUE(user_id, visit_date),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    
    connection.commit()
    connection.close()
    app.logger.info("Database initialized.")


def create_owner_admin():
    owner_email = os.getenv("OWNER_EMAIL", "").strip().lower()
    owner_password = os.getenv("OWNER_PASSWORD", "")

    if not owner_email or not owner_password:
        return

    connection = get_db()
    try:
        existing_admin = connection.execute(
            "SELECT id FROM users WHERE email = ?",
            (owner_email,)
        ).fetchone()

        if existing_admin:
            return

        password_hash = generate_password_hash(owner_password)
        connection.execute("""
            INSERT INTO users (name, email, password_hash, role, recruiter_status)
            VALUES (?, ?, ?, 'admin', 'not_applicable')
        """, ("CodeBridge Owner", owner_email, password_hash))
        connection.commit()
        app.logger.info("Private owner Admin account created.")
    except sqlite3.Error:
        connection.rollback()
    finally:
        connection.close()


# ==================================================
# AUTHENTICATION DECORATORS
# ==================================================

def login_required(view_function):
    @wraps(view_function)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Please log in first."}), 401
        return view_function(*args, **kwargs)
    return wrapper


def role_required(*allowed_roles):
    def decorator(view_function):
        @wraps(view_function)
        def wrapper(*args, **kwargs):
            if not session.get("user_id"):
                return jsonify({"error": "Please log in first."}), 401
            if session.get("role") not in allowed_roles:
                return jsonify({"error": "You are not authorized to access this resource."}), 403
            return view_function(*args, **kwargs)
        return wrapper
    return decorator


def get_public_user(user):
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "recruiter_status": user["recruiter_status"],
    }


# ==================================================
# SAMPLE JOBS
# ==================================================

SAMPLE_JOBS = [
    {
        "id": 1,
        "title": "Python Developer Intern",
        "organization": "Demo Opportunity",
        "company": "Demo Tech Corp",
        "type": "Internship",
        "level": "Beginner",
        "location": "Remote",
        "salary": "Stipend Provided",
        "description": "Build backend automation scripts and REST APIs using Python and Flask.",
        "skills": ["Python", "Git", "Problem solving"],
        "source": "Demo data — verify before applying"
    },
    {
        "id": 2,
        "title": "Frontend Apprentice",
        "organization": "Demo Opportunity",
        "company": "WebStart Labs",
        "type": "Apprenticeship",
        "level": "Beginner",
        "location": "Remote",
        "salary": "Paid Training",
        "description": "Learn modern component-driven development with React and Vite.",
        "skills": ["HTML", "CSS", "JavaScript", "React"],
        "source": "Demo data — verify before applying"
    },
]


# ==================================================
# GENERAL API & JOBS ENDPOINTS
# ==================================================

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "CodeBridge AI API"})


@app.get("/api/jobs")
def get_public_jobs():
    connection = get_db()
    try:
        approved_db_jobs = connection.execute(
            "SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC"
        ).fetchall()
        
        formatted_db_jobs = []
        for row in approved_db_jobs:
            j = dict(row)
            if isinstance(j["skills"], str):
                j["skills"] = [s.strip() for s in j["skills"].split(",") if s.strip()]
            formatted_db_jobs.append(j)

        return jsonify({"jobs": SAMPLE_JOBS + formatted_db_jobs})
    finally:
        connection.close()


@app.post("/api/jobs/create")
@role_required("recruiter")
def create_job_opportunity():
    user_id = session["user_id"]
    connection = get_db()
    try:
        user = connection.execute("SELECT recruiter_status FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user or user["recruiter_status"] != "approved":
            return jsonify({"error": "Your recruiter account is pending verification by the owner."}), 403

        data = request.get_json(silent=True) or {}
        title = str(data.get("title", "")).strip()
        company = str(data.get("company", "")).strip()
        job_type = str(data.get("type", "Internship")).strip()
        level = str(data.get("level", "Beginner")).strip()
        location = str(data.get("location", "Remote")).strip()
        salary = str(data.get("salary", "Stipend Provided")).strip()
        description = str(data.get("description", "")).strip()
        skills = data.get("skills", [])
        
        skills_str = ", ".join(skills) if isinstance(skills, list) else str(skills)

        if not title or not company:
            return jsonify({"error": "Title and company are required."}), 400

        connection.execute("""
            INSERT INTO jobs (recruiter_id, title, company, type, level, location, salary, description, skills, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        """, (user_id, title, company, job_type, level, location, salary, description, skills_str))
        connection.commit()

        return jsonify({"message": "Job posted successfully! Pending owner verification."}), 201
    finally:
        connection.close()


@app.get("/api/jobs/recruiter")
@role_required("recruiter")
def get_recruiter_jobs():
    user_id = session["user_id"]
    connection = get_db()
    try:
        jobs = connection.execute("SELECT * FROM jobs WHERE recruiter_id = ? ORDER BY id DESC", (user_id,)).fetchall()
        return jsonify({"jobs": [dict(j) for j in jobs]})
    finally:
        connection.close()


@app.get("/api/admin/recruiters/pending")
@role_required("admin")
def get_pending_recruiters():
    connection = get_db()
    try:
        users = connection.execute(
            "SELECT id, name, email, recruiter_status, created_at FROM users WHERE role = 'recruiter' AND recruiter_status = 'pending'"
        ).fetchall()
        return jsonify({"pending_recruiters": [dict(u) for u in users]})
    finally:
        connection.close()


@app.post("/api/admin/recruiters/<int:user_id>/verify")
@role_required("admin")
def verify_recruiter(user_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("approved", "rejected"):
        return jsonify({"error": "Invalid status."}), 400

    connection = get_db()
    try:
        cursor = connection.execute(
            "UPDATE users SET recruiter_status = ? WHERE id = ? AND role = 'recruiter'",
            (status, user_id)
        )
        connection.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "Recruiter not found."}), 404
        return jsonify({"message": f"Recruiter {status} successfully."})
    finally:
        connection.close()


@app.post("/api/recruiter/request-verification")
@login_required
def request_recruiter_verification():
    user_id = session.get("user_id")
    connection = get_db()
    try:
        user = connection.execute("SELECT name, email, recruiter_status FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404

        owner_email = os.getenv("OWNER_EMAIL")
        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", 587))
        smtp_user = os.getenv("SMTP_USER", owner_email)
        smtp_pass = os.getenv("SMTP_PASS", "")

        if not owner_email or not smtp_pass:
            return jsonify({"error": "Email server credentials not configured on the backend."}), 500

        msg = EmailMessage()

        msg["Subject"] = f"Recruiter Verification Request - {user['name']}"
        msg["From"] = smtp_user
        msg["To"] = owner_email

        msg.set_content(f"""
Hello CodeBridge AI Owner,

A new recruiter has requested account verification:

- Name: {user['name']}
- Email: {user['email']}
- User ID: #{user_id}
- Current Status: {user['recruiter_status']}

Please log into your Admin Owner Panel to review and approve/reject this account.

Best regards,
CodeBridge AI System
""")

        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(smtp_user, smtp_pass)

            server.send_message(
                msg,
                from_addr=smtp_user,
                to_addrs=[owner_email]
            )

        return jsonify({
            "message": "Verification request sent successfully to the platform owner!"
        }), 200
    except Exception as error:
        app.logger.exception("Failed to send verification email.")

        return jsonify({
            "error": f"{type(error).__name__}: {repr(error)}"
        }), 500

    finally:
        connection.close()

# ==================================================
# AUTHENTICATION API
# ==================================================

@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    role = str(data.get("role", "job_seeker")).strip().lower()

    if role not in ("job_seeker", "recruiter"):
        return jsonify({"error": "Invalid role."}), 400

    if not name or not email or not password or len(password) < 8:
        return jsonify({"error": "Valid name, email, and password (min 8 chars) required."}), 400

    connection = get_db()
    try:
        existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({"error": "Email already registered."}), 409

        password_hash = generate_password_hash(password)
        recruiter_status = "pending" if role == "recruiter" else "not_applicable"

        connection.execute("""
            INSERT INTO users (name, email, password_hash, role, recruiter_status)
            VALUES (?, ?, ?, ?, ?)
        """, (name, email, password_hash, role, recruiter_status))
        connection.commit()
        return jsonify({"message": "Registration successful."}), 201
    finally:
        connection.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    connection = get_db()
    try:
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    finally:
        connection.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    session.clear()
    session["user_id"] = user["id"]
    session["name"] = user["name"]
    session["email"] = user["email"]
    session["role"] = user["role"]

    return jsonify({"message": "Login successful.", "user": get_public_user(user)})


@app.get("/api/auth/me")
@login_required
def current_user():
    connection = get_db()
    try:
        user = connection.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    finally:
        connection.close()
    if not user:
        session.clear()
        return jsonify({"error": "User not found."}), 404
    return jsonify({"user": get_public_user(user)})


@app.post("/api/auth/logout")
@login_required
def logout():
    session.clear()
    return jsonify({"message": "Logged out."})


@app.delete("/api/auth/account")
@login_required
def delete_account():
    if session.get("role") == "admin":
        return jsonify({"error": "Admin account cannot be deleted."}), 403
    connection = get_db()
    try:
        connection.execute("DELETE FROM users WHERE id = ?", (session["user_id"],))
        connection.commit()
        session.clear()
        return jsonify({"message": "Account deleted."})
    finally:
        connection.close()


# ==================================================
# PROFILE VISIT & ACTIVITY API
# ==================================================

@app.post("/api/profile/visit")
@login_required
def record_profile_visit():
    user_id = session["user_id"]
    today = date.today().isoformat()
    connection = get_db()
    try:
        connection.execute("""
            INSERT INTO profile_visits (user_id, visit_date)
            VALUES (?, ?)
            ON CONFLICT(user_id, visit_date) DO NOTHING
        """, (user_id, today))
        connection.commit()
        return jsonify({"message": "Visit recorded."}), 200
    finally:
        connection.close()


@app.get("/api/profile/activity")
@login_required
def get_profile_activity():
    user_id = session["user_id"]
    today = date.today()
    start_date = today - timedelta(days=6)
    connection = get_db()
    try:
        visit_rows = connection.execute("""
            SELECT visit_date FROM profile_visits
            WHERE user_id = ? AND visit_date BETWEEN ? AND ?
        """, (user_id, start_date.isoformat(), today.isoformat())).fetchall()
        visit_dates = {row["visit_date"] for row in visit_rows}

        task_rows = connection.execute("""
            SELECT DATE(completed_at) AS completion_date, COUNT(*) AS task_count
            FROM roadmap_tasks
            WHERE user_id = ? AND completed = 1 AND completed_at IS NOT NULL
              AND DATE(completed_at) BETWEEN ? AND ?
            GROUP BY DATE(completed_at)
        """, (user_id, start_date.isoformat(), today.isoformat())).fetchall()
        tasks_by_date = {row["completion_date"]: row["task_count"] for row in task_rows}

        activity = []
        for offset in range(7):
            curr = start_date + timedelta(days=offset)
            d_str = curr.isoformat()
            activity.append({
                "date": d_str,
                "day": curr.strftime("%a"),
                "visits": 1 if d_str in visit_dates else 0,
                "tasks": int(tasks_by_date.get(d_str, 0))
            })

        return jsonify({
            "total_tasks_completed": sum(i["tasks"] for i in activity),
            "active_days": sum(1 for i in activity if i["visits"] > 0 or i["tasks"] > 0),
            "consistency": round((sum(1 for i in activity if i["visits"] > 0 or i["tasks"] > 0) / 7) * 100),
            "activity": activity
        }), 200
    finally:
        connection.close()


# ==================================================
# ROADMAP APIs
# ==================================================

@app.post("/api/analyze")
def analyze():
    data = request.get_json(silent=True) or {}
    return jsonify({
        "mode": "demo",
        "target_role": data.get("target_role", "Software Developer Intern"),
        "skill_gaps": ["Git & GitHub", "Portfolio Project", "API Integration"],
        "hiring_signals": ["Clean code", "Working demo link", "Structured documentation"],
        "portfolio_ideas": [{"title": "Full-Stack Task App", "description": "Build a CRUD app."}]
    })


@app.post("/api/roadmap")
def generate_roadmap():
    data = request.get_json(silent=True) or {}
    role = data.get("target_role", "Software Developer")
    weeks_count = int(data.get("duration_weeks", 4))
    return jsonify({
        "mode": "demo",
        "title": f"Learning Roadmap for {role}",
        "duration_weeks": weeks_count,
        "weeks": [
            {
                "week": i,
                "title": f"Week {i} Core Milestone",
                "goal": "Build practical competencies.",
                "topics": ["Basics", "Implementation"],
                "tasks": [f"Complete exercise {i}.1", f"Commit code to GitHub for week {i}"],
                "mini_project": f"Project milestone {i}",
                "resources": [{"name": "Official Docs", "url": "https://developer.mozilla.org"}]
            }
            for i in range(1, weeks_count + 1)
        ]
    })


if __name__ == "__main__":
    init_db()
    create_owner_admin()
    app.run(debug=True, host="127.0.0.1", port=5000)