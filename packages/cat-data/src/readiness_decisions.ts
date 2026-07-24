import { createWorkspace, readJsonlFile, workspacePath } from "./workspace.js";
import { appendDurableFile } from "./durable_file.js";

export type ReadinessDecisionKind = "accept_warning" | "reopen_warning";

export interface ReadinessDecisionEvent {
  ts: string;
  projectId: string;
  kind: ReadinessDecisionKind;
  warningPattern: string;
  reason: string;
  decidedBy: string;
}

export interface ReadinessDecisionMatch {
  warning: string;
  decision?: ReadinessDecisionEvent;
}

export interface ReadinessDecisionSummary {
  path: string;
  total: number;
  accepted: ReadinessDecisionEvent[];
}

export function readinessDecisionPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "readiness_decisions.jsonl");
}

export async function appendReadinessDecision(
  workspaceRoot: string,
  event: Omit<ReadinessDecisionEvent, "ts">,
): Promise<ReadinessDecisionEvent> {
  const full: ReadinessDecisionEvent = { ts: new Date().toISOString(), ...event };
  const path = readinessDecisionPath(workspaceRoot, event.projectId);
  await appendDurableFile(path, `${JSON.stringify(full)}\n`);
  return full;
}

export async function readReadinessDecisions(workspaceRoot: string, projectId: string): Promise<ReadinessDecisionEvent[]> {
  return readJsonlFile<ReadinessDecisionEvent>(readinessDecisionPath(workspaceRoot, projectId));
}

function matches(pattern: string, warning: string): boolean {
  if (!pattern.trim()) return false;
  if (warning.includes(pattern)) return true;
  try {
    return new RegExp(pattern, "i").test(warning);
  } catch {
    return false;
  }
}

export function matchReadinessDecisions(warnings: string[], decisions: ReadinessDecisionEvent[]): ReadinessDecisionMatch[] {
  const accepted = decisions.filter((decision) => decision.kind === "accept_warning");
  const reopened = decisions.filter((decision) => decision.kind === "reopen_warning");
  return warnings.map((warning) => {
    const lastAccept = accepted.filter((decision) => matches(decision.warningPattern, warning)).at(-1);
    if (!lastAccept) return { warning };
    const lastReopen = reopened.filter((decision) => matches(decision.warningPattern, warning)).at(-1);
    if (lastReopen && lastReopen.ts > lastAccept.ts) return { warning };
    return { warning, decision: lastAccept };
  });
}

export function summarizeReadinessDecisions(
  workspaceRoot: string,
  projectId: string,
  decisions: ReadinessDecisionEvent[],
): ReadinessDecisionSummary {
  return {
    path: readinessDecisionPath(workspaceRoot, projectId),
    total: decisions.length,
    accepted: decisions.filter((decision) => decision.kind === "accept_warning"),
  };
}
