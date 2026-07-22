import { createHash } from "node:crypto";
import type { DeliveryQaFinding } from "./delivery_qa.js";
import {
  appendQualityDecisionLedgerOnce,
  readQualityDecisionLedger,
  type QualityDecisionLedgerAppendResult,
  type QualityDecisionLedgerInput,
} from "./quality_decision_ledger.js";
import type { TeamDecision, TeamRoleFinding } from "./team_workflow.js";

export interface TeamQualityDecisionLedgerInput {
  projectId: string;
  batchId: string;
  workflowId: string;
  teamFindings?: readonly TeamRoleFinding[];
  deliveryQaFindings?: readonly DeliveryQaFinding[];
  decisions?: readonly TeamDecision[];
}

interface FindingScope {
  segmentId?: string;
  kind: "quality_finding" | "delivery_finding" | "team_finding";
}

function logicalEventId(kind: string, ...identity: string[]): string {
  return `${kind}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function requireScope(input: TeamQualityDecisionLedgerInput): void {
  if (!input.projectId.trim() || !input.batchId.trim() || !input.workflowId.trim()) {
    throw new Error("Team quality ledger requires projectId, batchId, and workflowId.");
  }
}

function addFindingScope(scopes: Map<string, FindingScope>, findingId: string, scope: FindingScope): void {
  const existing = scopes.get(findingId);
  if (existing && (existing.segmentId !== scope.segmentId || existing.kind !== scope.kind)) {
    throw new Error(`Team quality finding ${findingId} has conflicting source or segment scope.`);
  }
  scopes.set(findingId, scope);
}

/**
 * Project Team findings and human/Team decisions into the append-only quality
 * ledger. workflow_artifacts.json remains a compatibility projection; this
 * module owns replay identity, scope checks, and concurrent append safety.
 */
export async function syncTeamQualityDecisionLedger(
  workspaceRoot: string,
  input: TeamQualityDecisionLedgerInput,
): Promise<QualityDecisionLedgerAppendResult> {
  requireScope(input);
  const recordedAt = new Date().toISOString();
  const existing = await readQualityDecisionLedger(workspaceRoot, input.projectId);
  const findingScopes = new Map<string, FindingScope>();
  for (const event of existing) {
    if (
      event.batchId === input.batchId &&
      event.workflowId === input.workflowId &&
      event.findingId &&
      event.decision === "open" &&
      ["quality_finding", "delivery_finding", "team_finding"].includes(event.kind)
    ) {
      addFindingScope(findingScopes, event.findingId, { segmentId: event.segmentId, kind: event.kind as FindingScope["kind"] });
    }
  }

  const events: Array<QualityDecisionLedgerInput & { logicalEventId: string }> = [];
  for (const finding of input.teamFindings ?? []) {
    if (finding.workflowId && finding.workflowId !== input.workflowId) {
      throw new Error(`Team finding ${finding.id} belongs to workflow ${finding.workflowId}, not ${input.workflowId}.`);
    }
    addFindingScope(findingScopes, finding.id, { segmentId: finding.segmentId, kind: "team_finding" });
    events.push({
      projectId: input.projectId,
      batchId: input.batchId,
      workflowId: input.workflowId,
      segmentId: finding.segmentId,
      findingId: finding.id,
      code: finding.type,
      severity: finding.severity,
      kind: "team_finding",
      decision: "open",
      reason: finding.message,
      evidenceRefs: finding.evidenceRefs,
      actor: finding.roleId,
      recordedAt,
      logicalEventId: logicalEventId("team-finding", input.projectId, input.batchId, input.workflowId, finding.id),
    });
  }
  for (const finding of input.deliveryQaFindings ?? []) {
    addFindingScope(findingScopes, finding.id, { segmentId: finding.segmentId, kind: "delivery_finding" });
    events.push({
      projectId: input.projectId,
      batchId: input.batchId,
      workflowId: input.workflowId,
      segmentId: finding.segmentId,
      findingId: finding.id,
      code: finding.type,
      severity: finding.severity,
      kind: "delivery_finding",
      decision: "open",
      reason: finding.message,
      evidenceRefs: finding.evidence,
      actor: "deterministic_delivery_qa",
      recordedAt,
      logicalEventId: logicalEventId("delivery-finding", input.projectId, input.batchId, input.workflowId, finding.id),
    });
  }

  for (const decision of input.decisions ?? []) {
    if (decision.workflowId !== input.workflowId) {
      throw new Error(`Team decision ${decision.id} belongs to workflow ${decision.workflowId}, not ${input.workflowId}.`);
    }
    if (!decision.reason.trim()) throw new Error(`Team decision ${decision.id} requires a reason.`);
    const findingIds = [...new Set(decision.findingIds)];
    for (const findingId of findingIds.length ? findingIds : [undefined]) {
      const findingScope = findingId ? findingScopes.get(findingId) : undefined;
      if (findingId && !findingScope) {
        throw new Error(`Team decision ${decision.id} references finding ${findingId} outside ${input.batchId}/${input.workflowId}.`);
      }
      if (findingId && decision.segmentId && findingScope?.segmentId && decision.segmentId !== findingScope.segmentId) {
        throw new Error(`Team decision ${decision.id} segment scope does not match finding ${findingId}.`);
      }
      const segmentId = findingId ? findingScope?.segmentId ?? decision.segmentId : decision.segmentId;
      events.push({
        projectId: input.projectId,
        batchId: input.batchId,
        workflowId: input.workflowId,
        segmentId,
        findingId,
        kind: "team_decision",
        decision: decision.decision,
        reason: decision.reason,
        evidenceRefs: decision.evidenceRefs,
        actor: decision.decidedBy,
        recordedAt,
        logicalEventId: logicalEventId(
          "team-decision",
          input.projectId,
          input.batchId,
          input.workflowId,
          decision.id,
          findingId ?? "unscoped",
        ),
      });
    }
  }
  return appendQualityDecisionLedgerOnce(workspaceRoot, events);
}
