import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  applyProposalSet,
  createProposalSet,
  listProposalSets,
  readProposalSet,
  writeProposalReport,
  type SegmentChangeType,
  type SegmentProposal,
} from "@linguist-agent/cat-data";

const changeTypeSchema = Type.Union([
  Type.Literal("translation"),
  Type.Literal("term"),
  Type.Literal("terminology"),
  Type.Literal("accuracy"),
  Type.Literal("consistency"),
  Type.Literal("style"),
  Type.Literal("fluency"),
  Type.Literal("user_approved"),
  Type.Literal("other"),
]);

const proposalInputSchema = Type.Object({
  segmentId: Type.String(),
  proposedTarget: Type.String(),
  reason: Type.String(),
  changeType: changeTypeSchema,
  evidenceSources: Type.Optional(Type.Array(Type.String())),
  severity: Type.Optional(Type.String()),
});

const proposalCreateParameters = Type.Object({
  projectId: Type.String(),
  batchId: Type.String(),
  proposalSetId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  supersedesProposalSetId: Type.Optional(Type.String()),
  overwrite: Type.Optional(Type.Boolean({ default: false })),
  proposals: Type.Array(proposalInputSchema, { minItems: 1 }),
});

const proposalReadParameters = Type.Object({
  projectId: Type.String(),
  batchId: Type.String(),
  proposalSetId: Type.Optional(Type.String()),
});

const proposalApplyParameters = Type.Object({
  projectId: Type.String(),
  batchId: Type.String(),
  proposalSetId: Type.String(),
  proposalIds: Type.Optional(Type.Array(Type.String())),
  rejectProposalIds: Type.Optional(Type.Array(Type.String())),
  confirm: Type.Optional(Type.Boolean({ default: false })),
  propagateDuplicates: Type.Optional(Type.Boolean({ default: false })),
  rejectUnselected: Type.Optional(Type.Boolean({ default: false })),
});

const proposalReportParameters = Type.Object({
  projectId: Type.String(),
  batchId: Type.String(),
  proposalSetId: Type.String(),
  writeFile: Type.Optional(Type.Boolean({ default: true })),
});

function proposalLine(proposal: SegmentProposal): string {
  return [
    `- ${proposal.proposalId} [${proposal.status}] seg=${proposal.segmentId} type=${proposal.changeType}${proposal.severity ? ` severity=${proposal.severity}` : ""}`,
    `  source: ${proposal.source}`,
    `  original: ${proposal.originalTarget || "(empty)"}`,
    `  proposed: ${proposal.proposedTarget || "(empty)"}`,
    `  reason: ${proposal.reason}`,
    `  evidence: ${proposal.evidenceSources.length ? proposal.evidenceSources.join("; ") : "(none)"}`,
    proposal.skipReason ? `  skip: ${proposal.skipReason}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createProposalCreateTool() {
  return defineTool<typeof proposalCreateParameters>({
    name: "proposal_create",
    label: "Proposal Create",
    description: "Persist a reviewable segment proposal table for a batch without writing targets.",
    promptSnippet: "proposal_create: save proposed target changes as a durable table before apply.",
    promptGuidelines: [
      "Use proposal_create for E/edit or P/proof suggestions before changing client targets. First-pass translation drafts should use batch_set_targets.",
      "Term/terminology-authority proposals require returned evidenceSources; accuracy and consistency proposals may rely on the typed source/target/context.",
      "When a later review pass replaces an earlier proposal set, pass supersedesProposalSetId so the old set is marked superseded.",
      "Do not use proposal_create as evidence by itself; cite TM/glossary/assets in evidenceSources.",
    ],
    parameters: proposalCreateParameters,
    async execute(_toolCallId, params) {
      const result = await createProposalSet(process.cwd(), params.projectId, params.batchId, {
        proposalSetId: params.proposalSetId,
        title: params.title,
        supersedesProposalSetId: params.supersedesProposalSetId,
        overwrite: params.overwrite,
        proposals: params.proposals.map((proposal) => ({
          ...proposal,
          changeType: proposal.changeType as SegmentChangeType,
        })),
      });
      return {
        content: [
          {
            type: "text",
            text: [
              `# Proposal Set Created`,
              ``,
              `Set: ${result.proposalSet.proposalSetId}`,
              `Batch: ${result.proposalSet.batchId}`,
              `Status: ${result.proposalSet.status}`,
              result.proposalSet.supersedesProposalSetId ? `Supersedes: ${result.proposalSet.supersedesProposalSetId}` : undefined,
              `Path: ${result.path}`,
              `Rows: ${result.proposalSet.proposals.length}`,
              `Showing ${Math.min(20, result.proposalSet.proposals.length)}/${result.proposalSet.proposals.length} row(s); use proposal_read for the complete persisted set.`,
              ``,
              result.proposalSet.proposals.slice(0, 20).map(proposalLine).join("\n"),
            ].filter(Boolean).join("\n"),
          },
        ],
        details: result,
      };
    },
  });
}

export function createProposalReadTool() {
  return defineTool<typeof proposalReadParameters>({
    name: "proposal_read",
    label: "Proposal Read",
    description: "List proposal sets for a batch or read one proposal table.",
    promptSnippet: "proposal_read: inspect persisted proposal tables and their apply status.",
    promptGuidelines: [
      "Use proposal_read before applying or reporting review changes.",
      "When proposalSetId is omitted, list available proposal sets.",
    ],
    parameters: proposalReadParameters,
    async execute(_toolCallId, params) {
      if (!params.proposalSetId) {
        const rows = await listProposalSets(process.cwd(), params.projectId, params.batchId);
        return {
          content: [
            {
              type: "text",
              text: [
                `# Proposal Sets`,
                ``,
                rows.length
                  ? rows
                      .map(
                        (row) =>
                          `- ${row.proposalSetId}: ${row.title} · status=${row.status} · proposed=${row.proposed} applied=${row.applied} skipped=${row.skipped} rejected=${row.rejected}${row.supersededByProposalSetId ? ` · superseded_by=${row.supersededByProposalSetId}` : ""} · ${row.updatedAt}`,
                      )
                      .join("\n")
                  : "No proposal sets found.",
              ].join("\n"),
            },
          ],
          details: { rows },
        };
      }
      const proposalSet = await readProposalSet(process.cwd(), params.projectId, params.batchId, params.proposalSetId);
      return {
        content: [
          {
            type: "text",
            text: [
              `# Proposal Set ${proposalSet.proposalSetId}`,
              ``,
              `Title: ${proposalSet.title}`,
              `Status: ${proposalSet.status}`,
              proposalSet.supersedesProposalSetId ? `Supersedes: ${proposalSet.supersedesProposalSetId}` : undefined,
              proposalSet.supersededByProposalSetId ? `Superseded by: ${proposalSet.supersededByProposalSetId}` : undefined,
              `Rows: ${proposalSet.proposals.length}`,
              `Updated: ${proposalSet.updatedAt}`,
              ``,
              proposalSet.proposals.map(proposalLine).join("\n"),
            ].filter(Boolean).join("\n"),
          },
        ],
        details: proposalSet,
      };
    },
  });
}

export function createProposalApplyTool() {
  return defineTool<typeof proposalApplyParameters>({
    name: "proposal_apply",
    label: "Proposal Apply",
    description: "Apply selected proposals through the CAT data-layer write gate.",
    promptSnippet: "proposal_apply: explicitly apply selected proposal rows after user approval.",
    promptGuidelines: [
      "Use proposal_apply only after the user asks to apply selected proposals.",
      "Do not bypass proposal_apply with segment_set_target for review/proof proposal tables.",
      "Locked rows and term/terminology-authority proposals without returned evidence will be skipped by the data layer.",
    ],
    parameters: proposalApplyParameters,
    async execute(_toolCallId, params) {
      const result = await applyProposalSet(process.cwd(), params.projectId, params.batchId, params.proposalSetId, {
        proposalIds: params.proposalIds,
        rejectProposalIds: params.rejectProposalIds,
        confirm: params.confirm,
        propagateDuplicates: params.propagateDuplicates,
        rejectUnselected: params.rejectUnselected,
      });
      return {
        content: [
          {
            type: "text",
            text: [
              `# Proposal Apply Result`,
              ``,
              `Set: ${result.proposalSetId}`,
              `Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`,
              `Rejected: ${result.rejected.length ? result.rejected.join(", ") : "none"}`,
              `Skipped: ${
                result.skipped.length ? result.skipped.map((row) => `${row.proposalId} (${row.reason})`).join("; ") : "none"
              }`,
            ].join("\n"),
          },
        ],
        details: result,
      };
    },
  });
}

export function createProposalReportTool() {
  return defineTool<typeof proposalReportParameters>({
    name: "proposal_report",
    label: "Proposal Report",
    description: "Render a proposal set as a human-reviewable Markdown table and optionally save it under the batch reports folder.",
    promptSnippet: "proposal_report: create a Markdown review table with seg/source/original/proposed/reason/evidence columns.",
    promptGuidelines: [
      "Use proposal_report before asking the user to approve review/proof changes.",
      "The report is for human review only; it does not apply segment changes.",
      "After user approval, call proposal_apply with explicit proposalIds.",
    ],
    parameters: proposalReportParameters,
    async execute(_toolCallId, params) {
      const result = await writeProposalReport(process.cwd(), params.projectId, params.batchId, params.proposalSetId, {
        writeFile: params.writeFile,
      });
      return {
        content: [
          {
            type: "text",
            text: [`# Proposal Report`, ``, result.path ? `Path: ${result.path}` : `Path: not written`, ``, result.markdown].join("\n"),
          },
        ],
        details: result,
      };
    },
  });
}
