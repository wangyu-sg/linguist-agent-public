import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import {
  createTaskWorkspace,
  listStandaloneFileGrants,
  standaloneTaskWorkspaceRoot,
  TaskWorkspaceConflictError,
  writeJsonFile,
  type TaskArtifactType,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import {
  MaintenanceError,
  buildMaintenanceCandidate,
  previewMaintenance,
  type MaintenanceCandidate,
  type MaintenanceMigrate,
  type MaintenancePlan,
} from "../maintainer.js";

interface StoredMaintenancePlan {
  schemaVersion: 1;
  taskId: string;
  grantId: string;
  plan: MaintenancePlan;
}

interface StoredMaintenanceCandidate {
  schemaVersion: 1;
  taskId: string;
  candidate: MaintenanceCandidate;
}

interface MaintenanceJobState {
  status: "running" | "complete" | "failed";
  planHash: string;
  startedAt: string;
  completedAt?: string;
  candidate?: MaintenanceCandidate;
  snapshot?: TaskWorkspaceSnapshot;
  error?: { code: string; message: string };
}

const maintenanceJobs = new Map<string, MaintenanceJobState>();

export interface MaintainerRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  /** Explicit development/test capability. Stable composition must omit it. */
  allowExecution?: boolean;
  acquireCapabilityMutation?: () => (() => void) | undefined;
  preview?: (input: Parameters<typeof previewMaintenance>[0]) => Promise<MaintenancePlan>;
  build?: (input: Parameters<typeof buildMaintenanceCandidate>[0]) => Promise<MaintenanceCandidate>;
  migrate?: MaintenanceMigrate;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object body is required.");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function digest(value: unknown, label: string): string {
  const result = string(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 digest.`);
  return result;
}

function maintenanceRoot(repoRoot: string, taskId: string): string {
  return join(standaloneTaskWorkspaceRoot(repoRoot, taskId), "maintenance");
}

function planPath(repoRoot: string, taskId: string, planHash: string): string {
  return join(maintenanceRoot(repoRoot, taskId), "plans", `${planHash}.json`);
}

function candidatePath(repoRoot: string, taskId: string, reportSha256: string): string {
  return join(maintenanceRoot(repoRoot, taskId), "reports", `${reportSha256}.json`);
}

function jobKey(repoRoot: string, taskId: string): string {
  return `${resolve(repoRoot)}\0${taskId}`;
}

async function readStored<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function requireRepositoryGrant(repoRoot: string, taskId: string, grantId: string) {
  const grant = (await listStandaloneFileGrants(repoRoot, taskId)).find((candidate) => candidate.id === grantId);
  if (!grant || grant.kind !== "directory" || grant.access !== "read_write" || !grant.recursive) {
    throw new Error("Maintainer requires an active recursive directory grant with read_write access.");
  }
  return grant;
}

async function appendCompletedMaintainerRun(deps: MaintainerRouteDeps, input: {
  taskId: string;
  title: string;
  body: string;
  artifactType: TaskArtifactType;
  artifactTitle: string;
  artifactSummary: string;
  artifactContent: Record<string, unknown>;
  planHash: string;
  agentBacked?: boolean;
}): Promise<TaskWorkspaceSnapshot> {
  const workspace = createTaskWorkspace(deps.repoRoot);
  const before = await workspace.open({ kind: "standalone", taskId: input.taskId });
  if (before.activeRunId) throw new TaskWorkspaceConflictError("Finish or stop the active Run before using Maintainer.");
  const now = new Date().toISOString();
  const runId = `maintainer_${randomUUID()}`;
  const threadId = `${runId}.maintainer`;
  const activityId = `${runId}.result`;
  const artifactId = `${runId}.artifact`;
  await workspace.appendGenerated({
    kind: "standalone",
    taskId: input.taskId,
    runId,
    events: [{
      type: "run_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      run: {
        id: runId,
        taskId: input.taskId,
        mode: "pipeline",
        status: "complete",
        rootAgentThreadId: threadId,
        planHash: input.planHash,
        estimatedCalls: 0,
        estimatedCallsBySource: {},
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        stopAvailable: false,
        resumeAvailable: false,
        resourceManifest: {
          profile: "maintainer",
          packages: [],
          activeToolNames: input.agentBacked ? ["read", "grep", "find", "ls", "edit", "write"] : [],
        },
      },
    }, {
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      thread: {
        id: threadId,
        taskId: input.taskId,
        runId,
        parentThreadId: null,
        identity: input.agentBacked
          ? { kind: "specialist", roleId: "maintainer", displayName: "Maintainer", roleLabel: "Runtime Maintainer", disclosureLabel: "Agent" }
          : { kind: "deterministic", roleId: "maintainer", displayName: "Maintainer", roleLabel: "Runtime Maintainer", disclosureLabel: "System" },
        status: "complete",
        canReceiveUserMessage: false,
        handoffSummary: input.artifactSummary,
        latestActivityId: activityId,
        childThreadIds: [],
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "artifact_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      artifact: {
        id: artifactId,
        taskId: input.taskId,
        runId,
        type: input.artifactType,
        status: "reviewable",
        title: input.artifactTitle,
        summary: input.artifactSummary,
        scope: before.task.scope,
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: input.artifactContent,
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "activity_append",
      agentThreadId: threadId,
      occurredAt: now,
      activity: {
        id: activityId,
        taskId: input.taskId,
        runId,
        agentThreadId: threadId,
        seq: 1,
        type: "artifact_update",
        status: "done",
        actor: { kind: input.agentBacked ? "agent" : "system", id: "maintainer", displayName: "Maintainer", agentThreadId: threadId },
        title: input.title,
        body: input.body,
        tool: { name: "maintainer", effect: "execute", target: input.artifactTitle, outcome: "reviewable" },
        refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    }],
  });
  return workspace.open({ kind: "standalone", taskId: input.taskId });
}

export async function handleMaintainerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  deps: MaintainerRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "tasks" || !parts[2] || parts[3] !== "maintenance") return false;
  const taskId = decodeURIComponent(parts[2]);
  if (req.method !== "GET" && deps.allowExecution !== true) {
    deps.json(res, 403, {
      error: {
        code: "maintainer_disabled_in_stable",
        message: "Runtime Maintainer execution is unavailable in Stable. Existing Task history remains read-only.",
      },
    });
    return true;
  }
  try {
    if (parts[4] === "preview" && parts.length === 5 && req.method === "POST") {
      const before = await createTaskWorkspace(deps.repoRoot).open({ kind: "standalone", taskId });
      if (before.activeRunId) throw new TaskWorkspaceConflictError("Finish or stop the active Run before using Maintainer.");
      const body = object(await deps.readBody(req));
      const grant = await requireRepositoryGrant(deps.repoRoot, taskId, string(body.grantId, "grantId"));
      const targetPiVersion = string(body.targetPiVersion, "targetPiVersion");
      const candidateRoot = join(
        dirname(resolve(deps.repoRoot)),
        "maintenance-candidates",
        taskId,
        `pi-${targetPiVersion.replace(/[^0-9A-Za-z.-]/g, "-")}-${randomUUID()}`,
      );
      const plan = await (deps.preview ?? previewMaintenance)({ repoPath: grant.realPath, targetPiVersion, candidateRoot });
      await writeJsonFile(planPath(deps.repoRoot, taskId, plan.planHash), {
        schemaVersion: 1,
        taskId,
        grantId: grant.id,
        plan,
      } satisfies StoredMaintenancePlan);
      const snapshot = await appendCompletedMaintainerRun(deps, {
        taskId,
        title: "Maintenance plan ready for approval",
        body: "Read-only inspection completed. No repository, runtime, application, or remote state was changed.",
        artifactType: "maintenance_plan",
        artifactTitle: `Pi ${plan.target.piVersion} maintenance plan`,
        artifactSummary: `${plan.repository.dirty ? "Dirty" : "Clean"} repository; candidate will use an isolated Git worktree and ${plan.validationCommands.length} validation commands.`,
        artifactContent: { ...plan, grantId: grant.id },
        planHash: plan.planHash,
      });
      deps.json(res, 201, { plan, snapshot });
      return true;
    }
    if (parts[4] === "build" && parts.length === 5 && req.method === "GET") {
      const job = maintenanceJobs.get(jobKey(deps.repoRoot, taskId));
      if (!job) {
        deps.json(res, 404, { error: { code: "maintenance_job_not_found", message: "This Chat has no maintenance build job." } });
        return true;
      }
      deps.json(res, 200, { job });
      return true;
    }
    if (parts[4] === "build" && parts.length === 5 && req.method === "POST") {
      const body = object(await deps.readBody(req));
      const planHash = digest(body.planHash, "planHash");
      const stored = await readStored<StoredMaintenancePlan>(planPath(deps.repoRoot, taskId, planHash));
      if (!stored || stored.taskId !== taskId) {
        deps.json(res, 404, { error: { code: "maintenance_plan_not_found", message: "The approved maintenance plan was not found in this Chat." } });
        return true;
      }
      await requireRepositoryGrant(deps.repoRoot, taskId, stored.grantId);
      const key = jobKey(deps.repoRoot, taskId);
      const existing = maintenanceJobs.get(key);
      if (existing?.status === "running") {
        deps.json(res, 202, { job: existing });
        return true;
      }
      const job: MaintenanceJobState = { status: "running", planHash, startedAt: new Date().toISOString() };
      maintenanceJobs.set(key, job);
      void (async () => {
        try {
        const candidate = await (deps.build ?? buildMaintenanceCandidate)({
          plan: stored.plan,
          approvedPlanHash: planHash,
          migrate: deps.migrate,
        });
        await writeJsonFile(candidatePath(deps.repoRoot, taskId, candidate.reportSha256), { schemaVersion: 1, taskId, candidate } satisfies StoredMaintenanceCandidate);
        const snapshot = await appendCompletedMaintainerRun(deps, {
          taskId,
          title: "Maintenance candidate validated",
          body: candidate.disposition === "runtime_candidate"
            ? "The candidate protocol matches this Electron app. A second explicit approval is still required before the Electron runtime installer may switch it."
            : "The candidate protocol differs from this Electron app. Runtime-only activation is blocked; install the full signed app candidate instead.",
          artifactType: "file",
          artifactTitle: `Validated Pi ${stored.plan.target.piVersion} candidate`,
          artifactSummary: `${candidate.validation.length} validation commands passed; disposition: ${candidate.disposition}.`,
          artifactContent: { kind: "maintenance_candidate", ...candidate },
          planHash,
          agentBacked: candidate.migration.status === "completed",
        });
          maintenanceJobs.set(key, { ...job, status: "complete", completedAt: new Date().toISOString(), candidate, snapshot });
        } catch (error) {
          maintenanceJobs.set(key, {
            ...job,
            status: "failed",
            completedAt: new Date().toISOString(),
            error: {
              code: error instanceof MaintenanceError ? error.code : "candidate_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      })();
      deps.json(res, 202, { job });
      return true;
    }
    if (parts[4] === "activate" && parts.length === 5 && req.method === "POST") {
      const body = object(await deps.readBody(req));
      const reportSha256 = digest(body.reportSha256, "reportSha256");
      const stored = await readStored<StoredMaintenanceCandidate>(candidatePath(deps.repoRoot, taskId, reportSha256));
      if (!stored || stored.taskId !== taskId) {
        deps.json(res, 404, { error: { code: "maintenance_candidate_not_found", message: "The validated candidate was not found in this Chat." } });
        return true;
      }
      const confirmation = string(body.confirmation, "confirmation");
      if (confirmation !== `activate ${reportSha256.slice(0, 12)}`) {
        deps.json(res, 409, { error: { code: "second_approval_required", message: `Type activate ${reportSha256.slice(0, 12)} to approve this exact candidate.` } });
        return true;
      }
      const candidate = stored.candidate;
      const handoff = candidate.disposition === "runtime_candidate" ? {
        action: "electron_runtime_installer" as const,
        candidateBundleRoot: join(candidate.candidateRoot, "apps", "desktop", "out", "LinguistAgent-darwin-arm64", "LinguistAgent.app", "Contents", "Resources", "runtime"),
        reportSha256,
        serverPerformedSwitch: false as const,
        rollback: "Electron retains the prior managed runtime and restores it automatically if the candidate health check fails.",
      } : {
        action: "install_full_app_candidate" as const,
        candidateAppPath: join(candidate.candidateRoot, "apps", "desktop", "out", "LinguistAgent-darwin-arm64", "LinguistAgent.app"),
        reportSha256,
        serverPerformedSwitch: false as const,
        reason: "The candidate runtime protocol is incompatible with the current Electron app.",
      };
      await writeJsonFile(join(maintenanceRoot(deps.repoRoot, taskId), "activation-handoff.json"), { schemaVersion: 1, taskId, approvedAt: new Date().toISOString(), handoff });
      deps.json(res, 200, { handoff });
      return true;
    }
    deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported Maintainer operation." } });
    return true;
  } catch (error) {
    if (error instanceof MaintenanceError) {
      const status = error.code === "plan_hash_mismatch" || error.code === "repository_changed" ? 409 : 422;
      deps.json(res, status, { error: { code: error.code, message: error.message } });
      return true;
    }
    if (error instanceof TaskWorkspaceConflictError) {
      deps.json(res, 409, { error: { code: "maintainer_conflict", message: error.message } });
      return true;
    }
    deps.json(res, 400, { error: { code: "maintainer_invalid_request", message: error instanceof Error ? error.message : String(error) } });
    return true;
  }
}
