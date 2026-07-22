import type { ProjectManifest } from "@linguist-agent/cat-data";

export interface CatCompactionContext {
  projectId: string;
  projectRoot?: string;
  batches?: Array<{
    batchId: string;
    format: string;
    segments: number;
    confirmed: number;
    draft: number;
    new: number;
    locked: number;
  }>;
  customInstructions?: string;
}

export function buildCatCompactionInstructions(context: CatCompactionContext): string {
  const batchLines = context.batches?.length
    ? context.batches
        .map(
          (batch) =>
            `- ${batch.batchId}: ${batch.format}, ${batch.segments} segments, ${batch.confirmed} confirmed, ${batch.draft} draft, ${batch.new} new, ${batch.locked} locked`,
        )
        .join("\n")
    : "- none";
  const custom = context.customInstructions?.trim()
    ? `\n\nAdditional user instructions for this compaction:\n${context.customInstructions.trim()}`
    : "";

  return [
    "Create a CAT-aware Linguist Agent session summary.",
    "",
    "Preserve these facts explicitly:",
    `- Project id: ${context.projectId}`,
    context.projectRoot ? `- Project root: ${context.projectRoot}` : undefined,
    "- Current language direction and client/project preferences mentioned by the user.",
    "- Active/imported batches, their ids, formats, confirmation status, locked-row counts, and any pending work.",
    "- Terminology decisions, approved translations, rejected alternatives, and unresolved terminology questions.",
    "- TM/TB/glossary/asset evidence that directly supported a decision.",
    "- Unapplied proposals, delivery blockers/warnings, tag/lock risks, and export requirements.",
    "- User instructions about workflow, review role, quality bar, and preferred CAT behavior.",
    "",
    "Do not preserve:",
    "- Large raw tool outputs unless they are cited evidence.",
    "- Failed or irrelevant tool traces.",
    "- Repeated status boilerplate.",
    "",
    "Current imported batch snapshot:",
    batchLines,
    custom,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildCatCompactionInstructionsFromManifest(
  manifest: ProjectManifest,
  batches: CatCompactionContext["batches"],
  customInstructions?: string,
): string {
  return buildCatCompactionInstructions({
    projectId: manifest.projectId,
    projectRoot: manifest.root,
    batches,
    customInstructions,
  });
}
