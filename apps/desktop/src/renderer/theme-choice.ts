export type AppearanceChoice = "system" | "light" | "dark";

const STORAGE_KEY = "la-appearance";

function systemTheme(): "light" | "dark" {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolved(choice: AppearanceChoice): "light" | "dark" {
  return choice === "system" ? systemTheme() : choice;
}

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
    // data-theme 永远携带解析结果,使 tokens.css 只保留单一 dark 声明源。
    document.documentElement.dataset.theme = resolved(choice);
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, choice);
  } catch {
    // 隐私模式等场景下偏好不落盘,仅本次会话生效。
  }
}

// system 选择下跟随 OS 主题变化,即时重新解析。
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentAppearance() === "system") applyAppearance("system");
});

// 启动即应用,避免明暗闪烁。
applyAppearance(currentAppearance());
