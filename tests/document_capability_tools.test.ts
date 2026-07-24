import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStandaloneFileGrant, createTaskWorkspace } from "@linguist-agent/cat-data";
import { createStandaloneDocumentTools } from "../packages/cat-tools/src/document-capability-tools.ts";

test("General Core OCR tool writes a canonical reviewable Artifact inside the active Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-tool-"));
  try {
    const source = join(root, "scan.png");
    await writeFile(source, "unchanged", "utf8");
    const workspace = createTaskWorkspace(root);
    await workspace.create({ owner: { kind: "standalone" }, taskId: "chat", title: "OCR", intent: "Read scan", kind: "general" });
    const grant = await createStandaloneFileGrant(root, { taskId: "chat", path: source, kind: "file", access: "read" });
    await createStandaloneFileGrant(root, { taskId: "chat", path: root, kind: "directory", access: "read_write", recursive: true });
    const now = "2026-07-20T00:00:00.000Z";
    await workspace.appendGenerated({ kind: "standalone", taskId: "chat", runId: "run", events: [{
      type: "run_upsert", agentThreadId: "run.main", occurredAt: now, run: {
        id: "run", taskId: "chat", mode: "single", status: "active", rootAgentThreadId: "run.main", planHash: null,
        estimatedCalls: 1, estimatedCallsBySource: { main: 1 }, startedAt: now, updatedAt: now, completedAt: null,
        stopAvailable: true, resumeAvailable: false,
      },
    }, {
      type: "thread_upsert", agentThreadId: "run.main", occurredAt: now, thread: {
        id: "run.main", taskId: "chat", runId: "run", parentThreadId: null,
        identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "General Agent", disclosureLabel: "Agent" },
        status: "active", canReceiveUserMessage: true, handoffSummary: null, latestActivityId: null, childThreadIds: [], createdAt: now, updatedAt: now,
      },
    }] });
    const routed = {
      source: { sha256: "b".repeat(64), mimeType: "image/png" },
      status: "complete" as const,
      pages: [{ page: 1, status: "complete" as const, reason: "Local light OCR is selected.", backend: { id: "light-ocr" as const, version: "managed", ocr: true }, blockCount: 1 }],
      blocks: [{ id: "page-1", kind: "paragraph" as const, text: "text", locator: { kind: "page" as const, page: 1, bbox: { x: 0, y: 0, width: 5, height: 5 } }, readingOrder: 1, provenance: { sourceDigest: "b".repeat(64), backend: { id: "light-ocr" as const, version: "managed", ocr: true }, confidence: 0.2, userCorrected: false } }],
    };
    const [tool, officeTool] = createStandaloneDocumentTools({
      runtimeRoot: root,
      taskId: "chat",
      runId: "run",
      agentThreadId: "run.main",
      routeDocument: async () => routed,
      runOffice: async (_root, request) => ({
        ok: true,
        sourcePath: request.sourcePath,
        sourceSha256: "c".repeat(64),
        outputPath: request.outputPath,
        outputSha256: "d".repeat(64),
        diff: { changed: 1 },
        validation: { reopened: true },
      }),
    });
    const result = await tool!.execute("call", { sourcePath: source });
    assert.match(result.content[0]!.text, /reviewable document evidence Artifact/);
    const snapshot = await workspace.open({ kind: "standalone", taskId: "chat" });
    assert.equal(snapshot.artifacts[0]?.type, "document_evidence");
    assert.equal(snapshot.artifacts[0]?.status, "reviewable");
    assert.equal((snapshot.artifacts[0]?.content.router as any)?.pages[0].backend.id, "light-ocr");
    assert.equal(snapshot.artifacts[0]?.scope.kind, "standalone");
    assert.deepEqual(snapshot.artifacts[0]?.scope.kind === "standalone" ? snapshot.artifacts[0].scope.fileGrantIds : [], [grant.grant.id]);
    assert.equal(snapshot.activities.at(-1)?.refs.artifactIds[0], snapshot.artifacts[0]?.id);
    assert.equal(await readFile(source, "utf8"), "unchanged");

    const officeResult = await officeTool!.execute("office", {
      operation: "replace",
      sourcePath: source,
      outputPath: join(root, "output.xlsx"),
      replacements: [{ sheet: "Sheet1", cell: "A1", value: "Updated" }],
    });
    assert.match(officeResult.content[0]!.text, /rich_document Artifact/);
    const afterOffice = await workspace.open({ kind: "standalone", taskId: "chat" });
    const richDocument = afterOffice.artifacts.find((artifact) => artifact.type === "rich_document");
    assert.ok(richDocument);
    assert.equal((richDocument.content.document as any)?.blocks.some((block: any) => block.type === "diff"), true);
    assert.deepEqual(Object.keys(richDocument.content).sort(), ["artifactPath", "document", "operation"]);
    assert.equal(await readFile(source, "utf8"), "unchanged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
