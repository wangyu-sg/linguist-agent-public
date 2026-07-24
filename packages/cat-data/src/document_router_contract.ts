import type { DocumentEvidenceV1 } from "./document_capabilities.js";

export const DOCUMENT_ROUTER_SCHEMA_VERSION = 1;

export type DocumentBackendId =
  | "native-text"
  | "light-ocr"
  | "mineru-structured"
  | "unlimited-ocr-long-horizon"
  | "approved-remote-parser";

export type NormalizedDocumentBlockKind = "heading" | "paragraph" | "table" | "image" | "formula";

export interface DocumentBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DocumentBlockLocator =
  | { kind: "page"; page: number; bbox?: DocumentBoundingBox }
  | { kind: "cell"; sheet: string; cell: string }
  | { kind: "slide"; slide: number; bbox?: DocumentBoundingBox };

export interface DocumentBackendCapabilities {
  nativeText: boolean;
  ocr: boolean;
  layout: boolean;
  tables: boolean;
  formulas: boolean;
  multiPageReasoning: boolean;
}

export interface DocumentStagedInputRef {
  kind: "host-staged-file";
  id: string;
  sourceDigest: string;
}

export interface DocumentProbe {
  source: { sha256: string; mimeType: string };
  input: DocumentStagedInputRef;
  pages?: number[];
}

export interface DocumentParseRequest extends DocumentProbe {}

export type DocumentReadingOrderStatus = "verified" | "uncertain" | "unavailable";
export type DocumentLayoutComplexity = "simple" | "complex" | "unknown";

export interface DocumentBackendEstimate {
  supported: boolean;
  reason: string;
  pages: Array<{
    page: number;
    nativeTextCharacters: number;
    nativeTextCoverage: number;
    readingOrder: DocumentReadingOrderStatus;
    layoutComplexity: DocumentLayoutComplexity;
  }>;
}

export interface NormalizedDocumentBlockV1 {
  id: string;
  kind: NormalizedDocumentBlockKind;
  text?: string;
  locator: DocumentBlockLocator;
  readingOrder: number;
  provenance: {
    sourceDigest: string;
    backend: { id: DocumentBackendId; version: string; ocr: boolean };
    confidence?: number;
    userCorrected: boolean;
  };
}

export interface DocumentBackendParseResultV1 {
  schemaVersion: typeof DOCUMENT_ROUTER_SCHEMA_VERSION;
  source: { sha256: string; mimeType: string };
  blocks: NormalizedDocumentBlockV1[];
}

export interface DocumentBackend {
  id: DocumentBackendId;
  version: string;
  capabilities: DocumentBackendCapabilities;
  probe(input: DocumentProbe): Promise<DocumentBackendEstimate>;
  parse(input: DocumentParseRequest): Promise<DocumentBackendParseResultV1>;
}

export class DocumentRouterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRouterContractError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const BACKEND_IDS = new Set<DocumentBackendId>([
  "native-text",
  "light-ocr",
  "mineru-structured",
  "unlimited-ocr-long-horizon",
  "approved-remote-parser",
]);
const BLOCK_KINDS = new Set<NormalizedDocumentBlockKind>(["heading", "paragraph", "table", "image", "formula"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentRouterContractError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new DocumentRouterContractError(`${label} has unknown field ${key}.`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new DocumentRouterContractError(`${label} is missing required field ${key}.`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DocumentRouterContractError(`${label} must be a non-empty string.`);
  return value;
}

function digest(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!SHA256.test(parsed)) throw new DocumentRouterContractError(`${label} must be a lowercase SHA-256 digest.`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new DocumentRouterContractError(`${label} must be a positive integer.`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DocumentRouterContractError(`${label} must be a non-negative integer.`);
  return Number(value);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DocumentRouterContractError(`${label} must be finite.`);
  return value;
}

function parseBoundingBox(value: unknown, label: string): DocumentBoundingBox {
  const row = object(value, label);
  exactKeys(row, ["x", "y", "width", "height"], label);
  const width = finite(row.width, `${label}.width`);
  const height = finite(row.height, `${label}.height`);
  if (width <= 0 || height <= 0) throw new DocumentRouterContractError(`${label} width and height must be positive.`);
  return { x: finite(row.x, `${label}.x`), y: finite(row.y, `${label}.y`), width, height };
}

function parseLocator(value: unknown, label: string): DocumentBlockLocator {
  const row = object(value, label);
  const kind = string(row.kind, `${label}.kind`);
  if (kind === "page") {
    exactKeys(row, row.bbox === undefined ? ["kind", "page"] : ["kind", "page", "bbox"], label);
    return { kind, page: positiveInteger(row.page, `${label}.page`), ...(row.bbox === undefined ? {} : { bbox: parseBoundingBox(row.bbox, `${label}.bbox`) }) };
  }
  if (kind === "cell") {
    exactKeys(row, ["kind", "sheet", "cell"], label);
    return { kind, sheet: string(row.sheet, `${label}.sheet`), cell: string(row.cell, `${label}.cell`) };
  }
  if (kind === "slide") {
    exactKeys(row, row.bbox === undefined ? ["kind", "slide"] : ["kind", "slide", "bbox"], label);
    return { kind, slide: positiveInteger(row.slide, `${label}.slide`), ...(row.bbox === undefined ? {} : { bbox: parseBoundingBox(row.bbox, `${label}.bbox`) }) };
  }
  throw new DocumentRouterContractError(`${label}.kind is unsupported.`);
}

function parseBlock(value: unknown, sourceDigest: string, index: number): NormalizedDocumentBlockV1 {
  const label = `blocks[${index}]`;
  const row = object(value, label);
  exactKeys(row, row.text === undefined
    ? ["id", "kind", "locator", "readingOrder", "provenance"]
    : ["id", "kind", "text", "locator", "readingOrder", "provenance"], label);
  const kind = string(row.kind, `${label}.kind`) as NormalizedDocumentBlockKind;
  if (!BLOCK_KINDS.has(kind)) throw new DocumentRouterContractError(`${label}.kind is unsupported.`);
  const provenance = object(row.provenance, `${label}.provenance`);
  exactKeys(provenance, provenance.confidence === undefined
    ? ["sourceDigest", "backend", "userCorrected"]
    : ["sourceDigest", "backend", "confidence", "userCorrected"], `${label}.provenance`);
  const blockDigest = digest(provenance.sourceDigest, `${label}.provenance.sourceDigest`);
  if (blockDigest !== sourceDigest) throw new DocumentRouterContractError(`${label}.provenance.sourceDigest must match source.sha256.`);
  const backend = object(provenance.backend, `${label}.provenance.backend`);
  exactKeys(backend, ["id", "version", "ocr"], `${label}.provenance.backend`);
  const backendId = string(backend.id, `${label}.provenance.backend.id`) as DocumentBackendId;
  if (!BACKEND_IDS.has(backendId)) throw new DocumentRouterContractError(`${label}.provenance.backend.id is unsupported.`);
  if (typeof backend.ocr !== "boolean") throw new DocumentRouterContractError(`${label}.provenance.backend.ocr must be boolean.`);
  if (typeof provenance.userCorrected !== "boolean") throw new DocumentRouterContractError(`${label}.provenance.userCorrected must be boolean.`);
  const confidence = provenance.confidence === undefined ? undefined : finite(provenance.confidence, `${label}.provenance.confidence`);
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) throw new DocumentRouterContractError(`${label}.provenance.confidence must be between zero and one.`);
  return {
    id: string(row.id, `${label}.id`),
    kind,
    ...(row.text === undefined ? {} : { text: string(row.text, `${label}.text`) }),
    locator: parseLocator(row.locator, `${label}.locator`),
    readingOrder: positiveInteger(row.readingOrder, `${label}.readingOrder`),
    provenance: {
      sourceDigest: blockDigest,
      backend: { id: backendId, version: string(backend.version, `${label}.provenance.backend.version`), ocr: backend.ocr },
      ...(confidence === undefined ? {} : { confidence }),
      userCorrected: provenance.userCorrected,
    },
  };
}

function parseSource(value: unknown, label: string): { sha256: string; mimeType: string } {
  const source = object(value, label);
  exactKeys(source, ["sha256", "mimeType"], label);
  return {
    sha256: digest(source.sha256, `${label}.sha256`),
    mimeType: string(source.mimeType, `${label}.mimeType`),
  };
}

function parseStagedDocumentRequest(value: unknown, label: string): DocumentParseRequest {
  const row = object(value, label);
  exactKeys(row, row.pages === undefined ? ["source", "input"] : ["source", "input", "pages"], label);
  const source = parseSource(row.source, `${label}.source`);
  const input = object(row.input, `${label}.input`);
  exactKeys(input, ["kind", "id", "sourceDigest"], `${label}.input`);
  if (input.kind !== "host-staged-file") throw new DocumentRouterContractError(`${label}.input.kind is unsupported.`);
  const sourceDigest = digest(input.sourceDigest, `${label}.input.sourceDigest`);
  if (sourceDigest !== source.sha256) throw new DocumentRouterContractError(`${label}.input.sourceDigest must match source.sha256.`);
  const pages = row.pages === undefined
    ? undefined
    : (() => {
        if (!Array.isArray(row.pages)) throw new DocumentRouterContractError(`${label}.pages must be an array.`);
        const parsed = row.pages.map((page, index) => positiveInteger(page, `${label}.pages[${index}]`));
        if (new Set(parsed).size !== parsed.length) throw new DocumentRouterContractError(`${label}.pages must not repeat a page.`);
        return parsed;
      })();
  return { source, input: { kind: "host-staged-file", id: string(input.id, `${label}.input.id`), sourceDigest }, ...(pages === undefined ? {} : { pages }) };
}

export function parseDocumentParseRequest(value: unknown): DocumentParseRequest {
  return parseStagedDocumentRequest(value, "Document parse request");
}

export function parseDocumentProbe(value: unknown): DocumentProbe {
  return parseStagedDocumentRequest(value, "Document probe");
}

export function parseDocumentBackendEstimate(value: unknown): DocumentBackendEstimate {
  const row = object(value, "Document backend estimate");
  exactKeys(row, ["supported", "reason", "pages"], "Document backend estimate");
  if (typeof row.supported !== "boolean") throw new DocumentRouterContractError("Document backend estimate.supported must be boolean.");
  if (!Array.isArray(row.pages)) throw new DocumentRouterContractError("Document backend estimate.pages must be an array.");
  const pages = row.pages.map((value, index) => {
    const label = `Document backend estimate.pages[${index}]`;
    const page = object(value, label);
    exactKeys(page, ["page", "nativeTextCharacters", "nativeTextCoverage", "readingOrder", "layoutComplexity"], label);
    const coverage = finite(page.nativeTextCoverage, `${label}.nativeTextCoverage`);
    if (coverage < 0 || coverage > 1) throw new DocumentRouterContractError(`${label}.nativeTextCoverage must be between zero and one.`);
    const readingOrder = string(page.readingOrder, `${label}.readingOrder`) as DocumentReadingOrderStatus;
    if (!["verified", "uncertain", "unavailable"].includes(readingOrder)) throw new DocumentRouterContractError(`${label}.readingOrder is unsupported.`);
    const layoutComplexity = string(page.layoutComplexity, `${label}.layoutComplexity`) as DocumentLayoutComplexity;
    if (!["simple", "complex", "unknown"].includes(layoutComplexity)) throw new DocumentRouterContractError(`${label}.layoutComplexity is unsupported.`);
    return {
      page: positiveInteger(page.page, `${label}.page`),
      nativeTextCharacters: nonNegativeInteger(page.nativeTextCharacters, `${label}.nativeTextCharacters`),
      nativeTextCoverage: coverage,
      readingOrder,
      layoutComplexity,
    };
  });
  if (new Set(pages.map((page) => page.page)).size !== pages.length) throw new DocumentRouterContractError("Document backend estimate.pages must not repeat a page.");
  return { supported: row.supported, reason: string(row.reason, "Document backend estimate.reason"), pages };
}

export function parseDocumentBackendResult(value: unknown): DocumentBackendParseResultV1 {
  const row = object(value, "Document backend result");
  exactKeys(row, ["schemaVersion", "source", "blocks"], "Document backend result");
  if (row.schemaVersion !== DOCUMENT_ROUTER_SCHEMA_VERSION) throw new DocumentRouterContractError("Document backend result has an unsupported schema version.");
  const source = parseSource(row.source, "Document backend result.source");
  if (!Array.isArray(row.blocks)) throw new DocumentRouterContractError("Document backend result.blocks must be an array.");
  const blocks = row.blocks.map((block, index) => parseBlock(block, source.sha256, index));
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) throw new DocumentRouterContractError("Document backend result has duplicate block ids.");
  return { schemaVersion: DOCUMENT_ROUTER_SCHEMA_VERSION, source, blocks };
}

function backendForEvidence(route: DocumentEvidenceV1["extraction"]["route"]): DocumentBackendId {
  switch (route) {
    case "text-layer": return "native-text";
    case "paddleocr": return "light-ocr";
    case "mineru": return "mineru-structured";
  }
}

export function normalizeDocumentEvidence(evidence: DocumentEvidenceV1): DocumentBackendParseResultV1 {
  const backendId = backendForEvidence(evidence.extraction.route);
  const ocr = evidence.extraction.route !== "text-layer";
  return parseDocumentBackendResult({
    schemaVersion: DOCUMENT_ROUTER_SCHEMA_VERSION,
    source: { sha256: evidence.source.sha256, mimeType: evidence.source.mimeType },
    blocks: evidence.pages.flatMap((page) => page.blocks.map((block, index) => ({
      id: `${evidence.source.sha256}:page:${page.page}:block:${index + 1}`,
      kind: "paragraph" as const,
      text: block.text,
      locator: { kind: "page" as const, page: page.page, bbox: { ...block.bbox } },
      readingOrder: index + 1,
      provenance: {
        sourceDigest: evidence.source.sha256,
        backend: { id: backendId, version: evidence.extraction.runtimeVersion, ocr },
        confidence: block.confidence,
        userCorrected: false,
      },
    }))),
  });
}
