#!/usr/bin/env bash
# Smoke-test every page in headless Chrome: report JS errors and save screenshots.
# Usage: scripts/smoke.sh [port]   (expects a static server on the port, default 8765)
set -u
PORT="${1:-8765}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SMOKE_OUT:-$ROOT/.smoke}"
mkdir -p "$OUT"
fail=0
for page in index.html playground.html lessons/*.html; do
  [ -f "$ROOT/$page" ] || continue
  url="http://localhost:$PORT/$page"
  name="$(echo "$page" | tr '/' '_' | sed 's/.html$//')"
  dom="$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=4000 --dump-dom "$url" 2>/dev/null)"
  errs="$(printf '%s' "$dom" | grep -o 'data-js-errors="[^"]*"' | head -1)"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1360,2400 --virtual-time-budget=4000 \
    --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1
  if [ -n "$errs" ]; then echo "FAIL $page  $errs"; fail=1; else echo "ok   $page"; fi
done
exit $fail
