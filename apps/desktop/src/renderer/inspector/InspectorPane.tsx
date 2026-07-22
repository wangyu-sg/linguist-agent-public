import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type TransitionEvent,
} from "react";
import {
  INSPECTOR_DEFAULT_WIDTH,
  clampInspectorWidth,
  inspectorWidthBounds,
  inspectorWidthForKey,
} from "./inspector-layout.ts";

const INSPECTOR_WIDTH_STORAGE_KEY = "linguist-agent:inspector-width";

function storedInspectorWidth(): number {
  const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : INSPECTOR_DEFAULT_WIDTH;
}

export interface InspectorPaneProps {
  open: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  children: ReactNode;
}

export function InspectorPane({ open, expanded, onToggleExpanded, children }: InspectorPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ clientX: number; width: number } | null>(null);
  const [width, setWidth] = useState(storedInspectorWidth);
  const [rendered, setRendered] = useState(open);
  const [cachedChildren, setCachedChildren] = useState<ReactNode>(children);
  const [resizing, setResizing] = useState(false);

  const frameWidth = () => paneRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
  const updateWidth = (nextWidth: number, persist = false) => {
    const clamped = clampInspectorWidth(nextWidth, frameWidth());
    setWidth(clamped);
    if (persist) window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(clamped));
  };

  useEffect(() => {
    if (!open) return;
    setCachedChildren(children);
    setRendered(true);
  }, [children, open]);

  useEffect(() => {
    const clampForViewport = () => setWidth((current) => clampInspectorWidth(current, frameWidth()));
    window.addEventListener("resize", clampForViewport);
    return () => window.removeEventListener("resize", clampForViewport);
  }, []);

  useEffect(() => {
    if (!open) {
      dragRef.current = null;
      setResizing(false);
    }
  }, [open]);

  if (!rendered) return null;
  const bounds = inspectorWidthBounds(frameWidth());
  const style = { "--product-inspector-width": `${width}px` } as CSSProperties;
  const shownChildren = open ? children : cachedChildren;

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const renderedWidth = paneRef.current?.getBoundingClientRect().width ?? width;
    window.localStorage.setItem(
      INSPECTOR_WIDTH_STORAGE_KEY,
      String(clampInspectorWidth(renderedWidth, frameWidth())),
    );
  };

  const handleResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = inspectorWidthForKey(event.key, width, frameWidth(), event.shiftKey ? 32 : undefined);
    if (next === null) return;
    event.preventDefault();
    updateWidth(next, true);
  };

  const finishClose = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "width" || open) return;
    setRendered(false);
    setCachedChildren(null);
  };

  return (
    <div
      ref={paneRef}
      className="product-inspector-pane"
      data-open={open}
      data-expanded={expanded}
      data-resizing={resizing}
      aria-hidden={!open}
      inert={!open}
      style={style}
      onTransitionEnd={finishClose}
    >
      {open && !expanded ? (
        <div
          className="product-inspector-resizer"
          role="separator"
          aria-label="调整上下文检查器宽度"
          aria-orientation="vertical"
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={width}
          tabIndex={0}
          title="拖动调整宽度，双击展开"
          onDoubleClick={onToggleExpanded}
          onKeyDown={handleResizeKey}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            dragRef.current = { clientX: event.clientX, width };
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            updateWidth(drag.width + drag.clientX - event.clientX);
          }}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
        />
      ) : null}
      <div className="product-inspector-pane__surface">{shownChildren}</div>
    </div>
  );
}
