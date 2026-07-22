import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveRuntimeStorageRoots } from "@linguist-agent/cat-data";
import { runtimeInstanceId } from "./runtime_compatibility.js";

const execFileAsync = promisify(execFile);

export const RESIDENT_RUNTIME_LABEL = "com.linguist-agent.server";

export interface ResidentRuntimePaths {
  label: string;
  launchAgentPlist: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  legacyLogPath: string;
}

export interface ResidentRuntimeStatus {
  label: string;
  supported: boolean;
  state: "unsupported" | "manual" | "installed" | "running" | "error";
  pid: number;
  port: number;
  uptimeSec: number;
  repoRoot: string;
  logPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  launchAgentPlist: string;
  autostartInstalled: boolean;
  launchdLoaded: boolean;
  launchdRunning: boolean;
  launchdPid?: number;
  loopbackOnly: boolean;
  plistHasSecrets: boolean;
  plistSecretMatches: string[];
  manualStartCommand: string;
  stopCommand: string;
  restartAction: "manual" | "launchd" | "not_implemented";
  installCommand: string;
  startCommand: string;
  uninstallCommand: string;
  notes: string[];
  lastError?: string;
}

export interface ResidentRuntimeActionResult {
  action: ResidentRuntimeAction;
  ok: boolean;
  status: ResidentRuntimeStatus;
  message: string;
}

export type ResidentRuntimeAction = "install" | "start" | "stop" | "restart" | "uninstall";

interface LaunchdState {
  loaded: boolean;
  running: boolean;
  pid?: number;
  error?: string;
}

export interface ResidentRuntimeLauncher {
  executablePath: string;
  entryPath: string;
  nativeCapabilityAgentDir: string;
}

export interface ResidentRuntimeInput {
  repoRoot: string;
  port: number;
  currentPid: number;
  uptimeSec: number;
  launcher?: ResidentRuntimeLauncher;
}

export interface ResidentServerHealth {
  ok?: boolean;
  repoRoot?: string;
  runtimeInstanceId?: string;
  pi?: string;
}

export function residentRuntimePaths(repoRoot: string): ResidentRuntimePaths {
  const logDir = resolveRuntimeStorageRoots(repoRoot).logRoot;
  const legacyLogDir = join(repoRoot, "data", "logs");
  return {
    label: RESIDENT_RUNTIME_LABEL,
    launchAgentPlist: join(homedir(), "Library", "LaunchAgents", `${RESIDENT_RUNTIME_LABEL}.plist`),
    stdoutLogPath: join(logDir, "la-resident-server.out.log"),
    stderrLogPath: join(logDir, "la-resident-server.err.log"),
    legacyLogPath: join(legacyLogDir, "la-server.log"),
  };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderResidentLaunchAgentPlist(input: { repoRoot: string; port: number; launcher?: ResidentRuntimeLauncher }): string {
  const paths = residentRuntimePaths(input.repoRoot);
  const programArguments = input.launcher
    ? [input.launcher.executablePath, input.launcher.entryPath]
    : [
      "/bin/zsh",
      "-lc",
      [
        `cd ${shellQuote(input.repoRoot)}`,
        "&&",
        `LA_RESIDENT_RUNTIME=1`,
        `LA_SERVER_HOST=127.0.0.1`,
        `LA_SERVER_PORT=${input.port}`,
        `LA_NO_OPEN=1`,
        `PATH=${shellQuote(process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin")}`,
        shellQuote(join(input.repoRoot, "node_modules", ".bin", "tsx")),
        "packages/cat-server/src/server.ts",
      ].join(" "),
    ];
  const launcherEnvironment = input.launcher ? `
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>LA_NATIVE_CAPABILITY_AGENT_DIR</key>
    <string>${xmlEscape(input.launcher.nativeCapabilityAgentDir)}</string>
    <key>PATH</key>
    <string>${xmlEscape(`${join(input.repoRoot, "bin")}:${join(input.repoRoot, "node_modules", ".bin")}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(paths.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(input.repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LA_RESIDENT_RUNTIME</key>
    <string>1</string>
    <key>LA_SERVER_HOST</key>
    <string>127.0.0.1</string>
    <key>LA_SERVER_PORT</key>
    <string>${input.port}</string>
    <key>LA_NO_OPEN</key>
    <string>1</string>
${launcherEnvironment}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(paths.stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(paths.stderrLogPath)}</string>
</dict>
</plist>
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function findPlistSecretMatches(plist: string): string[] {
  const matches = new Set<string>();
  const re = /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*\b/g;
  for (const match of plist.matchAll(re)) matches.add(match[0]);
  return [...matches].sort();
}

function launchctlTarget(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "";
  return `gui/${uid}/${RESIDENT_RUNTIME_LABEL}`;
}

function launchctlGuiDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "";
  return `gui/${uid}`;
}

async function runLaunchctl(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("launchctl", args, { timeout: 8000 });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

async function inspectLaunchd(): Promise<LaunchdState> {
  if (platform() !== "darwin") return { loaded: false, running: false };
  try {
    const result = await runLaunchctl(["print", launchctlTarget()]);
    const output = `${result.stdout}\n${result.stderr}`;
    const pid = /pid\s*=\s*(\d+)/.exec(output)?.[1];
    return { loaded: true, running: Boolean(pid), pid: pid ? Number(pid) : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isLaunchdMissingServiceError(message)) return { loaded: false, running: false };
    return { loaded: false, running: false, error: message };
  }
}

export function isLaunchdMissingServiceError(message: string): boolean {
  return /Could not find service|No such process|Could not find domain/i.test(message);
}

export function isResidentServerHealthForRepo(health: ResidentServerHealth | undefined, repoRoot: string): boolean {
  if (health?.ok !== true) return false;
  if (health.runtimeInstanceId) return health.runtimeInstanceId === runtimeInstanceId(repoRoot);
  return typeof health.repoRoot === "string" && resolve(health.repoRoot) === resolve(repoRoot);
}

export function isResidentRuntimeStartConfirmed(input: {
  launchd: Pick<LaunchdState, "running">;
  health: ResidentServerHealth | undefined;
  repoRoot: string;
}): boolean {
  return input.launchd.running || isResidentServerHealthForRepo(input.health, input.repoRoot);
}

export async function waitForResidentRuntimeStartConfirmation(input: {
  repoRoot: string;
  port: number;
  attempts?: number;
  intervalMs?: number;
  inspect?: () => Promise<Pick<LaunchdState, "running">>;
  readHealth?: () => Promise<ResidentServerHealth | undefined>;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<boolean> {
  // The plist uses a ten-second ThrottleInterval. After an intentional stop,
  // launchd may accept the loaded KeepAlive job but delay its next process
  // until that interval expires, even when `kickstart -k` returns non-zero.
  const attempts = Math.max(1, input.attempts ?? 31);
  const intervalMs = Math.max(0, input.intervalMs ?? 500);
  const inspect = input.inspect ?? inspectLaunchd;
  const readHealth = input.readHealth ?? (() => readExistingResidentServerHealth({ port: input.port }));
  const delay = input.delay ?? ((milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [launchd, health] = await Promise.all([inspect(), readHealth()]);
    if (isResidentRuntimeStartConfirmed({ launchd, health, repoRoot: input.repoRoot })) return true;
    if (attempt + 1 < attempts) await delay(intervalMs);
  }
  return false;
}

export function shouldReplaceManualServerOnRestart(input: {
  launchd: Pick<LaunchdState, "running">;
  health: ResidentServerHealth | undefined;
  repoRoot: string;
}): boolean {
  return !input.launchd.running && isResidentServerHealthForRepo(input.health, input.repoRoot);
}

function restartManualServerAfterResponse(input: ResidentRuntimeInput, paths: ResidentRuntimePaths): void {
  if (input.launcher) {
    setTimeout(() => {
      spawn(input.launcher!.executablePath, [input.launcher!.entryPath], {
        cwd: input.repoRoot,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          LA_RESIDENT_RUNTIME: "1",
          LA_SERVER_HOST: "127.0.0.1",
          LA_SERVER_PORT: String(input.port),
          LA_NO_OPEN: "1",
          LA_NATIVE_CAPABILITY_AGENT_DIR: input.launcher!.nativeCapabilityAgentDir,
          PATH: `${join(input.repoRoot, "bin")}:${join(input.repoRoot, "node_modules", ".bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
        },
      }).unref();
      process.exit(0);
    }, 500).unref();
    return;
  }
  const command = [
    "sleep 0.5",
    "&&",
    `cd ${shellQuote(input.repoRoot)}`,
    "&&",
    `LA_SERVER_HOST=127.0.0.1`,
    `LA_SERVER_PORT=${input.port}`,
    `LA_NO_OPEN=1`,
    "npm run server",
    ">>",
    shellQuote(paths.stdoutLogPath),
    "2>&1",
  ].join(" ");
  spawn("/bin/zsh", ["-lc", command], { detached: true, stdio: "ignore" }).unref();
  setTimeout(() => process.exit(0), 150).unref();
}

export async function readExistingResidentServerHealth(input: { port: number; timeoutMs?: number }): Promise<ResidentServerHealth | undefined> {
  return new Promise((resolveHealth) => {
    let settled = false;
    const finish = (health: ResidentServerHealth | undefined) => {
      if (settled) return;
      settled = true;
      resolveHealth(health);
    };
    const req = request({
      host: "127.0.0.1",
      port: input.port,
      path: "/api/health",
      method: "GET",
      timeout: input.timeoutMs ?? 800,
    }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        finish(undefined);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 65536) req.destroy(new Error("resident health response too large"));
      });
      res.on("end", () => {
        try {
          finish(JSON.parse(body) as ResidentServerHealth);
        } catch {
          finish(undefined);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(undefined);
    });
    req.on("error", () => finish(undefined));
    req.end();
  });
}

async function readPlistSecretMatches(path: string): Promise<string[]> {
  try {
    return findPlistSecretMatches(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readResidentRuntimeStatus(input: ResidentRuntimeInput): Promise<ResidentRuntimeStatus> {
  const paths = residentRuntimePaths(input.repoRoot);
  const supported = platform() === "darwin";
  const autostartInstalled = existsSync(paths.launchAgentPlist);
  const [launchd, plistSecretMatches] = await Promise.all([
    inspectLaunchd(),
    readPlistSecretMatches(paths.launchAgentPlist),
  ]);
  const loopbackOnly = process.env.LA_SERVER_HOST === undefined || process.env.LA_SERVER_HOST === "127.0.0.1";
  const state = !supported
    ? "unsupported"
    : launchd.running
      ? "running"
      : autostartInstalled
        ? "installed"
        : "manual";
  const notes: string[] = [];
  if (!supported) notes.push("launchd resident runtime is only supported on macOS.");
  if (!autostartInstalled) notes.push("No LaunchAgent is installed; manual server start remains active.");
  if (autostartInstalled && !launchd.running) notes.push("LaunchAgent is installed but not loaded/running.");
  if (plistSecretMatches.length) notes.push("LaunchAgent plist contains secret-like keys and must be regenerated.");
  if (!loopbackOnly) notes.push("Current server host is not loopback-only; resident runtime should bind 127.0.0.1.");

  return {
    label: paths.label,
    supported,
    state: launchd.error && autostartInstalled ? "error" : state,
    pid: input.currentPid,
    port: input.port,
    uptimeSec: input.uptimeSec,
    repoRoot: input.repoRoot,
    logPath: paths.legacyLogPath,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath,
    launchAgentPlist: paths.launchAgentPlist,
    autostartInstalled,
    launchdLoaded: launchd.loaded,
    launchdRunning: launchd.running,
    launchdPid: launchd.pid,
    loopbackOnly,
    plistHasSecrets: plistSecretMatches.length > 0,
    plistSecretMatches,
    manualStartCommand: input.launcher
      ? `ELECTRON_RUN_AS_NODE=1 ${input.launcher.executablePath} ${input.launcher.entryPath}`
      : `cd ${input.repoRoot} && LA_SERVER_HOST=127.0.0.1 LA_SERVER_PORT=${input.port} npm run server`,
    stopCommand: `launchctl bootout ${launchctlGuiDomain()} ${paths.launchAgentPlist}`,
    restartAction: supported ? "launchd" : "not_implemented",
    installCommand: `write ${paths.launchAgentPlist}`,
    startCommand: `launchctl bootstrap ${launchctlGuiDomain()} ${paths.launchAgentPlist}`,
    uninstallCommand: `launchctl bootout ${launchctlGuiDomain()} ${paths.launchAgentPlist} && rm ${paths.launchAgentPlist}`,
    notes,
    lastError: launchd.error,
  };
}

export async function runResidentRuntimeAction(action: ResidentRuntimeAction, input: ResidentRuntimeInput): Promise<ResidentRuntimeActionResult> {
  if (platform() !== "darwin") {
    const status = await readResidentRuntimeStatus(input);
    return { action, ok: false, status, message: "launchd resident runtime is only supported on macOS." };
  }

  const paths = residentRuntimePaths(input.repoRoot);
  await mkdir(resolveRuntimeStorageRoots(input.repoRoot).logRoot, { recursive: true });
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });

  if (action === "install") {
    const plist = renderResidentLaunchAgentPlist({ repoRoot: input.repoRoot, port: input.port, launcher: input.launcher });
    const matches = findPlistSecretMatches(plist);
    if (matches.length) throw new Error(`Refusing to write LaunchAgent plist with secret-like keys: ${matches.join(", ")}`);
    await writeFile(paths.launchAgentPlist, plist, "utf8");
    return { action, ok: true, status: await readResidentRuntimeStatus(input), message: "LaunchAgent plist installed. Start it when the manual server is stopped or ready for handoff." };
  }

  if (action === "start") {
    if (!existsSync(paths.launchAgentPlist)) {
      throw new Error("LaunchAgent plist is not installed. Install it before starting resident runtime.");
    }
    const launchd = await inspectLaunchd();
    const existingHealth = launchd.running ? undefined : await readExistingResidentServerHealth({ port: input.port });
    if (isResidentServerHealthForRepo(existingHealth, input.repoRoot)) {
      return {
        action,
        ok: true,
        status: await readResidentRuntimeStatus(input),
        message: "A healthy Linguist Agent server is already listening on this port; LaunchAgent start is deferred to avoid interrupting it.",
      };
    }
    if (!launchd.loaded) await runLaunchctl(["bootstrap", launchctlGuiDomain(), paths.launchAgentPlist]);
    try {
      await runLaunchctl(["kickstart", "-k", launchctlTarget()]);
    } catch (error) {
      const confirmed = await waitForResidentRuntimeStartConfirmation({ repoRoot: input.repoRoot, port: input.port });
      if (!confirmed) throw error;
    }
    return { action, ok: true, status: await readResidentRuntimeStatus(input), message: "LaunchAgent start requested." };
  }

  if (action === "stop") {
    if (existsSync(paths.launchAgentPlist)) {
      try {
        await runLaunchctl(["bootout", launchctlGuiDomain(), paths.launchAgentPlist]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/No such process|Could not find service|Input\/output error/i.test(message)) throw error;
      }
    }
    return { action, ok: true, status: await readResidentRuntimeStatus(input), message: "LaunchAgent stop requested." };
  }

  if (action === "restart") {
    if (!existsSync(paths.launchAgentPlist)) {
      throw new Error("LaunchAgent plist is not installed. Install it before restarting resident runtime.");
    }
    const launchd = await inspectLaunchd();
    const existingHealth = launchd.running ? undefined : await readExistingResidentServerHealth({ port: input.port });
    if (shouldReplaceManualServerOnRestart({ launchd, health: existingHealth, repoRoot: input.repoRoot })) {
      restartManualServerAfterResponse(input, paths);
      return {
        action,
        ok: true,
        status: await readResidentRuntimeStatus(input),
        message: "Manual server restart requested; current server will exit after responding.",
      };
    }
    if (!launchd.loaded) await runLaunchctl(["bootstrap", launchctlGuiDomain(), paths.launchAgentPlist]);
    try {
      await runLaunchctl(["kickstart", "-k", launchctlTarget()]);
    } catch (error) {
      const confirmed = await waitForResidentRuntimeStartConfirmation({ repoRoot: input.repoRoot, port: input.port });
      if (!confirmed) throw error;
    }
    return { action, ok: true, status: await readResidentRuntimeStatus(input), message: "LaunchAgent restart requested." };
  }

  if (action === "uninstall") {
    if (existsSync(paths.launchAgentPlist)) {
      try {
        await runLaunchctl(["bootout", launchctlGuiDomain(), paths.launchAgentPlist]);
      } catch {
        // Removing the plist is still the reversible cleanup path when the job is not loaded.
      }
      await unlink(paths.launchAgentPlist).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { action, ok: true, status: await readResidentRuntimeStatus(input), message: "LaunchAgent uninstalled." };
  }

  const status = await readResidentRuntimeStatus(input);
  return { action, ok: false, status, message: `Unsupported resident runtime action: ${action}` };
}
