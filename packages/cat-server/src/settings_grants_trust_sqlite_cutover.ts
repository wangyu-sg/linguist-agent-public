import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  installStructuredStorageBackend,
  parseStandaloneFileGrantDocument,
  TEAM_ROLE_IDS,
  type StructuredStorageDomain,
} from "@linguist-agent/cat-data";
import {
  prepareSqliteSettingsGrantsTrustCutover,
  structuredPayloadSha256,
  type PreparedSqliteSettingsGrantsTrustCutover,
  type StructuredDomainSourceV1,
} from "@linguist-agent/storage-sqlite";
import type { DataRootWriterLease } from "./data_root_writer_lease.js";
import { listApprovedPiExtensionEntries } from "./pi_extension_trust.js";

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function envelope(domain: StructuredStorageDomain, key: string, scope: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    domain,
    key,
    scope,
    revision: 0,
    payload,
    payloadSha256: structuredPayloadSha256(payload as Parameters<typeof structuredPayloadSha256>[0]),
    secretRefs: [],
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${label}.${key} is not supported.`);
  }
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be a string.`);
}

function stringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`${label} must be a string array.`);
}

function validatePermissionRules(value: unknown, label: string): void {
  if (value === undefined) return;
  const row = record(value, label);
  const allowed = new Set(["fileRead", "fileWrite", "webRead", "bash", "bridge"]);
  for (const [key, decision] of Object.entries(row)) {
    if (!allowed.has(key) || !["auto", "ask", "deny"].includes(String(decision))) {
      throw new Error(`${label}.${key} is invalid.`);
    }
  }
}

function validateTeamRoleSettings(value: unknown, label: string): void {
  const row = record(value, label);
  allowedKeys(row, ["profiles", "source", "profileSources"], label);
  if (!Array.isArray(row.profiles)) throw new Error(`${label}.profiles must be an array.`);
  const roleIds = new Set<string>(TEAM_ROLE_IDS);
  const seen = new Set<string>();
  for (const [index, entry] of row.profiles.entries()) {
    const profile = record(entry, `${label}.profiles[${index}]`);
    allowedKeys(profile, ["roleId", "enabled", "provider", "modelId", "thinking"], `${label}.profiles[${index}]`);
    if (typeof profile.roleId !== "string" || !roleIds.has(profile.roleId) || seen.has(profile.roleId)) {
      throw new Error(`${label}.profiles[${index}].roleId is invalid or duplicated.`);
    }
    seen.add(profile.roleId);
    if (typeof profile.enabled !== "boolean") throw new Error(`${label}.profiles[${index}].enabled is invalid.`);
    optionalString(profile.provider, `${label}.profiles[${index}].provider`);
    optionalString(profile.modelId, `${label}.profiles[${index}].modelId`);
    if (profile.thinking !== undefined && !["minimal", "low", "medium", "high", "xhigh"].includes(String(profile.thinking))) {
      throw new Error(`${label}.profiles[${index}].thinking is invalid.`);
    }
  }
  if (row.source !== undefined) {
    const source = record(row.source, `${label}.source`);
    allowedKeys(source, ["scope", "globalConfigured", "projectConfigured"], `${label}.source`);
    if (source.scope !== "global" && source.scope !== "project") throw new Error(`${label}.source.scope is invalid.`);
    if (source.globalConfigured !== undefined && typeof source.globalConfigured !== "boolean") throw new Error(`${label}.source.globalConfigured is invalid.`);
    if (source.projectConfigured !== undefined && typeof source.projectConfigured !== "boolean") throw new Error(`${label}.source.projectConfigured is invalid.`);
  }
  if (row.profileSources !== undefined) {
    const profileSources = record(row.profileSources, `${label}.profileSources`);
    for (const [roleId, source] of Object.entries(profileSources)) {
      if (!roleIds.has(roleId) || (source !== "global" && source !== "project")) throw new Error(`${label}.profileSources.${roleId} is invalid.`);
    }
  }
}

function validateAgentSettings(value: unknown, label: string): void {
  const row = record(value, label);
  allowedKeys(row, ["modelProvider", "modelId", "thinkingLevel", "disabledTools", "disabledSkills", "permissionMode", "permissionRules", "teamRoleSettings"], label);
  optionalString(row.modelProvider, `${label}.modelProvider`);
  optionalString(row.modelId, `${label}.modelId`);
  if (row.thinkingLevel !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(row.thinkingLevel))) {
    throw new Error(`${label}.thinkingLevel is invalid.`);
  }
  if (row.disabledTools !== undefined) stringArray(row.disabledTools, `${label}.disabledTools`);
  if (row.disabledSkills !== undefined) stringArray(row.disabledSkills, `${label}.disabledSkills`);
  if (row.permissionMode !== undefined && !["ask", "auto", "custom"].includes(String(row.permissionMode))) {
    throw new Error(`${label}.permissionMode is invalid.`);
  }
  validatePermissionRules(row.permissionRules, `${label}.permissionRules`);
  if (row.teamRoleSettings !== undefined) validateTeamRoleSettings(row.teamRoleSettings, `${label}.teamRoleSettings`);
}

export function assertCanonicalAgentSettings(value: unknown, label = "agent settings"): void {
  validateAgentSettings(value, label);
}

function validateAgentPermissionSettings(value: unknown, label: string): void {
  const row = record(value, label);
  allowedKeys(row, ["permissionMode", "permissionRules"], label);
  if (row.permissionMode !== undefined && !["ask", "auto", "custom"].includes(String(row.permissionMode))) {
    throw new Error(`${label}.permissionMode is invalid.`);
  }
  validatePermissionRules(row.permissionRules, `${label}.permissionRules`);
}

export function assertCanonicalAgentPermissionSettings(value: unknown, label = "agent permissions"): void {
  validateAgentPermissionSettings(value, label);
}

function validateNotificationPreferences(value: unknown, label: string): void {
  const row = record(value, label);
  allowedKeys(row, ["schemaVersion", "enabled", "categories", "updatedAt"], label);
  if (row.schemaVersion !== 1 || typeof row.enabled !== "boolean") throw new Error(`${label} schema is invalid.`);
  const categories = record(row.categories, `${label}.categories`);
  const expected = ["waiting", "failed", "completed", "permission"].sort().join(",");
  if (Object.keys(categories).sort().join(",") !== expected
    || Object.values(categories).some((entry) => typeof entry !== "boolean")) {
    throw new Error(`${label}.categories is invalid.`);
  }
  if (row.updatedAt !== null && (typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)))) {
    throw new Error(`${label}.updatedAt is invalid.`);
  }
}

function validatePiTrust(value: unknown, label: string): void {
  const row = record(value, label);
  for (const [path, decision] of Object.entries(row)) {
    if (!path.startsWith("/") || (decision !== true && decision !== false && decision !== null)) {
      throw new Error(`${label}.${path} is invalid.`);
    }
  }
}

function validateExtensionTrust(value: unknown, label: string): void {
  const row = record(value, label);
  allowedKeys(row, ["schemaVersion", "approvals"], label);
  if (row.schemaVersion !== 2 || !Array.isArray(row.approvals)) throw new Error(`${label} schema is invalid.`);
  const digests = /^[a-f0-9]{64}$/u;
  const seen = new Set<string>();
  for (const [index, entry] of row.approvals.entries()) {
    const approval = record(entry, `${label}.approvals[${index}]`);
    allowedKeys(approval, ["originalResolvedPath", "sourceSha256", "stagedPath", "stagedSha256", "sizeBytes", "approvedAt"], `${label}.approvals[${index}]`);
    if (typeof approval.originalResolvedPath !== "string" || !approval.originalResolvedPath.startsWith("/")) throw new Error(`${label}.approvals[${index}].originalResolvedPath is invalid.`);
    if (typeof approval.stagedPath !== "string" || !approval.stagedPath.startsWith("/")) throw new Error(`${label}.approvals[${index}].stagedPath is invalid.`);
    if (typeof approval.sourceSha256 !== "string" || !digests.test(approval.sourceSha256)
      || approval.stagedSha256 !== approval.sourceSha256) throw new Error(`${label}.approvals[${index}] digest is invalid.`);
    if (!Number.isSafeInteger(approval.sizeBytes) || (approval.sizeBytes as number) < 0) throw new Error(`${label}.approvals[${index}].sizeBytes is invalid.`);
    if (typeof approval.approvedAt !== "string" || !Number.isFinite(Date.parse(approval.approvedAt))) throw new Error(`${label}.approvals[${index}].approvedAt is invalid.`);
    if (seen.has(approval.originalResolvedPath)) throw new Error(`${label}.approvals contains duplicate paths.`);
    seen.add(approval.originalResolvedPath);
  }
}

async function sourceFromFile(input: {
  sourceId: string;
  path: string;
  domain: StructuredStorageDomain;
  key: string;
  scope: string;
  wrap?: (value: unknown) => Record<string, unknown>;
  validate?: (value: unknown) => void | Promise<void>;
}): Promise<StructuredDomainSourceV1 | null> {
  const raw = await readOptional(input.path);
  if (!raw) return null;
  let parsed: unknown = {};
  let valid = true;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as unknown;
    await input.validate?.(parsed);
  } catch {
    valid = false;
  }
  const payload = input.wrap ? input.wrap(parsed) : (parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {});
  const value = envelope(input.domain, input.key, input.scope, payload);
  if (!valid) value.schemaVersion = 0;
  return {
    sourceId: input.sourceId,
    domain: input.domain,
    key: input.key,
    scope: input.scope,
    raw,
    value,
  };
}

async function projectSources(repoRoot: string): Promise<StructuredDomainSourceV1[]> {
  const projectsRoot = join(resolve(repoRoot), "data", "projects");
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const sources: StructuredDomainSourceV1[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const projectId = entry.name;
    const source = await sourceFromFile({
      sourceId: `projects/${projectId}/agent-settings.json`,
      path: join(projectsRoot, projectId, "agent_settings.json"),
      domain: "settings",
      key: `agent:${projectId}`,
      scope: `project:${projectId}`,
      validate: (value) => validateAgentSettings(value, `project ${projectId} agent settings`),
    });
    if (source) sources.push(source);
  }
  return sources;
}

async function standaloneGrantSources(repoRoot: string): Promise<StructuredDomainSourceV1[]> {
  const tasksRoot = join(resolve(repoRoot), "data", "assistant", "tasks");
  const entries = await readdir(tasksRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const sources: StructuredDomainSourceV1[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const taskId = entry.name;
    const source = await sourceFromFile({
      sourceId: `standalone/${taskId}/file-grants.json`,
      path: join(tasksRoot, taskId, "file_grants.json"),
      domain: "grants",
      key: taskId,
      scope: `task:${taskId}`,
      validate: (value) => { parseStandaloneFileGrantDocument(value); },
    });
    if (source) sources.push(source);
  }
  return sources;
}

export async function collectSettingsGrantsTrustSources(repoRoot: string, options: { piAgentDir?: string } = {}): Promise<StructuredDomainSourceV1[]> {
  const root = resolve(repoRoot);
  const sources: StructuredDomainSourceV1[] = [];
  const fixed: Array<Parameters<typeof sourceFromFile>[0]> = [
    {
      sourceId: "global/agent-permissions.json",
      path: join(root, "data", "runtime", "agent_permissions.json"),
      domain: "settings",
      key: "agent-permissions",
      scope: "global",
      validate: (value) => validateAgentPermissionSettings(value, "agent permissions"),
    },
    {
      sourceId: "global/notifications.json",
      path: join(root, "data", "settings", "notifications.json"),
      domain: "settings",
      key: "notifications",
      scope: "global",
      validate: (value) => validateNotificationPreferences(value, "notification preferences"),
    },
    {
      sourceId: "global/team-role-settings.json",
      path: join(root, "data", "runtime", "team_role_settings.json"),
      domain: "settings",
      key: "team-roles",
      scope: "global",
      validate: (value) => validateTeamRoleSettings(value, "team role settings"),
    },
    {
      sourceId: "global/pi-extension-trust.json",
      path: join(root, "data", "runtime", "pi_extension_trust.v2.json"),
      domain: "trust",
      key: "extensions",
      scope: "runtime",
      validate: async (value) => {
        validateExtensionTrust(value, "Pi Extension trust");
        await listApprovedPiExtensionEntries(root);
      },
    },
    {
      sourceId: "global/pi-trust.json",
      path: join(options.piAgentDir ?? join(homedir(), ".pi", "agent"), "trust.json"),
      domain: "trust",
      key: "pi",
      scope: "global",
      validate: (value) => validatePiTrust(value, "Pi trust"),
    },
  ];
  for (const candidate of fixed) {
    const source = await sourceFromFile(candidate);
    if (source) sources.push(source);
  }
  sources.push(...await projectSources(root));
  sources.push(...await standaloneGrantSources(root));
  return sources;
}

export async function prepareSettingsGrantsTrustSqliteCutover(input: {
  repoRoot: string;
  authority: DataRootWriterLease;
  activeRunCount: number;
  piAgentDir?: string;
  now?: () => Date;
}): Promise<PreparedSqliteSettingsGrantsTrustCutover> {
  const sources = await collectSettingsGrantsTrustSources(input.repoRoot, { piAgentDir: input.piAgentDir });
  const prepared = await prepareSqliteSettingsGrantsTrustCutover({
    root: input.repoRoot,
    authority: input.authority,
    activeRunCount: input.activeRunCount,
    sources,
    ...(input.now ? { now: input.now } : {}),
  });
  installStructuredStorageBackend(prepared.repository);
  return prepared;
}
