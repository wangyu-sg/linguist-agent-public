import {
  approvalKeyAction,
  type ApprovalKeyTarget,
} from "./approval-keys.ts";

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

/** Minimal structural mock of Element.closest: exact match per selector part. */
function target(matched: string[] = []): ApprovalKeyTarget {
  return {
    closest(selector: string) {
      const parts = selector.split(",").map((part) => part.trim());
      return matched.some((entry) => parts.includes(entry)) ? {} : null;
    },
  };
}

test("plain Enter approves when focus is on the page body or a neutral element", () => {
  assert.equal(approvalKeyAction({ key: "Enter" }, target()), "approve");
  assert.equal(approvalKeyAction({ key: "Enter" }, target(["div"])), "approve");
});

test("plain Escape declines when focus is on a neutral element", () => {
  assert.equal(approvalKeyAction({ key: "Escape" }, target()), "deny");
});

test("Enter yields to native activation on buttons and links", () => {
  assert.equal(approvalKeyAction({ key: "Enter" }, target(["button"])), null);
  assert.equal(approvalKeyAction({ key: "Enter" }, target(["a"])), null);
  assert.equal(approvalKeyAction({ key: "Enter" }, target(["summary"])), null);
});

test("both keys yield inside dialogs, menus, and text inputs", () => {
  for (const scope of ["[role='dialog']", "[role='menu']", "textarea", "input", "select"]) {
    assert.equal(approvalKeyAction({ key: "Enter" }, target([scope])), null);
    assert.equal(approvalKeyAction({ key: "Escape" }, target([scope])), null);
  }
});

test("modifier-composed keys never trigger a decision", () => {
  assert.equal(approvalKeyAction({ key: "Enter", metaKey: true }, target()), null);
  assert.equal(approvalKeyAction({ key: "Enter", ctrlKey: true }, target()), null);
  assert.equal(approvalKeyAction({ key: "Enter", shiftKey: true }, target()), null);
  assert.equal(approvalKeyAction({ key: "Escape", altKey: true }, target()), null);
});

test("unrelated keys and missing focus target are ignored", () => {
  assert.equal(approvalKeyAction({ key: " " }, target()), null);
  assert.equal(approvalKeyAction({ key: "Tab" }, target()), null);
  assert.equal(approvalKeyAction({ key: "Enter" }, null), null);
});
