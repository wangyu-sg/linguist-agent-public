import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type FileCapabilityOperation = "read" | "list" | "search" | "write";

export interface FileCapabilityGrant {
  id: string;
  rootPath: string;
  kind: "file" | "directory";
  recursive: boolean;
  operations: readonly FileCapabilityOperation[];
}

export interface AuthorizedFileCapability {
  grantId: string;
  path: string;
  operation: FileCapabilityOperation;
}

const PATH_KEYS = [
  "path", "file_path", "filePath", "target_path", "targetPath", "output_path", "outputPath",
  "dest", "destination", "to", "output", "output_file", "outputFile", "file", "filename",
  "directory", "dir", "cwd", "root", "notebook_path", "notebookPath", "sourcePath", "source_path", "tessdataPath",
] as const;
const PATH_ARRAY_KEYS = ["files", "paths", "file_paths", "filePaths", "targets", "edits", "sourcePaths", "source_paths"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collectFileCapabilityPaths(input: unknown, depth = 0, seen = new Set<object>()): string[] {
  if (!object(input) || depth > 5 || seen.has(input)) return [];
  seen.add(input);
  const paths: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) paths.push(value.trim().replace(/^@/, ""));
  }
  for (const key of PATH_ARRAY_KEYS) {
    const values = input[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string" && value.trim()) paths.push(value.trim().replace(/^@/, ""));
      else paths.push(...collectFileCapabilityPaths(value, depth + 1, seen));
    }
  }
  for (const [key, value] of Object.entries(input)) {
    if (PATH_KEYS.includes(key as typeof PATH_KEYS[number]) || PATH_ARRAY_KEYS.includes(key as typeof PATH_ARRAY_KEYS[number])) continue;
    if (object(value)) paths.push(...collectFileCapabilityPaths(value, depth + 1, seen));
    else if (Array.isArray(value)) {
      for (const entry of value) paths.push(...collectFileCapabilityPaths(entry, depth + 1, seen));
    }
  }
  return [...new Set(paths)];
}

function inside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalCandidate(path: string): Promise<string> {
  const existing = await realpath(path).catch(() => undefined);
  if (existing) return existing;
  let ancestor = dirname(path);
  const suffix: string[] = [path.slice(ancestor.length + 1)];
  for (;;) {
    const canonicalAncestor = await realpath(ancestor).catch(() => undefined);
    if (canonicalAncestor) return join(canonicalAncestor, ...suffix);
    const parent = dirname(ancestor);
    if (parent === ancestor) return path;
    suffix.unshift(ancestor.slice(parent.length + 1));
    ancestor = parent;
  }
}

interface CanonicalFileCapabilityGrant extends Omit<FileCapabilityGrant, "rootPath"> {
  rootPath: string;
}

export class FileCapabilityBroker {
  private constructor(
    private readonly cwd: string,
    private readonly grants: readonly CanonicalFileCapabilityGrant[],
  ) {}

  static async create(input: { cwd: string; grants: readonly FileCapabilityGrant[] }): Promise<FileCapabilityBroker> {
    const cwd = await realpath(resolve(input.cwd));
    const grants = await Promise.all(input.grants.map(async (grant): Promise<CanonicalFileCapabilityGrant> => ({
      ...grant,
      rootPath: await realpath(resolve(grant.rootPath)),
      operations: [...new Set(grant.operations)],
    })));
    return new FileCapabilityBroker(cwd, grants);
  }

  async authorizePath(path: string, operation: FileCapabilityOperation): Promise<AuthorizedFileCapability> {
    if (!path.trim() || path.includes("\0")) throw new Error("FILE_CAPABILITY_DENIED: invalid path.");
    const requested = resolve(this.cwd, path);
    const candidate = await canonicalCandidate(requested);
    const grant = this.grants.find((entry) => entry.operations.includes(operation)
      && (entry.kind === "file" || !entry.recursive
        ? candidate === entry.rootPath
        : inside(entry.rootPath, candidate)));
    if (!grant) throw new Error(`FILE_CAPABILITY_DENIED: ${operation} is not granted for ${candidate}.`);
    return { grantId: grant.id, path: candidate, operation };
  }

  async authorizeToolInput(
    capability: { filesystem: { operations: readonly FileCapabilityOperation[]; scope: "workspace-or-explicit-grant" } },
    input: unknown,
  ): Promise<{ allowed: boolean; authorizedPaths: AuthorizedFileCapability[]; reason?: string }> {
    const paths = collectFileCapabilityPaths(input);
    if (!paths.length) return { allowed: false, authorizedPaths: [], reason: "FILE_CAPABILITY_DENIED: tool input has no declared path." };
    const operation = capability.filesystem.operations[0];
    if (!operation) return { allowed: false, authorizedPaths: [], reason: "FILE_CAPABILITY_DENIED: tool declares no filesystem operation." };
    try {
      const authorizedPaths = await Promise.all(paths.map((path) => this.authorizePath(path, operation)));
      return { allowed: true, authorizedPaths };
    } catch (error) {
      return {
        allowed: false,
        authorizedPaths: [],
        reason: error instanceof Error ? error.message : "FILE_CAPABILITY_DENIED: path authorization failed.",
      };
    }
  }
}
