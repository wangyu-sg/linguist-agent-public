import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { catToolMetadataFor } from "@linguist-agent/cat-tools";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const PATH_FIELD_KEYS = [
  "path", "file_path", "filePath", "target_path", "targetPath", "output_path", "outputPath",
  "dest", "destination", "to", "output", "output_file", "outputFile", "file", "filename",
  "directory", "dir", "cwd", "root", "notebook_path", "notebookPath",
  "tessdataPath",
] as const;
const PATH_ARRAY_KEYS = ["files", "paths", "file_paths", "filePaths", "targets", "edits"] as const;

export const CAT_PROTECTED_CREDENTIAL_PATHS = [
  "~/.agent-reach",
  "~/.ssh",
  "~/.aws",
  "~/.codex",
  "~/.pi/agent/auth.json",
  "~/.config/gcloud/application_default_credentials.json",
  "~/Library/Keychains",
  "**/.env*",
] as const;

const SCOPED_DOCUMENT_TOOLS = new Set(["document_parse", "document_search", "document_screenshot"]);
const CANONICAL_LIFECYCLE_ONLY_TOOLS = new Set([
  "subagent",
  "wait",
  "subagent_supervisor",
  "intercom",
  "contact_supervisor",
]);
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectPaths(input: unknown, depth = 0, seen = new Set<object>()): string[] {
  if (!isObject(input) || depth > 5 || seen.has(input)) return [];
  seen.add(input);
  const paths: string[] = [];
  for (const key of PATH_FIELD_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) paths.push(value.trim());
  }
  for (const key of PATH_ARRAY_KEYS) {
    const values = input[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string" && value.trim()) paths.push(value.trim());
      else paths.push(...collectPaths(value, depth + 1, seen));
    }
  }
  // Tool adapters frequently wrap their argument object under `params`,
  // `options`, or another tool-specific envelope.  A path guard that only
  // inspects the top-level schema is not a safety boundary, so recurse through
  // nested objects as well (bounded and cycle-safe to avoid walking arbitrary
  // model payloads).
  for (const [key, value] of Object.entries(input)) {
    if (PATH_FIELD_KEYS.includes(key as typeof PATH_FIELD_KEYS[number]) || PATH_ARRAY_KEYS.includes(key as typeof PATH_ARRAY_KEYS[number])) continue;
    if (isObject(value)) paths.push(...collectPaths(value, depth + 1, seen));
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item)) paths.push(...collectPaths(item, depth + 1, seen));
      }
    }
  }
  return paths;
}

function expandPath(path: string, workspaceRoot: string, homeDir: string): string {
  const expanded = path === "~" ? homeDir : path.startsWith("~/") ? join(homeDir, path.slice(2)) : path;
  return resolve(isAbsolute(expanded) ? expanded : join(workspaceRoot, expanded));
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    // `realpath` fails when the final path does not exist. Resolve the nearest
    // existing ancestor so a symlink such as workspace/.ssh -> ~/.ssh cannot
    // bypass the credential-path guard by referring to a not-yet-created file.
    let existing = path;
    const suffix: string[] = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) return path;
      suffix.unshift(existing.slice(parent.length + 1));
      existing = parent;
    }
    try {
      const resolvedExisting = realpathSync.native(existing);
      return suffix.length ? join(resolvedExisting, ...suffix) : resolvedExisting;
    } catch {
      return path;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function protectedRoots(homeDir: string): string[] {
  return [
    join(homeDir, ".agent-reach"),
    join(homeDir, ".ssh"),
    join(homeDir, ".aws"),
    join(homeDir, ".codex"),
    join(homeDir, "Library", "Keychains"),
  ].map((path) => canonicalPath(resolve(path)));
}

function protectedFiles(homeDir: string): string[] {
  return [
    join(homeDir, ".pi", "agent", "auth.json"),
    join(homeDir, ".config", "gcloud", "application_default_credentials.json"),
  ].map((path) => canonicalPath(resolve(path)));
}

function isProtectedPath(path: string, workspaceRoot: string, homeDir: string): boolean {
  if (path.includes("\0")) return true;
  const absolute = canonicalPath(expandPath(path, workspaceRoot, homeDir));
  if (protectedRoots(homeDir).some((root) => isInside(root, absolute))) return true;
  if (protectedFiles(homeDir).includes(absolute)) return true;
  const name = basename(absolute);
  return name === ".env" || name.startsWith(".env.");
}

function bashProtectedReason(command: string, homeDir: string): string | undefined {
  if (/(^|[;&|()\s'"])(?:[^;&|()\s'"]*\/)?security(?:[;&|()\s'"]|$)/i.test(command)) {
    return "CAT safety kernel blocked direct macOS Keychain access from bash.";
  }
  const protectedTokens = [
    "~/.agent-reach", "~/.ssh", "~/.aws", "~/.codex", "~/.pi/agent/auth.json", "~/Library/Keychains",
    "$HOME/.agent-reach", "$HOME/.ssh", "$HOME/.aws", "$HOME/.codex", "$HOME/.pi/agent/auth.json", "$HOME/Library/Keychains",
    "${HOME}/.agent-reach", "${HOME}/.ssh", "${HOME}/.aws", "${HOME}/.codex", "${HOME}/.pi/agent/auth.json", "${HOME}/Library/Keychains",
    ...protectedRoots(homeDir),
    ...protectedFiles(homeDir),
  ];
  // Strip shell quoting/escaping for a conservative lexical check.  This is
  // intentionally not a shell parser: the sandbox remains the final control,
  // while this kernel must reject obvious path exfiltration before a generic
  // tool reaches it.
  const normalizedCommand = command.replace(/["'`\\]/g, "");
  const mentionsProtectedPath = protectedTokens.some((token) => command.includes(token) || normalizedCommand.includes(token.replaceAll("$HOME", homeDir)));
  const mentionsCredentialDir = /(?:^|[\s/])(?:\.agent-reach|\.ssh|\.aws|\.codex)(?:[/\s]|$)/i.test(normalizedCommand)
    || /(?:\.pi[/\\]agent[/\\]auth\.json|Library[/\\]Keychains)/i.test(normalizedCommand);
  const mentionsEnvFile = /(^|[;&|()\s'"/])\.env(?:\.[^;&|()\s'"]+)?(?:[;&|()\s'"]|$)/.test(command);
  return mentionsProtectedPath || mentionsCredentialDir || mentionsEnvFile
    ? "CAT safety kernel blocked bash access to a protected credential path."
    : undefined;
}

export function evaluateCatSafetyToolCall(
  event: { toolName: string; input: unknown },
  options: { workspaceRoot: string; homeDir?: string },
): ToolCallEventResult | undefined {
  if (catToolMetadataFor(event.toolName)) return undefined;
  const toolName = event.toolName.toLowerCase();
  if (CANONICAL_LIFECYCLE_ONLY_TOOLS.has(toolName)) {
    return {
      block: true,
      reason: `CAT safety kernel blocked ${event.toolName}; specialist execution must enter through the canonical Task Run/Agent lifecycle.`,
    };
  }
  const homeDir = options.homeDir ?? homedir();
  if (
    SCOPED_DOCUMENT_TOOLS.has(toolName)
    && isObject(event.input)
    && typeof event.input.ocrServerUrl === "string"
    && event.input.ocrServerUrl.trim()
  ) {
    return {
      block: true,
      reason: `CAT safety kernel blocked ${event.toolName}; remote OCR is disabled for customer documents.`,
    };
  }
  if (toolName === "bash") {
    const command = isObject(event.input) && typeof event.input.command === "string" ? event.input.command : "";
    const reason = command ? bashProtectedReason(command, homeDir) : undefined;
    return reason ? { block: true, reason } : undefined;
  }
  const blockedPath = collectPaths(event.input).find((path) => isProtectedPath(path, options.workspaceRoot, homeDir));
  if (blockedPath) {
    return { block: true, reason: `CAT safety kernel blocked ${event.toolName} access to protected credential path ${blockedPath}.` };
  }
  return undefined;
}
