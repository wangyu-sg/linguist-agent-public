import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkspaceAPIError,
  workspaceClient,
  type BatchSegment,
  type SaveSegmentOutcome,
  type SegmentDetectedTag,
  type SegmentEvidenceSnapshot,
} from "../src/renderer/data/workspace-client.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";
import {
  filterSegments,
  insertLiteralAt,
  nextEditableSegmentId,
  plainTextLength,
  relocateDetectedTags,
  segmentNumber,
  tokensFromDetectedTags,
} from "../src/renderer/cat/cat-model.ts";
import {
  guardDraftUnload,
  SegmentDraftController,
  type DraftClock,
} from "../src/renderer/cat/segment-draft.ts";

const at = "2026-07-16T00:00:00.000Z";

function segment(overrides: Partial<BatchSegment> = {}): BatchSegment {
  return {
    index: 1,
    id: "segment-one",
    source: "源文 {0}",
    target: "Target {0}",
    rawSource: "源文 {0}",
    rawTarget: "Target {0}",
    locked: false,
    status: "draft",
    duplicateKey: "source-one",
    placeholderCount: 1,
    unresolvedPlaceholderCount: 0,
    updatedAt: at,
    ...overrides,
  };
}

function saved(current: BatchSegment, revision: string, confirm = false): SaveSegmentOutcome {
  const updated = { ...current, status: confirm ? "confirmed" as const : current.target ? "draft" as const : "new" as const, updatedAt: revision };
  return {
    kind: "saved",
    segment: updated,
    batchUpdatedAt: revision,
    result: {
      batchId: "batch-one",
      requestedSegmentId: current.id,
      changedSegmentIds: [current.id],
      skippedLockedIds: [],
      skippedDuplicateIds: [],
      propagated: false,
      duplicateGroupSize: 1,
      target: updated.target,
      status: updated.status,
      segment: updated,
      batchUpdatedAt: revision,
    },
  };
}

class FakeClock implements DraftClock {
  now = 0;
  nextId = 1;
  tasks = new Map<number, { at: number; callback: () => void }>();

  schedule(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= this.now)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) return;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function evidenceSnapshot(segmentId: string): SegmentEvidenceSnapshot {
  return {
    projectId: "project-one",
    batchId: "batch-one",
    segmentId,
    source: `Source ${segmentId}`,
    tmMatches: [{
      id: `tm-${segmentId}`,
      source: "Source",
      target: "Target",
      srcLang: "en",
      tgtLang: "zh",
      origin: "reviewed",
      score: 1,
      matchType: "exact",
      effectiveAuthority: "reviewed_tm",
    }],
    termbaseMatches: [],
    glossaryMatches: [],
    cards: [],
    summary: { tm: 1, tmExact: 1, tmFuzzy: 0, termbase: 0, glossary: 0 },
  };
}

test("renders canonical one-based segment indexes without shifting companion scope", () => {
  assert.equal(segmentNumber(segment({ index: 1 })), "001");
});

test("filters all 10k rows without slicing and navigates to the next editable row", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => segment({
    index: index + 1,
    id: `segment-${index + 1}`,
    source: index % 2 ? `needle ${index}` : `other ${index}`,
    target: `target ${index}`,
    status: index === 2 ? "confirmed" : "draft",
    locked: index === 1,
  }));
  const matches = filterSegments(rows, "needle");
  assert.equal(matches.length, 5_000);
  assert.equal(matches.at(-1)?.id, "segment-10000");
  assert.equal(nextEditableSegmentId(rows, "segment-1"), "segment-4", "locked and confirmed rows are skipped");
});

test("reconstructs chips only from server-owned detected tag positions", () => {
  const tokens = tokensFromDetectedTags("Hello {0}!", [{
    literal: "{0}",
    kind: "placeholder-num",
    id: "0",
    index: 6,
    pairKey: "placeholder-num:0:tag",
    tone: "num",
    label: "{0}",
  }]);
  assert.deepEqual(tokens, [
    { kind: "text", value: "Hello " },
    { kind: "tag", tag: assertTag(tokens) },
    { kind: "text", value: "!" },
  ]);
});

function assertTag(tokens: ReturnType<typeof tokensFromDetectedTags>) {
  const token = tokens[1];
  assert.equal(token?.kind, "tag");
  return token.tag;
}

function detectedTag(literal: string, index: number, overrides: Partial<SegmentDetectedTag> = {}): SegmentDetectedTag {
  return {
    literal,
    kind: "placeholder-num",
    id: null,
    index,
    pairKey: `placeholder-num:literal:${literal}`,
    tone: "num",
    label: literal,
    ...overrides,
  };
}

test("chip editor re-chipifies edited text using only server-owned tag literals", () => {
  // After the user moves text around, the server-reported tag positions are stale;
  // relocation re-positions the same literals without detecting new patterns.
  const known = [detectedTag("{0}", 6), detectedTag("{1}", 10, { pairKey: "placeholder-num:1:tag" })];
  const edited = relocateDetectedTags("译文 {1} 然后 {0} 结束", known);
  assert.deepEqual(edited.map((tag) => [tag.literal, tag.index]), [["{1}", 3], ["{0}", 10]]);
  assert.equal(edited[0]?.pairKey, "placeholder-num:1:tag", "tag identity follows the literal");

  // A literal the server never reported stays plain text — the renderer must not detect tags.
  const unknown = relocateDetectedTags("输入 {9} 不是已知 tag", known);
  assert.deepEqual(unknown, []);

  // Round trip: rebuilding chips and serializing them back must reproduce the exact literal,
  // which is what the editor writes into SegmentDraftController.edit().
  const text = "a {0} b {1}";
  const literal = tokensFromDetectedTags(text, relocateDetectedTags(text, known))
    .map((token) => (token.kind === "text" ? token.value : token.tag.literal))
    .join("");
  assert.equal(literal, text);
});

test("chip editor renders real newlines as ↵ chips with the newline tone", () => {
  const tags = relocateDetectedTags("第一行\n第二行", []);
  assert.equal(tags.length, 1);
  assert.deepEqual(
    { literal: tags[0]!.literal, index: tags[0]!.index, tone: tags[0]!.tone, label: tags[0]!.label },
    { literal: "\n", index: 3, tone: "newline", label: "↵" },
  );
  const tokens = tokensFromDetectedTags("第一行\n第二行", tags);
  assert.deepEqual(tokens.map((token) => token.kind), ["text", "tag", "text"]);
  const roundTrip = tokens.map((token) => (token.kind === "text" ? token.value : token.tag.literal)).join("");
  assert.equal(roundTrip, "第一行\n第二行", "Enter 插入的换行序列化后必须还原为 \\n");
});

test("overlapping tag literals claim longest first and never double-claim", () => {
  const known = [detectedTag("{0}", 0), detectedTag("{0:cfg}", 0, { pairKey: "placeholder-num:0:long" })];
  const tags = relocateDetectedTags("{0:cfg} 和 {0}", known);
  assert.deepEqual(tags.map((tag) => [tag.literal, tag.index]), [["{0:cfg}", 0], ["{0}", 10]]);
});

test("character counts exclude tag literals and newline chips", () => {
  const known = [detectedTag("{0}", 0)];
  assert.equal(plainTextLength("译文 {0}\n次", known), 4, "译 文 空格 次，{0} 与换行不计入");
  assert.equal(plainTextLength("{0}{0}", known), 0);
  assert.equal(plainTextLength("plain text", []), 10);
  assert.equal(plainTextLength("", []), 0);
});

test("insertLiteralAt splices at the caret and clamps out-of-range offsets", () => {
  assert.deepEqual(insertLiteralAt("Target {0}", 7, "TM "), { value: "Target TM {0}", caret: 10 });
  assert.deepEqual(insertLiteralAt("abc", 99, "尾"), { value: "abc尾", caret: 4 });
  assert.deepEqual(insertLiteralAt("abc", -5, "头"), { value: "头abc", caret: 1 });
  assert.deepEqual(insertLiteralAt("", 0, "Target"), { value: "Target", caret: 6 });
});

test("750ms autosave coalesces typing and sends the latest buffer", async () => {
  const clock = new FakeClock();
  const calls: Array<{ target: string; confirm: boolean; expectedSegmentUpdatedAt: string | null }> = [];
  const controller = new SegmentDraftController({
    segment: segment(),
    clock,
    save: async (input) => {
      calls.push(input);
      return saved({ ...segment(), target: input.target }, "rev-one", input.confirm);
    },
    onCanonical: () => undefined,
  });

  controller.edit("First");
  clock.advance(500);
  controller.edit("Latest");
  clock.advance(749);
  await settle();
  assert.equal(calls.length, 0);
  clock.advance(1);
  await settle();
  assert.deepEqual(calls, [{ target: "Latest", confirm: false, expectedSegmentUpdatedAt: at }]);
  assert.equal(controller.getState().buffer, "Latest");
  assert.equal(controller.getState().phase, "clean");
});

test("navigation waits for a durable CAT draft and aborts when saving fails", async () => {
  const originalListTasks = workspaceClient.listTasks;
  let listCalls = 0;
  workspaceClient.listTasks = async () => {
    listCalls += 1;
    return { schemaVersion: 1, tasks: [] };
  };
  try {
    const store = new WorkspaceStore();
    let allow = false;
    store.setBeforeScopeTransition(async () => allow);

    await store.selectProject("project-one");
    assert.equal(store.getState().projectId, null);
    assert.equal(listCalls, 0, "scope mutation must not start before the draft is durable");

    allow = true;
    await store.selectProject("project-one");
    assert.equal(store.getState().projectId, "project-one");
    assert.equal(listCalls, 1);
    store.close();
  } finally {
    workspaceClient.listTasks = originalListTasks;
  }
});

test("window unload is blocked while a sub-750ms draft is flushed", async () => {
  const savedDraft = deferred<SaveSegmentOutcome>();
  let calls = 0;
  const controller = new SegmentDraftController({
    segment: segment(),
    save: async () => {
      calls += 1;
      return savedDraft.promise;
    },
    onCanonical: () => undefined,
  });
  controller.edit("Typed just before close");
  const event = {
    prevented: false,
    returnValue: undefined as string | undefined,
    preventDefault() { this.prevented = true; },
  };

  guardDraftUnload(controller, event);
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, "");
  assert.equal(calls, 1, "close guard must start the durable save without waiting for the autosave timer");

  savedDraft.resolve(saved({ ...segment(), target: "Typed just before close" }, "close-rev"));
  await settle();
  assert.equal(controller.getState().phase, "clean");
});

test("an in-flight ack advances revision without erasing newer typing", async () => {
  const clock = new FakeClock();
  const first = deferred<SaveSegmentOutcome>();
  const calls: Array<{ target: string; confirm: boolean; expectedSegmentUpdatedAt: string | null }> = [];
  const controller = new SegmentDraftController({
    segment: segment(),
    clock,
    save: async (input) => {
      calls.push(input);
      if (calls.length === 1) return first.promise;
      return saved({ ...segment(), target: input.target, updatedAt: "rev-one" }, "rev-two", input.confirm);
    },
    onCanonical: () => undefined,
  });

  controller.edit("A");
  const firstSave = controller.flush(false);
  controller.edit("B");
  first.resolve(saved({ ...segment(), target: "A" }, "rev-one"));
  assert.equal(await firstSave, true);
  assert.equal(controller.getState().buffer, "B");
  clock.advance(750);
  await settle();
  assert.deepEqual(calls.map((call) => [call.target, call.expectedSegmentUpdatedAt]), [
    ["A", at],
    ["B", "rev-one"],
  ]);
  assert.equal(controller.getState().phase, "clean");
});

test("Command-Return queues confirmation behind an active autosave", async () => {
  const first = deferred<SaveSegmentOutcome>();
  const calls: Array<{ target: string; confirm: boolean; expectedSegmentUpdatedAt: string | null }> = [];
  const controller = new SegmentDraftController({
    segment: segment(),
    save: async (input) => {
      calls.push(input);
      if (calls.length === 1) return first.promise;
      return saved({ ...segment(), target: input.target, updatedAt: "rev-one" }, "rev-two", input.confirm);
    },
    onCanonical: () => undefined,
  });

  controller.edit("Confirmed target");
  const autosave = controller.flush(false);
  const confirmation = controller.flush(true);
  first.resolve(saved({ ...segment(), target: "Confirmed target" }, "rev-one"));
  assert.equal(await autosave, true);
  assert.equal(await confirmation, true);
  assert.deepEqual(calls.map((call) => [call.confirm, call.expectedSegmentUpdatedAt]), [
    [false, at],
    [true, "rev-one"],
  ]);
  assert.equal(controller.getState().canonical.status, "confirmed");
});

test("repeated Command-Return shares one confirmation request", async () => {
  const confirmation = deferred<SaveSegmentOutcome>();
  const calls: Array<{ target: string; confirm: boolean; expectedSegmentUpdatedAt: string | null }> = [];
  const controller = new SegmentDraftController({
    segment: segment(),
    save: async (input) => {
      calls.push(input);
      return confirmation.promise;
    },
    onCanonical: () => undefined,
  });

  controller.edit("Confirmed once");
  const first = controller.flush(true);
  const second = controller.flush(true);
  assert.equal(calls.length, 1);
  confirmation.resolve(saved({ ...segment(), target: "Confirmed once" }, "rev-confirmed", true));
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls.length, 1);
});

test("typing during confirmation remains a dirty local buffer", async () => {
  const confirmation = deferred<SaveSegmentOutcome>();
  const controller = new SegmentDraftController({
    segment: segment(),
    save: async () => confirmation.promise,
    onCanonical: () => undefined,
  });

  controller.edit("Confirm this version");
  const pending = controller.flush(true);
  controller.edit("Newer local edit");
  confirmation.resolve(saved({ ...segment(), target: "Confirm this version" }, "rev-confirmed", true));
  assert.equal(await pending, true);
  assert.equal(controller.getState().canonical.status, "confirmed");
  assert.equal(controller.getState().buffer, "Newer local edit");
  assert.equal(controller.getState().phase, "dirty");
});

test("409 keeps the local buffer; server choice and retry are explicit", async () => {
  let calls = 0;
  const server = segment({ target: "Server", updatedAt: "server-rev" });
  const controller = new SegmentDraftController({
    segment: segment(),
    save: async (input) => {
      calls += 1;
      if (calls === 1) return { kind: "conflict", error: "segment_revision_conflict", currentSegment: server, batchUpdatedAt: "batch-rev" };
      return saved({ ...server, target: input.target }, "retry-rev", input.confirm);
    },
    onCanonical: () => undefined,
  });
  controller.edit("Local");
  assert.equal(await controller.flush(false), false);
  assert.equal(controller.getState().phase, "conflict");
  assert.equal(controller.getState().buffer, "Local");
  assert.equal(await controller.retry(), true);
  assert.equal(controller.getState().buffer, "Local");
  assert.equal(controller.getState().canonical.updatedAt, "retry-rev");

  const discard = new SegmentDraftController({
    segment: segment(),
    save: async () => ({ kind: "conflict", error: "segment_revision_conflict", currentSegment: server, batchUpdatedAt: "batch-rev" }),
    onCanonical: () => undefined,
  });
  discard.edit("Discard me");
  await discard.flush(false);
  discard.useServer();
  assert.equal(discard.getState().buffer, "Server");
  assert.equal(discard.getState().phase, "clean");
});

test("Esc cancels an unsent buffer and a locked 200 cannot advance", async () => {
  const clock = new FakeClock();
  let calls = 0;
  const controller = new SegmentDraftController({
    segment: segment(),
    clock,
    save: async () => { calls += 1; return saved(segment(), "never"); },
    onCanonical: () => undefined,
  });
  controller.edit("Unsent");
  controller.cancel();
  clock.advance(1_000);
  await settle();
  assert.equal(calls, 0);
  assert.equal(controller.getState().buffer, "Target {0}");

  const locked = segment({ locked: true, target: "Server locked", updatedAt: "locked-rev" });
  const raced = new SegmentDraftController({
    segment: segment(),
    save: async () => ({
      ...saved(locked, "locked-rev", false),
      result: {
        ...saved(locked, "locked-rev", false).result,
        changedSegmentIds: [],
        skippedLockedIds: [locked.id],
      },
    }),
    onCanonical: () => undefined,
  });
  raced.edit("Try confirm");
  assert.equal(await raced.flush(true), false);
  assert.equal(raced.getState().phase, "error");
});

test("a clean locked segment flushes as success so scope transitions are never blocked", async () => {
  const locked = segment({ locked: true, target: "Server locked" });
  let calls = 0;
  const controller = new SegmentDraftController({
    segment: locked,
    save: async () => { calls += 1; return saved(locked, "never"); },
    onCanonical: () => undefined,
  });
  // 干净锁定段:无可保存内容,flush 成功且不发任何写请求。
  assert.equal(await controller.flush(false), true);
  assert.equal(await controller.flush(true), true);
  assert.equal(calls, 0);
  // edit() 在锁定段上是 no-op,buffer 永远保持 canonical。
  controller.edit("local change");
  assert.equal(controller.getState().buffer, "Server locked");
  assert.equal(await controller.flush(false), true);
  assert.equal(calls, 0);
});

test("segment client always sends compact mode and an explicit revision", async () => {
  const originalWindow = globalThis.window;
  let captured: unknown;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            captured = input;
            const current = segment({ target: "Draft", updatedAt: "rev-one" });
            const outcome = saved(current, "rev-one");
            const { kind: _kind, ...data } = outcome;
            return { ok: true, status: 200, data };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.saveSegment("project one", "batch one", "segment one", {
      target: "Draft",
      confirm: false,
      expectedSegmentUpdatedAt: null,
    });
    assert.deepEqual(captured, {
      method: "POST",
      path: "/api/projects/project%20one/batches/batch%20one/segments/segment%20one",
      body: {
        target: "Draft",
        confirm: false,
        propagateDuplicates: false,
        reason: "Electron CAT draft autosave",
        changeType: "translation",
        responseMode: "segment",
        expectedSegmentUpdatedAt: null,
      },
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("segment evidence client uses the canonical scoped route", async () => {
  const originalWindow = globalThis.window;
  const snapshot = evidenceSnapshot("segment one");
  let captured: unknown;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            captured = input;
            return { ok: true, status: 200, data: snapshot };
          },
        },
      },
    },
  });
  try {
    assert.equal(await workspaceClient.fetchSegmentEvidence("project one", "batch one", "segment one"), snapshot);
    assert.deepEqual(captured, {
      method: "GET",
      path: "/api/projects/project%20one/batches/batch%20one/segments/segment%20one/evidence",
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("only the canonical 409 shape is treated as a revision conflict", async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: { api: { request: async () => ({ ok: false, status: 409, data: { error: "different_conflict" } }) } },
    },
  });
  try {
    await assert.rejects(
      workspaceClient.saveSegment("p", "b", "s", { target: "x", confirm: false, expectedSegmentUpdatedAt: null }),
      (error) => error instanceof WorkspaceAPIError && error.status === 409,
    );
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("Batch-ready requests only the canonical summary projection", async () => {
  const originalWindow = globalThis.window;
  let captured: unknown;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            captured = input;
            return { ok: true, status: 200, data: { summary: {} } };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.openBatchSummary("project one", "batch one");
    assert.deepEqual(captured, {
      method: "GET",
      path: "/api/projects/project%20one/batches/batch%20one?responseMode=summary",
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("store applies compact ack only to the current batch and invalidates delivery", async () => {
  const originalOpenBatch = workspaceClient.openBatch;
  const originalOpenBatchSummary = workspaceClient.openBatchSummary;
  workspaceClient.openBatch = async () => ({
    batch: {
      schemaVersion: 1,
      format: "xliff_1_2",
      projectId: "project-one",
      batchId: "batch-one",
      sourceFile: "batch.xlf",
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      createdAt: at,
      updatedAt: at,
      segments: [segment()],
    },
    delivery: { ready: true },
  });
  workspaceClient.openBatchSummary = async (projectId, batchId) => ({
    summary: {
      schemaVersion: 1,
      projectId,
      batchId,
      format: "xliff_1_2",
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      segments: 1,
      confirmed: 0,
      draft: 1,
      new: 0,
      locked: 0,
      updatedAt: at,
    },
  });
  try {
    const store = new WorkspaceStore();
    await store.openBatch("project-one", "batch-one");
    assert.equal(store.getState().batch, null, "Batch-ready must keep the full CAT payload deferred");
    await store.ensureBatchLoaded();
    store.applyCanonicalSegment("project-one", "batch-one", segment({ target: "Saved", updatedAt: "rev-two" }), "rev-two");
    assert.equal(store.getState().batch?.batch.segments[0]?.target, "Saved");
    assert.equal(store.getState().batch?.delivery, null);
    store.applyCanonicalSegment("project-two", "batch-one", segment({ target: "Wrong" }), "rev-three");
    assert.equal(store.getState().batch?.batch.segments[0]?.target, "Saved");
  } finally {
    workspaceClient.openBatch = originalOpenBatch;
    workspaceClient.openBatchSummary = originalOpenBatchSummary;
  }
});

test("segment evidence loading is scoped, race-safe, and retryable", async () => {
  const originalOpenBatchSummary = workspaceClient.openBatchSummary;
  const originalFetchSegmentEvidence = workspaceClient.fetchSegmentEvidence;
  const first = deferred<SegmentEvidenceSnapshot>();
  const second = deferred<SegmentEvidenceSnapshot>();
  workspaceClient.openBatchSummary = async () => ({
    summary: {
      schemaVersion: 1,
      projectId: "project-one",
      batchId: "batch-one",
      format: "xliff_1_2",
      sourceLanguage: "en",
      targetLanguage: "zh",
      segments: 2,
      confirmed: 0,
      draft: 0,
      new: 2,
      locked: 0,
      updatedAt: at,
    },
  });
  workspaceClient.fetchSegmentEvidence = async (_projectId, _batchId, segmentId) => (
    segmentId === "segment-one" ? first.promise : second.promise
  );
  try {
    const store = new WorkspaceStore();
    await store.openBatch("project-one", "batch-one");
    const firstLoad = store.loadSegmentEvidence("project-one", "batch-one", "segment-one");
    const secondLoad = store.loadSegmentEvidence("project-one", "batch-one", "segment-two");
    assert.deepEqual(store.getState().segmentEvidence, {
      status: "loading",
      scope: { projectId: "project-one", batchId: "batch-one", segmentId: "segment-two" },
      snapshot: null,
      error: null,
    });

    second.resolve(evidenceSnapshot("segment-two"));
    await secondLoad;
    first.resolve(evidenceSnapshot("segment-one"));
    await firstLoad;
    assert.equal(store.getState().segmentEvidence.status, "ready");
    assert.equal(store.getState().segmentEvidence.snapshot?.segmentId, "segment-two", "late evidence cannot replace the current segment");

    workspaceClient.fetchSegmentEvidence = async () => { throw new Error("Evidence unavailable"); };
    await store.loadSegmentEvidence("project-one", "batch-one", "segment-three");
    assert.equal(store.getState().segmentEvidence.status, "error");
    assert.equal(store.getState().segmentEvidence.error, "Evidence unavailable");

    workspaceClient.fetchSegmentEvidence = async () => evidenceSnapshot("segment-three");
    await store.loadSegmentEvidence("project-one", "batch-one", "segment-three");
    assert.equal(store.getState().segmentEvidence.status, "ready");
    assert.equal(store.getState().segmentEvidence.snapshot?.segmentId, "segment-three");

    const late = deferred<SegmentEvidenceSnapshot>();
    workspaceClient.fetchSegmentEvidence = async () => late.promise;
    const lateLoad = store.loadSegmentEvidence("project-one", "batch-one", "segment-four");
    await store.openBatch("project-one", "batch-two");
    late.resolve(evidenceSnapshot("segment-four"));
    await lateLoad;
    assert.equal(store.getState().batchId, "batch-two");
    assert.deepEqual(store.getState().segmentEvidence, {
      status: "idle",
      scope: null,
      snapshot: null,
      error: null,
    }, "a late response from the previous Batch scope must be discarded");
    store.close();
  } finally {
    workspaceClient.openBatchSummary = originalOpenBatchSummary;
    workspaceClient.fetchSegmentEvidence = originalFetchSegmentEvidence;
  }
});
