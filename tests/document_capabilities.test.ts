import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PADDLE_OCR_PACK,
  buildDocumentEvidence,
  extractPaddleOcrEvidence,
  inspectManagedDocumentCapabilities,
  managedDocumentCapabilityPath,
  routeDocumentExtraction,
  runManagedJsonlWorker,
  type ManagedCapabilityLockV1,
} from "../packages/cat-data/src/document_capabilities.ts";

test("document packs are explicit and missing never masquerades as ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-capabilities-"));
  const statuses = await inspectManagedDocumentCapabilities(root);
  assert.equal(statuses.python.state, "missing");
  assert.equal(statuses.ocr.state, "missing");
  assert.equal(statuses.mineru.state, "missing");
  assert.equal(statuses.office.state, "missing");
  assert.match(statuses.ocr.message ?? "", /not installed/i);
});

test("OCR capability locks verify exact runtime, wheels, models, and files", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-capabilities-"));
  const packPath = managedDocumentCapabilityPath(root, "ocr");
  await mkdir(join(packPath, "models", "PP-OCRv5_mobile_det"), { recursive: true });
  await mkdir(join(packPath, "models", "PP-OCRv6_medium_rec"), { recursive: true });
  await mkdir(join(packPath, "models", "PP-LCNet_x0_25_textline_ori"), { recursive: true });
  await mkdir(join(packPath, "worker"), { recursive: true });
  await mkdir(join(packPath, "venv", "bin"), { recursive: true });
  const files: Array<readonly [string, string]> = [
    ...["config.json", "inference.json", "inference.pdiparams", "inference.yml"].map((name) => [`models/PP-OCRv5_mobile_det/${name}`, `det-${name}`] as const),
    ...["inference.json", "inference.pdiparams", "inference.yml"].map((name) => [`models/PP-OCRv6_medium_rec/${name}`, `rec-${name}`] as const),
    ...["config.json", "inference.json", "inference.pdiparams", "inference.yml"].map((name) => [`models/PP-LCNet_x0_25_textline_ori/${name}`, `orientation-${name}`] as const),
    ["venv/bin/python3.11", "python"],
    ["worker/ocr_worker.py", "worker"],
  ];
  const lockedFiles = [];
  for (const [relativePath, body] of files) {
    await writeFile(join(packPath, relativePath), body, "utf8");
    lockedFiles.push({ path: relativePath, sha256: createHash("sha256").update(body).digest("hex"), sizeBytes: Buffer.byteLength(body) });
  }
  const lock: ManagedCapabilityLockV1 = {
    schemaVersion: 1,
    capabilityId: "ocr",
    installedAt: new Date().toISOString(),
    runtime: { distribution: PADDLE_OCR_PACK.runtime.distribution, sha256: PADDLE_OCR_PACK.runtime.sha256 },
    packages: PADDLE_OCR_PACK.packages.map((entry) => ({ ...entry })),
    models: PADDLE_OCR_PACK.models.map((entry) => ({ ...entry, files: lockedFiles.filter((file) => file.path.includes(entry.name)) })),
    files: lockedFiles,
  };
  await writeFile(join(packPath, "capability-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  const ready = (await inspectManagedDocumentCapabilities(root)).ocr;
  assert.equal(ready.state, "ready");

  const pythonPath = managedDocumentCapabilityPath(root, "python");
  await mkdir(join(pythonPath, "runtime", "python", "bin"), { recursive: true });
  await writeFile(join(pythonPath, "runtime", "python", "bin", "python3.11"), "python", "utf8");
  await writeFile(join(pythonPath, "capability-lock.json"), `${JSON.stringify({
    schemaVersion: 1,
    capabilityId: "python",
    installedAt: new Date().toISOString(),
    runtime: { distribution: PADDLE_OCR_PACK.runtime.distribution, sha256: PADDLE_OCR_PACK.runtime.sha256 },
    packages: [],
    models: [],
    files: [{ path: "runtime/python/bin/python3.11", sha256: createHash("sha256").update("python").digest("hex"), sizeBytes: 6 }],
  }, null, 2)}\n`, "utf8");
  const source = join(root, "scan.png");
  await writeFile(source, "image", "utf8");
  let workerOptions: any;
  await extractPaddleOcrEvidence(root, source, {
    runWorker: async (options) => {
      workerOptions = options;
      return [{ ok: true, pages: [{ page: 1, width: 10, height: 10, orientation: 0, blocks: [] }] }];
    },
  });
  assert.equal(workerOptions.executable, join(packPath, "venv", "bin", "python3.11"));
  assert.equal(workerOptions.request.useOrientation, false);
  assert.equal(workerOptions.env.HF_HUB_OFFLINE, "1");

  await writeFile(join(packPath, files[0][0]), "tampered", "utf8");
  const corrupt = (await inspectManagedDocumentCapabilities(root)).ocr;
  assert.equal(corrupt.state, "corrupt");
  assert.match(corrupt.message ?? "", /SHA-256/i);
});

test("JSONL worker uses stdin and returns typed lines without shell interpolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-worker-"));
  const worker = join(root, "worker.mjs");
  await writeFile(worker, [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => input += chunk);",
    "process.stdin.on('end', () => { for (const line of input.trim().split(/\\n+/)) console.log(JSON.stringify({ ok: true, request: JSON.parse(line) })); });",
  ].join("\n"), "utf8");
  const rows = await runManagedJsonlWorker({ executable: process.execPath, workerPath: worker, request: { sourcePath: "/tmp/name with spaces;no-shell.png" } });
  assert.deepEqual(rows, [{ ok: true, request: { sourcePath: "/tmp/name with spaces;no-shell.png" } }]);
});

test("document evidence preserves low confidence text, geometry, digest, and overlay", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-evidence-"));
  const source = join(root, "scan.png");
  await writeFile(source, "fixture", "utf8");
  const evidence = await buildDocumentEvidence({
    sourcePath: source,
    route: "paddleocr",
    runtimeVersion: "cpython-3.11.15+20260718",
    modelVersions: { detection: "PP-OCRv5_mobile_det", recognition: "PP-OCRv6_medium_rec" },
    pages: [{ page: 1, width: 100, height: 80, orientation: 0, blocks: [
      { polygon: [[1, 2], [20, 2], [20, 12], [1, 12]], text: "uncertain text", confidence: 0.31, orientation: 0 },
    ] }],
  });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.pages[0]?.blocks[0]?.text, "uncertain text");
  assert.equal(evidence.pages[0]?.blocks[0]?.confidence, 0.31);
  assert.deepEqual(evidence.pages[0]?.blocks[0]?.bbox, { x: 1, y: 2, width: 19, height: 10 });
  assert.match(evidence.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.overlay.pages[0]?.polygons.length, 1);
  assert.equal((await readFile(source, "utf8")), "fixture", "source files remain read-only");
});

test("document extraction routing is native-first, local-only by default, and cloud-gated", () => {
  assert.equal(routeDocumentExtraction({ nativeTextCharacters: 200, nativeTextCoverage: 0.9 }).route, "native-text");
  assert.equal(routeDocumentExtraction({ nativeTextCharacters: 0 }).route, "paddleocr");
  assert.equal(routeDocumentExtraction({ nativeTextCharacters: 20, nativeTextCoverage: 0.2, complexLayout: true, mineruState: "unqualified" }).route, "paddleocr");
  assert.equal(routeDocumentExtraction({ nativeTextCharacters: 20, nativeTextCoverage: 0.2, complexLayout: true, mineruState: "ready" }).route, "mineru");
  assert.equal(routeDocumentExtraction({ nativeTextCharacters: 0, userRequestedCloudVision: true }).route, "blocked");
  assert.deepEqual(routeDocumentExtraction({ nativeTextCharacters: 0, userRequestedCloudVision: true, cloudEgressDecisionId: "decision-1" }), {
    route: "cloud-vision",
    reason: "The user approved cloud vision for this file.",
    decisionId: "decision-1",
  });
});
