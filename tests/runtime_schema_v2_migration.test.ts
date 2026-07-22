import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskWorkspace,
  migrateRuntimeDataSchemaV2,
  previewRuntimeDataSnapshot,
  readRuntimeDataSchemaVersion,
  verifyRuntimeDataSchemaV2,
} from "@linguist-agent/cat-data";

const roots: string[] = [];

async function temporaryRuntime(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `la-schema-v2-${label}-`));
  roots.push(root);
  return root;
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => undefined));
}

async function downgradeProjectTaskToV1(root: string, projectId: string, taskId: string): Promise<void> {
  const path = join(root, "data", "projects", projectId, "task_workspace", "tasks", taskId, "snapshot.json");
  const snapshot = JSON.parse(await readFile(path, "utf8")) as {
    schemaVersion: number;
    task: Record<string, unknown>;
    artifacts: Array<Record<string, unknown>>;
    decisions: Array<Record<string, unknown>>;
  };
  const owner = snapshot.task.owner as { kind: "project"; projectId: string };
  const scope = snapshot.task.scope as Record<string, unknown>;
  const { owner: _owner, ...task } = snapshot.task;
  const { kind: _scopeKind, ...legacyScope } = scope;
  snapshot.schemaVersion = 1;
  snapshot.task = { ...task, projectId: owner.projectId, scope: legacyScope };
  snapshot.artifacts = snapshot.artifacts.map((artifact) => {
    const artifactScope = artifact.scope as Record<string, unknown>;
    const { kind: _kind, ...legacyArtifactScope } = artifactScope;
    return { ...artifact, scope: legacyArtifactScope };
  });
  snapshot.decisions = snapshot.decisions.map((decision) => {
    const decisionScope = decision.scope as Record<string, unknown>;
    const { kind: _kind, ...legacyDecisionScope } = decisionScope;
    return { ...decision, scope: legacyDecisionScope };
  });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

try {
  {
    const root = await temporaryRuntime("empty");
    const first = await migrateRuntimeDataSchemaV2(root, { now: () => "2026-07-20T00:00:00.000Z" });
    assert.equal(first.status, "migrated");
    assert.equal(first.schemaVersion, 2);
    assert.equal(first.backup?.schemaVersion, 1);
    assert.match(first.backup?.backupId ?? "", /^schema-1-to-2-[a-f0-9]{64}$/);
    assert.equal(await readRuntimeDataSchemaVersion(root), 2);
    await verifyRuntimeDataSchemaV2(root);

    const second = await migrateRuntimeDataSchemaV2(root);
    assert.equal(second.status, "already_current");
    assert.equal(second.migratedManifestHash, first.migratedManifestHash);
  }

  {
    const root = await temporaryRuntime("project");
    const workspace = createTaskWorkspace(root, { now: () => "2026-07-20T01:00:00.000Z" });
    await workspace.create({
      projectId: "project-one",
      taskId: "task-one",
      title: "Legacy project task",
      intent: "Verify schema upgrade",
      kind: "general",
      scope: { batchId: "batch-one", segmentIds: ["row-one"], sourceLocale: "zh-CN", targetLocale: "en-US" },
      initialMessage: "Keep this event during migration.",
    });
    await downgradeProjectTaskToV1(root, "project-one", "task-one");

    const result = await migrateRuntimeDataSchemaV2(root, { now: () => "2026-07-20T01:01:00.000Z" });
    assert.equal(result.status, "migrated");
    const migrated = await createTaskWorkspace(root).open({
      kind: "project",
      projectId: "project-one",
      taskId: "task-one",
    });
    assert.deepEqual(migrated.task.owner, { kind: "project", projectId: "project-one" });
    assert.deepEqual(migrated.task.scope, {
      kind: "project",
      batchId: "batch-one",
      segmentIds: ["row-one"],
      sourceLocale: "zh-CN",
      targetLocale: "en-US",
    });
    assert.equal(migrated.activities[0]?.body, "Keep this event during migration.");
  }

  {
    const root = await temporaryRuntime("home-chat");
    await writeText(join(root, "data", "assistant", "home_chat.json"), JSON.stringify([
      { ts: "2026-07-18T10:00:00.000Z", kind: "user", text: "帮我检查这份文件" },
      {
        ts: "2026-07-18T10:00:01.000Z",
        kind: "assistant",
        text: "请先选择文件。",
        usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13, costUsd: 0.001, modelCalls: 1 },
      },
    ]));
    const result = await migrateRuntimeDataSchemaV2(root, { now: () => "2026-07-20T02:00:00.000Z" });
    assert.equal(result.status, "migrated");
    assert.match(result.legacyHomeTaskId ?? "", /^legacy-home-[a-f0-9]{24}$/);
    const imported = await createTaskWorkspace(root).open({ kind: "standalone", taskId: result.legacyHomeTaskId! });
    assert.equal(imported.task.owner.kind, "standalone");
    assert.deepEqual(imported.task.scope, {
      kind: "standalone",
      workingDirectoryGrantId: undefined,
      fileGrantIds: [],
    });
    assert.equal(imported.task.kind, "general");
    assert.equal(imported.task.status, "archived");
    assert.deepEqual(imported.activities.map((activity) => activity.body), ["帮我检查这份文件", "请先选择文件。​".replace("​", "")]);
    assert.equal(imported.runs[0]?.usage?.totalTokens, 13);
  }

  {
    const root = await temporaryRuntime("home-session");
    const legacySession = join(root, "data", "assistant", "_pi_sessions", "session-one.jsonl");
    await writeText(legacySession, `${JSON.stringify({ type: "session", id: "legacy" })}\n`);
    const result = await migrateRuntimeDataSchemaV2(root, { now: () => "2026-07-20T03:00:00.000Z" });
    assert.equal(result.status, "migrated");
    const imported = await createTaskWorkspace(root).open({ kind: "standalone", taskId: result.legacyHomeTaskId! });
    assert.equal(imported.task.status, "archived");
    assert.match(imported.activities[0]?.body ?? "", /retained as internal recovery history/i);
    assert.equal(
      await readFile(join(root, "data", "assistant", "tasks", result.legacyHomeTaskId!, "_pi_sessions", "session-one.jsonl"), "utf8"),
      await readFile(legacySession, "utf8"),
    );
  }

  {
    const root = await temporaryRuntime("blocked");
    await writeText(join(root, "data", "sentinel.txt"), "unchanged");
    const before = await previewRuntimeDataSnapshot(root);
    const result = await migrateRuntimeDataSchemaV2(root, {
      activeRuns: [{ turnId: "turn-one" }, { turnId: "turn-two" }],
    });
    assert.equal(result.status, "blocked");
    assert.match(result.blockers[0] ?? "", /turn-one, turn-two/);
    assert.equal(await readRuntimeDataSchemaVersion(root), 1);
    assert.deepEqual(await previewRuntimeDataSnapshot(root), before);
    assert.equal(await exists(join(root, ".la-runtime-data-backups")), false);
  }

  {
    const root = await temporaryRuntime("staging-failure");
    await writeText(join(root, "data", "sentinel.txt"), "before");
    const before = await previewRuntimeDataSnapshot(root);
    await assert.rejects(
      migrateRuntimeDataSchemaV2(root, {
        beforeSwap: async () => { throw new Error("injected staging failure"); },
      }),
      /injected staging failure/,
    );
    assert.deepEqual(await previewRuntimeDataSnapshot(root), before);
    assert.equal(await readRuntimeDataSchemaVersion(root), 1);
    assert.equal(await readFile(join(root, "data", "sentinel.txt"), "utf8"), "before");
  }

  {
    const root = await temporaryRuntime("health-failure");
    await writeText(join(root, "data", "sentinel.txt"), "before");
    const before = await previewRuntimeDataSnapshot(root);
    await assert.rejects(
      migrateRuntimeDataSchemaV2(root, {
        healthCheck: async () => { throw new Error("injected health failure"); },
      }),
      /injected health failure/,
    );
    assert.deepEqual(await previewRuntimeDataSnapshot(root), before);
    assert.equal(await readRuntimeDataSchemaVersion(root), 1);
    assert.equal(await readFile(join(root, "data", "sentinel.txt"), "utf8"), "before");
  }

  {
    const root = await temporaryRuntime("corrupt-task");
    const snapshotPath = join(root, "data", "projects", "project-one", "task_workspace", "tasks", "task-one", "snapshot.json");
    await writeText(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      task: { id: "task-one", projectId: "wrong-project" },
    }));
    const before = await previewRuntimeDataSnapshot(root);
    await assert.rejects(migrateRuntimeDataSchemaV2(root), /legacy scope does not match its storage path/);
    assert.deepEqual(await previewRuntimeDataSnapshot(root), before);
    assert.equal(await readRuntimeDataSchemaVersion(root), 1);
  }

  console.log("runtime schema v2 migration tests passed");
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
