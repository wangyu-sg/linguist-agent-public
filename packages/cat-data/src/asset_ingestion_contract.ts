import type { WorkbookAssetAction, WorkbookAssetRole } from "./workbook_asset_plan.js";
import type { WorkbookMappingCandidate, WorkbookPreview, WorkbookSheetCoverage } from "./workbook_mapping.js";

export type AssetParseMode = "structured" | "mineru" | "dual" | "manual";
export type AssetParserKind = "structured" | "mineru";
export type AssetParserStatus = "ready" | "unavailable" | "error";
export type AssetAuthorityTier = "termbase" | "term_history" | "style_guide" | "reference" | "proposal_only";
export type AssetMappingPurpose = "termbase" | "tm" | "glossary" | "reference";
export type MappingAssistantStatus = "not_configured" | "ready" | "error";

export interface AssetColumnMapping {
  sourceColumn?: string;
  targetColumn?: string;
  noteColumn?: string;
  statusColumn?: string;
  categoryColumn?: string;
  dateColumn?: string;
  commentColumn?: string;
}

export interface AssetConfirmedMapping extends AssetColumnMapping {
  sheetName: string;
  role: WorkbookAssetRole;
  action: WorkbookAssetAction;
  authorityTier: AssetAuthorityTier;
  confidence: number;
  reason: string;
  warnings?: string[];
}

export interface AssetStructuredSheet {
  sheetName: string;
  role: WorkbookAssetRole;
  action: WorkbookAssetAction;
  authorityTier: AssetAuthorityTier;
  rowCount: number;
  headers: string[];
  sampleRows: string[][];
  engine?: WorkbookPreview["engine"];
  suggested: AssetColumnMapping;
  confidence: number;
  reason: string;
  diagnostics: Array<{ label: string; value: string | number }>;
  warnings: string[];
  mappingCandidates: WorkbookMappingCandidate[];
  parserKind?: string;
  parserStatus?: "ready" | "candidate" | "skipped";
  typedRowCount?: number;
  candidateCount?: number;
  blockCount?: number;
  trace?: string[];
}

export type AssetMinerUBlockType = "heading" | "paragraph" | "table" | "list" | "image" | "unknown";

export interface AssetMinerUBlock {
  id: string;
  blockType: AssetMinerUBlockType;
  text: string;
  page?: number;
  confidence?: number;
  source: string;
}

export interface AssetParsePreview {
  projectId: string;
  assetPath: string;
  resolvedPath?: string;
  mode: AssetParseMode;
  parser: AssetParserKind;
  status: AssetParserStatus;
  generatedAt: string;
  structuredSheets?: AssetStructuredSheet[];
  structuredSheetCoverage?: WorkbookSheetCoverage;
  mineruBlocks?: AssetMinerUBlock[];
  warnings: string[];
  error?: string;
}

export interface AssetParseComparison {
  projectId: string;
  assetPath: string;
  generatedAt: string;
  structuredStatus: AssetParserStatus;
  mineruStatus: AssetParserStatus;
  structuredSheetCount: number;
  mineruBlockCount: number;
  structuredRowCount: number;
  mineruTableBlockCount: number;
  structuredHeaders: Array<{ sheetName: string; headers: string[] }>;
  mineruTableSamples: Array<{ blockId: string; text: string }>;
  structuredOnlySheets: string[];
  mineruOnlyBlocks: string[];
  rowCountDelta?: number;
  warnings: string[];
}

export interface AssetParseResult {
  projectId: string;
  assetPath: string;
  mode: AssetParseMode;
  generatedAt: string;
  structuredPreview?: AssetParsePreview;
  mineruPreview?: AssetParsePreview;
  comparison?: AssetParseComparison;
  warnings: string[];
}

export interface AssetParsePreviewOptions {
  projectId: string;
  assetPath: string;
  mode?: AssetParseMode;
  maxSheets?: number;
  sheetOffset?: number;
  sampleRows?: number;
}

export interface AssetMappingSuggestion extends AssetConfirmedMapping {
  source: "deterministic" | "llm" | "manual";
  purpose: AssetMappingPurpose;
  sourceEvidence: string[];
  llmPromptPreview?: string;
}

export interface AssetMappingSuggestionResult {
  projectId: string;
  assetPath: string;
  parseMode: AssetParseMode;
  purpose: AssetMappingPurpose;
  generatedAt: string;
  assistantStatus: MappingAssistantStatus;
  assistantModel?: string;
  suggestions: AssetMappingSuggestion[];
  promptPreview?: string;
  warnings: string[];
  error?: string;
}

export interface AssetMappingProfile {
  id: string;
  projectId: string;
  assetPath: string;
  parseMode: AssetParseMode;
  confirmedMappings: AssetConfirmedMapping[];
  parserEvidence: {
    structured?: Pick<AssetParsePreview, "status" | "generatedAt" | "warnings"> & { sheetCount?: number };
    mineru?: Pick<AssetParsePreview, "status" | "generatedAt" | "warnings"> & { blockCount?: number };
    comparison?: Pick<AssetParseComparison, "generatedAt" | "warnings" | "rowCountDelta">;
  };
  llmAssisted: boolean;
  confirmedBy: string;
  confirmedAt: string;
  warnings: string[];
}

export interface AssetMappingProfilesPayload {
  projectId: string;
  profiles: AssetMappingProfile[];
}

export function authorityTierForWorkbookAction(action: WorkbookAssetAction): AssetAuthorityTier {
  if (action === "import_terms") return "termbase";
  if (action === "resolve_term_history" || action === "import_term_delta") return "term_history";
  if (action === "index_reference") return "reference";
  return "proposal_only";
}
