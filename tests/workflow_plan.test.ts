import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCatWorkflowPlan,
  completeCatWorkflowStep,
  createCatWorkflowRun,
  createTaskWorkspace,
  createProjectManifest,
  evaluateCatWorkflowReadiness,
  importPhraseBatch,
  inferCatWorkflowIntent,
  listCatWorkflowRuns,
  readCatWorkflowRun,
  readWorkflowArtifacts,
  renderCatWorkflowRun,
  renderCatWorkflowPlan,
  updateSegmentTarget,
} from "@linguist-agent/cat-data";
import { handleWorkflowRoute, prepareTeamExecution } from "../packages/cat-server/src/routes/workflow_routes.js";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target></target></trans-unit>
  </group>
</body></file></xliff>`;

assert.equal(inferCatWorkflowIntent("请检查资产有没有更新到最新"), "check_assets");
assert.equal(inferCatWorkflowIntent("prepare delivery and export this batch"), "prepare_delivery");
assert.equal(inferCatWorkflowIntent("导入术语表再做审校"), "import_terminology");
assert.equal(inferCatWorkflowIntent("继续翻译这个批次，先写首译"), "translate_batch");
assert.equal(inferCatWorkflowIntent("edit pass for this translated batch"), "edit_batch");
assert.equal(inferCatWorkflowIntent("终校这批译文"), "proof_batch");

const deliveryPlan = buildCatWorkflowPlan({
  projectId: "p1",
  batchId: "b1",
  userRequest: "请先检查资产，然后准备交付导出",
});
assert.equal(deliveryPlan.intent, "prepare_delivery");
assert.equal(deliveryPlan.inferred, true);
assert.equal(deliveryPlan.steps.some((step) => step.tool === "delivery_check"), true);
assert.equal(deliveryPlan.steps.some((step) => step.tool.includes("export_") && step.approvalRequired), true);
assert.match(renderCatWorkflowPlan(deliveryPlan), /Approval Gates/);

const terminologyPlan = buildCatWorkflowPlan({
  projectId: "p1",
  intent: "import_terminology",
});
assert.deepEqual(
  terminologyPlan.steps.map((step) => step.tool),
  ["project_health", "workbook_mapping_candidates", "workbook_preview", "termbase_import_table"],
);
assert.equal(terminologyPlan.steps.find((step) => step.tool === "workbook_preview")?.approvalRequired, true);
assert.equal(terminologyPlan.steps.find((step) => step.tool === "termbase_import_table")?.approvalRequired, false, "confirmed mapping authorizes the reversible workspace import without a second prompt");

const translationPlan = buildCatWorkflowPlan({
  projectId: "p1",
  batchId: "b1",
  intent: "translate_batch",
});
assert.equal(translationPlan.steps[0]?.tool, "batch_read");
const translationEvidenceStep = translationPlan.steps.find((step) => step.id === "collect-evidence");
assert.match(translationEvidenceStep?.tool ?? "", /evidence_pack/);
assert.match(translationEvidenceStep?.tool ?? "", /constraint_pack/);
assert.equal(translationPlan.steps.at(-2)?.tool, "batch_set_targets");
assert.equal(translationPlan.steps.at(-1)?.tool, "delivery_check");
assert.equal(translationPlan.steps.find((step) => step.tool === "batch_set_targets")?.approvalRequired, false);
assert.equal(translationPlan.steps.find((step) => step.tool === "batch_set_targets")?.writesProject, true);

const editPlan = buildCatWorkflowPlan({
  projectId: "p1",
  batchId: "b1",
  intent: "edit_batch",
});
assert.equal(editPlan.steps.find((step) => step.tool === "proposal_create")?.writesProject, true);
assert.equal(editPlan.steps.find((step) => step.tool === "proposal_apply")?.approvalRequired, true);

const teamPlanContract = buildCatWorkflowPlan({
  projectId: "p1",
  batchId: "b1",
  intent: "game_localization_team_run",
});
assert.equal(teamPlanContract.steps[0]?.title, "producer");
assert.equal(teamPlanContract.steps[9]?.title, "lead linguist final");
assert.equal(teamPlanContract.steps.some((row) => /^\d+\./.test(row.title)), false);

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-workflow-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "master.xliff"), masterFixture, "utf8");
await writeFile(join(customerRoot, "batch.mxliff"), mxliffFixture, "utf8");
await createProjectManifest(workspaceRoot, customerRoot, { projectId: "proj", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await importPhraseBatch(workspaceRoot, {
  projectId: "proj",
  mxliffPath: "batch.mxliff",
  masterXliffPath: "master.xliff",
  batchId: "b1",
});

const blocked = await evaluateCatWorkflowReadiness(
  workspaceRoot,
  buildCatWorkflowPlan({ projectId: "proj", batchId: "b1", intent: "prepare_delivery" }),
);
assert.equal(blocked.readiness.status, "blocked");
assert.equal(blocked.readiness.delivery?.status, "fail");
assert.equal(blocked.plan.steps.find((step) => step.tool === "delivery_check")?.status, "blocked");

const translationReady = await evaluateCatWorkflowReadiness(
  workspaceRoot,
  buildCatWorkflowPlan({ projectId: "proj", batchId: "b1", intent: "translate_batch" }),
);
assert.equal(translationReady.readiness.status, "ready");
assert.equal(translationReady.readiness.projectHealth?.status, "fail");
assert.match(renderCatWorkflowPlan(translationReady.plan, translationReady.readiness), /project_health=fail/);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Hero Emblem",
  reason: "fill test target",
  changeType: "user_approved",
});
const ready = await evaluateCatWorkflowReadiness(
  workspaceRoot,
  buildCatWorkflowPlan({ projectId: "proj", batchId: "b1", intent: "prepare_delivery" }),
);
assert.equal(ready.readiness.status, "needs_approval");
assert.equal(ready.readiness.delivery?.status, "pass");
assert.match(renderCatWorkflowPlan(ready.plan, ready.readiness), /delivery_check=pass/);

const { run, path } = await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  taskId: "task-delivery-smoke",
  batchId: "b1",
  workflowId: "delivery-smoke",
  intent: "prepare_delivery",
});
assert.equal(path.endsWith("delivery-smoke.json"), true);
assert.equal(run.status, "waiting_approval");
assert.equal(run.taskId, "task-delivery-smoke");
assert.equal(run.plan.taskId, "task-delivery-smoke");
assert.equal(run.currentStepId, "health");
assert.equal(run.approvedStepIds.length, 0);
assert.match(renderCatWorkflowRun(run), /Workflow Run/);

const listed = await listCatWorkflowRuns(workspaceRoot, "proj");
assert.equal(listed.some((row) => row.workflowId === "delivery-smoke" && row.approvalGatesRemaining === 2), true);
assert.equal(listed.find((row) => row.workflowId === "delivery-smoke")?.taskId, "task-delivery-smoke");

const completed = await completeCatWorkflowStep(workspaceRoot, "proj", "delivery-smoke", "health", "project_health checked");
assert.equal(completed.completedStepIds.includes("health"), true);
assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "delivery-smoke")).history.some((event) => event.kind === "completed"), true);

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let routeBody: Record<string, unknown> = {};
  const routeDeps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    readBody: async () => routeBody,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };

  routeBody = { batchId: "b1", workflowId: "unlinked-must-not-exist", intent: "prepare_delivery" };
  await assert.rejects(
    handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps),
    /taskId is required/,
  );

  routeBody = { taskId: "missing-task", batchId: "b1", workflowId: "invalid-link", intent: "prepare_delivery" };
  await assert.rejects(
    handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps),
    /was not found/,
  );
  await createTaskWorkspace(workspaceRoot).create({
    projectId: "proj",
    taskId: "task-route-smoke",
    title: "Route smoke",
    intent: "Prepare delivery",
    kind: "delivery",
    scope: { batchId: "b1" },
  });
  routeBody = { taskId: "task-route-smoke", workflowId: "missing-batch-link", intent: "prepare_delivery" };
  await assert.rejects(
    handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps),
    /scoped to batch b1, not an unscoped workflow/,
  );
  routeBody = { taskId: "task-route-smoke", batchId: "b1", workflowId: "route-smoke", intent: "prepare_delivery", includeReadiness: true };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps), true);
  const routeCreated = responses.pop()?.data as { run?: { workflowId?: string; taskId?: string } };
  assert.equal(routeCreated.run?.workflowId, "route-smoke");
  assert.equal(routeCreated.run?.taskId, "task-route-smoke");
  const taskSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-route-smoke" });
  assert.equal(taskSnapshot.activeRunId, "route-smoke");
  assert.equal(taskSnapshot.runs[0]?.mode, "pipeline");
  assert.equal(taskSnapshot.agentThreads[0]?.identity.displayName, "Linguist Agent");
  assert.deepEqual(taskSnapshot.activities.map((activity) => activity.type), ["acknowledgement", "plan"]);
  assert.match(taskSnapshot.activities[1]?.body ?? "", /Check project-level readiness/);
  const taskEvents = await createTaskWorkspace(workspaceRoot).events({
    projectId: "proj",
    taskId: "task-route-smoke",
    runId: "route-smoke",
  });
  assert.equal(taskEvents.events.length, 4);
  assert.equal(taskEvents.nextCursor, "task-route-smoke:4");

  await createTaskWorkspace(workspaceRoot).create({
    projectId: "proj",
    taskId: "task-team-route",
    title: "Team route smoke",
    intent: "Run the adaptive localization team",
    kind: "translation",
    scope: { batchId: "b1" },
  });
  routeBody = { taskId: "task-team-route", batchId: "b1", workflowId: "team-route", intent: "game_localization_team_run", includeReadiness: false };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps), true);
  responses.pop();
  routeBody = { forceAllRoles: true };
  const preflightCalls = await Promise.all([
    handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "preflight"], "proj", routeDeps),
    handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "preflight"], "proj", routeDeps),
  ]);
  assert.deepEqual(preflightCalls, [true, true]);
  const teamPlan = responses.pop()?.data as { planHash: string; estimatedCalls: number; selectedRoleIds: string[]; modelRoutes: Record<string, string> };
  responses.pop();
  assert.ok(teamPlan.planHash);
  let teamSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-team-route" });
  assert.equal(teamSnapshot.runs[0]?.status, "awaiting_input");
  assert.equal(teamSnapshot.runs[0]?.estimatedCalls, teamPlan.estimatedCalls);
  assert.deepEqual((teamSnapshot.runs[0] as any)?.modelRoutes, teamPlan.modelRoutes);
  assert.equal(teamSnapshot.decisions[0]?.status, "required");
  assert.equal(teamSnapshot.activities.some((activity) => activity.title === "Team preflight"), true);
  const selectedThreads = teamSnapshot.agentThreads.filter((thread) => teamPlan.selectedRoleIds.includes(thread.identity.roleId));
  assert.equal(selectedThreads.length, teamPlan.selectedRoleIds.length);
  for (const thread of selectedThreads) {
    const acknowledgement = teamSnapshot.activities.find((activity) => activity.agentThreadId === thread.id && activity.type === "acknowledgement");
    assert.equal(acknowledgement?.status, "pending");
    assert.match(acknowledgement?.body ?? "", /Waiting for Team plan confirmation/);
    assert.equal(thread.latestActivityId, acknowledgement?.id);
  }

  const mainTeamTaskId = "task-main-team-usage";
  const mainTeamRunId = "main-team-usage";
  const mainTeamThreadId = `${mainTeamRunId}.main`;
  await createTaskWorkspace(workspaceRoot).create({
    projectId: "proj",
    taskId: mainTeamTaskId,
    title: "Main to Team usage",
    intent: "Ask Main, then prepare Specialists.",
    kind: "translation",
    scope: { batchId: "b1" },
  });
  await createTaskWorkspace(workspaceRoot).appendGenerated({
    projectId: "proj",
    taskId: mainTeamTaskId,
    runId: mainTeamRunId,
    events: [{
      type: "run_upsert",
      agentThreadId: mainTeamThreadId,
      run: { id: mainTeamRunId, taskId: mainTeamTaskId, mode: "single", status: "active", rootAgentThreadId: mainTeamThreadId, estimatedCalls: 1, estimatedCallsBySource: { main: 1 }, updatedAt: "2026-07-10T12:00:00.000Z", stopAvailable: true, resumeAvailable: false },
    }, {
      type: "thread_upsert",
      agentThreadId: mainTeamThreadId,
      thread: { id: mainTeamThreadId, taskId: mainTeamTaskId, runId: mainTeamRunId, parentThreadId: null, identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" }, status: "active", canReceiveUserMessage: true, handoffSummary: null, latestActivityId: null, childThreadIds: [], createdAt: "2026-07-10T12:00:00.000Z", updatedAt: "2026-07-10T12:00:00.000Z" },
    }, {
      type: "usage_update",
      usageSource: "main",
      usage: { totalTokens: 100, costUSD: 0.01, modelCalls: 1 },
    }],
  });
  await prepareTeamExecution({ projectId: "proj", taskId: mainTeamTaskId, runId: mainTeamRunId, reason: "Use bounded specialist review.", deps: routeDeps });
  const mainTeamRun = (await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: mainTeamTaskId })).runs[0]!;
  const specialistEstimate = Object.entries(mainTeamRun.estimatedCallsBySource ?? {})
    .filter(([source]) => source.startsWith("specialist:"))
    .reduce((sum, [, calls]) => sum + calls, 0);
  assert.equal(mainTeamRun.estimatedCallsBySource?.main, 1);
  assert.equal(mainTeamRun.estimatedCalls, 1 + specialistEstimate, "Team preflight must add its estimate without overwriting Main");
  assert.equal(mainTeamRun.usage?.totalTokens, 100, "Team preflight must preserve already-incurred Main usage");

  routeBody = { planHash: teamPlan.planHash, forceAllRoles: true };
  await assert.rejects(handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "proj", "workflows", "team-route", "start"],
    "proj",
    routeDeps,
  ), /server-owned Team child adapter/);
  teamSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-team-route" });
  assert.equal(teamSnapshot.runs[0]?.status, "awaiting_input", "a failed child launch must not project a false active run");

  routeBody = { planHash: teamPlan.planHash, forceAllRoles: true, execute: false };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "start"], "proj", routeDeps), true);
  responses.pop();
  teamSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-team-route" });
  assert.equal(teamSnapshot.runs[0]?.status, "active");
  assert.equal(teamSnapshot.decisions[0]?.selectedOptionId, "start");
  const firstRoleId = teamPlan.selectedRoleIds[0]!;
  assert.equal(teamSnapshot.agentThreads.some((thread) => thread.identity.roleId === firstRoleId), true);

  routeBody = { roleId: firstRoleId, reason: "role stop smoke" };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "role-stop"], "proj", routeDeps), true);
  assert.deepEqual(responses.pop()?.data, { stopped: 0, reason: "role stop smoke", errors: [] });
  teamSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-team-route" });
  assert.equal(teamSnapshot.agentThreads.find((thread) => thread.identity.roleId === firstRoleId)?.status, "stopped");
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-route")).status, "stopped", "role stop must pause the sequential Team workflow");
  assert.equal(teamSnapshot.runs[0]?.resumeAvailable, true);

  routeBody = { forceAllRoles: true };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "preflight"], "proj", routeDeps), true);
  responses.pop();
  teamSnapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "task-team-route" });
  assert.equal(teamSnapshot.runs[0]?.status, "awaiting_input", "preflight must repair a stale active projection when no role is active");

  routeBody = { planHash: teamPlan.planHash, forceAllRoles: true, execute: false };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "resume"], "proj", routeDeps), true);
  const resumedRoleId = (responses.pop()?.data as { roleId?: string }).roleId;
  assert.equal(resumedRoleId, firstRoleId, "resume must restart the role the user stopped instead of skipping its work");

  routeBody = { reason: "whole Team stop" };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-route", "stop"], "proj", routeDeps), true);
  responses.pop();
  const stoppedPass = (await readWorkflowArtifacts(workspaceRoot, "proj")).teamRolePasses
    .find((row) => row.workflowId === "team-route" && row.roleId === firstRoleId);
  assert.equal(stoppedPass?.status, "stopped", "whole-Team Stop must persist the active child as resumable instead of leaving a stale busy pass");

  routeBody = {};
  assert.equal(await handleWorkflowRoute({ method: "GET" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", routeDeps), true);
  assert.equal(((responses.pop()?.data as { rows?: Array<{ workflowId: string }> }).rows ?? []).some((row) => row.workflowId === "route-smoke"), true);

  for (const [method, action] of [["GET", "next"], ["POST", "plan"], ["POST", "note"], ["POST", "approve"], ["POST", "complete-step"], ["POST", "cancel"]]) {
    assert.equal(
      await handleWorkflowRoute({ method } as never, {} as never, ["api", "projects", "proj", "workflows", "route-smoke", action], "proj", routeDeps),
      false,
      `legacy Workflow action ${action} must not remain routable`,
    );
  }
}

console.log("workflow_plan tests passed");
