import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateCatGovernanceSqliteCutover,
  prepareCatGovernanceSqliteCutover,
  type CatGovernanceSqliteAuthority,
} from "../packages/cat-server/src/cat_governance_sqlite_cutover.js";
import {
  appendQualityDecisionLedgerOnce,
  createProposalSet,
  readProposalSet,
  readQualityChecklist,
  readQualityDecisionLedger,
  resetCatGovernancePersistenceForTests,
  writeQualityChecklist,
  type CatBatch,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-cat-governance-"));
const projectId = "governance-project";
const batchId = "batch-001";
const authority: CatGovernanceSqliteAuthority = { assertOwned: async () => undefined };
const projectRoot = join(root, "data", "projects", projectId);
const emptyProjectId = "empty-project";
const batchRoot = join(projectRoot, "batches", batchId);
const ledgerPath = join(projectRoot, "quality_decision_ledger.jsonl");
const checklistPath = join(projectRoot, "quality_checklist.json");
const proposalPath = join(batchRoot, "proposals", "set-1.json");

const batch: CatBatch = {
  schemaVersion: 1,
  format: "xliff_1_2",
  projectId,
  batchId,
  sourceFile: join(root, "source.xliff"),
  sourceLanguage: "en-US",
  targetLanguage: "zh-CN",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
  tagReport: { totalSegments: 1, placeholderSegments: 0, masterMatchedSegments: 1, masterUnmatchedSegments: 0, replacedPlaceholders: 0, unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0 },
  duplicateSourceGroups: [],
  segments: [{ index: 0, id: "seg-1", source: "Hello", target: "你好", originalTarget: "你好", rawSource: "Hello", rawTarget: "你好", locked: false, status: "confirmed", duplicateKey: "hello", placeholderCount: 0, unresolvedPlaceholderCount: 0, updatedAt: "2026-07-23T00:00:00.000Z" }],
};

try {
  await mkdir(join(batchRoot, "proposals"), { recursive: true });
  await mkdir(join(root, "data", "projects", emptyProjectId), { recursive: true });
  await writeFile(join(root, "source.xliff"), "<xliff/>\n");
  await writeFile(join(batchRoot, "batch.json"), `${JSON.stringify(batch, null, 2)}\n`);
  const ledgerWithoutHash = { projectId, kind: "quality_finding", decision: "open", batchId, segmentId: "seg-1", findingId: "finding-1", code: "TERM", severity: "blocker", evidenceRefs: ["tb:1"], actor: "qa", recordedAt: "2026-07-23T00:00:00.000Z", schemaVersion: 1, sequence: 1 };
  await writeFile(ledgerPath, `${JSON.stringify({ ...ledgerWithoutHash, hash: createHash("sha256").update(JSON.stringify(ledgerWithoutHash)).digest("hex") })}\n`);
  await writeFile(checklistPath, `${JSON.stringify({ schemaVersion: 1, projectId, updatedAt: "2026-07-23T00:00:00.000Z", mechanicalOptions: {}, entries: [{ id: "ban", name: "Ban", scope: "target", pattern: "forbidden", severity: "blocker", status: "active" }] }, null, 2)}\n`);
  await writeFile(proposalPath, `${JSON.stringify({ schemaVersion: 1, projectId, batchId, proposalSetId: "set-1", title: "Synthetic", status: "active", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z", proposals: [{ proposalId: "p0001-seg-1", index: 1, segmentId: "seg-1", source: "Hello", originalTarget: "你好", proposedTarget: "您好", reason: "review", changeType: "edit", evidenceSources: ["tm:1"], status: "proposed", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" }] }, null, 2)}\n`);

  const prepared = await prepareCatGovernanceSqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.authority, "sqlite");
  activateCatGovernanceSqliteCutover(prepared);
  assert.equal((await readQualityDecisionLedger(root, projectId)).length, 1);
  assert.equal((await readQualityChecklist(root, projectId)).entries.length, 1);
  assert.equal((await readProposalSet(root, projectId, batchId, "set-1")).proposalSetId, "set-1");
  await appendQualityDecisionLedgerOnce(root, [{ projectId, batchId, segmentId: "seg-1", findingId: "finding-1", code: "TERM", kind: "quality_waiver", decision: "ignore_with_reason", reason: "approved", logicalEventId: "waiver-1" }]);
  await writeQualityChecklist(root, projectId, [{ id: "new", name: "New", scope: "target", pattern: "new", severity: "warning", status: "active" }]);
  await createProposalSet(root, projectId, batchId, { proposalSetId: "set-2", proposals: [{ segmentId: "seg-1", proposedTarget: "您好", reason: "review", changeType: "edit", evidenceSources: ["tm:1"] }] });
  assert.equal((await readQualityDecisionLedger(root, projectId)).length, 2);
  assert.equal((await readQualityChecklist(root, projectId)).entries[0]?.id, "new");
  assert.equal((await readProposalSet(root, projectId, batchId, "set-2")).proposalSetId, "set-2");
  assert.equal(JSON.parse(await readFile(checklistPath, "utf8")).entries[0].id, "ban");
  assert.ok(await stat(prepared.markerPath));
  prepared.close();
  resetCatGovernancePersistenceForTests(root);
  assert.equal((await readQualityDecisionLedger(root, projectId)).length, 2);
  assert.deepEqual(await readQualityDecisionLedger(root, emptyProjectId), []);
  assert.equal((await readQualityChecklist(root, emptyProjectId)).projectId, emptyProjectId);
  await assert.rejects(() => readProposalSet(root, emptyProjectId, "batch-404", "set-404"), /not found/);
  await assert.rejects(() => writeQualityChecklist(root, projectId, [{ id: "blocked", name: "Blocked", scope: "target", pattern: "x", severity: "warning", status: "active" }]), /authoritative/);
  console.log("SQLite CAT governance tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
