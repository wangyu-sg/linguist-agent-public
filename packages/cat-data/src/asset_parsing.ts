import { isAbsolute, resolve } from "node:path";
import { readProjectManifest } from "./project_manifest.js";
import { planWorkbookAssetImport, type WorkbookAssetSheetOverride } from "./workbook_asset_plan.js";
import { previewWorkbookMapping, suggestWorkbookMappingCandidates } from "./workbook_mapping.js";
import {
  authorityTierForWorkbookAction,
  type AssetColumnMapping,
  type AssetConfirmedMapping,
  type AssetMappingPurpose,
  type AssetMappingSuggestion,
  type AssetMappingSuggestionResult,
  type AssetParseComparison,
  type AssetParseMode,
  type AssetParsePreview,
  type AssetParsePreviewOptions,
  type AssetParseResult,
  type AssetStructuredSheet,
} from "./asset_ingestion_contract.js";

const WORKBOOK_MAPPING_ROLES = [
  "termbase",
  "termbase_delta",
  "candidate_terms",
  "glossary",
  "style_guide",
  "project_requirements",
  "qa_reference",
  "issue_log",
  "checklist",
  "source_table",
  "reference",
] as const;

export type AskAssetMappingModel = (input: {
  prompt: string;
  parse: AssetParseResult;
  purpose: AssetMappingPurpose;
}) => Promise<string>;

async function resolveProjectPath(workspaceRoot: string, projectId: string, assetPath: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, assetPath);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function diagnosticsForSheet(sheet: Pick<AssetStructuredSheet, "headers" | "sampleRows" | "rowCount">): Array<{ label: string; value: string | number }> {
  return [
    { label: "headers", value: sheet.headers.filter(Boolean).length },
    { label: "sample rows", value: sheet.sampleRows.length },
    { label: "rows", value: sheet.rowCount },
  ];
}

export async function structuredAssetPreview(
  workspaceRoot: string,
  options: AssetParsePreviewOptions & { sheetOverrides?: WorkbookAssetSheetOverride[]; purpose?: AssetMappingPurpose },
): Promise<AssetParsePreview> {
  try {
    const [preview, plan, candidates] = await Promise.all([
      previewWorkbookMapping(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        maxSheets: options.maxSheets ?? 12,
        sheetOffset: options.sheetOffset ?? 0,
        sampleRows: options.sampleRows ?? 5,
      }),
      planWorkbookAssetImport(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        sampleRows: options.sampleRows ?? 5,
        sheetOverrides: options.sheetOverrides,
      }),
      suggestWorkbookMappingCandidates(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        purpose: options.purpose === "tm" ? "tm" : options.purpose === "glossary" ? "glossary" : "termbase",
        maxSheets: options.maxSheets ?? 12,
        sheetOffset: options.sheetOffset ?? 0,
        sampleRows: Math.max(options.sampleRows ?? 8, 8),
        limit: 16,
      }),
    ]);
    const planBySheet = new Map(plan.sheets.map((sheet) => [sheet.sheetName, sheet]));
    const structuredSheets = preview.sheets.map((sheet): AssetStructuredSheet => {
      const sheetPlan = planBySheet.get(sheet.sheetName);
      const action = sheetPlan?.action ?? "needs_mapping";
      const needsColumnMapping = actionNeedsColumnMapping(action);
      return {
        sheetName: sheet.sheetName,
        role: sheetPlan?.role ?? "candidate_terms",
        action,
        authorityTier: authorityTierForWorkbookAction(action),
        rowCount: sheet.rowCount,
        headers: sheet.headers,
        sampleRows: sheet.sampleRows,
        engine: sheet.engine ?? preview.engine,
        suggested: needsColumnMapping ? sheet.suggested : {},
        confidence: sheet.confidence,
        reason: sheetPlan?.reason ?? sheet.reason,
        diagnostics: [
          ...diagnosticsForSheet(sheet),
          ...(sheetPlan?.diagnostics ?? []),
        ],
        warnings: sheetPlan?.warnings ?? [],
        mappingCandidates: needsColumnMapping ? candidates.candidates.filter((candidate) => candidate.sheetName === sheet.sheetName) : [],
        parserKind: sheetPlan?.parserKind,
        parserStatus: sheetPlan?.parserStatus,
        typedRowCount: sheetPlan?.typedRowCount,
        candidateCount: sheetPlan?.candidateCount,
        blockCount: sheetPlan?.blockCount,
        trace: sheetPlan?.trace,
      };
    });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath: preview.resolvedPath,
      mode: options.mode ?? "structured",
      parser: "structured",
      status: "ready",
      generatedAt: new Date().toISOString(),
      structuredSheets,
      structuredSheetCoverage: preview.sheetCoverage,
      warnings: [
        ...plan.warnings,
        ...(preview.sheetCoverage.hasMore
          ? [`Structured workbook preview shows ${preview.sheetCoverage.visibleSheets} visible sheets from ${preview.sheetCoverage.totalSheets} total; continue at sheetOffset=${preview.sheetCoverage.nextOffset} or use workbook_asset_plan before concluding the workbook is complete.`]
          : []),
      ],
    };
  } catch (error) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode: options.mode ?? "structured",
      parser: "structured",
      status: "error",
      generatedAt: new Date().toISOString(),
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function mineruAssetPreview(workspaceRoot: string, options: AssetParsePreviewOptions): Promise<AssetParsePreview> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    resolvedPath,
    mode: options.mode ?? "mineru",
    parser: "mineru",
    status: "unavailable",
    generatedAt: new Date().toISOString(),
    mineruBlocks: [],
    warnings: ["MinerU is disabled until a qualified managed backend is connected through the Document Router."],
  };

}

export function compareAssetParses(structured: AssetParsePreview, mineru: AssetParsePreview): AssetParseComparison {
  const structuredSheets = structured.structuredSheets ?? [];
  const mineruBlocks = mineru.mineruBlocks ?? [];
  const mineruTables = mineruBlocks.filter((block) => block.blockType === "table");
  const structuredRowCount = structuredSheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  return {
    projectId: structured.projectId,
    assetPath: structured.assetPath,
    generatedAt: new Date().toISOString(),
    structuredStatus: structured.status,
    mineruStatus: mineru.status,
    structuredSheetCount: structuredSheets.length,
    mineruBlockCount: mineruBlocks.length,
    structuredRowCount,
    mineruTableBlockCount: mineruTables.length,
    structuredHeaders: structuredSheets.map((sheet) => ({ sheetName: sheet.sheetName, headers: sheet.headers })),
    mineruTableSamples: mineruTables.slice(0, 8).map((block) => ({ blockId: block.id, text: block.text.slice(0, 500) })),
    structuredOnlySheets: structuredSheets.map((sheet) => sheet.sheetName),
    mineruOnlyBlocks: mineruBlocks.slice(0, 16).map((block) => block.id),
    rowCountDelta: mineruTables.length ? structuredRowCount - mineruTables.length : undefined,
    warnings: uniqueStrings([
      ...(structured.status === "error" ? [`Structured parser failed: ${structured.error ?? "unknown error"}`] : []),
      ...(mineru.status !== "ready" ? [`MinerU parser is ${mineru.status}: ${mineru.error ?? mineru.warnings.join("; ")}`] : []),
      ...(structured.status === "ready" && mineru.status === "ready" ? ["Dual parse comparison is advisory. Confirm mappings before import."] : []),
    ]),
  };
}

export async function parseAsset(workspaceRoot: string, options: AssetParsePreviewOptions & { sheetOverrides?: WorkbookAssetSheetOverride[]; purpose?: AssetMappingPurpose }): Promise<AssetParseResult> {
  const mode: AssetParseMode = options.mode ?? "structured";
  const generatedAt = new Date().toISOString();
  if (mode === "manual") {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      warnings: ["Manual mapping mode selected. Confirm sheet roles and source/target columns before import."],
    };
  }
  if (mode === "structured") {
    const structuredPreview = await structuredAssetPreview(workspaceRoot, { ...options, mode });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      structuredPreview,
      warnings: structuredPreview.warnings,
    };
  }
  if (mode === "mineru") {
    const mineruPreview = await mineruAssetPreview(workspaceRoot, { ...options, mode });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      mineruPreview,
      warnings: mineruPreview.warnings,
    };
  }
  const [structuredPreview, mineruPreview] = await Promise.all([
    structuredAssetPreview(workspaceRoot, { ...options, mode }),
    mineruAssetPreview(workspaceRoot, { ...options, mode }),
  ]);
  const comparison = compareAssetParses(structuredPreview, mineruPreview);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    mode,
    generatedAt,
    structuredPreview,
    mineruPreview,
    comparison,
    warnings: comparison.warnings,
  };
}

function roleForPurpose(purpose: AssetMappingPurpose): Pick<AssetConfirmedMapping, "role" | "action" | "authorityTier"> {
  if (purpose === "tm" || purpose === "reference") {
    return { role: "reference", action: "index_reference", authorityTier: "reference" };
  }
  return { role: purpose === "glossary" ? "glossary" : "termbase", action: purpose === "glossary" ? "needs_mapping" : "import_terms", authorityTier: purpose === "glossary" ? "proposal_only" : "termbase" };
}

function actionNeedsColumnMapping(action: AssetConfirmedMapping["action"]): boolean {
  return action === "import_terms" || action === "needs_mapping";
}

function deterministicSuggestions(parse: AssetParseResult, purpose: AssetMappingPurpose): AssetMappingSuggestion[] {
  const role = roleForPurpose(purpose);
  const sheets = parse.structuredPreview?.structuredSheets ?? [];
  return sheets.flatMap((sheet) => {
    const candidates = sheet.mappingCandidates.length
      ? sheet.mappingCandidates
      : sheet.suggested.sourceColumn && sheet.suggested.targetColumn
        ? [{
            sheetName: sheet.sheetName,
            sourceColumn: sheet.suggested.sourceColumn,
            targetColumn: sheet.suggested.targetColumn,
            noteColumn: sheet.suggested.noteColumn,
            rowCount: sheet.rowCount,
            confidence: sheet.confidence,
            score: Math.round(sheet.confidence * 100),
            reason: sheet.reason,
            sampleRows: sheet.sampleRows,
          }]
        : [];
    return candidates.slice(0, 3).map((candidate): AssetMappingSuggestion => ({
      ...role,
      sheetName: candidate.sheetName,
      sourceColumn: candidate.sourceColumn,
      targetColumn: candidate.targetColumn,
      noteColumn: candidate.noteColumn,
      confidence: candidate.confidence,
      reason: candidate.reason,
      warnings: sheet.warnings,
      source: "deterministic",
      purpose,
      sourceEvidence: [
        `${candidate.sheetName}: ${candidate.sourceColumn} -> ${candidate.targetColumn}`,
        ...candidate.sampleRows.slice(0, 2).map((row) => row.join(" | ")),
      ],
    }));
  });
}

function buildMappingPrompt(parse: AssetParseResult, purpose: AssetMappingPurpose): string {
  const sheets = parse.structuredPreview?.structuredSheets ?? [];
  return [
    "You are assisting Linguist Agent asset import mapping.",
    `Purpose: ${purpose}`,
    `Return strict JSON: {"suggestions":[{"sheetName":"...","sourceColumn":"...","targetColumn":"...","noteColumn":"...","role":"${WORKBOOK_MAPPING_ROLES.join("|")}","action":"import_terms|needs_mapping|index_reference|resolve_term_history|import_term_delta","confidence":0.0,"reason":"..."}]}.`,
    "Do not invent sheet or column names. Only use headers listed below.",
    "For index_reference sheets, omit sourceColumn/targetColumn unless the sheet truly has bilingual source/target columns.",
    "",
    ...sheets.map((sheet) => [
      `Sheet: ${sheet.sheetName}`,
      `Headers: ${sheet.headers.join(" | ")}`,
      `Samples: ${sheet.sampleRows.slice(0, 3).map((row) => row.join(" | ")).join(" / ")}`,
      `Current deterministic action: ${sheet.action}`,
    ].join("\n")),
  ].join("\n");
}

function validateLlmSuggestions(raw: unknown, parse: AssetParseResult, purpose: AssetMappingPurpose): AssetMappingSuggestion[] {
  const rows = typeof raw === "object" && raw && Array.isArray((raw as { suggestions?: unknown[] }).suggestions)
    ? (raw as { suggestions: unknown[] }).suggestions
    : [];
  const sheets = new Map((parse.structuredPreview?.structuredSheets ?? []).map((sheet) => [sheet.sheetName, sheet]));
  const out: AssetMappingSuggestion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const sheetName = typeof item.sheetName === "string" ? item.sheetName : "";
    const sheet = sheets.get(sheetName);
    if (!sheet) continue;
    const action = typeof item.action === "string" && ["import_terms", "import_term_delta", "resolve_term_history", "index_reference", "needs_mapping"].includes(item.action)
      ? item.action as AssetConfirmedMapping["action"]
      : roleForPurpose(purpose).action;
    const role = typeof item.role === "string" && WORKBOOK_MAPPING_ROLES.includes(item.role as (typeof WORKBOOK_MAPPING_ROLES)[number])
      ? item.role as AssetConfirmedMapping["role"]
      : roleForPurpose(purpose).role;
    const sourceColumn = typeof item.sourceColumn === "string" && sheet.headers.includes(item.sourceColumn) ? item.sourceColumn : undefined;
    const targetColumn = typeof item.targetColumn === "string" && sheet.headers.includes(item.targetColumn) ? item.targetColumn : undefined;
    if (actionNeedsColumnMapping(action) && (!sourceColumn || !targetColumn)) continue;
    const confidence = typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.7;
    const noteColumn = typeof item.noteColumn === "string" && sheet.headers.includes(item.noteColumn) ? item.noteColumn : undefined;
    out.push({
      sheetName,
      role,
      action,
      authorityTier: authorityTierForWorkbookAction(action),
      sourceColumn,
      targetColumn,
      noteColumn,
      confidence,
      reason: typeof item.reason === "string" ? item.reason : "LLM-assisted mapping suggestion.",
      warnings: sheet.warnings,
      source: "llm",
      purpose,
      sourceEvidence: [`${sheetName}: ${sourceColumn} -> ${targetColumn}`],
    });
  }
  return out;
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export async function suggestAssetMappings(
  workspaceRoot: string,
  options: AssetParsePreviewOptions & {
    purpose?: AssetMappingPurpose;
    sheetOverrides?: WorkbookAssetSheetOverride[];
    askModel?: AskAssetMappingModel;
    assistantModel?: string;
  },
): Promise<AssetMappingSuggestionResult> {
  const purpose = options.purpose ?? "termbase";
  const parseMode = options.mode ?? "structured";
  const parse = await parseAsset(workspaceRoot, { ...options, mode: parseMode });
  const promptPreview = buildMappingPrompt(parse, purpose);
  const deterministic = deterministicSuggestions(parse, purpose);
  if (!options.askModel) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "not_configured",
      suggestions: deterministic,
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
    };
  }
  try {
    const raw = await options.askModel({ prompt: promptPreview, parse, purpose });
    const llm = validateLlmSuggestions(parseModelJson(raw), parse, purpose).map((suggestion) => ({
      ...suggestion,
      llmPromptPreview: promptPreview.slice(0, 4000),
    }));
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "ready",
      assistantModel: options.assistantModel,
      suggestions: [...llm, ...deterministic],
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
    };
  } catch (error) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "error",
      assistantModel: options.assistantModel,
      suggestions: deterministic,
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function columnMappingFromSuggestion(suggestion: AssetMappingSuggestion): AssetColumnMapping {
  return {
    sourceColumn: suggestion.sourceColumn,
    targetColumn: suggestion.targetColumn,
    noteColumn: suggestion.noteColumn,
    statusColumn: suggestion.statusColumn,
    categoryColumn: suggestion.categoryColumn,
    dateColumn: suggestion.dateColumn,
    commentColumn: suggestion.commentColumn,
  };
}
