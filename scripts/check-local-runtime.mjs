import { inspectRuntime } from "../apps/desktop/src/runtime-client.mjs";

const status = await inspectRuntime();
if (status.status !== "ready") {
  process.stderr.write(`${status.status}: ${status.message}\n`);
  process.exitCode = 1;
}
