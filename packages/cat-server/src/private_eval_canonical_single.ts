import { createHash } from "node:crypto";
import {
  compilePrompt,
  type PrivateEvalExecutionManifest,
  type PrivateEvalRunOutput,
  type PrivateEvalSegment,
  type PrivateEvalThinkingLevel,
  type PrivateEvalUsage,
  type PromptManifest,
} from "@linguist-agent/cat-data";
import type { AgentRunOptions } from "@linguist-agent/cat-runtime";

export type PrivateEvalCanonicalSegment = Pick<
  PrivateEvalSegment,
  "segmentId" | "source" | "tags" | "riskTypes" | "tmRefs" | "termRefs"
>;

export interface PrivateEvalCanonicalSingleGenerationInput {
  projectId: string;
  prompt: string;
  modelProvider?: string;
  modelId?: string;
  runOptions: AgentRunOptions;
  parentRunId: string;
  thinkingLevel: PrivateEvalThinkingLevel;
  timeoutMs?: number;
}

export interface PrivateEvalCanonicalSingleGenerationResult {
  text: string;
  usage?: PrivateEvalUsage;
}

export interface RunPrivateEvalCanonicalSingleInput {
  projectId: string;
  parentRunId: string;
  evalSetId: string;
  segments: PrivateEvalCanonicalSegment[];
  sourceLocale: string;
  targetLocale: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel: PrivateEvalThinkingLevel;
  generate: (input: PrivateEvalCanonicalSingleGenerationInput) => Promise<PrivateEvalCanonicalSingleGenerationResult>;
}

export type PrivateEvalCanonicalSingleOutput = Pick<
  PrivateEvalRunOutput,
  "target" | "notes" | "rawResponse" | "promptManifest" | "executionManifest" | "usage"
>;

interface ParsedCandidate {
  segmentId: string;
  target: string;
  notes?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function balancedJsonObjects(text: string): string[] {
  const candidates: string[] = [];
  for (let start = text.indexOf("{"); start >= 0; ) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) { end = index + 1; break; }
      }
    }
    if (end > start) candidates.push(text.slice(start, end));
    start = text.indexOf("{", Math.max(start + 1, end));
  }
  return candidates;
}

function parseCandidates(text: string, expectedIds: string[]): ParsedCandidate[] {
  let parsedRows: unknown[] | undefined;
  for (const candidate of balancedJsonObjects(text).reverse()) {
    try {
      const parsed = JSON.parse(candidate) as { candidates?: unknown };
      if (Array.isArray(parsed.candidates)) { parsedRows = parsed.candidates; break; }
    } catch {
      // A model may emit a partial object before the final valid envelope.
    }
  }
  if (!parsedRows) throw new Error("Canonical Single returned no JSON candidates envelope.");
  const rows = parsedRows.map((value, index): ParsedCandidate => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Canonical Single candidate ${index + 1} must be an object.`);
    const row = value as Record<string, unknown>;
    if (typeof row.segmentId !== "string" || !row.segmentId.trim()) throw new Error(`Canonical Single candidate ${index + 1} requires segmentId.`);
    if (typeof row.target !== "string" || !row.target.trim()) throw new Error(`Canonical Single candidate ${row.segmentId} requires target.`);
    if (row.notes !== undefined && row.notes !== null && typeof row.notes !== "string") throw new Error(`Canonical Single candidate ${row.segmentId} notes must be a string.`);
    return { segmentId: row.segmentId, target: row.target, notes: typeof row.notes === "string" ? row.notes : undefined };
  });
  const actualIds = rows.map((row) => row.segmentId);
  const duplicates = actualIds.filter((id, index) => actualIds.indexOf(id) !== index);
  const missing = expectedIds.filter((id) => !actualIds.includes(id));
  const extra = actualIds.filter((id) => !expectedIds.includes(id));
  if (duplicates.length || missing.length || extra.length || rows.length !== expectedIds.length) {
    throw new Error(`Canonical Single candidate coverage mismatch: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}; duplicate=${[...new Set(duplicates)].join(",") || "none"}.`);
  }
  return rows;
}

/** Run one source-only, no-tool Pi call over the same batch packet used for Team quality comparison. */
export async function runPrivateEvalCanonicalSingle(
  input: RunPrivateEvalCanonicalSingleInput,
): Promise<Map<string, PrivateEvalCanonicalSingleOutput>> {
  if (!input.segments.length) return new Map();
  const scoped = input.segments.map((segment, index) => ({
    original: segment,
    segmentId: `eval-${String(index + 1).padStart(4, "0")}`,
  }));
  const compiled = compilePrompt({
    surface: "eval_generate",
    taskRecipe: [
      "Translate the complete batch as one coherent professional game-localization task.",
      "Use cross-segment context for terminology, voice, and UI consistency, while translating each source exactly once.",
      "Return only one JSON object: {\"candidates\":[{\"segmentId\":\"eval-0001\",\"target\":\"...\",\"notes\":\"optional short exception-only note\"}]}",
      "Return exactly one candidate for every supplied alias, with no missing, duplicate, reordered identity, or extra aliases.",
      "Do not mention or infer withheld reference, reviewed, or customer-return translations.",
    ].join("\n"),
    context: {
      task: JSON.stringify({
        locale: { source: input.sourceLocale, target: input.targetLocale },
        segments: scoped.map(({ original, segmentId }) => ({
          segmentId,
          source: original.source,
          ...(original.tags.length ? { tags: original.tags } : {}),
          ...(original.riskTypes.length ? { riskTypes: original.riskTypes } : {}),
          ...(original.tmRefs.length ? { tmRefs: original.tmRefs } : {}),
          ...(original.termRefs.length ? { termRefs: original.termRefs } : {}),
        })),
      }),
      hardConstraints: [
        "Reference/reviewed/customer-return targets are unavailable and must remain excluded.",
        "Do not modify CAT batches, project files, or external systems.",
      ],
    },
    toolProfile: {
      allowedTools: [],
      blockedTools: ["reference_vault", "write_file", "batch_set_targets"],
      writeMode: "none",
      profileId: "private-eval:canonical-single-batch",
    },
  });
  // The historical three-minute watchdog was measured on per-segment calls.
  // Batch envelopes need time proportional to output rows, while still
  // retaining a finite upper bound for provider/SDK stalls.
  const deadlineMs = Math.min(10 * 60_000, Math.max(3 * 60_000, 2 * 60_000 + scoped.length * 2_000));
  const generation = await input.generate({
    projectId: input.projectId,
    prompt: compiled.effectivePrompt,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    runOptions: {
      noTools: "all",
      noSession: true,
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
    parentRunId: input.parentRunId,
    thinkingLevel: input.thinkingLevel,
    timeoutMs: deadlineMs,
  });
  const rows = parseCandidates(generation.text.trim(), scoped.map((row) => row.segmentId));
  const byAlias = new Map(rows.map((row) => [row.segmentId, row]));
  const executionManifest: PrivateEvalExecutionManifest = {
    adapter: "canonical_single_batch",
    roleIds: [],
    estimatedCalls: 1,
    actualCalls: 1,
    deadlineMs,
    rolePromptHashes: [],
    thinkingLevel: input.thinkingLevel,
    segmentIdMode: "eval_alias_v1",
    referenceIncluded: false,
    writeMode: "none",
  };
  return new Map(scoped.map(({ original, segmentId }, index) => {
    const candidate = byAlias.get(segmentId)!;
    return [original.segmentId, {
      target: candidate.target,
      notes: candidate.notes,
      rawResponse: JSON.stringify({ segmentId, target: candidate.target, notes: candidate.notes, responseHash: hash(generation.text) }),
      promptManifest: compiled.manifest as PromptManifest,
      executionManifest,
      usage: index === 0 ? generation.usage : undefined,
    }];
  }));
}
