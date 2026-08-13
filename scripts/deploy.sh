#!/usr/bin/env bash
set -euo pipefail

LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="nathan-prod"
REMOTE_ROOT="/var/www/nathanbrenton.com"

RSYNC_EXCLUDES=(
  --exclude='.git/'
  --exclude='.gitignore'
  --exclude='.DS_Store'
  --exclude='.gitkeep'
  --exclude='README.md'
  --exclude='deploy/'
  --exclude='docs/'
  --exclude='scripts/'
)

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

confirm() {
  local prompt="$1"
  local reply

  printf '%s [y/N] ' "$prompt"
  read -r reply

  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

for cmd in ssh rsync curl shasum; do
  command -v "$cmd" >/dev/null 2>&1 ||
    fail "required command not found: $cmd"
done

cd "$LOCAL_ROOT"

printf '\n===== 1. VERIFY SSH CONNECTION =====\n'

SSH_HOST="$(ssh "$REMOTE" 'hostname')"
SSH_USER="$(ssh "$REMOTE" 'whoami')"

printf 'ssh_verified=yes\nhost=%s\nuser=%s\n' "$SSH_HOST" "$SSH_USER"

[[ "$SSH_HOST" == "web-prod-01" ]] ||
  fail "unexpected remote host: $SSH_HOST"

[[ "$SSH_USER" == "deploy-nathan" ]] ||
  fail "unexpected remote user: $SSH_USER"


printf '\n===== 2. VERIFY CURRENT PRODUCTION RELEASE =====\n'

CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

[[ "$CURRENT" == releases/* ]] ||
  fail "unexpected current symlink target: $CURRENT"

LINK_DEST="$REMOTE_ROOT/$CURRENT"

printf 'current=%s\n' "$CURRENT"

ssh "$REMOTE" "test -d '$LINK_DEST'" ||
  fail "current release target does not exist: $LINK_DEST"

printf 'current_target_exists=yes\n'


printf '\n===== 3. PREPARE DEPLOYMENT VARIABLES =====\n'

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"

printf 'current=%s\n' "$CURRENT"
printf 'link_dest=%s\n' "$LINK_DEST"
printf 'new_release=%s\n' "$RELEASE"

ssh "$REMOTE" "test -d '$LINK_DEST'" ||
  fail "link-dest does not exist"

printf 'link_dest_exists=yes\n'


printf '\n===== 4. DRY-RUN PUBLIC PAYLOAD =====\n'

rsync -a \
  --no-owner \
  --no-group \
  --delete \
  --itemize-changes \
  --dry-run \
  "${RSYNC_EXCLUDES[@]}" \
  --link-dest="$LINK_DEST" \
  ./ \
  "$REMOTE:$REMOTE_ROOT/releases/$RELEASE/"

printf '\nReview the dry-run above carefully.\n'

confirm "Upload this staged release?" || {
  printf 'Deployment cancelled before upload.\n'
  exit 0
}


printf '\n===== 5. UPLOAD NEW RELEASE =====\n'

rsync -a \
  --no-owner \
  --no-group \
  --delete \
  --itemize-changes \
  --stats \
  "${RSYNC_EXCLUDES[@]}" \
  --link-dest="$LINK_DEST" \
  ./ \
  "$REMOTE:$REMOTE_ROOT/releases/$RELEASE/"

printf 'uploaded_release=%s\n' "$RELEASE"

AFTER_UPLOAD_CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

printf 'current=%s\n' "$AFTER_UPLOAD_CURRENT"

[[ "$AFTER_UPLOAD_CURRENT" == "$CURRENT" ]] ||
  fail "production changed before promotion"


printf '\n===== 6. VALIDATE STAGED RELEASE =====\n'

ssh "$REMOTE" "test -d '$REMOTE_ROOT/releases/$RELEASE'" ||
  fail "staged release missing"

printf 'release_exists=yes\n'


printf '\n----- Remote file inventory -----\n'

ssh "$REMOTE" \
  "find '$REMOTE_ROOT/releases/$RELEASE' -type f -printf '%P\n' | sort"


printf '\n----- Forbidden files -----\n'

ssh "$REMOTE" "\
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/README.md' && \
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/deploy' && \
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/docs' && \
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/scripts' && \
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/.git' && \
  test ! -e '$REMOTE_ROOT/releases/$RELEASE/.gitignore'" ||
  fail "forbidden file or directory found in staged release"

printf 'forbidden_files=absent\n'


printf '\n----- Required public files -----\n'

for file in \
  index.html \
  script.js \
  site-data.js \
  styles.css \
  resume/Nathan-Brenton-Resume.pdf
do
  ssh "$REMOTE" \
    "test -f '$REMOTE_ROOT/releases/$RELEASE/$file'" ||
    fail "required public file missing: $file"
done

printf 'required_files=present\n'


printf '\n----- Release symlinks -----\n'

if ssh "$REMOTE" \
  "find '$REMOTE_ROOT/releases/$RELEASE' -type l -print -quit | grep -q ."
then
  fail "release_symlinks=FOUND"
fi

printf 'release_symlinks=none\n'


printf '\n----- Byte-for-byte comparison -----\n'

CHECKSUM_DIFF="$(
  rsync -a \
    --checksum \
    --delete \
    --itemize-changes \
    --dry-run \
    --no-owner \
    --no-group \
    "${RSYNC_EXCLUDES[@]}" \
    ./ \
    "$REMOTE:$REMOTE_ROOT/releases/$RELEASE/"
)"

if [[ -n "$CHECKSUM_DIFF" ]]; then
  printf '%s\n' "$CHECKSUM_DIFF"
  fail "staged release differs from local public source"
fi

printf 'checksum_comparison=clean\n'


STILL_CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

printf 'current=%s\n' "$STILL_CURRENT"

[[ "$STILL_CURRENT" == "$CURRENT" ]] ||
  fail "production changed during staged validation"


printf '\nStaged release %s passed validation.\n' "$RELEASE"

confirm "Atomically promote this release to production?" || {
  printf 'Release remains staged but was not promoted: %s\n' "$RELEASE"
  exit 0
}


printf '\n===== 7. ATOMIC PROMOTION =====\n'

ssh "$REMOTE" "\
  ROOT='$REMOTE_ROOT'; \
  RELEASE='$RELEASE'; \
  OLD=\$(readlink \"\$ROOT/current\") || exit 1; \
  rm -f \"\$ROOT/.current-\$RELEASE\"; \
  ln -s \"releases/\$RELEASE\" \"\$ROOT/.current-\$RELEASE\" && \
  mv -Tf \"\$ROOT/.current-\$RELEASE\" \"\$ROOT/current\" && \
  printf 'previous=%s\ncurrent=%s\n' \
    \"\$OLD\" \
    \"\$(readlink \"\$ROOT/current\")\""

PROMOTED_CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

[[ "$PROMOTED_CURRENT" == "releases/$RELEASE" ]] ||
  fail "promotion did not point current at releases/$RELEASE"


printf '\n===== 8. LIVE PRODUCTION VALIDATION =====\n'

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


LOCAL_INDEX_HASH="$(
  shasum -a 256 index.html |
    awk '{print $1}'
)"

LIVE_INDEX_HASH="$(
  curl -fsS https://nathanbrenton.com/index.html |
    shasum -a 256 |
    awk '{print $1}'
)"

printf 'local_index=%s\n' "$LOCAL_INDEX_HASH"
printf 'live_index=%s\n' "$LIVE_INDEX_HASH"

[[ "$LOCAL_INDEX_HASH" == "$LIVE_INDEX_HASH" ]] ||
  fail "live index.html does not match local source"


FINAL_CURRENT="$(ssh "$REMOTE" "readlink '$REMOTE_ROOT/current'")"

printf 'current=%s\n' "$FINAL_CURRENT"

[[ "$FINAL_CURRENT" == "releases/$RELEASE" ]] ||
  fail "production symlink does not match promoted release"


printf '\nDEPLOYMENT COMPLETE\n'
printf 'release=%s\n' "$RELEASE"
