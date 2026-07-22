import {
  COMPOSER_POWER_LEVELS,
  clampPowerIndex,
  composerPowerStorageKey,
  nextPowerIndexForKey,
  powerIndexForLevel,
  powerLevelAt,
  powerValueText,
  readPersistedThinkingLevel,
  writePersistedThinkingLevel,
  type ComposerPowerStorage,
} from "./composer-power.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

test("power slider stops map 1:1 to the runtime ThinkingLevel enum", () => {
  assert.deepEqual([...COMPOSER_POWER_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  COMPOSER_POWER_LEVELS.forEach((level, index) => {
    assert.equal(powerIndexForLevel(level), index);
    assert.equal(powerLevelAt(index), level);
  });
});

test("unset selection lands on the medium default and invalid indexes clamp", () => {
  assert.equal(powerIndexForLevel(undefined), 3);
  assert.equal(powerIndexForLevel(null), 3);
  assert.equal(powerLevelAt(-4), "off");
  assert.equal(powerLevelAt(99), "max");
  assert.equal(clampPowerIndex(Number.NaN), 3);
});

test("arrow keys step the slider per the Codex Power spec", () => {
  assert.equal(nextPowerIndexForKey(3, "ArrowLeft"), 2);
  assert.equal(nextPowerIndexForKey(3, "ArrowRight"), 4);
  assert.equal(nextPowerIndexForKey(3, "ArrowDown"), 2);
  assert.equal(nextPowerIndexForKey(3, "ArrowUp"), 4);
  assert.equal(nextPowerIndexForKey(0, "ArrowLeft"), 0);
  assert.equal(nextPowerIndexForKey(6, "ArrowRight"), 6);
  assert.equal(nextPowerIndexForKey(4, "Home"), 0);
  assert.equal(nextPowerIndexForKey(4, "End"), 6);
  assert.equal(nextPowerIndexForKey(4, "Tab"), 4);
});

test("aria value text follows the '{value}, {position} of {total}.' announcement", () => {
  assert.equal(powerValueText(0), "关闭, 1 of 7.");
  assert.equal(powerValueText(4), "High, 5 of 7.");
  assert.equal(powerValueText(6), "Max, 7 of 7.");
});

test("thinking level persists per Task through injectable storage", () => {
  const store = new Map<string, string>();
  const storage: ComposerPowerStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
  assert.equal(readPersistedThinkingLevel(storage, "task-a"), undefined);
  writePersistedThinkingLevel(storage, "task-a", "high");
  writePersistedThinkingLevel(storage, "task-b", "off");
  assert.equal(readPersistedThinkingLevel(storage, "task-a"), "high");
  assert.equal(readPersistedThinkingLevel(storage, "task-b"), "off");
  assert.equal(composerPowerStorageKey(null), "la.composer.thinkingLevel.default");
  writePersistedThinkingLevel(storage, "task-a", undefined);
  assert.equal(readPersistedThinkingLevel(storage, "task-a"), undefined);
  store.set("la.composer.thinkingLevel.task-c", "not-a-level");
  assert.equal(readPersistedThinkingLevel(storage, "task-c"), undefined);
  assert.equal(readPersistedThinkingLevel(null, "task-a"), undefined);
});
