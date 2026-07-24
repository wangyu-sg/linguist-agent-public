import { extname, join, resolve } from "node:path";
import {
  LightOcrDocumentBackend,
  NativeTextDocumentBackend,
  cleanupExpiredDocumentStaging,
  stagePdfDocument,
  stageSinglePageDocument,
  type DocumentBackend,
  type DocumentBackendEstimate,
  type DocumentBackendParseResultV1,
  type NormalizedDocumentBlockV1,
  type StagedDocument,
} from "@linguist-agent/cat-data";
import { CONSERVATIVE_DOCUMENT_ROUTER_POLICY, loadDocumentRouterBenchmarkPolicy } from "./documentRouterBenchmarkPolicy.js";

/** Server/worker policy: frozen per Router invocation, never derived by Renderer input. */
export const DOCUMENT_ROUTER_POLICY = CONSERVATIVE_DOCUMENT_ROUTER_POLICY;

export interface DocumentRouterPageResult {
  page: number;
  status: "complete" | "blocked";
  reason: string;
  backend?: { id: "native-text" | "light-ocr"; version: string; ocr: boolean };
  blockCount: number;
}

export interface DocumentRouterResult {
  schemaVersion: 1;
  source: { sha256: string; mimeType: string };
  policy: { source: "conservative-default" | "benchmark-profile"; reason: string; nativeTextCoverage: number; profileSha256?: string; benchmarkReportSha256?: string };
  status: "complete" | "partial" | "blocked";
  pages: DocumentRouterPageResult[];
  blocks: NormalizedDocumentBlockV1[];
}

type RouterBackends = { native: DocumentBackend; light: DocumentBackend };

export class DocumentRouter {
  constructor(private readonly options: {
    stage(sourcePath: string): Promise<StagedDocument>;
    backends(staged: StagedDocument): RouterBackends;
    benchmarkProfile?: unknown;
    now?: () => Date;
  }) {}

  async route(input: { sourcePath: string }): Promise<DocumentRouterResult> {
    const selection = loadDocumentRouterBenchmarkPolicy(this.options.benchmarkProfile, this.options.now?.());
    const policy = selection.policy;
    const staged = await this.options.stage(input.sourcePath);
    try {
      if (staged.pages.length > policy.maxPages) throw new Error("Document Router page count exceeds the Host limit.");
      const { native, light } = this.options.backends(staged);
      const estimate = await this.probe(native, staged);
      const nativePages: number[] = [];
      const lightPages: number[] = [];
      const pages = staged.pages.map((page) => {
        const pageEstimate = estimate.get(page);
        if (!pageEstimate) throw new Error("Document Router requires a complete native page estimate.");
        if (pageEstimate.layoutComplexity === "complex") {
          return { page, status: "blocked" as const, reason: "Optional structured-layout backend is not qualified.", blockCount: 0 };
        }
        if (pageEstimate.nativeTextCharacters > 0 && pageEstimate.nativeTextCoverage >= policy.nativeTextCoverage) {
          nativePages.push(page);
          return { page, status: "complete" as const, reason: `Native text coverage ${pageEstimate.nativeTextCoverage.toFixed(2)} meets the ${selection.source} threshold ${policy.nativeTextCoverage.toFixed(2)}.`, backend: { id: "native-text" as const, version: native.version, ocr: false }, blockCount: 0 };
        }
        lightPages.push(page);
        return { page, status: "complete" as const, reason: `Native text coverage ${pageEstimate.nativeTextCoverage.toFixed(2)} is below the ${selection.source} threshold ${policy.nativeTextCoverage.toFixed(2)}; local light OCR is selected.`, backend: { id: "light-ocr" as const, version: light.version, ocr: true }, blockCount: 0 };
      });
      const blocks: NormalizedDocumentBlockV1[] = [];
      await this.parseSelected(native, staged, nativePages, pages, blocks);
      await this.parseSelected(light, staged, lightPages, pages, blocks);
      if (blocks.length > policy.maxBlocks) throw new Error("Document Router block output exceeds the Host limit.");
      for (const page of pages) page.blockCount = blocks.filter((block) => block.locator.kind === "page" && block.locator.page === page.page).length;
      const complete = pages.filter((page) => page.status === "complete").length;
      return {
        schemaVersion: 1,
        source: staged.source,
        policy: { source: selection.source, reason: selection.reason, nativeTextCoverage: policy.nativeTextCoverage, ...(selection.profileSha256 === undefined ? {} : { profileSha256: selection.profileSha256 }), ...(selection.benchmarkReportSha256 === undefined ? {} : { benchmarkReportSha256: selection.benchmarkReportSha256 }) },
        status: complete === pages.length ? "complete" : complete ? "partial" : "blocked",
        pages,
        blocks,
      };
    } finally {
      await staged.dispose();
    }
  }

  private async probe(native: DocumentBackend, staged: StagedDocument): Promise<Map<number, DocumentBackendEstimate["pages"][number]>> {
    let estimate: DocumentBackendEstimate;
    try {
      estimate = await native.probe({ source: staged.source, input: staged.input, pages: staged.pages });
    } catch (error) {
      throw new Error(`Native document probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const pages = new Map(estimate.pages.map((page) => [page.page, page]));
    if (!estimate.supported || pages.size !== staged.pages.length || staged.pages.some((page) => !pages.has(page))) {
      throw new Error("Document Router requires a complete native page estimate.");
    }
    return pages;
  }

  private async parseSelected(
    backend: DocumentBackend,
    staged: StagedDocument,
    selectedPages: number[],
    pages: DocumentRouterPageResult[],
    blocks: NormalizedDocumentBlockV1[],
  ): Promise<void> {
    if (!selectedPages.length) return;
    try {
      const result = await backend.parse({ source: staged.source, input: staged.input, pages: selectedPages });
      const parsed = this.blocksForPages(result, selectedPages);
      blocks.push(...parsed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const page of pages) {
        if (!selectedPages.includes(page.page)) continue;
        page.status = "blocked";
        page.reason = `${backend.id === "light-ocr" ? "Local light OCR" : "Native extraction"} is unavailable: ${reason}`;
        delete page.backend;
      }
    }
  }

  private blocksForPages(result: DocumentBackendParseResultV1, pages: number[]): NormalizedDocumentBlockV1[] {
    if (result.blocks.some((block) => block.locator.kind !== "page" || !pages.includes(block.locator.page))) {
      throw new Error("Document backend returned a block outside its frozen page route.");
    }
    return result.blocks;
  }
}

export function documentRouterStagingRoot(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), "data", "assistant", "document-staging");
}

function sourceMimeType(sourcePath: string): "application/pdf" | "image/png" | "image/jpeg" | "image/tiff" {
  switch (extname(sourcePath).toLowerCase()) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".tif":
    case ".tiff": return "image/tiff";
    default: throw new Error("Document Router supports granted PDF, PNG, JPEG, and TIFF inputs only.");
  }
}

function unavailableNative(): DocumentBackend {
  return {
    id: "native-text",
    version: "native-unavailable-v1",
    capabilities: { nativeText: false, ocr: false, layout: false, tables: false, formulas: false, multiPageReasoning: false },
    probe: async (request) => ({
      supported: true,
      reason: "Native text extraction is unavailable for this image format.",
      pages: (request.pages ?? []).map((page) => ({ page, nativeTextCharacters: 0, nativeTextCoverage: 0, readingOrder: "unavailable" as const, layoutComplexity: "unknown" as const })),
    }),
    parse: async () => { throw new Error("Native text extraction is unavailable for this image format."); },
  };
}

export async function routeDocumentWithPolicy(input: {
  runtimeRoot: string;
  taskId: string;
  sourcePath: string;
  useOrientation?: boolean;
  benchmarkProfile?: unknown;
}): Promise<DocumentRouterResult> {
  const stagingRoot = documentRouterStagingRoot(input.runtimeRoot);
  await cleanupExpiredDocumentStaging({ stagingRoot, maxAgeMs: DOCUMENT_ROUTER_POLICY.stagingTtlMs });
  const mimeType = sourceMimeType(input.sourcePath);
  const router = new DocumentRouter({
    benchmarkProfile: input.benchmarkProfile,
    stage: (sourcePath) => mimeType === "application/pdf"
      ? stagePdfDocument({ sourcePath, stagingRoot, maxInputBytes: DOCUMENT_ROUTER_POLICY.maxInputBytes, maxPages: DOCUMENT_ROUTER_POLICY.maxPages })
      : stageSinglePageDocument({ sourcePath, stagingRoot, maxInputBytes: DOCUMENT_ROUTER_POLICY.maxInputBytes, mimeType }),
    backends: (staged) => ({
      native: mimeType === "application/pdf"
        ? new NativeTextDocumentBackend({ version: "native-pdf-v1", resolveStagedInput: staged.resolveStagedInput })
        : unavailableNative(),
      light: new LightOcrDocumentBackend({
        workspaceRoot: input.runtimeRoot,
        limits: {
          maxInputBytes: DOCUMENT_ROUTER_POLICY.maxInputBytes,
          maxPages: DOCUMENT_ROUTER_POLICY.maxPages,
          maxBlocks: DOCUMENT_ROUTER_POLICY.maxBlocks,
          timeoutMs: DOCUMENT_ROUTER_POLICY.timeoutMs,
          maxOutputBytes: DOCUMENT_ROUTER_POLICY.maxOutputBytes,
        },
        resolveStagedInput: staged.resolveStagedInput,
        useOrientation: input.useOrientation,
      }),
    }),
  });
  return router.route({ sourcePath: input.sourcePath });
}

export function cleanupExpiredDocumentRouterStages(runtimeRoot: string): Promise<number> {
  return cleanupExpiredDocumentStaging({ stagingRoot: documentRouterStagingRoot(runtimeRoot), maxAgeMs: DOCUMENT_ROUTER_POLICY.stagingTtlMs });
}
