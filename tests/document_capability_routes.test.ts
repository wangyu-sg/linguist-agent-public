import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStandaloneFileGrant,
  createTaskWorkspace,
  type DocumentEvidenceV1,
} from "@linguist-agent/cat-data";
import { handleDocumentCapabilityRoute } from "../packages/cat-server/src/routes/document_capability_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-document-capability-routes-"));
const taskId = "document-chat";
const source = join(root, "scan.png");
const denied = join(root, "denied.png");
await writeFile(source, "source-remains-read-only", "utf8");
await writeFile(denied, "not-granted", "utf8");
await createTaskWorkspace(root).create({ owner: { kind: "standalone" }, taskId, title: "Document review", intent: "Review local document evidence", kind: "general" });
const grant = await createStandaloneFileGrant(root, { taskId, path: source, kind: "file", access: "read" });

const evidence: DocumentEvidenceV1 = {
  schemaVersion: 1,
  source: { path: source, sha256: "a".repeat(64), mimeType: "image/png" },
  extraction: { route: "paddleocr", runtimeVersion: "managed", modelVersions: { detection: "det", recognition: "rec" }, createdAt: "2026-07-20T00:00:00.000Z" },
  pages: [{ page: 1, width: 100, height: 80, orientation: 0, blocks: [{ polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], bbox: { x: 0, y: 0, width: 10, height: 8 }, text: "低置信度", confidence: 0.4, orientation: 0 }] }],
  overlay: { pages: [{ page: 1, width: 100, height: 80, polygons: [{ polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], confidence: 0.4, text: "低置信度" }] }] },
};
let mutationAvailable = true;
let installed = 0;

async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  const url = new URL(path, "http://127.0.0.1");
  let output: { status: number; data: any } | undefined;
  const handled = await handleDocumentCapabilityRoute(
    Object.assign(new EventEmitter(), { method }) as IncomingMessage,
    {} as ServerResponse,
    url.pathname.split("/").filter(Boolean),
    {
      repoRoot: root,
      json: (_res, status, data) => { output = { status, data }; },
      readBody: async () => body,
      inspectCapabilities: async () => ({ python: { state: "ready" }, ocr: { state: "ready" }, mineru: { state: "missing" }, office: { state: "missing" } } as any),
      extractOcr: async (_root, path) => ({ ...evidence, source: { ...evidence.source, path } }),
      previewInstall: (_root, id) => ({ capabilityId: id, planHash: "p".repeat(64), label: id } as any),
      installCapability: async (_root, input) => { installed += 1; return { state: "ready", id: input.capabilityId }; },
      acquireCapabilityMutation: () => mutationAvailable ? () => undefined : undefined,
    },
  );
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

try {
  const status = await request("GET", "/api/capabilities/documents");
  assert.equal(status.status, 200);
  assert.equal(status.data.ocr.state, "ready");

  const preview = await request("POST", "/api/capabilities/documents/ocr/preview");
  assert.equal(preview.status, 200);
  assert.equal(preview.data.capabilityId, "ocr");
  mutationAvailable = false;
  assert.equal((await request("POST", "/api/capabilities/documents/ocr/install", { planHash: preview.data.planHash })).status, 409);
  mutationAvailable = true;
  assert.equal((await request("POST", "/api/capabilities/documents/ocr/install", { planHash: preview.data.planHash })).data.state, "ready");
  assert.equal(installed, 1);

  const rejected = await request("POST", "/api/documents/evidence", { taskId, sourcePath: denied });
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error.message, /file grants/i);

  const extracted = await request("POST", "/api/documents/evidence", { taskId, sourcePath: source });
  assert.equal(extracted.status, 201);
  assert.equal(extracted.data.artifacts.length, 1);
  assert.equal(extracted.data.artifacts[0].type, "document_evidence");
  assert.equal(extracted.data.artifacts[0].status, "reviewable");
  assert.deepEqual(extracted.data.artifacts[0].scope.fileGrantIds, [grant.grant.id]);
  assert.equal(extracted.data.artifacts[0].content.pages[0].blocks[0].confidence, 0.4);
  assert.equal(extracted.data.artifacts[0].content.document.blocks.some((block: any) => block.type === "page_overlay"), true);
  assert.equal(extracted.data.runs[0].mode, "pipeline");
  assert.equal(extracted.data.agentThreads[0].identity.displayName, "Document Analyst");
  assert.equal(await readFile(source, "utf8"), "source-remains-read-only");

  const conflictWorkspace = createTaskWorkspace(root);
  const snapshot = await conflictWorkspace.open({ kind: "standalone", taskId });
  const run = snapshot.runs[0];
  assert.ok(run);

  console.log("document capability route tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
