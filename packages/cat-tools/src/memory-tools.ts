/**
 * Quarantine marker for the retired TencentDB-Agent-Memory runtime.
 *
 * This module intentionally contains no ToolDefinition, gateway probe, or
 * HTTP client.  Legacy data can only enter the explicit read-only candidate
 * migration path in cat-data; it cannot capture, store, or recall from a Run.
 */
export interface LegacyTdaiMemoryRuntimeStatus {
  capture: "disabled";
  store: "disabled";
  recall: "disabled";
  reason: "explicit_read_only_candidate_migration_required";
}

export function legacyTdaiMemoryRuntimeStatus(): LegacyTdaiMemoryRuntimeStatus {
  return {
    capture: "disabled",
    store: "disabled",
    recall: "disabled",
    reason: "explicit_read_only_candidate_migration_required",
  };
}
