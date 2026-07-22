import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  createProjectManifest,
  buildProjectContextSnapshot,
  formatProjectContextDetailPage,
  formatProjectContextSnapshot,
  readProjectContextDetailPage,
  readProjectManifest,
  refreshProjectManifest,
  runProjectHealthCheck,
  scanProjectFolder,
  type DiscoveredAsset,
  type ProjectManifest,
  type ProjectScanReport,
} from "@linguist-agent/cat-data";

const assetRoleOverrideParameters = Type.Object({
  relPath: Type.String({ description: "Project-root-relative asset path to override." }),
  role: Type.String({ description: "Confirmed asset role, for example termbase, tm, reference, source_table, phrase_mxliff." }),
  status: Type.Optional(Type.Union([Type.Literal("inferred"), Type.Literal("confirmed")], { default: "confirmed" })),
  reason: Type.Optional(Type.String({ description: "Human/wizard reason for the override." })),
});

const projectOnboardParameters = Type.Object({
  rootPath: Type.String({ description: "Absolute or working-directory-relative project folder path to scan." }),
  projectId: Type.Optional(Type.String({ description: "Optional LA project id. Defaults to a slug inferred from the folder name." })),
  projectName: Type.Optional(Type.String({ description: "Optional human-readable project name shown in LA project navigation." })),
  sourceLanguage: Type.String({ minLength: 1, description: "Explicit default source locale for new project imports, for example ja-JP." }),
  targetLanguage: Type.String({ minLength: 1, description: "Explicit default target locale for new project imports, for example fr-FR." }),
  assetRoleOverrides: Type.Optional(Type.Array(assetRoleOverrideParameters)),
  maxDepth: Type.Optional(Type.Number({ default: 6, minimum: 1, maximum: 12 })),
  saveManifest: Type.Optional(Type.Boolean({ default: true, description: "Persist the scan as data/projects/<projectId>/project.json." })),
});

const projectReadParameters = Type.Object({
  projectId: Type.String({ description: "LA project id, for example the id returned by project_onboard." }),
});

const projectRefreshParameters = Type.Object({
  projectId: Type.String({ description: "LA project id to rescan from the saved manifest root." }),
  maxDepth: Type.Optional(Type.Number({ default: 6, minimum: 1, maximum: 12 })),
});

const projectHealthParameters = Type.Object({
  projectId: Type.String({ description: "LA project id to check before starting batch work or delivery." }),
});

const projectContextParameters = Type.Object({
  projectId: Type.String({ description: "LA project id to summarize for current session context." }),
  includeHealth: Type.Optional(Type.Boolean({ default: false, description: "Include project_health readiness summary. Set true before review/delivery decisions." })),
  section: Type.Optional(Type.Union([
    Type.Literal("batches"),
    Type.Literal("confirmed_asset_roles"),
    Type.Literal("warnings"),
    Type.Literal("questions"),
    Type.Literal("missing_assets"),
    Type.Literal("changed_assets"),
    Type.Literal("missing_batch_files"),
  ], { description: "Optional full-detail section to page instead of returning the summary packet." })),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "One-based start row for a detail section." })),
  limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 200, description: "Detail rows to return in this page." })),
});

interface ProjectOnboardDetails {
  manifest: ProjectManifest | null;
  path: string | null;
  scan: ProjectScanReport;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatAsset(asset: DiscoveredAsset): string {
  const metrics = asset.metrics
    ? [
        asset.metrics.transUnits ? `tu:${asset.metrics.transUnits}` : undefined,
        asset.metrics.lockedMarkers ? `locked:${asset.metrics.lockedMarkers}` : undefined,
        asset.metrics.placeholderMarkers ? `placeholders:${asset.metrics.placeholderMarkers}` : undefined,
        asset.metrics.duplicateSourceGroups ? `dup_src:${asset.metrics.duplicateSourceGroups}` : undefined,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return `| ${asset.role} | ${asset.relPath} | ${formatBytes(asset.sizeBytes)} | ${(asset.confidence * 100).toFixed(0)}% | ${metrics || "-"} |`;
}

function formatSuggestedActions(report: ProjectScanReport): string[] {
  const lines: string[] = [];
  lines.push(`## Suggested Actions`);
  if (!report.suggestedActions.length) {
    lines.push("- No concrete action inferred. Ask the user for the source batch, TM, and termbase files.");
    return lines;
  }
  lines.push(`| File | Role | Tool | Action | Prerequisites | Reason |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const action of report.suggestedActions) {
    lines.push(
      `| ${action.assetPath} | ${action.role} | ${action.tool ?? "-"} | ${action.action} | ${
        action.prerequisites.length ? action.prerequisites.join("<br>") : "-"
      } | ${action.reason} |`,
    );
  }
  return lines;
}

function formatReport(report: ProjectScanReport): string {
  const lines: string[] = [];
  lines.push(`# Project Onboarding Scan`);
  lines.push("");
  lines.push(`Root: ${report.root}`);
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push("");
  lines.push(`## Counts`);
  lines.push(Object.entries(report.countsByRole).map(([role, count]) => `${role}:${count}`).join(" · ") || "No files found.");
  lines.push("");
  lines.push(`## Assets`);
  lines.push(`| Role | File | Size | Confidence | Metrics |`);
  lines.push(`|---|---|---:|---:|---|`);
  for (const asset of report.assets) {
    lines.push(formatAsset(asset));
  }
  lines.push("");
  lines.push(`## Phrase Tag Pairing`);
  if (report.phraseTagPairs.length) {
    lines.push(`| MXLIFF | Master XLIFF | Confidence | Reason |`);
    lines.push(`|---|---|---:|---|`);
    for (const pair of report.phraseTagPairs) {
      lines.push(`| ${pair.mxliff} | ${pair.masterXliff ?? "MISSING"} | ${(pair.confidence * 100).toFixed(0)}% | ${pair.reason} |`);
    }
  } else {
    lines.push("No MXLIFF files detected.");
  }
  lines.push("");
  lines.push(`## Import Plan`);
  report.importPlan.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  lines.push("");
  lines.push(...formatSuggestedActions(report));
  lines.push("");
  lines.push(`## Warnings`);
  if (report.warnings.length) report.warnings.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- None.");
  lines.push("");
  lines.push(`## Questions`);
  if (report.questions.length) report.questions.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- No blocking questions detected.");
  return lines.join("\n");
}

function formatManifest(manifest: ProjectManifest, path?: string): string {
  const lines: string[] = [];
  lines.push(`# Project Manifest`);
  lines.push("");
  lines.push(`Project: ${manifest.projectId}`);
  if (manifest.projectName) lines.push(`Name: ${manifest.projectName}`);
  lines.push(`Root: ${manifest.root}`);
  lines.push(`Default languages: ${manifest.sourceLanguage} -> ${manifest.targetLanguage}`);
  lines.push(`Updated: ${manifest.updatedAt}`);
  if (path) lines.push(`Manifest: ${path}`);
  if (manifest.assetRoleDecisions.some((decision) => decision.status === "confirmed")) {
    lines.push("");
    lines.push(`## Confirmed Asset Roles`);
    for (const decision of manifest.assetRoleDecisions.filter((item) => item.status === "confirmed")) {
      lines.push(`- ${decision.relPath}: ${decision.role}`);
    }
  }
  lines.push("");
  lines.push(formatReport(manifest.scan));
  return lines.join("\n");
}

export function createProjectOnboardTool() {
  return defineTool<typeof projectOnboardParameters, ProjectOnboardDetails>({
    name: "project_onboard",
    label: "Project Onboard",
    description:
      "Scan a localization project folder and classify source/bilingual files, TM/TB/glossary/reference assets, Phrase MXLIFF master XLIFF pairs, duplicate-source risks, and import questions.",
    promptSnippet: "project_onboard: scan a customer project folder before importing or editing assets.",
    promptGuidelines: [
      "Call project_onboard when the user gives a project folder or asks to set up a new project.",
      "Use the Phrase tag pairing output before importing MXLIFF files.",
      "Use Suggested Actions as executable next steps; prefer the listed tool path over guessing.",
      "Treat warnings about duplicate source groups and raw placeholders as workflow risks, not final defects.",
      "Ask the listed blocking questions before applying or importing assets.",
    ],
    parameters: projectOnboardParameters,
    async execute(_toolCallId, params) {
      if (params.saveManifest ?? true) {
        const { manifest, path } = await createProjectManifest(process.cwd(), params.rootPath, {
          projectId: params.projectId,
          projectName: params.projectName,
          sourceLanguage: params.sourceLanguage,
          targetLanguage: params.targetLanguage,
          assetRoleOverrides: params.assetRoleOverrides,
          maxDepth: params.maxDepth,
        });
        return {
          content: [{ type: "text", text: formatManifest(manifest, path) }],
          details: { manifest, path, scan: manifest.scan },
        };
      }

      const report = await scanProjectFolder(params.rootPath, { maxDepth: params.maxDepth });
      return {
        content: [{ type: "text", text: formatReport(report) }],
        details: { manifest: null, path: null, scan: report },
      };
    },
  });
}

export function createProjectReadTool() {
  return defineTool<typeof projectReadParameters, ProjectManifest>({
    name: "project_read",
    label: "Project Read",
    description: "Read a persisted Linguist Agent project manifest from data/projects/<projectId>/project.json.",
    promptSnippet: "project_read: read the active project's saved CAT manifest before planning imports or reviewing batches.",
    promptGuidelines: [
      "Call project_read when the user refers to an already onboarded project.",
      "Use warnings and questions from the manifest as current project risks.",
      "Do not assume a project is imported just because a manifest exists.",
    ],
    parameters: projectReadParameters,
    async execute(_toolCallId, params) {
      const manifest = await readProjectManifest(process.cwd(), params.projectId);
      return {
        content: [{ type: "text", text: formatManifest(manifest) }],
        details: manifest,
      };
    },
  });
}

export function createProjectRefreshTool() {
  return defineTool<typeof projectRefreshParameters>({
    name: "project_refresh",
    label: "Project Refresh",
    description: "Rescan an existing LA project root, update its manifest, and report added/removed/changed assets before importing new work.",
    promptSnippet: "project_refresh: rescan a saved project and compare assets before starting new batch work.",
    promptGuidelines: [
      "Call project_refresh when the user says assets may have changed or asks to check whether the project is up to date.",
      "Report added/removed/changed assets before importing or reviewing a new batch.",
      "Use the refreshed Suggested Actions as the current import checklist.",
    ],
    parameters: projectRefreshParameters,
    async execute(_toolCallId, params) {
      const result = await refreshProjectManifest(process.cwd(), params.projectId, { maxDepth: params.maxDepth });
      const changed =
        result.changes.added.length +
        result.changes.removed.length +
        result.changes.roleChanged.length +
        result.changes.sizeChanged.length;
      const lines: string[] = [];
      lines.push(`# Project Refreshed`);
      lines.push("");
      lines.push(`Project: ${result.manifest.projectId}`);
      lines.push(`Root: ${result.manifest.root}`);
      lines.push(`Manifest: ${result.path}`);
      lines.push(`Changed assets: ${changed}`);
      lines.push("");
      lines.push(`## Added`);
      lines.push(result.changes.added.length ? result.changes.added.map((item) => `- ${item}`).join("\n") : "- None.");
      lines.push("");
      lines.push(`## Removed`);
      lines.push(result.changes.removed.length ? result.changes.removed.map((item) => `- ${item}`).join("\n") : "- None.");
      lines.push("");
      lines.push(`## Role Changed`);
      lines.push(
        result.changes.roleChanged.length
          ? result.changes.roleChanged.map((item) => `- ${item.relPath}: ${item.before} -> ${item.after}`).join("\n")
          : "- None.",
      );
      lines.push("");
      lines.push(`## Size Changed`);
      lines.push(
        result.changes.sizeChanged.length
          ? result.changes.sizeChanged.map((item) => `- ${item.relPath}: ${item.before} -> ${item.after} bytes`).join("\n")
          : "- None.",
      );
      lines.push("");
      lines.push(...formatSuggestedActions(result.manifest.scan));
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    },
  });
}

export function createProjectHealthTool() {
  return defineTool<typeof projectHealthParameters>({
    name: "project_health",
    label: "Project Health",
    description:
      "Run a deterministic readiness audit for an onboarded LA project: asset freshness, unsatisfied suggested imports, batch delivery state, and unapplied proposals.",
    promptSnippet: "project_health: check whether an onboarded project is ready before importing, translating, reviewing, or delivering a batch.",
    promptGuidelines: [
      "Call project_health before starting a new real project run when the user says assets may have changed.",
      "If status is fail, resolve blockers before translating or exporting.",
      "If status is warn, report the warnings and ask whether to refresh/import/index assets before proceeding.",
      "Do not treat project_health as translation evidence; it is readiness diagnostics.",
    ],
    parameters: projectHealthParameters,
    async execute(_toolCallId, params) {
      const report = await runProjectHealthCheck(process.cwd(), params.projectId);
      const lines: string[] = [];
      lines.push(`# Project Health`);
      lines.push("");
      lines.push(`Project: ${report.projectId}`);
      lines.push(`Status: ${report.status.toUpperCase()}`);
      lines.push(`Checked: ${report.checkedAt}`);
      lines.push(`Root: ${report.root}`);
      lines.push(`Manifest updated: ${report.manifestUpdatedAt}`);
      lines.push("");
      lines.push(`## Summary`);
      lines.push(
        `assets:${report.summary.assets} · suggested:${report.summary.suggestedActions} · missing_imports:${report.summary.missingImports} · changed:${report.summary.changedAssets} · batches:${report.summary.batches} · delivery_fail:${report.summary.deliveryFailures} · delivery_warn:${report.summary.deliveryWarnings} · unapplied_proposals:${report.summary.unappliedProposalRows}`,
      );
      lines.push("");
      lines.push(`## Issues`);
      if (report.issues.length) {
        for (const issue of report.issues) {
          const refs = [
            issue.assetPaths?.length
              ? `assets=${issue.assetPaths.slice(0, 8).join(", ")}${issue.assetPaths.length > 8 ? ` ... (showing 8/${issue.assetPaths.length})` : ""}`
              : undefined,
            issue.batchIds?.length ? `batches=${issue.batchIds.join(", ")}` : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}${refs ? ` (${refs})` : ""}`);
          for (const action of issue.nextActions ?? []) lines.push(`  - next: ${action}`);
        }
      } else {
        lines.push("- None.");
      }
      lines.push("");
      lines.push(`## Batches`);
      if (report.batches.length) {
        lines.push(`| Batch | Format | Segments | Locked | Delivery | Blockers | Warnings |`);
        lines.push(`|---|---|---:|---:|---|---:|---:|`);
        for (const batch of report.batches) {
          lines.push(
            `| ${batch.batchId} | ${batch.format} | ${batch.totalSegments} | ${batch.lockedSegments} | ${batch.status} | ${batch.blockers} | ${batch.warnings} |`,
          );
        }
      } else {
        lines.push("- No imported batches found.");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: report,
      };
    },
  });
}

export function createProjectContextTool() {
  return defineTool<typeof projectContextParameters>({
    name: "project_context",
    label: "Project Context",
    description:
      "Read the current LA project context packet: manifest summary, asset-role counts, confirmed asset roles, open questions, imported batches, CAT evidence policy, and optional project health readiness.",
    promptSnippet: "project_context: read the current CAT project context packet before resuming, reviewing, or deciding next actions.",
    promptGuidelines: [
      "Call project_context when the user asks what this project contains, where work left off, or what can happen next.",
      "Use includeHealth=true before review or delivery decisions so asset freshness, missing imports, blockers, and next actions are visible.",
      "When the summary reports omitted batches, confirmed asset roles, warnings, questions, or freshness paths, page that section and continue with nextStart until Page complete is yes.",
      "Do not treat project_context itself as TM/TB/asset evidence for term or accuracy changes; it is operational context.",
    ],
    parameters: projectContextParameters,
    async execute(_toolCallId, params) {
      if (params.section) {
        const page = await readProjectContextDetailPage(process.cwd(), params.projectId, params.section, {
          start: params.start,
          limit: params.limit,
        });
        return {
          content: [{ type: "text", text: formatProjectContextDetailPage(page) }],
          details: page,
        };
      }
      const snapshot = await buildProjectContextSnapshot(process.cwd(), params.projectId, { includeHealth: params.includeHealth ?? false });
      return {
        content: [{ type: "text", text: formatProjectContextSnapshot(snapshot) }],
        details: snapshot,
      };
    },
  });
}
