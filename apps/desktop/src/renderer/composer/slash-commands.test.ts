import { nextCommandIndex } from "../command/command-model.ts";
import {
  composerSlashCommands,
  filterComposerSlashCommands,
  slashQueryFromDraft,
  type ComposerSlashSource,
} from "./slash-commands.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  ok(value: unknown, message: string): void {
    if (!value) throw new Error(message);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

function source(overrides: Partial<ComposerSlashSource> = {}): ComposerSlashSource {
  return {
    canPickRoute: true,
    canOpenSettings: true,
    canStop: false,
    canCompact: false,
    canFork: false,
    canCopyChat: false,
    liveDelivery: null,
    currentThinkingLevel: undefined,
    actions: {
      openModelPicker: () => undefined,
      openSettings: () => undefined,
      stopRun: () => undefined,
      compact: () => undefined,
      fork: () => undefined,
      copyChat: () => undefined,
      setDelivery: () => undefined,
      setThinkingLevel: () => undefined,
    },
    ...overrides,
  };
}

test("slash trigger requires a leading slash and a single line", () => {
  assert.equal(slashQueryFromDraft(""), null);
  assert.equal(slashQueryFromDraft("/"), "");
  assert.equal(slashQueryFromDraft("/mod"), "mod");
  assert.equal(slashQueryFromDraft("hello /mod"), null);
  assert.equal(slashQueryFromDraft("/mod\nnext"), null);
});

test("inventory lists every runtime thinking level plus contextual actions", () => {
  const commands = composerSlashCommands(source({ canStop: true, liveDelivery: "steer" }));
  const ids = commands.map((command) => command.id);
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.ok(ids.includes(`thinking-${level}`), `missing thinking-${level}`);
  }
  assert.ok(ids.includes("model"), "missing model");
  assert.ok(ids.includes("stop"), "missing stop while a Run is stoppable");
  assert.ok(ids.includes("delivery-follow-up"), "missing queue toggle while steering");
  assert.ok(!ids.includes("delivery-steer"), "current delivery mode is not offered as a no-op");
  assert.ok(!ids.includes("thinking-auto"), "reset is hidden while following Pi settings");
});

test("disabled-context actions never appear in the menu", () => {
  const ids = composerSlashCommands(source()).map((command) => command.id);
  assert.ok(!ids.includes("stop"), "stop requires a stoppable Run");
  assert.ok(!ids.includes("delivery-steer") && !ids.includes("delivery-follow-up"), "delivery requires live delivery");
  assert.ok(!ids.includes("compact") && !ids.includes("fork") && !ids.includes("copy-chat"), "branch actions require a branch");
  const noRoute = composerSlashCommands(source({ canPickRoute: false })).map((command) => command.id);
  assert.ok(!noRoute.includes("model") && !noRoute.some((id) => id.startsWith("thinking-")), "route commands hide without a picker");
});

test("filter ranks title matches and narrows as you type", () => {
  const commands = composerSlashCommands(source({ canStop: true }));
  assert.equal(filterComposerSlashCommands(commands, "").length, commands.length);
  const thinking = filterComposerSlashCommands(commands, "思考");
  assert.ok(thinking.length >= 7, "思考 should match every level command");
  assert.equal(filterComposerSlashCommands(commands, "high")[0]?.id, "thinking-high");
  assert.equal(filterComposerSlashCommands(commands, "停止")[0]?.id, "stop");
  assert.equal(filterComposerSlashCommands(commands, "不存在的命令").length, 0);
});

test("executing a command runs its action and keyboard selection wraps", () => {
  let stopped = 0;
  let level: string | undefined;
  const commands = composerSlashCommands(source({
    canStop: true,
    actions: {
      ...source().actions,
      stopRun: () => { stopped += 1; },
      setThinkingLevel: (next) => { level = next; },
    },
  }));
  commands.find((command) => command.id === "stop")?.run();
  commands.find((command) => command.id === "thinking-xhigh")?.run();
  assert.equal(stopped, 1);
  assert.equal(level, "xhigh");
  const length = commands.length;
  assert.equal(nextCommandIndex(0, "ArrowUp", length), length - 1);
  assert.equal(nextCommandIndex(length - 1, "ArrowDown", length), 0);
});
