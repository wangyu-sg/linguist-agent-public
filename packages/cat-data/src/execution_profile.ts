import { createHash } from "node:crypto";
import type { PromptRequestBudget } from "./prompt_compiler.js";

/** Quality names are routing choices, never inferred claims about a model. */
export const EXECUTION_QUALITY_PROFILES = ["fast", "balanced", "best"] as const;
export type ExecutionQualityProfile = (typeof EXECUTION_QUALITY_PROFILES)[number];
export type ExecutionProfileId = ExecutionQualityProfile | "custom";
export type ExecutionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ExecutionModelRoute {
  provider: string;
  modelId: string;
  thinkingLevel?: ExecutionThinkingLevel;
}

export interface ExecutionProfileBudgetSnapshot {
  contextWindow: number;
  outputReserveTokens: number;
  toolSchemaTokens: number;
  historyTokens: number;
  providerFramingTokens: number;
  safetyMarginTokens: number;
  compactionReserveTokens: number;
}

/** Immutable, serializable selection authority for one planned Run. */
export interface ExecutionProfilePlan {
  schemaVersion: 1;
  profile: ExecutionProfileId;
  selection: "quality_route" | "explicit_model";
  model: ExecutionModelRoute;
  budget: ExecutionProfileBudgetSnapshot;
  profileHash: string;
}

export interface PlanExecutionProfileInput {
  /** Omit for the known Balanced compatibility route. */
  requestedProfile?: ExecutionQualityProfile;
  /** A legacy/direct provider-model choice is always `custom`. */
  explicitModel?: ExecutionModelRoute;
  qualityRoutes: Partial<Record<ExecutionQualityProfile, ExecutionModelRoute>>;
  /** LA-032's exact, verified model context/output budget. */
  requestBudget: PromptRequestBudget;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertRoute(route: ExecutionModelRoute, label: string): void {
  if (!route.provider.trim() || !route.modelId.trim()) throw new Error(`${label} requires a provider and modelId.`);
  if (route.thinkingLevel !== undefined
    && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(route.thinkingLevel)) {
    throw new Error(`${label}.thinkingLevel is invalid.`);
  }
}

function profileLabel(profile: ExecutionQualityProfile): string {
  return `${profile.slice(0, 1).toUpperCase()}${profile.slice(1)}`;
}

function snapshotBudget(input: PromptRequestBudget, route: ExecutionModelRoute): ExecutionProfileBudgetSnapshot {
  if (input.provider !== route.provider || input.modelId !== route.modelId) {
    throw new Error("ExecutionProfile request budget does not match the selected model route.");
  }
  const context = input.registry.resolve(route.provider, route.modelId);
  if (!context) throw new Error(`ExecutionProfile model context is unknown: ${route.provider}/${route.modelId}.`);
  const components = [
    input.toolSchemaTokens,
    input.historyTokens,
    input.providerFramingTokens,
    input.safetyMarginTokens,
    input.compactionReserveTokens,
  ];
  if (!isTokenCount(context.contextWindow) || context.contextWindow <= 0
    || !isTokenCount(context.outputReserveTokens) || context.outputReserveTokens >= context.contextWindow
    || components.some((value) => !isTokenCount(value))) {
    throw new Error("ExecutionProfile request budget is invalid.");
  }
  return {
    contextWindow: context.contextWindow,
    outputReserveTokens: context.outputReserveTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    historyTokens: input.historyTokens,
    providerFramingTokens: input.providerFramingTokens,
    safetyMarginTokens: input.safetyMarginTokens,
    compactionReserveTokens: input.compactionReserveTokens,
  };
}

/**
 * Resolves only explicit profile mappings. It never ranks models, infers tool
 * support, or falls through from an unknown profile to an arbitrary model.
 */
export function planExecutionProfile(input: PlanExecutionProfileInput): ExecutionProfilePlan {
  if (input.explicitModel && input.requestedProfile) {
    throw new Error("ExecutionProfile cannot combine an explicit model with a quality profile.");
  }
  const requestedProfile = input.requestedProfile ?? "balanced";
  const profile: ExecutionProfileId = input.explicitModel ? "custom" : requestedProfile;
  const selection = input.explicitModel ? "explicit_model" as const : "quality_route" as const;
  const selected = input.explicitModel ?? input.qualityRoutes[requestedProfile];
  if (!selected) throw new Error(`${profileLabel(requestedProfile)} ExecutionProfile is not configured.`);
  assertRoute(selected, `${profile === "custom" ? "Custom" : profileLabel(requestedProfile)} ExecutionProfile`);
  const model: ExecutionModelRoute = {
    provider: selected.provider,
    modelId: selected.modelId,
    ...(selected.thinkingLevel === undefined ? {} : { thinkingLevel: selected.thinkingLevel }),
  };
  const budget = snapshotBudget(input.requestBudget, model);
  const shape = {
    schemaVersion: 1 as const,
    profile,
    selection,
    model,
    budget,
  };
  return { ...shape, profileHash: digest(shape) };
}

/**
 * Pi does not promise in-place model rebinding. A changed profile is therefore
 * only compatible after a new runtime epoch; callers may schedule that for a
 * future Run but must never mutate an active Session in place.
 */
export function executionProfileSwitchCompatibility(
  current: ExecutionProfilePlan,
  next: ExecutionProfilePlan,
): { effectiveFrom: "next_turn" | "new_runtime_epoch"; compatibility: "compatible" | "requires_runtime_restart" } {
  return current.profileHash === next.profileHash
    ? { effectiveFrom: "next_turn", compatibility: "compatible" }
    : { effectiveFrom: "new_runtime_epoch", compatibility: "requires_runtime_restart" };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactFields(row: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  const extra = Object.keys(row).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label} has unknown field: ${extra}.`);
}

function requiredString(row: Record<string, unknown>, field: string, label: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string.`);
  return value;
}

/** Strict parser for profile plans crossing a Host/Worker or persisted-plan boundary. */
export function parseExecutionProfilePlan(value: unknown): ExecutionProfilePlan {
  const row = record(value, "ExecutionProfile plan");
  exactFields(row, ["schemaVersion", "profile", "selection", "model", "budget", "profileHash"], "ExecutionProfile plan");
  if (row.schemaVersion !== 1) throw new Error("ExecutionProfile plan.schemaVersion must be 1.");
  const profile = ["fast", "balanced", "best", "custom"].includes(String(row.profile))
    ? row.profile as ExecutionProfileId
    : (() => { throw new Error("ExecutionProfile plan.profile is invalid."); })();
  const selection: ExecutionProfilePlan["selection"] = row.selection === "quality_route" || row.selection === "explicit_model"
    ? row.selection
    : (() => { throw new Error("ExecutionProfile plan.selection is invalid."); })();
  if ((profile === "custom") !== (selection === "explicit_model")) {
    throw new Error("ExecutionProfile plan profile and selection are inconsistent.");
  }
  const modelRow = record(row.model, "ExecutionProfile plan.model");
  exactFields(modelRow, ["provider", "modelId", "thinkingLevel"], "ExecutionProfile plan.model");
  const model: ExecutionModelRoute = {
    provider: requiredString(modelRow, "provider", "ExecutionProfile plan.model"),
    modelId: requiredString(modelRow, "modelId", "ExecutionProfile plan.model"),
    ...(modelRow.thinkingLevel === undefined ? {} : { thinkingLevel: modelRow.thinkingLevel as ExecutionThinkingLevel }),
  };
  assertRoute(model, "ExecutionProfile plan.model");
  const budgetRow = record(row.budget, "ExecutionProfile plan.budget");
  const budgetFields = ["contextWindow", "outputReserveTokens", "toolSchemaTokens", "historyTokens", "providerFramingTokens", "safetyMarginTokens", "compactionReserveTokens"] as const;
  exactFields(budgetRow, budgetFields, "ExecutionProfile plan.budget");
  const budget = Object.fromEntries(budgetFields.map((field) => {
    const tokenCount = budgetRow[field];
    if (!isTokenCount(tokenCount)) throw new Error(`ExecutionProfile plan.budget.${field} is invalid.`);
    return [field, tokenCount];
  })) as unknown as ExecutionProfileBudgetSnapshot;
  if (budget.contextWindow <= 0 || budget.outputReserveTokens >= budget.contextWindow) {
    throw new Error("ExecutionProfile plan.budget context/output limits are invalid.");
  }
  const shape = { schemaVersion: 1 as const, profile, selection, model, budget };
  if (requiredString(row, "profileHash", "ExecutionProfile plan") !== digest(shape)) {
    throw new Error("ExecutionProfile plan.profileHash changed.");
  }
  return { ...shape, profileHash: row.profileHash as string };
}

export function assertExecutionProfilePlan(value: ExecutionProfilePlan): void {
  parseExecutionProfilePlan(value);
}
