import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareNativeCapabilityAgentDir } from "./prepare-native-capabilities.mjs";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(DESKTOP_ROOT, "../..");

function parseArguments(argv) {
  const result = { port: 8799 };
  for (const argument of argv) {
    if (argument === "--force-prepare") result.force = true;
    else if (argument.startsWith("--port=")) result.port = Number(argument.slice("--port=".length));
    else if (argument.startsWith("--agent-dir=")) result.agentDir = resolve(argument.slice("--agent-dir=".length));
    else throw new Error(`Unknown acceptance runtime argument: ${argument}`);
  }
  if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535 || result.port === 8787) {
    throw new Error("Acceptance runtime port must be 1024-65535 and cannot be the managed port 8787.");
  }
  return result;
}

const options = parseArguments(process.argv.slice(2));
const prepared = await prepareNativeCapabilityAgentDir({ agentDir: options.agentDir, force: options.force });
console.log(`Starting isolated acceptance runtime on 127.0.0.1:${options.port}`);
console.log(`Native capability agent directory: ${prepared.agentDir}`);

const child = spawn("npm", ["run", "server"], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    LA_ELECTRON_ACCEPTANCE: "1",
    LA_SERVER_PORT: String(options.port),
    LA_NATIVE_CAPABILITY_AGENT_DIR: prepared.agentDir,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
