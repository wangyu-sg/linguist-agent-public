import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectManifest,
  importPhraseBatch,
  readWorkflowArtifacts,
  upsertPhraseQaRow,
  upsertBrowserAutomationCheckpoint,
  upsertPlatformBackfillRow,
  upsertTeamRolePass,
  upsertWorkflowAuthorityEvidence,
  type TeamRolePass,
} from "@linguist-agent/cat-data";
import { handleWorkflowArtifactRoute } from "../packages/cat-server/src/routes/workflow_artifact_routes.js";

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="risk.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>获得1个奖励</source><target>Gain 2 rewards</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>名称</source><target>名称</target></trans-unit>
  </group>
  <group id="3" m:para-id="3"><context-group><context context-type="x-key">1003</context></context-group>
    <trans-unit id="job:3" m:para-id="3" m:locked="false"><source>第一行\\n第二行</source><target>First line second line</target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-workflow-artifacts-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "risk.mxliff"), mxliffFixture, "utf8");

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "risk-project",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "risk-project",
  mxliffPath: "risk.mxliff",
  batchId: "risk-batch",
});

let artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
assert.equal(artifacts.projectId, "risk-project");
assert.equal(artifacts.riskQueue.length, 3);
assert.equal(artifacts.riskQueue.some((row) => row.segmentId === "job:1" && row.risks.includes("number")), true);
assert.equal(artifacts.riskQueue.some((row) => row.segmentId === "job:2" && row.risks.includes("source_target_identity")), true);
assert.equal(artifacts.riskQueue.some((row) => row.segmentId === "job:3" && row.risks.includes("newline")), true);
assert.deepEqual(artifacts.riskQueue.map((row) => row.queueRank), [1, 2, 3]);

await upsertPhraseQaRow(workspaceRoot, "risk-project", {
  id: "qa-1",
  segmentId: "job:1",
  category: "number",
  message: "Phrase QA number warning.",
  disposition: "ignored_false_positive",
  finalIgnoreState: "ignored",
  evidence: "Reviewer verified source and target numbers are intentionally different.",
});
artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
assert.equal(artifacts.phraseQaRows.length, 1);
assert.equal(artifacts.phraseQaRows[0].disposition, "ignored_false_positive");
assert.equal(artifacts.phraseQaRows[0].finalIgnoreState, "ignored");

await upsertPlatformBackfillRow(workspaceRoot, "risk-project", {
  id: "bf-1",
  segmentId: "job:1",
  batch: "risk-batch",
  state: "readback_verified",
  decision: "confirmed",
  localProposal: "Gain 2 rewards",
  phraseEvidence: "Phrase CAT target matches local proposal.",
  readbackState: "verified after write",
});
artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
assert.equal(artifacts.backfillRows.length, 1);
assert.equal(artifacts.backfillRows[0].state, "readback_verified");
assert.equal(artifacts.backfillRows[0].decision, "confirmed");

await upsertWorkflowAuthorityEvidence(workspaceRoot, "risk-project", {
  id: "auth-local-job-1",
  decisionKey: "job:1",
  segmentId: "job:1",
  tier: "local_proposal",
  label: "Local proposal",
  target: "Gain 2 rewards",
  evidenceSource: "local_review",
});
await upsertWorkflowAuthorityEvidence(workspaceRoot, "risk-project", {
  id: "auth-phrase-job-1",
  decisionKey: "job:1",
  segmentId: "job:1",
  tier: "phrase_final_stage",
  label: "Phrase CAT readback",
  target: "Gain 1 reward",
  evidenceSource: "phrase_cat",
});
artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
const authorityDecision = artifacts.authorityDecisions.find((decision) => decision.decisionKey === "job:1");
assert.equal(authorityDecision?.winner.tier, "phrase_final_stage");
assert.equal(authorityDecision?.winner.target, "Gain 1 reward");
assert.equal(authorityDecision?.rejected.some((row) => row.tier === "local_proposal"), true);

await upsertBrowserAutomationCheckpoint(workspaceRoot, "risk-project", {
  id: "browser-qa-load-more",
  operation: "qa_load_more",
  status: "verified",
  checkpoint: "Scroll QA panel and verify final row coverage before continuing.",
  previousQaRowCount: 10,
  currentQaRowCount: 16,
  hasLoadMore: false,
  lastAction: "load more clicked and DOM re-read",
});
await upsertBrowserAutomationCheckpoint(workspaceRoot, "risk-project", {
  id: "browser-timeout-reconnect",
  operation: "reconnect",
  status: "observed",
  checkpoint: "Timeout recovered by re-reading current editor state.",
  currentSegmentId: "job:1",
  lastVerifiedSegmentId: "job:1",
  readbackState: "current row visible after reconnect",
});
artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
assert.equal(artifacts.browserAutomationChecks.length, 2);
assert.equal(artifacts.browserAutomationChecks.some((row) => row.operation === "qa_load_more" && row.hasLoadMore === false && row.currentQaRowCount === 16), true);
assert.equal(artifacts.browserAutomationChecks.some((row) => row.operation === "reconnect" && row.status === "observed" && row.currentSegmentId === "job:1"), true);

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
    optionalNumber: (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined,
  };

  routeBody = {
    operation: "qa_load_more",
    status: "verified",
    checkpoint: "Route module writes browser checkpoint.",
    currentQaRowCount: 20,
    hasLoadMore: false,
  };
  assert.equal(await handleWorkflowArtifactRoute({ method: "POST" } as never, {} as never, ["api", "projects", "risk-project", "workflow-artifacts", "browser-checks", "route-browser"], "risk-project", routeDeps), true);
  assert.equal(responses.pop()?.status, 200);

  routeBody = {};
  assert.equal(await handleWorkflowArtifactRoute({ method: "GET" } as never, {} as never, ["api", "projects", "risk-project", "workflow-artifacts"], "risk-project", routeDeps), true);
  const routeArtifacts = responses.pop()?.data as { browserAutomationChecks: Array<{ id: string; currentQaRowCount?: number }> };
  assert.equal(routeArtifacts.browserAutomationChecks.some((row) => row.id === "route-browser" && row.currentQaRowCount === 20), true);
}

{
  const rolePass = (roleId: TeamRolePass["roleId"]): TeamRolePass => ({
    workflowId: "concurrent-team-run",
    roleId,
    status: "completed",
    sessionId: `concurrent-${roleId}`,
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    summary: `${roleId} completed concurrently.`,
  });
  await Promise.all([
    upsertTeamRolePass(workspaceRoot, "risk-project", rolePass("translator")),
    upsertTeamRolePass(workspaceRoot, "risk-project", rolePass("editor")),
  ]);
  artifacts = await readWorkflowArtifacts(workspaceRoot, "risk-project");
  const concurrentRoles = artifacts.teamRolePasses
    .filter((row) => row.workflowId === "concurrent-team-run")
    .map((row) => row.roleId)
    .sort();
  assert.deepEqual(concurrentRoles, ["editor", "translator"]);
}

console.log("workflow_artifacts tests passed");
