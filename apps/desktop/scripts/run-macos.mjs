import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_APP_PATH } from "./packaging-config.mjs";
import { verifyMacApp } from "./verify-macos.mjs";

const run = promisify(execFile);
await verifyMacApp(DEFAULT_APP_PATH);
await run("/usr/bin/open", ["-n", DEFAULT_APP_PATH]);
console.log(`Launched local package without installing it: ${DEFAULT_APP_PATH}`);
