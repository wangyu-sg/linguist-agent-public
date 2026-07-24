import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface WorkflowEvalPersistence {
  readonly root: string;
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

const persistenceByRoot = new Map<string, WorkflowEvalPersistence>();

export function workflowEvalAuthorityMarkerPath(root: string): string {
  return join(resolve(root), "data", "runtime", "workflow-eval-sqlite-v1", "authority-v1.json");
}

export function installWorkflowEvalPersistence(root: string, persistence: WorkflowEvalPersistence): void {
  const key = resolve(root);
  if (resolve(persistence.root) !== key) throw new Error("Workflow/Eval persistence root does not match installation root.");
  const current = persistenceByRoot.get(key);
  if (current && current !== persistence) throw new Error(`Workflow/Eval persistence is already installed for ${key}.`);
  persistenceByRoot.set(key, persistence);
}

export function workflowEvalPersistenceFor(root: string): WorkflowEvalPersistence | undefined {
  return persistenceByRoot.get(resolve(root));
}

export async function assertWorkflowEvalLegacyAllowed(root: string): Promise<void> {
  if (workflowEvalPersistenceFor(root)) return;
  try {
    await readFile(workflowEvalAuthorityMarkerPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("SQLite Workflow/Team/Private Eval storage is authoritative; legacy structured writers are disabled.");
}

export function resetWorkflowEvalPersistenceForTests(root: string): void {
  persistenceByRoot.delete(resolve(root));
}
