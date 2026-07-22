import type {
  TaskActiveRunSummary,
  TaskLocator,
  TaskRecord,
  TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import { taskActiveRunSummary, taskLocator } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import { applyTaskEvent, TaskEventGapError } from "./task-events.ts";
import { notificationCandidateForTaskEvent, parseNotificationCandidate } from "./notification-candidate.ts";
import {
  standalonePermissionRequestFromStream,
  taskPermissionRequestFromStream,
  workspaceClient,
  WorkspaceAPIError,
  type AgentPermissionUserDecision,
  type BatchSegment,
  type BatchResponse,
  type CreateTaskInput,
  type DecisionInteractionInput,
  type BatchSummary,
  type ProjectSummary,
  type RuntimeStatus,
  type SegmentEvidenceSnapshot,
  type SegmentTagContract,
  type SpecialistFollowUpInput,
  type SpecialistFollowUpResult,
  type StreamState,
  type TaskDecisionInput,
  type TaskPermissionRequest,
  type TeamWorkflowAction,
  type NotificationPreferences,
} from "./workspace-client.ts";

type LoadState = "idle" | "loading" | "ready" | "error";

export interface SegmentEvidenceScope {
  projectId: string;
  batchId: string;
  segmentId: string;
}

export type SegmentEvidenceState =
  | { status: "idle"; scope: null; snapshot: null; error: null }
  | { status: "loading"; scope: SegmentEvidenceScope; snapshot: null; error: null }
  | { status: "ready"; scope: SegmentEvidenceScope; snapshot: SegmentEvidenceSnapshot; error: null }
  | { status: "error"; scope: SegmentEvidenceScope; snapshot: null; error: string };

export interface WorkspaceState {
  runtime: RuntimeStatus | null;
  projects: ProjectSummary[];
  chats: TaskRecord[];
  projectId: string | null;
  batchId: string | null;
  taskId: string | null;
  tasks: TaskRecord[];
  activeRunsByTaskId: Record<string, TaskActiveRunSummary>;
  chatActiveRunsByTaskId: Record<string, TaskActiveRunSummary>;
  batch: BatchResponse | null;
  batchSummary: BatchSummary | null;
  segmentEvidence: SegmentEvidenceState;
  task: TaskWorkspaceSnapshot | null;
  projectsState: LoadState;
  chatsState: LoadState;
  tasksState: LoadState;
  batchState: LoadState;
  taskState: LoadState;
  eventState: StreamState["status"] | "idle";
  eventMessage: string | null;
  permissionRequests: TaskPermissionRequest[];
  permissionState: LoadState;
  permissionError: string | null;
  notificationPreferences: NotificationPreferences | null;
  error: string | null;
}

const initialState: WorkspaceState = {
  runtime: null,
  projects: [],
  chats: [],
  projectId: null,
  batchId: null,
  taskId: null,
  tasks: [],
  activeRunsByTaskId: {},
  chatActiveRunsByTaskId: {},
  batch: null,
  batchSummary: null,
  segmentEvidence: { status: "idle", scope: null, snapshot: null, error: null },
  task: null,
  projectsState: "idle",
  chatsState: "idle",
  tasksState: "idle",
  batchState: "idle",
  taskState: "idle",
  eventState: "idle",
  eventMessage: null,
  permissionRequests: [],
  permissionState: "idle",
  permissionError: null,
  notificationPreferences: null,
  error: null,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptySegmentEvidence(): SegmentEvidenceState {
  return { status: "idle", scope: null, snapshot: null, error: null };
}

function sameEvidenceScope(left: SegmentEvidenceScope | null, right: SegmentEvidenceScope): boolean {
  return left?.projectId === right.projectId
    && left.batchId === right.batchId
    && left.segmentId === right.segmentId;
}

function upsertTask(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  return [task, ...tasks.filter((candidate) => candidate.id !== task.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function projectBatchId(task: TaskRecord | undefined): string | null {
  return task?.scope.kind === "project" ? task.scope.batchId ?? null : null;
}

function indexActiveRuns(activeRuns: readonly TaskActiveRunSummary[] = []): Record<string, TaskActiveRunSummary> {
  return Object.fromEntries(activeRuns.map((summary) => [summary.taskId, summary]));
}

function replaceActiveRunSummary(
  activeRunsByTaskId: Record<string, TaskActiveRunSummary>,
  snapshot: TaskWorkspaceSnapshot,
): Record<string, TaskActiveRunSummary> {
  const next = { ...activeRunsByTaskId };
  delete next[snapshot.task.id];
  const summary = taskActiveRunSummary(snapshot);
  if (summary) next[summary.taskId] = summary;
  return next;
}

function backgroundTaskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

function isSelectedLocator(state: WorkspaceState, locator: TaskLocator): boolean {
  return state.taskId === locator.taskId
    && (locator.kind === "standalone"
      ? state.projectId === null
      : state.projectId === locator.projectId);
}

function isNotificationTaskEligible(
  task: TaskRecord,
  activeRun: TaskActiveRunSummary | undefined,
): boolean {
  if (task.status === "active" || task.status === "awaiting_input") return true;
  return activeRun?.status === "active"
    || activeRun?.status === "awaiting_input"
    || activeRun?.status === "waiting"
    || activeRun?.status === "stopping";
}

export class WorkspaceStore {
  #state: WorkspaceState = initialState;
  #listeners = new Set<() => void>();
  #projectsRequest = 0;
  #chatsRequest = 0;
  #tasksRequest = 0;
  #batchRequest = 0;
  #segmentEvidenceRequest = 0;
  #taskRequest = 0;
  #unsubscribeTaskEvents: (() => void) | null = null;
  #taskEventSubscription = 0;
  #backgroundNotificationTargets = new Set<string>();
  #backgroundNotificationSubscriptions = new Map<string, (() => void) | null>();
  #closed = false;
  #removeNotificationListener: (() => void) | null = null;
  #presentedNotificationIds = new Set<string>();
  #beforeScopeTransition: (() => Promise<boolean>) | null = null;

  getState = (): WorkspaceState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setBeforeScopeTransition(guard: (() => Promise<boolean>) | null): () => void {
    this.#beforeScopeTransition = guard;
    return () => {
      if (this.#beforeScopeTransition === guard) this.#beforeScopeTransition = null;
    };
  }

  async prepareScopeTransition(): Promise<boolean> {
    return this.#beforeScopeTransition ? this.#beforeScopeTransition() : true;
  }

  #set(patch: Partial<WorkspaceState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  async boot(): Promise<void> {
    if (!this.#removeNotificationListener && typeof window !== "undefined" && window.linguist?.system?.onNotification) {
      this.#removeNotificationListener = window.linguist.system.onNotification((value) => {
        const candidate = parseNotificationCandidate(value);
        if (!candidate) return;
        void this.selectProject(candidate.projectId)
          .then(() => this.openTask(candidate.projectId, candidate.taskId))
          .catch(() => undefined);
      });
    }
    try {
      const runtime = await workspaceClient.runtimeStatus();
      this.#set({ runtime, error: runtime.status === "ready" ? null : runtime.message });
      if (runtime.status === "ready") {
        await Promise.all([this.refreshProjects(), this.refreshChats()]);
        try {
          this.#set({ notificationPreferences: await workspaceClient.fetchNotificationPreferences() });
        } catch {
          // Older managed runtimes may not expose the optional preference seam yet.
          this.#set({ notificationPreferences: null });
        }
        // Background notification streams are intentionally post-ready work. They use
        // the canonical Task SSE route and must never delay the first interactive shell.
        queueMicrotask(() => void this.#syncAllBackgroundNotificationTasks());
      }
    } catch (error) {
      this.#set({ projectsState: "error", error: message(error) });
    }
  }

  setNotificationPreferences(preferences: NotificationPreferences | null): void {
    this.#set({ notificationPreferences: preferences });
  }

  async refreshProjects(): Promise<void> {
    const request = ++this.#projectsRequest;
    this.#set({ projectsState: "loading", error: null });
    try {
      const { projects } = await workspaceClient.listProjects();
      if (request !== this.#projectsRequest) return;
      this.#set({ projects, projectsState: "ready" });
    } catch (error) {
      if (request !== this.#projectsRequest) return;
      this.#set({ projectsState: "error", error: message(error) });
    }
  }

  async refreshChats(): Promise<void> {
    const request = ++this.#chatsRequest;
    this.#set({ chatsState: "loading", error: null });
    try {
      const { tasks, activeRuns } = await workspaceClient.listChats();
      if (request !== this.#chatsRequest) return;
      this.#set({
        chats: tasks,
        chatActiveRunsByTaskId: indexActiveRuns(activeRuns),
        chatsState: "ready",
      });
    } catch (error) {
      if (request !== this.#chatsRequest) return;
      this.#set({ chatsState: "error", error: message(error) });
    }
  }

  async selectProject(projectId: string): Promise<void> {
    if (!await this.prepareScopeTransition()) return;
    const request = ++this.#tasksRequest;
    ++this.#batchRequest;
    ++this.#segmentEvidenceRequest;
    ++this.#taskRequest;
    this.#disconnectTaskEvents();
    this.#set({
      projectId,
      batchId: null,
      taskId: null,
      tasks: [],
      activeRunsByTaskId: {},
      batch: null,
      batchSummary: null,
      segmentEvidence: emptySegmentEvidence(),
      task: null,
      tasksState: "loading",
      batchState: "idle",
      taskState: "idle",
      eventState: "idle",
      eventMessage: null,
      permissionRequests: [],
      permissionState: "idle",
      permissionError: null,
      error: null,
    });
    try {
      const { tasks, activeRuns } = await workspaceClient.listTasks(projectId);
      if (request !== this.#tasksRequest || this.#state.projectId !== projectId) return;
      const activeTask = this.#state.task?.task;
      this.#set({
        tasks: activeTask?.owner.kind === "project" && activeTask.owner.projectId === projectId
          ? upsertTask(tasks, activeTask)
          : tasks,
        activeRunsByTaskId: indexActiveRuns(activeRuns),
        tasksState: "ready",
      });
      this.#syncBackgroundNotificationTasks(projectId, tasks, activeRuns);
    } catch (error) {
      if (request !== this.#tasksRequest || this.#state.projectId !== projectId) return;
      this.#set({ tasksState: "error", error: message(error) });
    }
  }

  async openBatch(projectId: string, batchId: string): Promise<void> {
    if (!await this.prepareScopeTransition()) return;
    const request = ++this.#batchRequest;
    ++this.#segmentEvidenceRequest;
    const sameProject = this.#state.projectId === projectId;
    if (!sameProject) ++this.#tasksRequest;
    const keepTask = sameProject && projectBatchId(this.#state.task?.task) === batchId;
    if (!keepTask) {
      ++this.#taskRequest;
      this.#disconnectTaskEvents();
    }
    this.#set({
      projectId,
      batchId,
      taskId: keepTask ? this.#state.taskId : null,
      tasks: sameProject ? this.#state.tasks : [],
      activeRunsByTaskId: sameProject ? this.#state.activeRunsByTaskId : {},
      batch: null,
      batchSummary: null,
      segmentEvidence: emptySegmentEvidence(),
      task: keepTask ? this.#state.task : null,
      tasksState: sameProject ? this.#state.tasksState : "idle",
      batchState: "loading",
      taskState: keepTask ? this.#state.taskState : "idle",
      eventState: keepTask ? this.#state.eventState : "idle",
      eventMessage: keepTask ? this.#state.eventMessage : null,
      permissionRequests: keepTask ? this.#state.permissionRequests : [],
      permissionState: keepTask ? this.#state.permissionState : "idle",
      permissionError: keepTask ? this.#state.permissionError : null,
      error: null,
    });
    try {
      const { summary } = await workspaceClient.openBatchSummary(projectId, batchId);
      if (request !== this.#batchRequest || this.#state.projectId !== projectId || this.#state.batchId !== batchId) return;
      this.#set({ batchSummary: summary, batchState: "ready" });
    } catch (error) {
      if (request !== this.#batchRequest || this.#state.projectId !== projectId || this.#state.batchId !== batchId) return;
      this.#set({ batchState: "error", error: message(error) });
    }
  }

  async ensureBatchLoaded(): Promise<BatchResponse | null> {
    const { projectId, batchId } = this.#state;
    if (!projectId || !batchId) return null;
    const loaded = this.#state.batch;
    if (
      loaded?.batch.projectId === projectId
      && loaded.batch.batchId === batchId
    ) return loaded;

    const request = ++this.#batchRequest;
    this.#set({ batch: null, batchState: "loading", error: null });
    try {
      const batch = await workspaceClient.openBatch(projectId, batchId);
      if (
        request !== this.#batchRequest
        || this.#state.projectId !== projectId
        || this.#state.batchId !== batchId
      ) return null;
      this.#set({ batch, batchState: "ready", error: null });
      return batch;
    } catch (error) {
      if (
        request !== this.#batchRequest
        || this.#state.projectId !== projectId
        || this.#state.batchId !== batchId
      ) return null;
      this.#set({ batchState: "error", error: message(error) });
      return null;
    }
  }

  async loadSegmentEvidence(projectId: string, batchId: string, segmentId: string): Promise<void> {
    const scope = { projectId, batchId, segmentId };
    if (this.#state.projectId !== projectId || this.#state.batchId !== batchId) return;
    if (
      sameEvidenceScope(this.#state.segmentEvidence.scope, scope)
      && (this.#state.segmentEvidence.status === "loading" || this.#state.segmentEvidence.status === "ready")
    ) return;

    const request = ++this.#segmentEvidenceRequest;
    this.#set({ segmentEvidence: { status: "loading", scope, snapshot: null, error: null } });
    try {
      const snapshot = await workspaceClient.fetchSegmentEvidence(projectId, batchId, segmentId);
      if (
        request !== this.#segmentEvidenceRequest
        || this.#state.projectId !== projectId
        || this.#state.batchId !== batchId
        || !sameEvidenceScope(this.#state.segmentEvidence.scope, scope)
      ) return;
      if (
        snapshot.projectId !== projectId
        || snapshot.batchId !== batchId
        || snapshot.segmentId !== segmentId
      ) throw new Error("Runtime returned evidence for a different segment scope.");
      this.#set({ segmentEvidence: { status: "ready", scope, snapshot, error: null } });
    } catch (error) {
      if (
        request !== this.#segmentEvidenceRequest
        || this.#state.projectId !== projectId
        || this.#state.batchId !== batchId
        || !sameEvidenceScope(this.#state.segmentEvidence.scope, scope)
      ) return;
      this.#set({ segmentEvidence: { status: "error", scope, snapshot: null, error: message(error) } });
    }
  }

  applyCanonicalSegment(projectId: string, batchId: string, segment: BatchSegment, batchUpdatedAt: string): void {
    const response = this.#state.batch;
    if (
      this.#state.projectId !== projectId
      || this.#state.batchId !== batchId
      || !response
      || response.batch.projectId !== projectId
      || response.batch.batchId !== batchId
    ) return;
    const previousSegment = response.batch.segments.find((candidate) => candidate.id === segment.id);
    const tagViews = { ...response.batch.tagViews };
    delete tagViews[segment.id];
    const projects = this.#state.projects.map((project) => project.projectId !== projectId ? project : {
      ...project,
      updatedAt: batchUpdatedAt,
      batches: project.batches.map((summary) => {
        if (summary.batchId !== batchId || !previousSegment) return summary;
        const counts = { new: summary.new, draft: summary.draft, confirmed: summary.confirmed, locked: summary.locked };
        counts[previousSegment.status] = Math.max(0, counts[previousSegment.status] - 1);
        counts[segment.status] += 1;
        if (previousSegment.locked !== segment.locked) counts.locked += segment.locked ? 1 : -1;
        return { ...summary, ...counts, updatedAt: batchUpdatedAt };
      }),
    });
    this.#set({
      projects,
      batch: {
        ...response,
        delivery: null,
        batch: {
          ...response.batch,
          updatedAt: batchUpdatedAt,
          tagViews,
          segments: response.batch.segments.map((candidate) => candidate.id === segment.id ? segment : candidate),
        },
      },
      batchState: "ready",
      error: null,
    });
  }

  applySegmentTagContract(
    projectId: string,
    batchId: string,
    segmentId: string,
    expectedSegmentUpdatedAt: string | null,
    contract: SegmentTagContract,
  ): void {
    const response = this.#state.batch;
    const segment = response?.batch.segments.find((candidate) => candidate.id === segmentId);
    if (
      this.#state.projectId !== projectId
      || this.#state.batchId !== batchId
      || !response
      || response.batch.projectId !== projectId
      || response.batch.batchId !== batchId
      || !segment
      || (segment.updatedAt ?? null) !== expectedSegmentUpdatedAt
    ) return;
    this.#set({
      batch: {
        ...response,
        batch: {
          ...response.batch,
          tagViews: { ...response.batch.tagViews, [segmentId]: contract },
        },
      },
    });
  }

  async openTask(projectId: string, taskId: string): Promise<void> {
    if (!await this.prepareScopeTransition()) return;
    const request = ++this.#taskRequest;
    ++this.#batchRequest;
    this.#disconnectTaskEvents();
    const sameProject = this.#state.projectId === projectId;
    if (!sameProject) ++this.#tasksRequest;
    const scopedTasks = sameProject ? this.#state.tasks : [];
    const listedBatchId = projectBatchId(scopedTasks.find((task) => task.id === taskId));
    const retainedBatch = sameProject
      && this.#state.batch?.batch.projectId === projectId
      && this.#state.batch.batch.batchId === listedBatchId
      ? this.#state.batch
      : null;
    const retainedSummary = sameProject
      && this.#state.batchSummary?.projectId === projectId
      && this.#state.batchSummary.batchId === listedBatchId
      ? this.#state.batchSummary
      : null;
    const retainSegmentEvidence = sameProject && this.#state.batchId === listedBatchId;
    if (!retainSegmentEvidence) ++this.#segmentEvidenceRequest;
    this.#set({
      projectId,
      batchId: listedBatchId,
      taskId,
      tasks: scopedTasks,
      activeRunsByTaskId: sameProject ? this.#state.activeRunsByTaskId : {},
      batch: retainedBatch,
      batchSummary: retainedSummary,
      segmentEvidence: retainSegmentEvidence ? this.#state.segmentEvidence : emptySegmentEvidence(),
      task: null,
      tasksState: sameProject ? this.#state.tasksState : "idle",
      batchState: retainedBatch ? "ready" : "idle",
      taskState: "loading",
      eventState: "idle",
      eventMessage: null,
      permissionRequests: [],
      permissionState: "loading",
      permissionError: null,
      error: null,
    });
    try {
      const [task, permissions] = await Promise.all([
        workspaceClient.openTask(projectId, taskId),
        workspaceClient.listTaskPermissionRequests(projectId, taskId)
          .then((requests) => ({ requests, error: null as string | null }))
          .catch((error) => ({ requests: [] as TaskPermissionRequest[], error: message(error) })),
      ]);
      if (request !== this.#taskRequest || this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
      if (task.task.owner.kind !== "project" || task.task.owner.projectId !== projectId || task.task.scope.kind !== "project") {
        throw new Error("Project Task route returned a non-project Task.");
      }
      const batchId = task.task.scope.batchId ?? null;
      if (batchId !== listedBatchId) ++this.#batchRequest;
      const currentBatch = this.#state.batch?.batch.projectId === projectId
        && this.#state.batch.batch.batchId === batchId
        ? this.#state.batch
        : null;
      const currentSummary = this.#state.batchSummary?.projectId === projectId
        && this.#state.batchSummary.batchId === batchId
        ? this.#state.batchSummary
        : this.#state.projects.find((project) => project.projectId === projectId)?.batches.find((batch) => batch.batchId === batchId) ?? null;
      const loadingCurrentBatch = batchId === this.#state.batchId && this.#state.batchState === "loading";
      const keepSegmentEvidence = this.#state.segmentEvidence.scope?.projectId === projectId
        && this.#state.segmentEvidence.scope.batchId === batchId;
      if (!keepSegmentEvidence) ++this.#segmentEvidenceRequest;
      this.#set({
        task,
        tasks: upsertTask(this.#state.tasks, task.task),
        activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, task),
        batchId,
        batch: currentBatch,
        batchSummary: currentSummary,
        segmentEvidence: keepSegmentEvidence ? this.#state.segmentEvidence : emptySegmentEvidence(),
        batchState: currentBatch ? "ready" : loadingCurrentBatch ? "loading" : "idle",
        taskState: "ready",
        permissionRequests: permissions.requests,
        permissionState: permissions.error ? "error" : "ready",
        permissionError: permissions.error,
      });
      this.#connectTaskEvents({ kind: "project", projectId, taskId }, task.eventCursor, request);
      this.#syncBackgroundNotificationTasks(projectId, this.#state.tasks, Object.values(this.#state.activeRunsByTaskId));
    } catch (error) {
      if (request !== this.#taskRequest || this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
      this.#set({ taskState: "error", error: message(error) });
    }
  }

  async openChat(taskId: string): Promise<void> {
    if (!await this.prepareScopeTransition()) return;
    const request = ++this.#taskRequest;
    ++this.#tasksRequest;
    ++this.#batchRequest;
    ++this.#segmentEvidenceRequest;
    this.#disconnectTaskEvents();
    this.#set({
      projectId: null,
      batchId: null,
      taskId,
      tasks: [],
      activeRunsByTaskId: {},
      batch: null,
      batchSummary: null,
      segmentEvidence: emptySegmentEvidence(),
      task: null,
      tasksState: "idle",
      batchState: "idle",
      taskState: "loading",
      eventState: "idle",
      eventMessage: null,
      permissionRequests: [],
      permissionState: "loading",
      permissionError: null,
      error: null,
    });
    try {
      const [snapshot, permissions] = await Promise.all([
        workspaceClient.openChat(taskId),
        workspaceClient.listStandalonePermissionRequests(taskId)
          .then((requests) => ({ requests, error: null as string | null }))
          .catch((error) => ({ requests: [] as TaskPermissionRequest[], error: message(error) })),
      ]);
      if (request !== this.#taskRequest || this.#state.projectId !== null || this.#state.taskId !== taskId) return;
      if (snapshot.task.owner.kind !== "standalone" || snapshot.task.scope.kind !== "standalone") {
        throw new Error("Standalone Chat route returned a project Task.");
      }
      this.#set({
        task: snapshot,
        chats: upsertTask(this.#state.chats, snapshot.task),
        chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
        taskState: "ready",
        permissionRequests: permissions.requests,
        permissionState: permissions.error ? "error" : "ready",
        permissionError: permissions.error,
      });
      this.#connectTaskEvents({ kind: "standalone", taskId }, snapshot.eventCursor, request);
    } catch (error) {
      if (request !== this.#taskRequest || this.#state.projectId !== null || this.#state.taskId !== taskId) return;
      this.#set({ taskState: "error", error: message(error) });
    }
  }

  async refreshTaskEvents(): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!taskId) return;
    if (projectId) await this.openTask(projectId, taskId);
    else await this.openChat(taskId);
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<TaskWorkspaceSnapshot> {
    const snapshot = await workspaceClient.createTask(projectId, input);
    if (this.#state.projectId === projectId) {
      const request = ++this.#taskRequest;
      this.#disconnectTaskEvents();
      const tasks = upsertTask(this.#state.tasks, snapshot.task);
      if (snapshot.task.owner.kind !== "project" || snapshot.task.scope.kind !== "project") {
        throw new Error("Project Task creation returned a non-project Task.");
      }
      const batchId = snapshot.task.scope.batchId ?? null;
      const keepBatch = this.#state.batchId === batchId;
      if (!keepBatch) ++this.#segmentEvidenceRequest;
      this.#set({
        tasks,
        activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, snapshot),
        taskId: snapshot.task.id,
        task: snapshot,
        batchId,
        batch: keepBatch ? this.#state.batch : null,
        batchSummary: keepBatch ? this.#state.batchSummary : null,
        segmentEvidence: keepBatch ? this.#state.segmentEvidence : emptySegmentEvidence(),
        batchState: keepBatch ? this.#state.batchState : "idle",
        taskState: "ready",
        permissionRequests: [],
        permissionState: "ready",
        permissionError: null,
        error: null,
      });
      this.#connectTaskEvents({ kind: "project", projectId, taskId: snapshot.task.id }, snapshot.eventCursor, request);
      this.#syncBackgroundNotificationTasks(projectId, this.#state.tasks, Object.values(this.#state.activeRunsByTaskId));
    }
    return snapshot;
  }

  async createChat(input: { title?: string; intent?: string } = {}): Promise<TaskWorkspaceSnapshot> {
    const snapshot = await workspaceClient.createChat(input);
    if (snapshot.task.owner.kind !== "standalone" || snapshot.task.scope.kind !== "standalone") {
      throw new Error("Standalone Chat creation returned a project Task.");
    }
    const request = ++this.#taskRequest;
    ++this.#tasksRequest;
    ++this.#batchRequest;
    ++this.#segmentEvidenceRequest;
    this.#disconnectTaskEvents();
    this.#set({
      projectId: null,
      batchId: null,
      taskId: snapshot.task.id,
      tasks: [],
      activeRunsByTaskId: {},
      batch: null,
      batchSummary: null,
      segmentEvidence: emptySegmentEvidence(),
      task: snapshot,
      chats: upsertTask(this.#state.chats, snapshot.task),
      chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
      tasksState: "idle",
      batchState: "idle",
      taskState: "ready",
      eventState: "idle",
      eventMessage: null,
      permissionRequests: [],
      permissionState: "ready",
      permissionError: null,
      error: null,
    });
    this.#connectTaskEvents(taskLocator(snapshot.task), snapshot.eventCursor, request);
    return snapshot;
  }

  async renameTask(titleText: string): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!taskId) throw new Error("Select a Task before renaming it.");
    const title = titleText.trim();
    if (!title) throw new Error("Task title is required.");
    if (Array.from(title).length > 120) throw new Error("Task title must be 120 characters or fewer.");
    const snapshot = projectId
      ? await workspaceClient.renameTask(projectId, taskId, title)
      : await workspaceClient.renameChat(taskId, title);
    if (this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
    this.#set({
      task: snapshot,
      ...(projectId ? {
        tasks: upsertTask(this.#state.tasks, snapshot.task),
        activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, snapshot),
      } : {
        chats: upsertTask(this.#state.chats, snapshot.task),
        chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
      }),
      taskState: "ready",
      error: null,
    });
  }

  /** 重命名任意 Task(侧栏右键菜单用),不切换当前 scope。 */
  async renameTaskById(projectId: string, taskId: string, titleText: string): Promise<void> {
    const title = titleText.trim();
    if (!title) throw new Error("Task title is required.");
    if (Array.from(title).length > 120) throw new Error("Task title must be 120 characters or fewer.");
    const snapshot = await workspaceClient.renameTask(projectId, taskId, title);
    if (this.#state.projectId === projectId && this.#state.taskId === taskId && this.#state.task) {
      this.#set({
        task: snapshot,
        tasks: upsertTask(this.#state.tasks, snapshot.task),
        activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, snapshot),
      });
    } else if (this.#state.projectId === projectId) {
      this.#set({ tasks: upsertTask(this.#state.tasks, snapshot.task) });
    }
  }

  async renameChatById(taskId: string, titleText: string): Promise<void> {
    const title = titleText.trim();
    if (!title) throw new Error("Chat title is required.");
    if (Array.from(title).length > 120) throw new Error("Chat title must be 120 characters or fewer.");
    const snapshot = await workspaceClient.renameChat(taskId, title);
    const selected = this.#state.projectId === null && this.#state.taskId === taskId;
    this.#set({
      chats: upsertTask(this.#state.chats, snapshot.task),
      chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
      ...(selected ? { task: snapshot, taskState: "ready" as const } : {}),
    });
  }

  async archiveChat(taskId: string): Promise<void> {
    const snapshot = await workspaceClient.archiveChat(taskId);
    const selected = this.#state.projectId === null && this.#state.taskId === taskId;
    this.#set({
      chats: upsertTask(this.#state.chats, snapshot.task),
      chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
      ...(selected ? { task: snapshot, taskState: "ready" as const } : {}),
    });
  }

  async restoreChat(taskId: string): Promise<void> {
    const snapshot = await workspaceClient.restoreChat(taskId);
    const selected = this.#state.projectId === null && this.#state.taskId === taskId;
    this.#set({
      chats: upsertTask(this.#state.chats, snapshot.task),
      chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, snapshot),
      ...(selected ? { task: snapshot, taskState: "ready" as const } : {}),
    });
  }

  sendChat(
    messageText: string,
    options: {
      runId?: string;
      segmentId?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: import("./workspace-client.ts").AgentThinkingLevel;
      assetPaths?: string[];
      capabilityIds?: import("./workspace-client.ts").NativeComposerCapabilityId[];
      delivery?: "auto" | "steer" | "follow_up";
      agentThreadId?: string;
      onEvent?: (event: unknown) => void;
      onState?: (state: StreamState) => void;
    } = {},
  ): () => void {
    const { projectId, taskId } = this.#state;
    if (!taskId) throw new Error("Select a Task before sending a message.");
    const message = messageText.trim();
    if (!message) throw new Error("Message is required.");
    const delivery = options.delivery ?? "auto";
    if (projectId && delivery !== "auto") {
      let active = true;
      void workspaceClient.sendTaskMessage(projectId, taskId, { message, delivery }).then((accepted) => {
        if (!active) return;
        options.onEvent?.({ type: "accepted", taskId, ...accepted });
        options.onState?.({ status: "closed" });
      }).catch((error) => {
        if (!active) return;
        options.onState?.({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
      return () => { active = false; };
    }
    if (!projectId) {
      if (this.#state.task?.task.owner.kind !== "standalone") throw new Error("Selected Chat is not standalone.");
      if (delivery !== "auto") {
        let active = true;
        void workspaceClient.sendChatMessage(taskId, {
          message,
          delivery,
          ...(options.agentThreadId ? { agentThreadId: options.agentThreadId } : {}),
        }).then((accepted) => {
          if (!active) return;
          options.onEvent?.({ type: "accepted", taskId, ...accepted });
          options.onState?.({ status: "closed" });
        }).catch((error) => {
          if (!active) return;
          options.onState?.({ status: "error", message: error instanceof Error ? error.message : String(error) });
        });
        return () => { active = false; };
      }
      return workspaceClient.streamChatMessage({
        taskId,
        message,
        delivery,
        ...(options.agentThreadId ? { agentThreadId: options.agentThreadId } : {}),
        ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      }, (event) => options.onEvent?.(event), options.onState);
    }
    return workspaceClient.streamTaskChat(
      {
        projectId,
        taskId,
        message,
        runId: options.runId,
        segmentId: options.segmentId,
        modelProvider: options.modelProvider,
        modelId: options.modelId,
        thinkingLevel: options.thinkingLevel,
        assetPaths: options.assetPaths,
        capabilityIds: options.capabilityIds,
      },
      (event) => options.onEvent?.(event),
      options.onState,
    );
  }

  async stopTask(reason?: string, turnId?: string): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!taskId) throw new Error("Select a Task before stopping it.");
    if (projectId) await workspaceClient.stopTask(projectId, taskId, { reason, turnId });
    else await workspaceClient.stopChat(taskId, { reason });
    if (this.#state.projectId === projectId && this.#state.taskId === taskId) {
      this.#set({ permissionRequests: [], permissionState: "ready", permissionError: null });
    }
  }

  async compactChat(customInstructions?: string, agentThreadId?: string): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (projectId !== null || !taskId) throw new Error("Select a standalone Chat before compacting it.");
    await workspaceClient.compactChat(taskId, {
      ...(customInstructions?.trim() ? { customInstructions: customInstructions.trim() } : {}),
      ...(agentThreadId ? { agentThreadId } : {}),
    });
    await this.openChat(taskId);
  }

  async forkChat(input: { sourceThreadId?: string; entryId?: string; position?: "before" | "at" }): Promise<import("./workspace-client.ts").ChatForkResult> {
    const { projectId, taskId } = this.#state;
    if (projectId !== null || !taskId) throw new Error("Select a standalone Chat before branching it.");
    const result = await workspaceClient.forkChat(taskId, input);
    await this.openChat(taskId);
    return result;
  }

  async copyChat(input: { title?: string; throughActivityId?: string } = {}): Promise<TaskWorkspaceSnapshot> {
    const { projectId, taskId } = this.#state;
    if (projectId !== null || !taskId) throw new Error("Select a standalone Chat before copying it.");
    const snapshot = await workspaceClient.copyChat(taskId, input);
    this.#set({ chats: upsertTask(this.#state.chats, snapshot.task) });
    await this.openChat(snapshot.task.id);
    return snapshot;
  }

  acceptPermissionRequest(value: unknown): void {
    const { projectId, taskId } = this.#state;
    if (!taskId) return;
    const request = projectId
      ? taskPermissionRequestFromStream(value, projectId, taskId)
      : standalonePermissionRequestFromStream(value, taskId);
    if (!request) return;
    this.#set({
      permissionRequests: [request, ...this.#state.permissionRequests.filter((row) => row.requestId !== request.requestId)],
      permissionState: "ready",
      permissionError: null,
    });
  }

  async refreshPermissionRequests(): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!taskId) return;
    this.#set({ permissionState: "loading", permissionError: null });
    try {
      const permissionRequests = projectId
        ? await workspaceClient.listTaskPermissionRequests(projectId, taskId)
        : await workspaceClient.listStandalonePermissionRequests(taskId);
      if (this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
      const resolved = this.#state.permissionRequests.filter((row) => row.status !== "pending" && row.status !== "expired");
      this.#set({
        permissionRequests: [...permissionRequests, ...resolved.filter((row) => !permissionRequests.some((pending) => pending.requestId === row.requestId))],
        permissionState: "ready",
        permissionError: null,
      });
    } catch (error) {
      if (this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
      this.#set({ permissionState: "error", permissionError: message(error) });
    }
  }

  async decidePermission(requestId: string, decision: AgentPermissionUserDecision, reason?: string): Promise<void> {
    const request = this.#state.permissionRequests.find((row) => row.requestId === requestId);
    if (!request || (request.status !== "pending" && request.status !== "error")) throw new Error("Permission request is no longer pending.");
    try {
      await workspaceClient.decidePermission(requestId, decision, reason);
      this.#set({
        permissionRequests: this.#state.permissionRequests.map((row) => row.requestId === requestId ? { ...row, status: decision === "approve" ? "approved" : "denied", error: undefined } : row),
        permissionError: null,
      });
    } catch (error) {
      const expired = error instanceof WorkspaceAPIError && error.status === 404;
      this.#set({
        permissionRequests: this.#state.permissionRequests.map((row) => row.requestId === requestId ? {
          ...row,
          status: expired ? "expired" : "error",
          error: expired ? "权限请求已过期。" : message(error),
        } : row),
        permissionError: expired ? null : message(error),
      });
      if (!expired) throw error;
    }
  }

  async startSpecialistFollowUp(
    sourceThreadId: string,
    messageText: string,
    refs: Omit<SpecialistFollowUpInput, "message"> = {},
  ): Promise<SpecialistFollowUpResult> {
    const { projectId, taskId } = this.#state;
    if (!projectId || !taskId) throw new Error("Select a Task before asking a specialist.");
    const message = messageText.trim();
    if (!message) throw new Error("Message is required.");
    return workspaceClient.startSpecialistFollowUp(projectId, taskId, sourceThreadId, { message, ...refs });
  }

  async commitDecisionInteraction(interactionId: string, input: DecisionInteractionInput): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!projectId || !taskId) throw new Error("Select a Task before answering a question.");
    const result = await workspaceClient.commitDecisionInteraction(projectId, taskId, interactionId, input);
    if (this.#state.projectId === projectId && this.#state.taskId === taskId) {
      this.#set({
        task: result.snapshot,
        tasks: upsertTask(this.#state.tasks, result.snapshot.task),
        activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, result.snapshot),
        taskState: "ready",
        error: null,
      });
      this.#connectTaskEvents({ kind: "project", projectId, taskId }, result.snapshot.eventCursor, this.#taskRequest);
    }
  }

  async commitTaskDecision(decisionId: string, input: TaskDecisionInput): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!projectId || !taskId) throw new Error("Select a Task before recording a decision.");
    const reason = input.reason.trim();
    if (!input.optionId.trim() || !reason) throw new Error("Decision option and reason are required.");
    const result = await workspaceClient.commitTaskDecision(projectId, taskId, decisionId, {
      optionId: input.optionId,
      reason,
    });
    if (this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
    this.#set({
      task: result.snapshot,
      tasks: upsertTask(this.#state.tasks, result.snapshot.task),
      activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, result.snapshot),
      taskState: "ready",
      error: null,
    });
    this.#connectTaskEvents({ kind: "project", projectId, taskId }, result.snapshot.eventCursor, this.#taskRequest);
    if (result.applyResult?.applied.length && this.#state.batchId) {
      const batchId = this.#state.batchId;
      const batch = await workspaceClient.openBatch(projectId, batchId);
      if (this.#state.projectId === projectId && this.#state.taskId === taskId && this.#state.batchId === batchId) {
        this.#set({ batch, batchState: "ready" });
      }
    }
  }

  async runTeamWorkflow(
    workflowId: string,
    action: TeamWorkflowAction,
    options: {
      forceAllRoles?: boolean;
      changeDecision?: { decisionId: string; optionId: string; reason: string };
    } = {},
  ): Promise<void> {
    const { projectId, taskId } = this.#state;
    if (!projectId || !taskId) throw new Error("Select a Task before running a Team workflow.");
    const forceAllRoles = options.forceAllRoles === true;
    const plan = await workspaceClient.preflightTeamWorkflow(projectId, workflowId, forceAllRoles);
    if (plan.readiness.status !== "ready") {
      throw new Error(`Team plan is blocked: ${plan.readiness.blockers.join("; ")}`);
    }
    if (options.changeDecision) {
      await this.commitTaskDecision(options.changeDecision.decisionId, {
        optionId: options.changeDecision.optionId,
        reason: options.changeDecision.reason,
      });
      if (this.#state.projectId !== projectId || this.#state.taskId !== taskId) return;
    }
    await workspaceClient.runTeamWorkflow(projectId, workflowId, action, plan.planHash, forceAllRoles);
    if (this.#state.projectId === projectId && this.#state.taskId === taskId) await this.openTask(projectId, taskId);
  }

  close(): void {
    this.#closed = true;
    ++this.#segmentEvidenceRequest;
    this.#disconnectTaskEvents();
    for (const key of this.#backgroundNotificationSubscriptions.keys()) this.#disconnectBackgroundNotification(key);
    this.#backgroundNotificationTargets.clear();
    this.#removeNotificationListener?.();
    this.#removeNotificationListener = null;
    this.#listeners.clear();
  }

  #connectTaskEvents(locator: TaskLocator, afterCursor: string, request: number): void {
    const key = locator.kind === "project" ? backgroundTaskKey(locator.projectId, locator.taskId) : null;
    if (key) {
      this.#backgroundNotificationTargets.delete(key);
      this.#disconnectBackgroundNotification(key);
    }
    this.#disconnectTaskEvents();
    const subscription = this.#taskEventSubscription;
    this.#unsubscribeTaskEvents = workspaceClient.subscribeTaskEvents(
      locator,
      afterCursor,
      (event) => {
        if (subscription !== this.#taskEventSubscription || request !== this.#taskRequest || !isSelectedLocator(this.#state, locator) || !this.#state.task) return;
        try {
          const previous = this.#state.task;
          const task = applyTaskEvent(previous, event);
          this.#set({
            task,
            ...(locator.kind === "project" ? {
              tasks: upsertTask(this.#state.tasks, task.task),
              activeRunsByTaskId: replaceActiveRunSummary(this.#state.activeRunsByTaskId, task),
            } : {
              chats: upsertTask(this.#state.chats, task.task),
              chatActiveRunsByTaskId: replaceActiveRunSummary(this.#state.chatActiveRunsByTaskId, task),
            }),
            taskState: "ready",
            error: null,
          });
          if (task !== previous && locator.kind === "project") this.#presentNotification(locator.projectId, event, task.task.id);
        } catch (error) {
          if (error instanceof TaskEventGapError) {
            if (locator.kind === "project") void this.openTask(locator.projectId, locator.taskId);
            else void this.openChat(locator.taskId);
          }
          else this.#set({ eventState: "error", error: message(error) });
        }
      },
      (state) => {
        if (subscription !== this.#taskEventSubscription || request !== this.#taskRequest || !isSelectedLocator(this.#state, locator)) return;
        if (state.status === "closed" && this.#state.eventState === "error") return;
        const recovered = state.status === "connected" && this.#state.eventState === "reconnecting";
        const eventMessage = state.status === "connected"
          ? null
          : state.message ?? (state.status === "closed" ? "Task 事件连接已关闭。" : null);
        this.#set({
          eventState: state.status,
          eventMessage,
          ...(state.status === "error" ? { error: eventMessage ?? "Task event stream failed." } : {}),
        });
        if (recovered) void this.refreshPermissionRequests();
      },
    );
  }

  #presentNotification(projectId: string, event: unknown, presentedTaskId: string): void {
    const preferences = this.#state.notificationPreferences;
    if (!preferences?.enabled) return;
    const candidate = notificationCandidateForTaskEvent(projectId, event);
    if (!candidate || !preferences.categories[candidate.category]) return;
    const focused = typeof document !== "undefined" && document.hasFocus();
    if (focused && this.#state.projectId === candidate.projectId && presentedTaskId === candidate.taskId) return;
    if (typeof window === "undefined" || !window.linguist?.system?.showNotification) return;
    if (this.#presentedNotificationIds.has(candidate.id)) return;
    this.#presentedNotificationIds.add(candidate.id);
    void window.linguist.system.showNotification(candidate)
      .then((shown) => {
        if (!shown) this.#presentedNotificationIds.delete(candidate.id);
        if (this.#presentedNotificationIds.size > 512) {
          const oldest = this.#presentedNotificationIds.values().next().value;
          if (typeof oldest === "string") this.#presentedNotificationIds.delete(oldest);
        }
      })
      .catch(() => this.#presentedNotificationIds.delete(candidate.id));
  }

  #disconnectTaskEvents(): void {
    this.#taskEventSubscription += 1;
    this.#unsubscribeTaskEvents?.();
    this.#unsubscribeTaskEvents = null;
  }

  #syncBackgroundNotificationTasks(
    projectId: string,
    tasks: readonly TaskRecord[],
    activeRuns: readonly TaskActiveRunSummary[] = [],
  ): void {
    if (this.#closed || typeof window === "undefined" || !window.linguist?.api) return;
    const activeRunByTaskId = indexActiveRuns(activeRuns);
    const selectedKey = this.#state.projectId === projectId && this.#state.taskId
      ? backgroundTaskKey(projectId, this.#state.taskId)
      : null;
    const desired = new Set(
      tasks
        .filter((task) => isNotificationTaskEligible(task, activeRunByTaskId[task.id]))
        .map((task) => backgroundTaskKey(projectId, task.id))
        .filter((key) => key !== selectedKey),
    );
    const projectPrefix = `${projectId}\u0000`;
    for (const key of this.#backgroundNotificationTargets) {
      if (key.startsWith(projectPrefix) && !desired.has(key)) this.#disconnectBackgroundNotification(key);
    }
    for (const key of desired) {
      this.#backgroundNotificationTargets.add(key);
      if (!this.#backgroundNotificationSubscriptions.has(key)) this.#startBackgroundNotificationSubscription(key);
    }
  }

  async #syncAllBackgroundNotificationTasks(): Promise<void> {
    if (this.#closed || typeof window === "undefined" || !window.linguist?.api) return;
    const projects = this.#state.projects.slice();
    await Promise.all(projects.map(async (project) => {
      try {
        const result = await workspaceClient.listTasks(project.projectId);
        if (this.#closed) return;
        this.#syncBackgroundNotificationTasks(project.projectId, result.tasks, result.activeRuns);
      } catch {
        // A project that cannot be listed must not block the rest of the shell or
        // create a speculative notification state. The selected Task stream owns
        // recovery and will surface its own error.
      }
    }));
  }

  #startBackgroundNotificationSubscription(key: string): void {
    if (this.#closed) return;
    const separator = key.indexOf("\u0000");
    if (separator < 1) return;
    const projectId = key.slice(0, separator);
    const taskId = key.slice(separator + 1);
    // null marks an in-flight openTask so repeated syncs cannot create duplicate
    // subscriptions before the canonical snapshot returns its cursor.
    this.#backgroundNotificationSubscriptions.set(key, null);
    void workspaceClient.openTask(projectId, taskId).then((snapshot) => {
      if (!this.#backgroundNotificationTargets.has(key) || this.#state.projectId === projectId && this.#state.taskId === taskId) {
        this.#backgroundNotificationSubscriptions.delete(key);
        return;
      }
      const unsubscribe = workspaceClient.subscribeTaskEvents(
        { kind: "project", projectId, taskId },
        snapshot.eventCursor,
        (event) => {
          if (!this.#backgroundNotificationTargets.has(key)) return;
          this.#presentNotification(projectId, event, taskId);
          if (event && typeof event === "object" && !Array.isArray(event) && (event as { type?: unknown }).type === "run_upsert") {
            const status = (event as { run?: { status?: unknown }}).run?.status;
            if (status === "stopped" || status === "failed" || status === "stale" || status === "complete") {
              void this.#reconcileBackgroundNotificationSubscription(key, projectId, taskId);
            }
          }
        },
      );
      if (!this.#backgroundNotificationTargets.has(key)) {
        unsubscribe();
        this.#backgroundNotificationSubscriptions.delete(key);
        return;
      }
      this.#backgroundNotificationSubscriptions.set(key, unsubscribe);
    }).catch(() => {
      if (this.#backgroundNotificationTargets.has(key)) {
        this.#backgroundNotificationSubscriptions.delete(key);
        this.#backgroundNotificationTargets.delete(key);
      }
    });
  }

  #disconnectBackgroundNotification(key: string): void {
    this.#backgroundNotificationSubscriptions.get(key)?.();
    this.#backgroundNotificationSubscriptions.delete(key);
    this.#backgroundNotificationTargets.delete(key);
  }

  async #reconcileBackgroundNotificationSubscription(key: string, projectId: string, taskId: string): Promise<void> {
    try {
      const snapshot = await workspaceClient.openTask(projectId, taskId);
      const activeRun = taskActiveRunSummary(snapshot) ?? undefined;
      if (this.#backgroundNotificationTargets.has(key) && !isNotificationTaskEligible(snapshot.task, activeRun)) {
        this.#disconnectBackgroundNotification(key);
      }
    } catch {
      // Keep the stream alive; the canonical stream's own reconnect path remains
      // the source of truth when a terminal snapshot cannot be read immediately.
    }
  }
}

export const workspaceStore = new WorkspaceStore();
