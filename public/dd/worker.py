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

VERSION = "0.31.5"
DD_URL = os.environ.get("DD_URL", "https://dicedrop.vercel.app").rstrip("/")
TOKEN = os.environ.get("DD_BOX_TOKEN", "")
KAMELEO = os.environ.get("KAMELEO_URL", "http://127.0.0.1:5050").rstrip("/")
LIB = "/app/pylib"
HEARTBEAT_SECONDS = 15
UPDATE_CHECK_SECONDS = 60
AGENT = "DiceDropWorker/" + VERSION

class Slots:
    """How many jobs this box runs at the same time (each one is one account in its own browser)."""

    def __init__(self, size=1):
        self.size = size
        self.active = 0
        self.guard = threading.Lock()

    def resize(self, size):
        with self.guard:
            self.size = max(1, min(int(size), 8))

    def acquire(self, blocking=False):
        with self.guard:
            if self.active < self.size:
                self.active += 1
                return True
            return False

    def release(self):
        with self.guard:
            self.active = max(0, self.active - 1)

    def locked(self):
        return self.active > 0


class PerJob(threading.local):
    """Each running job keeps its own notes (screenshot, flags, what it is doing), so jobs never mix."""

    def __init__(self):
        self.data = {"text": ""}

    def __getitem__(self, key):
        return self.data[key]

    def __setitem__(self, key, value):
        self.data[key] = value
        if key == "text":
            with state_guard:
                if value:
                    running_text[threading.get_ident()] = str(value)
                else:
                    running_text.pop(threading.get_ident(), None)

    def get(self, key, default=None):
        return self.data.get(key, default)


state_guard = threading.Lock()
running_text = {}      # what each running job is doing, for the VPS page
busy_accounts = set()  # an account is only ever open in one browser at a time
started_orders = set() # an order run is only ever started once by this worker
job_lock = Slots(1)
current_job = PerJob()
install_guard = threading.Lock()
stderr_guard = threading.Lock()
stderr_users = [0, None]


def start_job(target, argument, label, order_id=""):
    """Runs one job on its own thread and frees its account when it ends, whatever happens."""
    def run():
        try:
            target(argument)
        finally:
            with state_guard:
                busy_accounts.discard(label)
                running_text.pop(threading.get_ident(), None)

    with state_guard:
        busy_accounts.add(label)
        if order_id:
            started_orders.add(order_id)
    threading.Thread(target=run, daemon=True).start()


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

def call(path, body=None, timeout=45):
    request = urllib.request.Request(
        DD_URL + path,
        data=json.dumps(body or {}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": AGENT},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
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


def address_owner(ip):
    """Who an internet address belongs to (provider, city), from a public lookup. Asked from the box itself."""
    request = urllib.request.Request("https://ipinfo.io/" + urllib.parse.quote(ip) + "/json", headers={"User-Agent": AGENT, "Accept": "application/json"})
    found = json.loads(urllib.request.urlopen(request, timeout=15).read().decode())
    place = ", ".join(part for part in [found.get("city"), found.get("region"), found.get("country")] if part)
    return " · ".join(part for part in [found.get("org") or "owner not listed", place, found.get("hostname") or ""] if part)[:280]


checked_addresses = {}
told_waiting = {}


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


# ---------------------------------------------------------------- moving at a person's pace
# The worker used to work like a machine: the pointer jumped straight to the middle of each button, every key landed
# on the same beat, pages were never scrolled, and a whole order took about two minutes. These helpers make it work the
# way a person at the keyboard does: the pointer travels to a button along a curve and lands somewhere inside it, typing
# speeds up and slows down, pages get read (scrolled) before anything is pressed, and an order run takes its time.
human_state = threading.local()
pointer_at = {}


def pause(low=0.8, high=2.0):
    time.sleep(random.uniform(low, high) * float(getattr(human_state, "pace", 1.0)))


def human_move(page, x, y):
    """Moves the pointer to (x, y) the way a hand does: along a slight curve, faster in the middle, in many small steps."""
    start = pointer_at.get(id(page)) or (random.uniform(200, 900), random.uniform(120, 500))
    distance = ((x - start[0]) ** 2 + (y - start[1]) ** 2) ** 0.5
    steps = max(8, min(40, int(distance / random.uniform(18, 32))))
    bend = random.uniform(-0.18, 0.18) * distance
    middle = ((start[0] + x) / 2 - (y - start[1]) / max(distance, 1) * bend, (start[1] + y) / 2 + (x - start[0]) / max(distance, 1) * bend)
    for index in range(1, steps + 1):
        t = index / steps
        t = t * t * (3 - 2 * t)  # ease in and out
        px = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * middle[0] + t ** 2 * x
        py = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * middle[1] + t ** 2 * y
        page.mouse.move(px + random.uniform(-0.6, 0.6), py + random.uniform(-0.6, 0.6))
        time.sleep(random.uniform(0.004, 0.016))
    pointer_at[id(page)] = (x, y)
    if len(pointer_at) > 200:
        pointer_at.clear()


def humanize():
    """Once per worker: every click and every typed word, anywhere in the worker, goes through the person-like versions."""
    from playwright.sync_api import Locator

    if getattr(Locator, "_dd_human", False):
        return
    plain_click, plain_type = Locator.click, Locator.press_sequentially

    def click(self, **options):
        try:
            if getattr(human_state, "on", False) and not options.get("force") and "position" not in options:
                self.scroll_into_view_if_needed(timeout=min(int(options.get("timeout") or 5000), 5000))
                box = self.bounding_box(timeout=3000)
                if box and box["width"] > 8 and box["height"] > 8:
                    inside_x, inside_y = box["width"] * random.uniform(0.25, 0.75), box["height"] * random.uniform(0.3, 0.7)
                    human_move(self.page, box["x"] + inside_x, box["y"] + inside_y)
                    time.sleep(random.uniform(0.08, 0.35))
                    options["position"] = {"x": inside_x, "y": inside_y}
                    options.setdefault("delay", random.randint(45, 130))
        except Exception:
            options.pop("position", None)
        if "position" in options and not options.get("trial"):
            # If the chosen spot is covered by something, fall back to the plain click in the middle rather than fail.
            try:
                return plain_click(self, **dict(options, timeout=min(int(options.get("timeout") or 8000), 8000)))
            except Exception:
                options.pop("position", None)
        return plain_click(self, **options)

    def press_sequentially(self, text, **options):
        if not getattr(human_state, "on", False) or len(text) < 3:
            return plain_type(self, text, **options)
        base = int(options.get("delay") or 90)
        position = 0
        while position < len(text):
            size = random.randint(1, 5)
            chunk, position = text[position:position + size], position + size
            plain_type(self, chunk, **dict(options, delay=max(25, int(base * random.uniform(0.55, 1.6)))))
            if position < len(text) and random.random() < 0.22:
                time.sleep(random.uniform(0.25, 0.9))  # a glance away, the way people type

    Locator.click, Locator.press_sequentially, Locator._dd_human = click, press_sequentially, True


def look_around(page, low=2, high=5):
    """Reads the page the way a shopper does before pressing anything: scrolls down in a few goes, pauses, comes back up."""
    if not getattr(human_state, "on", False):
        return
    try:
        human_move(page, random.uniform(300, 900), random.uniform(250, 550))
        travelled = 0
        for _ in range(random.randint(low, high)):
            step = random.randint(280, 760)
            page.mouse.wheel(0, step)
            travelled += step
            time.sleep(random.uniform(0.7, 2.6))
        if random.random() < 0.5:
            page.mouse.wheel(0, -random.randint(150, 400))
            time.sleep(random.uniform(0.5, 1.5))
        page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
        time.sleep(random.uniform(0.8, 1.8))
    except Exception:
        pass


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


def amazon_sign_in(page, label, secrets, start_url=None):
    """Walks Amazon's sign-in screens one at a time. Returns (state, error text).
    start_url (used by order checks) opens that page first instead of the amazon.com home and account
    pages: if the account is still signed in the page just loads and the check skips two page loads. If the
    session has lapsed Amazon sends it to the sign-in screen and the walk below takes over exactly as normal."""
    if start_url:
        page.goto(start_url, wait_until="domcontentloaded", timeout=90000)
        pause(1.0, 2.0)
    else:
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
        if human_check(page):
            try:
                report(label, robot_check=True)
            except Exception:
                pass
            return "verification", "Amazon is asking this account to confirm a person is there (\"I am human\"). Open its browser and answer it."

        if "/ap/" not in url and SITE_MARK in url and not visible(page, EMAIL) and not visible(page, PASSWORD):
            greeting = ""
            try:
                greeting = page.locator("#nav-link-accountList-nav-line-1").first.inner_text(timeout=3000).strip().lower()
            except Exception:
                pass
            if REQUIRE_GREETING and "sign in" in greeting:
                return "needs_sign_in", "Amazon opened a page without the account's name on it, so sign-in could not be confirmed."
            if current_job.get("text", "").startswith("signing in"):
                try:
                    report(label, robot_check=False)  # a sign-in check found Amazon normal: the "confirm a person" flag comes off
                except Exception:
                    pass
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
        elif steps.count("picked the account") < 2 and pick_saved_account(page, secrets):
            report(label, note="choosing the account on Amazon's Switch accounts page")
            steps.append("picked the account")
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
    with stderr_guard:
        stderr_users[0] += 1
        if stderr_users[0] > 1:
            return None
        try:
            saved = os.dup(2)
            handle = os.open(ERR_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.dup2(handle, 2)
            os.close(handle)
            stderr_users[1] = saved
            return saved
        except Exception:
            stderr_users[1] = None
            return None


def restore_stderr(saved):
    detail = ""
    with stderr_guard:
        stderr_users[0] = max(0, stderr_users[0] - 1)
        try:
            with open(ERR_FILE, "r", errors="replace") as handle:
                detail = " ".join(handle.read().split())[-500:]
        except Exception:
            pass
        if stderr_users[0] == 0 and stderr_users[1] is not None:
            try:
                os.dup2(stderr_users[1], 2)
                os.close(stderr_users[1])
            except Exception:
                pass
            stderr_users[1] = None
    return detail


# ---------------------------------------------------------------- Multilogin (a second browser engine)
#
# An account can run on Multilogin instead of Kameleo: the worker then opens the account's existing Multilogin
# profile (the one already used by hand, with its cookies and its proxy saved inside it) and drives that.
# The Multilogin agent is installed inside this worker's container the first time it is needed.

MLX_API = "https://api.multilogin.com"
MLX_LAUNCHER = "https://launcher.mlx.yt:45001"
MLX_DEB = "https://mlxdists.s3.eu-west-3.amazonaws.com/mlx/latest/multiloginx-amd64.deb"
mlx_state = {"token": "", "at": 0.0, "agent": None, "screen": None}
mlx_guard = threading.Lock()


def mlx_request(method, url, body=None, token="", timeout=90):
    import ssl

    headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": AGENT}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    contexts = [None]
    if url.startswith(MLX_LAUNCHER):
        contexts.append(ssl._create_unverified_context())  # the launcher is this box itself (127.0.0.1)
    last = None
    for context in contexts:
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:400]
            raise RuntimeError("Multilogin answered " + str(error.code) + ": " + detail)
        except urllib.error.URLError as error:
            last = error
            if "CERTIFICATE" not in str(error).upper() and "SSL" not in str(error).upper():
                break
    raise ConnectionError(str(last))


def mlx_token(fresh=False):
    import hashlib

    if mlx_state["token"] and not fresh and time.time() - mlx_state["at"] < 20 * 60:
        return mlx_state["token"]
    creds = call("/api/worker/v1/multilogin", {})
    if not creds.get("email") or not creds.get("password"):
        raise Stop("No Multilogin sign-in is saved. Add it in DiceDrop under Settings > multilogin.")
    try:
        reply = mlx_request("POST", MLX_API + "/user/signin", {"email": creds["email"], "password": hashlib.md5(creds["password"].encode()).hexdigest()})
    except RuntimeError as failure:
        raise Stop("Multilogin did not accept the saved sign-in. " + str(failure)[:200])
    token = (reply.get("data") or {}).get("token") or ""
    if not token:
        raise Stop("Multilogin sign-in gave no token: " + json.dumps(reply)[:200])
    mlx_state.update({"token": token, "at": time.time()})
    return token


def mlx_launcher_up():
    try:
        with socket.create_connection(("127.0.0.1", 45001), timeout=2):
            return True
    except Exception:
        return False


def ensure_graphics():
    """The VPS has no graphics card, so the browser reported no graphics at all, unlike the same profile on a normal
    computer. This installs the software graphics libraries once, so the browser can draw the way it does elsewhere."""
    marker = "/var/lib/dicedrop-graphics-0"
    if os.path.exists(marker):
        return
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
    try:
        subprocess.call(["apt-get", "update", "-qq"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for name in ("libgl1", "libgl1-mesa-dri", "libglx-mesa0", "libegl1", "libgles2", "libvulkan1", "mesa-vulkan-drivers"):
            subprocess.call(["apt-get", "install", "-y", "-qq", "--no-install-recommends", name], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        open(marker, "w").write("installed")
        log("graphics libraries installed on this box")
    except Exception as failure:
        log("could not install the graphics libraries: " + str(failure)[:160])


def ensure_mlx_agent():
    """Installs (once) and starts Multilogin's agent in this container, on a virtual screen."""
    import shutil

    with mlx_guard:
        ensure_graphics()
        if mlx_launcher_up():
            return
        env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
        tool = shutil.which("mlx")
        if not tool or not shutil.which("Xvfb"):
            log("installing Multilogin on this box (one time, a few minutes)")
            subprocess.call(["apt-get", "update", "-qq"], env=env, stdout=subprocess.DEVNULL)
            wanted = ["xvfb", "ca-certificates", "libnss3", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libgbm1", "libxkbcommon0",
                      "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2", "libpango-1.0-0", "libcairo2", "libgtk-3-0", "fonts-liberation", "xdg-utils", "procps"]
            subprocess.call(["apt-get", "install", "-y", "-qq", "--no-install-recommends"] + wanted, env=env, stdout=subprocess.DEVNULL)
            for sound in ("libasound2", "libasound2t64"):
                if subprocess.call(["apt-get", "install", "-y", "-qq", "--no-install-recommends", sound], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
                    break
            package = "/tmp/multiloginx.deb"
            request = urllib.request.Request(MLX_DEB, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=600) as response, open(package, "wb") as out:
                shutil.copyfileobj(response, out)
            done = subprocess.run(["apt-get", "install", "-y", "-qq", package], env=env, capture_output=True, text=True)
            if done.returncode != 0:
                log("Multilogin package install said: " + (done.stderr or done.stdout)[-400:])
            tool = shutil.which("mlx")
            if not tool:
                for folder in ("/usr/bin", "/usr/local/bin", "/opt/mlx", "/opt/multilogin", "/opt/Multilogin"):
                    for name in ("mlx", "agent.bin", "mlx-agent"):
                        if os.path.exists(os.path.join(folder, name)):
                            tool = os.path.join(folder, name)
            if not tool:
                raise Stop("Multilogin was downloaded but its program was not found on the box. " + (done.stderr or done.stdout)[-300:])
        if mlx_state["screen"] is None or mlx_state["screen"].poll() is not None:
            mlx_state["screen"] = subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1.5)
        log("starting the Multilogin agent")
        out = open("/tmp/mlx-agent.log", "ab")
        mlx_state["agent"] = subprocess.Popen([tool], env=dict(os.environ, DISPLAY=":99", HOME=os.environ.get("HOME") or "/root"), stdout=out, stderr=out)
        for _ in range(120):
            if mlx_launcher_up():
                time.sleep(3)
                return
            if mlx_state["agent"].poll() is not None:
                break
            time.sleep(1)
        tail = ""
        try:
            tail = open("/tmp/mlx-agent.log", "rb").read()[-500:].decode(errors="replace")
        except Exception:
            pass
        raise Stop("The Multilogin agent did not start on this box. " + " ".join(tail.split())[-400:])


def mlx_find(label, secrets):
    """The folder and profile ids of the account's Multilogin profile, found once by its name (or given as an id)."""
    import re

    if secrets.get("mlx_profile_id") and secrets.get("mlx_folder_id"):
        return secrets["mlx_folder_id"], secrets["mlx_profile_id"]
    wanted = (secrets.get("mlx_profile") or "").strip()
    if not wanted:
        raise Stop("No Multilogin profile is named for this account.")
    uuid = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    both = re.fullmatch(r"\s*(" + uuid + r")\s*[/ ,]\s*(" + uuid + r")\s*", wanted)
    if both:
        folder, profile = both.group(1), both.group(2)
    else:
        try:
            reply = mlx_request("POST", MLX_API + "/profile/search", {"is_removed": False, "limit": 100, "offset": 0, "search_text": "" if re.fullmatch(uuid, wanted) else wanted,
                                                                      "storage_type": "all", "order_by": "created_at", "sort": "asc"}, token=mlx_token())
        except RuntimeError as failure:
            raise Stop("Multilogin could not search for the profile \"" + wanted + "\". " + str(failure)[:260])
        rows = (reply.get("data") or {}).get("profiles") or []
        match = [r for r in rows if str(r.get("id", "")).lower() == wanted.lower() or str(r.get("name", "")).strip().lower() == wanted.lower()]
        if len(match) != 1:
            names = ", ".join(str(r.get("name")) for r in rows[:12])
            raise Stop(("No Multilogin profile is named \"" + wanted + "\"." if not match else "More than one Multilogin profile is named \"" + wanted + "\".")
                       + (" Profiles found: " + names if names else " The search came back empty: " + json.dumps(reply)[:200]))
        folder, profile = str(match[0].get("folder_id") or ""), str(match[0].get("id") or "")
        if not folder or not profile:
            raise Stop("Multilogin's answer for \"" + wanted + "\" has no folder or profile id: " + json.dumps(match[0])[:260])
    report(label, mlx_profile_id=profile, mlx_folder_id=folder, note="Multilogin profile found")
    return folder, profile


def mlx_start(label, secrets):
    """Starts the account's Multilogin profile on this box. Returns (profile id, the address the remote control connects to)."""
    ensure_mlx_agent()
    folder, profile = mlx_find(label, secrets)
    address = MLX_LAUNCHER + "/api/v2/profile/f/" + folder + "/p/" + profile + "/start?automation_type=playwright&headless_mode=false"
    reply = None
    for attempt in range(3):
        try:
            reply = mlx_request("GET", address, token=mlx_token(fresh=attempt > 0), timeout=180)
            break
        except RuntimeError as failure:
            text = str(failure)
            log("Multilogin start for " + label + " (try " + str(attempt + 1) + " of 3): " + text[:300])
            busy = any(word in text.lower() for word in ("already", "running", "locked", "lock", "in use", "another device", "opened"))
            if attempt == 2:
                if busy:
                    # The profile is open somewhere else (most likely by hand on the operator's computer). Nothing is wrong:
                    # the worker leaves it alone and comes back later.
                    current_job["in_use"] = True
                    try:
                        report(label, in_use=True, error="Its Multilogin browser is open on another computer. The worker waits until it is closed there.")
                    except Exception:
                        pass
                    raise Stop("The Multilogin browser for " + label + " is open on another computer, so the worker left it alone.")
                raise Stop("Multilogin could not start the profile for " + label + ". " + text[:300])
            if busy and attempt == 0:
                mlx_stop(profile)  # clears a copy left open on this box; it cannot close one on another computer
            time.sleep(6)
        except ConnectionError as failure:
            raise Stop("The Multilogin agent on this box is not answering. " + str(failure)[:200])
    current_job["in_use"] = False
    port = (reply.get("data") or {}).get("port")
    if not port:
        raise Stop("Multilogin started the profile but gave no connection port: " + json.dumps(reply)[:260])
    return profile, "http://127.0.0.1:" + str(port)


def mlx_stop(profile):
    try:
        mlx_request("GET", MLX_LAUNCHER + "/api/v1/profile/stop/p/" + profile, token=mlx_token(), timeout=90)
    except Exception as failure:
        log("could not stop the Multilogin profile cleanly: " + str(failure)[:200])


DEVICE_JS = """() => {
  let gl = '';
  try {
    const c = document.createElement('canvas').getContext('webgl');
    const x = c.getExtension('WEBGL_debug_renderer_info');
    gl = c.getParameter(x.UNMASKED_VENDOR_WEBGL) + ' / ' + c.getParameter(x.UNMASKED_RENDERER_WEBGL);
  } catch (e) { gl = 'none'; }
  return {
    webdriver: navigator.webdriver, ua: navigator.userAgent, platform: navigator.platform,
    uaPlatform: navigator.userAgentData ? navigator.userAgentData.platform : '', cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory,
    languages: (navigator.languages || []).join(','), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: screen.width + 'x' + screen.height + ' avail ' + screen.availWidth + 'x' + screen.availHeight + ' window ' + window.outerWidth + 'x' + window.outerHeight + ' dpr ' + devicePixelRatio,
    webgl: gl, plugins: navigator.plugins.length, chrome: typeof window.chrome, touch: navigator.maxTouchPoints,
  };
}"""


def device_report(page, label):
    """What a website can see about this account's browser and connection: where the proxy address is, and
    whether the browser's time zone, language, screen and graphics agree with it. Read from a neutral site, for the log."""
    try:
        page.goto("https://ipinfo.io/json", wait_until="domcontentloaded", timeout=45000)
        where = json.loads(page.inner_text("body"))
    except Exception as failure:
        where = {"error": str(failure)[:80]}
    try:
        seen = page.evaluate(DEVICE_JS)
    except Exception as failure:
        seen = {"error": str(failure)[:80]}
    flags = []
    if where.get("country") and where.get("country") != "US":
        flags.append("the proxy address is located in " + str(where.get("country")) + ", not the US")
    if where.get("timezone") and seen.get("timezone") and where["timezone"] != seen["timezone"]:
        flags.append("browser time zone " + str(seen["timezone"]) + " does not match the address's " + str(where["timezone"]))
    if seen.get("webdriver"):
        flags.append("the browser says it is automated (webdriver)")
    if any(word in str(seen.get("webgl", "")).lower() for word in ("swiftshader", "llvmpipe", "software", "none")):
        flags.append("graphics are a server's software renderer: " + str(seen.get("webgl"))[:70])
    if "Windows" in str(seen.get("ua", "")) and "Win" not in str(seen.get("platform", "")):
        flags.append("says Windows but the platform reads " + str(seen.get("platform")))
    line = ("device check " + label + ": address " + str(where.get("ip", "")) + " " + str(where.get("city", "")) + ", " + str(where.get("region", "")) + ", " + str(where.get("country", ""))
            + " | " + str(where.get("org", "")) + " | tz " + str(where.get("timezone", "")) + " || browser: " + json.dumps(seen)[:700]
            + " || flags: " + ("; ".join(flags) if flags else "none"))
    log(line)
    try:
        call("/api/worker/v1/log", {"type": "device", "text": line[:3500]})
    except Exception:
        pass
    return flags


class Stop(Exception):
    """A clean, explained stop: the message is shown to the operator as is."""


class RobotCheck(Stop):
    """Amazon showed its "are you a person" page."""


def run_in_account_browser(label, note, work, reason="", summary=None):
    """Opens the account's own Kameleo browser on its dedicated proxy, runs `work(page, secrets)`, and always
    takes a screenshot and closes the profile afterwards. Returns (result, error text, screenshot, outgoing ip)."""
    profile_id = ""
    engine = "kameleo"
    result, error, shot, exit_ip = None, "", "", ""
    stage = ["getting ready"]
    opened_at = time.time()
    saved_stderr = capture_stderr()
    try:
        secrets = call("/api/worker/v1/accounts/secrets", {"account": label})
        if not secrets.get("password") and reason != "manual browser":
            # The browser can be opened by hand before any Amazon sign-in exists; everything else needs the password.
            raise Stop("No Amazon password is saved for this account.")
        engine = "multilogin" if secrets.get("engine") == "multilogin" else "kameleo"
        if engine == "kameleo" and (not secrets.get("proxy") or not secrets["proxy"].get("host")):
            raise Stop("No dedicated proxy is attached to this account.")

        stage[0] = "installing the remote control"
        with install_guard:
            ensure_playwright()
        from playwright.sync_api import sync_playwright

        box_ip = direct_ip()
        mlx_endpoint = ""
        if engine == "multilogin":
            stage[0] = "opening the Multilogin profile"
            note("opening the Multilogin profile")
            profile_id, mlx_endpoint = mlx_start(label, secrets)
        else:
            stage[0] = "creating the device identity"
            profile_id = ensure_profile(label, secrets)
        note("opening the browser")

        humanize()
        human_state.on = True
        human_state.pace = random.uniform(1.5, 2.1) if reason.startswith(("place order", "cart-only", "order check")) else 1.0
        stage[0] = "starting the remote control"
        with sync_playwright() as playwright:
            stage[0] = "connecting to the " + ("Multilogin" if engine == "multilogin" else "Kameleo") + " browser"
            endpoint = mlx_endpoint or ("ws://" + KAMELEO.split("://", 1)[1] + "/playwright/" + profile_id)
            # A proxy can refuse one connection (most often when the same account is opened again seconds
            # after its last session closed). Wait and try again before calling it a problem.
            browser = None
            for attempt in range(4):
                try:
                    browser = playwright.chromium.connect_over_cdp(endpoint_url=endpoint, timeout=600000)
                    break
                except Exception as failure:
                    if "proxy_connection_issue" not in str(failure) or attempt == 3:
                        if "proxy_connection_issue" in str(failure):
                            raise Stop("The proxy for " + label + " did not connect after 4 tries. The account itself is fine; it is tried again on the next check.")
                        raise
                    log("proxy for " + label + " did not connect (try " + str(attempt + 1) + " of 4); waiting 20 seconds")
                    time.sleep(20)
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
                if reason == "sign-in":
                    stage[0] = "checking what the browser looks like"
                    try:
                        device_report(page, label)
                    except Exception:
                        pass
                result = work(page, secrets, stage)
            finally:
                # An order run that is stopping: one AI look at the page, so the error says in plain words what Amazon wants.
                if sys.exc_info()[0] is not None and reason.startswith(("place order", "cart-only")) and not current_job.get("recorded_done"):
                    try:
                        current_job["ai_read"] = assist_read(page, label, stage[0])
                    except Exception:
                        current_job["ai_read"] = ""
                shot = snap(page)
    except Stop as stop:
        error = str(stop)[:1800]
        if current_job.get("ai_read"):
            error = (current_job["ai_read"] + " | " + error)[:1800]
            current_job["ai_read"] = ""
    except BaseException as failure:
        error = "While " + stage[0] + ": " + repr(failure)[:300]
        log("browser session ended unexpectedly while " + stage[0] + ": " + repr(failure)[:300])
    finally:
        low_level = restore_stderr(saved_stderr)
        if error and low_level and not error.startswith(("Amazon", "No ", "The proxy", "This item", "Out of stock")):
            error = error + " | details: " + low_level
        if profile_id and engine == "multilogin":
            mlx_stop(profile_id)
        elif profile_id:
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
        # A short timeout so a match that is present but not actionable (e.g. a button behind a dialog) can never
        # hang for Playwright's 30-second default; move on to the next selector instead.
        try:
            target.click(timeout=6000)
            return True
        except Exception:
            continue
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


def pick_saved_account(page, secrets):
    """Amazon's "Switch accounts" page lists the accounts this browser knows. Picks this account's own entry
    (the one showing its sign-in email), which leads on to the password step. True when it clicked."""
    try:
        words = page_words(page, 600).lower()
        email = (secrets.get("login_email") or "").strip().lower()
        if "switch accounts" not in words or not email or email not in words:
            return False
        for selector in [".cvf-account-switcher-claim", ".cvf-account-switcher-profile-details", "[data-test-id='accountType']"]:
            rows = page.locator(selector)
            for index in range(min(rows.count(), 6)):
                row = rows.nth(index)
                if row.is_visible() and email in row.inner_text(timeout=2000).lower():
                    row.click(timeout=8000)
                    return True
        entry = page.get_by_text(email, exact=False).first
        if entry.is_visible():
            entry.click(timeout=8000)
            return True
    except Stop:
        raise
    except Exception as failure:
        log("could not pick the account on Amazon's Switch accounts page: " + str(failure).split("\n")[0][:160])
    return False


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
        elif pick_saved_account(page, secrets):
            pass
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
    look_around(page)  # read the product page before adding it
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


# Pulls the two addresses out of Amazon's "Verify your address" dialog by their visible labels, so it does not
# depend on Amazon's internal field names (those change): the block that starts "Original address" / "Suggested address".
ADDR_SUGGEST_JS = r"""
() => {
  const clean = (t) => (t || '').trim().replace(/^(original address|suggested address)\s*:?\s*/i, '').replace(/edit this address/ig, '').trim();
  const pick = (lab) => {
    let best = '';
    for (const n of document.querySelectorAll('label,li,div,span,p,fieldset')) {
      const t = (n.innerText || '').trim();
      if (t.toLowerCase().startsWith(lab) && t.length < 220 && (!best || t.length < best.length)) best = clean(t);
    }
    return best;
  };
  return { original: pick('original address'), suggested: pick('suggested address') };
}
"""


def verify_address_dialog(page):
    """Returns the visible "Verify your address" dialog (the innermost box that holds its heading, the two
    radios and its own "Use this address" button), or None. Everything is done inside this box so a button
    sitting behind the dialog is never the one clicked."""
    try:
        loc = page.locator(
            "xpath=//*[.//*[contains(normalize-space(.),'Verify your address')]]"
            "[.//input[@type='radio']]"
            "[.//*[contains(normalize-space(.),'Use this address')]]"
        )
        if loc.count() and loc.last.is_visible():
            return loc.last
    except Exception:
        pass
    return None


def resolve_address_suggestion(page, label=""):
    """Handles Amazon's "Verify your address" dialog. The AI decides the buyer's original vs Amazon's suggestion;
    a suggestion is accepted only when the ZIP and street number both match. The radio is chosen by position
    (first = original, second = suggested) and "Use this address" is pressed inside the dialog. Returns True
    when it acted on the dialog, False when there was no such dialog."""
    modal = verify_address_dialog(page)
    if modal is None:
        return False
    try:
        pair = page.evaluate(ADDR_SUGGEST_JS) or {}
    except Exception:
        pair = {}
    original_txt = (pair.get("original") or "").strip()
    suggested_txt = (pair.get("suggested") or "").strip()
    pick = "original"
    if original_txt and suggested_txt:
        answer = {}
        try:
            answer = call("/api/worker/v1/address-choice", {"account": label, "original": original_txt, "suggested": suggested_txt}, timeout=30) or {}
        except Exception:
            answer = {}
        want = answer.get("choice")
        if want == "stop":
            raise Stop("Amazon suggested a different address and it needs a person. " + (answer.get("reason") or "")
                       + " Original: " + original_txt + " | Suggested: " + suggested_txt)
        if want == "suggested" and same_zip_and_number(original_txt, suggested_txt):
            pick = "suggested"
    # Original is pre-selected; only move the radio when we want the suggestion. By position, then by label.
    if pick == "suggested":
        radios = modal.locator("input[type='radio']")
        picked = False
        try:
            if radios.count() >= 2:
                radios.nth(1).check(force=True, timeout=4000)
                picked = True
        except Exception:
            picked = False
        if not picked:
            try:
                modal.get_by_text("Suggested", exact=False).first.click(timeout=3000)
            except Exception:
                pass
    # Press "Use this address" inside the dialog.
    for finder in (
        lambda: modal.get_by_role("button", name="Use this address", exact=False),
        lambda: modal.get_by_text("Use this address", exact=False),
        lambda: modal.locator("input[type='submit'], button[type='submit']"),
    ):
        try:
            btn = finder()
            if btn.count() and btn.last.is_visible():
                btn.last.click(timeout=8000)
                settle(page)
                return True
        except Exception:
            pass
    return False


def _zip_of(text):
    import re
    # The ZIP sits near the end, so take the last 5-digit group (a 5-digit street number earlier won't fool it).
    found = re.findall(r"\b(\d{5})(?:-\d{4})?\b", text or "")
    return found[-1] if found else ""


def _street_number_of(text):
    import re
    found = re.search(r"\b(\d{1,6})\b", (text or "").replace(",", " "))
    return found.group(1) if found else ""


def same_zip_and_number(original, suggested):
    """True only when both addresses carry the same 5-digit ZIP and the same leading street number. This is the
    hard floor under the AI: a suggestion that moves the ZIP or the house number is never accepted automatically."""
    oz, sz = _zip_of(original), _zip_of(suggested)
    on, sn = _street_number_of(original), _street_number_of(suggested)
    return bool(oz) and oz == sz and bool(on) and on == sn


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
                # Picking a saved address can also pop the "Verify your address" dialog; handle it either way.
                resolve_address_suggestion(page, current_job.get("label") or "")
                if delivering_to_buyer() or click_text(page, ["Deliver to this address", "Use this address", "Ship to this address"]) or safe_click(page, ["#shipToThisAddressButton input", "input[data-testid='Address_selectShipToThisAddress']"]):
                    settle(page)
                    for _ in range(20):
                        if delivering_to_buyer():
                            return "picked the saved address"
                        resolve_address_suggestion(page, current_job.get("label") or "")
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
    # Amazon may show a "Verify your address" dialog. It is NOT the address form, so form_open() cannot see it:
    # look for the dialog itself and handle it, retrying briefly in case it appears a moment after submit.
    for _ in range(16):
        if resolve_address_suggestion(page, current_job.get("label") or ""):
            break
        if not form_open() and verify_address_dialog(page) is None:
            break
        time.sleep(0.5)
    for _ in range(30):
        if not form_open() and verify_address_dialog(page) is None:
            break
        time.sleep(0.5)
    if form_open() or verify_address_dialog(page) is not None:
        message = ""
        try:
            message = " ".join(first_visible(page, ".a-alert-error, .a-box.a-alert-inline-error, .a-alert-inline-error").inner_text(timeout=3000).split())[:200]
        except Exception:
            pass
        raise Stop("Address not found: Amazon did not accept the buyer's address." + (" Amazon says: " + message if message else describe(page)))
    settle(page)
    # Some layouts return to the address list with the new one selected and a confirm button. Skip it when delivery
    # is already set, and drop the broad "Deliver to this address" text selector (it matches the page's main
    # checkout continue button, which can sit behind a dialog and hang the step).
    if not delivering_to_buyer():
        safe_click(page, ["#shipToThisAddressButton input", "input[data-testid='Address_selectShipToThisAddress']", "input[aria-labelledby='shipToThisAddressButton-announce']"])
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


# ---------------------------------------------------------------- AI helper
# When the worker meets a page it has no steps for, it shows the page to DiceDrop's AI helper and gets back one
# action at a time: click this, type that saved detail here, wait, done, or stop with the reason.
# The AI never receives a password or a card detail: it names which saved detail to type and the worker types it.
# It can never press a buy button, cancel, or remove anything: those clicks are refused here, in code.

AI_NEVER = NEVER_CLICK + ("cancel order", "cancel items", "cancel this", "request cancellation", "close your account", "close account",
                          "sign out", "delete", "remove", "buy again", "buy it again", "reorder", "add to cart", "change address")

ASSIST_HOSTS = ("amazon.com",)

ASSIST_JS = """(start) => {
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden'; };
  const skip = '#navbar, #nav-belt, #nav-main, #navFooter, #rhf, footer, header';
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
  document.querySelectorAll('[data-dd-ai]').forEach((e) => e.removeAttribute('data-dd-ai'));
  // Anything that holds card details is shown as dots, so no picture of the page can carry them.
  for (const e of document.querySelectorAll('input')) {
    const about = ((e.getAttribute('autocomplete') || '') + ' ' + e.name + ' ' + e.id + ' ' + (e.getAttribute('placeholder') || '')).toLowerCase();
    if ((e.value || '').replace(/\\D/g, '').length >= 3 && /cc-|card|cvv|cvc|security|ending in|expir/.test(about)) e.style.webkitTextSecurity = 'disc';
    if ((e.value || '').replace(/\\D/g, '').length >= 12) e.style.webkitTextSecurity = 'disc';
  }
  const out = [];
  let n = start;
  const all = document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=radio], [role=link], [role=checkbox], label');
  for (const e of all) {
    if (out.length >= 70) break;
    if (e.closest(skip)) continue;
    const tag = e.tagName.toLowerCase();
    const type = (e.getAttribute('type') || '').toLowerCase();
    const choice = type === 'radio' || type === 'checkbox';
    if (!shown(e) && !choice) continue;
    const field = tag === 'select' || tag === 'textarea' || (tag === 'input' && !['submit', 'button', 'radio', 'checkbox', 'image'].includes(type));
    let words = '';
    let kind = '';
    if (field) {
      words = clean([e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.labels && e.labels[0] ? e.labels[0].innerText : '', e.name, e.id].filter(Boolean).join(' | '));
      kind = tag === 'select' ? 'dropdown' : 'field';
    } else if (choice) {
      const row = (e.labels && e.labels[0]) || e.closest('label, li, tr, [class*=row], [class*=option], div');
      if (row && !shown(row) && !shown(e)) continue;
      words = clean(row ? row.innerText : '');
      kind = type + (e.checked ? ' (selected)' : '');
    } else if (tag === 'label') {
      if (!e.getAttribute('for') && !e.querySelector('input')) continue;
      continue;  // its radio / checkbox / field is listed itself
    } else {
      const by = e.getAttribute('aria-labelledby');
      words = clean(e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || (by && document.getElementById(by) ? document.getElementById(by).innerText : ''));
      if (!words) continue;
      kind = tag === 'a' || e.getAttribute('role') === 'link' ? 'link' : 'button';
    }
    e.setAttribute('data-dd-ai', String(n));
    out.push({ n, kind, words, field, tag, about: clean((e.id || '') + ' ' + (e.name || '')).toLowerCase() });
    n += 1;
  }
  return out;
}"""


def assist_elements(page):
    """Numbers what can be clicked or typed into, across the page and its frames. Never reads a field's value."""
    items, owners = [], {}
    for frame in page.frames:
        try:
            found = frame.evaluate(ASSIST_JS, len(items) + 1)
        except Exception:
            continue
        for item in found:
            owners[item["n"]] = frame
            items.append(item)
        if len(items) >= 120:
            break
    return items, owners


def assist_secrets(label):
    """The saved details the worker may type when the AI names them. They stay on this box and go to Amazon only."""
    import re

    try:
        card = call("/api/worker/v1/accounts/card", {"account": label})
    except Exception:
        return {}
    if not card.get("saved"):
        return {}
    month, year = str(card.get("exp_month") or ""), str(card.get("exp_year") or "")
    values = {
        "card_number": re.sub(r"\D", "", str(card.get("number") or "")),
        "card_security_code": str(card.get("cvv") or ""),
        "card_expiry_mm_yy": (month.zfill(2) + "/" + year[-2:]) if month and year else "",
        "card_exp_month": month,
        "card_exp_year": year,
        "name_on_card": str(card.get("name") or ""),
        "billing_zip": str(card.get("zip") or ""),
    }
    return {name: value for name, value in values.items() if value}


def assist_ask(page, label, goal, step, max_steps, history, names):
    items, owners = assist_elements(page)
    try:
        shot = base64.b64encode(page.screenshot(type="jpeg", quality=50, full_page=False)).decode()
    except Exception:
        shot = ""
    try:
        title = page.title()[:200]
    except Exception:
        title = ""
    answer = call("/api/worker/v1/assist", {
        "account": label, "goal": goal, "step": step, "max_steps": max_steps, "history": history[-12:],
        "url": page.url.split("?")[0][:300], "title": title, "text": page_words(page, 5000),
        "elements": [{"n": i["n"], "kind": i["kind"], "words": i["words"]} for i in items],
        "secrets": sorted(names), "screenshot": shot,
    }, timeout=90)
    return answer, items, owners


def assist(page, label, goal, finished=None, max_steps=10):
    """Lets the AI helper work a page the worker has no steps for. Returns (outcome, reason):
    "done" (goal reached), "stop" (the AI or a safety rule says a person is needed; reason says why),
    or "off" (the helper could not be asked)."""
    history, values, waits, refused = [], None, 0, 0
    current_job["ai_steps"] = 0
    for step in range(1, max_steps + 1):
        try:
            if finished and finished():
                return "done", "the page moved on"
            host = page.url.split("/")[2].lower() if "://" in page.url else ""
            if not any(host == allowed or host.endswith("." + allowed) for allowed in ASSIST_HOSTS):
                return "stop", "the page left Amazon (" + host[:40] + ")"
            if values is None:
                values = assist_secrets(label)
            answer, items, owners = assist_ask(page, label, goal, step, max_steps, history, values.keys())
        except Stop:
            raise
        except Exception as failure:
            log("AI helper could not be asked: " + str(failure)[:160])
            return "off", "the AI helper could not be reached"
        if answer.get("unavailable"):
            log("AI helper is not available: " + str(answer.get("reason"))[:120] + " " + str(answer.get("detail") or "")[:120])
            return "off", str(answer.get("reason") or "the AI helper is not available")
        current_job["ai_steps"] = step
        action, why = answer.get("action"), " ".join(str(answer.get("reason") or "").split())[:240]
        item = next((i for i in items if i["n"] == answer.get("element")), None)
        log("AI step " + str(step) + ": " + str(action) + (' "' + item["words"][:50] + '"' if item and action in ("click", "type_secret") else "")
            + (" [" + str(answer.get("secret")) + "]" if action == "type_secret" else "") + " - " + why + " (page: " + str(answer.get("page_is") or "")[:90] + ")")
        if action == "done":
            if finished and not finished():
                history.append("you said done, but the worker's own check shows the goal is not reached yet")
                continue
            return "done", why
        if action == "stop":
            return "stop", why or "the AI helper stopped without a reason"
        if action == "wait":
            waits += 1
            if waits > 3:
                return "stop", "the page did not change"
            time.sleep(4)
            history.append("waited 4 seconds")
            continue
        if item is None:
            history.append("element " + str(answer.get("element")) + " is not on the page; pick a number from the list")
            continue
        target = owners[item["n"]].locator('[data-dd-ai="' + str(item["n"]) + '"]').first
        described = (item["words"] + " " + item.get("about", "")).lower()
        try:
            if action == "click":
                if any(word in described for word in AI_NEVER):
                    refused += 1
                    log("AI helper: refused to click \"" + item["words"][:50] + "\"")
                    if refused >= 2:
                        return "stop", "the only way forward was a button the worker never presses (" + item["words"][:40] + ")"
                    history.append('REFUSED: the worker never clicks "' + item["words"][:50] + '". Choose something else or stop.')
                    continue
                try:
                    if item["kind"].startswith(("radio", "checkbox")):
                        target.check(timeout=6000, force=True)
                    else:
                        target.click(timeout=8000)
                except Exception:
                    target.click(timeout=6000, force=True)
                history.append('clicked ' + item["kind"] + ' "' + item["words"][:60] + '"')
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=20000)
                except Exception:
                    pass
                pause(2.0, 3.5)
            elif action == "type_secret":
                name = answer.get("secret")
                if name not in values:
                    history.append("that saved detail does not exist; the ones that do: " + (", ".join(sorted(values)) or "none"))
                    continue
                if not item.get("field"):
                    history.append('"' + item["words"][:50] + '" is not something that can be typed into')
                    continue
                if item.get("tag") == "select":
                    value = values[name]
                    for option in [value, value.lstrip("0"), value[-2:]]:
                        try:
                            target.select_option(option, timeout=3000)
                            break
                        except Exception:
                            continue
                else:
                    target.click(timeout=6000)
                    pause(0.2, 0.5)
                    target.fill("")
                    target.press_sequentially(values[name], delay=random.randint(60, 110))
                    try:
                        target.evaluate("e => { e.style.webkitTextSecurity = 'disc'; }")
                    except Exception:
                        pass
                history.append("typed the saved " + name + ' into "' + item["words"][:50] + '"')
                pause(0.5, 1.0)
        except Stop:
            raise
        except Exception as failure:
            history.append("that did not work: " + str(failure).split("\n")[0][:120])
    return "stop", "not finished after " + str(max_steps) + " steps"


def assist_read(page, label, doing):
    """One look, no actions: the AI says in a plain sentence what the page is asking for. For error reports."""
    try:
        answer, _, _ = assist_ask(page, label, "READ ONLY. Do not click or type anything. The worker stopped while " + str(doing)[:80]
                                  + ". Answer with the action stop, and as the reason one short plain sentence saying what this page is asking for or why the order cannot continue.", 1, 1, [], [])
        if answer.get("unavailable"):
            return ""
        return " ".join(str(answer.get("reason") or "").split())[:240]
    except Exception:
        return ""


GOAL_VERIFY_CHECKOUT = ("Amazon stopped the checkout on a payment verification page right after the order was submitted. Get past it so the payment is confirmed: "
                        "for example choose the card on file, type the card number or security code again where Amazon asks, and press the button that verifies or continues. "
                        "The goal is reached when Amazon shows the order confirmation (thank you) page. If Amazon wants identity confirmed in a way the worker cannot do, stop.")
GOAL_VERIFY_ORDER = ("This placed order shows a notice that the bank requires verification of the card. Answer it: press Verify payment, choose the card on file, "
                     "type its card number again where asked, press Verify card, and accept any step that keeps the same payment method. "
                     "The goal is reached when Amazon confirms the card was verified or returns to the order. Never place a new order.")


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
        # Keep a picture of exactly what the bank / Amazon is asking for, so a person can see it.
        try:
            current_job["verify_shot"] = base64.b64encode(page.screenshot(type="jpeg", quality=55, full_page=False)).decode()
        except Exception:
            current_job["verify_shot"] = ""
        log("verify payment at checkout: nothing to fill in. frames: " + ", ".join(sorted({f.url.split("?")[0][-70:] for f in page.frames}))[:600])
        helped = verify_with_ai(page, label)
        if helped:
            return helped
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
        helped = verify_with_ai(page, label)
        if helped:
            return helped
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


def verify_with_ai(page, label):
    """The checkout verification page has nothing the worker's own steps recognize: let the AI helper work it.
    Returns the note for the order, or "" when the helper could not be asked."""
    outcome, why = assist(page, label, GOAL_VERIFY_CHECKOUT, finished=lambda: "/cpe/" not in page.url.lower())
    if outcome == "off":
        return ""
    if outcome == "done":
        current_job["verify_ai_ok"] = True
        if why == "the page moved on" and not current_job.get("ai_steps"):
            # Amazon's own payment check finished before anything had to be done: say exactly that.
            log("verify payment at checkout: Amazon's payment check passed on its own")
            return "Amazon ran a payment check at checkout and it passed on its own"
        log("verify payment at checkout: answered with the AI helper")
        return "payment verification answered at checkout (AI helper)"
    current_job["verify_reason"] = why
    try:
        current_job["verify_shot"] = base64.b64encode(page.screenshot(type="jpeg", quality=55, full_page=False)).decode()
    except Exception:
        pass
    return "Amazon asked to verify the payment: " + why


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

    look_around(page, 1, 3)  # look the order over before buying, like anyone would
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
    handed_over = False
    handover_look = [0.0]
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
        if not handed_over and human_check(page):
            # Amazon wants a person ("I am human"). The worker does not answer that: it shows the browser to the operator
            # and waits. The person ticks the box (and presses Place your order again if Amazon returns to checkout).
            handed_over = True

            def placed_now():
                nonlocal order_id, on_confirmation
                for tab in page.context.pages:
                    try:
                        if not tab.is_closed() and "thankyou" in tab.url.lower():
                            on_confirmation = True
                            return True
                    except Exception:
                        pass
                if time.time() - handover_look[0] >= 15:
                    handover_look[0] = time.time()
                    order_id = new_in_history() or order_id
                return bool(order_id)

            needs_person(page, label, "Amazon asks \"I am human\" before placing this order. Tick the box; if it returns to checkout, press Place your order.", placed_now)
            if on_confirmation or order_id:
                break
            deadline = max(deadline, time.time() + 45)
            last_look = time.time() - 15
            continue
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
    # A live tracking number means the parcel has left Amazon, even when the tracking page headlines the
    # arrival date ("Arriving Monday") instead of the word "Shipped". Treat it as shipped unless the page
    # still says it has not gone out yet.
    if result["state"] == "ordered" and result.get("tracking_number"):
        low = (str(status) + " " + str(estimate) + " " + words).lower()
        if not any(p in low for p in ["not yet shipped", "not yet dispatched", "preparing for shipment", "preparing to ship", "label created", "not yet been shipped"]):
            result["state"] = "shipped"
    result["screenshot"] = picture(page, card_only=True)
    return result


def read_order_totals(page):
    """Reads the cost summary off an order's own details page (Item(s) Subtotal / Shipping / Tax / Grand Total),
    so a manual order gets its real COGS and tax, not just a placeholder. Returns a dict with any it could read."""
    import re
    text = ""
    for selector in ["#od-subtotals", "#odSubTotals", "[data-component='orderSummary']", "#order-summary", ".a-box-group .a-box-inner"]:
        try:
            loc = page.locator(selector)
            if loc.count() > 0:
                candidate = " ".join(loc.first.inner_text(timeout=4000).split())
                if "$" in candidate and re.search(r"(grand )?total", candidate, re.I):
                    text = candidate
                    break
        except Exception:
            continue
    if not text:
        # Fall back to the smallest page region that reads like an order summary.
        try:
            body = " ".join(page.locator("body").first.inner_text(timeout=5000).split())
            spot = re.search(r"(item\(?s\)?\s*subtotal.{0,240}?(?:grand total|order total)[^$]*\$\s*[0-9,]+\.[0-9]{2})", body, re.I)
            if spot:
                text = spot.group(1)
        except Exception:
            text = ""
    if not text:
        return {}

    def money(pattern):
        m = re.search(r"(?:" + pattern + r")[^$A-Za-z0-9]{0,18}\$\s*([0-9,]+\.[0-9]{2})", text, re.I)
        return float(m.group(1).replace(",", "")) if m and m.group(1) else None

    totals = {}
    for key, pat in (
        ("items", r"item\(?s\)?\s*subtotal"),
        ("shipping", r"shipping(?: ?& ?handling| and handling)?"),
        ("tax", r"(?<!before )(?:estimated )?tax(?: to be collected)?"),  # not "Total before tax"
        ("total", r"grand total|order total"),
    ):
        value = money(pat)
        if value is not None:
            totals[key] = value
    if "items" not in totals:
        value = money(r"subtotal")
        if value is not None:
            totals["items"] = value
    return totals


DATE_RE = r"((?:Arriving|Now expected|Expected|Delivery estimate|Estimated delivery|Delivery|Delivered):?\s+(?:today|tomorrow|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day(?:,?\s+[A-Za-z]{3,9}\.?\s+\d{1,2})?|[^.|\d]{0,30}?\d{1,2}(?:\s*-\s*(?:[A-Za-z]+\.?\s+)?\d{1,2})?))"


def order_page_ok(page, number, tracking=False):
    """True only when the page on screen really shows this order (not Amazon's "unable to load" page)."""
    try:
        low = page_words(page, 4000).lower()
        if "unable to load" in low:
            return False
        if "/ap/signin" in page.url or "sign in or create account" in low or "enter mobile number or email" in low:
            return False
        if number in page.url or number in page.content():
            return True
        if tracking:
            return bool(page.evaluate(STATUS_JS) or page.evaluate(ESTIMATE_JS))
    except Exception:
        pass
    return False


def open_order(page, number, tries=2, wait=6.0, direct=False):
    """Gets one specific order on screen, the way a person would: Your Orders, that order, Track package
    (or View order details). Tries again when the order is not showing yet or Amazon says it cannot load it.
    Returns (kind, the order card's words). kind is "track", "details", "list" (only the order's card in
    Your Orders could be shown) or "" when the order could not be seen at all.
    direct=True (used for a status check) goes straight to the order's own page first, since a check already
    has the order number: same read, fewer page loads. If that page does not show the order, it falls through
    to the Your Orders walk below so nothing that worked before is lost."""
    card_words = ""
    if direct:
        try:
            page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
            settle(page)
            if order_page_ok(page, number):
                words = page_words(page, 6000)
                if account_hold(words):
                    current_job["account_on_hold"] = True
                    current_job["hold_words"] = hold_sentence(words)
                    current_job["order_on_hold"] = number
                    return "hold", words
                if state_from_words(words) != "cancelled" and click_text(page, ["Track package", "Track Package"]):
                    settle(page)
                    if order_page_ok(page, number, tracking=True):
                        return "track", words
                    page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
                    settle(page)
                if order_page_ok(page, number):
                    return "details", words
        except Stop:
            raise
        except Exception as failure:
            log("opening order " + number + " directly: " + str(failure)[:160])
    for attempt in range(tries):
        last = attempt == tries - 1
        try:
            page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
            settle(page)
            look_around(page, 1, 2)  # scan Your Orders like a person: the mouse moves and the page scrolls
            card = order_card(page, number)
            try:
                listing = page_words(page, 5000)
                if "your orders" in listing.lower() and "/ap/signin" not in page.url:
                    current_job["account_on_hold"] = account_hold(listing)
                    if current_job["account_on_hold"]:
                        current_job["hold_words"] = hold_sentence(listing)
            except Exception:
                pass
            if card is not None:
                try:
                    card_words = " ".join(card.inner_text(timeout=5000).split())
                except Exception:
                    card_words = ""
                if account_hold(card_words) or (current_job.get("account_on_hold") and state_from_words(card_words, short=True) == "ordered" and "track package" not in card_words.lower()):
                    # "Order on hold - Verify your account": show exactly that, banner and order together.
                    current_job["order_on_hold"] = number
                    try:
                        page.evaluate("window.scrollTo(0, 0)")
                    except Exception:
                        pass
                    return "hold", card_words
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
                current_job["unlisted"] = number
                log("order " + number + " is not in the list; orders listed: " + ", ".join(sorted(order_numbers(page)))[:200])
                try:
                    newest = page.locator(".order-card, .js-order-card").first
                    if attempt == 0 and newest.count() > 0:
                        log("newest order in the list reads: " + " ".join(newest.inner_text(timeout=5000).split())[:260])
                except Exception:
                    pass
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


def order_gone(page, number, listed_only=False):
    """After an order could not be opened: is it really gone from the account?
    Returns ("cancelled", picture) when it is found under Cancelled Orders, ("missing", picture of Your Orders)
    when Your Orders loads normally and the order is nowhere in the account, or ("", "") when Amazon simply
    did not load properly this time."""
    try:
        page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        low = page_words(page, 5000).lower()
        if "/ap/signin" in page.url or "unable to load" in low or "your orders" not in low:
            return "", ""
        listed = order_numbers(page)
        if number in listed:
            return "", ""
        loaded = bool(listed) or "0 orders" in low or "not placed any orders" in low or "no orders" in low
        if not loaded:
            return "", ""
        list_shot = picture(page, card_only=False)
        # A full first page means there may be more orders further back: look at the next two pages as well.
        cards = 0
        try:
            cards = page.locator(".order-card, .js-order-card").count()
        except Exception:
            pass
        start = 10
        while cards >= 10 and start <= 20:
            page.goto(ACCOUNT_PAGE + "?startIndex=" + str(start), wait_until="domcontentloaded", timeout=90000)
            settle(page)
            if number in order_numbers(page):
                return "", ""
            try:
                cards = page.locator(".order-card, .js-order-card").count()
            except Exception:
                cards = 0
            start += 10
        if cards >= 10:
            return "", ""  # a long order history: not being on the first pages proves nothing
        if start > 10:
            page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
            settle(page)
        # Amazon keeps cancelled orders on their own tab.
        try:
            if click_text(page, ["Cancelled Orders", "Cancelled orders", "Canceled Orders"]):
                settle(page)
                card = order_card(page, number)
                if card is not None or number in order_numbers(page):
                    shot = ""
                    try:
                        if card is not None:
                            card.scroll_into_view_if_needed(timeout=5000)
                            shot = base64.b64encode(card.screenshot(type="jpeg", quality=70)).decode()
                    except Exception:
                        shot = ""
                    return "cancelled", shot or picture(page, card_only=False)
        except Stop:
            raise
        except Exception:
            pass
        if listed_only:
            return "missing", list_shot
        # Its own page: when that does not show the order either, it is no longer in the account.
        page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        low = page_words(page, 4000).lower()
        if "/ap/signin" in page.url or "sign in or create account" in low:
            return "", ""
        if number in page.content() and "unable to load" not in low and "can't find" not in low and "cannot find" not in low and "couldn't find" not in low:
            return "", ""
        return "missing", list_shot
    except Stop:
        raise
    except Exception as failure:
        log("looking for a missing order " + number + ": " + str(failure)[:160])
        return "", ""


def account_hold(words):
    """Amazon has put the whole account on hold ("Verify your account - We've detected unusual account activity.
    Existing orders are on hold and new orders will be cancelled") or this order ("Order on hold")."""
    low = " ".join((words or "").lower().split())
    return ("order on hold" in low or "orders are on hold" in low or "unusual account activity" in low
            or ("verify your account" in low and "on hold" in low))


def hold_sentence(words):
    """Amazon's own words for the hold, for the error shown to the operator."""
    import re

    flat = " ".join((words or "").split())
    found = re.search(r"(We've detected unusual account activity[^.]*\.[^.]*\.)", flat)
    if found:
        return found.group(1)[:220]
    return "Amazon put this order on hold until the account is verified"


def needs_verify(words):
    """Amazon is holding the order until the card is verified ("Your bank requires verification for the card...")."""
    low = (words or "").lower()
    return "requires verification" in low or "verify payment" in low or "verify your card" in low


def in_frames(page, selector):
    """The first visible match for a selector, looking through the page and every frame in it."""
    for frame in page.frames:
        try:
            found = frame.locator(selector)
            for index in range(min(found.count(), 6)):
                if found.nth(index).is_visible():
                    return frame, found.nth(index)
        except Exception:
            continue
    return None, None


def frames_summary(page):
    """What each frame shows (field names and button words only, never values), for the log."""
    seen = []
    for frame in page.frames:
        try:
            found = frame.evaluate(FRAME_FIELDS_JS)
            seen.append({"frame": frame.url.split("?")[0][-50:], "fields": [f["tag"] + ":" + f["type"] + " " + f["key"] for f in found.get("fields", [])][:12],
                         "buttons": found.get("buttons", [])[:12], "says": found.get("says", "")[:160]})
        except Exception:
            continue
    return json.dumps(seen)[:1500]


def resolve_verify(page, number, label):
    """The worker's own steps first; when they do not get through, the AI helper works the same pages."""
    verified, why = resolve_verify_steps(page, number, label)
    if verified or why in ("the order page did not load", "no verification is being asked for"):
        return verified, why
    try:
        page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        if not order_page_ok(page, number):
            return False, why
        if not needs_verify(page_words(page, 6000)):
            return True, "payment verified"
        outcome, said = assist(page, label, GOAL_VERIFY_ORDER + " The order number is " + number + ".")
        if outcome == "off":
            return False, why
        if outcome == "stop":
            return False, said
        time.sleep(4)
        page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        if order_page_ok(page, number) and not needs_verify(page_words(page, 6000)):
            return True, "payment verified (AI helper)"
        return False, "Amazon still asks to verify the payment"
    except Stop:
        raise
    except Exception as failure:
        log("verify payment with the AI helper could not be completed: " + str(failure)[:200])
        return False, why


def resolve_verify_steps(page, number, label):
    """Answers Amazon's "Verify payment" on a placed order, the way a person does:
    order page -> Verify payment -> pick the card on file -> re-enter its number -> Verify card.
    Uses the card details saved on the account. Returns (verified, short note). The card number is typed
    into Amazon only; it is never logged."""
    import re

    try:
        page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        if not order_page_ok(page, number):
            return False, "the order page did not load"
        if not needs_verify(page_words(page, 6000)):
            return True, "no verification is being asked for"
        card = call("/api/worker/v1/accounts/card", {"account": label})
        digits = re.sub(r"\D", "", str(card.get("number") or ""))
        if not card.get("saved") or len(digits) < 12:
            return False, "no card details are saved on this account"
        last4 = digits[-4:]
        if not click_text(page, ["Verify payment", "Verify Payment"]):
            return False, "the Verify payment button could not be clicked"
        settle(page)

        # "Select a payment method": pick the card on file, then its number box appears.
        frame, box = None, None
        for attempt in range(30):
            frame, box = in_frames(page, "input[placeholder*='ending in' i]")
            if box is not None:
                break
            if attempt % 5 == 0:
                for owner in page.frames:
                    try:
                        row = owner.get_by_text(re.compile(r"ending in\s*" + last4)).first
                        if row.count() > 0 and row.is_visible():
                            radio = row.locator("xpath=ancestor::*[.//input[@type='radio']][1]//input[@type='radio']").first
                            if radio.count() > 0:
                                radio.check(timeout=4000, force=True)
                            else:
                                row.click(timeout=4000)
                            break
                    except Exception:
                        continue
            time.sleep(1)
        if box is None:
            log("verify payment: the card number box did not appear; the page shows: " + frames_summary(page))
            return False, "the card number box did not appear"

        box.click()
        box.fill("")
        box.type(digits, delay=70)
        pause(0.4, 0.9)
        typed = re.sub(r"\D", "", box.input_value())
        if len(typed) != len(digits):
            box.fill(digits)
        if not click_text_in(frame.locator("body"), ["Verify card", "Verify Card"]):
            log("verify payment: no Verify card button; the page shows: " + frames_summary(page))
            return False, "the Verify card button could not be clicked"
        log("verify payment: card number entered and Verify card clicked for order " + number)

        # Amazon may then ask to confirm the payment method for the order. Never a buy button.
        for _ in range(20):
            time.sleep(1.5)
            moved = False
            for owner in page.frames:
                try:
                    if click_text_in(owner.locator("body"), ["Use this payment method", "Continue"]):
                        moved = True
                        break
                except Stop:
                    raise
                except Exception:
                    continue
            if moved or "order-details" in page.url or "order-history" in page.url:
                break
        settle(page)
        time.sleep(4)
        page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        if order_page_ok(page, number) and not needs_verify(page_words(page, 6000)):
            return True, "payment verified"
        log("verify payment: Amazon still asks after the attempt; the page shows: " + frames_summary(page))
        return False, "Amazon still asks to verify the payment"
    except Stop:
        raise
    except Exception as failure:
        log("verify payment could not be completed: " + str(failure)[:200])
        return False, "the verification could not be completed"


def check_order(page, order):
    """One order's look at Amazon, plus one more question when the order is not in Your Orders: Amazon sometimes
    takes an order out of the account while its own page still opens and says "Ordered". Such an order is reported
    as missing (or cancelled, when it is under Cancelled Orders) instead of ordered."""
    current_job["unlisted"] = ""
    current_job["account_on_hold"] = None
    current_job["order_on_hold"] = ""
    current_job["hold_words"] = ""
    result = check_order_look(page, order)
    number = order["amazon_order_id"]
    if result.get("human") and order.get("_label"):
        # Amazon's "I am human" box: say so at once, and keep this browser open live so the person can tick it.
        # When they have, the order is looked at again right away.
        try:
            call("/api/worker/v1/orders/" + str(order.get("id") or "") + "/check", dict(result, screenshot=result.get("screenshot", "")))
        except Exception:
            pass
        try:
            call("/api/worker/v1/orders/" + str(order.get("id") or "") + "/check",
                 {"step": "Amazon shows the \"I am human\" box · waiting for you: Accounts > " + order["_label"] + " > Go to live browser"}, timeout=15)
        except Exception:
            pass
        answered = needs_person(page, order["_label"], "Amazon shows its \"I am human\" box. Tick it and the worker carries on.",
                                lambda: not human_check(page), minutes=15 if order.get("_tries") else 8)
        if answered:
            report(order["_label"], robot_check=False, session_state="signed_in", error="")
            result = check_order_look(page, order)
    result.pop("human", None)
    if current_job.get("account_on_hold") is not None:
        result["account_on_hold"] = bool(current_job["account_on_hold"])
        if current_job["account_on_hold"]:
            result["account_hold_words"] = current_job.get("hold_words") or ""
    if current_job.get("unlisted") == number and result.get("state") == "ordered" and not result.get("missing") and not order.get("_tries"):
        try:
            gone, shot = order_gone(page, number, listed_only=True)
        except Stop:
            raise
        except Exception:
            gone, shot = "", ""
        if gone == "cancelled":
            log("order " + number + " is under Cancelled Orders")
            result.update({"state": "cancelled", "note": "", "screenshot": shot})
        elif gone == "missing":
            # The order's own page opens and shows a live order, so it stands. Amazon sometimes leaves an order out of
            # the Your Orders list while it is still on its way (DD-100002 shipped the morning after it vanished from the list).
            # An order counts as gone only when its own page no longer shows it either (see order_gone).
            log("order " + number + " is not in the Your Orders list, but its own page shows it: it stands")
    current_job["unlisted"] = ""
    return result


def check_order_look(page, order):
    """Looks one placed order up on Amazon the way a person would: Your Orders, that order, Track package.
    Returns what Amazon shows: state (ordered, shipped, delivered, cancelled), the delivery estimate, the
    tracking number and carrier when shown, a short note, and a picture. The picture is only ever of a page
    that shows this order; when the order cannot be opened, nothing is reported as changed."""
    import re

    number = order["amazon_order_id"]
    result = {"state": order.get("status") if order.get("status") in ("ordered", "shipped") else "ordered",
              "delivery_estimate": "", "tracking_number": "", "carrier": "", "note": "", "screenshot": ""}

    # First, the order's own page: that is where Amazon puts "Your bank requires verification" and the
    # Verify payment button. (The tracking view, which is looked at next, does not show it.) Only for orders
    # that have not shipped. Right after an order whose checkout asked for verification, look a few times:
    # the notice can take a minute to appear.
    # Only teleport to the order's own page when a verify notice is expected (right after placing). On a routine
    # check we do not deep-link at all: open_order walks Your Orders like a person, and the verify notice is still
    # caught below from the order page once it is open.
    seen_hold = False
    if order.get("status") != "shipped" and order.get("_verify_expected"):
        for look in range(4):
            try:
                page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
                settle(page)
                if order_page_ok(page, number) and needs_verify(page_words(page, 6000)):
                    seen_hold = True
                    break
            except Stop:
                raise
            except Exception:
                pass
            if order.get("_verify_expected") and look < 3:
                time.sleep(15)
    if seen_hold:
        log("order " + number + ": Amazon is asking to verify the payment")

    kind, card_words = ("details", "") if seen_hold else open_order(page, number, tries=int(order.get("_tries") or 3), wait=float(order.get("_wait") or 6.0))
    if not kind:
        gone, shot = order_gone(page, number)
        if gone == "cancelled":
            log("order " + number + " is under Cancelled Orders")
            result.update({"state": "cancelled", "note": "", "screenshot": shot})
            return result
        if gone == "missing":
            # Your Orders loads fine and this order is not in the account. DiceDrop marks it after it is missing three checks in a row.
            log("order " + number + " is not in the Amazon account any more (Your Orders loaded, order not listed, its page does not show it)")
            result.update({"missing": True, "screenshot": shot})
            return result
        # Nobody can see this order right now. That is never left as a quiet "Ordered": the picture of what Amazon shows
        # goes with the report, and DiceDrop turns the order into an error (at once for a just-placed order).
        if human_check(page):
            log("order " + number + ": Amazon is asking this account to confirm a person is there")
            # Its own name, so it is never mistaken for Amazon's "Verify your account" hold.
            result.update({"state": "verify", "note": "Human check", "attempted": False, "human": True,
                           "verify_detail": "Amazon shows its \"I am human\" box on this account. Tick it in the account's live browser; the order itself is not on hold.",
                           "screenshot": picture(page, card_only=False)})
            if order.get("_label"):
                report(order["_label"], robot_check=True, session_state="verification",
                       error="Amazon shows its \"I am human\" box. Open the live browser and tick it.")
            return result
        log("order " + number + " could not be found on Amazon (not in Your Orders, and its own page did not open)")
        result.update({"unseen": True, "fresh": bool(order.get("_tries")), "screenshot": picture(page, card_only=False),
                       "verify_detail": "the order is not in Your Orders and its own page does not open"})
        return result

    if kind == "hold":
        # Amazon wants the account itself verified. Only the account's owner can do that: report it, with the picture.
        log("order " + number + ": Amazon has the order on hold until the account is verified")
        result.update({"state": "verify", "note": "Verify Account", "attempted": False,
                       "verify_detail": current_job.get("hold_words") or hold_sentence(card_words),
                       "screenshot": picture(page, card_only=False)})
        if order.get("_label"):
            report(order["_label"], session_state="verification", error="Amazon asks to verify the account (unusual account activity). Its orders are on hold.")
        return result

    # Amazon holding the order for card verification: try to answer it (twice at most), otherwise report it.
    asked = seen_hold or needs_verify(card_words) or (kind != "list" and needs_verify(page_words(page, 6000)))
    if asked:
        attempts = int(order.get("verify_attempts") or 0)
        label = order.get("_label") or ""
        verified, why = (False, "left for a person after two tries")
        tried = False
        if label and attempts < 2:
            tried = True
            verified, why = resolve_verify(page, number, label)
            log("order " + number + " verify payment: " + why)
        if not verified:
            try:
                page.goto(ORDER_DETAILS + number, wait_until="domcontentloaded", timeout=90000)
                settle(page)
            except Exception:
                pass
            result.update({"state": "verify", "note": "Verify Payment", "attempted": tried, "verify_detail": why,
                           "screenshot": picture(page, card_only=False) if order_page_ok(page, number) else ""})
            return result
        result["verified"] = True
        kind, card_words = open_order(page, number, tries=2, wait=5.0)
        if not kind:
            result["state"] = "ordered"
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
        # On the order's own page, read its cost summary so COGS/tax land on the order (mainly for manual orders).
        try:
            for key, value in read_order_totals(page).items():
                result[key] = value
        except Exception:
            pass
    return result


def tracking_job(job):
    label = job.get("account_label") or ""
    orders = job.get("orders") or []
    problem = ""
    def step(text, only=None, reset=False):
        # Where the check is, and what it saw, for the operator. Kept as a short trail on the order (reset starts a
        # fresh trail at the top of a session). Changes nothing about the order itself.
        for one in ([only] if only else orders):
            try:
                call("/api/worker/v1/orders/" + str(one["id"]) + "/check", {"step": text, "reset": reset}, timeout=15)
            except Exception:
                pass

    try:
        current_job["text"] = "checking orders on " + label
        step("VPS picked it up · opening " + label + "'s browser", reset=True)

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            step("browser open · going to amazon.com and Your Orders like a person")
            # A check now arrives the human way: amazon.com, then Your Orders, mouse moving and scrolling, then
            # click into the order. Slower than a straight deep link, but it does not look like a bot teleporting.
            state, reason = amazon_sign_in(page, label, secrets)
            if state != "signed_in":
                for one in orders:
                    try:
                        step("could not sign in · " + reason[:90], only=one)
                    except Exception:
                        pass
                report(label, session_state=state, error=reason, note="sign-in did not finish")
                raise Stop("Amazon sign-in did not finish. " + reason)
            report(label, session_state="signed_in", error="")
            changes = 0
            for order in orders:
                stage[0] = "checking order " + str(order.get("order_number"))
                step("signed in · opening the order from Your Orders", only=order)
                try:
                    order["_label"] = label
                    look_around(page, 1, 3)  # move the mouse and scroll Your Orders like a person before opening the order
                    seen = check_order(page, order)
                    # The picture always goes along; DiceDrop keeps it the first time each milestone is seen.
                    reply = call("/api/worker/v1/orders/" + order["id"] + "/check", seen)
                    log("order " + str(order.get("order_number")) + " on Amazon: " + seen["state"] + (" · " + seen["note"] if seen["note"] else ""))
                    changes += 1 if reply.get("changed") else 0
                    st, note = seen.get("state"), seen.get("note") or ""
                    if seen.get("unseen") or note == "Not found on Amazon":
                        outcome = "could not find the order on Amazon"
                    elif seen.get("missing"):
                        outcome = "the order is no longer in the account"
                    elif st == "cancelled":
                        outcome = "saw the order is cancelled"
                    elif st == "verify" and note == "Human check":
                        outcome = "saw Amazon's \"I am human\" box · handed to you"
                    elif st == "verify" and note == "Verify Account":
                        outcome = "saw Amazon is holding the account"
                    elif st == "verify":
                        outcome = "saw Amazon ask to verify the payment"
                    else:
                        outcome = "read the order: " + str(st) + (" · screenshot saved" if seen.get("screenshot") else "")
                    step(outcome, only=order)
                except Stop:
                    raise
                except Exception as failure:
                    log("could not check order " + str(order.get("order_number")) + ": " + str(failure)[:200])
                    try:
                        step("could not read the order · " + str(failure)[:90], only=order)
                    except Exception:
                        pass
                pause(2.0, 4.0)
            step("session finished · closed the browser")
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


WARM_SEARCHES = ["desk lamp", "phone charger", "water bottle", "notebook", "kitchen towels", "led light bulbs", "storage bins", "coffee mug",
                 "running socks", "usb c cable", "dog toys", "throw pillow", "bluetooth speaker", "garden hose", "tool set", "backpack",
                 "wall clock", "shower curtain", "hand soap", "air fryer", "picture frames", "board games", "yoga mat", "office chair"]


def warm_up_browse(page, minutes):
    """Browses Amazon the way a shopper does: searches, opens a few products, reads down the page, looks at Your Orders.
    It never adds to the cart and never goes to checkout. Returns a short summary."""
    ends = time.time() + minutes * 60
    searched, opened = 0, 0

    def still_welcome(where):
        # Amazon's "are you a person / I am human" page. The worker never answers it: the session ends here and the account is flagged.
        if human_check(page) or visible(page, CAPTCHA):
            raise RobotCheck("Amazon asked whether a person is there (" + where + "). The session stopped at once; nothing was answered.")

    def scroll(times):
        for _ in range(times):
            try:
                if random.random() < 0.6:
                    human_move(page, random.uniform(250, 1000), random.uniform(200, 600))  # the pointer drifts while reading
                page.mouse.wheel(0, random.randint(350, 900))
            except Exception:
                pass
            pause(1.2, 3.5)

    page.goto("https://www.amazon.com/", wait_until="domcontentloaded", timeout=90000)
    settle(page)
    still_welcome("on the home page")
    scroll(random.randint(1, 3))
    for term in random.sample(WARM_SEARCHES, 4):
        if time.time() > ends:
            break
        box = first_visible(page, "#twotabsearchtextbox, input[name='field-keywords']")
        if box is None:
            page.goto("https://www.amazon.com/s?k=" + term.replace(" ", "+"), wait_until="domcontentloaded", timeout=90000)
        else:
            try:
                box.click(timeout=6000)
                box.fill("")
                box.press_sequentially(term, delay=random.randint(70, 140))
                pause(0.4, 1.0)
                box.press("Enter")
            except Stop:
                raise
            except Exception:
                # Something is covering the search box (a pop-up): go to the results directly instead.
                page.goto("https://www.amazon.com/s?k=" + term.replace(" ", "+"), wait_until="domcontentloaded", timeout=90000)
        settle(page)
        still_welcome("after a search")
        searched += 1
        scroll(random.randint(2, 4))
        for _ in range(random.randint(1, 2)):
            if time.time() > ends:
                break
            try:
                links = page.locator("div[data-component-type='s-search-result'] h2 a, div[data-component-type='s-search-result'] a.a-link-normal.s-no-outline")
                count = min(links.count(), 12)
                if count == 0:
                    break
                link = links.nth(random.randint(0, count - 1))
                address = link.get_attribute("href") or ""
                if not address or "/sspa/" in address:
                    continue
                # Open the product the way a shopper does: move the pointer to its title and click it.
                try:
                    link.evaluate("e => e.removeAttribute('target')")  # keep it in this tab
                    link.click(timeout=8000)
                    page.wait_for_load_state("domcontentloaded", timeout=60000)
                except Stop:
                    raise
                except Exception:
                    page.goto(address if address.startswith("http") else "https://www.amazon.com" + address, wait_until="domcontentloaded", timeout=90000)
                settle(page)
                still_welcome("on a product page")
                opened += 1
                scroll(random.randint(3, 7))
                pause(2.0, 6.0)
                page.go_back(wait_until="domcontentloaded", timeout=60000)
                settle(page)
            except Stop:
                raise
            except Exception:
                break
    still_welcome("at the end")
    try:
        page.goto(ACCOUNT_PAGE, wait_until="domcontentloaded", timeout=90000)
        settle(page)
        scroll(1)
    except Exception:
        pass
    return "browsed " + str(searched) + " search" + ("" if searched == 1 else "es") + " and " + str(opened) + " product" + ("" if opened == 1 else "s")


def warm_up_job(label):
    problem = ""
    try:
        current_job["text"] = "warming up " + label

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            state, reason = amazon_sign_in(page, label, secrets)
            if state != "signed_in":
                report(label, session_state=state, error=reason, note="sign-in did not finish")
                raise Stop("Amazon sign-in did not finish. " + reason)
            report(label, session_state="signed_in", error="")
            stage[0] = "browsing Amazon"
            return warm_up_browse(page, random.uniform(3.0, 5.5))

        _, problem, _, _ = run_in_account_browser(
            label, lambda text: None, work, reason="warm-up",
            summary=lambda r, e: (False, e) if e else (True, str(r or "browsed")))
        if problem and "whether a person is there" in problem:
            report(label, robot_check=True, error="Amazon is asking this account to confirm a person is there. Open its browser and answer it. Warm-up and orders are paused for it until then.")
        log("warm-up for " + label + " finished" + (": " + problem if problem else ""))
    except Exception as failure:
        problem = "The warm-up could not run: " + str(failure)[:200]
    finally:
        try:
            call("/api/worker/v1/accounts/warmed", {"account": label, "error": problem})
        except Exception as failure:
            log("could not record the warm-up: " + str(failure)[:200])
        current_job["text"] = ""
        job_lock.release()


# ---------------------------------------------------------------- live browser (an account's browser, used by hand)
#
# "Open browser" in DiceDrop opens the account's own Kameleo browser on its own proxy and shows it live in a
# browser tab: a picture of the page that refreshes several times a second, with every click, scroll and key
# passed through. It is the same browser the worker later orders from. The view is reached over an encrypted
# tunnel at an address only that session knows. While it is open the worker leaves the account alone.

LIVE_IDLE_MINUTES = 30
LIVE_MAX_MINUTES = 120

VIEWER_HTML = r"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>DiceDrop live browser · __LABEL__</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0f1115;color:#e6e8ee;font:14px/1.3 system-ui,sans-serif}
#bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;background:#171a21;border-bottom:1px solid #2a2f3a;position:sticky;top:0;z-index:2}
#bar b{margin-right:4px}button,select,input{font:inherit;color:#e6e8ee;background:#222734;border:1px solid #343b4a;border-radius:6px;padding:6px 10px;min-height:34px}
button{cursor:pointer}button:hover{background:#2b3242}#url{flex:1;min-width:180px}#txt{width:180px}
#done{border-color:#b33;color:#f88}#wrap{padding:8px;text-align:center}
#view{max-width:100%;outline:2px solid #2a2f3a;cursor:default;touch-action:none;user-select:none;-webkit-user-drag:none}
#view.on{outline-color:#4ade80}#note{padding:4px 8px;color:#9aa3b5;font-size:12px}
</style></head><body>
<div id="bar"><b>__LABEL__</b>
<button id="back" title="Back">&#8592;</button><button id="reload" title="Reload">&#8635;</button>
<input id="url" placeholder="address" autocomplete="off" spellcheck="false"><button id="go">Go</button>
<select id="tabs" title="Tabs"></select>
<button data-s="email">Type email</button><button data-s="password">Type password</button><button data-s="code">Type 2-step code</button>
<input id="txt" placeholder="text to type or paste" autocomplete="off"><button id="send">Type it</button>
<button id="done">Done · close browser</button></div>
<div id="note">Click the page once (green outline), then use it like a normal browser. Clicks, scrolling and typing go to the account's browser on the VPS.</div>
<div id="wrap"><img id="view" tabindex="0" alt="loading the browser..."></div>
<script>
const view=document.getElementById('view'),note=document.getElementById('note'),url=document.getElementById('url'),tabs=document.getElementById('tabs');
let seq=0,pending=[],sending=false,over=false,lastMove=0,lastWheel=0,oldSrc='';
function push(e){pending.push(e);flush()}
async function flush(){if(sending||!pending.length)return;sending=true;const batch=pending;pending=[];
  try{await fetch('input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch})})}catch(x){}
  sending=false;if(pending.length)flush()}
function at(ev){const r=view.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height))}}
const BTN=['left','middle','right'];
view.addEventListener('mousedown',e=>{e.preventDefault();view.focus();push({t:'down',b:BTN[e.button]||'left',...at(e)})});
window.addEventListener('mouseup',e=>{if(document.activeElement===view)push({t:'up',b:BTN[e.button]||'left',...at(e)})});
view.addEventListener('mousemove',e=>{const n=Date.now();if(n-lastMove<70)return;lastMove=n;push({t:'move',...at(e)})});
view.addEventListener('contextmenu',e=>e.preventDefault());
view.addEventListener('wheel',e=>{e.preventDefault();const n=Date.now();if(n-lastWheel<50)return;lastWheel=n;push({t:'wheel',dx:e.deltaX,dy:e.deltaY,...at(e)})},{passive:false});
view.addEventListener('focus',()=>view.classList.add('on'));view.addEventListener('blur',()=>view.classList.remove('on'));
view.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v')return;e.preventDefault();push({t:'key',a:'down',k:e.key})});
view.addEventListener('keyup',e=>{e.preventDefault();push({t:'key',a:'up',k:e.key})});
view.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text');if(t)push({t:'text',v:t,paste:true})});
let touch=null;
view.addEventListener('touchstart',e=>{const p=e.touches[0];touch={x:p.clientX,y:p.clientY,moved:false};e.preventDefault()},{passive:false});
view.addEventListener('touchmove',e=>{const p=e.touches[0];if(!touch)return;const dy=touch.y-p.clientY,dx=touch.x-p.clientX;if(Math.abs(dy)+Math.abs(dx)>6){touch.moved=true;push({t:'wheel',dx:dx,dy:dy,...at(p)});touch.x=p.clientX;touch.y=p.clientY}e.preventDefault()},{passive:false});
view.addEventListener('touchend',e=>{if(touch&&!touch.moved){const p={clientX:touch.x,clientY:touch.y};push({t:'down',b:'left',...at(p)});push({t:'up',b:'left',...at(p)})}touch=null;e.preventDefault()},{passive:false});
document.getElementById('back').onclick=()=>push({t:'back'});document.getElementById('reload').onclick=()=>push({t:'reload'});
function go(){let u=url.value.trim();if(!u)return;if(!/^https?:\/\//i.test(u))u='https://'+u;push({t:'nav',v:u});view.focus()}
document.getElementById('go').onclick=go;url.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
tabs.onchange=()=>push({t:'tab',i:Number(tabs.value)});
document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{push({t:'secret',v:b.dataset.s});view.focus()});
const txt=document.getElementById('txt');function sendText(){if(txt.value){push({t:'text',v:txt.value});txt.value='';view.focus()}}
document.getElementById('send').onclick=sendText;txt.addEventListener('keydown',e=>{if(e.key==='Enter')sendText()});
document.getElementById('done').onclick=()=>{if(confirm('Close this browser? The account stays signed in on the VPS.')){push({t:'close'});over=true;note.textContent='Closed. You can close this tab.'}};
async function loop(){while(!over){try{const r=await fetch('frame?since='+seq,{cache:'no-store'});
  if(r.status===410){over=true;note.textContent='This browser has been closed. You can close this tab.';break}
  if(r.status===200){seq=Number(r.headers.get('X-Seq'))||seq;let info={};try{info=JSON.parse(decodeURIComponent(r.headers.get('X-Info')||'%7B%7D'))}catch(x){}
    const src=URL.createObjectURL(await r.blob());view.src=src;if(oldSrc)URL.revokeObjectURL(oldSrc);oldSrc=src;
    if(document.activeElement!==url)url.value=info.url||'';document.title=(info.title||'')+' · __LABEL__';
    const want=(info.tabs||[]).map((t,i)=>i+'|'+t).join('\n');if(tabs.dataset.k!==want){tabs.dataset.k=want;tabs.innerHTML='';(info.tabs||[]).forEach((t,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Tab '+(i+1)+': '+t;tabs.appendChild(o)})}
    tabs.value=String(info.tab||0);if(info.note)note.textContent=info.note}
  }catch(x){await new Promise(s=>setTimeout(s,800))}}}
loop();
</script></body></html>"""


class LiveView:
    """What the viewer page and the browser session share: the newest picture, and the clicks and keys waiting to be played."""

    def __init__(self, token, label):
        import queue

        self.token, self.label = token, label
        self.frame, self.seq = b"", 0
        self.cond = threading.Condition()
        self.events = queue.Queue()
        self.info = {"url": "", "title": "", "tabs": [], "tab": 0, "note": ""}
        self.closed = False
        self.last_input = time.time()

    def set_frame(self, data):
        with self.cond:
            self.frame = data
            self.seq += 1
            self.cond.notify_all()

    def close(self):
        with self.cond:
            self.closed = True
            self.cond.notify_all()


def live_handler(view):
    import http.server
    import urllib.parse

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def plain(self, status, body=b"", kind="text/plain", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Robots-Tag", "noindex")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def rest(self):
            path = urllib.parse.urlparse(self.path)
            prefix = "/" + view.token
            if path.path != prefix and not path.path.startswith(prefix + "/"):
                return None, {}
            return path.path[len(prefix):], urllib.parse.parse_qs(path.query)

        def do_GET(self):
            rest, query = self.rest()
            if rest is None:
                return self.plain(404, b"not found")
            if rest == "":
                return self.plain(302, extra={"Location": "/" + view.token + "/"})
            if rest == "/":
                return self.plain(200, VIEWER_HTML.replace("__LABEL__", view.label).encode(), "text/html; charset=utf-8")
            if rest == "/frame":
                try:
                    since = int((query.get("since") or ["0"])[0])
                except ValueError:
                    since = 0
                with view.cond:
                    if view.seq <= since and not view.closed:
                        view.cond.wait(timeout=8)
                    if view.closed:
                        return self.plain(410, b"closed")
                    if view.seq <= since or not view.frame:
                        return self.plain(204)
                    data, seq, info = view.frame, view.seq, dict(view.info)
                return self.plain(200, data, "image/jpeg", {"X-Seq": str(seq), "X-Info": urllib.parse.quote(json.dumps(info)[:1800])})
            return self.plain(404, b"not found")

        def do_POST(self):
            rest, _ = self.rest()
            if rest != "/input":
                return self.plain(404, b"not found")
            try:
                size = min(int(self.headers.get("Content-Length") or 0), 200000)
                body = json.loads(self.rfile.read(size).decode() or "{}")
                for event in (body.get("events") or [])[:200]:
                    if isinstance(event, dict):
                        view.events.put(event)
                view.last_input = time.time()
            except Exception:
                return self.plain(400, b"bad request")
            return self.plain(204)

    return Handler


def ensure_tunnel_tool():
    """The small program that gives the live view an encrypted public address. Downloaded once."""
    import shutil

    path = os.path.join(LIB, "cloudflared")
    if os.path.exists(path) and os.path.getsize(path) > 5000000:
        return path
    os.makedirs(LIB, exist_ok=True)
    log("downloading the secure tunnel tool (one time)")
    request = urllib.request.Request("https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=240) as response, open(path + ".part", "wb") as out:
        shutil.copyfileobj(response, out)
    os.replace(path + ".part", path)
    os.chmod(path, 0o755)
    return path


def open_tunnel(port):
    """Returns (process, https address). The address is random and only reaches this one live view."""
    import re

    with install_guard:
        tool = ensure_tunnel_tool()
    process = subprocess.Popen([tool, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + str(port)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    found, tail = [""], []

    def read():
        for line in process.stdout:
            tail.append(line.strip()[:200])
            del tail[:-6]
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if match and not found[0] and "//api." not in match.group(0):
                found[0] = match.group(0)

    threading.Thread(target=read, daemon=True).start()
    for _ in range(90):
        if found[0]:
            time.sleep(4)  # the address needs a few seconds before it answers
            return process, found[0]
        if process.poll() is not None:
            break
        time.sleep(0.5)
    try:
        process.terminate()
    except Exception:
        pass
    raise Stop("The secure tunnel for the live view did not start. " + " | ".join(tail)[:400])


LIVE_KEYS = {" ": "Space", "Esc": "Escape", "Del": "Delete", "Left": "ArrowLeft", "Right": "ArrowRight", "Up": "ArrowUp", "Down": "ArrowDown", "OS": "Meta"}
LIVE_IGNORED_KEYS = ("Unidentified", "Dead", "Process", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "ContextMenu")


def live_session(page, secrets, label, view, announce, until=None, idle_minutes=None, max_minutes=None):
    """Runs on the thread that owns the browser: plays the waiting clicks and keys, then takes a new picture, over and over."""
    context = page.context
    current, known = page, len(context.pages)
    size, sized_at, last_shot, started = (1280, 720), 0.0, b"", time.time()
    held = set()

    def play(event):
        nonlocal current
        kind = event.get("t")
        x, y = float(event.get("x") or 0) * size[0], float(event.get("y") or 0) * size[1]
        if kind == "move":
            current.mouse.move(x, y)
        elif kind == "down":
            current.mouse.move(x, y)
            current.mouse.down(button=event.get("b") if event.get("b") in ("left", "middle", "right") else "left")
        elif kind == "up":
            current.mouse.up(button=event.get("b") if event.get("b") in ("left", "middle", "right") else "left")
        elif kind == "wheel":
            current.mouse.move(x, y)
            current.mouse.wheel(max(-1500, min(1500, float(event.get("dx") or 0))), max(-1500, min(1500, float(event.get("dy") or 0))))
        elif kind == "key":
            key = str(event.get("k") or "")
            key = LIVE_KEYS.get(key, key)
            if not key or key in LIVE_IGNORED_KEYS:
                return
            if event.get("a") == "down":
                try:
                    current.keyboard.down(key)
                    held.add(key)
                except Exception:
                    if len(key) == 1:
                        current.keyboard.insert_text(key)
            elif key in held:
                held.discard(key)
                current.keyboard.up(key)
        elif kind == "text":
            text = str(event.get("v") or "")[:4000]
            if event.get("paste"):
                current.keyboard.insert_text(text)
            else:
                current.keyboard.type(text, delay=random.randint(45, 90))
        elif kind == "secret":
            name = event.get("v")
            if name == "email":
                current.keyboard.type(secrets.get("login_email") or "", delay=random.randint(60, 110))
            elif name == "password":
                current.keyboard.type(secrets.get("password") or "", delay=random.randint(60, 110))
            elif name == "code":
                if not secrets.get("totp_enabled"):
                    view.info["note"] = "No 2-step key is saved for this account."
                    return
                code = call("/api/worker/v1/totp", {"account": label})
                current.keyboard.type(str(code.get("code") or ""), delay=random.randint(60, 110))
        elif kind == "nav":
            target = str(event.get("v") or "")
            if target.lower().startswith(("http://", "https://")):
                current.goto(target, wait_until="commit", timeout=60000)
        elif kind == "back":
            current.go_back(wait_until="commit", timeout=30000)
        elif kind == "reload":
            current.reload(wait_until="commit", timeout=60000)
        elif kind == "tab":
            pages = [p for p in context.pages if not p.is_closed()]
            index = int(event.get("i") or 0)
            if 0 <= index < len(pages):
                current = pages[index]
                current.bring_to_front()
        elif kind == "close":
            view.close()

    announce()
    info_at = 0.0
    until_at = time.time()
    while not view.closed:
        now = time.time()
        batch = []
        if now - view.last_input > (idle_minutes or LIVE_IDLE_MINUTES) * 60 or now - started > (max_minutes or LIVE_MAX_MINUTES) * 60:
            break
        if until is not None and now - until_at > 1.5:
            # The worker opened this view because Amazon asked for a person: it ends by itself once that is answered.
            until_at = now
            try:
                if until():
                    break
            except Stop:
                raise
            except Exception:
                pass
        try:
            pages = [p for p in context.pages if not p.is_closed()]
            if not pages:
                pages = [context.new_page()]
            if len(pages) > known or current.is_closed() or current not in pages:
                current = pages[-1]  # a link opened a new tab, or the tab in view was closed
                info_at = 0.0
            known = len(pages)
            # Clicks and keys first, in the order they were made. A run of mouse moves only needs its last one.
            while len(batch) < 80:
                try:
                    batch.append(view.events.get_nowait())
                except Exception:
                    break
            for index, event in enumerate(batch):
                if event.get("t") == "move" and index + 1 < len(batch) and batch[index + 1].get("t") == "move":
                    continue
                try:
                    play(event)
                except Stop:
                    raise
                except Exception as failure:
                    view.info["note"] = "That did not go through: " + str(failure).split("\n")[0][:120]
            if now - sized_at > 2:
                sized_at = now
                try:
                    width, height = current.evaluate("[window.innerWidth, window.innerHeight]")
                    if width and height:
                        size = (width, height)
                except Exception:
                    pass
            if now - info_at > 1:
                info_at = now
                before = json.dumps(view.info, sort_keys=True)
                try:
                    view.info.update({"url": current.url[:300], "title": current.title()[:80], "tab": pages.index(current),
                                      "tabs": [(p.url.split("//")[-1][:40] or "new tab") for p in pages]})
                except Exception:
                    pass
                if json.dumps(view.info, sort_keys=True) != before:
                    last_shot = b""  # the address or the tabs changed: send the picture again so the viewer shows them
            shot = current.screenshot(type="jpeg", quality=60, timeout=8000)
            if shot != last_shot:
                last_shot = shot
                view.set_frame(shot)
        except Stop:
            raise
        except Exception:
            time.sleep(0.3)
        time.sleep(0.04 if batch else 0.12)
    for key in list(held):
        try:
            current.keyboard.up(key)
        except Exception:
            pass
    return int((time.time() - started) / 60)


def human_check(page):
    """Amazon's "prove you are a person" page ("Check the box to continue. I am human"). The worker never answers it itself."""
    try:
        address = page.url.lower()
        if "/checkpoint" in address or "/errors/validatecaptcha" in address:
            return True
        words = page_words(page, 500).lower()
        return "i am human" in words or "check the box to continue" in words or "enter the characters you see" in words
    except Exception:
        return False


def needs_person(page, label, why, until, minutes=20):
    """Amazon is asking for a person. The worker keeps this same browser open, shows it live to the operator
    (the account shows "Go to live browser" in DiceDrop), and waits until the person has answered or the time is up.
    Returns True when `until()` came true."""
    import http.server

    answered = [False]

    def done():
        if until():
            answered[0] = True
        return answered[0]

    def tell(**fields):
        try:
            return call("/api/worker/v1/accounts/browser", dict(fields, account=label))
        except Exception as failure:
            log("could not report the hand-over for " + label + ": " + str(failure)[:160])
            return {}

    view = LiveView(os.urandom(18).hex(), label)
    view.info["note"] = why
    server, tunnel = None, None
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), live_handler(view))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        tunnel, address = open_tunnel(server.server_address[1])
        note = current_job.get("progress")

        def watch_for_close():
            while not view.closed:
                if tell(state="open").get("close"):
                    view.close()
                    return
                time.sleep(10)

        def announce():
            tell(state="needs_you", url=address + "/" + view.token + "/", note="NEEDS YOU · " + why)
            log("needs a person on " + label + ": " + why + " (live view open for " + str(minutes) + " minutes)")
            if note:
                try:
                    note(note="NEEDS YOU · " + why + " · Accounts > " + label + " > Go to live browser")
                except Exception:
                    pass
            threading.Thread(target=watch_for_close, daemon=True).start()

        live_session(page, {}, label, view, announce, until=done, idle_minutes=minutes, max_minutes=minutes)
    except Stop as failure:
        log("hand-over for " + label + " could not be offered: " + str(failure)[:200])
    finally:
        view.close()
        for closer in (lambda: server and server.shutdown(), lambda: tunnel and tunnel.terminate()):
            try:
                closer()
            except Exception:
                pass
        tell(state="closed", note="answered by hand" if answered[0] else "nobody answered in time")
    log("hand-over for " + label + (": answered" if answered[0] else ": not answered"))
    return answered[0]


def live_browser_job(label):
    """Opens one account's browser for the operator to use by hand, and keeps it open until they are done."""
    import http.server

    outcome = ""
    tunnel, server = None, None

    def tell(**fields):
        try:
            return call("/api/worker/v1/accounts/browser", dict(fields, account=label))
        except Exception as failure:
            log("could not report on the live browser for " + label + ": " + str(failure)[:160])
            return {}

    try:
        current_job["text"] = "live browser " + label
        tell(state="opening", note="opening the browser")

        def work(page, secrets, stage):
            nonlocal tunnel, server
            stage[0] = "opening the live view"
            view = LiveView(os.urandom(18).hex(), label)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), live_handler(view))
            server.daemon_threads = True
            threading.Thread(target=server.serve_forever, daemon=True).start()
            tell(state="opening", note="starting the secure connection")
            tunnel, address = open_tunnel(server.server_address[1])

            def watch_for_close():
                # The operator can also close it from DiceDrop. Asked every 10 seconds, which also says "still open".
                while not view.closed:
                    if tell(state="open").get("close"):
                        view.close()
                        return
                    time.sleep(10)

            def announce():
                tell(state="open", url=address + "/" + view.token + "/", note="open")
                log("live browser for " + label + " is open")
                threading.Thread(target=watch_for_close, daemon=True).start()

            stage[0] = "showing the browser"
            try:
                page.goto("https://www.amazon.com/", wait_until="commit", timeout=60000)
            except Exception:
                pass
            try:
                minutes = live_session(page, secrets, label, view, announce)
            finally:
                view.close()
            return "used by hand for " + str(minutes) + " minute" + ("" if minutes == 1 else "s")

        result, problem, _, _ = run_in_account_browser(
            label, lambda text: tell(state="opening", note=text), work, reason="manual browser",
            summary=lambda r, e: (False, e) if e else (True, str(r or "used by hand")))
        outcome = problem or str(result or "closed")
        log("live browser for " + label + " closed" + (": " + problem if problem else ""))
    except Exception as failure:
        outcome = "The live browser could not open: " + str(failure)[:200]
    finally:
        for closer in (lambda: server and server.shutdown(), lambda: tunnel and tunnel.terminate()):
            try:
                closer()
            except Exception:
                pass
        tell(state="closed", note=outcome)
        ship_log("job", "live browser " + label)
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
        current_job["progress"] = progress
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
                    # The order was created, so Amazon's payment check at checkout let it through.
                    # The remark stays on the order (and keeps it on a 3-minute watch for 50 minutes).
                    totals["verify"] = "Amazon showed its Confirm your identity page at checkout"
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
                seen = {"state": "ordered", "delivery_estimate": "", "note": "", "tracking_number": "", "carrier": "", "screenshot": ""}
                if order_id:
                    try:
                        seen = check_order(page, {"id": job.get("id"), "amazon_order_id": order_id, "status": "ordered", "_label": label, "_tries": 10, "_wait": 12.0, "verify_attempts": 0,
                                                 "_verify_expected": bool(current_job.get("verify_note"))})
                    except Stop:
                        raise
                    except Exception as failure:
                        log("after ordering: could not look at the order: " + str(failure)[:200])
                if not seen.get("delivery_estimate") and current_job.get("thankyou_estimate"):
                    seen["delivery_estimate"] = current_job["thankyou_estimate"]
                # Amazon's "Verify payment - Confirm your identity to complete this payment" page at checkout: the page has
                # nothing to click, moves on, and Amazon still creates the order. Every order that went through it was then
                # cancelled or held by Amazon within minutes (DD-100011, DD-100013, DD-100010, DD-100004), even though the
                # order page and the account showed nothing at first. So such an order is reported as Verify Payment right away,
                # with the picture of that page. It is watched every 3 minutes and turns Ordered only if it is still standing after 45.
                if current_job.get("verify_note") and seen.get("state") == "ordered" and not seen.get("verified") and not current_job.get("verify_ai_ok"):
                    # Amazon or the bank asked to confirm the payment during checkout and it was not answered.
                    # The order exists, but Amazon cancels these if the payment is not confirmed: say so now.
                    seen["state"] = "verify"
                    seen["note"] = "Verify Payment"
                    seen["attempted"] = False
                    seen["verify_detail"] = ("Amazon showed \"Confirm your identity to complete this payment\" at checkout. Orders that go through that page "
                                             "have been cancelled by Amazon within minutes, so this one is watched until it ships or is cancelled.")
                    if current_job.get("verify_shot"):
                        seen["screenshot"] = current_job["verify_shot"]
                current_job["shot"] = seen.get("screenshot", "")
                log("after ordering: " + str(seen.get("state")) + ", estimate '" + str(seen.get("delivery_estimate")) + "', picture " + ("taken" if seen.get("screenshot") else "missing"))
                if seen.get("state") == "verify" or seen.get("delivery_estimate") or seen.get("screenshot") or seen.get("unseen"):
                    # The same report the regular order check sends: delivery window, proof picture, Verify Payment.
                    try:
                        call("/api/worker/v1/orders/" + str(job.get("id")) + "/check", seen)
                    except Exception as failure:
                        log("could not save the order's first look: " + str(failure)[:200])
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
        elif error and current_job.get("in_use") and not current_job.get("place_clicked"):
            # The account's browser is open on another computer: nothing was touched, so the order goes back in line.
            progress(done=True, release=True, note="waiting · " + label + "'s browser is open on another computer")
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
        current_job["verify_ai_ok"] = False
        current_job["in_use"] = False
        current_job["verify_reason"] = ""
        current_job["ai_read"] = ""
        current_job["verify_shot"] = ""
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
            with state_guard:
                doing = " | ".join(running_text.values())
            state = doing or kameleo_state()
            reply = call("/api/worker/v1/heartbeat", {"version": VERSION, "hostname": socket.gethostname(), "state": state})
            job_lock.resize(reply.get("max_jobs") or 1)
            if reply.get("desired_state") != "pause":
                for account in reply.get("accounts", []):
                    label = account.get("label")
                    if account.get("signin_requested") and label not in busy_accounts and job_lock.acquire(blocking=False):
                        log("sign-in requested for " + label)
                        start_job(sign_in_job, label, label)
                    elif account.get("signin_requested") and time.time() - told_waiting.get(label, 0) > 45:
                        # The sign-in has to wait: say why on the account instead of leaving "waiting for the box".
                        told_waiting[label] = time.time()
                        why = ("this account is busy (" + (" | ".join(running_text.values()) or "another job") + ")") if label in busy_accounts else "the VPS is working at its limit; this is next"
                        try:
                            report(label, note="waiting · " + why[:140])
                        except Exception:
                            pass
                # Who each account's proxy address belongs to: looked up once per address, from the box itself.
                for check in reply.get("ip_checks", [])[:6]:
                    label, ip = check.get("account_label") or "", check.get("ip") or ""
                    if not label or not ip or time.time() - checked_addresses.get(ip, 0) < 600:
                        continue
                    checked_addresses[ip] = time.time()
                    try:
                        info = address_owner(ip)
                        call("/api/worker/v1/accounts/address", {"account": label, "ip": ip, "info": info})
                        log("address " + ip + " (" + label + "): " + info)
                    except Exception as failure:
                        log("could not look up address " + ip + ": " + str(failure)[:120])
                # An account's browser opened by hand from DiceDrop.
                for job in reply.get("browser_jobs", []):
                    label = job.get("account_label") or ""
                    if label and label not in busy_accounts and job_lock.acquire(blocking=False):
                        log("live browser requested for " + label)
                        start_job(live_browser_job, label, label)
                for job in reply.get("order_jobs", []):
                    label = job.get("account_label") or ""
                    if job.get("run_kind") not in ("cart_only", "place_order") or not label:
                        continue
                    token = job.get("run_token") or job.get("id")
                    if token in started_orders or label in busy_accounts:
                        continue
                    if job_lock.acquire(blocking=False):
                        log(str(job.get("run_kind")) + " run requested for " + str(job.get("order_number")) + " on " + label)
                        start_job(cart_only_job, job, label, token)
                for job in reply.get("tracking_jobs", []):
                    label = job.get("account_label") or ""
                    if not job.get("orders") or not label or label in busy_accounts:
                        continue
                    if job_lock.acquire(blocking=False):
                        log("order check due for " + label + " (" + str(len(job["orders"])) + " open)")
                        start_job(tracking_job, job, label)
                # Warm-up browsing comes last: orders and order checks always go first.
                for job in reply.get("warmup_jobs", []):
                    label = job.get("account_label") or ""
                    if not label or label in busy_accounts:
                        continue
                    if job_lock.acquire(blocking=False):
                        log("warm-up session due for " + label)
                        start_job(warm_up_job, label, label)
        except urllib.error.HTTPError as error:
            log("DiceDrop answered " + str(error.code) + ". " + error.read().decode()[:200])
        except Exception as error:
            log("could not reach DiceDrop: " + str(error))
        if time.time() - last_update_check > UPDATE_CHECK_SECONDS and not job_lock.locked():
            last_update_check = time.time()
            if newer_version_available():
                log("a newer worker is available. restarting to pick it up.")
                return 0
        time.sleep(HEARTBEAT_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
