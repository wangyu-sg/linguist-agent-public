import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  countPhrasePlaceholders,
  readGenericXliff,
  readMqxliff,
  readPhraseMxliff,
  readSdlxliff,
  readTableCsv,
  segmentStatusFromMqxliff,
  segmentStatusFromSdlxliff,
  type DuplicateSourceGroup,
  type TagRehydrationReport,
} from "@linguist-agent/cat-formats";
import { readProjectLocalePair, readProjectManifest } from "./project_manifest.js";
import { canonicalLocale } from "./locale.js";
import { createTmStore } from "./tm.js";
import { writeSourceContextRowsForBatch } from "./source_context.js";
import { readXlsxBatchRows } from "./table_batch.js";
import { assertChangeEvidenceAllowed, assertSegmentWritePolicyAllowed } from "./write_policy.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile, type CatWorkspace } from "./workspace.js";
import { readProjectTagRuleContext } from "./tag_rules.js";
import { assertCatCoreLegacyAllowed, catCorePersistenceFor, readCatCoreReadCache, catCoreReadCachePath } from "./cat_core_storage.js";

export type SegmentStatus = "new" | "draft" | "confirmed";
export type BatchWorkflowStage = "translate" | "edit" | "proof" | "delivery";
export type SegmentChangeType =
  | "translation"
  | "term"
  | "terminology"
  | "accuracy"
  | "consistency"
  | "style"
  | "fluency"
  | "user_approved"
  | "other";

export interface BatchSegment {
  index: number;
  id: string;
  masterId?: string;
  resname?: string;
  contextNote?: string;
  source: string;
  target: string;
  originalTarget?: string;
  rawSource: string;
  rawTarget: string;
  locked: boolean;
  status: SegmentStatus;
  duplicateKey: string;
  duplicateRole?: "unique" | "first" | "repeat";
  duplicateOrdinal?: number;
  duplicateGroupSize?: number;
  duplicateFirstSegmentId?: string;
  placeholderCount: number;
  unresolvedPlaceholderCount: number;
  unresolvedRuntimePlaceholderCount?: number;
  unresolvedTagPlaceholderCount?: number;
  unresolvedPlaceholders?: string[];
  unresolvedRuntimePlaceholders?: string[];
  unresolvedTagPlaceholders?: string[];
  confirmationLevel?: string;
  tuId?: string;
  updatedAt?: string;
  updateReason?: string;
  updateChangeType?: SegmentChangeType;
  updateEvidenceSources?: string[];
}

export interface CatBatch {
  schemaVersion: 1;
  format: "phrase_mxliff" | "mqxliff" | "sdlxliff" | "xliff_1_2" | "xliff_2_0" | "csv_paste" | "xlsx_paste";
  projectId: string;
  batchId: string;
  sourceFile: string;
  masterFile?: string;
  sourceLanguage: string;
  targetLanguage: string;
  workflowStage?: BatchWorkflowStage;
  createdAt: string;
  updatedAt: string;
  tagReport: TagRehydrationReport;
  duplicateSourceGroups: DuplicateSourceGroup[];
  segments: BatchSegment[];
}

type GenericSegmentInput = {
  index: number;
  id: string;
  source: string;
  target: string;
  locked?: boolean;
  state?: string;
  note?: string;
  duplicateKey?: string;
};

export interface SegmentUpdateResult {
  batchId: string;
  requestedSegmentId: string;
  changedSegmentIds: string[];
  skippedLockedIds: string[];
  skippedDuplicateIds: string[];
  propagated: boolean;
  duplicateGroupSize: number;
  target: string;
  status: SegmentStatus;
  segment: BatchSegment;
  batchUpdatedAt: string;
}

export interface SegmentUpdateOptions {
  segmentId: string;
  target: string;
  confirm?: boolean;
  propagateDuplicates?: boolean;
  reason: string;
  evidenceSources?: string[];
  acceptedRiskCodes?: string[];
  changeType: SegmentChangeType;
  expectedSegmentUpdatedAt?: string | null;
}

export class SegmentRevisionConflictError extends Error {
  readonly currentSegment: BatchSegment;
  readonly batchUpdatedAt: string;

  constructor(currentSegment: BatchSegment, batchUpdatedAt: string) {
    super(`Segment ${currentSegment.id} changed after the editor loaded it.`);
    this.name = "SegmentRevisionConflictError";
    this.currentSegment = currentSegment;
    this.batchUpdatedAt = batchUpdatedAt;
  }
}

const segmentMutationQueues = new Map<string, Promise<void>>();

async function serializeSegmentMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = segmentMutationQueues.get(key) ?? Promise.resolve();
  let result: T | undefined;
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      result = await mutation();
    });
  segmentMutationQueues.set(key, queued);
  try {
    await queued;
    return result as T;
  } finally {
    if (segmentMutationQueues.get(key) === queued) segmentMutationQueues.delete(key);
  }
}

export function batchPath(workspace: CatWorkspace, batchId: string): string {
  return workspacePath(workspace, "batches", batchId, "batch.json");
}

async function readExistingBatch(workspaceRoot: string, projectId: string, batchId: string): Promise<CatBatch | null> {
  try {
    return await readBatch(workspaceRoot, projectId, batchId);
  } catch (error) {
    if (error instanceof Error && error.message === `Batch ${batchId} not found for project ${projectId}.`) return null;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeBatch(
  workspaceRoot: string,
  projectId: string,
  batch: CatBatch,
  expected: CatBatch | null,
): Promise<void> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) {
    await persistence.writeBatch(projectId, batch.batchId, batch, expected);
    return;
  }
  await assertCatCoreLegacyAllowed(workspaceRoot);
  await mkdir(dirname(batchPath(createWorkspace(workspaceRoot, projectId), batch.batchId)), { recursive: true });
  await writeJsonFile(batchPath(createWorkspace(workspaceRoot, projectId), batch.batchId), batch);
}

function safeBatchId(value: string): string {
  return value.replace(/[/:]+/g, "-").replace(/\s+/g, " ").trim() || "batch";
}

function segmentStatus(target: string, confirmed?: string): SegmentStatus {
  if (confirmed && confirmed !== "0" && confirmed.toLowerCase() !== "false") return "confirmed";
  return target.trim() ? "draft" : "new";
}

function emptyTagReport(totalSegments: number): TagRehydrationReport {
  return {
    totalSegments,
    placeholderSegments: 0,
    masterMatchedSegments: totalSegments,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  };
}

function buildDuplicateGroups(segments: BatchSegment[]): DuplicateSourceGroup[] {
  const byKey = new Map<string, BatchSegment[]>();
  for (const segment of segments) {
    const list = byKey.get(segment.duplicateKey) ?? [];
    list.push(segment);
    byKey.set(segment.duplicateKey, list);
  }
  return Array.from(byKey.entries())
    .filter(([, list]) => list.length > 1)
    .map(([duplicateKey, list]) => ({
      duplicateKey,
      source: list[0].source,
      count: list.length,
      segmentIds: list.map((segment) => segment.id),
      firstSegmentId: list[0].id,
    }));
}

function annotateDuplicateMetadata(segments: BatchSegment[]): BatchSegment[] {
  const byKey = new Map<string, BatchSegment[]>();
  for (const segment of segments) {
    const list = byKey.get(segment.duplicateKey) ?? [];
    list.push(segment);
    byKey.set(segment.duplicateKey, list);
  }
  for (const list of byKey.values()) {
    const first = list[0];
    for (const [index, segment] of list.entries()) {
      segment.duplicateGroupSize = list.length;
      segment.duplicateOrdinal = index + 1;
      segment.duplicateFirstSegmentId = first.id;
      segment.duplicateRole = list.length === 1 ? "unique" : index === 0 ? "first" : "repeat";
    }
  }
  return segments;
}

export function assertSegmentWriteAllowed(options: Pick<SegmentUpdateOptions, "changeType" | "reason" | "evidenceSources">): string[] {
  return assertChangeEvidenceAllowed(options);
}

async function resolveProjectPath(workspaceRoot: string, projectId: string, path: string): Promise<string> {
  if (isAbsolute(path)) return path;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, path);
}

export async function importPhraseBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    mxliffPath: string;
    masterXliffPath?: string;
    batchId?: string;
    overwrite?: boolean;
    workflowStage?: BatchWorkflowStage;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const mxliffPath = await resolveProjectPath(workspaceRoot, options.projectId, options.mxliffPath);
  const masterXliffPath = options.masterXliffPath
    ? await resolveProjectPath(workspaceRoot, options.projectId, options.masterXliffPath)
    : undefined;
  const parsed = await readPhraseMxliff(mxliffPath, { masterPath: masterXliffPath });
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  const batchId = safeBatchId(options.batchId ?? parsed.batchId);
  const path = batchPath(workspace, batchId);
  const existing = await readExistingBatch(workspaceRoot, options.projectId, batchId);
  if (existing && !options.overwrite) {
    throw new Error(`Batch ${batchId} already exists. Pass overwrite=true to replace it.`);
  }

  const now = new Date().toISOString();
  const batch: CatBatch = {
    schemaVersion: 1,
    format: "phrase_mxliff",
    projectId: options.projectId,
    batchId,
    sourceFile: mxliffPath,
    masterFile: masterXliffPath,
    sourceLanguage: canonicalLocale(parsed.sourceLanguage, "sourceLanguage"),
    targetLanguage: canonicalLocale(parsed.targetLanguage, "targetLanguage"),
    workflowStage: options.workflowStage ?? existing?.workflowStage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tagReport: parsed.tagReport,
    duplicateSourceGroups: parsed.duplicateSourceGroups,
    segments: annotateDuplicateMetadata(parsed.segments.map((segment) => ({
      index: segment.index,
      id: segment.id,
      masterId: segment.masterId,
      resname: segment.resname,
      contextNote: segment.contextNote,
      source: segment.rehydratedSource,
      target: segment.rehydratedTarget,
      originalTarget: segment.rehydratedTarget,
      rawSource: segment.source,
      rawTarget: segment.target,
      locked: segment.locked,
      status: segmentStatus(segment.rehydratedTarget, segment.confirmed),
      duplicateKey: segment.duplicateKey,
      placeholderCount: segment.placeholderCount,
      unresolvedPlaceholderCount: segment.unresolvedPlaceholderCount,
      unresolvedRuntimePlaceholderCount: segment.unresolvedRuntimePlaceholderCount,
      unresolvedTagPlaceholderCount: segment.unresolvedTagPlaceholderCount,
      unresolvedPlaceholders: segment.unresolvedPlaceholders,
      unresolvedRuntimePlaceholders: segment.unresolvedRuntimePlaceholders,
      unresolvedTagPlaceholders: segment.unresolvedTagPlaceholders,
    }))),
  };

  await writeBatch(workspaceRoot, options.projectId, batch, existing);
  await writeSourceContextRowsForBatch(workspaceRoot, batch);
  return { batch, path };
}

export async function importSdlxliffBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    sdlxliffPath: string;
    batchId?: string;
    overwrite?: boolean;
    workflowStage?: BatchWorkflowStage;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const sdlxliffPath = await resolveProjectPath(workspaceRoot, options.projectId, options.sdlxliffPath);
  const parsed = await readSdlxliff(sdlxliffPath);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  const batchId = safeBatchId(options.batchId ?? parsed.batchId);
  const path = batchPath(workspace, batchId);
  const existing = await readExistingBatch(workspaceRoot, options.projectId, batchId);
  if (existing && !options.overwrite) {
    throw new Error(`Batch ${batchId} already exists. Pass overwrite=true to replace it.`);
  }

  const now = new Date().toISOString();
  const segments: BatchSegment[] = annotateDuplicateMetadata(parsed.segments.map((segment) => ({
    index: segment.index,
    id: segment.id,
    source: segment.source,
    target: segment.target,
    originalTarget: segment.target,
    rawSource: segment.source,
    rawTarget: segment.target,
    locked: segment.locked,
    status: segmentStatusFromSdlxliff(segment.target, segment.confirmationLevel),
    duplicateKey: segment.duplicateKey,
    placeholderCount: segment.sourceTags.length,
    unresolvedPlaceholderCount: 0,
    confirmationLevel: segment.confirmationLevel,
    tuId: segment.tuId,
  })));
  const batch: CatBatch = {
    schemaVersion: 1,
    format: "sdlxliff",
    projectId: options.projectId,
    batchId,
    sourceFile: sdlxliffPath,
    sourceLanguage: canonicalLocale(parsed.sourceLanguage, "sourceLanguage"),
    targetLanguage: canonicalLocale(parsed.targetLanguage, "targetLanguage"),
    workflowStage: options.workflowStage ?? existing?.workflowStage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tagReport: emptyTagReport(parsed.segments.length),
    duplicateSourceGroups: buildDuplicateGroups(segments),
    segments,
  };

  await writeBatch(workspaceRoot, options.projectId, batch, existing);
  await writeSourceContextRowsForBatch(workspaceRoot, batch);
  return { batch, path };
}

export async function importMqxliffBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    mqxliffPath: string;
    batchId?: string;
    overwrite?: boolean;
    workflowStage?: BatchWorkflowStage;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const mqxliffPath = await resolveProjectPath(workspaceRoot, options.projectId, options.mqxliffPath);
  const parsed = await readMqxliff(mqxliffPath);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  const batchId = safeBatchId(options.batchId ?? parsed.batchId);
  const path = batchPath(workspace, batchId);
  const existing = await readExistingBatch(workspaceRoot, options.projectId, batchId);
  if (existing && !options.overwrite) {
    throw new Error(`Batch ${batchId} already exists. Pass overwrite=true to replace it.`);
  }

  const now = new Date().toISOString();
  const segments: BatchSegment[] = annotateDuplicateMetadata(parsed.segments.map((segment) => ({
    index: segment.index,
    id: segment.id,
    contextNote: segment.note,
    source: segment.source,
    target: segment.target,
    originalTarget: segment.target,
    rawSource: segment.source,
    rawTarget: segment.target,
    locked: segment.locked,
    status: segmentStatusFromMqxliff(segment.target, segment.status),
    duplicateKey: segment.duplicateKey,
    placeholderCount: segment.sourceTags.length,
    unresolvedPlaceholderCount: 0,
    confirmationLevel: segment.status,
  })));
  const batch: CatBatch = {
    schemaVersion: 1,
    format: "mqxliff",
    projectId: options.projectId,
    batchId,
    sourceFile: mqxliffPath,
    sourceLanguage: canonicalLocale(parsed.sourceLanguage, "sourceLanguage"),
    targetLanguage: canonicalLocale(parsed.targetLanguage, "targetLanguage"),
    workflowStage: options.workflowStage ?? existing?.workflowStage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tagReport: emptyTagReport(parsed.segments.length),
    duplicateSourceGroups: buildDuplicateGroups(segments),
    segments,
  };

  await writeBatch(workspaceRoot, options.projectId, batch, existing);
  await writeSourceContextRowsForBatch(workspaceRoot, batch);
  return { batch, path };
}

async function writeGenericBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    batchId: string;
    sourceFile: string;
    format: CatBatch["format"];
    sourceLanguage?: string;
    targetLanguage?: string;
    workflowStage?: BatchWorkflowStage;
    segments: GenericSegmentInput[];
    overwrite?: boolean;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
  });
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  const batchId = safeBatchId(options.batchId);
  const path = batchPath(workspace, batchId);
  const existing = await readExistingBatch(workspaceRoot, options.projectId, batchId);
  if (existing && !options.overwrite) {
    throw new Error(`Batch ${batchId} already exists. Pass overwrite=true to replace it.`);
  }
  const now = new Date().toISOString();
  const segments: BatchSegment[] = annotateDuplicateMetadata(options.segments.map((segment) => ({
    index: segment.index,
    id: segment.id,
    contextNote: segment.note,
    source: segment.source,
    target: segment.target,
    originalTarget: segment.target,
    rawSource: segment.source,
    rawTarget: segment.target,
    locked: Boolean(segment.locked),
    status: segmentStatus(segment.target, segment.state === "translated" || segment.state === "final" ? "1" : undefined),
    duplicateKey: segment.duplicateKey ?? segment.source.trim(),
    placeholderCount: 0,
    unresolvedPlaceholderCount: 0,
    confirmationLevel: segment.state,
  })));
  const batch: CatBatch = {
    schemaVersion: 1,
    format: options.format,
    projectId: options.projectId,
    batchId,
    sourceFile: options.sourceFile,
    sourceLanguage: locales.sourceLanguage,
    targetLanguage: locales.targetLanguage,
    workflowStage: options.workflowStage ?? existing?.workflowStage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tagReport: emptyTagReport(segments.length),
    duplicateSourceGroups: buildDuplicateGroups(segments),
    segments,
  };
  await writeBatch(workspaceRoot, options.projectId, batch, existing);
  await writeSourceContextRowsForBatch(workspaceRoot, batch);
  return { batch, path };
}

export async function importGenericXliffBatch(
  workspaceRoot: string,
  options: { projectId: string; xliffPath: string; batchId?: string; overwrite?: boolean; workflowStage?: BatchWorkflowStage },
): Promise<{ batch: CatBatch; path: string }> {
  const xliffPath = await resolveProjectPath(workspaceRoot, options.projectId, options.xliffPath);
  const parsed = await readGenericXliff(xliffPath);
  return writeGenericBatch(workspaceRoot, {
    projectId: options.projectId,
    batchId: options.batchId ?? parsed.batchId,
    sourceFile: xliffPath,
    format: parsed.format,
    sourceLanguage: parsed.sourceLanguage,
    targetLanguage: parsed.targetLanguage,
    workflowStage: options.workflowStage,
    segments: parsed.segments,
    overwrite: options.overwrite,
  });
}

export async function importCsvBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    csvPath: string;
    batchId?: string;
    overwrite?: boolean;
    workflowStage?: BatchWorkflowStage;
    sourceLanguage?: string;
    targetLanguage?: string;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const csvPath = await resolveProjectPath(workspaceRoot, options.projectId, options.csvPath);
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, options);
  const parsed = await readTableCsv(csvPath, { srcLang: locales.sourceLanguage, tgtLang: locales.targetLanguage });
  return writeGenericBatch(workspaceRoot, {
    projectId: options.projectId,
    batchId: options.batchId ?? parsed.batchId,
    sourceFile: csvPath,
    format: "csv_paste",
    sourceLanguage: parsed.sourceLanguage,
    targetLanguage: parsed.targetLanguage,
    workflowStage: options.workflowStage,
    segments: parsed.segments,
    overwrite: options.overwrite,
  });
}

export async function importXlsxBatch(
  workspaceRoot: string,
  options: {
    projectId: string;
    xlsxPath: string;
    batchId?: string;
    overwrite?: boolean;
    workflowStage?: BatchWorkflowStage;
    sourceLanguage?: string;
    targetLanguage?: string;
  },
): Promise<{ batch: CatBatch; path: string }> {
  const xlsxPath = await resolveProjectPath(workspaceRoot, options.projectId, options.xlsxPath);
  const parsed = await readXlsxBatchRows(xlsxPath);
  return writeGenericBatch(workspaceRoot, {
    projectId: options.projectId,
    batchId: options.batchId ?? basename(xlsxPath, ".xlsx"),
    sourceFile: xlsxPath,
    format: "xlsx_paste",
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    workflowStage: options.workflowStage,
    segments: parsed.rows,
    overwrite: options.overwrite,
  });
}

export async function readBatch(workspaceRoot: string, projectId: string, batchId: string): Promise<CatBatch> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  const batch = persistence
    ? await persistence.readBatch(projectId, batchId)
    : (await readCatCoreReadCache<CatBatch>(workspaceRoot, "batch", projectId, batchId))
      ?? (await assertCatCoreLegacyAllowed(workspaceRoot), await readJsonFile<CatBatch | null>(batchPath(createWorkspace(workspaceRoot, projectId), batchId), null));
  if (!batch) throw new Error(`Batch ${batchId} not found for project ${projectId}.`);
  return {
    ...batch,
    sourceLanguage: canonicalLocale(batch.sourceLanguage, "sourceLanguage"),
    targetLanguage: canonicalLocale(batch.targetLanguage, "targetLanguage"),
  };
}

export async function listBatches(workspaceRoot: string, projectId: string): Promise<Array<{ batchId: string; path: string }>> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) return persistence.listBatches(projectId);
  const cachedRoot = dirname(catCoreReadCachePath(workspaceRoot, "batch", projectId, "__root__"));
  try {
    const cachedEntries = await readdir(cachedRoot, { withFileTypes: true });
    const cached = await Promise.all(cachedEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => ({
        batch: JSON.parse(await readFile(join(cachedRoot, entry.name), "utf8")) as CatBatch,
      })));
    return cached
      .sort((left, right) => left.batch.batchId.localeCompare(right.batch.batchId))
      .map(({ batch }) => ({ batchId: batch.batchId, path: batchPath(createWorkspace(workspaceRoot, projectId), batch.batchId) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await assertCatCoreLegacyAllowed(workspaceRoot);
  const projectDir = workspacePath(createWorkspace(workspaceRoot, projectId), "batches");
  try {
    const entries = await readdir(projectDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ batchId: entry.name, path: join(projectDir, entry.name, "batch.json") }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function updateSegmentTarget(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  options: SegmentUpdateOptions,
): Promise<SegmentUpdateResult> {
  return serializeSegmentMutation(`${workspaceRoot}\u001f${projectId}\u001f${batchId}`, () =>
    updateSegmentTargetUnlocked(workspaceRoot, projectId, batchId, options));
}

async function updateSegmentTargetUnlocked(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  options: SegmentUpdateOptions,
): Promise<SegmentUpdateResult> {
  const evidenceSources = assertSegmentWriteAllowed(options);
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  const expectedBatch = structuredClone(batch);
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, projectId);
  const primary = batch.segments.find((segment) => segment.id === options.segmentId);
  if (!primary) throw new Error(`Segment ${options.segmentId} not found in batch ${batchId}.`);
  if (options.expectedSegmentUpdatedAt !== undefined
      && (primary.updatedAt ?? null) !== options.expectedSegmentUpdatedAt) {
    throw new SegmentRevisionConflictError(primary, batch.updatedAt);
  }

  const originalPrimaryTarget = primary.target;
  const propagate = options.propagateDuplicates === true;
  const targets = propagate
    ? batch.segments.filter((segment) => segment.duplicateKey === primary.duplicateKey)
    : [primary];
  const status: SegmentStatus = options.confirm ? "confirmed" : options.target.trim() ? "draft" : "new";
  const now = new Date().toISOString();
  const changedSegmentIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const skippedDuplicateIds: string[] = [];
  const changedSegments: BatchSegment[] = [];

  for (const segment of targets) {
    if (segment.locked) {
      skippedLockedIds.push(segment.id);
      continue;
    }
    if (propagate && segment.id !== primary.id) {
      const safeDuplicateTarget =
        !segment.target.trim() ||
        segment.target === originalPrimaryTarget ||
        segment.target === primary.rawTarget;
      if (!safeDuplicateTarget) {
        skippedDuplicateIds.push(segment.id);
        continue;
      }
    }
    assertSegmentWritePolicyAllowed({
      batch,
      segment,
      target: options.target,
      reason: options.reason,
      changeType: options.changeType,
      evidenceSources,
      acceptedRiskCodes: options.acceptedRiskCodes,
      ruleContext,
    });
    segment.target = options.target;
    segment.unresolvedPlaceholderCount = batch.format === "phrase_mxliff" ? countPhrasePlaceholders(options.target) : 0;
    segment.unresolvedRuntimePlaceholderCount = 0;
    segment.unresolvedTagPlaceholderCount = segment.unresolvedPlaceholderCount;
    segment.unresolvedPlaceholders = [];
    segment.unresolvedRuntimePlaceholders = [];
    segment.unresolvedTagPlaceholders = [];
    segment.status = status;
    segment.updatedAt = now;
    segment.updateReason = options.reason;
    segment.updateChangeType = options.changeType;
    segment.updateEvidenceSources = evidenceSources;
    changedSegmentIds.push(segment.id);
    changedSegments.push(segment);
  }

  batch.updatedAt = now;
  await writeBatch(workspaceRoot, projectId, batch, expectedBatch);
  if (options.confirm) {
    const workspace = createWorkspace(workspaceRoot, projectId);
    const tm = createTmStore(workspace);
    for (const segment of changedSegments) {
      if (!segment.source.trim() || !segment.target.trim()) continue;
      await tm.upsertReviewed({
        source: segment.source,
        target: segment.target,
        srcLang: batch.sourceLanguage || "unknown",
        tgtLang: batch.targetLanguage || "unknown",
        project: batch.projectId,
        note: `${batch.batchId}:${segment.id}${options.reason ? ` · ${options.reason}` : ""}`,
        sourceKind: "batch_confirm",
        sourceBatchId: batch.batchId,
        sourceSegmentId: segment.id,
      });
    }
  }
  return {
    batchId,
    requestedSegmentId: options.segmentId,
    changedSegmentIds,
    skippedLockedIds,
    skippedDuplicateIds,
    propagated: propagate,
    duplicateGroupSize: targets.length,
    target: options.target,
    status,
    segment: primary,
    batchUpdatedAt: batch.updatedAt,
  };
}
