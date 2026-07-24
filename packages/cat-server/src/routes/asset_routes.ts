import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AskAssetMappingModel,
  AskTypedWorkbookModel,
  AssetConfirmedMapping,
  AssetMappingProfile,
  AssetMappingPurpose,
  AssetParseMode,
  AssetTypedIndex,
} from "@linguist-agent/cat-data";

type ManifestAsset = {
  relPath: string;
  role: string;
  confidence: number;
  sizeBytes: number;
  reasons?: string[];
  metrics?: unknown;
};

type ManifestDecision = {
  relPath: string;
  role: string;
  confidence: number;
  status: "inferred" | "confirmed";
  reasons: string[];
};

type ProjectManifestLike = {
  sourceLanguage?: string;
  targetLanguage?: string;
  scan?: { assets?: ManifestAsset[] };
  assetRoleDecisions?: ManifestDecision[];
};

export interface AssetRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  optionalBoolean: (value: unknown) => boolean | undefined;
  readProjectManifest: (repoRoot: string, projectId: string) => Promise<ProjectManifestLike>;
  planWorkbookAssetImport: (repoRoot: string, input: {
    projectId: string;
    assetPath: string;
    sampleRows?: number;
    sheetOverrides?: WorkbookSheetOverrideInput[];
    parseMode?: AssetParseMode;
    mappingProfileId?: string;
    confirmedMappings?: AssetConfirmedMapping[];
  }) => Promise<unknown>;
  importWorkbookAssetPlan: (
    repoRoot: string,
    input: {
      projectId: string;
      assetPath: string;
      append?: boolean;
      srcLang?: string;
      tgtLang?: string;
      sheetOverrides?: WorkbookSheetOverrideInput[];
      parseMode?: AssetParseMode;
      mappingProfileId?: string;
      confirmedMappings?: AssetConfirmedMapping[];
      confirmedTypedCandidateIds?: string[];
    },
  ) => Promise<unknown>;
  parseAsset: (repoRoot: string, input: {
    projectId: string;
    assetPath: string;
    mode?: AssetParseMode;
    maxSheets?: number;
    sheetOffset?: number;
    sampleRows?: number;
    sheetOverrides?: WorkbookSheetOverrideInput[];
    purpose?: AssetMappingPurpose;
  }) => Promise<unknown>;
  suggestAssetMappings: (repoRoot: string, input: {
    projectId: string;
    assetPath: string;
    mode?: AssetParseMode;
    maxSheets?: number;
    sheetOffset?: number;
    sampleRows?: number;
    sheetOverrides?: WorkbookSheetOverrideInput[];
    purpose?: AssetMappingPurpose;
    askModel?: AskAssetMappingModel;
    assistantModel?: string;
  }) => Promise<unknown>;
  askAssetMappingModelForProject?: (projectId: string) => Promise<{
    askModel: AskAssetMappingModel;
    assistantModel?: string;
  } | undefined>;
  parseWorkbookTypedAsset: (repoRoot: string, input: {
    projectId: string;
    assetPath: string;
    sheetOverrides?: WorkbookSheetOverrideInput[];
    askModel?: AskTypedWorkbookModel;
  }) => Promise<AssetTypedIndex>;
  readAssetTypedIndex: (repoRoot: string, projectId: string) => Promise<AssetTypedIndex | undefined>;
  confirmTypedAssetCandidates: (repoRoot: string, input: { projectId: string; candidateIds: string[]; append?: boolean; srcLang?: string; tgtLang?: string }) => Promise<unknown>;
  readAssetMappingProfiles: (repoRoot: string, projectId: string) => Promise<unknown>;
  saveAssetMappingProfile: (
    repoRoot: string,
    input: Omit<AssetMappingProfile, "id" | "confirmedAt"> & { id?: string; confirmedAt?: string },
  ) => Promise<unknown>;
  readTermHistoryIndex: (repoRoot: string, projectId: string) => Promise<unknown>;
  readTermbaseEntries: (repoRoot: string, projectId: string) => Promise<any[]>;
  readTermbaseOverrides: (repoRoot: string, projectId: string) => Promise<any[]>;
  auditTermbaseConflicts: (entries: any[], overrides: any[], history?: any) => unknown[];
  upsertTermbaseOverride: (
    repoRoot: string,
    projectId: string,
    override: { source: string; target: string; srcLang?: string; tgtLang?: string; reason?: string; decidedBy?: string },
  ) => Promise<unknown>;
  grepAssets: (repoRoot: string, input: { projectId: string; query: string; limit?: number }) => Promise<unknown>;
  readAssetText: (repoRoot: string, input: { projectId: string; assetPath: string; maxChars?: number }) => Promise<unknown>;
  readWorkbookNativePreview: (repoRoot: string, input: { projectId: string; assetPath: string }) => Promise<unknown>;
  readWorkbookSheetPage: (repoRoot: string, input: { projectId: string; assetPath: string; sheetName?: string; offset?: number; limit?: number }) => Promise<unknown>;
}

type WorkbookSheetOverrideInput = {
  sheetName: string;
  role: AssetConfirmedMapping["role"];
  action?: "import_terms" | "import_term_delta" | "resolve_term_history" | "index_reference" | "needs_mapping";
  reason?: string;
};

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

function assetKind(relPath: string): "workbook" | "document" | "memory" | "other" {
  const ext = relPath.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (["xlsx", "xls", "csv", "tsv"].includes(ext)) return "workbook";
  if (["docx", "md", "txt", "pdf"].includes(ext)) return "document";
  if (["tmx", "sdltm", "tbx", "sdltb"].includes(ext)) return "memory";
  return "other";
}

function sheetOverrides(value: unknown): WorkbookSheetOverrideInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("sheetOverrides must be an array.");
  return value.map((item, index): WorkbookSheetOverrideInput => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`sheetOverrides[${index}] must be an object.`);
    const row = item as Record<string, unknown>;
    if (typeof row.sheetName !== "string" || typeof row.role !== "string") throw new Error(`sheetOverrides[${index}] requires sheetName and role.`);
    if (!WORKBOOK_MAPPING_ROLES.includes(row.role as (typeof WORKBOOK_MAPPING_ROLES)[number])) throw new Error(`sheetOverrides[${index}].role is invalid.`);
    const action = typeof row.action === "string" && ["import_terms", "import_term_delta", "resolve_term_history", "index_reference", "needs_mapping"].includes(row.action)
      ? row.action as WorkbookSheetOverrideInput["action"]
      : row.action === undefined ? undefined : (() => { throw new Error(`sheetOverrides[${index}].action is invalid.`); })();
    return {
      sheetName: row.sheetName,
      role: row.role as WorkbookSheetOverrideInput["role"],
      action,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  });
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error("Expected an array of non-empty strings.");
  }
  return value.map((item) => item.trim());
}

function parseMode(value: unknown, fallback: AssetParseMode = "structured"): AssetParseMode {
  return typeof value === "string" && ["structured", "mineru", "dual", "manual"].includes(value)
    ? value as AssetParseMode
    : fallback;
}

function mappingPurpose(value: unknown): AssetMappingPurpose | undefined {
  return typeof value === "string" && ["termbase", "tm", "glossary", "reference"].includes(value)
    ? value as AssetMappingPurpose
    : undefined;
}

type AssetSearchHit = {
  id: string;
  kind: string;
  relPath: string;
  lineNo?: number;
  source?: string;
  target?: string;
  text: string;
  detail?: string;
  role?: string;
  sheetName?: string;
};

type AssetSearchGroup = {
  id: string;
  title: string;
  kind: string;
  count: number;
  hits: AssetSearchHit[];
};

function normalizedSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function searchMatches(row: unknown, needle: string): boolean {
  if (!needle) return true;
  if (typeof row === "string") return normalizedSearchText(row).includes(needle);
  if (!row || typeof row !== "object") return false;
  return Object.values(row as Record<string, unknown>).some((value) => {
    if (typeof value === "string") return normalizedSearchText(value).includes(needle);
    if (Array.isArray(value)) return value.some((item) => searchMatches(item, needle));
    if (value && typeof value === "object") return searchMatches(value, needle);
    return false;
  });
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function sourceLabelForAsset(asset: ManifestAsset): string {
  return [asset.role, assetKind(asset.relPath)].filter(Boolean).join(" · ");
}

function groupFromHits(id: string, title: string, kind: string, hits: AssetSearchHit[]): AssetSearchGroup {
  return { id, title, kind, count: hits.length, hits };
}

async function buildAssetSearchPayload(projectId: string, deps: AssetRouteDeps, query: string, limit: number) {
  const needle = normalizedSearchText(query);
  const manifest = await deps.readProjectManifest(deps.repoRoot, projectId);
  const assets = manifest.scan?.assets ?? [];
  const fileHitsRaw = await deps.grepAssets(deps.repoRoot, { projectId, query, limit });
  const fileHits = Array.isArray(fileHitsRaw) ? fileHitsRaw.flatMap((item, index): AssetSearchHit[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const relPath = textValue(row.relPath) ?? textValue(row.path);
    const text = textValue(row.text) ?? textValue(row.line) ?? "";
    if (!relPath) return [];
    return [{
      id: textValue(row.id) ?? `file:${relPath}:${row.lineNo ?? index}`,
      kind: "file",
      relPath,
      lineNo: optionalNumber(row.lineNo),
      text,
      detail: textValue(row.detail),
    }];
  }) : [];

  const termbaseHits = (await deps.readTermbaseEntries(deps.repoRoot, projectId))
    .filter((entry) => searchMatches(entry, needle))
    .slice(0, limit)
    .map((entry, index): AssetSearchHit => ({
      id: textValue(entry.id) ?? `termbase:${entry.source}:${entry.target}:${index}`,
      kind: "termbase",
      relPath: textValue(entry.sourceFile) ?? "termbase",
      lineNo: optionalNumber(entry.rowNo),
      source: textValue(entry.source),
      target: textValue(entry.target),
      text: [entry.source, entry.target].filter(Boolean).join(" -> "),
      detail: [entry.note, entry.origin, entry.sheetName].filter(Boolean).join(" · "),
      role: "termbase",
      sheetName: textValue(entry.sheetName),
    }));

  const typedIndex = await deps.readAssetTypedIndex(deps.repoRoot, projectId);
  const typedHits = (typedIndex?.rows ?? [])
    .filter((row) => searchMatches(row, needle))
    .slice(0, limit)
    .map((row): AssetSearchHit => ({
      id: `typed:${row.id}`,
      kind: row.kind ?? "reference",
      relPath: row.assetPath ?? typedIndex?.assetPath ?? "typed-index",
      lineNo: optionalNumber(row.rowNo),
      source: textValue(row.source) ?? textValue(row.question) ?? textValue(row.issue),
      target: textValue(row.target) ?? textValue(row.answer) ?? textValue(row.guidance),
      text: textValue(row.text) ?? [row.source, row.target, row.note, row.guidance].filter(Boolean).join(" "),
      detail: [row.role, row.action, row.authorityTier, row.sheetName].filter(Boolean).join(" · "),
      role: textValue(row.role),
      sheetName: textValue(row.sheetName),
    }));

  const sourceRows = assets.map((asset) => ({
    id: asset.relPath,
    kind: assetKind(asset.relPath),
    relPath: asset.relPath,
    role: asset.role,
    text: sourceLabelForAsset(asset),
    detail: asset.reasons?.join(" · ") ?? "",
    sizeBytes: asset.sizeBytes,
  }));

  return {
    projectId,
    query,
    sources: sourceRows,
    hits: fileHits,
    groups: [
      groupFromHits("files", "Files", "file", fileHits),
      groupFromHits("termbase", "Termbase", "termbase", termbaseHits),
      groupFromHits("typed", "Workbook / reference", "typed", typedHits),
    ],
  };
}

function confirmedMappings(value: unknown): AssetConfirmedMapping[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("confirmedMappings must be an array.");
  return value.map((item, index): AssetConfirmedMapping => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`confirmedMappings[${index}] must be an object.`);
    const row = item as Record<string, unknown>;
    if (typeof row.sheetName !== "string") throw new Error(`confirmedMappings[${index}].sheetName is required.`);
    if (typeof row.role !== "string" || !WORKBOOK_MAPPING_ROLES.includes(row.role as (typeof WORKBOOK_MAPPING_ROLES)[number])) throw new Error(`confirmedMappings[${index}].role is invalid.`);
    if (typeof row.action !== "string" || !["import_terms", "import_term_delta", "resolve_term_history", "index_reference", "needs_mapping"].includes(row.action)) throw new Error(`confirmedMappings[${index}].action is invalid.`);
    if (typeof row.authorityTier !== "string" || !["termbase", "term_history", "style_guide", "reference", "proposal_only"].includes(row.authorityTier)) throw new Error(`confirmedMappings[${index}].authorityTier is invalid.`);
    if (row.confidence !== undefined && (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) throw new Error(`confirmedMappings[${index}].confidence must be between 0 and 1.`);
    const confidence = row.confidence ?? 0.7;
    const warnings = row.warnings === undefined
      ? undefined
      : (() => {
        if (!Array.isArray(row.warnings) || !row.warnings.every((warning) => typeof warning === "string")) throw new Error(`confirmedMappings[${index}].warnings must be an array of strings.`);
        return row.warnings;
      })();
    return {
      sheetName: row.sheetName,
      role: row.role as AssetConfirmedMapping["role"],
      action: row.action as AssetConfirmedMapping["action"],
      authorityTier: row.authorityTier as AssetConfirmedMapping["authorityTier"],
      confidence,
      reason: typeof row.reason === "string" ? row.reason : "Confirmed mapping.",
      sourceColumn: typeof row.sourceColumn === "string" ? row.sourceColumn : undefined,
      targetColumn: typeof row.targetColumn === "string" ? row.targetColumn : undefined,
      noteColumn: typeof row.noteColumn === "string" ? row.noteColumn : undefined,
      statusColumn: typeof row.statusColumn === "string" ? row.statusColumn : undefined,
      categoryColumn: typeof row.categoryColumn === "string" ? row.categoryColumn : undefined,
      dateColumn: typeof row.dateColumn === "string" ? row.dateColumn : undefined,
      commentColumn: typeof row.commentColumn === "string" ? row.commentColumn : undefined,
      warnings,
    };
  });
}

export async function handleAssetRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: AssetRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "assets") return false;

  if (parts.length === 4 && req.method === "GET") {
    const manifest = await deps.readProjectManifest(deps.repoRoot, projectId);
    const decisions = new Map((manifest.assetRoleDecisions ?? []).map((decision) => [decision.relPath, decision]));
    const assets = (manifest.scan?.assets ?? []).map((asset) => {
      const decision = decisions.get(asset.relPath);
      return {
        ...asset,
        kind: assetKind(asset.relPath),
        selectedRole: decision?.role ?? asset.role,
        roleStatus: decision?.status ?? "inferred",
        roleReasons: decision?.reasons ?? asset.reasons ?? [],
      };
    });
    deps.json(res, 200, {
      projectId,
      sourceLanguage: manifest.sourceLanguage,
      targetLanguage: manifest.targetLanguage,
      assets,
    });
    return true;
  }

  if (parts[4] === "search" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const query = url.searchParams.get("q") ?? "";
    deps.json(res, 200, await buildAssetSearchPayload(projectId, deps, query, optionalNumber(url.searchParams.get("limit")) ?? 40));
    return true;
  }

  if (parts[4] === "read" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    deps.json(res, 200, await deps.readAssetText(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(url.searchParams.get("path"), "path"),
      maxChars: optionalNumber(url.searchParams.get("maxChars")) ?? 24000,
    }));
    return true;
  }

  if (parts[4] === "workbook-preview" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    deps.json(res, 200, await deps.readWorkbookNativePreview(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(url.searchParams.get("path"), "path"),
    }));
    return true;
  }

  if (parts[4] === "workbook-rows" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    deps.json(res, 200, await deps.readWorkbookSheetPage(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(url.searchParams.get("path"), "path"),
      sheetName: deps.optionalString(url.searchParams.get("sheetName")),
      offset: optionalNumber(url.searchParams.get("offset")) ?? 0,
      limit: optionalNumber(url.searchParams.get("limit")) ?? 200,
    }));
    return true;
  }

  if ((parts[4] === "parse-preview" || parts[4] === "parse-compare") && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const mode = parts[4] === "parse-compare" ? "dual" : parseMode(body.mode);
    deps.json(res, 200, await deps.parseAsset(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      mode,
      maxSheets: optionalNumber(body.maxSheets),
      sheetOffset: optionalNumber(body.sheetOffset),
      sampleRows: optionalNumber(body.sampleRows),
      sheetOverrides: sheetOverrides(body.sheetOverrides),
      purpose: mappingPurpose(body.purpose),
    }));
    return true;
  }

  if (parts[4] === "typed-preview" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const model = deps.optionalBoolean(body.llmAssisted) === false ? undefined : await deps.askAssetMappingModelForProject?.(projectId);
    deps.json(res, 200, await deps.parseWorkbookTypedAsset(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      sheetOverrides: sheetOverrides(body.sheetOverrides),
      askModel: model ? async ({ prompt, evidence }) => model.askModel({
        prompt,
        parse: {
          projectId,
          assetPath: evidence.assetPath,
          mode: "structured",
          generatedAt: evidence.generatedAt,
          structuredPreview: {
            projectId,
            assetPath: evidence.assetPath,
            mode: "structured",
            parser: "structured",
            status: "ready",
            generatedAt: evidence.generatedAt,
            structuredSheets: [],
            warnings: evidence.warnings,
          },
          warnings: evidence.warnings,
        },
        purpose: "reference",
      }) : undefined,
    }));
    return true;
  }

  if (parts[4] === "typed-index" && req.method === "GET") {
    deps.json(res, 200, await deps.readAssetTypedIndex(deps.repoRoot, projectId) ?? {
      schemaVersion: 1,
      projectId,
      assetPath: "",
      generatedAt: new Date().toISOString(),
      sheets: [],
      rows: [],
      summary: { typedRows: 0, candidateRows: 0, referenceRows: 0, blocks: 0 },
      warnings: [],
    });
    return true;
  }

  if (parts[4] === "typed-confirm" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.confirmTypedAssetCandidates(deps.repoRoot, {
      projectId,
      candidateIds: stringArray(body.candidateIds),
      append: deps.optionalBoolean(body.append),
      srcLang: deps.optionalString(body.srcLang),
      tgtLang: deps.optionalString(body.tgtLang),
    }));
    return true;
  }

  if (parts[4] === "mapping-suggestions" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const model = await deps.askAssetMappingModelForProject?.(projectId);
    deps.json(res, 200, await deps.suggestAssetMappings(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      mode: parseMode(body.parseMode ?? body.mode),
      maxSheets: optionalNumber(body.maxSheets),
      sheetOffset: optionalNumber(body.sheetOffset),
      sampleRows: optionalNumber(body.sampleRows),
      sheetOverrides: sheetOverrides(body.sheetOverrides),
      purpose: mappingPurpose(body.purpose),
      askModel: model?.askModel,
      assistantModel: model?.assistantModel,
    }));
    return true;
  }

  if (parts[4] === "mapping-profiles" && req.method === "GET") {
    deps.json(res, 200, await deps.readAssetMappingProfiles(deps.repoRoot, projectId));
    return true;
  }

  if (parts[4] === "mapping-profiles" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const mappings = confirmedMappings(body.confirmedMappings) ?? [];
    deps.json(res, 200, await deps.saveAssetMappingProfile(deps.repoRoot, {
      id: deps.optionalString(body.id),
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      parseMode: parseMode(body.parseMode ?? body.mode),
      confirmedMappings: mappings,
      parserEvidence: typeof body.parserEvidence === "object" && body.parserEvidence ? body.parserEvidence as AssetMappingProfile["parserEvidence"] : {},
      llmAssisted: deps.optionalBoolean(body.llmAssisted) ?? mappings.some((mapping) => mapping.reason.toLocaleLowerCase().includes("llm")),
      confirmedBy: deps.optionalString(body.confirmedBy) ?? "user",
      warnings: body.warnings === undefined
        ? []
        : (() => {
          if (!Array.isArray(body.warnings) || !body.warnings.every((warning) => typeof warning === "string")) throw new Error("warnings must be an array of strings.");
          return body.warnings;
        })(),
    }));
    return true;
  }

  if (parts[4] === "workbook-plan" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const sampleRows = Number(body.sampleRows ?? 3);
    deps.json(res, 200, await deps.planWorkbookAssetImport(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      sampleRows: Number.isFinite(sampleRows) ? sampleRows : 3,
      sheetOverrides: sheetOverrides(body.sheetOverrides),
      parseMode: parseMode(body.parseMode ?? body.mode),
      mappingProfileId: deps.optionalString(body.mappingProfileId),
      confirmedMappings: confirmedMappings(body.confirmedMappings),
    }));
    return true;
  }

  if (parts[4] === "workbook-import" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.importWorkbookAssetPlan(deps.repoRoot, {
      projectId,
      assetPath: deps.requireString(body.assetPath, "assetPath"),
      append: deps.optionalBoolean(body.append),
      srcLang: deps.optionalString(body.srcLang),
      tgtLang: deps.optionalString(body.tgtLang),
      sheetOverrides: sheetOverrides(body.sheetOverrides),
      parseMode: parseMode(body.parseMode ?? body.mode),
      mappingProfileId: deps.optionalString(body.mappingProfileId),
      confirmedMappings: confirmedMappings(body.confirmedMappings),
      confirmedTypedCandidateIds: stringArray(body.confirmedTypedCandidateIds),
    }));
    return true;
  }

  if (parts[4] === "termbase-conflicts" && req.method === "GET") {
    const [entries, overrides, history] = await Promise.all([
      deps.readTermbaseEntries(deps.repoRoot, projectId),
      deps.readTermbaseOverrides(deps.repoRoot, projectId),
      deps.readTermHistoryIndex(deps.repoRoot, projectId),
    ]);
    deps.json(res, 200, {
      projectId,
      conflicts: deps.auditTermbaseConflicts(entries, overrides, history),
      overrideCount: overrides.length,
    });
    return true;
  }

  if (parts[4] === "term-history" && req.method === "GET") {
    const history = await deps.readTermHistoryIndex(deps.repoRoot, projectId) as Record<string, unknown>;
    deps.json(res, 200, {
      projectId,
      ...history,
    });
    return true;
  }

  if (parts[4] === "termbase-overrides" && req.method === "GET") {
    deps.json(res, 200, { projectId, overrides: await deps.readTermbaseOverrides(deps.repoRoot, projectId) });
    return true;
  }

  if (parts[4] === "termbase-overrides" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const manifest = await deps.readProjectManifest(deps.repoRoot, projectId);
    deps.json(res, 200, await deps.upsertTermbaseOverride(deps.repoRoot, projectId, {
      source: deps.requireString(body.source, "source"),
      target: deps.requireString(body.target, "target"),
      srcLang: deps.optionalString(body.srcLang) ?? manifest.sourceLanguage,
      tgtLang: deps.optionalString(body.tgtLang) ?? manifest.targetLanguage,
      reason: deps.optionalString(body.reason),
      decidedBy: deps.optionalString(body.decidedBy),
    }));
    return true;
  }

  return false;
}
