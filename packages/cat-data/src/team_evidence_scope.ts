import { createHash } from "node:crypto";
import type { TeamRoleId } from "./team_workflow.js";

export const TEAM_EVIDENCE_TOOL_NAMES = [
  "batch_read",
  "tm_lookup",
  "tm_concordance",
  "termbase_lookup",
  "glossary_lookup",
  "asset_block_search",
  "asset_grep",
  "asset_read",
  "evidence_pack",
  "constraint_pack",
  "exemplar_lookup",
  "team_artifact_read",
] as const;

export type TeamEvidenceToolName = (typeof TEAM_EVIDENCE_TOOL_NAMES)[number];

export interface TeamEvidenceScope {
  schemaVersion: 1;
  projectId: string;
  workflowId: string;
  roleId: TeamRoleId;
  batchId?: string;
  segmentIds: string[];
  allowedTools: TeamEvidenceToolName[];
  issuedAt: string;
  expiresAt: string;
  policyHash: string;
}

const TOOL_NAMES = new Set<string>(TEAM_EVIDENCE_TOOL_NAMES);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function safeStorageId(value: unknown, label: string): string {
  const id = nonEmpty(value, label);
  if (id === "." || id === ".." || /[\\/\0]/.test(id)) throw new Error(`${label} is unsafe.`);
  return id;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

export function teamEvidencePolicyHash(input: Omit<TeamEvidenceScope, "policyHash">): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

export function parseTeamEvidenceScope(value: unknown): TeamEvidenceScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Team evidence scope.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) throw new Error("Unsupported Team evidence scope schema.");
  const tools = uniqueStrings(row.allowedTools);
  if (tools.some((tool) => !TOOL_NAMES.has(tool))) throw new Error("Invalid Team evidence tool allowlist.");
  const scopeWithoutHash: Omit<TeamEvidenceScope, "policyHash"> = {
    schemaVersion: 1,
    projectId: safeStorageId(row.projectId, "scope.projectId"),
    workflowId: safeStorageId(row.workflowId, "scope.workflowId"),
    roleId: nonEmpty(row.roleId, "scope.roleId") as TeamRoleId,
    batchId: row.batchId === undefined ? undefined : safeStorageId(row.batchId, "scope.batchId"),
    segmentIds: uniqueStrings(row.segmentIds),
    allowedTools: tools as TeamEvidenceToolName[],
    issuedAt: nonEmpty(row.issuedAt, "scope.issuedAt"),
    expiresAt: nonEmpty(row.expiresAt, "scope.expiresAt"),
  };
  if (!Number.isFinite(Date.parse(scopeWithoutHash.issuedAt)) || !Number.isFinite(Date.parse(scopeWithoutHash.expiresAt))) {
    throw new Error("Invalid Team evidence scope lifetime.");
  }
  const policyHash = nonEmpty(row.policyHash, "scope.policyHash");
  if (teamEvidencePolicyHash(scopeWithoutHash) !== policyHash) throw new Error("Team evidence scope policy hash mismatch.");
  return { ...scopeWithoutHash, policyHash };
}

export function teamEvidenceToolsForScope(batchId: string | undefined): TeamEvidenceToolName[] {
  return TEAM_EVIDENCE_TOOL_NAMES.filter((name) => batchId || !["batch_read", "evidence_pack", "constraint_pack"].includes(name));
}
