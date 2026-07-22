import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DefaultResourceLoader, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createProjectManifest,
  createWorkspace,
  JsonTmStore,
  TEAM_EVIDENCE_TOOL_NAMES,
  workflowArtifactsPath,
  writeJsonFile,
} from "@linguist-agent/cat-data";
import { guardTeamEvidenceChildToolCall, prepareTeamEvidenceChildScope, readTeamEvidenceChildScope, registerTeamEvidenceChildRuntime } from "@linguist-agent/cat-runtime";
import { buildTeamEvidenceTools } from "@linguist-agent/cat-tools";

const originalCwd = process.cwd();
const originalCacheRoot = process.env.LA_RUNTIME_CACHE_ROOT;
const root = await mkdtemp(join(tmpdir(), "la-team-evidence-child-"));
process.env.LA_RUNTIME_CACHE_ROOT = join(root, "cache");
process.chdir(root);

try {
  assert.equal(guardTeamEvidenceChildToolCall("batch_read"), undefined);
  assert.match(guardTeamEvidenceChildToolCall("intercom")?.reason ?? "", /outside the read-only Team evidence tool profile/);
  assert.match(guardTeamEvidenceChildToolCall("write")?.reason ?? "", /outside the read-only Team evidence tool profile/);
  const prepared = await prepareTeamEvidenceChildScope({
    repoRoot: root,
    projectId: "project-1",
    workflowId: "workflow-1",
    roleId: "translator",
    batchId: "batch-1",
  });
  assert.ok(prepared.sessionDir.startsWith(join(root, "cache", "team-role-sessions")));
  assert.match(prepared.policyHash, /^[0-9a-f]{64}$/);
  const futureSessionFile = join(prepared.sessionDir, "future-run", "session.jsonl");
  assert.equal((await readTeamEvidenceChildScope(root, futureSessionFile)).workflowId, "workflow-1", "scope must load before Pi creates its session file");

  const childSessionDir = join(prepared.sessionDir, "async-run");
  const childSessionFile = join(childSessionDir, "session.jsonl");
  await mkdir(childSessionDir, { recursive: true });
  await writeFile(childSessionFile, "", "utf8");
  const loaded = await readTeamEvidenceChildScope(root, childSessionFile);
  assert.equal(loaded.projectId, "project-1");
  assert.equal(loaded.batchId, "batch-1");
  assert.deepEqual(loaded.allowedTools, TEAM_EVIDENCE_TOOL_NAMES);

  const workspace = createWorkspace(root, "project-1");
  const projectRoot = join(root, "customer-project");
  await mkdir(projectRoot, { recursive: true });
  await createProjectManifest(root, projectRoot, { projectId: "project-1", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  const batchDir = join(root, "data", "projects", "project-1", "batches", "batch-1");
  await mkdir(batchDir, { recursive: true });
  await writeFile(join(batchDir, "batch.json"), `${JSON.stringify({
    schemaVersion: 1,
    format: "csv_paste",
    projectId: "project-1",
    batchId: "batch-1",
    sourceFile: join(batchDir, "source.csv"),
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    tagReport: { totalSegments: 120, placeholderSegments: 0, masterMatchedSegments: 120, masterUnmatchedSegments: 0, replacedPlaceholders: 0, unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0 },
    duplicateSourceGroups: [],
    segments: Array.from({ length: 120 }, (_, index) => ({
      index: index + 1,
      id: `segment-${index + 1}`,
      source: `Source ${index + 1}`,
      target: "",
      rawSource: `Source ${index + 1}`,
      rawTarget: "",
      locked: false,
      status: "new",
      duplicateKey: `Source ${index + 1}`,
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    })),
  })}\n`, "utf8");
  await new JsonTmStore(workspace).seed([
    { source: "勇者徽记", target: "Hero Emblem", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed" },
  ]);
  const context = {
    cwd: root,
    sessionManager: { getSessionFile: () => childSessionFile },
  } as unknown as ExtensionContext;
  const tools = buildTeamEvidenceTools(async (toolName, ctx) => {
    const scope = await readTeamEvidenceChildScope(ctx.cwd, ctx.sessionManager.getSessionFile() ?? "");
    if (!scope.allowedTools.includes(toolName)) throw new Error("tool not allowed");
    return scope;
  });
  assert.deepEqual(tools.map((tool) => tool.name), TEAM_EVIDENCE_TOOL_NAMES);
  assert.ok(tools.every((tool) => !/(?:^|_)(?:write|edit|set|apply|import|export)(?:_|$)/i.test(tool.name)));
  const batchSchema = tools.find((tool) => tool.name === "batch_read")!.parameters as unknown as { properties?: Record<string, unknown> };
  assert.equal(batchSchema.properties?.projectId, undefined);
  assert.equal(batchSchema.properties?.batchId, undefined);

  const tmLookup = tools.find((tool) => tool.name === "tm_lookup")!;
  const tmResult = await tmLookup.execute("tm-1", { source: "勇者徽记", threshold: 0.7, topK: 1 }, undefined, undefined, context);
  assert.match(tmResult.content.map((part) => "text" in part ? part.text : "").join("\n"), /Hero Emblem/);

  const termbase = tools.find((tool) => tool.name === "termbase_lookup")!;
  await assert.rejects(
    () => termbase.execute("tb-1", { projectId: "another-project", term: "战士" }, undefined, undefined, context),
    /project scope conflict/,
  );

  const subset = await prepareTeamEvidenceChildScope({
    repoRoot: root,
    projectId: "project-1",
    workflowId: "workflow-2",
    roleId: "editor",
    batchId: "batch-1",
    segmentIds: ["segment-1"],
  });
  const subsetSessionDir = join(subset.sessionDir, "async-run");
  const subsetSessionFile = join(subsetSessionDir, "session.jsonl");
  await mkdir(subsetSessionDir, { recursive: true });
  await writeFile(subsetSessionFile, "", "utf8");
  const subsetContext = { cwd: root, sessionManager: { getSessionFile: () => subsetSessionFile } } as unknown as ExtensionContext;
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  let activeTools: string[] = [];
  registerTeamEvidenceChildRuntime({
    on: (name: string, handler: (event: unknown, context: ExtensionContext) => unknown) => { handlers.set(name, handler); },
    registerTool: () => undefined,
    setActiveTools: (names: string[]) => { activeTools = names; },
  } as never);
  await handlers.get("session_start")?.({}, subsetContext);
  assert.deepEqual(activeTools, subset.scope.allowedTools);
  const noTools = await prepareTeamEvidenceChildScope({
    repoRoot: root,
    projectId: "project-1",
    workflowId: "workflow-eval",
    roleId: "translator",
    batchId: "batch-1",
    allowedTools: [],
  });
  const noToolsContext = {
    cwd: root,
    sessionManager: { getSessionFile: () => join(noTools.sessionDir, "run-0", "session.jsonl") },
  } as unknown as ExtensionContext;
  const beforeStart = await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, noToolsContext);
  assert.deepEqual(activeTools, [], "blind Eval must remove every provider-visible CAT tool before the agent request is built");
  assert.match((beforeStart as { systemPrompt?: string })?.systemPrompt ?? "", /Team child constitution/);
  await handlers.get("before_provider_request")?.({}, noToolsContext);
  assert.deepEqual(activeTools, [], "blind Eval must keep the provider payload tool-free");
  const batchRead = tools.find((tool) => tool.name === "batch_read")!;
  let batchStart: number | null = 1;
  let batchRows = 0;
  while (batchStart !== null) {
    const page = await batchRead.execute(`batch-page-${batchStart}`, { start: batchStart, limit: 50 }, undefined, undefined, context);
    const details = page.details as { returned: number; nextStart: number | null; pageComplete: boolean };
    batchRows += details.returned;
    batchStart = details.nextStart;
    assert.equal(details.pageComplete, batchStart === null);
  }
  assert.equal(batchRows, 120);
  await assert.rejects(
    () => batchRead.execute("batch-1", { start: 1, limit: 20 }, undefined, undefined, subsetContext),
    /disabled for a segment-subset/,
  );

  const scopedQaFindings = Array.from({ length: 55 }, (_, index) => ({
    id: `qa-${index}`,
    type: "placeholder_mismatch",
    severity: "warning" as const,
    segmentId: "segment-1",
    source: `SAFE SOURCE ${index}`,
    target: `Safe target ${index}`,
    message: `Scoped QA finding ${index}`,
    evidence: [`source:${index}`, `target:${index}`],
  }));
  await writeJsonFile(workflowArtifactsPath(root, "project-1"), {
    sourceLabel: "Team evidence child test",
    teamRoleArtifacts: [{
      id: "workflow-2:lead_linguist_setup:strategy",
      workflowId: "workflow-2",
      roleId: "lead_linguist_setup",
      type: "strategy",
      summary: "Long nested strategy",
      data: { rules: Array.from({ length: 60 }, (_, index) => `Rule ${index}`) },
      createdAt: "2026-07-11T00:00:00.000Z",
    }],
    teamCandidateTargets: Array.from({ length: 120 }, (_, index) => ({
      id: `candidate-${index}`,
      workflowId: "workflow-2",
      roleId: "translator",
      segmentId: "segment-1",
      target: `Candidate target ${index}`,
      function: "expressive",
      notes: `Candidate note ${index}`,
      evidenceRefs: [`tm:${index}`],
    })),
    deliveryQaReports: [{
      reportId: "qa-report-1",
      projectId: "project-1",
      batchId: "batch-1",
      workflowId: "workflow-2",
      generatedAt: "2026-07-11T00:00:00.000Z",
      summary: { blockers: 0, warnings: 57, advisories: 0 },
      findings: [
        ...scopedQaFindings,
        {
          id: "qa-unscoped",
          type: "placeholder_mismatch",
          severity: "warning",
          source: "UNSCOPED SECRET SOURCE",
          target: "Unscoped secret target",
          message: "Unscoped QA finding must not enter a segment-subset Task",
          evidence: ["unscoped-secret"],
        },
        {
          id: "qa-secret",
          type: "placeholder_mismatch",
          severity: "warning",
          segmentId: "segment-secret",
          source: "DO NOT LEAK SOURCE",
          target: "Do not leak target",
          message: "Out-of-scope QA finding",
          evidence: ["secret"],
        },
      ],
    }],
  });

  const teamArtifactRead = tools.find((tool) => tool.name === "team_artifact_read")!;
  const qaPageOne = await teamArtifactRead.execute(
    "artifact-qa-1",
    { kind: "delivery_qa", segmentId: "segment-1", start: 1, limit: 50 },
    undefined,
    undefined,
    subsetContext,
  );
  const qaPageOneText = qaPageOne.content.map((part) => "text" in part ? part.text : "").join("\n");
  const qaPageOneDetails = qaPageOne.details as {
    total: number;
    returned: number;
    nextStart: number | null;
    rowPageComplete: boolean;
    contentComplete: boolean;
  };
  assert.equal(qaPageOneDetails.total, 56, "one scoped report row plus all 55 scoped findings must be pageable");
  assert.equal(qaPageOneDetails.returned, 50);
  assert.equal(qaPageOneDetails.nextStart, 51);
  assert.equal(qaPageOneDetails.rowPageComplete, false);
  assert.equal(qaPageOneDetails.contentComplete, true);
  assert.doesNotMatch(qaPageOneText, /DO NOT LEAK|UNSCOPED SECRET|qa-secret|qa-unscoped|segment-secret/);

  const qaPageTwo = await teamArtifactRead.execute(
    "artifact-qa-2",
    { kind: "delivery_qa", segmentId: "segment-1", start: qaPageOneDetails.nextStart, limit: 50 },
    undefined,
    undefined,
    subsetContext,
  );
  const qaPageTwoText = qaPageTwo.content.map((part) => "text" in part ? part.text : "").join("\n");
  const qaPageTwoDetails = qaPageTwo.details as {
    returned: number;
    nextStart: number | null;
    rowPageComplete: boolean;
    contentComplete: boolean;
  };
  assert.equal(qaPageTwoDetails.returned, 6);
  assert.equal(qaPageTwoDetails.nextStart, null);
  assert.equal(qaPageTwoDetails.rowPageComplete, true);
  assert.equal(qaPageTwoDetails.contentComplete, true);
  assert.match(`${qaPageOneText}\n${qaPageTwoText}`, /qa-0/);
  assert.match(`${qaPageOneText}\n${qaPageTwoText}`, /qa-54/);
  assert.doesNotMatch(`${qaPageOneText}\n${qaPageTwoText}`, /DO NOT LEAK|UNSCOPED SECRET|qa-secret|qa-unscoped|segment-secret/);
  await assert.rejects(
    () => teamArtifactRead.execute(
      "artifact-qa-secret",
      { kind: "delivery_qa", segmentId: "segment-secret", start: 1, limit: 20 },
      undefined,
      undefined,
      subsetContext,
    ),
    /outside the Team Task scope/,
  );

  const nestedArtifact = await teamArtifactRead.execute(
    "artifact-nested",
    { kind: "role_artifacts", start: 1, limit: 20 },
    undefined,
    undefined,
    subsetContext,
  );
  const nestedText = nestedArtifact.content.map((part) => "text" in part ? part.text : "").join("\n");
  const nestedDetails = nestedArtifact.details as {
    nextStart: number | null;
    rowPageComplete: boolean;
    contentComplete: boolean;
    truncations: Array<{ id: string; notices: string[] }>;
  };
  assert.equal(nestedDetails.nextStart, null);
  assert.equal(nestedDetails.rowPageComplete, true);
  assert.equal(nestedDetails.contentComplete, false, "null nextStart must not imply truncated nested content is complete");
  assert.equal(nestedDetails.truncations.length, 1);
  assert.match(nestedText, /Truncation: .*array truncated from 60 to 50 items/);
  assert.match(nestedText, /Content complete: no/);

  const candidatePages: string[] = [];
  let candidateStart: number | null = 1;
  let candidateTotal = 0;
  while (candidateStart !== null) {
    const page = await teamArtifactRead.execute(
      `artifact-candidates-${candidateStart}`,
      { kind: "candidates", start: candidateStart, limit: 50 },
      undefined,
      undefined,
      subsetContext,
    );
    candidatePages.push(page.content.map((part) => "text" in part ? part.text : "").join("\n"));
    const details = page.details as { total: number; returned: number; nextStart: number | null; contentComplete: boolean };
    candidateTotal += details.returned;
    candidateStart = details.nextStart;
    assert.equal(details.contentComplete, true);
  }
  assert.equal(candidateTotal, 120);
  assert.match(candidatePages.join("\n"), /candidate-0/);
  assert.match(candidatePages.join("\n"), /candidate-119/);

  const missingDir = join(dirname(prepared.sessionDir), "missing", "async-run");
  const missingFile = join(missingDir, "session.jsonl");
  await mkdir(missingDir, { recursive: true });
  await writeFile(missingFile, "", "utf8");
  await assert.rejects(() => readTeamEvidenceChildScope(root, missingFile), /no server-authored evidence scope/);

  const scopePath = join(prepared.sessionDir, "scope.json");
  const tampered = JSON.parse(await readFile(scopePath, "utf8")) as Record<string, unknown>;
  tampered.projectId = "another-project";
  await writeFile(scopePath, `${JSON.stringify(tampered)}\n`, "utf8");
  await assert.rejects(() => readTeamEvidenceChildScope(root, childSessionFile), /policy hash mismatch/);

  const outsideFile = join(root, "outside", "session.jsonl");
  await mkdir(dirname(outsideFile), { recursive: true });
  await writeFile(outsideFile, "", "utf8");
  await assert.rejects(() => readTeamEvidenceChildScope(root, outsideFile), /escaped the server-owned session root/);
} finally {
  process.chdir(originalCwd);
  if (originalCacheRoot === undefined) delete process.env.LA_RUNTIME_CACHE_ROOT;
  else process.env.LA_RUNTIME_CACHE_ROOT = originalCacheRoot;
}

const loaderRoot = await mkdtemp(join(tmpdir(), "la-team-extension-loader-"));
const resourceLoader = new DefaultResourceLoader({
  cwd: loaderRoot,
  agentDir: join(loaderRoot, "agent"),
  settingsManager: SettingsManager.create(loaderRoot, join(loaderRoot, "agent")),
  additionalExtensionPaths: [join(originalCwd, ".pi", "extensions", "team-evidence-child.ts")],
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await resourceLoader.reload();
assert.deepEqual(resourceLoader.getExtensions().errors, [], "the production Pi loader must load the Team child extension without dependency alias errors");

console.log("team evidence child runtime tests passed");
