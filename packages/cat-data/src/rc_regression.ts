import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAssetBlocks, searchAssetBlocks } from "./asset_blocks.js";
import { importPhraseBatch } from "./batch_workspace.js";
import { importGlossaryTable, lookupGlossary } from "./glossary.js";
import { createProjectManifest } from "./project_manifest.js";
import { createProposalSet, readProposalSet } from "./proposals.js";
import { runRcReadinessReport, type RcReadinessReport } from "./rc_readiness.js";
import { importTmTable } from "./tm_import.js";
import { applyProposalSet, writeProposalReport, type ProposalApplyResult, type ProposalReportResult } from "./proposals.js";
import { createTmStore, type TmMatch } from "./tm.js";
import { createWorkspace } from "./workspace.js";
import { exportPhraseMxliff, type ExportResult } from "./delivery.js";
import { buildDeliveryReadinessReport, type DeliveryReadinessReport } from "./delivery_readiness.js";

export interface RcRegressionReport {
  schemaVersion: 1;
  projectId: string;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  reportPath: string;
  customerRoot: string;
  milestones: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }>;
  evidence: {
    tmMatches: number;
    glossaryMatches: number;
    assetHits: number;
  };
  proposal: {
    proposalSetId: string;
    reportPath?: string;
    applied: ProposalApplyResult;
  };
  batchIds: string[];
  deliveryReadiness: DeliveryReadinessReport[];
  exports: ExportResult[];
  rcReadiness: RcReadinessReport;
}

export interface RunRcRegressionOptions {
  projectId?: string;
  customerRoot?: string;
  reportDir?: string;
}

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
</body></file></xliff>`;

function mxliffFixture(assassinTarget: string): string {
  return `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>${assassinTarget}</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
  </group>
</body></file></xliff>`;
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function prepareFixtureCustomerRoot(workspaceRoot: string, projectId: string, explicitRoot?: string): Promise<string> {
  const root = explicitRoot ?? join(workspaceRoot, "tmp", "rc-regression", projectId);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "master.xliff"), masterFixture, "utf8");
  await writeFile(join(root, "batch-a.mxliff"), mxliffFixture("Shadow Emblem"), "utf8");
  await writeFile(join(root, "batch-b.mxliff"), mxliffFixture("Shadow Emblem"), "utf8");
  await writeFile(
    join(root, "glossary.csv"),
    ["source,target,note", "暗影徽记,Shadow Emblem,Official item naming", "勇者徽记,Hero Emblem,Official item naming"].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "tm.csv"),
    ["source,target,note", "勇者徽记,Hero Emblem,Reviewed customer TM", "暗影徽记,Shadow Emblem,Legacy target before style update"].join("\n"),
    "utf8",
  );
  await writeFile(join(root, "style.md"), "# Style\nUse title case for Gem item names.\nUse apostrophe form for Shadow Emblem.\n", "utf8");
  return root;
}

function milestone(name: string, ok: boolean, detail: string): RcRegressionReport["milestones"][number] {
  return { name, status: ok ? "pass" : "fail", detail };
}

function renderMarkdown(report: RcRegressionReport): string {
  const lines: string[] = [];
  lines.push("# LA RC Regression Report");
  lines.push("");
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Fixture root: ${report.customerRoot}`);
  lines.push("");
  lines.push("## Milestones");
  lines.push("");
  lines.push("| Milestone | Status | Detail |");
  lines.push("|---|---|---|");
  for (const row of report.milestones) lines.push(`| ${row.name} | ${row.status} | ${row.detail.replace(/\|/g, "\\|")} |`);
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push(`- TM matches: ${report.evidence.tmMatches}`);
  lines.push(`- Glossary matches: ${report.evidence.glossaryMatches}`);
  lines.push(`- Asset hits: ${report.evidence.assetHits}`);
  lines.push("");
  lines.push("## Proposal / Apply");
  lines.push("");
  lines.push(`- Proposal set: ${report.proposal.proposalSetId}`);
  lines.push(`- Proposal report: ${report.proposal.reportPath ?? "not written"}`);
  lines.push(`- Applied: ${report.proposal.applied.applied.join(", ") || "none"}`);
  lines.push(`- Skipped: ${report.proposal.applied.skipped.length}`);
  lines.push("");
  lines.push("## Delivery / Export");
  lines.push("");
  for (const readiness of report.deliveryReadiness) {
    const exported = report.exports.find((row) => row.batchId === readiness.batchId);
    lines.push(`- ${readiness.batchId}: readiness ${readiness.status}; export ${exported?.format ?? "missing"} -> ${exported?.outputPath ?? "missing"}; audit ${exported?.auditId ?? "missing"}`);
  }
  lines.push(`- RC readiness: ${report.rcReadiness.status} -> ${report.rcReadiness.reportPath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runRcRegression(workspaceRoot: string, options: RunRcRegressionOptions = {}): Promise<RcRegressionReport> {
  const checkedAt = new Date().toISOString();
  const projectId = options.projectId ?? `rc-regression-${timestampId()}`;
  const customerRoot = await prepareFixtureCustomerRoot(workspaceRoot, projectId, options.customerRoot);
  const milestones: RcRegressionReport["milestones"] = [];

  const { manifest } = await createProjectManifest(workspaceRoot, customerRoot, {
    projectId,
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    assetRoleOverrides: [
      { relPath: "glossary.csv", role: "glossary", status: "confirmed", reason: "RC regression fixture glossary" },
      { relPath: "tm.csv", role: "translation_memory", status: "confirmed", reason: "RC regression fixture TM" },
      { relPath: "style.md", role: "style_guide", status: "confirmed", reason: "RC regression fixture style guide" },
    ],
  });
  milestones.push(milestone("onboarding", manifest.projectId === projectId && manifest.scan.assets.length >= 5, `${manifest.scan.assets.length} assets scanned`));

  const batchIds = ["b1", "b2"];
  for (const [index, batchId] of batchIds.entries()) {
    await importPhraseBatch(workspaceRoot, {
      projectId,
      mxliffPath: index === 0 ? "batch-a.mxliff" : "batch-b.mxliff",
      masterXliffPath: "master.xliff",
      batchId,
    });
  }
  milestones.push(milestone("batch_import", true, "Two sanitized Phrase MXLIFF batches imported with a master XLIFF companion"));

  await importGlossaryTable(workspaceRoot, { projectId, assetPath: "glossary.csv", sourceColumn: "source", targetColumn: "target", noteColumn: "note" });
  await importTmTable(workspaceRoot, { projectId, assetPath: "tm.csv", sourceColumn: "source", targetColumn: "target", noteColumn: "note" });
  await buildAssetBlocks(workspaceRoot, { projectId });

  const tmMatches: TmMatch[] = await createTmStore(createWorkspace(workspaceRoot, projectId)).lookup({ source: "勇者徽记", threshold: 0.7 });
  const glossaryMatches = await lookupGlossary(workspaceRoot, { projectId, term: "暗影徽记" });
  const assetHits = await searchAssetBlocks(workspaceRoot, { projectId, query: "Shadow Emblem" });
  milestones.push(milestone("evidence_retrieval", Boolean(tmMatches.length && glossaryMatches.length && assetHits.length), `${tmMatches.length} TM, ${glossaryMatches.length} glossary, ${assetHits.length} asset hits`));

  const evidenceSource = glossaryMatches[0] ? `${glossaryMatches[0].sourceFile}:${glossaryMatches[0].rowNo}` : "glossary.csv:2";
  const { proposalSet } = await createProposalSet(workspaceRoot, projectId, "b1", {
    proposalSetId: "rc-term-pass",
    title: "RC terminology pass",
    proposals: [
      {
        segmentId: "job:1",
        proposedTarget: "Shadow Emblem",
        reason: "Use official glossary item name.",
        changeType: "term",
        evidenceSources: [evidenceSource],
        severity: "L2",
      },
    ],
  });
  const proposalReport: ProposalReportResult = await writeProposalReport(workspaceRoot, projectId, "b1", proposalSet.proposalSetId);
  const applied = await applyProposalSet(workspaceRoot, projectId, "b1", proposalSet.proposalSetId, { confirm: true });
  const afterApply = await readProposalSet(workspaceRoot, projectId, "b1", proposalSet.proposalSetId);
  milestones.push(milestone("proposal_review_apply", applied.applied.length === 1 && afterApply.proposals[0]?.status === "applied", `${applied.applied.length} applied`));

  const readinessBeforeExport = await Promise.all(batchIds.map((batchId) => buildDeliveryReadinessReport(workspaceRoot, projectId, batchId)));
  milestones.push(
    milestone(
      "delivery_gate",
      readinessBeforeExport.every((row) => row.status === "pass"),
      readinessBeforeExport.map((row) => `${row.batchId}:${row.status}`).join(", "),
    ),
  );

  const exports: ExportResult[] = [];
  for (const batchId of batchIds) exports.push(await exportPhraseMxliff(workspaceRoot, { projectId, batchId }));
  milestones.push(
    milestone(
      "export",
      exports.every((row) => Boolean(row.auditId)),
      exports.map((row) => `${row.batchId}:${row.auditId ?? "missing"}`).join(", "),
    ),
  );

  const rcReadiness = await runRcReadinessReport(workspaceRoot, { projectId, batchIds, reportDir: options.reportDir });
  milestones.push(milestone("rc_report", rcReadiness.status === "pass", `rc readiness ${rcReadiness.status}`));

  const failed = milestones.filter((row) => row.status === "fail");
  const warned = milestones.filter((row) => row.status === "warn");
  const status: RcRegressionReport["status"] = failed.length ? "fail" : warned.length ? "warn" : "pass";
  const reportDir = options.reportDir ?? join(workspaceRoot, "data", "reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `la_rc_regression_${projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
  const report: RcRegressionReport = {
    schemaVersion: 1,
    projectId,
    checkedAt,
    status,
    reportPath,
    customerRoot,
    milestones,
    evidence: {
      tmMatches: tmMatches.length,
      glossaryMatches: glossaryMatches.length,
      assetHits: assetHits.length,
    },
    proposal: {
      proposalSetId: proposalSet.proposalSetId,
      reportPath: proposalReport.path,
      applied,
    },
    batchIds,
    deliveryReadiness: await Promise.all(batchIds.map((batchId) => buildDeliveryReadinessReport(workspaceRoot, projectId, batchId))),
    exports,
    rcReadiness,
  };
  await writeFile(reportPath, renderMarkdown(report), "utf8");
  await readFile(reportPath, "utf8");
  return report;
}
