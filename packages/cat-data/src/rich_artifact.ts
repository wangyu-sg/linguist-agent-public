export const RICH_ARTIFACT_SCHEMA_VERSION = 1 as const;

export interface DocumentEvidenceRichArtifactInput {
  source: { path: string; sha256: string; mimeType: string };
  extraction: {
    route: "text-layer" | "paddleocr" | "mineru";
    runtimeVersion: string;
    modelVersions: Record<string, string>;
    createdAt: string;
  };
  pages: Array<{
    page: number;
    width: number;
    height: number;
    blocks: Array<{ polygon: Array<[number, number]>; text: string; confidence: number }>;
  }>;
}

export interface OfficeRichArtifactInput {
  ok: true;
  sourcePath?: string;
  sourcePaths?: string[];
  sourceSha256?: string;
  sourceDigests?: Array<{ path: string; sha256: string }>;
  outputPath?: string;
  outputSha256?: string;
  result?: unknown;
  diff?: unknown;
  validation?: unknown;
}

export interface MineruRichArtifactInput {
  sourcePath: string;
  sourceSha256: string;
  outputDirectory: string;
  files: Array<{ path: string; sha256: string; sizeBytes: number; kind?: "file" | "symlink" }>;
}

export type RichArtifactFileRole = "source" | "output" | "reference";
export type RichArtifactTableValue = string | number | boolean | null;

export interface RichArtifactFileReferenceV1 {
  path: string;
  label: string;
  role: RichArtifactFileRole;
  mimeType?: string;
  sha256?: string;
}

export interface RichArtifactMarkdownBlockV1 {
  id: string;
  type: "markdown";
  markdown: string;
}

export interface RichArtifactTableBlockV1 {
  id: string;
  type: "table";
  caption?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "center" | "right" }>;
  rows: Array<Record<string, RichArtifactTableValue>>;
}

export interface RichArtifactChartBlockV1 {
  id: string;
  type: "chart";
  caption?: string;
  kind: "bar" | "line" | "pie";
  series: Array<{
    label: string;
    points: Array<{ label: string; value: number }>;
  }>;
}

export interface RichArtifactImageBlockV1 {
  id: string;
  type: "image";
  file: RichArtifactFileReferenceV1;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface RichArtifactPageOverlayBlockV1 {
  id: string;
  type: "page_overlay";
  page: number;
  width: number;
  height: number;
  background?: RichArtifactFileReferenceV1;
  regions: Array<{
    polygon: Array<[number, number]>;
    label?: string;
    confidence?: number;
  }>;
}

export interface RichArtifactDiffBlockV1 {
  id: string;
  type: "diff";
  label?: string;
  before?: string;
  after?: string;
  patch?: string;
}

export interface RichArtifactFileReferenceBlockV1 {
  id: string;
  type: "file_reference";
  file: RichArtifactFileReferenceV1;
}

export type RichArtifactBlockV1 =
  | RichArtifactMarkdownBlockV1
  | RichArtifactTableBlockV1
  | RichArtifactChartBlockV1
  | RichArtifactImageBlockV1
  | RichArtifactPageOverlayBlockV1
  | RichArtifactDiffBlockV1
  | RichArtifactFileReferenceBlockV1;

export interface RichArtifactDocumentV1 {
  schemaVersion: typeof RICH_ARTIFACT_SCHEMA_VERSION;
  title: string;
  createdAt: string;
  generator: string;
  blocks: RichArtifactBlockV1[];
}

const BLOCK_TYPES = ["markdown", "table", "chart", "image", "page_overlay", "diff", "file_reference"] as const;
const FILE_ROLES = ["source", "output", "reference"] as const;
const CHART_KINDS = ["bar", "line", "pie"] as const;
const ALIGNMENTS = ["left", "center", "right"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RAW_HTML_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|form|input|button|video|audio|svg)\b/i;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > maximum) throw new Error(`${label} must contain at most ${maximum} entries.`);
  return value;
}

function text(value: unknown, label: string, maximum = 100_000): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  if (value.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  if (value.includes("\0")) throw new Error(`${label} contains a NUL byte.`);
  return value;
}

function optionalText(value: unknown, label: string, maximum?: number): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label, maximum);
}

function finite(value: unknown, label: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  if (minimum !== undefined && value < minimum) throw new Error(`${label} must be at least ${minimum}.`);
  if (maximum !== undefined && value > maximum) throw new Error(`${label} must be at most ${maximum}.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = finite(value, label, minimum);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value as T[number])) {
    throw new Error(`${label} must be one of ${values.join(", ")}.`);
  }
  return value as T[number];
}

function identifier(value: unknown, label: string): string {
  const parsed = text(value, label, 128);
  if (!ID_PATTERN.test(parsed)) throw new Error(`${label} must be a stable identifier.`);
  return parsed;
}

function assertNoExecutableMarkup(value: string, label: string): void {
  if (RAW_HTML_PATTERN.test(value)) throw new Error(`${label} cannot contain executable or embedded HTML.`);
}

function fileReference(value: unknown, label: string): RichArtifactFileReferenceV1 {
  const row = object(value, label);
  const path = text(row.path, `${label}.path`, 4_096);
  const uriScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(path);
  if ((uriScheme && !windowsDrive) || path.startsWith("//")) throw new Error(`${label}.path must be a local path, not a URI.`);
  const sha256 = optionalText(row.sha256, `${label}.sha256`, 64)?.toLowerCase();
  const mimeType = optionalText(row.mimeType, `${label}.mimeType`, 256);
  if (sha256 && !SHA256_PATTERN.test(sha256)) throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  return {
    path,
    label: text(row.label, `${label}.label`, 512),
    role: enumValue(row.role, FILE_ROLES, `${label}.role`),
    ...(mimeType ? { mimeType } : {}),
    ...(sha256 ? { sha256 } : {}),
  };
}

function tableValue(value: unknown, label: string): RichArtifactTableValue {
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value === "string") return text(value, label, 20_000);
  throw new Error(`${label} must be text, a finite number, a boolean, or null.`);
}

function parseBlock(value: unknown, index: number): RichArtifactBlockV1 {
  const label = `richArtifact.blocks[${index}]`;
  const row = object(value, label);
  const id = identifier(row.id, `${label}.id`);
  const type = enumValue(row.type, BLOCK_TYPES, `${label}.type`);
  if (type === "markdown") {
    const markdown = text(row.markdown, `${label}.markdown`, 200_000);
    assertNoExecutableMarkup(markdown, `${label}.markdown`);
    return { id, type, markdown };
  }
  if (type === "table") {
    const caption = optionalText(row.caption, `${label}.caption`, 1_000);
    const columns = array(row.columns, `${label}.columns`, 64).map((columnValue, columnIndex) => {
      const column = object(columnValue, `${label}.columns[${columnIndex}]`);
      const align = column.align === undefined ? undefined : enumValue(column.align, ALIGNMENTS, `${label}.columns[${columnIndex}].align`);
      return {
        key: identifier(column.key, `${label}.columns[${columnIndex}].key`),
        label: text(column.label, `${label}.columns[${columnIndex}].label`, 256),
        ...(align ? { align } : {}),
      };
    });
    if (!columns.length) throw new Error(`${label}.columns must not be empty.`);
    if (new Set(columns.map((column) => column.key)).size !== columns.length) throw new Error(`${label}.columns keys must be unique.`);
    const columnKeys = new Set(columns.map((column) => column.key));
    const rows = array(row.rows, `${label}.rows`, 10_000).map((rowValue, rowIndex) => {
      const source = object(rowValue, `${label}.rows[${rowIndex}]`);
      const unknownKeys = Object.keys(source).filter((key) => !columnKeys.has(key));
      if (unknownKeys.length) throw new Error(`${label}.rows[${rowIndex}] contains unknown columns: ${unknownKeys.join(", ")}.`);
      return Object.fromEntries(columns.map((column) => [
        column.key,
        source[column.key] === undefined ? null : tableValue(source[column.key], `${label}.rows[${rowIndex}].${column.key}`),
      ]));
    });
    return {
      id,
      type,
      ...(caption ? { caption } : {}),
      columns,
      rows,
    };
  }
  if (type === "chart") {
    const caption = optionalText(row.caption, `${label}.caption`, 1_000);
    const series = array(row.series, `${label}.series`, 32).map((seriesValue, seriesIndex) => {
      const source = object(seriesValue, `${label}.series[${seriesIndex}]`);
      return {
        label: text(source.label, `${label}.series[${seriesIndex}].label`, 256),
        points: array(source.points, `${label}.series[${seriesIndex}].points`, 1_000).map((pointValue, pointIndex) => {
          const point = object(pointValue, `${label}.series[${seriesIndex}].points[${pointIndex}]`);
          return {
            label: text(point.label, `${label}.series[${seriesIndex}].points[${pointIndex}].label`, 256),
            value: finite(point.value, `${label}.series[${seriesIndex}].points[${pointIndex}].value`),
          };
        }),
      };
    });
    if (!series.length || series.some((entry) => !entry.points.length)) throw new Error(`${label}.series and every point set must not be empty.`);
    return {
      id,
      type,
      kind: enumValue(row.kind, CHART_KINDS, `${label}.kind`),
      ...(caption ? { caption } : {}),
      series,
    };
  }
  if (type === "image") {
    const caption = optionalText(row.caption, `${label}.caption`, 1_000);
    return {
      id,
      type,
      file: fileReference(row.file, `${label}.file`),
      alt: text(row.alt, `${label}.alt`, 1_000),
      ...(caption ? { caption } : {}),
      ...(row.width === undefined ? {} : { width: finite(row.width, `${label}.width`, 1, 100_000) }),
      ...(row.height === undefined ? {} : { height: finite(row.height, `${label}.height`, 1, 100_000) }),
    };
  }
  if (type === "page_overlay") {
    const width = finite(row.width, `${label}.width`, 1, 100_000);
    const height = finite(row.height, `${label}.height`, 1, 100_000);
    const regions = array(row.regions, `${label}.regions`, 20_000).map((regionValue, regionIndex) => {
      const region = object(regionValue, `${label}.regions[${regionIndex}]`);
      const regionLabel = optionalText(region.label, `${label}.regions[${regionIndex}].label`, 2_000);
      const polygon = array(region.polygon, `${label}.regions[${regionIndex}].polygon`, 128).map((pointValue, pointIndex) => {
        if (!Array.isArray(pointValue) || pointValue.length !== 2) throw new Error(`${label}.regions[${regionIndex}].polygon[${pointIndex}] must be [x, y].`);
        return [
          finite(pointValue[0], `${label}.regions[${regionIndex}].polygon[${pointIndex}][0]`, 0, width),
          finite(pointValue[1], `${label}.regions[${regionIndex}].polygon[${pointIndex}][1]`, 0, height),
        ] as [number, number];
      });
      if (polygon.length < 2) throw new Error(`${label}.regions[${regionIndex}].polygon must contain at least two points.`);
      return {
        polygon,
        ...(regionLabel ? { label: regionLabel } : {}),
        ...(region.confidence === undefined ? {} : { confidence: finite(region.confidence, `${label}.regions[${regionIndex}].confidence`, 0, 1) }),
      };
    });
    return {
      id,
      type,
      page: integer(row.page, `${label}.page`, 1),
      width,
      height,
      ...(row.background === undefined ? {} : { background: fileReference(row.background, `${label}.background`) }),
      regions,
    };
  }
  if (type === "diff") {
    const diffLabel = optionalText(row.label, `${label}.label`, 1_000);
    const before = optionalText(row.before, `${label}.before`, 200_000);
    const after = optionalText(row.after, `${label}.after`, 200_000);
    const patch = optionalText(row.patch, `${label}.patch`, 400_000);
    if (!before && !after && !patch) throw new Error(`${label} requires before, after, or patch text.`);
    return {
      id,
      type,
      ...(diffLabel ? { label: diffLabel } : {}),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(patch ? { patch } : {}),
    };
  }
  return { id, type, file: fileReference(row.file, `${label}.file`) };
}

export function parseRichArtifactDocument(value: unknown): RichArtifactDocumentV1 {
  const row = object(value, "richArtifact");
  if (row.schemaVersion !== RICH_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`richArtifact.schemaVersion must be ${RICH_ARTIFACT_SCHEMA_VERSION}.`);
  }
  const createdAt = text(row.createdAt, "richArtifact.createdAt", 64);
  if (!Number.isFinite(new Date(createdAt).valueOf())) throw new Error("richArtifact.createdAt must be an ISO timestamp.");
  const blocks = array(row.blocks, "richArtifact.blocks", 256).map(parseBlock);
  if (!blocks.length) throw new Error("richArtifact.blocks must not be empty.");
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) throw new Error("richArtifact block ids must be unique.");
  return {
    schemaVersion: RICH_ARTIFACT_SCHEMA_VERSION,
    title: text(row.title, "richArtifact.title", 1_000),
    createdAt: new Date(createdAt).toISOString(),
    generator: text(row.generator, "richArtifact.generator", 512),
    blocks,
  };
}

export function richArtifactDocumentFromContent(content: Record<string, unknown>): RichArtifactDocumentV1 | null {
  if (content.document === undefined) return null;
  return parseRichArtifactDocument(content.document);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function jsonPreview(value: unknown, maximum = 18_000): string {
  if (value === undefined) return "Not provided";
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    serialized = String(value);
  }
  return serialized.length <= maximum ? serialized : `${serialized.slice(0, maximum)}\n… truncated in preview; inspect the raw result Artifact for the complete value.`;
}

export function createDocumentEvidenceRichArtifact(
  evidence: DocumentEvidenceRichArtifactInput,
  options: { title?: string; generator?: string } = {},
): RichArtifactDocumentV1 {
  const blockCount = evidence.pages.reduce((sum, page) => sum + page.blocks.length, 0);
  return parseRichArtifactDocument({
    schemaVersion: RICH_ARTIFACT_SCHEMA_VERSION,
    title: options.title ?? `Document evidence · ${fileName(evidence.source.path)}`,
    createdAt: evidence.extraction.createdAt,
    generator: options.generator ?? "Linguist Agent · local document evidence",
    blocks: [{
      id: "summary",
      type: "markdown",
      markdown: `# Local document evidence\n\n${blockCount} text region(s) across ${evidence.pages.length} page(s). Low-confidence text is preserved for visual review.`,
    }, {
      id: "extraction",
      type: "table",
      caption: "Extraction provenance",
      columns: [{ key: "field", label: "Field" }, { key: "value", label: "Value" }],
      rows: [
        { field: "Route", value: evidence.extraction.route },
        { field: "Runtime", value: evidence.extraction.runtimeVersion },
        ...Object.entries(evidence.extraction.modelVersions).map(([name, version]) => ({ field: `Model · ${name}`, value: version })),
      ],
    }, {
      id: "source",
      type: "file_reference",
      file: {
        path: evidence.source.path,
        label: fileName(evidence.source.path),
        role: "source",
        mimeType: evidence.source.mimeType,
        sha256: evidence.source.sha256,
      },
    }, ...evidence.pages.map((page, index) => ({
      id: `page-${page.page}-${index + 1}`,
      type: "page_overlay",
      page: page.page,
      width: page.width,
      height: page.height,
      background: {
        path: evidence.source.path,
        label: `${fileName(evidence.source.path)} · page ${page.page}`,
        role: "source",
        mimeType: evidence.source.mimeType,
        sha256: evidence.source.sha256,
      },
      regions: page.blocks.map((block) => ({
        polygon: block.polygon,
        label: block.text || "Empty OCR region",
        confidence: block.confidence,
      })),
    }))],
  });
}

export function createOfficeRichArtifact(
  operation: string,
  result: OfficeRichArtifactInput,
  options: { title: string; createdAt: string; generator?: string },
): RichArtifactDocumentV1 {
  const sourceFiles = result.sourceDigests?.length
    ? result.sourceDigests
    : result.sourcePath
      ? [{ path: result.sourcePath, sha256: result.sourceSha256 }]
      : (result.sourcePaths ?? []).map((path) => ({ path, sha256: undefined }));
  const blocks: unknown[] = [{
    id: "summary",
    type: "markdown",
    markdown: `# ${operation === "inspect" ? "Document inspection" : "Validated document operation"}\n\nOperation: **${operation}**. Source files are read-only; mutations are written to a new output and accompanied by worker validation.`,
  }, {
    id: "validation",
    type: "table",
    caption: "Operation evidence",
    columns: [{ key: "field", label: "Field" }, { key: "value", label: "Value" }],
    rows: [
      { field: "Operation", value: operation },
      { field: "Result", value: result.ok },
      { field: "Reopen validation", value: jsonPreview(result.validation) },
      { field: "Worker result", value: jsonPreview(result.result) },
    ],
  }];
  if (result.diff !== undefined) {
    blocks.push({ id: "diff", type: "diff", label: "Typed document diff", patch: jsonPreview(result.diff, 300_000) });
  }
  sourceFiles.forEach((source, index) => blocks.push({
    id: `source-${index + 1}`,
    type: "file_reference",
    file: {
      path: source.path,
      label: fileName(source.path),
      role: "source",
      ...(source.sha256 ? { sha256: source.sha256 } : {}),
    },
  }));
  if (result.outputPath) {
    blocks.push({
      id: "output",
      type: "file_reference",
      file: {
        path: result.outputPath,
        label: fileName(result.outputPath),
        role: "output",
        ...(result.outputSha256 ? { sha256: result.outputSha256 } : {}),
      },
    });
  }
  return parseRichArtifactDocument({
    schemaVersion: RICH_ARTIFACT_SCHEMA_VERSION,
    title: options.title,
    createdAt: options.createdAt,
    generator: options.generator ?? "Linguist Agent · managed Office capability",
    blocks,
  });
}

export function createMineruRichArtifact(
  result: MineruRichArtifactInput,
  options: { title?: string; createdAt: string; generator?: string },
): RichArtifactDocumentV1 {
  return parseRichArtifactDocument({
    schemaVersion: RICH_ARTIFACT_SCHEMA_VERSION,
    title: options.title ?? `Complex layout extraction · ${fileName(result.sourcePath)}`,
    createdAt: options.createdAt,
    generator: options.generator ?? "Linguist Agent · qualified local MinerU capability",
    blocks: [{
      id: "summary",
      type: "markdown",
      markdown: `# Complex layout extraction\n\nThe qualified local MinerU pack produced ${result.files.length} locked output file(s). The source digest remained unchanged.`,
    }, {
      id: "outputs",
      type: "table",
      caption: "Locked output closure",
      columns: [
        { key: "path", label: "Path" },
        { key: "sha256", label: "SHA-256" },
        { key: "bytes", label: "Bytes", align: "right" },
        { key: "kind", label: "Kind" },
      ],
      rows: result.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        bytes: file.sizeBytes,
        kind: file.kind ?? "file",
      })),
    }, {
      id: "source",
      type: "file_reference",
      file: { path: result.sourcePath, label: fileName(result.sourcePath), role: "source", sha256: result.sourceSha256 },
    }, {
      id: "output-directory",
      type: "file_reference",
      file: { path: result.outputDirectory, label: "MinerU output directory", role: "output" },
    }],
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function renderFile(file: RichArtifactFileReferenceV1): string {
  return `<dl class="file"><div><dt>File</dt><dd>${escapeHtml(file.label)}</dd></div><div><dt>Role</dt><dd>${escapeHtml(file.role)}</dd></div><div><dt>Path</dt><dd><code>${escapeHtml(file.path)}</code></dd></div>${file.mimeType ? `<div><dt>Type</dt><dd>${escapeHtml(file.mimeType)}</dd></div>` : ""}${file.sha256 ? `<div><dt>SHA-256</dt><dd><code>${file.sha256}</code></dd></div>` : ""}</dl>`;
}

function renderBlock(block: RichArtifactBlockV1): string {
  if (block.type === "markdown") return `<section class="markdown"><pre>${escapeHtml(block.markdown)}</pre></section>`;
  if (block.type === "table") return `<figure>${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}<table><thead><tr>${block.columns.map((column) => `<th style="text-align:${column.align ?? "left"}">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${block.columns.map((column) => `<td style="text-align:${column.align ?? "left"}">${escapeHtml(String(row[column.key] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table></figure>`;
  if (block.type === "chart") {
    const maximum = Math.max(1, ...block.series.flatMap((series) => series.points.map((point) => Math.abs(point.value))));
    return `<figure>${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}<div class="chart" data-kind="${block.kind}">${block.series.map((series) => `<section><h3>${escapeHtml(series.label)}</h3>${series.points.map((point) => `<div class="chart-row"><span>${escapeHtml(point.label)}</span><i style="width:${Math.max(1, Math.round(Math.abs(point.value) / maximum * 100))}%"></i><strong>${escapeHtml(String(point.value))}</strong></div>`).join("")}</section>`).join("")}</div></figure>`;
  }
  if (block.type === "image") return `<figure class="image-placeholder" role="img" aria-label="${escapeHtml(block.alt)}"><strong>${escapeHtml(block.alt)}</strong>${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}${renderFile(block.file)}</figure>`;
  if (block.type === "page_overlay") {
    const polygons = block.regions.map((region) => `<polygon points="${region.polygon.map(([x, y]) => `${x},${y}`).join(" ")}" aria-label="${escapeHtml(region.label ?? "Region")}" />`).join("");
    return `<figure><figcaption>Page ${block.page} · ${block.regions.length} region(s)</figcaption><svg class="overlay" viewBox="0 0 ${block.width} ${block.height}" role="img" aria-label="Page ${block.page} evidence overlay">${polygons}</svg>${block.background ? renderFile(block.background) : ""}</figure>`;
  }
  if (block.type === "diff") return `<section class="diff">${block.label ? `<h3>${escapeHtml(block.label)}</h3>` : ""}${block.before ? `<h4>Before</h4><pre>${escapeHtml(block.before)}</pre>` : ""}${block.after ? `<h4>After</h4><pre>${escapeHtml(block.after)}</pre>` : ""}${block.patch ? `<h4>Patch</h4><pre>${escapeHtml(block.patch)}</pre>` : ""}</section>`;
  return `<section>${renderFile(block.file)}</section>`;
}

/** Trusted, script-free export projection of the same declarative document used by Electron preview. */
export function renderRichArtifactHtml(value: RichArtifactDocumentV1): string {
  const document = parseRichArtifactDocument(value);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="la-rich-artifact" content="v1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>body{margin:0;background:#fff;color:#171717;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:900px;margin:0 auto;padding:48px}header{border-bottom:1px solid #ddd;margin-bottom:28px;padding-bottom:18px}h1{font-size:28px;margin:0 0 6px}header p{color:#666;margin:0}section,figure{break-inside:avoid;margin:0 0 24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f6;border:1px solid #e5e5e5;border-radius:8px;padding:14px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;vertical-align:top}figcaption{font-weight:650;margin-bottom:8px}.file{border:1px solid #ddd;border-radius:8px;padding:12px}.file div{display:grid;grid-template-columns:90px 1fr;gap:8px}.file dt{color:#666}.file dd{margin:0;overflow-wrap:anywhere}.chart-row{display:grid;grid-template-columns:minmax(100px,1fr) 3fr auto;gap:10px;align-items:center;margin:7px 0}.chart-row i{display:block;height:10px;background:#267a79;border-radius:999px}.overlay{width:100%;max-height:520px;background:#f7f7f7;border:1px solid #ddd}.overlay polygon{fill:rgba(38,122,121,.12);stroke:#267a79;stroke-width:2}.image-placeholder{border:1px dashed #aaa;border-radius:8px;padding:16px}@media print{main{max-width:none;padding:18mm}}</style></head><body><main><header><h1>${escapeHtml(document.title)}</h1><p>${escapeHtml(document.generator)} · ${escapeHtml(document.createdAt)}</p></header>${document.blocks.map(renderBlock).join("")}</main></body></html>`;
}
