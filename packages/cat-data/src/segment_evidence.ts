import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { batchPath, readBatch, type BatchSegment, type CatBatch } from "./batch_workspace.js";
import { lookupGlossary, type GlossaryMatch } from "./glossary.js";
import { lookupTermbase, type TermbaseMatch } from "./termbase.js";
import { createTmStore, effectiveTmAuthority, type JsonTmStore, type TmMatch } from "./tm.js";
import { createWorkspace } from "./workspace.js";

interface EvidenceBatchCacheEntry {
  signature: string;
  batch: CatBatch;
}

const EVIDENCE_BATCH_CACHE_LIMIT = 2;
const evidenceBatchCache = new Map<string, EvidenceBatchCacheEntry>();
const evidenceBatchReads = new Map<string, Promise<CatBatch>>();

function fileSignature(info: Awaited<ReturnType<typeof stat>>): string {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
}

function rememberEvidenceBatch(key: string, entry: EvidenceBatchCacheEntry): void {
  evidenceBatchCache.delete(key);
  evidenceBatchCache.set(key, entry);
  while (evidenceBatchCache.size > EVIDENCE_BATCH_CACHE_LIMIT) {
    const oldest = evidenceBatchCache.keys().next().value as string | undefined;
    if (!oldest) break;
    evidenceBatchCache.delete(oldest);
  }
}

/**
 * Segment selection is high frequency, while a 10k-row Batch is a multi-MB
 * atomic JSON document. Re-parsing that document for every arrow-key move can
 * serialize the local runtime for hundreds of milliseconds. Keep only the two
 * most recently inspected canonical Batches and validate each hit against the
 * current inode/size/timestamps. A Batch write uses atomic rename, so a changed
 * revision cannot be mistaken for the cached object.
 */
async function readEvidenceBatch(workspaceRoot: string, projectId: string, batchId: string): Promise<CatBatch> {
  const workspace = createWorkspace(workspaceRoot, projectId);
  const path = batchPath(workspace, batchId);
  const key = path;
  const before = await stat(path);
  const signature = fileSignature(before);
  const cached = evidenceBatchCache.get(key);
  if (cached?.signature === signature) {
    rememberEvidenceBatch(key, cached);
    return cached.batch;
  }

  const readKey = `${key}\0${signature}`;
  const inFlight = evidenceBatchReads.get(readKey);
  if (inFlight) return inFlight;
  const read = (async () => {
    let expectedSignature = signature;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const batch = await readBatch(workspaceRoot, projectId, batchId);
      const committedSignature = fileSignature(await stat(path));
      if (committedSignature === expectedSignature) {
        rememberEvidenceBatch(key, { signature: committedSignature, batch });
        return batch;
      }
      expectedSignature = committedSignature;
    }
    throw new Error(`Batch ${batchId} changed repeatedly while segment evidence was loading.`);
  })();
  evidenceBatchReads.set(readKey, read);
  try {
    return await read;
  } finally {
    if (evidenceBatchReads.get(readKey) === read) evidenceBatchReads.delete(readKey);
  }
}

export type SegmentEvidenceTab = "cat" | "rules" | "refs" | "preview";

export interface SegmentEvidenceCard {
  id: string;
  tab: SegmentEvidenceTab;
  toolName: string;
  text: string;
  timestamp: string | null;
  isError: boolean;
}

export interface SegmentEvidenceSummary {
  tm: number;
  tmExact: number;
  tmFuzzy: number;
  termbase: number;
  glossary: number;
}

export interface SegmentEvidenceSnapshot {
  projectId: string;
  batchId: string;
  segmentId: string;
  source: string;
  tmMatches: TmMatch[];
  termbaseMatches: TermbaseMatch[];
  glossaryMatches: GlossaryMatch[];
  cards: SegmentEvidenceCard[];
  summary: SegmentEvidenceSummary;
}

export interface BatchEvidencePack {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  summary: SegmentEvidenceSummary & {
    totalSegments: number;
    segmentsWithEvidence: number;
    cards: number;
  };
  segments: SegmentEvidenceSnapshot[];
}

function scoreBand(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function firstLine(value: string, limit = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1)}...`;
}

function evidencePath(path: string, rowNo?: number): string {
  const file = basename(path);
  return rowNo ? `${file}:${rowNo}` : file;
}

function sourceLength(match: Pick<TmMatch | TermbaseMatch | GlossaryMatch, "source">): number {
  return match.source.trim().length;
}

function sortTmMatches(matches: TmMatch[]): TmMatch[] {
  const rank = (match: TmMatch): number => {
    switch (match.effectiveAuthority ?? effectiveTmAuthority(match)) {
      case "reviewed_tm": return 5;
      case "client_tm": return 4;
      case "imported_tm": return 3;
      case "working_tm": return 2;
      case "unknown_tm": return 1;
      default: return 0;
    }
  };
  return [...matches].sort((a, b) => b.score - a.score || rank(b) - rank(a) || sourceLength(b) - sourceLength(a) || (b.quality ?? 0) - (a.quality ?? 0));
}

function sortLexicalMatches<T extends TermbaseMatch | GlossaryMatch>(matches: T[]): T[] {
  const rank = (match: T): number => (match.matchType === "exact" ? 0 : 1);
  return [...matches].sort((a, b) => rank(a) - rank(b) || sourceLength(b) - sourceLength(a) || a.source.localeCompare(b.source));
}

function tmCard(segment: BatchSegment, matches: TmMatch[]): SegmentEvidenceCard | null {
  if (!matches.length) return null;
  const visible = sortTmMatches(matches)
    .slice(0, 5);
  const lines = [
    `Showing ${visible.length} of ${matches.length} TM match(es); use the structured tmMatches array or paged lookup for the complete set.`,
    ...visible.flatMap((match, index) => [
      `${index + 1}. ${scoreBand(match.score)} ${match.matchType} · ${match.effectiveAuthority ?? effectiveTmAuthority(match)}${match.quality ? ` · q${match.quality}` : ""}`,
      `   Source: ${firstLine(match.source)}`,
      `   Target: ${firstLine(match.target)}`,
      `   Evidence: tm:${match.id}`,
    ]),
  ];
  return {
    id: `auto-${segment.id}-tm`,
    tab: "cat",
    toolName: "tm_lookup",
    text: lines.join("\n"),
    timestamp: null,
    isError: false,
  };
}

function tmSummary(matches: TmMatch[]): Pick<SegmentEvidenceSummary, "tm" | "tmExact" | "tmFuzzy"> {
  return {
    tm: matches.length,
    tmExact: matches.filter((match) => match.matchType === "exact").length,
    tmFuzzy: matches.filter((match) => match.matchType !== "exact").length,
  };
}

function termbaseCard(segment: BatchSegment, matches: TermbaseMatch[]): SegmentEvidenceCard | null {
  if (!matches.length) return null;
  const visible = sortLexicalMatches(matches)
    .slice(0, 8);
  const lines = [
    `Showing ${visible.length} of ${matches.length} termbase match(es); use the structured termbaseMatches array or paged lookup for the complete set.`,
    ...visible.flatMap((match, index) => [
      `${index + 1}. ${match.matchType} · ${match.resolution ?? "preferred"}`,
      `   Source: ${firstLine(match.source)}`,
      `   Target: ${firstLine(match.target)}`,
      `   Evidence: termbase:${evidencePath(match.sourceFile, match.rowNo)}`,
    ]),
  ];
  return {
    id: `auto-${segment.id}-termbase`,
    tab: "cat",
    toolName: "termbase_lookup",
    text: lines.join("\n"),
    timestamp: null,
    isError: false,
  };
}

function glossaryCard(segment: BatchSegment, matches: GlossaryMatch[]): SegmentEvidenceCard | null {
  if (!matches.length) return null;
  const visible = sortLexicalMatches(matches)
    .slice(0, 8);
  const lines = [
    `Showing ${visible.length} of ${matches.length} glossary match(es); use the structured glossaryMatches array or paged lookup for the complete set.`,
    ...visible.flatMap((match, index) => [
      `${index + 1}. ${match.matchType}`,
      `   Source: ${firstLine(match.source)}`,
      `   Target: ${firstLine(match.target)}`,
      `   Evidence: glossary:${evidencePath(match.sourceFile, match.rowNo)}`,
    ]),
  ];
  return {
    id: `auto-${segment.id}-glossary`,
    tab: "rules",
    toolName: "glossary_lookup",
    text: lines.join("\n"),
    timestamp: null,
    isError: false,
  };
}

async function lookupTmForSegment(
  tmStore: JsonTmStore,
  source: string,
  options: { srcLang: string; tgtLang: string },
): Promise<TmMatch[]> {
  const base = {
    source,
    origin: "any" as const,
    threshold: 0.7,
    topK: 50,
  };
  const matches = await tmStore.lookup({ ...base, srcLang: options.srcLang, tgtLang: options.tgtLang });
  return matches.map((match) => ({ ...match, effectiveAuthority: effectiveTmAuthority(match) }));
}

async function lookupTermbaseForSegment(
  workspaceRoot: string,
  options: { projectId: string; source: string; srcLang: string; tgtLang: string },
): Promise<TermbaseMatch[]> {
  const base = {
    projectId: options.projectId,
    term: options.source,
    limit: 20,
  };
  return lookupTermbase(workspaceRoot, {
    ...base,
    srcLang: options.srcLang,
    tgtLang: options.tgtLang,
  });
}

async function buildSegmentEvidenceSnapshotFromBatch(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; sourceLanguage: string; targetLanguage: string; tmStore: JsonTmStore; segment: BatchSegment },
): Promise<SegmentEvidenceSnapshot> {
  const segment = options.segment;
  const source = segment.source.trim();
  const [tmMatches, termbaseMatches, glossaryMatches] = await Promise.all([
    lookupTmForSegment(options.tmStore, source, {
      srcLang: options.sourceLanguage,
      tgtLang: options.targetLanguage,
    }),
    lookupTermbaseForSegment(workspaceRoot, {
      projectId: options.projectId,
      source,
      srcLang: options.sourceLanguage,
      tgtLang: options.targetLanguage,
    }),
    lookupGlossary(workspaceRoot, {
      projectId: options.projectId,
      term: source,
      limit: 20,
    }),
  ]);
  const sortedTmMatches = sortTmMatches(tmMatches).slice(0, 50);
  const sortedTermbaseMatches = sortLexicalMatches(termbaseMatches).slice(0, 20);
  const sortedGlossaryMatches = sortLexicalMatches(glossaryMatches).slice(0, 20);
  const cards = [tmCard(segment, sortedTmMatches), termbaseCard(segment, sortedTermbaseMatches), glossaryCard(segment, sortedGlossaryMatches)].filter(
    (card): card is SegmentEvidenceCard => Boolean(card),
  );
  return {
    projectId: options.projectId,
    batchId: options.batchId,
    segmentId: segment.id,
    source: segment.source,
    tmMatches: sortedTmMatches,
    termbaseMatches: sortedTermbaseMatches,
    glossaryMatches: sortedGlossaryMatches,
    cards,
    summary: {
      ...tmSummary(sortedTmMatches),
      termbase: sortedTermbaseMatches.length,
      glossary: sortedGlossaryMatches.length,
    },
  };
}

export async function buildSegmentEvidenceSnapshot(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; segmentId: string },
): Promise<SegmentEvidenceSnapshot> {
  const batch = await readEvidenceBatch(workspaceRoot, options.projectId, options.batchId);
  const segment = batch.segments.find((candidate) => candidate.id === options.segmentId);
  if (!segment) throw new Error(`Segment ${options.segmentId} not found in batch ${options.batchId}.`);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  return buildSegmentEvidenceSnapshotFromBatch(workspaceRoot, {
    projectId: options.projectId,
    batchId: options.batchId,
    sourceLanguage: batch.sourceLanguage,
    targetLanguage: batch.targetLanguage,
    tmStore: createTmStore(workspace),
    segment,
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildBatchEvidencePack(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; concurrency?: number },
): Promise<BatchEvidencePack> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  const tmStore = createTmStore(workspace);
  const segments = await mapLimit(batch.segments, options.concurrency ?? 8, (segment) =>
    buildSegmentEvidenceSnapshotFromBatch(workspaceRoot, {
      projectId: options.projectId,
      batchId: options.batchId,
      sourceLanguage: batch.sourceLanguage,
      targetLanguage: batch.targetLanguage,
      tmStore,
      segment,
    }),
  );
  const summary = segments.reduce(
    (total, segment) => ({
      totalSegments: total.totalSegments + 1,
      segmentsWithEvidence:
        total.segmentsWithEvidence + (segment.summary.tm + segment.summary.termbase + segment.summary.glossary > 0 ? 1 : 0),
      cards: total.cards + segment.cards.length,
      tm: total.tm + segment.summary.tm,
      tmExact: total.tmExact + segment.summary.tmExact,
      tmFuzzy: total.tmFuzzy + segment.summary.tmFuzzy,
      termbase: total.termbase + segment.summary.termbase,
      glossary: total.glossary + segment.summary.glossary,
    }),
    { totalSegments: 0, segmentsWithEvidence: 0, cards: 0, tm: 0, tmExact: 0, tmFuzzy: 0, termbase: 0, glossary: 0 },
  );
  return {
    schemaVersion: 1,
    projectId: options.projectId,
    batchId: options.batchId,
    checkedAt: new Date().toISOString(),
    summary,
    segments,
  };
}
