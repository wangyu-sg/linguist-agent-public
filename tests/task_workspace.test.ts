import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace, pendingInitialTaskRun, type TaskRunEventDraft } from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-task-workspace-"));
const nowValues = [
  "2026-07-10T10:00:00.000Z",
  "2026-07-10T10:01:00.000Z",
];
const workspace = createTaskWorkspace(root, {
  now: () => nowValues.shift() ?? "2026-07-10T10:02:00.000Z",
  createTaskId: () => "task-persisted",
});

const created = await workspace.create({
  projectId: "project-one",
  title: "本地化 482–520 段",
  intent: "审校本批剧情，并保持角色语气与术语一致。",
  kind: "translation",
  scope: { batchId: "batch-story-07", segmentIds: ["482", "483"] },
});

assert.equal(created.task.id, "task-persisted");
assert.equal(created.task.status, "draft");
assert.equal(created.task.scope.batchId, "batch-story-07");
assert.deepEqual(created.task.scope.segmentIds, ["482", "483"]);
assert.equal(created.activeRunId, null);
assert.equal(created.eventCursor, "task-persisted:0");
assert.deepEqual(created.runs, []);
assert.equal("sessionId" in created.task, false);
assert.deepEqual(await workspace.probe({ projectId: "project-one", taskId: "task-persisted" }), {
  schemaVersion: 2,
  kind: "project",
  projectId: "project-one",
  taskId: "task-persisted",
  taskStatus: "draft",
  taskUpdatedAt: created.task.updatedAt,
  eventCursor: created.eventCursor,
  projectedAt: created.projectedAt,
  activeRunId: null,
  activeRunStatus: null,
  activeRunUpdatedAt: null,
});

// A new module instance must recover the same durable user object. The public
// interface, not direct filesystem inspection, is the verification surface.
const reopened = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-persisted" });
assert.deepEqual(reopened, created);
assert.deepEqual(await createTaskWorkspace(root).list({ projectId: "project-one" }), [created.task]);

// A no-project Chat is a canonical standalone Task, not a synthetic Project.
// The discriminated locator must keep it isolated even when a Project Task has
// the same taskId.
const standalone = await workspace.create({
  owner: { kind: "standalone" },
  taskId: "task-persisted",
  title: "无项目对话",
  intent: "作为通用 Agent 处理没有项目归属的工作。",
  kind: "general",
  scope: { workingDirectoryGrantId: "grant-workspace", fileGrantIds: ["grant-file"] },
});
assert.deepEqual(standalone.task.owner, { kind: "standalone" });
assert.deepEqual(standalone.task.scope, {
  kind: "standalone",
  workingDirectoryGrantId: "grant-workspace",
  fileGrantIds: ["grant-file"],
});
assert.equal((await workspace.open({ kind: "project", projectId: "project-one", taskId: "task-persisted" })).task.title, created.task.title);
assert.equal((await workspace.open({ kind: "standalone", taskId: "task-persisted" })).task.title, "无项目对话");
assert.deepEqual(await workspace.list({ kind: "standalone" }), [standalone.task]);
assert.deepEqual(await workspace.probe({ kind: "standalone", taskId: "task-persisted" }), {
  schemaVersion: 2,
  kind: "standalone",
  taskId: "task-persisted",
  taskStatus: "draft",
  taskUpdatedAt: standalone.task.updatedAt,
  eventCursor: standalone.eventCursor,
  projectedAt: standalone.projectedAt,
  activeRunId: null,
  activeRunStatus: null,
  activeRunUpdatedAt: null,
});
assert.equal((await workspace.archive({ kind: "standalone", taskId: "task-persisted" })).task.status, "archived");
assert.equal((await workspace.restore({ kind: "standalone", taskId: "task-persisted" })).task.status, "draft");
assert.equal((await workspace.restore({ kind: "standalone", taskId: "task-persisted" })).task.status, "draft", "restore must be idempotent");
await assert.rejects(
  workspace.create({
    owner: { kind: "standalone" },
    taskId: "standalone-translation",
    title: "Invalid standalone CAT Task",
    intent: "Must not bypass Project CAT scope.",
    kind: "translation",
  }),
  /Standalone Tasks must use kind general/,
);

const initialMessage = `Review the whole imported batch. ${"Keep this instruction. ".repeat(40)}`.trim();
const createdWithInitialTurn = await workspace.create({
  projectId: "project-one",
  taskId: "task-initial-turn",
  title: "Review imported batch",
  intent: initialMessage,
  kind: "review",
  scope: { batchId: "batch-story-07", segmentIds: ["482"] },
  initialMessage,
});
const initialRun = assertInitialTurn(createdWithInitialTurn, initialMessage);
assert.deepEqual(createdWithInitialTurn.activities[0]?.refs.segmentIds, ["482"]);
assert.equal(pendingInitialTaskRun(createdWithInitialTurn, initialMessage, initialRun.id)?.run.id, initialRun.id);
assert.equal(pendingInitialTaskRun(createdWithInitialTurn, "different message", initialRun.id), undefined);
assert.equal(createdWithInitialTurn.eventCursor, "task-initial-turn:3");
assert.deepEqual(
  await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-initial-turn" }),
  createdWithInitialTurn,
  "Task, pending Main Run, root thread, and full human message must reopen as one durable creation",
);
const initialEvents = await workspace.events({
  projectId: "project-one",
  taskId: "task-initial-turn",
  runId: initialRun.id,
});
assert.deepEqual(initialEvents.events.map((event) => event.type), ["run_upsert", "thread_upsert", "activity_append"]);

function assertInitialTurn(snapshot: typeof createdWithInitialTurn, message: string) {
  assert.equal(snapshot.task.status, "active");
  assert.equal(snapshot.runs.length, 1);
  const run = snapshot.runs[0]!;
  assert.equal(snapshot.activeRunId, run.id);
  assert.equal(run.mode, "single");
  assert.equal(run.status, "pending");
  assert.equal(run.stopAvailable, true);
  const thread = snapshot.agentThreads.find((row) => row.id === run.rootAgentThreadId);
  assert.equal(thread?.identity.kind, "main");
  assert.equal(thread?.status, "pending");
  const activity = snapshot.activities.find((row) => row.runId === run.id && row.type === "message");
  assert.equal(activity?.actor.kind, "human");
  assert.equal(activity?.body, message, "the initial user message must never be truncated");
  return run;
}

const duplicateCreates = await Promise.allSettled([
  createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-create-race", title: "first", intent: "race", kind: "general" }),
  createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-create-race", title: "second", intent: "race", kind: "general" }),
]);
assert.equal(duplicateCreates.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(duplicateCreates.filter((result) => result.status === "rejected").length, 1);

const titleWorkspace = createTaskWorkspace(root, { now: () => "2026-07-10T10:03:00.000Z" });
await titleWorkspace.create({
  projectId: "project-one",
  taskId: "task-auto-title",
  title: "检查这个测试批次，准备自适应 Team 计划",
  intent: "检查这个测试批次，准备自适应 Team 计划并展示每位 Agent 的过程。",
  kind: "general",
  autoTitle: true,
});
const pendingTitle = (await titleWorkspace.open({ projectId: "project-one", taskId: "task-auto-title" })).task.titleGeneration!;
assert.equal(pendingTitle.status, "pending");
const claimedTitle = await titleWorkspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-auto-title",
  expectedStatus: "pending",
  expectedAttemptId: null,
  generation: {
    ...pendingTitle,
    attemptId: "title-attempt-one",
    startedAt: "2026-07-10T10:03:00.000Z",
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
  },
});
assert.equal(claimedTitle?.task.titleGeneration?.attemptId, "title-attempt-one");
assert.equal(await titleWorkspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-auto-title",
  expectedStatus: "pending",
  expectedAttemptId: null,
  generation: pendingTitle,
}), null, "a claimed title generation cannot be claimed twice");
const generatedTitle = await titleWorkspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-auto-title",
  expectedStatus: "pending",
  expectedAttemptId: "title-attempt-one",
  title: "审查测试批次 Team 计划",
  generation: {
    ...claimedTitle!.task.titleGeneration!,
    status: "generated",
    completedAt: "2026-07-10T10:03:00.000Z",
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, costUSD: 0.0002, modelCalls: 1 },
  },
});
assert.equal(generatedTitle?.task.title, "审查测试批次 Team 计划");
assert.equal(generatedTitle?.task.titleGeneration?.usage?.modelCalls, 1);
const renamedTask = await titleWorkspace.updateTitle({
  projectId: "project-one",
  taskId: "task-auto-title",
  title: "审查测试批次 Team 计划",
});
assert.equal(renamedTask.task.title, "审查测试批次 Team 计划");
assert.equal(renamedTask.eventCursor, "task-auto-title:0");
assert.equal((await titleWorkspace.open({ projectId: "project-one", taskId: "task-auto-title" })).task.title, "审查测试批次 Team 计划");

await titleWorkspace.create({
  projectId: "project-one",
  taskId: "task-manual-title",
  title: "等待自动命名",
  intent: "验证人工重命名拥有最终标题权威。",
  kind: "general",
  autoTitle: true,
});
const manuallyRenamed = await titleWorkspace.updateTitle({
  projectId: "project-one",
  taskId: "task-manual-title",
  title: "人工命名的任务",
});
assert.equal(manuallyRenamed.task.title, "人工命名的任务");
assert.equal(manuallyRenamed.task.titleGeneration?.status, "failed");
assert.match(manuallyRenamed.task.titleGeneration?.error ?? "", /manual Task rename/);
assert.equal(await titleWorkspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-manual-title",
  expectedStatus: "pending",
  expectedAttemptId: null,
  title: "迟到的自动标题",
  generation: {
    status: "generated",
    requestedAt: "2026-07-10T10:03:00.000Z",
    completedAt: "2026-07-10T10:03:00.000Z",
  },
}), null, "manual rename must prevent a late background title from replacing the user title");

await titleWorkspace.create({
  projectId: "project-one",
  taskId: "task-archive",
  title: "Historical task",
  intent: "Keep imported history without presenting it as active work.",
  kind: "general",
});
const archivedTask = await titleWorkspace.archive({ projectId: "project-one", taskId: "task-archive" });
assert.equal(archivedTask.task.status, "archived");
assert.equal(archivedTask.eventCursor, "task-archive:0");
assert.deepEqual(await titleWorkspace.archive({ projectId: "project-one", taskId: "task-archive" }), archivedTask, "archive must be idempotent");

const appended = await workspace.append({
  projectId: "project-one",
  taskId: "task-persisted",
  page: {
    schemaVersion: 2,
    taskId: "task-persisted",
    runId: "run-one",
    afterCursor: "task-persisted:0",
    nextCursor: "task-persisted:3",
    hasMore: false,
    events: [
      {
        id: "event-run-one",
        cursor: "task-persisted:1",
        seq: 1,
        taskId: "task-persisted",
        runId: "run-one",
        agentThreadId: "thread-main",
        type: "run_upsert",
        occurredAt: "2026-07-10T10:01:00.000Z",
        run: {
          id: "run-one",
          taskId: "task-persisted",
          mode: "team",
          status: "active",
          rootAgentThreadId: "thread-main",
          planHash: "plan-one",
          estimatedCalls: 3,
          startedAt: "2026-07-10T10:01:00.000Z",
          updatedAt: "2026-07-10T10:01:00.000Z",
          completedAt: null,
          stopAvailable: true,
          resumeAvailable: false,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0, modelCalls: 0 }
        }
      },
      {
        id: "event-thread-main",
        cursor: "task-persisted:2",
        seq: 2,
        taskId: "task-persisted",
        runId: "run-one",
        agentThreadId: "thread-main",
        type: "thread_upsert",
        occurredAt: "2026-07-10T10:01:00.000Z",
        thread: {
          id: "thread-main",
          taskId: "task-persisted",
          runId: "run-one",
          parentThreadId: null,
          identity: {
            kind: "main",
            roleId: "linguist-agent",
            displayName: "Linguist Agent",
            roleLabel: "主 Agent",
            disclosureLabel: "Agent"
          },
          status: "active",
          canReceiveUserMessage: true,
          handoffSummary: null,
          latestActivityId: "activity-ack",
          childThreadIds: [],
          createdAt: "2026-07-10T10:01:00.000Z",
          updatedAt: "2026-07-10T10:01:01.000Z"
        }
      },
      {
        id: "event-activity-ack",
        cursor: "task-persisted:3",
        seq: 3,
        taskId: "task-persisted",
        runId: "run-one",
        agentThreadId: "thread-main",
        type: "activity_append",
        occurredAt: "2026-07-10T10:01:01.000Z",
        activity: {
          id: "activity-ack",
          taskId: "task-persisted",
          runId: "run-one",
          agentThreadId: "thread-main",
          seq: 1,
          type: "acknowledgement",
          status: "done",
          actor: {
            kind: "agent",
            id: "linguist-agent",
            displayName: "Linguist Agent",
            agentThreadId: "thread-main"
          },
          title: "已接收任务",
          body: "我会先确认约束，再开始执行。",
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: "2026-07-10T10:01:01.000Z",
          updatedAt: "2026-07-10T10:01:01.000Z"
        }
      }
    ]
  }
});

assert.equal(appended.task.status, "active");
assert.equal(appended.activeRunId, "run-one");
assert.equal(appended.eventCursor, "task-persisted:3");
assert.equal(appended.runs[0]?.status, "active");
await assert.rejects(
  workspace.archive({ projectId: "project-one", taskId: "task-persisted" }),
  /cannot be archived while run run-one is active/,
);
assert.equal(appended.agentThreads[0]?.identity.displayName, "Linguist Agent");
assert.equal(appended.activities[0]?.type, "acknowledgement");
const activeProbe = await workspace.probe({ projectId: "project-one", taskId: "task-persisted" });
assert.equal(activeProbe.eventCursor, appended.eventCursor);
assert.equal(activeProbe.activeRunId, "run-one");
assert.equal(activeProbe.activeRunStatus, "active");
assert.deepEqual(await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-persisted" }), appended);

const eventPage = await createTaskWorkspace(root).events({
  projectId: "project-one",
  taskId: "task-persisted",
  runId: "run-one",
  afterCursor: "task-persisted:0",
  limit: 10,
});
assert.equal(eventPage.events.length, 3);
assert.equal(eventPage.nextCursor, "task-persisted:3");
assert.equal(eventPage.hasMore, false);

await assert.rejects(
  () => workspace.append({ projectId: "project-one", taskId: "task-persisted", page: eventPage }),
  /cursor conflict/,
  "a stale writer must not overwrite a newer TaskWorkspace projection",
);
await assert.rejects(
  () => workspace.append({
    projectId: "project-one",
    taskId: "task-persisted",
    page: {
      schemaVersion: 2,
      taskId: "task-persisted",
      runId: "run-one",
      afterCursor: "task-persisted:3",
      nextCursor: "task-persisted:4",
      hasMore: false,
      events: [{
        id: "event-bad-seq",
        cursor: "task-persisted:4",
        seq: 3,
        taskId: "task-persisted",
        runId: "run-one",
        type: "usage_update",
        occurredAt: "2026-07-10T10:01:02.000Z",
        usage: { totalTokens: 1 },
      }],
    },
  }),
  /expected event seq 4, received 3/,
  "an invalid page must fail before corrupting the durable event log",
);

const firstEventPage = await workspace.events({
  projectId: "project-one",
  taskId: "task-persisted",
  runId: "run-one",
  afterCursor: "task-persisted:0",
  limit: 2,
});
assert.equal(firstEventPage.events.length, 2);
assert.equal(firstEventPage.nextCursor, "task-persisted:2");
assert.equal(firstEventPage.hasMore, true);
const secondEventPage = await workspace.events({
  projectId: "project-one",
  taskId: "task-persisted",
  runId: "run-one",
  afterCursor: firstEventPage.nextCursor,
  limit: 2,
});
assert.equal(secondEventPage.events.length, 1);
assert.equal(secondEventPage.nextCursor, "task-persisted:3");
assert.equal(secondEventPage.hasMore, false);

// Fault injection: emulate a process dying after events.jsonl was appended but
// before the derived snapshot rename completed. Reopening through the public
// interface must replay durable events and heal the projection.
const persistedTaskRoot = join(root, "data", "projects", "project-one", "task_workspace", "tasks", "task-persisted");
await writeFile(
  join(persistedTaskRoot, "snapshot.json"),
  `${JSON.stringify(created, null, 2)}\n`,
  "utf8",
);
// Legacy one-event-per-line logs remain readable during the v1 page-record migration.
await writeFile(join(persistedTaskRoot, "events.jsonl"), `${eventPage.events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
const replayed = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-persisted" });
assert.deepEqual(replayed, appended);
await appendFile(join(persistedTaskRoot, "events.jsonl"), "{\"recordType\":\"task_run_event_page_v1\",\"page\":", "utf8");
assert.deepEqual(await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-persisted" }), appended);

await workspace.create({
  projectId: "project-one",
  taskId: "task-concurrent",
  title: "并发任务",
  intent: "验证两个请求不能从同一 cursor 同时覆盖任务状态。",
  kind: "general",
});
const concurrentPage = {
  schemaVersion: 2,
  taskId: "task-concurrent",
  runId: "run-concurrent",
  afterCursor: "task-concurrent:0",
  nextCursor: "task-concurrent:2",
  hasMore: false,
  events: [
    {
      id: "event-concurrent-run",
      cursor: "task-concurrent:1",
      seq: 1,
      taskId: "task-concurrent",
      runId: "run-concurrent",
      agentThreadId: "thread-concurrent-main",
      type: "run_upsert",
      occurredAt: "2026-07-10T10:02:00.000Z",
      run: {
        id: "run-concurrent",
        taskId: "task-concurrent",
        mode: "single",
        status: "active",
        rootAgentThreadId: "thread-concurrent-main",
        updatedAt: "2026-07-10T10:02:00.000Z",
        stopAvailable: true,
        resumeAvailable: false
      }
    },
    {
      id: "event-concurrent-thread",
      cursor: "task-concurrent:2",
      seq: 2,
      taskId: "task-concurrent",
      runId: "run-concurrent",
      agentThreadId: "thread-concurrent-main",
      type: "thread_upsert",
      occurredAt: "2026-07-10T10:02:00.000Z",
      thread: {
        id: "thread-concurrent-main",
        taskId: "task-concurrent",
        runId: "run-concurrent",
        parentThreadId: null,
        identity: {
          kind: "main",
          roleId: "linguist-agent",
          displayName: "Linguist Agent",
          roleLabel: "主 Agent",
          disclosureLabel: "Agent"
        },
        status: "active",
        canReceiveUserMessage: true,
        childThreadIds: [],
        createdAt: "2026-07-10T10:02:00.000Z",
        updatedAt: "2026-07-10T10:02:00.000Z"
      }
    }
  ]
};
const concurrentResults = await Promise.allSettled([
  createTaskWorkspace(root).append({ projectId: "project-one", taskId: "task-concurrent", page: concurrentPage }),
  createTaskWorkspace(root).append({ projectId: "project-one", taskId: "task-concurrent", page: concurrentPage }),
]);
assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(concurrentResults.filter((result) => result.status === "rejected").length, 1);

await assert.rejects(
  createTaskWorkspace(root).appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-overlap",
    events: [{
      type: "run_upsert",
      agentThreadId: "thread-overlap-main",
      run: {
        id: "run-overlap",
        taskId: "task-concurrent",
        mode: "pipeline",
        status: "active",
        rootAgentThreadId: "thread-overlap-main",
        modelRoutes: {},
        updatedAt: "2026-07-10T10:02:01.000Z",
        stopAvailable: false,
        resumeAvailable: false,
      },
    }],
  }),
  /already has active run run-concurrent/,
);

function generatedEvents(evidenceRef: string, timestamp: string, proposedSeq: number): TaskRunEventDraft[] {
  return [
    {
      type: "activity_append",
      agentThreadId: "thread-concurrent-main",
      activity: {
        id: "activity-generated",
        taskId: "task-concurrent",
        runId: "run-concurrent",
        agentThreadId: "thread-concurrent-main",
        seq: proposedSeq,
        type: "progress",
        status: "running",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: "thread-concurrent-main" },
        title: "Generated once",
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    {
      type: "artifact_upsert",
      agentThreadId: "thread-concurrent-main",
      artifact: {
        id: "artifact-generated",
        taskId: "task-concurrent",
        runId: "run-concurrent",
        type: "evidence_pack",
        status: "reviewable",
        title: "Evidence",
        scope: { kind: "project", segmentIds: [] },
        version: proposedSeq,
        provenance: { agentThreadId: "thread-concurrent-main", activityId: "activity-generated", evidenceRefs: [evidenceRef], parentArtifactIds: [] },
        availableDecisions: [],
        content: { stable: true },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  ];
}

const generatedResults = await Promise.allSettled([
  createTaskWorkspace(root).appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    events: generatedEvents("evidence:a", "2026-07-10T10:03:00.000Z", 99),
  }),
  createTaskWorkspace(root).appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    events: generatedEvents("evidence:b", "2026-07-10T10:03:01.000Z", 100),
  }),
]);
assert.equal(generatedResults.every((result) => result.status === "fulfilled"), true);
const generatedSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-concurrent" });
assert.equal(generatedSnapshot.activities.filter((activity) => activity.id === "activity-generated").length, 1);
assert.equal(generatedSnapshot.activities.find((activity) => activity.id === "activity-generated")?.seq, 1);
assert.equal(generatedSnapshot.artifacts.find((artifact) => artifact.id === "artifact-generated")?.version, 2);
assert.deepEqual(generatedSnapshot.artifacts.find((artifact) => artifact.id === "artifact-generated")?.provenance.evidenceRefs, ["evidence:b"]);

const requiredDecision = {
  id: "decision-concurrent",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  requestedByThreadId: "thread-concurrent-main",
  kind: "answer" as const,
  status: "required" as const,
  prompt: "Choose one answer.",
  options: [{ id: "accept", label: "Accept", action: "answer" as const, destructive: false }],
  interactionId: "interaction-concurrent",
  questionIndex: 0,
  selectionMode: "single" as const,
  selectedOptionId: null,
  selectedOptionIds: [],
  reason: null,
  scope: { kind: "project", segmentIds: [] },
  createdAt: "2026-07-10T10:03:02.000Z",
  decidedAt: null,
};
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  events: [{ type: "decision_upsert", agentThreadId: "thread-concurrent-main", decision: requiredDecision }],
});
await assert.rejects(
  workspace.appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    events: [{
      type: "decision_upsert",
      agentThreadId: "thread-concurrent-main",
      decision: { ...requiredDecision, prompt: "A changed question must not replace the pending one." },
    }],
  }),
  /Decision decision-concurrent definition cannot change/,
);
await assert.rejects(
  workspace.appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    events: [{
      type: "decision_upsert",
      agentThreadId: "thread-concurrent-main",
      decision: {
        ...requiredDecision,
        id: "decision-added-late",
        questionIndex: 1,
        prompt: "A late question must not change an interaction already shown to the user.",
      },
    }],
  }),
  /Decision interaction interaction-concurrent cannot add questions after it is recorded/,
);
const recordedDecision = {
  ...requiredDecision,
  status: "recorded" as const,
  selectedOptionId: "accept",
  selectedOptionIds: ["accept"],
  reason: "Confirmed",
  decidedAt: "2026-07-10T10:03:03.000Z",
};
let decisionSideEffects = 0;
const decisionResults = await Promise.allSettled([
  createTaskWorkspace(root).appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    expectedRequiredDecisionIds: [requiredDecision.id],
    beforeCommit: async () => { decisionSideEffects += 1; },
    events: [{ type: "decision_upsert", agentThreadId: "thread-concurrent-main", decision: recordedDecision }],
  }),
  createTaskWorkspace(root).appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: "run-concurrent",
    expectedRequiredDecisionIds: [requiredDecision.id],
    beforeCommit: async () => { decisionSideEffects += 1; },
    events: [{ type: "decision_upsert", agentThreadId: "thread-concurrent-main", decision: recordedDecision }],
  }),
]);
assert.equal(decisionResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(decisionResults.filter((result) => result.status === "rejected").length, 1);
assert.equal(decisionSideEffects, 1, "only the CAS winner may execute a canonical side effect");

const resourceManifest = {
  profile: "main",
  packages: [{
    name: "@eko24ive/pi-ask",
    source: "npm:@eko24ive/pi-ask@1.1.0",
    version: "1.1.0",
    integrity: "sha512-dGVzdA==",
  }],
  activeToolNames: ["ask"],
  requestShapeHash: "shape-one",
};
const runWithManifest = {
  id: "run-concurrent",
  taskId: "task-concurrent",
  mode: "single" as const,
  status: "active" as const,
  rootAgentThreadId: "thread-concurrent-main",
  updatedAt: "2026-07-10T10:03:04.000Z",
  stopAvailable: true,
  resumeAvailable: false,
  resourceManifest,
};
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  events: [{ type: "run_upsert", agentThreadId: "thread-concurrent-main", run: runWithManifest }],
});
const lifecycleUpdate = await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  events: [{
    type: "run_upsert",
    agentThreadId: "thread-concurrent-main",
    run: { ...runWithManifest, updatedAt: "2026-07-10T10:03:05.000Z", resourceManifest: undefined },
  }],
});
assert.deepEqual(
  JSON.parse(JSON.stringify(lifecycleUpdate.runs.find((run) => run.id === "run-concurrent")?.resourceManifest)),
  resourceManifest,
);
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  events: [{
    type: "run_upsert",
    agentThreadId: "thread-concurrent-main",
    run: { ...runWithManifest, updatedAt: "2026-07-10T10:03:06.000Z" },
  }],
});
const beforeManifestTamper = await workspace.open({ projectId: "project-one", taskId: "task-concurrent" });
const manifestTamperSeq = Number(beforeManifestTamper.eventCursor.split(":").at(-1)) + 1;
await assert.rejects(
  workspace.append({
    projectId: "project-one",
    taskId: "task-concurrent",
    page: {
      schemaVersion: 2,
      taskId: "task-concurrent",
      runId: "run-concurrent",
      afterCursor: beforeManifestTamper.eventCursor,
      nextCursor: `task-concurrent:${manifestTamperSeq}`,
      hasMore: false,
      events: [{
        id: "event-manifest-tamper",
        cursor: `task-concurrent:${manifestTamperSeq}`,
        seq: manifestTamperSeq,
        taskId: "task-concurrent",
        runId: "run-concurrent",
        agentThreadId: "thread-concurrent-main",
        type: "run_upsert",
        occurredAt: "2026-07-10T10:03:07.000Z",
        run: {
          ...runWithManifest,
          updatedAt: "2026-07-10T10:03:07.000Z",
          resourceManifest: { ...resourceManifest, profile: "research" },
        },
      }],
    },
  }),
  /resourceManifest cannot change after it is recorded/,
);

await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-concurrent",
  events: [{
    type: "run_upsert",
    agentThreadId: "thread-concurrent-main",
    run: {
      ...runWithManifest,
      status: "complete",
      updatedAt: "2026-07-10T10:03:08.000Z",
      completedAt: "2026-07-10T10:03:08.000Z",
      stopAvailable: false,
      resourceManifest: undefined,
    },
  }],
});
const promotionHashes = {
  requestShapeHash: "a".repeat(64),
  systemPromptHash: "b".repeat(64),
  toolSurfaceHash: "c".repeat(64),
  resourceIndexHash: "d".repeat(64),
};
const promotionMainManifest = {
  profile: "main",
  packages: resourceManifest.packages,
  activeToolNames: ["ask"],
  ...promotionHashes,
  mainSurface: {
    packageNames: ["@eko24ive/pi-ask"],
    requestShape: {
      schemaVersion: 2 as const,
      ...promotionHashes,
      systemPromptChars: 100,
      activeToolCount: 1,
      resourceCount: 0,
      activeToolNames: ["ask"],
    },
  },
};
const promotionRun = {
  id: "run-promotion",
  taskId: "task-concurrent",
  mode: "team" as const,
  status: "waiting" as const,
  rootAgentThreadId: "thread-promotion-main",
  updatedAt: "2026-07-10T10:03:08.100Z",
  stopAvailable: true,
  resumeAvailable: false,
  resourceManifest: promotionMainManifest,
};
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: promotionRun.id,
  events: [{
    type: "run_upsert",
    agentThreadId: promotionRun.rootAgentThreadId,
    run: promotionRun,
  }, {
    type: "thread_upsert",
    agentThreadId: promotionRun.rootAgentThreadId,
    thread: {
      id: promotionRun.rootAgentThreadId,
      taskId: "task-concurrent",
      runId: promotionRun.id,
      identity: {
        kind: "main",
        roleId: "main",
        displayName: "Linguist Agent",
        roleLabel: "Main Agent",
        disclosureLabel: "Agent",
      },
      status: "waiting",
      canReceiveUserMessage: true,
      childThreadIds: [],
      createdAt: promotionRun.updatedAt,
      updatedAt: promotionRun.updatedAt,
    },
  }],
});
const promotedResourceManifest = {
  ...promotionMainManifest,
  profile: "main+team",
  packages: [...promotionMainManifest.packages, {
    name: "pi-subagents",
    source: "npm:pi-subagents@0.35.1",
    version: "0.35.1",
    integrity: "sha512-c3ViYWdlbnRz",
  }],
  activeToolNames: ["ask", "subagent"],
  requestShapeHash: "e".repeat(64),
  systemPromptHash: "f".repeat(64),
  toolSurfaceHash: "0".repeat(64),
  resourceIndexHash: "1".repeat(64),
};
const promotedSnapshot = await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: promotionRun.id,
  events: [{
    type: "run_upsert",
    agentThreadId: promotionRun.rootAgentThreadId,
    run: {
      ...promotionRun,
      status: "active",
      updatedAt: "2026-07-10T10:03:08.200Z",
      resourceManifest: promotedResourceManifest,
    },
  }],
});
assert.equal(promotedSnapshot.runs.find(({ id }) => id === promotionRun.id)?.resourceManifest?.profile, "main+team");
await assert.rejects(
  workspace.appendGenerated({
    projectId: "project-one",
    taskId: "task-concurrent",
    runId: promotionRun.id,
    events: [{
      type: "run_upsert",
      agentThreadId: promotionRun.rootAgentThreadId,
      run: {
        ...promotionRun,
        status: "active",
        updatedAt: "2026-07-10T10:03:08.300Z",
        resourceManifest: { ...promotedResourceManifest, requestShapeHash: "2".repeat(64) },
      },
    }],
  }),
  /resourceManifest cannot change after it is recorded/,
);
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: promotionRun.id,
  events: [{
    type: "run_upsert",
    agentThreadId: promotionRun.rootAgentThreadId,
    run: {
      ...promotionRun,
      status: "complete",
      updatedAt: "2026-07-10T10:03:08.400Z",
      completedAt: "2026-07-10T10:03:08.400Z",
      stopAvailable: false,
      resourceManifest: promotedResourceManifest,
    },
  }],
});
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-concurrent",
  runId: "run-second",
  events: [{
    type: "run_upsert",
    agentThreadId: "thread-second-main",
    run: {
      id: "run-second",
      taskId: "task-concurrent",
      mode: "single",
      status: "active",
      rootAgentThreadId: "thread-second-main",
      updatedAt: "2026-07-10T10:03:09.000Z",
      stopAvailable: true,
      resumeAvailable: false,
    },
  }, {
    type: "thread_upsert",
    agentThreadId: "thread-second-main",
    thread: {
      id: "thread-second-main",
      taskId: "task-concurrent",
      runId: "run-second",
      parentThreadId: null,
      identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: "active",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: "2026-07-10T10:03:09.000Z",
      updatedAt: "2026-07-10T10:03:09.000Z",
    },
  }],
});
const taskWideEvents = await workspace.eventsAfter({
  projectId: "project-one",
  taskId: "task-concurrent",
  afterCursor: "task-concurrent:0",
  limit: 1_000,
});
assert.equal(taskWideEvents.hasMore, false);
assert.deepEqual(new Set(taskWideEvents.events.map((event) => event.runId)), new Set(["run-concurrent", "run-promotion", "run-second"]));

await workspace.create({
  projectId: "project-one",
  taskId: "task-terminal-thread",
  title: "Terminal thread reconciliation",
  intent: "A stopped run must not leave a child Agent spinning.",
  kind: "translation",
});
const terminalMainThread = {
  id: "thread-terminal-main",
  taskId: "task-terminal-thread",
  runId: "run-terminal",
  parentThreadId: null,
  identity: { kind: "main" as const, roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" as const },
  status: "active" as const,
  canReceiveUserMessage: true,
  handoffSummary: null,
  latestActivityId: null,
  childThreadIds: ["thread-terminal-producer"],
  createdAt: "2026-07-10T10:04:00.000Z",
  updatedAt: "2026-07-10T10:04:00.000Z",
};
const terminalChildThread = {
  id: "thread-terminal-producer",
  taskId: "task-terminal-thread",
  runId: "run-terminal",
  parentThreadId: terminalMainThread.id,
  identity: { kind: "specialist" as const, roleId: "producer", displayName: "Producer", roleLabel: "Producer", disclosureLabel: "Agent" as const },
  status: "active" as const,
  canReceiveUserMessage: false,
  handoffSummary: null,
  latestActivityId: null,
  childThreadIds: [],
  createdAt: "2026-07-10T10:04:00.000Z",
  updatedAt: "2026-07-10T10:04:00.000Z",
};
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-terminal-thread",
  runId: "run-terminal",
  events: [{
    type: "run_upsert",
    agentThreadId: terminalMainThread.id,
    run: { id: "run-terminal", taskId: "task-terminal-thread", mode: "team", status: "active", rootAgentThreadId: terminalMainThread.id, updatedAt: terminalMainThread.updatedAt, stopAvailable: true, resumeAvailable: false },
  }, {
    type: "thread_upsert",
    agentThreadId: terminalMainThread.id,
    thread: terminalMainThread,
  }, {
    type: "thread_upsert",
    agentThreadId: terminalChildThread.id,
    thread: terminalChildThread,
  }],
});
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-terminal-thread",
  runId: "run-terminal",
  events: [{
    type: "run_upsert",
    agentThreadId: terminalMainThread.id,
    run: { id: "run-terminal", taskId: "task-terminal-thread", mode: "team", status: "stopped", rootAgentThreadId: terminalMainThread.id, updatedAt: "2026-07-10T10:05:00.000Z", completedAt: "2026-07-10T10:05:00.000Z", stopAvailable: false, resumeAvailable: true },
  }, {
    type: "thread_upsert",
    agentThreadId: terminalMainThread.id,
    thread: { ...terminalMainThread, status: "stopped", updatedAt: "2026-07-10T10:05:00.000Z" },
  }, {
    type: "thread_upsert",
    agentThreadId: terminalChildThread.id,
    thread: { ...terminalChildThread, status: "stopped", updatedAt: "2026-07-10T10:05:00.000Z" },
  }],
});
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-terminal-thread",
  runId: "run-terminal",
  events: [{
    type: "thread_upsert",
    agentThreadId: terminalChildThread.id,
    thread: { ...terminalChildThread, status: "active", updatedAt: "2026-07-10T10:05:01.000Z" },
  }],
});
const reconciledTerminalTask = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-terminal-thread" });
assert.equal(reconciledTerminalTask.runs[0]?.status, "stopped");
assert.equal(reconciledTerminalTask.agentThreads.find((thread) => thread.id === terminalChildThread.id)?.status, "stopped", "opening a terminal run must reconcile stale nonterminal child state");

await workspace.create({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  title: "Usage ledger",
  intent: "Keep title, Main, Specialist, and retry cost separate.",
  kind: "general",
  autoTitle: true,
});
await workspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  expectedStatus: "pending",
  expectedAttemptId: null,
  title: "Canonical usage ledger",
  generation: {
    status: "generated",
    requestedAt: "2026-07-10T11:00:00.000Z",
    completedAt: "2026-07-10T11:00:01.000Z",
    usage: { totalTokens: 5, costUSD: 0.0001, modelCalls: 1 },
  },
});
const usageRun = {
  id: "usage-run-main-team",
  taskId: "task-usage-ledger",
  mode: "team" as const,
  status: "active" as const,
  rootAgentThreadId: "usage-run-main-team.main",
  estimatedCalls: 999,
  estimatedCallsBySource: { main: 1, "specialist:translator": 1 },
  updatedAt: "2026-07-10T11:00:02.000Z",
  stopAvailable: true,
  resumeAvailable: false,
};
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  runId: usageRun.id,
  events: [{ type: "run_upsert", agentThreadId: usageRun.rootAgentThreadId, run: usageRun }, {
    type: "thread_upsert",
    agentThreadId: usageRun.rootAgentThreadId,
    thread: {
      id: usageRun.rootAgentThreadId,
      taskId: usageRun.taskId,
      runId: usageRun.id,
      parentThreadId: null,
      identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: "active",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: usageRun.updatedAt,
      updatedAt: usageRun.updatedAt,
    },
  }, {
    type: "usage_update", usageSource: "main", usage: { totalTokens: 100, costUSD: 0.01, modelCalls: 1 },
  }, {
    type: "usage_update", usageSource: "specialist:translator", usage: { totalTokens: 40, costUSD: 0.004, modelCalls: 1 },
  }],
});
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  runId: usageRun.id,
  events: [{
    type: "usage_update",
    usageSource: "specialist:translator",
    usage: { totalTokens: 40, costUSD: 0.004, modelCalls: 1 },
  }],
});
const usageSnapshot = await workspace.open({ projectId: "project-one", taskId: "task-usage-ledger" });
assert.equal(usageSnapshot.runs[0]?.estimatedCalls, 2, "Run estimate must be derived from stable sources, not a stale client total");
assert.equal(usageSnapshot.runs[0]?.usage?.totalTokens, 140, "replaying one source must replace it, not double count it");
assert.equal(usageSnapshot.runs[0]?.usage?.modelCalls, 2);
assert.equal(usageSnapshot.usage?.totalTokens, 145, "Task total must include title generation exactly once");
assert.equal(usageSnapshot.usage?.modelCalls, 3);
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  runId: usageRun.id,
  events: [{
    type: "run_upsert",
    agentThreadId: usageRun.rootAgentThreadId,
    run: { id: usageRun.id, taskId: usageRun.taskId, mode: "team", status: "complete", rootAgentThreadId: usageRun.rootAgentThreadId, stopAvailable: false, resumeAvailable: false, completedAt: "2026-07-10T11:01:00.000Z", updatedAt: "2026-07-10T11:01:00.000Z" },
  }],
});
const retryRun = { ...usageRun, id: "usage-run-retry", rootAgentThreadId: "usage-run-retry.main", mode: "single" as const, estimatedCalls: 1, estimatedCallsBySource: { main: 1 }, updatedAt: "2026-07-10T11:02:00.000Z" };
await workspace.appendGenerated({
  projectId: "project-one",
  taskId: "task-usage-ledger",
  runId: retryRun.id,
  events: [{ type: "run_upsert", agentThreadId: retryRun.rootAgentThreadId, run: retryRun }, {
    type: "thread_upsert",
    agentThreadId: retryRun.rootAgentThreadId,
    thread: {
      id: retryRun.rootAgentThreadId,
      taskId: retryRun.taskId,
      runId: retryRun.id,
      parentThreadId: null,
      identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: "active",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: retryRun.updatedAt,
      updatedAt: retryRun.updatedAt,
    },
  }, { type: "usage_update", usageSource: "main", usage: { totalTokens: 10, costUSD: 0.001, modelCalls: 1 } }],
});
const retryUsage = await workspace.open({ projectId: "project-one", taskId: "task-usage-ledger" });
assert.equal(retryUsage.runs.find((run) => run.id === usageRun.id)?.usage?.totalTokens, 140);
assert.equal(retryUsage.runs.find((run) => run.id === usageRun.id)?.estimatedCalls, 2, "lifecycle updates must not erase the canonical estimate ledger");
assert.equal(retryUsage.runs.find((run) => run.id === retryRun.id)?.usage?.totalTokens, 10);
assert.equal(retryUsage.usage?.totalTokens, 155, "Task total must sum Runs without moving prior usage into a retry");

console.log("task workspace tests passed");
