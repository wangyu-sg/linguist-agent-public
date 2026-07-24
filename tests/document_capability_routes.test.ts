import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStandaloneFileGrant,
  createTaskWorkspace,
} from "@linguist-agent/cat-data";
import { createDocumentEvidenceApplicationPort } from "../packages/cat-server/src/application/document_evidence_application_port.js";
import { handleDocumentCapabilityRoute } from "../packages/cat-server/src/routes/document_capability_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-document-capability-routes-"));
const taskId = "document-chat";
const source = join(root, "scan.png");
const denied = join(root, "denied.png");
await writeFile(source, "source-remains-read-only", "utf8");
await writeFile(denied, "not-granted", "utf8");
await createTaskWorkspace(root).create({ owner: { kind: "standalone" }, taskId, title: "Document review", intent: "Review local document evidence", kind: "general" });
const grant = await createStandaloneFileGrant(root, { taskId, path: source, kind: "file", access: "read" });

const routed = {
  schemaVersion: 1 as const,
  source: { sha256: "a".repeat(64), mimeType: "image/png" },
  policy: { source: "conservative-default" as const, reason: "Synthetic test policy.", nativeTextCoverage: 0.75 },
  status: "complete" as const,
  pages: [{ page: 1, status: "complete" as const, reason: "Local light OCR is selected.", backend: { id: "light-ocr" as const, version: "managed", ocr: true }, blockCount: 1 }],
  blocks: [{ id: "page-1", kind: "paragraph" as const, text: "低置信度", locator: { kind: "page" as const, page: 1, bbox: { x: 0, y: 0, width: 10, height: 8 } }, readingOrder: 1, provenance: { sourceDigest: "a".repeat(64), backend: { id: "light-ocr" as const, version: "managed", ocr: true }, confidence: 0.4, userCorrected: false } }],
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
      documentEvidence: createDocumentEvidenceApplicationPort({
        routeDocument: async () => routed,
      }),
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
  assert.equal(extracted.data.artifacts[0].content.router.blocks[0].provenance.confidence, 0.4);
  assert.equal(extracted.data.artifacts[0].content.router.pages[0].backend.id, "light-ocr");
  assert.equal(extracted.data.artifacts[0].content.document.blocks.some((block: any) => block.id === "routing"), true);
  assert.equal(extracted.data.runs[0].mode, "pipeline");
  assert.equal(extracted.data.agentThreads[0].identity.displayName, "Document Analyst");
  assert.equal(await readFile(source, "utf8"), "source-remains-read-only");

  const corrected = await request("POST", "/api/documents/evidence/corrections", {
    taskId,
    artifactId: extracted.data.artifacts[0].id,
    blockId: "page-1",
    text: "人工确认后的文字",
  });
  assert.equal(corrected.status, 201);
  const correctionArtifact = corrected.data.artifacts.find((artifact: any) => artifact.provenance.parentArtifactIds.includes(extracted.data.artifacts[0].id));
  assert.equal(correctionArtifact.type, "document_evidence");
  assert.equal(correctionArtifact.content.router.blocks[0].text, "人工确认后的文字");
  assert.equal(correctionArtifact.content.router.blocks[0].provenance.userCorrected, true);
  assert.equal(correctionArtifact.content.correction.blockId, "page-1");
  assert.equal(corrected.data.artifacts.find((artifact: any) => artifact.id === extracted.data.artifacts[0].id).content.router.blocks[0].text, "低置信度");

  const conflictWorkspace = createTaskWorkspace(root);
  const snapshot = await conflictWorkspace.open({ kind: "standalone", taskId });
  const run = snapshot.runs[0];
  assert.ok(run);

  console.log("document capability route tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
