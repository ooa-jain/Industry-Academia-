"""Session auth: password login for project managers / the super admin,
magic-link login for group members."""
from functools import wraps

from flask import current_app, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import db, hash_token, jsonable, now, oid

ADMIN_ROLES = ("project_manager", "super_admin")


# --------------------------------------------------------------- bootstrap
def ensure_bootstrap_admin(app):
    """Seed the first account — the org's super admin — from env, once.
    Never overwrites an existing one."""
    email = app.config["ADMIN_EMAIL"].strip().lower()
    if not email:
        return
    if db().admins.find_one({"email": email}):
        return
    db().admins.insert_one({
        "email": email,
        "name": app.config["ADMIN_NAME"],
        "password_hash": generate_password_hash(app.config["ADMIN_PASSWORD"]),
        "role": "super_admin",
        "active": True,
        "created_at": now(),
        "last_login": None,
    })
    app.logger.warning("Bootstrap super admin created for %s — change the password.", email)


def backfill_group_owners():
    """One-time migration: groups created before ownership existed get an
    owner_id, matched by the creator's email. Safe to call on every boot."""
    for g in db().groups.find({"owner_id": {"$exists": False}}):
        a = db().admins.find_one({"email": g.get("created_by")})
        if a:
            db().groups.update_one({"_id": g["_id"]}, {"$set": {"owner_id": a["_id"]}})


# ------------------------------------------------------------------ session
def login_admin(admin):
    session.clear()
    session.permanent = True
    role = admin.get("role") or "project_manager"
    session["role"] = role
    session["admin_id"] = str(admin["_id"])
    db().admins.update_one({"_id": admin["_id"]}, {"$set": {"last_login": now()}})


def login_member(member):
    session.clear()
    session.permanent = True
    session["role"] = "member"
    session["member_id"] = str(member["_id"])
    session["group_id"] = str(member["group_id"])


def logout():
    session.clear()


def current_actor():
    """Return the signed-in project manager / super admin / member as a dict, or None."""
    role = session.get("role")
    if role in ADMIN_ROLES:
        a = db().admins.find_one({"_id": oid(session.get("admin_id"))})
        if not a or not a.get("active", True):
            session.clear()
            return None
        # Read the role fresh from the DB record — a promotion/demotion by the
        # super admin takes effect immediately, without waiting for re-login.
        actual_role = a.get("role") or "project_manager"
        return {"role": actual_role, "id": str(a["_id"]), "name": a.get("name") or a["email"],
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
    """Project manager or super admin — i.e. anyone above a group member."""
    @wraps(fn)
    def wrapper(*a, **kw):
        actor = current_actor()
        if not actor:
            return _deny("Sign in to continue.", 401)
        if actor["role"] not in ADMIN_ROLES:
            return _deny("This action is limited to project managers.", 403)
        kw["actor"] = actor
        return fn(*a, **kw)
    return wrapper


def require_super_admin(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        actor = current_actor()
        if not actor:
            return _deny("Sign in to continue.", 401)
        if actor["role"] != "super_admin":
            return _deny("This action is limited to the super admin.", 403)
        kw["actor"] = actor
        return fn(*a, **kw)
    return wrapper


def verify_password(admin, password):
    return check_password_hash(admin.get("password_hash", ""), password or "")


def hash_password(raw):
    return generate_password_hash(raw)


def member_link(raw_token):
    return f"{current_app.config['PUBLIC_BASE_URL']}/join/{raw_token}"
