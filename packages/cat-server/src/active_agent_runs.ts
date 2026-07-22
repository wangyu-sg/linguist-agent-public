import type { TeamRoleId } from "@linguist-agent/cat-data";

export interface StopAgentRunRequest {
  turnId?: string;
  scope?: ActiveAgentRun["scope"];
  projectId?: string;
  taskId?: string;
  workflowId?: string;
  roleId?: TeamRoleId;
  subagentRunId?: string;
  parentRunId?: string;
  reason?: string;
}

export interface ActiveAgentRun {
  turnId: string;
  sessionId?: string;
  scope: "project" | "standalone" | "workflow_role" | "private_eval";
  projectId?: string;
  taskId?: string;
  workflowId?: string;
  roleId?: TeamRoleId;
  beforeAbort?: () => Promise<void>;
  session?: { abort: () => Promise<void>; dispose: () => void };
  subagentRunId?: string;
  parentRunId?: string;
  subagent?: { stop: (runId: string) => Promise<void> };
  startedAt: string;
}

export interface StopAgentRunResult {
  stopped: number;
  reason?: string;
  errors: string[];
}

interface ActiveAgentRunState {
  run: ActiveAgentRun;
  status: "running" | "stopping" | "stopped";
  disposed: boolean;
  stopPromise?: Promise<string[]>;
}

export class ActiveAgentRunResourceMutationError extends Error {
  readonly status = 409;
  readonly code = "resource_mutation_active";

  constructor() {
    super("Pi Packages are being changed. Wait for that change to finish before starting an Agent Run.");
    this.name = "ActiveAgentRunResourceMutationError";
  }
}

function isAlreadyTerminalSubagentStop(error: unknown): boolean {
  return error instanceof Error && /Async run '.+' was not found in the active session\.?$/.test(error.message);
}

export class ActiveAgentRunRegistry {
  private readonly runs = new Map<string, ActiveAgentRunState>();
  private pendingStarts = 0;
  private resourceMutationActive = false;

  constructor(private readonly subagentDisposeDelayMs = 12_000, private readonly stopTimeoutMs = 8_000) {}

  register(run: Omit<ActiveAgentRun, "startedAt"> & Partial<Pick<ActiveAgentRun, "startedAt">>): ActiveAgentRun {
    if (this.resourceMutationActive) throw new ActiveAgentRunResourceMutationError();
    if (this.runs.has(run.turnId)) throw new Error(`Agent run ${run.turnId} is already active.`);
    const active: ActiveAgentRun = {
      ...run,
      startedAt: run.startedAt ?? new Date().toISOString(),
    };
    const state: ActiveAgentRunState = { run: active, status: "running", disposed: false };
    this.runs.set(active.turnId, state);
    const stoppedParent = active.parentRunId ? this.runs.get(active.parentRunId) : undefined;
    if (stoppedParent && stoppedParent.status !== "running") {
      void this.stopRun(state);
    }
    return active;
  }

  /**
   * Protect the setup window before a Run can be registered. Callers release
   * only after register() succeeds or setup fails, so Package mutations cannot
   * rewrite a resource tree between verification and Session ownership.
   */
  acquireRunStartLease(): () => void {
    if (this.resourceMutationActive) throw new ActiveAgentRunResourceMutationError();
    this.pendingStarts += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingStarts = Math.max(0, this.pendingStarts - 1);
    };
  }

  /** Atomically excludes both live Runs and Runs still resolving resources. */
  tryAcquireResourceMutationLease(): (() => void) | undefined {
    if (this.resourceMutationActive || this.pendingStarts > 0 || this.runs.size > 0) return undefined;
    this.resourceMutationActive = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.resourceMutationActive = false;
    };
  }

  unregister(turnId: string): void {
    const state = this.runs.get(turnId);
    if (!state) return;
    this.dispose(state);
    this.runs.delete(turnId);
  }

  /** Finish matching externally-owned sessions after Pi/subagent completion. */
  complete(filter: StopAgentRunRequest, _error?: unknown): number {
    const matches = this.matchingStates(filter);
    for (const state of matches) {
      this.dispose(state);
      this.runs.delete(state.run.turnId);
    }
    return matches.length;
  }

  list(): ActiveAgentRun[] {
    return Array.from(this.runs.values(), (state) => state.run);
  }

  find(filter: StopAgentRunRequest): ActiveAgentRun | undefined {
    return this.matchingStates(filter)[0]?.run;
  }

  isStoppingOrStopped(turnId: string): boolean {
    const state = this.runs.get(turnId);
    return state ? state.status !== "running" : false;
  }

  activeSessionIds(filter: StopAgentRunRequest = {}): string[] {
    return Array.from(new Set(
      this.matchingStates(filter)
        .filter((state) => state.status === "running" && state.run.sessionId)
        .map((state) => state.run.sessionId as string),
    ));
  }

  async stop(filter: StopAgentRunRequest): Promise<StopAgentRunResult> {
    const matches = this.matchingStates(filter).filter((state) => state.status === "running");
    const errors: string[] = [];
    for (const state of matches) errors.push(...await this.stopRun(state));
    return { stopped: matches.length, reason: filter.reason, errors };
  }

  private async stopRun(state: ActiveAgentRunState): Promise<string[]> {
    if (state.stopPromise) return state.stopPromise;
    state.status = "stopping";
    state.stopPromise = (async () => {
      const errors: string[] = [];
      const stopDeadline = Date.now() + Math.max(1, this.stopTimeoutMs);
      if (state.run.beforeAbort) {
        await this.runStopStep("beforeAbort", state.run.beforeAbort, errors, () => false, stopDeadline);
      }
      if (state.run.subagentRunId && state.run.subagent) {
        await this.runStopStep(
          "subagent stop",
          () => state.run.subagent!.stop(state.run.subagentRunId!),
          errors,
          isAlreadyTerminalSubagentStop,
          stopDeadline,
        );
      }
      if (state.run.session) {
        await this.runStopStep("session abort", () => state.run.session!.abort(), errors, () => false, stopDeadline);
      }
      state.status = "stopped";
      this.dispose(state);
      return errors;
    })();
    return state.stopPromise;
  }

  private async runStopStep(
    label: string,
    action: () => Promise<void>,
    errors: string[],
    ignoreError: (error: unknown) => boolean = () => false,
    deadline = Date.now() + Math.max(1, this.stopTimeoutMs),
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} timed out within the ${Math.max(1, this.stopTimeoutMs)}ms Stop budget`)),
            remainingMs,
          );
        }),
      ]);
    } catch (error) {
      if (!ignoreError(error)) errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private dispose(state: ActiveAgentRunState): void {
    if (state.disposed || !state.run.session) return;
    state.disposed = true;
    const dispose = () => {
      try {
        state.run.session?.dispose();
      } catch {
        // Cleanup is best effort; a provider teardown bug must not strand Stop.
      }
    };
    if (!state.run.subagentRunId || this.subagentDisposeDelayMs <= 0) {
      dispose();
      return;
    }
    const timer = setTimeout(dispose, this.subagentDisposeDelayMs);
    timer.unref?.();
  }

  private matchingStates(filter: StopAgentRunRequest): ActiveAgentRunState[] {
    return Array.from(this.runs.values()).filter(({ run }) =>
      (!filter.turnId || run.turnId === filter.turnId) &&
      (!filter.scope || run.scope === filter.scope) &&
      (!filter.projectId || run.projectId === filter.projectId) &&
      (!filter.taskId || run.taskId === filter.taskId) &&
      (!filter.workflowId || run.workflowId === filter.workflowId) &&
      (!filter.roleId || run.roleId === filter.roleId) &&
      (!filter.subagentRunId || run.subagentRunId === filter.subagentRunId) &&
      (!filter.parentRunId || run.parentRunId === filter.parentRunId)
    );
  }
}
