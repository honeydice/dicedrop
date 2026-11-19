"""DiceDrop worker. Runs on each VPS box next to Kameleo.

What it does:
  * checks in with DiceDrop every 15 seconds and reports whether Kameleo is up
  * when the operator asks, signs one of this box's accounts in to Amazon through that account's own
    Kameleo profile and dedicated proxy, then reports the result and a screenshot
  * when the operator clicks "Order now", does a cart-only run: item in cart, buyer address added, checkout opened,
    totals read, screenshot taken. It never places an order.
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

VERSION = "0.9.5"
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


def submit(page, field, buttons):
    """Submit the way a person does: press Enter in the field. If the page has not moved on, click the button too."""
    before = page.url
    try:
        field.press("Enter")
    except Exception:
        pass
    pause(1.5, 2.5)
    try:
        still_here = page.url == before and field.is_visible()
    except Exception:
        still_here = False
    if still_here and click_first(page, buttons):
        return "enter+button"
    return "enter"


def click_first(page, selectors):
    for selector in selectors:
        target = first_visible(page, selector)
        if target is not None:
            target.click()
            return True
    return False


def snap(page):
    try:
        return base64.b64encode(page.screenshot(type="jpeg", quality=45, full_page=False)).decode()
    except Exception:
        return ""


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
            field = human_type(page, OTP, code["code"])
            steps.append("code:" + submit(page, field, ["#auth-signin-button", "input[type='submit']", "button[type='submit']"]))
            entered_code = True
        elif visible(page, PASSWORD):
            report(label, note="entering the password")
            if len([step for step in steps if step.startswith("password")]) >= 2:
                return "needs_sign_in", "Amazon stayed on the password page (" + ", ".join(steps) + "). The page says: " + page_words(page)
            if visible(page, "input[name='rememberMe']"):
                try:
                    page.locator("input[name='rememberMe']").first.check()
                except Exception:
                    pass
            field = human_type(page, PASSWORD, secrets["password"])
            typed = typed_length(field)
            steps.append("password typed " + str(typed) + " of " + str(len(secrets["password"])) + " characters, sent by " + submit(page, field, ["#signInSubmit", "input[type='submit']", "button[type='submit']"]))
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


def run_in_account_browser(label, note, work):
    """Opens the account's own Kameleo browser on its dedicated proxy, runs `work(page, secrets)`, and always
    takes a screenshot and closes the profile afterwards. Returns (result, error text, screenshot, outgoing ip)."""
    profile_id = ""
    result, error, shot, exit_ip = None, "", "", ""
    stage = ["getting ready"]
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
        error = str(stop)[:600]
    except Exception as failure:
        error = "While " + stage[0] + ": " + str(failure)[:300]
    finally:
        low_level = restore_stderr(saved_stderr)
        if error and low_level and not error.startswith(("Amazon", "No ", "The proxy", "This item", "Out of stock")):
            error = error + " | details: " + low_level
        if profile_id:
            try:
                kameleo("POST", "/profiles/" + profile_id + "/stop", {})
            except Exception as failure:
                log("could not stop the profile cleanly: " + str(failure)[:200])
    return result, error, shot, exit_ip


def sign_in_job(label):
    try:
        current_job["text"] = "signing in " + label
        report(label, note="getting ready", error="")

        def work(page, secrets, stage):
            stage[0] = "signing in on Amazon"
            return amazon_sign_in(page, label, secrets)

        result, error, shot, _ = run_in_account_browser(label, lambda text: report(label, note=text), work)
        state, reason = result if result else ("needs_sign_in", "")
        error = error or reason
        report(label, session_state=state, error=error, note="signed in" if state == "signed_in" else "sign-in did not finish", screenshot=shot, done=True)
        log("sign-in for " + label + " finished: " + state + (" (" + error + ")" if error else ""))
    finally:
        current_job["text"] = ""
        job_lock.release()


# ---------------------------------------------------------------- cart-only run (never places an order)
#
# This worker has no "place order" step. It clears the cart, adds the item, saves the buyer's address as the
# default delivery address, opens checkout, reads the totals, takes a screenshot, and stops.

CART_PAGE = "https://www.amazon.com/gp/cart/view.html"
ADD_ADDRESS_PAGE = "https://www.amazon.com/a/addresses/add?ref=ya_address_book_add_button"
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


def add_address(page, label, secrets, ship):
    page.goto(ADD_ADDRESS_PAGE, wait_until="domcontentloaded", timeout=90000)
    settle(page)
    pass_sign_in_wall(page, label, secrets)
    if "/a/addresses/add" not in page.url:
        page.goto(ADD_ADDRESS_PAGE, wait_until="domcontentloaded", timeout=90000)
        settle(page)
    prefix = "#address-ui-widgets-enterAddress"
    if not fill_field(page, prefix + "FullName", ship["name"]):
        raise Stop("Amazon's add-address form did not load as expected.")
    fill_field(page, prefix + "PhoneNumber", ship.get("phone") or "5125550100")
    fill_field(page, prefix + "Line1", ship["line1"])
    pause(0.5, 1.0)
    page.keyboard.press("Escape")  # close the address suggestions dropdown
    fill_field(page, prefix + "Line2", ship.get("line2") or "")
    fill_field(page, prefix + "City", ship["city"])
    state = (ship.get("state") or "").upper()
    picked = False
    for selector in ["select#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId", "select[name='address-ui-widgets-enterAddressStateOrRegion']"]:
        try:
            if page.locator(selector).count() > 0:
                page.locator(selector).first.select_option(state, force=True)
                picked = True
                break
        except Exception:
            continue
    if not picked and visible(page, "#address-ui-widgets-enterAddressStateOrRegion"):
        page.locator("#address-ui-widgets-enterAddressStateOrRegion").first.click()
        pause()
        option = page.locator("a.a-dropdown-link", has_text=STATES.get(state, state)).first
        if option.is_visible():
            option.click()
            picked = True
    if not picked:
        raise Stop("Could not choose the state on Amazon's address form.")
    fill_field(page, prefix + "PostalCode", ship["postal_code"])
    # Make it the default so checkout ships to the buyer without another choice.
    for selector in ["#address-ui-widgets-use-as-my-default", "input[name='address-ui-widgets-use-as-my-default']"]:
        try:
            if page.locator(selector).count() > 0:
                page.locator(selector).first.check(force=True)
                break
        except Exception:
            continue
    pause()
    if not safe_click(page, ["#address-ui-widgets-form-submit-button input", "#address-ui-widgets-form-submit-button", "input[aria-labelledby='address-ui-widgets-form-submit-button-announce']"]):
        raise Stop("Could not find the save button on Amazon's address form.")
    settle(page)
    # Amazon may suggest a corrected address. Keep what the buyer gave.
    safe_click(page, ["input[name='address-ui-widgets-saveOriginalOrSuggestedAddress']", "#address-ui-widgets-original-address-block_id-input"])
    settle(page)
    if "/a/addresses/add" in page.url and visible(page, ".a-alert-error, .a-box.a-alert-inline-error, [id*='address-ui-widgets'][id*='error']"):
        message = ""
        try:
            message = " ".join(page.locator(".a-alert-error, .a-box.a-alert-inline-error").first.inner_text(timeout=3000).split())[:200]
        except Exception:
            pass
        raise Stop("Address not found: Amazon did not accept the buyer's address." + (" Amazon says: " + message if message else ""))


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
            stage[0] = "adding the buyer's address"
            progress(note="adding the buyer's address")
            add_address(page, label, secrets, ship)
            stage[0] = "opening checkout"
            progress(note="opening checkout")
            page.goto(CART_PAGE, wait_until="domcontentloaded", timeout=90000)
            settle(page)
            if not safe_click(page, ["input[name='proceedToRetailCheckout']", "#sc-buy-box-ptc-button input"]):
                raise Stop("The cart is empty or the checkout button is missing.")
            settle(page)
            pass_sign_in_wall(page, label, secrets)
            settle(page)
            stage[0] = "reading the totals"
            return read_totals(page)

        totals, error, shot, _ = run_in_account_browser(label, lambda text: progress(note=text), work)
        if error:
            progress(done=True, error=error, note="stopped", screenshot=shot)
        else:
            progress(done=True, note="cart ready · address added · not ordered", screenshot=shot, checkout=totals or {})
        log("cart run " + job.get("order_number", "") + " finished" + (": " + error if error else ""))
    except Exception as failure:
        progress(done=True, error="The cart run could not start: " + str(failure)[:200], note="stopped")
    finally:
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
                started = False
                for account in reply.get("accounts", []):
                    if account.get("signin_requested") and job_lock.acquire(blocking=False):
                        log("sign-in requested for " + account["label"])
                        threading.Thread(target=sign_in_job, args=(account["label"],), daemon=True).start()
                        started = True
                        break
                if not started:
                    for job in reply.get("order_jobs", []):
                        if job.get("run_kind") == "cart_only" and job_lock.acquire(blocking=False):
                            log("cart run requested for " + str(job.get("order_number")))
                            threading.Thread(target=cart_only_job, args=(job,), daemon=True).start()
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
