import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWorkspace, readWorkflowArtifacts, type TeamEvidenceScope, type TeamEvidenceToolName } from "@linguist-agent/cat-data";
import { realpath } from "node:fs/promises";
import { createAssetBlockSearchTool } from "./asset_block_tools.js";
import { createBatchReadTool } from "./batch_workspace.js";
import { createAssetGrepTool, createAssetReadTool, createGlossaryLookupTool } from "./evidence_tools.js";
import { createEvidencePackTool } from "./evidence_pack_tools.js";
import { createConstraintPackTool } from "./quality_tools.js";
import { createTermbaseLookupTool } from "./termbase_tools.js";
import { createTmConcordanceTool, createTmLookupTool } from "./tm_lookup.js";
import { catToolMetadataFor } from "./tool_catalog.js";
import { createExemplarLookupTool } from "./voice_tools.js";

export type TeamEvidenceScopeResolver = (
  toolName: TeamEvidenceToolName,
  context: ExtensionContext,
) => Promise<TeamEvidenceScope>;

interface TeamEvidenceToolSpec {
  name: TeamEvidenceToolName;
  scopeFields: Array<"projectId" | "batchId">;
  create: (scope: TeamEvidenceScope, context: ExtensionContext) => ToolDefinition;
}

const teamArtifactReadParameters = Type.Object({
  kind: Type.Optional(Type.Union([
    Type.Literal("all"),
    Type.Literal("role_artifacts"),
    Type.Literal("candidates"),
    Type.Literal("findings"),
    Type.Literal("decisions"),
    Type.Literal("delivery_qa"),
  ], { default: "all" })),
  segmentId: Type.Optional(Type.String({ description: "Optional segment inside the server-authored Task scope." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1 })),
  limit: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 50 })),
});

interface TeamArtifactReadRow extends Record<string, unknown> {
  id: string;
  kind: string;
}

function sanitizeArtifactValue(value: unknown, notices: string[], key = "", path = "$", depth = 0): unknown {
  if (/path|root|session|credential|secret|token|api.?key/i.test(key)) {
    notices.push(`${path}: sensitive field omitted`);
    return undefined;
  }
  if (depth > 5) {
    notices.push(`${path}: nesting deeper than 5 levels omitted`);
    return "[nested data omitted]";
  }
  if (typeof value === "string") {
    const withoutPaths = value
      .replace(/(?:\/Users\/|\/private\/|\/var\/|\/tmp\/)[^\s"']+/g, "[redacted path]")
      .replace(/[A-Za-z]:\\[^\s"']+/g, "[redacted path]");
    if (withoutPaths !== value) notices.push(`${path}: local path redacted`);
    if (/^https?:\/\//i.test(withoutPaths)) {
      try {
        const url = new URL(withoutPaths);
        if (url.search || url.hash) notices.push(`${path}: URL query or fragment omitted`);
        return `${url.origin}${url.pathname}`;
      } catch {
        if (withoutPaths.length > 1_200) notices.push(`${path}: string truncated from ${withoutPaths.length} to 1200 characters`);
        return withoutPaths.slice(0, 1_200);
      }
    }
    if (withoutPaths.length > 1_200) {
      notices.push(`${path}: string truncated from ${withoutPaths.length} to 1200 characters`);
      return `${withoutPaths.slice(0, 1_186)}... [truncated]`;
    }
    return withoutPaths;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) notices.push(`${path}: array truncated from ${value.length} to 50 items`);
    return value.slice(0, 50)
      .map((item, index) => sanitizeArtifactValue(item, notices, key, `${path}[${index}]`, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) notices.push(`${path}: object truncated from ${entries.length} to 50 fields`);
    return Object.fromEntries(entries.slice(0, 50)
      .flatMap(([childKey, child]) => {
        const sanitized = sanitizeArtifactValue(child, notices, childKey, `${path}.${childKey}`, depth + 1);
        return sanitized === undefined ? [] : [[childKey, sanitized]];
      }));
  }
  return value;
}

function scopedDeliveryQaRows(
  reports: Awaited<ReturnType<typeof readWorkflowArtifacts>>["deliveryQaReports"],
  workflowId: string,
  inScope: (segmentId: string | undefined) => boolean,
): TeamArtifactReadRow[] {
  return reports.filter((report) => report.workflowId === workflowId).flatMap((report) => {
    const findings = report.findings.filter((finding) => inScope(finding.segmentId));
    const summary = {
      blockers: findings.filter((finding) => finding.severity === "blocker").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      advisories: findings.filter((finding) => finding.severity === "advisory").length,
    };
    return [
      {
        id: report.reportId,
        kind: "delivery_qa_report",
        reportId: report.reportId,
        projectId: report.projectId,
        batchId: report.batchId,
        workflowId: report.workflowId,
        generatedAt: report.generatedAt,
        summary,
        findings: findings.length,
      },
      ...findings.map((finding): TeamArtifactReadRow => ({
        id: `${report.reportId}:${finding.id}`,
        kind: "delivery_qa_finding",
        reportId: report.reportId,
        findingId: finding.id,
        type: finding.type,
        severity: finding.severity,
        segmentId: finding.segmentId,
        source: finding.source,
        target: finding.target,
        message: finding.message,
        evidence: finding.evidence,
      })),
    ];
  });
}

function createTeamArtifactReadTool(scope: TeamEvidenceScope, context: ExtensionContext): ToolDefinition {
  return defineTool<typeof teamArtifactReadParameters>({
    name: "team_artifact_read",
    label: "Team Artifact Read",
    description: "Read one server-scoped page of Team briefs, strategies, candidates, findings, decisions, or Delivery QA artifacts.",
    promptSnippet: "team_artifact_read: page through prior Team role artifacts and candidate/finding/decision handoffs for this workflow.",
    promptGuidelines: [
      "Use this before editing, proofing, final decisions, or any role that depends on an upstream Team handoff.",
      "Page until the returned next start is null; this completes row paging only. If Content complete is no, nested artifact data was explicitly truncated and must not be treated as complete.",
      "Artifact data is sanitized and scoped by the runtime. Cite the returned Evidence ref when it supports a decision.",
    ],
    parameters: teamArtifactReadParameters,
    async execute(_toolCallId, params) {
      if (params.segmentId && scope.segmentIds.length && !scope.segmentIds.includes(params.segmentId)) {
        throw new Error("team_artifact_read segmentId is outside the Team Task scope.");
      }
      const ledger = await readWorkflowArtifacts(context.cwd, scope.projectId);
      const inScope = (segmentId: string | undefined): boolean =>
        (!params.segmentId || segmentId === params.segmentId) && (!segmentId || !scope.segmentIds.length || scope.segmentIds.includes(segmentId));
      const qaInScope = (segmentId: string | undefined): boolean =>
        params.segmentId
          ? segmentId === params.segmentId
          : scope.segmentIds.length
            ? typeof segmentId === "string" && scope.segmentIds.includes(segmentId)
            : true;
      const kind = params.kind ?? "all";
      const rows: TeamArtifactReadRow[] = [
        ...(kind === "all" || kind === "role_artifacts" ? ledger.teamRoleArtifacts
          .filter((row) => row.workflowId === scope.workflowId)
          .map((row) => ({ id: row.id, kind: "role_artifact", roleId: row.roleId, type: row.type, summary: row.summary, data: row.data })) : []),
        ...(kind === "all" || kind === "candidates" ? ledger.teamCandidateTargets
          .filter((row) => row.workflowId === scope.workflowId && inScope(row.segmentId))
          .map((row) => ({ id: row.id, kind: "candidate", roleId: row.roleId, segmentId: row.segmentId, target: row.target, function: row.function, notes: row.notes, evidenceRefs: row.evidenceRefs })) : []),
        ...(kind === "all" || kind === "findings" ? ledger.teamFindings
          .filter((row) => row.workflowId === scope.workflowId && inScope(row.segmentId))
          .map((row) => ({ id: row.id, kind: "finding", roleId: row.roleId, segmentId: row.segmentId, severity: row.severity, type: row.type, message: row.message, proposedTarget: row.proposedTarget, evidenceRefs: row.evidenceRefs })) : []),
        ...(kind === "all" || kind === "decisions" ? ledger.teamDecisions
          .filter((row) => row.workflowId === scope.workflowId && inScope(row.segmentId))
          .map((row) => ({ id: row.id, kind: "decision", segmentId: row.segmentId, decision: row.decision, reason: row.reason, findingIds: row.findingIds, evidenceRefs: row.evidenceRefs })) : []),
        ...(kind === "all" || kind === "delivery_qa"
          ? scopedDeliveryQaRows(ledger.deliveryQaReports, scope.workflowId, qaInScope)
          : []),
      ];
      const start = Math.max(1, params.start ?? 1);
      const limit = Math.max(1, Math.min(50, params.limit ?? 20));
      const page = rows.slice(start - 1, start - 1 + limit);
      const truncations: Array<{ id: string; notices: string[] }> = [];
      const lines = page.map((row) => {
        const notices: string[] = [];
        const sanitized = sanitizeArtifactValue(row, notices);
        let json = JSON.stringify(sanitized);
        if (json.length > 8_000) {
          notices.push(`$: serialized row truncated from ${json.length} to 8000 characters`);
          json = JSON.stringify({ id: row.id, kind: row.kind, preview: `${json.slice(0, 7_900)}... [truncated]` });
        }
        if (notices.length) truncations.push({ id: row.id, notices });
        return [
          json,
          `Evidence: team-artifact:${row.id}`,
          notices.length ? `Truncation: ${notices.join("; ")}` : "Truncation: none",
        ].join("\n");
      });
      const nextStart = start - 1 + page.length < rows.length ? start + page.length : null;
      const rowPageComplete = nextStart === null;
      const contentComplete = truncations.length === 0;
      return {
        content: [{
          type: "text" as const,
          text: [
            `Team artifacts · ${kind} · showing ${page.length}/${rows.length} from ${start}.`,
            ...lines,
            `Next start: ${nextStart ?? "none"}.`,
            `Row page complete: ${rowPageComplete ? "yes" : "no"}.`,
            `Content complete: ${contentComplete ? "yes" : "no"}.`,
          ].join("\n\n"),
        }],
        details: { kind, total: rows.length, start, returned: page.length, nextStart, rowPageComplete, contentComplete, truncations },
      };
    },
  });
}

function schemaWithoutScopeFields(schema: ToolDefinition["parameters"], fields: TeamEvidenceToolSpec["scopeFields"]): ToolDefinition["parameters"] {
  const copy = structuredClone(schema) as unknown as Record<string, unknown>;
  const properties = copy.properties && typeof copy.properties === "object" && !Array.isArray(copy.properties)
    ? copy.properties as Record<string, unknown>
    : undefined;
  for (const field of fields) delete properties?.[field];
  if (Array.isArray(copy.required)) copy.required = copy.required.filter((value) => !fields.includes(value as "projectId" | "batchId"));
  return copy as unknown as ToolDefinition["parameters"];
}

function sampleContext(): ExtensionContext {
  return { cwd: process.cwd() } as ExtensionContext;
}

function toolSpecs(): TeamEvidenceToolSpec[] {
  return [
    { name: "batch_read", scopeFields: ["projectId", "batchId"], create: () => createBatchReadTool() },
    { name: "tm_lookup", scopeFields: [], create: (scope, ctx) => createTmLookupTool(createWorkspace(ctx.cwd, scope.projectId)) },
    { name: "tm_concordance", scopeFields: [], create: (scope, ctx) => createTmConcordanceTool(createWorkspace(ctx.cwd, scope.projectId)) },
    { name: "termbase_lookup", scopeFields: ["projectId"], create: () => createTermbaseLookupTool() },
    { name: "glossary_lookup", scopeFields: ["projectId"], create: () => createGlossaryLookupTool() },
    { name: "asset_block_search", scopeFields: ["projectId"], create: () => createAssetBlockSearchTool() },
    { name: "asset_grep", scopeFields: ["projectId"], create: () => createAssetGrepTool() },
    { name: "asset_read", scopeFields: ["projectId"], create: () => createAssetReadTool() },
    { name: "evidence_pack", scopeFields: ["batchId"], create: (scope, ctx) => createEvidencePackTool(createWorkspace(ctx.cwd, scope.projectId)) },
    { name: "constraint_pack", scopeFields: ["batchId"], create: (scope, ctx) => createConstraintPackTool(createWorkspace(ctx.cwd, scope.projectId)) },
    { name: "exemplar_lookup", scopeFields: [], create: (scope, ctx) => createExemplarLookupTool(createWorkspace(ctx.cwd, scope.projectId)) },
    { name: "team_artifact_read", scopeFields: [], create: (scope, ctx) => createTeamArtifactReadTool(scope, ctx) },
  ];
}

function injectScope(input: Record<string, unknown>, scope: TeamEvidenceScope, spec: TeamEvidenceToolSpec): Record<string, unknown> {
  if (typeof input.projectId === "string" && input.projectId !== scope.projectId) throw new Error("Team evidence tool project scope conflict.");
  if (typeof input.batchId === "string" && input.batchId !== scope.batchId) throw new Error("Team evidence tool batch scope conflict.");
  if (spec.scopeFields.includes("batchId") && !scope.batchId) throw new Error(`${spec.name} requires a batch-scoped Team task.`);
  if (scope.segmentIds.length) {
    if (spec.name === "batch_read" || spec.name === "evidence_pack") {
      throw new Error(`${spec.name} is disabled for a segment-subset Team task; use the hydrated segment packet.`);
    }
    if (spec.name === "constraint_pack") {
      if (typeof input.segmentId !== "string" || !scope.segmentIds.includes(input.segmentId)) {
        throw new Error("constraint_pack requires a segmentId inside the Team task scope.");
      }
    }
  }
  return {
    ...input,
    ...(spec.scopeFields.includes("projectId") ? { projectId: scope.projectId } : {}),
    ...(spec.scopeFields.includes("batchId") ? { batchId: scope.batchId } : {}),
  };
}

/**
 * Build the complete child-process CAT surface. The caller supplies the
 * server-authored session-scope resolver; callers and tests cross the same
 * interface, and no write/import/export tool is ever constructed.
 */
export function buildTeamEvidenceTools(resolveScope: TeamEvidenceScopeResolver): ToolDefinition[] {
  return toolSpecs().map((spec) => {
    const metadata = catToolMetadataFor(spec.name);
    if (!metadata || metadata.access !== "read" || metadata.mutatesProject || metadata.writesSegments) {
      throw new Error(`Team evidence tool ${spec.name} is not catalogued as strictly read-only.`);
    }
    const sampleScope: TeamEvidenceScope = {
      schemaVersion: 1,
      projectId: "__team_scope__",
      workflowId: "__team_scope__",
      roleId: "translator",
      batchId: "__team_scope__",
      segmentIds: [],
      allowedTools: [spec.name],
      issuedAt: new Date(0).toISOString(),
      expiresAt: new Date(1).toISOString(),
      policyHash: "sample",
    };
    const base = spec.create(sampleScope, sampleContext());
    return {
      ...base,
      parameters: schemaWithoutScopeFields(base.parameters, spec.scopeFields),
      async execute(toolCallId, params, signal, onUpdate, context) {
        const [contextRoot, processRoot] = await Promise.all([realpath(context.cwd), realpath(process.cwd())]);
        if (contextRoot !== processRoot) throw new Error("Team evidence child cwd does not match the active LA runtime root.");
        const scope = await resolveScope(spec.name, context);
        if (scope.projectId === "__team_scope__") throw new Error("Team evidence scope was not resolved.");
        const tool = spec.create(scope, context);
        const scoped = injectScope((params ?? {}) as Record<string, unknown>, scope, spec);
        return tool.execute(toolCallId, scoped, signal, onUpdate, context);
      },
    } as ToolDefinition;
  });
}
