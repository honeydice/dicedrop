"""DiceDrop worker. Runs on each VPS box next to Kameleo.

Milestone 1: check in with DiceDrop every 15 seconds and report whether Kameleo is up on this box.
The box only ever calls out. It picks up new versions of this file on its own.
"""
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

VERSION = "0.7.0"
DD_URL = os.environ.get("DD_URL", "https://dicedrop.vercel.app").rstrip("/")
TOKEN = os.environ.get("DD_BOX_TOKEN", "")
KAMELEO = os.environ.get("KAMELEO_URL", "http://127.0.0.1:5050")
HEARTBEAT_SECONDS = 15
UPDATE_CHECK_SECONDS = 300
AGENT = "DiceDropWorker/" + VERSION


def log(message):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


def call(path, body=None):
    request = urllib.request.Request(
        DD_URL + path,
        data=json.dumps(body or {}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": AGENT},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode() or "{}")


def kameleo_state():
    """Any answer from Kameleo's local port means the engine is running."""
    try:
        urllib.request.urlopen(urllib.request.Request(KAMELEO + "/swagger", headers={"User-Agent": AGENT}), timeout=5)
        return "kameleo ready"
    except urllib.error.HTTPError:
        return "kameleo ready"
    except Exception:
        return "kameleo starting"


def newer_version_available():
    try:
        request = urllib.request.Request(DD_URL + "/dd/version.txt", headers={"User-Agent": AGENT})
        latest = urllib.request.urlopen(request, timeout=15).read().decode().strip()
        return bool(latest) and latest != VERSION
    except Exception:
        return False


def main():
    if not TOKEN:
        log("No box token set. Run the install command from the DiceDrop VPS page.")
        time.sleep(60)
        return 1
    log("DiceDrop worker " + VERSION + " starting on " + socket.gethostname())
    last_update_check = time.time()
    while True:
        try:
            reply = call("/api/worker/v1/heartbeat", {"version": VERSION, "hostname": socket.gethostname(), "state": kameleo_state()})
            log("checked in. desired state: " + str(reply.get("desired_state")) + ", accounts on this box: " + str(len(reply.get("accounts", []))))
        except urllib.error.HTTPError as error:
            log("DiceDrop answered " + str(error.code) + ". " + error.read().decode()[:200])
        except Exception as error:
            log("could not reach DiceDrop: " + str(error))
        if time.time() - last_update_check > UPDATE_CHECK_SECONDS:
            last_update_check = time.time()
            if newer_version_available():
                log("a newer worker is available. restarting to pick it up.")
                return 0
        time.sleep(HEARTBEAT_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
