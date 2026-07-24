#!/usr/bin/env bash
# Linguist Agent — one-click stop.
#
# Stops the background server-mode processes started by scripts/la-start.sh:
# the Unix-domain cat-server and optional TencentDB memory
# gateway (8420).
#
# Usage: bash scripts/la-stop.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="tmp/la"
GATEWAY_PORT="8420"

stopped_any=0

kill_pidfile() { # name — kill the recorded npm wrapper pid + its children
  local name="$1" file="$RUN_DIR/$name.pid" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[la-stop] stopping $name (pid $pid + children)"
    pkill -P "$pid" 2>/dev/null || true   # child processes
    kill "$pid" 2>/dev/null || true       # the npm wrapper
    stopped_any=1
  fi
  rm -f "$file"
}

kill_port() { # port, label — kill whatever holds the port (the real listener)
  local port="$1" label="$2" pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[la-stop] stopping $label (port $port): $(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
    stopped_any=1
  else
    echo "[la-stop] $label (port $port): not running"
  fi
}

# Recorded npm wrappers first (so they don't respawn/orphan), then port-based kill
# of the actual listeners as the authoritative cleanup.
for name in server gateway; do kill_pidfile "$name"; done

if [ -n "${LA_SERVER_PORT:-}" ]; then
  kill_port "$LA_SERVER_PORT" "legacy cat-server"
fi
kill_port "$GATEWAY_PORT" "memory gateway"

if [ "$stopped_any" = "1" ]; then
  echo "[la-stop] Done."
else
  echo "[la-stop] Nothing was running."
fi
