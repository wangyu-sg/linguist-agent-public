import { createHash } from "node:crypto";
import type { SegmentProposalInput } from "./proposals.js";
import { effectiveTmAuthority, isHardExactTmAuthority, type TmMatch } from "./tm.js";

/**
 * This is a pure candidate router, not a translation writer. It treats TM and
 * repetition as provenance-bearing inputs, leaves proposal persistence to the
 * existing proposal gate, and keeps its cache in memory only.
 */
export const SAFE_HIGH_FUZZY_SCORE = 0.85;

export type CandidatePipelineRoute = "exact_tm" | "repetition" | "fuzzy_diff_repair" | "full_generation";
export type CandidateModelInvocation = "skip_expensive_generation" | "diff_repair" | "full_generation";
export type CandidateStatus = "ready_for_proposal" | "requires_diff_repair";

export interface CandidatePipelineInput {
  schemaVersion: 1;
  segment: {
    segmentId: string;
    sourceHash: string;
    revision: number;
  };
  /** LA-034's immutable graph digest, not a graph-authority reference. */
  context: { graphHash: string };
  /** A canonical constraint owner must positively verify safe reuse. */
  constraints: { snapshotHash: string; reuseSafety: "verified" | "unknown" | "blocked" };
  assets: { snapshotHash: string };
  /** Exact immutable route identity from the LA-033 execution planner. */
  model: { provider: string; modelId: string; executionProfileHash: string };
  prompt: { promptHash: string };
  tmMatches: readonly TmMatch[];
  repetitions?: readonly CandidateRepetition[];
}

export interface CandidateRepetition {
  sourceHash: string;
  sourceRevision: number;
  target: string;
  status: "confirmed";
  evidenceSource: string;
}

export interface TranslationCandidate {
  candidateId: string;
  target: string;
  source: "tm" | "repetition";
  status: CandidateStatus;
  evidenceSources: string[];
  reason: string;
}

export interface CandidatePipelinePlan {
  schemaVersion: 1;
  /** Candidate output is not Evidence, Project Truth, or a write authority. */
  authority: "candidate_only";
  canCommit: false;
  /** Stable segment identity only; source text never needs to enter the cache plan. */
  segmentId: string;
  cacheKey: string;
  cacheHit: boolean;
  route: CandidatePipelineRoute;
  modelInvocation: CandidateModelInvocation;
  candidate?: TranslationCandidate;
  reason: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function digest(value: unknown, label: string): string {
  const normalized = nonEmpty(value, label).toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(row).sort((left, right) => left.localeCompare(right)).map((key) => [key, canonicalize(row[key])]));
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizedMatches(matches: readonly TmMatch[]): TmMatch[] {
  return matches.map((match, index) => {
    if (!match || typeof match !== "object") throw new Error(`tmMatches[${index}] is invalid.`);
    const id = nonEmpty(match.id, `tmMatches[${index}].id`);
    const source = nonEmpty(match.source, `tmMatches[${index}].source`);
    const target = nonEmpty(match.target, `tmMatches[${index}].target`);
    if (typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < 0 || match.score > 1) {
      throw new Error(`tmMatches[${index}].score must be from 0 to 1.`);
    }
    if (!["exact", "contains", "fuzzy"].includes(match.matchType)) throw new Error(`tmMatches[${index}].matchType is invalid.`);
    return { ...match, id, source, target, effectiveAuthority: match.effectiveAuthority ?? effectiveTmAuthority(match) };
  }).sort((left, right) => left.id.localeCompare(right.id) || left.target.localeCompare(right.target) || left.source.localeCompare(right.source));
}

function normalizedRepetitions(repetitions: readonly CandidateRepetition[] | undefined): CandidateRepetition[] {
  return (repetitions ?? []).map((repetition, index) => ({
    sourceHash: digest(repetition.sourceHash, `repetitions[${index}].sourceHash`),
    sourceRevision: positiveInteger(repetition.sourceRevision, `repetitions[${index}].sourceRevision`),
    target: nonEmpty(repetition.target, `repetitions[${index}].target`),
    status: repetition.status === "confirmed" ? repetition.status : (() => { throw new Error(`repetitions[${index}].status must be confirmed.`); })(),
    evidenceSource: nonEmpty(repetition.evidenceSource, `repetitions[${index}].evidenceSource`),
  })).sort((left, right) => left.evidenceSource.localeCompare(right.evidenceSource) || left.target.localeCompare(right.target));
}

interface NormalizedCandidateInput {
  segment: CandidatePipelineInput["segment"];
  context: CandidatePipelineInput["context"];
  constraints: CandidatePipelineInput["constraints"];
  assets: CandidatePipelineInput["assets"];
  model: CandidatePipelineInput["model"];
  prompt: CandidatePipelineInput["prompt"];
  tmMatches: TmMatch[];
  repetitions: CandidateRepetition[];
}

function normalizeInput(input: CandidatePipelineInput): NormalizedCandidateInput {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1) throw new Error("Unsupported CandidatePipeline schema.");
  const segmentId = nonEmpty(input.segment?.segmentId, "segment.segmentId");
  const sourceHash = digest(input.segment?.sourceHash, "segment.sourceHash");
  const revision = positiveInteger(input.segment?.revision, "segment.revision");
  const graphHash = digest(input.context?.graphHash, "context.graphHash");
  const constraintHash = digest(input.constraints?.snapshotHash, "constraints.snapshotHash");
  const reuseSafety = input.constraints?.reuseSafety;
  if (reuseSafety !== "verified" && reuseSafety !== "unknown" && reuseSafety !== "blocked") throw new Error("constraints.reuseSafety is invalid.");
  const assetHash = digest(input.assets?.snapshotHash, "assets.snapshotHash");
  const provider = nonEmpty(input.model?.provider, "model.provider");
  const modelId = nonEmpty(input.model?.modelId, "model.modelId");
  const executionProfileHash = digest(input.model?.executionProfileHash, "model.executionProfileHash");
  const promptHash = digest(input.prompt?.promptHash, "prompt.promptHash");
  if (!Array.isArray(input.tmMatches)) throw new Error("tmMatches must be an array.");
  return {
    segment: { segmentId, sourceHash, revision },
    context: { graphHash },
    constraints: { snapshotHash: constraintHash, reuseSafety },
    assets: { snapshotHash: assetHash },
    model: { provider, modelId, executionProfileHash },
    prompt: { promptHash },
    tmMatches: normalizedMatches(input.tmMatches),
    repetitions: normalizedRepetitions(input.repetitions),
  };
}

/** The entire request identity is hashed; stale plans cannot be aliased to a new input. */
export function candidatePipelineCacheKey(input: CandidatePipelineInput): string {
  const normalized = normalizeInput(input);
  return contentHash(normalized);
}

function uniqueTargets<T extends { target: string }>(rows: T[]): T[] {
  const targets = new Map<string, T>();
  for (const row of rows) if (!targets.has(row.target.trim())) targets.set(row.target.trim(), row);
  return [...targets.values()].sort((left, right) => left.target.localeCompare(right.target));
}

function candidate(cacheKey: string, row: { target: string; source: TranslationCandidate["source"]; evidenceSources: string[]; status: CandidateStatus; reason: string }): TranslationCandidate {
  return {
    candidateId: contentHash({ cacheKey, routeSource: row.source, target: row.target, evidenceSources: row.evidenceSources, status: row.status }).slice(0, 24),
    target: row.target,
    source: row.source,
    status: row.status,
    evidenceSources: [...new Set(row.evidenceSources)].sort((left, right) => left.localeCompare(right)),
    reason: row.reason,
  };
}

function fullGenerationPlan(cacheKey: string, segmentId: string, reason: string): CandidatePipelinePlan {
  return { schemaVersion: 1, authority: "candidate_only", canCommit: false, segmentId, cacheKey, cacheHit: false, route: "full_generation", modelInvocation: "full_generation", reason };
}

function buildPlan(input: NormalizedCandidateInput, cacheKey: string): CandidatePipelinePlan {
  if (input.constraints.reuseSafety !== "verified") {
    return fullGenerationPlan(cacheKey, input.segment.segmentId, `Reuse is ${input.constraints.reuseSafety}; deterministic constraints did not authorize TM/repetition reuse.`);
  }

  const safeExact = uniqueTargets(input.tmMatches.filter((match) => match.matchType === "exact" && isHardExactTmAuthority(match)));
  if (safeExact.length === 1) {
    const match = safeExact[0]!;
    const value = candidate(cacheKey, {
      target: match.target,
      source: "tm",
      status: "ready_for_proposal",
      evidenceSources: [`tm:${match.id}`],
      reason: "Safe exact reviewed TM reuse; expensive generation skipped.",
    });
    return {
      schemaVersion: 1,
      authority: "candidate_only",
      canCommit: false,
      segmentId: input.segment.segmentId,
      cacheKey,
      cacheHit: false,
      route: "exact_tm",
      modelInvocation: "skip_expensive_generation",
      candidate: value,
      reason: value.reason,
    };
  }
  if (safeExact.length > 1) return fullGenerationPlan(cacheKey, input.segment.segmentId, "Conflicting reviewed exact TM targets require a proposal/generation path; expensive generation was not skipped.");

  const safeRepetition = uniqueTargets(input.repetitions.filter((row) => row.sourceHash === input.segment.sourceHash && row.sourceRevision === input.segment.revision));
  if (safeRepetition.length === 1) {
    const repetition = safeRepetition[0]!;
    const value = candidate(cacheKey, {
      target: repetition.target,
      source: "repetition",
      status: "ready_for_proposal",
      evidenceSources: [repetition.evidenceSource],
      reason: "Safe confirmed repetition reuse; expensive generation skipped.",
    });
    return {
      schemaVersion: 1,
      authority: "candidate_only",
      canCommit: false,
      segmentId: input.segment.segmentId,
      cacheKey,
      cacheHit: false,
      route: "repetition",
      modelInvocation: "skip_expensive_generation",
      candidate: value,
      reason: value.reason,
    };
  }
  if (safeRepetition.length > 1) return fullGenerationPlan(cacheKey, input.segment.segmentId, "Conflicting confirmed repetition targets require a proposal/generation path; expensive generation was not skipped.");

  const fuzzy = input.tmMatches.filter((match) => match.matchType === "fuzzy" && match.score >= SAFE_HIGH_FUZZY_SCORE && isHardExactTmAuthority(match));
  const bestFuzzy = fuzzy.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))[0];
  if (bestFuzzy) {
    const value = candidate(cacheKey, {
      target: bestFuzzy.target,
      source: "tm",
      status: "requires_diff_repair",
      evidenceSources: [`tm:${bestFuzzy.id}`],
      reason: `Safe high-fuzzy reviewed TM (${Math.round(bestFuzzy.score * 100)}%) is a diff-repair seed, not a final proposal.`,
    });
    return {
      schemaVersion: 1,
      authority: "candidate_only",
      canCommit: false,
      segmentId: input.segment.segmentId,
      cacheKey,
      cacheHit: false,
      route: "fuzzy_diff_repair",
      modelInvocation: "diff_repair",
      candidate: value,
      reason: value.reason,
    };
  }
  return fullGenerationPlan(cacheKey, input.segment.segmentId, "No safe exact/repetition/high-fuzzy reuse candidate is available.");
}

/** A bounded non-authoritative cache. It deliberately has no persistence or writer. */
export class CandidatePipelineCache {
  private readonly entries = new Map<string, CandidatePipelinePlan>();

  take(cacheKey: string): CandidatePipelinePlan | undefined {
    return this.entries.get(cacheKey);
  }

  remember(plan: CandidatePipelinePlan): void {
    this.entries.set(plan.cacheKey, plan);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Selects the cheapest safe next path. It never invokes a model: `diff_repair`
 * and `full_generation` are instructions for a future, separately governed
 * executor, while skip routes return only a reviewable candidate.
 */
export function planTmFirstCandidatePipeline(
  input: CandidatePipelineInput,
  options: { cache?: CandidatePipelineCache } = {},
): CandidatePipelinePlan {
  const normalized = normalizeInput(input);
  const cacheKey = contentHash(normalized);
  const cached = options.cache?.take(cacheKey);
  if (cached) return deepFreeze({ ...cached, cacheHit: true });
  const plan = deepFreeze(buildPlan(normalized, cacheKey));
  options.cache?.remember(plan);
  return plan;
}

/**
 * Only a completed safe-reuse candidate can be turned into the existing
 * proposal input. Callers must still invoke `createProposalSet` and its gates.
 */
export function proposalInputFromCandidatePlan(plan: CandidatePipelinePlan): SegmentProposalInput {
  if (!plan.candidate || plan.candidate.status !== "ready_for_proposal") {
    throw new Error("Candidate plan does not contain a ready proposal candidate.");
  }
  const segmentId = nonEmpty(plan.segmentId, "candidate plan segmentId");
  return {
    segmentId,
    proposedTarget: plan.candidate.target,
    reason: plan.candidate.reason,
    changeType: "translation",
    evidenceSources: [...plan.candidate.evidenceSources],
  };
}
