"""DiceDrop worker. Runs on each VPS box next to Kameleo.

What it does:
  * checks in with DiceDrop every 15 seconds and reports whether Kameleo is up
  * when the operator asks, signs one of this box's accounts in to Amazon through that account's own
    Kameleo profile and dedicated proxy, then reports the result and a screenshot
The box only ever calls out. It picks up new versions of this file on its own.
"""
import base64
import json
import os
import random
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "0.8.1"
DD_URL = os.environ.get("DD_URL", "https://dicedrop.vercel.app").rstrip("/")
TOKEN = os.environ.get("DD_BOX_TOKEN", "")
KAMELEO = os.environ.get("KAMELEO_URL", "http://127.0.0.1:5050").rstrip("/")
LIB = "/app/pylib"
HEARTBEAT_SECONDS = 15
UPDATE_CHECK_SECONDS = 300
AGENT = "DiceDropWorker/" + VERSION

job_lock = threading.Lock()
current_job = {"text": ""}


def log(message):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


# ---------------------------------------------------------------- talking to DiceDrop

def call(path, body=None):
    request = urllib.request.Request(
        DD_URL + path,
        data=json.dumps(body or {}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": AGENT},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode() or "{}")


def report(label, **fields):
    """Tell DiceDrop how an account is doing. Never raises, so a hiccup cannot break a sign-in."""
    try:
        call("/api/worker/v1/accounts/update", dict(fields, account=label))
    except Exception as error:
        log("could not report on " + label + ": " + str(error))


# ---------------------------------------------------------------- talking to Kameleo on this box

def kameleo(method, path, body=None, timeout=60):
    request = urllib.request.Request(
        KAMELEO + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": AGENT},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:300]
        raise RuntimeError("Kameleo answered " + str(error.code) + " on " + path + ". " + detail)


def kameleo_state():
    try:
        kameleo("GET", "/general/healthcheck", timeout=5)
        return "kameleo ready"
    except Exception:
        return "kameleo starting"


def ensure_playwright():
    """Playwright is only the remote control for Kameleo's browser. Install it once, next to the worker."""
    import importlib

    os.makedirs(LIB, exist_ok=True)
    if LIB not in sys.path:
        sys.path.insert(0, LIB)
    # Python remembers folders it has already looked in. Clear that so a fresh install is seen right away.
    sys.path_importer_cache.pop(LIB, None)
    importlib.invalidate_caches()
    try:
        import playwright.sync_api  # noqa: F401
        return
    except ImportError:
        pass
    log("installing the browser remote control (one time, about a minute)")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--target", LIB, "playwright"])
    sys.path_importer_cache.pop(LIB, None)
    importlib.invalidate_caches()
    import playwright.sync_api  # noqa: F401


def direct_ip():
    try:
        request = urllib.request.Request("https://api.ipify.org", headers={"User-Agent": AGENT})
        return urllib.request.urlopen(request, timeout=15).read().decode().strip()
    except Exception:
        return ""


def ensure_profile(label, secrets):
    """Each account has one Kameleo profile: one device identity plus its dedicated proxy. Create it once, keep it."""
    proxy = secrets["proxy"]
    proxy_choice = {
        "value": "http",
        "extra": {"host": proxy["host"], "port": int(proxy["port"]), "id": proxy.get("username") or "", "secret": proxy.get("password") or ""},
    }
    profile_id = secrets.get("kameleo_profile_id")
    if profile_id:
        try:
            kameleo("GET", "/profiles/" + profile_id)
            return profile_id
        except Exception:
            log("saved profile for " + label + " is not on this box. creating a new one.")
    query = urllib.parse.urlencode({"deviceType": "desktop", "osFamily": "windows", "browserProduct": "chrome"})
    fingerprints = kameleo("GET", "/fingerprints?" + query)
    if not fingerprints:
        raise RuntimeError("Kameleo returned no device identities to choose from.")
    chosen = random.choice(fingerprints[:25])
    profile = kameleo("POST", "/profiles/new", {
        "fingerprintId": chosen["id"],
        "name": "dicedrop-" + label,
        "proxy": proxy_choice,
        "storage": "local",
        "language": "en-US",
    })
    report(label, kameleo_profile_id=profile["id"], note="device identity created")
    return profile["id"]


# ---------------------------------------------------------------- Amazon sign-in

EMAIL = "#ap_email, #ap_email_login, input[name='email']"
PASSWORD = "#ap_password, input[name='password']"
OTP = "#auth-mfa-otpcode, input[name='otpCode']"
CAPTCHA = "#auth-captcha-image, #captchacharacters, form[action*='validateCaptcha'], iframe[src*='captcha']"
ERROR_BOX = "#auth-error-message-box, #auth-warning-message-box"
HOME_PAGE = "https://www.amazon.com/"
ACCOUNT_PAGE = "https://www.amazon.com/gp/css/homepage.html"
SITE_MARK = "amazon.com"


def pause(low=0.8, high=2.0):
    time.sleep(random.uniform(low, high))


def visible(page, selector):
    try:
        return page.locator(selector).first.is_visible()
    except Exception:
        return False


def human_type(page, selector, text):
    field = page.locator(selector).first
    field.click()
    pause(0.2, 0.6)
    field.fill("")
    field.press_sequentially(text, delay=random.randint(70, 150))
    pause(0.3, 0.9)


def click_first(page, selectors):
    for selector in selectors:
        if visible(page, selector):
            page.locator(selector).first.click()
            return True
    return False


def snap(page):
    try:
        return base64.b64encode(page.screenshot(type="jpeg", quality=45, full_page=False)).decode()
    except Exception:
        return ""


def amazon_sign_in(page, label, secrets):
    """Walks Amazon's sign-in screens one at a time. Returns (state, error text)."""
    page.goto(HOME_PAGE, wait_until="domcontentloaded", timeout=90000)
    pause(2.0, 4.0)
    page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
    pause(1.5, 3.0)

    entered_password = False
    entered_code = False
    for _ in range(10):
        url = page.url
        if "/ap/" not in url and SITE_MARK in url and not visible(page, EMAIL) and not visible(page, PASSWORD):
            return "signed_in", ""

        if visible(page, CAPTCHA):
            return "verification", "Amazon is showing a picture puzzle. Solve it once through the box's screen viewer."

        if visible(page, ERROR_BOX):
            message = " ".join(page.locator(ERROR_BOX).first.inner_text().split())[:200]
            if entered_password or entered_code:
                return "needs_sign_in", "Amazon said: " + message

        if visible(page, OTP):
            if not secrets.get("totp_enabled"):
                return "verification", "Amazon asked for a two-step code and this account has no key saved."
            code = call("/api/worker/v1/totp", {"account": label})
            if int(code.get("expires_in", 30)) < 6:
                time.sleep(int(code.get("expires_in", 5)) + 1)
                code = call("/api/worker/v1/totp", {"account": label})
            report(label, note="entering the two-step code")
            human_type(page, OTP, code["code"])
            if visible(page, "#auth-mfa-remember-device"):
                try:
                    page.locator("#auth-mfa-remember-device").first.check()
                except Exception:
                    pass
            click_first(page, ["#auth-signin-button", "input[type='submit']"])
            entered_code = True
        elif visible(page, PASSWORD):
            report(label, note="entering the password")
            human_type(page, PASSWORD, secrets["password"])
            if visible(page, "input[name='rememberMe']"):
                try:
                    page.locator("input[name='rememberMe']").first.check()
                except Exception:
                    pass
            click_first(page, ["#signInSubmit", "input[type='submit']"])
            entered_password = True
        elif visible(page, EMAIL):
            report(label, note="entering the email")
            human_type(page, EMAIL, secrets["login_email"])
            click_first(page, ["input#continue", "#continue input", "#continue", "input[type='submit']"])
        elif click_first(page, ["#ap-account-fixup-phone-skip-link", "a#ap-account-fixup-phone-skip-link", "#auth-account-fixup-skip-link"]):
            pass
        elif "/ap/cvf" in url or "/ap/challenge" in url:
            return "verification", "Amazon wants extra verification (a code by email or text, or an approval tap)."
        else:
            title = ""
            try:
                title = page.title()[:80]
            except Exception:
                pass
            return "needs_sign_in", "Stopped on a page the worker does not know yet: " + title

        try:
            page.wait_for_load_state("domcontentloaded", timeout=45000)
        except Exception:
            pass
        pause(2.0, 4.0)

    return "needs_sign_in", "Amazon kept asking for more steps than expected."


def sign_in_job(label):
    profile_id = ""
    state, error, shot, exit_ip = "", "", "", ""
    try:
        current_job["text"] = "signing in " + label
        report(label, note="getting ready", error="")
        secrets = call("/api/worker/v1/accounts/secrets", {"account": label})
        if not secrets.get("password"):
            raise RuntimeError("No Amazon password is saved for this account.")
        if not secrets.get("proxy") or not secrets["proxy"].get("host"):
            raise RuntimeError("No dedicated proxy is attached to this account.")

        ensure_playwright()
        from playwright.sync_api import sync_playwright

        box_ip = direct_ip()
        profile_id = ensure_profile(label, secrets)
        report(label, note="opening the browser (the first time downloads it, a few minutes)")

        with sync_playwright() as playwright:
            endpoint = "ws://" + KAMELEO.split("://", 1)[1] + "/playwright/" + profile_id
            browser = playwright.chromium.connect_over_cdp(endpoint_url=endpoint, timeout=600000)
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(30000)
            try:
                report(label, note="checking the proxy")
                page.goto("https://api.ipify.org/?format=text", wait_until="domcontentloaded", timeout=60000)
                exit_ip = page.inner_text("body").strip()[:45]
                if not exit_ip or (box_ip and exit_ip == box_ip):
                    raise RuntimeError("The proxy is not being used (the browser shows this box's own address). Stopped before opening Amazon.")
                report(label, exit_ip=exit_ip, note="proxy ok, opening Amazon")
                state, error = amazon_sign_in(page, label, secrets)
            finally:
                shot = snap(page)
    except Exception as failure:
        state = state or "needs_sign_in"
        error = error or str(failure)[:300]
        log("sign-in for " + label + " stopped: " + error)
    finally:
        if profile_id:
            try:
                kameleo("POST", "/profiles/" + profile_id + "/stop", {})
            except Exception as failure:
                log("could not stop the profile cleanly: " + str(failure)[:200])
        report(label, session_state=state, error=error, note="signed in" if state == "signed_in" else "sign-in did not finish", screenshot=shot, done=True)
        log("sign-in for " + label + " finished: " + state + (" (" + error + ")" if error else ""))
        current_job["text"] = ""
        job_lock.release()


# ---------------------------------------------------------------- main loop

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
            state = current_job["text"] or kameleo_state()
            reply = call("/api/worker/v1/heartbeat", {"version": VERSION, "hostname": socket.gethostname(), "state": state})
            if reply.get("desired_state") != "pause":
                for account in reply.get("accounts", []):
                    if account.get("signin_requested") and job_lock.acquire(blocking=False):
                        log("sign-in requested for " + account["label"])
                        threading.Thread(target=sign_in_job, args=(account["label"],), daemon=True).start()
                        break
        except urllib.error.HTTPError as error:
            log("DiceDrop answered " + str(error.code) + ". " + error.read().decode()[:200])
        except Exception as error:
            log("could not reach DiceDrop: " + str(error))
        if time.time() - last_update_check > UPDATE_CHECK_SECONDS and not current_job["text"]:
            last_update_check = time.time()
            if newer_version_available():
                log("a newer worker is available. restarting to pick it up.")
                return 0
        time.sleep(HEARTBEAT_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
