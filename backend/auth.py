"""Session auth: password login for admins, magic-link login for members."""
from functools import wraps

from flask import current_app, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import db, hash_token, jsonable, now, oid


# --------------------------------------------------------------- bootstrap
def ensure_bootstrap_admin(app):
    """Seed the first admin from env, once. Never overwrites an existing one."""
    email = app.config["ADMIN_EMAIL"].strip().lower()
    if not email:
        return
    if db().admins.find_one({"email": email}):
        return
    db().admins.insert_one({
        "email": email,
        "name": app.config["ADMIN_NAME"],
        "password_hash": generate_password_hash(app.config["ADMIN_PASSWORD"]),
        "created_at": now(),
    })
    app.logger.warning("Bootstrap admin created for %s — change the password.", email)


# ------------------------------------------------------------------ session
def login_admin(admin):
    session.clear()
    session.permanent = True
    session["role"] = "admin"
    session["admin_id"] = str(admin["_id"])


def login_member(member):
    session.clear()
    session.permanent = True
    session["role"] = "member"
    session["member_id"] = str(member["_id"])
    session["group_id"] = str(member["group_id"])


def logout():
    session.clear()


def current_actor():
    """Return the signed-in admin or member as a dict, or None."""
    role = session.get("role")
    if role == "admin":
        a = db().admins.find_one({"_id": oid(session.get("admin_id"))})
        if not a:
            session.clear()
            return None
        return {"role": "admin", "id": str(a["_id"]), "name": a.get("name") or a["email"],
                "email": a["email"]}
    if role == "member":
        m = db().members.find_one({"_id": oid(session.get("member_id"))})
        if not m or not m.get("active", True):
            session.clear()
            return None
        return {"role": "member", "id": str(m["_id"]), "name": m["name"], "email": m["email"],
                "group_id": str(m["group_id"]), "title": m.get("title", "")}
    return None


def member_by_token(raw_token):
    if not raw_token:
        return None
    return db().members.find_one({"token_hash": hash_token(raw_token), "active": True})


# --------------------------------------------------------------- decorators
def _deny(msg, code):
    return jsonify({"error": msg}), code


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        actor = current_actor()
        if not actor:
            return _deny("Sign in to continue.", 401)
        kw["actor"] = actor
        return fn(*a, **kw)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        actor = current_actor()
        if not actor:
            return _deny("Sign in to continue.", 401)
        if actor["role"] != "admin":
            return _deny("This action is limited to the coordinator.", 403)
        kw["actor"] = actor
        return fn(*a, **kw)
    return wrapper


def verify_password(admin, password):
    return check_password_hash(admin.get("password_hash", ""), password or "")


def hash_password(raw):
    return generate_password_hash(raw)


def member_link(raw_token):
    return f"{current_app.config['PUBLIC_BASE_URL']}/join/{raw_token}"
