#!/usr/bin/env bash
# Pull, build, restart. Matches the juooa.cloud pattern.
#   sudo bash deploy/deploy.sh
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/iae-desk}
SERVICE=${SERVICE:-iae-desk}

cd "$APP_DIR"

echo "→ git pull"
git pull --ff-only

echo "→ python deps"
if [ ! -d venv ]; then python3 -m venv venv; fi
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r backend/requirements.txt

echo "→ frontend build"
cd frontend
npm ci --silent
npm run build --silent
cd ..

echo "→ restart $SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl --no-pager --lines=5 status "$SERVICE" || true

echo "→ health"
curl -fsS http://127.0.0.1:8130/api/health && echo
echo "done."
