import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createStandaloneFileGrant, createTaskWorkspace } from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  createGeneralAgentSession,
  prepareGeneralAgentSessionPlan,
  resolveGeneralSessionPlanAccess,
} from "@linguist-agent/cat-runtime";

const root = await mkdtemp(join(tmpdir(), "la-general-plan-"));
const agentDir = await mkdtemp(join(tmpdir(), "la-general-plan-agent-"));

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

try {
  await createTaskWorkspace(root).create({
    owner: { kind: "standalone" },
    taskId: "plan-chat",
    title: "Plan Chat",
    intent: "Freeze a General worker preparation plan.",
    kind: "general",
  });
  const skillPath = join(agentDir, "skills", "fixture", "SKILL.md");
  await write(skillPath, [
    "---",
    "name: fixture",
    "description: Prepared skill",
    "---",
    "Use prepared evidence.",
  ].join("\n"));
  await write(join(agentDir, "extensions", "must-not-run.ts"), [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(join(root, "extension-ran.txt"))}, 'bad');`,
    "export default function extension() {}",
  ].join("\n"));

  const input = {
    runtimeRoot: root,
    taskId: "plan-chat",
    runId: "run-plan",
    rootAgentThreadId: "run-plan.main",
    agentDir,
    projectTrusted: true,
    permissionContract: buildAgentPermissionContract({ mode: "ask" as const }),
    modelProvider: "fixture",
    modelId: "fixture-model",
    thinkingLevel: "high" as const,
    contextHandoffs: ["Accepted handoff"],
    delegationEnabled: true,
    managedResources: { extensions: [], skills: [], prompts: [], themes: [] },
  };
  const first = await prepareGeneralAgentSessionPlan(input);
  const second = await prepareGeneralAgentSessionPlan(input);
  assert.deepEqual(second, first, "the same reviewed inputs must produce the same serialized plan");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "the preparation plan must cross a process boundary without hidden values");
  assert.equal(first.schemaVersion, 1);
  assert.match(first.planHash, /^[a-f0-9]{64}$/u);
  assert.match(first.promptInputHash, /^[a-f0-9]{64}$/u);
  assert.match(first.toolManifestHash, /^[a-f0-9]{64}$/u);
  assert.match(first.resourceSnapshotHash, /^[a-f0-9]{64}$/u);
  assert.match(first.capabilityGrantHash, /^[a-f0-9]{64}$/u);
  assert.match(first.contextInputHash, /^[a-f0-9]{64}$/u);
  assert.equal(first.resourceSnapshot.entries.some((entry) => entry.type === "extension"), false);
  assert.equal(await access(join(root, "extension-ran.txt")).then(() => true, () => false), false);
  assert.equal(first.initialActiveToolNames.includes("delegate_agent"), true);
  assert.equal(first.registeredToolNames.includes("document_extract_evidence"), true);
  assert.equal(first.registeredToolNames.includes("agent_plan_update"), true, "the plan tool is registered for Run-backed sessions");
  assert.equal(first.initialActiveToolNames.includes("agent_plan_update"), false, "the plan tool activates explicitly via capability_search");
  const withHostMemory = await prepareGeneralAgentSessionPlan({
    ...input,
    confirmedMemory: "Explicitly confirmed memory (recall context only; never citable project evidence):\n- [preference] Host-selected snapshot. (scope: personal, source task: chat, memory: memory_snapshot, revision: 2, validity: from 2026-07-23T00:00:00.000Z; no expiry, selection: scope:personal; retrieval:lexical; semantic:lexical-only)",
  });
  assert.match(withHostMemory.confirmedMemory, /Host-selected snapshot/);
  assert.notEqual(withHostMemory.planHash, first.planHash, "the immutable host-selected memory snapshot must be part of the attested Run plan");

  const lateGrantRoot = join(root, "late-grant");
  await mkdir(lateGrantRoot, { recursive: true });
  await createStandaloneFileGrant(root, {
    taskId: "plan-chat",
    path: lateGrantRoot,
    kind: "directory",
    access: "read",
  });
  const narrowedAccess = await resolveGeneralSessionPlanAccess(first);
  assert.deepEqual(narrowedAccess.grants, [], "a grant added after preflight must not expand the active Plan");

  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  await assert.rejects(
    () => createGeneralAgentSession({
      ...input,
      modelRuntime,
      preparedPlan: first,
      thinkingLevel: "low",
      delegate: async () => ({ agentThreadId: "child", role: "Research Agent", summary: "done" }),
    }),
    /does not match the requested session identity or capabilities/,
  );
  const created = await createGeneralAgentSession({
    ...input,
    modelRuntime,
    preparedPlan: first,
    delegate: async () => ({ agentThreadId: "child", role: "Research Agent", summary: "done" }),
  });
  try {
    assert.deepEqual(created.resources.activeToolNames, first.initialActiveToolNames);
    assert.equal(created.resources.resourceSetHash, first.resourceSnapshotHash);
  } finally {
    if (created.runtime) await created.runtime.dispose();
    else created.session.dispose();
  }

  await write(skillPath, "---\nname: fixture\ndescription: changed\n---\nChanged.\n");
  await assert.rejects(
    () => createGeneralAgentSession({
      ...input,
      modelRuntime,
      preparedPlan: first,
      delegate: async () => ({ agentThreadId: "child", role: "Research Agent", summary: "done" }),
    }),
    /Pi resource changed after the Run snapshot was fixed/,
  );

  process.stdout.write("general session preparation plan tests passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
}
