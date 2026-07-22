import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVerifiedRuntimeDataBackup,
  executeRuntimeDataRollback,
  previewRuntimeDataRollback,
  previewRuntimeDataSnapshot,
} from "@linguist-agent/cat-data";

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

const repoRoot = await mkdtemp(join(tmpdir(), "la-runtime-migration-"));
const projectFile = join(repoRoot, "data/projects/p1/batches/b1/batch.json");
const sessionFile = join(repoRoot, "data/projects/p1/_pi_sessions/session.jsonl");
await write(projectFile, "project-before");
await write(sessionFile, "session-before");

const snapshot = await previewRuntimeDataSnapshot(repoRoot);
assert.equal(snapshot.files, 2);
assert.ok(snapshot.manifestHash);

await write(projectFile, "before-backfill");
const taskBackfillBackup = await createVerifiedRuntimeDataBackup(repoRoot);
assert.match(taskBackfillBackup.backupId, /^legacy-task-backfill-[a-f0-9]{12}$/);
assert.equal(await readFile(join(taskBackfillBackup.backupPath, "data/projects/p1/batches/b1/batch.json"), "utf8"), "before-backfill");
assert.deepEqual(
  await createVerifiedRuntimeDataBackup(repoRoot),
  taskBackfillBackup,
  "an unchanged runtime tree must reuse the verified snapshot",
);
await write(projectFile, "after-backfill");
await write(join(repoRoot, "data/projects/p2/project.json"), "new-project");
const taskBackfillRollback = await previewRuntimeDataRollback(repoRoot, taskBackfillBackup.backupId);
await assert.rejects(
  executeRuntimeDataRollback(repoRoot, { backupId: taskBackfillBackup.backupId, planHash: "stale" }),
  /rollback plan changed/i,
);
await executeRuntimeDataRollback(repoRoot, { backupId: taskBackfillBackup.backupId, planHash: taskBackfillRollback.planHash });
assert.equal(await readFile(projectFile, "utf8"), "before-backfill");
assert.equal(await readFile(sessionFile, "utf8"), "session-before");
await assert.rejects(stat(join(repoRoot, "data/projects/p2/project.json")));

await rm(repoRoot, { recursive: true, force: true });
console.log("runtime_migrations tests passed");
