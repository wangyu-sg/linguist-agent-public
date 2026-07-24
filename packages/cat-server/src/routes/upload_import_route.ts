import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname } from "node:path";
import type { BatchWorkflowStage } from "@linguist-agent/cat-data";

export interface UploadImportRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  safeProjectId: (value: string) => string;
  inferBatchId: (fileName: string) => string;
  writeUploadedProjectFile: (projectId: string, fileName: string, contentBase64: string, allowedExts?: string[]) => Promise<string>;
  readProjectManifest: (repoRoot: string, projectId: string) => Promise<unknown>;
  createProjectManifest: (
    repoRoot: string,
    rootPath: string,
    input: { projectId?: string; projectName?: string; sourceLanguage: string; targetLanguage: string },
  ) => Promise<{ manifest: unknown }>;
  isEnoent: (error: unknown) => boolean;
  importPhraseBatch: (
    repoRoot: string,
    input: { projectId: string; mxliffPath: string; masterXliffPath?: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
  importMqxliffBatch: (
    repoRoot: string,
    input: { projectId: string; mqxliffPath: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
  importSdlxliffBatch: (
    repoRoot: string,
    input: { projectId: string; sdlxliffPath: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
  importGenericXliffBatch: (
    repoRoot: string,
    input: { projectId: string; xliffPath: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
  importCsvBatch: (
    repoRoot: string,
    input: { projectId: string; csvPath: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
  importXlsxBatch: (
    repoRoot: string,
    input: { projectId: string; xlsxPath: string; batchId: string; overwrite: boolean; workflowStage?: BatchWorkflowStage },
  ) => Promise<Record<string, unknown>>;
}

function batchWorkflowStage(value: unknown): BatchWorkflowStage | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const allowed = new Set<BatchWorkflowStage>(["translate", "edit", "proof", "delivery"]);
  if (typeof value === "string" && allowed.has(value as BatchWorkflowStage)) return value as BatchWorkflowStage;
  throw new Error(`Invalid batch workflowStage ${String(value)}.`);
}

export async function handleUploadImportRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: UploadImportRouteDeps,
): Promise<boolean> {
  if (url.pathname !== "/api/projects/import-upload" || req.method !== "POST") return false;
  const body = await deps.readBody(req) as Record<string, unknown>;
  const fileName = deps.requireString(body.fileName, "fileName");
  const projectName = deps.optionalString(body.projectName);
  const projectId = deps.safeProjectId(deps.optionalString(body.projectId) ?? projectName ?? deps.inferBatchId(fileName));
  const filePath = await deps.writeUploadedProjectFile(projectId, fileName, deps.requireString(body.fileDataBase64, "fileDataBase64"), [".mxliff", ".mqxliff", ".sdlxliff", ".xliff", ".xlf", ".csv", ".xlsx"]);
  const masterXliffPath = body.masterFileName && body.masterFileDataBase64
    ? await deps.writeUploadedProjectFile(projectId, deps.requireString(body.masterFileName, "masterFileName"), deps.requireString(body.masterFileDataBase64, "masterFileDataBase64"), [".xliff", ".xlf"])
    : undefined;
  let manifest: unknown;
  try {
    manifest = await deps.readProjectManifest(deps.repoRoot, projectId);
  } catch (error) {
    if (!deps.isEnoent(error)) throw error;
    manifest = (await deps.createProjectManifest(deps.repoRoot, dirname(filePath), {
      projectId,
      projectName,
      sourceLanguage: deps.requireString(body.sourceLanguage, "sourceLanguage"),
      targetLanguage: deps.requireString(body.targetLanguage, "targetLanguage"),
    })).manifest;
  }
  const batchId = deps.optionalString(body.batchId) ?? deps.inferBatchId(fileName);
  if (body.overwrite !== undefined && typeof body.overwrite !== "boolean") {
    throw new Error("overwrite must be a boolean when provided.");
  }
  const overwrite = body.overwrite ?? false;
  const workflowStage = batchWorkflowStage(body.workflowStage);
  const ext = extname(filePath).toLocaleLowerCase();
  if (ext === ".mxliff") {
    const result = await deps.importPhraseBatch(deps.repoRoot, { projectId, mxliffPath: filePath, masterXliffPath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  if (ext === ".mqxliff") {
    const result = await deps.importMqxliffBatch(deps.repoRoot, { projectId, mqxliffPath: filePath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  if (ext === ".sdlxliff") {
    const result = await deps.importSdlxliffBatch(deps.repoRoot, { projectId, sdlxliffPath: filePath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  if (ext === ".xliff" || ext === ".xlf") {
    const result = await deps.importGenericXliffBatch(deps.repoRoot, { projectId, xliffPath: filePath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  if (ext === ".csv") {
    const result = await deps.importCsvBatch(deps.repoRoot, { projectId, csvPath: filePath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  if (ext === ".xlsx") {
    const result = await deps.importXlsxBatch(deps.repoRoot, { projectId, xlsxPath: filePath, batchId, overwrite, workflowStage });
    deps.json(res, 200, { projectId, manifest, ...result });
    return true;
  }
  throw new Error(`Unsupported batch file extension ${ext || "(none)"}.`);
}
