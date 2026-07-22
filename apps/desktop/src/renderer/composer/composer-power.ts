import type { AgentThinkingLevel } from "../data/workspace-client.ts";

/* ============================================================
   思考级别 Power Slider 纯模型(Codex spec 03 §2 + 05 §5)。
   档位与 runtime 实际支持的 ThinkingLevel 枚举一一对应:
   node_modules/@earendil-works/pi-coding-agent/.../pi-agent-core/dist/types.d.ts
     export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
   服务端 packages/cat-server/src/general_agent_runs.ts acceptMessage
   只在新 Run 接受 thinkingLevel;Run 进行中提交新级别会被拒绝,
   因此滑杆选择始终从下一条新 Run 生效(见组件 tooltip 说明)。
   ============================================================ */

export const COMPOSER_POWER_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AgentThinkingLevel[];

export const thinkingLevelLabels: Record<AgentThinkingLevel, string> = {
  off: "关闭",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/** Pi 未返回有效设置时的纯 UI fallback；正常路径使用 catalog 的有效值。 */
export const COMPOSER_POWER_DEFAULT_INDEX = COMPOSER_POWER_LEVELS.indexOf("medium");

export function powerIndexForLevel(level?: AgentThinkingLevel | null): number {
  if (!level) return COMPOSER_POWER_DEFAULT_INDEX;
  const index = COMPOSER_POWER_LEVELS.indexOf(level);
  return index >= 0 ? index : COMPOSER_POWER_DEFAULT_INDEX;
}

export function powerLevelAt(index: number): AgentThinkingLevel {
  return COMPOSER_POWER_LEVELS[clampPowerIndex(index)] ?? "medium";
}

export function clampPowerIndex(index: number): number {
  if (!Number.isFinite(index)) return COMPOSER_POWER_DEFAULT_INDEX;
  return Math.min(COMPOSER_POWER_LEVELS.length - 1, Math.max(0, Math.round(index)));
}

/** spec 05 §5.1:"Use Left and Right arrow keys to adjust power"。 */
export function nextPowerIndexForKey(current: number, key: string): number {
  if (key === "ArrowLeft" || key === "ArrowDown") return clampPowerIndex(current - 1);
  if (key === "ArrowRight" || key === "ArrowUp") return clampPowerIndex(current + 1);
  if (key === "Home") return 0;
  if (key === "End") return COMPOSER_POWER_LEVELS.length - 1;
  return clampPowerIndex(current);
}

/** spec 05 §5.1 播报格式:"{value}, {position} of {total}." */
export function powerValueText(index: number): string {
  const clamped = clampPowerIndex(index);
  return `${thinkingLevelLabels[powerLevelAt(clamped)]}, ${clamped + 1} of ${COMPOSER_POWER_LEVELS.length}.`;
}

/* ---------- 每个 Task 持久化(滑杆是 Task 级偏好,不是一次性覆盖) ---------- */

export const COMPOSER_POWER_STORAGE_PREFIX = "la.composer.thinkingLevel.";

export interface ComposerPowerStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function composerPowerStorageKey(taskId: string | null): string {
  return `${COMPOSER_POWER_STORAGE_PREFIX}${taskId ?? "default"}`;
}

export function readPersistedThinkingLevel(
  storage: ComposerPowerStorage | null | undefined,
  taskId: string | null,
): AgentThinkingLevel | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(composerPowerStorageKey(taskId));
    return raw && (COMPOSER_POWER_LEVELS as readonly string[]).includes(raw)
      ? (raw as AgentThinkingLevel)
      : undefined;
  } catch {
    return undefined;
  }
}

export function writePersistedThinkingLevel(
  storage: ComposerPowerStorage | null | undefined,
  taskId: string | null,
  level: AgentThinkingLevel | undefined,
): void {
  if (!storage) return;
  try {
    if (level) storage.setItem(composerPowerStorageKey(taskId), level);
    else storage.removeItem(composerPowerStorageKey(taskId));
  } catch {
    // 隐私模式等场景下 localStorage 可能抛错;持久化失败不影响当次选择。
  }
}
