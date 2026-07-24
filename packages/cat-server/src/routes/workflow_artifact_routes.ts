import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createCapturedPhraseQaAdapter,
  createObservedPhraseAdapter,
  readWorkflowArtifacts,
  runPhraseQaWorkflow,
  runPlatformBackfillWorkflow,
  upsertBrowserAutomationCheckpoint,
  upsertPhraseQaRow,
  upsertPlatformBackfillRow,
  upsertWorkflowAuthorityEvidence,
  type PhraseQaCapture,
  type PhraseQaRawIssue,
  type PlatformBackfillPlanRow,
} from "@linguist-agent/cat-data";

export interface WorkflowArtifactRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  optionalStringArray: (value: unknown) => string[] | undefined;
  optionalBoolean: (value: unknown) => boolean | undefined;
  optionalNumber: (value: unknown) => number | undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
    throw new Error("Expected a record of string values.");
  }
  return Object.fromEntries(entries);
}

function phraseBackfillPlanRows(value: unknown, deps: Pick<WorkflowArtifactRouteDeps, "requireString" | "optionalString" | "optionalStringArray">): PlatformBackfillPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`rows[${index}] must be an object.`);
    const input = row as Record<string, unknown>;
    return {
      id: deps.optionalString(input.id),
      batchId: deps.requireString(input.batchId, `rows[${index}].batchId`),
      segmentId: deps.requireString(input.segmentId, `rows[${index}].segmentId`),
      target: deps.requireString(input.target, `rows[${index}].target`),
      expectedCurrentTarget: deps.optionalString(input.expectedCurrentTarget),
      evidence: deps.optionalString(input.evidence),
      acceptedRiskCodes: deps.optionalStringArray(input.acceptedRiskCodes),
    };
  });
}

function phraseQaCaptures(value: unknown, deps: Pick<WorkflowArtifactRouteDeps, "requireString" | "optionalString" | "optionalBoolean">): PhraseQaCapture[] {
  if (!Array.isArray(value)) return [];
  return value.map((capture, captureIndex) => {
    if (!capture || typeof capture !== "object") throw new Error(`captures[${captureIndex}] must be an object.`);
    const input = capture as Record<string, unknown>;
    const rowsInput = Array.isArray(input.rows) ? input.rows : [];
    const rows: PhraseQaRawIssue[] = rowsInput.map((row, rowIndex) => {
      if (!row || typeof row !== "object") throw new Error(`captures[${captureIndex}].rows[${rowIndex}] must be an object.`);
      const qa = row as Record<string, unknown>;
      return {
        id: deps.optionalString(qa.id),
        segmentId: deps.requireString(qa.segmentId, `captures[${captureIndex}].rows[${rowIndex}].segmentId`),
        category: deps.optionalString(qa.category),
        message: deps.requireString(qa.message, `captures[${captureIndex}].rows[${rowIndex}].message`),
        evidence: deps.optionalString(qa.evidence),
        decisionHint: deps.optionalString(qa.decisionHint) as PhraseQaRawIssue["decisionHint"],
        finalIgnoreState: deps.optionalString(qa.finalIgnoreState) as PhraseQaRawIssue["finalIgnoreState"],
      };
    });
    return { rows, hasLoadMore: deps.optionalBoolean(input.hasLoadMore) ?? false };
  });
}

export async function handleWorkflowArtifactRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: WorkflowArtifactRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "workflow-artifacts") return false;

  if (parts[4] === "run-backfill" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const adapter = createObservedPhraseAdapter({
      currentTargets: stringRecord(body.currentTargets),
      lockedSegmentIds: deps.optionalStringArray(body.lockedSegmentIds),
      readbackTargets: stringRecord(body.readbackTargets),
    });
    const run = await runPlatformBackfillWorkflow(deps.repoRoot, projectId, phraseBackfillPlanRows(body.rows, deps), adapter, {
      stopOnFailure: deps.optionalBoolean(body.stopOnFailure),
    });
    deps.json(res, 200, { run, artifacts: await readWorkflowArtifacts(deps.repoRoot, projectId) });
    return true;
  }

  if (parts[4] === "run-phrase-qa" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const run = await runPhraseQaWorkflow(deps.repoRoot, projectId, createCapturedPhraseQaAdapter({ captures: phraseQaCaptures(body.captures, deps) }), {
      maxLoadMorePasses: deps.optionalNumber(body.maxLoadMorePasses),
      ignoreFalsePositives: deps.optionalBoolean(body.ignoreFalsePositives),
      ignoreChunkSize: deps.optionalNumber(body.ignoreChunkSize),
    });
    deps.json(res, 200, { run, artifacts: await readWorkflowArtifacts(deps.repoRoot, projectId) });
    return true;
  }

  if (parts[4] === "backfill" && parts[5] && (req.method === "PATCH" || req.method === "POST")) {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await upsertPlatformBackfillRow(deps.repoRoot, projectId, {
      id: decodeURIComponent(parts[5]),
      segmentId: deps.optionalString(body.segmentId),
      batch: deps.optionalString(body.batch),
      state: deps.optionalString(body.state) as any,
      decision: deps.optionalString(body.decision) as any,
      localProposal: deps.optionalString(body.localProposal),
      phraseEvidence: deps.optionalString(body.phraseEvidence),
      readbackState: deps.optionalString(body.readbackState),
    }));
    return true;
  }

  if (parts[4] === "phrase-qa" && parts[5] && (req.method === "PATCH" || req.method === "POST")) {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await upsertPhraseQaRow(deps.repoRoot, projectId, {
      id: decodeURIComponent(parts[5]),
      segmentId: deps.optionalString(body.segmentId),
      category: deps.optionalString(body.category) as any,
      message: deps.optionalString(body.message),
      disposition: deps.optionalString(body.disposition) as any,
      finalIgnoreState: deps.optionalString(body.finalIgnoreState) as any,
      evidence: deps.optionalString(body.evidence),
    }));
    return true;
  }

  if (parts[4] === "authority-evidence" && parts[5] && (req.method === "PATCH" || req.method === "POST")) {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await upsertWorkflowAuthorityEvidence(deps.repoRoot, projectId, {
      id: decodeURIComponent(parts[5]),
      tier: deps.requireString(body.tier, "tier") as any,
      label: deps.requireString(body.label, "label"),
      target: deps.optionalString(body.target),
      source: deps.optionalString(body.source),
      detail: deps.optionalString(body.detail),
      decisionKey: deps.optionalString(body.decisionKey),
      segmentId: deps.optionalString(body.segmentId),
      batch: deps.optionalString(body.batch),
      evidenceSource: deps.optionalString(body.evidenceSource) as any,
      ts: deps.optionalString(body.ts),
    }));
    return true;
  }

  if (parts[4] === "browser-checks" && parts[5] && (req.method === "PATCH" || req.method === "POST")) {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await upsertBrowserAutomationCheckpoint(deps.repoRoot, projectId, {
      id: decodeURIComponent(parts[5]),
      operation: deps.requireString(body.operation, "operation") as any,
      status: deps.requireString(body.status, "status") as any,
      checkpoint: deps.requireString(body.checkpoint, "checkpoint"),
      observedAt: deps.optionalString(body.observedAt),
      currentSegmentId: deps.optionalString(body.currentSegmentId),
      lastVerifiedSegmentId: deps.optionalString(body.lastVerifiedSegmentId),
      currentQaRowCount: typeof body.currentQaRowCount === "number" ? body.currentQaRowCount : undefined,
      previousQaRowCount: typeof body.previousQaRowCount === "number" ? body.previousQaRowCount : undefined,
      hasLoadMore: deps.optionalBoolean(body.hasLoadMore),
      readbackState: deps.optionalString(body.readbackState),
      lastAction: deps.optionalString(body.lastAction),
      error: deps.optionalString(body.error),
    }));
    return true;
  }

  if (req.method === "GET") {
    deps.json(res, 200, await readWorkflowArtifacts(deps.repoRoot, projectId));
    return true;
  }

  return false;
}
