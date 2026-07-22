import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  readTeamEvidenceChildScope,
  readCanonicalTeamRoleSystemPrompt,
} from "@linguist-agent/cat-runtime";
import {
  teamRoleSessionId,
  type TeamRoleId,
  type TeamRoleSubagentSpawnRequest,
} from "@linguist-agent/cat-data";
import type { TaskPackageRunResources } from "./task_package_profile.js";
import {
  buildTeamChildRpcCliArgs,
  resolveTeamChildPackageExecution,
  startTeamChildRpcRun,
  type TeamChildRpcRunHandle,
} from "./team_child_rpc_adapter.js";

export interface StartWorkflowTeamChildRpcInput {
  repoRoot: string;
  roleId: TeamRoleId;
  workflowId: string;
  request: TeamRoleSubagentSpawnRequest;
  taskPackageResources: TaskPackageRunResources;
  verifiedPiBinaryPath: string;
  uiContext: ExtensionUIContext;
}

/**
 * Launch one Team specialist through Pi's native RPC mode when a Package
 * Extension needs standard interactive UI. Pi still owns the Agent loop; LA
 * owns the process boundary, canonical Decision host, and exact resource set.
 */
export async function startWorkflowTeamChildRpc(
  input: StartWorkflowTeamChildRpcInput,
): Promise<TeamChildRpcRunHandle> {
  const sessionDir = input.request.params.sessionDir;
  if (!sessionDir) throw new Error(`Team role ${input.roleId} has no server-owned child session scope.`);
  const scope = await readTeamEvidenceChildScope(input.repoRoot, join(sessionDir, "session.jsonl"));
  if (scope.workflowId !== input.workflowId || scope.roleId !== input.roleId) {
    throw new Error(`Team child evidence scope does not match ${input.workflowId}/${input.roleId}.`);
  }
  const execution = await resolveTeamChildPackageExecution(input.taskPackageResources.resolvedResources);
  if (execution.mode !== "pi_rpc_v1") {
    throw new Error(execution.mode === "blocked"
      ? `Task Package profile cannot start a Team child: ${execution.blockers.join(" ")}`
      : "Task Package profile does not require the Pi RPC child transport.");
  }
  const systemPromptPath = join(sessionDir, "rpc-system-prompt.md");
  await writeFile(
    systemPromptPath,
    await readCanonicalTeamRoleSystemPrompt(input.repoRoot, input.roleId),
    { encoding: "utf8", mode: 0o600 },
  );
  const evidenceExtension = join(input.repoRoot, ".pi", "extensions", "team-evidence-child.ts");
  const selected = input.taskPackageResources.resolvedResources;
  const cliArgs = buildTeamChildRpcCliArgs({
    sessionDir,
    sessionId: teamRoleSessionId(input.workflowId, input.roleId),
    model: input.request.params.model,
    systemPromptPath,
    allowedToolNames: scope.allowedTools,
    // Package hooks load first. The server-owned evidence guard loads last so
    // its system-prompt append, active-tool reset, and tool-call block are the
    // final authority in Pi's ordered Extension runner.
    extensionPaths: [...selected.filter((resource) => resource.resourceType === "extension").map((resource) => resource.path), evidenceExtension],
    skillPaths: selected.filter((resource) => resource.resourceType === "skill").map((resource) => resource.path),
    promptTemplatePaths: selected.filter((resource) => resource.resourceType === "prompt").map((resource) => resource.path),
  });
  const runId = `la-rpc-${randomUUID()}`;
  return startTeamChildRpcRun({
    verifiedPiBinaryPath: input.verifiedPiBinaryPath,
    cwd: input.repoRoot,
    cliArgs,
    env: {
      ...process.env,
      PI_SUBAGENT_CHILD: "1",
      PI_SUBAGENT_RUN_ID: runId,
      PI_SUBAGENT_CHILD_AGENT: input.request.params.agent,
    },
    prompt: input.request.params.task,
    runId,
    agent: input.request.params.agent,
    model: input.request.params.model,
    uiContext: input.uiContext,
  });
}
