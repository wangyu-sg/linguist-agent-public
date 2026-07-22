import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  importCsvBatch,
  importGenericXliffBatch,
  importMqxliffBatch,
  importPhraseBatch,
  importSdlxliffBatch,
  importXlsxBatch,
  readBatch,
  updateSegmentTarget,
  type BatchSegment,
  type CatBatch,
  type SegmentChangeType,
  type SegmentUpdateResult,
} from "@linguist-agent/cat-data";

const batchImportPhraseParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  mxliffPath: Type.String({ description: "Absolute path, or path relative to the project root, to the Phrase MXLIFF file." }),
  masterXliffPath: Type.Optional(
    Type.String({ description: "Absolute path, or project-root-relative path, to the master XLIFF tag companion." }),
  ),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the MXLIFF basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchImportSdlxliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  sdlxliffPath: Type.String({ description: "Absolute path, or path relative to the project root, to the SDLXLIFF file." }),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the SDLXLIFF basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchImportMqxliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  mqxliffPath: Type.String({ description: "Absolute path, or path relative to the project root, to the memoQ MQXLIFF file." }),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the MQXLIFF basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchImportXliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  xliffPath: Type.String({ description: "Absolute path, or path relative to the project root, to the generic XLIFF 1.2/2.0 file." }),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the XLIFF basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchImportCsvParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  csvPath: Type.String({ description: "Absolute path, or path relative to the project root, to a CSV table with SegmentID/Source/Target columns." }),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the CSV basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchImportXlsxParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  xlsxPath: Type.String({ description: "Absolute path, or path relative to the project root, to an XLSX table with SegmentID/Source/Target columns." }),
  batchId: Type.Optional(Type.String({ description: "Optional stable batch id. Defaults to the XLSX basename." })),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
});

const batchReadParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_phrase." }),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1 })),
  limit: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 200 })),
  filter: Type.Optional(
    Type.Union([
      Type.Literal("all"),
      Type.Literal("untranslated"),
      Type.Literal("draft"),
      Type.Literal("confirmed"),
      Type.Literal("locked"),
      Type.Literal("duplicates"),
      Type.Literal("tag_warnings"),
    ]),
  ),
});

const segmentChangeTypeSchema = Type.Union(
  [
    Type.Literal("translation"),
    Type.Literal("term"),
    Type.Literal("terminology"),
    Type.Literal("accuracy"),
    Type.Literal("consistency"),
    Type.Literal("style"),
    Type.Literal("fluency"),
    Type.Literal("user_approved"),
    Type.Literal("other"),
  ],
  { description: "Why this write is allowed. Term/terminology authority writes require returned evidenceSources." },
);

const segmentSetTargetParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_phrase." }),
  segmentId: Type.String({ description: "Segment id to update." }),
  target: Type.String({ description: "New target text. Must preserve required tags." }),
  confirm: Type.Optional(Type.Boolean({ default: false, description: "Mark changed rows as confirmed." })),
  propagateDuplicates: Type.Optional(
    Type.Boolean({
      description:
      "When true, update every unlocked segment in the same exact-source duplicate group. Defaults to false; duplicate propagation must be explicit.",
    }),
  ),
  changeType: segmentChangeTypeSchema,
  reason: Type.String({ description: "Short reason for the change. Must cite user instruction or evidence." }),
  evidenceSources: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Returned evidence references for term/terminology-authority changes, e.g. tm_lookup row, glossary_lookup row, asset path:line.",
    }),
  ),
});

const batchSetTargetInputParameters = Type.Object({
  segmentId: Type.String({ description: "Segment id to update." }),
  target: Type.String({ description: "Draft target text. Must preserve required tags." }),
  reason: Type.Optional(Type.String({ description: "Row-specific reason. Defaults to the batch reason." })),
  changeType: Type.Optional(segmentChangeTypeSchema),
  evidenceSources: Type.Optional(Type.Array(Type.String())),
  acceptedRiskCodes: Type.Optional(Type.Array(Type.String())),
  propagateDuplicates: Type.Optional(Type.Boolean({ description: "Opt-in duplicate propagation for this row." })),
});

const batchSetTargetsParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by a batch import tool." }),
  reason: Type.Optional(Type.String({ description: "Default reason for all draft writes." })),
  propagateDuplicates: Type.Optional(Type.Boolean({ default: false, description: "Default duplicate propagation flag for rows without an override." })),
  updates: Type.Array(batchSetTargetInputParameters, { minItems: 1 }),
});

function formatImport(batch: CatBatch, path: string): string {
  return [
    `# Batch Imported`,
    ``,
    `Batch: ${batch.batchId}`,
    `Path: ${path}`,
    `Segments: ${batch.segments.length}`,
    `Languages: ${batch.sourceLanguage} -> ${batch.targetLanguage}`,
    `Duplicate source groups: ${batch.duplicateSourceGroups.length}`,
    `Tag report: matched ${batch.tagReport.masterMatchedSegments}/${batch.tagReport.totalSegments}, unresolved ${batch.tagReport.unresolvedPlaceholders} (runtime ${batch.tagReport.unresolvedRuntimePlaceholders ?? 0}, tag ${batch.tagReport.unresolvedTagPlaceholders ?? 0}), mismatches ${batch.tagReport.tagCountMismatches}`,
  ].join("\n");
}

function formatSegment(segment: BatchSegment): string {
  const flags = [
    segment.locked ? "LOCKED" : undefined,
    segment.status,
    segment.duplicateRole && segment.duplicateRole !== "unique"
      ? `duplicate:${segment.duplicateRole} ${segment.duplicateOrdinal ?? "?"}/${segment.duplicateGroupSize ?? "?"}`
      : undefined,
    segment.placeholderCount ? `tags:${segment.placeholderCount}` : undefined,
    segment.unresolvedPlaceholderCount
      ? `unresolved:${segment.unresolvedPlaceholderCount} runtime:${segment.unresolvedRuntimePlaceholderCount ?? 0} tag:${segment.unresolvedTagPlaceholderCount ?? 0}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `## ${segment.index}. ${segment.id} ${flags ? `(${flags})` : ""}`,
    `Source: ${segment.source}`,
    `Target: ${segment.target || "(empty)"}`,
    segment.masterId ? `Master: ${segment.masterId}` : undefined,
    segment.resname ? `Key: ${segment.resname}` : undefined,
    segment.contextNote ? `Context: ${segment.contextNote}` : undefined,
    segment.duplicateRole && segment.duplicateRole !== "unique" ? `Duplicate first: ${segment.duplicateFirstSegmentId}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function filterSegments(batch: CatBatch, filter = "all"): BatchSegment[] {
  const duplicateKeys = new Set(batch.duplicateSourceGroups.map((group) => group.duplicateKey));
  switch (filter) {
    case "untranslated":
      return batch.segments.filter((segment) => !segment.target.trim());
    case "draft":
      return batch.segments.filter((segment) => segment.status === "draft");
    case "confirmed":
      return batch.segments.filter((segment) => segment.status === "confirmed");
    case "locked":
      return batch.segments.filter((segment) => segment.locked);
    case "duplicates":
      return batch.segments.filter((segment) => duplicateKeys.has(segment.duplicateKey));
    case "tag_warnings":
      return batch.segments.filter((segment) => (segment.unresolvedTagPlaceholderCount ?? segment.unresolvedPlaceholderCount) > 0);
    default:
      return batch.segments;
  }
}

function formatBatchRead(batch: CatBatch, rows: BatchSegment[], totalFiltered: number, start: number, nextStart: number | null): string {
  return [
    `# Batch ${batch.batchId}`,
    ``,
    `Segments: ${batch.segments.length} · Showing: ${rows.length}/${totalFiltered}`,
    `Page start: ${start} · Next start: ${nextStart ?? "none"} · Page complete: ${nextStart === null ? "yes" : "no"}`,
    `Duplicate source groups: ${batch.duplicateSourceGroups.length}`,
    `Tag warnings: unresolved=${batch.tagReport.unresolvedPlaceholders} (runtime=${batch.tagReport.unresolvedRuntimePlaceholders ?? 0}, tag=${batch.tagReport.unresolvedTagPlaceholders ?? 0}), mismatches=${batch.tagReport.tagCountMismatches}`,
    ``,
    rows.map(formatSegment).join("\n\n") || "No segments matched this filter.",
  ].join("\n");
}

function formatUpdate(result: SegmentUpdateResult): string {
  return [
    `# Segment Updated`,
    ``,
    `Batch: ${result.batchId}`,
    `Requested: ${result.requestedSegmentId}`,
    `Changed: ${result.changedSegmentIds.length ? result.changedSegmentIds.join(", ") : "none"}`,
    `Skipped locked: ${result.skippedLockedIds.length ? result.skippedLockedIds.join(", ") : "none"}`,
    `Skipped duplicate targets: ${result.skippedDuplicateIds.length ? result.skippedDuplicateIds.join(", ") : "none"}`,
    `Propagated duplicate group: ${result.propagated ? `yes (${result.duplicateGroupSize} rows)` : "no"}`,
    `Status: ${result.status}`,
  ].join("\n");
}

interface BatchSetTargetsResult {
  batchId: string;
  changedSegmentIds: string[];
  skippedLockedIds: string[];
  skippedDuplicateIds: string[];
  errors: Array<{ segmentId: string; message: string }>;
  results: SegmentUpdateResult[];
}

function formatBatchSetTargets(result: BatchSetTargetsResult): string {
  return [
    `# Batch Targets Updated`,
    ``,
    `Batch: ${result.batchId}`,
    `Changed: ${result.changedSegmentIds.length ? result.changedSegmentIds.join(", ") : "none"}`,
    `Skipped locked: ${result.skippedLockedIds.length ? result.skippedLockedIds.join(", ") : "none"}`,
    `Skipped duplicate targets: ${result.skippedDuplicateIds.length ? result.skippedDuplicateIds.join(", ") : "none"}`,
    `Errors total: ${result.errors.length}`,
    `Errors: showing ${Math.min(20, result.errors.length)}/${result.errors.length}; use the structured result for the complete set.`,
    ...result.errors.slice(0, 20).map((error) => `- ${error.segmentId}: ${error.message}`),
    ...(result.errors.length > 20 ? [`... ${result.errors.length - 20} more error(s) are present in the structured tool result.`] : []),
  ].join("\n");
}

export function createBatchImportPhraseTool() {
  return defineTool<typeof batchImportPhraseParameters>({
    name: "batch_import_phrase",
    label: "Batch Import Phrase",
    description:
      "Import a Phrase MXLIFF batch with its master XLIFF tag companion into the active LA project workspace.",
    promptSnippet: "batch_import_phrase: create a working CAT batch from Phrase MXLIFF plus master XLIFF tags.",
    promptGuidelines: [
      "Call batch_import_phrase after project_onboard identifies a Phrase MXLIFF/master XLIFF pair.",
      "Never import a Phrase MXLIFF without checking whether a master XLIFF companion is available.",
      "After import, inspect tagReport and duplicate source groups before translation or review.",
    ],
    parameters: batchImportPhraseParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importPhraseBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchImportSdlxliffTool() {
  return defineTool<typeof batchImportSdlxliffParameters>({
    name: "batch_import_sdlxliff",
    label: "Batch Import SDLXLIFF",
    description:
      "Import a Trados SDLXLIFF batch into the active LA project workspace, preserving locked rows and confirmation levels.",
    promptSnippet: "batch_import_sdlxliff: create a CAT batch from Trados SDLXLIFF with lock and confirmation metadata.",
    promptGuidelines: [
      "Call batch_import_sdlxliff for .sdlxliff files exported from Trados.",
      "After import, inspect locked rows and confirmation levels before translation or review.",
      "Do not edit locked SDLXLIFF rows; segment_set_target will skip them.",
    ],
    parameters: batchImportSdlxliffParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importSdlxliffBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchImportMqxliffTool() {
  return defineTool<typeof batchImportMqxliffParameters>({
    name: "batch_import_mqxliff",
    label: "Batch Import MQXLIFF",
    description:
      "Import a memoQ MQXLIFF batch into the active LA project workspace, preserving locked rows and memoQ segment status.",
    promptSnippet: "batch_import_mqxliff: create a CAT batch from memoQ MQXLIFF with lock/status metadata and inline tag carriers.",
    promptGuidelines: [
      "Call batch_import_mqxliff for plain .mqxliff files exported from memoQ.",
      "Do not use this for .mqxlz containers; ask the user for a plain MQXLIFF export first.",
      "After import, inspect locked rows, memoQ statuses, and tag signatures before translation or review.",
    ],
    parameters: batchImportMqxliffParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importMqxliffBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchImportXliffTool() {
  return defineTool<typeof batchImportXliffParameters>({
    name: "batch_import_xliff",
    label: "Batch Import XLIFF",
    description:
      "Import a generic XLIFF 1.2 or XLIFF 2.0 batch into the active LA project workspace.",
    promptSnippet: "batch_import_xliff: create a CAT batch from generic XLIFF 1.2/2.0 when no Phrase/memoQ/Trados adapter is needed.",
    promptGuidelines: [
      "Call batch_import_xliff for generic .xlf or .xliff files that are not Phrase master tag companions.",
      "Inspect locked rows and target state after import; generic XLIFF has less vendor-specific tag metadata than Phrase/memoQ/SDLXLIFF.",
      "Prefer vendor-specific import tools when the file is clearly Phrase MXLIFF, memoQ MQXLIFF, or Trados SDLXLIFF.",
    ],
    parameters: batchImportXliffParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importGenericXliffBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchImportCsvTool() {
  return defineTool<typeof batchImportCsvParameters>({
    name: "batch_import_csv",
    label: "Batch Import CSV",
    description: "Import a pasted/exported CSV table with segment id, source, target, status, and note columns.",
    promptSnippet: "batch_import_csv: create a CAT batch from a CSV table with SegmentID/Source/Target columns.",
    promptGuidelines: [
      "Use batch_import_csv for simple table workflows or pasted spreadsheet exports.",
      "Confirm the CSV has a source column before import; target/status/note columns are optional.",
      "Do not treat CSV import as preserving vendor-native rich tags unless the text itself contains them.",
    ],
    parameters: batchImportCsvParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importCsvBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchImportXlsxTool() {
  return defineTool<typeof batchImportXlsxParameters>({
    name: "batch_import_xlsx",
    label: "Batch Import XLSX",
    description: "Import an XLSX table with segment id, source, target, status, and note columns.",
    promptSnippet: "batch_import_xlsx: create a CAT batch from an XLSX table with SegmentID/Source/Target columns.",
    promptGuidelines: [
      "Use batch_import_xlsx for simple workbook paste/table workflows, not authoritative multi-sheet asset workbooks.",
      "If a workbook contains multiple asset roles, preview/map it through workbook_preview/workbook_asset_plan instead.",
      "Do not treat XLSX import as preserving vendor-native rich tags unless the text itself contains them.",
    ],
    parameters: batchImportXlsxParameters,
    async execute(_toolCallId, params) {
      const { batch, path } = await importXlsxBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatImport(batch, path) }],
        details: { batch, path },
      };
    },
  });
}

export function createBatchReadTool() {
  return defineTool<typeof batchReadParameters>({
    name: "batch_read",
    label: "Batch Read",
    description: "Read a page of segments from an imported LA CAT batch.",
    promptSnippet: "batch_read: inspect source, target, locked status, duplicate groups, and tag warnings for an imported batch.",
    promptGuidelines: [
      "Call batch_read before translating, editing, proofing, or changing a segment.",
      "Continue with the returned Next start until Page complete is yes; do not infer unseen rows.",
      "Use filter='duplicates' when checking repeated-source propagation behavior.",
      "Use filter='tag_warnings' before delivery or export.",
    ],
    parameters: batchReadParameters,
    async execute(_toolCallId, params) {
      const batch = await readBatch(process.cwd(), params.projectId, params.batchId);
      const filtered = filterSegments(batch, params.filter);
      const start = Math.max(1, params.start ?? 1);
      const limit = Math.max(1, Math.min(200, params.limit ?? 20));
      const rows = filtered.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + rows.length < filtered.length ? start + rows.length : null;
      return {
        content: [{ type: "text", text: formatBatchRead(batch, rows, filtered.length, start, nextStart) }],
        details: { batchId: batch.batchId, total: batch.segments.length, filtered: filtered.length, start, returned: rows.length, nextStart, pageComplete: nextStart === null, rows },
      };
    },
  });
}

export function createSegmentSetTargetTool() {
  return defineTool<typeof segmentSetTargetParameters>({
    name: "segment_set_target",
    label: "Segment Set Target",
    description:
      "Set a segment target in an imported LA batch, with locked-row protection and optional exact-duplicate propagation.",
    promptSnippet: "segment_set_target: write a reviewed target to a batch segment only after evidence or user instruction.",
    promptGuidelines: [
      "Use segment_set_target only when the user asks to apply a translation/review or explicitly approves a target.",
      "Never use segment_set_target on locked rows; the tool will skip locked rows, including locked duplicates.",
      "Duplicate propagation is opt-in: pass propagateDuplicates=true only when the exact-source duplicate group is safe to synchronize.",
      "When propagateDuplicates=true, only duplicate rows that are empty or still match the primary row's prior target are changed; existing divergent translations are skipped.",
      "Always include changeType and a short reason when changing a target.",
      "For term or terminology-authority changes, include at least one returned evidenceSources entry. Tool trace is not evidence; source/context can establish ordinary accuracy or consistency.",
    ],
    parameters: segmentSetTargetParameters,
    async execute(_toolCallId, params) {
      const result = await updateSegmentTarget(process.cwd(), params.projectId, params.batchId, {
        ...params,
        changeType: params.changeType as SegmentChangeType,
      });
      return {
        content: [{ type: "text", text: formatUpdate(result) }],
        details: result,
      };
    },
  });
}

export function createBatchSetTargetsTool() {
  return defineTool<typeof batchSetTargetsParameters>({
    name: "batch_set_targets",
    label: "Batch Set Targets",
    description:
      "Write first-pass translation draft targets to imported LA batch segments through the shared segment write guard.",
    promptSnippet: "batch_set_targets: write first-pass translation drafts to batch segments; targets stay draft, not confirmed.",
    promptGuidelines: [
      "Use batch_set_targets for T/translate first-pass work after batch_read and project evidence lookup.",
      "This tool always writes draft targets; do not use it for E/P review changes or final confirmation.",
      "Locked rows are skipped and unsafe tag/placeholder changes are rejected by the shared write guard.",
      "Use proposal_create for edit/proof findings and proposal_apply only after explicit approval.",
    ],
    parameters: batchSetTargetsParameters,
    async execute(_toolCallId, params) {
      const result: BatchSetTargetsResult = {
        batchId: params.batchId,
        changedSegmentIds: [],
        skippedLockedIds: [],
        skippedDuplicateIds: [],
        errors: [],
        results: [],
      };
      for (const update of params.updates) {
        try {
          const row = await updateSegmentTarget(process.cwd(), params.projectId, params.batchId, {
            segmentId: update.segmentId,
            target: update.target,
            confirm: false,
            propagateDuplicates: update.propagateDuplicates ?? params.propagateDuplicates ?? false,
            reason: update.reason ?? params.reason ?? "first-pass translation draft",
            changeType: (update.changeType ?? "translation") as SegmentChangeType,
            evidenceSources: update.evidenceSources,
            acceptedRiskCodes: update.acceptedRiskCodes,
          });
          result.results.push(row);
          result.changedSegmentIds.push(...row.changedSegmentIds);
          result.skippedLockedIds.push(...row.skippedLockedIds);
          result.skippedDuplicateIds.push(...row.skippedDuplicateIds);
        } catch (error) {
          result.errors.push({ segmentId: update.segmentId, message: error instanceof Error ? error.message : String(error) });
        }
      }
      result.changedSegmentIds = [...new Set(result.changedSegmentIds)];
      result.skippedLockedIds = [...new Set(result.skippedLockedIds)];
      result.skippedDuplicateIds = [...new Set(result.skippedDuplicateIds)];
      return {
        content: [{ type: "text", text: formatBatchSetTargets(result) }],
        details: result,
      };
    },
  });
}
