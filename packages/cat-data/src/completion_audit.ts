import type { PrimaryUseReadinessReport } from "./primary_use_readiness.js";
import type { RcRisk } from "./rc_gate.js";

export type CompletionAuditStatus = "pass" | "warn" | "fail";

export interface CompletionAuditCheck {
  id: string;
  status: CompletionAuditStatus;
  requirement: string;
  evidence: string;
}

export interface CompletionAuditInput {
  checkedAt: string;
  version: string;
  projectId: string;
  primaryUse: Pick<PrimaryUseReadinessReport, "status" | "reportPath" | "failures" | "warnings" | "checks">;
  runtimeHealthStatus: CompletionAuditStatus;
  risks: RcRisk[];
  trackedRuntimeFiles: string[];
  implementation: {
    toolMetadata: boolean;
    runtimeHooks: boolean;
    noSilentFallbackTrace: boolean;
    deliveryAudit: boolean;
  };
}

export interface CompletionAuditReport {
  schemaVersion: 1;
  checkedAt: string;
  version: string;
  projectId: string;
  status: CompletionAuditStatus;
  reportPath: string;
  primaryUseReportPath: string;
  checks: CompletionAuditCheck[];
  failures: string[];
  warnings: string[];
}

function check(status: CompletionAuditStatus, id: string, requirement: string, evidence: string): CompletionAuditCheck {
  return { id, status, requirement, evidence };
}

export function buildCompletionAuditReport(input: CompletionAuditInput & { reportPath: string }): CompletionAuditReport {
  const openCritical = input.risks.filter((risk) => (risk.severity === "P0" || risk.severity === "P1") && risk.status !== "closed");
  const checks: CompletionAuditCheck[] = [
    check(
      input.primaryUse.status === "pass" ? "pass" : input.primaryUse.status,
      "primary_use_readiness",
      "At least two real/customer-like batches have delivery-safe exports and accepted warning decisions.",
      `${input.primaryUse.status}; ${input.primaryUse.reportPath}`,
    ),
    check(
      openCritical.length ? "fail" : "pass",
      "no_open_p0_p1",
      "No known P0/P1 issues remain for tag handling, locked segments, evidence gates, proposal apply, TM/TB truth, or export paths.",
      openCritical.map((risk) => risk.id).join(", ") || "none",
    ),
    check(
      input.runtimeHealthStatus === "pass" ? "pass" : "fail",
      "pi_runtime_health",
      "Pinned Pi runtime, compaction/retry settings, CAT tool surface, and scoped sessions are healthy.",
      input.runtimeHealthStatus,
    ),
    check(
      input.implementation.toolMetadata ? "pass" : "fail",
      "tool_metadata",
      "CAT tools expose execution mode, evidence requirements, and safety metadata.",
      input.implementation.toolMetadata ? "present" : "missing",
    ),
    check(
      input.implementation.runtimeHooks ? "pass" : "fail",
      "runtime_hooks",
      "Pi runtime hooks inject project context, guard tool calls, and validate tool results.",
      input.implementation.runtimeHooks ? "present" : "missing",
    ),
    check(
      input.implementation.noSilentFallbackTrace ? "pass" : "fail",
      "trace_no_silent_fallback",
      "Tool/result validation and diagnostics are surfaced in trace/reporting instead of silent fallback.",
      input.implementation.noSilentFallbackTrace ? "present" : "missing",
    ),
    check(
      input.implementation.deliveryAudit ? "pass" : "fail",
      "delivery_audit",
      "Exports, proposal reports, and delivery readiness provide explicit auditability.",
      input.implementation.deliveryAudit ? "present" : "missing",
    ),
    check(
      input.trackedRuntimeFiles.length ? "fail" : "pass",
      "no_tracked_customer_runtime_data",
      "Customer/runtime data under data/ is not tracked by git.",
      input.trackedRuntimeFiles.join(", ") || "none",
    ),
  ];
  const failures = checks.filter((row) => row.status === "fail").map((row) => `${row.id}: ${row.requirement}`);
  const warnings = checks.filter((row) => row.status === "warn").map((row) => `${row.id}: ${row.requirement}`);
  return {
    schemaVersion: 1,
    checkedAt: input.checkedAt,
    version: input.version,
    projectId: input.projectId,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
    reportPath: input.reportPath,
    primaryUseReportPath: input.primaryUse.reportPath,
    checks,
    failures,
    warnings,
  };
}

export function renderCompletionAuditMarkdown(report: CompletionAuditReport): string {
  const lines: string[] = [];
  lines.push("# LA Production Completion Audit");
  lines.push("");
  lines.push(`Version: ${report.version}`);
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Primary-use report: ${report.primaryUseReportPath}`);
  lines.push("");
  lines.push("## Requirements");
  lines.push("");
  lines.push("| ID | Status | Requirement | Evidence |");
  lines.push("|---|---|---|---|");
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.requirement.replace(/\|/g, "\\|")} | ${check.evidence.replace(/\|/g, "\\|")} |`);
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
  return `${lines.join("\n")}\n`;
}
