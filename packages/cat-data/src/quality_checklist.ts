import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./workspace.js";
import { parseMechanicalTextQaOptions, type MechanicalTextQaOptions, type MechanicalTextQaSegment } from "./mechanical_text_qa.js";
import { assertCatGovernanceLegacyAllowed, catGovernancePersistenceFor, readCatGovernanceReadCache } from "./cat_governance_storage.js";

export type QualityChecklistScope = "source" | "target" | "either";
export type QualityChecklistSeverity = "blocker" | "warning" | "info";
export type QualityChecklistStatus = "active" | "disabled";

export interface QualityChecklistEntry {
  id: string;
  name: string;
  scope: QualityChecklistScope;
  pattern: string;
  flags?: string;
  severity: QualityChecklistSeverity;
  status: QualityChecklistStatus;
  message?: string;
}

export interface QualityChecklistDocument {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  mechanicalOptions: MechanicalTextQaOptions;
  entries: QualityChecklistEntry[];
}

export interface QualityChecklistIssue {
  checklistId: string;
  checklistName: string;
  segmentId: string;
  severity: QualityChecklistSeverity;
  scope: "source" | "target";
  match: string;
  message: string;
  evidence: string[];
}

export function parseQualityChecklistEntries(value: unknown): QualityChecklistEntry[] {
  if (!Array.isArray(value)) throw new Error("quality checklist entries must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`quality checklist entries[${index}] must be an object.`);
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string") throw new Error(`quality checklist entries[${index}].id is required.`);
    if (typeof raw.name !== "string") throw new Error(`quality checklist entries[${index}].name is required.`);
    if (typeof raw.pattern !== "string") throw new Error(`quality checklist entries[${index}].pattern is required.`);
    if (raw.flags !== undefined && typeof raw.flags !== "string") throw new Error(`quality checklist entries[${index}].flags must be a string.`);
    if (raw.message !== undefined && typeof raw.message !== "string") throw new Error(`quality checklist entries[${index}].message must be a string.`);
    return {
      id: raw.id,
      name: raw.name,
      scope: raw.scope as QualityChecklistScope,
      pattern: raw.pattern,
      flags: raw.flags as string | undefined,
      severity: raw.severity as QualityChecklistSeverity,
      status: raw.status as QualityChecklistStatus,
      message: raw.message as string | undefined,
    };
  });
}

function safeProjectId(projectId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId)) throw new Error("quality checklist requires a safe projectId.");
  return projectId;
}

export function qualityChecklistPath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, "data", "projects", safeProjectId(projectId), "quality_checklist.json");
}

function requireEntryId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) throw new Error("quality checklist entry id is invalid.");
  return id;
}

export function compileQualityChecklistEntry(entry: QualityChecklistEntry): RegExp {
  if (!entry.pattern || entry.pattern.length > 240) throw new Error(`quality checklist ${entry.id} pattern must be 1-240 characters.`);
  if (/\([^)]*[*+][^)]*\)\s*[*+{]/.test(entry.pattern)) throw new Error(`quality checklist ${entry.id} pattern failed safety lint.`);
  const rawFlags = entry.flags ?? "iu";
  if (/[^imsu]/.test(rawFlags)) throw new Error(`quality checklist ${entry.id} flags may use only i, m, s, or u.`);
  const flags = Array.from(new Set(rawFlags.split(""))).join("");
  let regex: RegExp;
  try {
    regex = new RegExp(entry.pattern, flags);
  } catch (error) {
    throw new Error(`quality checklist ${entry.id} regex is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (regex.test("")) throw new Error(`quality checklist ${entry.id} pattern must not match an empty string.`);
  return regex;
}

export function validateQualityChecklistDocument(input: QualityChecklistDocument): QualityChecklistDocument {
  if (input.schemaVersion !== 1) throw new Error("quality checklist schemaVersion must be 1.");
  const projectId = safeProjectId(input.projectId);
  const ids = new Set<string>();
  const entries = input.entries.map((raw) => {
    const entry: QualityChecklistEntry = {
      id: requireEntryId(raw.id),
      name: raw.name.trim(),
      scope: raw.scope,
      pattern: raw.pattern,
      flags: raw.flags,
      severity: raw.severity,
      status: raw.status,
      message: raw.message?.trim() || undefined,
    };
    if (!entry.name || entry.name.length > 160) throw new Error(`quality checklist ${entry.id} name is required and must be at most 160 characters.`);
    if (!(["source", "target", "either"] as const).includes(entry.scope)) throw new Error(`quality checklist ${entry.id} scope is invalid.`);
    if (!(["blocker", "warning", "info"] as const).includes(entry.severity)) throw new Error(`quality checklist ${entry.id} severity is invalid.`);
    if (!(["active", "disabled"] as const).includes(entry.status)) throw new Error(`quality checklist ${entry.id} status is invalid.`);
    if (ids.has(entry.id)) throw new Error(`quality checklist repeats entry id ${entry.id}.`);
    ids.add(entry.id);
    compileQualityChecklistEntry(entry);
    return entry;
  });
  return {
    schemaVersion: 1,
    projectId,
    updatedAt: input.updatedAt,
    mechanicalOptions: parseMechanicalTextQaOptions(input.mechanicalOptions) ?? {},
    entries,
  };
}

export async function readQualityChecklist(workspaceRoot: string, projectId: string): Promise<QualityChecklistDocument> {
  const empty: QualityChecklistDocument = { schemaVersion: 1, projectId: safeProjectId(projectId), updatedAt: "", mechanicalOptions: {}, entries: [] };
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  const cached = persistence ? null : await readCatGovernanceReadCache<QualityChecklistDocument>(workspaceRoot, "checklist", projectId);
  const document = persistence
    ? await persistence.readQualityChecklist(projectId) ?? empty
    : cached ?? await readJsonFile<QualityChecklistDocument>(qualityChecklistPath(workspaceRoot, projectId), empty);
  if (!persistence && !cached) await assertCatGovernanceLegacyAllowed(workspaceRoot);
  return validateQualityChecklistDocument(document);
}

export async function writeQualityChecklist(
  workspaceRoot: string,
  projectId: string,
  entries: QualityChecklistEntry[],
  mechanicalOptions?: MechanicalTextQaOptions,
): Promise<QualityChecklistDocument> {
  const currentOptions = mechanicalOptions ?? (await readQualityChecklist(workspaceRoot, projectId)).mechanicalOptions;
  const document = validateQualityChecklistDocument({
    schemaVersion: 1,
    projectId: safeProjectId(projectId),
    updatedAt: new Date().toISOString(),
    mechanicalOptions: currentOptions,
    entries,
  });
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  if (persistence) await persistence.writeQualityChecklist(projectId, document, await persistence.readQualityChecklist(projectId));
  else {
    await assertCatGovernanceLegacyAllowed(workspaceRoot);
    await writeJsonFile(qualityChecklistPath(workspaceRoot, projectId), document, { durability: "critical" });
  }
  return document;
}

function firstMatch(regex: RegExp, value: string): string | undefined {
  regex.lastIndex = 0;
  return regex.exec(value)?.[0];
}

export function findQualityChecklistIssues(
  document: QualityChecklistDocument,
  segments: readonly MechanicalTextQaSegment[],
): QualityChecklistIssue[] {
  const issues: QualityChecklistIssue[] = [];
  for (const entry of document.entries) {
    if (entry.status !== "active") continue;
    const regex = compileQualityChecklistEntry(entry);
    for (const segment of segments) {
      if (segment.locked || !segment.target.trim()) continue;
      const candidates: Array<{ scope: "source" | "target"; value: string }> = entry.scope === "either"
        ? [{ scope: "source", value: segment.source }, { scope: "target", value: segment.target }]
        : [{ scope: entry.scope, value: entry.scope === "source" ? segment.source : segment.target }];
      for (const candidate of candidates) {
        const match = firstMatch(regex, candidate.value);
        if (!match) continue;
        issues.push({
          checklistId: entry.id,
          checklistName: entry.name,
          segmentId: segment.id,
          severity: entry.severity,
          scope: candidate.scope,
          match,
          message: entry.message ?? `${entry.name}: ${candidate.scope} matches project QA checklist rule.`,
          evidence: [`checklist:${entry.id}`, `${candidate.scope}-match:${match}`, `pattern-sha256:${createHash("sha256").update(entry.pattern).digest("hex")}`],
        });
        break;
      }
    }
  }
  return issues;
}
