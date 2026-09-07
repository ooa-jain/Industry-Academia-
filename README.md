# Engagement Desk

Industry–Academia engagement register with per-person task links, for the JAIN Office of
Academics. Flask + MongoDB Atlas on the back, React (Vite) on the front, one origin.

**The idea:** a project manager registers, creates a *group*, adds people by **name + email**, and
gets one **private link per person**. That link is their sign-in — no password, no account to
create. It opens only the tasks assigned to them (plus anything they were tagged on), and they
update status, progress and post notes straight from it.

There are three roles:

```
Super admin      →  /login   (username + password) → every group, of every project manager,
                                                        plus a directory of who has registered
                                                        and logged in (/api/coordinators)
Project manager  →  /login   (username + password) → full board, tasks and people —
                                                        scoped to the groups THEY created
Member           →  /join/<token>                  → /me — only their own tasks
```

Anyone can self-register as a project manager at `/register`; that account only ever sees the
groups it creates. Super admin is not self-service — it is seeded once from `ADMIN_EMAIL` in
`.env` (see **First run**), and from there a super admin can promote or pause any other account
from the **Project managers** directory in the console.

---

## Layout

```
backend/           Flask app
  app.py           factory + SPA fallback
  config.py        env config
  db.py            Mongo client, indexes, serialisers, token hashing
  auth.py          sessions, decorators, bootstrap super admin
  api.py           the whole REST API
  test_flow.py     permission tests against an in-memory Mongo
  wsgi.py          gunicorn entrypoint
frontend/          React 18 + Vite
  src/main.jsx     router, project manager / super admin login, magic-link exchange
  src/AdminApp.jsx project manager console (+ super admin directory tab)
  src/MemberApp.jsx member portal
  src/api.js       fetch wrapper + shared vocabulary
  src/ui.jsx       shared components
  src/styles.css   design tokens (light + dark)
deploy/            systemd unit, nginx vhost, deploy.sh
```

---

## Run it locally

```bash
git clone git@github.com:ooa-jain/iae-desk.git && cd iae-desk
cp .env.example .env          # fill in MONGO_URI, ADMIN_EMAIL, ADMIN_PASSWORD

python3 -m venv venv && ./venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..

cd backend && ../venv/bin/python app.py     # http://localhost:5000
```

There is **no seed or demo data** — the desk starts empty and everything in it comes from
MongoDB. On first sign-in you are asked to create a group, then add people and tasks.

For frontend hot reload, run `npm run dev` in `frontend/` (port 5173, proxies `/api` to 5000).

### First run

1. Sign in at `/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. This seeds the **super
   admin** account on first boot; editing those values afterwards does **not** change an existing
   account. Everyone else registers at `/register` and becomes a **project manager**.
2. Create a group.
3. **People → Add person** — name + email. The private link appears once; copy it or use the
   pre-filled mail draft.
4. **Task board → New task** — give it a topic (this creates or reuses that engagement behind the
   scenes), assign it to a person, optionally tag others.

---

## Deploy on the VPS

```bash
# once
sudo mkdir -p /var/www/iae-desk && sudo chown -R $USER /var/www/iae-desk
git clone git@github.com:ooa-jain/iae-desk.git /var/www/iae-desk
cd /var/www/iae-desk
cp .env.example .env && nano .env          # MONGO_URI, MONGO_DB, SECRET_KEY,
                                           # ADMIN_EMAIL, ADMIN_PASSWORD,
                                           # PUBLIC_BASE_URL=https://desk.juooa.cloud, COOKIE_SECURE=1
python3 -m venv venv && ./venv/bin/pip install -r backend/requirements.txt
cd frontend && npm ci && npm run build && cd ..

sudo cp deploy/iae-desk.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now iae-desk

sudo cp deploy/nginx.conf /etc/nginx/sites-available/desk.juooa.cloud
sudo ln -s /etc/nginx/sites-available/desk.juooa.cloud /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d desk.juooa.cloud

# every release after that
cd /var/www/iae-desk && sudo bash deploy/deploy.sh
```

Add the VPS IP to the **Atlas Network Access** allowlist, and give the database user `readWrite`
on the database named in `MONGO_DB`. If Atlas is unreachable the process still starts — it logs
the reason and `GET /api/health` returns `503` with the driver's message, so
`journalctl -u iae-desk -n 50` tells you what is wrong.

---

## Security model

- **Member tokens** are 32 bytes of `secrets.token_urlsafe`. Only the SHA-256 hash is stored; the
  raw link is shown once, at creation, and on demand via **New link** (which retires the old one).
- Sessions are signed, `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=1`.
- **Server-side scoping.** A member's queries are filtered to
  `assignee_id == me OR me ∈ mentions OR me ∈ watchers`. They cannot read another person's tasks
  even by guessing an id.
- **Server-side field allowlist.** A member may write only `status` and `progress`, plus comments
  on their own tasks. Titles, assignees, due dates and topics are project-manager-only.
- **Group ownership.** Every group carries an `owner_id`. A project manager's queries are filtered
  to groups they own — `group_guard()` in `api.py` refuses any other group with a 404, so one
  project manager cannot browse or edit another's teams. A super admin bypasses that filter
  entirely and can reach every group, and is the only role that can see the coordinator directory
  (`/api/coordinators`) or promote/pause an account.
- Nginx sends `no-store` on `/api/` and `/join/` so links never sit in a proxy cache.

Rotate a link the moment someone forwards it. Removing a member unassigns their tasks rather than
deleting the work.

---

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone |
| POST | `/api/auth/register` | anyone (always creates a project manager) |
| POST | `/api/auth/join` | anyone with a valid token |
| GET | `/api/auth/me` | anyone |
| GET/POST | `/api/groups` | project manager (own groups) / super admin (all) / member (own) |
| GET/POST | `/api/groups/<gid>/members` | project manager or super admin, on their own group |
| POST | `/api/members/<mid>/rotate` | project manager or super admin |
| GET/POST | `/api/groups/<gid>/engagements` | project manager or super admin |
| PATCH/DELETE | `/api/engagements/<eid>` | project manager or super admin |
| GET | `/api/groups/<gid>/tasks` | project manager or super admin (members get their slice) |
| POST | `/api/engagements/<eid>/tasks` | project manager or super admin |
| PATCH | `/api/tasks/<tid>` | project manager or super admin (member: status + progress) |
| GET/POST | `/api/tasks/<tid>/comments` | project manager/super admin + assigned/tagged member |
| GET | `/api/coordinators` | super admin — every account, groups, last login |
| PATCH | `/api/coordinators/<aid>` | super admin — promote/demote, pause/resume |
| GET | `/api/me/board` | member |
| GET | `/api/health` | anyone |

---

## Collections

`groups` · `members` · `engagements` · `tasks` · `comments` · `activity` · `admins`

Indexes are created at boot in `db.ensure_indexes()`. `members` is unique on
`(group_id, email)` and on `token_hash`. `admins` holds both project managers and the super admin,
distinguished by `role` (`"project_manager"` or `"super_admin"`); `groups.owner_id` points back at
whoever created that group. `backfill_group_owners()` in `auth.py` runs at every boot to set
`owner_id` on any group created before ownership existed, matched by the `created_by` email.
#   I n d u s t r y - A c a d e m i a -  
 