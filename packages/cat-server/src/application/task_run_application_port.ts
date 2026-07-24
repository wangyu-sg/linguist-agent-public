import { TaskWorkspaceConflictError } from "@linguist-agent/cat-data";

const TASK_COMPOSER_CAPABILITY_IDS = new Set(["research"] as const);

export type TaskComposerCapabilityId = "research";

export interface TaskRunApplicationPort {
  resolveComposerCapabilityIds(value: unknown): TaskComposerCapabilityId[];
}

/** The route may accept a DTO array, but only this port owns its runtime capability allowlist. */
export const taskRunApplicationPort: TaskRunApplicationPort = {
  resolveComposerCapabilityIds(value: unknown): TaskComposerCapabilityId[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      throw new TaskWorkspaceConflictError("capabilityIds must be an array of native capability ids.");
    }
    const ids = [...new Set(value)] as TaskComposerCapabilityId[];
    const unsupported = ids.filter((id) => !TASK_COMPOSER_CAPABILITY_IDS.has(id));
    if (unsupported.length) throw new TaskWorkspaceConflictError(`Native capability is not ready for Task Composer activation: ${unsupported.join(", ")}.`);
    return ids;
  },
};
