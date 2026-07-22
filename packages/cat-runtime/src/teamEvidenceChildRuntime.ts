import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  parseTeamEvidenceScope,
  readJsonFile,
  resolveRuntimeStorageRoots,
  TEAM_EVIDENCE_TOOL_NAMES,
  teamEvidencePolicyHash,
  teamEvidenceToolsForScope,
  writeJsonFile,
  type TeamEvidenceScope,
  type TeamEvidenceToolName,
  type TeamRoleId,
} from "@linguist-agent/cat-data";
import { buildTeamEvidenceTools } from "@linguist-agent/cat-tools";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { buildCatRequestShape, combineCatRequestShapes, type CatRequestShapeManifest } from "./catRequestShape.js";

const SCOPE_FILE = "scope.json";
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;

export const TEAM_EVIDENCE_CHILD_CONSTITUTION = [
  "Linguist Agent Team child constitution:",
  "- Obey the binding/advisory authority supplied by the typed scope. Locks and structural constraints are immutable; exact TM binds only under its effective authority; fuzzy TM is advisory.",
  "- Decide text function before wording. Expressive game text may be localized creatively where binding evidence leaves room; operational text uses clear target-market convention.",
  "- Use only the scoped CAT evidence tools that are actually active. Tool trace is audit data; cite concrete evidence returned by a tool.",
  "- You produce reviewable JSON artifacts and proposals only. Never claim to write CAT targets, apply proposals, waive findings, authorize delivery, or export files.",
  "- Return the role JSON in your final assistant response. The runner persists it; never request file-write approval or use coordination tools to save the artifact.",
  "- Do not reveal hidden reasoning. Give only concise, decision-relevant notes, evidence refs, queries, and the exact role JSON contract.",
].join("\n");

export function guardTeamEvidenceChildToolCall(toolName: string): { block: true; reason: string } | undefined {
  return (TEAM_EVIDENCE_TOOL_NAMES as readonly string[]).includes(toolName)
    ? undefined
    : { block: true, reason: `${toolName} is outside the read-only Team evidence tool profile. Return the role JSON in the final response instead.` };
}

export interface PrepareTeamEvidenceChildScopeInput {
  repoRoot: string;
  projectId: string;
  workflowId: string;
  roleId: TeamRoleId;
  batchId?: string;
  segmentIds?: string[];
  allowedTools?: TeamEvidenceToolName[];
  ttlMs?: number;
}

export interface PreparedTeamEvidenceChildScope {
  sessionDir: string;
  policyHash: string;
  scope: TeamEvidenceScope;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function teamRoleAgentName(roleId: TeamRoleId): string {
  return `la-team-${roleId.replaceAll("_", "-")}`;
}

function profileFrontmatter(document: string, path: string): { body: string; fields: Map<string, string> } {
  const normalized = document.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`Team Agent profile has no frontmatter: ${path}`);
  const boundary = normalized.indexOf("\n---\n", 4);
  if (boundary < 0) throw new Error(`Team Agent profile frontmatter is incomplete: ${path}`);
  const fields = new Map<string, string>();
  for (const line of normalized.slice(4, boundary).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return { body: normalized.slice(boundary + 5).trim(), fields };
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function sameStrings(actual: string[], expected: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertCanonicalTeamProfile(agentName: string, fields: Map<string, string>): void {
  const exact: Record<string, string> = {
    name: agentName,
    extensions: "",
    subagentOnlyExtensions: ".pi/extensions/team-evidence-child.ts",
    systemPromptMode: "replace",
    inheritProjectContext: "false",
    inheritSkills: "false",
    defaultContext: "fresh",
    completionGuard: "false",
  };
  for (const [field, expected] of Object.entries(exact)) {
    if (fields.get(field) !== expected) {
      throw new Error(`Canonical Team Agent ${agentName} must set ${field}: ${expected || "(empty)"}.`);
    }
  }
  if (!sameStrings(csv(fields.get("tools")), TEAM_EVIDENCE_TOOL_NAMES)) {
    throw new Error(`Canonical Team Agent ${agentName} must declare exactly the scoped CAT evidence tool set.`);
  }
  for (const forbidden of ["mcpDirectTools", "skills"]) {
    if (csv(fields.get(forbidden)).length) throw new Error(`Canonical Team Agent ${agentName} cannot declare ${forbidden}.`);
  }
}

export function assertCanonicalTeamProjectSettingsDocument(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project Pi settings must be a JSON object.");
  }
  if (Object.prototype.hasOwnProperty.call(value, "subagents")) {
    throw new Error("Canonical Team Runs do not allow project Pi subagents settings or Agent overrides.");
  }
}

export async function assertCanonicalTeamProjectSettings(repoRoot: string): Promise<void> {
  const settings = await readJsonFile<Record<string, unknown>>(join(repoRoot, ".pi", "settings.json"), {});
  assertCanonicalTeamProjectSettingsDocument(settings);
}

/**
 * Build the attested request shape for the real server-owned Team child surfaces.
 * The hash covers each selected role prompt, the child Extension entry, the
 * Extension constitution, and the exact scoped tool schemas. It deliberately
 * uses repo-relative resource identifiers so a Run manifest never persists a
 * customer or machine path.
 */
export async function buildTeamEvidenceChildRequestShape(input: {
  repoRoot: string;
  roleIds: TeamRoleId[];
  activeToolNames: TeamEvidenceToolName[];
  packageResources?: Array<{
    packageName: string;
    version: string;
    resourceType: "extension" | "skill" | "prompt";
    resourceId: string;
    integrity: string;
  }>;
}): Promise<CatRequestShapeManifest> {
  await assertCanonicalTeamProjectSettings(input.repoRoot);
  const roleIds = [...new Set(input.roleIds)].sort();
  if (!roleIds.length) throw new Error("A Team child request shape requires at least one model-backed role.");
  const activeToolNames = [...new Set(input.activeToolNames)].sort();
  const allowed = new Set<string>(TEAM_EVIDENCE_TOOL_NAMES);
  if (activeToolNames.some((name) => !allowed.has(name))) throw new Error("Team child request shape contains an unsupported evidence tool.");
  const extensionPath = join(input.repoRoot, ".pi", "extensions", "team-evidence-child.ts");
  const extensionBytes = await readFile(extensionPath);
  const extensionIntegrity = `sha256-${sha256(extensionBytes)}`;
  const tools = buildTeamEvidenceTools(async () => {
    throw new Error("Request-shape inspection must not execute a Team evidence tool.");
  });
  const surfaces = await Promise.all(roleIds.map(async (roleId) => {
    const agentName = teamRoleAgentName(roleId);
    const profilePath = join(input.repoRoot, ".pi", "agents", `${agentName}.md`);
    const profile = await readFile(profilePath, "utf8");
    const parsed = profileFrontmatter(profile, profilePath);
    assertCanonicalTeamProfile(agentName, parsed.fields);
    const profileIntegrity = `sha256-${sha256(profile)}`;
    return {
      id: roleId,
      manifest: buildCatRequestShape({
        systemPrompt: `${parsed.body}\n\n${TEAM_EVIDENCE_CHILD_CONSTITUTION}`,
        activeToolNames,
        tools,
        resources: [
          { kind: "context", name: `agent:${agentName}`, description: profileIntegrity, path: `.pi/agents/${agentName}.md` },
          { kind: "context", name: "extension:team-evidence-child", description: extensionIntegrity, path: ".pi/extensions/team-evidence-child.ts" },
          ...(input.packageResources ?? []).map((resource) => ({
            kind: resource.resourceType === "skill" ? "skill" as const : resource.resourceType === "prompt" ? "prompt" as const : "context" as const,
            name: `package:${resource.packageName}@${resource.version}:${resource.resourceId}`,
            description: resource.integrity,
          })),
        ],
      }),
    };
  }));
  return combineCatRequestShapes({ scope: "team-evidence-children-v1", surfaces });
}

/** Return the exact attested role prompt body used by non-TUI Pi child hosts. */
export async function readCanonicalTeamRoleSystemPrompt(
  repoRoot: string,
  roleId: TeamRoleId,
): Promise<string> {
  const agentName = teamRoleAgentName(roleId);
  const profilePath = join(repoRoot, ".pi", "agents", `${agentName}.md`);
  const parsed = profileFrontmatter(await readFile(profilePath, "utf8"), profilePath);
  assertCanonicalTeamProfile(agentName, parsed.fields);
  // team-evidence-child appends the constitution in before_agent_start for
  // both pi-subagents and direct RPC children. Returning it here as well would
  // make only the direct transport receive the binding policy twice.
  return parsed.body;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}

function sessionsRoot(repoRoot: string): string {
  return join(resolveRuntimeStorageRoots(repoRoot).cacheRoot, "team-role-sessions");
}

export async function prepareTeamEvidenceChildScope(input: PrepareTeamEvidenceChildScopeInput): Promise<PreparedTeamEvidenceChildScope> {
  const issued = Date.now();
  const ttlMs = Math.max(60_000, Math.min(MAX_TTL_MS, input.ttlMs ?? DEFAULT_TTL_MS));
  const withoutHash: Omit<TeamEvidenceScope, "policyHash"> = {
    schemaVersion: 1,
    projectId: input.projectId,
    workflowId: input.workflowId,
    roleId: input.roleId,
    batchId: input.batchId,
    segmentIds: [...new Set((input.segmentIds ?? []).map((value) => value.trim()).filter(Boolean))],
    allowedTools: [...new Set(input.allowedTools ?? teamEvidenceToolsForScope(input.batchId))],
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + ttlMs).toISOString(),
  };
  const scope = parseTeamEvidenceScope({ ...withoutHash, policyHash: teamEvidencePolicyHash(withoutHash) });
  const sessionDir = join(sessionsRoot(input.repoRoot), `${scope.workflowId}-${scope.roleId}-${randomUUID()}`);
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await writeJsonFile(join(sessionDir, SCOPE_FILE), scope);
  return { sessionDir, policyHash: scope.policyHash, scope };
}

async function findScopeFile(repoRoot: string, sessionFile: string): Promise<string> {
  const configuredRoot = sessionsRoot(repoRoot);
  const root = await realpath(configuredRoot);
  let existing = resolve(sessionFile);
  const missing: string[] = [];
  while (true) {
    try {
      existing = await realpath(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
  const file = resolve(existing, ...missing);
  if (!inside(root, file)) throw new Error("Team child session escaped the server-owned session root.");
  let cursor = dirname(file);
  for (let depth = 0; depth < 6 && inside(root, cursor); depth += 1) {
    const candidate = join(cursor, SCOPE_FILE);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (cursor === root) break;
    cursor = dirname(cursor);
  }
  throw new Error("Team child session has no server-authored evidence scope.");
}

export async function readTeamEvidenceChildScope(repoRoot: string, sessionFile: string): Promise<TeamEvidenceScope> {
  if (!sessionFile) throw new Error("Team evidence tools require a persisted child session.");
  const scopePath = await findScopeFile(repoRoot, resolve(sessionFile));
  const scope = parseTeamEvidenceScope(await readJsonFile<unknown>(scopePath, undefined));
  if (Date.parse(scope.expiresAt) <= Date.now()) throw new Error("Team evidence scope expired.");
  return scope;
}

export function registerTeamEvidenceChildRuntime(pi: ExtensionAPI): void {
  const activateScopedTools = async (ctx: ExtensionContext) => {
    const scope = await readTeamEvidenceChildScope(ctx.cwd, ctx.sessionManager.getSessionFile() ?? "");
    pi.setActiveTools(scope.allowedTools);
  };
  pi.on("session_start", (_event, ctx) => activateScopedTools(ctx));
  pi.on("before_provider_request", (_event, ctx) => activateScopedTools(ctx));
  pi.on("before_agent_start", async (event, ctx) => {
    // `before_provider_request` is too late to change the already-serialized
    // tool payload. Reset here as well so the first provider request sees the
    // signed scope, including the deliberately empty Private Eval profile.
    await activateScopedTools(ctx);
    return { systemPrompt: `${event.systemPrompt}\n\n${TEAM_EVIDENCE_CHILD_CONSTITUTION}` };
  });
  pi.on("tool_call", (event) => guardTeamEvidenceChildToolCall(event.toolName));
  for (const tool of buildTeamEvidenceTools(async (toolName, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const scope = await readTeamEvidenceChildScope(ctx.cwd, sessionFile ?? "");
    if (!scope.allowedTools.includes(toolName)) throw new Error(`${toolName} is not allowed for this Team role scope.`);
    return scope;
  })) {
    pi.registerTool(tool);
  }
}
