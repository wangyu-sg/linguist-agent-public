import type {
  BatchSegment,
  CatBatch,
  SegmentDetectedTag,
  SegmentRenderToken,
} from "../data/workspace-client.ts";

export function filterSegments(segments: BatchSegment[], query: string): BatchSegment[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return segments;
  return segments.filter((segment) => (
    segment.id.toLocaleLowerCase().includes(needle)
    || segment.source.toLocaleLowerCase().includes(needle)
    || segment.target.toLocaleLowerCase().includes(needle)
  ));
}

export function segmentNumber(segment: BatchSegment): string {
  return String(segment.index).padStart(3, "0");
}

export function segmentIssueCount(segment: BatchSegment): number {
  const detailed = [
    ...(segment.unresolvedPlaceholders ?? []),
    ...(segment.unresolvedRuntimePlaceholders ?? []),
    ...(segment.unresolvedTagPlaceholders ?? []),
  ];
  if (detailed.length) return detailed.length;
  return (segment.unresolvedPlaceholderCount ?? 0)
    + (segment.unresolvedRuntimePlaceholderCount ?? 0)
    + (segment.unresolvedTagPlaceholderCount ?? 0);
}

export function adjacentSegmentId(segments: BatchSegment[], currentId: string, delta: -1 | 1): string | null {
  const currentIndex = segments.findIndex((segment) => segment.id === currentId);
  if (currentIndex < 0) return segments[0]?.id ?? null;
  return segments[currentIndex + delta]?.id ?? null;
}

export function nextEditableSegmentId(segments: BatchSegment[], currentId: string): string | null {
  const currentIndex = segments.findIndex((segment) => segment.id === currentId);
  for (let index = currentIndex + 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment && !segment.locked && segment.status !== "confirmed") return segment.id;
  }
  return null;
}

/** Rebuilds display tokens from server-owned detected tags without detecting tags in the renderer. */
export function tokensFromDetectedTags(text: string, tags: SegmentDetectedTag[]): SegmentRenderToken[] {
  const tokens: SegmentRenderToken[] = [];
  let offset = 0;
  for (const tag of [...tags].sort((left, right) => left.index - right.index)) {
    if (tag.index < offset || tag.index < 0 || tag.index + tag.literal.length > text.length) continue;
    if (tag.index > offset) tokens.push({ kind: "text", value: text.substring(offset, tag.index) });
    tokens.push({ kind: "tag", tag });
    offset = tag.index + tag.literal.length;
  }
  if (offset < text.length) tokens.push({ kind: "text", value: text.substring(offset) });
  return tokens;
}

function rangesOverlap(ranges: Array<{ start: number; end: number }>, start: number, end: number): boolean {
  return ranges.some((range) => !(end <= range.start || start >= range.end));
}

/**
 * Re-locates server-owned tag literals inside edited text. The renderer never
 * detects new tag patterns: only literals the server already reported (via the
 * segment tag contract) are re-positioned, longest-literal-first so overlapping
 * candidates never double-claim. Real "\n" characters surface as ↵ chips with
 * the contract's newline tone, mirroring how the server renders `\n` escapes.
 */
export function relocateDetectedTags(text: string, knownTags: SegmentDetectedTag[]): SegmentDetectedTag[] {
  if (!text) return [];
  const claimed: Array<{ start: number; end: number }> = [];
  const tags: SegmentDetectedTag[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    tags.push({
      literal: "\n",
      kind: "escape",
      id: null,
      index,
      pairKey: "escape:literal:\n",
      tone: "newline",
      label: "↵",
    });
    claimed.push({ start: index, end: index + 1 });
  }
  const sampleByLiteral = new Map<string, SegmentDetectedTag>();
  for (const tag of knownTags) {
    if (!tag.literal) continue;
    const existing = sampleByLiteral.get(tag.literal);
    if (!existing || tag.pairKey < existing.pairKey) sampleByLiteral.set(tag.literal, tag);
  }
  const literals = [...sampleByLiteral.keys()].sort((left, right) => right.length - left.length || left.localeCompare(right));
  for (const literal of literals) {
    const sample = sampleByLiteral.get(literal)!;
    let from = 0;
    while (from <= text.length - literal.length) {
      const found = text.indexOf(literal, from);
      if (found < 0) break;
      const end = found + literal.length;
      if (!rangesOverlap(claimed, found, end)) {
        tags.push({ ...sample, index: found });
        claimed.push({ start: found, end });
      }
      from = found + literal.length;
    }
  }
  return tags.sort((left, right) => left.index - right.index);
}

/** Counts only translatable characters: tag literals and newline chips never count. */
export function plainTextLength(text: string, knownTags?: SegmentDetectedTag[]): number {
  if (!text) return 0;
  let count = 0;
  for (const token of tokensFromDetectedTags(text, relocateDetectedTags(text, knownTags ?? []))) {
    if (token.kind === "text") count += token.value.length;
  }
  return count;
}

/**
 * CAT-style word count: Han characters count individually, Latin runs
 * count as words, and mixed CJK/Latin text counts both (the industry
 * "Asian chars + non-Asian words" basis). Tag literals and newline
 * chips never count.
 */
export function wordCount(text: string, knownTags?: SegmentDetectedTag[]): number {
  if (!text) return 0;
  let plain = "";
  for (const token of tokensFromDetectedTags(text, relocateDetectedTags(text, knownTags ?? []))) {
    if (token.kind === "text") plain += token.value;
  }
  const han = (plain.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (plain.replace(/\p{Script=Han}/gu, " ").match(/[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu) ?? []).length;
  return han + latin;
}

const DIFF_TOKEN_PATTERN = /\p{Script=Han}|[\p{L}\p{N}_]+|[^\s]/gu;

export interface DiffTokenPart {
  token: string;
  added: boolean;
}

/**
 * Multiset token diff (port of the retired mac client's TokenDiff):
 * Han characters, Latin words, and punctuation are tokens; a candidate
 * token is "added" when the baseline's multiset cannot cover it.
 * Whitespace between tokens is preserved as plain parts.
 */
export function markAddedTokens(baseline: string, candidate: string): DiffTokenPart[] {
  const remaining = new Map<string, number>();
  for (const token of baseline.match(DIFF_TOKEN_PATTERN) ?? []) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }
  const parts: DiffTokenPart[] = [];
  let offset = 0;
  for (const match of candidate.matchAll(DIFF_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push({ token: candidate.slice(offset, index), added: false });
    const token = match[0];
    const left = remaining.get(token) ?? 0;
    if (left > 0) {
      remaining.set(token, left - 1);
      parts.push({ token, added: false });
    } else {
      parts.push({ token, added: true });
    }
    offset = index + token.length;
  }
  if (offset < candidate.length) parts.push({ token: candidate.slice(offset), added: false });
  return parts;
}

export interface BatchSegmentStats {
  total: number;
  confirmed: number;
  draft: number;
  fresh: number;
  locked: number;
  tagged: number;
  /** Whole-batch scope: source words across every segment. */
  sourceWords: number;
  /** Progress: source words of confirmed segments (CAT-standard billing basis). */
  confirmedSourceWords: number;
  /** Current target words across the batch (live draft buffer wins). */
  targetWords: number;
}

interface BatchStatsSegmentOverride {
  id: string;
  status: BatchSegment["status"];
  target: string;
}

/**
 * Batch-level aggregates for the CAT status bar. `override` carries the
 * selected segment's live draft so unsaved edits and just-confirmed states
 * are reflected before the server echoes them back.
 */
export function batchSegmentStats(
  segments: BatchSegment[],
  tagViews: CatBatch["tagViews"],
  override?: BatchStatsSegmentOverride,
): BatchSegmentStats {
  const stats: BatchSegmentStats = {
    total: segments.length,
    confirmed: 0,
    draft: 0,
    fresh: 0,
    locked: 0,
    tagged: 0,
    sourceWords: 0,
    confirmedSourceWords: 0,
    targetWords: 0,
  };
  for (const segment of segments) {
    const isOverride = override?.id === segment.id;
    const status = isOverride ? override.status : segment.status;
    const target = isOverride ? override.target : segment.target;
    const tagView = tagViews?.[segment.id];
    const sourceTags = tagView && tagView.source === segment.source ? tagView.text.tags : undefined;
    if (segment.locked) stats.locked += 1;
    if (sourceTags?.length) stats.tagged += 1;
    if (status === "confirmed") stats.confirmed += 1;
    else if (status === "draft") stats.draft += 1;
    else stats.fresh += 1;
    const sourceWords = wordCount(segment.source, sourceTags);
    stats.sourceWords += sourceWords;
    if (status === "confirmed") stats.confirmedSourceWords += sourceWords;
    stats.targetWords += wordCount(target, tagView?.validation.targetTags);
  }
  return stats;
}

/** Splices an inserted literal into a buffer at a clamped caret offset. */
export function insertLiteralAt(buffer: string, offset: number, literal: string): { value: string; caret: number } {
  const at = Math.max(0, Math.min(offset, buffer.length));
  return { value: buffer.slice(0, at) + literal + buffer.slice(at), caret: at + literal.length };
}
