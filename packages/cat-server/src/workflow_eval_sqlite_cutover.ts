import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { installWorkflowEvalPersistence, workflowEvalAuthorityMarkerPath } from "@linguist-agent/cat-data";
import { SqliteEventProjectionStore, SqliteWorkflowEvalRepository, type SqliteStorageAuthority } from "@linguist-agent/storage-sqlite";

export interface WorkflowEvalSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  records: number;
  excludes: ["eval-corpus-bytes", "eval-reports"];
}

export interface PreparedWorkflowEvalSqliteCutover {
  status: "cutover" | "already-sqlite";
  root: string;
  marker: WorkflowEvalSqliteAuthorityMarkerV1;
  markerPath: string;
  repository: SqliteWorkflowEvalRepository;
  close(): void;
}

function databasePath(root: string): string { return join(root, "data", "runtime", "workflow-eval-sqlite-v1", "workflow-eval.sqlite"); }
function backupRoot(root: string): string { return join(root, "data", "backups", "workflow-eval-cutover-v1", `attempt-${Date.now()}-${process.pid}`); }
function optionalFile(path: string): Promise<Buffer | null> { return readFile(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)); }

async function sync(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await sync(temporary); await rename(temporary, path); await sync(dirname(path)); }
  finally { await rm(temporary, { force: true }); }
}

async function copyExact(root: string, source: string, backup: string): Promise<void> {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Workflow/Eval source must be a regular file: ${source}`);
  const rel = relative(root, source);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Workflow/Eval backup path escapes root.");
  const target = join(backup, rel);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await sync(target);
}

async function json(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  try { return JSON.parse(raw); } catch (error) { throw new Error(`Invalid Workflow/Eval JSON ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function jsonl(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error));
  return raw.split(/\r?\n/u).filter(Boolean).map((line, index) => { try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid Workflow/Eval JSONL ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`); } });
}
async function directories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error)))
    .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)).map((entry) => entry.name).sort();
}

interface RecordSource { key: string; path: string; value: unknown; }
async function sources(root: string): Promise<RecordSource[]> {
  const out: RecordSource[] = [];
  for (const projectId of await directories(join(root, "data", "projects"))) {
    const projectRoot = join(root, "data", "projects", projectId);
    const artifacts = join(projectRoot, "workflow_artifacts.json");
    if (await optionalFile(artifacts)) out.push({ key: `artifacts/${projectId}`, path: artifacts, value: await json(artifacts) });
    const workflows = join(projectRoot, "workflows");
    for (const file of await readdir(workflows).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error))) {
      if (!file.endsWith(".json")) continue;
      const path = join(workflows, file); const value = await json(path);
      const workflowId = file.slice(0, -5);
      if (!(value && typeof value === "object" && (value as { projectId?: unknown; workflowId?: unknown }).projectId === projectId && (value as { workflowId?: unknown }).workflowId === workflowId)) throw new Error(`Workflow scope mismatch: ${path}`);
      out.push({ key: `workflow/${projectId}/${workflowId}`, path, value });
    }
  }
  for (const evalSetId of await directories(join(root, "data", "evals", "private"))) {
    const evalRoot = join(root, "data", "evals", "private", evalSetId);
    for (const [key, path, loader] of [
      [`eval/${evalSetId}/set`, join(evalRoot, "eval_set.json"), json],
    ] as const) if (await optionalFile(path)) out.push({ key, path, value: await loader(path) });
    for (const runId of await directories(join(evalRoot, "runs"))) {
      const runRoot = join(evalRoot, "runs", runId);
      for (const [key, path, loader] of [
        [`eval/${evalSetId}/run/${runId}`, join(runRoot, "run.json"), json],
        [`eval/${evalSetId}/outputs/${runId}`, join(runRoot, "outputs.jsonl"), jsonl],
      ] as const) if (await optionalFile(path)) out.push({ key, path, value: await loader(path) });
    }
    for (const runId of await readdir(join(evalRoot, "scorecards")).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error))) if (runId.endsWith(".jsonl")) {
      const path = join(evalRoot, "scorecards", runId); out.push({ key: `eval/${evalSetId}/scorecard/${runId.slice(0, -6)}`, path, value: await jsonl(path) });
    }
    for (const reviewId of await readdir(join(evalRoot, "blind_reviews")).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error))) if (reviewId.endsWith(".json")) {
      const path = join(evalRoot, "blind_reviews", reviewId); out.push({ key: `eval/${evalSetId}/blind/${reviewId.slice(0, -5)}`, path, value: await json(path) });
    }
  }
  return out;
}

export async function prepareWorkflowEvalSqliteCutover(input: { root: string; authority: SqliteStorageAuthority; activeRunCount: number; now?: () => Date }): Promise<PreparedWorkflowEvalSqliteCutover> {
  const root = resolve(input.root);
  if (input.activeRunCount > 0) throw new Error("Cannot cut Workflow/Team/Private Eval storage while Agent Runs are active.");
  const markerPath = workflowEvalAuthorityMarkerPath(root);
  const current = await optionalFile(markerPath);
  const store = new SqliteEventProjectionStore(databasePath(root));
  const repository = new SqliteWorkflowEvalRepository({ root, store, authority: input.authority });
  if (current) return { status: "already-sqlite", root, marker: JSON.parse(current.toString("utf8")) as WorkflowEvalSqliteAuthorityMarkerV1, markerPath, repository, close: () => store.close() };
  const backup = backupRoot(root); let published = false;
  try {
    const records = await sources(root);
    for (const record of records) { await copyExact(root, record.path, backup); await repository.write(record.key, record.value); if (JSON.stringify(await repository.read(record.key)) !== JSON.stringify(record.value)) throw new Error(`Workflow/Eval parity failed for ${record.key}.`); }
    await atomicJson(join(backup, "import-report-v1.json"), { schemaVersion: 1, records: records.map((record) => record.key) });
    const marker: WorkflowEvalSqliteAuthorityMarkerV1 = { schemaVersion: 1, authority: "sqlite", databaseRelativePath: relative(root, databasePath(root)).replaceAll("\\", "/"), backupRootRelativePath: relative(root, backup).replaceAll("\\", "/"), cutoverAt: (input.now?.() ?? new Date()).toISOString(), records: records.length, excludes: ["eval-corpus-bytes", "eval-reports"] };
    await input.authority.assertOwned(); await atomicJson(markerPath, marker); published = true;
    return { status: "cutover", root, marker, markerPath, repository, close: () => store.close() };
  } catch (error) {
    store.close(); if (!published) await Promise.all([rm(databasePath(root), { force: true }), rm(`${databasePath(root)}-wal`, { force: true }), rm(`${databasePath(root)}-shm`, { force: true }), rm(backup, { recursive: true, force: true })]); throw error;
  }
}

export function activateWorkflowEvalSqliteCutover(prepared: PreparedWorkflowEvalSqliteCutover): void { installWorkflowEvalPersistence(prepared.root, prepared.repository); }
