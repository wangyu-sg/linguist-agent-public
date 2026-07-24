import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import {
  extractPdfBlocks,
  extractPptxBlocks,
  type ExtractedDocumentBlock,
} from "./document_assets.js";
import {
  DOCUMENT_ROUTER_SCHEMA_VERSION,
  parseDocumentBackendResult,
  parseDocumentProbe,
  parseDocumentParseRequest,
  type DocumentBackend,
  type DocumentBackendEstimate,
  type DocumentBackendParseResultV1,
  type DocumentParseRequest,
  type DocumentProbe,
  type DocumentStagedInputRef,
  type NormalizedDocumentBlockKind,
} from "./document_router_contract.js";

export interface NativeTextDocumentBackendOptions {
  version: string;
  resolveStagedInput: (input: DocumentStagedInputRef) => Promise<string>;
  extractBlocks?: (path: string) => Promise<ExtractedDocumentBlock[]>;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function defaultExtractBlocks(path: string, mimeType: string): Promise<ExtractedDocumentBlock[]> {
  const extension = extname(path).toLowerCase();
  if (mimeType === "application/pdf" || extension === ".pdf") return extractPdfBlocks(path);
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || extension === ".pptx") return extractPptxBlocks(path);
  throw new Error("Native extraction is partial for this format because the current extractor has no verified page, slide, or cell locator.");
}

function blockKind(block: ExtractedDocumentBlock): NormalizedDocumentBlockKind {
  if (block.blockType === "heading") return "heading";
  if (block.blockType === "table") return "table";
  if (block.blockType === "image") return "image";
  return "paragraph";
}

function location(block: ExtractedDocumentBlock): { id: string; locator: { kind: "page"; page: number } | { kind: "slide"; slide: number } } {
  if (block.page !== undefined) return { id: `page:${block.page}`, locator: { kind: "page", page: block.page } };
  if (block.slide !== undefined) return { id: `slide:${block.slide}`, locator: { kind: "slide", slide: block.slide } };
  throw new Error("Native extraction produced a block without a verified page or slide locator.");
}

export class NativeTextDocumentBackend implements DocumentBackend {
  readonly id = "native-text" as const;
  readonly capabilities = { nativeText: true, ocr: false, layout: false, tables: true, formulas: false, multiPageReasoning: false };

  constructor(private readonly options: NativeTextDocumentBackendOptions) {}

  get version(): string {
    return this.options.version;
  }

  async probe(input: DocumentProbe): Promise<DocumentBackendEstimate> {
    const { source, input: stagedInput, pages } = parseDocumentProbe(input);
    const blocks = await this.blocksFor(stagedInput, source.sha256, source.mimeType);
    const pageNumbers = pages ?? [...new Set(blocks.map((block) => block.page ?? block.slide).filter((page): page is number => page !== undefined))];
    return {
      supported: true,
      reason: "Native text extraction is available.",
      pages: pageNumbers.map((page) => {
        const text = blocks.filter((block) => (block.page ?? block.slide) === page).map((block) => block.text).join("\n");
        // ponytail: binary native coverage; replace with visual glyph coverage when a qualified renderer exists.
        return { page, nativeTextCharacters: text.length, nativeTextCoverage: text ? 1 : 0, readingOrder: "uncertain" as const, layoutComplexity: "unknown" as const };
      }),
    };
  }

  async parse(input: DocumentParseRequest): Promise<DocumentBackendParseResultV1> {
    const request = parseDocumentParseRequest(input);
    const blocks = await this.blocksFor(request.input, request.source.sha256, request.source.mimeType);
    const selected = request.pages ? blocks.filter((block) => request.pages!.includes(block.page ?? block.slide ?? -1)) : blocks;
    return parseDocumentBackendResult({
      schemaVersion: DOCUMENT_ROUTER_SCHEMA_VERSION,
      source: request.source,
      blocks: selected.map((block, index) => {
        const place = location(block);
        return {
          id: `${request.source.sha256}:${place.id}:block:${block.ordinal}`,
          kind: blockKind(block),
          text: block.text,
          locator: place.locator,
          readingOrder: index + 1,
          provenance: {
            sourceDigest: request.source.sha256,
            backend: { id: this.id, version: this.version, ocr: false },
            userCorrected: false,
          },
        };
      }),
    });
  }

  private async blocksFor(input: DocumentStagedInputRef, expectedDigest: string, mimeType: string): Promise<ExtractedDocumentBlock[]> {
    const path = await this.options.resolveStagedInput(input);
    if (await sha256File(path) !== expectedDigest) throw new Error("Host-staged document bytes do not match the requested source digest.");
    return this.options.extractBlocks ? this.options.extractBlocks(path) : defaultExtractBlocks(path, mimeType);
  }
}
