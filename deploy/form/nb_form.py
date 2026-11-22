#!/usr/bin/env python3
"""nathanbrenton.com: the quote request form.

Receives the form from https://nathanbrenton.com/contact/ and emails it through Postmark.
Python standard library only; nothing to install. Adapted from the ASAP Plumbing form service.

Production: runs as the systemd unit nathanbrenton-form on 127.0.0.1:18770 on web-prod-01.
nginx forwards POST /api/quote-request to it and serves everything else itself.

Local preview (serves the site too, so the form can be tried end to end):
    POSTMARK_SERVER_TOKEN=POSTMARK_API_TEST python3 deploy/form/nb_form.py --dev
then open http://127.0.0.1:18770/contact/. Postmark's test token checks each message without
delivering it.

Settings (environment):
    POSTMARK_SERVER_TOKEN   or the systemd credential "postmark-token" (production)
    NB_FORM_TO              where requests go (default info@nathanbrenton.com); commas for several
    NB_FORM_FROM            sender; must be on the Postmark-verified domain
    NB_FORM_PORT            default 18770

Visitors' details are never written to disk or to the log; the log shows only an id and the outcome.
"""
import argparse
import html
import json
import logging
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # no tz database: fall back to UTC
    PACIFIC = timezone.utc

ENDPOINT = "/api/quote-request"
POSTMARK_URL = "https://api.postmarkapp.com/email"
MAX_BODY = 24 * 1024
MIN_SECONDS = 4          # people take longer than this to fill in the form
CONTACT_EMAIL = "info@nathanbrenton.com"

CONTACT_BY = {"email": "Email", "call": "Call", "text": "Text"}
SERVICES = {
    "it-support": "Computers, Wi-Fi or IT support",
    "migration": "Moving email, files or accounts",
    "website-new": "A new website",
    "website-existing": "Changes or a move for an existing website",
    "domain-email": "Domain, DNS or email set-up",
    "photo": "Photography",
    "video": "Video",
    "social-listings": "Social media, Google or Yelp listings",
    "other": "Something else",
}
LOCATION = {"onsite": "On-site", "remote": "Remote is fine", "unsure": "Not sure"}
TIMELINE = {"unsure": "Not sure yet", "asap": "As soon as possible", "month": "Within a month",
            "quarter": "In 1 to 3 months", "planning": "Just planning"}
BUDGET = {"unsure": "Not sure yet", "under-500": "Under $500", "500-1500": "$500 to $1,500",
          "1500-5000": "$1,500 to $5,000", "over-5000": "Over $5,000"}
LINK = re.compile(r"https?://|www\.|\[url", re.I)
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

log = logging.getLogger("nb-form")


class Spam(Exception):
    """A request we drop quietly; the sender is still told it worked."""


def clean(value, limit, multiline=False):
    """Trim, cap the length and strip control characters (keeps newlines in the message)."""
    value = unicodedata.normalize("NFC", value or "")
    keep = "\n" if multiline else ""
    value = "".join(c for c in value if c in keep or unicodedata.category(c)[0] != "C")
    if multiline:
        value = re.sub(r"\n{3,}", "\n\n", value.replace("\r", ""))
    else:
        value = " ".join(value.split())
    return value.strip()[:limit]


def phone_digits(value):
    d = re.sub(r"\D", "", value)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d


def pick(value, choices, default):
    return value if value in choices else default


def validate(form):
    """Return (cleaned fields, {field: message}). Raises Spam for obvious bots."""
    get = lambda k: form.get(k, [""])[0]
    if get("website").strip():
        raise Spam("trap field filled")
    seconds = get("t").strip()
    no_js = not seconds.isdigit()
    if not no_js and int(seconds) < MIN_SECONDS:
        raise Spam(f"sent after {seconds}s")

    f = {
        "name": clean(get("name"), 100),
        "email": clean(get("email"), 254),
        "phone": clean(get("phone"), 30),
        "organization": clean(get("organization"), 120),
        "contact_by": pick(get("contact_by"), CONTACT_BY, "email"),
        "services": [s for s in dict.fromkeys(form.get("services", [])) if s in SERVICES],
        "details": clean(get("details"), 4000, multiline=True),
        "location_type": pick(get("location_type"), LOCATION, "unsure"),
        "city": clean(get("city"), 80),
        "timeline": pick(get("timeline"), TIMELINE, "unsure"),
        "budget": pick(get("budget"), BUDGET, "unsure"),
    }
    errors = {}
    if not f["name"]:
        errors["name"] = "Please enter your name."
    if not f["email"]:
        errors["email"] = "Please enter your email address."
    elif not EMAIL.match(f["email"]):
        errors["email"] = "Please check your email address."
    digits = phone_digits(f["phone"])
    if f["phone"]:
        if len(digits) == 10:
            f["phone"] = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) < 7:
            errors["phone"] = "Please check your phone number."
    if not f["phone"] and f["contact_by"] in ("call", "text"):
        errors["phone"] = "Please enter a phone number, or choose Email."
    if len(f["details"]) < 10:
        errors["details"] = "Please tell me a little about the job."

    # Links: real requests rarely have more than a couple; spam nearly always does.
    if any(LINK.search(f[k]) for k in ("name", "organization", "city")):
        raise Spam("link in a short field")
    if len(LINK.findall(f["details"])) > (1 if no_js else 3):
        errors["details"] = "Please keep to one or two web links and describe the job in words."
    return f, errors


def compose(f):
    """Build the Postmark message for a validated request."""
    when = datetime.now(PACIFIC).strftime("%a %b %-d, %Y, %-I:%M %p %Z")
    who = f["name"] + (f" ({f['organization']})" if f["organization"] else "")
    subject = "Quote request: " + who
    services = ", ".join(SERVICES[s] for s in f["services"]) or "not chosen"
    where = LOCATION[f["location_type"]] + (f", {f['city']}" if f["city"] else "")
    digits = phone_digits(f["phone"])

    rows = [
        ("Name", f["name"]),
        ("Organization", f["organization"] or "not given"),
        ("Email", f["email"]),
        ("Phone", f["phone"] or "not given"),
        ("Best way to reach", CONTACT_BY[f["contact_by"]]),
        ("Services", services),
        ("Where", where),
        ("Timeline", TIMELINE[f["timeline"]]),
        ("Budget", BUDGET[f["budget"]]),
    ]
    text = "New quote request from nathanbrenton.com\n\n"
    text += "\n".join(f"{k}: {v}" for k, v in rows)
    text += "\n\nAbout the job:\n" + f["details"] + "\n\n"
    text += f"Sent {when} from nathanbrenton.com/contact/\nReply to this email to answer them.\n"

    e = html.escape
    cell = 'style="padding:6px 14px 6px 0;vertical-align:top;color:#555;white-space:nowrap"'
    links = {"Email": f'<a href="mailto:{e(f["email"])}">{e(f["email"])}</a>'}
    if len(digits) == 10:
        links["Phone"] = (f'<a href="tel:+1{digits}">{e(f["phone"])}</a> &nbsp;·&nbsp; '
                          f'<a href="sms:+1{digits}">text</a>')
    body_rows = "".join(
        f"<tr><td {cell}><strong>{e(k)}</strong></td><td style=\"padding:6px 0\">{links.get(k, e(v))}</td></tr>"
        for k, v in rows)
    html_body = (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222">'
        '<h2 style="margin:0 0 12px;font-size:20px">New quote request from nathanbrenton.com</h2>'
        f'<table cellpadding="0" cellspacing="0">{body_rows}</table>'
        '<h3 style="margin:18px 0 6px;font-size:16px">About the job</h3>'
        f'<p style="margin:0;white-space:pre-wrap">{e(f["details"])}</p>'
        f'<p style="margin:22px 0 0;font-size:12px;color:#777">Sent {e(when)} from nathanbrenton.com/contact/'
        '<br>Reply to this email to answer them.</p></div>')

    return {
        "From": os.environ.get("NB_FORM_FROM", "Nathan Brenton website <website@nathanbrenton.com>"),
        "To": os.environ.get("NB_FORM_TO", CONTACT_EMAIL),
        "ReplyTo": f'"{f["name"].replace(chr(34), "")}" <{f["email"]}>',
        "Subject": subject,
        "TextBody": text,
        "HtmlBody": html_body,
        "Tag": "quote-request",
        "MessageStream": "outbound",
        "TrackOpens": False,
        "TrackLinks": "None",
    }


def postmark_token():
    creds = os.environ.get("CREDENTIALS_DIRECTORY")
    if creds and (Path(creds) / "postmark-token").exists():
        return (Path(creds) / "postmark-token").read_text().strip()
    return os.environ.get("POSTMARK_SERVER_TOKEN", "").strip()


def send(message, request_id):
    """Send through Postmark; one retry on a network or server error. Returns True if accepted."""
    token = postmark_token()
    if not token:
        log.error("%s not sent: no Postmark token configured", request_id)
        return False
    data = json.dumps(message).encode()
    for attempt in (1, 2):
        req = urllib.request.Request(POSTMARK_URL, data=data, method="POST", headers={
            "Accept": "application/json", "Content-Type": "application/json",
            "X-Postmark-Server-Token": token})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                reply = json.load(r)
            if reply.get("ErrorCode") == 0:
                log.info("%s sent, Postmark id %s", request_id, reply.get("MessageID"))
                return True
            log.error("%s not sent: Postmark error %s: %s", request_id, reply.get("ErrorCode"), reply.get("Message"))
            return False
        except urllib.error.HTTPError as err:
            try:
                reply = json.load(err)
            except Exception:
                reply = {}
            log.error("%s not sent (attempt %d): HTTP %s, Postmark error %s: %s", request_id, attempt,
                      err.code, reply.get("ErrorCode"), reply.get("Message"))
            if err.code < 500:
                return False
        except Exception as err:  # network trouble
            log.error("%s not sent (attempt %d): %s", request_id, attempt, err)
        time.sleep(2)
    return False


class Handler(SimpleHTTPRequestHandler):
    server_version = "nb-form"
    sys_version = ""
    dev = False

    def log_message(self, fmt, *args):  # no access log: nginx keeps one
        if self.dev:
            sys.stderr.write("  " + fmt % args + "\n")

    def reply(self, status, payload, wants_json):
        if wants_json:
            body = json.dumps(payload).encode()
            ctype = "application/json"
        else:  # browsers without JavaScript post the form normally: answer with a small page
            if payload.get("ok"):
                title, text = "Thank you!", "Your request has been sent. I'll reply soon, usually within one business day."
            elif payload.get("fields"):
                title = "Please check your request"
                text = " ".join(payload["fields"].values()) + " Use your browser's Back button to fix it."
            else:
                title, text = "Sorry, your request didn't go through", ""
            body = (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
                    f'<meta name="viewport" content="width=device-width, initial-scale=1">'
                    f'<meta name="robots" content="noindex"><title>{html.escape(title)}</title>'
                    f'<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/pages.css"></head>'
                    f'<body><main class="page"><header class="page-header"><h1>{html.escape(title)}</h1>'
                    f'<p class="lede">{html.escape(text)}</p>'
                    f'<p>You can also email <a class="text-link" href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>.</p>'
                    f'<p><a class="text-link" href="/">Back to the home page</a></p></header></main></body></html>').encode()
            ctype = "text/html; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        wants_json = "application/json" in self.headers.get("Accept", "")
        if self.path.split("?")[0] != ENDPOINT:
            return self.reply(404, {"ok": False}, wants_json)
        request_id = uuid.uuid4().hex[:8]
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self.reply(413, {"ok": False}, wants_json)
        raw = self.rfile.read(length).decode("utf-8", "replace")
        form = urllib.parse.parse_qs(raw, keep_blank_values=True, max_num_fields=60)
        try:
            fields, errors = validate(form)
        except Spam as why:
            log.info("%s dropped as spam: %s", request_id, why)
            return self.reply(200, {"ok": True}, wants_json)
        if errors:
            log.info("%s returned for fixes: %s", request_id, ", ".join(sorted(errors)))
            return self.reply(422, {"ok": False, "fields": errors}, wants_json)
        if send(compose(fields), request_id):
            return self.reply(200, {"ok": True}, wants_json)
        return self.reply(502, {"ok": False, "error": "send_failed"}, wants_json)

    def do_GET(self):
        if self.path == "/api/health":
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.dev:
            return super().do_GET()
        self.send_error(404)

    def do_HEAD(self):
        if self.dev:
            return super().do_HEAD()
        self.send_error(404)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("NB_FORM_PORT", "18770")))
    ap.add_argument("--dev", action="store_true", help="also serve the site for a local preview")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stdout)

    if args.dev:
        Handler.dev = True
        site = Path(__file__).resolve().parents[2]
        handler = lambda *a, **kw: Handler(*a, directory=str(site), **kw)
    else:
        handler = Handler
    if not postmark_token():
        log.warning("no Postmark token configured: requests will fail until one is set")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    log.info("listening on http://127.0.0.1:%d%s", args.port, " (dev: serving the site too)" if args.dev else "")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
