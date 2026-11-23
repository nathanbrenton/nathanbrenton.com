# Watch: monitoring and backups for nathanbrenton.com (web-prod-01)

This is the first install of the **Watch** service ("Monitoring and Backups"), and the template for client installs.
Set up and tested 2026-11-23. Everything except S3 is free; S3 costs cents a month.

## What is watched

| Layer | Tool | Checks | Alerts to |
|---|---|---|---|
| Outside, every 3 min | Better Stack monitor `nathanbrenton.com` | home page loads over HTTPS and contains "Nathan Brenton" | email |
| Outside, every 3 min | Better Stack monitor `nathanbrenton.com - contact form page` | `/contact/` loads and contains "Send request" | email |
| On the server | Monit `nathanbrenton-form` (`deploy/monit/nathanbrenton-form`) | form service answers `/api/health` with `ok` (2 failed cycles = alert) | Monit mail alerts |
| On the server | Prometheus rule in `/etc/prometheus/rules/production-health.yml` | TLS certificate expiry | Alertmanager |
| On the server | certbot.timer | renews certificates twice a day | — |
| Mail | DMARC aggregate reports | who sends as nathanbrenton.com | admin@nathanbrenton.com ([email DNS](nathanbrenton.com-email-dns.md)) |
| Backups | Better Stack heartbeat `web-prod-01 nightly backup` | a successful backup pinged in the last day (+6 h grace) | email |

Better Stack account: the one signed in with nathanbrenton@proton.me (the D'Acqua Dolce team is a different login; don't mix them).
Free-plan limits: SSL-expiry and domain-expiry checks in Better Stack need a paid plan, so certificate expiry is covered by
Prometheus and domain renewal by Squarespace auto-renew.

## Backups

**What:** nightly restic snapshot of web-prod-01 (both sites, all server settings) to S3.

| Item | Value |
|---|---|
| Bucket | `nathanbrenton-web-prod-01-backup`, region **us-east-2 (Ohio)**, private, versioning on |
| Lifecycle rule | `expire-old-versions`: delete noncurrent versions after 30 days, expired delete markers, incomplete uploads after 7 days |
| Repository | `s3:s3.us-east-2.amazonaws.com/nathanbrenton-web-prod-01-backup/restic` |
| IAM user | `web-prod-01-restic`, no console access, inline policy `restic-web-prod-01-backup` ([deploy/backup/iam-policy-restic.json](../deploy/backup/iam-policy-restic.json)): list/get/put/delete objects in this bucket only. It can't delete old versions or change the bucket, so a compromised server can't destroy the 30-day history |
| Schedule | `web-prod-01-backup.timer`, 10:30 UTC (about 02:30 Pacific) ± 15 min, catches up after downtime |
| Retention | 7 daily, 4 weekly, 6 monthly; prune + `check --read-data-subset=5%` on Sundays |
| Size | about 1 GB (Hiplingo media and releases are most of it) |
| Memory | `GOGC=20`, `MemoryMax=300M`; nightly peak about 46 MB |

**Backed up:** `/etc /opt /root /home /srv /usr/local /var/www /var/spool/cron /var/lib/grafana` plus
`/var/backups/web-prod-01-meta` (package list, enabled services, timers), per [include.txt](../deploy/backup/include.txt).
**Skipped:** caches, Prometheus/node_exporter binaries (reinstall from checksummed downloads), Grafana's bundled plugins and
generated files, per [exclude.txt](../deploy/backup/exclude.txt). Prometheus and Loki data are not backed up (short-lived metrics and logs).

### Secrets and where they live

| Secret | Location | Copy |
|---|---|---|
| restic password | `/etc/restic/password` (root 600) | **Proton Pass: "web-prod-01 restic backup"**. Without it the backups can't be opened |
| AWS access key for `web-prod-01-restic` | `/etc/restic/env` (root 600) | none needed: make a new key in IAM if lost |
| Backup heartbeat URL | `/etc/restic/heartbeat-url` (root 600) | Better Stack shows it |

Never paste these into chat, git, tickets or email.

### Cost guardrails (AWS account on nathanbrenton@proton.me)

- Paid plan (upgraded 2026-11-23 so the account doesn't close when the free period ends; remaining credits apply first).
- Hard monthly spend limit **$20** (project pauses at the limit); cost control "stop new resource launches" on.
- Budgets: `monthly-2-usd` (email at $2) and `My Zero-Spend Budget`.
- Expected S3 cost: a few cents a month.

## Fresh install (the Watch template)

Files: `deploy/backup/` and `deploy/monit/` in this repo. Stage them to the server (as for the form service), then:

1. **AWS** (account owner's browser): budget alert → bucket (private, versioning on) → lifecycle rule → IAM user with the
   inline policy (edit the bucket name in the JSON) → *don't* make the access key yet.
2. **Server:** `sudo apt-get install -y restic`.
3. **Access key + installer:** create the key (CLI), then `sudo bash <staging>/backup/install.sh` and type the key ID and
   secret at the prompts. It installs everything, creates the password, initialises the repository and enables the timer.
   For another server or client, edit `REPO` in `install.sh` and the host name in `web-prod-01-backup` first.
4. **Save the password** (`sudo cat /etc/restic/password`) in the owner's password manager, then clear the terminal.
5. **First backup by hand:** `sudo systemctl start web-prod-01-backup.service`, check `journalctl -u web-prod-01-backup`.
6. **Heartbeat:** create it in Better Stack (1 day + 6 h grace), store the URL in `/etc/restic/heartbeat-url`
   with `read -rsp` (root 600), run the backup again, confirm the ping arrived.
7. **Restore test** (below), then the Monit form check and the Better Stack page monitors.

For a client, the bucket and AWS account are in the **client's** name and the client pays the storage.

## Restore

All commands: **Run on: web-prod-01**, inside a root shell that has loaded the settings:

```bash
sudo -i
set -a; . /etc/restic/env; set +a; export GOGC=20
restic snapshots                                   # list snapshots
restic restore latest --target /root/restore --include /etc/nginx   # get files back into a side folder
```

Copy what you need from `/root/restore` into place, then `rm -rf /root/restore`. Never restore straight over `/`.

**Server lost:** on any machine with restic, set `RESTIC_REPOSITORY` to the repository above, `RESTIC_PASSWORD` from
Proton Pass, and a fresh AWS key for `web-prod-01-restic` (IAM → Security credentials). Then `restic restore latest
--target ./web-prod-01-restore`, and rebuild following the web-prod-01 runbook using the restored `/etc` and
`/var/backups/web-prod-01-meta`.

**Tested 2026-11-23:** `/etc/nginx`, `/etc/postfix` and `/opt/nathanbrenton-form` restored from S3 and matched live byte for byte.

## Monthly check (10 minutes)

1. Better Stack: all monitors Up, backup heartbeat green for the month.
2. `restic snapshots` shows recent daily snapshots; repeat the restore test above.
3. AWS billing: month's cost as expected (cents).
4. Skim DMARC reports at admin@ (until DMARC reaches `p=reject`).

Not yet done: a full "server lost" drill from a second machine (needs restic on the Mac).
