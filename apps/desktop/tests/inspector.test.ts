import assert from "node:assert/strict";
import test from "node:test";
import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskDecision,
} from "../../../packages/cat-data/src/task_workspace_contract.ts";
import {
  activityDetailBody,
  artifactEvidence,
  followUpTargetForSelection,
  segmentLinkedItems,
} from "../src/renderer/inspector/inspector-model.ts";
import {
  segmentEvidenceGroups,
  segmentEvidenceSummaryRows,
} from "../src/renderer/inspector/segment-evidence-model.ts";
import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  clampInspectorWidth,
  inspectorWidthBounds,
  inspectorWidthForKey,
} from "../src/renderer/inspector/inspector-layout.ts";
import type { SegmentEvidenceSnapshot } from "../src/renderer/data/workspace-client.ts";

const at = "2026-07-16T00:00:00.000Z";
const scope = { kind: "project" as const, batchId: "batch-one", segmentIds: ["segment-one"] };

function activity(overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    id: "activity-one",
    taskId: "task-one",
    runId: "run-one",
    agentThreadId: "specialist-one",
    seq: 1,
    type: "evidence_read",
    status: "done",
    actor: { kind: "agent", id: "translator", displayName: "译者", agentThreadId: "specialist-one" },
    title: "查阅术语",
    body: "读取了项目术语表。",
    tool: { name: "term_lookup", effect: "read", target: "segment-one", outcome: "1 result" },
    refs: { artifactIds: [], evidenceRefs: ["term:one"], decisionIds: [], segmentIds: ["segment-one"] },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function artifact(overrides: Partial<TaskArtifact> = {}): TaskArtifact {
  return {
    id: "artifact-one",
    taskId: "task-one",
    runId: "run-one",
    type: "segment_proposal",
    status: "reviewable",
    title: "句段建议",
    summary: "建议调整角色语气。",
    scope,
    version: 1,
    provenance: { agentThreadId: "specialist-one", activityId: "activity-one", evidenceRefs: ["term:one"], parentArtifactIds: [] },
    availableDecisions: ["apply", "request_change"],
    content: { target: "A revised line", evidenceRefs: ["term:one", "tm:two"] },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function decision(overrides: Partial<TaskDecision> = {}): TaskDecision {
  return {
    id: "decision-one",
    taskId: "task-one",
    runId: "run-one",
    requestedByThreadId: "specialist-one",
    kind: "proposal_review",
    status: "required",
    prompt: "是否应用建议？",
    options: [{ id: "apply", label: "应用建议", action: "apply", destructive: false }],
    scope,
    createdAt: at,
    ...overrides,
  };
}

const specialist: TaskAgentThread = {
  id: "specialist-one",
  taskId: "task-one",
  runId: "run-one",
  parentThreadId: "main-one",
  identity: { kind: "specialist", roleId: "translator", displayName: "翻译专家", roleLabel: "Translator", disclosureLabel: "Agent" },
  status: "complete",
  canReceiveUserMessage: true,
  childThreadIds: [],
  createdAt: at,
  updatedAt: at,
};

test("only a message-capable specialist artifact or activity exposes a scoped follow-up", () => {
  assert.deepEqual(followUpTargetForSelection({ kind: "artifact", artifact: artifact() }, [specialist]), {
    threadId: "specialist-one",
    displayName: "翻译专家",
    roleLabel: "Translator",
    source: "artifact",
    artifactId: "artifact-one",
  });
  assert.equal(followUpTargetForSelection({ kind: "decision", decision: decision() }, [specialist]), null);
  assert.equal(followUpTargetForSelection({ kind: "activity", activity: activity() }, [{ ...specialist, canReceiveUserMessage: false }]), null);
});

test("message and final reply bodies stay in conversation while typed activity detail remains inspectable", () => {
  assert.equal(activityDetailBody(activity()), "读取了项目术语表。");
  assert.equal(activityDetailBody(activity({ type: "message", tool: null, body: "不要复制这条消息" })), null);
  assert.equal(activityDetailBody(activity({ type: "final_response", tool: null, body: "不要复制完整回复" })), null);
});

test("artifact evidence is canonical and de-duplicated", () => {
  assert.deepEqual(artifactEvidence(artifact()), { refs: ["term:one", "tm:two"], content: undefined });
});

test("focused segment links only its canonical Task items and keeps chronology", () => {
  const otherActivity = activity({ id: "activity-other", refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: ["segment-two"] } });
  const laterDecision = decision({ createdAt: "2026-07-16T00:00:03.000Z" });
  const linked = segmentLinkedItems("segment-one", {
    activities: [otherActivity, activity({ createdAt: "2026-07-16T00:00:01.000Z" })],
    artifacts: [artifact({ createdAt: "2026-07-16T00:00:02.000Z" })],
    decisions: [laterDecision, decision({ id: "decision-other", scope: { ...scope, segmentIds: ["segment-two"] } })],
  });
  assert.deepEqual(linked.map((item) => item.kind), ["activity", "artifact", "decision"]);
  assert.equal(linked.some((item) => item.kind === "activity" && item.activity.id === "activity-other"), false);
});

test("segment evidence presentation keeps every structured match and canonical count", () => {
  const snapshot: SegmentEvidenceSnapshot = {
    projectId: "project-one",
    batchId: "batch-one",
    segmentId: "segment-one",
    source: "Do not repeat this source in the Inspector",
    tmMatches: ["tm-one", "tm-two", "tm-three"].map((id, index) => ({
      id,
      source: `TM source ${index}`,
      target: `TM target ${index}`,
      srcLang: "en",
      tgtLang: "zh",
      origin: "reviewed" as const,
      score: 1 - index * 0.1,
      matchType: index ? "fuzzy" as const : "exact" as const,
    })),
    termbaseMatches: ["tb-one", "tb-two"].map((id) => ({
      id,
      source: id,
      target: `${id}-target`,
      srcLang: "en",
      tgtLang: "zh",
      sourceFile: "terms.tbx",
      rowNo: 1,
      origin: "tbx" as const,
      matchType: "exact" as const,
    })),
    glossaryMatches: [{
      id: "glossary-one",
      source: "glossary source",
      target: "glossary target",
      sourceFile: "glossary.csv",
      rowNo: 2,
      matchType: "contains",
    }],
    cards: [],
    summary: { tm: 3, tmExact: 1, tmFuzzy: 2, termbase: 2, glossary: 1 },
  };

  const groups = segmentEvidenceGroups(snapshot);
  assert.deepEqual(groups.map((group) => [group.kind, group.matches.length]), [
    ["tm", 3],
    ["termbase", 2],
    ["glossary", 1],
  ]);
  assert.equal(groups[0]?.matches, snapshot.tmMatches, "the Inspector model must not slice canonical evidence");
  assert.equal(groups[1]?.matches, snapshot.termbaseMatches);
  assert.equal(groups[2]?.matches, snapshot.glossaryMatches);
  assert.deepEqual(segmentEvidenceSummaryRows(snapshot), [
    { label: "TM", value: 3 },
    { label: "精确", value: 1 },
    { label: "模糊", value: 2 },
    { label: "Termbase", value: 2 },
    { label: "Glossary", value: 1 },
  ]);
});

test("Inspector width keeps a usable main canvas and the source-confirmed 320px floor", () => {
  assert.deepEqual(inspectorWidthBounds(1_440), { min: INSPECTOR_MIN_WIDTH, max: INSPECTOR_MAX_WIDTH });
  assert.deepEqual(inspectorWidthBounds(900), { min: INSPECTOR_MIN_WIDTH, max: 480 });
  assert.equal(clampInspectorWidth(120, 1_440), INSPECTOR_MIN_WIDTH);
  assert.equal(clampInspectorWidth(900, 1_440), INSPECTOR_MAX_WIDTH);
  assert.equal(clampInspectorWidth(Number.NaN, 900), INSPECTOR_DEFAULT_WIDTH);
});

test("Inspector separator keyboard behavior mirrors its left-edge resize direction", () => {
  assert.equal(inspectorWidthForKey("ArrowLeft", 380, 1_000), 396);
  assert.equal(inspectorWidthForKey("ArrowRight", 380, 1_000), 364);
  assert.equal(inspectorWidthForKey("Home", 500, 1_000), INSPECTOR_DEFAULT_WIDTH);
  assert.equal(inspectorWidthForKey("End", 380, 1_000), 580);
  assert.equal(inspectorWidthForKey("Escape", 380, 1_000), null);
});
