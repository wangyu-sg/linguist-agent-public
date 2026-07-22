import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { TeamRoleId, TeamRolePass, TeamRoleStatus } from "./team_workflow.js";

export interface SubagentAsyncStatus {
  lifecycleArtifactVersion?: number;
  runId: string;
  sessionId?: string;
  mode?: "single" | "parallel" | "chain";
  state: "queued" | "running" | "complete" | "failed" | "paused";
  agent?: string;
  agents?: string[];
  startedAt?: number;
  endedAt?: number;
  lastUpdate?: number;
  cwd?: string;
  outputFile?: string;
  sessionFile?: string;
  totalTokens?: { input: number; output: number; total: number };
  totalCost?: { inputTokens: number; outputTokens: number; costUsd: number };
  steps?: Array<{
    agent: string;
    model?: string;
    status?: string;
    transcriptPath?: string;
    sessionFile?: string;
    currentTool?: string;
    currentPath?: string;
    turnCount?: number;
    toolCount?: number;
  }>;
  error?: string;
}

export interface SubagentRolePassSyncInput {
  workflowId: string;
  roleId: TeamRoleId;
  sessionId: string;
  subagentRunId?: string;
  asyncDir?: string;
  asyncRoot?: string;
  inputArtifactRefs?: string[];
  outputArtifactRefs?: string[];
  contextManifestRef?: TeamRolePass["contextManifestRef"];
  contextManifest?: TeamRolePass["contextManifest"];
  transcriptRef?: string;
}

export interface SubagentRolePassSyncResult {
  rolePass: TeamRolePass;
  status: SubagentAsyncStatus;
  asyncDir: string;
}

function sanitizeTempScopeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function tempScopeId(): string {
  if (typeof process.getuid === "function") {
    try {
      return `uid-${process.getuid()}`;
    } catch {
      // Fall through to username/HOME for platforms without a stable uid.
    }
  }
  try {
    const username = userInfo().username;
    if (username) return `user-${sanitizeTempScopeSegment(username)}`;
  } catch {
    // Fall through to HOME, matching pi-subagents' best-effort temp scope.
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
  return home ? `home-${sanitizeTempScopeSegment(home)}` : "shared";
}

export function defaultSubagentAsyncRoot(): string {
  return join(tmpdir(), `pi-subagents-${tempScopeId()}`, "async-subagent-runs");
}

function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith(`..${"\\"}`) || resolve(rel) === rel) {
    throw new Error(`Subagent async dir must be inside ${resolvedRoot}.`);
  }
}

function statusToRoleStatus(state: SubagentAsyncStatus["state"]): TeamRoleStatus {
  switch (state) {
    case "queued": return "queued";
    case "running": return "running";
    case "complete": return "completed";
    case "failed": return "failed";
    case "paused": return "waiting";
  }
}

function iso(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

function roleAgentName(roleId: TeamRoleId): string {
  return `la-team-${roleId.replaceAll("_", "-")}`;
}

export async function readSubagentAsyncStatus(input: { subagentRunId?: string; asyncDir?: string; asyncRoot?: string }): Promise<{ status: SubagentAsyncStatus; asyncDir: string }> {
  const asyncRoot = resolve(input.asyncRoot ?? defaultSubagentAsyncRoot());
  const asyncDir = input.asyncDir ? resolve(input.asyncDir) : join(asyncRoot, input.subagentRunId ?? "");
  assertInsideRoot(asyncRoot, asyncDir);
  if (!input.subagentRunId && !input.asyncDir) throw new Error("subagentRunId or asyncDir is required.");
  if (input.subagentRunId && basename(asyncDir) !== input.subagentRunId && !input.asyncDir) throw new Error("subagentRunId does not match asyncDir.");
  const status = JSON.parse(await readFile(join(asyncDir, "status.json"), "utf8")) as SubagentAsyncStatus;
  if (input.subagentRunId && status.runId && status.runId !== input.subagentRunId) throw new Error(`Subagent status runId ${status.runId} does not match ${input.subagentRunId}.`);
  return { status, asyncDir };
}

export async function waitForSubagentAsyncStatus(
  input: { subagentRunId?: string; asyncDir?: string; asyncRoot?: string },
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ status: SubagentAsyncStatus; asyncDir: string }> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 3_000);
  const pollMs = Math.max(1, options.pollMs ?? 25);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (true) {
    try {
      return await readSubagentAsyncStatus(input);
    } catch (error) {
      const transient = (error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError;
      if (!transient) throw error;
      lastError = error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for pi-subagents status.json after ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export async function listSubagentAsyncStatuses(input: { asyncRoot?: string; sinceMs?: number; agent?: string } = {}): Promise<Array<{ status: SubagentAsyncStatus; asyncDir: string }>> {
  const asyncRoot = resolve(input.asyncRoot ?? defaultSubagentAsyncRoot());
  let entries: string[];
  try {
    entries = await readdir(asyncRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: Array<{ status: SubagentAsyncStatus; asyncDir: string }> = [];
  for (const entry of entries) {
    const asyncDir = join(asyncRoot, entry);
    try {
      if (!(await stat(asyncDir)).isDirectory()) continue;
      const { status } = await readSubagentAsyncStatus({ asyncDir, asyncRoot });
      const time = status.startedAt ?? status.lastUpdate ?? status.endedAt ?? 0;
      if (input.sinceMs !== undefined && time < input.sinceMs) continue;
      if (input.agent && status.agent !== input.agent && !status.steps?.some((step) => step.agent === input.agent)) continue;
      rows.push({ status, asyncDir });
    } catch {
      // Ignore partial async dirs while pi-subagents is still writing them.
    }
  }
  return rows.sort((a, b) => (b.status.startedAt ?? b.status.lastUpdate ?? 0) - (a.status.startedAt ?? a.status.lastUpdate ?? 0));
}

export async function buildRolePassFromSubagentStatus(input: SubagentRolePassSyncInput): Promise<SubagentRolePassSyncResult> {
  const { status, asyncDir } = await readSubagentAsyncStatus({
    subagentRunId: input.subagentRunId,
    asyncDir: input.asyncDir,
    asyncRoot: input.asyncRoot,
  });
  const outputRefs = [...(input.outputArtifactRefs ?? [])];
  if (status.outputFile) outputRefs.push(`subagent-output:${status.outputFile}`);
  const expectedAgent = roleAgentName(input.roleId);
  const modelStep = status.steps?.find((step) => step.agent === input.roleId || step.agent === expectedAgent);
  const usage = status.totalTokens || status.totalCost ? {
    inputTokens: status.totalTokens?.input ?? status.totalCost?.inputTokens,
    outputTokens: status.totalTokens?.output ?? status.totalCost?.outputTokens,
    totalTokens: status.totalTokens?.total,
    costUsd: status.totalCost?.costUsd,
  } : undefined;
  const rolePass: TeamRolePass = {
    workflowId: input.workflowId,
    roleId: input.roleId,
    status: statusToRoleStatus(status.state),
    sessionId: input.sessionId,
    subagentRunId: status.runId,
    subagentAsyncDir: asyncDir,
    modelId: modelStep?.model,
    startedAt: iso(status.startedAt),
    completedAt: iso(status.endedAt),
    usage,
    inputArtifactRefs: input.inputArtifactRefs ?? [],
    outputArtifactRefs: outputRefs,
    contextManifestRef: input.contextManifestRef,
    contextManifest: input.contextManifest,
    summary: status.error ? `Subagent ${status.runId} ${status.state}: ${status.error}` : `Subagent ${status.runId} is ${status.state}.`,
    transcriptRef: input.transcriptRef ?? status.sessionFile ?? `subagent:${status.runId}`,
  };
  return { rolePass, status, asyncDir };
}
