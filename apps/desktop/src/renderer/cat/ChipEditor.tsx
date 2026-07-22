import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import type { SegmentDetectedTag } from "../data/workspace-client.ts";
import { insertLiteralAt, relocateDetectedTags, tokensFromDetectedTags } from "./cat-model.ts";

export interface ChipEditorHandle {
  /** Inserts a literal string at the current caret, re-chipifies, and moves the caret after it. */
  insertText(literal: string): void;
  focus(): void;
}

export interface ChipEditorProps {
  value: string;
  tagDefs: SegmentDetectedTag[];
  ariaLabel: string;
  onChange(value: string): void;
  onFlush(): void;
  onCancel(): void;
  onConfirm(): void;
  /** One-shot insertion queued before the editor mounted (match dock). Consumed once. */
  pendingInsertRef: MutableRefObject<string | null>;
}

const CHIP_ATTRIBUTE = "data-literal";

function createChip(tag: SegmentDetectedTag): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "cat-tag-token";
  span.dataset.tone = tag.tone;
  span.setAttribute(CHIP_ATTRIBUTE, tag.literal);
  span.contentEditable = "false";
  span.title = tag.literal === "\n" ? "换行" : tag.literal;
  span.textContent = tag.label;
  return span;
}

function literalLengthOfNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length;
  if (!(node instanceof HTMLElement)) return 0;
  if (node.tagName === "BR") return 1;
  const literal = node.getAttribute(CHIP_ATTRIBUTE);
  if (literal !== null) return literal.length;
  let total = 0;
  for (const child of node.childNodes) total += literalLengthOfNode(child);
  return total;
}

function serializeNode(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? "");
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "BR") {
    out.push("\n");
    return;
  }
  const literal = node.getAttribute(CHIP_ATTRIBUTE);
  if (literal !== null) {
    out.push(literal);
    return;
  }
  const isBlock = node.tagName === "DIV" || node.tagName === "P";
  if (isBlock && node.previousSibling) out.push("\n");
  for (const child of node.childNodes) serializeNode(child, out);
}

function serializeEditor(root: HTMLElement): string {
  const out: string[] = [];
  for (const child of root.childNodes) serializeNode(child, out);
  return out.join("");
}

function buildEditorDom(root: HTMLElement, value: string, tagDefs: SegmentDetectedTag[]): void {
  root.textContent = "";
  for (const token of tokensFromDetectedTags(value, relocateDetectedTags(value, tagDefs))) {
    root.appendChild(token.kind === "text" ? document.createTextNode(token.value) : createChip(token.tag));
  }
}

/** Literal-coordinate caret offset for a DOM selection endpoint. */
function literalOffsetForDomPosition(root: HTMLElement, container: Node, offset: number): number {
  let total = 0;
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, (node.textContent ?? "").length);
      } else {
        const children = Array.from(node.childNodes);
        for (let index = 0; index < Math.min(offset, children.length); index += 1) {
          total += literalLengthOfNode(children[index]!);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? "").length;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      total += 1;
      return;
    }
    const literal = node.getAttribute(CHIP_ATTRIBUTE);
    if (literal !== null) {
      total += literal.length;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return total;
}

/** DOM position for a literal-coordinate caret offset. Only used on freshly built (flat) DOM. */
function domPositionForLiteralOffset(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const children = Array.from(root.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const length = literalLengthOfNode(child);
    if (child.nodeType === Node.TEXT_NODE) {
      if (remaining <= length) return { node: child, offset: remaining };
    } else {
      if (remaining === 0) return { node: root, offset: index };
      if (remaining <= length) return { node: root, offset: index + 1 };
    }
    remaining -= length;
  }
  return { node: root, offset: children.length };
}

function applyCaret(root: HTMLElement, position: { node: Node; offset: number }): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretLiteralOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.startContainer !== root && !root.contains(range.startContainer)) return null;
  return literalOffsetForDomPosition(root, range.startContainer, range.startOffset);
}

/**
 * Uncontrolled contenteditable chip editor. React never re-renders the chip
 * DOM while the user types; the DOM is the source of truth between rebuilds
 * and is serialized back to a literal string for SegmentDraftController.edit().
 * Rebuilds happen only on mount, on external value changes (cancel, useServer,
 * conflict resolution), after paste, and after imperative insertions, so the
 * caret and IME composition stay stable.
 */
export const ChipEditor = forwardRef<ChipEditorHandle, ChipEditorProps>(function ChipEditor(
  { value, tagDefs, ariaLabel, onChange, onFlush, onCancel, onConfirm, pendingInsertRef },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const lastSerializedRef = useRef(value);
  const tagDefsRef = useRef(tagDefs);
  const callbacksRef = useRef({ onChange, onFlush, onCancel, onConfirm });
  tagDefsRef.current = tagDefs;
  callbacksRef.current = { onChange, onFlush, onCancel, onConfirm };

  const commitSerialized = (): void => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    const serialized = serializeEditor(root);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    callbacksRef.current.onChange(serialized);
  };

  /** Rebuilds chips around the current DOM content, restoring the caret by literal offset. */
  const rechipifyPreservingCaret = (): void => {
    const root = rootRef.current;
    if (!root) return;
    const caret = caretLiteralOffset(root);
    const serialized = serializeEditor(root);
    buildEditorDom(root, serialized, tagDefsRef.current);
    if (caret !== null) applyCaret(root, domPositionForLiteralOffset(root, caret));
  };

  const insertLiteral = (literal: string): void => {
    const root = rootRef.current;
    if (!root || !literal) return;
    let caret = caretLiteralOffset(root);
    if (caret === null) {
      root.focus();
      caret = serializeEditor(root).length;
    }
    const next = insertLiteralAt(serializeEditor(root), caret, literal);
    buildEditorDom(root, next.value, tagDefsRef.current);
    applyCaret(root, domPositionForLiteralOffset(root, next.caret));
    lastSerializedRef.current = next.value;
    callbacksRef.current.onChange(next.value);
  };

  const insertLiteralRef = useRef(insertLiteral);
  insertLiteralRef.current = insertLiteral;

  useImperativeHandle(ref, () => ({
    insertText: (literal: string) => insertLiteralRef.current(literal),
    focus: () => rootRef.current?.focus(),
  }), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    buildEditorDom(root, value, tagDefsRef.current);
    lastSerializedRef.current = value;
    const pending = pendingInsertRef.current;
    if (pending !== null) pendingInsertRef.current = null;
    root.focus();
    applyCaret(root, domPositionForLiteralOffset(root, Number.POSITIVE_INFINITY));
    if (pending !== null) insertLiteralRef.current(pending);
    // The editor instance is keyed per segment; this mount build runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // External value change (cancel, useServer, conflict resolution, canonical sync):
    // user input already equals lastSerializedRef and never reaches this branch.
    if (value === lastSerializedRef.current) return;
    buildEditorDom(root, value, tagDefsRef.current);
    lastSerializedRef.current = value;
    if (root === document.activeElement || root.contains(document.activeElement)) {
      applyCaret(root, domPositionForLiteralOffset(root, Number.POSITIVE_INFINITY));
    }
  }, [value]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onCancel();
      return;
    }
    if (event.key === "Enter") {
      if (event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onConfirm();
        return;
      }
      event.preventDefault();
      // Chromium turns the inserted "\n" into a <br>; re-chipification then
      // renders it as a ↵ chip, matching the contract's newline tone.
      document.execCommand("insertText", false, "\n");
      rechipifyPreservingCaret();
      commitSerialized();
    }
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    document.execCommand("insertText", false, text);
    rechipifyPreservingCaret();
    commitSerialized();
  };

  return (
    <div
      ref={rootRef}
      className="cat-chip-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      tabIndex={0}
      spellCheck={false}
      onInput={commitSerialized}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => {
        composingRef.current = false;
        commitSerialized();
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={() => { void callbacksRef.current.onFlush(); }}
    />
  );
});
