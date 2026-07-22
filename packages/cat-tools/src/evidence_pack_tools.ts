import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { buildBatchEvidencePack, type CatWorkspace } from "@linguist-agent/cat-data";

const evidencePackParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to inspect (an imported batch_id)." }),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for the evidence-bearing segment page." })),
  limit: Type.Optional(Type.Number({ default: 25, minimum: 1, maximum: 100, description: "Segments to return in this page." })),
});

export function createEvidencePackTool(workspace: CatWorkspace) {
  return defineTool<typeof evidencePackParameters>({
    name: "evidence_pack",
    label: "Evidence Pack",
    description: "Build a batch-wide TM/TB/glossary evidence pack that separates exact TM with effective authority from fuzzy advisory matches for every segment.",
    promptSnippet: "evidence_pack: batch-wide TM/TB/glossary evidence before translation/review; obey exact TM only when its typed authority binds, and treat fuzzy TM as advisory.",
    promptGuidelines: [
      "Use evidence_pack at the start of TM/TB-heavy batches so exact TM, termbase, glossary, and their typed authority are visible before writing.",
      "Treat tmExact as traditional CAT authority to cite and satisfy; treat tmFuzzy as a scored suggestion to inspect, not as an automatic overwrite or blocker.",
      "Use segment-specific evidence from the pack as planning context; still cite concrete TM/TB/glossary/tool evidence when writing proposals.",
      "Page until Next start is none before claiming batch-wide evidence coverage.",
    ],
    parameters: evidencePackParameters,
    async execute(_id, params) {
      const pack = await buildBatchEvidencePack(workspace.root, {
        projectId: workspace.projectId,
        batchId: params.batchId,
      });
      const evidenceSegments = pack.segments.filter((segment) => segment.cards.length);
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 25)));
      const page = evidenceSegments.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + page.length < evidenceSegments.length ? start + page.length : null;
      const dense = page
        .map((segment) => `- ${segment.segmentId}: tmExact=${segment.summary.tmExact}, tmFuzzy=${segment.summary.tmFuzzy}, tb=${segment.summary.termbase}, glossary=${segment.summary.glossary}`);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Evidence pack · ${params.batchId} · ${pack.summary.segmentsWithEvidence}/${pack.summary.totalSegments} segment(s) have evidence · ${pack.summary.cards} card(s).`,
              `Totals: tmExact=${pack.summary.tmExact}, tmFuzzy=${pack.summary.tmFuzzy}, termbase=${pack.summary.termbase}, glossary=${pack.summary.glossary}.`,
              `Showing ${page.length}/${evidenceSegments.length} evidence-bearing segment(s) from ${start}.`,
              ...dense,
              `Next start: ${nextStart ?? "none"}.`,
            ].join("\n"),
          },
        ],
        details: { ...pack.summary, start, returned: page.length, totalEvidenceSegments: evidenceSegments.length, nextStart },
      };
    },
  });
}
