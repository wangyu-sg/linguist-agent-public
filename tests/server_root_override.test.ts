import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolvePiAgentDir,
  resolveServerRepoRoot,
} from "../packages/cat-server/src/server_root.js";

const sourceRoot = "/checkout/linguist-agent";
const temporaryRoot = join(resolve(tmpdir()), "la-server-root-123");
const temporaryPiAgentDir = join(temporaryRoot, "pi-agent");

assert.equal(
  resolveServerRepoRoot({ sourceRoot, env: {} }),
  resolve(sourceRoot),
);
assert.equal(
  resolveServerRepoRoot({
    sourceRoot,
    env: { LA_TEST_MODE: "1", LA_TEST_REPO_ROOT: temporaryRoot },
  }),
  resolve(temporaryRoot),
);
assert.equal(
  resolvePiAgentDir({
    env: { LA_TEST_MODE: "1", LA_TEST_PI_AGENT_DIR: temporaryPiAgentDir },
  }),
  resolve(temporaryPiAgentDir),
);
assert.equal(resolvePiAgentDir({ env: {} }), undefined);

assert.throws(
  () => resolveServerRepoRoot({
    sourceRoot,
    env: { LA_TEST_REPO_ROOT: temporaryRoot },
  }),
  /explicit test mode/,
);
assert.throws(
  () => resolveServerRepoRoot({
    sourceRoot,
    env: { LA_TEST_MODE: "1", LA_TEST_REPO_ROOT: "/Users/wangyu/Desktop/linguist-agent" },
  }),
  /temporary directory/,
);
assert.throws(
  () => resolvePiAgentDir({
    env: { LA_TEST_MODE: "1", LA_TEST_PI_AGENT_DIR: "/Users/wangyu/.pi/agent" },
  }),
  /temporary directory/,
);

process.stdout.write("server root override tests passed\n");
