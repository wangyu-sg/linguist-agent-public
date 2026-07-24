import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron main and preload share one compiled IPC contract", async () => {
  const [contract, main, preload, packaging] = await Promise.all([
    readFile(new URL("../src/ipc-contract.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/packaging-config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(contract, /export const IPC_CHANNELS/u);
  assert.match(contract, /export const APP_COMMANDS/u);
  assert.match(main, /from "\.\/ipc-contract\.cjs"/u);
  assert.match(preload, /require\("\.\/ipc-contract\.cjs"\)/u);
  assert.match(main, /IPC_CHANNELS/u);
  assert.match(preload, /IPC_CHANNELS/u);
  assert.match(packaging, /"dist\/electron\/main\.js"/u);
  assert.match(packaging, /"dist\/electron\/preload\.cjs"/u);
  assert.match(packaging, /"dist\/electron\/ipc-contract\.cjs"/u);
  assert.match(packaging, /"dist\/electron\/workspace-capabilities\.cjs"/u);
  assert.doesNotMatch(packaging, /"src\/main\.mjs"|"src\/preload\.cjs"/u);
});
