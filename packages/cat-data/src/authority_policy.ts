export type AuthorityTier =
  | "phrase_final_stage"
  | "style_guide"
  | "exact_compound_term"
  | "customer_override"
  | "local_proposal"
  | "base_term";

export interface AuthorityEvidence {
  id: string;
  tier: AuthorityTier;
  label: string;
  target?: string;
  source?: string;
  detail?: string;
}

export interface AuthorityDecision {
  winner: AuthorityEvidence;
  rejected: AuthorityEvidence[];
  reason: string;
}

export const AUTHORITY_PRIORITY: Record<AuthorityTier, number> = {
  phrase_final_stage: 100,
  style_guide: 90,
  exact_compound_term: 80,
  customer_override: 75,
  local_proposal: 40,
  base_term: 20,
};

export function authorityPriority(tier: AuthorityTier): number {
  const priority = AUTHORITY_PRIORITY[tier];
  if (priority === undefined) throw new Error(`Unknown authority tier: ${tier}`);
  return priority;
}

export function resolveAuthorityDecision(evidence: AuthorityEvidence[]): AuthorityDecision | undefined {
  const usable = evidence.filter((item) => item.id && item.tier);
  if (!usable.length) return undefined;
  const sorted = [...usable].sort((a, b) => authorityPriority(b.tier) - authorityPriority(a.tier) || a.id.localeCompare(b.id));
  const winner = sorted[0];
  return {
    winner,
    rejected: sorted.slice(1),
    reason: `${winner.tier} evidence outranks ${sorted.slice(1).map((item) => item.tier).join(", ") || "no competing evidence"}.`,
  };
}

export function authorityDecisionRequiresPlatformCheck(decision: AuthorityDecision): boolean {
  return decision.winner.tier !== "phrase_final_stage" && decision.rejected.some((item) => item.tier === "phrase_final_stage");
}
