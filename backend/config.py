import os
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except Exception:
    pass


def _bool(name, default="0"):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


class Config:
    # --- core ---
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5000").rstrip("/")

    # --- mongo atlas ---
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB = os.getenv("MONGO_DB", "iae_desk")

    # --- bootstrap admin (seeded on first run only) ---
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "ooa.connect@jainuniversity.ac.in")
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Office of Academics")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")

    # --- session cookie ---
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _bool("COOKIE_SECURE")
    PERMANENT_SESSION_LIFETIME = timedelta(days=60)

    # --- misc ---
    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024
    FRONTEND_DIST = os.getenv("FRONTEND_DIST", str(ROOT / "frontend" / "dist"))
