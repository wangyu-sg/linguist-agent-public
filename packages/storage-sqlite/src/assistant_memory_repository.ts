import { createHash } from "node:crypto";
import {
  parseAssistantMemoryFile,
  type AssistantMemoryFileV1,
  type AssistantMemoryPersistence,
  type AssistantMemoryScope,
} from "@linguist-agent/cat-data";
import {
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";

export const SQLITE_ASSISTANT_MEMORY_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "sqlite",
  streamPrefix: "assistant-memory-",
  semanticIndex: "non-canonical",
  evidencePolicy: "recall-only-not-citable",
} as const);

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

function streamId(scope: AssistantMemoryScope): string {
  const digest = createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 48);
  return `assistant-memory-${digest}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function storedFile(value: SqliteJsonObject): AssistantMemoryFileV1 {
  return parseAssistantMemoryFile(value, "SQLite Assistant Memory projection");
}

/** SQLite-backed canonical memory projection with event history and CAS writes. */
export function createSqliteAssistantMemoryPersistence(input: {
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
}): AssistantMemoryPersistence {
  return {
    async read(scope) {
      const projection = input.store.readProjection(streamId(scope));
      return projection ? storedFile(projection.value) : null;
    },
    async write(scope, file, expected) {
      await input.authority.assertOwned();
      const id = streamId(scope);
      const current = input.store.readProjection(id);
      const projection = jsonObject(file);
      if (!current) {
        if (expected !== null) throw new SqliteRevisionConflictError(id, 0, 0);
        input.store.initializeProjection({
          commandId: `assistant-memory-init-${createHash("sha256").update(JSON.stringify(projection)).digest("hex").slice(0, 40)}`,
          streamId: id,
          projection,
        });
        return;
      }
      if (!expected || !sameJson(current.value, expected)) {
        throw new SqliteRevisionConflictError(id, expected ? current.revision : 0, current.revision);
      }
      input.store.append({
        commandId: `assistant-memory-write-${createHash("sha256").update(JSON.stringify({ id, revision: current.revision, projection })).digest("hex").slice(0, 40)}`,
        streamId: id,
        expectedRevision: current.revision,
        events: [{
          id: createHash("sha256").update(JSON.stringify({ id, revision: current.revision + 1, projection })).digest("hex").slice(0, 48),
          type: "assistant_memory.snapshot.updated",
          occurredAt: file.updatedAt,
          payload: {
            scope: jsonObject(scope),
            statusCounts: jsonObject({
              proposed: file.entries.filter((entry) => entry.status === "proposed").length,
              active: file.entries.filter((entry) => entry.status === "active").length,
              superseded: file.entries.filter((entry) => entry.status === "superseded").length,
              revoked: file.entries.filter((entry) => entry.status === "revoked").length,
            }),
          },
        }],
        projection,
      });
    },
  };
}

export function assistantMemoryStreamId(scope: AssistantMemoryScope): string {
  return streamId(scope);
}
