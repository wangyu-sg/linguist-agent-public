import { createHash } from "node:crypto";
import {
  TASK_DECISION_BINDING_SCHEMA_VERSION,
  type TaskDecision,
} from "@linguist-agent/cat-data";

/** Temporary server policy; make configurable only with a versioned contract. */
export const TASK_DECISION_BINDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type TaskDecisionBindingIssue = "missing" | "schema_mismatch" | "content_mismatch" | "plan_mismatch" | "expired";

function decisionContent(decision: TaskDecision): Record<string, unknown> {
  return {
    id: decision.id,
    taskId: decision.taskId,
    runId: decision.runId,
    requestedByThreadId: decision.requestedByThreadId,
    requestProvenance: decision.requestProvenance ? { ...decision.requestProvenance } : null,
    artifactId: decision.artifactId ?? null,
    kind: decision.kind,
    prompt: decision.prompt,
    options: decision.options.map((option) => ({
      id: option.id,
      label: option.label,
      action: option.action,
      destructive: option.destructive,
      description: option.description ?? null,
      preview: option.preview ?? null,
    })),
    interactionId: decision.interactionId ?? null,
    questionIndex: decision.questionIndex ?? null,
    selectionMode: decision.selectionMode ?? null,
    scope: decision.scope,
    createdAt: decision.createdAt,
  };
}

function contentHash(decision: TaskDecision): string {
  return createHash("sha256").update(JSON.stringify(decisionContent(decision))).digest("hex");
}

function planHash(decision: TaskDecision, decisionContentHash: string, runPlanHash: string | null | undefined): string {
  return runPlanHash ?? createHash("sha256")
    .update(JSON.stringify({ taskId: decision.taskId, runId: decision.runId, contentHash: decisionContentHash }))
    .digest("hex");
}

/** Server callers create this once; clients only receive and display it. */
export function bindTaskDecision(
  decision: TaskDecision,
  options: { runPlanHash?: string | null; expiresAt?: string },
): TaskDecision {
  const decisionContentHash = contentHash(decision);
  return {
    ...decision,
    decisionBinding: {
      schemaVersion: TASK_DECISION_BINDING_SCHEMA_VERSION,
      contentHash: decisionContentHash,
      planHash: planHash(decision, decisionContentHash, options.runPlanHash),
      expiresAt: options.expiresAt ?? new Date(Date.parse(decision.createdAt) + TASK_DECISION_BINDING_TTL_MS).toISOString(),
    },
  };
}

/** Return the first fail-closed reason; callers map it to their transport error. */
export function taskDecisionBindingIssue(
  decision: TaskDecision,
  options: { runPlanHash?: string | null; now: Date },
): TaskDecisionBindingIssue | null {
  const binding = decision.decisionBinding;
  if (!binding) return "missing";
  if (binding.schemaVersion !== TASK_DECISION_BINDING_SCHEMA_VERSION) return "schema_mismatch";
  const decisionContentHash = contentHash(decision);
  if (binding.contentHash !== decisionContentHash) return "content_mismatch";
  if (binding.planHash !== planHash(decision, decisionContentHash, options.runPlanHash)) return "plan_mismatch";
  return options.now.getTime() >= Date.parse(binding.expiresAt) ? "expired" : null;
}
