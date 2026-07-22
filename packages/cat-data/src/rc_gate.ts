export type RcRiskSeverity = "P0" | "P1" | "P2" | "P3";
export type RcRiskStatus = "open" | "closed" | "accepted" | "monitoring";

export interface RcRisk {
  id: string;
  severity: RcRiskSeverity;
  status: RcRiskStatus;
  area: string;
  summary: string;
}
export interface RcGateCommandResult {
  name: string;
  command: string;
  status: "pass" | "fail" | "skipped";
  exitCode?: number | null;
  durationMs?: number;
  output?: string;
}

export interface RcGateReport {
  schemaVersion: 1;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  reportPath: string;
  version: string;
  commands: RcGateCommandResult[];
  risks: RcRisk[];
  failures: string[];
  warnings: string[];
}

const KNOWN_SEVERITIES = new Set<RcRiskSeverity>(["P0", "P1", "P2", "P3"]);
const KNOWN_STATUSES = new Set<RcRiskStatus>(["open", "closed", "accepted", "monitoring"]);

function cleanCell(value: string): string {
  return value.trim().replace(/^`|`$/g, "").trim();
}

export function parseKnownRisksMarkdown(markdown: string): RcRisk[] {
  const risks: RcRisk[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    if (/^\|\s*-+/.test(trimmed) || /\|\s*ID\s*\|/i.test(trimmed)) continue;
    const cells = trimmed.slice(1, -1).split("|").map(cleanCell);
    if (cells.length < 5) continue;
    const [id, severity, status, area, summary] = cells;
    if (!KNOWN_SEVERITIES.has(severity as RcRiskSeverity)) continue;
    if (!KNOWN_STATUSES.has(status as RcRiskStatus)) continue;
    risks.push({
      id,
      severity: severity as RcRiskSeverity,
      status: status as RcRiskStatus,
      area,
      summary,
    });
  }
  return risks;
}

export function openCriticalRisks(risks: RcRisk[]): RcRisk[] {
  return risks.filter((risk) => (risk.severity === "P0" || risk.severity === "P1") && risk.status !== "closed");
}

export function buildRcGateReport(input: {
  checkedAt: string;
  reportPath: string;
  version: string;
  commands: RcGateCommandResult[];
  risks: RcRisk[];
}): RcGateReport {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const command of input.commands) {
    if (command.status === "fail") failures.push(`${command.name} failed with exit code ${command.exitCode ?? "unknown"}.`);
    if (command.status === "skipped") warnings.push(`${command.name} was skipped.`);
  }
  for (const risk of openCriticalRisks(input.risks)) failures.push(`${risk.id} ${risk.severity} ${risk.status}: ${risk.summary}`);
  for (const risk of input.risks) {
    if (risk.severity === "P2" && risk.status === "open") warnings.push(`${risk.id} P2 open: ${risk.summary}`);
  }
  return {
    schemaVersion: 1,
    checkedAt: input.checkedAt,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
    reportPath: input.reportPath,
    version: input.version,
    commands: input.commands,
    risks: input.risks,
    failures,
    warnings,
  };
}

export function renderRcGateReport(report: RcGateReport): string {
  const lines: string[] = [];
  lines.push("# LA RC Gate Report");
  lines.push("");
  lines.push(`Version: ${report.version}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  lines.push("| Name | Status | Exit | Duration | Command |");
  lines.push("|---|---|---:|---:|---|");
  for (const command of report.commands) {
    lines.push(
      `| ${command.name} | ${command.status} | ${command.exitCode ?? "-"} | ${command.durationMs ?? "-"}ms | ${command.command.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Known Risks");
  lines.push("");
  if (report.risks.length) {
    lines.push("| ID | Severity | Status | Area | Summary |");
    lines.push("|---|---|---|---|---|");
    for (const risk of report.risks) {
      lines.push(`| ${risk.id} | ${risk.severity} | ${risk.status} | ${risk.area} | ${risk.summary.replace(/\|/g, "\\|")} |`);
    }
  } else {
    lines.push("- None recorded.");
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
