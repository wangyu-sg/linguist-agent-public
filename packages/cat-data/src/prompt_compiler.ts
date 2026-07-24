import { createHash } from "node:crypto";

/**
 * The prompt compiler is the one seam where a CAT surface turns typed context
 * into model input.  It deliberately keeps policy out of prose: hard
 * constraints and the tool profile are represented in the manifest as well
 * as in the prompt so callers can audit what was actually sent to a model.
 */

export const PROMPT_SURFACES = ["cat", "team_role", "eval_generate", "eval_judge"] as const;
export type PromptSurface = (typeof PROMPT_SURFACES)[number];

/** A verified model context/output pair.  Provider metadata is not inferred. */
export interface ModelContextEntry {
  provider: string;
  modelId: string;
  contextWindow: number;
  outputReserveTokens: number;
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

/**
 * Minimal immutable lookup used by request planning.  It deliberately stores
 * only the provider/model pair and the verified context/output limits; tool,
 * history and framing costs belong to the concrete request.
 */
export class ModelContextRegistry {
  private readonly entries = new Map<string, ModelContextEntry>();

  constructor(entries: readonly ModelContextEntry[]) {
    for (const entry of entries) {
      if (!entry.provider.trim() || !entry.modelId.trim()
        || !validTokenCount(entry.contextWindow) || entry.contextWindow <= 0
        || !validTokenCount(entry.outputReserveTokens) || entry.outputReserveTokens >= entry.contextWindow) {
        throw new Error("Invalid ModelContextRegistry entry.");
      }
      const key = `${entry.provider}\u0000${entry.modelId}`;
      if (this.entries.has(key)) throw new Error(`Duplicate ModelContextRegistry entry: ${entry.provider}/${entry.modelId}.`);
      this.entries.set(key, { ...entry });
    }
  }

  resolve(provider: string, modelId: string): ModelContextEntry | undefined {
    const entry = this.entries.get(`${provider}\u0000${modelId}`);
    return entry ? { ...entry } : undefined;
  }
}

/** Every non-prompt component is explicit so an absent estimate cannot pass. */
export interface PromptRequestBudget {
  registry: ModelContextRegistry;
  provider: string;
  modelId: string;
  toolSchemaTokens: number;
  historyTokens: number;
  providerFramingTokens: number;
  safetyMarginTokens: number;
  compactionReserveTokens: number;
}

export interface PromptRequestBudgetManifest extends Omit<ModelContextEntry, "provider" | "modelId"> {
  provider: string;
  modelId: string;
  toolSchemaTokens: number;
  historyTokens: number;
  providerFramingTokens: number;
  safetyMarginTokens: number;
  compactionReserveTokens: number;
  availablePromptTokens: number;
  totalRequestTokens: number;
  requiredRequestTokens: number;
}

export interface PromptToolProfile {
  /** The harness-enforced allow list. Empty means no generic tools. */
  allowedTools: string[];
  /** Explicitly blocked tools are retained for audit even when not allowed. */
  blockedTools: string[];
  /** CAT writes are never inferred from natural language. */
  writeMode: "none" | "proposal_only" | "qa_only" | "central_writer";
  /** Optional profile revision, useful when replaying a run. */
  profileId?: string;
}

export interface PromptContextPacket {
  /** Stable ids make context manifests replayable without copying raw files. */
  artifactRefs?: string[];
  hardConstraints?: string[];
  evidence?: string[];
  styleGuidance?: string[];
  priorFindings?: string[];
  /** A typed task payload (source/segment metadata, role input, etc.). */
  task?: string;
  /** Reference material is opt-in; eval generation must leave it undefined. */
  reference?: string[];
  transcript?: string;
}

export interface PromptCompileInput {
  surface: PromptSurface;
  taskRecipe: string;
  roleRecipe?: string;
  constitution?: string;
  context: PromptContextPacket;
  toolProfile: PromptToolProfile;
  /** Required for a launchable v2 request. */
  requestBudget?: PromptRequestBudget;
  /** Legacy prompt-only limit. It remains readable but cannot launch a v2 Run. */
  tokenBudget?: number;
}

export interface PromptManifest {
  surface: PromptSurface;
  /** Present only on legacy prompt-only manifests. */
  tokenBudget?: number;
  estimateScope: "compiled_business_prompt" | "complete_request_v2";
  /** Complete v2 request accounting. Undefined keeps historical manifests readable. */
  requestBudget?: PromptRequestBudgetManifest;
  tokenEstimate: number;
  /** Undefined means no limit was asserted, not that the prompt "passed". */
  overBudget?: boolean;
  truncationReason?: string;
  omittedSections: string[];
  hardConstraintsPreserved: boolean;
  referenceIncluded: boolean;
  toolProfile: PromptToolProfile;
  constitutionHash: string;
  recipeHash: string;
  contextHash: string;
  policyHash: string;
  promptHash: string;
}

export interface CompiledPrompt {
  /** The system-facing portion (constitution + role recipe + task recipe). */
  systemPrompt: string;
  /** The typed context portion, kept separately for inspection/replay. */
  contextPrompt: string;
  /** Exact text to send to the model when the provider has one prompt field. */
  effectivePrompt: string;
  manifest: PromptManifest;
}

export type PromptLaunchPlan =
  | { kind: "ready"; compiled: CompiledPrompt }
  | { kind: "needs_compaction"; requiredTokens: number; availableTokens: number; removableSections: string[] }
  | { kind: "blocked"; reason: "unknown_model_context" | "incomplete_request_budget" | "mandatory_prompt_exceeds_budget" | "tool_schema_exceeds_budget" };

export function planPromptLaunch(compiled: CompiledPrompt): PromptLaunchPlan {
  if (compiled.manifest.requestBudget
    && compiled.manifest.requestBudget.toolSchemaTokens >= compiled.manifest.requestBudget.contextWindow - compiled.manifest.requestBudget.outputReserveTokens) {
    return { kind: "blocked", reason: "tool_schema_exceeds_budget" };
  }
  if (compiled.manifest.overBudget) return { kind: "blocked", reason: "mandatory_prompt_exceeds_budget" };
  if (!compiled.manifest.requestBudget) {
    return { kind: "blocked", reason: compiled.manifest.tokenBudget === undefined ? "unknown_model_context" : "incomplete_request_budget" };
  }
  if (compiled.manifest.omittedSections.length) {
    return {
      kind: "needs_compaction",
      requiredTokens: compiled.manifest.requestBudget.requiredRequestTokens,
      availableTokens: compiled.manifest.requestBudget.contextWindow,
      removableSections: [...compiled.manifest.omittedSections],
    };
  }
  return { kind: "ready", compiled };
}

export class PromptCompileError extends Error {
  readonly code: "invalid_surface" | "empty_recipe" | "reference_not_allowed" | "invalid_request_budget";

  constructor(code: PromptCompileError["code"], message: string) {
    super(message);
    this.name = "PromptCompileError";
    this.code = code;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/**
 * Stable provider-neutral estimate used only before real usage exists.
 * UTF-8 bytes avoid the severe undercount produced by `text.length / 4` for
 * Chinese and other multibyte scripts. Provider usage remains authoritative.
 */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function nonEmpty(value: string | undefined): string {
  return value?.trim() ?? "";
}

function escapeUntrustedSource(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

function untrustedSource(sourceId: string, value: string): string {
  const sha256 = createHash("sha256").update(value, "utf8").digest("hex");
  return `<untrusted_source source_id="${sourceId}" sha256="${sha256}" mime="text/plain" truncated="false">\n${escapeUntrustedSource(value)}\n</untrusted_source>`;
}

function listSection(title: string, rows: string[] | undefined, sourcePrefix?: string): string | undefined {
  const values = (rows ?? []).map((row) => row.trim()).filter(Boolean);
  return values.length
    ? [`# ${title}`, ...values.map((row, index) => sourcePrefix ? untrustedSource(`${sourcePrefix}-${index + 1}`, row) : `- ${row}`)].join("\n")
    : undefined;
}

function contextSections(context: PromptContextPacket): Array<{ id: string; text: string; mandatory?: boolean }> {
  const sections: Array<{ id: string; text: string; mandatory?: boolean }> = [];
  const hard = listSection("Hard Constraints", context.hardConstraints);
  if (hard) sections.push({ id: "hard_constraints", text: hard, mandatory: true });
  const task = nonEmpty(context.task);
  if (task) sections.push({ id: "task", text: `# Typed task context\n${untrustedSource("task-1", task)}`, mandatory: true });
  const artifactRefs = listSection("Artifact references", context.artifactRefs);
  if (artifactRefs) sections.push({ id: "artifact_refs", text: artifactRefs });
  const evidence = listSection("Evidence", context.evidence, "evidence");
  if (evidence) sections.push({ id: "evidence", text: evidence });
  const style = listSection("Style Guide / Genre Guidance", context.styleGuidance, "style-guidance");
  if (style) sections.push({ id: "style_guidance", text: style });
  const findings = listSection("Prior Findings", context.priorFindings, "prior-finding");
  if (findings) sections.push({ id: "prior_findings", text: findings });
  const refs = listSection("Reference material", context.reference, "reference");
  if (refs) sections.push({ id: "reference", text: refs });
  const transcript = nonEmpty(context.transcript);
  if (transcript) sections.push({ id: "transcript", text: `# Transcript (advisory)\n${untrustedSource("transcript-1", transcript)}` });
  return sections;
}

function fitContext(
  sections: Array<{ id: string; text: string; mandatory?: boolean }>,
  budget: number,
): { prompt: string; omitted: string[]; truncationReason?: string; hardConstraintsPreserved: boolean } {
  const omitted: string[] = [];
  const mandatory = sections.filter((section) => section.mandatory);
  const optional = sections.filter((section) => !section.mandatory);
  const separator = "\n\n";
  const mandatoryText = mandatory.map((section) => section.text).join(separator);
  const mandatoryTokens = estimatePromptTokens(mandatoryText);
  const chunks = [mandatoryText];
  let used = mandatoryTokens;
  for (const section of optional) {
    const candidate = `${section.text}${separator}`;
    const next = estimatePromptTokens(candidate);
    if (used + next > budget) {
      omitted.push(section.id);
      continue;
    }
    chunks.push(section.text);
    used += next;
  }
  const prompt = chunks.filter(Boolean).join(separator);
  const overBudget = estimatePromptTokens(prompt) > budget;
  const hardConstraintsPreserved = mandatory.every((section) => prompt.includes(section.text));
  return {
    prompt,
    omitted,
    truncationReason: omitted.length || overBudget
      ? `${overBudget ? `context exceeded token budget ${budget}` : "optional sections omitted"}; ${hardConstraintsPreserved ? "preserve hard constraints" : "hard constraints could not be preserved"}`
      : undefined,
    hardConstraintsPreserved,
  };
}

function resolveRequestBudget(input: PromptRequestBudget | undefined): PromptRequestBudgetManifest | undefined {
  if (!input) return undefined;
  const entry = input.registry.resolve(input.provider, input.modelId);
  if (!entry) return undefined;
  const costs = [
    input.toolSchemaTokens,
    input.historyTokens,
    input.providerFramingTokens,
    input.safetyMarginTokens,
    input.compactionReserveTokens,
  ];
  if (costs.some((value) => !validTokenCount(value))) {
    throw new PromptCompileError("invalid_request_budget", "Request budget costs must be non-negative integers.");
  }
  const availablePromptTokens = entry.contextWindow - entry.outputReserveTokens - costs.reduce((total, value) => total + value, 0);
  return {
    ...entry,
    toolSchemaTokens: input.toolSchemaTokens,
    historyTokens: input.historyTokens,
    providerFramingTokens: input.providerFramingTokens,
    safetyMarginTokens: input.safetyMarginTokens,
    compactionReserveTokens: input.compactionReserveTokens,
    availablePromptTokens,
    totalRequestTokens: entry.contextWindow - availablePromptTokens,
    requiredRequestTokens: entry.contextWindow - availablePromptTokens,
  };
}

/**
 * Compile a prompt and produce a replay/audit manifest. This is intentionally
 * side-effect free so Team, CAT, and private Eval can share the exact seam.
 */
export function compilePrompt(input: PromptCompileInput): CompiledPrompt {
  if (!PROMPT_SURFACES.includes(input.surface)) throw new PromptCompileError("invalid_surface", `Unknown prompt surface ${String(input.surface)}.`);
  const taskRecipe = nonEmpty(input.taskRecipe);
  if (!taskRecipe) throw new PromptCompileError("empty_recipe", "taskRecipe must not be empty.");
  if (input.surface === "eval_generate" && (input.context.reference ?? []).some((item) => item.trim().length > 0)) {
    throw new PromptCompileError("reference_not_allowed", "eval_generate prompts cannot include withheld reference material.");
  }
  const roleRecipe = nonEmpty(input.roleRecipe);
  const constitution = nonEmpty(input.constitution) || "Linguist Agent CAT surface. Follow the typed context and tool profile. Preserve immutable delivery constraints.";
  const requestBudget = resolveRequestBudget(input.requestBudget);
  const budget = requestBudget?.availablePromptTokens ?? input.tokenBudget;
  const systemSections = [constitution, roleRecipe, taskRecipe].filter(Boolean);
  const systemPrompt = systemSections.join("\n\n");
  const systemTokens = estimatePromptTokens(systemPrompt);
  const contextBudget = budget === undefined ? Number.POSITIVE_INFINITY : Math.max(1, budget - systemTokens);
  // Only a caller that explicitly supplies an evidence-backed budget opts in
  // to fitting optional context. No default number is allowed to masquerade as
  // a product or quality threshold.
  const sections = contextSections(input.context);
  const fitted = fitContext(sections, contextBudget);
  const contextPrompt = fitted.prompt;
  const effectivePrompt = [systemPrompt, contextPrompt].filter(Boolean).join("\n\n");
  const promptTokens = estimatePromptTokens(effectivePrompt);
  const totalRequestTokens = requestBudget
    ? promptTokens + requestBudget.outputReserveTokens + requestBudget.toolSchemaTokens + requestBudget.historyTokens
      + requestBudget.providerFramingTokens + requestBudget.safetyMarginTokens + requestBudget.compactionReserveTokens
    : promptTokens;
  const requiredPrompt = [systemPrompt, sections.map((section) => section.text).join("\n\n")].filter(Boolean).join("\n\n");
  const requiredRequestTokens = requestBudget
    ? estimatePromptTokens(requiredPrompt) + requestBudget.outputReserveTokens + requestBudget.toolSchemaTokens + requestBudget.historyTokens
      + requestBudget.providerFramingTokens + requestBudget.safetyMarginTokens + requestBudget.compactionReserveTokens
    : undefined;
  const manifest: PromptManifest = {
    surface: input.surface,
    tokenBudget: budget,
    estimateScope: requestBudget ? "complete_request_v2" : "compiled_business_prompt",
    requestBudget: requestBudget
      ? { ...requestBudget, totalRequestTokens, requiredRequestTokens: requiredRequestTokens! }
      : undefined,
    tokenEstimate: totalRequestTokens,
    overBudget: budget === undefined ? undefined : promptTokens > budget || (requestBudget !== undefined && totalRequestTokens > requestBudget.contextWindow),
    truncationReason: fitted.truncationReason,
    omittedSections: fitted.omitted,
    hardConstraintsPreserved: fitted.hardConstraintsPreserved,
    referenceIncluded: (input.context.reference ?? []).some((item) => item.trim().length > 0),
    toolProfile: {
      ...input.toolProfile,
      allowedTools: [...input.toolProfile.allowedTools],
      blockedTools: [...input.toolProfile.blockedTools],
    },
    constitutionHash: hash(constitution),
    recipeHash: hash({ roleRecipe, taskRecipe }),
    contextHash: hash(input.context),
    policyHash: hash(input.toolProfile),
    promptHash: hash(effectivePrompt),
  };
  return { systemPrompt, contextPrompt, effectivePrompt, manifest };
}
