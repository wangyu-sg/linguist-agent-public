import { createHash, randomUUID } from "node:crypto";
import {
  createTaskWorkspaceFromPersistence,
  parseTaskRunEvent,
  parseTaskWorkspaceSnapshot,
  TaskWorkspaceConflictError,
  type TaskLocator,
  type TaskOwner,
  type TaskRunEvent,
  type TaskWorkspace,
  type TaskWorkspaceOptions,
  type TaskWorkspacePersistence,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import {
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";
import { legacyTaskStreamId } from "./legacy_task_importer.js";

export interface SqliteTaskWorkspaceRepositoryInput {
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
  options?: TaskWorkspaceOptions;
}

export const SQLITE_TASK_WORKSPACE_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "unconnected",
  productionCutoverOwner: "LA-089",
} as const);

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function locatorForSnapshot(snapshot: TaskWorkspaceSnapshot): TaskLocator {
  return snapshot.task.owner.kind === "standalone"
    ? { kind: "standalone", taskId: snapshot.task.id }
    : { kind: "project", projectId: snapshot.task.owner.projectId, taskId: snapshot.task.id };
}

function sameOwner(owner: TaskOwner, snapshot: TaskWorkspaceSnapshot): boolean {
  return owner.kind === "standalone"
    ? snapshot.task.owner.kind === "standalone"
    : snapshot.task.owner.kind === "project" && snapshot.task.owner.projectId === owner.projectId;
}

function taskEventFromPayload(payload: SqliteJsonObject, label: string): TaskRunEvent {
  const value = payload.taskEvent ?? payload.legacyEvent;
  if (value === undefined) throw new Error(`${label} has no canonical Task event payload.`);
  return parseTaskRunEvent(value, label);
}

function translateConflict(error: unknown): never {
  if (error instanceof SqliteRevisionConflictError) {
    throw new TaskWorkspaceConflictError(error.message);
  }
  throw error;
}

export function createSqliteTaskWorkspacePersistence(
  store: SqliteEventProjectionStore,
  authority: SqliteStorageAuthority,
): TaskWorkspacePersistence {
  return {
    key(locator) {
      return `sqlite:${store.storageId}:${legacyTaskStreamId(locator)}`;
    },
    async readSnapshot(locator) {
      const stored = store.readProjection(legacyTaskStreamId(locator));
      return stored ? parseTaskWorkspaceSnapshot(stored.value) : null;
    },
    async readEvents(locator) {
      return store.readEvents(legacyTaskStreamId(locator)).map((event, index) =>
        taskEventFromPayload(event.payload, `SQLite Task event[${index}]`));
    },
    async readLastEventCursor(locator) {
      const events = store.readEvents(legacyTaskStreamId(locator));
      return events.length ? taskEventFromPayload(events.at(-1)!.payload, "SQLite Task event tail").cursor : null;
    },
    async listLocators(owner) {
      const locators: TaskLocator[] = [];
      for (const stored of store.listProjections()) {
        if (!stored.streamId.startsWith("legacy-task-")) continue;
        const snapshot = parseTaskWorkspaceSnapshot(stored.value);
        if (sameOwner(owner, snapshot)) locators.push(locatorForSnapshot(snapshot));
      }
      return locators;
    },
    async create(locator, snapshot, page) {
      await authority.assertOwned();
      const streamId = legacyTaskStreamId(locator);
      try {
        if (page?.events.length) {
          store.append({
            commandId: `task-create-${digest(page).slice(0, 48)}`,
            streamId,
            expectedRevision: 0,
            events: page.events.map((event) => ({
              id: event.id,
              type: event.type,
              occurredAt: event.occurredAt,
              payload: { taskEvent: jsonObject(event) },
            })),
            projection: jsonObject(snapshot),
          });
        } else {
          store.initializeProjection({
            commandId: `task-create-${digest(snapshot).slice(0, 48)}`,
            streamId,
            projection: jsonObject(snapshot),
          });
        }
      } catch (error) {
        translateConflict(error);
      }
    },
    async replaceProjection(locator, expected, next) {
      await authority.assertOwned();
      const streamId = legacyTaskStreamId(locator);
      try {
        store.replaceProjection({
          commandId: `task-projection-${randomUUID()}`,
          streamId,
          expectedRevision: store.currentRevision(streamId),
          expectedProjection: jsonObject(expected),
          projection: jsonObject(next),
        });
      } catch (error) {
        translateConflict(error);
      }
    },
    async commitPage(locator, expected, page, next) {
      await authority.assertOwned();
      const streamId = legacyTaskStreamId(locator);
      const expectedRevision = page.events.at(0)?.seq ? page.events[0]!.seq - 1 : store.currentRevision(streamId);
      if (expected.eventCursor !== page.afterCursor) {
        throw new TaskWorkspaceConflictError("SQLite Task projection cursor changed before commit.");
      }
      try {
        store.append({
          commandId: `task-page-${digest(page).slice(0, 48)}`,
          streamId,
          expectedRevision,
          events: page.events.map((event) => ({
            id: event.id,
            type: event.type,
            occurredAt: event.occurredAt,
            payload: { taskEvent: jsonObject(event) },
          })),
          projection: jsonObject(next),
        });
      } catch (error) {
        translateConflict(error);
      }
    },
  };
}

export function createSqliteTaskWorkspaceRepository(
  input: SqliteTaskWorkspaceRepositoryInput,
): TaskWorkspace {
  return createTaskWorkspaceFromPersistence(
    createSqliteTaskWorkspacePersistence(input.store, input.authority),
    input.options,
  );
}
