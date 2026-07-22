import { createHash } from "node:crypto";
import { appendQualityDecisionLedgerOnce, readQualityDecisionLedger } from "./quality_decision_ledger.js";

export interface QualityFindingWaiver {
  schemaVersion: 1;
  id: string;
  batchId: string;
  segmentId: string;
  findingId: string;
  code: string;
  reason: string;
  acceptedBy?: string;
  acceptedAt: string;
}

export interface QualityFindingWaiverInput {
  batchId: string;
  segmentId: string;
  findingId: string;
  code: string;
  reason: string;
  acceptedBy?: string;
}

function waiverId(input: Pick<QualityFindingWaiverInput, "batchId" | "findingId">): string {
  return `${input.batchId}:${input.findingId}`;
}

export async function readQualityFindingWaivers(workspaceRoot: string, projectId: string): Promise<QualityFindingWaiver[]> {
  const waivers = new Map<string, QualityFindingWaiver>();
  for (const event of await readQualityDecisionLedger(workspaceRoot, projectId)) {
    if (event.kind !== "quality_waiver" || event.decision !== "ignore_with_reason" ||
        !event.batchId || !event.segmentId || !event.findingId || !event.code || !event.reason) continue;
    const id = waiverId({ batchId: event.batchId, findingId: event.findingId });
    waivers.set(id, {
      schemaVersion: 1,
      id,
      batchId: event.batchId,
      segmentId: event.segmentId,
      findingId: event.findingId,
      code: event.code,
      reason: event.reason,
      acceptedBy: event.actor,
      acceptedAt: event.recordedAt ?? "",
    });
  }
  return [...waivers.values()];
}

export async function upsertQualityFindingWaiver(
  workspaceRoot: string,
  projectId: string,
  input: QualityFindingWaiverInput,
): Promise<QualityFindingWaiver[]> {
  if (!input.reason.trim()) {
    throw new Error("quality finding waiver requires a reason.");
  }
  const reason = input.reason.trim();
  const logicalEventId = `quality-waiver:${createHash("sha256").update(JSON.stringify({ projectId, ...input, reason })).digest("hex")}`;
  await appendQualityDecisionLedgerOnce(workspaceRoot, [{
    projectId,
    batchId: input.batchId,
    segmentId: input.segmentId,
    findingId: input.findingId,
    code: input.code,
    kind: "quality_waiver",
    decision: "ignore_with_reason",
    reason,
    actor: input.acceptedBy,
    logicalEventId,
  }]);
  return readQualityFindingWaivers(workspaceRoot, projectId);
}
