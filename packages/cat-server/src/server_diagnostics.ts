import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ServerDiagnosticCode =
  | "project_manifest_unreadable"
  | "project_batches_unreadable"
  | "project_batch_unreadable"
  | "mcp_config_not_discoverable"
  | "mcp_discovery_failed"
  | "session_stats_line_unreadable";

export interface ServerDiagnostic {
  ts: string;
  severity: "warning" | "error";
  code: ServerDiagnosticCode;
  message: string;
  path?: string;
  projectId?: string;
  batchId?: string;
  line?: number;
}

export function serverDiagnosticsPath(repoRoot: string): string {
  return join(repoRoot, "data", "server_diagnostics.jsonl");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createServerDiagnostic(params: Omit<ServerDiagnostic, "ts" | "message"> & {
  ts?: string;
  error?: unknown;
  message?: string;
}): ServerDiagnostic {
  return {
    ts: params.ts ?? new Date().toISOString(),
    severity: params.severity,
    code: params.code,
    message: params.message ?? errorMessage(params.error),
    path: params.path,
    projectId: params.projectId,
    batchId: params.batchId,
    line: params.line,
  };
}

export async function appendServerDiagnostics(repoRoot: string, diagnostics: ServerDiagnostic[]): Promise<void> {
  if (!diagnostics.length) return;
  const path = serverDiagnosticsPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, diagnostics.map((diagnostic) => JSON.stringify(diagnostic)).join("\n") + "\n", "utf8");
}

export async function readServerDiagnostics(repoRoot: string, limit = 200): Promise<ServerDiagnostic[]> {
  try {
    const raw = await readFile(serverDiagnosticsPath(repoRoot), "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-Math.max(1, Math.min(limit, 2000)))
      .map((line) => JSON.parse(line) as ServerDiagnostic);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
