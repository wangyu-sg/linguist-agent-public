#!/usr/bin/env bash
# Retired TencentDB-Agent-Memory runtime setup entrypoint.

set -euo pipefail

echo "[tdai-setup] Legacy TDAI memory runtime is retired. No repository will be cloned, updated, patched, or installed."
echo "[tdai-setup] Export legacy records through a user-approved read-only adapter, then review them as pending MemoryCandidate records in LA."
exit 1
