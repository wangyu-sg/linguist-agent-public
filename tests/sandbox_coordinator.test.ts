import assert from "node:assert/strict";
import { createSandboxCommandCoordinator } from "../packages/cat-runtime/src/catSandbox.js";

type Config = { id: string };
let active: Config | undefined;
let releaseFirst!: () => void;
let firstEntered!: () => void;
const firstAtWrap = new Promise<void>((resolve) => { firstEntered = resolve; });
const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
const entered: string[] = [];

const coordinator = createSandboxCommandCoordinator({
  getConfig: () => active as never,
  initialize: async (config) => { active = config as unknown as Config; },
  updateConfig: (config) => { active = config as unknown as Config; },
  wrapWithSandbox: async (command) => {
    entered.push(command);
    if (command === "A") {
      firstEntered();
      await firstRelease;
    }
    return `${command}:${active?.id}`;
  },
});

const first = coordinator.wrap("A", { id: "A" } as never);
await firstAtWrap;
const second = coordinator.wrap("B", { id: "B" } as never);
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepEqual(entered, ["A"]);
assert.equal(active?.id, "A");

releaseFirst();
assert.deepEqual(await Promise.all([first, second]), ["A:A", "B:B"]);
assert.deepEqual(entered, ["A", "B"]);

console.log("sandbox coordinator tests passed");
