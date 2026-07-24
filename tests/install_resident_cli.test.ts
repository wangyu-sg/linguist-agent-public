import assert from "node:assert/strict";
import {
  parseInstallResidentArgs,
  parseResidentRuntimeLauncher,
  runInstallResidentCommand,
} from "../packages/cat-server/src/install_resident.js";
import type { ResidentRuntimeActionResult } from "@linguist-agent/cat-server/resident_runtime";

assert.deepEqual(parseInstallResidentArgs([]).actions, ["install", "start"]);
assert.deepEqual(parseInstallResidentArgs(["--stop"]).actions, ["stop"]);
assert.deepEqual(parseInstallResidentArgs(["--uninstall"]).actions, ["stop", "uninstall"]);
assert.deepEqual(parseResidentRuntimeLauncher({
  LA_RESIDENT_EXECUTABLE: "/Applications/LinguistAgent.app/Contents/MacOS/Linguist Agent",
  LA_RESIDENT_ENTRY: "/tmp/la/runtime-launcher.mjs",
  LA_NATIVE_CAPABILITY_AGENT_DIR: "/tmp/la/native-capabilities",
}, "/tmp/la"), {
  executablePath: "/Applications/LinguistAgent.app/Contents/MacOS/Linguist Agent",
  entryPath: "/tmp/la/runtime-launcher.mjs",
  nativeCapabilityAgentDir: "/tmp/la/native-capabilities",
});
assert.throws(() => parseResidentRuntimeLauncher({
  LA_RESIDENT_EXECUTABLE: "/Applications/LinguistAgent.app/Contents/MacOS/Linguist Agent",
  LA_RESIDENT_ENTRY: "/tmp/other/runtime-launcher.mjs",
  LA_NATIVE_CAPABILITY_AGENT_DIR: "/tmp/la/native-capabilities",
}, "/tmp/la"), /inside the runtime root/);

const calls: string[] = [];
const output: string[] = [];
const result = await runInstallResidentCommand({
  argv: [],
  env: { LA_SERVER_PORT: "9898" },
  repoRoot: "/tmp/la",
  currentPid: 42,
  uptimeSec: 0,
  actionRunner: async (action, input): Promise<ResidentRuntimeActionResult> => {
    calls.push(`${action}:${input.repoRoot}:${input.port}:${input.currentPid}`);
    return {
      action,
      ok: true,
      message: `${action} ok`,
      status: {
        label: "com.linguist-agent.server",
        supported: true,
        state: action === "start" ? "running" : "installed",
        pid: 0,
        port: input.port,
        transport: "unix",
        uptimeSec: 0,
        repoRoot: input.repoRoot,
        logPath: "/tmp/la/data/logs/la-server.log",
        stdoutLogPath: "/tmp/la/logs/la-resident-server.out.log",
        stderrLogPath: "/tmp/la/logs/la-resident-server.err.log",
        launchAgentPlist: "/Users/test/Library/LaunchAgents/com.linguist-agent.server.plist",
        autostartInstalled: true,
        loopbackOnly: true,
        plistHasSecrets: false,
        manualStartCommand: "npm run server",
        stopCommand: "launchctl bootout",
        restartAction: "launchd",
        notes: [],
      },
    };
  },
  writeLine: (line) => output.push(line),
});

assert.equal(result.exitCode, 0);
assert.deepEqual(calls, ["install:/tmp/la:9898:42", "start:/tmp/la:9898:42"]);
assert.equal(output.some((line) => line.includes("authenticated Unix-domain rendezvous")), true);
assert.equal(output.some((line) => line.includes("http://127.0.0.1:9898/api/health")), false);
assert.equal(output.some((line) => line.includes("resident runtime process confirmed")), true);

console.log("install_resident_cli tests passed");
