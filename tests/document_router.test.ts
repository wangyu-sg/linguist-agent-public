import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  DocumentBackend,
  DocumentBackendParseResultV1,
  DocumentBackendEstimate,
  DocumentParseRequest,
  DocumentProbe,
} from "@linguist-agent/cat-data";
import { DOCUMENT_ROUTER_POLICY, DocumentRouter } from "@linguist-agent/cat-runtime";

const digest = "a".repeat(64);
const source = { sha256: digest, mimeType: "application/pdf" };
const input = { kind: "host-staged-file" as const, id: "staged-document", sourceDigest: digest };

function backend(id: "native-text" | "light-ocr", estimate: DocumentBackendEstimate, parse: (input: DocumentParseRequest) => Promise<DocumentBackendParseResultV1>): DocumentBackend {
  return {
    id,
    version: `${id}-v1`,
    capabilities: { nativeText: id === "native-text", ocr: id === "light-ocr", layout: false, tables: false, formulas: false, multiPageReasoning: false },
    probe: async (_input: DocumentProbe) => estimate,
    parse,
  };
}

test("Document Router freezes a per-page native/light/blocked plan and disposes staging", async () => {
  let disposed = false;
  const nativeCalls: number[][] = [];
  const lightCalls: number[][] = [];
  const native = backend("native-text", {
    supported: true,
    reason: "native probe",
    pages: [
      { page: 1, nativeTextCharacters: 40, nativeTextCoverage: 1, readingOrder: "verified", layoutComplexity: "simple" },
      { page: 2, nativeTextCharacters: 0, nativeTextCoverage: 0, readingOrder: "unavailable", layoutComplexity: "simple" },
      { page: 3, nativeTextCharacters: 0, nativeTextCoverage: 0, readingOrder: "unavailable", layoutComplexity: "complex" },
    ],
  }, async (request) => {
    nativeCalls.push(request.pages ?? []);
    return {
      schemaVersion: 1,
      source,
      blocks: [{
        id: "native-page-1", kind: "paragraph", text: "native", locator: { kind: "page", page: 1 }, readingOrder: 1,
        provenance: { sourceDigest: digest, backend: { id: "native-text", version: "native-text-v1", ocr: false }, userCorrected: false },
      }],
    };
  });
  const light = backend("light-ocr", { supported: true, reason: "light ready", pages: [] }, async (request) => {
    lightCalls.push(request.pages ?? []);
    return {
      schemaVersion: 1,
      source,
      blocks: [{
        id: "light-page-2", kind: "paragraph", text: "ocr", locator: { kind: "page", page: 2 }, readingOrder: 1,
        provenance: { sourceDigest: digest, backend: { id: "light-ocr", version: "light-ocr-v1", ocr: true }, confidence: 0.4, userCorrected: false },
      }],
    };
  });

  const router = new DocumentRouter({
    stage: async () => ({ source, input, pages: [1, 2, 3], resolveStagedInput: async () => "/never-exposed.pdf", dispose: async () => { disposed = true; } }),
    backends: () => ({ native, light }),
  });
  const result = await router.route({ sourcePath: "/granted/source.pdf" });

  assert.deepEqual(nativeCalls, [[1]]);
  assert.deepEqual(lightCalls, [[2]]);
  assert.equal(disposed, true);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.pages.map((page) => [page.page, page.status, page.backend?.id]), [
    [1, "complete", "native-text"],
    [2, "complete", "light-ocr"],
    [3, "blocked", undefined],
  ]);
  assert.match(result.pages[2]!.reason, /optional structured-layout backend is not qualified/i);
  assert.equal(JSON.stringify(result).includes("/granted/source.pdf"), false);
  assert.deepEqual(result.blocks.map((block) => block.provenance.backend.ocr), [false, true]);
});

test("Document Router reports an unavailable light backend as blocked instead of succeeding or falling back", async () => {
  const native = backend("native-text", {
    supported: true,
    reason: "native probe",
    pages: [{ page: 1, nativeTextCharacters: 0, nativeTextCoverage: 0, readingOrder: "unavailable", layoutComplexity: "simple" }],
  }, async () => ({ schemaVersion: 1, source, blocks: [] }));
  const light = backend("light-ocr", { supported: true, reason: "light ready", pages: [] }, async () => { throw new Error("PaddleOCR is missing."); });
  const router = new DocumentRouter({
    stage: async () => ({ source, input, pages: [1], resolveStagedInput: async () => "/never-exposed.pdf", dispose: async () => undefined }),
    backends: () => ({ native, light }),
  });
  const result = await router.route({ sourcePath: "/granted/source.pdf" });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blocks, []);
  assert.match(result.pages[0]!.reason, /PaddleOCR is missing/u);
});

test("Document Router production policy is bounded and legacy direct Paddle choice is absent", async () => {
  assert.deepEqual(DOCUMENT_ROUTER_POLICY, {
    schemaVersion: 1,
    maxInputBytes: 64 * 1024 * 1024,
    maxPages: 500,
    maxBlocks: 20_000,
    maxOutputBytes: 32 * 1024 * 1024,
    timeoutMs: 5 * 60 * 1000,
    stagingTtlMs: 24 * 60 * 60 * 1000,
    nativeTextCoverage: 0.75,
  });
  const [applicationPort, tool, legacyCapability] = await Promise.all([
    readFile(new URL("../packages/cat-server/src/application/document_evidence_application_port.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/cat-tools/src/document-capability-tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/cat-data/src/document_capabilities.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(applicationPort, /extractPaddleOcrEvidence/u);
  assert.doesNotMatch(tool, /extractPaddleOcrEvidence/u);
  assert.match(applicationPort, /routeDocumentWithPolicy/u);
  assert.match(tool, /routeDocument/u);
  assert.doesNotMatch(legacyCapability, /routeDocumentExtraction/u);
});
