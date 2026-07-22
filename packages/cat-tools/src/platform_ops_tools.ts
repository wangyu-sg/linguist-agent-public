import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  createCapturedPhraseQaAdapter,
  createObservedPhraseAdapter,
  runPhraseQaWorkflow,
  runPlatformBackfillWorkflow,
  type CatWorkspace,
  type PhraseQaDisposition,
  type PhraseQaFinalIgnoreState,
} from "@linguist-agent/cat-data";

const observedTargetSchema = Type.Object({
  segmentId: Type.String({ description: "Phrase segment id / LA batch segment id." }),
  target: Type.String({ description: "Observed Phrase current or readback target text/signature." }),
});

const backfillRowSchema = Type.Object({
  id: Type.Optional(Type.String({ description: "Optional workflow artifact row id." })),
  batchId: Type.String({ description: "Imported LA batch id." }),
  segmentId: Type.String({ description: "Segment id to backfill in Phrase." }),
  target: Type.String({ description: "Local proposal/final target to write to Phrase if gates pass." }),
  expectedCurrentTarget: Type.Optional(Type.String({ description: "Observed current Phrase target expected before writing. Mismatch blocks write." })),
  evidence: Type.Optional(Type.String({ description: "Phrase TM/TB/CAT or local proposal evidence summary." })),
  acceptedRiskCodes: Type.Optional(Type.Array(Type.String(), { description: "Explicitly accepted formatting/newline risk codes for this segment." })),
});

const platformBackfillRunParameters = Type.Object({
  rows: Type.Array(backfillRowSchema, { minItems: 1 }),
  observedCurrentTargets: Type.Array(observedTargetSchema, { minItems: 1 }),
  observedReadbackTargets: Type.Optional(Type.Array(observedTargetSchema)),
  lockedSegmentIds: Type.Optional(Type.Array(Type.String())),
  stopOnFailure: Type.Optional(Type.Boolean({ default: true })),
});

const qaRowSchema = Type.Object({
  id: Type.Optional(Type.String()),
  segmentId: Type.String(),
  category: Type.Optional(Type.String()),
  message: Type.String(),
  evidence: Type.Optional(Type.String()),
  decisionHint: Type.Optional(Type.Union([
    Type.Literal("fixed_true_issue"),
    Type.Literal("ignored_false_positive"),
    Type.Literal("retained_unconfirmed"),
    Type.Literal("retained_true_issue"),
    Type.Literal("unresolved"),
  ])),
  finalIgnoreState: Type.Optional(Type.Union([
    Type.Literal("ignored"),
    Type.Literal("not_ignored"),
    Type.Literal("not_applicable"),
  ])),
});

const qaCaptureSchema = Type.Object({
  rows: Type.Array(qaRowSchema),
  hasLoadMore: Type.Boolean({ description: "Whether Phrase QA still shows more rows after this capture." }),
});

const phraseQaRunParameters = Type.Object({
  captures: Type.Array(qaCaptureSchema, { minItems: 1 }),
  maxLoadMorePasses: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 100 })),
  ignoreFalsePositives: Type.Optional(Type.Boolean({ default: false })),
  ignoreChunkSize: Type.Optional(Type.Number({ default: 10, minimum: 1, maximum: 50 })),
});

function observedMap(rows: Array<{ segmentId: string; target: string }> = []): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.segmentId, row.target]));
}

export function createPlatformBackfillRunTool(workspace: CatWorkspace) {
  return defineTool<typeof platformBackfillRunParameters>({
    name: "platform_backfill_run",
    label: "Platform Backfill Run",
    description:
      "Run the Phrase backfill state machine from observed Phrase current/readback targets. Writes workflow_artifacts rows/checkpoints and blocks unsafe writes.",
    promptSnippet:
      "platform_backfill_run: after Browser/Chrome reads Phrase current targets, run row-level backfill with write-before-read, formatting gate, and readback checkpoints.",
    promptGuidelines: [
      "Use this only after reading the visible Phrase row label/source signature/current target for every row.",
      "Never infer current target from scroll position. If Phrase current target differs from expectedCurrentTarget, this tool blocks the row.",
      "Do not use Cmd+S, confirm segments, or mark platform work complete as part of this tool.",
      "Native tags, rich text, placeholders, hard line breaks, and literal \\n risks are checked before platform write.",
    ],
    parameters: platformBackfillRunParameters,
    async execute(_toolCallId, params) {
      const run = await runPlatformBackfillWorkflow(workspace.root, workspace.projectId, params.rows, createObservedPhraseAdapter({
        currentTargets: observedMap(params.observedCurrentTargets),
        readbackTargets: observedMap(params.observedReadbackTargets ?? params.observedCurrentTargets),
        lockedSegmentIds: params.lockedSegmentIds,
      }), {
        stopOnFailure: params.stopOnFailure,
      });
      const text = [
        `Platform backfill run: processed ${run.processed}, verified ${run.verified}, skipped ${run.skipped}, blocked ${run.blocked}.`,
        run.stopped ? "Runner stopped on failure. Inspect Platform Backfill checkpoints before continuing." : "Runner did not stop early.",
      ].join("\n");
      return { content: [{ type: "text", text }], details: run };
    },
  });
}

export function createPhraseQaRunTool(workspace: CatWorkspace) {
  return defineTool<typeof phraseQaRunParameters>({
    name: "platform_phrase_qa_run",
    label: "Platform Phrase QA Run",
    description:
      "Persist captured Phrase QA rows through the QA parser/load-more state machine, including dispositions, final ignore state, and row-count checkpoints.",
    promptSnippet:
      "platform_phrase_qa_run: after Browser/Chrome captures Phrase QA rows, parse dispositions, preserve unconfirmed warnings, and persist hasLoadMore=false coverage.",
    promptGuidelines: [
      "Run/capture Phrase QA until hasLoadMore=false; if load-more is still true, pass the captures so LA records a blocked checkpoint.",
      "Retain 未确认句段 by default. Do not ignore unconfirmed warnings just to make the list clean.",
      "Only mark ignored_false_positive when a row was reviewed and the reason is recorded in evidence.",
      "After any ignore batch, recapture QA and call this tool again with the updated final ignore state.",
    ],
    parameters: phraseQaRunParameters,
    async execute(_toolCallId, params) {
      const run = await runPhraseQaWorkflow(workspace.root, workspace.projectId, createCapturedPhraseQaAdapter({
        captures: params.captures.map((capture) => ({
          hasLoadMore: capture.hasLoadMore,
          rows: capture.rows.map((row) => ({
            ...row,
            decisionHint: row.decisionHint as PhraseQaDisposition | undefined,
            finalIgnoreState: row.finalIgnoreState as PhraseQaFinalIgnoreState | undefined,
          })),
        })),
      }), {
        maxLoadMorePasses: params.maxLoadMorePasses,
        ignoreFalsePositives: params.ignoreFalsePositives,
        ignoreChunkSize: params.ignoreChunkSize,
      });
      const text = [
        `Phrase QA run: captured ${run.capturedRows} row(s), ignored ${run.ignoredRows} reviewed false positive row(s).`,
        run.hasLoadMore ? "Coverage incomplete: hasLoadMore=true." : "Coverage complete: hasLoadMore=false.",
      ].join("\n");
      return { content: [{ type: "text", text }], details: run };
    },
  });
}
