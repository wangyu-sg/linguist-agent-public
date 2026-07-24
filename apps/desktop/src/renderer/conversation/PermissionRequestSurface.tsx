import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import type { AgentPermissionAction, TaskPermissionRequest } from "../data/workspace-client.ts";
import { Button } from "../ui/index.ts";

const domainLabels: Record<TaskPermissionRequest["domain"], string> = {
  fileRead: "读取本地文件",
  fileWrite: "写入普通文件",
  webRead: "访问网络",
  bash: "运行命令",
  bridge: "使用外部连接",
};

const riskLabels: Record<TaskPermissionRequest["riskClass"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  protected: "受保护",
  non_picker: "系统规则",
};

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select, [contenteditable='true']")
      || Boolean(target.closest("[role='menu'], details"))
  );
}

export interface PermissionRequestSurfaceProps {
  request: TaskPermissionRequest;
  disabled?: boolean;
  onDecide: (requestId: string, action: AgentPermissionAction, reason?: string) => Promise<void>;
}

/**
 * Codex-style approval surface. It intentionally remains an ordinary div in
 * the current Composer stack: no native dialog, no backdrop, and no global
 * focus trap. The request itself is still bound to its Task/Run/session by the
 * server registry.
 */
export function PermissionRequestSurface({ request, disabled = false, onDecide }: PermissionRequestSurfaceProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<AgentPermissionAction | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewCollapsible, setPreviewCollapsible] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const previewRef = useRef<HTMLPreElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const isResourceTrust = request.kind === "pi_resource_trust"
    || request.toolName === "Trust Pi Extension executable code"
    || request.toolName === "Trust working-directory Pi resources";
  const expiresAt = Date.parse(request.expiresAt);
  const expired = request.status === "expired" || (Number.isFinite(expiresAt) && expiresAt <= clock);
  const canDecide = !disabled && !expired && (request.status === "pending" || request.status === "error");

  useEffect(() => {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || (request.status !== "pending" && request.status !== "error")) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(0, expiresAt - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [expiresAt, request.requestId, request.status]);

  useEffect(() => {
    if (!canDecide) return;
    primaryRef.current?.focus();
  }, [canDecide, request.requestId]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || previewExpanded) return;
    setPreviewCollapsible(preview.scrollHeight > preview.clientHeight + 1);
  }, [previewExpanded, request.argsSummary]);

  const decide = async (action: AgentPermissionAction) => {
    if (!canDecide || busy) return;
    setBusy(action);
    try {
      await onDecide(request.requestId, action, reason.trim() || undefined);
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canDecide || event.defaultPrevented || isTextEntry(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void decide("deny");
    } else if (event.key === "Enter" && event.target === surfaceRef.current) {
      event.preventDefault();
      void decide("allow_once");
    }
  };

  const status = expired ? "expired" : request.status;
  const statusCopy = status === "error" ? "处理失败，可重试" : status === "pending" ? "等待你的决定" : status === "expired" ? "已过期" : status === "approved" ? "已批准" : "已拒绝";
  const subtitle = isResourceTrust
    ? "在 Run 开始前审查并固定 Pi 资源；摘要或路径变化会再次请求确认。"
    : `${domainLabels[request.domain]} · ${riskLabels[request.riskClass]}`;

  return (
    <div
      ref={surfaceRef}
      className="permission-request-surface"
      data-codex-approval-surface="true"
      data-status={status}
      data-decidable={canDecide ? "true" : undefined}
      tabIndex={canDecide ? -1 : undefined}
      aria-labelledby={`permission-surface-${request.requestId}`}
      onKeyDown={onKeyDown}
    >
      <header className="permission-request-surface__header">
        <span className="permission-request-surface__icon" aria-hidden="true"><ShieldAlert /></span>
        <div className="permission-request-surface__heading">
          <span className="permission-request-surface__eyebrow">{isResourceTrust ? "Pi 资源信任" : "Agent 权限请求"}</span>
          <h2 id={`permission-surface-${request.requestId}`}>{request.toolName}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="permission-request-surface__status">{statusCopy}</span>
      </header>

      <section className="permission-request-surface__reason" aria-label="Reason">
        <strong>Reason</strong>
        <p>{isResourceTrust ? "Pi 资源在执行前需要精确摘要/路径信任。" : `Agent 请求 ${domainLabels[request.domain]}，由你决定本次作用域。`}</p>
      </section>

      {request.argsSummary ? (
        <section className="permission-request-surface__preview" data-expanded={previewExpanded || undefined} aria-label="请求预览">
          <pre ref={previewRef}><code>{request.argsSummary}</code></pre>
          {previewCollapsible || previewExpanded ? (
            <Button
              type="button"
              variant="ghost"
              className="permission-request-surface__preview-toggle"
              aria-expanded={previewExpanded}
              onClick={() => setPreviewExpanded((value) => !value)}
            >
              {previewExpanded ? "收起预览" : "展开预览"}
            </Button>
          ) : null}
        </section>
      ) : null}

      {request.error ? <p className="permission-request-surface__error" role="alert">{request.error}</p> : null}

      {canDecide ? (
        <>
          <label className="permission-request-surface__reason-input">
            <span>说明（可选）</span>
            <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="记录批准或拒绝的原因…" />
          </label>
          <footer className="permission-request-surface__actions">
            {isResourceTrust ? (
              <>
                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void decide("deny")}>拒绝 <kbd className="permission-request-surface__kbd" aria-hidden="true">Esc</kbd></Button>
                <Button ref={primaryRef} type="button" variant="primary" loading={busy === "allow_once"} disabled={busy !== null} onClick={() => void decide("allow_once")}>Trust this summary <kbd className="permission-request-surface__kbd" aria-hidden="true">Enter</kbd></Button>
              </>
            ) : (
              <>
                <Button type="button" variant="secondary" loading={busy === "always_allow"} disabled={busy !== null} onClick={() => void decide("always_allow")}>Always allow</Button>
                <Button type="button" variant="secondary" loading={busy === "deny"} disabled={busy !== null} onClick={() => void decide("deny")}>Deny <kbd className="permission-request-surface__kbd" aria-hidden="true">Esc</kbd></Button>
                <details className="permission-request-surface__scope-menu">
                  <summary aria-label="更多授权范围"><span>更多</span><ChevronDown aria-hidden="true" /></summary>
                  <div role="menu">
                    <button type="button" role="menuitem" disabled={busy !== null} onClick={() => void decide("allow_conversation")}>Allow this conversation</button>
                  </div>
                </details>
                <Button ref={primaryRef} type="button" variant="primary" loading={busy === "allow_once"} disabled={busy !== null} onClick={() => void decide("allow_once")}>Allow once <kbd className="permission-request-surface__kbd" aria-hidden="true">Enter</kbd></Button>
              </>
            )}
          </footer>
        </>
      ) : null}
    </div>
  );
}
