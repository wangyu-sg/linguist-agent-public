import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTaskWorkspace,
  parseTaskWorkspaceSnapshot,
  type TaskRunEventDraft,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";

const TERMINAL_RUN_STATUSES = new Set(["stopped", "failed", "stale", "complete"]);
const NATIVE_INTERACTION_PREFIXES = ["native-ui:", "pi-ask:"] as const;
const RESTART_REASON = "The runtime restarted before the Agent run completed.";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface TaskExtensionReconciliationResult {
  failedRuns: number;
  runIds: string[];
  diagnostics: TaskExtensionReconciliationDiagnostic[];
}

export interface TaskExtensionReconciliationDiagnostic {
  projectId: string;
  taskId: string;
  code: "task_snapshot_unreadable" | "task_reconciliation_failed";
}

function isNativeInteractionId(value: string | null | undefined): boolean {
  return Boolean(value && NATIVE_INTERACTION_PREFIXES.some((prefix) => value.startsWith(prefix)));
}

function snapshotMayContainNativeInteraction(serialized: string): boolean {
  return /"interactionId"\s*:\s*"(?:native-ui:|pi-ask:)/.test(serialized);
}

function snapshotHasInterruptedRun(snapshot: TaskWorkspaceSnapshot): boolean {
  return snapshot.runs.some((run) => (
    !TERMINAL_RUN_STATUSES.has(run.status)
    && (
      (run.mode === "single" && run.startedAt != null)
      || snapshot.decisions.some((decision) => decision.runId === run.id && isNativeInteractionId(decision.interactionId))
    )
  ));
}

function runWasInterrupted(snapshot: TaskWorkspaceSnapshot, runId: string): boolean {
  const run = snapshot.runs.find((candidate) => candidate.id === runId);
  return Boolean(run
    && !TERMINAL_RUN_STATUSES.has(run.status)
    && (
      (run.mode === "single" && run.startedAt != null)
      || snapshot.decisions.some((decision) => decision.runId === run.id && isNativeInteractionId(decision.interactionId))
    ));
}

function restartFailureEvents(snapshot: TaskWorkspaceSnapshot, runId: string, failedAt: string): TaskRunEventDraft[] {
  const run = snapshot.runs.find((candidate) => candidate.id === runId);
  if (!run) return [];
  const thread = snapshot.agentThreads.find((candidate) => candidate.id === run.rootAgentThreadId);
  if (!thread) return [];
  const required = snapshot.decisions.filter((decision) => decision.runId === runId && decision.status === "required");
  return [
    {
      type: "run_upsert",
      agentThreadId: thread.id,
      run: {
        ...run,
        status: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        stopAvailable: false,
        resumeAvailable: false,
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: thread.id,
      thread: { ...thread, status: "failed", updatedAt: failedAt },
    },
    ...required.map((decision): TaskRunEventDraft => ({
      type: "decision_upsert",
      agentThreadId: decision.requestedByThreadId,
      decision: { ...decision, status: "cancelled", reason: RESTART_REASON, decidedAt: failedAt },
    })),
    {
      type: "activity_append",
      agentThreadId: thread.id,
      activity: {
        id: `${runId}.extension-runtime-restarted`,
        taskId: snapshot.task.id,
        runId,
        agentThreadId: thread.id,
        seq: 0,
        type: "error",
        status: "error",
        actor: { kind: "system", id: "pi-runtime", displayName: "Pi Runtime", agentThreadId: thread.id },
        title: "Agent run interrupted",
        body: `${RESTART_REASON} Retry starts a new Run; this Run is preserved as failed.`,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: required.map((decision) => decision.id) },
        createdAt: failedAt,
        updatedAt: failedAt,
      },
    },
  ];
}

export async function reconcileInterruptedTaskExtensionInteractions(input: {
  repoRoot: string;
  failedAt?: string;
}): Promise<TaskExtensionReconciliationResult> {
  const failedAt = input.failedAt ?? new Date().toISOString();
  const workspace = createTaskWorkspace(input.repoRoot);
  const projectsRoot = join(input.repoRoot, "data", "projects");
  const projectEntries = await readdir(projectsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const runIds: string[] = [];
  const diagnostics: TaskExtensionReconciliationDiagnostic[] = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory() || !SAFE_ID.test(projectEntry.name)) continue;
    const projectId = projectEntry.name;
    const tasksRoot = join(projectsRoot, projectId, "task_workspace", "tasks");
    const taskEntries = await readdir(tasksRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const taskEntry of taskEntries) {
      if (!taskEntry.isDirectory() || !SAFE_ID.test(taskEntry.name)) continue;
      const taskId = taskEntry.name;
      let serialized: string;
      try {
        serialized = await readFile(join(tasksRoot, taskId, "snapshot.json"), "utf8");
      } catch {
        diagnostics.push({ projectId, taskId, code: "task_snapshot_unreadable" });
        continue;
      }
      const snapshotHasNativeInteraction = snapshotMayContainNativeInteraction(serialized);
      let candidate: TaskWorkspaceSnapshot;
      try {
        candidate = parseTaskWorkspaceSnapshot(JSON.parse(serialized));
      } catch {
        // Preserve the cheap recovery-index behavior for unrelated historical
        // Tasks. A malformed snapshot is actionable here only when it claims
        // to contain a native interaction that startup must reconcile.
        if (snapshotHasNativeInteraction) {
          diagnostics.push({ projectId, taskId, code: "task_snapshot_unreadable" });
        }
        continue;
      }
      if (candidate.task.status === "archived") continue;

      if (!snapshotHasInterruptedRun(candidate)) {
        try {
          // appendGenerated() fsyncs the event page before replacing the
          // derived snapshot. If the process dies between those writes, the
          // snapshot cannot identify the pending interaction. Probe the log
          // cursor and let open() replay only Tasks with a real cursor gap.
          const probe = await workspace.probe({ projectId, taskId });
          if (probe.eventCursor === candidate.eventCursor) continue;
        } catch {
          diagnostics.push({ projectId, taskId, code: "task_reconciliation_failed" });
          continue;
        }
      }

      try {
        const snapshot = await workspace.open({ projectId, taskId });
        for (const run of snapshot.runs) {
          if (!runWasInterrupted(snapshot, run.id)) continue;
          const events = restartFailureEvents(snapshot, run.id, failedAt);
          if (!events.length) continue;
          await workspace.appendGenerated({ projectId, taskId, runId: run.id, events });
          runIds.push(run.id);
        }
      } catch {
        diagnostics.push({ projectId, taskId, code: "task_reconciliation_failed" });
      }
    }
  }

  return { failedRuns: runIds.length, runIds, diagnostics };
}
