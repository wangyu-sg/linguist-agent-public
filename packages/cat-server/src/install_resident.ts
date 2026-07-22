import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  runResidentRuntimeAction,
  type ResidentRuntimeAction,
  type ResidentRuntimeActionResult,
  type ResidentRuntimeInput,
  type ResidentRuntimeLauncher,
} from "./resident_runtime.js";

export interface InstallResidentPlan {
  actions: ResidentRuntimeAction[];
}

export interface RunInstallResidentCommandOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  currentPid?: number;
  uptimeSec?: number;
  actionRunner?: (action: ResidentRuntimeAction, input: ResidentRuntimeInput) => Promise<ResidentRuntimeActionResult>;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
}

export interface InstallResidentCommandResult {
  exitCode: number;
  results: ResidentRuntimeActionResult[];
}

export function parseInstallResidentArgs(argv: string[]): InstallResidentPlan {
  if (argv.includes("--help") || argv.includes("-h")) return { actions: [] };
  if (argv.includes("--uninstall")) return { actions: ["stop", "uninstall"] };
  if (argv.includes("--stop")) return { actions: ["stop"] };
  if (argv.includes("--restart")) return { actions: ["restart"] };
  if (argv.includes("--start")) return { actions: ["start"] };
  return { actions: ["install", "start"] };
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function parsePort(env: Record<string, string | undefined> | undefined): number {
  const value = Number(env?.LA_SERVER_PORT ?? 8787);
  return Number.isFinite(value) && value > 0 ? value : 8787;
}

function pathInside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export function parseResidentRuntimeLauncher(
  env: Record<string, string | undefined> | undefined,
  repoRoot: string,
): ResidentRuntimeLauncher | undefined {
  const executablePath = env?.LA_RESIDENT_EXECUTABLE?.trim();
  const entryPath = env?.LA_RESIDENT_ENTRY?.trim();
  const nativeCapabilityAgentDir = env?.LA_NATIVE_CAPABILITY_AGENT_DIR?.trim();
  if (!executablePath && !entryPath && !nativeCapabilityAgentDir) return undefined;
  if (!executablePath || !entryPath || !nativeCapabilityAgentDir) {
    throw new Error("Managed resident launcher requires executable, entry, and native capability paths.");
  }
  if (!isAbsolute(executablePath) || !isAbsolute(entryPath) || !isAbsolute(nativeCapabilityAgentDir)) {
    throw new Error("Managed resident launcher paths must be absolute.");
  }
  if (!pathInside(repoRoot, entryPath) || !pathInside(repoRoot, nativeCapabilityAgentDir)) {
    throw new Error("Managed resident launcher resources must stay inside the runtime root.");
  }
  return { executablePath, entryPath, nativeCapabilityAgentDir };
}

function printUsage(writeLine: (line: string) => void): void {
  writeLine("Usage: npm run server:install -- [--start|--stop|--restart|--uninstall]");
  writeLine("Default action installs the user LaunchAgent plist and asks launchd to start it.");
}

export async function runInstallResidentCommand(options: RunInstallResidentCommandOptions): Promise<InstallResidentCommandResult> {
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  const plan = parseInstallResidentArgs(options.argv);
  if (!plan.actions.length) {
    printUsage(writeLine);
    return { exitCode: 0, results: [] };
  }

  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const port = parsePort(options.env ?? process.env);
  const currentPid = options.currentPid ?? process.pid;
  const uptimeSec = options.uptimeSec ?? Math.round(process.uptime());
  const launcher = parseResidentRuntimeLauncher(options.env ?? process.env, repoRoot);
  const actionRunner = options.actionRunner ?? runResidentRuntimeAction;
  const results: ResidentRuntimeActionResult[] = [];

  writeLine(`Linguist Agent resident runtime installer`);
  writeLine(`repoRoot: ${repoRoot}`);
  writeLine(`health: http://127.0.0.1:${port}/api/health`);

  try {
    for (const action of plan.actions) {
      const result = await actionRunner(action, { repoRoot, port, currentPid, uptimeSec, launcher });
      results.push(result);
      writeLine(`${action}: ${result.ok ? "ok" : "failed"} - ${result.message}`);
      writeLine(`status: ${result.status.state ?? "unknown"} port=${result.status.port} plist=${result.status.launchAgentPlist}`);
      if (!result.ok) {
        writeError(`resident runtime ${action} failed`);
        return { exitCode: 1, results };
      }
    }
    const last = results.at(-1);
    if (last?.status.state === "running") {
      writeLine(`resident runtime process confirmed; health: http://127.0.0.1:${port}/api/health`);
    } else if (last?.ok) {
      writeLine(`resident runtime action completed; health: http://127.0.0.1:${port}/api/health`);
    }
    return { exitCode: 0, results };
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    return { exitCode: 1, results };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runInstallResidentCommand({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
