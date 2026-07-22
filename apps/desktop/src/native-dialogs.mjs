const BATCH_EXTENSIONS = ["mxliff", "mqxliff", "sdlxliff", "xliff", "xlf", "csv", "xlsx"];
const ASSET_EXTENSIONS = [
  "md", "txt", "csv", "tsv", "xlsx", "docx", "pptx", "pdf",
  "png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp",
  "tmx", "sdltm", "tbx", "sdltb",
];

export function projectFolderDialogOptions() {
  return {
    title: "选择项目文件夹",
    buttonLabel: "选择",
    properties: ["openDirectory", "createDirectory"],
  };
}

export function importFilesDialogOptions(kind) {
  const extensions = kind === "batch" ? BATCH_EXTENSIONS : kind === "asset" ? ASSET_EXTENSIONS : null;
  if (!extensions) throw new Error("Unsupported import kind.");
  return {
    title: kind === "batch" ? "导入 Batch" : "导入 Assets",
    buttonLabel: "导入",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: kind === "batch" ? "CAT 文件" : "项目资料", extensions: [...extensions] }],
  };
}

export function selectedProjectFolder(result) {
  return result?.canceled ? null : result?.filePaths?.find((path) => typeof path === "string") ?? null;
}

export function selectedImportFiles(result) {
  return result?.canceled ? [] : (result?.filePaths ?? []).filter((path) => typeof path === "string");
}
