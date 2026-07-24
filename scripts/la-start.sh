#!/usr/bin/env bash
# Linguist Agent — one-click start.
#
# Usage:
#   bash scripts/la-start.sh            # local server in the background
#   bash scripts/la-start.sh server     # same explicit server form
#   bash scripts/la-start.sh server --memory   # local server + TencentDB memory gateway
#
# Server mode runs cat-server in the background — stop it with scripts/la-stop.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="tmp/la"
GATEWAY_PORT="8420"

MODE="${1:-server}"
WITH_MEMORY=0
for arg in "$@"; do
  [ "$arg" = "--memory" ] && WITH_MEMORY=1
done

if [ ! -d node_modules ]; then
  echo "[la-start] node_modules missing — run 'npm install' first." >&2
  exit 1
fi

if [ "$MODE" = "--memory" ]; then MODE="server"; fi
if [ "$MODE" != "server" ]; then
  echo "[la-start] Unknown mode '$MODE'. Linguist Agent product runs through the native app or canonical Task/CAT server." >&2
  exit 1
fi

port_pids() { lsof -ti "tcp:$1" 2>/dev/null || true; }

# ── Server mode (background) ──────────────────────────────────────────────────────
mkdir -p "$RUN_DIR"

start_bg() { # name, logfile, cmd...
  local name="$1" log="$2" session pid cmd; shift 2
  if command -v screen >/dev/null 2>&1; then
    session="la-$name"
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    cmd="$(printf '%q ' "$@")"
    screen -dmS "$session" bash -lc "cd \"$ROOT\" && exec $cmd >\"$log\" 2>&1"
    sleep 0.2
    pid="$(screen -ls 2>/dev/null | awk -v session=".$session" '$1 ~ session { split($1, a, "."); print a[1]; exit }' || true)"
    [ -n "$pid" ] || pid="$(pgrep -f "SCREEN.*${session}" | head -n 1 || true)"
    echo "$pid" >"$RUN_DIR/$name.pid"
  else
    nohup "$@" </dev/null >"$log" 2>&1 &
    echo $! >"$RUN_DIR/$name.pid"
  fi
  echo "[la-start] $name started (pid $(cat "$RUN_DIR/$name.pid"), log $log)"
}

if [ "$WITH_MEMORY" = "1" ]; then
  if [ -d "${MEMORY_TENCENTDB_ROOT:-$HOME/.memory-tencentdb}/TencentDB-Agent-Memory" ]; then
    if [ -z "$(port_pids "$GATEWAY_PORT")" ]; then
      start_bg gateway "$RUN_DIR/gateway.log" npm run tdai:start
    else
      echo "[la-start] memory gateway already running on $GATEWAY_PORT"
    fi
  else
    echo "[la-start] --memory requested but gateway not set up — run 'npm run tdai:setup' first. Continuing without memory."
  fi
fi

start_bg server "$RUN_DIR/server.log" npm run server

# ── wait for readiness ─────────────────────────────────────────────────────────
echo -n "[la-start] waiting for authenticated local runtime "
ready=0
for _ in $(seq 1 40); do
  if node scripts/check-local-runtime.mjs >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$(cat "$RUN_DIR/server.pid")" 2>/dev/null; then break; fi
  printf "."; sleep 0.5
done
echo
if [ "$ready" != "1" ]; then
  echo "[la-start] server did not become ready — see $RUN_DIR/server.log" >&2
  echo "[la-start] (run 'bash scripts/la-stop.sh' to clean up)" >&2
  exit 1
fi

echo "[la-start] Server ready on authenticated Unix transport"
echo "[la-start] Stop with: bash scripts/la-stop.sh"
