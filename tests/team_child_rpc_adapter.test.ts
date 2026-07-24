import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { defaultSubagentAsyncRoot, TEAM_EVIDENCE_TOOL_NAMES } from "@linguist-agent/cat-data";
import { prepareTeamEvidenceChildScope, TEAM_EVIDENCE_CHILD_CONSTITUTION } from "@linguist-agent/cat-runtime";
import {
  resolveTeamChildPackageExecution,
  startTeamChildRpcRun,
} from "../packages/cat-server/src/team_child_rpc_adapter.js";
import { startWorkflowTeamChildRpc } from "../packages/cat-server/src/workflow_team_child_rpc.js";

const root = await mkdtemp(join(tmpdir(), "la-team-child-rpc-"));
const runId = `la-rpc-${Date.now()}`;
const asyncDir = join(defaultSubagentAsyncRoot(), runId);
const createdAsyncDirs = [asyncDir];

try {
  const standardExtension = join(root, "standard-ui.ts");
  await writeFile(standardExtension, [
    "export default function extension(pi) {",
    "  pi.on('session_start', async (_event, ctx) => {",
    "    await ctx.ui.confirm('Continue?', 'Use the approved glossary?');",
    "  });",
    "}",
  ].join("\n"), "utf8");
  const unsupportedExtension = join(root, "custom-ui.ts");
  await writeFile(unsupportedExtension, "export default (_pi) => ctx.ui.custom(() => undefined);\n", "utf8");

  const baseResource = {
    packageSource: "npm:example-package@1.2.3",
    resourceType: "extension" as const,
    resourceId: "standard-ui.ts",
    path: standardExtension,
    version: "1.2.3",
    integrity: `sha256-${createHash("sha256").update(await readFile(standardExtension)).digest("base64")}`,
    packageName: "example-package",
    enabledByPi: true,
    executable: true,
    origin: "package" as const,
    scope: "global" as const,
  };
  const standard = await resolveTeamChildPackageExecution([baseResource]);
  assert.equal(standard.mode, "blocked");
  assert.match(standard.blockers.join("\n"), /Stable Team Runs do not load third-party executable Package Extensions/);
  assert.equal(standard.provenance, undefined);

  const unsupported = await resolveTeamChildPackageExecution([{
    ...baseResource,
    path: unsupportedExtension,
    resourceId: "custom-ui.ts",
    integrity: `sha256-${createHash("sha256").update(await readFile(unsupportedExtension)).digest("base64")}`,
  }]);
  assert.equal(unsupported.mode, "blocked");
  assert.match(unsupported.blockers.join("\n"), /Stable Team Runs do not load third-party executable Package Extensions/);

  const ambiguous = await resolveTeamChildPackageExecution([
    baseResource,
    { ...baseResource, packageSource: "npm:another@1.0.0", packageName: "another", resourceId: "another.ts" },
  ]);
  assert.equal(ambiguous.mode, "blocked");
  assert.match(ambiguous.blockers.join("\n"), /Stable Team Runs do not load third-party executable Package Extensions/);

  const noExtension = await resolveTeamChildPackageExecution([{ ...baseResource, resourceType: "skill", executable: false }]);
  assert.equal(noExtension.mode, "pi_rpc_v1");
  assert.equal(noExtension.provenance, undefined);

  const noResources = await resolveTeamChildPackageExecution([]);
  assert.equal(noResources.mode, "pi_subagents");

  const changedSkillPath = join(root, "changed-skill.md");
  await writeFile(changedSkillPath, "# Approved skill\n", "utf8");
  const changedSkill = {
    ...baseResource,
    resourceType: "skill" as const,
    resourceId: "changed-skill.md",
    path: changedSkillPath,
    executable: false,
    integrity: `sha256-${createHash("sha256").update(await readFile(changedSkillPath)).digest("base64")}`,
  };
  await writeFile(changedSkillPath, "# Mutated after selection\n", "utf8");
  const changedSkillExecution = await resolveTeamChildPackageExecution([changedSkill]);
  assert.equal(changedSkillExecution.mode, "blocked");
  assert.match(changedSkillExecution.blockers.join("\n"), /resource bytes changed after selection/i);

  const responseLog = join(root, "response.json");
  const argsLog = join(root, "args.json");
  const fakePi = join(root, "fake-pi");
  await writeFile(fakePi, `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const output = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
if (process.env.FAKE_ARGS_LOG) fs.writeFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(process.argv.slice(2)));
rl.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "prompt") {
    if (process.env.FAKE_MODE === "timeout") return;
    output({ type: "response", id: command.id, command: "prompt", success: true });
    if (process.env.FAKE_MODE === "hold") return;
    if (process.env.FAKE_MODE === "unknown-ui") {
      output({ type: "extension_ui_request", id: "ui-unknown-1", method: "custom_widget" });
      return;
    }
    if (process.env.FAKE_MODE === "extension-error") {
      output({ type: "extension_error", extensionPath: "/package/extension.ts", event: "session_start", error: "fixture failure" });
      return;
    }
    output({ type: "extension_ui_request", id: "ui-confirm-1", method: "confirm", title: "Continue?", message: "Use the approved glossary?" });
    return;
  }
  if (command.type === "extension_ui_response" && command.id === "ui-confirm-1") {
    fs.writeFileSync(process.env.FAKE_UI_RESPONSE_LOG, JSON.stringify(command));
    output({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "{\\\"roleId\\\":\\\"producer\\\",\\\"summary\\\":\\\"Done.\\\",\\\"brief\\\":{\\\"projectGoal\\\":\\\"Ship.\\\",\\\"scope\\\":[],\\\"knownAssets\\\":[],\\\"missingInputs\\\":[],\\\"risks\\\":[],\\\"handoffNotes\\\":[]},\\\"findings\\\":[],\\\"queries\\\":[]}" }] } });
    output({ type: "agent_settled" });
    return;
  }
  if (command.id) output({ type: "response", id: command.id, command: command.type, success: true });
});
`, "utf8");
  await chmod(fakePi, 0o755);

  const seen: string[] = [];
  const uiContext = {
    confirm: async (title: string, message: string) => {
      seen.push(`${title}\n${message}`);
      return true;
    },
  } as ExtensionUIContext;
  const handle = await startTeamChildRpcRun({
    verifiedPiBinaryPath: fakePi,
    cwd: root,
    cliArgs: [],
    env: { ...process.env, FAKE_UI_RESPONSE_LOG: responseLog, FAKE_ARGS_LOG: argsLog },
    prompt: "Run the Producer role.",
    runId,
    agent: "la-team-producer",
    model: "example/model",
    asyncDir,
    uiContext,
  });
  const completed = await handle.completion;
  assert.equal(completed.state, "complete");
  assert.deepEqual(seen, ["Continue?\nUse the approved glossary?"]);
  assert.deepEqual(JSON.parse(await readFile(responseLog, "utf8")), {
    type: "extension_ui_response",
    id: "ui-confirm-1",
    confirmed: true,
  });
  assert.match(await readFile(completed.outputFile, "utf8"), /"roleId":"producer"/);
  const status = JSON.parse(await readFile(join(asyncDir, "status.json"), "utf8")) as Record<string, unknown>;
  assert.equal(status.state, "complete");
  assert.equal(status.runId, runId);
  assert.equal(status.outputFile, completed.outputFile);
  assert.deepEqual(JSON.parse(await readFile(argsLog, "utf8")), ["--mode", "rpc"]);

  for (const [mode, expected] of [
    ["unknown-ui", /unsupported Extension UI method/],
    ["extension-error", /Extension failed.*fixture failure/],
    ["timeout", /Timed out waiting for Pi RPC child command prompt/],
  ] as const) {
    const failureRunId = `la-rpc-${mode}-${Date.now()}`;
    const failureAsyncDir = join(defaultSubagentAsyncRoot(), failureRunId);
    createdAsyncDirs.push(failureAsyncDir);
    const failureHandle = await startTeamChildRpcRun({
      verifiedPiBinaryPath: fakePi,
      cwd: root,
      cliArgs: [],
      env: { ...process.env, FAKE_MODE: mode },
      prompt: "Exercise fail-closed transport behavior.",
      runId: failureRunId,
      agent: "la-team-producer",
      asyncDir: failureAsyncDir,
      uiContext,
      commandTimeoutMs: mode === "timeout" ? 100 : 1_000,
    });
    const failure = await failureHandle.completion;
    assert.equal(failure.state, "failed");
    assert.match(failure.error ?? "", expected);
  }

  const spawnFailureRunId = `la-rpc-spawn-failure-${Date.now()}`;
  const spawnFailureAsyncDir = join(defaultSubagentAsyncRoot(), spawnFailureRunId);
  createdAsyncDirs.push(spawnFailureAsyncDir);
  const spawnFailureHandle = await startTeamChildRpcRun({
    verifiedPiBinaryPath: join(root, "missing-pi"),
    cwd: root,
    cliArgs: [],
    prompt: "Exercise spawn failure handling.",
    runId: spawnFailureRunId,
    agent: "la-team-producer",
    asyncDir: spawnFailureAsyncDir,
    uiContext,
    commandTimeoutMs: 1_000,
  });
  const spawnFailure = await spawnFailureHandle.completion;
  assert.equal(spawnFailure.state, "failed");
  assert.match(spawnFailure.error ?? "", /failed to start|ENOENT/i);

  const stoppedRunId = `la-rpc-stopped-${Date.now()}`;
  const stoppedAsyncDir = join(defaultSubagentAsyncRoot(), stoppedRunId);
  createdAsyncDirs.push(stoppedAsyncDir);
  const stoppedHandle = await startTeamChildRpcRun({
    verifiedPiBinaryPath: fakePi,
    cwd: root,
    cliArgs: [],
    env: { ...process.env, FAKE_MODE: "hold" },
    prompt: "Wait until canonical Stop.",
    runId: stoppedRunId,
    agent: "la-team-producer",
    asyncDir: stoppedAsyncDir,
    uiContext,
  });
  await stoppedHandle.stop();
  const stopped = await stoppedHandle.completion;
  assert.equal(stopped.state, "failed");
  assert.match(stopped.error ?? "", /was stopped/);

  const agentDir = join(root, ".pi", "agents");
  const extensionDir = join(root, ".pi", "extensions");
  await mkdir(agentDir, { recursive: true });
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, "team-evidence-child.ts"), "export default function evidence() {}\n", "utf8");
  await writeFile(join(agentDir, "la-team-producer.md"), `---
name: la-team-producer
description: Test Producer
tools: ${TEAM_EVIDENCE_TOOL_NAMES.join(", ")}
extensions:
subagentOnlyExtensions: .pi/extensions/team-evidence-child.ts
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
defaultContext: fresh
completionGuard: false
---

You are the Producer. Return only the role JSON.
`, "utf8");
  const skillPath = join(root, "package-skill.md");
  const promptPath = join(root, "package-prompt.md");
  await writeFile(skillPath, "# Package skill\n", "utf8");
  await writeFile(promptPath, "# Package prompt\n", "utf8");
  const skillResource = {
    ...baseResource,
    resourceType: "skill" as const,
    resourceId: "package-skill.md",
    path: skillPath,
    executable: false,
    integrity: `sha256-${createHash("sha256").update(await readFile(skillPath)).digest("base64")}`,
  };
  const promptResource = {
    ...baseResource,
    resourceType: "prompt" as const,
    resourceId: "package-prompt.md",
    path: promptPath,
    executable: false,
    integrity: `sha256-${createHash("sha256").update(await readFile(promptPath)).digest("base64")}`,
  };
  const scoped = await prepareTeamEvidenceChildScope({
    repoRoot: root,
    projectId: "project-one",
    workflowId: "workflow-one",
    roleId: "producer",
    allowedTools: ["batch_read"],
  });
  process.env.FAKE_UI_RESPONSE_LOG = responseLog;
  process.env.FAKE_ARGS_LOG = argsLog;
  await assert.rejects(startWorkflowTeamChildRpc({
    repoRoot: root,
    roleId: "producer",
    workflowId: "workflow-one",
    request: {
      protocol: "pi-subagents-rpc-v1",
      method: "spawn",
      params: {
        agent: "la-team-producer",
        task: "Run the Producer role.",
        context: "fresh",
        agentScope: "project",
        async: true,
        clarify: false,
        artifacts: true,
        acceptance: { level: "none", reason: "Typed output validation." },
        output: "data/team-role-outputs/test.json",
        outputMode: "file-only",
        sessionDir: scoped.sessionDir,
        model: "example/model",
      },
    },
    taskPackageResources: {
      profileRevision: 1,
      profileHash: "sha256-profile",
      selections: [],
      resolvedResources: [baseResource, skillResource, promptResource],
      isolatedResources: {
        extensionPaths: [standardExtension],
        skillPaths: [skillPath],
        promptTemplatePaths: [promptPath],
      },
      packages: [],
    },
    verifiedPiBinaryPath: fakePi,
    uiContext,
  }), /Stable Team Runs do not load third-party executable Package Extensions/);

  const workflowHandle = await startWorkflowTeamChildRpc({
    repoRoot: root,
    roleId: "producer",
    workflowId: "workflow-one",
    request: {
      protocol: "pi-subagents-rpc-v1",
      method: "spawn",
      params: {
        agent: "la-team-producer",
        task: "Run the Producer role.",
        context: "fresh",
        agentScope: "project",
        async: true,
        clarify: false,
        artifacts: true,
        acceptance: { level: "none", reason: "Typed output validation." },
        output: "data/team-role-outputs/test.json",
        outputMode: "file-only",
        sessionDir: scoped.sessionDir,
        model: "example/model",
      },
    },
    taskPackageResources: {
      profileRevision: 1,
      profileHash: "sha256-profile",
      selections: [],
      resolvedResources: [skillResource, promptResource],
      isolatedResources: {
        extensionPaths: [],
        skillPaths: [skillPath],
        promptTemplatePaths: [promptPath],
      },
      packages: [],
    },
    verifiedPiBinaryPath: fakePi,
    uiContext,
  });
  createdAsyncDirs.push(workflowHandle.asyncDir);
  assert.equal((await workflowHandle.completion).state, "complete");
  const workflowArgs = JSON.parse(await readFile(argsLog, "utf8")) as string[];
  assert.deepEqual(workflowArgs.slice(0, 2), ["--mode", "rpc"]);
  assert.equal(workflowArgs.includes("--no-context-files"), true);
  assert.equal(workflowArgs.includes(join(extensionDir, "team-evidence-child.ts")), true);
  assert.equal(workflowArgs.includes(standardExtension), false);
  assert.equal(workflowArgs.includes(skillPath), true);
  assert.equal(workflowArgs.includes(promptPath), true);
  const systemPromptIndex = workflowArgs.indexOf("--system-prompt");
  assert.ok(systemPromptIndex >= 0);
  const systemPrompt = await readFile(workflowArgs[systemPromptIndex + 1]!, "utf8");
  assert.match(systemPrompt, /You are the Producer/);
  assert.equal(systemPrompt.includes(TEAM_EVIDENCE_CHILD_CONSTITUTION), false, "the evidence Extension appends the constitution exactly once at runtime");
} finally {
  delete process.env.FAKE_UI_RESPONSE_LOG;
  delete process.env.FAKE_ARGS_LOG;
  await rm(root, { recursive: true, force: true });
  await Promise.all(createdAsyncDirs.map((path) => rm(path, { recursive: true, force: true })));
}

console.log("Team child Pi RPC adapter tests passed");
