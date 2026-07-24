import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../packages/cat-server/src/server.ts", import.meta.url), "utf8");
const desktopMainSource = await readFile(new URL("../apps/desktop/src/main.ts", import.meta.url), "utf8");

// LA-125: the runtime composition root may assemble a Task Run coordinator,
// but must not own the coordinator's Pi session/run lifecycle implementation.
assert.equal(/function runAgentStreamingUnlocked\(/u.test(serverSource), false);
assert.equal(/function compactProjectAgentSession\(/u.test(serverSource), false);
assert.match(serverSource, /projectTaskRunCoordinator/u);

// Electron main remains a native transport/lifecycle adapter. It must not
// import server implementation or construct a second Task/Run lifecycle.
assert.equal(/cat-server\/src\/server|createTaskWorkspace|createCatWorker/u.test(desktopMainSource), false);

console.log("composition root boundary tests passed");
