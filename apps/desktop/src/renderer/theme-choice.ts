export type AppearanceChoice = "system" | "light" | "dark";

const STORAGE_KEY = "la-appearance";

/** 外观偏好(明暗主题):本机 localStorage,即时生效,不涉及后端。 */
export function currentAppearance(): AppearanceChoice {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyAppearance(choice: AppearanceChoice): void {
  if (typeof document !== "undefined") {
    if (choice === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, choice);
  } catch {
    // 隐私模式等场景下偏好不落盘,仅本次会话生效。
  }
}

// 启动即应用,避免明暗闪烁。
applyAppearance(currentAppearance());
