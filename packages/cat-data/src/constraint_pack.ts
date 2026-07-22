import {
  readBatch,
  type BatchSegment,
  type CatBatch,
} from "./batch_workspace.js";
import { readPreferredGlossaryEntries, resolvePreferredGlossaryEntries, type GlossaryEntry, type GlossaryMatch } from "./glossary.js";
import { readPreferredTermbaseEntries, type TermbaseMatch } from "./termbase.js";
import { readProjectTagRuleContext } from "./tag_rules.js";
import { detectTags, type ProjectTagRuleContext } from "./tag_tokens.js";
import { createTmStore, effectiveTmAuthority, isHardExactTmAuthority, type JsonTmStore, type TmEntry, type TmMatch } from "./tm.js";
import { localesMatch } from "./locale.js";
import { createWorkspace } from "./workspace.js";
import { readVoiceProfile, type VoiceProfile } from "./voice_profile.js";
import { phraseInlineTagSignature, phrasePlaceholderSignature } from "@linguist-agent/cat-formats";

export type ConstraintKind =
  | "terminology"
  | "exact_tm"
  | "fuzzy_tm"
  | "duplicate_group"
  | "tag_signature"
  | "placeholder"
  | "number"
  | "voice";

export type ConstraintSeverity = "blocker" | "warning" | "advisory";

export interface SegmentConstraint {
  kind: ConstraintKind;
  severity: ConstraintSeverity;
  sourceTerm?: string;
  requiredTarget?: string;
  evidenceSource?: string;
  authority?: string;
  tmId?: string;
  duplicateKey?: string;
  siblingSegmentIds?: string[];
  requiredSignature?: string[];
  voiceProfileEntryId?: string;
  message?: string;
}

export interface SegmentConstraintPack {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  segmentId: string;
  textType: string | null;
  speaker: string | null;
  voiceProfileEntryId: string | null;
  constraints: SegmentConstraint[];
  summary: {
    blockerConstraints: number;
    warningConstraints: number;
    advisoryConstraints: number;
  };
}

export interface BatchConstraintPack {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  summary: {
    totalSegments: number;
    segmentsWithConstraints: number;
    blockerConstraints: number;
    warningConstraints: number;
    advisoryConstraints: number;
  };
  segments: SegmentConstraintPack[];
}

const HIGH_FUZZY_THRESHOLD = 0.7;

interface SegmentLookupInputs {
  projectId: string;
  voiceProfile: VoiceProfile | null;
  ruleContext: ProjectTagRuleContext;
  lookupTm: (source: string) => Promise<TmMatch[]>;
  lookupTermbase: (source: string) => Promise<TermbaseMatch[]>;
  lookupGlossary: (source: string) => Promise<GlossaryMatch[]>;
}

async function lookupTmForSegment(
  tmStore: JsonTmStore,
  source: string,
  options: { srcLang: string; tgtLang: string },
): Promise<TmMatch[]> {
  const base = { source, origin: "any" as const, threshold: HIGH_FUZZY_THRESHOLD, topK: 50 };
  const matches = await tmStore.lookup({ ...base, srcLang: options.srcLang, tgtLang: options.tgtLang });
  return matches.map((match) => ({ ...match, effectiveAuthority: effectiveTmAuthority(match) }));
}

function normalizeLookup(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchTerminologyEntries(
  entries: TermbaseMatch[],
  source: string,
  options: { srcLang: string; tgtLang: string },
): TermbaseMatch[] {
  const query = normalizeLookup(source);
  if (!query) return [];
  const matches: TermbaseMatch[] = [];
  for (const entry of entries) {
    const sourceTerm = normalizeLookup(entry.source);
    if (!sourceTerm) continue;
    const matchType: TermbaseMatch["matchType"] | null =
      sourceTerm === query ? "exact" : sourceTerm.includes(query) || query.includes(sourceTerm) ? "contains" : null;
    if (!matchType) continue;
    const match = { ...entry, matchType };
    if (localesMatch(entry.srcLang, options.srcLang) && localesMatch(entry.tgtLang, options.tgtLang)) matches.push(match);
  }
  return matches;
}

function matchGlossaryEntries(entries: GlossaryEntry[], source: string): GlossaryMatch[] {
  const query = normalizeLookup(source);
  if (!query) return [];
  const matches: GlossaryMatch[] = [];
  for (const entry of entries) {
    const sourceTerm = normalizeLookup(entry.source);
    const matchType = sourceTerm === query ? "exact" : sourceTerm.includes(query) || query.includes(sourceTerm) ? "contains" : null;
    if (matchType) matches.push({ ...entry, matchType });
  }
  return matches;
}

function preferredTermbaseMatches(
  entries: Awaited<ReturnType<typeof readPreferredTermbaseEntries>>,
  defaults: { srcLang: string; tgtLang: string },
): TermbaseMatch[] {
  return entries.map((entry, index) => ({
    id: `preferred-${index + 1}`,
    source: entry.source,
    target: entry.target,
    srcLang: entry.srcLang ?? defaults.srcLang,
    tgtLang: entry.tgtLang ?? defaults.tgtLang,
    note: entry.note,
    sourceFile: "preferred-termbase",
    rowNo: index + 1,
    origin: "manual",
    matchType: "contains",
    resolution: "preferred",
  }));
}

function tmAuthorityRank(match: TmMatch): number {
  switch (match.effectiveAuthority ?? effectiveTmAuthority(match)) {
    case "reviewed_tm": return 5;
    case "client_tm": return 4;
    case "imported_tm": return 3;
    case "working_tm": return 2;
    case "unknown_tm": return 1;
    default: return 0;
  }
}

function effectiveExactTmMatches(matches: TmMatch[]): TmMatch[] {
  const exact = matches.filter((match) => match.matchType === "exact" && isHardExactTmAuthority(match));
  if (!exact.length) return [];
  const topRank = Math.max(...exact.map(tmAuthorityRank));
  return exact.filter((match) => tmAuthorityRank(match) === topRank);
}

function buildExactTmIndex(entries: TmEntry[], options: { srcLang: string; tgtLang: string }): Map<string, TmMatch[]> {
  const index = new Map<string, TmMatch[]>();
  for (const entry of entries) {
    const authority = effectiveTmAuthority(entry);
    if (authority === "mt" || authority === "unknown_tm") continue;
    if (!localesMatch(entry.srcLang, options.srcLang) || !localesMatch(entry.tgtLang, options.tgtLang)) continue;
    const key = normalizeLookup(entry.source);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push({ ...entry, score: 1, matchType: "exact", effectiveAuthority: authority });
    index.set(key, bucket);
  }
  for (const [key, bucket] of index.entries()) index.set(key, bucket.sort((a, b) => tmAuthorityRank(b) - tmAuthorityRank(a) || (b.quality ?? 0) - (a.quality ?? 0)));
  return index;
}

function tagSignature(source: string): string[] {
  // Reuse the same inline-tag signature extraction the delivery gate uses, so
  // constraint packs and the export gate see the same tags. This covers
  // Phrase-style <color>/<bpt>/<g> structural tags and {u> change markers.
  // NOTE: BBCode-style bracket tags like [27CA28]...[-]#r are a project-specific
  // format that neither this helper nor phraseInlineTagSignature recognizes;
  // those are governed by confirmed project tag rules below, not by this generic
  // signature scan.
  return phraseInlineTagSignature(source);
}

function placeholderSignature(source: string): string[] {
  return phrasePlaceholderSignature(source);
}

function projectTagSignature(source: string, ruleContext: ProjectTagRuleContext): string[] {
  return detectTags(source, ruleContext)
    .filter((tag) => tag.kind === "project-tag")
    .map((tag) => tag.literal);
}

function numberTokens(value: string): string[] {
  return Array.from(value.matchAll(/\d+(?:\.\d+)?/g)).map((m) => m[0]);
}

function summarizeConstraints(constraints: SegmentConstraint[]): SegmentConstraintPack["summary"] {
  return {
    blockerConstraints: constraints.filter((constraint) => constraint.severity === "blocker").length,
    warningConstraints: constraints.filter((constraint) => constraint.severity === "warning").length,
    advisoryConstraints: constraints.filter((constraint) => constraint.severity === "advisory").length,
  };
}

function voiceEntryFor(
  voiceProfile: VoiceProfile | null,
  segment: BatchSegment,
): { entryId: string | null; textType: string | null; speaker: string | null } {
  if (!voiceProfile || voiceProfile.status !== "confirmed" || !voiceProfile.entries.length) {
    return { entryId: null, textType: null, speaker: (segment as { speaker?: string | null }).speaker ?? null };
  }
  const speaker = (segment as { speaker?: string | null }).speaker ?? null;
  // Match by speaker first, then fall back to any non-diegetic entry (speaker null).
  const bySpeaker = voiceProfile.entries.find((entry) => entry.speaker === speaker);
  const fallback = voiceProfile.entries.find((entry) => entry.speaker === null);
  const entry = bySpeaker ?? fallback;
  return { entryId: entry?.id ?? null, textType: entry?.textType ?? null, speaker };
}

async function buildSegmentConstraintPack(
  batch: CatBatch,
  segment: BatchSegment,
  inputs: SegmentLookupInputs,
  duplicateSiblings: Map<string, string[]>,
): Promise<SegmentConstraintPack> {
  const source = segment.source.trim();
  const constraints: SegmentConstraint[] = [];
  const seenTerminology = new Set<string>();
  const { entryId: voiceProfileEntryId, textType, speaker } = voiceEntryFor(inputs.voiceProfile, segment);

  // Terminology constraints (preferred termbase targets).
  if (source) {
    const termbaseMatches = await inputs.lookupTermbase(source);
    for (const match of termbaseMatches) {
      // An unresolved conflict or an entry replaced by an explicit override is
      // evidence, not binding authority. Only the effective preferred row can
      // become a generation blocker.
      if ((match.resolution === "preferred" || match.resolution === "override") && (match.matchType === "exact" || match.matchType === "contains")) {
        const key = `${match.source}\u0000${match.target}`;
        if (seenTerminology.has(key)) continue;
        seenTerminology.add(key);
        constraints.push({
          kind: "terminology",
          severity: "blocker",
          sourceTerm: match.source,
          requiredTarget: match.target,
          authority: "termbase",
          evidenceSource: `termbase:${match.sourceFile}:${match.rowNo}`,
          message: `Source uses term "${match.source}"; target must contain preferred "${match.target}".`,
        });
      }
    }
    const glossaryMatches = await inputs.lookupGlossary(source);
    const preferredGlossaryIds = new Set(resolvePreferredGlossaryEntries(glossaryMatches).map((entry) => entry.id));
    for (const match of glossaryMatches.filter((row) => preferredGlossaryIds.has(row.id))) {
      if (match.matchType === "exact" || match.matchType === "contains") {
        const key = `${match.source}\u0000${match.target}`;
        if (seenTerminology.has(key)) continue;
        seenTerminology.add(key);
        constraints.push({
          kind: "terminology",
          severity: "blocker",
          sourceTerm: match.source,
          requiredTarget: match.target,
          authority: "glossary",
          evidenceSource: `glossary:${match.sourceFile}:${match.rowNo}`,
          message: `Source uses glossary term "${match.source}"; target must contain required "${match.target}".`,
        });
      }
    }

    // TM constraints. Batch packs pass exact-index matches only; segment
    // snapshots pass the normal TM lookup and may include high-fuzzy matches.
    const tmMatches = await inputs.lookupTm(source);
    const exactTm = effectiveExactTmMatches(tmMatches);
    const exactTargets = new Map(exactTm.map((match) => [match.target.trim(), match]));
    if (exactTargets.size === 1) {
      const match = exactTargets.values().next().value as TmMatch;
      constraints.push({
        kind: "exact_tm",
        severity: "blocker",
        tmId: match.id,
        requiredTarget: match.target,
        authority: match.effectiveAuthority ?? effectiveTmAuthority(match),
        evidenceSource: `tm:${match.id}`,
        message: `Exact ${match.effectiveAuthority ?? effectiveTmAuthority(match)} match; target must equal "${match.target}" unless a higher typed authority overrides it.`,
      });
    } else if (exactTargets.size > 1) {
      const conflicting = [...exactTargets.values()];
      constraints.push({
        kind: "exact_tm",
        severity: "warning",
        authority: conflicting[0] ? conflicting[0].effectiveAuthority ?? effectiveTmAuthority(conflicting[0]) : "tm_conflict",
        message: `Exact TM has conflicting top-authority targets (${conflicting.map((match) => `"${match.target}"`).join(", ")}); treat them as evidence and resolve the conflict before claiming a binding target.`,
      });
    }
    if (!exactTm.length) {
      const advisoryExact = tmMatches.filter((match) => match.matchType === "exact" && !["mt", "unknown_tm"].includes(match.effectiveAuthority ?? effectiveTmAuthority(match)));
      const topRank = advisoryExact.length ? Math.max(...advisoryExact.map(tmAuthorityRank)) : 0;
      const topMatches = advisoryExact.filter((match) => tmAuthorityRank(match) === topRank);
      const advisoryTargets = new Map(topMatches.map((match) => [match.target.trim(), match]));
      if (advisoryTargets.size === 1) {
        const match = advisoryTargets.values().next().value as TmMatch;
        if (!segment.target.trim() || segment.target.trim() !== match.target.trim()) {
          constraints.push({
            kind: "exact_tm",
            severity: "advisory",
            tmId: match.id,
            requiredTarget: match.target,
            authority: match.effectiveAuthority ?? effectiveTmAuthority(match),
            evidenceSource: `tm:${match.id}`,
            message: `Exact ${match.effectiveAuthority ?? effectiveTmAuthority(match)} match is advisory until explicitly reviewed/promoted; use "${match.target}" only when current project context supports it.`,
          });
        }
      } else if (advisoryTargets.size > 1) {
        const conflicting = [...advisoryTargets.values()];
        constraints.push({
          kind: "exact_tm",
          severity: "warning",
          authority: conflicting[0]?.effectiveAuthority ?? (conflicting[0] ? effectiveTmAuthority(conflicting[0]) : "tm_conflict"),
          message: `Exact advisory TM evidence conflicts (${conflicting.map((match) => `"${match.target}"`).join(", ")}); resolve from current project evidence before translation.`,
        });
      }
    }
    for (const match of tmMatches.filter((row) => row.matchType !== "exact").slice(0, 3)) {
      if (match.score >= HIGH_FUZZY_THRESHOLD) {
        constraints.push({
          kind: "fuzzy_tm",
          severity: "warning",
          tmId: match.id,
          requiredTarget: match.target,
          authority: match.effectiveAuthority ?? effectiveTmAuthority(match),
          evidenceSource: `tm:${match.id}`,
          message: `High fuzzy ${match.effectiveAuthority ?? effectiveTmAuthority(match)} (${Math.round(match.score * 100)}%); prefer consistency with "${match.target}".`,
        });
      }
    }
  }

  // Duplicate-group constraint.
  const siblings = duplicateSiblings.get(segment.id);
  if (siblings && siblings.length) {
    constraints.push({
      kind: "duplicate_group",
      severity: "warning",
      duplicateKey: segment.duplicateKey,
      siblingSegmentIds: siblings,
      message: `Duplicate source group; keep targets consistent across ${siblings.length + 1} segment(s).`,
    });
  }

  // Tag-signature constraint.
  const signature = tagSignature(segment.source);
  if (signature.length) {
    constraints.push({
      kind: "tag_signature",
      severity: "blocker",
      requiredSignature: signature,
      message: "Target must preserve every inline tag from the source signature.",
    });
  }

  // Confirmed project tag rules are first-class generation constraints. These
  // cover game/project markup that generic delivery signatures intentionally do
  // not understand, e.g. [27CA28], [-], #r, or <a^...^a> when the project has
  // confirmed those tokens during tag-rule onboarding.
  const projectTags = projectTagSignature(segment.source, inputs.ruleContext);
  if (projectTags.length) {
    constraints.push({
      kind: "tag_signature",
      severity: "blocker",
      authority: "project_tag_rule",
      requiredSignature: projectTags,
      message: `Target must preserve confirmed project tag rule token(s): ${projectTags.join(", ")}.`,
    });
  }

  // Placeholder constraint: reuse the same placeholder signature the delivery
  // gate uses so {0}/{N>}/<N} runtime placeholders are surfaced to the model at
  // generation time, not only caught at export.
  const placeholders = placeholderSignature(segment.source);
  if (placeholders.length) {
    constraints.push({
      kind: "placeholder",
      severity: "blocker",
      requiredSignature: placeholders,
      message: `Target must preserve every runtime placeholder (${placeholders.join(", ")}) from the source.`,
    });
  }

  // Number constraint (advisory carry-over; delivery gate enforces these).
  const sourceNumbers = numberTokens(segment.source);
  if (sourceNumbers.length) {
    constraints.push({
      kind: "number",
      severity: "warning",
      message: `Source contains numbers (${sourceNumbers.join(", ")}); preserve their values unless the typed scope explicitly authorizes a unit or notation conversion, and keep any difference visible to QA.`,
    });
  }

  // Voice constraint (advisory; only when a confirmed profile governs this segment).
  if (voiceProfileEntryId) {
    constraints.push({
      kind: "voice",
      severity: "advisory",
      voiceProfileEntryId,
      message: "Match the confirmed voice profile for this speaker/text type.",
    });
  }

  return {
    schemaVersion: 1,
    projectId: inputs.projectId,
    batchId: batch.batchId,
    segmentId: segment.id,
    textType,
    speaker,
    voiceProfileEntryId,
    constraints,
    summary: summarizeConstraints(constraints),
  };
}

function buildDuplicateSiblingMap(batch: CatBatch): Map<string, string[]> {
  const byKey = new Map<string, BatchSegment[]>();
  for (const segment of batch.segments) {
    if (segment.duplicateGroupSize && segment.duplicateGroupSize > 1) {
      const bucket = byKey.get(segment.duplicateKey) ?? [];
      bucket.push(segment);
      byKey.set(segment.duplicateKey, bucket);
    }
  }
  const siblings = new Map<string, string[]>();
  for (const group of byKey.values()) {
    for (const segment of group) {
      siblings.set(
        segment.id,
        group.filter((other) => other.id !== segment.id).map((other) => other.id),
      );
    }
  }
  return siblings;
}

export async function buildSegmentConstraintPackSnapshot(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; segmentId: string },
): Promise<SegmentConstraintPack> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  const segment = batch.segments.find((candidate) => candidate.id === options.segmentId);
  if (!segment) throw new Error(`Segment ${options.segmentId} not found in batch ${options.batchId}.`);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  let voiceProfile: VoiceProfile | null = null;
  try {
    voiceProfile = await readVoiceProfile(workspaceRoot, options.projectId, options.batchId);
  } catch {
    voiceProfile = null;
  }
  const siblings = buildDuplicateSiblingMap(batch);
  const tmStore = createTmStore(workspace);
  const [preferredTerms, glossaryEntries, ruleContext] = await Promise.all([
    readPreferredTermbaseEntries(workspaceRoot, options.projectId),
    readPreferredGlossaryEntries(workspaceRoot, options.projectId),
    readProjectTagRuleContext(workspaceRoot, options.projectId),
  ]);
  const termbaseMatches = preferredTermbaseMatches(preferredTerms, {
    srcLang: batch.sourceLanguage,
    tgtLang: batch.targetLanguage,
  });
  return buildSegmentConstraintPack(batch, segment, {
    projectId: options.projectId,
    voiceProfile,
    ruleContext,
    lookupTm: (source) => lookupTmForSegment(tmStore, source, {
      srcLang: batch.sourceLanguage,
      tgtLang: batch.targetLanguage,
    }),
    lookupTermbase: (source) => Promise.resolve(matchTerminologyEntries(termbaseMatches, source, {
      srcLang: batch.sourceLanguage,
      tgtLang: batch.targetLanguage,
    })),
    lookupGlossary: (source) => Promise.resolve(matchGlossaryEntries(glossaryEntries, source)),
  }, siblings);
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

function isFlaggedSegment(
  segment: BatchSegment,
  ruleContext: ProjectTagRuleContext,
  exactTmIndex: Map<string, TmMatch[]>,
  termbaseEntries: TermbaseMatch[],
  glossaryEntries: GlossaryEntry[],
  languagePair: { srcLang: string; tgtLang: string },
): boolean {
  // "Flagged" is evidence-derived: structural/number/duplicate risk or a real
  // binding TM/term/glossary match. String length is not evidence of risk.
  if (!segment.source.trim()) return false;
  if (tagSignature(segment.source).length) return true;
  if (projectTagSignature(segment.source, ruleContext).length) return true;
  if (placeholderSignature(segment.source).length) return true;
  if (numberTokens(segment.source).length) return true;
  if (segment.duplicateGroupSize && segment.duplicateGroupSize > 1) return true;
  const exactTm = exactTmIndex.get(normalizeLookup(segment.source)) ?? [];
  if (exactTm.some(isHardExactTmAuthority)) return true;
  if (exactTm.length) {
    const topRank = Math.max(...exactTm.map(tmAuthorityRank));
    const targets = new Set(exactTm.filter((match) => tmAuthorityRank(match) === topRank).map((match) => match.target.trim()));
    if (targets.size > 1 || !targets.has(segment.target.trim())) return true;
  }
  if (matchTerminologyEntries(termbaseEntries, segment.source, languagePair).length) return true;
  return matchGlossaryEntries(glossaryEntries, segment.source).length > 0;
}

export async function buildBatchConstraintPack(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; concurrency?: number; onlyFlagged?: boolean },
): Promise<BatchConstraintPack> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  const workspace = createWorkspace(workspaceRoot, options.projectId);
  let voiceProfile: VoiceProfile | null = null;
  try {
    voiceProfile = await readVoiceProfile(workspaceRoot, options.projectId, options.batchId);
  } catch {
    voiceProfile = null;
  }
  const tmStore = createTmStore(workspace);
  const [tmEntries, preferredTerms, glossaryEntries] = await Promise.all([
    tmStore.list(),
    readPreferredTermbaseEntries(workspaceRoot, options.projectId),
    readPreferredGlossaryEntries(workspaceRoot, options.projectId),
  ]);
  const exactTmIndex = buildExactTmIndex(tmEntries, {
    srcLang: batch.sourceLanguage,
    tgtLang: batch.targetLanguage,
  });
  const termbaseMatches = preferredTermbaseMatches(preferredTerms, {
    srcLang: batch.sourceLanguage,
    tgtLang: batch.targetLanguage,
  });
  const siblings = buildDuplicateSiblingMap(batch);
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, options.projectId);
  const candidateSegments = options.onlyFlagged
    ? batch.segments.filter((segment) => isFlaggedSegment(segment, ruleContext, exactTmIndex, termbaseMatches, glossaryEntries, {
        srcLang: batch.sourceLanguage,
        tgtLang: batch.targetLanguage,
      }))
    : batch.segments;
  const segments = await mapLimit(candidateSegments, options.concurrency ?? 8, (segment) =>
    buildSegmentConstraintPack(batch, segment, {
      projectId: options.projectId,
      voiceProfile,
      ruleContext,
      lookupTm: (source) => Promise.resolve(exactTmIndex.get(normalizeLookup(source)) ?? []),
      lookupTermbase: (source) => Promise.resolve(matchTerminologyEntries(termbaseMatches, source, {
        srcLang: batch.sourceLanguage,
        tgtLang: batch.targetLanguage,
      })),
      lookupGlossary: (source) => Promise.resolve(matchGlossaryEntries(glossaryEntries, source)),
    }, siblings),
  );
  const summary = segments.reduce(
    (total, pack) => ({
      totalSegments: total.totalSegments + 1,
      segmentsWithConstraints: total.segmentsWithConstraints + (pack.constraints.length ? 1 : 0),
      blockerConstraints: total.blockerConstraints + pack.summary.blockerConstraints,
      warningConstraints: total.warningConstraints + pack.summary.warningConstraints,
      advisoryConstraints: total.advisoryConstraints + pack.summary.advisoryConstraints,
    }),
    { totalSegments: 0, segmentsWithConstraints: 0, blockerConstraints: 0, warningConstraints: 0, advisoryConstraints: 0 },
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
