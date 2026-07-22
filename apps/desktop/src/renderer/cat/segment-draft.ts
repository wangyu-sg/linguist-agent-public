import type {
  BatchSegment,
  SaveSegmentOutcome,
} from "../data/workspace-client.ts";

export type DraftPhase = "clean" | "dirty" | "saving" | "conflict" | "error";
export type DraftIntent = "draft" | "confirm";

export interface DraftConflict {
  serverSegment: BatchSegment;
  batchUpdatedAt: string;
  intent: DraftIntent;
}

export interface SegmentDraftSnapshot {
  canonical: BatchSegment;
  buffer: string;
  phase: DraftPhase;
  conflict: DraftConflict | null;
  error: string | null;
}

export interface DraftClock {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface SegmentDraftControllerOptions {
  segment: BatchSegment;
  save(input: { target: string; confirm: boolean; expectedSegmentUpdatedAt: string | null }): Promise<SaveSegmentOutcome>;
  onCanonical(segment: BatchSegment, batchUpdatedAt: string): void;
  autosaveDelayMs?: number;
  clock?: DraftClock;
}

export interface DraftUnloadEvent {
  returnValue: string | undefined;
  preventDefault(): void;
}

const realClock: DraftClock = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SegmentDraftController {
  #snapshot: SegmentDraftSnapshot;
  #listeners = new Set<() => void>();
  #save: SegmentDraftControllerOptions["save"];
  #onCanonical: SegmentDraftControllerOptions["onCanonical"];
  #delayMs: number;
  #clock: DraftClock;
  #timer: unknown = null;
  #pending: Promise<boolean> | null = null;
  #confirmOperation: Promise<boolean> | null = null;
  #discardAfterSave = false;

  constructor(options: SegmentDraftControllerOptions) {
    this.#snapshot = {
      canonical: options.segment,
      buffer: options.segment.target,
      phase: "clean",
      conflict: null,
      error: null,
    };
    this.#save = options.save;
    this.#onCanonical = options.onCanonical;
    this.#delayMs = options.autosaveDelayMs ?? 750;
    this.#clock = options.clock ?? realClock;
  }

  getState = (): SegmentDraftSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  hasUnsavedChanges(): boolean {
    return this.#snapshot.phase !== "clean" || this.#snapshot.buffer !== this.#snapshot.canonical.target;
  }

  edit(value: string): void {
    if (this.#snapshot.canonical.locked) return;
    this.#discardAfterSave = false;
    const conflict = this.#snapshot.conflict;
    this.#publish({
      buffer: value,
      phase: conflict ? "conflict" : this.#pending ? "saving" : value === this.#snapshot.canonical.target ? "clean" : "dirty",
      error: null,
    });
    this.#clearTimer();
    if (!conflict && value !== this.#snapshot.canonical.target) this.#scheduleAutosave();
  }

  syncCanonical(segment: BatchSegment, batchUpdatedAt: string): void {
    if (segment.id !== this.#snapshot.canonical.id) return;
    const previous = this.#snapshot.canonical;
    if (segment.updatedAt === previous.updatedAt && segment.target === previous.target && segment.status === previous.status) return;
    if (this.#snapshot.phase === "clean" || this.#snapshot.buffer === previous.target) {
      this.#publish({ canonical: segment, buffer: segment.target, phase: "clean", conflict: null, error: null });
      return;
    }
    this.#clearTimer();
    this.#publish({
      canonical: segment,
      phase: "conflict",
      conflict: { serverSegment: segment, batchUpdatedAt, intent: "draft" },
      error: null,
    });
  }

  flush(confirm = false): Promise<boolean> {
    if (!confirm) return this.#flushInternal(false);
    if (this.#confirmOperation) return this.#confirmOperation;
    const operation = this.#flushInternal(true).finally(() => {
      if (this.#confirmOperation === operation) this.#confirmOperation = null;
    });
    this.#confirmOperation = operation;
    return operation;
  }

  async #flushInternal(confirm: boolean): Promise<boolean> {
    this.#clearTimer();
    if (this.#pending) {
      await this.#pending;
      if (this.#snapshot.conflict) return false;
      this.#clearTimer();
    }
    if (this.#snapshot.canonical.locked) {
      // 锁定段无可写内容:干净即成功,不得阻断界面/scope 切换;
      // 有本地草稿时仍需用户显式放弃(CAT 错误提示提供"放弃修改")。
      return !this.#snapshot.conflict && this.#snapshot.buffer === this.#snapshot.canonical.target;
    }
    if (this.#snapshot.conflict) return false;
    if (!confirm && this.#snapshot.buffer === this.#snapshot.canonical.target) return true;
    return this.#startSave(confirm);
  }

  async retry(): Promise<boolean> {
    const conflict = this.#snapshot.conflict;
    if (!conflict) return this.flush(false);
    this.#publish({
      canonical: conflict.serverSegment,
      phase: this.#snapshot.buffer === conflict.serverSegment.target ? "clean" : "dirty",
      conflict: null,
      error: null,
    });
    return this.flush(conflict.intent === "confirm");
  }

  useServer(): void {
    this.#clearTimer();
    const canonical = this.#snapshot.conflict?.serverSegment ?? this.#snapshot.canonical;
    this.#discardAfterSave = true;
    this.#publish({ canonical, buffer: canonical.target, phase: this.#pending ? "saving" : "clean", conflict: null, error: null });
  }

  cancel(): void {
    this.#clearTimer();
    this.#discardAfterSave = true;
    this.#publish({
      buffer: this.#snapshot.canonical.target,
      phase: this.#pending ? "saving" : "clean",
      conflict: null,
      error: null,
    });
  }

  dispose(): void {
    this.#clearTimer();
    this.#listeners.clear();
  }

  #scheduleAutosave(): void {
    this.#clearTimer();
    this.#timer = this.#clock.schedule(() => {
      this.#timer = null;
      void this.flush(false);
    }, this.#delayMs);
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    this.#clock.cancel(this.#timer);
    this.#timer = null;
  }

  #startSave(confirm: boolean): Promise<boolean> {
    const target = this.#snapshot.buffer;
    const expectedSegmentUpdatedAt = this.#snapshot.canonical.updatedAt ?? null;
    this.#publish({ phase: "saving", conflict: null, error: null });
    const operation = this.#save({ target, confirm, expectedSegmentUpdatedAt })
      .then((outcome) => {
        if (outcome.kind === "conflict") {
          this.#onCanonical(outcome.currentSegment, outcome.batchUpdatedAt);
          if (this.#discardAfterSave) {
            this.#publish({
              canonical: outcome.currentSegment,
              buffer: outcome.currentSegment.target,
              phase: "clean",
              conflict: null,
              error: null,
            });
          } else {
            this.#publish({
              canonical: outcome.currentSegment,
              phase: "conflict",
              conflict: {
                serverSegment: outcome.currentSegment,
                batchUpdatedAt: outcome.batchUpdatedAt,
                intent: confirm ? "confirm" : "draft",
              },
              error: null,
            });
          }
          return false;
        }

        this.#onCanonical(outcome.segment, outcome.batchUpdatedAt);
        if (
          confirm
          && (
            outcome.segment.status !== "confirmed"
            || !outcome.result.changedSegmentIds.includes(outcome.segment.id)
            || outcome.result.skippedLockedIds.includes(outcome.segment.id)
          )
        ) {
          this.#publish({
            canonical: outcome.segment,
            buffer: this.#snapshot.buffer === target ? outcome.segment.target : this.#snapshot.buffer,
            phase: "error",
            conflict: null,
            error: "服务端没有确认此句段。请检查锁定状态后重试。",
          });
          return false;
        }
        if (this.#discardAfterSave || this.#snapshot.buffer === target) {
          this.#discardAfterSave = false;
          this.#publish({
            canonical: outcome.segment,
            buffer: outcome.segment.target,
            phase: "clean",
            conflict: null,
            error: null,
          });
        } else {
          this.#publish({ canonical: outcome.segment, phase: "dirty", conflict: null, error: null });
          this.#scheduleAutosave();
        }
        return true;
      })
      .catch((error) => {
        this.#publish({ phase: "error", error: message(error) });
        return false;
      })
      .finally(() => {
        if (this.#pending === operation) this.#pending = null;
      });
    this.#pending = operation;
    return operation;
  }

  #publish(patch: Partial<SegmentDraftSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

export function guardDraftUnload(controller: SegmentDraftController, event: DraftUnloadEvent): void {
  if (!controller.hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
  void controller.flush(false);
}
