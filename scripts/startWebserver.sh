#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8080

cd "$ROOT"

echo "Serving $ROOT"
echo "http://localhost:$PORT"

python3 -m http.server "$PORT"
