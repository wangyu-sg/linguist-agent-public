import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatQualityAuditMarkdown, recordQualityFindingWaiver, runQualityAudit, buildBatchConstraintPack, buildSegmentConstraintPackSnapshot, type CatWorkspace } from "@linguist-agent/cat-data";

const qualityAuditParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to audit (an imported batch_id)." }),
  includeMarkdown: Type.Optional(Type.Boolean({ description: "Include the Markdown report in the tool output." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for open findings." })),
  limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 200, description: "Open findings to return in this page." })),
});

const qualityWaiverParameters = Type.Object({
  batchId: Type.String({ description: "Batch id that owns the quality finding (an imported batch_id)." }),
  segmentId: Type.String({ description: "Segment id whose quality finding the user explicitly accepted." }),
  findingId: Type.String({ description: "Exact quality finding id from quality_audit (the finding.id field)." }),
  code: Type.String({ description: "Exact quality finding code to waive, such as TERM_PREFERRED_MISSING or TM_EXACT_TARGET_MISMATCH." }),
  reason: Type.String({ description: "Short human reason for accepting this quality risk; required and recorded in the waiver audit." }),
  acceptedBy: Type.Optional(Type.String({ description: "Optional reviewer/user name recorded in the waiver audit." })),
});

export function createQualityAuditTool(workspace: CatWorkspace) {
  return defineTool<typeof qualityAuditParameters>({
    name: "quality_audit",
    label: "Quality Audit",
    description:
      "Run the mechanical CAT quality audit on a batch: termbase/glossary preferred-term misses, exact high-authority TM mismatches, and exact-TM conflicts become blockers or warnings.",
    promptSnippet: "quality_audit: mechanical termbase/glossary/exact-TM quality gate after draft/proposal writes and before edit/proof/delivery.",
    promptGuidelines: [
      "Use quality_audit after first-pass draft writes and after applying proposal batches, and before final delivery.",
      "Treat open termbase/glossary preferred-term and exact-TM findings as mechanical CAT issues to fix or explicitly waive before export.",
      "Do not treat ignored findings as hidden; mention the accepted risk if it affects handoff.",
      "Page open findings until Next start is none; includeMarkdown=true returns the complete human-readable report when explicitly needed.",
    ],
    parameters: qualityAuditParameters,
    async execute(_id, params) {
      const report = await runQualityAudit(workspace.root, workspace.projectId, params.batchId);
      const open = report.findings.filter((finding) => finding.status === "open");
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 50)));
      const page = open.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + page.length < open.length ? start + page.length : null;
      const head = `Quality audit · ${params.batchId} · ${report.status} · ${report.summary.openBlockers} blocker(s), ${report.summary.openWarnings} warning(s), ${report.summary.ignored} ignored.`;
      const lines = page
        .map((finding) => `- ${finding.segmentId}: ${finding.code} · ${finding.message}`);
      const markdown = params.includeMarkdown ? ["", formatQualityAuditMarkdown(report)].join("\n") : "";
      return {
        content: [{ type: "text" as const, text: [head, `Showing ${page.length}/${open.length} open finding(s) from ${start}.`, ...lines, `Next start: ${nextStart ?? "none"}.`, markdown].filter(Boolean).join("\n") }],
        details: {
          status: report.status,
          blockers: report.summary.openBlockers,
          warnings: report.summary.openWarnings,
          ignored: report.summary.ignored,
          findings: report.findings.length,
          openFindings: open.length,
          start,
          returned: page.length,
          nextStart,
        },
      };
    },
  });
}

export function createQualityWaiverTool(workspace: CatWorkspace) {
  return defineTool<typeof qualityWaiverParameters>({
    name: "quality_waiver",
    label: "Accept Quality Risk",
    description:
      "Record an explicit user-approved waiver for one quality_audit finding on one segment. The finding becomes ignored but stays visible in reports; it does not erase the underlying issue.",
    promptSnippet:
      "quality_waiver: persist a user-approved waiver for one quality_audit finding (batchId/segmentId/findingId/code) before re-running quality_audit.",
    promptGuidelines: [
      "Use only after showing the quality finding to the user or receiving an explicit instruction that the specific finding is acceptable.",
      "Record the exact findingId and code from quality_audit; do not waive findings you have not surfaced.",
      "Run quality_audit again after accepting the risk; the waived finding becomes ignored but remains visible in the audit report.",
      "This is the quality-side counterpart to delivery_accept_risk; both require a reason and leave an auditable record.",
    ],
    parameters: qualityWaiverParameters,
    async execute(_id, params) {
      const { waivers } = await recordQualityFindingWaiver(workspace.root, workspace.projectId, {
        batchId: params.batchId,
        segmentId: params.segmentId,
        findingId: params.findingId,
        code: params.code,
        reason: params.reason,
        acceptedBy: params.acceptedBy,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `# Quality Risk Accepted`,
              ``,
              `Batch: ${params.batchId}`,
              `Segment: ${params.segmentId}`,
              `Finding: ${params.findingId}`,
              `Code: ${params.code}`,
              `Reason: ${params.reason}`,
              `Project quality waivers: ${waivers.length}`,
              ``,
              `The finding is now ignored but stays visible in quality_audit reports. Run quality_audit again before export.`,
            ].join("\n"),
          },
        ],
        details: { waivers },
      };
    },
  });
}

const expressiveAuditParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to audit (an imported batch_id)." }),
  includeMarkdown: Type.Optional(Type.Boolean({ description: "Include the Markdown report in the tool output." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for open expressive findings." })),
  limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 200, description: "Open expressive findings to return in this page." })),
});

const EXPRESSIVE_CODES = new Set(["TRANSLATIONESE_PATTERN", "VOICE_INCONSISTENCY", "REGISTER_MISMATCH"]);

export function createExpressiveAuditTool(workspace: CatWorkspace) {
  return defineTool<typeof expressiveAuditParameters>({
    name: "expressive_audit",
    label: "Expressive Audit",
    description:
      "Run the expressive-layer quality audit (translationese patterns, voice consistency, register mismatch) on a batch. Reuses the quality_audit engine and filters to expressive findings; these are advisory warnings by default and do not block delivery unless a project tunes the threshold.",
    promptSnippet:
      "expressive_audit: expression-layer QA (translationese/voice/register) after draft writes and before review; reuses the quality_audit engine.",
    promptGuidelines: [
      "Use expressive_audit after first-pass draft writes to catch translationese and register drift early, and again before delivery.",
      "These findings are rule-based and advisory by default; they surface register/voice risk rather than block export.",
      "Neither these heuristics nor a model critique proves translationese alone; use them to focus bilingual human/model review and keep false positives reviewable.",
      "For the full mechanical terminology/glossary/exact-TM gate, run quality_audit; this tool is the expression-layer subset.",
      "Page open expressive findings until Next start is none before declaring the batch reviewed.",
    ],
    parameters: expressiveAuditParameters,
    async execute(_id, params) {
      const report = await runQualityAudit(workspace.root, workspace.projectId, params.batchId);
      const expressive = report.findings.filter((finding) => EXPRESSIVE_CODES.has(finding.code));
      const open = expressive.filter((finding) => finding.status === "open");
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 50)));
      const page = open.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + page.length < open.length ? start + page.length : null;
      const head = `Expressive audit · ${params.batchId} · ${open.length} open expressive finding(s) (${report.summary.translationesePatterns} translationese, ${report.summary.voiceInconsistencies} voice, ${report.summary.registerMismatches} register).`;
      const lines = page
        .map((finding) => `- ${finding.segmentId}: ${finding.code} · ${finding.message}`);
      const markdown = params.includeMarkdown ? ["", formatQualityAuditMarkdown(report)].join("\n") : "";
      return {
        content: [{ type: "text" as const, text: [head, `Showing ${page.length}/${open.length} open expressive finding(s) from ${start}.`, ...lines, `Next start: ${nextStart ?? "none"}.`, markdown].filter(Boolean).join("\n") }],
        details: {
          status: report.status,
          openExpressive: open.length,
          translationesePatterns: report.summary.translationesePatterns,
          voiceInconsistencies: report.summary.voiceInconsistencies,
          registerMismatches: report.summary.registerMismatches,
          findings: expressive.length,
          start,
          returned: page.length,
          nextStart,
        },
      };
    },
  });
}

const constraintPackParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to build constraints for (an imported batch_id)." }),
  segmentId: Type.Optional(Type.String({ description: "Optional segment id; when set, return a single per-segment constraint pack instead of the batch pack." })),
  onlyFlagged: Type.Optional(Type.Boolean({ description: "When true (batch mode), restrict to term-sensitive / flagged rows to limit per-segment lookups. Defaults to false." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for constrained segments in batch mode." })),
  limit: Type.Optional(Type.Number({ default: 25, minimum: 1, maximum: 100, description: "Constrained segments to return in this batch-mode page." })),
});

export function createConstraintPackTool(workspace: CatWorkspace) {
  return defineTool<typeof constraintPackParameters>({
    name: "constraint_pack",
    label: "Segment Constraint Pack",
    description:
      "Build per-segment or batch mechanical constraints: termbase, glossary, exact TM, duplicate groups, confirmed project tags, placeholders, numbers, and voice. Per-segment snapshots may include fuzzy TM as advisory context; batch packs avoid fuzzy full scans.",
    promptSnippet:
      "constraint_pack: per-segment termbase/glossary/exact-TM/tag/placeholder/duplicate/voice constraints to satisfy before writing a target; batch mode reuses evidence_pack lookups.",
    promptGuidelines: [
      "Use constraint_pack before translating term-sensitive rows so TM/TB/glossary/tag/placeholder/duplicate/voice constraints are explicit, not buried in context.",
      "For large batches, pass onlyFlagged=true to restrict per-segment lookups to structurally risky rows.",
      "In batch mode, page until Next start is none before claiming constraint coverage; use segmentId for the complete constraints of one row.",
      "Follow each constraint row's typed severity, authority, and binding/advisory status. Only effective binding TM/terminology and code-owned structural blockers are mandatory; fuzzy TM, duplicate, number, voice, and other warning/advisory rows require judgment rather than automatic copying.",
      "The delivery gate re-enforces locks and required tag/placeholder/ICU/newline signatures. Preserve numeric values by default, but an explicit unit/notation conversion remains reviewable through the number QA warning instead of becoming a fabricated delivery blocker.",
    ],
    parameters: constraintPackParameters,
    async execute(_id, params) {
      if (params.segmentId) {
        const pack = await buildSegmentConstraintPackSnapshot(workspace.root, {
          projectId: workspace.projectId,
          batchId: params.batchId,
          segmentId: params.segmentId,
        });
        const head = `Constraint pack · ${params.batchId} · ${params.segmentId} · ${pack.constraints.length} constraint(s) (${pack.summary.blockerConstraints} blocker, ${pack.summary.warningConstraints} warning, ${pack.summary.advisoryConstraints} advisory).`;
        const lines = pack.constraints.map((constraint) => `- ${constraint.kind} · ${constraint.severity}: ${constraint.message ?? ""}`);
        return {
          content: [{ type: "text" as const, text: [head, ...lines].filter(Boolean).join("\n") }],
          details: pack,
        };
      }
      const pack = await buildBatchConstraintPack(workspace.root, {
        projectId: workspace.projectId,
        batchId: params.batchId,
        onlyFlagged: params.onlyFlagged ?? false,
      });
      const head = `Constraint pack · ${params.batchId} · ${pack.summary.segmentsWithConstraints}/${pack.summary.totalSegments} segment(s) with constraints · ${pack.summary.blockerConstraints} blocker, ${pack.summary.warningConstraints} warning, ${pack.summary.advisoryConstraints} advisory.`;
      const constrainedSegments = pack.segments.filter((segment) => segment.constraints.length);
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 25)));
      const page = constrainedSegments.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + page.length < constrainedSegments.length ? start + page.length : null;
      const dense = page
        .map((segment) => `- ${segment.segmentId}: ${segment.constraints.length} constraint(s), ${segment.summary.blockerConstraints} blocker, ${segment.summary.warningConstraints} warning, ${segment.summary.advisoryConstraints} advisory`);
      return {
        content: [{ type: "text" as const, text: [head, `Showing ${page.length}/${constrainedSegments.length} constrained segment(s) from ${start}.`, ...dense, `Next start: ${nextStart ?? "none"}.`].join("\n") }],
        details: { ...pack.summary, start, returned: page.length, totalConstrainedSegments: constrainedSegments.length, nextStart },
      };
    },
  });
}
