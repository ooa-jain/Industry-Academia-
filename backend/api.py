"""REST API for the Industry-Academia Engagement Desk."""
from flask import Blueprint, jsonify, request

import auth as A
from db import db, jsonable, log, new_token, next_seq, now, oid

api = Blueprint("api", __name__)

TASK_STATUSES = ["To do", "In progress", "Blocked", "In review", "Done"]
ENGAGEMENT_STATUSES = ["Prospect", "Scoping", "Active", "On Hold", "Completed", "Discontinued"]
DECISIONS = ["Under Discussion", "Pending Approval", "Approved", "Pivoted", "Rejected"]
STAGES = ["input", "process", "output", "outcome", "impact"]
STAGE_STATES = ["not-started", "in-progress", "done"]
PRIORITIES = ["Low", "Normal", "High"]


# ------------------------------------------------------------------ helpers
def bad(msg, code=400):
    return jsonify({"error": msg}), code


def body():
    return request.get_json(silent=True) or {}


def s(v, limit=4000):
    return ("" if v is None else str(v)).strip()[:limit]


def group_guard(actor, gid):
    """Return the group doc if the actor may touch it, else None."""
    g = db().groups.find_one({"_id": oid(gid)})
    if not g:
        return None
    if actor["role"] == "admin":
        return g
    if actor.get("group_id") == str(g["_id"]):
        return g
    return None


def member_scope(actor):
    """Query fragment limiting tasks to what this member may see."""
    mid = oid(actor["id"])
    return {"$or": [{"assignee_id": mid}, {"mentions": mid}, {"watchers": mid}]}


def hydrate_tasks(rows, group_id):
    """Attach assignee + engagement labels without an N+1 round trip."""
    member_ids = {r["assignee_id"] for r in rows if r.get("assignee_id")}
    for r in rows:
        member_ids.update(r.get("mentions") or [])
    people = {m["_id"]: m for m in db().members.find(
        {"_id": {"$in": list(member_ids)}}, {"name": 1, "email": 1})} if member_ids else {}

    eng_ids = {r["engagement_id"] for r in rows if r.get("engagement_id")}
    engs = {e["_id"]: e for e in db().engagements.find(
        {"_id": {"$in": list(eng_ids)}}, {"company_name": 1, "seq": 1, "theme": 1, "status": 1})} \
        if eng_ids else {}

    counts = {}
    if rows:
        pipeline = [{"$match": {"task_id": {"$in": [r["_id"] for r in rows]}}},
                    {"$group": {"_id": "$task_id", "n": {"$sum": 1}}}]
        counts = {c["_id"]: c["n"] for c in db().comments.aggregate(pipeline)}

    out = []
    for r in rows:
        d = jsonable(r)
        a = people.get(r.get("assignee_id"))
        d["assignee"] = {"id": str(a["_id"]), "name": a["name"], "email": a["email"]} if a else None
        d["mention_people"] = [
            {"id": str(people[m]["_id"]), "name": people[m]["name"], "email": people[m]["email"]}
            for m in (r.get("mentions") or []) if m in people
        ]
        e = engs.get(r.get("engagement_id"))
        d["engagement"] = {
            "id": str(e["_id"]), "company_name": e.get("company_name", ""),
            "seq": e.get("seq", 0), "theme": e.get("theme", ""), "status": e.get("status", ""),
        } if e else None
        d["comment_count"] = counts.get(r["_id"], 0)
        out.append(d)
    return out


def blank_ipooi():
    return {k: {"text": "", "status": "not-started"} for k in STAGES}


# -------------------------------------------------------------------- health
@api.get("/health")
def health():
    try:
        db().command("ping")
        return {"ok": True, "db": "up"}
    except Exception as e:
        return {"ok": False, "db": str(e)}, 503


# ---------------------------------------------------------------------- auth
@api.post("/auth/login")
def login():
    d = body()
    email = s(d.get("email"), 200).lower()
    admin = db().admins.find_one({"email": email})
    if not admin or not A.verify_password(admin, d.get("password")):
        return bad("That email and password do not match.", 401)
    A.login_admin(admin)
    return {"actor": A.current_actor()}


@api.post("/auth/register")
def register():
    d = body()
    name = s(d.get("name"), 200)
    email = s(d.get("email"), 200).lower()
    password = d.get("password") or ""

    if not name:
        return bad("Please provide your full name.")
    if not email:
        return bad("Please provide an email address or username.")
    if len(password) < 6:
        return bad("Password must be at least 6 characters long.")

    existing = db().admins.find_one({"email": email})
    if existing:
        return bad("An account with this email or username already exists.", 409)

    doc = {
        "email": email,
        "name": name,
        "password_hash": A.hash_password(password),
        "created_at": now(),
    }
    try:
        r = db().admins.insert_one(doc)
        doc["_id"] = r.inserted_id
    except Exception:
        return bad("An account with this email or username already exists.", 409)

    A.login_admin(doc)
    return {"actor": A.current_actor()}, 201


@api.post("/auth/join")
def join():
    """Exchange a magic-link token for a member session."""
    token = s(body().get("token"), 200)
    m = A.member_by_token(token)
    if not m:
        return bad("This link is not valid any more. Ask the coordinator for a fresh one.", 401)
    A.login_member(m)
    db().members.update_one({"_id": m["_id"]}, {"$set": {"last_seen": now()}})
    log(m["group_id"], m["name"], f"{m['name']} opened their task list")
    return {"actor": A.current_actor()}


@api.post("/auth/logout")
def do_logout():
    A.logout()
    return {"ok": True}


@api.get("/auth/me")
def me():
    return {"actor": A.current_actor()}


# -------------------------------------------------------------------- groups
@api.get("/groups")
@A.require_auth
def list_groups(actor):
    q = {} if actor["role"] == "admin" else {"_id": oid(actor["group_id"])}
    rows = list(db().groups.find(q).sort("created_at", -1))
    for g in rows:
        g["member_count"] = db().members.count_documents({"group_id": g["_id"], "active": True})
        g["task_count"] = db().tasks.count_documents({"group_id": g["_id"]})
    return {"groups": jsonable(rows)}


@api.post("/groups")
@A.require_admin
def create_group(actor):
    d = body()
    name = s(d.get("name"), 160)
    if not name:
        return bad("Give the group a name.")
    doc = {"name": name, "description": s(d.get("description"), 500),
           "created_at": now(), "created_by": actor["email"]}
    r = db().groups.insert_one(doc)
    doc["_id"] = r.inserted_id
    log(r.inserted_id, actor["name"], f"Group '{name}' created")
    return {"group": jsonable(doc)}, 201


@api.patch("/groups/<gid>")
@A.require_admin
def patch_group(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    d = body()
    upd = {k: s(d[k], 500) for k in ("name", "description") if k in d}
    if upd:
        db().groups.update_one({"_id": oid(gid)}, {"$set": upd})
    return {"group": jsonable(db().groups.find_one({"_id": oid(gid)}))}


@api.delete("/groups/<gid>")
@A.require_admin
def delete_group(gid, actor):
    g = group_guard(actor, gid)
    if not g:
        return bad("Group not found.", 404)
    for coll in ("tasks", "engagements", "members", "activity"):
        db()[coll].delete_many({"group_id": oid(gid)})
    db().groups.delete_one({"_id": oid(gid)})
    return {"ok": True}


# ------------------------------------------------------------------- members
@api.get("/groups/<gid>/members")
@A.require_auth
def list_members(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    rows = list(db().members.find({"group_id": oid(gid)}).sort("name", 1))
    out = []
    for m in rows:
        d = jsonable(m)
        d.pop("token_hash", None)
        d["open_tasks"] = db().tasks.count_documents(
            {"assignee_id": m["_id"], "status": {"$ne": "Done"}})
        if actor["role"] != "admin":
            d.pop("token_tail", None)
        out.append(d)
    return {"members": out}


@api.post("/groups/<gid>/members")
@A.require_admin
def add_member(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    d = body()
    name, email = s(d.get("name"), 160), s(d.get("email"), 200).lower()
    if not name or not email:
        return bad("A name and an email address are both required.")
    if "@" not in email or "." not in email.split("@")[-1]:
        return bad("That does not look like an email address.")
    if db().members.find_one({"group_id": oid(gid), "email": email}):
        return bad("Someone with that email is already in this group.", 409)

    raw, hashed, tail = new_token()
    doc = {
        "group_id": oid(gid), "name": name, "email": email,
        "title": s(d.get("title"), 160), "role": s(d.get("role"), 40) or "Member",
        "token_hash": hashed, "token_tail": tail, "active": True,
        "created_at": now(), "last_seen": None,
    }
    r = db().members.insert_one(doc)
    doc["_id"] = r.inserted_id
    log(gid, actor["name"], f"{name} ({email}) added to the group")
    out = jsonable(doc)
    out.pop("token_hash", None)
    out["link"] = A.member_link(raw)   # shown once here, and on demand via /link
    return {"member": out}, 201


@api.patch("/members/<mid>")
@A.require_admin
def patch_member(mid, actor):
    m = db().members.find_one({"_id": oid(mid)})
    if not m or not group_guard(actor, m["group_id"]):
        return bad("Member not found.", 404)
    d = body()
    upd = {}
    for k in ("name", "title", "role"):
        if k in d:
            upd[k] = s(d[k], 160)
    if "active" in d:
        upd["active"] = bool(d["active"])
    if upd:
        db().members.update_one({"_id": m["_id"]}, {"$set": upd})
    return {"member": jsonable(db().members.find_one({"_id": m["_id"]}, {"token_hash": 0}))}


@api.delete("/members/<mid>")
@A.require_admin
def delete_member(mid, actor):
    m = db().members.find_one({"_id": oid(mid)})
    if not m or not group_guard(actor, m["group_id"]):
        return bad("Member not found.", 404)
    db().tasks.update_many({"assignee_id": m["_id"]},
                           {"$set": {"assignee_id": None}, "$currentDate": {"updated_at": True}})
    db().tasks.update_many({"mentions": m["_id"]}, {"$pull": {"mentions": m["_id"]}})
    db().members.delete_one({"_id": m["_id"]})
    log(m["group_id"], actor["name"], f"{m['name']} removed from the group")
    return {"ok": True}


@api.post("/members/<mid>/rotate")
@A.require_admin
def rotate_link(mid, actor):
    """Issue a new magic link; the old one stops working immediately."""
    m = db().members.find_one({"_id": oid(mid)})
    if not m or not group_guard(actor, m["group_id"]):
        return bad("Member not found.", 404)
    raw, hashed, tail = new_token()
    db().members.update_one({"_id": m["_id"]},
                            {"$set": {"token_hash": hashed, "token_tail": tail}})
    log(m["group_id"], actor["name"], f"New link issued for {m['name']}")
    return {"link": A.member_link(raw), "token_tail": tail}


# --------------------------------------------------------------- engagements
ENG_FIELDS = ("theme", "company_name", "industry_personnel", "industry_spoc",
              "university_spoc", "assigned_work", "kpis", "start_date", "target_date")


@api.get("/groups/<gid>/engagements")
@A.require_auth
def list_engagements(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    q = {"group_id": oid(gid)}
    if actor["role"] == "member":
        visible = db().tasks.distinct("engagement_id",
                                      {"group_id": oid(gid), **member_scope(actor)})
        q["_id"] = {"$in": visible}
    rows = list(db().engagements.find(q).sort("order", 1))
    ids = [r["_id"] for r in rows]
    agg = {c["_id"]: c for c in db().tasks.aggregate([
        {"$match": {"engagement_id": {"$in": ids}}},
        {"$group": {"_id": "$engagement_id", "total": {"$sum": 1},
                    "done": {"$sum": {"$cond": [{"$eq": ["$status", "Done"]}, 1, 0]}}}}])}
    out = []
    for r in rows:
        d = jsonable(r)
        c = agg.get(r["_id"], {})
        d["task_total"] = c.get("total", 0)
        d["task_done"] = c.get("done", 0)
        out.append(d)
    return {"engagements": out}


@api.post("/groups/<gid>/engagements")
@A.require_admin
def create_engagement(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    d = body()
    if not s(d.get("company_name")):
        return bad("Name the partner organisation.")
    doc = {k: s(d.get(k)) for k in ENG_FIELDS}
    doc.update({
        "group_id": oid(gid),
        "seq": next_seq(gid),
        "status": d.get("status") if d.get("status") in ENGAGEMENT_STATUSES else "Prospect",
        "decision": d.get("decision") if d.get("decision") in DECISIONS else "Under Discussion",
        "ipooi": blank_ipooi(),
        "order": int(now().timestamp() * 1000),
        "created_at": now(), "updated_at": now(),
    })
    r = db().engagements.insert_one(doc)
    doc["_id"] = r.inserted_id
    log(gid, actor["name"], f"Case file opened for {doc['company_name']}",
        {"engagement_id": str(r.inserted_id)})
    return {"engagement": jsonable(doc)}, 201


@api.patch("/engagements/<eid>")
@A.require_admin
def patch_engagement(eid, actor):
    e = db().engagements.find_one({"_id": oid(eid)})
    if not e or not group_guard(actor, e["group_id"]):
        return bad("Case file not found.", 404)
    d = body()
    upd = {k: s(d[k]) for k in ENG_FIELDS if k in d}
    if d.get("status") in ENGAGEMENT_STATUSES:
        upd["status"] = d["status"]
    if d.get("decision") in DECISIONS:
        upd["decision"] = d["decision"]
    if isinstance(d.get("ipooi"), dict):
        ip = dict(e.get("ipooi") or blank_ipooi())
        for k, v in d["ipooi"].items():
            if k in STAGES and isinstance(v, dict):
                cur = dict(ip.get(k) or {"text": "", "status": "not-started"})
                if v.get("status") in STAGE_STATES:
                    cur["status"] = v["status"]
                if "text" in v:
                    cur["text"] = s(v["text"])
                ip[k] = cur
        upd["ipooi"] = ip
    if "order" in d:
        try:
            upd["order"] = int(d["order"])
        except (TypeError, ValueError):
            pass
    if upd:
        upd["updated_at"] = now()
        db().engagements.update_one({"_id": e["_id"]}, {"$set": upd})
        if "status" in upd and upd["status"] != e.get("status"):
            log(e["group_id"], actor["name"],
                f"{e.get('company_name')} moved to {upd['status']}",
                {"engagement_id": str(e["_id"])})
    return {"engagement": jsonable(db().engagements.find_one({"_id": e["_id"]}))}


@api.delete("/engagements/<eid>")
@A.require_admin
def delete_engagement(eid, actor):
    e = db().engagements.find_one({"_id": oid(eid)})
    if not e or not group_guard(actor, e["group_id"]):
        return bad("Case file not found.", 404)
    tids = [t["_id"] for t in db().tasks.find({"engagement_id": e["_id"]}, {"_id": 1})]
    db().comments.delete_many({"task_id": {"$in": tids}})
    db().tasks.delete_many({"engagement_id": e["_id"]})
    db().engagements.delete_one({"_id": e["_id"]})
    return {"ok": True}


# --------------------------------------------------------------------- tasks
def _resolve_people(gid, ids):
    if not ids:
        return []
    wanted = [oid(x) for x in ids if oid(x)]
    found = db().members.find({"_id": {"$in": wanted}, "group_id": oid(gid)}, {"_id": 1})
    return [m["_id"] for m in found]


@api.get("/groups/<gid>/tasks")
@A.require_auth
def list_tasks(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    q = {"group_id": oid(gid)}
    if actor["role"] == "member":
        q.update(member_scope(actor))
    if request.args.get("assignee"):
        a = request.args["assignee"]
        q["assignee_id"] = oid(actor["id"]) if a == "me" else oid(a)
    if request.args.get("engagement"):
        q["engagement_id"] = oid(request.args["engagement"])
    if request.args.get("status"):
        q["status"] = request.args["status"]
    rows = list(db().tasks.find(q).sort([("order", 1), ("created_at", 1)]))
    return {"tasks": hydrate_tasks(rows, gid)}


@api.post("/engagements/<eid>/tasks")
@A.require_admin
def create_task(eid, actor):
    e = db().engagements.find_one({"_id": oid(eid)})
    if not e or not group_guard(actor, e["group_id"]):
        return bad("Case file not found.", 404)
    d = body()
    title = s(d.get("title"), 300)
    if not title:
        return bad("Give the task a title.")
    assignee = oid(d.get("assignee_id"))
    if assignee and not db().members.find_one({"_id": assignee, "group_id": e["group_id"]}):
        return bad("That person is not in this group.")
    doc = {
        "group_id": e["group_id"], "engagement_id": e["_id"],
        "title": title, "detail": s(d.get("detail")),
        "assignee_id": assignee,
        "mentions": _resolve_people(e["group_id"], d.get("mentions")),
        "watchers": [],
        "status": d.get("status") if d.get("status") in TASK_STATUSES else "To do",
        "priority": d.get("priority") if d.get("priority") in PRIORITIES else "Normal",
        "due_date": s(d.get("due_date"), 20),
        "progress": max(0, min(100, int(d.get("progress") or 0))),
        "order": int(now().timestamp() * 1000),
        "created_at": now(), "updated_at": now(), "done_at": None,
    }
    r = db().tasks.insert_one(doc)
    doc["_id"] = r.inserted_id
    who = db().members.find_one({"_id": assignee}, {"name": 1}) if assignee else None
    log(e["group_id"], actor["name"],
        f"Task '{title}' assigned to {who['name'] if who else 'nobody yet'}",
        {"task_id": str(r.inserted_id), "engagement_id": str(e["_id"])})
    return {"task": hydrate_tasks([doc], e["group_id"])[0]}, 201


MEMBER_EDITABLE = {"status", "progress"}


@api.patch("/tasks/<tid>")
@A.require_auth
def patch_task(tid, actor):
    t = db().tasks.find_one({"_id": oid(tid)})
    if not t:
        return bad("Task not found.", 404)
    if not group_guard(actor, t["group_id"]):
        return bad("Task not found.", 404)

    d = body()
    if actor["role"] == "member":
        mid = oid(actor["id"])
        allowed = t.get("assignee_id") == mid or mid in (t.get("mentions") or [])
        if not allowed:
            return bad("This task is not assigned to you.", 403)
        keys = set(d) & MEMBER_EDITABLE
        if not keys:
            return bad("You can update the status and progress of your own tasks.", 403)
        d = {k: d[k] for k in keys}

    upd = {}
    if d.get("status") in TASK_STATUSES:
        upd["status"] = d["status"]
        upd["done_at"] = now() if d["status"] == "Done" else None
        if d["status"] == "Done":
            upd["progress"] = 100
    if "progress" in d:
        try:
            upd["progress"] = max(0, min(100, int(d["progress"])))
        except (TypeError, ValueError):
            pass
    if actor["role"] == "admin":
        for k in ("title", "detail", "due_date"):
            if k in d:
                upd[k] = s(d[k], 300 if k == "title" else 4000)
        if d.get("priority") in PRIORITIES:
            upd["priority"] = d["priority"]
        if "assignee_id" in d:
            a = oid(d["assignee_id"])
            if a and not db().members.find_one({"_id": a, "group_id": t["group_id"]}):
                return bad("That person is not in this group.")
            upd["assignee_id"] = a
        if "mentions" in d:
            upd["mentions"] = _resolve_people(t["group_id"], d["mentions"])
        if "order" in d:
            try:
                upd["order"] = int(d["order"])
            except (TypeError, ValueError):
                pass

    if not upd:
        return bad("Nothing to update.")
    upd["updated_at"] = now()
    db().tasks.update_one({"_id": t["_id"]}, {"$set": upd})

    if "status" in upd and upd["status"] != t.get("status"):
        log(t["group_id"], actor["name"],
            f"'{t['title']}' → {upd['status']}", {"task_id": str(t["_id"])})
        db().comments.insert_one({
            "task_id": t["_id"], "group_id": t["group_id"], "kind": "status",
            "author_name": actor["name"], "author_role": actor["role"],
            "text": f"Status changed from {t.get('status')} to {upd['status']}",
            "created_at": now()})

    fresh = db().tasks.find_one({"_id": t["_id"]})
    return {"task": hydrate_tasks([fresh], t["group_id"])[0]}


@api.delete("/tasks/<tid>")
@A.require_admin
def delete_task(tid, actor):
    t = db().tasks.find_one({"_id": oid(tid)})
    if not t or not group_guard(actor, t["group_id"]):
        return bad("Task not found.", 404)
    db().comments.delete_many({"task_id": t["_id"]})
    db().tasks.delete_one({"_id": t["_id"]})
    return {"ok": True}


# ------------------------------------------------------------------ comments
@api.get("/tasks/<tid>/comments")
@A.require_auth
def list_comments(tid, actor):
    t = db().tasks.find_one({"_id": oid(tid)})
    if not t or not group_guard(actor, t["group_id"]):
        return bad("Task not found.", 404)
    if actor["role"] == "member":
        mid = oid(actor["id"])
        if t.get("assignee_id") != mid and mid not in (t.get("mentions") or []):
            return bad("This task is not assigned to you.", 403)
    rows = list(db().comments.find({"task_id": t["_id"]}).sort("created_at", 1))
    return {"comments": jsonable(rows)}


@api.post("/tasks/<tid>/comments")
@A.require_auth
def add_comment(tid, actor):
    t = db().tasks.find_one({"_id": oid(tid)})
    if not t or not group_guard(actor, t["group_id"]):
        return bad("Task not found.", 404)
    if actor["role"] == "member":
        mid = oid(actor["id"])
        if t.get("assignee_id") != mid and mid not in (t.get("mentions") or []):
            return bad("This task is not assigned to you.", 403)
    text = s(body().get("text"), 4000)
    if not text:
        return bad("Write something first.")
    doc = {"task_id": t["_id"], "group_id": t["group_id"], "kind": "note",
           "author_name": actor["name"], "author_role": actor["role"],
           "text": text, "created_at": now()}
    r = db().comments.insert_one(doc)
    doc["_id"] = r.inserted_id
    db().tasks.update_one({"_id": t["_id"]}, {"$set": {"updated_at": now()}})
    log(t["group_id"], actor["name"], f"Update posted on '{t['title']}'", {"task_id": str(t["_id"])})
    return {"comment": jsonable(doc)}, 201


# ------------------------------------------------------------------ activity
@api.get("/groups/<gid>/activity")
@A.require_auth
def activity(gid, actor):
    if not group_guard(actor, gid):
        return bad("Group not found.", 404)
    rows = list(db().activity.find({"group_id": oid(gid)}).sort("created_at", -1).limit(60))
    return {"activity": jsonable(rows)}


# --------------------------------------------------------------- member view
@api.get("/me/board")
@A.require_auth
def my_board(actor):
    if actor["role"] != "member":
        return bad("This view is for group members.", 403)
    gid = oid(actor["group_id"])
    rows = list(db().tasks.find({"group_id": gid, **member_scope(actor)})
                .sort([("status", 1), ("due_date", 1)]))
    tasks = hydrate_tasks(rows, gid)
    group = db().groups.find_one({"_id": gid})
    mid = oid(actor["id"])
    return {
        "group": jsonable(group),
        "tasks": tasks,
        "mine": [t for t in tasks if (t.get("assignee") or {}).get("id") == str(mid)],
        "mentioned": [t for t in tasks
                      if (t.get("assignee") or {}).get("id") != str(mid)],
        "statuses": TASK_STATUSES,
    }
