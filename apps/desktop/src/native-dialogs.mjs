const BATCH_EXTENSIONS = ["mxliff", "mqxliff", "sdlxliff", "xliff", "xlf", "csv", "xlsx"];
const ASSET_EXTENSIONS = [
  "md", "txt", "csv", "tsv", "xlsx", "docx", "pptx", "pdf",
  "png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp",
  "tmx", "sdltm", "tbx", "sdltb",
];
const LAPKG_EXTENSIONS = ["lapkg"];

export function projectFolderDialogOptions() {
  return {
    title: "选择项目文件夹",
    buttonLabel: "选择",
    properties: ["openDirectory", "createDirectory"],
  };
}

export function importFilesDialogOptions(kind) {
  const extensions = kind === "batch" ? BATCH_EXTENSIONS : kind === "asset" ? ASSET_EXTENSIONS : kind === "lapkg" ? LAPKG_EXTENSIONS : null;
  if (!extensions) throw new Error("Unsupported import kind.");
  return {
    title: kind === "batch" ? "导入 Batch" : kind === "asset" ? "导入 Assets" : "选择签名 LA Package",
    buttonLabel: kind === "lapkg" ? "选择" : "导入",
    properties: kind === "lapkg" ? ["openFile"] : ["openFile", "multiSelections"],
    filters: [{ name: kind === "batch" ? "CAT 文件" : kind === "asset" ? "项目资料" : "LA Package", extensions: [...extensions] }],
  };
}

export function selectedProjectFolder(result) {
  return result?.canceled ? null : result?.filePaths?.find((path) => typeof path === "string") ?? null;
}

export function selectedImportFiles(result) {
  return result?.canceled ? [] : (result?.filePaths ?? []).filter((path) => typeof path === "string");
}
