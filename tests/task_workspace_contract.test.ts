import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  parseTaskRunEventPage,
  parseTaskArtifact,
  parseTaskWorkspaceSnapshot,
  TASK_WORKSPACE_SCHEMA_VERSION,
} from "@linguist-agent/cat-data";

const fixtureRoot = join(process.cwd(), "contracts", "fixtures");
const schemaRoot = join(process.cwd(), "contracts", "schemas");

const legacySnapshotFixture = JSON.parse(await readFile(join(fixtureRoot, "task-workspace-snapshot.v1.json"), "utf8")) as any;
const legacyEventFixture = JSON.parse(await readFile(join(fixtureRoot, "run-event-page.v1.json"), "utf8")) as any;
const legacyArtifactFixture = JSON.parse(await readFile(join(fixtureRoot, "task-artifacts.v1.json"), "utf8")) as any[];

function projectScopeV2(scope: Record<string, unknown>): Record<string, unknown> {
  const { projectId: _legacyProjectId, ...projectScope } = scope;
  return { ...projectScope, kind: "project" };
}

const snapshotFixture = structuredClone(legacySnapshotFixture) as any;
snapshotFixture.schemaVersion = TASK_WORKSPACE_SCHEMA_VERSION;
snapshotFixture.task.owner = { kind: "project", projectId: snapshotFixture.task.projectId };
delete snapshotFixture.task.projectId;
snapshotFixture.task.scope = projectScopeV2(snapshotFixture.task.scope);
snapshotFixture.artifacts = snapshotFixture.artifacts.map((artifact: any) => ({
  ...artifact,
  scope: projectScopeV2(artifact.scope),
}));
snapshotFixture.decisions = snapshotFixture.decisions.map((decision: any) => ({
  ...decision,
  scope: projectScopeV2(decision.scope),
}));

const eventFixture = structuredClone(legacyEventFixture) as any;
eventFixture.schemaVersion = TASK_WORKSPACE_SCHEMA_VERSION;
eventFixture.events = eventFixture.events.map((event: any) => ({
  ...event,
  ...(event.artifact ? { artifact: { ...event.artifact, scope: projectScopeV2(event.artifact.scope) } } : {}),
  ...(event.decision ? { decision: { ...event.decision, scope: projectScopeV2(event.decision.scope) } } : {}),
}));

const artifactFixture = legacyArtifactFixture.map((artifact) => ({
  ...structuredClone(artifact),
  scope: projectScopeV2(artifact.scope),
}));
const snapshot = parseTaskWorkspaceSnapshot(snapshotFixture);
const eventPage = parseTaskRunEventPage(eventFixture);
const artifacts = artifactFixture.map(parseTaskArtifact);

assert.equal(snapshot.schemaVersion, TASK_WORKSPACE_SCHEMA_VERSION);
assert.equal(snapshot.task.id, "task-localize-482-520");
assert.deepEqual(snapshot.task.owner, { kind: "project", projectId: "project-stellar-legend" });
assert.equal(snapshot.activeRunId, "run-team-001");
assert.equal(snapshot.runs[0]?.mode, "team");
assert.deepEqual((snapshot.runs[0] as any)?.modelRoutes, {
  producer: "deepseek/deepseek-v4-flash",
  editor: "deepseek/deepseek-v4-flash",
});
assert.equal(snapshot.agentThreads.length, 2);
assert.equal(snapshot.agentThreads[0]?.identity.displayName, "Linguist Agent");
assert.equal(snapshot.agentThreads[0]?.identity.disclosureLabel, "Agent");
assert.equal(snapshot.agentThreads[1]?.identity.roleId, "editor");
assert.equal(snapshot.agentThreads[1]?.canReceiveUserMessage, true);
assert.equal(snapshot.activities.some((row) => row.type === "evidence_read" && row.tool?.effect === "read"), true);
assert.deepEqual(snapshot.activities[0]?.refs.segmentIds, [], "historical activities without segment refs must remain decodable");
assert.equal(snapshot.artifacts[0]?.type, "segment_proposal");
assert.equal(snapshot.artifacts[0]?.content.candidateTarget, "Tonight, the moon will keep my secret.");
assert.equal(snapshot.decisions[0]?.status, "required");
assert.deepEqual(snapshot.runs[0]?.resourceManifest?.requestShape, {
  schemaVersion: 2,
  systemPromptChars: 1840,
  activeToolCount: 2,
  resourceCount: 3,
});
assert.equal(snapshot.decisions[0]?.options.some((option) => option.action === "request_change"), true);
assert.equal("sessionId" in snapshot.task, false, "Pi sessions must not leak into TaskWorkspace product identity");
assert.deepEqual(artifacts.map((artifact) => artifact.type), [
  "qa_report",
  "delivery_readiness",
  "delivery_export",
  "eval_output",
  "eval_scorecard",
  "eval_comparison",
]);
assert.equal(artifacts.find((artifact) => artifact.type === "eval_output")?.content.segmentId, "segment-007");
assert.equal(artifacts.find((artifact) => artifact.type === "delivery_readiness")?.content.status, "ready");

assert.equal(eventPage.schemaVersion, TASK_WORKSPACE_SCHEMA_VERSION);
assert.equal(eventPage.afterCursor, "cursor-100");
assert.equal(eventPage.nextCursor, "cursor-106");
assert.deepEqual(eventPage.events.map((row) => row.type), [
  "run_upsert",
  "thread_upsert",
  "activity_append",
  "artifact_upsert",
  "decision_upsert",
  "usage_update",
]);

const nativeInteractionFixture = structuredClone(snapshotFixture) as any;
nativeInteractionFixture.activities[0].refs.segmentIds = ["482"];
nativeInteractionFixture.runs[0].resourceManifest = {
  profile: "main",
  packages: [
    {
      name: "@eko24ive/pi-ask",
      source: "npm:@eko24ive/pi-ask@1.1.0",
      version: "1.1.0",
      integrity: "sha256-patched-ask-fixture",
    },
  ],
  activeToolNames: ["ask_user", "tm_lookup"],
  requestShapeHash: "request-shape-fixture",
  systemPromptHash: "system-prompt-fixture",
  toolSurfaceHash: "tool-surface-fixture",
  resourceIndexHash: "resource-index-fixture",
  requestShape: {
    schemaVersion: 2,
    systemPromptChars: 1840,
    activeToolCount: 2,
    resourceCount: 3,
  },
};
nativeInteractionFixture.decisions[0] = {
  ...nativeInteractionFixture.decisions[0],
  artifactId: null,
  kind: "answer",
  status: "recorded",
  interactionId: "interaction-ask-001",
  questionIndex: 0,
  selectionMode: "multiple",
  options: [
    {
      id: "formal",
      label: "正式",
      action: "answer",
      destructive: false,
      description: "更克制的生产文本语气",
      preview: "Please proceed with the formal register.",
    },
    {
      id: "concise",
      label: "简洁",
      action: "answer",
      destructive: false,
      description: null,
      preview: null,
    },
  ],
  selectedOptionId: "formal",
  selectedOptionIds: ["formal", "concise"],
  responseText: "保留角色称谓。",
  decidedAt: "2026-07-10T09:46:00.000Z",
};
const nativeInteraction = parseTaskWorkspaceSnapshot(nativeInteractionFixture);
assert.deepEqual(nativeInteraction.activities[0]?.refs.segmentIds, ["482"]);
assert.equal(nativeInteraction.runs[0]?.resourceManifest?.profile, "main");
assert.deepEqual(nativeInteraction.runs[0]?.resourceManifest?.activeToolNames, ["ask_user", "tm_lookup"]);
assert.equal(nativeInteraction.runs[0]?.resourceManifest?.requestShape?.activeToolCount, 2);
assert.equal(nativeInteraction.decisions[0]?.interactionId, "interaction-ask-001");
assert.deepEqual(nativeInteraction.decisions[0]?.selectedOptionIds, ["formal", "concise"]);
assert.equal(nativeInteraction.decisions[0]?.options[0]?.description, "更克制的生产文本语气");
assert.equal(nativeInteraction.decisions[0]?.options[0]?.preview, "Please proceed with the formal register.");

const hash = (character: string) => character.repeat(64);
const mainSurfaceFixture = structuredClone(nativeInteractionFixture) as any;
mainSurfaceFixture.runs[0].resourceManifest = {
  ...mainSurfaceFixture.runs[0].resourceManifest,
  requestShapeHash: hash("a"),
  systemPromptHash: hash("b"),
  toolSurfaceHash: hash("c"),
  resourceIndexHash: hash("d"),
  mainSurface: {
    packageNames: ["@eko24ive/pi-ask"],
    requestShape: {
      schemaVersion: 2,
      requestShapeHash: hash("a"),
      systemPromptHash: hash("b"),
      toolSurfaceHash: hash("c"),
      resourceIndexHash: hash("d"),
      systemPromptChars: 1840,
      activeToolCount: 2,
      resourceCount: 3,
      activeToolNames: ["ask_user", "tm_lookup"],
    },
  },
};
assert.equal(parseTaskWorkspaceSnapshot(mainSurfaceFixture).runs[0]?.resourceManifest?.mainSurface?.requestShape.schemaVersion, 2);

const mismatchedMainSurface = structuredClone(mainSurfaceFixture) as any;
mismatchedMainSurface.runs[0].resourceManifest.mainSurface.requestShape.activeToolCount = 1;
assert.throws(() => parseTaskWorkspaceSnapshot(mismatchedMainSurface), /activeToolCount must match activeToolNames/);

const missingPromotedMainSurface = structuredClone(mainSurfaceFixture) as any;
missingPromotedMainSurface.runs[0].resourceManifest.profile = "main+team";
delete missingPromotedMainSurface.runs[0].resourceManifest.mainSurface;
assert.throws(() => parseTaskWorkspaceSnapshot(missingPromotedMainSurface), /main\+team requires mainSurface/);

const generatedTitleFixture = structuredClone(nativeInteractionFixture) as any;
generatedTitleFixture.task.titleGeneration = {
  status: "generated",
  requestedAt: "2026-07-10T09:40:00.000Z",
  attemptId: "title-attempt-001",
  startedAt: "2026-07-10T09:40:01.000Z",
  completedAt: "2026-07-10T09:40:02.000Z",
  provider: "deepseek",
  modelId: "deepseek-v4-flash",
  usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24, costUSD: 0.0003, modelCalls: 1 },
};
generatedTitleFixture.runs[0].estimatedCallsBySource = { main: 1, "specialist:editor": 3 };
generatedTitleFixture.runs[0].usageBySource = {
  main: { inputTokens: 100, outputTokens: 20, totalTokens: 120, costUSD: 0.001, modelCalls: 1 },
  "specialist:editor": { inputTokens: 4020, outputTokens: 760, totalTokens: 5980, costUSD: 0.0174, modelCalls: 1 },
};
const generatedTitle = parseTaskWorkspaceSnapshot(generatedTitleFixture);
assert.equal(generatedTitle.task.titleGeneration?.usage?.modelCalls, 1);
assert.equal(generatedTitle.runs[0]?.estimatedCalls, 4);
assert.equal(generatedTitle.runs[0]?.usage?.totalTokens, 6100);
assert.equal(generatedTitle.usage?.totalTokens, 6124, "Task total includes title and Run usage exactly once");

const sourcedEventFixture = structuredClone(eventFixture) as any;
sourcedEventFixture.events.at(-1).usageSource = "specialist:editor";
assert.equal(parseTaskRunEventPage(sourcedEventFixture).events.at(-1)?.usageSource, "specialist:editor");

const nativeFreeformFixture = structuredClone(nativeInteractionFixture) as any;
nativeFreeformFixture.decisions[0].selectionMode = "freeform";
nativeFreeformFixture.decisions[0].options = [{ id: "freeform", label: "补充说明", action: "answer", destructive: false }];
nativeFreeformFixture.decisions[0].selectedOptionId = "freeform";
nativeFreeformFixture.decisions[0].selectedOptionIds = ["freeform"];
nativeFreeformFixture.decisions[0].responseText = "请把语气再收敛一些。";
assert.equal(parseTaskWorkspaceSnapshot(nativeFreeformFixture).decisions[0]?.responseText, "请把语气再收敛一些。");

const pendingFreeformFixture = structuredClone(nativeFreeformFixture) as any;
pendingFreeformFixture.decisions[0].status = "required";
pendingFreeformFixture.decisions[0].selectedOptionId = null;
pendingFreeformFixture.decisions[0].selectedOptionIds = [];
pendingFreeformFixture.decisions[0].responseText = null;
pendingFreeformFixture.decisions[0].decidedAt = null;
assert.equal(parseTaskWorkspaceSnapshot(pendingFreeformFixture).decisions[0]?.status, "required");

const missingFreeformOption = structuredClone(pendingFreeformFixture) as any;
missingFreeformOption.decisions[0].options = [{ id: "other", label: "Other", action: "answer", destructive: false }];
assert.throws(() => parseTaskWorkspaceSnapshot(missingFreeformOption), /freeform selection requires the freeform option/);

const missingRecordedSelections = structuredClone(nativeInteractionFixture) as any;
delete missingRecordedSelections.decisions[0].selectedOptionIds;
assert.throws(() => parseTaskWorkspaceSnapshot(missingRecordedSelections), /selectedOptionIds is required for a recorded grouped interaction/);

const negativeQuestionIndex = structuredClone(nativeInteractionFixture) as any;
negativeQuestionIndex.decisions[0].questionIndex = -1;
assert.throws(() => parseTaskWorkspaceSnapshot(negativeQuestionIndex), /questionIndex must be an integer >= 0/);

const incompleteInteraction = structuredClone(nativeInteractionFixture) as any;
delete incompleteInteraction.decisions[0].questionIndex;
assert.throws(() => parseTaskWorkspaceSnapshot(incompleteInteraction), /grouped interaction requires questionIndex and selectionMode/);

const duplicateQuestionIndex = structuredClone(nativeInteractionFixture) as any;
duplicateQuestionIndex.decisions.push({
  ...duplicateQuestionIndex.decisions[0],
  id: "decision-duplicate-index",
});
assert.throws(() => parseTaskWorkspaceSnapshot(duplicateQuestionIndex), /questionIndex must be unique/);

const mixedInteractionThreads = structuredClone(nativeInteractionFixture) as any;
mixedInteractionThreads.decisions.push({
  ...mixedInteractionThreads.decisions[0],
  id: "decision-other-thread",
  questionIndex: 1,
  requestedByThreadId: mixedInteractionThreads.agentThreads[0].id,
});
assert.throws(() => parseTaskWorkspaceSnapshot(mixedInteractionThreads), /must belong to one agent thread/);

const duplicateSelections = structuredClone(nativeInteractionFixture) as any;
duplicateSelections.decisions[0].selectedOptionIds = ["formal", "formal"];
assert.throws(() => parseTaskWorkspaceSnapshot(duplicateSelections), /selectedOptionIds must be unique/);

const unknownSelection = structuredClone(nativeInteractionFixture) as any;
unknownSelection.decisions[0].selectedOptionIds = ["formal", "missing"];
assert.throws(() => parseTaskWorkspaceSnapshot(unknownSelection), /selectedOptionIds must reference options/);

const localPackageSource = structuredClone(nativeInteractionFixture) as any;
localPackageSource.runs[0].resourceManifest.packages[0].source = "/tmp/untrusted-extension";
assert.throws(() => parseTaskWorkspaceSnapshot(localPackageSource), /resourceManifest.*source must be an npm or git source/);

const invalidPackageIntegrity = structuredClone(nativeInteractionFixture) as any;
invalidPackageIntegrity.runs[0].resourceManifest.packages[0].integrity = "unverified";
assert.throws(() => parseTaskWorkspaceSnapshot(invalidPackageIntegrity), /resourceManifest.*integrity must be a verified hash/);

const invalidRequestShapeCount = structuredClone(nativeInteractionFixture) as any;
invalidRequestShapeCount.runs[0].resourceManifest.requestShape.activeToolCount = 1;
assert.throws(() => parseTaskWorkspaceSnapshot(invalidRequestShapeCount), /requestShape\.activeToolCount must match activeToolNames\.length/);

const schemaFiles = [
  "task-workspace-common.v1.schema.json",
  "task-workspace-snapshot.v1.schema.json",
  "run-event-page.v1.schema.json",
  "task-artifacts.v1.schema.json",
  "task-workspace-common.v2.schema.json",
  "task-workspace-snapshot.v2.schema.json",
  "task-workspace-probe.v2.schema.json",
  "run-event-page.v2.schema.json",
  "task-artifacts.v2.schema.json",
];
const schemas = new Map<string, Record<string, unknown>>();
for (const file of schemaFiles) {
  const schema = JSON.parse(await readFile(join(schemaRoot, file), "utf8")) as Record<string, unknown>;
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(typeof schema.$id, "string");
  schemas.set(file, schema);
}
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schemas.get("task-workspace-common.v1.schema.json")!);
ajv.addSchema(schemas.get("task-workspace-common.v2.schema.json")!);
const snapshotSchema = ajv.compile(schemas.get("task-workspace-snapshot.v1.schema.json")!);
const eventPageSchema = ajv.compile(schemas.get("run-event-page.v1.schema.json")!);
const artifactsSchema = ajv.compile(schemas.get("task-artifacts.v1.schema.json")!);
const snapshotSchemaV2 = ajv.compile(schemas.get("task-workspace-snapshot.v2.schema.json")!);
const eventPageSchemaV2 = ajv.compile(schemas.get("run-event-page.v2.schema.json")!);
const artifactsSchemaV2 = ajv.compile(schemas.get("task-artifacts.v2.schema.json")!);
function assertSchemaValid(validate: typeof snapshotSchema, value: unknown, label: string): void {
  assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)}`);
}
function assertSchemaInvalid(validate: typeof snapshotSchema, value: unknown, label: string): void {
  assert.equal(validate(value), false, `${label} unexpectedly passed JSON Schema validation`);
}
assertSchemaValid(snapshotSchema, legacySnapshotFixture, "legacy v1 snapshot fixture");
assertSchemaValid(eventPageSchema, legacyEventFixture, "legacy v1 event page fixture");
assertSchemaValid(artifactsSchema, legacyArtifactFixture, "legacy v1 artifact fixture");
assertSchemaValid(snapshotSchemaV2, snapshotFixture, "project v2 snapshot fixture");
assertSchemaValid(eventPageSchemaV2, eventFixture, "v2 event page fixture");
assertSchemaValid(artifactsSchemaV2, artifactFixture, "v2 artifact fixture");

const standaloneSchemaFixture = structuredClone(snapshotFixture) as any;
standaloneSchemaFixture.task.owner = { kind: "standalone" };
standaloneSchemaFixture.task.scope = { kind: "standalone", fileGrantIds: ["grant-workspace"] };
standaloneSchemaFixture.task.kind = "general";
standaloneSchemaFixture.artifacts = standaloneSchemaFixture.artifacts.map((artifact: any) => ({
  ...artifact,
  scope: { kind: "standalone", fileGrantIds: ["grant-workspace"] },
}));
standaloneSchemaFixture.decisions = standaloneSchemaFixture.decisions.map((decision: any) => ({
  ...decision,
  scope: { kind: "standalone", fileGrantIds: ["grant-workspace"] },
}));
assertSchemaValid(snapshotSchemaV2, standaloneSchemaFixture, "standalone v2 snapshot fixture");

const mismatchedOwnerSchemaFixture = structuredClone(standaloneSchemaFixture) as any;
mismatchedOwnerSchemaFixture.task.scope = { kind: "project", segmentIds: [] };
assertSchemaInvalid(snapshotSchemaV2, mismatchedOwnerSchemaFixture, "standalone owner with project scope");

const duplicateProjectTruthSchemaFixture = structuredClone(snapshotFixture) as any;
duplicateProjectTruthSchemaFixture.task.scope.projectId = "project-stellar-legend";
assertSchemaInvalid(snapshotSchemaV2, duplicateProjectTruthSchemaFixture, "v2 project scope duplicate projectId");

const badDisclosure = structuredClone(snapshotFixture) as any;
badDisclosure.agentThreads[1].identity.disclosureLabel = "System";
assert.throws(() => parseTaskWorkspaceSnapshot(badDisclosure), /specialist identity must disclose as Agent/);

const missingTool = structuredClone(snapshotFixture) as any;
missingTool.activities.find((row: any) => row.type === "evidence_read").tool = null;
assert.throws(() => parseTaskWorkspaceSnapshot(missingTool), /tool is required for evidence_read/);

const unknownArtifact = structuredClone(snapshotFixture) as any;
unknownArtifact.activities[0].refs.artifactIds = ["missing-artifact"];
assert.throws(() => parseTaskWorkspaceSnapshot(unknownArtifact), /references unknown artifact/);

const badRecordedDecision = structuredClone(snapshotFixture) as any;
badRecordedDecision.decisions[0].status = "recorded";
badRecordedDecision.decisions[0].selectedOptionId = null;
assert.throws(() => parseTaskWorkspaceSnapshot(badRecordedDecision), /selectedOptionId is required when recorded/);

const wrongEventPayload = structuredClone(eventFixture) as any;
wrongEventPayload.events[0].thread = wrongEventPayload.events[1].thread;
assert.throws(() => parseTaskRunEventPage(wrongEventPayload), /exactly the run payload/);

const usageSourceOnActivity = structuredClone(eventFixture) as any;
usageSourceOnActivity.events[2].usageSource = "main";
assert.throws(() => parseTaskRunEventPage(usageSourceOnActivity), /only valid for usage_update/);
const legacyUsageSourceOnActivity = structuredClone(legacyEventFixture) as any;
legacyUsageSourceOnActivity.events[2].usageSource = "main";
assertSchemaInvalid(eventPageSchema, legacyUsageSourceOnActivity, "usageSource on non-usage event");

const crossRunPayload = structuredClone(eventFixture) as any;
crossRunPayload.events[0].run.id = "another-run";
assert.throws(() => parseTaskRunEventPage(crossRunPayload), /run scope must match event taskId and runId/);

const outOfOrderEvents = structuredClone(eventFixture) as any;
outOfOrderEvents.events[2].seq = 100;
assert.throws(() => parseTaskRunEventPage(outOfOrderEvents), /seq must be strictly increasing/);

const duplicateEventCursor = structuredClone(eventFixture) as any;
duplicateEventCursor.events[1].cursor = duplicateEventCursor.events[0].cursor;
assert.throws(() => parseTaskRunEventPage(duplicateEventCursor), /contains duplicate cursor/);

const mismatchedCursor = structuredClone(eventFixture) as any;
mismatchedCursor.nextCursor = "cursor-mismatch";
assert.throws(() => parseTaskRunEventPage(mismatchedCursor), /nextCursor must equal/);

const emptyCursorAdvance = structuredClone(eventFixture) as any;
emptyCursorAdvance.events = [];
emptyCursorAdvance.nextCursor = "cursor-without-event";
assert.throws(() => parseTaskRunEventPage(emptyCursorAdvance), /nextCursor must equal afterCursor when events is empty/);

console.log("task workspace canonical contract tests passed");
