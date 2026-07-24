import { createHash } from "node:crypto";
import type { WorkflowEvalPersistence } from "@linguist-agent/cat-data";
import { SqliteEventProjectionStore, type SqliteJsonObject, type SqliteStorageAuthority } from "./index.js";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function streamId(key: string): string {
  return `workflow-eval-${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

function object(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

type Projection = { kind: "workflow-eval"; key: string; value: unknown };

export const SQLITE_WORKFLOW_EVAL_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "sqlite",
  domains: ["workflow", "workflow-artifacts", "private-eval-metadata"],
  excludes: ["eval-corpus-bytes", "eval-reports"],
} as const);

export class SqliteWorkflowEvalRepository implements WorkflowEvalPersistence {
  readonly root: string;
  readonly #store: SqliteEventProjectionStore;
  readonly #authority: SqliteStorageAuthority;

  constructor(input: { root: string; store: SqliteEventProjectionStore; authority: SqliteStorageAuthority }) {
    this.root = input.root;
    this.#store = input.store;
    this.#authority = input.authority;
  }

  async read(key: string): Promise<unknown | null> {
    const current = this.#store.readProjection(streamId(key));
    if (!current) return null;
    const projection = current.value as unknown as Projection;
    if (projection.kind !== "workflow-eval" || projection.key !== key) throw new Error(`SQLite Workflow/Eval projection mismatch for ${key}.`);
    return projection.value;
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.#authority.assertOwned();
    const stream = streamId(key);
    const projection: Projection = { kind: "workflow-eval", key, value };
    const current = this.#store.readProjection(stream);
    const digest = createHash("sha256").update(stableJson(projection)).digest("hex").slice(0, 48);
    if (!current) {
      this.#store.initializeProjection({ commandId: `workflow-eval-init-${digest}`, streamId: stream, projection: object(projection) });
      return;
    }
    const currentProjection = current.value as unknown as Projection;
    if (currentProjection.kind !== "workflow-eval" || currentProjection.key !== key) throw new Error(`SQLite Workflow/Eval stream collision for ${key}.`);
    this.#store.append({
      commandId: `workflow-eval-write-${current.revision}-${digest}`,
      streamId: stream,
      expectedRevision: current.revision,
      events: [{ id: `workflow-eval-event-${current.revision + 1}-${digest}`, type: "workflow_eval.updated", occurredAt: new Date().toISOString(), payload: object({ key }) }],
      projection: object(projection),
    });
  }

  async list(prefix: string): Promise<string[]> {
    return this.#store.listProjections()
      .map((row) => row.value as unknown as Projection)
      .filter((row) => row.kind === "workflow-eval" && row.key.startsWith(prefix))
      .map((row) => row.key)
      .sort();
  }

  close(): void { this.#store.close(); }
}
