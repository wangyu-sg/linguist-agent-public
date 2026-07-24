import { readFile, unlink } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  estimatePromptTokens,
  type TeamContextManifest,
  type TeamEvidenceToolName,
  type TeamRoleId,
  type TeamRoleProfile,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";
import { prepareTeamEvidenceChildScope } from "@linguist-agent/cat-runtime";
import { buildTeamEvidenceTools } from "@linguist-agent/cat-tools";
import { prepareSubagentTeamRoleRun, teamRoleAgentName } from "../subagent_team_adapter.js";
import { readSubagentTaskActivityDrafts, type SubagentTaskActivityBridgeInput } from "../subagent_task_activity_bridge.js";

export interface WorkflowTeamRoleRunInput {
  repoRoot: string;
  projectId: string;
  workflowId: string;
  roleId: TeamRoleId;
  evidenceScope: {
    batchId?: string;
    segmentIds: string[];
    allowedTools: TeamEvidenceToolName[];
  };
  task: string;
  modelProvider?: string;
  modelId?: string;
  thinking?: TeamRoleProfile["thinking"];
  inputArtifactRefs: string[];
  outputArtifactRefs: string[];
  contextManifest: TeamContextManifest;
}

export interface WorkflowApplicationPort {
  estimateTeamToolSchemaTokens(activeToolNames: TeamEvidenceToolName[]): number;
  prepareTeamRoleRun(input: WorkflowTeamRoleRunInput): Promise<ReturnType<typeof prepareSubagentTeamRoleRun>>;
  roleAgentName(roleId: TeamRoleId): string;
  readRoleOutput(input: { repoRoot: string; asyncDir?: string; configuredOutput?: string; statusOutputFile?: string }): Promise<string | undefined>;
  readTaskActivityDrafts(input: SubagentTaskActivityBridgeInput): Promise<TaskRunEventDraft[]>;
  discardWorkflowFile(path: string): Promise<void>;
}

function readInsideAsyncDir(asyncDir: string | undefined, path: string | undefined): Promise<string | undefined> {
  if (!asyncDir || !path) return Promise.resolve(undefined);
  return readInsideRoot(resolve(asyncDir), resolve(path));
}

async function readInsideRoot(root: string, path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const file = resolve(root, path);
  const rel = relative(root, file);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || resolve(rel) === rel) return undefined;
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * This port is the only route-facing adapter for Team filesystem/Pi work. It
 * preserves the canonical workflow and Task writers in cat-data; it does not
 * create a second lifecycle or state projection.
 */
export const workflowApplicationPort: WorkflowApplicationPort = {
  estimateTeamToolSchemaTokens(activeToolNames: TeamEvidenceToolName[]): number {
    const active = new Set(activeToolNames);
    const schemas = buildTeamEvidenceTools(async () => {
      throw new Error("Prompt budget inspection must not execute a Team evidence tool.");
    })
      .filter((tool) => active.has(tool.name as TeamEvidenceToolName))
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    return estimatePromptTokens(JSON.stringify(schemas));
  },

  async prepareTeamRoleRun(input: WorkflowTeamRoleRunInput) {
    const childScope = await prepareTeamEvidenceChildScope({
      repoRoot: input.repoRoot,
      projectId: input.projectId,
      workflowId: input.workflowId,
      roleId: input.roleId,
      batchId: input.evidenceScope.batchId,
      segmentIds: input.evidenceScope.segmentIds,
      allowedTools: input.evidenceScope.allowedTools,
    });
    return prepareSubagentTeamRoleRun({
      workflowId: input.workflowId,
      roleId: input.roleId,
      task: input.task,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      thinking: input.thinking,
      inputArtifactRefs: input.inputArtifactRefs,
      outputArtifactRefs: input.outputArtifactRefs,
      contextManifestRef: `team-evidence-policy:${childScope.policyHash}`,
      contextManifest: input.contextManifest,
      sessionDir: childScope.sessionDir,
    });
  },

  roleAgentName(roleId: TeamRoleId): string {
    return teamRoleAgentName(roleId);
  },

  async readRoleOutput(input) {
    return (await readInsideRoot(resolve(input.repoRoot), input.configuredOutput))
      ?? await readInsideAsyncDir(input.asyncDir, input.statusOutputFile);
  },

  readTaskActivityDrafts(input: SubagentTaskActivityBridgeInput): Promise<TaskRunEventDraft[]> {
    return readSubagentTaskActivityDrafts(input);
  },

  discardWorkflowFile(path: string): Promise<void> {
    return unlink(path);
  },
};
