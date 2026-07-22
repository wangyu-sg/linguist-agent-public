import { readBatch } from "./batch_workspace.js";
import type { FormattingSignatureMismatch } from "./format_signatures.js";
import { runQaWriteGate } from "./qa_write_gate.js";
import { readProjectTagRuleContext } from "./tag_rules.js";
import {
  readWorkflowArtifacts,
  upsertBrowserAutomationCheckpoint,
  upsertPhraseQaRow,
  upsertPlatformBackfillRow,
  upsertWorkflowAuthorityEvidence,
  type BrowserAutomationCheckpointStatus,
  type PhraseQaDisposition,
  type PhraseQaFinalIgnoreState,
  type RiskKind,
} from "./workflow_artifacts.js";

export interface PhraseSegmentRead {
  segmentId: string;
  target: string;
  locked?: boolean;
}

export interface PhrasePlatformAdapter {
  openJob?: () => Promise<void>;
  readSegment: (segmentId: string) => Promise<PhraseSegmentRead>;
  writeTarget: (segmentId: string, target: string) => Promise<void>;
  readTarget: (segmentId: string) => Promise<string>;
  runQa?: () => Promise<void>;
  captureQa?: () => Promise<PhraseQaCapture>;
  loadMoreQa?: () => Promise<PhraseQaCapture>;
  ignoreQaIssue?: (rowId: string) => Promise<void>;
}

export interface PlatformBackfillPlanRow {
  id?: string;
  batchId: string;
  segmentId: string;
  target: string;
  expectedCurrentTarget?: string;
  evidence?: string;
  acceptedRiskCodes?: string[];
}

export interface PlatformBackfillRunOptions {
  stopOnFailure?: boolean;
}

export interface PlatformBackfillRunResult {
  projectId: string;
  processed: number;
  verified: number;
  skipped: number;
  blocked: number;
  stopped: boolean;
}

export interface PlatformWriteGateResult {
  ok: boolean;
  blockers: FormattingSignatureMismatch[];
}

export interface PhraseQaRawIssue {
  id?: string;
  segmentId: string;
  category?: string;
  message: string;
  evidence?: string;
  decisionHint?: PhraseQaDisposition;
  finalIgnoreState?: PhraseQaFinalIgnoreState;
}

export interface PhraseQaCapture {
  rows: PhraseQaRawIssue[];
  hasLoadMore: boolean;
}

export interface PhraseQaRunOptions {
  maxLoadMorePasses?: number;
  ignoreFalsePositives?: boolean;
  ignoreChunkSize?: number;
}

export interface PhraseQaRunResult {
  projectId: string;
  capturedRows: number;
  ignoredRows: number;
  hasLoadMore: boolean;
  blocked: boolean;
}

export interface ObservedPhraseAdapterInput {
  currentTargets: Record<string, string>;
  lockedSegmentIds?: string[];
  readbackTargets?: Record<string, string>;
}

export interface CapturedPhraseQaAdapterInput {
  captures: PhraseQaCapture[];
}

function now(): string {
  return new Date().toISOString();
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function createObservedPhraseAdapter(input: ObservedPhraseAdapterInput): PhrasePlatformAdapter {
  const targets = new Map(Object.entries(input.currentTargets));
  const readbacks = new Map(Object.entries(input.readbackTargets ?? {}));
  const locked = new Set(input.lockedSegmentIds ?? []);
  return {
    async readSegment(segmentId) {
      return { segmentId, target: targets.get(segmentId) ?? "", locked: locked.has(segmentId) };
    },
    async writeTarget(segmentId, target) {
      targets.set(segmentId, target);
    },
    async readTarget(segmentId) {
      return readbacks.get(segmentId) ?? targets.get(segmentId) ?? "";
    },
  };
}

export function createCapturedPhraseQaAdapter(input: CapturedPhraseQaAdapterInput): Pick<PhrasePlatformAdapter, "runQa" | "captureQa" | "loadMoreQa" | "ignoreQaIssue"> {
  let index = 0;
  const captures = input.captures.length ? input.captures : [{ rows: [], hasLoadMore: false }];
  return {
    async runQa() {
      index = 0;
    },
    async captureQa() {
      return captures[index] ?? captures[captures.length - 1];
    },
    async loadMoreQa() {
      index = Math.min(index + 1, captures.length - 1);
      return captures[index];
    },
    async ignoreQaIssue() {
      return;
    },
  };
}

function checkpointId(prefix: string, segmentId: string, suffix: string): string {
  return `${prefix}:${segmentId}:${suffix}`.replace(/\s+/g, "_");
}

export async function runPlatformWriteGate(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  segmentId: string,
  target: string,
  acceptedRiskCodes: string[] = [],
): Promise<PlatformWriteGateResult> {
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  const segment = batch.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new Error(`Segment ${segmentId} not found in batch ${batchId}.`);
  if (segment.locked) {
    return {
      ok: false,
      blockers: [{
        kind: "native_tag",
        code: "LOCKED_SEGMENT_PLATFORM_WRITE",
        source: ["locked"],
        target: ["write_requested"],
      }],
    };
  }
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, projectId);
  const gate = runQaWriteGate(segment, target, ruleContext, acceptedRiskCodes);
  return { ok: gate.ok, blockers: gate.blockers };
}

async function writeCheckpoint(
  workspaceRoot: string,
  projectId: string,
  input: {
    id: string;
    operation: "backfill" | "readback" | "qa_run" | "qa_load_more" | "qa_ignore" | "reconnect";
    status: BrowserAutomationCheckpointStatus;
    checkpoint: string;
    currentSegmentId?: string;
    lastVerifiedSegmentId?: string;
    currentQaRowCount?: number;
    previousQaRowCount?: number;
    hasLoadMore?: boolean;
    readbackState?: string;
    lastAction?: string;
    error?: string;
  },
): Promise<void> {
  await upsertBrowserAutomationCheckpoint(workspaceRoot, projectId, {
    observedAt: now(),
    ...input,
  });
}

export async function runPlatformBackfillWorkflow(
  workspaceRoot: string,
  projectId: string,
  rows: PlatformBackfillPlanRow[],
  adapter: PhrasePlatformAdapter,
  options: PlatformBackfillRunOptions = {},
): Promise<PlatformBackfillRunResult> {
  const stopOnFailure = options.stopOnFailure !== false;
  let processed = 0;
  let verified = 0;
  let skipped = 0;
  let blocked = 0;
  let stopped = false;

  if (adapter.openJob) await adapter.openJob();

  for (const row of rows) {
    const id = row.id ?? `bf:${row.batchId}:${row.segmentId}`;
    processed += 1;
    await upsertPlatformBackfillRow(workspaceRoot, projectId, {
      id,
      segmentId: row.segmentId,
      batch: row.batchId,
      state: "opened",
      decision: "uncertain",
      localProposal: row.target,
      phraseEvidence: row.evidence ?? "Phrase backfill runner opened row; no platform evidence recorded yet.",
      readbackState: "opened",
    });
    await writeCheckpoint(workspaceRoot, projectId, {
      id: checkpointId("bf", row.segmentId, "opened"),
      operation: "backfill",
      status: "observed",
      checkpoint: "Phrase row opened before reading current target.",
      currentSegmentId: row.segmentId,
      lastAction: "open row",
    });

    const current = await adapter.readSegment(row.segmentId);
    await upsertPlatformBackfillRow(workspaceRoot, projectId, {
      id,
      state: "current_read",
      phraseEvidence: `Current Phrase target: ${current.target}`,
      readbackState: "current target read before write",
    });
    if (current.locked) {
      blocked += 1;
      await upsertPlatformBackfillRow(workspaceRoot, projectId, {
        id,
        state: "blocked",
        decision: "uncertain",
        readbackState: "blocked: Phrase row is locked",
      });
      await writeCheckpoint(workspaceRoot, projectId, {
        id: checkpointId("bf", row.segmentId, "locked"),
        operation: "backfill",
        status: "blocked",
        checkpoint: "Phrase row is locked; runner did not write or confirm.",
        currentSegmentId: row.segmentId,
        readbackState: "locked",
      });
      if (stopOnFailure) {
        stopped = true;
        break;
      }
      continue;
    }
    if (row.expectedCurrentTarget !== undefined && normalize(current.target) !== normalize(row.expectedCurrentTarget)) {
      blocked += 1;
      await upsertPlatformBackfillRow(workspaceRoot, projectId, {
        id,
        state: "current_mismatch",
        decision: "uncertain",
        phraseEvidence: `Expected current Phrase target '${row.expectedCurrentTarget}', observed '${current.target}'.`,
        readbackState: "blocked: current target mismatch before write",
      });
      await writeCheckpoint(workspaceRoot, projectId, {
        id: checkpointId("bf", row.segmentId, "current_mismatch"),
        operation: "backfill",
        status: "blocked",
        checkpoint: "Current target mismatch; runner stopped before overwrite.",
        currentSegmentId: row.segmentId,
        readbackState: current.target,
        error: "current target mismatch",
      });
      if (stopOnFailure) {
        stopped = true;
        break;
      }
      continue;
    }
    if (normalize(current.target) === normalize(row.target)) {
      skipped += 1;
      await upsertPlatformBackfillRow(workspaceRoot, projectId, {
        id,
        state: "skipped_already_matching",
        decision: "skipped",
        phraseEvidence: "Current Phrase target already matches local proposal.",
        readbackState: "already matching; no write or confirm",
      });
      await writeCheckpoint(workspaceRoot, projectId, {
        id: checkpointId("bf", row.segmentId, "already_matching"),
        operation: "readback",
        status: "verified",
        checkpoint: "Readback already matched local proposal; no write was performed.",
        currentSegmentId: row.segmentId,
        lastVerifiedSegmentId: row.segmentId,
        readbackState: current.target,
      });
      continue;
    }

    const gate = await runPlatformWriteGate(workspaceRoot, projectId, row.batchId, row.segmentId, row.target, row.acceptedRiskCodes);
    if (!gate.ok) {
      blocked += 1;
      const codes = gate.blockers.map((item) => item.code).join(", ");
      await upsertPlatformBackfillRow(workspaceRoot, projectId, {
        id,
        state: "blocked",
        decision: "uncertain",
        phraseEvidence: `Formatting/newline gate blocked Phrase write: ${codes}.`,
        readbackState: "blocked: write gate failed",
      });
      await writeCheckpoint(workspaceRoot, projectId, {
        id: checkpointId("bf", row.segmentId, "write_gate"),
        operation: "backfill",
        status: "blocked",
        checkpoint: "Formatting/tag/newline signature mismatch blocked platform write.",
        currentSegmentId: row.segmentId,
        error: codes,
      });
      if (stopOnFailure) {
        stopped = true;
        break;
      }
      continue;
    }

    await upsertPlatformBackfillRow(workspaceRoot, projectId, {
      id,
      state: "write_started",
      readbackState: "writing target; no confirm/save command issued",
    });
    await writeCheckpoint(workspaceRoot, projectId, {
      id: checkpointId("bf", row.segmentId, "write_started"),
      operation: "backfill",
      status: "observed",
      checkpoint: "Target write started. Runner does not use Cmd+S, confirm, or mark-complete.",
      currentSegmentId: row.segmentId,
      lastAction: "writeTarget",
    });
    await adapter.writeTarget(row.segmentId, row.target);
    await upsertPlatformBackfillRow(workspaceRoot, projectId, {
      id,
      state: "write_done",
      readbackState: "target written; reading back immediately",
    });
    const readback = await adapter.readTarget(row.segmentId);
    if (normalize(readback) !== normalize(row.target)) {
      blocked += 1;
      await upsertPlatformBackfillRow(workspaceRoot, projectId, {
        id,
        state: "readback_failed",
        decision: "uncertain",
        phraseEvidence: `Readback did not match local proposal. Observed: ${readback}`,
        readbackState: "failed after write",
      });
      await writeCheckpoint(workspaceRoot, projectId, {
        id: checkpointId("bf", row.segmentId, "readback_failed"),
        operation: "readback",
        status: "failed",
        checkpoint: "Readback mismatch after write; runner stopped before moving on.",
        currentSegmentId: row.segmentId,
        readbackState: readback,
        error: "readback mismatch",
      });
      if (stopOnFailure) {
        stopped = true;
        break;
      }
      continue;
    }

    verified += 1;
    await upsertPlatformBackfillRow(workspaceRoot, projectId, {
      id,
      state: "readback_verified",
      decision: "confirmed",
      phraseEvidence: `Phrase CAT readback matches local proposal: ${readback}`,
      readbackState: "verified after write",
    });
    await upsertWorkflowAuthorityEvidence(workspaceRoot, projectId, {
      id: `phrase-readback:${row.batchId}:${row.segmentId}`,
      decisionKey: row.segmentId,
      segmentId: row.segmentId,
      batch: row.batchId,
      tier: "phrase_final_stage",
      label: "Phrase CAT readback",
      target: readback,
      evidenceSource: "phrase_cat",
      detail: "Platform Backfill runner read target back after write. No confirmation or mark-complete action was performed.",
    });
    await writeCheckpoint(workspaceRoot, projectId, {
      id: checkpointId("bf", row.segmentId, "readback_verified"),
      operation: "readback",
      status: "verified",
      checkpoint: "Readback matched local proposal after write.",
      currentSegmentId: row.segmentId,
      lastVerifiedSegmentId: row.segmentId,
      readbackState: readback,
    });
  }

  return { projectId, processed, verified, skipped, blocked, stopped };
}

function riskCategoryFromQa(raw: PhraseQaRawIssue): RiskKind | "phrase_qa" {
  const value = `${raw.category ?? ""} ${raw.message}`.toLowerCase();
  if (value.includes("tag")) return "tag";
  if (value.includes("placeholder")) return "placeholder";
  if (value.includes("newline") || value.includes("line break") || value.includes("换行")) return "newline";
  if (value.includes("\\n")) return "literal_newline";
  if (value.includes("number") || value.includes("数字")) return "number";
  if (value.includes("term") || value.includes("术语")) return "term_conflict";
  if (value.includes("source=target") || value.includes("source target")) return "source_target_identity";
  if (value.includes("underline")) return "underline";
  if (value.includes("rich text") || value.includes("format")) return "rich_text";
  return "phrase_qa";
}

function classifyQaDisposition(raw: PhraseQaRawIssue): { disposition: PhraseQaDisposition; finalIgnoreState: PhraseQaFinalIgnoreState } {
  if (raw.decisionHint) {
    return {
      disposition: raw.decisionHint,
      finalIgnoreState: raw.finalIgnoreState ?? (raw.decisionHint === "ignored_false_positive" ? "ignored" : raw.decisionHint === "retained_unconfirmed" ? "not_applicable" : "not_ignored"),
    };
  }
  const text = `${raw.category ?? ""} ${raw.message}`.toLowerCase();
  if (text.includes("未确认") || text.includes("unconfirmed")) {
    return { disposition: "retained_unconfirmed", finalIgnoreState: "not_applicable" };
  }
  if (text.includes("false positive") || text.includes("误报")) {
    return { disposition: "ignored_false_positive", finalIgnoreState: "ignored" };
  }
  return { disposition: "unresolved", finalIgnoreState: "not_ignored" };
}

async function persistQaCapture(workspaceRoot: string, projectId: string, rows: PhraseQaRawIssue[]): Promise<void> {
  for (const [index, raw] of rows.entries()) {
    const classification = classifyQaDisposition(raw);
    await upsertPhraseQaRow(workspaceRoot, projectId, {
      id: raw.id ?? `phrase-qa:${raw.segmentId}:${index + 1}`,
      segmentId: raw.segmentId,
      category: riskCategoryFromQa(raw),
      message: raw.message,
      disposition: classification.disposition,
      finalIgnoreState: classification.finalIgnoreState,
      evidence: raw.evidence ?? "Captured from Phrase QA runner.",
    });
  }
}

export async function runPhraseQaWorkflow(
  workspaceRoot: string,
  projectId: string,
  adapter: Pick<PhrasePlatformAdapter, "runQa" | "captureQa" | "loadMoreQa" | "ignoreQaIssue">,
  options: PhraseQaRunOptions = {},
): Promise<PhraseQaRunResult> {
  if (!adapter.runQa || !adapter.captureQa) {
    throw new Error("Phrase QA runner requires runQa and captureQa adapter methods.");
  }
  const maxLoadMorePasses = options.maxLoadMorePasses ?? 20;
  await adapter.runQa();
  let capture = await adapter.captureQa();
  await persistQaCapture(workspaceRoot, projectId, capture.rows);
  await writeCheckpoint(workspaceRoot, projectId, {
    id: "qa:run:initial",
    operation: "qa_run",
    status: "observed",
    checkpoint: "Phrase QA run captured initial rows.",
    currentQaRowCount: capture.rows.length,
    previousQaRowCount: 0,
    hasLoadMore: capture.hasLoadMore,
  });

  let passes = 0;
  while (capture.hasLoadMore && passes < maxLoadMorePasses) {
    passes += 1;
    if (!adapter.loadMoreQa) {
      await writeCheckpoint(workspaceRoot, projectId, {
        id: `qa:load_more:${passes}`,
        operation: "qa_load_more",
        status: "blocked",
        checkpoint: "QA capture reported load-more rows, but no loadMoreQa adapter method is available.",
        previousQaRowCount: capture.rows.length,
        currentQaRowCount: capture.rows.length,
        hasLoadMore: true,
        error: "missing loadMoreQa adapter",
      });
      return { projectId, capturedRows: capture.rows.length, ignoredRows: 0, hasLoadMore: true, blocked: true };
    }
    const previous = capture.rows.length;
    capture = await adapter.loadMoreQa();
    await persistQaCapture(workspaceRoot, projectId, capture.rows);
    await writeCheckpoint(workspaceRoot, projectId, {
      id: `qa:load_more:${passes}`,
      operation: "qa_load_more",
      status: "verified",
      checkpoint: "QA load-more clicked and rows recaptured.",
      previousQaRowCount: previous,
      currentQaRowCount: capture.rows.length,
      hasLoadMore: capture.hasLoadMore,
      lastAction: "loadMoreQa",
    });
  }
  if (capture.hasLoadMore) {
    await writeCheckpoint(workspaceRoot, projectId, {
      id: "qa:load_more:max_passes",
      operation: "qa_load_more",
      status: "blocked",
      checkpoint: "QA load-more coverage did not stabilize before max passes.",
      currentQaRowCount: capture.rows.length,
      hasLoadMore: true,
      error: "max load-more passes reached",
    });
    return { projectId, capturedRows: capture.rows.length, ignoredRows: 0, hasLoadMore: true, blocked: true };
  }

  let ignoredRows = 0;
  if (options.ignoreFalsePositives && adapter.ignoreQaIssue) {
    const current = await readWorkflowArtifacts(workspaceRoot, projectId);
    const rowsToIgnore = current.phraseQaRows.filter((row) => row.disposition === "ignored_false_positive" && row.finalIgnoreState !== "ignored");
    const chunkSize = Math.max(1, options.ignoreChunkSize ?? 10);
    for (let offset = 0; offset < rowsToIgnore.length; offset += chunkSize) {
      const chunk = rowsToIgnore.slice(offset, offset + chunkSize);
      for (const row of chunk) {
        await adapter.ignoreQaIssue(row.id);
        ignoredRows += 1;
        await upsertPhraseQaRow(workspaceRoot, projectId, {
          id: row.id,
          finalIgnoreState: "ignored",
          evidence: `${row.evidence} Phrase QA false positive ignored by runner.`,
        });
      }
      const recapture = await adapter.captureQa();
      await persistQaCapture(workspaceRoot, projectId, recapture.rows);
      await writeCheckpoint(workspaceRoot, projectId, {
        id: `qa:ignore:${offset / chunkSize + 1}`,
        operation: "qa_ignore",
        status: "verified",
        checkpoint: "Reviewed false-positive QA rows ignored in a bounded chunk, then recaptured.",
        previousQaRowCount: capture.rows.length,
        currentQaRowCount: recapture.rows.length,
        hasLoadMore: recapture.hasLoadMore,
        lastAction: "ignoreQaIssue chunk",
      });
      capture = recapture;
    }
  }

  await writeCheckpoint(workspaceRoot, projectId, {
    id: "qa:final",
    operation: "qa_run",
    status: capture.hasLoadMore ? "blocked" : "verified",
    checkpoint: "Phrase QA final coverage captured. 未确认句段 are retained by default, not ignored.",
    currentQaRowCount: capture.rows.length,
    hasLoadMore: capture.hasLoadMore,
  });
  return { projectId, capturedRows: capture.rows.length, ignoredRows, hasLoadMore: capture.hasLoadMore, blocked: capture.hasLoadMore };
}
