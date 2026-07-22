import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createWorkspace, workspacePath, writeJsonFile } from "./workspace.js";
import { scanProjectFolder, type ProjectScanReport } from "./project_scan.js";
import { canonicalLocale } from "./locale.js";

export interface AssetRoleDecision {
  relPath: string;
  role: string;
  confidence: number;
  status: "inferred" | "confirmed";
  reasons: string[];
}

export interface AssetRoleOverride {
  relPath: string;
  role: string;
  status?: "inferred" | "confirmed";
  reason?: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  projectName?: string;
  root: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
  updatedAt: string;
  scan: ProjectScanReport;
  assetRoleDecisions: AssetRoleDecision[];
  phraseTagPairs: ProjectScanReport["phraseTagPairs"];
  importPlan: string[];
  warnings: string[];
  questions: string[];
}

export interface ProjectManifestRefreshResult {
  manifest: ProjectManifest;
  path: string;
  changes: {
    added: string[];
    removed: string[];
    roleChanged: Array<{ relPath: string; before: string; after: string }>;
    sizeChanged: Array<{ relPath: string; before: number; after: number }>;
  };
}

function asciiSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase();
  return slug || "project";
}

function requiredLocale(value: string | undefined, label: "sourceLanguage" | "targetLanguage"): string {
  if (!value?.trim()) throw new Error(`New projects require an explicit ${label}.`);
  return canonicalLocale(value, label);
}

export function inferProjectId(rootPath: string): string {
  return asciiSlug(basename(resolve(rootPath)));
}

export function projectManifestPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "project.json");
}

function buildManifest(
  projectId: string,
  scan: ProjectScanReport,
  options: {
    previous?: ProjectManifest;
    projectName?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    assetRoleOverrides?: AssetRoleOverride[];
  } = {},
): ProjectManifest {
  const now = new Date().toISOString();
  const previous = options.previous;
  const sourceLanguage = requiredLocale(options.sourceLanguage ?? previous?.sourceLanguage, "sourceLanguage");
  const targetLanguage = requiredLocale(options.targetLanguage ?? previous?.targetLanguage, "targetLanguage");
  const overrides = new Map((options.assetRoleOverrides ?? []).map((override) => [override.relPath, override]));
  return {
    schemaVersion: 1,
    projectId,
    projectName: options.projectName?.trim() || previous?.projectName || projectId,
    root: scan.root,
    sourceLanguage,
    targetLanguage,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    scan,
    assetRoleDecisions: scan.assets.map((asset) => {
      const old = previous?.assetRoleDecisions.find((decision) => decision.relPath === asset.relPath);
      const override = overrides.get(asset.relPath);
      return {
        relPath: asset.relPath,
        role: override?.role ?? old?.role ?? asset.role,
        confidence: asset.confidence,
        status: override?.status ?? old?.status ?? "inferred",
        reasons: override?.reason ? [override.reason, ...asset.reasons] : asset.reasons,
      };
    }),
    phraseTagPairs: scan.phraseTagPairs,
    importPlan: scan.importPlan,
    warnings: scan.warnings,
    questions: scan.questions,
  };
}

export async function readProjectManifest(workspaceRoot: string, projectId: string): Promise<ProjectManifest> {
  const path = projectManifestPath(workspaceRoot, projectId);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as ProjectManifest;
}

export async function readProjectLocalePair(
  workspaceRoot: string,
  projectId: string,
  overrides: { sourceLanguage?: string; targetLanguage?: string } = {},
): Promise<{ sourceLanguage: string; targetLanguage: string }> {
  if (overrides.sourceLanguage?.trim() && overrides.targetLanguage?.trim()) {
    return {
      sourceLanguage: requiredLocale(overrides.sourceLanguage, "sourceLanguage"),
      targetLanguage: requiredLocale(overrides.targetLanguage, "targetLanguage"),
    };
  }
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return {
    sourceLanguage: requiredLocale(overrides.sourceLanguage ?? manifest.sourceLanguage, "sourceLanguage"),
    targetLanguage: requiredLocale(overrides.targetLanguage ?? manifest.targetLanguage, "targetLanguage"),
  };
}

async function readPreviousManifest(workspaceRoot: string, projectId: string): Promise<ProjectManifest | undefined> {
  try {
    return await readProjectManifest(workspaceRoot, projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function diffManifests(previous: ProjectManifest, next: ProjectManifest): ProjectManifestRefreshResult["changes"] {
  const before = new Map(previous.scan.assets.map((asset) => [asset.relPath, asset]));
  const after = new Map(next.scan.assets.map((asset) => [asset.relPath, asset]));
  const added: string[] = [];
  const removed: string[] = [];
  const roleChanged: ProjectManifestRefreshResult["changes"]["roleChanged"] = [];
  const sizeChanged: ProjectManifestRefreshResult["changes"]["sizeChanged"] = [];

  for (const [relPath, asset] of after) {
    const old = before.get(relPath);
    if (!old) {
      added.push(relPath);
      continue;
    }
    if (old.role !== asset.role) roleChanged.push({ relPath, before: old.role, after: asset.role });
    if (old.sizeBytes !== asset.sizeBytes) sizeChanged.push({ relPath, before: old.sizeBytes, after: asset.sizeBytes });
  }
  for (const relPath of before.keys()) {
    if (!after.has(relPath)) removed.push(relPath);
  }
  return {
    added: added.sort((a, b) => a.localeCompare(b, "zh-CN")),
    removed: removed.sort((a, b) => a.localeCompare(b, "zh-CN")),
    roleChanged: roleChanged.sort((a, b) => a.relPath.localeCompare(b.relPath, "zh-CN")),
    sizeChanged: sizeChanged.sort((a, b) => a.relPath.localeCompare(b.relPath, "zh-CN")),
  };
}

export async function createProjectManifest(
  workspaceRoot: string,
  rootPath: string,
  options: {
    projectId?: string;
    projectName?: string;
    maxDepth?: number;
    sourceLanguage?: string;
    targetLanguage?: string;
    assetRoleOverrides?: AssetRoleOverride[];
  } = {},
): Promise<{ manifest: ProjectManifest; path: string }> {
  const projectId = options.projectId ?? inferProjectId(rootPath);
  const scan = await scanProjectFolder(rootPath, { maxDepth: options.maxDepth });
  const previous = await readPreviousManifest(workspaceRoot, projectId);
  const manifest = buildManifest(projectId, scan, {
    previous,
    projectName: options.projectName,
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    assetRoleOverrides: options.assetRoleOverrides,
  });
  const path = projectManifestPath(workspaceRoot, projectId);
  await writeJsonFile(path, manifest);
  return { manifest, path };
}

export async function refreshProjectManifest(
  workspaceRoot: string,
  projectId: string,
  options: { maxDepth?: number } = {},
): Promise<ProjectManifestRefreshResult> {
  const previous = await readProjectManifest(workspaceRoot, projectId);
  const scan = await scanProjectFolder(previous.root, { maxDepth: options.maxDepth });
  const manifest = buildManifest(projectId, scan, { previous });
  const changes = diffManifests(previous, manifest);
  const path = projectManifestPath(workspaceRoot, projectId);
  await writeJsonFile(path, manifest);
  return { manifest, path, changes };
}
