import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmTdaiMemoryCandidate,
  createTdaiMemoryCandidatePlan,
  formatAssistantMemoryRecall,
  listAssistantMemories,
  writeTdaiMemoryMigrationBackup,
} from "@linguist-agent/cat-data";

const sourceBytes = Buffer.from(JSON.stringify({ export: "synthetic-only" }), "utf8");
const plan = createTdaiMemoryCandidatePlan({
  scope: { kind: "project", projectId: "tdai-migration" },
  source: {
    sourceId: "tdai-export-synthetic-01",
    rawBytes: sourceBytes,
    records: [
      { recordId: "r1", text: "Use Gem for 宝石 in this project.", identityKey: "term:宝石" },
      { recordId: "r2", text: "Use Jewel for 宝石 in this project.", identityKey: "term:宝石" },
      { recordId: "r3", text: "Use Gem for 宝石 in this project." },
      { recordId: "r4", text: "API_KEY=sk-secret-value-that-must-not-be-copied" },
      { recordId: "r5", text: "okay" },
      { recordId: "r6", text: "Always preserve tag placeholders." },
    ],
  },
  existingMemories: [{ id: "memory_existing", text: "Always preserve tag placeholders." }],
});

assert.equal(plan.report.sourceRecordCount, 6);
assert.equal(plan.report.pendingCandidateCount, 2);
assert.equal(plan.report.excludedSecretOrPiiCount, 1);
assert.equal(plan.report.excludedLowValueCount, 1);
assert.equal(plan.report.duplicateCount, 2);
assert.equal(plan.report.conflictCount, 1);
assert.equal(plan.candidates.every((candidate) => candidate.status === "pending"), true);
assert.equal(plan.candidates.every((candidate) => candidate.source.system === "tencentdb-agent-memory"), true);
assert.equal(plan.candidates.every((candidate) => candidate.source.sourceId === "tdai-export-synthetic-01"), true);
assert.equal(plan.candidates.every((candidate) => candidate.conflictsWith?.length === 1), true);
assert.equal(JSON.stringify(plan).includes("sk-secret-value"), false, "secret text must never enter a candidate plan or report");
assert.match(plan.planHash, /^[a-f0-9]{64}$/);

const root = await mkdtemp(join(tmpdir(), "la-tdai-memory-candidates-"));
const activeBeforeConfirmation = await listAssistantMemories(root, { kind: "project", projectId: "tdai-migration" }, { status: "active" });
assert.deepEqual(activeBeforeConfirmation, []);
assert.equal(formatAssistantMemoryRecall(activeBeforeConfirmation), "", "pending TDAI candidates must not be recalled");

const backup = await writeTdaiMemoryMigrationBackup(join(root, "backups"), plan, {
  sourceId: "tdai-export-synthetic-01",
  rawBytes: sourceBytes,
});
assert.equal((await readFile(backup.sourcePath)).equals(sourceBytes), true, "the explicit source backup must preserve exact bytes");
assert.equal((await readFile(backup.reportPath, "utf8")).includes("sk-secret-value"), false, "report must not copy excluded secret text");

await assert.rejects(
  () => confirmTdaiMemoryCandidate(root, plan, {
    planHash: "0".repeat(64),
    candidateId: plan.candidates[0]!.id,
    confirmedBy: "user",
    sourceTaskId: "task_tdai_migration_review",
    backup,
  }),
  /plan hash/i,
);

const activeAfterRejectedConfirmation = await listAssistantMemories(root, { kind: "project", projectId: "tdai-migration" }, { status: "active" });
assert.deepEqual(activeAfterRejectedConfirmation, [], "a rejected confirmation must not create or recall memory");

const confirmed = await confirmTdaiMemoryCandidate(root, plan, {
  planHash: plan.planHash,
  candidateId: plan.candidates[0]!.id,
  confirmedBy: "user",
  sourceTaskId: "task_tdai_migration_review",
  backup,
  now: "2026-07-23T00:00:00.000Z",
});
assert.equal(confirmed.status, "active");
assert.equal(confirmed.source.taskId, "task_tdai_migration_review");

const activeAfterUserConfirmation = await listAssistantMemories(root, { kind: "project", projectId: "tdai-migration" }, { status: "active" });
assert.equal(activeAfterUserConfirmation.length, 1);
assert.match(formatAssistantMemoryRecall(activeAfterUserConfirmation), /Use Gem for 宝石/);

console.log("tdai_memory_migration tests passed");
