import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { readXlsxBatchRows } from "./table_batch.js";
import { readWorkbookRows, type WorkbookRows } from "./workbook_mapping.js";
import { compareFormattingSignatures } from "./format_signatures.js";
import { QA_WRITE_BLOCKER_CODES } from "./qa_write_gate.js";
import type { ProjectTagRuleContext } from "./tag_rules_core.js";
import { readJsonFile, readJsonlFile, writeJsonFile } from "./workspace.js";
import type { PromptManifest } from "./prompt_compiler.js";
import type { TeamContextManifest, TeamRoleId, TeamRoleProfile } from "./team_workflow.js";
import { numberQaTokens } from "./number_qa.js";
import { checkSpelling, type SpellingQaCoverage } from "./spelling_qa.js";

export type PrivateEvalThinkingLevel = NonNullable<TeamRoleProfile["thinking"]>;
export const DEFAULT_PRIVATE_EVAL_THINKING_LEVEL: PrivateEvalThinkingLevel = "medium";

export const EVAL_DIMENSIONS = [
  "adequacy",
  "terminology",
  "hard_constraints",
  "function_strategy_fit",
  "genre_voice_fit",
  "styleguide_application",
  "fluency_idiomaticity",
  "overediting_risk",
  "delivery_readiness",
] as const;

export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export interface PrivateEvalSegment {
  evalSetId: string;
  segmentId: string;
  source: string;
  referenceTarget?: string;
  reviewedTarget?: string;
  customerReturnTarget?: string;
  tags: string[];
  riskTypes: Array<"terminology" | "placeholder" | "tag" | "number" | "ui" | "flavor" | "omission" | "style">;
  assetRefs: string[];
  tmRefs: string[];
  termRefs: string[];
}

export interface PrivateEvalSet {
  evalSetId: string;
  label: string;
  sourceRoot: string;
  createdAt: string;
  assetPaths: string[];
  segmentCount: number;
  rubricPath: string;
}

export interface PrivateEvalRun {
  runId: string;
  evalSetId: string;
  projectId?: string;
  taskId?: string;
  segmentCount?: number;
  mode: "single_agent" | "team_workflow";
  modelRoutes: Record<string, string>;
  /** Shared Single/Team comparison setting. Optional only for historical decoding. */
  thinkingLevel?: PrivateEvalThinkingLevel;
  /** Previous terminal attempt whose completed checkpoints seeded this run. */
  resumedFromRunId?: string;
  /** Completed outputs reused from the source attempt rather than regenerated. */
  checkpointOutputCount?: number;
  /** Subset of aggregate usage attributable to reused checkpoint outputs. */
  checkpointUsage?: PrivateEvalUsage;
  startedAt: string;
  completedAt?: string;
  usage?: PrivateEvalUsage;
  error?: string;
  status: "running" | "stopped" | "failed" | "completed";
}

export interface PrivateEvalRunOutput {
  runId: string;
  evalSetId: string;
  segmentId: string;
  mode: PrivateEvalRun["mode"];
  source: string;
  target?: string;
  notes?: string;
  rawResponse?: string;
  /** PromptCompiler manifest used for this segment; no reference text is stored here. */
  promptManifest?: PromptManifest;
  executionManifest?: PrivateEvalExecutionManifest;
  mechanicalQa?: PrivateEvalMechanicalQa;
  usage?: PrivateEvalUsage;
  status: "completed" | "failed";
  error?: string;
}

export interface PrivateEvalMechanicalQa {
  safe: boolean;
  blockerCodes: string[];
  warningCodes: string[];
  spelling?: SpellingQaCoverage;
}

export interface PrivateEvalMechanicalQaOptions {
  targetLocale?: string;
  allowedTerms?: readonly string[];
}

export function evaluatePrivateEvalMechanicalQa(
  source: string,
  target: string | undefined,
  ruleContext: ProjectTagRuleContext,
  options: PrivateEvalMechanicalQaOptions = {},
): PrivateEvalMechanicalQa {
  const spelling = options.targetLocale
    ? checkSpelling([{ id: "eval", target: target ?? "" }], options.targetLocale, options.allowedTerms)
    : undefined;
  if (!target?.trim()) {
    return {
      safe: false,
      blockerCodes: ["MISSING_TARGET"],
      warningCodes: [],
      ...(spelling ? { spelling: spelling.coverage } : {}),
    };
  }
  const comparison = compareFormattingSignatures(source, target, ruleContext);
  const blockerCodes = comparison.mismatches
    .filter((mismatch) => QA_WRITE_BLOCKER_CODES.has(mismatch.code))
    .map((mismatch) => mismatch.code);
  const warningCodes = comparison.mismatches
    .filter((mismatch) => !QA_WRITE_BLOCKER_CODES.has(mismatch.code))
    .map((mismatch) => mismatch.code);
  const sourceNumbers = numberQaTokens(source);
  const targetNumbers = numberQaTokens(target);
  if (sourceNumbers.length && (sourceNumbers.length !== targetNumbers.length || sourceNumbers.some((value, index) => value !== targetNumbers[index]))) {
    warningCodes.push("NUMBER_MISMATCH");
  }
  if (spelling?.issues.length) warningCodes.push("SPELLING_UNKNOWN_WORD");
  return {
    safe: blockerCodes.length === 0,
    blockerCodes: [...new Set(blockerCodes)].sort(),
    warningCodes: [...new Set(warningCodes)].sort(),
    ...(spelling ? { spelling: spelling.coverage } : {}),
  };
}

export interface PrivateEvalUsage {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  modelCalls?: number;
}

export interface PrivateEvalExecutionManifest {
  adapter: "single_pi" | "canonical_single_batch" | "pi_role_sessions_team" | "canonical_team_workflow";
  roleIds: TeamRoleId[];
  estimatedCalls: number;
  actualCalls: number;
  /** Provider watchdog applied to each model call; optional on historical runs. */
  deadlineMs?: number;
  rolePromptHashes: Array<{ roleId: TeamRoleId; promptHash: string; modelRoute?: string }>;
  roleContextManifests?: Array<{ roleId: TeamRoleId; modelRoute?: string; manifest: TeamContextManifest }>;
  thinkingLevel?: PrivateEvalThinkingLevel;
  segmentIdMode?: "eval_alias_v1";
  referenceIncluded: false;
  writeMode: "none";
}

export interface PrivateEvalTeamRoleLifecycleEvent {
  type: "started" | "completed" | "failed";
  segmentId: string;
  roleId: TeamRoleId;
  callIndex: number;
  roleAttempt: number;
  modelRoute?: string;
  promptHash: string;
  usage?: PrivateEvalUsage;
  error?: string;
}

export interface HumanScoreRow {
  runId: string;
  segmentId: string;
  dimension: EvalDimension;
  score: 1 | 2 | 3 | 4 | 5;
  judge: "human:reviewer";
  issueTier: "OK" | "A" | "B" | "C";
  issueCategories: string[];
  accepted?: boolean;
  comment?: string;
}

export type PrivateEvalBlindPreference = "a" | "b" | "tie" | "both_fail";
export type PrivateEvalIssueTier = "OK" | "A" | "B" | "C";

export interface PrivateEvalBlindJudgment {
  pairId: string;
  preference: PrivateEvalBlindPreference;
  issueTierA: PrivateEvalIssueTier;
  issueTierB: PrivateEvalIssueTier;
  issueCategoriesA: string[];
  issueCategoriesB: string[];
  comment?: string;
  judgedAt: string;
}

export interface PrivateEvalBlindPair {
  pairId: string;
  segmentId: string;
  source: string;
  candidateA: string;
  candidateB: string;
  referenceTarget?: string;
  reviewedTarget?: string;
  customerReturnTarget?: string;
  riskTypes: PrivateEvalSegment["riskTypes"];
  tmRefs: string[];
  termRefs: string[];
  judgment?: PrivateEvalBlindJudgment;
  /** Revealed only after every pair has been judged. */
  candidateARunId?: string;
  /** Revealed only after every pair has been judged. */
  candidateBRunId?: string;
}

export interface PrivateEvalBlindReview {
  reviewId: string;
  evalSetId: string;
  seed: string;
  createdAt: string;
  total: number;
  judged: number;
  complete: boolean;
  pairs: PrivateEvalBlindPair[];
  revealedRuns?: Array<{ runId: string; mode: PrivateEvalRun["mode"]; modelRoute?: string; wins: number }>;
}

export interface PrivateEvalBlindReviewSummary {
  reviewId: string;
  evalSetId: string;
  createdAt: string;
  total: number;
  judged: number;
  complete: boolean;
}

interface StoredPrivateEvalBlindPair extends PrivateEvalBlindPair {
  candidateARunId: string;
  candidateBRunId: string;
}

interface StoredPrivateEvalBlindReview {
  reviewId: string;
  evalSetId: string;
  seed: string;
  createdAt: string;
  runIds: [string, string];
  pairs: StoredPrivateEvalBlindPair[];
}

export interface CreatePrivateEvalSetInput {
  evalSetId: string;
  label: string;
  sourceRoot: string;
  sampleSize?: number;
}

export interface PrivateEvalSetPayload {
  evalSet: PrivateEvalSet;
  segments: PrivateEvalSegment[];
}

export interface PrivateEvalRunSegmentInput {
  evalSet: PrivateEvalSet;
  run: PrivateEvalRun;
  segment: PrivateEvalSegment;
  index: number;
  total: number;
}

export type PrivateEvalSegmentRunner = (input: PrivateEvalRunSegmentInput) => Promise<Pick<PrivateEvalRunOutput, "target" | "notes" | "rawResponse" | "promptManifest" | "executionManifest" | "mechanicalQa" | "usage">>;
export interface ExecutePrivateEvalRunOptions {
  segmentLimit?: number;
  shouldStop?: () => boolean;
  onOutput?: (output: PrivateEvalRunOutput) => void | Promise<void>;
}

type SegmentSeed = { segmentId: string; source: string; referenceTarget?: string; reviewedTarget?: string; customerReturnTarget?: string; tags?: string[] };
type TargetLookup = { byId: Map<string, string>; bySource: Map<string, string> };
type BilingualRef = { source: string; target: string; ref: string };

const RISK_SAMPLE_ORDER: PrivateEvalSegment["riskTypes"][number][] = [
  "ui",
  "placeholder",
  "tag",
  "number",
  "terminology",
  "flavor",
  "style",
  "omission",
];

const SOURCE_ONLY_SOURCE_HEADERS = ["source", "src", "cn", "zh", "chinese", "中文", "原文", "源文", "简中"];
const SOURCE_ONLY_TARGET_HEADERS = ["target", "tgt", "en", "english", "translation", "英文", "译文"];
const SOURCE_ONLY_ID_HEADERS = ["id", "key", "segmentid", "segment_id", "编号", "键"];

function privateEvalId(value: string, label: string): string {
  const clean = value.trim();
  if (!clean || clean !== value || clean !== basename(clean) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(clean)) {
    throw new Error(`${label} must be a path-free identifier.`);
  }
  return clean;
}

function evalRoot(workspaceRoot: string, evalSetId: string): string {
  return join(workspaceRoot, "data", "evals", "private", privateEvalId(evalSetId, "Private Eval set id"));
}

function evalRunRoot(workspaceRoot: string, evalSetId: string, runId: string): string {
  return join(evalRoot(workspaceRoot, evalSetId), "runs", privateEvalId(runId, "Private Eval run id"));
}

function evalSetsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "data", "evals", "private");
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  await walk(root);
  return out;
}

function inferRiskTypes(source: string, tags: string[]): PrivateEvalSegment["riskTypes"] {
  const risks = new Set<PrivateEvalSegment["riskTypes"][number]>();
  if (tags.some((tag) => /ui/i.test(tag)) || source.length <= 8) risks.add("ui");
  if (tags.some((tag) => /flavor|story|dialog/i.test(tag)) || /[。！？]/.test(source)) risks.add("flavor");
  if (tags.some((tag) => /term|tb|glossary|术语/i.test(tag))) risks.add("terminology");
  if (tags.some((tag) => /style|voice|风格/i.test(tag))) risks.add("style");
  if (tags.some((tag) => /return|review|omission|missing|返修|审校|漏/i.test(tag))) risks.add("omission");
  if (/\{[^}]+\}|%[sdif]|\$\w+/.test(source)) risks.add("placeholder");
  if (/<[^>]+>|\[[A-Za-z/-][^\]]*\]/.test(source)) risks.add("tag");
  if (/\d/.test(source)) risks.add("number");
  return Array.from(risks);
}

function findHeader(headers: string[], aliases: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  return normalized.findIndex((header) => aliases.includes(header));
}

function bilingualSheetRows(sheet: WorkbookRows): { sourceIndex: number; targetIndex: number; rows: Array<{ row: string[]; rowNo: number }> } | undefined {
  const sourceIndex = findHeader(sheet.headers, SOURCE_ONLY_SOURCE_HEADERS);
  const targetIndex = findHeader(sheet.headers, SOURCE_ONLY_TARGET_HEADERS);
  if (sourceIndex >= 0 && targetIndex >= 0) {
    return { sourceIndex, targetIndex, rows: sheet.rows.map((row, index) => ({ row, rowNo: index + 2 })) };
  }
  const [first, second] = sheet.headers;
  const cjk = (value: string): boolean => /[\u3400-\u9fff]/.test(value);
  const latin = (value: string): boolean => /[A-Za-z]/.test(value);
  if (!first?.trim() || !second?.trim() || !((cjk(first) && latin(second)) || (latin(first) && cjk(second)))) return undefined;
  return {
    sourceIndex: 0,
    targetIndex: 1,
    rows: [{ row: sheet.headers, rowNo: 1 }, ...sheet.rows.map((row, index) => ({ row, rowNo: index + 2 }))],
  };
}

async function loadSourceOnlyWorkbookSeeds(filePath: string): Promise<SegmentSeed[]> {
  const sheets = await readWorkbookRows(filePath);
  const fileLabel = basename(filePath, extname(filePath));
  const seeds: SegmentSeed[] = [];
  for (const sheet of sheets) {
    const sourceIndex = findHeader(sheet.headers, SOURCE_ONLY_SOURCE_HEADERS);
    const targetIndex = findHeader(sheet.headers, SOURCE_ONLY_TARGET_HEADERS);
    const idIndex = findHeader(sheet.headers, SOURCE_ONLY_ID_HEADERS);
    const sourceColumn = sourceIndex >= 0 ? sourceIndex : 0;
    for (const [index, row] of sheet.rows.entries()) {
      const source = (row[sourceColumn] ?? "").trim();
      if (!source) continue;
      const explicitId = idIndex >= 0 ? (row[idIndex] ?? "").trim() : "";
      seeds.push({
        segmentId: explicitId || `${fileLabel}:${sheet.sheetName}:${index + 2}`,
        source,
        referenceTarget: targetIndex >= 0 ? (row[targetIndex] ?? "").trim() || undefined : undefined,
        tags: [`sheet:${sheet.sheetName}`],
      });
    }
  }
  if (!seeds.length) throw new Error(`No source rows found in workbook ${filePath}.`);
  return seeds;
}

async function loadSegmentSeeds(sourceRoot: string): Promise<SegmentSeed[]> {
  try {
    return JSON.parse(await readFile(join(sourceRoot, "segments.json"), "utf8")) as SegmentSeed[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const files = await walkFiles(sourceRoot);
  const xlsx = files.find((path) => /待翻译文本/.test(path) && extname(path).toLowerCase() === ".xlsx") ?? files.find((path) => extname(path).toLowerCase() === ".xlsx");
  if (!xlsx) throw new Error(`No segments.json or readable XLSX found under ${sourceRoot}.`);
  try {
    const { rows } = await readXlsxBatchRows(xlsx);
    return rows.map((row) => ({
      segmentId: row.id,
      source: row.source,
      referenceTarget: row.target || undefined,
      tags: [row.note, row.state].filter((value): value is string => Boolean(value)),
    }));
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes("expected SegmentID/Source/Target columns")) throw error;
    return loadSourceOnlyWorkbookSeeds(xlsx);
  }
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

function sampleSegments(segments: PrivateEvalSegment[], sampleSize: number): PrivateEvalSegment[] {
  const selected = new Map<string, PrivateEvalSegment>();
  const add = (segment: PrivateEvalSegment): void => {
    if (selected.size < sampleSize) selected.set(segment.segmentId, segment);
  };
  for (const risk of RISK_SAMPLE_ORDER) {
    const segment = segments.find((candidate) => candidate.riskTypes.includes(risk) && !selected.has(candidate.segmentId));
    if (segment) add(segment);
    if (selected.size >= sampleSize) break;
  }
  for (const segment of segments) {
    add(segment);
    if (selected.size >= sampleSize) break;
  }
  return Array.from(selected.values());
}

function emptyTargetLookup(): TargetLookup {
  return { byId: new Map(), bySource: new Map() };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function loadTargetLookup(paths: string[]): Promise<TargetLookup> {
  const lookup = emptyTargetLookup();
  for (const path of paths) {
    try {
      const { rows } = await readXlsxBatchRows(path);
      for (const row of rows) {
        const target = row.target.trim();
        if (!target) continue;
        lookup.byId.set(row.id, target);
        const source = normalizedText(row.source);
        if (source && !lookup.bySource.has(source)) lookup.bySource.set(source, target);
      }
      continue;
    } catch {
      // A reviewed/reference workbook may be a simple CN/EN table without a
      // SegmentID. Keep the strict CAT batch importer unchanged and align this
      // Eval-only evidence by source instead.
    }
    try {
      for (const sheet of await readWorkbookRows(path)) {
        const bilingual = bilingualSheetRows(sheet);
        if (!bilingual) continue;
        for (const { row } of bilingual.rows) {
          const source = normalizedText(row[bilingual.sourceIndex] ?? "");
          const target = (row[bilingual.targetIndex] ?? "").trim();
          if (source && target && !lookup.bySource.has(source)) lookup.bySource.set(source, target);
        }
      }
    } catch {
      // ponytail: optional Eval evidence remains best-effort; the asset path is
      // still retained for audit when a workbook cannot be read.
    }
  }
  return lookup;
}

function targetForSeed(seed: SegmentSeed, lookup: TargetLookup): string | undefined {
  return lookup.byId.get(seed.segmentId) ?? lookup.bySource.get(normalizedText(seed.source));
}

async function loadBilingualRefs(sourceRoot: string, paths: string[]): Promise<BilingualRef[]> {
  const refs: BilingualRef[] = [];
  for (const path of paths) {
    try {
      for (const sheet of await readWorkbookRows(path)) {
        const bilingual = bilingualSheetRows(sheet);
        if (!bilingual) continue;
        for (const { row, rowNo } of bilingual.rows) {
          const source = normalizedText(row[bilingual.sourceIndex] ?? "");
          const target = (row[bilingual.targetIndex] ?? "").trim();
          if (!source || !target) continue;
          refs.push({ source, target, ref: `${relative(sourceRoot, path)}:${sheet.sheetName}:${rowNo}` });
        }
      }
    } catch {
      // ponytail: raw eval should not fail just because one optional evidence table is odd.
    }
  }
  return refs;
}

function tmRefsForSeed(seed: SegmentSeed, refs: BilingualRef[]): string[] {
  const source = normalizedText(seed.source);
  return refs.filter((row) => row.source === source).map((row) => `${row.ref} => ${row.target}`);
}

function termRefsForSeed(seed: SegmentSeed, refs: BilingualRef[]): string[] {
  const source = normalizedText(seed.source);
  return refs.filter((row) => source.includes(row.source)).map((row) => `${row.ref} => ${row.source}=${row.target}`);
}

function relativeAssetTokens(sourceRoot: string, path: string): string[] {
  return relative(sourceRoot, path)
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.replace(/\.[^.]+$/, "").trim().toLocaleLowerCase())
    .filter(Boolean);
}

function compactAssetToken(value: string): string {
  return value.replace(/[\s_.-]+/g, "");
}

function isTmAsset(sourceRoot: string, path: string): boolean {
  return relativeAssetTokens(sourceRoot, path).some((part) => {
    const compact = compactAssetToken(part);
    return compact === "tm" || compact === "translationmemory" || compact === "localizationtext";
  });
}

function isTermAsset(sourceRoot: string, path: string): boolean {
  return relativeAssetTokens(sourceRoot, path).some((part) => {
    const compact = compactAssetToken(part);
    return part === "术语" || ["term", "terms", "termbase", "glossary", "tb"].includes(compact);
  });
}

function isCustomerReturnAsset(sourceRoot: string, path: string): boolean {
  return relativeAssetTokens(sourceRoot, path).some((part) => /客户审校|返修|return/i.test(part));
}

function isReviewedAsset(sourceRoot: string, path: string): boolean {
  return relativeAssetTokens(sourceRoot, path).some((part) => /已完成|translated|reviewed/i.test(part));
}

export async function createPrivateEvalSet(workspaceRoot: string, input: CreatePrivateEvalSetInput): Promise<PrivateEvalSetPayload> {
  const root = evalRoot(workspaceRoot, input.evalSetId);
  const [assetPaths, seeds] = await Promise.all([walkFiles(input.sourceRoot), loadSegmentSeeds(input.sourceRoot)]);
  const xlsxAssetPaths = assetPaths.filter((path) => extname(path).toLowerCase() === ".xlsx");
  const customerReturnLookup = await loadTargetLookup(xlsxAssetPaths.filter((path) => isCustomerReturnAsset(input.sourceRoot, path)));
  const reviewedLookup = await loadTargetLookup(xlsxAssetPaths.filter((path) => isReviewedAsset(input.sourceRoot, path) && !isCustomerReturnAsset(input.sourceRoot, path)));
  const tmRefs = await loadBilingualRefs(input.sourceRoot, xlsxAssetPaths.filter((path) => isTmAsset(input.sourceRoot, path)));
  const termRefs = await loadBilingualRefs(input.sourceRoot, xlsxAssetPaths.filter((path) => isTermAsset(input.sourceRoot, path)));
  const allSegments: PrivateEvalSegment[] = seeds.map((seed) => {
    const tags = seed.tags ?? [];
    return {
      evalSetId: input.evalSetId,
      segmentId: seed.segmentId,
      source: seed.source,
      referenceTarget: seed.referenceTarget,
      reviewedTarget: seed.reviewedTarget ?? targetForSeed(seed, reviewedLookup),
      customerReturnTarget: seed.customerReturnTarget ?? targetForSeed(seed, customerReturnLookup),
      tags,
      riskTypes: inferRiskTypes(seed.source, tags),
      assetRefs: assetPaths.map((path) => relative(input.sourceRoot, path)),
      tmRefs: tmRefsForSeed(seed, tmRefs),
      termRefs: termRefsForSeed(seed, termRefs),
    };
  });
  const segments = sampleSegments(allSegments, Math.min(input.sampleSize ?? 120, allSegments.length));
  const evalSet: PrivateEvalSet = {
    evalSetId: input.evalSetId,
    label: input.label,
    sourceRoot: input.sourceRoot,
    createdAt: new Date().toISOString(),
    assetPaths,
    segmentCount: segments.length,
    rubricPath: join(root, "rubric.json"),
  };
  await mkdir(root, { recursive: true });
  await writeJsonFile(join(root, "eval_set.json"), evalSet);
  await writeJsonl(join(root, "segments.jsonl"), segments);
  await writeJsonl(join(root, "references.jsonl"), segments.map((segment) => ({
    segmentId: segment.segmentId,
    referenceTarget: segment.referenceTarget,
    reviewedTarget: segment.reviewedTarget,
    customerReturnTarget: segment.customerReturnTarget,
  })));
  await writeJsonFile(join(root, "rubric.json"), { dimensions: EVAL_DIMENSIONS });
  return { evalSet, segments };
}

export async function listPrivateEvalSets(workspaceRoot: string): Promise<PrivateEvalSet[]> {
  const root = evalSetsRoot(workspaceRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonFile<PrivateEvalSet | null>(join(root, entry.name, "eval_set.json"), null)));
  return rows.filter((row): row is PrivateEvalSet => Boolean(row)).sort((a, b) => a.evalSetId.localeCompare(b.evalSetId));
}

export async function readPrivateEvalSet(workspaceRoot: string, evalSetId: string): Promise<PrivateEvalSetPayload> {
  const root = evalRoot(workspaceRoot, evalSetId);
  const segments = await readJsonlFile<PrivateEvalSegment>(join(root, "segments.jsonl"));
  return {
    evalSet: await readJsonFile<PrivateEvalSet>(join(root, "eval_set.json"), {
      evalSetId,
      label: evalSetId,
      sourceRoot: "",
      createdAt: "",
      assetPaths: [],
      segmentCount: 0,
      rubricPath: join(root, "rubric.json"),
    }),
    // Older durable eval sets predate the optional evidence arrays. Normalize
    // them at the storage boundary so every runner receives one stable shape.
    segments: segments.map((segment) => ({
      ...segment,
      tags: Array.isArray(segment.tags) ? segment.tags : [],
      riskTypes: Array.isArray(segment.riskTypes) ? segment.riskTypes : [],
      assetRefs: Array.isArray(segment.assetRefs) ? segment.assetRefs : [],
      tmRefs: Array.isArray(segment.tmRefs) ? segment.tmRefs : [],
      termRefs: Array.isArray(segment.termRefs) ? segment.termRefs : [],
    })),
  };
}

export async function createPrivateEvalRun(workspaceRoot: string, evalSetId: string, input: Pick<PrivateEvalRun, "mode" | "modelRoutes" | "projectId" | "taskId" | "segmentCount" | "thinkingLevel" | "resumedFromRunId"> & { runId?: string }): Promise<PrivateEvalRun> {
  const run: PrivateEvalRun = {
    runId: input.runId ?? `eval-run-${randomUUID()}`,
    evalSetId,
    projectId: input.projectId,
    taskId: input.taskId,
    segmentCount: input.segmentCount,
    mode: input.mode,
    modelRoutes: input.modelRoutes,
    thinkingLevel: input.thinkingLevel ?? DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
    resumedFromRunId: input.resumedFromRunId,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  const runsRoot = join(evalRoot(workspaceRoot, evalSetId), "runs");
  const runRoot = evalRunRoot(workspaceRoot, evalSetId, run.runId);
  await mkdir(runsRoot, { recursive: true });
  try {
    await mkdir(runRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Private Eval run already exists: ${run.runId}`);
    throw error;
  }
  await writeJsonFile(join(runRoot, "run.json"), run);
  return run;
}

export async function readPrivateEvalRun(workspaceRoot: string, evalSetId: string, runId: string): Promise<PrivateEvalRun> {
  return readJsonFile<PrivateEvalRun>(join(evalRunRoot(workspaceRoot, evalSetId, runId), "run.json"), {
    runId,
    evalSetId,
    mode: "single_agent",
    modelRoutes: {},
    startedAt: "",
    status: "failed",
  });
}

export async function updatePrivateEvalRun(workspaceRoot: string, run: PrivateEvalRun): Promise<PrivateEvalRun> {
  await writeJsonFile(join(evalRunRoot(workspaceRoot, run.evalSetId, run.runId), "run.json"), run);
  return run;
}

export async function listPrivateEvalRuns(workspaceRoot: string, evalSetId: string): Promise<PrivateEvalRun[]> {
  const runsRoot = join(evalRoot(workspaceRoot, evalSetId), "runs");
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonFile<PrivateEvalRun | null>(join(runsRoot, entry.name, "run.json"), null)));
  return rows
    .filter((row): row is PrivateEvalRun => Boolean(row))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function readPrivateEvalRunOutputs(workspaceRoot: string, evalSetId: string, runId: string): Promise<PrivateEvalRunOutput[]> {
  return readJsonlFile<PrivateEvalRunOutput>(join(evalRunRoot(workspaceRoot, evalSetId, runId), "outputs.jsonl"));
}

async function writePrivateEvalRunOutputs(workspaceRoot: string, evalSetId: string, runId: string, outputs: PrivateEvalRunOutput[]): Promise<void> {
  await writeJsonl(join(evalRunRoot(workspaceRoot, evalSetId, runId), "outputs.jsonl"), outputs);
}

/**
 * Seed a fresh server-owned attempt from a terminal run's completed rows.
 * The source run remains immutable; copied rows are re-owned by the new run so
 * comparison, usage, Stop, and Task projection all have one truthful owner.
 */
export async function seedPrivateEvalRunFromCheckpoint(
  workspaceRoot: string,
  evalSetId: string,
  targetRunId: string,
  sourceRunId: string,
): Promise<PrivateEvalRunOutput[]> {
  if (targetRunId === sourceRunId) throw new Error("Private Eval checkpoint source and target runs must differ.");
  const [target, source, existing, sourceOutputs] = await Promise.all([
    readPrivateEvalRun(workspaceRoot, evalSetId, targetRunId),
    readPrivateEvalRun(workspaceRoot, evalSetId, sourceRunId),
    readPrivateEvalRunOutputs(workspaceRoot, evalSetId, targetRunId),
    readPrivateEvalRunOutputs(workspaceRoot, evalSetId, sourceRunId),
  ]);
  if (existing.length) throw new Error(`Private Eval run ${targetRunId} already has outputs and cannot be checkpoint-seeded.`);
  if (!["failed", "stopped"].includes(source.status)) throw new Error(`Private Eval checkpoint source ${sourceRunId} must be failed or stopped.`);
  if (target.mode !== source.mode) throw new Error("Private Eval checkpoint mode does not match the new run.");
  if (!target.projectId || !target.taskId || target.projectId !== source.projectId || target.taskId !== source.taskId) {
    throw new Error("Private Eval checkpoint requires the same canonical project and Task scope.");
  }
  if (target.segmentCount === undefined || target.segmentCount !== source.segmentCount) {
    throw new Error("Private Eval checkpoint requires the same explicit segment count.");
  }
  const routes = (value: Record<string, string>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  if (routes(target.modelRoutes) !== routes(source.modelRoutes) || target.thinkingLevel !== source.thinkingLevel) {
    throw new Error("Private Eval checkpoint requires the same model routes and thinking level.");
  }
  if (target.resumedFromRunId !== sourceRunId) throw new Error("Private Eval run does not declare the requested checkpoint source.");
  const copied = sourceOutputs
    .filter((output) => output.status === "completed")
    .map((output) => ({ ...output, runId: targetRunId, evalSetId, mode: target.mode }));
  if (copied.length) await writePrivateEvalRunOutputs(workspaceRoot, evalSetId, targetRunId, copied);
  return copied;
}

export function summarizePrivateEvalOutputUsage(outputs: PrivateEvalRunOutput[]): PrivateEvalUsage | undefined {
  const rows = outputs.map((output) => output.usage).filter((usage): usage is PrivateEvalUsage => Boolean(usage));
  if (!rows.length) return undefined;
  const cacheReadTokens = rows.some((usage) => usage.cacheReadTokens !== undefined)
    ? rows.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0)
    : undefined;
  const cacheWriteTokens = rows.some((usage) => usage.cacheWriteTokens !== undefined)
    ? rows.reduce((sum, usage) => sum + (usage.cacheWriteTokens ?? 0), 0)
    : undefined;
  return {
    inputTokens: rows.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    outputTokens: rows.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0),
    totalTokens: rows.reduce((sum, usage) => sum + (usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))), 0),
    costUsd: rows.every((usage) => usage.costUsd !== undefined)
      ? rows.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0)
      : undefined,
    modelCalls: rows.reduce((sum, usage) => sum + (usage.modelCalls ?? 1), 0),
  };
}

export async function executePrivateEvalRun(
  workspaceRoot: string,
  evalSetId: string,
  runId: string,
  runner: PrivateEvalSegmentRunner,
  options: ExecutePrivateEvalRunOptions = {},
): Promise<{ run: PrivateEvalRun; outputs: PrivateEvalRunOutput[] }> {
  const payload = await readPrivateEvalSet(workspaceRoot, evalSetId);
  let run = await readPrivateEvalRun(workspaceRoot, evalSetId, runId);
  run = await updatePrivateEvalRun(workspaceRoot, { ...run, status: "running", completedAt: undefined, error: undefined });
  const segments = payload.segments.slice(0, options.segmentLimit ?? payload.segments.length);
  const persisted = await readPrivateEvalRunOutputs(workspaceRoot, evalSetId, runId);
  const completedIds = new Set(persisted.filter((output) => output.status === "completed").map((output) => output.segmentId));
  const outputs = persisted.filter((output) => completedIds.has(output.segmentId));
  const stopRun = async (): Promise<{ run: PrivateEvalRun; outputs: PrivateEvalRunOutput[] }> => {
    const stopped = await updatePrivateEvalRun(workspaceRoot, { ...run, usage: summarizePrivateEvalOutputUsage(outputs), status: "stopped", completedAt: new Date().toISOString(), error: undefined });
    if (outputs.length) await writePrivateEvalRunOutputs(workspaceRoot, evalSetId, runId, outputs);
    return { run: stopped, outputs };
  };
  try {
    for (const [index, segment] of segments.entries()) {
      if (completedIds.has(segment.segmentId)) continue;
      if (options.shouldStop?.()) return stopRun();
      const result = await runner({ evalSet: payload.evalSet, run, segment, index, total: segments.length });
      // Stop may arrive while a provider/subagent call is unwinding. Never
      // persist that in-flight candidate as completed after the user stopped.
      if (options.shouldStop?.()) return stopRun();
      outputs.push({
        runId,
        evalSetId,
        segmentId: segment.segmentId,
        mode: run.mode,
        source: segment.source,
        target: result.target,
        notes: result.notes,
        rawResponse: result.rawResponse,
        promptManifest: result.promptManifest,
        executionManifest: result.executionManifest,
        mechanicalQa: result.mechanicalQa,
        usage: result.usage,
        status: "completed",
      });
      completedIds.add(segment.segmentId);
      await writePrivateEvalRunOutputs(workspaceRoot, evalSetId, runId, outputs);
      await options.onOutput?.(outputs.at(-1)!);
      if (options.shouldStop?.()) return stopRun();
    }
    run = await updatePrivateEvalRun(workspaceRoot, { ...run, usage: summarizePrivateEvalOutputUsage(outputs), status: "completed", completedAt: new Date().toISOString(), error: undefined });
    return { run, outputs };
  } catch (error) {
    if (options.shouldStop?.()) return stopRun();
    const failed = {
      ...run,
      usage: summarizePrivateEvalOutputUsage(outputs),
      error: error instanceof Error ? error.message : String(error),
      status: "failed" as const,
      completedAt: new Date().toISOString(),
    };
    await updatePrivateEvalRun(workspaceRoot, failed);
    if (outputs.length) await writePrivateEvalRunOutputs(workspaceRoot, evalSetId, runId, outputs);
    throw error;
  }
}

export async function writeHumanScorecard(workspaceRoot: string, evalSetId: string, runId: string, rows: HumanScoreRow[]): Promise<string> {
  const path = join(evalRoot(workspaceRoot, evalSetId), "scorecards", `${privateEvalId(runId, "Private Eval run id")}.jsonl`);
  const cleanRows = rows.map((row) => {
    if (row.runId !== runId) throw new Error("Scorecard row runId does not match the requested run.");
    if (!row.segmentId?.trim()) throw new Error("Scorecard row requires segmentId.");
    if (!EVAL_DIMENSIONS.includes(row.dimension)) throw new Error(`Unsupported eval dimension: ${row.dimension}`);
    if (!Number.isInteger(row.score) || row.score < 1 || row.score > 5) throw new Error("Scorecard score must be an integer from 1 to 5.");
    if (row.judge !== "human:reviewer") throw new Error("Scorecard judge must be human:reviewer.");
    if (!["OK", "A", "B", "C"].includes(row.issueTier)) throw new Error(`Unsupported issue tier: ${row.issueTier}`);
    if (!Array.isArray(row.issueCategories) || row.issueCategories.some((value) => typeof value !== "string")) throw new Error("Scorecard issueCategories must be strings.");
    if (row.accepted !== undefined && typeof row.accepted !== "boolean") throw new Error("Scorecard accepted must be boolean.");
    if (row.comment !== undefined && typeof row.comment !== "string") throw new Error("Scorecard comment must be a string.");
    return { ...row, segmentId: row.segmentId.trim() };
  });
  const merged = new Map((await readHumanScorecard(workspaceRoot, evalSetId, runId))
    .map((row) => [`${row.segmentId}\0${row.dimension}`, row] as const));
  for (const row of cleanRows) merged.set(`${row.segmentId}\0${row.dimension}`, row);
  await writeJsonl(path, Array.from(merged.values()));
  return path;
}

export async function readHumanScorecard(workspaceRoot: string, evalSetId: string, runId: string): Promise<HumanScoreRow[]> {
  return readJsonlFile<HumanScoreRow>(join(evalRoot(workspaceRoot, evalSetId), "scorecards", `${privateEvalId(runId, "Private Eval run id")}.jsonl`));
}

function blindReviewDirectory(workspaceRoot: string, evalSetId: string): string {
  return join(evalRoot(workspaceRoot, evalSetId), "blind_reviews");
}

function blindReviewPath(workspaceRoot: string, evalSetId: string, reviewId: string): string {
  const clean = reviewId.trim();
  if (!clean || clean !== basename(clean) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(clean)) {
    throw new Error("Blind review id must be a path-free identifier.");
  }
  return join(blindReviewDirectory(workspaceRoot, evalSetId), `${clean}.json`);
}

const blindReviewMutationQueues = new Map<string, Promise<void>>();

async function withBlindReviewMutationLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = blindReviewMutationQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate, () => gate);
  blindReviewMutationQueues.set(path, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (blindReviewMutationQueues.get(path) === queued) blindReviewMutationQueues.delete(path);
  }
}

function blindHash(seed: string, value: string): string {
  return createHash("sha256").update(`${seed}\0${value}`).digest("hex");
}

function summarizeBlindReview(stored: StoredPrivateEvalBlindReview): PrivateEvalBlindReviewSummary {
  const judged = stored.pairs.filter((pair) => pair.judgment).length;
  return {
    reviewId: stored.reviewId,
    evalSetId: stored.evalSetId,
    createdAt: stored.createdAt,
    total: stored.pairs.length,
    judged,
    complete: stored.pairs.length > 0 && judged === stored.pairs.length,
  };
}

export async function listPrivateEvalBlindReviews(workspaceRoot: string, evalSetId: string): Promise<PrivateEvalBlindReviewSummary[]> {
  let files: string[];
  try {
    files = (await readdir(blindReviewDirectory(workspaceRoot, evalSetId))).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const summaries = await Promise.all(files.map(async (file) => {
    const stored = await readJsonFile<StoredPrivateEvalBlindReview | null>(join(blindReviewDirectory(workspaceRoot, evalSetId), file), null);
    if (!stored) throw new Error(`Blind review file is empty: ${file}`);
    if (stored.evalSetId !== evalSetId) throw new Error(`Blind review ${stored.reviewId} belongs to ${stored.evalSetId}, not ${evalSetId}.`);
    return summarizeBlindReview(stored);
  }));
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.reviewId.localeCompare(b.reviewId));
}

async function presentBlindReview(workspaceRoot: string, stored: StoredPrivateEvalBlindReview): Promise<PrivateEvalBlindReview> {
  const summary = summarizeBlindReview(stored);
  const { judged, complete } = summary;
  const runs = complete ? await Promise.all(stored.runIds.map((runId) => readPrivateEvalRun(workspaceRoot, stored.evalSetId, runId))) : [];
  const wins = new Map(stored.runIds.map((runId) => [runId, 0]));
  if (complete) {
    for (const pair of stored.pairs) {
      const winner = pair.judgment?.preference === "a" ? pair.candidateARunId : pair.judgment?.preference === "b" ? pair.candidateBRunId : undefined;
      if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
  }
  return {
    reviewId: stored.reviewId,
    evalSetId: stored.evalSetId,
    seed: stored.seed,
    createdAt: stored.createdAt,
    total: stored.pairs.length,
    judged,
    complete,
    pairs: stored.pairs.map(({ candidateARunId, candidateBRunId, ...pair }) => ({
      ...pair,
      ...(complete ? { candidateARunId, candidateBRunId } : {}),
    })),
    revealedRuns: complete ? runs.map((run) => ({ runId: run.runId, mode: run.mode, modelRoute: run.modelRoutes.default, wins: wins.get(run.runId) ?? 0 })) : undefined,
  };
}

export async function createPrivateEvalBlindReview(workspaceRoot: string, evalSetId: string, input: {
  runIds: [string, string];
  seed: string;
  sampleSize?: number;
  reviewId?: string;
}): Promise<PrivateEvalBlindReview> {
  const [leftId, rightId] = input.runIds;
  if (!leftId?.trim() || !rightId?.trim() || leftId === rightId) throw new Error("Blind review requires two distinct run ids.");
  const seed = input.seed.trim();
  if (!seed) throw new Error("Blind review requires a non-empty seed.");
  const [leftRun, rightRun, payload, leftOutputs, rightOutputs] = await Promise.all([
    readPrivateEvalRun(workspaceRoot, evalSetId, leftId),
    readPrivateEvalRun(workspaceRoot, evalSetId, rightId),
    readPrivateEvalSet(workspaceRoot, evalSetId),
    readPrivateEvalRunOutputs(workspaceRoot, evalSetId, leftId),
    readPrivateEvalRunOutputs(workspaceRoot, evalSetId, rightId),
  ]);
  if (leftRun.status !== "completed" || rightRun.status !== "completed") throw new Error("Blind review requires two completed runs.");
  if (new Set([leftRun.mode, rightRun.mode]).size !== 2) throw new Error("Blind review requires one Single run and one Team run.");
  if (!leftRun.projectId || !leftRun.taskId || leftRun.projectId !== rightRun.projectId || leftRun.taskId !== rightRun.taskId) {
    throw new Error("Blind review runs must share the same canonical project and Eval Task scope.");
  }
  const leftBySegment = new Map(leftOutputs.filter((row) => row.status === "completed" && row.target).map((row) => [row.segmentId, row.target!]));
  const rightBySegment = new Map(rightOutputs.filter((row) => row.status === "completed" && row.target).map((row) => [row.segmentId, row.target!]));
  const common = payload.segments
    .filter((segment) => leftBySegment.has(segment.segmentId) && rightBySegment.has(segment.segmentId))
    .sort((a, b) => blindHash(seed, a.segmentId).localeCompare(blindHash(seed, b.segmentId)));
  const sampleSize = input.sampleSize === undefined ? common.length : Math.min(common.length, Math.max(1, Math.floor(input.sampleSize)));
  if (!common.length) throw new Error("Blind review runs have no completed segments in common.");
  const digest = blindHash(seed, [...input.runIds].sort().join("\0")).slice(0, 16);
  const reviewId = input.reviewId?.trim() || `blind-${digest}-${sampleSize}`;
  const path = blindReviewPath(workspaceRoot, evalSetId, reviewId);
  const pairs: StoredPrivateEvalBlindPair[] = common.slice(0, sampleSize).map((segment) => {
    const swap = Number.parseInt(blindHash(seed, `${segment.segmentId}\0candidate-order`).slice(0, 2), 16) % 2 === 1;
    return {
      pairId: `pair-${blindHash(reviewId, segment.segmentId).slice(0, 16)}`,
      segmentId: segment.segmentId,
      source: segment.source,
      candidateA: swap ? rightBySegment.get(segment.segmentId)! : leftBySegment.get(segment.segmentId)!,
      candidateB: swap ? leftBySegment.get(segment.segmentId)! : rightBySegment.get(segment.segmentId)!,
      candidateARunId: swap ? rightId : leftId,
      candidateBRunId: swap ? leftId : rightId,
      referenceTarget: segment.referenceTarget,
      reviewedTarget: segment.reviewedTarget,
      customerReturnTarget: segment.customerReturnTarget,
      riskTypes: [...segment.riskTypes],
      tmRefs: [...segment.tmRefs],
      termRefs: [...segment.termRefs],
    };
  });
  const stored: StoredPrivateEvalBlindReview = { reviewId, evalSetId, seed, createdAt: new Date().toISOString(), runIds: [leftId, rightId], pairs };
  return withBlindReviewMutationLock(path, async () => {
    const existing = await readJsonFile<StoredPrivateEvalBlindReview | null>(path, null);
    if (existing) {
      if (
        existing.seed !== seed
        || existing.pairs.length !== sampleSize
        || [...existing.runIds].sort().join("\0") !== [...input.runIds].sort().join("\0")
      ) {
        throw new Error(`Blind review ${reviewId} already exists with different inputs.`);
      }
      return presentBlindReview(workspaceRoot, existing);
    }
    await writeJsonFile(path, stored);
    return presentBlindReview(workspaceRoot, await readJsonFile(path, stored));
  });
}

export async function readPrivateEvalBlindReview(workspaceRoot: string, evalSetId: string, reviewId: string): Promise<PrivateEvalBlindReview> {
  const stored = await readJsonFile<StoredPrivateEvalBlindReview | null>(blindReviewPath(workspaceRoot, evalSetId, reviewId), null);
  if (!stored) throw new Error(`Blind review not found: ${reviewId}`);
  return presentBlindReview(workspaceRoot, stored);
}

export async function readPrivateEvalBlindReviewRunIds(workspaceRoot: string, evalSetId: string, reviewId: string): Promise<[string, string]> {
  const stored = await readJsonFile<StoredPrivateEvalBlindReview | null>(blindReviewPath(workspaceRoot, evalSetId, reviewId), null);
  if (!stored) throw new Error(`Blind review not found: ${reviewId}`);
  return stored.runIds;
}

export async function writePrivateEvalBlindJudgments(workspaceRoot: string, evalSetId: string, reviewId: string, rows: Array<Omit<PrivateEvalBlindJudgment, "judgedAt"> & { judgedAt?: string }>): Promise<PrivateEvalBlindReview> {
  const path = blindReviewPath(workspaceRoot, evalSetId, reviewId);
  return withBlindReviewMutationLock(path, async () => {
    const stored = await readJsonFile<StoredPrivateEvalBlindReview | null>(path, null);
    if (!stored) throw new Error(`Blind review not found: ${reviewId}`);
    const pairs = new Map(stored.pairs.map((pair) => [pair.pairId, pair]));
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.pairId !== "string") throw new Error("Blind review judgment requires a pairId.");
      const pair = pairs.get(row.pairId);
      if (!pair) throw new Error(`Unknown blind review pair: ${row.pairId}`);
      if (!["a", "b", "tie", "both_fail"].includes(row.preference)) throw new Error(`Unsupported blind preference: ${row.preference}`);
      if (!["OK", "A", "B", "C"].includes(row.issueTierA) || !["OK", "A", "B", "C"].includes(row.issueTierB)) throw new Error("Blind review issue tiers must be OK, A, B, or C.");
      if (!Array.isArray(row.issueCategoriesA) || !Array.isArray(row.issueCategoriesB) || [...row.issueCategoriesA, ...row.issueCategoriesB].some((value) => typeof value !== "string")) {
        throw new Error("Blind review issue categories must be strings.");
      }
      if (row.comment !== undefined && typeof row.comment !== "string") throw new Error("Blind review comment must be a string.");
      pair.judgment = { ...row, comment: row.comment?.trim() || undefined, judgedAt: new Date().toISOString() };
    }
    await writeJsonFile(path, stored);
    return presentBlindReview(workspaceRoot, stored);
  });
}

function durationMs(startedAt: string, completedAt?: string): number | undefined {
  if (!startedAt || !completedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatUsage(run: PrivateEvalRun): string {
  if (!run.usage) return "-";
  const tokens = run.usage.totalTokens ?? ((run.usage.inputTokens ?? 0) + (run.usage.outputTokens ?? 0));
  const cost = run.usage.costUsd === undefined ? "cost unknown" : `$${run.usage.costUsd.toFixed(4)}`;
  return `${tokens} tokens, ${cost}`;
}

export async function renderPrivateEvalComparison(workspaceRoot: string, evalSetId: string, comparisonId = `comparison-${randomUUID()}`): Promise<{ markdown: string; reportPath: string }> {
  const payload = await readPrivateEvalSet(workspaceRoot, evalSetId);
  const scorecardDir = join(evalRoot(workspaceRoot, evalSetId), "scorecards");
  const files = (await readdir(scorecardDir).catch(() => [])).filter((file) => file.endsWith(".jsonl"));
  const rows = (await Promise.all(files.map((file) => readJsonlFile<HumanScoreRow>(join(scorecardDir, file))))).flat();
  const runs = await listPrivateEvalRuns(workspaceRoot, evalSetId);
  const outputsByRun = new Map<string, PrivateEvalRunOutput[]>();
  await Promise.all(runs.map(async (run) => {
    outputsByRun.set(run.runId, await readPrivateEvalRunOutputs(workspaceRoot, evalSetId, run.runId));
  }));
  const scoreRowsByRun = new Map<string, HumanScoreRow[]>();
  for (const row of rows) scoreRowsByRun.set(row.runId, [...(scoreRowsByRun.get(row.runId) ?? []), row]);
  const average = (scoreRows: HumanScoreRow[]): string => {
    if (!scoreRows.length) return "-";
    return (scoreRows.reduce((sum, row) => sum + row.score, 0) / scoreRows.length).toFixed(2);
  };
  const countBy = (scoreRows: HumanScoreRow[], key: (row: HumanScoreRow) => string): string => {
    const counts = new Map<string, number>();
    for (const row of scoreRows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => `${label}:${count}`).join(", ") || "-";
  };
  const countStrings = (values: string[]): string => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => `${label}:${count}`).join(", ") || "-";
  };
  const acceptedSegments = (scoreRows: HumanScoreRow[]): string => {
    const judged = new Map<string, boolean[]>();
    for (const row of scoreRows) {
      if (typeof row.accepted === "boolean") judged.set(row.segmentId, [...(judged.get(row.segmentId) ?? []), row.accepted]);
    }
    if (!judged.size) return "-";
    const accepted = Array.from(judged.values()).filter((rows) => rows.every(Boolean)).length;
    return `${accepted}/${judged.size}`;
  };
  const tmRefSegmentIds = new Set(payload.segments.filter((segment) => segment.tmRefs.length).map((segment) => segment.segmentId));
  const termRefSegmentIds = new Set(payload.segments.filter((segment) => segment.termRefs.length).map((segment) => segment.segmentId));
  const evidenceOutputCoverage = (outputs: PrivateEvalRunOutput[], segmentIds: Set<string>): string => {
    if (!segmentIds.size) return "0/0";
    const completed = new Set(outputs.filter((output) => output.status === "completed").map((output) => output.segmentId));
    return `${Array.from(segmentIds).filter((segmentId) => completed.has(segmentId)).length}/${segmentIds.size}`;
  };
  const dimensionRows = Array.from(EVAL_DIMENSIONS).flatMap((dimension) => {
    const dimensionScores = rows.filter((row) => row.dimension === dimension);
    if (!dimensionScores.length) return [];
    return [`| ${dimension} | ${average(dimensionScores)} | ${dimensionScores.length} |`];
  });
  const runLines = runs.flatMap((run) => {
    const runScores = scoreRowsByRun.get(run.runId) ?? [];
    const outputs = outputsByRun.get(run.runId) ?? [];
    const completedOutputs = outputs.filter((output) => output.status === "completed").length;
    const failedOutputs = outputs.filter((output) => output.status === "failed").length;
    const executionAdapters = countStrings(outputs.map((output) => output.executionManifest?.adapter ?? "legacy_unknown"));
    const actualCalls = outputs.reduce((total, output) => total + (output.executionManifest?.actualCalls ?? 0), 0);
    const completeSegments = new Set(outputs
      .filter((output) => EVAL_DIMENSIONS.every((dimension) => runScores.some((row) => row.segmentId === output.segmentId && row.dimension === dimension)))
      .map((output) => output.segmentId));
    const okSegments = Array.from(completeSegments).filter((segmentId) => {
      const segmentScores = runScores.filter((row) => row.segmentId === segmentId);
      return segmentScores.length >= EVAL_DIMENSIONS.length && segmentScores.every((row) => row.issueTier === "OK");
    });
    return [
      `### ${run.mode} - ${run.runId}`,
      "",
      `Status: ${run.status}`,
      `Model route: ${run.modelRoutes.default ?? "-"}`,
      `Execution adapter: ${executionAdapters}`,
      `Recorded model calls: ${actualCalls || "-"}`,
      `Duration: ${formatDuration(durationMs(run.startedAt, run.completedAt))}`,
      `Token/cost: ${formatUsage(run)}`,
      `Outputs: ${outputs.length}/${payload.segments.length}`,
      `Output success: ${completedOutputs}/${outputs.length} completed, ${failedOutputs} failed`,
      `Evidence output coverage: TM ${evidenceOutputCoverage(outputs, tmRefSegmentIds)}, Term ${evidenceOutputCoverage(outputs, termRefSegmentIds)}`,
      `Fully scored outputs: ${completeSegments.size}/${outputs.length}`,
      `Human OK outputs: ${okSegments.length}/${completeSegments.size} fully scored`,
      `Human accepted outputs: ${acceptedSegments(runScores)}`,
      `Average score: ${average(runScores)}`,
      `Issue tiers: ${countBy(runScores, (row) => row.issueTier)}`,
      `Issue categories: ${countStrings(runScores.flatMap((row) => row.issueCategories))}`,
      "",
      "| Dimension | Average | Rows |",
      "|---|---:|---:|",
      ...Array.from(EVAL_DIMENSIONS).map((dimension) => {
        const scores = runScores.filter((row) => row.dimension === dimension);
        return `| ${dimension} | ${average(scores)} | ${scores.length} |`;
      }),
      "",
    ];
  });
  const lines = [
    `# Private Eval Comparison: ${payload.evalSet.label}`,
    "",
    `Eval set: ${evalSetId}`,
    `Segments: ${payload.segments.length}`,
    `Runs: ${runs.length}`,
    `Score rows: ${rows.length}`,
    "",
    "## Evidence Coverage",
    "",
    `TM ref segments: ${tmRefSegmentIds.size}/${payload.segments.length}`,
    `Term ref segments: ${termRefSegmentIds.size}/${payload.segments.length}`,
    "",
    "## Overall Dimension Averages",
    "",
    "| Dimension | Average | Rows |",
    "|---|---:|---:|",
    ...(dimensionRows.length ? dimensionRows : ["| - | - | 0 |"]),
    "",
    "## Runs",
    "",
    ...(runLines.length ? runLines : ["No runs recorded."]),
  ];
  const markdown = lines.join("\n");
  const reportPath = join(evalRoot(workspaceRoot, evalSetId), "reports", `${comparisonId}.md`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf8");
  return { markdown, reportPath };
}
