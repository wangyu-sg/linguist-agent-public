import type {
  AssetParseResult,
  CreateProjectInput,
  ProjectAssetItem,
  ProjectAssetReadResponse,
  ProjectAssetsCatalog,
} from "../data/workspace-client.ts";

export type AssetIngestionStatus = "queued" | "scanning" | "parsing" | "ready" | "registered" | "failed";

export interface AssetIngestionFile {
  filePath: string;
  relPath?: string;
  status: AssetIngestionStatus;
  asset?: ProjectAssetItem;
  parse?: AssetParseResult;
  read?: ProjectAssetReadResponse;
  message?: string;
  error?: string;
}

export interface AssetIngestionContext {
  projectId: string;
  projectName: string;
  rootPath: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface AssetIngestionDependencies {
  pickImportFiles(): Promise<string[]>;
  refreshProject(input: CreateProjectInput): Promise<unknown>;
  listAssets(projectId: string): Promise<ProjectAssetsCatalog>;
  parseAsset(projectId: string, filePath: string): Promise<AssetParseResult>;
  readAsset(projectId: string, filePath: string): Promise<ProjectAssetReadResponse>;
  onChange?(files: AssetIngestionFile[]): void;
}

export interface AssetIngestionOutcome {
  files: AssetIngestionFile[];
  catalog?: ProjectAssetsCatalog;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

export function projectRelativeAssetPath(rootPath: string, filePath: string): string | null {
  const root = withoutTrailingSlash(rootPath.trim());
  const file = filePath.trim();
  if (!root || !file || file === root || !file.startsWith(`${root}/`)) return null;
  const relative = file.slice(root.length + 1);
  return relative && !relative.split("/").includes("..") ? relative : null;
}

function supportsStructuredParse(path: string): boolean {
  return /\.(?:xlsx|csv|tsv|txt|md|markdown)$/iu.test(path);
}

function supportsTextPreview(path: string): boolean {
  return /\.(?:txt|md|markdown|csv|tsv|docx|pptx|pdf|png|jpe?g|webp|tiff?|bmp)$/iu.test(path);
}

function publish(files: AssetIngestionFile[], dependencies: AssetIngestionDependencies): void {
  dependencies.onChange?.(files.map((file) => ({ ...file })));
}

/**
 * Registers picker-authorized files already located inside the canonical
 * Project root, then performs deterministic parsing or a read-only preview.
 * It never copies a customer file and never calls an Agent or model route.
 */
export async function ingestProjectAssets(
  context: AssetIngestionContext,
  dependencies: AssetIngestionDependencies,
): Promise<AssetIngestionOutcome> {
  const selected = await dependencies.pickImportFiles();
  if (!selected.length) return { files: [] };

  const files: AssetIngestionFile[] = selected.map((filePath) => {
    const relPath = projectRelativeAssetPath(context.rootPath, filePath);
    return relPath
      ? { filePath, relPath, status: "queued" }
      : {
          filePath,
          status: "failed",
          error: "文件不在当前项目文件夹内。Linguist Agent 不会复制客户文件；请先将文件放入项目文件夹，再重新选择。",
        };
  });
  publish(files, dependencies);

  const eligible = files.filter((file) => file.relPath);
  if (!eligible.length) return { files };
  if (!context.sourceLanguage || !context.targetLanguage) {
    const error = "项目语言信息不完整，无法安全刷新资料清单。";
    for (const file of eligible) {
      file.status = "failed";
      file.error = error;
    }
    publish(files, dependencies);
    return { files };
  }

  for (const file of eligible) file.status = "scanning";
  publish(files, dependencies);
  let catalog: ProjectAssetsCatalog;
  try {
    await dependencies.refreshProject({
      projectId: context.projectId,
      rootPath: context.rootPath,
      projectName: context.projectName,
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
    });
    catalog = await dependencies.listAssets(context.projectId);
  } catch (error) {
    const detail = errorMessage(error);
    for (const file of eligible) {
      file.status = "failed";
      file.error = detail;
    }
    publish(files, dependencies);
    return { files };
  }

  const byPath = new Map(catalog.assets.map((asset) => [asset.relPath, asset]));
  for (const file of eligible) {
    const asset = byPath.get(file.relPath!);
    if (!asset) {
      file.status = "failed";
      file.error = "项目扫描未登记这个文件。请确认文件仍位于项目文件夹内，并重试。";
      publish(files, dependencies);
      continue;
    }
    file.asset = asset;
    file.status = "parsing";
    publish(files, dependencies);
    try {
      if (supportsStructuredParse(file.filePath)) {
        const parse = await dependencies.parseAsset(context.projectId, file.filePath);
        file.parse = parse;
        const preview = parse.structuredPreview;
        if (preview?.status === "error") {
          file.status = "registered";
          file.error = preview.error ?? "文件已登记，但结构化解析失败。";
        } else {
          file.status = "ready";
          file.message = "已登记并完成本地结构化解析";
        }
      } else if (supportsTextPreview(file.filePath)) {
        const read = await dependencies.readAsset(context.projectId, file.filePath);
        file.read = read;
        file.status = read.skippedReason ? "registered" : "ready";
        file.message = read.skippedReason ?? "已登记并完成本地内容预览";
      } else {
        file.status = "registered";
        file.message = "已登记到项目资料库；此格式没有通用内容预览。";
      }
    } catch (error) {
      file.status = "registered";
      file.error = `文件已登记，但解析失败：${errorMessage(error)}`;
    }
    publish(files, dependencies);
  }
  return { files, catalog };
}
