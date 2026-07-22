import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  exportCsvBatch,
  exportGenericXliff,
  exportPhraseBilingualDocx,
  exportPhraseMxliff,
  exportMqxliff,
  exportSdlxliff,
  exportXlsxBatch,
  buildDeliveryReadinessReport,
  runDeliveryCheck,
  upsertDeliveryRiskWaiver,
  type DeliveryReadinessReport,
  type DeliveryReport,
  type ExportResult,
} from "@linguist-agent/cat-data";

const deliveryCheckParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_phrase." }),
});

const deliveryReadinessParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by a supported batch import tool." }),
});

const deliveryAcceptRiskParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by a supported batch import tool." }),
  segmentId: Type.String({ description: "Segment id whose delivery blocker the user explicitly accepted." }),
  code: Type.String({ description: "Exact delivery issue code to waive for this segment, such as TAG_SIGNATURE_MISMATCH." }),
  reason: Type.String({ description: "Short human reason for accepting this delivery risk." }),
  acceptedBy: Type.Optional(Type.String({ description: "Optional reviewer/user name recorded in the waiver audit." })),
});

const exportPhraseMxliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_phrase." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .mxliff path." })),
  role: Type.Optional(
    Type.Union([Type.Literal("T"), Type.Literal("E"), Type.Literal("P")], {
      description: "Native Phrase confirmation to write for LA-reviewed confirmed rows: T=translated (m:confirmed=2), E/P=reviewed (m:confirmed=3). Defaults to E.",
    }),
  ),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportPhraseDocxParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_phrase." }),
  templateDocxPath: Type.String({
    description:
      "Absolute path, or project-root-relative path, to the Phrase bilingual DOCX exported from the same batch. LA updates target cells by segment id.",
  }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .docx path." })),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportMqxliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_mqxliff." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .mqxliff path." })),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportSdlxliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_sdlxliff." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .sdlxliff path." })),
  role: Type.Optional(
    Type.Union([Type.Literal("T"), Type.Literal("E"), Type.Literal("P")], {
      description: "Confirmation level to write: T=Translated, E=ApprovedTranslation, P=ApprovedSignOff.",
    }),
  ),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportXliffParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_xliff." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .xlf/.xliff path." })),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportCsvParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_csv." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .csv path." })),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

const exportXlsxParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  batchId: Type.String({ description: "Batch id created by batch_import_xlsx." }),
  outputPath: Type.Optional(Type.String({ description: "Optional absolute or project-root-relative output .xlsx path." })),
  force: Type.Optional(Type.Boolean({ default: false, description: "Allow export despite delivery blockers only when the user explicitly instructs it." })),
});

function formatIssues(report: DeliveryReport): string {
  const lines: string[] = [];
  for (const issue of [...report.blockers, ...(report.waived ?? []), ...report.warnings]) {
    lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
    if (issue.segmentIds.length) lines.push(`  segments: ${issue.segmentIds.slice(0, 20).join(", ")}${issue.segmentIds.length > 20 ? ` ... (showing 20/${issue.segmentIds.length})` : ""}`);
  }
  return lines.join("\n") || "No blockers, waived risks, or warnings.";
}

function formatDelivery(report: DeliveryReport): string {
  return [
    `# Delivery Check`,
    ``,
    `Batch: ${report.batchId}`,
    `Status: ${report.status}`,
    `Segments: ${report.summary.totalSegments}`,
    `Locked: ${report.summary.lockedSegments}`,
    `Untranslated editable: ${report.summary.untranslatedEditable}`,
    `Unresolved tag segments: ${report.summary.unresolvedTagSegments}`,
    `Tag signature mismatch segments: ${report.summary.tagMismatchSegments}`,
    `Duplicate divergence groups: ${report.summary.duplicateInconsistencyGroups}`,
    `Unapplied proposal rows: ${report.summary.unappliedProposalRows}`,
    `Waived delivery risks: ${report.waived?.length ?? 0}`,
    ``,
    formatIssues(report),
  ].join("\n");
}

function formatReadiness(report: DeliveryReadinessReport): string {
  const fileLines = report.files.map((file) => `- ${file.role}: ${file.status}${file.exists ? ` (${file.size ?? 0} bytes)` : ` missing: ${file.path}`}`);
  const latestExport = report.latestExport
    ? `${report.latestExport.format} at ${report.latestExport.exportedAt} -> ${report.latestExport.outputPath}`
    : "none";
  return [
    `# Delivery Readiness`,
    ``,
    `Batch: ${report.batchId}`,
    `Status: ${report.status}`,
    `Delivery gate: ${report.delivery.status}`,
    `Proposal rows: ${report.proposals.proposed} proposed / ${report.proposals.applied} applied / ${report.proposals.rejected} rejected`,
    `Export audits: ${report.exportAuditCount}`,
    `Latest export: ${latestExport}`,
    ``,
    `## Files`,
    ...fileLines,
    ``,
    `## Next Actions`,
    ...report.nextActions.map((action) => `- ${action}`),
  ].join("\n");
}

function formatExport(result: ExportResult): string {
  return [
    `# Export Complete`,
    ``,
    `Batch: ${result.batchId}`,
    `Format: ${result.format}`,
    `Output: ${result.outputPath}`,
    `Updated segments: ${result.updatedSegments}`,
    result.missingIds.length ? `Missing segment IDs in template: ${result.missingIds.join(", ")}` : `Missing segment IDs in template: none`,
    ``,
    `Delivery status at export: ${result.delivery.status}`,
  ].join("\n");
}

export function createDeliveryCheckTool() {
  return defineTool<typeof deliveryCheckParameters>({
    name: "delivery_check",
    label: "Delivery Check",
    description: "Run deterministic delivery blockers/warnings before exporting a CAT batch.",
    promptSnippet: "delivery_check: verify untranslated editable rows, locked-row safety, unresolved tags, and duplicate consistency.",
    promptGuidelines: [
      "Run delivery_check before exporting or claiming a batch is ready.",
      "Treat blockers as stop signs unless the user explicitly asks for an emergency export.",
      "Warnings should be explained to the user with affected segment ids.",
    ],
    parameters: deliveryCheckParameters,
    async execute(_toolCallId, params) {
      const report = await runDeliveryCheck(process.cwd(), params.projectId, params.batchId);
      return {
        content: [{ type: "text", text: formatDelivery(report) }],
        details: report,
      };
    },
  });
}

export function createDeliveryReadinessTool() {
  return defineTool<typeof deliveryReadinessParameters>({
    name: "delivery_readiness",
    label: "Delivery Readiness",
    description: "Summarize delivery gate, proposal state, source/master file availability, and latest export audit for one batch.",
    promptSnippet: "delivery_readiness: one-shot pre-handoff summary combining delivery_check, proposals, file freshness, and export audit.",
    promptGuidelines: [
      "Use delivery_readiness before telling the user a batch is ready to hand off.",
      "Do not treat a previous export as current if delivery or proposals changed afterward; inspect the report and nextActions.",
      "If status is fail or warn, state the exact next deterministic action before export.",
    ],
    parameters: deliveryReadinessParameters,
    async execute(_toolCallId, params) {
      const report = await buildDeliveryReadinessReport(process.cwd(), params.projectId, params.batchId);
      return {
        content: [{ type: "text", text: formatReadiness(report) }],
        details: report,
      };
    },
  });
}

export function createDeliveryAcceptRiskTool() {
  return defineTool<typeof deliveryAcceptRiskParameters>({
    name: "delivery_accept_risk",
    label: "Accept Delivery Risk",
    description: "Record an explicit user-approved waiver for one delivery blocker code on one segment.",
    promptSnippet: "delivery_accept_risk: persist a user-approved delivery waiver for projectId/batchId/segmentId/code before re-running delivery_check.",
    promptGuidelines: [
      "Use only after showing the blocker to the user or receiving an explicit instruction that the specific item is acceptable.",
      "Record the exact delivery issue code and segment id; do not waive broad batches with this tool.",
      "Run delivery_check again after accepting the risk, then export only if no active blockers remain.",
    ],
    parameters: deliveryAcceptRiskParameters,
    async execute(_toolCallId, params) {
      const waivers = await upsertDeliveryRiskWaiver(process.cwd(), params.projectId, {
        batchId: params.batchId,
        segmentId: params.segmentId,
        code: params.code,
        reason: params.reason,
        acceptedBy: params.acceptedBy,
      });
      return {
        content: [{
          type: "text",
          text: [
            `# Delivery Risk Accepted`,
            ``,
            `Batch: ${params.batchId}`,
            `Segment: ${params.segmentId}`,
            `Code: ${params.code}`,
            `Reason: ${params.reason}`,
            `Project waivers: ${waivers.length}`,
          ].join("\n"),
        }],
        details: { waivers },
      };
    },
  });
}

export function createExportPhraseMxliffTool() {
  return defineTool<typeof exportPhraseMxliffParameters>({
    name: "export_phrase_mxliff",
    label: "Export Phrase MXLIFF",
    description: "Export an imported Phrase MXLIFF batch by writing LA targets back to the original MXLIFF file.",
    promptSnippet: "export_phrase_mxliff: write reviewed targets back to Phrase MXLIFF after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_phrase_mxliff.",
      "Use role='E' for reviewed Phrase MXLIFF delivery unless the user explicitly wants translation-stage output.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
      "This preserves untouched Phrase segments byte-for-byte, writes only LA-reviewed rows, and does not write locked-row changes when the delivery gate blocks them.",
    ],
    parameters: exportPhraseMxliffParameters,
    async execute(_toolCallId, params) {
      const result = await exportPhraseMxliff(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportPhraseDocxTool() {
  return defineTool<typeof exportPhraseDocxParameters>({
    name: "export_phrase_docx",
    label: "Export Phrase DOCX",
    description:
      "Export a Phrase bilingual DOCX by updating the target column in the original DOCX template. Use this when Phrase permissions only allow DOCX upload.",
    promptSnippet: "export_phrase_docx: update Phrase bilingual DOCX target cells by segment id after delivery_check passes.",
    promptGuidelines: [
      "Use the DOCX exported from Phrase for the same batch as templateDocxPath.",
      "Run delivery_check before export_phrase_docx.",
      "Do not generate a new DOCX layout from scratch; this tool preserves the Phrase table template and only rewrites target cells.",
    ],
    parameters: exportPhraseDocxParameters,
    async execute(_toolCallId, params) {
      const result = await exportPhraseBilingualDocx(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportMqxliffTool() {
  return defineTool<typeof exportMqxliffParameters>({
    name: "export_mqxliff",
    label: "Export MQXLIFF",
    description: "Export a memoQ MQXLIFF batch by writing LA targets back to the original MQXLIFF file.",
    promptSnippet: "export_mqxliff: write reviewed targets back to memoQ MQXLIFF after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_mqxliff.",
      "Use this only for plain .mqxliff batches imported with batch_import_mqxliff; .mqxlz containers are not supported by this tool.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
      "This preserves memoQ bpt/ept/ph inline carriers by rewrapping LA's readable target text through the source-side tag map.",
    ],
    parameters: exportMqxliffParameters,
    async execute(_toolCallId, params) {
      const result = await exportMqxliff(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportSdlxliffTool() {
  return defineTool<typeof exportSdlxliffParameters>({
    name: "export_sdlxliff",
    label: "Export SDLXLIFF",
    description:
      "Export a Trados SDLXLIFF batch by writing LA targets back to the original SDLXLIFF and mapping T/E/P roles to Trados confirmation levels.",
    promptSnippet: "export_sdlxliff: write reviewed targets back to Trados SDLXLIFF after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_sdlxliff.",
      "Use role='T' for Translated, role='E' for ApprovedTranslation, and role='P' for ApprovedSignOff.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
    ],
    parameters: exportSdlxliffParameters,
    async execute(_toolCallId, params) {
      const result = await exportSdlxliff(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportXliffTool() {
  return defineTool<typeof exportXliffParameters>({
    name: "export_xliff",
    label: "Export XLIFF",
    description: "Export a generic XLIFF 1.2/2.0 batch by writing LA targets back to the original XLIFF file.",
    promptSnippet: "export_xliff: write reviewed targets back to generic XLIFF after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_xliff.",
      "Use this only for batches imported with batch_import_xliff.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
    ],
    parameters: exportXliffParameters,
    async execute(_toolCallId, params) {
      const result = await exportGenericXliff(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportCsvTool() {
  return defineTool<typeof exportCsvParameters>({
    name: "export_csv",
    label: "Export CSV",
    description: "Export a CSV table batch by writing LA targets back to the original CSV table.",
    promptSnippet: "export_csv: write reviewed targets back to CSV after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_csv.",
      "Use this only for batches imported with batch_import_csv.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
    ],
    parameters: exportCsvParameters,
    async execute(_toolCallId, params) {
      const result = await exportCsvBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}

export function createExportXlsxTool() {
  return defineTool<typeof exportXlsxParameters>({
    name: "export_xlsx",
    label: "Export XLSX",
    description: "Export an XLSX table batch by writing LA targets back to the original XLSX table.",
    promptSnippet: "export_xlsx: write reviewed targets back to XLSX after delivery_check passes.",
    promptGuidelines: [
      "Run delivery_check before export_xlsx.",
      "Use this only for batches imported with batch_import_xlsx.",
      "Do not set force=true unless the user explicitly asks to export despite listed blockers.",
    ],
    parameters: exportXlsxParameters,
    async execute(_toolCallId, params) {
      const result = await exportXlsxBatch(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatExport(result) }],
        details: result,
      };
    },
  });
}
