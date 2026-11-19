#!/usr/bin/env bash
# DiceDrop box installer. Sets up Docker, Kameleo, and the DiceDrop worker on a fresh Ubuntu server.
# Usage:  curl -fsSL https://dicedrop.vercel.app/dd/install.sh | sudo bash -s -- <box token>
set -euo pipefail

DD_URL="${DD_URL:-https://dicedrop.vercel.app}"
TOKEN="${1:-}"
DIR=/opt/dicedrop

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stop() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }

[ -n "$TOKEN" ] || stop "Missing box token. Copy the full install command from the DiceDrop VPS page."
[ "$(id -u)" -eq 0 ] || stop "Run this as root (the command from DiceDrop already includes sudo)."
[ "$(uname -m)" = "x86_64" ] || stop "This server is not a standard 64-bit Intel/AMD machine, which Kameleo needs."

say "[1/5] Checking in with DiceDrop"
command -v curl >/dev/null 2>&1 || { apt-get update -y >/dev/null && apt-get install -y curl >/dev/null; }
CONFIG="$(curl -fsS -X POST "$DD_URL/api/worker/v1/config" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')" \
  || stop "DiceDrop did not accept this box token. Click 'Install command' on the VPS page to get a fresh one."
PAT="$(printf '%s' "$CONFIG" | sed -n 's/.*"kameleo_pat":"\([^"]*\)".*/\1/p')"
BOX="$(printf '%s' "$CONFIG" | sed -n 's/.*"box":"\([^"]*\)".*/\1/p')"
[ -n "$PAT" ] || stop "No Kameleo token saved yet. Add it in DiceDrop under Settings > kameleo, then run this again."
echo "Recognized as box: ${BOX:-unknown}"

say "[2/5] Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { apt-get update -y >/dev/null && apt-get install -y docker-compose-plugin; }
systemctl enable --now docker >/dev/null 2>&1 || true

say "[3/5] Writing the box configuration"
mkdir -p "$DIR"
umask 077
cat > "$DIR/.env" <<ENV
DD_URL=$DD_URL
DD_BOX_TOKEN='$TOKEN'
PAT='$PAT'
ENV
umask 022

cat > "$DIR/run.py" <<'PY'
"""Fetches the current DiceDrop worker and runs it. When the worker exits (for an update), fetch and run again."""
import os
import subprocess
import sys
import time
import urllib.request

URL = os.environ.get("DD_URL", "https://dicedrop.vercel.app").rstrip("/") + "/dd/worker.py"
PATH = "/app/worker.py"

while True:
    try:
        request = urllib.request.Request(URL, headers={"User-Agent": "DiceDropWorker/bootstrap"})
        code = urllib.request.urlopen(request, timeout=30).read()
        if b"DiceDrop worker" in code:
            with open(PATH, "wb") as handle:
                handle.write(code)
    except Exception as error:
        print("could not fetch the latest worker, using the saved copy:", error, flush=True)
    if os.path.exists(PATH):
        subprocess.call([sys.executable, PATH])
    time.sleep(10)
PY

cat > "$DIR/docker-compose.yml" <<'YML'
services:
  kameleo:
    image: kameleo/kameleo-app:latest
    platform: linux/amd64
    shm_size: 2g
    env_file: .env
    ports:
      - "127.0.0.1:5050:5050"
    volumes:
      - kameleo-data:/data
    restart: unless-stopped
  worker:
    image: python:3.12-slim
    network_mode: host
    env_file: .env
    environment:
      - PYTHONUNBUFFERED=1
    volumes:
      - /opt/dicedrop:/app
    command: python /app/run.py
    restart: unless-stopped
volumes:
  kameleo-data:
YML

say "[4/5] Downloading Kameleo and the worker (a few minutes the first time)"
cd "$DIR"
docker compose pull
docker compose up -d

say "[5/5] Done"
echo "This box now checks in with DiceDrop every 15 seconds."
echo "Open the VPS page in DiceDrop: ${BOX:-this box} should turn green within a minute."
echo "To watch it work:  cd $DIR && docker compose logs -f worker"
