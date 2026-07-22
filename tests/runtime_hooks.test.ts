import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentPermissionContract,
  buildCatAgentTurnContext,
  buildCatCompactionInstructionsForWorkspace,
  extractCatRuntimeValidation,
  normalizeAndGuardCatToolCall,
  registerCatRuntimeHooks,
  validateCatToolResult,
} from "@linguist-agent/cat-runtime";
import { createWorkspace, upsertPhraseQaRow, upsertPlatformBackfillRow, upsertWorkflowAuthorityEvidence, workspacePath } from "@linguist-agent/cat-data";

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-runtime-hooks-test-"));
const customerRoot = join(workspaceRoot, "customer");
const workspace = createWorkspace(workspaceRoot, "proj");
await mkdir(workspacePath(workspace), { recursive: true });
await mkdir(customerRoot, { recursive: true });
const customerDocument = join(customerRoot, "terms.xlsx");
const outsideDocument = join(workspaceRoot, "outside.pdf");
await writeFile(customerDocument, "terms", "utf8");
await writeFile(outsideDocument, "private", "utf8");
await symlink(workspaceRoot, join(customerRoot, "escape"), "dir");
await writeFile(
  workspacePath(workspace, "project.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      projectId: "proj",
      root: customerRoot,
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
      scan: { root: customerRoot, assets: [], phraseTagPairs: [], importPlan: [], suggestedActions: [], warnings: [], questions: [] },
      assetRoleDecisions: [{ relPath: "terms.xlsx", role: "glossary", confidence: 90, status: "confirmed", reasons: ["test"] }],
      phraseTagPairs: [],
      importPlan: [],
      warnings: [],
      questions: ["Confirm if OS terms are authoritative."],
    },
    null,
    2,
  ),
  "utf8",
);
await mkdir(workspacePath(workspace, "batches", "b1"), { recursive: true });
await writeFile(
  workspacePath(workspace, "batches", "b1", "batch.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      format: "phrase_mxliff",
      projectId: "proj",
      batchId: "b1",
      sourceFile: "b1.mxliff",
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
      tagReport: {
        totalSegments: 2,
        placeholderSegments: 0,
        masterMatchedSegments: 2,
        masterUnmatchedSegments: 0,
        replacedPlaceholders: 0,
        unresolvedPlaceholders: 0,
        tagCountMismatches: 0,
      },
      duplicateSourceGroups: [],
      segments: [
        { index: 1, id: "s1", source: "勇者徽记", target: "Hero Emblem", rawSource: "勇者徽记", rawTarget: "Hero Emblem", locked: false, status: "confirmed", duplicateKey: "勇者徽记", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
        { index: 2, id: "s2", source: "法师宝石", target: "", rawSource: "法师宝石", rawTarget: "", locked: true, status: "new", duplicateKey: "法师宝石", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
      ],
    },
    null,
    2,
  ),
  "utf8",
);
await upsertPhraseQaRow(workspaceRoot, "proj", {
  id: "qa-open",
  segmentId: "s1",
  category: "placeholder",
  message: "Placeholder risk needs review.",
  disposition: "unresolved",
  finalIgnoreState: "not_ignored",
  evidence: "Phrase QA row captured after load-more completion.",
});
await upsertPlatformBackfillRow(workspaceRoot, "proj", {
  id: "bf-blocked",
  segmentId: "s1",
  batch: "b1",
  state: "blocked",
  decision: "uncertain",
  localProposal: "Hero Emblem",
  phraseEvidence: "Current target mismatch before write.",
  readbackState: "blocked before write",
});
await upsertWorkflowAuthorityEvidence(workspaceRoot, "proj", {
  id: "auth-style-s1",
  decisionKey: "s1",
  segmentId: "s1",
  tier: "style_guide",
  label: "Style Guide",
  target: "Hero Emblem",
  evidenceSource: "style_guide",
});

const context = await buildCatAgentTurnContext(workspace);
assert.match(context, /project_id: proj/);
assert.match(context, new RegExp(`project_root: ${customerRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
assert.match(context, /project_default_language_pair: unspecified -> unspecified/);
assert.match(context, /confirmed_asset_roles: showing 1\/1: terms\.xlsx=glossary/);
assert.match(context, /b1: phrase_mxliff, 2 seg, 1 confirmed, 0 draft, 1 new, 1 locked/);
assert.match(context, /tool_trace is audit data, not evidence/);
assert.match(context, /project memory is recall context, not citable CAT evidence/);
assert.match(context, /CAT-critical compaction reinjection:/);
assert.doesNotMatch(context, /workflow_reports:/);
assert.match(context, /pending_phrase_qa: unresolved=1/);
assert.match(context, /pending_backfill: blocked=1/);
assert.match(context, /platform_checks: blocked=0/);
assert.match(context, /risk_queue:/);
assert.match(context, /authority_decisions:/);

const compactionInstructions = await buildCatCompactionInstructionsForWorkspace(workspace, "Keep current reviewer role.");
assert.match(compactionInstructions, /Create a CAT-aware Linguist Agent session summary/);
assert.match(compactionInstructions, /b1: phrase_mxliff, 2 segments, 1 confirmed, 0 draft, 1 new, 1 locked/);
assert.match(compactionInstructions, /CAT-critical compaction reinjection:/);
assert.match(compactionInstructions, /User compaction note:\nKeep current reviewer role/);

const missingWorkspace = createWorkspace(workspaceRoot, "missing-project");
const fallbackContext = await buildCatAgentTurnContext(missingWorkspace);
assert.match(fallbackContext, /context_warning:/);
assert.match(fallbackContext, /CAT-critical compaction reinjection:/);
assert.doesNotMatch(fallbackContext, /workflow_reports:/);

const input: Record<string, unknown> = {
  project_id: "proj",
  batch_id: "b1",
  segment_id: "s1",
  target: "Gem",
  reason: "Terminology update",
  change_type: "term",
};
const blocked = normalizeAndGuardCatToolCall({ toolName: "segment_set_target", input });
assert.equal(blocked?.block, true);
assert.match(blocked?.reason ?? "", /evidence gate blocked segment_set_target/);
assert.equal(input.projectId, "proj");
assert.equal(input.batchId, "b1");
assert.equal(input.changeType, "term");

const safeInput: Record<string, unknown> = {
  project_id: "proj",
  batch_id: "b1",
  segment_id: "s1",
  target: "Gem",
  reason: "Terminology update",
  change_type: "term",
  evidence_sources: ["termbase:Gem"],
};
assert.equal(normalizeAndGuardCatToolCall({ toolName: "segment_set_target", input: safeInput })?.block, undefined);
assert.deepEqual(safeInput.evidenceSources, ["termbase:Gem"]);

const emptyResult = validateCatToolResult({
  toolName: "tm_lookup",
  content: [{ type: "text", text: "   " }],
  details: { source: "test" },
  isError: false,
});
assert.equal(emptyResult?.isError, true);
assert.match(emptyResult?.content?.[0]?.text ?? "", /empty textual result/);
assert.equal((emptyResult?.details as { catRuntimeValidation?: { errors: string[] } }).catRuntimeValidation?.errors.length, 1);
assert.deepEqual(extractCatRuntimeValidation(emptyResult)?.errors, ["tm_lookup returned an empty textual result"]);

const goodResult = validateCatToolResult({
  toolName: "segment_set_target",
  content: [{ type: "text", text: "updated" }],
  details: {},
  isError: false,
});
assert.equal(goodResult?.isError, undefined);
assert.equal((goodResult?.details as { catRuntimeValidation?: { warnings: string[] } }).catRuntimeValidation?.warnings.length, 1);
assert.deepEqual(extractCatRuntimeValidation(goodResult)?.warnings, ["segment_set_target mutated project state"]);

// --- Integration: the permission contract runs through the SAME registered tool_call
// hook as the CAT hard gates, and CAT gates win regardless of permission mode. ---
type HookResult = { block?: boolean; reason?: string } | undefined;
type HookFn = (event: { toolName: string; input: Record<string, unknown> }) => HookResult | Promise<HookResult>;
type RegisteredHook = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function captureRuntimeHooks(contract: ReturnType<typeof buildAgentPermissionContract>, requestDecision?: (request: unknown) => Promise<{ decision: "approve" | "deny"; reason?: string }>): Record<string, RegisteredHook> {
  const handlers: Record<string, RegisteredHook> = {};
  const fakePi = {
    registerCommand: () => {},
    on: (eventName: string, handler: RegisteredHook) => {
      handlers[eventName] = handler;
    },
  } as unknown as Parameters<typeof registerCatRuntimeHooks>[0];
  registerCatRuntimeHooks(fakePi, workspace, {
    contract,
    sessionId: () => "integration-session",
    requestDecision: requestDecision as never,
  });
  return handlers;
}

function captureToolCallHook(contract: ReturnType<typeof buildAgentPermissionContract>, requestDecision?: (request: unknown) => Promise<{ decision: "approve" | "deny"; reason?: string }>): HookFn {
  const handlers = captureRuntimeHooks(contract, requestDecision);
  const toolCallHook = handlers["tool_call"];
  assert.equal(typeof toolCallHook, "function");
  return toolCallHook as HookFn;
}

const compactionHooks = captureRuntimeHooks(buildAgentPermissionContract({ mode: "full" }));
assert.equal(typeof compactionHooks["session_before_compact"], "function");
assert.equal(typeof compactionHooks["session_compact"], "function");
const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
const fakeCompactionContext = {
  ui: {
    setStatus: (key: string, text: string | undefined) => statusUpdates.push({ key, text }),
  },
};
await compactionHooks["session_before_compact"](
  { type: "session_before_compact", reason: "overflow", willRetry: true },
  fakeCompactionContext,
);
assert.deepEqual(statusUpdates.at(-1), { key: "la-cat-compaction", text: "CAT compaction: overflow; retry pending" });
await compactionHooks["session_compact"](
  { type: "session_compact", reason: "overflow", willRetry: true, compactionEntry: { id: "compact-1" } },
  fakeCompactionContext,
);
assert.deepEqual(statusUpdates.at(-1), { key: "la-cat-compaction", text: undefined });

// Full-access mode: an unevidenced term change is STILL blocked by the CAT evidence gate,
// because the hook runs the hard guard before ever consulting the permission policy.
const fullHook = captureToolCallHook(buildAgentPermissionContract({ mode: "full" }));
const fullModeTermChange = await fullHook({
  toolName: "segment_set_target",
  input: { project_id: "proj", batch_id: "b1", segment_id: "s1", target: "Gemstone", reason: "Terminology update", change_type: "term" },
});
assert.equal(fullModeTermChange?.block, true);
assert.match(fullModeTermChange?.reason ?? "", /evidence gate blocked segment_set_target/);

// Same full-access hook: a generic bash call is auto-approved (no block). This proves the
// block above is the CAT gate, not a blanket denial — the permission layer is permissive here.
const fullModeBash = await fullHook({ toolName: "bash", input: { command: "pwd" } });
assert.equal(fullModeBash?.block ?? false, false);

const projectDocumentRead = await fullHook({ toolName: "document_parse", input: { path: customerDocument } });
assert.equal(projectDocumentRead, undefined);
const canonicalDocumentRead = await fullHook({
  toolName: "document_search",
  input: { path: workspacePath(workspace, "project.json"), phrase: "projectId" },
});
assert.equal(canonicalDocumentRead, undefined);
const outsideDocumentRead = await fullHook({ toolName: "document_screenshot", input: { path: outsideDocument } });
assert.equal(outsideDocumentRead?.block, true);
assert.match(outsideDocumentRead?.reason ?? "", /outside the current Project scope/i);
const escapedDocumentRead = await fullHook({
  toolName: "document_parse",
  input: { path: join(customerRoot, "escape", "outside.pdf") },
});
assert.equal(escapedDocumentRead?.block, true);
assert.match(escapedDocumentRead?.reason ?? "", /outside the current Project scope/i);
const deniedDocumentReadHook = captureToolCallHook(
  buildAgentPermissionContract({ mode: "custom", customRules: { fileRead: "deny" } }),
);
const deniedDocumentRead = await deniedDocumentReadHook({ toolName: "document_parse", input: { path: customerDocument } });
assert.equal(deniedDocumentRead?.block, true);
assert.match(deniedDocumentRead?.reason ?? "", /permission policy denied fileRead/i);

const deniedBridgeContract = buildAgentPermissionContract({ mode: "custom", customRules: { bridge: "deny" } });
const askUserHook = captureToolCallHook(
  deniedBridgeContract,
  async () => assert.fail("ask_user must use the canonical Decision interaction without Agent Autonomy approval"),
);
assert.equal(await askUserHook({ toolName: "ask_user", input: { title: "Scope", questions: [] } }), undefined);
assert.equal(
  await askUserHook({ toolName: "prepare_team_execution", input: { reason: "Use one bounded Specialist." } }),
  undefined,
  "server-owned Team preparation must reach its canonical Task Decision without a duplicate permission prompt",
);

for (const toolName of ["subagent", "wait"]) {
  const result = await fullHook({ toolName, input: toolName === "subagent" ? { agent: "worker", task: "translate" } : {} });
  assert.equal(result?.block, true);
  assert.match(result?.reason ?? "", /canonical Task Run\/Agent lifecycle/i);
}

// Credential paths are a hard rail, not an autonomy preference. Full access therefore cannot
// expose provider auth files or invoke the macOS Keychain CLI through inherited Pi tools.
const fullModeCredentialRead = await fullHook({ toolName: "read", input: { path: "~/.pi/agent/auth.json" } });
assert.equal(fullModeCredentialRead?.block, true);
assert.match(fullModeCredentialRead?.reason ?? "", /protected credential path/);
const fullModeKeychainBash = await fullHook({ toolName: "bash", input: { command: "/usr/bin/security find-generic-password -s test" } });
assert.equal(fullModeKeychainBash?.block, true);
assert.match(fullModeKeychainBash?.reason ?? "", /Keychain access/);

// Ask mode through the same registered hook: a denied approval on bash surfaces as a block,
// confirming the permission layer is actually reachable along the real tool_call path.
const askHook = captureToolCallHook(buildAgentPermissionContract({ mode: "ask" }), async () => ({ decision: "deny", reason: "integration denial" }));
const askModeBashDenied = await askHook({ toolName: "bash", input: { command: "rm -rf scratch" } });
assert.equal(askModeBashDenied?.block, true);
assert.match(askModeBashDenied?.reason ?? "", /integration denial/);

console.log("runtime_hooks tests passed");
