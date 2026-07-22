import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createWorkspace,
  createTaskWorkspace,
  type TaskRecord,
  type TaskTitleGeneration,
} from "@linguist-agent/cat-data";
import { catAgentSessionDir } from "@linguist-agent/cat-runtime";
import type { GeneratedAgentTitle } from "./session_titles.js";

export interface TaskAutoTitleModel {
  provider?: string;
  modelId?: string;
}

export interface TaskAutoTitleLocator {
  projectId: string;
  taskId: string;
}

export interface TaskAutoTitleCoordinator {
  schedule(input: TaskAutoTitleLocator): Promise<void>;
  recover(): Promise<{ failed: number; scheduled: number }>;
  waitForIdle(): Promise<void>;
}

export async function syncExistingPiSessionTitle(input: {
  repoRoot: string;
  projectId: string;
  sessionId: string;
  title: string;
  liveManager?: Pick<SessionManager, "appendSessionInfo" | "getSessionName">;
}): Promise<void> {
  if (input.liveManager) {
    if (input.liveManager.getSessionName() !== input.title) input.liveManager.appendSessionInfo(input.title);
    return;
  }
  const workspace = createWorkspace(input.repoRoot, input.projectId);
  const sessionDir = catAgentSessionDir(workspace);
  const existing = (await SessionManager.list(workspace.root, sessionDir)).find((session) => session.id === input.sessionId);
  if (!existing) return;
  const manager = SessionManager.open(existing.path, sessionDir, workspace.root);
  if (manager.getSessionName() !== input.title) manager.appendSessionInfo(input.title);
}

export function createTaskAutoTitleCoordinator(input: {
  repoRoot: string;
  resolveModel: (projectId: string) => Promise<TaskAutoTitleModel>;
  generateTitle: (input: TaskAutoTitleLocator & TaskAutoTitleModel & { userMessage: string }) => Promise<GeneratedAgentTitle | undefined>;
  syncSessionTitle: (input: TaskAutoTitleLocator & { title: string }) => Promise<void>;
  now?: () => string;
  createAttemptId?: () => string;
}): TaskAutoTitleCoordinator {
  const now = input.now ?? (() => new Date().toISOString());
  const createAttemptId = input.createAttemptId ?? (() => `title_${randomUUID()}`);
  const jobs = new Map<string, Promise<void>>();
  const key = (locator: TaskAutoTitleLocator): string => `${locator.projectId}\0${locator.taskId}`;

  const fail = async (
    locator: TaskAutoTitleLocator,
    generation: TaskTitleGeneration,
    error: string,
  ): Promise<TaskRecord | undefined> => {
    const snapshot = await createTaskWorkspace(input.repoRoot).updateTitleGeneration({
      ...locator,
      expectedStatus: "pending",
      expectedAttemptId: generation.attemptId ?? null,
      generation: {
        ...generation,
        status: "failed",
        completedAt: now(),
        error: error.slice(0, 500),
      },
    });
    return snapshot?.task;
  };

  const run = async (locator: TaskAutoTitleLocator): Promise<void> => {
    const workspace = createTaskWorkspace(input.repoRoot);
    const current = await workspace.open(locator);
    const pending = current.task.titleGeneration;
    if (pending?.status !== "pending" || pending.attemptId) return;

    let model: TaskAutoTitleModel;
    try {
      model = await input.resolveModel(locator.projectId);
    } catch (error) {
      await fail(locator, pending, error instanceof Error ? error.message : String(error));
      return;
    }
    const attemptId = createAttemptId();
    const claimed = await workspace.updateTitleGeneration({
      ...locator,
      expectedStatus: "pending",
      expectedAttemptId: null,
      generation: {
        ...pending,
        attemptId,
        startedAt: now(),
        provider: model.provider ?? null,
        modelId: model.modelId ?? null,
      },
    });
    const generation = claimed?.task.titleGeneration;
    if (!generation || generation.status !== "pending" || generation.attemptId !== attemptId) return;

    let generated: GeneratedAgentTitle | undefined;
    try {
      generated = await input.generateTitle({ ...locator, ...model, userMessage: claimed.task.intent });
    } catch (error) {
      await fail(locator, generation, error instanceof Error ? error.message : String(error));
      return;
    }
    if (!generated) {
      await fail(locator, generation, "Title model or authentication is unavailable.");
      return;
    }

    const completed = await workspace.updateTitleGeneration({
      ...locator,
      expectedStatus: "pending",
      expectedAttemptId: attemptId,
      title: generated.title,
      generation: {
        ...generation,
        status: "generated",
        completedAt: now(),
        usage: generated.usage,
        error: null,
      },
    });
    if (completed) await input.syncSessionTitle({ ...locator, title: completed.task.title });
  };

  const schedule = (locator: TaskAutoTitleLocator): Promise<void> => {
    const jobKey = key(locator);
    const active = jobs.get(jobKey);
    if (active) return active;
    const job = run(locator).finally(() => {
      if (jobs.get(jobKey) === job) jobs.delete(jobKey);
    });
    jobs.set(jobKey, job);
    return job;
  };

  return {
    schedule,
    async recover() {
      let failed = 0;
      let scheduled = 0;
      let projects;
      try {
        projects = await readdir(join(input.repoRoot, "data", "projects"), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { failed, scheduled };
        throw error;
      }
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const projectId = project.name;
        for (const task of await createTaskWorkspace(input.repoRoot).list({ projectId })) {
          const generation = task.titleGeneration;
          if (generation?.status !== "pending") continue;
          if (!generation.attemptId) {
            scheduled += 1;
            void schedule({ projectId, taskId: task.id }).catch(() => undefined);
            continue;
          }
          const recovered = await fail(
            { projectId, taskId: task.id },
            generation,
            "The runtime restarted during title generation; the request was not repeated.",
          );
          if (recovered) {
            failed += 1;
            await input.syncSessionTitle({ projectId, taskId: task.id, title: recovered.title }).catch(() => undefined);
          }
        }
      }
      return { failed, scheduled };
    },
    async waitForIdle() {
      while (jobs.size) await Promise.all([...jobs.values()]);
    },
  };
}
