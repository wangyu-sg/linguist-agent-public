import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type QualityDecisionLedgerKind =
  | "quality_finding"
  | "quality_waiver"
  | "delivery_finding"
  | "delivery_waiver"
  | "team_finding"
  | "team_decision"
  | "export_authorization";

export type QualityDecisionLedgerDecision =
  | "open"
  | "ignore_with_reason"
  | "accepted_risk"
  | "authorized"
  | "blocked"
  | "accept"
  | "reject"
  | "query"
  | "fix_required";

export type QualityDecisionLedgerSeverity =
  | "blocker"
  | "major"
  | "minor"
  | "warning"
  | "advisory"
  | "info";

export interface QualityDecisionLedgerInput {
  projectId: string;
  batchId?: string;
  workflowId?: string;
  segmentId?: string;
  findingId?: string;
  code?: string;
  severity?: QualityDecisionLedgerSeverity;
  kind: QualityDecisionLedgerKind;
  decision: QualityDecisionLedgerDecision;
  reason?: string;
  evidenceRefs?: string[];
  actor?: string;
  recordedAt?: string;
  /** Stable identity supplied by a source adapter for replay-safe appends. */
  logicalEventId?: string;
}

export interface QualityDecisionLedgerEvent extends QualityDecisionLedgerInput {
  schemaVersion: 1;
  sequence: number;
  previousHash?: string;
  hash: string;
}

export interface QualityDecisionLedgerSummary {
  acceptedRisks: number;
  exportAuthorizations: number;
  openFindings: number;
  blockedExports: number;
  totalEvents: number;
}

function safeProjectId(projectId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId)) throw new Error("quality decision ledger requires a safe projectId.");
  return projectId;
}

export function qualityDecisionLedgerPath(workspaceRoot: string, projectId: string): string {
  return join(resolve(workspaceRoot), "data", "projects", safeProjectId(projectId), "quality_decision_ledger.jsonl");
}

function hashEvent(event: Omit<QualityDecisionLedgerEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

export async function readQualityDecisionLedger(workspaceRoot: string, projectId: string): Promise<QualityDecisionLedgerEvent[]> {
  const path = qualityDecisionLedgerPath(workspaceRoot, projectId);
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: QualityDecisionLedgerEvent[] = [];
  for (const [index, line] of raw.split(/\r?\n/).filter(Boolean).entries()) {
    const row = JSON.parse(line) as QualityDecisionLedgerEvent;
    if (row.schemaVersion !== 1 || row.sequence !== index + 1) throw new Error(`quality decision ledger sequence is invalid at line ${index + 1}.`);
    if (index > 0 && !row.previousHash) throw new Error("quality decision ledger hash chain is broken.");
    if (index === 0 && row.previousHash) throw new Error("quality decision ledger first event has an unexpected previous hash.");
    if (index > 0 && row.previousHash !== rows[index - 1]?.hash) throw new Error("quality decision ledger hash chain is broken.");
    const { hash: actualHash, ...withoutHash } = row;
    if (!actualHash || actualHash !== hashEvent(withoutHash)) throw new Error("quality decision ledger hash is invalid.");
    rows.push(row);
  }
  return rows;
}

const appendQueues = new Map<string, Promise<void>>();

export interface QualityDecisionLedgerAppendResult {
  events: QualityDecisionLedgerEvent[];
  appended: number;
  skipped: number;
}

function validateLedgerInput(input: QualityDecisionLedgerInput): void {
  if (["quality_waiver", "delivery_waiver"].includes(input.kind) && !input.reason?.trim()) {
    throw new Error("quality decision ledger waiver requires a reason.");
  }
  if (input.logicalEventId !== undefined && (!input.logicalEventId.trim() || input.logicalEventId.length > 1024 || /[\r\n]/.test(input.logicalEventId))) {
    throw new Error("quality decision ledger logicalEventId is invalid.");
  }
}

function comparableLogicalEvent(input: QualityDecisionLedgerInput): string {
  return JSON.stringify({
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    segmentId: input.segmentId,
    findingId: input.findingId,
    code: input.code,
    severity: input.severity,
    kind: input.kind,
    decision: input.decision,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs ? [...new Set(input.evidenceRefs)].sort() : undefined,
    actor: input.actor,
    logicalEventId: input.logicalEventId,
  });
}

const FINDING_KINDS = new Set<QualityDecisionLedgerKind>(["quality_finding", "delivery_finding", "team_finding"]);

function assertFindingScopes(
  existing: readonly QualityDecisionLedgerInput[],
  inputs: readonly QualityDecisionLedgerInput[],
): void {
  const scopes = new Map<string, { kind: QualityDecisionLedgerKind; segmentId?: string }>();
  for (const event of [...existing, ...inputs]) {
    if (event.decision !== "open" || !event.findingId || !FINDING_KINDS.has(event.kind)) continue;
    const key = JSON.stringify([event.batchId, event.workflowId, event.findingId]);
    const prior = scopes.get(key);
    if (prior && (prior.kind !== event.kind || prior.segmentId !== event.segmentId)) {
      throw new Error(`quality decision ledger finding ${event.findingId} has conflicting source or segment scope.`);
    }
    scopes.set(key, { kind: event.kind, segmentId: event.segmentId });
  }
}

async function appendQualityDecisionLedgerInputs(
  workspaceRoot: string,
  inputs: readonly QualityDecisionLedgerInput[],
  requireLogicalEventId: boolean,
): Promise<QualityDecisionLedgerAppendResult> {
  if (!inputs.length) return { events: [], appended: 0, skipped: 0 };
  const projectId = inputs[0]!.projectId;
  if (inputs.some((input) => input.projectId !== projectId)) throw new Error("quality decision ledger batch requires one projectId.");
  const path = qualityDecisionLedgerPath(workspaceRoot, projectId);
  for (const input of inputs) {
    validateLedgerInput(input);
    if (requireLogicalEventId && !input.logicalEventId) throw new Error("quality decision ledger idempotent append requires logicalEventId.");
  }
  let result!: QualityDecisionLedgerAppendResult;
  const previous = appendQueues.get(path) ?? Promise.resolve();
  const next = previous.then(async () => {
    const existing = await readQualityDecisionLedger(workspaceRoot, projectId);
    assertFindingScopes(existing, inputs);
    const byLogicalEventId = new Map(existing.flatMap((event) => event.logicalEventId ? [[event.logicalEventId, event] as const] : []));
    const events: QualityDecisionLedgerEvent[] = [];
    const appended: QualityDecisionLedgerEvent[] = [];
    for (const input of inputs) {
      const prior = input.logicalEventId ? byLogicalEventId.get(input.logicalEventId) : undefined;
      if (prior) {
        if (comparableLogicalEvent(prior) !== comparableLogicalEvent(input)) {
          throw new Error(`quality decision ledger logical event ${input.logicalEventId} conflicts with its recorded payload.`);
        }
        events.push(prior);
        continue;
      }
      const last = appended.at(-1) ?? existing.at(-1);
      const withoutHash: Omit<QualityDecisionLedgerEvent, "hash"> = {
        ...input,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        schemaVersion: 1,
        sequence: existing.length + appended.length + 1,
        ...(last?.hash ? { previousHash: last.hash } : {}),
      };
      const event = { ...withoutHash, hash: hashEvent(withoutHash) };
      appended.push(event);
      events.push(event);
      if (input.logicalEventId) byLogicalEventId.set(input.logicalEventId, event);
    }
    if (appended.length) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${appended.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    }
    result = { events, appended: appended.length, skipped: events.length - appended.length };
  });
  appendQueues.set(path, next.catch(() => undefined));
  await next;
  return result;
}

export async function appendQualityDecisionLedger(workspaceRoot: string, input: QualityDecisionLedgerInput): Promise<QualityDecisionLedgerEvent> {
  return (await appendQualityDecisionLedgerInputs(workspaceRoot, [input], false)).events[0]!;
}

/** Append a same-project event batch once, atomically checking replay keys under the ledger write queue. */
export async function appendQualityDecisionLedgerOnce(
  workspaceRoot: string,
  inputs: readonly (QualityDecisionLedgerInput & { logicalEventId: string })[],
): Promise<QualityDecisionLedgerAppendResult> {
  return appendQualityDecisionLedgerInputs(workspaceRoot, inputs, true);
}

export function summarizeQualityDecisionLedger(events: QualityDecisionLedgerEvent[]): QualityDecisionLedgerSummary {
  const latestByFinding = new Map<string, QualityDecisionLedgerEvent>();
  for (const event of events) if (event.findingId) latestByFinding.set(event.findingId, event);
  return {
    acceptedRisks: events.filter((event) => event.decision === "ignore_with_reason" || event.decision === "accepted_risk").length,
    exportAuthorizations: events.filter((event) => event.kind === "export_authorization" && event.decision === "authorized").length,
    openFindings: [...latestByFinding.values()].filter((event) => event.decision === "open").length,
    blockedExports: events.filter((event) => event.kind === "export_authorization" && event.decision === "blocked").length,
    totalEvents: events.length,
  };
}

export async function authorizeQualityLedgerExport(
  workspaceRoot: string,
  input: { projectId: string; batchId?: string; workflowId?: string; blockerFindingIds?: string[]; unreviewedFindingIds?: string[]; reason?: string },
): Promise<{ authorized: boolean; blockers: string[]; unreviewedFindingIds: string[]; waivedFindingIds: string[] }> {
  const events = await readQualityDecisionLedger(workspaceRoot, input.projectId);
  const scoped = events.filter((event) => event.batchId === input.batchId && (!input.workflowId || !event.workflowId || event.workflowId === input.workflowId));
  const findingKey = (event: Pick<QualityDecisionLedgerEvent, "workflowId" | "findingId">) => `${event.workflowId ?? ""}\u0000${event.findingId ?? ""}`;
  const unresolved = new Map<string, QualityDecisionLedgerEvent>();
  const recordedFindingIds = new Set<string>();
  const waived = new Set<string>();
  for (const event of scoped) {
    if (event.findingId && FINDING_KINDS.has(event.kind) && event.decision === "open") {
      recordedFindingIds.add(event.findingId);
      unresolved.set(findingKey(event), event);
      continue;
    }
    const resolvesFinding = event.findingId && (
      (event.kind.endsWith("waiver") && ["accepted_risk", "ignore_with_reason"].includes(event.decision)) ||
      (event.kind === "team_decision" && event.actor === "user" && ["accept", "accepted_risk", "ignore_with_reason"].includes(event.decision))
    );
    if (!resolvesFinding) continue;
    if (event.kind.endsWith("waiver")) waived.add(event.findingId!);
    if (event.workflowId) {
      unresolved.delete(findingKey(event));
    } else {
      for (const [key, finding] of unresolved) if (finding.findingId === event.findingId) unresolved.delete(key);
    }
  }
  const canonicalIds = (ids: readonly string[]) => [...new Set(ids)].sort();
  const unresolvedEvents = [...unresolved.values()];
  const unresolvedIds = new Set(unresolvedEvents.map((event) => event.findingId!));
  // Deterministic QA callers supply their current finding set because a later
  // clean run supersedes older open events. Team findings remain reviewable
  // until an explicit user decision, so they are always derived from ledger.
  const durableTeamFindings = unresolvedEvents.filter((event) => event.kind === "team_finding");
  const blockers = canonicalIds([
    ...(input.blockerFindingIds ?? []).filter((id) => !waived.has(id) && (!recordedFindingIds.has(id) || unresolvedIds.has(id))),
    ...durableTeamFindings.filter((event) => event.severity === "blocker").map((event) => event.findingId!),
  ]);
  const unreviewedFindingIds = canonicalIds([
    ...(input.unreviewedFindingIds ?? []).filter((id) => !waived.has(id) && (!recordedFindingIds.has(id) || unresolvedIds.has(id))),
    ...durableTeamFindings.map((event) => event.findingId!),
  ]);
  const waivedFindingIds = canonicalIds([...waived]);
  const authorized = blockers.length === 0 && unreviewedFindingIds.length === 0;
  const reason = input.reason ?? (authorized ? "All scoped findings are reviewed or waived." : "Open blocker or unreviewed finding remains.");
  const state = {
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    authorized,
    blockers,
    unreviewedFindingIds,
    waivedFindingIds,
    reason,
  };
  const logicalEventId = `export-authorization:${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
  await appendQualityDecisionLedgerOnce(workspaceRoot, [{
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    kind: "export_authorization",
    decision: authorized ? "authorized" : "blocked",
    reason,
    evidenceRefs: [
      ...blockers.map((id) => `blocker:${id}`),
      ...unreviewedFindingIds.map((id) => `unreviewed:${id}`),
      ...waivedFindingIds.map((id) => `waived:${id}`),
    ],
    actor: "deterministic_export_gate",
    logicalEventId,
  }]);
  return { authorized, blockers, unreviewedFindingIds, waivedFindingIds };
}
