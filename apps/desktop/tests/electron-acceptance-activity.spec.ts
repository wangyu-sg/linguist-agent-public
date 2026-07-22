import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { createTaskWorkspace, type TaskRunEventDraft } from "../../../packages/cat-data/src/task_workspace.ts";
import {
  ACCEPTANCE_ACTIVITY_COUNT,
  ACCEPTANCE_ACTIVITY_HZ,
  acceptanceActivityPrefix,
  assertOwnedElectronAcceptanceFixture,
  producerStatusLine,
  runElectronAcceptanceActivitySequence,
  validateElectronAcceptanceActivityRequest,
} from "../scripts/electron-acceptance-activity-lib.ts";

const fixtureName = "electron-acceptance-stress";
const projectId = "electron-acceptance-primary";
const taskId = "electron-activity-append";
const batchId = "electron-variable-1040";

async function ownedFixtureRoot(): Promise<string> {
  const root = await mkdtemp("/private/tmp/la-electron-activity-");
  await mkdir(join(root, "data", "projects", projectId), { recursive: true });
  await writeFile(join(root, "data", "electron-acceptance-fixture.json"), JSON.stringify({
    fixture: fixtureName,
    containsCustomerData: false,
  }));
  await writeFile(join(root, "data", "electron-acceptance-config.json"), JSON.stringify({
    fixture: fixtureName,
    containsCustomerData: false,
    runtimeURL: "http://127.0.0.1:8799",
    scenarios: {
      activityAppend: { projectId, batchId, taskId, expectedEvents: 100, expectedHz: 5, producer: "external-canonical" },
    },
  }));
  await writeFile(join(root, "data", "projects", projectId, "electron-acceptance-fixture.json"), JSON.stringify({
    fixture: fixtureName,
    projectId,
    containsCustomerData: false,
  }));
  return root;
}

test("activity producer refuses the managed runtime and unowned data", async () => {
  const root = await ownedFixtureRoot();
  try {
    await assert.rejects(
      assertOwnedElectronAcceptanceFixture({ repoRoot: root, runtimeURL: "http://127.0.0.1:8787", projectId, taskId }),
      /8787/,
    );
    await writeFile(join(root, "data", "electron-acceptance-fixture.json"), JSON.stringify({
      fixture: fixtureName,
      containsCustomerData: true,
    }));
    await assert.rejects(
      assertOwnedElectronAcceptanceFixture({ repoRoot: root, runtimeURL: "http://127.0.0.1:8799", projectId, taskId }),
      /owned synthetic fixture/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("activity producer appends exactly 100 ordered canonical events at 5 Hz", async () => {
  const root = await ownedFixtureRoot();
  try {
    let elapsedMs = 0;
    const base = Date.parse("2026-07-16T08:00:00.000Z");
    const now = () => new Date(base + elapsedMs).toISOString();
    const sleeps: number[] = [];
    const workspace = createTaskWorkspace(root, { now });
    let snapshot = await workspace.create({
      projectId,
      taskId,
      title: "Synthetic live append",
      intent: "Measure canonical Activity delivery.",
      kind: "general",
      initialMessage: "Synthetic fixture only.",
      scope: { batchId, segmentIds: [], sourceLocale: "en-US", targetLocale: "zh-CN" },
    });
    const run = snapshot.runs[0]!;
    const thread = snapshot.agentThreads[0]!;
    const activeAt = now();
    const activate: TaskRunEventDraft[] = [
      { type: "run_upsert", agentThreadId: thread.id, run: { ...run, status: "active", startedAt: activeAt, updatedAt: activeAt } },
      { type: "thread_upsert", agentThreadId: thread.id, thread: { ...thread, status: "active", updatedAt: activeAt } },
    ];
    snapshot = await workspace.appendGenerated({ projectId, taskId, runId: run.id, events: activate });

    const result = await runElectronAcceptanceActivitySequence({
      repoRoot: root,
      runtimeURL: "http://127.0.0.1:8799",
      projectId,
      taskId,
      runToken: "run-a",
      expectedEvents: ACCEPTANCE_ACTIVITY_COUNT,
      expectedHz: ACCEPTANCE_ACTIVITY_HZ,
      workspace,
      now,
      monotonicNow: () => elapsedMs,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        elapsedMs += milliseconds;
      },
    });

    assert.equal(result.appended, 100);
    assert.equal(sleeps.length, 99);
    assert.ok(sleeps.every((value) => value === 200));
    snapshot = await workspace.open({ projectId, taskId });
    const prefix = acceptanceActivityPrefix("run-a");
    const appended = snapshot.activities.filter((activity) => activity.id.startsWith(prefix));
    assert.equal(appended.length, 100);
    assert.deepEqual(appended.map((activity) => activity.id), Array.from(
      { length: 100 },
      (_, index) => `${prefix}${String(index + 1).padStart(3, "0")}`,
    ));
    assert.ok(appended.every((activity, index) => index === 0 || activity.seq > appended[index - 1]!.seq));
    assert.ok(appended.every((activity, index) => Date.parse(activity.createdAt) === base + index * 200));

    await assert.rejects(
      runElectronAcceptanceActivitySequence({
        repoRoot: root,
        runtimeURL: "http://127.0.0.1:8799",
        projectId,
        taskId,
        runToken: "run-a",
        expectedEvents: 100,
        expectedHz: 5,
        workspace,
        now,
        monotonicNow: () => elapsedMs,
        sleep: async () => undefined,
      }),
      /already exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("producer parameters and JSONL status output are fixed and non-sensitive", () => {
  assert.deepEqual(validateElectronAcceptanceActivityRequest({ runToken: "round-2", expectedEvents: 100, expectedHz: 5 }), {
    runToken: "round-2",
    expectedEvents: 100,
    expectedHz: 5,
  });
  assert.throws(() => validateElectronAcceptanceActivityRequest({ runToken: "round-2", expectedEvents: 99, expectedHz: 5 }), /exactly 100/);
  assert.throws(() => validateElectronAcceptanceActivityRequest({ runToken: "round-2", expectedEvents: 100, expectedHz: 4 }), /exactly 5 Hz/);
  assert.throws(() => validateElectronAcceptanceActivityRequest({ runToken: "../escape", expectedEvents: 100, expectedHz: 5 }), /runToken/);

  const line = producerStatusLine("producer_ready", "round-2", { expectedEvents: 100, expectedHz: 5 });
  const parsed = JSON.parse(line);
  assert.deepEqual(parsed, {
    state: "producer_ready",
    runToken: "sha256:a34ee5577eae",
    expectedEvents: 100,
    expectedHz: 5,
  });
  assert.ok(!line.includes("/Users/"));
  assert.ok(!line.includes("round-2"));
});
