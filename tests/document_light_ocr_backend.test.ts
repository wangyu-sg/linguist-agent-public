import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LightOcrDocumentBackend,
  MANAGED_PADDLE_OCR_RUNTIME_VERSION,
  type DocumentEvidenceV1,
  type ManagedDocumentCapabilityStatuses,
} from "@linguist-agent/cat-data";

const fixtureBytes = "scanned fixture";
const limits = {
  maxInputBytes: 1024,
  maxPages: 1,
  maxBlocks: 4,
  timeoutMs: 1234,
  maxOutputBytes: 4096,
};

function capabilityStatuses(ocrState: ManagedDocumentCapabilityStatuses["ocr"]["state"]): ManagedDocumentCapabilityStatuses {
  const state = (id: "python" | "ocr" | "mineru" | "office", value: ManagedDocumentCapabilityStatuses["ocr"]["state"]) => ({
    id,
    label: id,
    tier: id === "mineru" || id === "office" ? "labs" as const : "core" as const,
    state: value,
    path: `/synthetic/${id}`,
    message: `${id} is ${value}.`,
  });
  return {
    python: state("python", "ready"),
    ocr: state("ocr", ocrState),
    mineru: state("mineru", "unqualified"),
    office: state("office", "missing"),
  };
}

function evidence(path: string, sha256: string): DocumentEvidenceV1 {
  return {
    schemaVersion: 1,
    source: { path, sha256, mimeType: "image/png" },
    extraction: { route: "paddleocr", runtimeVersion: MANAGED_PADDLE_OCR_RUNTIME_VERSION, modelVersions: { recognition: "pinned" }, createdAt: "2026-07-24T00:00:00.000Z" },
    pages: [{
      page: 1,
      width: 100,
      height: 80,
      orientation: 0,
      blocks: [{
        polygon: [[1, 2], [20, 2], [20, 12], [1, 12]],
        bbox: { x: 1, y: 2, width: 19, height: 10 },
        text: "low-confidence text",
        confidence: 0.31,
        orientation: 0,
      }],
    }],
    overlay: { pages: [{ page: 1, width: 100, height: 80, polygons: [{ polygon: [[1, 2], [20, 2], [20, 12], [1, 12]], confidence: 0.31, text: "low-confidence text" }] }] },
  };
}

test("local light-OCR backend emits digest-bound geometry and confidence without leaking a path", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-light-ocr-"));
  try {
    const path = join(root, "staged.png");
    await writeFile(path, fixtureBytes, "utf8");
    const sha256 = createHash("sha256").update(fixtureBytes).digest("hex");
    let workerOptions: { timeoutMs?: number; maxBufferBytes?: number } | undefined;
    const backend = new LightOcrDocumentBackend({
      workspaceRoot: root,
      limits,
      resolveStagedInput: async () => path,
      inspectCapabilities: async () => capabilityStatuses("ready"),
      runWorker: async (options) => {
        workerOptions = options;
        return [];
      },
      extractEvidence: async (_workspaceRoot, sourcePath, options) => {
        await options?.runWorker?.({ executable: "managed-python", workerPath: "ocr_worker.py", request: { sourcePath } });
        return evidence(sourcePath, sha256);
      },
    });
    const request = {
      source: { sha256, mimeType: "image/png" },
      input: { kind: "host-staged-file" as const, id: "staged-ocr", sourceDigest: sha256 },
    };

    assert.deepEqual(await backend.probe(request), {
      supported: true,
      reason: "Local PaddleOCR is available.",
      pages: [],
    });
    assert.deepEqual(await backend.parse(request), {
      schemaVersion: 1,
      source: request.source,
      blocks: [{
        id: `${sha256}:page:1:block:1`,
        kind: "paragraph",
        text: "low-confidence text",
        locator: { kind: "page", page: 1, bbox: { x: 1, y: 2, width: 19, height: 10 } },
        readingOrder: 1,
        provenance: {
          sourceDigest: sha256,
          backend: { id: "light-ocr", version: MANAGED_PADDLE_OCR_RUNTIME_VERSION, ocr: true },
          confidence: 0.31,
          userCorrected: false,
        },
      }],
    });
    assert.equal(workerOptions?.timeoutMs, limits.timeoutMs);
    assert.equal(workerOptions?.maxBufferBytes, limits.maxOutputBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local light-OCR backend refuses unavailable packs and limits before producing a result", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-light-ocr-"));
  try {
    const path = join(root, "staged.png");
    await writeFile(path, fixtureBytes, "utf8");
    const sha256 = createHash("sha256").update(fixtureBytes).digest("hex");
    const request = {
      source: { sha256, mimeType: "image/png" },
      input: { kind: "host-staged-file" as const, id: "staged-ocr", sourceDigest: sha256 },
    };
    for (const state of ["missing", "corrupt", "unqualified"] as const) {
      let extracted = false;
      const backend = new LightOcrDocumentBackend({
        workspaceRoot: root,
        limits,
        resolveStagedInput: async () => path,
        inspectCapabilities: async () => capabilityStatuses(state),
        extractEvidence: async () => {
          extracted = true;
          return evidence(path, sha256);
        },
      });
      await assert.rejects(() => backend.parse(request), new RegExp(`ocr is ${state}`, "i"));
      assert.equal(extracted, false);
    }

    let extracted = false;
    const oversized = new LightOcrDocumentBackend({
      workspaceRoot: root,
      limits: { ...limits, maxInputBytes: 1 },
      resolveStagedInput: async () => path,
      inspectCapabilities: async () => capabilityStatuses("ready"),
      extractEvidence: async () => {
        extracted = true;
        return evidence(path, sha256);
      },
    });
    await assert.rejects(() => oversized.parse(request), /input exceeds the Host limit/u);
    assert.equal(extracted, false);

    const overPages = new LightOcrDocumentBackend({
      workspaceRoot: root,
      limits,
      resolveStagedInput: async () => path,
      inspectCapabilities: async () => capabilityStatuses("ready"),
      extractEvidence: async () => ({ ...evidence(path, sha256), pages: [evidence(path, sha256).pages[0]!, { ...evidence(path, sha256).pages[0]!, page: 2 }], overlay: { pages: [] } }),
    });
    await assert.rejects(() => overPages.parse(request), /page count exceeds the Host limit/u);

    const oversizedOutput = new LightOcrDocumentBackend({
      workspaceRoot: root,
      limits: { ...limits, maxOutputBytes: 1 },
      resolveStagedInput: async () => path,
      inspectCapabilities: async () => capabilityStatuses("ready"),
      extractEvidence: async () => evidence(path, sha256),
    });
    await assert.rejects(() => oversizedOutput.parse(request), /output exceeds the Host limit/u);

    const runtimeDrift = new LightOcrDocumentBackend({
      workspaceRoot: root,
      limits,
      resolveStagedInput: async () => path,
      inspectCapabilities: async () => capabilityStatuses("ready"),
      extractEvidence: async () => ({ ...evidence(path, sha256), extraction: { ...evidence(path, sha256).extraction, runtimeVersion: "untrusted-paddle" } }),
    });
    await assert.rejects(() => runtimeDrift.parse(request), /runtime version does not match/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
