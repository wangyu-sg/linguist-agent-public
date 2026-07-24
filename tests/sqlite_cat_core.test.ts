import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateCatCoreSqliteCutover,
  prepareCatCoreSqliteCutover,
  type CatCoreSqliteAuthority,
} from "../packages/cat-server/src/cat_core_sqlite_cutover.js";
import {
  createWorkspace,
  lookupTermbase,
  readBatch,
  readProjectManifest,
  readTermbaseEntries,
  readTermbaseOverrides,
  writeBatch,
  writeTermbaseEntries,
  writeTermbaseOverrides,
  resetCatCorePersistenceForTests,
  createTmStore,
  type CatBatch,
  type ProjectManifest,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-cat-core-"));
const projectId = "synthetic-project";
const batchId = "batch-001";
const authority: CatCoreSqliteAuthority = { assertOwned: async () => undefined };
const sourcePath = join(root, "fixtures", "source.xliff");
const manifestPath = join(root, "data", "projects", projectId, "project.json");
const batchPath = join(root, "data", "projects", projectId, "batches", batchId, "batch.json");

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const sourceBytes = Buffer.from("<xliff><trans-unit id=\"1\"><source>Hello</source></trans-unit></xliff>\n", "utf8");
const batch: CatBatch = {
  schemaVersion: 1,
  format: "xliff_1_2",
  projectId,
  batchId,
  sourceFile: sourcePath,
  sourceLanguage: "en-US",
  targetLanguage: "zh-CN",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
  tagReport: {
    totalSegments: 1,
    placeholderSegments: 0,
    masterMatchedSegments: 1,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  },
  duplicateSourceGroups: [],
  segments: [{
    index: 0,
    id: "seg-1",
    source: "Hello",
    target: "你好",
    originalTarget: "你好",
    rawSource: "Hello",
    rawTarget: "你好",
    locked: false,
    status: "confirmed",
    duplicateKey: "hello",
    placeholderCount: 0,
    unresolvedPlaceholderCount: 0,
    updatedAt: "2026-07-23T00:00:00.000Z",
  }],
};

const manifest: ProjectManifest = {
  schemaVersion: 1,
  projectId,
  projectName: "Synthetic",
  root,
  sourceLanguage: "en-US",
  targetLanguage: "zh-CN",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
  scan: {
    root,
    scannedAt: "2026-07-23T00:00:00.000Z",
    assets: [{ path: sourcePath, relPath: "fixtures/source.xliff", name: "source.xliff", ext: ".xliff", sizeBytes: sourceBytes.byteLength, role: "xliff", confidence: 1, reasons: ["synthetic"] }],
    phraseTagPairs: [],
    warnings: [],
    questions: [],
    importPlan: [],
    suggestedActions: [],
    countsByRole: { xliff: 1 },
  },
  assetRoleDecisions: [{ relPath: "fixtures/source.xliff", role: "xliff", confidence: 1, status: "confirmed", reasons: ["synthetic"] }],
  phraseTagPairs: [],
  importPlan: [],
  warnings: [],
  questions: [],
};

try {
  await mkdir(join(root, "fixtures"), { recursive: true });
  await mkdir(join(root, "data", "projects", projectId, "batches", batchId), { recursive: true });
  await mkdir(join(root, "data", "projects", projectId), { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
  await writeFile(join(root, "data", "projects", projectId, "tm.json"), `${JSON.stringify([{ id: "tm-1", source: "Hello", target: "你好", srcLang: "en-US", tgtLang: "zh-CN", origin: "reviewed", project: projectId }])}\n`);
  await writeFile(join(root, "data", "projects", projectId, "termbase.json"), `${JSON.stringify([{ id: "tb-1", source: "Hello", target: "你好", srcLang: "en-US", tgtLang: "zh-CN", sourceFile: sourcePath, rowNo: 1, origin: "table" }])}\n`);
  await writeFile(join(root, "data", "projects", projectId, "termbase_overrides.json"), "[]\n");

  const prepared = await prepareCatCoreSqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.authority, "sqlite");
  assert.equal(prepared.marker.projects.length, 1);
  assert.ok(prepared.marker.sourceRefs >= 2);
  activateCatCoreSqliteCutover(prepared);

  assert.deepEqual(await readBatch(root, projectId, batchId), batch);
  assert.deepEqual(await readProjectManifest(root, projectId), manifest);
  assert.equal((await readTermbaseEntries(root, projectId)).length, 1);
  assert.equal((await createTmStore(createWorkspace(root, projectId)).lookup({ source: "Hello" }))[0]?.target, "你好");
  assert.equal((await lookupTermbase(root, { projectId, term: "Hello" }))[0]?.target, "你好");

  const next = structuredClone(batch);
  next.segments[0]!.target = "您好";
  next.segments[0]!.updatedAt = "2026-07-23T00:01:00.000Z";
  next.updatedAt = next.segments[0]!.updatedAt;
  await writeBatch(root, projectId, next, batch);
  assert.equal((await readBatch(root, projectId, batchId)).segments[0]?.target, "您好");
  assert.equal(JSON.parse(await readFile(batchPath, "utf8")).segments[0].target, "你好");

  const tm = createTmStore(createWorkspace(root, projectId));
  await tm.upsertReviewed({ source: "Goodbye", target: "再见", srcLang: "en-US", tgtLang: "zh-CN", project: projectId });
  assert.equal((await tm.list()).length, 2);

  const terms = await readTermbaseEntries(root, projectId);
  await writeTermbaseEntries(root, projectId, [...terms, { id: "tb-2", source: "Goodbye", target: "再见", srcLang: "en-US", tgtLang: "zh-CN", sourceFile: sourcePath, rowNo: 2, origin: "manual" }], terms);
  await writeTermbaseOverrides(root, projectId, [{ source: "Hello", target: "您好", srcLang: "en-US", tgtLang: "zh-CN" }]);
  assert.equal((await readTermbaseOverrides(root, projectId))[0]?.target, "您好");
  assert.equal((await lookupTermbase(root, { projectId, term: "Hello" }))[0]?.target, "您好");

  await assert.rejects(() => prepareCatCoreSqliteCutover({ root, authority, activeRunCount: 1 }), /Agent Runs are active/);
  assert.equal((await prepared.blobStore.inspect()).invalidBlobs.length, 0);
  assert.ok(await stat(prepared.markerPath));
  prepared.close();
  resetCatCorePersistenceForTests(root);
  assert.equal((await readBatch(root, projectId, batchId)).segments[0]?.target, "您好");
  assert.equal((await readProjectManifest(root, projectId)).projectId, projectId);
  assert.equal((await createTmStore(createWorkspace(root, projectId)).list()).length, 2);
  assert.equal((await readTermbaseEntries(root, projectId)).length, 2);
  await assert.rejects(
    () => writeBatch(root, projectId, next, next),
    /SQLite CAT-core storage is authoritative/,
  );
  console.log("SQLite CAT core tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
