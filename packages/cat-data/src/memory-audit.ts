import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { readJsonlFile, workspacePath, type CatWorkspace } from "./workspace.js";

export type MemoryAuditKind = "capture_success" | "capture_failed" | "search_success" | "search_failed" | "store_success" | "store_failed";

export interface MemoryAuditEvent {
  ts: string;
  kind: MemoryAuditKind;
  gatewayUrl: string;
  projectId: string;
  sessionId?: string;
  query?: string;
  resultCount?: number;
  strategy?: string;
  contentPreview?: string;
  error?: string;
}

export interface MemoryAuditSummary {
  path: string;
  total: number;
  lastEvent?: MemoryAuditEvent;
  lastCaptureAt?: string;
  lastCaptureError?: string;
  lastSearchAt?: string;
  lastStoreAt?: string;
  consecutiveFailures: number;
}

export function memoryAuditPath(workspace: CatWorkspace): string {
  return workspacePath(workspace, "memory_audit.jsonl");
}

export async function appendMemoryAudit(workspace: CatWorkspace, event: Omit<MemoryAuditEvent, "ts" | "projectId">): Promise<void> {
  const full: MemoryAuditEvent = {
    ts: new Date().toISOString(),
    projectId: workspace.projectId,
    ...event,
  };
  const path = memoryAuditPath(workspace);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(full)}\n`, "utf8");
}

export async function readMemoryAuditSummary(workspace: CatWorkspace, limit = 200): Promise<MemoryAuditSummary> {
  const path = memoryAuditPath(workspace);
  const rows = (await readJsonlFile<MemoryAuditEvent>(path)).slice(-limit);
  let lastCaptureAt: string | undefined;
  let lastCaptureError: string | undefined;
  let lastSearchAt: string | undefined;
  let lastStoreAt: string | undefined;
  let consecutiveFailures = 0;
  for (const row of rows) {
    if (row.kind === "capture_success") {
      lastCaptureAt = row.ts;
      lastCaptureError = undefined;
    }
    if (row.kind === "capture_failed") {
      lastCaptureError = row.error;
    }
    if (row.kind === "search_success") lastSearchAt = row.ts;
    if (row.kind === "store_success") lastStoreAt = row.ts;
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!rows[i]?.kind.endsWith("_failed")) break;
    consecutiveFailures += 1;
  }
  return {
    path,
    total: rows.length,
    lastEvent: rows.at(-1),
    lastCaptureAt,
    lastCaptureError,
    lastSearchAt,
    lastStoreAt,
    consecutiveFailures,
  };
}
