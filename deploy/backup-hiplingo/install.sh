#!/bin/bash
# Run with sudo from the staging folder: sudo bash install.sh
# Installs the Hiplingo backup script, timer and lists; creates its own restic password; asks for the AWS key once;
# initialises the repository if needed. Never prints secrets. Separate from /etc/restic (the whole-server backup).
set -euo pipefail
umask 077
cd "$(dirname "$0")"
CONF=/etc/restic-hiplingo
REPO="s3:s3.us-east-2.amazonaws.com/hiplingo-record-label-backup/restic"

command -v restic >/dev/null || { echo "restic not installed"; exit 1; }
install -d -o root -g root -m 700 "$CONF"
install -o root -g root -m 600 include.txt exclude.txt "$CONF/"
install -o root -g root -m 700 hiplingo-backup /usr/local/sbin/hiplingo-backup
install -o root -g root -m 644 hiplingo-backup.service hiplingo-backup.timer /etc/systemd/system/

if [[ ! -s "$CONF/password" ]]; then
  openssl rand -base64 32 > "$CONF/password"
  echo "created new restic password"
fi
chmod 600 "$CONF/password"

if ! grep -q '^AWS_SECRET_ACCESS_KEY=.\+' "$CONF/env" 2>/dev/null; then
  read -rp  "AWS access key ID for hiplingo-web-prod-01-restic: " KEY_ID
  read -rsp "AWS secret access key (hidden): " SECRET; echo
  [[ -n "$KEY_ID" && -n "$SECRET" ]] || { echo "empty key, nothing written"; exit 1; }
  printf 'RESTIC_REPOSITORY=%s\nRESTIC_PASSWORD_FILE=%s/password\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_DEFAULT_REGION=us-east-2\n' \
    "$REPO" "$CONF" "$KEY_ID" "$SECRET" > "$CONF/env"
  unset SECRET
  echo "saved AWS key to $CONF/env"
fi
chmod 600 "$CONF/env"

set -a; . "$CONF/env"; set +a
if restic cat config >/dev/null 2>&1; then
  echo "repository: already initialised"
else
  restic init >/dev/null && echo "repository: initialised at $REPO"
fi

systemctl daemon-reload
systemctl enable hiplingo-backup.timer >/dev/null
echo "timer: enabled (not started yet)"
echo "INSTALL OK"
