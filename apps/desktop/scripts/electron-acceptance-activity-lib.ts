import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createTaskWorkspace, type TaskWorkspace } from "@linguist-agent/cat-data";

const run = promisify(execFile);
const FIXTURE = "electron-acceptance-stress";

export const ACCEPTANCE_ACTIVITY_COUNT = 100;
export const ACCEPTANCE_ACTIVITY_HZ = 5;

type ProducerRequest = {
  runToken: string;
  expectedEvents: number;
  expectedHz: number;
};

type FixtureConfig = {
  fixture?: unknown;
  containsCustomerData?: unknown;
  runtimeURL?: unknown;
  scenarios?: {
    activityAppend?: {
      projectId?: unknown;
      taskId?: unknown;
      expectedEvents?: unknown;
      expectedHz?: unknown;
      producer?: unknown;
    };
  };
};

async function readJSON(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`Acceptance marker is missing or invalid: ${path}.`);
  }
}

function assertRuntimeURL(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Acceptance activity runtime must be loopback HTTP.");
  }
  if (!url.port || url.port === "8787" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Acceptance activity runtime must use an isolated non-8787 loopback port.");
  }
  return url.origin;
}

function isOwnedMarker(value: Record<string, unknown>, projectId?: string): boolean {
  return value.fixture === FIXTURE
    && value.containsCustomerData === false
    && (projectId === undefined || value.projectId === projectId);
}

async function assertSafeRoot(repoRoot: string): Promise<string> {
  const root = resolve(repoRoot);
  if (root === "/private/tmp" || root.startsWith("/private/tmp/") || root === "/tmp" || root.startsWith("/tmp/")) return root;
  const gitMarker = await stat(join(root, ".git")).catch(() => null);
  if (!gitMarker?.isFile()) throw new Error("Acceptance writes require /tmp or an explicit linked Git worktree.");
  const ignored = await run("/usr/bin/git", ["-C", root, "check-ignore", "data/"]).then(() => true, () => false);
  if (!ignored) throw new Error("Linked-worktree data/ must be ignored before acceptance writes.");
  return root;
}

export async function assertOwnedElectronAcceptanceFixture(input: {
  repoRoot: string;
  runtimeURL: string;
  projectId: string;
  taskId: string;
}): Promise<{ repoRoot: string; runtimeURL: string; config: FixtureConfig }> {
  const repoRoot = await assertSafeRoot(input.repoRoot);
  const runtimeURL = assertRuntimeURL(input.runtimeURL);
  const globalMarker = await readJSON(join(repoRoot, "data", "electron-acceptance-fixture.json"));
  const projectMarker = await readJSON(join(repoRoot, "data", "projects", input.projectId, "electron-acceptance-fixture.json"));
  const config = await readJSON(join(repoRoot, "data", "electron-acceptance-config.json")) as FixtureConfig;
  if (!isOwnedMarker(globalMarker) || !isOwnedMarker(projectMarker, input.projectId)
    || config.fixture !== FIXTURE || config.containsCustomerData !== false) {
    throw new Error("Acceptance activity writes require an owned synthetic fixture with containsCustomerData:false.");
  }
  if (typeof config.runtimeURL !== "string" || assertRuntimeURL(config.runtimeURL) !== runtimeURL) {
    throw new Error("Acceptance fixture runtimeURL does not match the isolated runtime.");
  }
  const scenario = config.scenarios?.activityAppend;
  if (scenario?.projectId !== input.projectId || scenario.taskId !== input.taskId
    || scenario.expectedEvents !== ACCEPTANCE_ACTIVITY_COUNT || scenario.expectedHz !== ACCEPTANCE_ACTIVITY_HZ
    || scenario.producer !== "external-canonical") {
    throw new Error("Task is not the configured synthetic activityAppend scenario.");
  }
  return { repoRoot, runtimeURL, config };
}

export function validateElectronAcceptanceActivityRequest(value: unknown): ProducerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Activity producer request must be an object.");
  const request = value as Partial<ProducerRequest>;
  if (typeof request.runToken !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(request.runToken)) {
    throw new Error("runToken must be a short synthetic identifier.");
  }
  if (request.expectedEvents !== ACCEPTANCE_ACTIVITY_COUNT) throw new Error("Activity producer requires exactly 100 events.");
  if (request.expectedHz !== ACCEPTANCE_ACTIVITY_HZ) throw new Error("Activity producer requires exactly 5 Hz.");
  return { runToken: request.runToken, expectedEvents: ACCEPTANCE_ACTIVITY_COUNT, expectedHz: ACCEPTANCE_ACTIVITY_HZ };
}

export function acceptanceActivityPrefix(runToken: string): string {
  return `electron-acceptance-live-${runToken}-`;
}

export function producerStatusLine(
  state: "producer_ready" | "producer_complete",
  runToken: string,
  details: Record<string, unknown>,
): string {
  return `${JSON.stringify({
    ...details,
    state,
    runToken: `sha256:${createHash("sha256").update(runToken).digest("hex").slice(0, 12)}`,
  })}\n`;
}

export async function runElectronAcceptanceActivitySequence(input: {
  repoRoot: string;
  runtimeURL: string;
  projectId: string;
  taskId: string;
  runToken: string;
  expectedEvents: number;
  expectedHz: number;
  workspace?: Pick<TaskWorkspace, "open" | "appendGenerated">;
  now?: () => string;
  monotonicNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ appended: number; firstSeq: number; lastSeq: number; startedAt: string; completedAt: string }> {
  const request = validateElectronAcceptanceActivityRequest(input);
  const owned = await assertOwnedElectronAcceptanceFixture(input);
  const workspace = input.workspace ?? createTaskWorkspace(owned.repoRoot);
  const now = input.now ?? (() => new Date().toISOString());
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const sleep = input.sleep ?? ((milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  const runRecord = snapshot.activeRunId
    ? snapshot.runs.find((candidate) => candidate.id === snapshot.activeRunId)
    : undefined;
  if (!runRecord || runRecord.status !== "active") throw new Error("Synthetic activityAppend Task must have one active canonical Run.");
  const thread = snapshot.agentThreads.find((candidate) => candidate.id === runRecord.rootAgentThreadId);
  if (!thread) throw new Error("Synthetic activityAppend Run has no canonical root Agent thread.");
  const prefix = acceptanceActivityPrefix(request.runToken);
  if (snapshot.activities.some((activity) => activity.id.startsWith(prefix))) {
    throw new Error(`Acceptance activity run ${request.runToken} already exists; use a unique run token.`);
  }

  const startedAt = now();
  const intervalMs = 1_000 / request.expectedHz;
  const startTick = monotonicNow();
  for (let offset = 0; offset < request.expectedEvents; offset += 1) {
    const waitMs = startTick + offset * intervalMs - monotonicNow();
    if (waitMs > 0) await sleep(waitMs);
    const createdAt = now();
    const index = offset + 1;
    await workspace.appendGenerated({
      projectId: input.projectId,
      taskId: input.taskId,
      runId: runRecord.id,
      events: [{
        type: "activity_append",
        agentThreadId: thread.id,
        occurredAt: createdAt,
        activity: {
          id: `${prefix}${String(index).padStart(3, "0")}`,
          taskId: input.taskId,
          runId: runRecord.id,
          agentThreadId: thread.id,
          seq: 0,
          type: "progress",
          status: "done",
          actor: { kind: "system", id: "acceptance-harness", displayName: "Acceptance Harness", agentThreadId: thread.id },
          title: `Synthetic live activity ${index}`,
          body: "Synthetic Electron acceptance event; no customer text or hidden reasoning.",
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
          createdAt,
          updatedAt: createdAt,
        },
      }],
    });
  }

  const finalSnapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  const appended = finalSnapshot.activities.filter((activity) => activity.id.startsWith(prefix));
  if (appended.length !== request.expectedEvents) {
    throw new Error(`Acceptance activity sequence committed ${appended.length}/${request.expectedEvents} events.`);
  }
  if (!appended.every((activity, index) => index === 0 || activity.seq > appended[index - 1]!.seq)) {
    throw new Error("Acceptance activity sequence is not strictly ordered.");
  }
  return {
    appended: appended.length,
    firstSeq: appended[0]!.seq,
    lastSeq: appended.at(-1)!.seq,
    startedAt,
    completedAt: now(),
  };
}
