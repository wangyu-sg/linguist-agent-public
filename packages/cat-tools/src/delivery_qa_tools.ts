import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { describeSpellingQaCoverage, readSavedDeliveryQaReport, runDeliveryQa, type CatWorkspace, type DeliveryQaReport } from "@linguist-agent/cat-data";

const deliveryQaParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to run Xbench-like deterministic QA on." }),
  workflowId: Type.Optional(Type.String({ description: "Optional team workflow id that owns this QA pass." })),
  reportId: Type.Optional(Type.String({ description: "Existing raw report id to page without running QA again." })),
  includeFindings: Type.Optional(Type.Boolean({ description: "Include this finding page in the text output. Defaults true." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for findings." })),
  limit: Type.Optional(Type.Number({ default: 80, minimum: 1, maximum: 200, description: "Findings to return in this page." })),
});

function formatDeliveryQa(report: DeliveryQaReport, input: { includeFindings: boolean; start: number; limit: number }): { text: string; nextStart: number | null; returned: number } {
  const head = `Delivery QA · ${report.batchId ?? "batch"} · ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s), ${report.summary.advisories} advisory.\n${describeSpellingQaCoverage(report.spelling)}`;
  const page = input.includeFindings ? report.findings.slice(input.start - 1, input.start - 1 + input.limit) : [];
  const nextStart = input.includeFindings && input.start - 1 + page.length < report.findings.length ? input.start + page.length : null;
  const rows = input.includeFindings
    ? page.map((finding) => `- ${finding.severity.toUpperCase()} ${finding.type}${finding.segmentId ? ` · ${finding.segmentId}` : ""}: ${finding.message}`)
    : [];
  return {
    text: [head, input.includeFindings ? `Showing ${page.length}/${report.findings.length} finding(s) from ${input.start}.` : undefined, ...rows, input.includeFindings ? `Next start: ${nextStart ?? "none"}.` : undefined].filter(Boolean).join("\n"),
    nextStart,
    returned: page.length,
  };
}

export function createDeliveryQaTool(workspace: CatWorkspace) {
  return defineTool<typeof deliveryQaParameters>({
    name: "delivery_qa",
    label: "Delivery QA",
    description: "Run the team-workflow Xbench-like deterministic delivery QA report for a batch and persist the raw report.",
    promptSnippet: "delivery_qa: run Xbench-like deterministic QA before Delivery Manager or final handoff; preserves the raw report.",
    promptGuidelines: [
      "Use delivery_qa as the Delivery Manager's deterministic QA pass before Lead Linguist Final review.",
      "Treat blockers as fix-or-query items; do not waive or edit translations from this tool.",
      "Preserve the raw report id so reviewed QA decisions can reference exact findings later.",
      "Run once without reportId, then page that same reportId until Next start is none; do not create a new report just to read the next page.",
    ],
    parameters: deliveryQaParameters,
    async execute(_toolCallId, params) {
      const report = params.reportId
        ? await readSavedDeliveryQaReport(workspace.root, workspace.projectId, params.reportId)
        : await runDeliveryQa(workspace.root, workspace.projectId, params.batchId, params.workflowId);
      if (report.batchId !== params.batchId) throw new Error(`Delivery QA report ${report.reportId} belongs to batch ${report.batchId}, not ${params.batchId}.`);
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 80)));
      const formatted = formatDeliveryQa(report, { includeFindings: params.includeFindings ?? true, start, limit });
      return {
        content: [{ type: "text" as const, text: formatted.text }],
        details: { ...report, start, returned: formatted.returned, nextStart: formatted.nextStart },
      };
    },
  });
}
