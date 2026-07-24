import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  catGovernanceAuthorityMarkerPath,
  installCatGovernancePersistence,
  readQualityChecklist,
  readQualityDecisionLedger,
  type ExportAuditRecord,
  type QualityChecklistDocument,
  type QualityDecisionLedgerEvent,
  type SegmentProposalSet,
} from "@linguist-agent/cat-data";
import {
  SqliteCatGovernanceRepository,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
} from "@linguist-agent/storage-sqlite";

export type CatGovernanceSqliteAuthority = SqliteStorageAuthority;

export interface CatGovernanceSqliteProjectReportV1 {
  projectId: string;
  ledgerEvents: number;
  checklistEntries: number;
  proposalSets: number;
  proposalRows: number;
  exportAudits: number;
  status: "valid";
}

export interface CatGovernanceSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  projects: CatGovernanceSqliteProjectReportV1[];
  excludes: ["segment-source", "asset-evidence-bytes", "vectors", "read-cache"];
}

export interface PreparedCatGovernanceSqliteCutover {
  status: "cutover" | "already-sqlite";
  root: string;
  marker: CatGovernanceSqliteAuthorityMarkerV1;
  markerPath: string;
  repository: SqliteCatGovernanceRepository;
  store: SqliteEventProjectionStore;
  close(): void;
}

const EXCLUDES: CatGovernanceSqliteAuthorityMarkerV1["excludes"] = ["segment-source", "asset-evidence-bytes", "vectors", "read-cache"];

function databasePath(root: string): string {
  return join(root, "data", "runtime", "cat-governance-sqlite-v1", "cat-governance.sqlite");
}

function backupRoot(root: string): string {
  return join(root, "data", "backups", "cat-governance-cutover-v1", `attempt-${Date.now()}-${process.pid}`);
}

function projectRoot(root: string, projectId: string): string {
  return join(root, "data", "projects", projectId);
}

function safeRelativePath(root: string, path: string): string {
  const value = relative(resolve(root), resolve(path));
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error("CAT governance backup path escapes the project root.");
  return value.split("\\").join("/");
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function copyExact(source: string, target: string): Promise<void> {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`CAT governance source must be a regular file: ${source}`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await syncFile(target);
}

async function optionalFile(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function discoverProjects(root: string): Promise<string[]> {
  const projectsRoot = join(root, "data", "projects");
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const ids: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) ids.push(entry.name);
  }
  return ids;
}

async function proposalFiles(root: string, projectId: string): Promise<string[]> {
  const batchesRoot = join(projectRoot(root, projectId), "batches");
  const batches = await readdir(batchesRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const batch of batches.filter((entry) => entry.isDirectory())) {
    const proposalsRoot = join(batchesRoot, batch.name, "proposals");
    const entries = await readdir(proposalsRoot, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    files.push(...entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => join(proposalsRoot, entry.name)));
  }
  return files.sort();
}

async function parseExportAudits(path: string): Promise<ExportAuditRecord[]> {
  const raw = await optionalFile(path);
  if (!raw) return [];
  return raw.toString("utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as ExportAuditRecord; } catch (error) { throw new Error(`Invalid export audit at ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

interface ParsedProject {
  projectId: string;
  ledger: QualityDecisionLedgerEvent[];
  checklist: QualityChecklistDocument | null;
  proposals: SegmentProposalSet[];
  audits: ExportAuditRecord[];
  files: string[];
}

async function parseProject(root: string, projectId: string): Promise<ParsedProject> {
  const rootPath = projectRoot(root, projectId);
  const ledger = await readQualityDecisionLedger(root, projectId);
  const checklist = await optionalFile(join(rootPath, "quality_checklist.json")) ? await readQualityChecklist(root, projectId) : null;
  const proposals: SegmentProposalSet[] = [];
  const files = [
    join(rootPath, "quality_decision_ledger.jsonl"),
    join(rootPath, "quality_checklist.json"),
    join(rootPath, "exports", "export_audit.jsonl"),
    ...(await proposalFiles(root, projectId)),
  ];
  for (const path of await proposalFiles(root, projectId)) {
    const raw = await readFile(path, "utf8");
    const proposal = JSON.parse(raw) as SegmentProposalSet;
    if (proposal.schemaVersion !== 1 || proposal.projectId !== projectId || !proposal.batchId || !proposal.proposalSetId || !Array.isArray(proposal.proposals)) {
      throw new Error(`CAT governance proposal file is invalid: ${path}`);
    }
    proposals.push(proposal);
  }
  return { projectId, ledger, checklist, proposals, audits: await parseExportAudits(join(rootPath, "exports", "export_audit.jsonl")), files: [...new Set(files)] };
}

async function backupProject(root: string, attempt: string, parsed: ParsedProject): Promise<void> {
  const target = join(attempt, "projects", parsed.projectId);
  for (const file of parsed.files) {
    if (await optionalFile(file)) await copyExact(file, join(target, safeRelativePath(projectRoot(root, parsed.projectId), file)));
  }
}

function ledgerInputs(events: QualityDecisionLedgerEvent[]) {
  return events.map(({ schemaVersion: _schemaVersion, sequence: _sequence, previousHash: _previousHash, hash: _hash, ...input }) => input);
}

function reportFor(parsed: ParsedProject): CatGovernanceSqliteProjectReportV1 {
  return {
    projectId: parsed.projectId,
    ledgerEvents: parsed.ledger.length,
    checklistEntries: parsed.checklist?.entries.length ?? 0,
    proposalSets: parsed.proposals.length,
    proposalRows: parsed.proposals.reduce((sum, proposal) => sum + proposal.proposals.length, 0),
    exportAudits: parsed.audits.length,
    status: "valid",
  };
}

export async function prepareCatGovernanceSqliteCutover(input: {
  root: string;
  authority: CatGovernanceSqliteAuthority;
  activeRunCount: number;
  now?: () => Date;
}): Promise<PreparedCatGovernanceSqliteCutover> {
  const root = resolve(input.root);
  if (input.activeRunCount > 0) throw new Error("Cannot cut CAT governance storage while Agent Runs are active.");
  const markerPath = catGovernanceAuthorityMarkerPath(root);
  const existingMarkerRaw = await optionalFile(markerPath);
  if (existingMarkerRaw) {
    const marker = JSON.parse(existingMarkerRaw.toString("utf8")) as CatGovernanceSqliteAuthorityMarkerV1;
    const store = new SqliteEventProjectionStore(databasePath(root));
    const repository = new SqliteCatGovernanceRepository({ root, store, authority: input.authority });
    return { status: "already-sqlite", root, marker, markerPath, repository, store, close: () => store.close() };
  }
  const database = databasePath(root);
  const attempt = backupRoot(root);
  const store = new SqliteEventProjectionStore(database);
  const repository = new SqliteCatGovernanceRepository({ root, store, authority: input.authority });
  let markerPublished = false;
  try {
    const parsed = await Promise.all((await discoverProjects(root)).map((projectId) => parseProject(root, projectId)));
    for (const project of parsed) {
      await backupProject(root, attempt, project);
      if (project.ledger.length) {
        await repository.appendLedger(project.projectId, ledgerInputs(project.ledger), false);
        if (JSON.stringify(await repository.readLedger(project.projectId)) !== JSON.stringify(project.ledger)) throw new Error(`CAT governance ledger parity failed for ${project.projectId}.`);
      }
      if (project.checklist) await repository.writeQualityChecklist(project.projectId, project.checklist, null);
      for (const proposal of project.proposals) await repository.writeProposalSet(project.projectId, proposal.batchId, proposal, null);
      for (const audit of project.audits) await repository.appendExportAudit(project.projectId, audit);
      await repository.syncReadCaches(project.projectId);
    }
    await writeAtomicJson(join(attempt, "import-report-v1.json"), { schemaVersion: 1, valid: parsed.map(reportFor), invalid: [] });
    const marker: CatGovernanceSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: relative(root, database).split("\\").join("/"),
      backupRootRelativePath: relative(root, attempt).split("\\").join("/"),
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      projects: parsed.map(reportFor),
      excludes: EXCLUDES,
    };
    await input.authority.assertOwned();
    await writeAtomicJson(markerPath, marker);
    markerPublished = true;
    return { status: "cutover", root, marker, markerPath, repository, store, close: () => store.close() };
  } catch (error) {
    store.close();
    if (!markerPublished) {
      await Promise.all([
        rm(database, { force: true }),
        rm(`${database}-wal`, { force: true }),
        rm(`${database}-shm`, { force: true }),
        rm(join(root, "data", "runtime", "cat-governance-sqlite-v1", "read-cache"), { recursive: true, force: true }),
        rm(attempt, { recursive: true, force: true }),
      ]);
    }
    throw error;
  }
}

export function activateCatGovernanceSqliteCutover(prepared: PreparedCatGovernanceSqliteCutover): void {
  installCatGovernancePersistence(prepared.root, prepared.repository);
}
