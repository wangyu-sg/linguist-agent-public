#!/usr/bin/env bash
# One-time setup for TencentDB-Agent-Memory Gateway sidecar.
# Clones the repo to ~/.memory-tencentdb/TencentDB-Agent-Memory and installs deps.
# Run once, then use tdai-start.sh to launch.

set -euo pipefail

REPO_URL="https://github.com/Tencent/TencentDB-Agent-Memory"
CLONE_ROOT="${MEMORY_TENCENTDB_ROOT:-$HOME/.memory-tencentdb}"
REPO_DIR="$CLONE_ROOT/TencentDB-Agent-Memory"
CONFIG_DIR="$CLONE_ROOT/memory-tdai"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EMBED_PATCH="$SCRIPT_DIR/../patches/tdai-gateway-embed.patch"

echo "[tdai-setup] Clone root: $CLONE_ROOT"

# Clone or update
mkdir -p "$CLONE_ROOT"
if [ -d "$REPO_DIR/.git" ]; then
  if git -C "$REPO_DIR" diff --quiet && git -C "$REPO_DIR" diff --cached --quiet; then
    echo "[tdai-setup] Repo exists — pulling latest..."
    git -C "$REPO_DIR" pull --ff-only
  else
    echo "[tdai-setup] Repo exists with local changes — skipping pull to preserve them."
  fi
else
  echo "[tdai-setup] Cloning $REPO_URL ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# LA uses TDAI as an embedding provider only. This patch exposes POST /embed
# without reading or writing TDAI memory records.
if grep -q "POST /embed" "$REPO_DIR/src/gateway/server.ts"; then
  echo "[tdai-setup] TDAI /embed bridge already present — skipping patch."
else
  echo "[tdai-setup] Applying LA TDAI /embed bridge patch..."
  git apply --check "$EMBED_PATCH"
  git apply "$EMBED_PATCH"
fi

# Install dependencies
echo "[tdai-setup] Installing npm dependencies..."
npm install --ignore-scripts

# Copy LA config into the data dir
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/tdai-gateway.yaml" ]; then
  cp "$SCRIPT_DIR/../config/tdai-gateway.yaml" "$CONFIG_DIR/tdai-gateway.yaml"
  echo "[tdai-setup] Wrote $CONFIG_DIR/tdai-gateway.yaml"
else
  echo "[tdai-setup] Config already exists at $CONFIG_DIR/tdai-gateway.yaml — skipping."
fi

echo "[tdai-setup] Done. Start with: npm run tdai:start"
