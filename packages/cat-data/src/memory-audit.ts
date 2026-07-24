import { readJsonlFile, workspacePath, type CatWorkspace } from "./workspace.js";

export type LegacyMemoryAuditKind = "capture_success" | "capture_failed" | "search_success" | "search_failed" | "store_success" | "store_failed";

export interface LegacyMemoryAuditEvent {
  ts: string;
  kind: LegacyMemoryAuditKind;
}

export interface LegacyMemoryAuditSummary {
  path: string;
  total: number;
  lastLegacyActivityAt?: string;
  kinds: LegacyMemoryAuditKind[];
}

export function legacyMemoryAuditPath(workspace: CatWorkspace): string {
  return workspacePath(workspace, "memory_audit.jsonl");
}

/**
 * Historical audit records are inventory evidence only.  This module has no
 * append API, so a new Run cannot recreate the retired TDAI write path.
 */
export async function readLegacyMemoryAuditSummary(workspace: CatWorkspace, limit = 200): Promise<LegacyMemoryAuditSummary> {
  const path = legacyMemoryAuditPath(workspace);
  const rows = (await readJsonlFile<LegacyMemoryAuditEvent>(path)).slice(-limit)
    .filter((row): row is LegacyMemoryAuditEvent => Boolean(row)
      && typeof row.ts === "string"
      && ["capture_success", "capture_failed", "search_success", "search_failed", "store_success", "store_failed"].includes(row.kind));
  return {
    path,
    total: rows.length,
    ...(rows.at(-1)?.ts ? { lastLegacyActivityAt: rows.at(-1)!.ts } : {}),
    kinds: [...new Set(rows.map((row) => row.kind))],
  };
}
