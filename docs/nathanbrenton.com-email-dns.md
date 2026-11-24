# nathanbrenton.com email DNS (SPF, DKIM, DMARC)

DNS is managed at **Squarespace Domains** (domains.squarespace.com → nathanbrenton.com → DNS → Custom records).
The `ns-cloud-c*.googledomains.com` nameservers are left over from Google Domains; there is no Google Cloud DNS.

## Who sends as nathanbrenton.com

| Sender | Header From | Envelope / SPF domain | DKIM | DMARC result |
|---|---|---|---|---|
| Website quote form (Postmark) | `website@nathanbrenton.com` | `pm-bounces.nathanbrenton.com` (CNAME to Postmark) | `d=nathanbrenton.com` (Postmark, verified) | pass via DKIM and SPF (relaxed) |
| web-prod-01 local mail (cron, root, bounces) | `*@nathanbrenton.com` / `MAILER-DAEMON@web-prod-01.nathanbrenton.com` | apex or `web-prod-01` HELO | none | pass via SPF (relaxed) |
| Monitoring alerts | `alerts@ops.nathanbrenton.com` | `ops.nathanbrenton.com` | OpenDKIM `webprod01-202608` | own `_dmarc.ops` record |
| Forwarded mail (SRS) | original sender | `srs.nathanbrenton.com` | original sender's | judged on the original sender |

Nathan does not send as `@nathanbrenton.com` from Gmail or Proton (confirmed 2026-11-23).
If that changes, add the provider to SPF and DKIM **before** tightening DMARC.

## Records (added 2026-11-23)

| Host | Type | Value |
|---|---|---|
| `@` | TXT | `v=spf1 ip4:45.32.88.137 -all` |
| `web-prod-01` | TXT | `v=spf1 ip4:45.32.88.137 -all` |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:admin@nathanbrenton.com` |

Already present before: Postmark DKIM and `pm-bounces` CNAME, `ops` SPF + DKIM + `_dmarc.ops`, `srs` SPF + MX.

Added 2026-11-24 for hiplingo.com, whose DMARC reports also go to admin@nathanbrenton.com:

| Host | Type | Value |
|---|---|---|
| `hiplingo.com._report._dmarc` | TXT | `v=DMARC1` |

This tells report senders that nathanbrenton.com accepts reports for hiplingo.com; without it some (Google included)
drop them. Remove it if hiplingo.com's `rua` ever stops pointing here. Each new domain reporting to admin@ needs its own
`<domain>._report._dmarc` record.

## Tightening schedule

DMARC aggregate reports arrive at admin@nathanbrenton.com (forwarded by web-prod-01; Postmark is not involved).

1. **From about 2026-12-07:** if the reports show only web-prod-01 (45.32.88.137) and Postmark, and both pass,
   change `_dmarc` to `v=DMARC1; p=quarantine; rua=mailto:admin@nathanbrenton.com`.
2. **Two weeks after that,** with clean reports: `p=reject`.

Any failing source in the reports: identify it first, don't tighten past it.

## Check

```bash
dig +short TXT nathanbrenton.com
dig +short TXT web-prod-01.nathanbrenton.com
dig +short TXT _dmarc.nathanbrenton.com
```
