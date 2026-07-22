#!/usr/bin/env bash
# Start the TencentDB-Agent-Memory Gateway sidecar.
# Prerequisites: run scripts/tdai-setup.sh once first.

set -euo pipefail

CLONE_ROOT="${MEMORY_TENCENTDB_ROOT:-$HOME/.memory-tencentdb}"
REPO_DIR="$CLONE_ROOT/TencentDB-Agent-Memory"
CONFIG_DIR="$CLONE_ROOT/memory-tdai"

if [ ! -d "$REPO_DIR" ]; then
  echo "[tdai-start] Repo not found at $REPO_DIR — run 'npm run tdai:setup' first."
  exit 1
fi

export TDAI_DATA_DIR="$CONFIG_DIR"
export TDAI_GATEWAY_CONFIG="$CONFIG_DIR/tdai-gateway.yaml"

if curl -fsS http://127.0.0.1:8420/health >/dev/null 2>&1; then
  echo "[tdai-start] TDAI Gateway already healthy at http://127.0.0.1:8420"
  if curl -fsS -X POST http://127.0.0.1:8420/embed -H "Content-Type: application/json" -d '{"texts":[]}' >/dev/null 2>&1; then
    echo "[tdai-start] TDAI /embed bridge is available."
  else
    echo "[tdai-start] Warning: TDAI Gateway is healthy but /embed is unavailable or not ready."
    echo "[tdai-start] Run npm run tdai:setup and restart the Gateway before building embedding-backed asset RAG indexes."
  fi
  echo "[tdai-start] Nothing to start."
  exit 0
fi

echo "[tdai-start] Starting TDAI Gateway on http://127.0.0.1:8420"
echo "[tdai-start] Data dir: $CONFIG_DIR"
echo "[tdai-start] Press Ctrl+C to stop."

cd "$REPO_DIR"
npx tsx src/gateway/server.ts
