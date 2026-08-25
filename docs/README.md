# nathanbrenton.com / web-prod-01 documentation

This directory owns the shared production-server runbook and the
nathanbrenton.com website deployment workflow.

## Authoritative documents

### `web-prod-01-production-rebuild-runbook-20260824-alerting-v1.txt`

Authoritative machine rebuild / operations runbook for `web-prod-01`.

Covers:

- Debian 13 foundation;
- SSH/users/deployment identities;
- nftables and Fail2ban;
- nginx and TLS;
- Postfix/OpenDKIM/PostSRSd;
- operational/business mail boundaries;
- daily health report;
- Monit;
- node_exporter;
- Prometheus;
- Grafana;
- Blackbox Exporter;
- Alertmanager;
- 16 production Prometheus alert rules;
- independent Monit observability watchdog;
- final audits.

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

Once their unique content has been confirmed merged into the authoritative
rebuild runbook, older server/mail/rebuild documents should be archived or
removed from the active documentation set rather than maintained as competing
sources of truth.

## Publication boundary

`docs/` is operational/source documentation and must not be included in the
public nathanbrenton.com release payload.
