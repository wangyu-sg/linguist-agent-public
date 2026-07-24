import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDocumentEvidence, parseDocumentBackendEstimate, parseDocumentBackendResult, parseDocumentParseRequest, parseDocumentProbe } from "@linguist-agent/cat-data";

test("normalizes existing local OCR evidence into provenance-complete blocks without leaking a source path", () => {
  const sourceDigest = "a".repeat(64);
  const result = normalizeDocumentEvidence({
    schemaVersion: 1,
    source: { path: "/private/customer/scan.png", sha256: sourceDigest, mimeType: "image/png" },
    extraction: {
      route: "paddleocr",
      runtimeVersion: "managed-python / paddle-3.7.0",
      modelVersions: { recognition: "PP-OCRv6_medium_rec@revision" },
      createdAt: "2026-07-23T00:00:00.000Z",
    },
    pages: [{
      page: 2,
      width: 100,
      height: 80,
      orientation: 0,
      blocks: [{
        polygon: [[1, 2], [21, 2], [21, 12], [1, 12]],
        bbox: { x: 1, y: 2, width: 20, height: 10 },
        text: "uncertain text",
        confidence: 0.31,
        orientation: 0,
      }],
    }],
    overlay: { pages: [{ page: 2, width: 100, height: 80, polygons: [] }] },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    source: { sha256: sourceDigest, mimeType: "image/png" },
    blocks: [{
      id: `${sourceDigest}:page:2:block:1`,
      kind: "paragraph",
      text: "uncertain text",
      locator: { kind: "page", page: 2, bbox: { x: 1, y: 2, width: 20, height: 10 } },
      readingOrder: 1,
      provenance: {
        sourceDigest,
        backend: { id: "light-ocr", version: "managed-python / paddle-3.7.0", ocr: true },
        confidence: 0.31,
        userCorrected: false,
      },
    }],
  });
});

test("rejects a backend result with unknown fields instead of silently accepting untrusted output", () => {
  assert.throws(
    () => parseDocumentBackendResult({
      schemaVersion: 1,
      source: { sha256: "b".repeat(64), mimeType: "application/pdf" },
      blocks: [],
      uncheckedWorkerPayload: true,
    }),
    /unknown field uncheckedWorkerPayload/i,
  );
});

interface MutableBackendResult {
  schemaVersion: number;
  source: { sha256: string; mimeType: string };
  blocks: Array<{
    id: string;
    kind: string;
    text: string;
    locator: { kind: string; page: number; bbox: { x: number; y: number; width: number; height: number } };
    readingOrder: number;
    provenance: {
      sourceDigest: string;
      backend: { id: string; version: string; ocr: boolean };
      userCorrected: boolean;
    };
  }>;
}

function validBackendResult(): MutableBackendResult {
  const sourceDigest = "c".repeat(64);
  return {
    schemaVersion: 1,
    source: { sha256: sourceDigest, mimeType: "application/pdf" },
    blocks: [{
      id: "page-1-block-1",
      kind: "paragraph",
      text: "Native text",
      locator: { kind: "page", page: 1, bbox: { x: 0, y: 0, width: 10, height: 5 } },
      readingOrder: 1,
      provenance: {
        sourceDigest,
        backend: { id: "native-text", version: "pdftotext-1", ocr: false },
        userCorrected: false,
      },
    }],
  };
}

test("rejects invalid geometry, order, source provenance, and duplicate block identity", () => {
  const invalidGeometry = validBackendResult();
  invalidGeometry.blocks[0]!.locator.bbox.width = 0;
  assert.throws(() => parseDocumentBackendResult(invalidGeometry), /width and height must be positive/i);

  const invalidOrder = validBackendResult();
  invalidOrder.blocks[0]!.readingOrder = 0;
  assert.throws(() => parseDocumentBackendResult(invalidOrder), /readingOrder must be a positive integer/i);

  const crossSource = validBackendResult();
  crossSource.blocks[0]!.provenance.sourceDigest = "d".repeat(64);
  assert.throws(() => parseDocumentBackendResult(crossSource), /must match source\.sha256/i);

  const duplicate = validBackendResult();
  duplicate.blocks.push(structuredClone(duplicate.blocks[0]!));
  assert.throws(() => parseDocumentBackendResult(duplicate), /duplicate block ids/i);
});

test("requires a host-staged parse input whose digest and page scope are explicit", () => {
  assert.throws(
    () => parseDocumentParseRequest({
      source: { sha256: "e".repeat(64), mimeType: "application/pdf" },
      input: { kind: "host-staged-file", id: "staged-1", sourceDigest: "f".repeat(64) },
      pages: [1, 3],
    }),
    /sourceDigest must match source\.sha256/i,
  );
});

test("rejects arbitrary paths and repeated page scopes in a parse request", () => {
  const sourceDigest = "e".repeat(64);
  assert.throws(
    () => parseDocumentParseRequest({
      source: { sha256: sourceDigest, mimeType: "application/pdf" },
      input: { kind: "host-staged-file", id: "staged-1", sourceDigest, path: "/customer/secret.pdf" },
    }),
    /unknown field path/i,
  );
  assert.throws(
    () => parseDocumentParseRequest({
      source: { sha256: sourceDigest, mimeType: "application/pdf" },
      input: { kind: "host-staged-file", id: "staged-1", sourceDigest },
      pages: [1, 1],
    }),
    /must not repeat a page/i,
  );
});

test("requires probe input to use the same host-staged source identity", () => {
  assert.throws(
    () => parseDocumentProbe({
      source: { sha256: "1".repeat(64), mimeType: "application/pdf" },
      input: { kind: "host-staged-file", id: "staged-1", sourceDigest: "2".repeat(64) },
    }),
    /sourceDigest must match source\.sha256/i,
  );
});

test("requires a complete per-page estimate before routing can use a backend probe", () => {
  assert.throws(
    () => parseDocumentBackendEstimate({ supported: true, reason: "native text available" }),
    /missing required field pages/i,
  );
});
