import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_RUNTIME = "http://127.0.0.1:8787";
const KEYCHAIN_SERVICE = "com.linguist-agent.local-transport";

export const RETAINED_RUNS = 5;
export const WARMUP_RUNS = 3;
export const PERFORMANCE_GATES = Object.freeze({
  firstVisibleP95Ms: 1_000,
  shellInteractiveP95Ms: 1_500,
  scopeFeedbackMs: 100,
  scopeReadyP95Ms: 300,
  inspectorStableMs: 100,
  averageFps: 57,
  p95FrameMs: 20,
  hitchRatio: 0.01,
  freezeMs: 100,
  activityVisibleMs: 100,
});

export const REQUIRED_STATES = Object.freeze([
  "running",
  "waiting",
  "stopping",
  "stopped",
  "failed",
  "empty",
  "loading",
  "decision",
  "permission-error",
  "credential-error",
  "draft-conflict",
]);

export function assertIsolatedRuntimeURL(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Acceptance runtime must be loopback HTTP.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Acceptance runtime URL must contain only loopback host and port.");
  }
  const normalized = url.origin;
  if (normalized === DEFAULT_RUNTIME || url.port === "8787") {
    throw new Error("Port 8787 is reserved for the managed runtime. Start an isolated runtime on another port.");
  }
  return normalized;
}

export function redactId(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

export function nearestRank(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

export function summarize(values) {
  if (!values.length) return { count: 0, min: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0],
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    max: sorted.at(-1),
  };
}

export function frameSummary(timestamps, targetHz = 60) {
  const deltas = timestamps.slice(1).map((value, index) => value - timestamps[index]).filter((value) => value > 0);
  const durationMs = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0;
  const hitchThresholdMs = Math.max(20, (1_000 / targetHz) * 1.2);
  const hitches = deltas.filter((value) => value > hitchThresholdMs);
  return {
    frames: deltas.length,
    durationMs,
    averageFps: durationMs > 0 ? deltas.length * 1_000 / durationMs : null,
    p95FrameMs: nearestRank(deltas, 0.95),
    maxFrameMs: deltas.length ? Math.max(...deltas) : null,
    hitchThresholdMs,
    hitchCount: hitches.length,
    hitchRatio: deltas.length ? hitches.length / deltas.length : null,
    freezeCount: deltas.filter((value) => value >= PERFORMANCE_GATES.freezeMs).length,
  };
}

export function parseArguments(argv) {
  const result = { allowGaps: false };
  for (const argument of argv) {
    if (argument === "--allow-gaps") result.allowGaps = true;
    else if (argument.startsWith("--config=")) result.configPath = resolve(argument.slice(9));
    else if (argument.startsWith("--out=")) result.outputDirectory = resolve(argument.slice(6));
    else if (argument.startsWith("--only=")) result.only = argument.slice(7).split(",").filter(Boolean);
    else if (argument.startsWith("--label=")) result.label = argument.slice(8);
    else if (argument.startsWith("--activity-run-token=")) result.activityRunToken = argument.slice(21);
    else if (argument.startsWith("--activity-handshake=")) result.activityHandshake = assertAcceptanceHandshakePath(argument.slice(21));
    else throw new Error(`Unknown acceptance argument: ${argument}`);
  }
  if (Boolean(result.activityRunToken) !== Boolean(result.activityHandshake)) {
    throw new Error("--activity-run-token and --activity-handshake must be provided together.");
  }
  if (result.activityRunToken && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(result.activityRunToken)) {
    throw new Error("--activity-run-token must be a short synthetic identifier.");
  }
  return result;
}

export function assertAcceptanceHandshakePath(value) {
  const path = resolve(value);
  if (path !== "/private/tmp" && !path.startsWith("/private/tmp/") && path !== "/tmp" && !path.startsWith("/tmp/")) {
    throw new Error("Acceptance handshakes must stay under /tmp.");
  }
  return path;
}

export async function writeAcceptanceHandshake(path, value) {
  const target = assertAcceptanceHandshakePath(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" });
  try {
    await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadAcceptanceConfig(path = process.env.LA_ACCEPTANCE_CONFIG) {
  if (!path) throw new Error("Set LA_ACCEPTANCE_CONFIG or pass --config=<fixture.json>.");
  const config = JSON.parse(await readFile(resolve(path), "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Acceptance config must be an object.");
  return config;
}

export async function resolveCredential(environment = process.env) {
  if (environment.LA_LOCAL_API_TOKEN?.trim()) return environment.LA_LOCAL_API_TOKEN.trim();
  if (process.platform !== "darwin") throw new Error("Set LA_LOCAL_API_TOKEN for the isolated runtime.");
  try {
    const { stdout } = await run("/usr/bin/security", [
      "find-generic-password",
      "-a",
      userInfo().username,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], { maxBuffer: 4_096 });
    if (stdout.trim()) return stdout.trim();
  } catch {
    // Report one non-secret failure below.
  }
  throw new Error("Isolated runtime credential is unavailable.");
}

export async function runtimeJSON(runtimeURL, credential, path, authenticated = true) {
  const response = await fetch(new URL(path, `${runtimeURL}/`), {
    headers: authenticated ? { authorization: `Bearer ${credential}` } : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) throw new Error(`Acceptance runtime ${path} returned HTTP ${response.status}.`);
  return data;
}

function scenario(config, name, gaps) {
  const value = config.scenarios?.[name];
  if (!value || typeof value !== "object") gaps.push(`${name}: scenario is not configured`);
  return value ?? null;
}

export async function inspectFixture(config, runtimeURL, credential) {
  const gaps = [];
  const health = await runtimeJSON(runtimeURL, credential, "/api/health", false);
  const projectResponse = await runtimeJSON(runtimeURL, credential, "/api/projects");
  const projects = Array.isArray(projectResponse?.projects) ? projectResponse.projects : [];
  const projectMap = new Map(projects.map((project) => [project.projectId, project]));
  const tasksByProject = new Map();
  const snapshots = new Map();

  for (const project of projects) {
    const taskResponse = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(project.projectId)}/tasks`);
    const tasks = Array.isArray(taskResponse?.tasks) ? taskResponse.tasks : [];
    tasksByProject.set(project.projectId, tasks);
    for (const task of tasks) {
      const snapshot = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(project.projectId)}/tasks/${encodeURIComponent(task.id)}`);
      snapshots.set(`${project.projectId}:${task.id}`, snapshot);
    }
  }

  const findProject = (id, label) => {
    const project = projectMap.get(id);
    if (!project) gaps.push(`${label}: project is missing`);
    return project;
  };
  const findBatch = (projectId, batchId, label) => {
    const project = findProject(projectId, label);
    const batch = project?.batches?.find((candidate) => candidate.batchId === batchId);
    if (project && !batch) gaps.push(`${label}: batch is missing`);
    return batch;
  };
  const findSnapshot = (projectId, taskId, label) => {
    const snapshot = snapshots.get(`${projectId}:${taskId}`);
    if (!snapshot) gaps.push(`${label}: task is missing`);
    return snapshot;
  };

  const projectSwitch = scenario(config, "projectSwitch", gaps);
  if (projectSwitch) {
    if (projectSwitch.fromProjectId === projectSwitch.toProjectId) gaps.push("projectSwitch: two distinct projects are required");
    findProject(projectSwitch.fromProjectId, "projectSwitch.from");
    findProject(projectSwitch.toProjectId, "projectSwitch.to");
  }

  const batchSwitch = scenario(config, "batchSwitch", gaps);
  if (batchSwitch) {
    if (batchSwitch.fromBatchId === batchSwitch.toBatchId) gaps.push("batchSwitch: two distinct batches are required");
    findBatch(batchSwitch.projectId, batchSwitch.fromBatchId, "batchSwitch.from");
    findBatch(batchSwitch.projectId, batchSwitch.toBatchId, "batchSwitch.to");
  }

  const taskSwitch = scenario(config, "taskSwitch", gaps);
  if (taskSwitch) {
    if (!taskSwitch.fromBatchId || !taskSwitch.toBatchId) gaps.push("taskSwitch: fromBatchId and toBatchId are required for deterministic navigation");
    if (taskSwitch.fromTaskId === taskSwitch.toTaskId) gaps.push("taskSwitch: two distinct tasks are required");
    findSnapshot(taskSwitch.projectId, taskSwitch.fromTaskId, "taskSwitch.from");
    findSnapshot(taskSwitch.projectId, taskSwitch.toTaskId, "taskSwitch.to");
  }

  for (const [name, minimum] of [["activity465", 465], ["activity1146", 1_146]]) {
    const value = scenario(config, name, gaps);
    if (!value) continue;
    if (!value.batchId) gaps.push(`${name}: batchId is required for deterministic navigation`);
    else findBatch(value.projectId, value.batchId, name);
    const snapshot = findSnapshot(value.projectId, value.taskId, name);
    const count = snapshot?.activities?.length ?? 0;
    if (snapshot && count < minimum) gaps.push(`${name}: ${count} complete activities, requires at least ${minimum}`);
  }

  for (const [name, minimum] of [["cat1040", 1_040], ["cat10000", 10_000]]) {
    const value = scenario(config, name, gaps);
    if (!value) continue;
    const batch = findBatch(value.projectId, value.batchId, name);
    if (batch && batch.segments < minimum) gaps.push(`${name}: ${batch.segments} complete segments, requires at least ${minimum}`);
    if (!value.taskId) gaps.push(`${name}: taskId is required because CAT is a Task workspace mode`);
    else findSnapshot(value.projectId, value.taskId, name);
  }

  const inspector = scenario(config, "inspector", gaps);
  if (inspector) {
    if (!inspector.batchId) gaps.push("inspector: batchId is required for deterministic navigation");
    else findBatch(inspector.projectId, inspector.batchId, "inspector");
    const snapshot = findSnapshot(inspector.projectId, inspector.taskId, "inspector");
    const inspectable = (snapshot?.artifacts?.length ?? 0) + (snapshot?.decisions?.length ?? 0)
      + (snapshot?.activities?.filter((activity) => !["message", "final_response"].includes(activity.type)).length ?? 0);
    if (snapshot && !inspectable) gaps.push("inspector: task has no inspectable Activity, Artifact, or Decision");
  }

  const activityAppend = scenario(config, "activityAppend", gaps);
  if (activityAppend) {
    if (!activityAppend.batchId) gaps.push("activityAppend: batchId is required for deterministic navigation");
    else findBatch(activityAppend.projectId, activityAppend.batchId, "activityAppend");
    findSnapshot(activityAppend.projectId, activityAppend.taskId, "activityAppend");
    if (activityAppend.expectedEvents !== 100 || activityAppend.expectedHz !== 5) {
      gaps.push("activityAppend: requires exactly 100 canonical events at 5 Hz");
    }
    if (activityAppend.producer !== "external-canonical") {
      gaps.push("activityAppend: producer must be external-canonical; the renderer harness never fabricates events");
    }
  }

  if (!config.uiTask) gaps.push("uiTask: task for window/keyboard/AX acceptance is not configured");
  else {
    if (!config.uiTask.batchId) gaps.push("uiTask: batchId is required for deterministic navigation");
    findSnapshot(config.uiTask.projectId, config.uiTask.taskId, "uiTask");
  }

  const stateStatuses = {
    running: ["active"],
    waiting: ["awaiting_input", "waiting"],
    stopping: ["stopping"],
    stopped: ["stopped"],
    failed: ["failed", "stale"],
  };
  for (const state of REQUIRED_STATES) {
    const value = config.states?.[state];
    if (!value) {
      gaps.push(`state.${state}: fixture is not configured`);
      continue;
    }
    if (state in stateStatuses || state === "decision") {
      const snapshot = findSnapshot(value.projectId, value.taskId, `state.${state}`);
      if (!snapshot) continue;
      if (state === "decision") {
        if (!snapshot.decisions?.some((decision) => decision.status === "pending" || decision.status === "required")) {
          gaps.push("state.decision: task has no pending canonical Decision");
        }
      } else {
        const statuses = new Set((snapshot.runs ?? []).map((run) => run.status));
        if (!stateStatuses[state].some((status) => statuses.has(status))) {
          gaps.push(`state.${state}: task has no ${stateStatuses[state].join("/")} Run`);
        }
      }
    } else if (typeof value.capture !== "string" || !value.capture.trim()) {
      gaps.push(`state.${state}: a repeatable capture instruction is required`);
    }
  }

  return {
    health: {
      productVersion: health?.productVersion ?? null,
      apiProtocolVersion: health?.apiProtocolVersion ?? null,
      dataSchemaVersion: health?.dataSchemaVersion ?? null,
      runtimeInstanceId: health?.runtimeInstanceId ? redactId(health.runtimeInstanceId) : null,
      capabilities: Array.isArray(health?.capabilities) ? [...health.capabilities].sort() : [],
    },
    inventory: {
      projects: projects.map((project) => ({
        id: redactId(project.projectId),
        batches: (project.batches ?? []).map((batch) => ({ id: redactId(batch.batchId), segments: batch.segments })),
        tasks: (tasksByProject.get(project.projectId) ?? []).map((task) => {
          const snapshot = snapshots.get(`${project.projectId}:${task.id}`);
          return {
            id: redactId(task.id),
            status: task.status,
            activities: snapshot?.activities?.length ?? 0,
            artifacts: snapshot?.artifacts?.length ?? 0,
            decisions: snapshot?.decisions?.length ?? 0,
          };
        }),
      })),
    },
    gaps: [...new Set(gaps)].sort(),
  };
}

export async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForTarget(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Electron DevTools target did not appear.", { cause: lastError });
}

export class CDPClient {
  #socket;
  #nextId = 0;
  #pending = new Map();

  static async connect(url) {
    const client = new CDPClient();
    await client.#open(url);
    return client;
  }

  async #open(url) {
    await new Promise((resolveOpen, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
      socket.addEventListener("close", () => {
        for (const pending of this.#pending.values()) pending.reject(new Error("CDP connection closed."));
        this.#pending.clear();
      });
      this.#socket = socket;
    });
  }

  send(method, params = {}) {
    return new Promise((resolveSend, reject) => {
      const id = ++this.#nextId;
      this.#pending.set(id, { resolve: resolveSend, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket?.close();
  }
}

export async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

export async function waitForExpression(client, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for renderer state: ${expression}`);
}

function executableFor(appPath) {
  const resolved = resolve(appPath);
  if (resolved === "/Applications" || resolved.startsWith("/Applications/")) {
    throw new Error("Acceptance never launches the installed /Applications client.");
  }
  return resolved.endsWith(".app") ? join(resolved, "Contents", "MacOS", "Linguist Agent") : resolved;
}

export async function launchAcceptanceApp({ appPath, runtimeURL, credential, width = 1_440, height = 900 }) {
  const executable = executableFor(appPath);
  await access(executable);
  const port = await availablePort();
  const userData = await mkdtemp(join(tmpdir(), "la-electron-acceptance-profile-"));
  let stdout = "";
  let stderr = "";
  const startedAt = performance.now();
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--disable-background-networking",
  ], {
    env: {
      ...process.env,
      LA_MAC_LOCAL_SERVER_URL: runtimeURL,
      LA_LOCAL_API_TOKEN: credential,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-65_536); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-65_536); });

  try {
    const target = await waitForTarget(port);
    const targetAt = performance.now();
    const client = await CDPClient.connect(target.webSocketDebuggerUrl);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Performance.enable"),
      client.send("Accessibility.enable"),
    ]);
    await waitForExpression(client, "document.readyState === 'complete' && document.visibilityState === 'visible'");
    const visibleAt = performance.now();
    await waitForExpression(client, "document.querySelector('.workspace-shell')");
    const shellAt = performance.now();
    await waitForExpression(client, "document.querySelector('.workspace-start, .workspace-project, .workspace-batch-ready, .workspace-task-surface') && !document.querySelector('[aria-busy=true]')");
    const contentAt = performance.now();
    return {
      client,
      child,
      target,
      userData,
      startedAt,
      milestones: {
        debugTargetMs: targetAt - startedAt,
        firstVisibleMs: visibleAt - startedAt,
        shellInteractiveMs: shellAt - startedAt,
        contentReadyMs: contentAt - startedAt,
      },
      output: () => ({ stdout, stderr }),
      async close() {
        client.close();
        if (child.exitCode === null) child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolveExit) => child.once("exit", resolveExit)),
          new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
        ]);
        if (child.exitCode === null) child.kill("SIGKILL");
        await rm(userData, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(userData, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : error}\n${stderr.slice(-2_000)}`);
  }
}

export async function rendererMemory(client) {
  const [metrics, counters] = await Promise.all([
    client.send("Performance.getMetrics"),
    client.send("Memory.getDOMCounters"),
  ]);
  const values = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
  return {
    jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
    jsHeapTotalBytes: values.JSHeapTotalSize ?? null,
    documents: counters.documents,
    nodes: counters.nodes,
    jsEventListeners: counters.jsEventListeners,
  };
}

export async function processTreeMemory(rootPid) {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,rss="]);
  const rows = stdout.trim().split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), rssKiB: Number(match[3]) }] : [];
  });
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!pids.has(row.pid) && pids.has(row.parentPid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  return {
    processCount: pids.size,
    rssBytes: rows.filter((row) => pids.has(row.pid)).reduce((sum, row) => sum + row.rssKiB * 1_024, 0),
  };
}

export async function environmentReport(appPath, displayHz, environment = process.env) {
  const executable = executableFor(appPath);
  const appBytes = await readFile(executable);
  const command = async (file, args) => {
    try { return (await run(file, args, { maxBuffer: 1024 * 1024 })).stdout.trim(); } catch { return null; }
  };
  const requirement = await command("/usr/bin/codesign", ["-d", "-r-", appPath]);
  return {
    collectedAt: new Date().toISOString(),
    app: basename(appPath),
    executableSha256: createHash("sha256").update(appBytes).digest("hex"),
    designatedRequirement: requirement,
    gitCommit: await command("/usr/bin/git", ["rev-parse", "HEAD"]),
    macOS: await command("/usr/bin/sw_vers", []),
    architecture: process.arch,
    node: process.version,
    displayHz,
    displayVerification: environment.LA_ACCEPTANCE_DISPLAY_VERIFIED === "1" ? "operator-verified" : "declared-only",
    fixed60HzComparable: displayHz === 60 && environment.LA_ACCEPTANCE_DISPLAY_VERIFIED === "1",
  };
}
