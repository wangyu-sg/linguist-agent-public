export type FontChoice = "sans" | "serif";

const STORAGE_KEY = "la-font-choice";
const CAT_FS_KEY = "la-editor-fs";
const CAT_FS_DEFAULT = 13.5;
const CAT_FS_MIN = 12;
const CAT_FS_MAX = 22;

/** 界面字体偏好:本机 localStorage,即时生效,不涉及后端。 */
export function currentFontChoice(): FontChoice {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "serif" ? "serif" : "sans";
  } catch {
    return "sans";
  }
}

export function applyFontChoice(choice: FontChoice): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.font = choice;
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, choice);
  } catch {
    // 隐私模式等场景下偏好不落盘,仅本次会话生效。
  }
}

/** CAT 编辑器字号(12–22,对齐旧 Swift 版 la.editorFs)。 */
export function currentCatEditorFontSize(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(CAT_FS_KEY));
    if (Number.isFinite(value) && value >= CAT_FS_MIN && value <= CAT_FS_MAX) return value;
  } catch {
    // fall through to default
  }
  return CAT_FS_DEFAULT;
}

export function applyCatEditorFontSize(size: number): void {
  const clamped = Math.max(CAT_FS_MIN, Math.min(CAT_FS_MAX, size));
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--cat-editor-fs", `${clamped}px`);
  }
  try {
    globalThis.localStorage?.setItem(CAT_FS_KEY, String(clamped));
  } catch {
    // 同上,仅本次会话生效。
  }
}

// 启动即应用,避免先 SF 后宋体的闪烁。
applyFontChoice(currentFontChoice());
applyCatEditorFontSize(currentCatEditorFontSize());
