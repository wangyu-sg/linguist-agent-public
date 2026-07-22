#!/usr/bin/env python3
"""Isolated MinerU Labs worker using JSONL and argv-only subprocesses."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def handle(request: dict[str, Any]) -> dict[str, Any]:
    operation = str(request.get("operation") or "probe")
    executable = Path(sys.executable).parent / "mineru"
    if not executable.is_file():
        raise FileNotFoundError("The isolated MinerU console script is missing")
    if operation == "probe":
        completed = subprocess.run([str(executable), "--version"], check=True, capture_output=True, text=True, timeout=30)
        return {"ok": True, "version": (completed.stdout or completed.stderr).strip()}
    if operation != "extract":
        raise ValueError(f"Unsupported MinerU operation: {operation}")
    source = Path(str(request.get("sourcePath") or "")).resolve(strict=True)
    output = Path(str(request.get("outputDirectory") or "")).resolve(strict=False)
    if source == output or source in output.parents:
        raise ValueError("MinerU output must be a separate managed directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"MinerU output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        [str(executable), "-p", str(source), "-o", str(output)],
        check=True,
        capture_output=True,
        text=True,
        timeout=int(request.get("timeoutSeconds") or 900),
    )
    files = [
        {"path": str(path.relative_to(output)), "sha256": sha256(path), "sizeBytes": path.stat().st_size}
        for path in sorted(output.rglob("*"))
        if path.is_file()
    ]
    return {
        "ok": True,
        "sourcePath": str(source),
        "sourceSha256": sha256(source),
        "outputDirectory": str(output),
        "files": files,
        "stdout": completed.stdout[-4000:],
        "stderr": completed.stderr[-4000:],
    }


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Worker request must be a JSON object")
            response = handle(request)
        except Exception as error:
            response = {"ok": False, "error": str(error), "errorType": type(error).__name__}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
