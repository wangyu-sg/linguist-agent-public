import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createDiagnosticId, redactLogContext } from "@linguist-agent/cat-data";

export type ServerDiagnosticCode =
  | "project_manifest_unreadable"
  | "project_batches_unreadable"
  | "project_batch_unreadable"
  | "mcp_config_not_discoverable"
  | "mcp_discovery_failed"
  | "session_stats_line_unreadable";

const SERVER_DIAGNOSTIC_CODES = new Set<ServerDiagnosticCode>([
  "project_manifest_unreadable",
  "project_batches_unreadable",
  "project_batch_unreadable",
  "mcp_config_not_discoverable",
  "mcp_discovery_failed",
  "session_stats_line_unreadable",
]);

function requiredDiagnosticCode(value: unknown): ServerDiagnosticCode {
  if (typeof value !== "string" || !SERVER_DIAGNOSTIC_CODES.has(value as ServerDiagnosticCode)) {
    throw new Error("Server diagnostic code is invalid.");
  }
  return value as ServerDiagnosticCode;
}

function requiredDiagnosticSeverity(value: unknown): ServerDiagnostic["severity"] {
  if (value !== "warning" && value !== "error") throw new Error("Server diagnostic severity is invalid.");
  return value;
}

export interface ServerDiagnostic {
  schemaVersion: 1;
  ts: string;
  diagnosticId: string;
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

export function createServerDiagnostic(params: Omit<ServerDiagnostic, "schemaVersion" | "ts" | "diagnosticId" | "message"> & {
  ts?: string;
  diagnosticId?: string;
  error?: unknown;
  message?: string;
}): ServerDiagnostic {
  const redacted = redactLogContext({
    error: params.error ?? new Error(params.message ?? "Unknown diagnostic failure."),
    path: params.path,
    projectId: params.projectId,
    batchId: params.batchId,
    diagnosticId: params.diagnosticId,
  }) as {
    error: { message?: string };
    path?: string;
    projectId?: string;
    batchId?: string;
    diagnosticId?: string;
  };
  return {
    schemaVersion: 1,
    ts: params.ts ?? new Date().toISOString(),
    diagnosticId: redacted.diagnosticId && redacted.diagnosticId !== "[REDACTED]"
      ? redacted.diagnosticId
      : createDiagnosticId(),
    severity: params.severity,
    code: params.code,
    message: redacted.error.message ?? "Diagnostic failure details were unavailable.",
    path: redacted.path,
    projectId: redacted.projectId,
    batchId: redacted.batchId,
    line: params.line,
  };
}

let appendQueue: Promise<void> = Promise.resolve();

export async function appendServerDiagnostics(
  repoRoot: string,
  diagnostics: ServerDiagnostic[],
  options: { maxBytes?: number } = {},
): Promise<void> {
  if (!diagnostics.length) return;
  const previous = appendQueue;
  let release!: () => void;
  appendQueue = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  await previous;
  try {
    const path = serverDiagnosticsPath(repoRoot);
    const archivePath = `${path}.1`;
    const maxBytes = Math.max(1_024, Math.floor(options.maxBytes ?? 5 * 1024 * 1024));
    await mkdir(dirname(path), { recursive: true });
    const safeDiagnostics = diagnostics.map((diagnostic) => createServerDiagnostic({
      ts: diagnostic.ts,
      diagnosticId: diagnostic.diagnosticId,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.path,
      projectId: diagnostic.projectId,
      batchId: diagnostic.batchId,
      line: diagnostic.line,
    }));
    const lines = safeDiagnostics.map((diagnostic) => `${JSON.stringify(diagnostic)}\n`);
    const retainedLines: string[] = [];
    let retainedBytes = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!;
      const lineBytes = Buffer.byteLength(line);
      if (retainedBytes + lineBytes > maxBytes) continue;
      retainedLines.unshift(line);
      retainedBytes += lineBytes;
    }
    if (!retainedLines.length) throw new Error("A redacted server diagnostic exceeds the retention bound.");
    const payload = retainedLines.join("");
    const currentBytes = await stat(path).then((metadata) => metadata.size, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    if (currentBytes > 0 && currentBytes + Buffer.byteLength(payload) > maxBytes) {
      await rm(archivePath, { force: true });
      await rename(path, archivePath);
    }
    await appendFile(path, payload, { encoding: "utf8", mode: 0o600 });
  } finally {
    release();
  }
}

export async function readServerDiagnostics(repoRoot: string, limit = 200): Promise<ServerDiagnostic[]> {
  try {
    const raw = await readFile(serverDiagnosticsPath(repoRoot), "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-Math.max(1, Math.min(limit, 2000)))
      .map((line) => JSON.parse(line) as Partial<ServerDiagnostic>)
      .map((diagnostic) => createServerDiagnostic({
        ts: diagnostic.ts,
        diagnosticId: diagnostic.diagnosticId,
        severity: requiredDiagnosticSeverity(diagnostic.severity),
        code: requiredDiagnosticCode(diagnostic.code),
        message: typeof diagnostic.message === "string" ? diagnostic.message : "Legacy diagnostic detail was unavailable.",
        path: diagnostic.path,
        projectId: diagnostic.projectId,
        batchId: diagnostic.batchId,
        line: diagnostic.line,
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
