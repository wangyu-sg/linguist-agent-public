import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  createWorkspace,
  readBatch,
  readProjectManifest,
  workspacePath,
  type CatBatch,
  type ProjectManifest,
} from "@linguist-agent/cat-data";
import { createServerDiagnostic, type ServerDiagnostic } from "./server_diagnostics.js";

export interface BatchSummary {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  format: CatBatch["format"];
  sourceLanguage: string;
  targetLanguage: string;
  segments: number;
  confirmed: number;
  draft: number;
  new: number;
  locked: number;
  workflowStage?: CatBatch["workflowStage"];
  updatedAt: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  root: string;
  updatedAt: string;
  assetCount: number;
  batches: BatchSummary[];
}

export interface ProjectsIndexResult {
  projects: ProjectSummary[];
  diagnostics: ServerDiagnostic[];
}

export interface ProjectDeleteResult {
  projectId: string;
  deleted: boolean;
  path: string;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function summarizeBatch(batch: CatBatch): BatchSummary {
  let confirmed = 0;
  let draft = 0;
  let fresh = 0;
  let locked = 0;
  for (const segment of batch.segments) {
    if (segment.status === "confirmed") confirmed += 1;
    else if (segment.status === "draft") draft += 1;
    else fresh += 1;
    if (segment.locked) locked += 1;
  }
  return {
    schemaVersion: 1,
    projectId: batch.projectId,
    batchId: batch.batchId,
    format: batch.format,
    sourceLanguage: batch.sourceLanguage,
    targetLanguage: batch.targetLanguage,
    segments: batch.segments.length,
    confirmed,
    draft,
    new: fresh,
    locked,
    ...(batch.workflowStage ? { workflowStage: batch.workflowStage } : {}),
    updatedAt: batch.updatedAt,
  };
}

function projectWorkspaceDir(repoRoot: string, projectId: string): string {
  const base = resolve(repoRoot, "data", "projects");
  const projectPath = resolve(base, projectId);
  const rel = relative(base, projectPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to delete project outside data/projects: ${projectId}`);
  }
  return projectPath;
}

export async function listProjectsWithDiagnostics(
  repoRoot: string,
  now: () => string = () => new Date().toISOString(),
): Promise<ProjectsIndexResult> {
  const base = join(repoRoot, "data", "projects");
  await mkdir(base, { recursive: true });
  const entries = await readdir(base, { withFileTypes: true });
  const projects: ProjectSummary[] = [];
  const diagnostics: ServerDiagnostic[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    let manifest: ProjectManifest;
    const manifestPath = workspacePath(createWorkspace(repoRoot, projectId), "project.json");
    try {
      manifest = await readProjectManifest(repoRoot, projectId);
    } catch (error) {
      diagnostics.push(
        createServerDiagnostic({
          ts: now(),
          severity: isMissing(error) ? "warning" : "error",
          code: "project_manifest_unreadable",
          message: isMissing(error) ? "Project manifest is missing." : undefined,
          error,
          path: manifestPath,
          projectId,
        }),
      );
      continue;
    }

    const batches: ProjectSummary["batches"] = [];
    const batchesDir = workspacePath(createWorkspace(repoRoot, projectId), "batches");
    let batchDirs: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      batchDirs = await readdir(batchesDir, { withFileTypes: true });
    } catch (error) {
      if (!isMissing(error)) {
        diagnostics.push(
          createServerDiagnostic({
            ts: now(),
            severity: "error",
            code: "project_batches_unreadable",
            error,
            path: batchesDir,
            projectId,
          }),
        );
      }
    }

    for (const batchDir of batchDirs) {
      if (!batchDir.isDirectory()) continue;
      const batchPath = workspacePath(createWorkspace(repoRoot, projectId), "batches", batchDir.name, "batch.json");
      try {
        const batch = await readBatch(repoRoot, projectId, batchDir.name);
        batches.push(summarizeBatch(batch));
      } catch (error) {
        diagnostics.push(
          createServerDiagnostic({
            ts: now(),
            severity: isMissing(error) ? "warning" : "error",
            code: "project_batch_unreadable",
            message: isMissing(error) ? "Batch manifest is missing." : undefined,
            error,
            path: batchPath,
            projectId,
            batchId: batchDir.name,
          }),
        );
      }
    }

    projects.push({
      projectId,
      name: manifest.projectName ?? projectId,
      root: manifest.root,
      updatedAt: manifest.updatedAt,
      assetCount: manifest.scan.assets.length,
      batches: batches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    });
  }

  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    diagnostics,
  };
}

export async function listProjects(repoRoot: string): Promise<ProjectSummary[]> {
  return (await listProjectsWithDiagnostics(repoRoot)).projects;
}

export async function deleteProjectWorkspace(repoRoot: string, projectId: string): Promise<ProjectDeleteResult> {
  const path = projectWorkspaceDir(repoRoot, projectId);
  try {
    await rm(path, { recursive: true, force: false });
    return { projectId, deleted: true, path };
  } catch (error) {
    if (isMissing(error)) return { projectId, deleted: false, path };
    throw error;
  }
}
