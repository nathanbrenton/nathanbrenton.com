# nathanbrenton.com: quote form service and nginx update

The quote form on `/contact/` posts to `/api/quote-request`. nginx passes that one address to a
small Python program (`deploy/form/nb_form.py`, standard library only) that emails the request
through Postmark. It runs as its own systemd unit with a throwaway user, listens only on
`127.0.0.1:18770`, and writes no files. Visitors' details never reach the log.
Adapted from the ASAP Plumbing form service on dacqua-prod; nothing is shared with it.

| | |
|---|---|
| Program | `/opt/nathanbrenton-form/nb_form.py` |
| Unit | `/etc/systemd/system/nathanbrenton-form.service` |
| Postmark token | `/etc/nathanbrenton-form/postmark-token` (root only) |
| Sends from / to | `website@nathanbrenton.com` → `info@nathanbrenton.com` (forwarded by this host's Postfix to the private business inbox). Reply-To is the visitor. |
| Spam checks | hidden trap field, sends under 4 seconds, links in short fields, more than 3 links in the message, nginx limit of 6 posts a minute per address |
| nginx | `deploy/nginx/nathanbrenton.com.conf` → `/etc/nginx/sites-available/nathanbrenton.com`; `deploy/nginx/nathanbrenton-com-http.conf` → `/etc/nginx/conf.d/` |

Local test (nothing is sent; Postmark's test token only checks the message):

```bash
POSTMARK_SERVER_TOKEN=POSTMARK_API_TEST python3 deploy/form/nb_form.py --dev
```

then open http://127.0.0.1:18770/contact/.

## What the nginx update changes (checked live 2026-11-22)

| Before | After |
|---|---|
| No security headers at all | HSTS, CSP (`'self'` only), nosniff, frame-deny, referrer and permissions policies |
| `www.` serves a second copy of the site | `www.` and `http://` redirect to `https://nathanbrenton.com/` |
| Missing pages return 200 with the home page | Missing pages return 404 with `/404.html` |
| No caching rules | Pages always rechecked; CSS/JS 1 day; images 30 days |
| No form endpoint | `POST /api/quote-request` → `127.0.0.1:18770`, rate-limited |

## Install, in order

Each step is done once. Steps marked **(Nathan)** are run by Nathan; the rest are read-only or rsync.

### 1. Postmark (Nathan, in the browser)
Done 2026-11-22: server `nathanbrenton.com` created in Nathan's own Postmark account; the domain
was already verified there (DKIM + Return-Path `pm-bounces` → `pm.mtasv.net`).

Create a Server for nathanbrenton.com, add the Sender Signature domain `nathanbrenton.com`, and
note the DKIM and Return-Path DNS records Postmark shows. Never paste the API token into chat.

### 2. DNS (Nathan, Google Cloud DNS)
Already in place as of 2026-11-22 (nothing to add). For a fresh domain: add the two records from step 1 (a DKIM `TXT` at `<selector>._domainkey` and a `CNAME`
`pm-bounces` → `pm.mtasv.net`), then press Verify in Postmark for both.

### 3. Stage the files on the host (from this Mac)
Staged through the deploy account into `/tmp` (the `n8` login needs Nathan's key unlocked).
The files hold no secrets; compare the checksums before installing.

```bash
cd ~/Desktop/websites/nathanbrenton.com && TS=$(date -u +%Y%m%dT%H%M%SZ) && D=/tmp/nathanbrenton-staging/$TS && ssh nathan-prod "umask 022; mkdir -p $D/form $D/nginx" && rsync -a deploy/form/nb_form.py deploy/form/nathanbrenton-form.service nathan-prod:$D/form/ && rsync -a deploy/nginx/nathanbrenton.com.conf deploy/nginx/nathanbrenton-com-http.conf nathan-prod:$D/nginx/ && echo $TS && shasum -a 256 deploy/form/nb_form.py deploy/form/nathanbrenton-form.service deploy/nginx/nathanbrenton*.conf
```

### 4. Form service (Nathan, on web-prod-01)
The `read -rsp` line asks for the token without showing it: copy it from Postmark → the
nathanbrenton.com server → API Tokens.

```bash
TS=<the timestamp printed in step 3>
sudo install -d -m 755 -o root -g root /opt/nathanbrenton-form
sudo install -m 644 -o root -g root /tmp/nathanbrenton-staging/$TS/form/nb_form.py /opt/nathanbrenton-form/nb_form.py
sudo install -d -m 700 -o root -g root /etc/nathanbrenton-form
sudo bash -c 'umask 077; read -rsp "Postmark server token: " t; echo; printf %s "$t" > /etc/nathanbrenton-form/postmark-token'
sudo install -m 644 -o root -g root /tmp/nathanbrenton-staging/$TS/form/nathanbrenton-form.service /etc/systemd/system/nathanbrenton-form.service
sudo systemctl daemon-reload && sudo systemctl enable --now nathanbrenton-form
curl -s http://127.0.0.1:18770/api/health
```

The last line prints `ok`.

### 5. nginx (Nathan, on web-prod-01)
Back up the live file outside nginx's include paths, install, test, reload:

```bash
sudo install -d -m 700 /root/nginx-backups && sudo cp -a /etc/nginx/sites-available/nathanbrenton.com /root/nginx-backups/nathanbrenton.com.$TS
sudo install -m 644 -o root -g root /tmp/nathanbrenton-staging/$TS/nginx/nathanbrenton-com-http.conf /etc/nginx/conf.d/nathanbrenton-com-http.conf
sudo install -m 644 -o root -g root /tmp/nathanbrenton-staging/$TS/nginx/nathanbrenton.com.conf /etc/nginx/sites-available/nathanbrenton.com
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run --cert-name nathanbrenton.com
```

Undo: copy the backup back, remove the `conf.d` file, `sudo nginx -t && sudo systemctl reload nginx`.

### 6. Site release (from this Mac, after approval)

```bash
~/Desktop/websites/nathanbrenton.com/scripts/deploy.sh
```

### 7. Checks
- `curl -sI https://nathanbrenton.com/` shows the security headers; `https://www.nathanbrenton.com/`
  answers 301; `https://nathanbrenton.com/no-such-page` answers 404.
- One real request from `/contact/` arrives in the business inbox, and shows in Postmark → Activity.
- Better Stack: add a keyword monitor for `/contact/` (text "Get a quote").

## Day to day
- Log: `journalctl -u nathanbrenton-form` has one line per request: an id and whether it was sent,
  returned for fixes, or dropped as spam. Failed sends are logged as `ERROR`.
- If sending fails, the visitor is told to try again or email info@, and what they typed stays on screen.
- New token: run the `read -rsp` line again, then `sudo systemctl restart nathanbrenton-form`.
- Update the program: install the new `nb_form.py` as in step 4, then `sudo systemctl restart nathanbrenton-form`.
- Turn the form off: `sudo systemctl disable --now nathanbrenton-form`.
