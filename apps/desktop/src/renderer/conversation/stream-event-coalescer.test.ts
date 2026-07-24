import { STREAM_UI_UPDATE_INTERVAL_MS, StreamEventCoalescer } from "./stream-event-coalescer.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

interface Event {
  type: string;
  text?: string;
  marker?: string;
}

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  return {
    now: () => now,
    schedule: (callback: () => void, delayMs: number) => {
      const id = ++nextId;
      timers.set(id, { dueAt: now + delayMs, callback });
      return id;
    },
    cancel: (handle: unknown) => { timers.delete(handle as number); },
    advance: (milliseconds: number) => {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.dueAt;
        timer.callback();
      }
      now = target;
    },
  };
}

test("coalesces assistant deltas to at most 20 UI updates per second without dropping text", () => {
  const clock = fakeClock();
  const emitted: Array<{ at: number; event: Event }> = [];
  const coalescer = new StreamEventCoalescer<Event>({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    emit: (event) => emitted.push({ at: clock.now(), event }),
  });

  coalescer.enqueue({ type: "assistant_delta", text: "A", marker: "first" });
  coalescer.enqueue({ type: "assistant_delta", text: "B", marker: "second" });
  clock.advance(STREAM_UI_UPDATE_INTERVAL_MS - 1);
  assert.deepEqual(emitted, []);
  clock.advance(1);
  assert.deepEqual(emitted, [{ at: STREAM_UI_UPDATE_INTERVAL_MS, event: { type: "assistant_delta", text: "AB", marker: "first" } }]);

  coalescer.enqueue({ type: "assistant_delta", text: "C" });
  clock.advance(STREAM_UI_UPDATE_INTERVAL_MS - 1);
  assert.equal(emitted.length, 1);
  clock.advance(1);
  assert.deepEqual(emitted.map((row) => row.at), [STREAM_UI_UPDATE_INTERVAL_MS, STREAM_UI_UPDATE_INTERVAL_MS * 2]);
  assert.equal(emitted[1]?.event.text, "C");
});

test("flushes pending text before final, Decision, and tool events without delaying their order", () => {
  const clock = fakeClock();
  const emitted: Event[] = [];
  const coalescer = new StreamEventCoalescer<Event>({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    emit: (event) => emitted.push(event),
  });

  coalescer.enqueue({ type: "assistant_delta", text: "partial" });
  coalescer.enqueue({ type: "tool_start", marker: "tool-one" });
  coalescer.enqueue({ type: "assistant_delta", text: " final" });
  coalescer.enqueue({ type: "permission_request", marker: "decision-one" });
  coalescer.enqueue({ type: "assistant_delta", text: " answer" });
  coalescer.enqueue({ type: "assistant_final", marker: "final-one" });

  assert.deepEqual(emitted, [
    { type: "assistant_delta", text: "partial" },
    { type: "tool_start", marker: "tool-one" },
    { type: "assistant_delta", text: " final" },
    { type: "permission_request", marker: "decision-one" },
    { type: "assistant_delta", text: " answer" },
    { type: "assistant_final", marker: "final-one" },
  ]);
});

test("explicit flush preserves pending text before a background handoff", () => {
  const clock = fakeClock();
  const emitted: Event[] = [];
  const coalescer = new StreamEventCoalescer<Event>({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    emit: (event) => emitted.push(event),
  });

  coalescer.enqueue({ type: "assistant_delta", text: "keep me" });
  coalescer.flush();
  clock.advance(STREAM_UI_UPDATE_INTERVAL_MS * 2);
  assert.deepEqual(emitted, [{ type: "assistant_delta", text: "keep me" }]);
});

test("clear drops obsolete pending text before a Task page switch", () => {
  const clock = fakeClock();
  const emitted: Event[] = [];
  const coalescer = new StreamEventCoalescer<Event>({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    emit: (event) => emitted.push(event),
  });

  coalescer.enqueue({ type: "assistant_delta", text: "old Task" });
  coalescer.clear();
  clock.advance(STREAM_UI_UPDATE_INTERVAL_MS * 2);
  assert.deepEqual(emitted, []);
});
