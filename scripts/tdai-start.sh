#!/usr/bin/env bash
# Retired TencentDB-Agent-Memory runtime start entrypoint.

set -euo pipefail

echo "[tdai-start] Legacy TDAI capture/store/recall is disabled and cannot be started by LA."
echo "[tdai-start] Use Confirmed Memory for recall. Any legacy import must use the explicit read-only MemoryCandidate workflow."
exit 1
