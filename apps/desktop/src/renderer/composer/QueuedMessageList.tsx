import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Play, RotateCcw, Trash2, TriangleAlert, Zap } from "lucide-react";
import type { TaskMessageQueue, TaskQueuedMessage } from "../data/workspace-client.ts";
import { IconButton } from "../ui/index.ts";
import { moveQueuedMessage } from "./queued-message-model.ts";

export interface QueuedMessageListProps {
  activeRun: boolean;
  busy: boolean;
  queue: TaskMessageQueue;
  onClear: () => void;
  onDelete: (message: TaskQueuedMessage) => void;
  onEdit: (message: TaskQueuedMessage, text: string) => void;
  onPause: () => void;
  onReorder: (messageIds: string[]) => void;
  onResume: () => void;
  onRetry: (message: TaskQueuedMessage) => void;
  onSteer: (message: TaskQueuedMessage) => void;
  pausedSubmitText?: string | null;
  onCancelPausedSubmit?: () => void;
  onClearAndSubmit?: () => void;
  onSubmitDespitePause?: () => void;
}

function pauseReason(queue: TaskMessageQueue): string {
  if (queue.pausedReason === "interrupted") return "Queue paused because you interrupted";
  if (queue.pausedReason === "delivery_failed") return "A queued message could not be sent";
  return "Queue paused";
}

export function QueuedMessageList({
  activeRun,
  busy,
  queue,
  onClear,
  onDelete,
  onEdit,
  onPause,
  onReorder,
  onResume,
  onRetry,
  onSteer,
  pausedSubmitText = null,
  onCancelPausedSubmit,
  onClearAndSubmit,
  onSubmitDespitePause,
}: QueuedMessageListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLButtonElement>(null);
  const submitTitleId = useId();
  const submitDescriptionId = useId();

  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (pausedSubmitText) confirmationRef.current?.focus(); }, [pausedSubmitText]);

  const startEdit = (message: TaskQueuedMessage) => {
    setEditingId(message.id);
    setEditText(message.text);
  };
  const saveEdit = (message: TaskQueuedMessage) => {
    const text = editText.trim();
    if (text && text !== message.text) onEdit(message, text);
    setEditingId(null);
  };
  const editKeyDown = (event: KeyboardEvent<HTMLInputElement>, message: TaskQueuedMessage) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      saveEdit(message);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditingId(null);
    }
  };
  const drop = (event: DragEvent, overId: string) => {
    event.preventDefault();
    if (!draggingId) return;
    const ids = queue.messages.map((message) => message.id);
    const next = moveQueuedMessage(ids, draggingId, overId);
    setDraggingId(null);
    if (next !== ids) onReorder(next);
  };
  const move = (message: TaskQueuedMessage, offset: -1 | 1) => {
    const ids = queue.messages.map((entry) => entry.id);
    const index = ids.indexOf(message.id);
    const over = ids[index + offset];
    if (over) onReorder(moveQueuedMessage(ids, message.id, over));
  };

  return (
    <section className="queued-message-list" aria-label="Queued messages">
      {queue.paused ? (
        <div className="queued-message-list__paused" role="status">
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>{pauseReason(queue)}</strong>
            <small>{activeRun ? "Resume, retry, edit, or delete a message to continue." : "Retry a message to start a new Run, or edit and delete the queue."}</small>
          </span>
          {activeRun && queue.pausedReason !== "delivery_failed"
            ? <button type="button" disabled={busy} onClick={onResume}><Play aria-hidden="true" />Resume</button>
            : null}
        </div>
      ) : null}
      {pausedSubmitText ? (
        <div
          className="queued-message-list__submit-confirmation"
          role="alertdialog"
          aria-labelledby={submitTitleId}
          aria-describedby={submitDescriptionId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onCancelPausedSubmit?.();
          }}
        >
          <span>
            <strong id={submitTitleId}>Send message?</strong>
            <small id={submitDescriptionId}>
              You are about to send a message. Do you want to clear the {queue.messages.length} previously queued?
            </small>
          </span>
          <span className="queued-message-list__submit-actions">
            <button ref={confirmationRef} type="button" disabled={busy} onClick={onClearAndSubmit}>Clear queue</button>
            <button type="button" data-emphasis="primary" disabled={busy} onClick={onSubmitDespitePause}>Send message</button>
          </span>
        </div>
      ) : null}
      <div className="queued-message-list__scroll" role="list">
        {queue.messages.map((message, index) => (
          <div
            className="queued-message-list__row"
            data-status={message.status}
            data-dragging={draggingId === message.id ? "true" : undefined}
            draggable={!busy && editingId !== message.id}
            key={message.id}
            role="listitem"
            onDragStart={(event) => {
              setDraggingId(message.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", message.id);
            }}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => drop(event, message.id)}
          >
            <span className="queued-message-list__handle" aria-hidden="true"><GripVertical /></span>
            {message.status === "failed" ? <TriangleAlert className="queued-message-list__warning" aria-label="This queued message could not be sent" /> : null}
            {editingId === message.id ? (
              <input
                ref={editRef}
                className="queued-message-list__editor"
                value={editText}
                aria-label="Edit queued message"
                disabled={busy}
                onChange={(event) => setEditText(event.target.value)}
                onBlur={() => saveEdit(message)}
                onKeyDown={(event) => editKeyDown(event, message)}
              />
            ) : (
              <button className="queued-message-list__text" type="button" title={message.text} onDoubleClick={() => startEdit(message)}>{message.text}</button>
            )}
            <div className="queued-message-list__actions">
              {message.status !== "queued" ? <IconButton type="button" disabled={busy} aria-label="Retry queued message" title="Retry" onClick={() => onRetry(message)}><RotateCcw /></IconButton> : null}
              <IconButton type="button" disabled={busy || !activeRun} aria-label="Steer with queued message" title="Steer · Submit without interrupting the model" onClick={() => onSteer(message)}><Zap /></IconButton>
              <IconButton className="queued-message-list__move-action" type="button" disabled={busy || index === 0} aria-label="Move queued message up" title="Move up" onClick={() => move(message, -1)}><ArrowUp /></IconButton>
              <IconButton className="queued-message-list__move-action" type="button" disabled={busy || index === queue.messages.length - 1} aria-label="Move queued message down" title="Move down" onClick={() => move(message, 1)}><ArrowDown /></IconButton>
              <IconButton type="button" disabled={busy} aria-label="Edit queued message" title="Edit message" onClick={() => startEdit(message)}><Pencil /></IconButton>
              <IconButton type="button" disabled={busy} aria-label="Delete queued message" title="Delete queued message" onClick={() => onDelete(message)}><Trash2 /></IconButton>
            </div>
          </div>
        ))}
      </div>
      <div className="queued-message-list__footer">
        <span aria-live="polite" aria-atomic="true">{queue.messages.length} queued</span>
        <span>
          <button type="button" disabled={busy} onClick={onClear}>Clear queue</button>
          {activeRun && !queue.paused ? <button type="button" disabled={busy} onClick={onPause}>Pause queue</button> : null}
        </span>
      </div>
    </section>
  );
}
