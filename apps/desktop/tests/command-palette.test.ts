import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { TaskRecord } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import type { ProjectSummary } from "../src/renderer/data/workspace-client.ts";
import { commandItems, mergeCommandTasks, nextCommandIndex, searchCommands } from "../src/renderer/command/command-model.ts";

const projects: ProjectSummary[] = [
  {
    projectId: "synthetic-rpg",
    name: "合成冒险游戏",
    root: "projects/synthetic-rpg",
    updatedAt: "2026-07-16T04:00:00.000Z",
    assetCount: 12,
    batches: [
      {
        schemaVersion: 1,
        projectId: "synthetic-rpg",
        batchId: "synthetic-batch-001",
        format: "xlsx_paste",
        sourceLanguage: "zh-CN",
        targetLanguage: "en-US",
        segments: 653,
        confirmed: 640,
        draft: 13,
        new: 0,
        locked: 0,
        updatedAt: "2026-07-16T04:00:00.000Z",
      },
    ],
  },
  {
    projectId: "synthetic-series",
    name: "合成番剧",
    root: "projects/synthetic-series",
    updatedAt: "2026-07-15T04:00:00.000Z",
    assetCount: 4,
    batches: [],
  },
];

const tasks: TaskRecord[] = [
  {
    id: "task-review",
    owner: { kind: "project", projectId: "synthetic-rpg" },
    scope: {
      kind: "project",
      batchId: "synthetic-batch-001",
      segmentIds: [],
      sourceLocale: "zh-CN",
      targetLocale: "en-US",
    },
    title: "审校合成冒险游戏第 12 句",
    intent: "检查术语、标签与角色语气",
    kind: "review",
    status: "active",
    createdAt: "2026-07-16T03:00:00.000Z",
    updatedAt: "2026-07-16T04:00:00.000Z",
  },
];

test("command palette is a projection of canonical workspace scope", () => {
  const items = commandItems({ projects, tasks, projectId: "synthetic-rpg", batchId: "synthetic-batch-001", taskId: "task-review" });
  assert.deepEqual(
    items.filter((item) => item.type === "命令").map((item) => item.selection.kind),
    ["create-chat", "import-batch", "show-conversation", "show-cat", "create-project", "open-settings"],
  );
  assert.deepEqual(
    items.find((item) => item.id === "batch:synthetic-rpg:synthetic-batch-001")?.selection,
    { kind: "open-batch", projectId: "synthetic-rpg", batchId: "synthetic-batch-001" },
  );
  assert.deepEqual(
    items.find((item) => item.id === "task:synthetic-rpg:task-review")?.selection,
    { kind: "open-task", projectId: "synthetic-rpg", taskId: "task-review" },
  );
});

test("import and Task mode actions only exist for valid current scope", () => {
  const items = commandItems({ projects, tasks: [], projectId: null, batchId: null, taskId: null });
  const actions = items.filter((item) => item.type === "命令").map((item) => item.selection.kind);
  assert.deepEqual(actions, ["create-chat", "create-project", "open-settings"]);
});

test("global Task projection keeps other Projects searchable without changing selected scope", () => {
  const remoteTask: TaskRecord = {
    ...tasks[0]!,
    id: "task-series",
    owner: { kind: "project", projectId: "synthetic-series" },
    scope: { ...tasks[0]!.scope, batchId: null },
    title: "审校番剧角色语气",
    updatedAt: "2026-07-16T05:00:00.000Z",
  };
  const merged = mergeCommandTasks(tasks, [remoteTask, { ...tasks[0]!, title: "旧缓存" }]);
  const items = commandItems({ projects, tasks: merged, projectId: "synthetic-rpg", batchId: "synthetic-batch-001", taskId: "task-review" });
  assert.equal(searchCommands(items, "番剧角色语气")[0]?.id, "task:synthetic-series:task-series");
  assert.deepEqual(searchCommands(items, "番剧角色语气")[0]?.selection, {
    kind: "open-task",
    projectId: "synthetic-series",
    taskId: "task-series",
  });
  assert.equal(merged.find((task) => task.id === "task-review")?.title, "审校合成冒险游戏第 12 句");
});

test("search ranks exact and title-prefix matches ahead of metadata matches", () => {
  const items = commandItems({ projects, tasks, projectId: "synthetic-rpg", batchId: "synthetic-batch-001", taskId: "task-review" });
  assert.equal(searchCommands(items, "合成冒险游戏")[0]?.id, "project:synthetic-rpg");
  assert.equal(searchCommands(items, "synthetic-batch-001")[0]?.id, "batch:synthetic-rpg:synthetic-batch-001");
  assert.equal(searchCommands(items, "12 术语")[0]?.id, "task:synthetic-rpg:task-review");
  assert.equal(searchCommands(items, "不存在的命令").length, 0);
});

test("arrow selection wraps while Home and End remain deterministic", () => {
  assert.equal(nextCommandIndex(0, "ArrowUp", 4), 3);
  assert.equal(nextCommandIndex(3, "ArrowDown", 4), 0);
  assert.equal(nextCommandIndex(2, "Home", 4), 0);
  assert.equal(nextCommandIndex(1, "End", 4), 3);
  assert.equal(nextCommandIndex(0, "Tab", 4), 0);
  assert.equal(nextCommandIndex(0, "ArrowDown", 0), -1);
});

test("Command-K crosses the context bridge only as a fixed main-to-renderer command", async () => {
  const [contract, main, preload, palette, productWorkspace, workspace] = await Promise.all([
    readFile(new URL("../src/ipc-contract.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/command/CommandPalette.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/shell/ProductWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/workspace/Workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(main, /accelerator: "CommandOrControl\+K"/);
  assert.match(main, /sendCommand\("show-command-palette"\)/);
  assert.match(main, /accelerator: "CommandOrControl\+Shift\+I"/);
  assert.match(main, /sendCommand\("toggle-inspector"\)/);
  assert.match(contract, /"show-command-palette"/);
  assert.match(contract, /"toggle-inspector"/);
  assert.doesNotMatch(preload, /sendCommand|ipcRenderer\.send\("app:command"/);
  assert.match(palette, /previousFocus\.current/);
  assert.match(palette, /target\.focus\(\)/);
  assert.match(productWorkspace, /focusWorkspaceCenter\(\)/);
  assert.match(productWorkspace, /lastInspectorSelection\.current/);
  assert.match(productWorkspace, /command === "toggle-inspector"/);
  assert.match(workspace, /data-command-focus-target="center"/);
});
