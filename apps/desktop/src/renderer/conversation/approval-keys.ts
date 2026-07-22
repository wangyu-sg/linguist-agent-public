/**
 * Codex spec 05 §1.2 审批键盘契约:
 * - Enter = approve(主操作),Escape = decline。
 * - 守卫:焦点在 [role=dialog]/[role=menu] 内两键都不触发;
 *   焦点在文本输入(input/textarea/select)内两键都让位;
 *   Enter 落在 button/a/summary 上时让位原生激活,不重复触发。
 * - 只有未加修饰键的裸按键生效。
 *
 * 纯函数实现,不依赖 React/DOM——target 只要求结构上的 closest(),
 * 便于 node:test 直接单测。
 */

export type ApprovalKeyAction = "approve" | "deny";

export interface ApprovalKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface ApprovalKeyTarget {
  closest(selector: string): unknown;
}

const MODAL_SCOPE = "[role='dialog'], [role='menu']";
const TEXT_INPUT_SCOPE = "input, textarea, select";
const NATIVE_ACTIVATION_SCOPE = "button, a, summary";

export function approvalKeyAction(
  event: ApprovalKeyEvent,
  target: ApprovalKeyTarget | null,
): ApprovalKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key !== "Enter" && event.key !== "Escape") return null;
  if (!target) return null;
  if (target.closest(MODAL_SCOPE)) return null;
  if (target.closest(TEXT_INPUT_SCOPE)) return null;
  if (event.key === "Escape") return "deny";
  if (target.closest(NATIVE_ACTIVATION_SCOPE)) return null;
  return "approve";
}
