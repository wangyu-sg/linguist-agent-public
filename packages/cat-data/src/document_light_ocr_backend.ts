import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  extractPaddleOcrEvidence,
  inspectManagedDocumentCapabilities,
  MANAGED_PADDLE_OCR_RUNTIME_VERSION,
  runManagedJsonlWorker,
  type DocumentEvidenceV1,
  type ManagedDocumentCapabilityStatuses,
  type RunManagedJsonlWorkerOptions,
} from "./document_capabilities.js";
import {
  DOCUMENT_ROUTER_SCHEMA_VERSION,
  normalizeDocumentEvidence,
  parseDocumentBackendResult,
  parseDocumentProbe,
  parseDocumentParseRequest,
  type DocumentBackend,
  type DocumentBackendEstimate,
  type DocumentBackendParseResultV1,
  type DocumentParseRequest,
  type DocumentProbe,
  type DocumentStagedInputRef,
} from "./document_router_contract.js";

export interface LightOcrLimits {
  maxInputBytes: number;
  maxPages: number;
  maxBlocks: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface LightOcrDocumentBackendOptions {
  workspaceRoot: string;
  limits: LightOcrLimits;
  resolveStagedInput: (input: DocumentStagedInputRef) => Promise<string>;
  inspectCapabilities?: (workspaceRoot: string) => Promise<ManagedDocumentCapabilityStatuses>;
  extractEvidence?: typeof extractPaddleOcrEvidence;
  runWorker?: (options: RunManagedJsonlWorkerOptions) => Promise<Record<string, unknown>[]>;
  useOrientation?: boolean;
}

function assertPositiveLimit(value: number, name: keyof LightOcrLimits): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Light OCR ${name} must be a positive integer.`);
}

function verifyLimits(limits: LightOcrLimits): void {
  for (const [name, value] of Object.entries(limits) as Array<[keyof LightOcrLimits, number]>) assertPositiveLimit(value, name);
}

async function digestStagedFile(path: string, maxInputBytes: number): Promise<string> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxInputBytes) throw new Error("Light OCR input exceeds the Host limit.");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export class LightOcrDocumentBackend implements DocumentBackend {
  readonly id = "light-ocr" as const;
  readonly capabilities = { nativeText: false, ocr: true, layout: false, tables: false, formulas: false, multiPageReasoning: false };

  constructor(private readonly options: LightOcrDocumentBackendOptions) {
    verifyLimits(options.limits);
  }

  get version(): string {
    return MANAGED_PADDLE_OCR_RUNTIME_VERSION;
  }

  async probe(input: DocumentProbe): Promise<DocumentBackendEstimate> {
    const request = parseDocumentProbe(input);
    await this.assertReady();
    await this.resolveAndVerify(request.input, request.source.sha256);
    return {
      supported: true,
      reason: "Local PaddleOCR is available.",
      pages: [],
    };
  }

  async parse(input: DocumentParseRequest): Promise<DocumentBackendParseResultV1> {
    const request = parseDocumentParseRequest(input);
    await this.assertReady();
    const path = await this.resolveAndVerify(request.input, request.source.sha256);
    const evidence = await this.extract(path);
    this.assertEvidenceWithinLimits(evidence, request.source.sha256);
    const normalized = normalizeDocumentEvidence(evidence);
    const selected = request.pages
      ? normalized.blocks.filter((block) => block.locator.kind === "page" && request.pages!.includes(block.locator.page))
      : normalized.blocks;
    return parseDocumentBackendResult({
      schemaVersion: DOCUMENT_ROUTER_SCHEMA_VERSION,
      source: request.source,
      blocks: selected,
    });
  }

  private async assertReady(): Promise<void> {
    const statuses = await (this.options.inspectCapabilities ?? inspectManagedDocumentCapabilities)(this.options.workspaceRoot);
    if (statuses.python.state !== "ready") throw new Error(statuses.python.message ?? `Managed Python is ${statuses.python.state}.`);
    if (statuses.ocr.state !== "ready") throw new Error(statuses.ocr.message ?? `PaddleOCR is ${statuses.ocr.state}.`);
  }

  private async resolveAndVerify(input: DocumentStagedInputRef, expectedDigest: string): Promise<string> {
    const path = await this.options.resolveStagedInput(input);
    if (await digestStagedFile(path, this.options.limits.maxInputBytes) !== expectedDigest) {
      throw new Error("Host-staged document bytes do not match the requested source digest.");
    }
    return path;
  }

  private async extract(path: string): Promise<DocumentEvidenceV1> {
    const extractEvidence = this.options.extractEvidence ?? extractPaddleOcrEvidence;
    const runWorker = this.options.runWorker ?? runManagedJsonlWorker;
    return extractEvidence(this.options.workspaceRoot, path, {
      useOrientation: this.options.useOrientation,
      runWorker: (options) => runWorker({
        ...options,
        timeoutMs: this.options.limits.timeoutMs,
        maxBufferBytes: this.options.limits.maxOutputBytes,
      }),
    });
  }

  private assertEvidenceWithinLimits(evidence: DocumentEvidenceV1, expectedDigest: string): void {
    if (evidence.extraction.route !== "paddleocr") throw new Error("Light OCR backend requires PaddleOCR evidence.");
    if (evidence.source.sha256 !== expectedDigest) throw new Error("PaddleOCR evidence source digest does not match the requested source.");
    if (evidence.extraction.runtimeVersion !== this.version) throw new Error("PaddleOCR evidence runtime version does not match the managed backend.");
    if (evidence.pages.length > this.options.limits.maxPages) throw new Error("Light OCR page count exceeds the Host limit.");
    const blockCount = evidence.pages.reduce((total, page) => total + page.blocks.length, 0);
    if (blockCount > this.options.limits.maxBlocks) throw new Error("Light OCR block count exceeds the Host limit.");
    if (Buffer.byteLength(JSON.stringify(evidence)) > this.options.limits.maxOutputBytes) throw new Error("Light OCR output exceeds the Host limit.");
  }
}
