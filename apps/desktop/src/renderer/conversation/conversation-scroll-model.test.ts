import {
  CONVERSATION_BOTTOM_THRESHOLD_PX,
  conversationDistanceFromBottom,
  conversationIsAtBottom,
} from "./conversation-scroll-model.ts";

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

test("uses the Codex 24px bottom threshold", () => {
  assert.equal(CONVERSATION_BOTTOM_THRESHOLD_PX, 24);
  assert.equal(conversationDistanceFromBottom({ scrollHeight: 1_000, scrollTop: 676, clientHeight: 300 }), 24);
  assert.equal(conversationIsAtBottom({ scrollHeight: 1_000, scrollTop: 676, clientHeight: 300 }), true);
  assert.equal(conversationIsAtBottom({ scrollHeight: 1_000, scrollTop: 675, clientHeight: 300 }), false);
});
