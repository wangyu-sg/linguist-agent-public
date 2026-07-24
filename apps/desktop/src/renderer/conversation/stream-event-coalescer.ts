export const MAX_STREAM_UI_UPDATES_PER_SECOND = 20;
export const STREAM_UI_UPDATE_INTERVAL_MS = 1_000 / MAX_STREAM_UI_UPDATES_PER_SECOND;

export interface CoalescibleStreamEvent {
  type?: string;
  text?: string;
}

export interface StreamEventCoalescerOptions<T extends CoalescibleStreamEvent> {
  emit: (event: T) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Coalesces only visible assistant text. Every other stream event first flushes
 * text, then passes through immediately, so final/Decision/tool ordering never
 * waits behind a UI frame budget.
 */
export class StreamEventCoalescer<T extends CoalescibleStreamEvent> {
  #pendingEvent: T | null = null;
  #pendingText = "";
  #timer: unknown = null;
  #lastDeltaEmissionAt: number | null = null;
  readonly #emit: (event: T) => void;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => unknown;
  readonly #cancel: (handle: unknown) => void;

  constructor(options: StreamEventCoalescerOptions<T>) {
    this.#emit = options.emit;
    this.#now = options.now ?? (() => Date.now());
    this.#schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  enqueue(event: T): void {
    if (event.type !== "assistant_delta" || !event.text) {
      this.flush();
      this.#emit(event);
      return;
    }
    if (!this.#pendingEvent) this.#pendingEvent = event;
    this.#pendingText += event.text;
    this.#scheduleFlush();
  }

  flush(): void {
    this.#cancelScheduledFlush();
    if (!this.#pendingEvent || !this.#pendingText) return;
    const event = { ...this.#pendingEvent, text: this.#pendingText } as T;
    this.#pendingEvent = null;
    this.#pendingText = "";
    this.#lastDeltaEmissionAt = this.#now();
    this.#emit(event);
  }

  clear(): void {
    this.#cancelScheduledFlush();
    this.#pendingEvent = null;
    this.#pendingText = "";
  }

  #scheduleFlush(): void {
    if (this.#timer !== null) return;
    const elapsed = this.#lastDeltaEmissionAt === null ? 0 : this.#now() - this.#lastDeltaEmissionAt;
    const delayMs = Math.max(0, STREAM_UI_UPDATE_INTERVAL_MS - elapsed);
    this.#timer = this.#schedule(() => {
      this.#timer = null;
      this.flush();
    }, delayMs);
  }

  #cancelScheduledFlush(): void {
    if (this.#timer === null) return;
    this.#cancel(this.#timer);
    this.#timer = null;
  }
}
