#!/usr/bin/env bash
set -euo pipefail

REMOTE="nathan-prod"
REMOTE_ROOT="/var/www/nathanbrenton.com"
AUTO_YES=false

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

confirm() {
  local prompt="$1"
  local reply

  if [[ "$AUTO_YES" == true ]]; then
    printf '%s [auto-yes]\n' "$prompt"
    return 0
  fi

  printf '%s [y/N] ' "$prompt"
  read -r reply

  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

usage() {
  cat <<'EOF_USAGE'
Usage: rollback.sh [-y|--yes]

  -y, --yes   Automatically confirm rollback and failed-release cleanup.
  -h, --help  Show this help.
EOF_USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
  shift
done

for cmd in ssh curl; do
  command -v "$cmd" >/dev/null 2>&1 ||
    fail "required command not found: $cmd"
done

if command -v shasum >/dev/null 2>&1; then
  sha256_local() {
    shasum -a 256
  }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256_local() {
    sha256sum
  }
else
  fail "neither shasum nor sha256sum is available"
fi


printf '\n===== 1. VERIFY SSH CONNECTION =====\n'

SSH_HOST="$(ssh "$REMOTE" 'hostname')"
SSH_USER="$(ssh "$REMOTE" 'whoami')"

printf 'ssh_verified=yes\nhost=%s\nuser=%s\n' "$SSH_HOST" "$SSH_USER"

[[ "$SSH_HOST" == "web-prod-01" ]] ||
  fail "unexpected remote host: $SSH_HOST"

[[ "$SSH_USER" == "deploy-nathan" ]] ||
  fail "unexpected remote user: $SSH_USER"


printf '\n===== 2. IDENTIFY CURRENT RELEASE =====\n'

CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

[[ "$CURRENT" == releases/* ]] ||
  fail "unexpected current symlink target: $CURRENT"

CURRENT_NAME="${CURRENT#releases/}"

ssh "$REMOTE" "test -d '$REMOTE_ROOT/releases/$CURRENT_NAME'" ||
  fail "current release directory does not exist"

printf 'current=%s\n' "$CURRENT"


printf '\n===== 3. IDENTIFY PREVIOUS RELEASE =====\n'

PREVIOUS=""

while IFS= read -r release; do
  if [[ "$release" == "$CURRENT_NAME" ]]; then
    break
  fi

  PREVIOUS="$release"
done < <(
  ssh "$REMOTE" \
    "find '$REMOTE_ROOT/releases' -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort"
)

[[ -n "$PREVIOUS" ]] ||
  fail "no earlier release exists before $CURRENT_NAME"

ssh "$REMOTE" "test -d '$REMOTE_ROOT/releases/$PREVIOUS'" ||
  fail "rollback target does not exist"

printf 'current_release=%s\n' "$CURRENT_NAME"
printf 'rollback_target=%s\n' "$PREVIOUS"


printf '\n===== 4. CONFIRM ROLLBACK =====\n'

confirm "Rollback production from $CURRENT_NAME to $PREVIOUS?" || {
  printf 'Rollback cancelled.\n'
  exit 0
}


printf '\n===== 5. ATOMIC ROLLBACK =====\n'

ssh "$REMOTE" "\
  ROOT='$REMOTE_ROOT'; \
  TARGET='$PREVIOUS'; \
  OLD=\$(readlink \"\$ROOT/current\") || exit 1; \
  rm -f \"\$ROOT/.current-rollback\"; \
  ln -s \"releases/\$TARGET\" \"\$ROOT/.current-rollback\" && \
  mv -Tf \"\$ROOT/.current-rollback\" \"\$ROOT/current\" && \
  printf 'previous=%s\ncurrent=%s\n' \
    \"\$OLD\" \
    \"\$(readlink \"\$ROOT/current\")\""

ROLLED_BACK_CURRENT="$(
  ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'"
)"

[[ "$ROLLED_BACK_CURRENT" == "releases/$PREVIOUS" ]] ||
  fail "rollback did not point current at releases/$PREVIOUS"


printf '\n===== 6. VALIDATE ROLLED-BACK RELEASE =====\n'

for file in \
  index.html \
  script.js \
  site-data.js \
  styles.css \
  resume/Nathan-Brenton-Resume.pdf
do
  ssh "$REMOTE" \
    "test -f '$REMOTE_ROOT/releases/$PREVIOUS/$file'" ||
    fail "required file missing after rollback: $file"
done

printf 'required_files=present\n'


printf '\n----- Live endpoint checks -----\n'

for url in \
  https://nathanbrenton.com/ \
  https://www.nathanbrenton.com/ \
  https://nathanbrenton.com/resume/Nathan-Brenton-Resume.pdf \
  https://nathanbrenton.com/assets/banner-desktop.webp
do
  printf '%s -> ' "$url"

  curl -fsS \
    -o /dev/null \
    -w 'http=%{http_code}\n' \
    "$url" ||
    fail "live endpoint failed: $url"
done


printf '\n----- Confirm live index matches rollback release -----\n'

REMOTE_INDEX_HASH="$(
  ssh "$REMOTE" \
    "sha256sum '$REMOTE_ROOT/releases/$PREVIOUS/index.html' | awk '{print \$1}'"
)"

LIVE_INDEX_HASH="$(
  curl -fsS https://nathanbrenton.com/index.html |
    sha256_local |
    awk '{print $1}'
)"

printf 'rollback_index=%s\n' "$REMOTE_INDEX_HASH"
printf 'live_index=%s\n' "$LIVE_INDEX_HASH"

[[ "$REMOTE_INDEX_HASH" == "$LIVE_INDEX_HASH" ]] ||
  fail "live index.html does not match rollback release"

printf 'rollback_validation=PASS\n'


printf '\n===== 7. OPTIONAL FAILED-RELEASE CLEANUP =====\n'

printf 'Rolled back from: %s\n' "$CURRENT_NAME"
printf 'Production now:  %s\n' "$PREVIOUS"
printf '\n'

if confirm "Delete rolled-back release $CURRENT_NAME from the server?"; then
  STILL_CURRENT="$(
    ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'"
  )"

  [[ "$STILL_CURRENT" == "releases/$PREVIOUS" ]] ||
    fail "production current changed unexpectedly; refusing cleanup"

  [[ "$CURRENT_NAME" != "$PREVIOUS" ]] ||
    fail "cleanup target unexpectedly equals current release"

  ssh "$REMOTE" \
    "rm -rf -- '$REMOTE_ROOT/releases/$CURRENT_NAME'"

  if ssh "$REMOTE" \
    "test -e '$REMOTE_ROOT/releases/$CURRENT_NAME'"
  then
    fail "rolled-back release still exists after cleanup"
  fi

  printf 'deleted_release=%s\n' "$CURRENT_NAME"
else
  printf 'retained_release=%s\n' "$CURRENT_NAME"
fi


printf '\nROLLBACK COMPLETE\n'
printf 'current=releases/%s\n' "$PREVIOUS"
