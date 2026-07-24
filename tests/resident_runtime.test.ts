import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  findPlistSecretMatches,
  isLaunchdMissingServiceError,
  isResidentRuntimeStartConfirmed,
  isResidentServerHealthForRepo,
  readExistingResidentServerHealth,
  renderResidentLaunchAgentPlist,
  residentRuntimePaths,
  shouldReplaceManualServerOnRestart,
  waitForResidentRuntimeStartConfirmation,
} from "@linguist-agent/cat-server/resident_runtime";
import { runtimeInstanceId } from "../packages/cat-server/src/runtime_compatibility.js";

const repoRoot = "/Users/test/linguist-agent";
process.env.LA_RUNTIME_LOG_ROOT = "/Users/test/Library/Logs/Linguist Agent";
const plist = renderResidentLaunchAgentPlist({
  repoRoot,
  port: 8787,
});

assert.match(plist, /com\.linguist-agent\.server/);
assert.doesNotMatch(plist, /LA_SERVER_HOST|LA_SERVER_PORT|127\.0\.0\.1|8787/);
assert.match(plist, /LA_RESIDENT_RUNTIME/);
assert.match(plist, /StandardOutPath/);
assert.match(plist, /StandardErrorPath/);
assert.match(plist, /node_modules\/\.bin\/tsx/);
assert.match(plist, /packages\/cat-server\/src\/server\.ts/);
assert.doesNotMatch(plist, /\/opt\/homebrew\/bin\/node/);
assert.doesNotMatch(plist, /node node_modules\/\.bin\/tsx/);
assert.doesNotMatch(plist, /API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/);
assert.deepEqual(findPlistSecretMatches(plist), []);

const managedPlist = renderResidentLaunchAgentPlist({
  repoRoot,
  port: 8787,
  launcher: {
    executablePath: "/Users/test/Linguist Agent.app/Contents/MacOS/Linguist Agent",
    entryPath: `${repoRoot}/runtime-launcher.mjs`,
    nativeCapabilityAgentDir: `${repoRoot}/native-capabilities`,
  },
});
assert.match(managedPlist, /Linguist Agent\.app\/Contents\/MacOS\/Linguist Agent/);
assert.match(managedPlist, /runtime-launcher\.mjs/);
assert.match(managedPlist, /ELECTRON_RUN_AS_NODE/);
assert.match(managedPlist, /LA_NATIVE_CAPABILITY_AGENT_DIR/);
assert.match(managedPlist, /native-capabilities/);
assert.doesNotMatch(managedPlist, /\/bin\/zsh|node_modules\/\.bin\/tsx|server\.ts|npm run/);
assert.deepEqual(findPlistSecretMatches(managedPlist), []);

const unsafePlist = `${plist}<key>DEEPSEEK_API_KEY</key><string>sk-test</string><key>TAVILY_TOKEN</key>`;
assert.deepEqual(findPlistSecretMatches(unsafePlist), ["DEEPSEEK_API_KEY", "TAVILY_TOKEN"]);

const paths = residentRuntimePaths(repoRoot);
assert.equal(paths.label, "com.linguist-agent.server");
assert.equal(paths.launchAgentPlist.endsWith("/Library/LaunchAgents/com.linguist-agent.server.plist"), true);
assert.equal(paths.stdoutLogPath, "/Users/test/Library/Logs/Linguist Agent/la-resident-server.out.log");
assert.equal(paths.stderrLogPath, "/Users/test/Library/Logs/Linguist Agent/la-resident-server.err.log");
assert.equal(paths.legacyLogPath, "/Users/test/linguist-agent/data/logs/la-server.log");

assert.equal(isLaunchdMissingServiceError('Bad request.\nCould not find service "com.linguist-agent.server" in domain for user gui: 501'), true);
assert.equal(isLaunchdMissingServiceError("launchctl failed: permission denied"), false);

assert.equal(isResidentServerHealthForRepo({ ok: true, repoRoot }, repoRoot), true);
assert.equal(isResidentServerHealthForRepo({ ok: true, runtimeInstanceId: runtimeInstanceId(repoRoot) }, repoRoot), true);
assert.equal(isResidentServerHealthForRepo({ ok: true, runtimeInstanceId: runtimeInstanceId("/Users/test/other-agent") }, repoRoot), false);
assert.equal(isResidentServerHealthForRepo({ ok: true, repoRoot: "/Users/test/other-agent" }, repoRoot), false);
assert.equal(isResidentServerHealthForRepo({ ok: false, repoRoot }, repoRoot), false);
assert.equal(isResidentRuntimeStartConfirmed({ launchd: { loaded: true, running: true }, health: undefined, repoRoot }), true);
assert.equal(isResidentRuntimeStartConfirmed({ launchd: { loaded: true, running: false }, health: { ok: true, repoRoot }, repoRoot }), true);
assert.equal(isResidentRuntimeStartConfirmed({ launchd: { loaded: true, running: false }, health: { ok: true, repoRoot: "/Users/test/other-agent" }, repoRoot }), false);
assert.equal(shouldReplaceManualServerOnRestart({ launchd: { running: false }, health: { ok: true, repoRoot }, repoRoot }), true);
assert.equal(shouldReplaceManualServerOnRestart({ launchd: { running: true }, health: { ok: true, repoRoot }, repoRoot }), false);
assert.equal(shouldReplaceManualServerOnRestart({ launchd: { running: false }, health: { ok: true, repoRoot: "/Users/test/other-agent" }, repoRoot }), false);

let confirmationChecks = 0;
const eventuallyStarted = await waitForResidentRuntimeStartConfirmation({
  repoRoot,
  port: 8787,
  attempts: 3,
  intervalMs: 0,
  inspect: async () => ({ loaded: true, running: ++confirmationChecks >= 2 }),
  readHealth: async () => undefined,
  delay: async () => undefined,
});
assert.equal(eventuallyStarted, true, "launchd propagation races must be retried before start is reported as failed");
assert.equal(confirmationChecks, 2);

const healthServer = createServer((req, res) => {
  if (req.url !== "/api/health") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, repoRoot, pi: "0.80.3" }));
});
await new Promise<void>((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
try {
  const address = healthServer.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  const port = typeof address === "object" && address ? address.port : 0;
  const health = await readExistingResidentServerHealth({ port });
  assert.deepEqual(health, { ok: true, repoRoot, pi: "0.80.3" });
  assert.equal(isResidentServerHealthForRepo(health, repoRoot), true);
} finally {
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => error ? reject(error) : resolve());
  });
}

console.log("resident_runtime tests passed");
