import { join } from "node:path";
import { readJsonFile, resolveStructuredStorageBackend, writeJsonFile } from "@linguist-agent/cat-data";

export const NOTIFICATION_CATEGORIES = ["waiting", "failed", "completed", "permission"] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

export interface NotificationPreferences {
  schemaVersion: 1;
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  updatedAt: string | null;
}

export interface WriteNotificationPreferencesInput {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  expectedUpdatedAt: string | null;
}

export interface NotificationCandidate {
  id: string;
  category: NotificationCategory;
  projectId: string;
  taskId: string;
  runId: string;
  occurredAt: string;
}

const DEFAULT_CATEGORIES: Record<NotificationCategory, boolean> = {
  waiting: true,
  failed: true,
  completed: true,
  permission: true,
};

export class NotificationPreferencesConflictError extends Error {
  readonly status = 409;
  readonly code = "notification_preferences_conflict";

  constructor() {
    super("Notification preferences changed elsewhere. Reload before saving again.");
    this.name = "NotificationPreferencesConflictError";
  }
}

function defaults(): NotificationPreferences {
  return {
    schemaVersion: 1,
    enabled: true,
    categories: { ...DEFAULT_CATEGORIES },
    updatedAt: null,
  };
}

function preferencesPath(repoRoot: string): string {
  return join(repoRoot, "data", "settings", "notifications.json");
}

const STORAGE_ADDRESS = { domain: "settings" as const, key: "notifications", scope: "global" };

function categoryRecord(value: unknown): Record<NotificationCategory, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("categories must be an object");
  }
  const result = {} as Record<NotificationCategory, boolean>;
  for (const category of NOTIFICATION_CATEGORIES) {
    const candidate = (value as Record<string, unknown>)[category];
    if (typeof candidate !== "boolean") throw new Error(`${category} must be a boolean`);
    result[category] = candidate;
  }
  return result;
}

function normalizeStored(value: unknown): NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults();
  const row = value as Record<string, unknown>;
  return {
    schemaVersion: 1,
    enabled: typeof row.enabled === "boolean" ? row.enabled : true,
    categories: row.categories === undefined ? { ...DEFAULT_CATEGORIES } : categoryRecord(row.categories),
    updatedAt: row.updatedAt === null || typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

export async function readNotificationPreferences(repoRoot: string): Promise<NotificationPreferences> {
  const backend = resolveStructuredStorageBackend(repoRoot);
  const stored = backend?.read(STORAGE_ADDRESS);
  if (backend) return normalizeStored(stored?.payload ?? null);
  return normalizeStored(await readJsonFile<unknown>(preferencesPath(repoRoot), null));
}

export async function writeNotificationPreferences(
  repoRoot: string,
  input: WriteNotificationPreferencesInput,
  now: () => string = () => new Date().toISOString(),
): Promise<NotificationPreferences> {
  const current = await readNotificationPreferences(repoRoot);
  if (input.expectedUpdatedAt !== current.updatedAt) throw new NotificationPreferencesConflictError();
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be a boolean");
  const next: NotificationPreferences = {
    schemaVersion: 1,
    enabled: input.enabled,
    categories: categoryRecord(input.categories),
    updatedAt: now(),
  };
  const backend = resolveStructuredStorageBackend(repoRoot);
  const stored = backend?.read(STORAGE_ADDRESS);
  if (backend) {
    await backend.write({
      address: STORAGE_ADDRESS,
      expectedRevision: stored?.revision ?? 0,
      expectedValue: stored?.payload ?? {},
      value: next as unknown as Record<string, unknown>,
    });
    return next;
  }
  await writeJsonFile(preferencesPath(repoRoot), next, { durability: "critical" });
  return next;
}

export function notificationCandidateForTaskEvent(projectId: string, value: unknown): NotificationCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const id = typeof event.id === "string" ? event.id : null;
  const taskId = typeof event.taskId === "string" ? event.taskId : null;
  const runId = typeof event.runId === "string" ? event.runId : null;
  const occurredAt = typeof event.occurredAt === "string" ? event.occurredAt : null;
  if (!id || !taskId || !runId || !occurredAt) return null;

  let category: NotificationCategory | null = null;
  if (event.type === "run_upsert") {
    const status = (event.run as Record<string, unknown> | undefined)?.status;
    if (status === "awaiting_input" || status === "waiting") category = "waiting";
    else if (status === "failed") category = "failed";
    else if (status === "complete") category = "completed";
  } else if (event.type === "activity_append") {
    const activity = event.activity as Record<string, unknown> | undefined;
    if (activity?.type === "elicitation" && activity.status === "blocked") category = "permission";
  }
  return category ? { id: `${projectId}:${id}`, category, projectId, taskId, runId, occurredAt } : null;
}
