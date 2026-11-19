"""DiceDrop worker. Runs on each VPS box next to Kameleo.

What it does:
  * checks in with DiceDrop every 15 seconds and reports whether Kameleo is up
  * when the operator asks, signs one of this box's accounts in to Amazon through that account's own
    Kameleo profile and dedicated proxy, then reports the result and a screenshot
  * when the operator clicks "Order now (cart only)": item in cart, buyer address added, gift note added,
    totals read, screenshot taken. Nothing is bought.
  * when the operator clicks "Place order (real)": the same steps, then the order is placed once and the
    confirmation page is captured.
  * every 30 minutes (set in DiceDrop), looks at each account's placed orders on Amazon and reports
    shipped, delivered, or cancelled, with a picture of the order's tracking page.
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

VERSION = "0.17.5"
DD_URL = os.environ.get("DD_URL", "https://dicedrop.vercel.app").rstrip("/")
TOKEN = os.environ.get("DD_BOX_TOKEN", "")
KAMELEO = os.environ.get("KAMELEO_URL", "http://127.0.0.1:5050").rstrip("/")
LIB = "/app/pylib"
HEARTBEAT_SECONDS = 15
UPDATE_CHECK_SECONDS = 60
AGENT = "DiceDropWorker/" + VERSION

job_lock = threading.Lock()
current_job = {"text": ""}


recent_lines = []


def log(message):
    line = time.strftime("%Y-%m-%d %H:%M:%S") + " " + str(message)
    print(line, flush=True)
    recent_lines.append(line[:300])
    del recent_lines[:-80]


def ship_log(kind, extra=""):
    """Send the last lines of this box's log to DiceDrop, so a problem can be read without logging in to the box."""
    try:
        call("/api/worker/v1/log", {"type": kind, "text": (extra + "\n" if extra else "") + "\n".join(recent_lines[-45:])})
    except Exception:
        pass


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

    # The remote control needs one small system library that the slim container image leaves out.
    if not any(os.path.exists(path) for path in ("/usr/lib/x86_64-linux-gnu/libatomic.so.1", "/lib/x86_64-linux-gnu/libatomic.so.1", "/usr/lib64/libatomic.so.1")):
        log("installing a missing system library (one time)")
        env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
        subprocess.check_call(["apt-get", "update", "-qq"], env=env, stdout=subprocess.DEVNULL)
        subprocess.check_call(["apt-get", "install", "-y", "-qq", "--no-install-recommends", "libatomic1"], env=env, stdout=subprocess.DEVNULL)

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
ERROR_BOX = "#auth-error-message-box, #auth-warning-message-box, .a-alert-error, #passkey-error-alert"
HOME_PAGE = "https://www.amazon.com/"
# Order history is only shown to a signed-in shopper; signed out, Amazon sends the browser to its sign-in page.
ACCOUNT_PAGE = "https://www.amazon.com/gp/your-account/order-history"
SITE_MARK = "amazon.com"
REQUIRE_GREETING = True


def pause(low=0.8, high=2.0):
    time.sleep(random.uniform(low, high))


def first_visible(page, selector):
    """The first match that is actually on screen. A selector list can match hidden fields first, so check each one."""
    try:
        matches = page.locator(selector)
        for index in range(min(matches.count(), 8)):
            candidate = matches.nth(index)
            if candidate.is_visible():
                return candidate
    except Exception:
        pass
    return None


def visible(page, selector):
    return first_visible(page, selector) is not None


def human_type(page, selector, text):
    field = first_visible(page, selector) or page.locator(selector).first
    field.click()
    pause(0.2, 0.6)
    field.fill("")
    field.press_sequentially(text, delay=random.randint(70, 150))
    pause(0.3, 0.9)
    return field


def typed_length(field):
    try:
        return len(field.input_value(timeout=2000))
    except Exception:
        return -1


def type_checked(page, selector, text):
    """Types into a field and confirms the text is really in it before anything is submitted.
    Amazon sometimes redraws the sign-in page a moment after it appears, which wipes anything typed too early."""
    how = "keys"
    field = None
    for attempt in range(3):
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        pause(1.0, 2.0)
        field = human_type(page, selector, text)
        pause(0.8, 1.4)
        if typed_length(field) == len(text):
            return field, how + (" (try " + str(attempt + 1) + ")" if attempt else "")
        pause(1.5, 2.5)
    # Last resort: place the text straight into whichever matching field will hold it.
    try:
        matches = page.locator(selector + ", input[type='password']") if "password" in selector else page.locator(selector)
        for index in range(min(matches.count(), 8)):
            candidate = matches.nth(index)
            if not candidate.is_visible():
                continue
            candidate.click()
            candidate.fill(text)
            pause(0.5, 1.0)
            if typed_length(candidate) == len(text):
                return candidate, "direct fill"
    except Exception:
        pass
    return field, "not accepted by the field"


def moved_on(page, field, before, seconds):
    """Waits for the page to react to a submit: a new address, the field going away, or an Amazon message appearing."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if page.url != before:
                return True
            if not field.is_visible():
                return True
            if first_visible(page, ERROR_BOX) is not None or first_visible(page, CAPTCHA) is not None:
                return True
        except Exception:
            return True  # the page is navigating
        time.sleep(0.5)
    return False


def submit(page, field, buttons):
    """Submit once, the way a person does: press Enter and wait for Amazon to answer.
    Only if nothing at all happens is the button clicked. Sending the form twice makes Amazon discard it."""
    before = page.url
    try:
        field.press("Enter")
    except Exception:
        pass
    if moved_on(page, field, before, 25):
        return "enter"
    how = "enter (no reaction)"
    if click_first(page, buttons):
        how = "enter, then button after 25s of nothing"
        if moved_on(page, field, before, 20):
            return how
    try:
        field.evaluate("(el) => { const f = el.closest('form'); if (f && f.requestSubmit) f.requestSubmit(); }")
        how += ", then asked the form to send itself"
        moved_on(page, field, before, 20)
    except Exception:
        pass
    return how


def click_first(page, selectors):
    for selector in selectors:
        target = first_visible(page, selector)
        if target is not None:
            target.click()
            return True
    return False


def snap(page):
    if current_job.get("shot"):
        return current_job["shot"]
    try:
        whole = bool(current_job.get("whole_page"))
        return base64.b64encode(page.screenshot(type="jpeg", quality=38 if whole else 45, full_page=whole)).decode()
    except Exception:
        return ""


page_events = []

LOOK_JS = """() => {
  const pw = document.querySelector('#ap_password, input[name=password]');
  const form = pw ? pw.closest('form') : null;
  const shown = (e) => e.offsetParent !== null;
  const btns = [...document.querySelectorAll('input[type=submit],button,[role=button],.a-button-input')].filter(shown).slice(0, 7)
    .map((e) => e.tagName + '#' + e.id + '[' + (e.type || '') + '] ' + (e.innerText || e.value || e.getAttribute('aria-labelledby') || '').trim().slice(0, 28));
  return {
    form: form ? { id: form.id, name: form.name, action: (form.getAttribute('action') || '').slice(0, 70), method: form.method } : null,
    field: pw ? { id: pw.id, type: pw.type, disabled: pw.disabled, readonly: pw.readOnly } : null,
    focus: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : '',
    buttons: btns,
    dialogs: document.querySelectorAll('[role=dialog],.a-popover-modal,.a-modal-scroller').length,
    frames: window.frames.length,
    webdriver: navigator.webdriver === true,
    cookies: navigator.cookieEnabled,
    scripts: document.scripts.length,
  };
}"""


def watch(page):
    """Keep a short list of page errors and failed downloads, so a stall can be explained without seeing the screen."""
    del page_events[:]

    def note(kind, text):
        if len(page_events) < 12:
            page_events.append(kind + ": " + " ".join(str(text).split())[:110])

    try:
        page.on("pageerror", lambda error: note("script error", error))
        page.on("requestfailed", lambda request: note("failed", request.url.split("?")[0][-70:] + " " + str(request.failure or "")))
        page.on("console", lambda message: note("console", message.text) if message.type == "error" else None)
    except Exception:
        pass


def look(page):
    try:
        found = json.dumps(page.evaluate(LOOK_JS))[:700]
    except Exception as failure:
        found = "could not inspect: " + str(failure)[:80]
    return " | inspection: " + found + " | events: " + ("; ".join(page_events) if page_events else "none")


FIELDS_JS = """() => {
  const shown = (e) => e.offsetParent !== null;
  const fields = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(shown).slice(0, 22)
    .map((e) => e.tagName.toLowerCase() + '#' + e.id + '(' + (e.name || '').slice(0, 45) + ')');
  const buttons = [...document.querySelectorAll('input[type=submit],button,[role=button],a.a-button-text')].filter(shown).slice(0, 10)
    .map((e) => '#' + e.id + ' ' + (e.innerText || e.value || e.getAttribute('aria-labelledby') || '').trim().slice(0, 30));
  return { at: location.pathname.slice(0, 70), title: document.title.slice(0, 60), fields, buttons };
}"""


def describe(page, words=160):
    """What the page is, in a form that can be fixed from: where it is, what it says, and which fields and buttons it shows."""
    try:
        found = json.dumps(page.evaluate(FIELDS_JS))[:1300]
    except Exception as failure:
        found = "could not inspect: " + str(failure)[:80]
    return " The page says: " + page_words(page, words) + " | inspection: " + found


def page_words(page, limit=220):
    """A short, readable sample of what the page says, so a stop can explain itself."""
    try:
        text = " ".join(page.locator("body").first.inner_text(timeout=4000).split())
        return text[:limit]
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
    steps = []
    for _ in range(10):
        url = page.url
        if visible(page, CAPTCHA):
            return "verification", "Amazon is showing a picture puzzle. Solve it once through the box's screen viewer."

        if "/ap/" not in url and SITE_MARK in url and not visible(page, EMAIL) and not visible(page, PASSWORD):
            greeting = ""
            try:
                greeting = page.locator("#nav-link-accountList-nav-line-1").first.inner_text(timeout=3000).strip().lower()
            except Exception:
                pass
            if REQUIRE_GREETING and "sign in" in greeting:
                return "needs_sign_in", "Amazon opened a page without the account's name on it, so sign-in could not be confirmed."
            return "signed_in", ""

        if visible(page, ERROR_BOX):
            message = " ".join(first_visible(page, ERROR_BOX).inner_text().split())[:200]
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
            if visible(page, "#auth-mfa-remember-device"):
                try:
                    page.locator("#auth-mfa-remember-device").first.check()
                except Exception:
                    pass
            field, how = type_checked(page, OTP, code["code"])
            steps.append("code by " + how + ":" + submit(page, field, ["#auth-signin-button", "input[type='submit']", "button[type='submit']"]))
            entered_code = True
        elif visible(page, PASSWORD):
            report(label, note="entering the password")
            if len([step for step in steps if step.startswith("password")]) >= 2:
                return "needs_sign_in", "Amazon stayed on the password page (" + ", ".join(steps) + "). The page says: " + page_words(page, 120) + look(page)
            if visible(page, "input[name='rememberMe']"):
                try:
                    page.locator("input[name='rememberMe']").first.check()
                except Exception:
                    pass
            field, how = type_checked(page, PASSWORD, secrets["password"])
            typed = typed_length(field)
            if typed != len(secrets["password"]):
                return "needs_sign_in", "The password field would not take the password (" + str(typed) + " of " + str(len(secrets["password"])) + " characters, " + how + "). The page says: " + page_words(page)
            steps.append("password typed " + str(typed) + " of " + str(len(secrets["password"])) + " by " + how + ", sent by " + submit(page, field, ["#signInSubmit", "input[type='submit']", "button[type='submit']"]))
            entered_password = True
        elif visible(page, EMAIL):
            report(label, note="entering the email")
            steps.append("email")
            if steps.count("email") > 2:
                return "needs_sign_in", "Amazon did not move past the email step. The page says: " + page_words(page)
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
            return "needs_sign_in", "Stopped on a page the worker does not know yet: " + title + ". The page says: " + page_words(page)

        pause(1.5, 2.5)
        try:
            page.wait_for_load_state("load", timeout=45000)
        except Exception:
            pass
        pause(2.0, 4.0)

    return "needs_sign_in", "Amazon kept asking for more steps (" + ", ".join(steps[-6:]) + "). The page says: " + page_words(page)


ERR_FILE = "/app/driver-errors.log"


def capture_stderr():
    """Send low-level error output to a file during a job, so the reason for a crash can be reported to DiceDrop."""
    try:
        saved = os.dup(2)
        handle = os.open(ERR_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.dup2(handle, 2)
        os.close(handle)
        return saved
    except Exception:
        return None


def restore_stderr(saved):
    detail = ""
    try:
        if saved is not None:
            os.dup2(saved, 2)
            os.close(saved)
        with open(ERR_FILE, "r", errors="replace") as handle:
            detail = " ".join(handle.read().split())[-500:]
    except Exception:
        pass
    return detail


class Stop(Exception):
    """A clean, explained stop: the message is shown to the operator as is."""


def run_in_account_browser(label, note, work, reason="", summary=None):
    """Opens the account's own Kameleo browser on its dedicated proxy, runs `work(page, secrets)`, and always
    takes a screenshot and closes the profile afterwards. Returns (result, error text, screenshot, outgoing ip)."""
    profile_id = ""
    result, error, shot, exit_ip = None, "", "", ""
    stage = ["getting ready"]
    opened_at = time.time()
    saved_stderr = capture_stderr()
    try:
        secrets = call("/api/worker/v1/accounts/secrets", {"account": label})
        if not secrets.get("password"):
            raise Stop("No Amazon password is saved for this account.")
        if not secrets.get("proxy") or not secrets["proxy"].get("host"):
            raise Stop("No dedicated proxy is attached to this account.")

        stage[0] = "installing the remote control"
        ensure_playwright()
        from playwright.sync_api import sync_playwright

        box_ip = direct_ip()
        stage[0] = "creating the device identity"
        profile_id = ensure_profile(label, secrets)
        note("opening the browser")

        stage[0] = "starting the remote control"
        with sync_playwright() as playwright:
            stage[0] = "connecting to the Kameleo browser"
            endpoint = "ws://" + KAMELEO.split("://", 1)[1] + "/playwright/" + profile_id
            browser = playwright.chromium.connect_over_cdp(endpoint_url=endpoint, timeout=600000)
            stage[0] = "opening a page"
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(30000)
            watch(page)
            try:
                stage[0] = "checking the proxy"
                note("checking the proxy")
                page.goto("https://api.ipify.org/?format=text", wait_until="domcontentloaded", timeout=60000)
                exit_ip = page.inner_text("body").strip()[:45]
                if not exit_ip or (box_ip and exit_ip == box_ip):
                    raise Stop("The proxy is not being used (the browser shows this box's own address). Stopped before opening Amazon.")
                report(label, exit_ip=exit_ip)
                result = work(page, secrets, stage)
            finally:
                shot = snap(page)
    except Stop as stop:
        error = str(stop)[:1800]
    except BaseException as failure:
        error = "While " + stage[0] + ": " + repr(failure)[:300]
        log("browser session ended unexpectedly while " + stage[0] + ": " + repr(failure)[:300])
    finally:
        low_level = restore_stderr(saved_stderr)
        if error and low_level and not error.startswith(("Amazon", "No ", "The proxy", "This item", "Out of stock")):
            error = error + " | details: " + low_level
        if profile_id:
            try:
                kameleo("POST", "/profiles/" + profile_id + "/stop", {})
            except Exception as failure:
                log("could not stop the profile cleanly: " + str(failure)[:200])
        # One line in the account's access log: when, why, and how it went.
        try:
            fine, outcome = (False, error) if error else (True, "done")
            if summary:
                fine, outcome = summary(result, error)
            call("/api/worker/v1/accounts/access", {"account": label, "reason": reason or "session", "ok": bool(fine),
                 "result": str(outcome or "")[:600], "exit_ip": exit_ip, "seconds": int(time.time() - opened_at)})
        except Exception as failure:
            log("could not write the access log: " + str(failure)[:200])
    return result, error, shot, exit_ip


def sign_in_job(label):
    try:
        current_job["text"] = "signing in " + label
        report(label, note="getting ready", error="")

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            return amazon_sign_in(page, label, secrets)

        result, error, shot, _ = run_in_account_browser(
            label, lambda text: report(label, note=text), work, reason="sign-in",
            summary=lambda r, e: (True, "signed in") if r and r[0] == "signed_in" and not e else (False, e or (r[1] if r and r[1] else "sign-in did not finish")))
        state, reason = result if result else ("needs_sign_in", "")
        error = error or reason
        report(label, session_state=state, error=error, note="signed in" if state == "signed_in" else "sign-in did not finish", screenshot=shot, done=True)
        log("sign-in for " + label + " finished: " + state + (" (" + error + ")" if error else ""))
    finally:
        current_job["text"] = ""
        job_lock.release()


# ---------------------------------------------------------------- cart-only run (never places an order)
#
# A cart-only run clears the cart, adds the item, opens checkout, adds the buyer's address there
# (Change -> Add a new delivery address -> Use this address), adds the gift note, reads the totals, takes a
# screenshot, and stops. A "place_order" run does the same and then buys, through place_order() and nothing else.
# Every general-purpose click helper refuses buy buttons.

CART_PAGE = "https://www.amazon.com/gp/cart/view.html"
NEVER_CLICK = ("place your order", "place order", "buy now", "placeyourorder", "turbo-checkout")

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def safe_click(page, selectors):
    """Clicks the first visible match, but refuses anything that looks like a buy button."""
    for selector in selectors:
        target = first_visible(page, selector)
        if target is None:
            continue
        try:
            described = " ".join([
                target.inner_text(timeout=2000) or "",
                target.get_attribute("value") or "",
                target.get_attribute("name") or "",
                target.get_attribute("aria-label") or "",
                target.get_attribute("id") or "",
            ]).lower()
        except Exception:
            described = ""
        if any(word in described for word in NEVER_CLICK):
            raise Stop("Refused to click a buy button (" + selector + "). This run never places orders.")
        target.click()
        return True
    return False


def click_text(page, texts):
    """Clicks a button or link by the words a person reads on it. Never a buy button."""
    for text in texts:
        if any(word in text.lower() for word in NEVER_CLICK):
            raise Stop("Refused to click \"" + text + "\". This run never places orders.")
        try:
            matches = page.get_by_text(text, exact=True)
            for index in range(min(matches.count(), 5)):
                candidate = matches.nth(index)
                if not candidate.is_visible():
                    continue
                # Amazon's yellow buttons are a caption with an invisible input laid over it. Click the real control.
                target = candidate
                try:
                    shell = candidate.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or contains(concat(' ', normalize-space(@class), ' '), ' a-button ')][1]")
                    if shell.count() > 0:
                        inner = shell.locator("input, button").first
                        target = inner if inner.count() > 0 else shell.first
                except Exception:
                    target = candidate
                try:
                    target.click(timeout=6000)
                except Exception:
                    target.click(timeout=6000, force=True)
                return True
        except Exception:
            continue
    return False


def settle(page):
    try:
        page.wait_for_load_state("domcontentloaded", timeout=45000)
    except Exception:
        pass
    pause(1.5, 3.0)


def pass_sign_in_wall(page, label, secrets):
    """Amazon sometimes asks for the password again before the cart, address book, or checkout."""
    for _ in range(4):
        if visible(page, CAPTCHA):
            raise Stop("Amazon is showing a picture puzzle. Solve it once through the box's screen viewer.")
        if "/ap/" not in page.url:
            return
        if visible(page, OTP):
            code = call("/api/worker/v1/totp", {"account": label})
            human_type(page, OTP, code["code"])
            click_first(page, ["#auth-signin-button", "input[type='submit']"])
        elif visible(page, PASSWORD):
            human_type(page, PASSWORD, secrets["password"])
            click_first(page, ["#signInSubmit", "input[type='submit']"])
        elif visible(page, EMAIL):
            human_type(page, EMAIL, secrets["login_email"])
            click_first(page, ["input#continue", "#continue input", "#continue", "input[type='submit']"])
        else:
            raise Stop("Amazon wants extra verification before continuing.")
        settle(page)
    if "/ap/" in page.url:
        raise Stop("Amazon kept asking to sign in again.")


def clear_cart(page, label, secrets):
    page.goto(CART_PAGE, wait_until="domcontentloaded", timeout=90000)
    settle(page)
    pass_sign_in_wall(page, label, secrets)
    for _ in range(20):
        if not safe_click(page, ["input[data-action='delete']", "span[data-action='delete'] input", "input[value='Delete']", "input[name^='submit.delete']"]):
            break
        pause(1.5, 2.5)


def add_to_cart(page, order):
    page.goto("https://www.amazon.com/dp/" + order["asin"] + "?th=1&psc=1", wait_until="domcontentloaded", timeout=90000)
    settle(page)
    if visible(page, CAPTCHA):
        raise Stop("Amazon is showing a picture puzzle on the product page.")
    if not visible(page, "#add-to-cart-button"):
        availability = ""
        try:
            availability = " ".join(page.locator("#availability").first.inner_text(timeout=3000).split())[:120]
        except Exception:
            pass
        raise Stop("Out of stock or not sold directly: no Add to Cart button on this item." + (" Amazon says: " + availability if availability else ""))
    quantity = int(order.get("quantity") or 1)
    if quantity > 1 and visible(page, "select#quantity"):
        try:
            page.locator("select#quantity").first.select_option(str(quantity))
            pause()
        except Exception:
            pass
    safe_click(page, ["#add-to-cart-button"])
    settle(page)
    # Decline the protection-plan offer if it appears.
    safe_click(page, ["#attachSiNoCoverage input", "#attachSiNoCoverage", "input[aria-labelledby='attachSiNoCoverage-announce']", "#siNoCoverage-announce"])
    pause()


def fill_field(page, selector, value):
    if value and visible(page, selector):
        human_type(page, selector, value)
        return True
    return False


def fill_by(page, selectors, label_text, value, required=True):
    """Fills a form field found by its id, or failing that by the label a person reads next to it."""
    if not value:
        return True
    target = None
    for selector in selectors:
        target = first_visible(page, selector)
        if target is not None:
            break
    if target is None:
        try:
            candidate = page.get_by_label(label_text, exact=False).first
            if candidate.is_visible():
                target = candidate
        except Exception:
            target = None
    if target is None:
        if required:
            raise Stop("Could not find the \"" + label_text + "\" field on Amazon's address form." + describe(page))
        return False
    target.click()
    pause(0.2, 0.5)
    target.fill("")
    target.press_sequentially(value, delay=random.randint(60, 130))
    pause(0.4, 0.9)
    return True


def delivery_change_link(page):
    """The "Change" link that belongs to the delivery address, never the one next to the payment method.
    Found by position: it is the "Change" sitting level with the "Delivering to ..." heading."""
    for selector in ["#addressChangeLinkId", "a[data-testid='Address_selectChangeAddress']"]:
        target = first_visible(page, selector)
        if target is not None:
            return target
    try:
        heading = None
        for words in ["Delivering to", "Shipping to", "Deliver to"]:
            matches = page.get_by_text(words, exact=False)
            for index in range(min(matches.count(), 6)):
                if matches.nth(index).is_visible():
                    heading = matches.nth(index)
                    break
            if heading is not None:
                break
        if heading is None:
            return None
        anchor = heading.bounding_box()
        if not anchor:
            return None
        best, best_gap = None, 9999
        links = page.get_by_text("Change", exact=True)
        for index in range(min(links.count(), 12)):
            link = links.nth(index)
            if not link.is_visible():
                continue
            box = link.bounding_box()
            if not box:
                continue
            gap = abs((box["y"] + box["height"] / 2) - (anchor["y"] + anchor["height"] / 2))
            if gap < best_gap:
                best, best_gap = link, gap
        if best is not None and best_gap <= 120:
            return best
    except Exception:
        pass
    return None


def wait_for_checkout(page, seconds=30):
    """The checkout page fills in its delivery section a moment after it opens. Wait for it."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if (delivery_change_link(page) is not None or visible(page, "#add-new-address-popover-link")
                or visible(page, "#address-ui-widgets-enterAddressFullName")):
            return True
        try:
            if page.get_by_text("Add a new delivery address", exact=False).first.is_visible():
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def add_address_at_checkout(page, ship):
    """On the checkout page: Change (delivery) -> Add a new delivery address -> fill the form -> Use this address."""
    prefix = "#address-ui-widgets-enterAddress"
    add_new = ["#add-new-address-popover-link", "#add-new-address-desktop-sasp-tango-link", "a:has-text('Add a new delivery address')", "a:has-text('Add a new address')"]
    form_open = lambda: visible(page, prefix + "FullName") or visible(page, prefix + "Line1")

    def delivering_to_buyer():
        try:
            for words in ["Delivering to " + ship["name"], "Shipping to " + ship["name"]]:
                if page.get_by_text(words, exact=False).first.is_visible():
                    return True
        except Exception:
            pass
        return False

    if delivering_to_buyer():
        return "already set"

    if not form_open():
        if not any(visible(page, selector) for selector in add_new):
            link = delivery_change_link(page)
            if link is None:
                raise Stop("Could not find the delivery \"Change\" link on Amazon's checkout page." + describe(page))
            link.click()
            settle(page)
        # If this buyer's address is already saved on the account, pick it instead of adding it a second time.
        try:
            saved = page.get_by_text(ship["name"], exact=True)
            for index in range(min(saved.count(), 6)):
                entry = saved.nth(index)
                if not entry.is_visible():
                    continue
                row = entry.locator("xpath=ancestor::*[contains(., '" + ship["postal_code"][:5] + "')][1]")
                if row.count() == 0:
                    continue
                entry.click()
                pause(0.6, 1.2)
                if click_text(page, ["Deliver to this address", "Use this address", "Ship to this address"]) or safe_click(page, ["#shipToThisAddressButton input", "input[data-testid='Address_selectShipToThisAddress']"]):
                    settle(page)
                    for _ in range(20):
                        if delivering_to_buyer():
                            return "picked the saved address"
                        time.sleep(0.5)
                break
        except Exception:
            pass
        if not form_open() and not safe_click(page, add_new):
            raise Stop("Could not find \"Add a new delivery address\" on Amazon's checkout page." + describe(page))
        for _ in range(20):
            if form_open():
                break
            time.sleep(0.5)
    pause(1.0, 2.0)

    def choose_state():
        state = (ship.get("state") or "").upper()
        for selector in ["select#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId", "select[name='address-ui-widgets-enterAddressStateOrRegion']"]:
            try:
                if page.locator(selector).count() > 0:
                    page.locator(selector).first.select_option(state, force=True)
                    return True
            except Exception:
                continue
        try:
            page.get_by_label("State", exact=True).first.select_option(state)
            return True
        except Exception:
            pass
        if visible(page, "#address-ui-widgets-enterAddressStateOrRegion"):
            first_visible(page, "#address-ui-widgets-enterAddressStateOrRegion").click()
            pause()
            option = page.locator("a.a-dropdown-link", has_text=STATES.get(state, state)).first
            if option.is_visible():
                option.click()
                return True
        return False

    def step_away():
        """Close Amazon's address suggestions by clicking the form's own title. Escape would close the whole form."""
        for words in ["Enter a new shipping address", "Add an address", "Full name (First and Last name)"]:
            try:
                title = page.get_by_text(words, exact=False).first
                if title.is_visible():
                    title.click()
                    pause(0.4, 0.8)
                    return
            except Exception:
                continue

    fill_by(page, [prefix + "FullName"], "Full name", ship["name"])
    fill_by(page, [prefix + "PhoneNumber"], "Phone number", ship.get("phone") or "5125550100", required=False)
    # The street goes in first; Amazon then offers suggestions. Click away from them, then set the rest by hand
    # so the city, state, and ZIP are exactly what the buyer gave.
    fill_by(page, [prefix + "Line1"], "Street address", ship["line1"])
    step_away()
    if not form_open():
        raise Stop("Amazon's address form closed while it was being filled in." + describe(page))
    fill_by(page, [prefix + "Line2"], "Unit or suite number", ship.get("line2") or "", required=False)
    step_away()
    fill_by(page, [prefix + "City"], "City", ship["city"])
    if not choose_state():
        raise Stop("Could not choose the state on Amazon's address form." + describe(page))
    pause(0.4, 0.8)
    fill_by(page, [prefix + "PostalCode"], "ZIP Code", ship["postal_code"])
    step_away()
    # Make sure a suggestion did not overwrite the street.
    try:
        street = first_visible(page, prefix + "Line1")
        if street is not None and street.input_value(timeout=2000).strip().lower() != ship["line1"].strip().lower():
            fill_by(page, [prefix + "Line1"], "Street address", ship["line1"])
            step_away()
    except Exception:
        pass
    pause()

    if not safe_click(page, ["#address-ui-widgets-form-submit-button input", "#address-ui-widgets-form-submit-button", "input[aria-labelledby='address-ui-widgets-form-submit-button-announce']", "span:has-text('Use this address') input", "input[type='submit'][aria-labelledby*='submit-button']"]):
        raise Stop("Could not find \"Use this address\" on Amazon's address form." + describe(page))
    settle(page)
    # Amazon may suggest a corrected address. Keep what the buyer gave.
    if safe_click(page, ["input[name='address-ui-widgets-saveOriginalOrSuggestedAddress']", "#address-ui-widgets-original-address-block_id-input"]):
        settle(page)
    for _ in range(30):
        if not form_open():
            break
        time.sleep(0.5)
    if form_open():
        message = ""
        try:
            message = " ".join(first_visible(page, ".a-alert-error, .a-box.a-alert-inline-error, .a-alert-inline-error").inner_text(timeout=3000).split())[:200]
        except Exception:
            pass
        raise Stop("Address not found: Amazon did not accept the buyer's address." + (" Amazon says: " + message if message else describe(page)))
    settle(page)
    # Some layouts return to the address list with the new one selected and a confirm button.
    safe_click(page, ["#shipToThisAddressButton input", "input[data-testid='Address_selectShipToThisAddress']", "input[aria-labelledby='shipToThisAddressButton-announce']", "span:has-text('Deliver to this address') input"])
    settle(page)
    first_name = ship["name"].split()[0]
    try:
        body = page.locator("body").first.inner_text(timeout=6000)
    except Exception:
        body = ""
    if first_name.lower() not in body.lower():
        raise Stop("The address was sent, but the checkout page does not show the buyer's name yet." + describe(page))


def add_gift(page, gift):
    """Marks the order as a gift: "Add gift options" -> message and sender -> save. Works only inside the popup.
    Returns a short note. If Amazon does not offer gift options for the item, the run simply carries on."""
    if not gift or not gift.get("enabled") or not (gift.get("message") or "").strip():
        return "gift off"
    if not click_text(page, ["Add gift options", "Change gift options", "Add a gift receipt for easy returns"]):
        return "gift not offered"
    message_box = None
    for attempt in range(24):
        message_box = first_visible(page, "textarea[id*='message' i], textarea[name*='message' i], textarea")
        if message_box is not None:
            break
        if attempt == 8:
            # Some layouts want "this is a gift" ticked before the message box appears.
            try:
                tick = page.get_by_label("gift", exact=False).first
                if tick.is_visible():
                    tick.check()
            except Exception:
                pass
        time.sleep(0.5)
    if message_box is None:
        raise Stop("The gift options opened, but there is no message box." + describe(page))
    pause(0.6, 1.2)

    sender = None
    for selector in ["input[id*='sender' i]", "input[name*='sender' i]", "input[id*='gift' i][id*='from' i]", "input[name*='from' i]", "input[aria-label*='From' i]", "input[placeholder*='From' i]"]:
        sender = first_visible(page, selector)
        if sender is not None:
            break
    if sender is None:
        try:
            candidate = page.get_by_label("From", exact=False).first
            if candidate.is_visible():
                sender = candidate
        except Exception:
            sender = None

    text = gift["message"].strip()
    who = (gift.get("from") or "").strip()
    if sender is None and who:
        text = text + " From " + who
    message_box.click()
    pause(0.2, 0.5)
    message_box.fill("")
    message_box.press_sequentially(text, delay=random.randint(40, 90))
    pause(0.4, 0.8)
    if sender is not None and who:
        sender.click()
        pause(0.2, 0.4)
        sender.fill("")
        sender.press_sequentially(who, delay=random.randint(50, 110))
        pause(0.4, 0.8)

    saved = click_text(page, ["Save gift options", "Save gift options and continue", "Save and continue", "Save"]) or safe_click(page, [
        "input[aria-labelledby*='gift' i][type='submit']", "span[id*='gift' i][id*='save' i] input", "input[name*='gift' i][type='submit']"])
    if not saved:
        raise Stop("Could not find the save button in the gift options." + describe(page))
    for _ in range(30):
        try:
            if not message_box.is_visible():
                break
        except Exception:
            break
        time.sleep(0.5)
    else:
        raise Stop("The gift options did not close after saving." + describe(page))
    settle(page)
    return "gift added" + ("" if sender is not None or not who else " (sender written into the message)")


FRAME_FIELDS_JS = """() => {
  const shown = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
  const key = (e) => [e.id, e.name, e.getAttribute('autocomplete'), e.getAttribute('placeholder'), e.getAttribute('aria-label'),
    (e.labels && e.labels[0] ? e.labels[0].innerText : '')].filter(Boolean).join(' | ').slice(0, 120);
  return {
    fields: [...document.querySelectorAll('input:not([type=hidden]),select')].filter(shown).slice(0, 14).map((e, i) => ({ i, tag: e.tagName.toLowerCase(), type: e.type || '', key: key(e) })),
    buttons: [...document.querySelectorAll('button,input[type=submit],[role=button],a.a-button-text')].filter(shown).slice(0, 10).map((e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 30)),
    says: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 260),
  };
}"""

CARD_KEYS = {
    "number": ["cardnumber", "card-number", "card number", "cc-number", "ccnumber", "creditcardnumber", "card_number"],
    "cvv": ["cvv", "cvc", "csc", "security code", "securitycode", "security-code", "card verification"],
    "exp": ["expir", "exp-date", "expdate", "mm/yy", "mm / yy", "cc-exp"],
    "month": ["expmonth", "exp-month", "exp_month", "cc-exp-month", "month"],
    "year": ["expyear", "exp-year", "exp_year", "cc-exp-year", "year"],
    "name": ["name on card", "cardholder", "cc-name", "accountholdername", "card holder"],
    "zip": ["zip", "postal"],
}


def verify_payment(page, label):
    """Amazon's "Verify payment" page asks to confirm the card. Look through the page and its frames for the
    fields it shows, fill the ones this account has saved card details for, and submit once.
    Returns a short note of what happened. Card details are never written to the log or sent anywhere but Amazon."""
    seen = []
    target, layout = None, None
    # Amazon often passes through this address for a second on its way to the confirmation page.
    for _ in range(4):
        time.sleep(1)
        if "/cpe/" not in page.url.lower():
            return ""
    for _ in range(30):
        if "/cpe/" not in page.url.lower():
            return ""
        for frame in page.frames:
            try:
                found = frame.evaluate(FRAME_FIELDS_JS)
            except Exception:
                continue
            if found.get("fields"):
                target, layout = frame, found
                break
        if target is not None:
            break
        time.sleep(1)
    try:
        for frame in page.frames:
            try:
                found = frame.evaluate(FRAME_FIELDS_JS)
                seen.append({"frame": frame.url.split("?")[0][-60:], "fields": [f["tag"] + ":" + f["type"] + " " + f["key"] for f in found.get("fields", [])], "buttons": found.get("buttons", []), "says": found.get("says", "")[:200]})
            except Exception:
                continue
    except Exception:
        pass
    current_job["verify_seen"] = json.dumps(seen)[:1800]
    if target is None:
        return "Amazon asked to verify the payment, but showed no fields to fill in (it may want an approval from the bank or card app)"

    card = call("/api/worker/v1/accounts/card", {"account": label})
    if not card.get("saved"):
        return "Amazon asked to verify the card, and this account has no card details saved"

    month, year = str(card.get("exp_month", "")), str(card.get("exp_year", ""))
    values = {"number": card.get("number", ""), "cvv": card.get("cvv", ""), "exp": month + "/" + year[-2:], "month": month, "year": year,
              "name": card.get("name") or "", "zip": card.get("zip") or ""}
    filled, last = [], None
    inputs = target.locator("input:not([type=hidden]), select")
    for field in layout["fields"]:
        described = field["key"].lower()
        kind = ""
        for name in ["number", "cvv", "month", "year", "exp", "name", "zip"]:
            if any(word in described for word in CARD_KEYS[name]):
                kind = name
                break
        if not kind or not values.get(kind) or kind in filled:
            continue
        try:
            visible_inputs = [inputs.nth(i) for i in range(min(inputs.count(), 40)) if inputs.nth(i).is_visible()]
            element = visible_inputs[field["i"]]
            if field["tag"] == "select":
                choice = values[kind]
                for option in [choice, choice.lstrip("0"), choice[-2:]]:
                    try:
                        element.select_option(option)
                        break
                    except Exception:
                        continue
            else:
                element.click()
                pause(0.2, 0.5)
                element.fill("")
                element.press_sequentially(values[kind], delay=random.randint(60, 120))
                last = element
            filled.append(kind)
            pause(0.4, 0.9)
        except Exception:
            continue
    if not filled:
        return "Amazon asked to verify the payment with fields the worker does not recognize yet"
    pause(0.6, 1.2)
    sent = False
    for words in ["Verify", "Continue", "Submit", "Confirm", "Verify card", "Save", "Done"]:
        try:
            button = target.get_by_role("button", name=words, exact=True).first
            if button.is_visible():
                button.click()
                sent = True
                break
        except Exception:
            continue
    if not sent and last is not None:
        try:
            last.press("Enter")
            sent = True
        except Exception:
            pass
    return "payment verified with the saved card (" + ", ".join(filled) + ")" + ("" if sent else ", but no button to send it was found")


ORDER_NUMBER = r"\b\d{3}-\d{7}-\d{7}\b"


def order_numbers(view):
    import re

    try:
        return set(re.findall(ORDER_NUMBER, view.url + " " + view.content()))
    except Exception:
        return set()


def place_order(page, label=""):
    """The ONLY place in this worker that buys. It runs only for a "place_order" run.
    It clicks Place your order once (and confirms Amazon's duplicate page once if that appears).
    The order counts as placed as soon as either Amazon's confirmation page shows, or a new order number
    appears in the account's order history, which is checked every 15 seconds in a second tab.
    Returns the Amazon order number."""
    import re

    expected = ""
    match = re.search(r"p-(\d{3}-\d{7}-\d{7})", page.url)
    if match:
        expected = match.group(1)

    # Note which orders the account already has, so the new one can be recognized.
    history, known = None, set()
    try:
        history = page.context.new_page()
        history.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        known = order_numbers(history)
        page.bring_to_front()
    except Exception:
        history = None

    button = first_visible(page, "#placeOrder, input[name='placeYourOrder1']")
    if button is None:
        raise Stop("Could not find Amazon's Place your order button. Nothing was ordered." + describe(page))
    current_job["place_clicked"] = True
    button.click()

    def new_in_history():
        if history is None:
            return ""
        try:
            history.reload(wait_until="domcontentloaded", timeout=45000)
            time.sleep(1.5)
            fresh = order_numbers(history) - known
        except Exception:
            return ""
        # The number in the checkout address is Amazon's purchase id, not the order number: never use it.
        fresh.discard(expected)
        if not fresh:
            return ""
        return sorted(fresh)[0]

    order_id = ""
    on_confirmation = False
    confirmed_duplicate = False
    verify_tried = False
    started = time.time()
    last_look = started
    deadline = started + 240
    while time.time() < deadline and not order_id and not on_confirmation:
        time.sleep(1)
        try:
            address = page.url.lower()
            words = page_words(page, 600).lower()
        except Exception:
            continue
        if "thankyou" in address or "order placed" in words or "your order has been placed" in words or "thank you, your order" in words:
            on_confirmation = True
            break
        if "/duplicateorder" in address and not confirmed_duplicate:
            # Amazon noticed a recent order for the same item and holds this one as "pending" until it is confirmed.
            # Selling the same item to more than one buyer is normal here, so confirm it. This is done once.
            again = first_visible(page, "#placeOrder, input[name='placeYourOrder1']")
            if again is not None:
                pause(1.0, 2.0)
                again.click()
                confirmed_duplicate = True
                current_job["duplicate_confirmed"] = True
                deadline = time.time() + 240
        if "/cpe/" in address and not verify_tried:
            # "Verify payment": answer it before doing anything else, or Amazon cancels the order later.
            verify_tried = True
            try:
                current_job["verify_note"] = verify_payment(page, label)
            except Exception as failure:
                current_job["verify_note"] = "payment verification could not be completed: " + str(failure)[:120]
            log("verify payment: " + str(current_job.get("verify_note")))
            deadline = max(deadline, time.time() + 120)
            last_look = time.time()  # give Amazon a moment to take the answer before leaving this page
            continue
        if time.time() - last_look >= 15:
            last_look = time.time()
            order_id = new_in_history()

    if on_confirmation:
        settle(page)
        try:
            import re
            said = re.search(r"((?:Arriving|Delivery|Estimated delivery|Delivering)\s*:?\s*[A-Z][a-z]+\.?,?\s+[A-Za-z]{3,9}\.?\s+\d{1,2}(?:\s*-\s*(?:[A-Za-z]{3,9}\.?\s+)?\d{1,2})?)", page_words(page, 3000))
            current_job["thankyou_estimate"] = " ".join(said.group(1).split())[:90] if said else ""
        except Exception:
            current_job["thankyou_estimate"] = ""
        # The real order number is the new one in Your Orders. The confirmation page's address carries the
        # purchase id (it looks like an order number and is not one), so that is left out.
        for _ in range(36):
            order_id = new_in_history()
            if order_id:
                break
            time.sleep(5)
        if not order_id:
            shown = order_numbers(page) - known - {expected}
            if len(shown) == 1:
                order_id = sorted(shown)[0]
        if not order_id:
            log("order placed, but its number is not in Your Orders yet; purchase id " + str(expected))
    elif not order_id:
        time.sleep(5)
        order_id = new_in_history()

    if not on_confirmation and not order_id:
        stopped_on = describe(page)
        raise Stop("Place your order was clicked, but no confirmation page and no new order in the order history after 4 minutes. The order MAY have been placed. Amazon stopped on:" + stopped_on)

    try:
        if history is not None:
            history.close()
    except Exception:
        pass
    return order_id


ESTIMATE_JS = """() => {
  const starts = /^(Arriving|Now expected|Expected|Delivered|Delivery estimate|Not yet shipped|Shipped|Out for delivery|Order received|Preparing for shipment)/i;
  const shown = (e) => e.offsetParent !== null;
  for (const e of document.querySelectorAll('h1,h2,h3,h4,[class*="primary-status" i],[class*="promise" i]')) {
    const t = (e.innerText || '').trim().replace(/\\s+/g, ' ');
    if (shown(e) && t.length < 90 && starts.test(t)) return t;
  }
  return '';
}"""


def click_text_in(scope, texts):
    """Like click_text, but only inside one part of the page (for example, one order's card)."""
    for text in texts:
        if any(word in text.lower() for word in NEVER_CLICK):
            raise Stop("Refused to click \"" + text + "\".")
        try:
            matches = scope.get_by_text(text, exact=True)
            for index in range(min(matches.count(), 4)):
                candidate = matches.nth(index)
                if not candidate.is_visible():
                    continue
                target = candidate
                try:
                    shell = candidate.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or contains(concat(' ', normalize-space(@class), ' '), ' a-button ')][1]")
                    if shell.count() > 0:
                        inner = shell.locator("input, button, a").first
                        target = inner if inner.count() > 0 else shell.first
                except Exception:
                    target = candidate
                try:
                    target.click(timeout=6000)
                except Exception:
                    target.click(timeout=6000, force=True)
                return True
        except Exception:
            continue
    return False


def capture_tracking(page, order_id):
    """After an order is placed: open that exact order on Amazon and take its picture. Keeps trying until the
    order itself is on screen (a brand-new order can take a minute to show, and Amazon sometimes answers
    "We're unable to load your order details"). Returns the delivery estimate. A picture is only ever taken of a
    page that shows this order. Never raises: the order is already placed."""
    estimate = ""
    current_job["shot"] = ""
    if not order_id:
        log("after ordering: Amazon did not show an order number, so the picture is left to the next order check")
        return estimate
    try:
        import re

        kind, card_words = open_order(page, order_id, tries=10, wait=12.0)
        if not kind:
            log("after ordering: order " + str(order_id) + " could not be opened on Amazon yet; the next order check takes its picture")
            return estimate
        if kind == "track":
            for _ in range(20):
                try:
                    seen = page.evaluate(ESTIMATE_JS)
                except Exception:
                    seen = ""
                if seen:
                    estimate = seen
                    break
                time.sleep(0.5)
            pause(1.0, 2.0)
            current_job["shot"] = picture(page, card_only=True)
        elif kind == "details":
            found = re.search(DATE_RE, page_words(page, 6000))
            estimate = " ".join(found.group(1).split())[:90] if found else ""
            current_job["shot"] = picture(page, card_only=False)
        else:  # the order's own card in Your Orders
            found = re.search(DATE_RE, card_words)
            estimate = " ".join(found.group(1).split())[:90] if found else ""
            card = order_card(page, order_id)
            if card is not None:
                card.scroll_into_view_if_needed(timeout=5000)
                current_job["shot"] = base64.b64encode(card.screenshot(type="jpeg", quality=70)).decode()
        if not estimate and card_words:
            found = re.search(DATE_RE, card_words)
            estimate = " ".join(found.group(1).split())[:90] if found else ""
        log("after ordering: order " + str(order_id) + " opened (" + kind + "), picture " + ("taken" if current_job.get("shot") else "missing"))
    except Exception as failure:
        log("could not capture the order picture: " + str(failure)[:200])
    return estimate


# ---------------------------------------------------------------- the regular look at placed orders

STATUS_JS = """() => {
  const names = ['Ordered', 'Shipped', 'Out for delivery', 'Delivered', 'On the way', 'Arriving today', 'Cancelled', 'Canceled', 'Not yet shipped', 'Preparing for shipment', 'Delayed', 'Running late', 'Undeliverable', 'Returned'];
  const shown = (e) => e.offsetParent !== null;
  for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,[class*="milestone-primary" i],[class*="primary-status" i]')) {
    const t = (e.innerText || '').trim().replace(/\\s+/g, ' ');
    if (shown(e) && names.some((n) => t.toLowerCase() === n.toLowerCase())) return t;
  }
  return '';
}"""


def order_card(page, amazon_order_id):
    for selector in [".order-card", ".js-order-card", ".a-box-group", "li.order-card__list"]:
        try:
            found = page.locator(selector).filter(has_text=amazon_order_id)
            if found.count() > 0:
                return found.first
        except Exception:
            continue
    return None


CANCELLED = r"(?:orders?|items?|shipments?)\s+(?:has|have|was|were)\s+(?:been\s+)?cancell?ed|cancell?ed\s+by|we(?:'ve| have)?\s+cancell?ed|you(?:'ve| have)?\s+cancell?ed|your order was cancell?ed"


def cancel_words(words):
    """The sentence Amazon uses to say an order was cancelled, or "" when the page does not say that.
    The "Cancelled Orders" tab and "Cancel items" buttons do not count."""
    import re

    found = re.search(r"[^.!?]{0,70}(?:" + CANCELLED + r")[^.!?]{0,90}[.!?]?", words, re.I)
    return " ".join(found.group(0).split())[:180] if found else ""


def state_from_words(words, short=False):
    """`short` is for a small piece of text such as one order's card or a status heading, where the single
    word "Cancelled" is the status. For a whole page, only a full cancellation sentence counts."""
    import re

    low = words.lower()
    if cancel_words(words) or (short and re.search(r"\bcancell?ed\b(?!\s+orders)", low)):
        return "cancelled"
    if "delivered" in low and "not delivered" not in low and "to be delivered" not in low:
        return "delivered"
    if any(word in low for word in ["shipped", "on the way", "out for delivery", "arriving today", "in transit"]) and "not yet shipped" not in low:
        return "shipped"
    return "ordered"


def picture(page, card_only=True):
    """A picture of the tracking card if there is one, otherwise the top of the page."""
    if card_only:
        try:
            heading = page.locator("text=/^(Arriving|Now expected|Expected|Delivered|Not yet shipped|Out for delivery|Shipped|On the way)/").first
            block = heading.locator("xpath=ancestor::*[contains(., 'Shipped') and contains(., 'Delivered')][1]")
            if block.count() > 0 and block.first.is_visible():
                return base64.b64encode(block.first.screenshot(type="jpeg", quality=70)).decode()
        except Exception:
            pass
    try:
        page.evaluate("window.scrollTo(0, 0)")
        return base64.b64encode(page.screenshot(type="jpeg", quality=55, full_page=False)).decode()
    except Exception:
        return ""


ORDER_DETAILS = "https://www.amazon.com/gp/your-account/order-details?orderID="


def read_tracking(page, result, card_words=""):
    """Reads the opened Track package page into `result`: state, delivery window, tracking number, carrier, picture."""
    import re

    settle(page)
    status, estimate = "", ""
    for _ in range(20):
        try:
            status = page.evaluate(STATUS_JS)
            estimate = page.evaluate(ESTIMATE_JS)
        except Exception:
            pass
        if status or estimate:
            break
        time.sleep(0.5)
    pause(1.0, 2.0)
    words = page_words(page, 2500)
    result["state"] = state_from_words(status or estimate or card_words, short=True)
    result["delivery_estimate"] = estimate[:90]
    result["note"] = (status or estimate)[:120]
    found = re.search(r"Tracking (?:ID|number|#)\s*:?\s*([A-Z0-9]{8,34})", words, re.I)
    if found:
        result["tracking_number"] = found.group(1)
    found = re.search(r"(?:Shipped with|Delivery by|Carrier:?)\s+([A-Za-z][A-Za-z .&-]{1,28}?)(?=\s+(?:Tracking|See|Your|$))", words)
    if found:
        result["carrier"] = found.group(1).strip()
    result["screenshot"] = picture(page, card_only=True)
    return result


DATE_RE = r"((?:Arriving|Now expected|Expected|Delivery estimate|Estimated delivery|Delivery|Delivered):?\s+(?:today|tomorrow|[^.|\d]{0,30}?\d{1,2}(?:\s*-\s*(?:[A-Za-z]+\.?\s+)?\d{1,2})?))"


def order_page_ok(page, number, tracking=False):
    """True only when the page on screen really shows this order (not Amazon's "unable to load" page)."""
    try:
        low = page_words(page, 4000).lower()
        if "unable to load" in low:
            return False
        if number in page.url or number in page.content():
            return True
        if tracking:
            return bool(page.evaluate(STATUS_JS) or page.evaluate(ESTIMATE_JS))
    except Exception:
        pass
    return False


def open_order(page, number, tries=2, wait=6.0):
    """Gets one specific order on screen, the way a person would: Your Orders, that order, Track package
    (or View order details). Tries again when the order is not showing yet or Amazon says it cannot load it.
    Returns (kind, the order card's words). kind is "track", "details", "list" (only the order's card in
    Your Orders could be shown) or "" when the order could not be seen at all."""
    card_words = ""
    for attempt in range(tries):
        last = attempt == tries - 1
        try:
            page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
            settle(page)
            card = order_card(page, number)
            if card is not None:
                try:
                    card_words = " ".join(card.inner_text(timeout=5000).split())
                except Exception:
                    card_words = ""
                if state_from_words(card_words, short=True) != "cancelled" and click_text_in(card, ["Track package", "Track Package"]):
                    settle(page)
                    if order_page_ok(page, number, tracking=True):
                        return "track", card_words
                    page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
                    settle(page)
                    card = order_card(page, number)
                if card is not None and click_text_in(card, ["View order details", "Order details", "View order"]):
                    settle(page)
                    if order_page_ok(page, number):
                        return "details", card_words
                if last:
                    page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
                    settle(page)
                    if order_card(page, number) is not None:
                        return "list", card_words
            else:
                log("order " + number + " is not in the list; orders listed: " + ", ".join(sorted(order_numbers(page)))[:200])
                # Not on the first page of Your Orders (older order), or too new to be listed: its own address.
                page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
                settle(page)
                if order_page_ok(page, number):
                    try:
                        if state_from_words(page_words(page, 6000)) != "cancelled" and click_text(page, ["Track package", "Track Package"]):
                            settle(page)
                            if order_page_ok(page, number, tracking=True):
                                return "track", card_words
                            page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
                            settle(page)
                    except Stop:
                        raise
                    except Exception:
                        pass
                    if order_page_ok(page, number):
                        return "details", card_words
        except Stop:
            raise
        except Exception as failure:
            log("opening order " + number + ": " + str(failure)[:160])
        log("order " + number + " is not showing on Amazon yet (try " + str(attempt + 1) + " of " + str(tries) + ")")
        if not last:
            time.sleep(wait)
    return "", card_words


def check_order(page, order):
    """Looks one placed order up on Amazon the way a person would: Your Orders, that order, Track package.
    Returns what Amazon shows: state (ordered, shipped, delivered, cancelled), the delivery estimate, the
    tracking number and carrier when shown, a short note, and a picture. The picture is only ever of a page
    that shows this order; when the order cannot be opened, nothing is reported as changed."""
    import re

    number = order["amazon_order_id"]
    result = {"state": order.get("status") if order.get("status") in ("ordered", "shipped") else "ordered",
              "delivery_estimate": "", "tracking_number": "", "carrier": "", "note": "", "screenshot": ""}

    kind, card_words = open_order(page, number, tries=3, wait=6.0)
    if not kind:
        log("order " + number + " could not be opened on Amazon this time; it is checked again next round")
        return result
    if kind == "track":
        result["state"] = "ordered"
        return read_tracking(page, result, card_words)

    words = card_words if kind == "list" else page_words(page, 6000)
    from_card = state_from_words(card_words, short=True) if card_words else "ordered"
    result["state"] = from_card if from_card != "ordered" else state_from_words(words, short=(kind == "list"))
    if result["state"] == "cancelled":
        result["note"] = ""  # the status itself says it: Cancelled by Amazon
    else:
        found = re.search(r"((?:Delivered|Shipped|On the way|Out for delivery)[^.]{0,60})", card_words + " " + words)
        result["note"] = found.group(1).strip()[:120] if found else ""
        dated = re.search(DATE_RE, card_words + " " + words)
        if dated:
            result["delivery_estimate"] = " ".join(dated.group(1).split())[:90]
        else:
            log("no delivery date found for " + number + " (" + kind + "); the page says: " + " ".join(words.split())[:700])
    if kind == "list":
        try:
            card = order_card(page, number)
            card.scroll_into_view_if_needed(timeout=5000)
            result["screenshot"] = base64.b64encode(card.screenshot(type="jpeg", quality=70)).decode()
        except Exception:
            result["screenshot"] = ""
    else:
        result["screenshot"] = picture(page, card_only=False)
    return result


def tracking_job(job):
    label = job.get("account_label") or ""
    orders = job.get("orders") or []
    problem = ""
    try:
        current_job["text"] = "checking orders on " + label

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            state, reason = amazon_sign_in(page, label, secrets)
            if state != "signed_in":
                report(label, session_state=state, error=reason, note="sign-in did not finish")
                raise Stop("Amazon sign-in did not finish. " + reason)
            report(label, session_state="signed_in", error="")
            changes = 0
            for order in orders:
                stage[0] = "checking order " + str(order.get("order_number"))
                try:
                    seen = check_order(page, order)
                    # The picture always goes along; DiceDrop keeps it the first time each milestone is seen.
                    reply = call("/api/worker/v1/orders/" + order["id"] + "/check", seen)
                    log("order " + str(order.get("order_number")) + " on Amazon: " + seen["state"] + (" · " + seen["note"] if seen["note"] else ""))
                    changes += 1 if reply.get("changed") else 0
                except Stop:
                    raise
                except Exception as failure:
                    log("could not check order " + str(order.get("order_number")) + ": " + str(failure)[:200])
                pause(2.0, 4.0)
            return changes

        _, problem, _, _ = run_in_account_browser(
            label, lambda text: None, work, reason="order check",
            summary=lambda r, e: (False, e) if e else (True, "checked " + str(len(orders)) + " order" + ("" if len(orders) == 1 else "s") + " · " + str(r or 0) + " changed"))
    except Exception as failure:
        problem = "The order check could not run: " + str(failure)[:200]
    finally:
        try:
            call("/api/worker/v1/accounts/checked", {"account": label, "error": problem})
        except Exception as failure:
            log("could not record the order check: " + str(failure)[:200])
        ship_log("job", "order check " + label)
        current_job["text"] = ""
        job_lock.release()


def read_totals(page):
    import re

    text = ""
    for selector in ["#subtotals-marketplace-table", "#subtotals", "[data-testid='order-summary']", "#spc-order-summary", "#checkout-order-summary"]:
        try:
            if page.locator(selector).count() > 0:
                text = " ".join(page.locator(selector).first.inner_text(timeout=4000).split())
                if text:
                    break
        except Exception:
            continue
    totals = {"raw": text[:400]}

    def money(pattern):
        match = re.search(pattern + r"[^$]*\$\s*([0-9,]+\.[0-9]{2})", text, re.I)
        return float(match.group(1).replace(",", "")) if match else None

    totals["items"] = money(r"items?(?:\s*\(\d+\))?:?")
    totals["shipping"] = money(r"shipping(?: & handling)?:?")
    totals["tax"] = money(r"(?<!before )(?:estimated )?tax(?: to be collected)?:?")
    totals["total"] = money(r"order total:?")
    return totals


def cart_only_job(job):
    order_id = job["id"]
    label = job.get("account_label") or ""

    def progress(**fields):
        try:
            call("/api/worker/v1/orders/" + order_id + "/progress", fields)
        except Exception as failure:
            log("could not report on order " + job.get("order_number", "") + ": " + str(failure))

    try:
        current_job["text"] = "cart run " + job.get("order_number", "")
        current_job["whole_page"] = True
        current_job["place_clicked"] = False
        current_job["duplicate_confirmed"] = False
        current_job["recorded_done"] = False
        current_job["placed_id"] = ""
        current_job["thankyou_estimate"] = ""
        current_job["shot"] = ""
        progress(note="getting ready")
        order = call("/api/worker/v1/orders/" + order_id + "/details", {})
        ship = order["ship_to"]

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            progress(note="signing in")
            state, reason = amazon_sign_in(page, label, secrets)
            if state != "signed_in":
                report(label, session_state=state, error=reason, note="sign-in did not finish")
                raise Stop("Amazon sign-in did not finish. " + reason)
            report(label, session_state="signed_in", error="", note="signed in")
            stage[0] = "clearing the cart"
            progress(note="clearing the cart")
            clear_cart(page, label, secrets)
            stage[0] = "adding the item to the cart"
            progress(note="adding the item to the cart")
            add_to_cart(page, order)
            stage[0] = "opening checkout"
            progress(note="opening checkout")
            page.goto(CART_PAGE, wait_until="domcontentloaded", timeout=90000)
            settle(page)
            if not safe_click(page, ["input[name='proceedToRetailCheckout']", "#sc-buy-box-ptc-button input"]):
                raise Stop("The cart is empty or the checkout button is missing." + describe(page))
            settle(page)
            pass_sign_in_wall(page, label, secrets)
            settle(page)
            # Amazon sometimes puts a page in between the cart and checkout. Step through up to four of them.
            for _ in range(4):
                if "/checkout/p/" in page.url or wait_for_checkout(page, 4):
                    break
                if click_text(page, ["Continue to checkout", "Continue to Checkout"]):
                    progress(note="continuing to checkout")
                    settle(page)
                    pass_sign_in_wall(page, label, secrets)
                    settle(page)
                elif safe_click(page, ["#prime-declineCTA", "a#prime-declineCTA", "input[name='prime-interstitial-decline']"]) or click_text(page, ["No thanks", "No Thanks"]):
                    settle(page)
                else:
                    break
            stage[0] = "waiting for the checkout page"
            wait_for_checkout(page)
            stage[0] = "adding the buyer's address at checkout"
            progress(note="adding the buyer's address")
            add_address_at_checkout(page, ship)
            stage[0] = "adding the gift message"
            progress(note="adding the gift message")
            gift_note = add_gift(page, order.get("gift"))
            stage[0] = "reading the totals"
            try:
                page.evaluate("window.scrollTo(0, 0)")
            except Exception:
                pass
            pause()
            totals = read_totals(page)
            totals["gift"] = gift_note
            if order.get("run_kind") == "place_order":
                if totals.get("total") is None:
                    raise Stop("Could not read the order total at checkout, so the order was not placed." + describe(page))
                stage[0] = "placing the order"
                progress(note="placing the order · total $" + format(totals["total"], ".2f"))
                order_id = place_order(page, label)
                if current_job.get("verify_note"):
                    totals["verify"] = current_job["verify_note"]
                if current_job.get("verify_seen"):
                    totals["verify_page"] = current_job["verify_seen"]
                # Record the order right away. Nothing after this line can undo it or cause it to be placed again.
                log("order placed on Amazon: " + str(order_id))
                progress(done=True, placed=True, amazon_order_id=order_id, checkout=totals,
                         note="ordered · " + (order_id or "order number not shown") + " · " + str(totals.get("gift", ""))
                         + (" · duplicate confirmed" if current_job.get("duplicate_confirmed") else "")
                         + (" · " + str(totals["verify"]) if totals.get("verify") else ""))
                current_job["recorded_done"] = True
                current_job["placed_id"] = order_id
                stage[0] = "capturing the tracking card"
                estimate = capture_tracking(page, order_id) or current_job.get("thankyou_estimate", "")
                log("after ordering: estimate '" + str(estimate) + "', picture " + ("taken" if current_job.get("shot") else "missing"))
                if current_job.get("shot"):
                    progress(note="ordered · " + (order_id or "") + (" · expected " + estimate if estimate else ""), screenshot=current_job["shot"])
                if estimate or current_job.get("shot"):
                    # The same report the regular order check sends: saves the delivery window and the "ordered" proof.
                    try:
                        call("/api/worker/v1/orders/" + str(job.get("id")) + "/check",
                             {"state": "ordered", "delivery_estimate": estimate, "note": estimate, "tracking_number": "", "carrier": "", "screenshot": current_job.get("shot", "")})
                    except Exception as failure:
                        log("could not save the ordered proof: " + str(failure)[:200])
            return totals

        real = job.get("run_kind") == "place_order"
        totals, error, shot, _ = run_in_account_browser(
            label, lambda text: progress(note=text), work,
            reason=("place order " if real else "cart-only run ") + str(job.get("order_number", "")),
            summary=lambda r, e: (
                (True, "ordered · " + str(current_job.get("placed_id") or "") + (" · then: " + e[:200] if e else "")) if current_job.get("recorded_done")
                else (False, e) if e
                else (True, "cart ready · not ordered" + (" · total " + str((r or {}).get("total")) if (r or {}).get("total") is not None else ""))))
        totals = totals or {}
        if current_job.get("recorded_done"):
            pass  # the order was already recorded as placed; a later hiccup must not change that
        elif error:
            progress(done=True, error=error, note="stopped", screenshot=shot, place_uncertain=bool(current_job.get("place_clicked")))
        else:
            progress(done=True, note="cart ready · address added · " + str(totals.get("gift", "gift step skipped")) + " · not ordered", screenshot=shot, checkout=totals)
        log("cart run " + job.get("order_number", "") + " finished" + (": " + error if error else ""))
    except BaseException as failure:  # anything at all: the order must never be left looking unfinished
        log("run for " + str(job.get("order_number")) + " ended unexpectedly: " + repr(failure)[:300])
        if not current_job.get("recorded_done"):
            progress(done=True, error="The run ended unexpectedly: " + repr(failure)[:200], note="stopped", place_uncertain=bool(current_job.get("place_clicked")))
    finally:
        ship_log("job", "run " + str(job.get("order_number")) + " (" + str(job.get("run_kind")) + ")")
        current_job["shot"] = ""
        current_job["verify_note"] = ""
        current_job["verify_seen"] = ""
        current_job["whole_page"] = False
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
    ship_log("started")
    last_update_check = time.time()
    while True:
        try:
            state = current_job["text"] or kameleo_state()
            reply = call("/api/worker/v1/heartbeat", {"version": VERSION, "hostname": socket.gethostname(), "state": state})
            if reply.get("desired_state") != "pause":
                started = False
                for account in reply.get("accounts", []):
                    if account.get("signin_requested") and job_lock.acquire(blocking=False):
                        log("sign-in requested for " + account["label"])
                        threading.Thread(target=sign_in_job, args=(account["label"],), daemon=True).start()
                        started = True
                        break
                if not started:
                    for job in reply.get("order_jobs", []):
                        if job.get("run_kind") in ("cart_only", "place_order") and job_lock.acquire(blocking=False):
                            log(str(job.get("run_kind")) + " run requested for " + str(job.get("order_number")))
                            threading.Thread(target=cart_only_job, args=(job,), daemon=True).start()
                            started = True
                            break
                if not started:
                    for job in reply.get("tracking_jobs", []):
                        if job.get("orders") and job_lock.acquire(blocking=False):
                            log("order check due for " + str(job.get("account_label")) + " (" + str(len(job["orders"])) + " open)")
                            threading.Thread(target=tracking_job, args=(job,), daemon=True).start()
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
