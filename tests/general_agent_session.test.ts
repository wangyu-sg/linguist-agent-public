import { strict as assert } from "node:assert";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { confirmAssistantMemory, createTaskWorkspace, proposeAssistantMemory } from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  buildGeneralSandboxRuntimeConfig,
  createGeneralAgentSession,
  createPiAgentRuntimePort,
} from "@linguist-agent/cat-runtime";

const root = await mkdtemp(join(tmpdir(), "la-general-session-"));
const agentDir = await mkdtemp(join(tmpdir(), "la-general-agent-dir-"));

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

try {
  await createTaskWorkspace(root).create({
    owner: { kind: "standalone" },
    taskId: "chat-one",
    title: "General Chat",
    intent: "Verify the Pi-native General Core surface.",
    kind: "general",
  });
  const memoryProposal = await proposeAssistantMemory(root, {
    scope: { kind: "personal" },
    kind: "preference",
    text: "Keep answers concise.",
    source: { taskId: "older-chat" },
  });
  await confirmAssistantMemory(root, { scope: { kind: "personal" }, id: memoryProposal.id, actor: "user" });
  const privateWorkspace = join(root, "data", "assistant", "tasks", "chat-one", "workspace");
  await write(join(privateWorkspace, "AGENTS.md"), "# Chat context\nAlways preserve evidence links.\n");
  await write(join(agentDir, "skills", "fixture-skill", "SKILL.md"), [
    "---",
    "name: fixture-skill",
    "description: Fixture skill loaded from the trusted Pi agent directory.",
    "---",
    "Use this fixture only in tests.",
  ].join("\n"));
  await write(join(agentDir, "prompts", "fixture.md"), [
    "---",
    "description: Fixture prompt",
    "---",
    "Fixture prompt body.",
  ].join("\n"));
  await write(join(agentDir, "extensions", "fixture.ts"), [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(join(root, "extension-executed.txt"))}, 'executed');`,
    "export default function fixture(pi: any) {",
    "  pi.registerTool({ name: 'fixture_deferred', label: 'Fixture Deferred', description: 'Deferred fixture capability', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }) });",
    "  pi.registerCommand('fixture-command', {",
    "    description: 'Fixture command',",
    "    handler: async () => undefined,",
    "  });",
    "}",
  ].join("\n"));
  await write(join(agentDir, "extensions", "shadowed.ts"), [
    "export default function shadowed(pi: any) {",
    "  pi.registerTool({ name: 'fixture_deferred', label: 'Shadowed Fixture', description: 'Conflicting deferred capability', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [{ type: 'text', text: 'shadowed' }], details: {} }) });",
    "}",
  ].join("\n"));

  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  let executableAuthorizationCount = 0;
  const created = await createGeneralAgentSession({
    runtimeRoot: root,
    taskId: "chat-one",
    agentDir,
    modelRuntime,
    permissionContract: buildAgentPermissionContract({ mode: "ask" }),
    projectTrusted: true,
    authorizeExecutableExtensions: async () => {
      executableAuthorizationCount += 1;
    },
    delegate: async () => ({ agentThreadId: "child-1", role: "Research Agent", summary: "done" }),
  });
  try {
    assert.equal(executableAuthorizationCount, 0, "Stable General Runs must not offer approval for third-party executable Extensions");
    assert.equal(await access(join(root, "extension-executed.txt")).then(() => true, () => false), false, "Stable General Runs must not evaluate third-party Extension modules");
    assert.equal(created.access.workingDirectory, privateWorkspace);
    assert.deepEqual(created.access.grants, []);
    assert.equal(created.resources.skills.some((skill) => skill.name === "fixture-skill"), true);
    assert.equal(created.resources.prompts.some((prompt) => prompt.name === "fixture"), true);
    assert.deepEqual(created.resources.extensions, [
      { path: "<inline:1>", tools: [], commands: [] },
      { path: "<inline:2>", tools: ["capability_search"], commands: [] },
    ], "Stable General Runs load only the two LA-owned inline extension factories");
    assert.deepEqual(created.resources.conflicts, []);
    assert.match(created.resources.resourceSetHash, /^[a-f0-9]{64}$/);
    assert.equal(created.resources.contextFiles.includes(join(privateWorkspace, "AGENTS.md")), true);
    for (const tool of ["read", "grep", "find", "ls", "edit", "write", "bash", "capability_search", "assistant_memory_search", "assistant_memory_propose", "assistant_library_search", "assistant_library_list", "delegate_agent"]) {
      assert.equal(created.resources.activeToolNames.includes(tool), true, `${tool} must be active in General Core`);
    }
    assert.equal(created.session.getAllTools().some((tool) => tool.name === "fixture_deferred"), false);
    assert.equal(created.resources.activeToolNames.includes("fixture_deferred"), false, "non-core tools must remain registered but initially inactive");
    assert.doesNotMatch(created.session.systemPrompt, /Keep answers concise/, "a General Worker must not enumerate live Personal Memory without a host-selected snapshot");
    assert.match(created.session.systemPrompt, /No host-selected Confirmed Memory was attached to this Run/);
    const sandbox = buildGeneralSandboxRuntimeConfig(created.access);
    assert.deepEqual(sandbox.filesystem?.allowWrite?.includes(privateWorkspace), true);
    assert.deepEqual(sandbox.filesystem?.allowRead?.includes(privateWorkspace), true);
    assert.ok(created.runtime, "General Core must use Pi AgentSessionRuntime for branch/resume semantics");
    const originalSessionFile = created.session.sessionFile;
    const branchPoint = created.session.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Native Pi branch point" }],
      timestamp: Date.now(),
    } as never);
    created.session.sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Native Pi branch response" }],
      provider: "fixture",
      model: "fixture",
      api: "openai-responses",
      stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    } as never);
    const forked = await created.runtime.fork(branchPoint, { position: "at" });
    assert.equal(forked.cancelled, false);
    assert.notEqual(created.runtime.session.sessionFile, originalSessionFile);
    assert.equal(created.runtime.session.sessionManager.getHeader().parentSession, originalSessionFile);
    assert.equal(executableAuthorizationCount, 0);
    await write(join(agentDir, "skills", "fixture-skill", "SKILL.md"), "---\nname: fixture-skill\ndescription: Changed\n---\nChanged.\n");
    await assert.rejects(
      created.runtime.newSession(),
      /resource changed after the Run snapshot was fixed/i,
    );
  } finally {
    if (created.runtime) await created.runtime.dispose();
    else created.session.dispose();
  }

  const child = await createGeneralAgentSession({
    runtimeRoot: root,
    taskId: "chat-one",
    agentDir,
    modelRuntime,
    permissionContract: buildAgentPermissionContract({
      mode: "custom",
      customRules: { fileRead: "auto", fileWrite: "deny", webRead: "deny", bash: "deny", bridge: "deny" },
    }),
    sessionIdSuffix: "delegated-child",
    readOnlyChild: true,
    projectTrusted: false,
  });
  try {
    for (const tool of ["read", "grep", "find", "ls", "assistant_memory_search", "assistant_library_search", "assistant_library_list"]) {
      assert.equal(child.resources.activeToolNames.includes(tool), true, `${tool} must be active for a read-only child`);
    }
    for (const tool of ["edit", "write", "bash", "capability_search", "assistant_memory_propose", "delegate_agent", "fixture_deferred"]) {
      assert.equal(child.resources.activeToolNames.includes(tool), false, `${tool} must not be active for a read-only child`);
    }
    assert.equal(child.resources.extensions.some((extension) => extension.path.endsWith("fixture.ts")), false);
    assert.equal(child.resources.contextFiles.includes(join(privateWorkspace, "AGENTS.md")), false, "untrusted working-directory context must not load into a child");
    assert.match(child.session.systemPrompt, /delegated child Agent/);
  } finally {
    if (child.runtime) await child.runtime.dispose();
    else child.session.dispose();
  }

  const runtimePort = createPiAgentRuntimePort({ modelRuntime: async () => modelRuntime });
  assert.equal(await runtimePort.supportsInput("fixture", "missing", "image"), false);
  const adapted = await runtimePort.createGeneralSession({
    runtimeRoot: root,
    taskId: "chat-one",
    agentDir,
    permissionContract: buildAgentPermissionContract({ mode: "ask" }),
    projectTrusted: true,
  });
  try {
    assert.equal(adapted.access.workingDirectory, privateWorkspace);
    assert.equal(adapted.resources.activeToolNames.includes("read"), true);
    assert.match(adapted.resources.resourceSetHash, /^[a-f0-9]{64}$/u);
    assert.equal(adapted.session.sessionId.length > 0, true);
    assert.equal(adapted.session.sessionFile?.endsWith(".jsonl"), true);
    assert.equal(typeof adapted.fork, "function", "Pi adapter preserves native branch capability behind the port");
  } finally {
    await adapted.dispose();
  }

  console.log("general Agent session tests passed");
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(agentDir, { recursive: true, force: true }),
  ]);
}
