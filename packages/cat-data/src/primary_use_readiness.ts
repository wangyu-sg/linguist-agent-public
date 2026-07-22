import { openCriticalRisks, type RcRisk } from "./rc_gate.js";
import type { BetaDeliveryCandidateReport } from "./beta_candidate.js";
import type { ReadinessDecisionEvent, ReadinessDecisionMatch, ReadinessDecisionSummary } from "./readiness_decisions.js";

export type PrimaryUseReadinessStatus = "pass" | "warn" | "fail";

export interface PrimaryUseCheck {
  id: string;
  status: PrimaryUseReadinessStatus;
  summary: string;
  evidence?: string;
}

export interface PrimaryUseReadinessInput {
  checkedAt: string;
  version: string;
  projectId: string;
  beta: Pick<BetaDeliveryCandidateReport, "status" | "batchCount" | "minBatches" | "reportPath" | "failures" | "warnings" | "alpha">;
  risks: RcRisk[];
  readinessDecisions: {
    summary: ReadinessDecisionSummary;
    matches: ReadinessDecisionMatch[];
  };
}

export interface PrimaryUseReadinessReport {
  schemaVersion: 1;
  checkedAt: string;
  version: string;
  projectId: string;
  status: PrimaryUseReadinessStatus;
  reportPath: string;
  betaReportPath: string;
  readinessDecisions: {
    summary: ReadinessDecisionSummary;
    unacceptedWarnings: string[];
    acceptedWarnings: Array<{ warning: string; decision: ReadinessDecisionEvent }>;
  };
  checks: PrimaryUseCheck[];
  failures: string[];
  warnings: string[];
}

export function buildPrimaryUseReadiness(input: PrimaryUseReadinessInput & { reportPath: string }): PrimaryUseReadinessReport {
  const checks: PrimaryUseCheck[] = [];
  const add = (check: PrimaryUseCheck) => checks.push(check);
  const betaExportsOk = input.beta.alpha.batches.every((batch) => batch.export?.auditId);
  add({
    id: "real_two_batch_delivery",
    status: input.beta.status !== "fail" && input.beta.batchCount >= input.beta.minBatches && betaExportsOk ? "pass" : "fail",
    summary: `${input.beta.batchCount} real/customer-like batch(es) checked; required ${input.beta.minBatches}.`,
    evidence: `beta=${input.beta.status}; exports=${input.beta.alpha.batches.map((batch) => `${batch.batchId}:${batch.export?.auditId ?? "missing"}`).join(", ")}`,
  });
  const criticalRisks = openCriticalRisks(input.risks);
  add({
    id: "no_open_p0_p1",
    status: criticalRisks.length ? "fail" : "pass",
    summary: criticalRisks.length ? `${criticalRisks.length} open P0/P1 known risk(s) remain.` : "No open P0/P1 known risks remain.",
    evidence: criticalRisks.map((risk) => `${risk.id}:${risk.summary}`).join("; ") || "none",
  });
  const unacceptedWarnings = input.readinessDecisions.matches.filter((match) => !match.decision).map((match) => match.warning);
  const acceptedWarnings = input.readinessDecisions.matches
    .filter((match): match is { warning: string; decision: ReadinessDecisionEvent } => Boolean(match.decision));
  if (input.beta.warnings.length) {
    add({
      id: "beta_warnings",
      status: unacceptedWarnings.length ? "warn" : "pass",
      summary: unacceptedWarnings.length
        ? `${unacceptedWarnings.length} beta warning(s) remain without a readiness decision.`
        : `${acceptedWarnings.length} beta warning(s) are accepted for this project phase.`,
      evidence: input.readinessDecisions.matches
        .map((match) => `${match.decision ? "accepted" : "open"}:${match.warning}`)
        .slice(0, 5)
        .join("; "),
    });
  }
  const failures = checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.summary}`);
  const warnings = checks.filter((check) => check.status === "warn").map((check) => `${check.id}: ${check.summary}`);
  return {
    schemaVersion: 1,
    checkedAt: input.checkedAt,
    version: input.version,
    projectId: input.projectId,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
    reportPath: input.reportPath,
    betaReportPath: input.beta.reportPath,
    readinessDecisions: {
      summary: input.readinessDecisions.summary,
      unacceptedWarnings,
      acceptedWarnings,
    },
    checks,
    failures,
    warnings,
  };
}

export function renderPrimaryUseReadinessMarkdown(report: PrimaryUseReadinessReport): string {
  const lines: string[] = [];
  lines.push("# LA Primary-Use Readiness Report");
  lines.push("");
  lines.push(`Version: ${report.version}`);
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Beta report: ${report.betaReportPath}`);
  lines.push(`Readiness decisions: ${report.readinessDecisions.summary.path}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| ID | Status | Summary | Evidence |");
  lines.push("|---|---|---|---|");
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.summary.replace(/\|/g, "\\|")} | ${(check.evidence ?? "-").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## Failures");
  if (report.failures.length) {
    for (const failure of report.failures) lines.push(`- ${failure}`);
  } else {
    lines.push("- None.");
  }
  if (report.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Readiness Decisions");
  if (report.readinessDecisions.acceptedWarnings.length) {
    for (const match of report.readinessDecisions.acceptedWarnings) {
      lines.push(`- accepted: ${match.warning}`);
      lines.push(`  - reason: ${match.decision.reason}`);
      lines.push(`  - by: ${match.decision.decidedBy} at ${match.decision.ts}`);
    }
  } else {
    lines.push("- No accepted warnings.");
  }
  if (report.readinessDecisions.unacceptedWarnings.length) {
    lines.push("");
    lines.push("Unaccepted warnings:");
    for (const warning of report.readinessDecisions.unacceptedWarnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
