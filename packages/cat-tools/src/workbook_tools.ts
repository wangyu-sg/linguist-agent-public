import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  importWorkbookAssetPlan,
  parseAsset,
  planWorkbookAssetImport,
  saveAssetMappingProfile,
  previewWorkbookMapping,
  suggestAssetMappings,
  suggestWorkbookMappingCandidates,
} from "@linguist-agent/cat-data";

const assetParseModeSchema = Type.Union([
  Type.Literal("structured"),
  Type.Literal("mineru"),
  Type.Literal("dual"),
  Type.Literal("manual"),
]);

const assetPurposeSchema = Type.Union([
  Type.Literal("termbase"),
  Type.Literal("tm"),
  Type.Literal("glossary"),
  Type.Literal("reference"),
]);

const workbookAssetRoleSchema = Type.Union([
  Type.Literal("termbase"),
  Type.Literal("termbase_delta"),
  Type.Literal("candidate_terms"),
  Type.Literal("glossary"),
  Type.Literal("style_guide"),
  Type.Literal("project_requirements"),
  Type.Literal("qa_reference"),
  Type.Literal("issue_log"),
  Type.Literal("checklist"),
  Type.Literal("source_table"),
  Type.Literal("reference"),
]);

const assetConfirmedMappingSchema = Type.Object({
  sheetName: Type.String(),
  role: workbookAssetRoleSchema,
  action: Type.Union([Type.Literal("import_terms"), Type.Literal("import_term_delta"), Type.Literal("resolve_term_history"), Type.Literal("index_reference"), Type.Literal("needs_mapping")]),
  authorityTier: Type.Union([Type.Literal("termbase"), Type.Literal("term_history"), Type.Literal("style_guide"), Type.Literal("reference"), Type.Literal("proposal_only")]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  reason: Type.String(),
  sourceColumn: Type.Optional(Type.String()),
  targetColumn: Type.Optional(Type.String()),
  noteColumn: Type.Optional(Type.String()),
  statusColumn: Type.Optional(Type.String()),
  categoryColumn: Type.Optional(Type.String()),
  dateColumn: Type.Optional(Type.String()),
  commentColumn: Type.Optional(Type.String()),
  warnings: Type.Optional(Type.Array(Type.String())),
});

const workbookPreviewParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute xlsx/csv/tsv/txt/md table path." }),
  maxSheets: Type.Optional(Type.Number({ default: 8, minimum: 1, maximum: 20 })),
  sheetOffset: Type.Optional(Type.Number({ default: 0, minimum: 0, maximum: 10000 })),
  sampleRows: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 20 })),
});

const workbookMappingCandidatesParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute xlsx/csv/tsv/txt/md table path." }),
  purpose: Type.Optional(
    Type.Union([Type.Literal("termbase"), Type.Literal("tm"), Type.Literal("glossary")], {
      default: "termbase",
      description: "Mapping purpose. Use termbase for authoritative terminology workbooks.",
    }),
  ),
  maxSheets: Type.Optional(Type.Number({ default: 12, minimum: 1, maximum: 30 })),
  sheetOffset: Type.Optional(Type.Number({ default: 0, minimum: 0, maximum: 10000 })),
  sampleRows: Type.Optional(Type.Number({ default: 12, minimum: 3, maximum: 30 })),
  limit: Type.Optional(Type.Number({ default: 8, minimum: 1, maximum: 20 })),
});

const workbookAssetPlanParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute noisy multi-sheet workbook path." }),
  sampleRows: Type.Optional(Type.Number({ default: 3, minimum: 1, maximum: 10 })),
  parseMode: Type.Optional(assetParseModeSchema),
  mappingProfileId: Type.Optional(Type.String()),
  confirmedMappings: Type.Optional(Type.Array(assetConfirmedMappingSchema)),
});

const workbookAssetImportParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute noisy multi-sheet workbook path." }),
  append: Type.Optional(Type.Boolean({ default: false })),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  parseMode: Type.Optional(assetParseModeSchema),
  mappingProfileId: Type.Optional(Type.String()),
  confirmedMappings: Type.Optional(Type.Array(assetConfirmedMappingSchema)),
});

const assetParsePreviewParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute asset path." }),
  mode: Type.Optional(assetParseModeSchema),
  purpose: Type.Optional(assetPurposeSchema),
  maxSheets: Type.Optional(Type.Number({ default: 12, minimum: 1, maximum: 40 })),
  sheetOffset: Type.Optional(Type.Number({ default: 0, minimum: 0, maximum: 10000 })),
  sampleRows: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 30 })),
  mineruCommand: Type.Optional(Type.String({ description: "Optional MinerU executable path for this run." })),
  mineruTimeoutMs: Type.Optional(Type.Number({ default: 180000, minimum: 1000, maximum: 600000 })),
});

const assetMappingSuggestParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute asset path." }),
  mode: Type.Optional(assetParseModeSchema),
  purpose: Type.Optional(assetPurposeSchema),
  maxSheets: Type.Optional(Type.Number({ default: 12, minimum: 1, maximum: 40 })),
  sampleRows: Type.Optional(Type.Number({ default: 8, minimum: 1, maximum: 30 })),
  mineruCommand: Type.Optional(Type.String({ description: "Optional MinerU executable path for this run." })),
});

const assetMappingProfileSaveParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute asset path." }),
  parseMode: Type.Optional(assetParseModeSchema),
  confirmedMappings: Type.Array(assetConfirmedMappingSchema, { minItems: 1 }),
  llmAssisted: Type.Optional(Type.Boolean({ default: false })),
  confirmedBy: Type.Optional(Type.String({ default: "agent" })),
  warnings: Type.Optional(Type.Array(Type.String())),
});

export function createWorkbookPreviewTool() {
  return defineTool<typeof workbookPreviewParameters>({
    name: "workbook_preview",
    label: "Workbook Preview",
    description: "Preview workbook/table sheets, headers, sample rows, and source/target mapping suggestions before importing terminology.",
    promptSnippet: "workbook_preview: inspect XLSX/CSV/TSV/TXT/MD tables and suggest source/target/note columns before import.",
    promptGuidelines: [
      "Call workbook_preview before importing any glossary or termbase table.",
      "If confidence is below 0.8, ask the user to confirm source/target columns before importing.",
      "Do not import a workbook blindly based only on filename.",
      "Treat sheet coverage as a preview: if hasMore is true, continue with the reported nextOffset or use workbook_asset_plan, which scans every sheet before import.",
    ],
    parameters: workbookPreviewParameters,
    async execute(_toolCallId, params) {
      const preview = await previewWorkbookMapping(process.cwd(), params);
      const text = [
        `Workbook: ${preview.assetPath}`,
        `Resolved: ${preview.resolvedPath}`,
        `Engine: ${preview.engine ?? "unknown"}`,
        `Sheet coverage: ${preview.sheetCoverage.visibleSheets} visible / ${preview.sheetCoverage.scannedSheets} scanned / ${preview.sheetCoverage.totalSheets} total (offset ${preview.sheetCoverage.offset}, limit ${preview.sheetCoverage.limit})${preview.sheetCoverage.hasMore ? `; continue at sheetOffset=${preview.sheetCoverage.nextOffset}` : ""}`,
        "",
        ...preview.sheets.map((sheet) =>
          [
            `## ${sheet.sheetName} (${sheet.rowCount} rows, confidence ${(sheet.confidence * 100).toFixed(0)}%, engine ${sheet.engine ?? preview.engine ?? "unknown"})`,
            `Suggested: source=${sheet.suggested.sourceColumn ?? "-"} target=${sheet.suggested.targetColumn ?? "-"} note=${sheet.suggested.noteColumn ?? "-"}`,
            `Reason: ${sheet.reason}`,
            `Headers: ${sheet.headers.join(" | ")}`,
            sheet.sampleRows.length ? `Samples:\n${sheet.sampleRows.map((row) => `- ${row.join(" | ")}`).join("\n")}` : "Samples: none",
          ].join("\n"),
        ),
      ].join("\n");
      return { content: [{ type: "text", text }], details: preview };
    },
  });
}

export function createWorkbookMappingCandidatesTool() {
  return defineTool<typeof workbookMappingCandidatesParameters>({
    name: "workbook_mapping_candidates",
    label: "Workbook Mapping Candidates",
    description:
      "Score likely source/target/note column mappings across workbook sheets before importing a terminology, glossary, or TM table.",
    promptSnippet:
      "workbook_mapping_candidates: rank candidate sheet/column mappings for XLSX/CSV/TSV terminology or TM imports; ask the user to confirm before importing.",
    promptGuidelines: [
      "Use this after project_onboard/project_health reports an unsatisfied workbook_preview -> termbase_import_table or tm_import_table action.",
      "Do not call termbase_import_table or tm_import_table until the user confirms the selected sheet and source/target columns.",
      "Prefer high-confidence termbase candidates from sheets named Terms/Glossary/术语; treat Query/Issue/Checklist/Reference sheets as review context unless the user confirms otherwise.",
      "Do not use workbook_mapping_candidates for Term Change Log old/new sheets; those require workbook_asset_plan and term-history resolution before authority.",
      "Treat inspected sheets as a bounded candidate scan: if sheetCoverage.hasMore is true, continue at sheetCoverage.nextOffset before concluding no candidate exists.",
    ],
    parameters: workbookMappingCandidatesParameters,
    async execute(_toolCallId, params) {
      const result = await suggestWorkbookMappingCandidates(process.cwd(), params);
      const lines: string[] = [
        `Workbook mapping candidates: ${result.assetPath}`,
        `Resolved: ${result.resolvedPath}`,
        `Purpose: ${result.purpose}`,
        `Sheet coverage: ${result.sheetCoverage.visibleSheets} visible / ${result.sheetCoverage.scannedSheets} scanned / ${result.sheetCoverage.totalSheets} total (offset ${result.sheetCoverage.offset}, limit ${result.sheetCoverage.limit})${result.sheetCoverage.hasMore ? `; continue at sheetOffset=${result.sheetCoverage.nextOffset}` : ""}`,
        "",
      ];
      if (!result.candidates.length) {
        lines.push("No importable source/target mapping candidates found. Ask the user for exact sheet and column names.");
      } else {
        for (const [index, candidate] of result.candidates.entries()) {
          lines.push(
            [
              `## ${index + 1}. ${candidate.sheetName} · score ${candidate.score} · confidence ${(candidate.confidence * 100).toFixed(0)}%`,
              `sourceColumn: ${candidate.sourceColumn}`,
              `targetColumn: ${candidate.targetColumn}`,
              `noteColumn: ${candidate.noteColumn ?? "-"}`,
              `rows: ${candidate.rowCount}`,
              `reason: ${candidate.reason}`,
              candidate.sampleRows.length ? `samples:\n${candidate.sampleRows.map((row) => `- ${row.join(" | ")}`).join("\n")}` : "samples: none",
            ].join("\n"),
          );
          lines.push("");
        }
      }
      return { content: [{ type: "text", text: lines.join("\n").trimEnd() }], details: result };
    },
  });
}

function formatAssetPlan(result: Awaited<ReturnType<typeof planWorkbookAssetImport>>): string {
  const lines = [
    `Workbook asset plan: ${result.assetPath}`,
    `Resolved: ${result.resolvedPath}`,
    `Sheets: ${result.summary.sheets}`,
    `Importable term rows: ${result.summary.importableTermRows}`,
    `Dedupe term pairs: ${result.summary.dedupeTermPairs}`,
    `Reference blocks: ${result.summary.referenceBlocks}`,
    `Needs mapping: ${result.summary.needsMapping}`,
    `Needs term-history resolution: ${result.summary.needsResolution}`,
    `Typed rows: ${result.summary.typedRows ?? 0}`,
    `Candidate rows: ${result.summary.candidateRows ?? 0}`,
    `Typed blocks: ${result.summary.typedBlocks ?? 0}`,
    "",
  ];
  for (const sheet of result.sheets) {
    lines.push(
      [
        `## ${sheet.sheetName}`,
        `role: ${sheet.role}`,
        `action: ${sheet.action}`,
        `rows: ${sheet.rowCount}`,
        `importableTerms: ${sheet.importableTerms}`,
        `referenceBlocks: ${sheet.referenceBlocks}`,
        `parser: ${sheet.parserKind ?? "-"} / ${sheet.parserStatus ?? "-"}`,
        `typedRows: ${sheet.typedRowCount ?? 0}`,
        `candidateRows: ${sheet.candidateCount ?? 0}`,
        `reason: ${sheet.reason}`,
        sheet.diagnostics.length ? `diagnostics: ${sheet.diagnostics.map((item) => `${item.label}=${item.value}`).join("; ")}` : undefined,
        sheet.warnings.length ? `warnings: ${sheet.warnings.join("; ")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    lines.push("");
  }
  if (result.warnings.length) {
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n").trimEnd();
}

function formatParseResult(result: Awaited<ReturnType<typeof parseAsset>>): string {
  const structured = result.structuredPreview;
  const mineru = result.mineruPreview;
  const comparison = result.comparison;
  const lines = [
    `Asset parse preview: ${result.assetPath}`,
    `Mode: ${result.mode}`,
    structured
      ? `Structured: ${structured.status} · ${(structured.structuredSheets ?? []).length} visible sheets${structured.structuredSheetCoverage ? ` / ${structured.structuredSheetCoverage.totalSheets} total` : ""}`
      : undefined,
    mineru ? `MinerU: ${mineru.status} · ${(mineru.mineruBlocks ?? []).length} blocks` : undefined,
    comparison
      ? `Dual comparison: structuredRows=${comparison.structuredRowCount} mineruTables=${comparison.mineruTableBlockCount} rowDelta=${comparison.rowCountDelta ?? "-"}`
      : undefined,
    "",
  ].filter(Boolean) as string[];
  const structuredSheets = structured?.structuredSheets ?? [];
  const structuredVisible = Math.min(8, structuredSheets.length);
  if (structured) lines.push(`Structured sheet details: showing ${structuredVisible}/${structuredSheets.length} returned sheet(s); use structuredSheetCoverage and sheetOffset for the complete preview.`);
  for (const sheet of structuredSheets.slice(0, 8)) {
    lines.push(`- ${sheet.sheetName}: ${sheet.role}/${sheet.action}, rows=${sheet.rowCount}, confidence=${(sheet.confidence * 100).toFixed(0)}%, source=${sheet.suggested.sourceColumn ?? "-"} target=${sheet.suggested.targetColumn ?? "-"}`);
  }
  const mineruBlocks = mineru?.mineruBlocks ?? [];
  const mineruVisible = Math.min(6, mineruBlocks.length);
  if (mineru) lines.push(`MinerU block details: showing ${mineruVisible}/${mineruBlocks.length} returned block(s); structured details contain the complete parse result.`);
  for (const block of mineruBlocks.slice(0, 6)) {
    lines.push(`- MinerU ${block.blockType} ${block.id}: ${block.text.slice(0, 140).replace(/\s+/g, " ")}`);
  }
  if (result.warnings.length) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n").trimEnd();
}

export function createAssetParsePreviewTool() {
  return defineTool<typeof assetParsePreviewParameters>({
    name: "asset_parse_preview",
    label: "Asset Parse Preview",
    description:
      "Preview a project asset through structured workbook parsing, MinerU parsing, dual comparison, or manual mapping mode before import.",
    promptSnippet:
      "asset_parse_preview: run structured/MinerU/dual asset parsing before mapping and import; dual mode compares extracted sheet/table evidence.",
    promptGuidelines: [
      "Use structured mode for XLSX/CSV/TSV tables, MinerU mode for PDFs or visually structured assets, and dual mode when structure may be lossy.",
      "A parse preview is not an import. Ask for confirmation or save a mapping profile before writing termbase/reference indexes.",
      "If MinerU is unavailable, continue with structured/manual mapping and report the unavailable parser explicitly.",
      "If structuredSheetCoverage.hasMore is true, continue with the reported nextOffset or use workbook_asset_plan before treating the workbook as fully inspected.",
    ],
    parameters: assetParsePreviewParameters,
    async execute(_toolCallId, params) {
      const result = await parseAsset(process.cwd(), params);
      return { content: [{ type: "text", text: formatParseResult(result) }], details: result };
    },
  });
}

export function createAssetMappingSuggestTool() {
  return defineTool<typeof assetMappingSuggestParameters>({
    name: "asset_mapping_suggest",
    label: "Asset Mapping Suggest",
    description:
      "Generate deterministic and optional LLM-assisted sheet/column mapping suggestions from an asset parse preview before import.",
    promptSnippet:
      "asset_mapping_suggest: propose source/target/note column mappings for termbase/TM/glossary/reference intake; user confirmation still required.",
    promptGuidelines: [
      "Use this after asset_parse_preview when a workbook has ambiguous sheet roles or source/target columns.",
      "Treat LLM suggestions as assistant proposals, not authority. Persist confirmed mappings before import.",
      "Do not invent sheet or column names; suggestions must match parser output.",
    ],
    parameters: assetMappingSuggestParameters,
    async execute(_toolCallId, params) {
      const result = await suggestAssetMappings(process.cwd(), params);
      const lines = [
        `Asset mapping suggestions: ${result.assetPath}`,
        `Mode: ${result.parseMode}`,
        `Purpose: ${result.purpose}`,
        `Assistant: ${result.assistantStatus}${result.assistantModel ? ` (${result.assistantModel})` : ""}`,
        `Showing ${Math.min(12, result.suggestions.length)}/${result.suggestions.length} suggestion(s); the structured result contains the complete proposal set.`,
        "",
      ];
      for (const [index, suggestion] of result.suggestions.slice(0, 12).entries()) {
        lines.push(
          `${index + 1}. ${suggestion.sheetName}: ${suggestion.sourceColumn ?? "-"} -> ${suggestion.targetColumn ?? "-"} · ${suggestion.role}/${suggestion.action} · ${(suggestion.confidence * 100).toFixed(0)}% · ${suggestion.source}`,
        );
      }
      if (result.warnings.length) {
        lines.push("", "Warnings:");
        for (const warning of result.warnings) lines.push(`- ${warning}`);
      }
      return { content: [{ type: "text", text: lines.join("\n").trimEnd() }], details: result };
    },
  });
}

export function createAssetMappingProfileSaveTool() {
  return defineTool<typeof assetMappingProfileSaveParameters>({
    name: "asset_mapping_profile_save",
    label: "Asset Mapping Profile Save",
    description:
      "Persist a user-confirmed asset mapping profile so workbook plan/import can use explicit project-specific sheet roles and source/target columns.",
    promptSnippet:
      "asset_mapping_profile_save: save confirmed sheet roles and source/target/note columns before workbook_asset_plan or workbook_asset_import.",
    promptGuidelines: [
      "Only call this after user confirmation or an explicit workflow decision.",
      "Do not save LLM suggestions as confirmed mappings without user approval.",
      "Pass the returned mappingProfileId and confirmedMappings into workbook_asset_plan/workbook_asset_import.",
    ],
    parameters: assetMappingProfileSaveParameters,
    async execute(_toolCallId, params) {
      const result = await saveAssetMappingProfile(process.cwd(), {
        ...params,
        parseMode: params.parseMode ?? "structured",
        parserEvidence: {},
        llmAssisted: params.llmAssisted ?? false,
        confirmedBy: params.confirmedBy ?? "agent",
        warnings: params.warnings ?? [],
      });
      return {
        content: [{ type: "text", text: `Asset mapping profile saved: ${result.profile.id}\nMappings: ${result.profile.confirmedMappings.length}\nPath: ${result.path}` }],
        details: result,
      };
    },
  });
}

export function createWorkbookAssetPlanTool() {
  return defineTool<typeof workbookAssetPlanParameters>({
    name: "workbook_asset_plan",
    label: "Workbook Asset Plan",
    description:
      "Create a deterministic split/import plan for noisy multi-sheet asset workbooks, separating termbase, term delta, reference, and manual-mapping sheets.",
    promptSnippet:
      "workbook_asset_plan: inspect a multi-sheet client asset workbook and produce the safe termbase/reference split plan before import.",
    promptGuidelines: [
      "Use this for asset master workbooks before importing.",
      "Do not treat workbook_mapping_candidates as an import plan for Query/Issue/Style/CI sheets.",
      "Term Change Log / old-new terminology sheets must be resolved as history before preferred term import; approved rows alone are not enough.",
      "Only workbook_asset_import should write the planned split to termbase/reference indexes.",
    ],
    parameters: workbookAssetPlanParameters,
    async execute(_toolCallId, params) {
      const result = await planWorkbookAssetImport(process.cwd(), params);
      return { content: [{ type: "text", text: formatAssetPlan(result) }], details: result };
    },
  });
}

export function createWorkbookAssetImportTool() {
  return defineTool<typeof workbookAssetImportParameters>({
    name: "workbook_asset_import",
    label: "Workbook Asset Import",
    description:
      "Import a noisy multi-sheet asset workbook according to LA's split plan: authoritative term sheets into termbase and reference sheets into asset blocks.",
    promptSnippet:
      "workbook_asset_import: write the workbook_asset_plan result to project termbase.json and asset_blocks.jsonl.",
    promptGuidelines: [
      "Call workbook_asset_plan first and inspect warnings before importing.",
      "Use append=true only when adding to an existing project index.",
      "Rows marked needs_mapping are indexed as reference until the user confirms an authoritative mapping.",
      "Rows marked resolve_term_history are indexed as reference and do not become preferred terms until the history resolver produces a current-vs-deprecated decision.",
    ],
    parameters: workbookAssetImportParameters,
    async execute(_toolCallId, params) {
      const result = await importWorkbookAssetPlan(process.cwd(), params);
      const text = [
        `Workbook asset import complete: ${result.assetPath}`,
        `Imported terms: ${result.importedTerms}`,
        `Imported term-history rows: ${result.importedTermHistoryRows}`,
        `Term-history decisions: ${result.termHistoryDecisions.length}`,
        `Skipped duplicate terms: ${result.skippedDuplicateTerms}`,
        `Reference blocks: ${result.writtenReferenceBlocks}`,
        `Termbase: ${result.termbasePath}`,
        `Asset blocks: ${result.assetBlocksPath}`,
        `Term history: ${result.termHistoryPath}`,
        result.warnings.length ? `Warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : undefined,
        result.sampleTerms.length
          ? `Sample terms:\n${result.sampleTerms.map((entry) => `- ${entry.source} -> ${entry.target} (${entry.sheetName}:${entry.rowNo})`).join("\n")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      return { content: [{ type: "text", text }], details: result };
    },
  });
}
