export interface SessionUsageTotals {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptySessionUsageTotals(): SessionUsageTotals {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function positiveFiniteNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function addPiMessageUsageTotals(totals: SessionUsageTotals, usage: unknown): SessionUsageTotals {
  const record = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  return {
    inputTokens: totals.inputTokens + positiveFiniteNumber(record.input),
    cacheReadTokens: totals.cacheReadTokens + positiveFiniteNumber(record.cacheRead),
    cacheWriteTokens: totals.cacheWriteTokens + positiveFiniteNumber(record.cacheWrite),
  };
}

export function sessionCacheHitRatePercent(totals: SessionUsageTotals): number | undefined {
  const total = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  if (total <= 0) return undefined;
  return Math.round((totals.cacheReadTokens / total) * 100);
}
