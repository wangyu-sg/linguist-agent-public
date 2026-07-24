import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { FileCapabilityBroker, type FileGrantV1 } from "@linguist-agent/cat-data";
import {
  evaluateAgentToolPermissionCall,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
} from "./agentPermissions.js";
import { resolveToolCapabilityManifest } from "./toolCapabilities.js";
import { guardRuntimeCapabilities } from "./runtimeCapabilityGuards.js";

export interface GeneralRuntimeAccessSnapshot {
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}

interface GeneralRuntimePermissionOptions {
  access: () => Promise<GeneralRuntimeAccessSnapshot>;
  contract: AgentPermissionContract;
  taskId?: string;
  runId?: string;
  sessionId: () => string | undefined;
  requestDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}

async function guardGrantedPaths(
  toolName: string,
  input: unknown,
  access: GeneralRuntimeAccessSnapshot,
): Promise<ToolCallEventResult | undefined> {
  const manifest = resolveToolCapabilityManifest(toolName);
  if (!manifest || (manifest.permissionDomain !== "fileRead" && manifest.permissionDomain !== "fileWrite")) return undefined;
  const filesystem = manifest.capabilities.find((capability) => capability.kind === "filesystem");
  if (!filesystem || filesystem.kind !== "filesystem") return undefined;
  const broker = await FileCapabilityBroker.create({
    cwd: access.workingDirectory,
    grants: [{
      id: "standalone-workspace",
      rootPath: access.workspaceRoot,
      kind: "directory",
      recursive: true,
      operations: ["read", "list", "search", "write"],
    }, ...access.grants.map((grant) => ({
      id: grant.id,
      rootPath: grant.realPath,
      kind: grant.kind,
      recursive: grant.recursive,
      operations: grant.access === "read_write"
        ? ["read", "list", "search", "write"] as const
        : ["read", "list", "search"] as const,
    }))],
  });
  const decision = await broker.authorizeToolInput({ filesystem }, input);
  return decision.allowed ? undefined : {
    block: true,
    reason: `${decision.reason} Choose the file or directory in the host before using ${toolName}.`,
  };
}

export function createGeneralRuntimeExtension(options: GeneralRuntimePermissionOptions) {
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", async (event) => {
      const access = await options.access();
      const grantBlock = await guardGrantedPaths(event.toolName, event.input, access);
      if (grantBlock) return grantBlock;
      const capabilityBlock = guardRuntimeCapabilities(event);
      if (capabilityBlock) return capabilityBlock;
      return evaluateAgentToolPermissionCall({
        toolName: event.toolName,
        input: event.input,
        contract: options.contract,
        taskId: options.taskId,
        runId: options.runId,
        sessionId: options.sessionId(),
        requestDecision: options.requestDecision,
      });
    });
  };
}
