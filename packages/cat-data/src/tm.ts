import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { workspacePath, type CatWorkspace, readJsonFile, writeJsonFile } from "./workspace.js";
import { localeKey, localesMatch } from "./locale.js";
import { assertCatCoreLegacyAllowed, catCorePersistenceFor, readCatCoreReadCache, type CatCorePersistence } from "./cat_core_storage.js";

export interface TmEntry {
  id: string;
  source: string;
  target: string;
  srcLang: string;
  tgtLang: string;
  origin: "reviewed" | "client_tm" | "mt" | "imported" | "unknown";
  quality?: number;
  project?: string;
  note?: string;
  sourceKind?: "client_import" | "customer_return" | "batch_confirm" | "manual" | "legacy";
  sourceBatchId?: string;
  sourceSegmentId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TmMatch extends TmEntry {
  score: number;
  matchType: "exact" | "contains" | "fuzzy";
  effectiveAuthority?: TmEffectiveAuthority;
}

export interface TmConcordanceMatch extends TmEntry {
  field: "source" | "target" | "note";
  snippet: string;
  score: number;
}

export interface TmSeedEntry extends Omit<TmEntry, "id"> {
  id?: string;
}

export interface TmUpsertResult {
  action: "inserted" | "updated" | "unchanged";
  entry: TmEntry;
}

export interface TmBulkImportResult {
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  replaced: number;
  path: string;
  sample: TmEntry[];
}

export type TmEffectiveAuthority = "reviewed_tm" | "working_tm" | "client_tm" | "imported_tm" | "mt" | "unknown_tm";

const tmFileLocks = new Map<string, Promise<void>>();

async function withTmFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const previous = tmFileLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);
  tmFileLocks.set(path, next);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (tmFileLocks.get(path) === next) {
      tmFileLocks.delete(path);
    }
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function stableId(entry: Pick<TmEntry, "source" | "srcLang" | "tgtLang" | "project">, prefix = "reviewed"): string {
  const digest = createHash("sha1")
    .update([entry.project ?? "", localeKey(entry.srcLang), localeKey(entry.tgtLang), normalize(entry.source)].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

function sourceIdentity(entry: Pick<TmEntry, "source" | "srcLang" | "tgtLang" | "project">): string {
  return [entry.project ?? "", localeKey(entry.srcLang), localeKey(entry.tgtLang), normalize(entry.source)].join("\u0000");
}

export function effectiveTmAuthority(entry: Pick<TmEntry, "origin" | "sourceKind">): TmEffectiveAuthority {
  if (entry.origin === "reviewed") return entry.sourceKind === "batch_confirm" ? "working_tm" : "reviewed_tm";
  if (entry.origin === "client_tm") return "client_tm";
  if (entry.origin === "imported") return "imported_tm";
  if (entry.origin === "mt") return "mt";
  return "unknown_tm";
}

export function isHardExactTmAuthority(entry: Pick<TmEntry, "origin" | "sourceKind">): boolean {
  // Import provenance is evidence, not a project decision. Only an explicitly
  // reviewed/promoted row may force an exact target; client/imported TM stays
  // advisory until that promotion happens.
  return effectiveTmAuthority(entry) === "reviewed_tm";
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[\s,.;:!?，。！？、；："'()[\]{}<>《》【】]+/u)
      .filter(Boolean),
  );
}

// Character n-grams (default bigrams). Critical for CJK fuzzy matching: Chinese has no
// spaces, so token-overlap returns 0 for near-paraphrases — but character bigrams capture
// shared substrings (e.g. 造成…伤害 vs 造成…一击 share 造成). Also robust to word-order
// changes and typos for Latin text.
function charNgrams(value: string, n = 2): Set<string> {
  const v = value.replace(/\s+/g, "");
  if (v.length <= n) return new Set(v ? [v] : []);
  const grams = new Set<string>();
  for (let i = 0; i <= v.length - n; i += 1) grams.add(v.slice(i, i + n));
  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// v1.6 hybrid-lexical fuzzy score. Was: token-set overlap only (returned 0 for any CJK
// near-match, the exact band where fuzzy TM saves the most time). Now: exact → contains →
// max(char-bigram Dice, token Jaccard). Bigram Dice is the standard fuzzy-string metric and
// works across zh/en; token Jaccard still rewards multi-word Latin overlap.
function scoreSource(query: string, source: string): Pick<TmMatch, "score" | "matchType"> {
  const q = normalize(query);
  const s = normalize(source);
  if (!q || !s) return { score: 0, matchType: "fuzzy" };
  if (q === s) return { score: 1, matchType: "exact" };
  if (q.includes(s) || s.includes(q)) {
    const shorter = Math.min(q.length, s.length);
    const longer = Math.max(q.length, s.length);
    return { score: Math.max(0.72, shorter / longer), matchType: "contains" };
  }
  const dice = diceCoefficient(charNgrams(q), charNgrams(s));
  const tokens = jaccard(tokenSet(q), tokenSet(s));
  return { score: Math.max(dice, tokens), matchType: "fuzzy" };
}

function snippetAround(value: string, query: string, radius = 48): string {
  const normalizedValue = value.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const index = normalizedValue.indexOf(normalizedQuery);
  if (index < 0) return value.length > radius * 2 ? `${value.slice(0, radius * 2)}...` : value;
  const start = Math.max(0, index - radius);
  const end = Math.min(value.length, index + query.length + radius);
  return `${start > 0 ? "..." : ""}${value.slice(start, end)}${end < value.length ? "..." : ""}`;
}

export class JsonTmStore {
  readonly path: string;

  constructor(readonly workspace: CatWorkspace, private readonly persistence?: CatCorePersistence) {
    this.path = workspacePath(workspace, "tm.json");
  }

  async list(): Promise<TmEntry[]> {
    if (this.persistence) return this.persistence.readTm(this.workspace.projectId);
    const cached = await readCatCoreReadCache<TmEntry[]>(this.workspace.root, "tm", this.workspace.projectId);
    if (cached) return cached;
    await assertCatCoreLegacyAllowed(this.workspace.root);
    return readJsonFile<TmEntry[]>(this.path, []);
  }

  private async writeEntries(entries: TmEntry[], expected: TmEntry[] | null): Promise<void> {
    if (this.persistence) {
      await this.persistence.writeTm(this.workspace.projectId, entries, expected);
      return;
    }
    await assertCatCoreLegacyAllowed(this.workspace.root);
    await writeJsonFile(this.path, entries);
  }

  async seed(entries: TmSeedEntry[]): Promise<TmEntry[]> {
    const now = new Date().toISOString();
    const normalized = entries.map((entry, index): TmEntry => ({
      id: entry.id ?? `seed-${String(index + 1).padStart(3, "0")}`,
      source: entry.source,
      target: entry.target,
      srcLang: entry.srcLang,
      tgtLang: entry.tgtLang,
      origin: entry.origin,
      quality: entry.quality,
      project: entry.project,
      note: entry.note,
      sourceKind: entry.sourceKind ?? "legacy",
      sourceBatchId: entry.sourceBatchId,
      sourceSegmentId: entry.sourceSegmentId,
      createdAt: entry.createdAt ?? now,
      updatedAt: entry.updatedAt ?? now,
    }));
    await this.writeEntries(normalized, await this.list());
    return normalized;
  }

  async upsertReviewed(entry: Omit<TmEntry, "id" | "origin"> & { id?: string; origin?: TmEntry["origin"] }): Promise<TmUpsertResult> {
    return withTmFileLock(this.path, async () => {
      const entries = await this.list();
      const id = entry.id ?? stableId(entry);
      const now = new Date().toISOString();
      const next: TmEntry = {
        id,
        source: entry.source,
        target: entry.target,
        srcLang: entry.srcLang,
        tgtLang: entry.tgtLang,
        origin: entry.origin ?? "reviewed",
        quality: entry.quality ?? 100,
        project: entry.project,
        note: entry.note,
        sourceKind: entry.sourceKind ?? (entry.origin === "client_tm" ? "client_import" : "manual"),
        sourceBatchId: entry.sourceBatchId,
        sourceSegmentId: entry.sourceSegmentId,
        createdAt: entry.createdAt ?? now,
        updatedAt: now,
      };
      const existingIndex = entries.findIndex(
        (candidate) =>
          candidate.id === id ||
          (localesMatch(candidate.srcLang, next.srcLang) &&
            localesMatch(candidate.tgtLang, next.tgtLang) &&
            candidate.project === next.project &&
            normalize(candidate.source) === normalize(next.source)),
      );
      let action: TmUpsertResult["action"] = "inserted";
      if (existingIndex >= 0) {
        const current = entries[existingIndex];
        if (
          current.target === next.target &&
          current.origin === next.origin &&
          current.quality === next.quality &&
          current.note === next.note &&
          current.sourceKind === next.sourceKind &&
          current.sourceBatchId === next.sourceBatchId &&
          current.sourceSegmentId === next.sourceSegmentId
        ) {
          action = "unchanged";
        } else {
          action = "updated";
        }
        entries[existingIndex] =
          action === "unchanged"
            ? current
            : { ...current, ...next, id: current.id, createdAt: current.createdAt ?? next.createdAt };
      } else {
        entries.push(next);
      }
      await this.writeEntries(entries, await this.list());
      await appendFile(
        workspacePath(this.workspace, "tm_audit.jsonl"),
        `${JSON.stringify({ ts: new Date().toISOString(), action, entry: existingIndex >= 0 ? entries[existingIndex] : next })}\n`,
        "utf8",
      );
      return { action, entry: existingIndex >= 0 ? entries[existingIndex] : next };
    });
  }

  async promoteReviewed(id: string): Promise<TmUpsertResult> {
    return withTmFileLock(this.path, async () => {
      const entries = await this.list();
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error(`TM entry ${id} not found.`);
      const current = entries[index];
      const next: TmEntry = {
        ...current,
        origin: current.origin === "mt" ? "reviewed" : current.origin,
        sourceKind: "manual",
        updatedAt: new Date().toISOString(),
      };
      const action: TmUpsertResult["action"] =
        current.origin === next.origin && current.sourceKind === next.sourceKind ? "unchanged" : "updated";
      entries[index] = next;
      await this.writeEntries(entries, await this.list());
      await appendFile(
        workspacePath(this.workspace, "tm_audit.jsonl"),
        `${JSON.stringify({ ts: next.updatedAt, action: "promote_reviewed", entry: next })}\n`,
        "utf8",
      );
      return { action, entry: next };
    });
  }

  async importClientEntries(
    rows: Array<Omit<TmEntry, "id" | "origin"> & { id?: string; origin?: TmEntry["origin"] }>,
    options: { append?: boolean; srcLang?: string; tgtLang?: string; project?: string } = {},
  ): Promise<TmBulkImportResult> {
    return withTmFileLock(this.path, async () => {
      const original = await this.list();
      const replacing = !options.append;
      const replaceable = (entry: TmEntry) =>
        ["client_tm", "imported", "unknown"].includes(entry.origin) &&
        (!options.project || entry.project === options.project) &&
        (!options.srcLang || localesMatch(entry.srcLang, options.srcLang)) &&
        (!options.tgtLang || localesMatch(entry.tgtLang, options.tgtLang));
      const preserved = replacing ? original.filter((entry) => !replaceable(entry)) : [...original];
      const replaced = replacing ? original.length - preserved.length : 0;
      const entries = [...preserved];
      let idIndex = new Map<string, number>();
      let sourceIndex = new Map<string, number>();
      const rebuildIndexes = () => {
        idIndex = new Map();
        sourceIndex = new Map();
        entries.forEach((entry, index) => {
          if (!idIndex.has(entry.id)) idIndex.set(entry.id, index);
          const sourceKey = sourceIdentity(entry);
          if (!sourceIndex.has(sourceKey)) sourceIndex.set(sourceKey, index);
        });
      };
      const indexEntry = (entry: TmEntry, index: number) => {
        if (!idIndex.has(entry.id)) idIndex.set(entry.id, index);
        const sourceKey = sourceIdentity(entry);
        if (!sourceIndex.has(sourceKey)) sourceIndex.set(sourceKey, index);
      };
      rebuildIndexes();
      let imported = 0;
      let updated = 0;
      let unchanged = 0;
      let skipped = 0;
      const sample: TmEntry[] = [];

      for (const row of rows) {
        const source = row.source.trim();
        const target = row.target.trim();
        if (!source || !target) {
          skipped += 1;
          continue;
        }
        const next: TmEntry = {
          id: row.id ?? stableId({ source, srcLang: row.srcLang, tgtLang: row.tgtLang, project: row.project }, "client-tm"),
          source,
          target,
          srcLang: row.srcLang,
          tgtLang: row.tgtLang,
          origin: row.origin ?? "client_tm",
          quality: row.quality ?? 100,
          project: row.project,
          note: row.note,
          sourceKind: row.sourceKind ?? "client_import",
          sourceBatchId: row.sourceBatchId,
          sourceSegmentId: row.sourceSegmentId,
          createdAt: row.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const existingIndex = idIndex.get(next.id) ?? sourceIndex.get(sourceIdentity(next)) ?? -1;
        if (existingIndex >= 0) {
          const current = entries[existingIndex];
          // CAT-truth invariant: a client/imported TM row must NEVER overwrite a
          // human-reviewed row. The replaceable() filter preserves reviewed rows from
          // bulk replace, but the per-row merge below would otherwise clobber a reviewed
          // row's target/origin when the client row shares the same source — skip it.
          if (current.origin === "reviewed") {
            skipped += 1;
            continue;
          }
          if (current.target === next.target && current.origin === next.origin && current.quality === next.quality && current.note === next.note) {
            unchanged += 1;
          } else {
            updated += 1;
          }
          const merged = { ...current, ...next, id: current.id, createdAt: current.createdAt ?? next.createdAt };
          const sourceChanged = sourceIdentity(current) !== sourceIdentity(merged);
          entries[existingIndex] = merged;
          if (sourceChanged) {
            rebuildIndexes();
          }
          if (sample.length < 5) sample.push(entries[existingIndex]);
        } else {
          entries.push(next);
          indexEntry(next, entries.length - 1);
          imported += 1;
          if (sample.length < 5) sample.push(next);
        }
      }

      await this.writeEntries(entries, original);
      await appendFile(
        workspacePath(this.workspace, "tm_audit.jsonl"),
        `${JSON.stringify({
          ts: new Date().toISOString(),
          action: "client_tm_import",
          imported,
          updated,
          unchanged,
          skipped,
          replaced,
          srcLang: options.srcLang,
          tgtLang: options.tgtLang,
          project: options.project,
        })}\n`,
        "utf8",
      );
      return { imported, updated, unchanged, skipped, replaced, path: this.path, sample };
    });
  }

  async lookup(options: {
    source: string;
    srcLang?: string;
    tgtLang?: string;
    origin?: TmEntry["origin"] | "any";
    minQuality?: number;
    threshold?: number;
    topK?: number;
    includeUnreviewedMt?: boolean;
  }): Promise<TmMatch[]> {
    const threshold = options.threshold ?? 0.7;
    const topK = options.topK ?? 5;
    const entries = await this.list();
    const matches: TmMatch[] = [];

    for (const entry of entries) {
      if (entry.origin === "mt" && !options.includeUnreviewedMt) continue;
      if (options.origin && options.origin !== "any" && entry.origin !== options.origin) continue;
      if (typeof options.minQuality === "number" && (entry.quality ?? 0) < options.minQuality) continue;
      if (options.srcLang && !localesMatch(entry.srcLang, options.srcLang)) continue;
      if (options.tgtLang && !localesMatch(entry.tgtLang, options.tgtLang)) continue;
      const scored = scoreSource(options.source, entry.source);
      if (scored.score < threshold) continue;
      matches.push({ ...entry, ...scored, effectiveAuthority: effectiveTmAuthority(entry) });
    }

    return matches
      .sort((a, b) => b.score - a.score || (b.quality ?? 0) - (a.quality ?? 0))
      .slice(0, topK);
  }

  async concordance(options: {
    query: string;
    srcLang?: string;
    tgtLang?: string;
    origin?: TmEntry["origin"] | "any";
    minQuality?: number;
    field?: "source" | "target" | "note" | "both";
    topK?: number;
    includeUnreviewedMt?: boolean;
  }): Promise<TmConcordanceMatch[]> {
    const query = normalize(options.query);
    if (!query) return [];
    const topK = options.topK ?? 20;
    const entries = await this.list();
    const matches: TmConcordanceMatch[] = [];
    const fields: Array<"source" | "target"> =
      options.field === "source" ? ["source"] : options.field === "target" ? ["target"] : ["source", "target"];
    for (const entry of entries) {
      if (entry.origin === "mt" && !options.includeUnreviewedMt) continue;
      if (options.origin && options.origin !== "any" && entry.origin !== options.origin) continue;
      if (typeof options.minQuality === "number" && (entry.quality ?? 0) < options.minQuality) continue;
      if (options.srcLang && !localesMatch(entry.srcLang, options.srcLang)) continue;
      if (options.tgtLang && !localesMatch(entry.tgtLang, options.tgtLang)) continue;
      if (options.field !== "note") {
        for (const field of fields) {
          const value = entry[field];
          const normalizedValue = normalize(value);
          if (!normalizedValue.includes(query)) continue;
          const exact = normalizedValue === query;
          matches.push({
            ...entry,
            field,
            snippet: snippetAround(value, options.query),
            score: exact ? 1 : Math.max(0.6, query.length / Math.max(query.length, normalizedValue.length)),
          });
        }
      }
      if (entry.note && options.field !== "source" && options.field !== "target") {
        const normalizedNote = normalize(entry.note);
        if (normalizedNote.includes(query)) {
          matches.push({
            ...entry,
            field: "note",
            snippet: snippetAround(entry.note, options.query),
            score: Math.max(0.5, query.length / Math.max(query.length, normalizedNote.length)),
          });
        }
      }
    }
    return matches.sort((a, b) => b.score - a.score || (b.quality ?? 0) - (a.quality ?? 0)).slice(0, topK);
  }
}

export function createTmStore(workspace: CatWorkspace): JsonTmStore {
  return new JsonTmStore(workspace, catCorePersistenceFor(workspace.root));
}
