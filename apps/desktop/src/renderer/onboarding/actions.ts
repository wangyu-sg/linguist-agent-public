import type {
  BatchImportResponse,
  CreateProjectInput,
  CreateProjectResponse,
  NativeFileHandle,
} from "../data/workspace-client.ts";

export interface ProjectDraft {
  name: string;
  sourceLocale: string;
  targetLocale: string;
  folderHandle?: NativeFileHandle;
}

export interface NewProjectDependencies {
  pickProjectFolder(): Promise<NativeFileHandle | null>;
  createProject(input: CreateProjectInput): Promise<CreateProjectResponse>;
  refreshProjects(): Promise<void>;
  selectProject(projectId: string): Promise<void>;
  onFolderSelected?(handle: NativeFileHandle): void;
}

export type NewProjectResult =
  | { status: "cancelled" }
  | { status: "created"; projectId: string; folder: NativeFileHandle };

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}不能为空。`);
  return trimmed;
}

export async function createProjectFromPicker(
  draft: ProjectDraft,
  dependencies: NewProjectDependencies,
): Promise<NewProjectResult> {
  const projectName = required(draft.name, "项目名称");
  const sourceLanguage = required(draft.sourceLocale, "源语言");
  const targetLanguage = required(draft.targetLocale, "目标语言");
  const folder = draft.folderHandle ?? await dependencies.pickProjectFolder();
  if (!folder) return { status: "cancelled" };
  dependencies.onFolderSelected?.(folder);
  const created = await dependencies.createProject({ rootHandle: folder, projectName, sourceLanguage, targetLanguage });
  await dependencies.refreshProjects();
  await dependencies.selectProject(created.manifest.projectId);
  return { status: "created", projectId: created.manifest.projectId, folder };
}

export interface BatchImportFileResult {
  file: NativeFileHandle;
  status: "imported" | "failed";
  batchId?: string;
  segmentCount?: number;
  message?: string;
}

export interface BatchImportOutcome {
  results: BatchImportFileResult[];
  openedBatchId?: string;
  followUpError?: string;
}

/** A mixed import keeps the sheet open so failed files and their retry path remain visible. */
export function shouldDismissBatchImport(outcome: BatchImportOutcome): boolean {
  return Boolean(
    outcome.openedBatchId
    && !outcome.followUpError
    && outcome.results.length > 0
    && outcome.results.every((result) => result.status === "imported"),
  );
}

export interface ImportBatchDependencies {
  pickImportFiles(): Promise<NativeFileHandle[]>;
  importBatch(projectId: string, file: NativeFileHandle): Promise<BatchImportResponse>;
  refreshProjects(): Promise<void>;
  openBatch(projectId: string, batchId: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importBatchesFromPicker(
  projectId: string,
  dependencies: ImportBatchDependencies,
): Promise<BatchImportOutcome> {
  const files = await dependencies.pickImportFiles();
  if (!files.length) return { results: [] };
  const results: BatchImportFileResult[] = [];
  let lastImported: BatchImportResponse | undefined;
  for (const file of files) {
    try {
      const imported = await dependencies.importBatch(projectId, file);
      lastImported = imported;
      results.push({
        file,
        status: "imported",
        batchId: imported.batch.batchId,
        segmentCount: imported.batch.segments.length,
      });
    } catch (error) {
      results.push({ file, status: "failed", message: errorMessage(error) });
    }
  }
  if (!lastImported) return { results };
  try {
    await dependencies.refreshProjects();
    await dependencies.openBatch(projectId, lastImported.batch.batchId);
    return { results, openedBatchId: lastImported.batch.batchId };
  } catch (error) {
    return { results, followUpError: errorMessage(error) };
  }
}
