import { createHash } from "node:crypto";
import { appendQualityDecisionLedgerOnce, readQualityDecisionLedger } from "./quality_decision_ledger.js";

export interface DeliveryRiskWaiver {
  schemaVersion: 1;
  id: string;
  batchId: string;
  segmentId: string;
  code: string;
  reason: string;
  acceptedBy?: string;
  acceptedAt: string;
}

export interface DeliveryRiskWaiverInput {
  batchId: string;
  segmentId: string;
  code: string;
  reason: string;
  acceptedBy?: string;
}

function waiverId(input: Pick<DeliveryRiskWaiverInput, "batchId" | "segmentId" | "code">): string {
  return `${input.batchId}:${input.segmentId}:${input.code}`;
}

export function deliveryRiskFindingId(code: string, segmentId?: string): string {
  return `team-delivery:delivery_check:${code}:${segmentId ?? "batch"}`;
}

export async function readDeliveryRiskWaivers(workspaceRoot: string, projectId: string): Promise<DeliveryRiskWaiver[]> {
  const waivers = new Map<string, DeliveryRiskWaiver>();
  for (const event of await readQualityDecisionLedger(workspaceRoot, projectId)) {
    if (event.kind !== "delivery_waiver" || event.decision !== "accepted_risk" ||
        !event.batchId || !event.segmentId || !event.code || !event.reason) continue;
    const id = waiverId({ batchId: event.batchId, segmentId: event.segmentId, code: event.code });
    waivers.set(id, {
      schemaVersion: 1,
      id,
      batchId: event.batchId,
      segmentId: event.segmentId,
      code: event.code,
      reason: event.reason,
      acceptedBy: event.actor,
      acceptedAt: event.recordedAt ?? "",
    });
  }
  return [...waivers.values()];
}

export async function upsertDeliveryRiskWaiver(
  workspaceRoot: string,
  projectId: string,
  input: DeliveryRiskWaiverInput,
): Promise<DeliveryRiskWaiver[]> {
  if (!input.reason.trim()) {
    throw new Error("delivery risk waiver requires a reason.");
  }
  const reason = input.reason.trim();
  const logicalEventId = `delivery-waiver:${createHash("sha256").update(JSON.stringify({ projectId, ...input, reason })).digest("hex")}`;
  await appendQualityDecisionLedgerOnce(workspaceRoot, [{
    projectId,
    batchId: input.batchId,
    segmentId: input.segmentId,
    findingId: deliveryRiskFindingId(input.code, input.segmentId),
    code: input.code,
    kind: "delivery_waiver",
    decision: "accepted_risk",
    reason,
    actor: input.acceptedBy,
    logicalEventId,
  }]);
  return readDeliveryRiskWaivers(workspaceRoot, projectId);
}
