# nathanbrenton.com / web-prod-01 documentation

This directory owns the shared production-server runbook and the
nathanbrenton.com website deployment workflow.

## Authoritative documents

### `web-prod-01-production-rebuild-runbook-20260825-weekly-digest.txt`

Authoritative machine rebuild / operations runbook for `web-prod-01`.

Covers:

- Debian 13 foundation;
- SSH/users/deployment identities;
- nftables and Fail2ban;
- nginx and TLS;
- Postfix/OpenDKIM/PostSRSd;
- operational/business mail boundaries;
- Monit;
- node_exporter;
- Prometheus;
- Grafana;
- Blackbox Exporter;
- Alertmanager;
- Daily Server Health Report v2;
- Weekly Operations Digest;
- 18 production Prometheus alert rules;
- node_exporter systemd collector integration;
- independent Monit observability watchdog;
- final operational audits.

Completed observability/reporting milestones:

- Observability v1;
- Alerting v1;
- Daily Server Health Report v2;
- Weekly Operations Digest.

Next recommended observability milestone:

- Grafana Alloy + Loki.

### `nathanbrenton.com-production-deployment-workflow.txt`

Website-specific immutable-release deployment / rollback workflow.

## Ownership rule

Shared host infrastructure belongs here even though the same server also
serves Hiplingo.

Hiplingo frontend deployment belongs in:

`~/Desktop/record-label/hiplingo.com/docs/`

Hiplingo publication/media deployment belongs in:

`~/Desktop/record-label/metadata-editor/docs/`

## Superseded historical docs

The previous authoritative runbook:

`web-prod-01-production-rebuild-runbook-20260825-daily-report-v2.txt`

is superseded by the Weekly Operations Digest revision.

Older server/mail/rebuild documentation should remain archived rather than
maintained as competing active sources of truth.

## Publication boundary

`docs/` is operational/source documentation and must not be included in the
public nathanbrenton.com release payload.
