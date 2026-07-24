import {
  COMPOSER_SINGLE_LINE_TEXT_BUFFER_PX,
  deriveAgentComposerPresentation,
  formatRunElapsed,
  selectCanonicalActiveRun,
  shouldUseSingleLineComposer,
} from "./composer-model.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

test("single-line composer requires text plus the source-derived safety buffer to fit", () => {
  assert.equal(shouldUseSingleLineComposer({
    availableInputWidth: 200,
    measuredTextWidth: 200 - COMPOSER_SINGLE_LINE_TEXT_BUFFER_PX,
    hasLineBreak: false,
  }), true);
  assert.equal(shouldUseSingleLineComposer({
    availableInputWidth: 200,
    measuredTextWidth: 200 - COMPOSER_SINGLE_LINE_TEXT_BUFFER_PX + 1,
    hasLineBreak: false,
  }), false);
});

test("composer expands for semantic multiline states without clipping content", () => {
  const base = { availableInputWidth: 640, measuredTextWidth: 40, hasLineBreak: false };
  assert.equal(shouldUseSingleLineComposer({ ...base, hasLineBreak: true }), false);
  assert.equal(shouldUseSingleLineComposer({ ...base, hasVisibleAttachments: true }), false);
  assert.equal(shouldUseSingleLineComposer({ ...base, isVoiceActive: true }), false);
});

test("explicit layout locks are deterministic and missing measurements start single-line", () => {
  assert.equal(shouldUseSingleLineComposer({ availableInputWidth: null, measuredTextWidth: 900, hasLineBreak: false }), true);
  assert.equal(shouldUseSingleLineComposer({ availableInputWidth: 20, measuredTextWidth: 900, hasLineBreak: false, lockedLayout: "single-line" }), true);
  assert.equal(shouldUseSingleLineComposer({ availableInputWidth: 900, measuredTextWidth: 20, hasLineBreak: false, lockedLayout: "multiline" }), false);
});

test("Composer actions never infer an active Run from historical stoppability", () => {
  const completed = { id: "run-complete", stopAvailable: true };
  const active = { id: "run-active", stopAvailable: true };

  assert.equal(selectCanonicalActiveRun(null, [completed, active]), null);
  assert.equal(selectCanonicalActiveRun("missing-run", [completed, active]), null);
  assert.equal(selectCanonicalActiveRun("run-active", [completed, active]), active);
});

test("Batch first turn is a multiline Task-creation composer, not a form textarea", () => {
  const presentation = deriveAgentComposerPresentation({ context: "batch-intent" });
  assert.equal(presentation.layoutLock, "multiline");
  assert.equal(presentation.placeholder, "描述需要完成的工作…");
  assert.equal(presentation.action, "send");
  assert.equal(presentation.canSend, true);
});

test("active Project and standalone Tasks use keyboard-delimited steer and follow-up", () => {
  const presentation = deriveAgentComposerPresentation({
    context: "task",
    hasHistory: true,
    runStatus: "active",
    stopAvailable: true,
    hasDraft: true,
    activeDelivery: "follow_up",
  });
  assert.equal(presentation.action, "follow_up");
  assert.equal(presentation.canSend, true);
  assert.equal(presentation.placeholder, "安排当前 Run 完成后的下一步…");
});

test("active standalone turns expose canonical Pi steer and follow-up delivery", () => {
  const steer = deriveAgentComposerPresentation({
    context: "task",
    hasHistory: true,
    runStatus: "active",
    stopAvailable: true,
    hasDraft: true,
    activeDelivery: "steer",
  });
  assert.equal(steer.action, "steer");
  assert.equal(steer.canSend, true);
  assert.equal(steer.placeholder, "补充要求或方向…");

  const followUp = deriveAgentComposerPresentation({
    context: "task",
    hasHistory: true,
    runStatus: "active",
    stopAvailable: true,
    hasDraft: true,
    activeDelivery: "follow_up",
  });
  assert.equal(followUp.action, "follow_up");
  assert.equal(followUp.canSend, true);
  assert.equal(followUp.placeholder, "安排当前 Run 完成后的下一步…");
});

test("Task context chooses specialist, segment, first-turn, then follow-up placeholders", () => {
  assert.equal(deriveAgentComposerPresentation({ context: "task", recipientName: "LQA Specialist" }).placeholder, "给 LQA Specialist 留言…");
  assert.equal(deriveAgentComposerPresentation({ context: "task", focusedSegmentId: "seg-645" }).placeholder, "说明这一句要如何处理…");
  assert.equal(deriveAgentComposerPresentation({ context: "task" }).placeholder, "输入消息…");
  assert.equal(deriveAgentComposerPresentation({ context: "task", hasHistory: true }).placeholder, "输入消息…");
});

test("projectless Chat uses general Chat language instead of internal CAT terminology", () => {
  const chat = deriveAgentComposerPresentation({ context: "task", isStandalone: true });
  assert.equal(chat.placeholder, "输入消息…");
  assert.equal(chat.layoutLock, "multiline");
});

test("first Task turns keep a semantic multiline Composer while follow-ups may compact", () => {
  const firstTurn = deriveAgentComposerPresentation({ context: "task" });
  const followUp = deriveAgentComposerPresentation({ context: "task", hasHistory: true });
  assert.equal(firstTurn.layoutLock, "multiline");
  assert.equal(followUp.layoutLock, null);
});

test("run elapsed formatting stays compact and rejects invalid timestamps", () => {
  const start = "2026-07-16T00:00:00.000Z";
  assert.equal(formatRunElapsed(start, "2026-07-16T00:00:07.000Z"), "7s");
  assert.equal(formatRunElapsed(start, "2026-07-16T00:02:07.000Z"), "2m 7s");
  assert.equal(formatRunElapsed(start, "2026-07-16T03:02:07.000Z"), "3h 2m");
  assert.equal(formatRunElapsed("invalid"), null);
});

test("send button state stays compact while shortcuts expose delivery", () => {
  const idle = deriveAgentComposerPresentation({ context: "task", hasHistory: true });
  assert.equal(idle.sendButton.state, "send");

  const stop = deriveAgentComposerPresentation({ context: "task", hasHistory: true, runStatus: "active", stopAvailable: true });
  assert.equal(stop.sendButton.state, "stop");
  assert.equal(stop.sendButton.tooltip, "停止当前 Run (Esc)");

  const queue = deriveAgentComposerPresentation({ context: "task", hasHistory: true, runStatus: "active", stopAvailable: true, hasDraft: true, activeDelivery: "follow_up" });
  assert.equal(queue.sendButton.state, "queue");
  assert.equal(queue.sendButton.tooltip, "完成后执行 (⌥⌘↩)");

  const steer = deriveAgentComposerPresentation({ context: "task", hasHistory: true, runStatus: "active", stopAvailable: true, hasDraft: true, activeDelivery: "steer" });
  assert.equal(steer.sendButton.state, "steer");
  assert.equal(steer.sendButton.tooltip, "立即调整 (⌘↩)");

  const stopping = deriveAgentComposerPresentation({ context: "task", hasHistory: true, runStatus: "stopping" });
  assert.equal(stopping.sendButton.state, "stopping");
});

test("canonical active Run actions win after the local stream has connected", () => {
  const projectRun = deriveAgentComposerPresentation({
    context: "task",
    hasHistory: true,
    runStatus: "active",
    stopAvailable: true,
    isSending: true,
  });
  assert.equal(projectRun.action, "stop");
  assert.equal(projectRun.sendButton.state, "stop");

  const standaloneRun = deriveAgentComposerPresentation({
    context: "task",
    hasHistory: true,
    isStandalone: true,
    runStatus: "active",
    stopAvailable: true,
    hasDraft: true,
    activeDelivery: "steer",
    isSending: true,
  });
  assert.equal(standaloneRun.action, "steer");
  assert.equal(standaloneRun.sendButton.state, "steer");
});

test("active standalone Run keeps a visible Stop until a draft can be queued or steered", () => {
  const empty = deriveAgentComposerPresentation({
    context: "task",
    isStandalone: true,
    runStatus: "active",
    stopAvailable: true,
    activeDelivery: "steer",
  });
  assert.equal(empty.action, "stop");
  assert.equal(empty.sendButton.state, "stop");

  const drafting = deriveAgentComposerPresentation({
    context: "task",
    isStandalone: true,
    runStatus: "active",
    stopAvailable: true,
    hasDraft: true,
    activeDelivery: "steer",
  });
  assert.equal(drafting.action, "steer");
});
