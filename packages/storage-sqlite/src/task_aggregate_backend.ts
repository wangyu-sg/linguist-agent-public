import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  emptyTaskMessageQueue,
  parseTaskMessageQueue,
  type TaskAggregateStorageBackend,
  type TaskLocator,
  type TaskMessageQueuePersistence,
} from "@linguist-agent/cat-data";
import {
  SqliteEventProjectionStore,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";
import { legacyTaskSideStreamIds } from "./legacy_task_side_importer.js";
import { createSqliteTaskWorkspacePersistence } from "./task_workspace_repository.js";

export interface SqliteTaskPackageProfileStoreInput {
  repoRoot: string;
  projectId: string;
  taskId: string;
}

export interface SqliteTaskPackageProfilePersistence {
  key(input: SqliteTaskPackageProfileStoreInput): string;
  read(input: SqliteTaskPackageProfileStoreInput): Promise<unknown | null>;
  write(
    input: SqliteTaskPackageProfileStoreInput,
    expected: unknown,
    next: unknown,
  ): Promise<void>;
}

export interface SqliteTaskAggregateBackend extends TaskAggregateStorageBackend {
  taskPackageProfile: SqliteTaskPackageProfilePersistence;
}

export interface CreateSqliteTaskAggregateBackendInput {
  root: string;
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
}

export const SQLITE_TASK_AGGREGATE_BACKEND_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "unconnected",
  productionCutoverOwner: "LA-089",
  excludes: ["project-quality-ledger"],
} as const);

function jsonObject(value: unknown, label: string): SqliteJsonObject {
  const encoded = JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === undefined || typeof candidate === "function"
      || typeof candidate === "symbol" || typeof candidate === "bigint") {
      throw new Error(`${label} contains a non-JSON value.`);
    }
    if (typeof candidate === "number" && !Number.isFinite(candidate)) {
      throw new Error(`${label} contains a non-finite number.`);
    }
    return candidate;
  });
  if (encoded === undefined) throw new Error(`${label} is not JSON serializable.`);
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as SqliteJsonObject;
}

function isAbsentProjection(value: SqliteJsonObject): boolean {
  return Object.keys(value).length === 1 && value.present === false;
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const keys = Object.keys(value).sort();
  const allowed = new Set([...expected, ...optional]);
  const missing = expected.filter((key) => !(key in value));
  const unknown = keys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    throw new Error(
      `${label} fields are invalid`
      + `${missing.length ? `; missing ${missing.join(", ")}` : ""}`
      + `${unknown.length ? `; unknown ${unknown.join(", ")}` : ""}.`,
    );
  }
}

function parseStrictQueue(value: SqliteJsonObject, taskId: string) {
  exactKeys(
    value,
    ["schemaVersion", "taskId", "paused", "pausedReason", "messages", "updatedAt"],
    "Task message queue",
  );
  if (!Array.isArray(value.messages)) throw new Error("Task message queue messages must be an array.");
  value.messages.forEach((message, index) => {
    exactKeys(
      message,
      ["id", "taskId", "runId", "text", "delivery", "status", "createdAt", "updatedAt"],
      `Task queued message ${index}`,
      ["error"],
    );
  });
  return parseTaskMessageQueue(value, taskId);
}

function assertStrictProfile(value: unknown, label: string): void {
  exactKeys(
    value,
    ["schemaVersion", "taskId", "revision", "selections", "executableApprovals", "updatedAt"],
    label,
  );
  if (!Array.isArray(value.selections) || !Array.isArray(value.executableApprovals)) {
    throw new Error(`${label} selections and executableApprovals must be arrays.`);
  }
  value.selections.forEach((selection, index) => {
    exactKeys(
      selection,
      ["packageSource", "resourceType", "resourceId", "enabled"],
      `${label} selection ${index}`,
    );
  });
  value.executableApprovals.forEach((approval, index) => {
    exactKeys(
      approval,
      ["packageSource", "version", "integrity", "approvedAt"],
      `${label} executable approval ${index}`,
    );
  });
}

function projectLocator(input: SqliteTaskPackageProfileStoreInput): TaskLocator {
  return {
    kind: "project",
    projectId: input.projectId,
    taskId: input.taskId,
  };
}

function replaceOrInitialize(input: {
  store: SqliteEventProjectionStore;
  streamId: string;
  stored: ReturnType<SqliteEventProjectionStore["readProjection"]>;
  projection: SqliteJsonObject;
  commandPrefix: string;
}): void {
  const commandId = `${input.commandPrefix}-${randomUUID()}`;
  if (!input.stored) {
    input.store.initializeProjection({
      commandId,
      streamId: input.streamId,
      projection: input.projection,
    });
    return;
  }
  input.store.replaceProjection({
    commandId,
    streamId: input.streamId,
    expectedRevision: input.stored.revision,
    expectedProjection: input.stored.value,
    projection: input.projection,
  });
}

export function createSqliteTaskMessageQueuePersistence(
  store: SqliteEventProjectionStore,
  authority: SqliteStorageAuthority,
): TaskMessageQueuePersistence {
  return {
    key(locator) {
      return `sqlite:${store.storageId}:${legacyTaskSideStreamIds(locator).messageQueue}`;
    },
    async read(locator) {
      const stored = store.readProjection(legacyTaskSideStreamIds(locator).messageQueue);
      return !stored || isAbsentProjection(stored.value)
        ? emptyTaskMessageQueue(locator.taskId)
        : parseStrictQueue(stored.value, locator.taskId);
    },
    async update(locator, mutate) {
      await authority.assertOwned();
      const streamId = legacyTaskSideStreamIds(locator).messageQueue;
      const stored = store.readProjection(streamId);
      const current = !stored || isAbsentProjection(stored.value)
        ? emptyTaskMessageQueue(locator.taskId)
        : parseStrictQueue(stored.value, locator.taskId);
      const next = parseTaskMessageQueue(await mutate(current), locator.taskId);
      await authority.assertOwned();
      replaceOrInitialize({
        store,
        streamId,
        stored,
        projection: jsonObject(next, "Task message queue"),
        commandPrefix: "task-queue",
      });
      return next;
    },
  };
}

export function createSqliteTaskPackageProfilePersistence(
  store: SqliteEventProjectionStore,
  authority: SqliteStorageAuthority,
): SqliteTaskPackageProfilePersistence {
  return {
    key(input) {
      return `sqlite:${store.storageId}:${legacyTaskSideStreamIds(projectLocator(input)).resourceProfile}`;
    },
    async read(input) {
      const stored = store.readProjection(legacyTaskSideStreamIds(projectLocator(input)).resourceProfile);
      if (!stored || isAbsentProjection(stored.value)) return null;
      assertStrictProfile(stored.value, "Task Package profile");
      return stored.value;
    },
    async write(input, expected, next) {
      await authority.assertOwned();
      const streamId = legacyTaskSideStreamIds(projectLocator(input)).resourceProfile;
      const stored = store.readProjection(streamId);
      const current = !stored || isAbsentProjection(stored.value) ? null : stored.value;
      const expectedProfile = jsonObject(expected, "expected Task Package profile");
      assertStrictProfile(expectedProfile, "expected Task Package profile");
      const nextProfile = jsonObject(next, "Task Package profile");
      assertStrictProfile(nextProfile, "Task Package profile");
      if (current !== null && JSON.stringify(current) !== JSON.stringify(expectedProfile)) {
        throw new Error("Task Package profile changed before the SQLite write.");
      }
      await authority.assertOwned();
      replaceOrInitialize({
        store,
        streamId,
        stored,
        projection: nextProfile,
        commandPrefix: "task-profile",
      });
    },
  };
}

export function createSqliteTaskAggregateBackend(
  input: CreateSqliteTaskAggregateBackendInput,
): SqliteTaskAggregateBackend {
  return {
    root: resolve(input.root),
    workspace: createSqliteTaskWorkspacePersistence(input.store, input.authority),
    messageQueue: createSqliteTaskMessageQueuePersistence(input.store, input.authority),
    taskPackageProfile: createSqliteTaskPackageProfilePersistence(input.store, input.authority),
  };
}
