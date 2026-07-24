import type {
  AssetParseResult,
  NativeFileHandle,
  ProjectAssetItem,
  ProjectAssetReadResponse,
  ProjectAssetsCatalog,
} from "../data/workspace-client.ts";

export type AssetIngestionStatus = "queued" | "scanning" | "parsing" | "ready" | "registered" | "failed";

export interface AssetIngestionFile {
  handle: NativeFileHandle;
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
}

export interface AssetIngestionDependencies {
  pickImportFiles(): Promise<NativeFileHandle[]>;
  refreshProjectAssets(input: { projectId: string; handles: NativeFileHandle[] }): Promise<{ files: Array<NativeFileHandle & { relPath: string }> }>;
  listAssets(projectId: string): Promise<ProjectAssetsCatalog>;
  parseAsset(projectId: string, assetPath: string): Promise<AssetParseResult>;
  readAsset(projectId: string, assetPath: string): Promise<ProjectAssetReadResponse>;
  onChange?(files: AssetIngestionFile[]): void;
}

export interface AssetIngestionOutcome {
  files: AssetIngestionFile[];
  catalog?: ProjectAssetsCatalog;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  let catalog: ProjectAssetsCatalog;
  let files: AssetIngestionFile[];
  try {
    const refreshed = await dependencies.refreshProjectAssets({ projectId: context.projectId, handles: selected });
    const pathsByHandle = new Map(refreshed.files.map((file) => [file.id, file.relPath]));
    files = selected.map((handle) => {
      const relPath = pathsByHandle.get(handle.id);
      if (!relPath) throw new Error("Canonical Project asset refresh did not return a selected native file.");
      return { handle, relPath, status: "scanning" };
    });
    publish(files, dependencies);
    catalog = await dependencies.listAssets(context.projectId);
  } catch (error) {
    const detail = errorMessage(error);
    files = selected.map((handle) => ({ handle, status: "failed", error: detail }));
    publish(files, dependencies);
    return { files };
  }

  const byPath = new Map(catalog.assets.map((asset) => [asset.relPath, asset]));
  for (const file of files) {
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
      if (supportsStructuredParse(file.relPath!)) {
        const parse = await dependencies.parseAsset(context.projectId, file.relPath!);
        file.parse = parse;
        const preview = parse.structuredPreview;
        if (preview?.status === "error") {
          file.status = "registered";
          file.error = preview.error ?? "文件已登记，但结构化解析失败。";
        } else {
          file.status = "ready";
          file.message = "已登记并完成本地结构化解析";
        }
      } else if (supportsTextPreview(file.relPath!)) {
        const read = await dependencies.readAsset(context.projectId, file.relPath!);
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
