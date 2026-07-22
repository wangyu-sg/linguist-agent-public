import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { FileGrantV1 } from "@linguist-agent/cat-data";
import {
  evaluateAgentToolPermissionCall,
  resolveAgentToolPermissionDomain,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
} from "./agentPermissions.js";

export interface GeneralRuntimeAccessSnapshot {
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}

interface GeneralRuntimePermissionOptions {
  access: () => Promise<GeneralRuntimeAccessSnapshot>;
  contract: AgentPermissionContract;
  sessionId: () => string | undefined;
  requestDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}

const PATH_KEYS = [
  "path", "file_path", "filePath", "target_path", "targetPath", "output_path", "outputPath",
  "dest", "destination", "to", "output", "output_file", "outputFile", "file", "filename", "cwd",
] as const;
const PATH_ARRAY_KEYS = ["files", "paths", "file_paths", "filePaths", "targets", "edits"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectPaths(input: unknown, depth = 0): string[] {
  if (!object(input) || depth > 4) return [];
  const paths: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) paths.push(value.trim());
  }
  for (const key of PATH_ARRAY_KEYS) {
    const values = input[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string" && value.trim()) paths.push(value.trim());
      else paths.push(...collectPaths(value, depth + 1));
    }
  }
  return paths;
}

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalCandidate(value: string, cwd: string): Promise<string> {
  const absolute = resolve(cwd, value);
  const existing = await realpath(absolute).catch(() => undefined);
  if (existing) return existing;
  let parent = dirname(absolute);
  for (;;) {
    const canonicalParent = await realpath(parent).catch(() => undefined);
    if (canonicalParent) return resolve(canonicalParent, relative(parent, absolute));
    const next = dirname(parent);
    if (next === parent) return absolute;
    parent = next;
  }
}

function grantAllows(grant: FileGrantV1, path: string, write: boolean): boolean {
  if (write && grant.access !== "read_write") return false;
  if (grant.kind === "file" || !grant.recursive) return path === grant.realPath;
  return isInside(grant.realPath, path);
}

async function guardGrantedPaths(
  toolName: string,
  input: unknown,
  access: GeneralRuntimeAccessSnapshot,
): Promise<ToolCallEventResult | undefined> {
  const resolution = resolveAgentToolPermissionDomain(toolName);
  if (resolution.controlledBy !== "permission" || (resolution.domain !== "fileRead" && resolution.domain !== "fileWrite")) return undefined;
  const write = resolution.domain === "fileWrite";
  const candidates = collectPaths(input);
  if (!candidates.length) return undefined;
  for (const candidate of candidates) {
    const path = await canonicalCandidate(candidate, access.workingDirectory);
    if (isInside(access.workspaceRoot, path)) continue;
    if (access.grants.some((grant) => grantAllows(grant, path, write))) continue;
    return {
      block: true,
      reason: `File grant policy blocked ${toolName} targeting ${path}; choose the file or directory in the host before using it.`,
    };
  }
  return undefined;
}

export function createGeneralRuntimeExtension(options: GeneralRuntimePermissionOptions) {
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", async (event) => {
      const access = await options.access();
      const grantBlock = await guardGrantedPaths(event.toolName, event.input, access);
      if (grantBlock) return grantBlock;
      return evaluateAgentToolPermissionCall({
        toolName: event.toolName,
        input: event.input,
        contract: options.contract,
        sessionId: options.sessionId(),
        requestDecision: options.requestDecision,
      });
    });
  };
}
