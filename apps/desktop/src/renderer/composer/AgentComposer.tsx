import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import {
  shouldUseSingleLineComposer,
  type ComposerLayoutLock,
} from "./composer-model.ts";
import "./composer.css";

function classNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export interface AgentComposerProps {
  "aria-label": string;
  attachments?: ReactNode;
  autoFocus?: boolean;
  className?: string;
  errorMessage?: string | null;
  hint?: ReactNode;
  inputId?: string;
  inputLabel?: string;
  inputPopupActiveDescendant?: string;
  inputPopupControls?: string;
  inputPopupExpanded?: boolean;
  layoutLock?: ComposerLayoutLock;
  leadingControls?: ReactNode;
  onChange: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** 锚定在 composer 上方的弹出层(Slash 命令菜单等),随 form 定位。 */
  overlay?: ReactNode;
  placeholder: string;
  statusMessage?: string | null;
  topTray?: ReactNode;
  trailingControls: ReactNode;
  utilityBar?: ReactNode;
  value: string;
  variant?: "default" | "first-turn";
}

/**
 * Shared Task composer chrome. Pi and the canonical Task transport own what an
 * action means; this component only owns the responsive input surface.
 */
export const AgentComposer = forwardRef<HTMLTextAreaElement, AgentComposerProps>(function AgentComposer({
  "aria-label": ariaLabel,
  attachments,
  autoFocus = false,
  className,
  errorMessage = null,
  hint,
  inputId,
  inputLabel = "消息",
  inputPopupActiveDescendant,
  inputPopupControls,
  inputPopupExpanded,
  layoutLock = null,
  leadingControls,
  onChange,
  onKeyDown,
  onSubmit,
  overlay,
  placeholder,
  statusMessage = null,
  topTray,
  trailingControls,
  utilityBar,
  value,
  variant = "default",
}, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hintId = useId();
  const messageId = useId();
  const [metrics, setMetrics] = useState<{ availableInputWidth: number | null; measuredTextWidth: number }>({
    availableInputWidth: null,
    measuredTextWidth: 0,
  });

  useImperativeHandle(forwardedRef, () => textareaRef.current!, []);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const textarea = textareaRef.current;
    const actions = actionsRef.current;
    if (!surface || !textarea || !actions) return;

    const measure = () => {
      const style = window.getComputedStyle(textarea);
      const canvas = measureCanvasRef.current ?? document.createElement("canvas");
      measureCanvasRef.current = canvas;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = style.font;
      // Placeholder copy is visual affordance, never editor content. Measuring
      // it made an empty first turn multiline and a short typed message compact
      // on the next frame, which is a visibly unstable Composer state.
      const text = value;
      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
      const measuredTextWidth = context.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
      const leadingWidth = leadingRef.current?.offsetWidth ?? 0;
      const availableInputWidth = Math.max(0, surface.clientWidth - leadingWidth - actions.offsetWidth - 52);
      setMetrics((current) => (
        current.availableInputWidth === availableInputWidth && Math.abs(current.measuredTextWidth - measuredTextWidth) < 0.5
          ? current
          : { availableInputWidth, measuredTextWidth }
      ));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    if (leadingRef.current) observer.observe(leadingRef.current);
    observer.observe(actions);
    return () => observer.disconnect();
  }, [leadingControls, trailingControls, value]);

  const singleLine = shouldUseSingleLineComposer({
    ...metrics,
    hasLineBreak: /[\r\n]/.test(value),
    hasVisibleAttachments: Boolean(attachments),
    lockedLayout: layoutLock,
  });
  const describedBy = [hint ? hintId : null, statusMessage || errorMessage ? messageId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form
      className={classNames("agent-composer", className)}
      data-layout={singleLine ? "single-line" : "multiline"}
      data-variant={variant}
      onSubmit={onSubmit}
      aria-label={ariaLabel}
    >
      {overlay ? <div className="agent-composer__overlay">{overlay}</div> : null}
      {topTray ? <div className="agent-composer__top-tray">{topTray}</div> : null}
      <div
        ref={surfaceRef}
        className="agent-composer__surface"
        data-has-tray={topTray ? "true" : undefined}
        data-layout={singleLine ? "single-line" : "multiline"}
      >
        {attachments ? <div className="agent-composer__attachments">{attachments}</div> : null}
        <label className="agent-composer__input">
          <span className="la-sr-only">{inputLabel}</span>
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={1}
            value={value}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-describedby={describedBy}
            aria-activedescendant={inputPopupActiveDescendant}
            aria-controls={inputPopupControls}
            aria-expanded={inputPopupExpanded}
            aria-haspopup={inputPopupControls ? "listbox" : undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        {utilityBar ? <div className="agent-composer__utility-bar">{utilityBar}</div> : null}
        <div className="agent-composer__footer">
          <div className="agent-composer__primary-controls">
            <div ref={leadingRef} className="agent-composer__leading">{leadingControls}</div>
          </div>
          {hint ? <span id={hintId} className="agent-composer__hint">{hint}</span> : null}
          <div ref={actionsRef} className="agent-composer__actions">{trailingControls}</div>
        </div>
      </div>
      {statusMessage || errorMessage ? (
        <p id={messageId} className="agent-composer__message" data-tone={errorMessage ? "error" : "status"} role={errorMessage ? "alert" : "status"}>
          {errorMessage ?? statusMessage}
        </p>
      ) : null}
    </form>
  );
});
