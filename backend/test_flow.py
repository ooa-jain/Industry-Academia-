"""End-to-end smoke test against an in-memory Mongo (mongomock).

    ../venv/bin/python test_flow.py
"""
import os
import sys

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("ADMIN_EMAIL", "ooa.connect@jainuniversity.ac.in")
os.environ.setdefault("ADMIN_PASSWORD", "test-pass")
os.environ.setdefault("PUBLIC_BASE_URL", "http://localhost:5000")

import mongomock  # noqa: E402
import db as dbmod  # noqa: E402

dbmod.MongoClient = lambda *a, **kw: mongomock.MongoClient()

from app import create_app  # noqa: E402

FAIL = []


def check(label, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + label + ("" if cond else f"  <- {extra}"))
    if not cond:
        FAIL.append(label)


def main():
    app = create_app()
    admin = app.test_client()
    member = app.test_client()

    print("\n— coordinator —")
    r = admin.post("/api/auth/login", json={"email": os.environ["ADMIN_EMAIL"], "password": "wrong"})
    check("bad password rejected", r.status_code == 401)

    r = admin.post("/api/auth/login",
                   json={"email": os.environ["ADMIN_EMAIL"], "password": "test-pass"})
    check("login works", r.status_code == 200, r.get_json())

    r = admin.post("/api/groups", json={"name": "Industry Liaison Cell"})
    gid = r.get_json()["group"]["id"]
    check("group created", r.status_code == 201)

    r = admin.post(f"/api/groups/{gid}/members",
                   json={"name": "Aditi Sharma", "email": "aditi@example.edu", "title": "B.Tech CSE"})
    m1 = r.get_json()["member"]
    link = m1["link"]
    token = link.rsplit("/", 1)[-1]
    check("member added with a link", r.status_code == 201 and "/join/" in link, link)

    r = admin.post(f"/api/groups/{gid}/members",
                   json={"name": "Rahul Nair", "email": "rahul@example.edu"})
    m2 = r.get_json()["member"]
    check("second member added", r.status_code == 201)

    r = admin.post(f"/api/groups/{gid}/members",
                   json={"name": "Dup", "email": "aditi@example.edu"})
    check("duplicate email refused", r.status_code == 409)

    r = admin.post(f"/api/groups/{gid}/engagements",
                   json={"company_name": "Verdant Farms", "theme": "AgriTech", "status": "Active"})
    eid = r.get_json()["engagement"]["id"]
    check("case file created", r.status_code == 201)

    r = admin.post(f"/api/engagements/{eid}/tasks",
                   json={"title": "Map the 40 centres", "assignee_id": m1["id"],
                         "due_date": "2026-10-05", "mentions": [m2["id"]]})
    t1 = r.get_json()["task"]
    check("task created and assigned", r.status_code == 201 and t1["assignee"]["name"] == "Aditi Sharma")
    check("mention resolved", len(t1["mention_people"]) == 1, t1["mention_people"])

    r = admin.post(f"/api/engagements/{eid}/tasks",
                   json={"title": "Rahul-only task", "assignee_id": m2["id"]})
    t2 = r.get_json()["task"]
    check("second task created", r.status_code == 201)

    r = admin.post(f"/api/engagements/{eid}/tasks", json={"title": "Nobody's task"})
    t3 = r.get_json()["task"]
    check("unassigned task allowed", r.status_code == 201 and t3["assignee"] is None)

    print("\n— member via magic link —")
    r = member.post("/api/auth/join", json={"token": "not-a-real-token"})
    check("bad token rejected", r.status_code == 401)

    r = member.post("/api/auth/join", json={"token": token})
    check("magic link signs in", r.status_code == 200 and r.get_json()["actor"]["role"] == "member")

    r = member.get("/api/me/board")
    board = r.get_json()
    ids = {t["id"] for t in board["tasks"]}
    check("sees own task", t1["id"] in ids)
    check("does NOT see the other member's task", t2["id"] not in ids, sorted(ids))
    check("does NOT see the unassigned task", t3["id"] not in ids)
    check("mine / tagged split", len(board["mine"]) == 1 and len(board["mentioned"]) == 0,
          f"mine={len(board['mine'])} tagged={len(board['mentioned'])}")

    r = member.get(f"/api/groups/{gid}/tasks")
    check("group task list is scoped for members", {t["id"] for t in r.get_json()["tasks"]} == {t1["id"]})

    r = member.patch(f"/api/tasks/{t1['id']}", json={"status": "In progress", "progress": 40})
    check("member may set status + progress", r.status_code == 200
          and r.get_json()["task"]["status"] == "In progress")

    r = member.patch(f"/api/tasks/{t1['id']}", json={"title": "hijacked"})
    check("member may NOT rename a task", r.status_code == 403)

    r = member.patch(f"/api/tasks/{t2['id']}", json={"status": "Done"})
    check("member may NOT touch someone else's task", r.status_code == 403)

    r = member.post(f"/api/tasks/{t1['id']}/comments", json={"text": "Twelve centres mapped."})
    check("member can post an update", r.status_code == 201)

    r = member.post(f"/api/groups/{gid}/engagements", json={"company_name": "Sneaky Corp"})
    check("member may NOT create case files", r.status_code == 403)

    r = member.get(f"/api/groups/{gid}/members")
    peers = r.get_json()["members"]
    check("member sees peers without token tails",
          all("token_tail" not in p and "token_hash" not in p for p in peers), peers)

    print("\n— tagged-in visibility —")
    tagged = app.test_client()
    link2 = admin.post(f"/api/members/{m2['id']}/rotate").get_json()["link"]
    tagged.post("/api/auth/join", json={"token": link2.rsplit("/", 1)[-1]})
    b2 = tagged.get("/api/me/board").get_json()
    check("tagged person sees the task they were tagged on",
          t1["id"] in {t["id"] for t in b2["tasks"]})
    check("tagged task lands in 'mentioned', not 'mine'",
          len(b2["mine"]) == 1 and len(b2["mentioned"]) == 1,
          f"mine={len(b2['mine'])} tagged={len(b2['mentioned'])}")

    print("\n— link rotation —")
    stale = app.test_client()
    r = stale.post("/api/auth/join", json={"token": token})
    check("old link still valid (was not rotated)", r.status_code == 200)
    new_link = admin.post(f"/api/members/{m1['id']}/rotate").get_json()["link"]
    r = stale.post("/api/auth/join", json={"token": token})
    check("rotated link retires the old token", r.status_code == 401)
    r = stale.post("/api/auth/join", json={"token": new_link.rsplit("/", 1)[-1]})
    check("new link works", r.status_code == 200)

    print("\n— coordinator view —")
    r = admin.get(f"/api/groups/{gid}/tasks")
    check("admin sees every task", len(r.get_json()["tasks"]) == 3)
    r = admin.get(f"/api/groups/{gid}/engagements")
    e = r.get_json()["engagements"][0]
    check("task rollup on the case file", e["task_total"] == 3, e)
    r = admin.get(f"/api/groups/{gid}/activity")
    check("activity logged", len(r.get_json()["activity"]) > 3)

    print("\n— signed out —")
    anon = app.test_client()
    check("anonymous is blocked", anon.get(f"/api/groups/{gid}/tasks").status_code == 401)
    check("anonymous /me is null", anon.get("/api/auth/me").get_json()["actor"] is None)

    print("\n" + ("ALL CHECKS PASSED" if not FAIL else f"{len(FAIL)} FAILED: {FAIL}"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
