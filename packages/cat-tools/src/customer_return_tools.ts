import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatCustomerReturnMarkdown, learnCustomerReturn, type CatWorkspace } from "@linguist-agent/cat-data";

const customerReturnLearnParameters = Type.Object({
  batchId: Type.String({ description: "Batch id that the customer return belongs to." }),
  xlsxPath: Type.String({ description: "Customer-return XLSX path with SegmentID/Source/Target columns." }),
  importReviewedTm: Type.Optional(Type.Boolean({ description: "Import changed rows as reviewed TM for future exact-match gating. Defaults to true." })),
});

export function createCustomerReturnLearnTool(workspace: CatWorkspace) {
  return defineTool<typeof customerReturnLearnParameters>({
    name: "customer_return_learn",
    label: "Learn Customer Return",
    description: "Compare a customer-return XLSX against the current batch, persist changed rows, and optionally import them as reviewed TM.",
    promptSnippet: "customer_return_learn: make customer-return changes future TM authority.",
    promptGuidelines: [
      "Use this only after the user identifies a customer-return file for the selected batch.",
      "Do not mutate current batch targets; this records customer authority and reviewed TM for future QA gates.",
      "Summarize changed rows and whether reviewed TM was updated.",
    ],
    parameters: customerReturnLearnParameters,
    async execute(_id, params) {
      const report = await learnCustomerReturn(workspace.root, {
        projectId: workspace.projectId,
        batchId: params.batchId,
        xlsxPath: params.xlsxPath,
        importReviewedTm: params.importReviewedTm,
      });
      return {
        content: [{ type: "text" as const, text: formatCustomerReturnMarkdown(report) }],
        details: {
          changedRows: report.changedRows,
          reviewedTmUpdated: report.reviewedTmUpdated,
        },
      };
    },
  });
}
