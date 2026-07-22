import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  createTmStore,
  createTaskWorkspace,
  createProjectManifest,
  createWorkspace,
  importPhraseBatch,
  readBatch,
  readSourceContextIndex,
  termbasePath,
  updateSegmentTarget,
  writeJsonFile,
  type TermbaseEntry,
} from "@linguist-agent/cat-data";
import { createBatchSetTargetsTool, createSegmentSetTargetTool, createTmConcordanceTool, createTmLookupTool } from "@linguist-agent/cat-tools";
import { handleBatchRoute } from "../packages/cat-server/src/routes/batch_routes.js";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source><target>Gain &lt;color=#ffffff&gt;30% Attack Speed&lt;/color&gt;.</target></trans-unit>
  <trans-unit id="1002"><source>重复文本</source><target>Repeated Text</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context><context context-type="x-key-note">Sheet: Demo!F1</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>获得{1}30%攻击速度{2}。</source><target>Gain {1}30% Attack Speed{2}.</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>重复文本</source><target>Repeated Text</target></trans-unit>
  </group>
  <group id="3" m:para-id="3"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:3" m:para-id="3" m:locked="true"><source>重复文本</source><target>Repeated Text</target></trans-unit>
  </group>
</body></file></xliff>`;

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function writeRouteXlsx(path: string, rows: string[][]): Promise<void> {
  const zip = new JSZip();
  const strings: string[] = [];
  const indexFor = (value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      strings.push(value);
      index = strings.length - 1;
    }
    return index;
  };
  const colName = (index: number) => String.fromCharCode(65 + index);
  const sheetRows = rows
    .map((row, rowIndex) =>
      `<row r="${rowIndex + 1}">${row
        .map((cell, colIndex) => `<c r="${colName(colIndex)}${rowIndex + 1}" t="s"><v>${indexFor(cell)}</v></c>`)
        .join("")}</row>`)
    .join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t>${xmlEscape(value)}</t></si>`)
      .join("")}</sst>`,
  );
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-batch-test-"));
const mxliffPath = join(workspaceRoot, "sample.mxliff");
const masterPath = join(workspaceRoot, "master.xliff");
await writeFile(mxliffPath, mxliffFixture, "utf8");
await writeFile(masterPath, masterFixture, "utf8");
await createProjectManifest(workspaceRoot, workspaceRoot, { projectId: "proj", sourceLanguage: "zh-CN", targetLanguage: "en-US" });

const { batch, path } = await importPhraseBatch(workspaceRoot, {
  projectId: "proj",
  mxliffPath,
  masterXliffPath: masterPath,
  batchId: "b1",
});

assert.equal(path.endsWith("data/projects/proj/batches/b1/batch.json"), true);
assert.equal(batch.segments.length, 3);
assert.equal(batch.segments[0].source, "获得<color=#ffffff>30%攻击速度</color>。");
assert.equal(batch.segments[0].target, "Gain <color=#ffffff>30% Attack Speed</color>.");
assert.equal(batch.segments[0].contextNote, "Sheet: Demo!F1");
const sourceContext = await readSourceContextIndex(workspaceRoot, "proj");
const job1Context = sourceContext.rows.find((row) => row.segmentId === "job:1");
assert.equal(job1Context?.masterId, "1001");
assert.equal(job1Context?.contextNote, "Sheet: Demo!F1");
assert.equal(job1Context?.coordinate, "Demo!F1");
assert.equal(batch.duplicateSourceGroups.length, 1);
assert.equal(batch.segments[0].duplicateRole, "unique");
assert.equal(batch.segments[1].duplicateRole, "first");
assert.equal(batch.segments[1].duplicateOrdinal, 1);
assert.equal(batch.segments[1].duplicateGroupSize, 2);
assert.equal(batch.segments[1].duplicateFirstSegmentId, "job:2");
assert.equal(batch.segments[2].duplicateRole, "repeat");
assert.equal(batch.segments[2].duplicateOrdinal, 2);
assert.equal(batch.segments[2].duplicateFirstSegmentId, "job:2");

{
  const responses: Array<{ status: number; data: unknown; markdown?: string }> = [];
  let routeBody: Record<string, unknown> = {};
  const routeDeps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    markdown: (_res: unknown, status: number, data: string) => responses.push({ status, data, markdown: data }),
    readBody: async () => routeBody,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
      return value.trim();
    },
    optionalString: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };

  routeBody = { filePath: mxliffPath, masterXliffPath: masterPath, batchId: "route-b1", overwrite: true };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches"), ["api", "projects", "proj", "batches"], "proj", routeDeps), true);
  assert.equal((responses.pop()?.data as { batch?: { batchId?: string } }).batch?.batchId, "route-b1");

  routeBody = {};
  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1"), ["api", "projects", "proj", "batches", "route-b1"], "proj", routeDeps), true);
  const routePayload = responses.pop()?.data as { batch?: { tagViews?: Record<string, unknown> } };
  assert.equal(Boolean(routePayload.batch?.tagViews?.["job:1"]), true);

  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1?responseMode=summary"), ["api", "projects", "proj", "batches", "route-b1"], "proj", routeDeps), true);
  const summaryPayload = responses.pop()?.data as { summary?: Record<string, unknown>; batch?: unknown; delivery?: unknown };
  assert.deepEqual(summaryPayload.summary, {
    schemaVersion: 1,
    projectId: "proj",
    batchId: "route-b1",
    format: "phrase_mxliff",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    segments: 3,
    confirmed: 0,
    draft: 3,
    new: 0,
    locked: 1,
    updatedAt: (summaryPayload.summary as { updatedAt: string }).updatedAt,
  });
  assert.equal(typeof summaryPayload.summary?.updatedAt, "string");
  assert.equal(summaryPayload.batch, undefined, "summary mode must not serialize CAT rows or tag views");
  assert.equal(summaryPayload.delivery, undefined, "summary mode must not run or serialize Delivery detail");
  await assert.rejects(
    handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1?responseMode=unknown"), ["api", "projects", "proj", "batches", "route-b1"], "proj", routeDeps),
    /responseMode must be 'summary'/,
  );
  await createTaskWorkspace(workspaceRoot).create({
    projectId: "proj",
    taskId: "delivery-task",
    title: "Prepare delivery",
    intent: "Run deterministic QA and export the batch.",
    kind: "delivery",
    scope: { batchId: "route-b1" },
  });
  await createTaskWorkspace(workspaceRoot).create({ projectId: "proj", taskId: "wrong-batch-task", title: "Wrong scope", intent: "Reject cross-batch projection.", kind: "delivery", scope: { batchId: "other" } });
  routeBody = {};
  await assert.rejects(
    handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/delivery-qa"), ["api", "projects", "proj", "batches", "route-b1", "delivery-qa"], "proj", routeDeps),
    /taskId is required/,
  );
  routeBody = { taskId: "wrong-batch-task" };
  await assert.rejects(
    handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/delivery-qa"), ["api", "projects", "proj", "batches", "route-b1", "delivery-qa"], "proj", routeDeps),
    /batch scope does not match/,
  );

  await createTmStore(createWorkspace(workspaceRoot, "proj")).seed([
    { source: "重复文本", target: "Repeated Text", srcLang: "zh-CN", tgtLang: "en-US", origin: "client_tm" },
  ]);
  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/segments/job%3A2/evidence"), ["api", "projects", "proj", "batches", "route-b1", "segments", "job%3A2", "evidence"], "proj", routeDeps), true);
  const evidencePayload = responses.pop()?.data as { summary?: { tm?: number }; cards?: Array<{ toolName?: string; tab?: string }> };
  assert.equal(evidencePayload.summary?.tm, 1);
  assert.equal(evidencePayload.cards?.[0]?.toolName, "tm_lookup");
  assert.equal(evidencePayload.cards?.[0]?.tab, "cat");

  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/evidence-pack"), ["api", "projects", "proj", "batches", "route-b1", "evidence-pack"], "proj", routeDeps), true);
  const evidencePackPayload = responses.pop()?.data as { summary?: { totalSegments?: number; segmentsWithEvidence?: number } };
  assert.equal(evidencePackPayload.summary?.totalSegments, 3);
  assert.equal((evidencePackPayload.summary?.segmentsWithEvidence ?? 0) >= 1, true);

  routeBody = { target: "Route Draft Copy", reason: "route segment update smoke", changeType: "user_approved" };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/segments/job%3A2"), ["api", "projects", "proj", "batches", "route-b1", "segments", "job%3A2"], "proj", routeDeps), true);
  assert.equal(((responses.pop()?.data as { result?: { changedSegmentIds?: string[] } }).result?.changedSegmentIds ?? []).includes("job:2"), true);

  const routeDraftRevision = (await readBatch(workspaceRoot, "proj", "route-b1")).segments.find((segment) => segment.id === "job:2")?.updatedAt;
  assert.equal(typeof routeDraftRevision, "string");
  routeBody = {
    target: "Route Draft Copy v2",
    reason: "compact route segment update",
    changeType: "user_approved",
    responseMode: "segment",
    expectedSegmentUpdatedAt: routeDraftRevision,
  };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/segments/job%3A2"), ["api", "projects", "proj", "batches", "route-b1", "segments", "job%3A2"], "proj", routeDeps), true);
  const compactMutation = responses.pop() as { status: number; data: { segment?: { target?: string }; batch?: unknown; batchUpdatedAt?: string } };
  assert.equal(compactMutation.status, 200);
  assert.equal(compactMutation.data.segment?.target, "Route Draft Copy v2");
  assert.equal(compactMutation.data.batch, undefined);
  assert.equal(typeof compactMutation.data.batchUpdatedAt, "string");

  routeBody = {
    target: "Stale client overwrite",
    reason: "must conflict",
    changeType: "user_approved",
    responseMode: "segment",
    expectedSegmentUpdatedAt: routeDraftRevision,
  };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/segments/job%3A2"), ["api", "projects", "proj", "batches", "route-b1", "segments", "job%3A2"], "proj", routeDeps), true);
  const conflictMutation = responses.pop() as { status: number; data: { error?: string; currentSegment?: { target?: string } } };
  assert.equal(conflictMutation.status, 409);
  assert.equal(conflictMutation.data.error, "segment_revision_conflict");
  assert.equal(conflictMutation.data.currentSegment?.target, "Route Draft Copy v2");

  await writeJsonFile<TermbaseEntry[]>(termbasePath(workspaceRoot, "proj"), [
    {
      id: "tb-route-repeat",
      source: "重复文本",
      target: "Repeated Text",
      srcLang: "zh-CN",
      tgtLang: "en-US",
      sourceFile: "terms.xlsx",
      rowNo: 2,
      origin: "manual",
    },
  ]);
  routeBody = { taskId: "delivery-task" };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/delivery-qa"), ["api", "projects", "proj", "batches", "route-b1", "delivery-qa"], "proj", routeDeps), true);
  const qaReport = responses.pop()?.data as { reportId: string; findings: Array<{ id: string }> };
  assert.equal(qaReport.findings.length > 0, true);
  let deliveryTask = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "delivery-task" });
  assert.equal(deliveryTask.runs[0]?.mode, "pipeline");
  assert.equal(deliveryTask.artifacts[0]?.type, "qa_report");

  routeBody = {
    taskId: "delivery-task",
    reportId: qaReport.reportId,
    decisions: [{ findingId: qaReport.findings[0]!.id, reviewDecision: "accepted_risk", reviewReason: "Reviewed in route test.", reviewedBy: "user" }],
  };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/delivery-qa-review"), ["api", "projects", "proj", "batches", "route-b1", "delivery-qa-review"], "proj", routeDeps), true);
  assert.equal((responses.pop()?.data as { reportId?: string }).reportId, `${qaReport.reportId}:reviewed`);
  deliveryTask = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "delivery-task" });
  assert.equal(deliveryTask.runs.length, 2, "each deterministic pipeline invocation must be a distinct Run");
  assert.deepEqual(deliveryTask.runs.map((run) => run.status), ["complete", "complete"]);
  assert.equal(deliveryTask.decisions.length, 1);
  assert.equal(deliveryTask.decisions[0]?.selectedOptionId, "accepted_risk");

  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/quality?taskId=delivery-task"), ["api", "projects", "proj", "batches", "route-b1", "quality"], "proj", routeDeps), true);
  const qualityPayload = responses.pop()?.data as { summary?: { openBlockers?: number }; findings?: Array<{ id: string; segmentId: string; code: string; status: string }> };
  assert.equal((qualityPayload.summary?.openBlockers ?? 0) >= 1, true);
  const qualityFinding = qualityPayload.findings?.find((finding) => finding.status === "open");
  assert.equal(Boolean(qualityFinding), true);

  routeBody = { taskId: "delivery-task", segmentId: qualityFinding?.segmentId, findingId: qualityFinding?.id, code: qualityFinding?.code, reason: "route test accepted quality finding", acceptedBy: "test" };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/quality/waivers"), ["api", "projects", "proj", "batches", "route-b1", "quality", "waivers"], "proj", routeDeps), true);
  const waiverPayload = responses.pop()?.data as { waivers?: unknown[]; quality?: { summary?: { ignored?: number } } };
  assert.equal(waiverPayload.waivers?.length, 1);
  assert.equal(waiverPayload.quality?.summary?.ignored, 1);

  assert.equal(await handleBatchRoute({ method: "GET", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/delivery-readiness?taskId=delivery-task"), ["api", "projects", "proj", "batches", "route-b1", "delivery-readiness"], "proj", routeDeps), true);
  assert.equal((responses.pop()?.data as { batchId?: string }).batchId, "route-b1");
  deliveryTask = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "delivery-task" });
  assert.equal(deliveryTask.artifacts.some((artifact) => artifact.type === "delivery_readiness"), true);
  assert.equal(deliveryTask.artifacts.filter((artifact) => artifact.type === "qa_report").length >= 3, true);
  assert.equal(deliveryTask.decisions.some((decision) => decision.kind === "waiver" && decision.selectedOptionId === "accepted_risk"), true);
  const pipelineRoot = deliveryTask.agentThreads.find((thread) => thread.id === deliveryTask.runs[0]?.rootAgentThreadId);
  assert.equal(pipelineRoot?.childThreadIds.length, new Set(pipelineRoot?.childThreadIds).size);

  const customerReturnPath = join(workspaceRoot, "customer-return.xlsx");
  await writeRouteXlsx(customerReturnPath, [
    ["SegmentID", "Source", "Target"],
    ["job:2", "重复文本", "Reviewed Return Text"],
  ]);
  routeBody = { xlsxPath: customerReturnPath, importReviewedTm: true };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/customer-returns"), ["api", "projects", "proj", "batches", "route-b1", "customer-returns"], "proj", routeDeps), true);
  const customerReturnPayload = responses.pop()?.data as { changedRows?: number; reviewedTmUpdated?: number; rows?: Array<{ segmentId?: string; returnedTarget?: string }> };
  assert.equal(customerReturnPayload.changedRows, 1);
  assert.equal(customerReturnPayload.reviewedTmUpdated, 1);
  assert.equal(customerReturnPayload.rows?.[0]?.segmentId, "job:2");
  assert.equal(customerReturnPayload.rows?.[0]?.returnedTarget, "Reviewed Return Text");

  const runsBeforeBlockedExport = deliveryTask.runs.length;
  routeBody = { format: "phrase_mxliff", taskId: "delivery-task" };
  await assert.rejects(
    handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/export"), ["api", "projects", "proj", "batches", "route-b1", "export"], "proj", routeDeps),
    /Quality decision ledger blocked export/,
  );
  deliveryTask = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "delivery-task" });
  assert.equal(deliveryTask.runs.length, runsBeforeBlockedExport + 1);
  assert.equal(deliveryTask.runs.at(-1)?.status, "failed");
  assert.equal(deliveryTask.task.status, "failed");
  assert.equal(deliveryTask.activeRunId, null);

  routeBody = { format: "phrase_mxliff", force: true, taskId: "delivery-task" };
  assert.equal(await handleBatchRoute({ method: "POST", headers: {} } as never, {} as never, new URL("http://x/api/projects/proj/batches/route-b1/export"), ["api", "projects", "proj", "batches", "route-b1", "export"], "proj", routeDeps), true);
  assert.equal((responses.pop()?.data as { format?: string }).format, "phrase_mxliff");
  deliveryTask = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: "delivery-task" });
  assert.equal(deliveryTask.runs.length, runsBeforeBlockedExport + 2);
  assert.equal(deliveryTask.runs.at(-1)?.status, "complete");
  assert.equal(deliveryTask.task.status, "complete");
  const taskArtifactTypes = deliveryTask.artifacts.map((artifact) => artifact.type);
  assert.equal(taskArtifactTypes.includes("delivery_export"), true);
  assert.equal(taskArtifactTypes.includes("delivery_readiness"), true);
  assert.equal(taskArtifactTypes.filter((type) => type === "qa_report").length, 4);
  const deliveryAuthorization = deliveryTask.decisions.find((decision) => decision.kind === "delivery_authorization");
  assert.equal(deliveryAuthorization?.selectedOptionId, "blocked_force_override");
  assert.match(deliveryAuthorization?.reason ?? "", /explicit force override/);
  assert.equal(deliveryTask.agentThreads.some((thread) => thread.identity.roleId === "delivery_qa"), true);
  assert.equal(deliveryTask.agentThreads.some((thread) => thread.identity.roleId === "quality_audit"), true);
  assert.equal(deliveryTask.agentThreads.some((thread) => thread.identity.roleId === "quality_waiver"), true);
  assert.equal(deliveryTask.agentThreads.some((thread) => thread.identity.roleId === "delivery_readiness"), true);
  assert.equal(deliveryTask.agentThreads.some((thread) => thread.identity.roleId === "delivery_export"), true);
}

await assert.rejects(
  () =>
    updateSegmentTarget(workspaceRoot, "proj", "b1", {
      segmentId: "job:2",
      target: "Empty reason",
      confirm: true,
      reason: "",
      changeType: "user_approved",
    }),
  /non-empty reason/,
);

await assert.rejects(
  () =>
    updateSegmentTarget(workspaceRoot, "proj", "b1", {
      segmentId: "job:2",
      target: "Terminology-only rewrite",
      confirm: true,
      reason: "term rewrite without evidence",
      changeType: "term",
    }),
  /requires citable evidenceSources/,
);

await assert.rejects(
  () =>
    updateSegmentTarget(workspaceRoot, "proj", "b1", {
      segmentId: "job:2",
      target: "Terminology-only rewrite",
      confirm: true,
      reason: "term rewrite with audit-only evidence",
      changeType: "term",
      evidenceSources: ["tool_trace:abc123"],
    }),
  /audit-only evidence/,
);

await assert.rejects(
  () =>
    updateSegmentTarget(workspaceRoot, "proj", "b1", {
      segmentId: "job:1",
      target: "Gain 30% Attack Speed.",
      confirm: false,
      reason: "tag policy should reject tag loss at write time",
      changeType: "user_approved",
    }),
  /tag signature policy/,
);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Draft Copy",
  confirm: false,
  reason: "manual draft save should not confirm",
  changeType: "user_approved",
});
const draftUpdated = await readBatch(workspaceRoot, "proj", "b1");
assert.equal(draftUpdated.segments.find((segment) => segment.id === "job:2")?.target, "Draft Copy");
assert.equal(draftUpdated.segments.find((segment) => segment.id === "job:2")?.status, "draft");

const concurrentRevision = draftUpdated.segments.find((segment) => segment.id === "job:2")?.updatedAt ?? null;
const concurrentTagRevision = draftUpdated.segments.find((segment) => segment.id === "job:1")?.updatedAt ?? null;
await Promise.all([
  updateSegmentTarget(workspaceRoot, "proj", "b1", {
    segmentId: "job:2",
    target: "Concurrent first row",
    confirm: false,
    reason: "serialized mutation first row",
    changeType: "user_approved",
    expectedSegmentUpdatedAt: concurrentRevision,
  }),
  updateSegmentTarget(workspaceRoot, "proj", "b1", {
    segmentId: "job:1",
    target: "Concurrent <color=#ffffff>31% Attack Speed</color>.",
    confirm: false,
    reason: "serialized mutation second row",
    changeType: "user_approved",
    expectedSegmentUpdatedAt: concurrentTagRevision,
  }),
]);
const concurrentlyUpdated = await readBatch(workspaceRoot, "proj", "b1");
assert.equal(concurrentlyUpdated.segments.find((segment) => segment.id === "job:2")?.target, "Concurrent first row");
assert.equal(concurrentlyUpdated.segments.find((segment) => segment.id === "job:1")?.target, "Concurrent <color=#ffffff>31% Attack Speed</color>.");

const result = await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Repeated Copy",
  confirm: true,
  reason: "duplicate propagation smoke",
  changeType: "user_approved",
});

assert.deepEqual(result.changedSegmentIds, ["job:2"]);
assert.deepEqual(result.skippedLockedIds, []);
assert.deepEqual(result.skippedDuplicateIds, []);
assert.equal(result.propagated, false);
assert.equal(result.duplicateGroupSize, 1);

const updated = await readBatch(workspaceRoot, "proj", "b1");
assert.equal(updated.segments.find((segment) => segment.id === "job:2")?.target, "Repeated Copy");
assert.equal(updated.segments.find((segment) => segment.id === "job:2")?.status, "confirmed");
assert.equal(updated.segments.find((segment) => segment.id === "job:2")?.updateChangeType, "user_approved");
assert.equal(updated.segments.find((segment) => segment.id === "job:3")?.target, "Repeated Text");
assert.equal(updated.segments.find((segment) => segment.id === "job:3")?.status, "draft");

const explicitPropagation = await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Repeated Copy v2",
  confirm: true,
  propagateDuplicates: true,
  reason: "explicit duplicate propagation smoke",
  changeType: "user_approved",
});
assert.deepEqual(explicitPropagation.changedSegmentIds, ["job:2"]);
assert.deepEqual(explicitPropagation.skippedLockedIds, ["job:3"]);
assert.equal(explicitPropagation.propagated, true);
assert.equal(explicitPropagation.duplicateGroupSize, 2);

const tmAfterConfirm = await createTmStore(createWorkspace(workspaceRoot, "proj")).lookup({
  source: "重复文本",
  srcLang: "zh-cn",
  tgtLang: "en-us",
  threshold: 1,
});
assert.equal(tmAfterConfirm[0]?.target, "Repeated Copy v2");
assert.equal(tmAfterConfirm[0]?.origin, "reviewed");
assert.equal(tmAfterConfirm[0]?.sourceKind, "batch_confirm");
assert.equal(tmAfterConfirm[0]?.sourceBatchId, "b1");
assert.equal(tmAfterConfirm[0]?.sourceSegmentId, "job:2");
assert.equal(tmAfterConfirm[0]?.effectiveAuthority, "working_tm");

{
  const divergentMxliffPath = join(workspaceRoot, "divergent.mxliff");
  const divergentMxliff = `<?xml version="1.0"?>
  <xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
    <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
      <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>重复文本</source><target>Repeated Text</target></trans-unit>
    </group>
    <group id="4" m:para-id="4"><context-group><context context-type="x-key">1002</context></context-group>
      <trans-unit id="job:4" m:para-id="4" m:locked="false"><source>重复文本</source><target>Context Variant</target></trans-unit>
    </group>
  </body></file></xliff>`;
  await writeFile(divergentMxliffPath, divergentMxliff, "utf8");
  await importPhraseBatch(workspaceRoot, {
    projectId: "proj",
    mxliffPath: divergentMxliffPath,
    masterXliffPath: masterPath,
    batchId: "b2",
  });
  const duplicateResult = await updateSegmentTarget(workspaceRoot, "proj", "b2", {
    segmentId: "job:2",
    target: "Repeated Copy",
    confirm: true,
    propagateDuplicates: true,
    reason: "safe duplicate propagation should not overwrite divergent context",
    changeType: "user_approved",
  });
  assert.deepEqual(duplicateResult.changedSegmentIds, ["job:2"]);
  assert.deepEqual(duplicateResult.skippedDuplicateIds, ["job:4"]);
  const divergentBatch = await readBatch(workspaceRoot, "proj", "b2");
  assert.equal(divergentBatch.segments.find((segment) => segment.id === "job:4")?.target, "Context Variant");
}

{
  const tm = createTmStore(createWorkspace(workspaceRoot, "proj"));
  await Promise.all(
    Array.from({ length: 20 }, (_unused, index) =>
      tm.upsertReviewed({
        source: `并发源 ${index}`,
        target: `Concurrent target ${index}`,
        srcLang: "zh-cn",
        tgtLang: "en-us",
        project: "proj",
      }),
    ),
  );
  const entries = await tm.list();
  assert.equal(entries.filter((entry) => entry.source.startsWith("并发源 ")).length, 20);
}

{
  const tm = createTmStore(createWorkspace(workspaceRoot, "tm-self-loop"));
  await tm.seed([
    {
      id: "mt-1",
      source: "自循环术语",
      target: "Self-loop MT",
      srcLang: "zh-cn",
      tgtLang: "en-us",
      origin: "mt",
      quality: 80,
    },
    {
      id: "client-1",
      source: "自循环术语",
      target: "Client-approved Term",
      srcLang: "zh-cn",
      tgtLang: "en-us",
      origin: "client_tm",
      quality: 100,
      project: "proj",
      note: "approved in client TM",
    },
  ]);
  const authoritative = await tm.lookup({ source: "自循环术语", srcLang: "zh-cn", tgtLang: "en-us", threshold: 1 });
  assert.deepEqual(authoritative.map((entry) => entry.origin), ["client_tm"]);
  const filtered = await tm.lookup({
    source: "自循环术语",
    srcLang: "zh-cn",
    tgtLang: "en-us",
    threshold: 1,
    origin: "client_tm",
    minQuality: 100,
  });
  assert.deepEqual(filtered.map((entry) => entry.id), ["client-1"]);
  const withMt = await tm.lookup({
    source: "自循环术语",
    srcLang: "zh-cn",
    tgtLang: "en-us",
    threshold: 1,
    includeUnreviewedMt: true,
  });
  assert.equal(withMt.some((entry) => entry.origin === "mt"), true);
  const concordance = await tm.concordance({ query: "Self-loop MT", srcLang: "zh-cn", tgtLang: "en-us" });
  assert.equal(concordance.length, 0);
  const noteConcordance = await tm.concordance({ query: "client TM", srcLang: "zh-cn", tgtLang: "en-us", field: "note" });
  assert.deepEqual(noteConcordance.map((entry) => entry.id), ["client-1"]);
  const lookupTool = createTmLookupTool(createWorkspace(workspaceRoot, "tm-self-loop"));
  const lookupOutput = await lookupTool.execute("tool-call", {
    source: "自循环术语",
    srcLang: "zh-cn",
    tgtLang: "en-us",
    threshold: 1,
  } as any);
  assert.match(lookupOutput.content[0].text, /client_tm · q100/);
  assert.match(lookupOutput.content[0].text, /Evidence: tm:client-1/);
  assert.doesNotMatch(lookupOutput.content[0].text, /Self-loop MT/);
  const concordanceTool = createTmConcordanceTool(createWorkspace(workspaceRoot, "tm-self-loop"));
  const concordanceOutput = await concordanceTool.execute("tool-call", {
    query: "client TM",
    srcLang: "zh-cn",
    tgtLang: "en-us",
    field: "note",
  } as any);
  assert.match(concordanceOutput.content[0].text, /note ·/);
  assert.match(concordanceOutput.content[0].text, /Evidence: tm:client-1/);
}

{
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const batchTool = createBatchSetTargetsTool();
    const batchWrite = await batchTool.execute("test-tool-call", {
      projectId: "proj",
      batchId: "b1",
      reason: "first-pass translation smoke",
      updates: [
        {
          segmentId: "job:2",
          target: "First-pass draft copy",
        },
      ],
    } as any);
    assert.match(batchWrite.content[0].text, /Batch Targets Updated/);
    assert.match(batchWrite.content[0].text, /Changed: job:2/);
    const batchAfterDrafts = await readBatch(workspaceRoot, "proj", "b1");
    assert.equal(batchAfterDrafts.segments.find((segment) => segment.id === "job:2")?.target, "First-pass draft copy");
    assert.equal(batchAfterDrafts.segments.find((segment) => segment.id === "job:2")?.status, "draft");

    const tool = createSegmentSetTargetTool();
    await assert.rejects(
      () =>
        tool.execute("test-tool-call", {
          projectId: "proj",
          batchId: "b1",
          segmentId: "job:2",
          target: "Terminology-only rewrite",
          confirm: true,
          changeType: "term",
          reason: "term rewrite without evidence",
      } as any),
      /requires citable evidenceSources/,
    );
    const ok = await tool.execute("test-tool-call", {
      projectId: "proj",
      batchId: "b1",
      segmentId: "job:2",
      target: "Reviewed duplicate copy",
      confirm: true,
      propagateDuplicates: false,
      changeType: "term",
      reason: "glossary confirmed row 1",
      evidenceSources: ["glossary:row:1"],
    } as any);
    assert.match(ok.content[0].text, /Segment Updated/);
  } finally {
    process.chdir(previousCwd);
  }
}

console.log("batch_workspace tests passed");
