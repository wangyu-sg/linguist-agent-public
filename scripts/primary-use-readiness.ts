import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendReadinessDecision,
  buildPrimaryUseReadiness,
  matchReadinessDecisions,
  parseKnownRisksMarkdown,
  readReadinessDecisions,
  renderPrimaryUseReadinessMarkdown,
  runBetaDeliveryCandidate,
  summarizeReadinessDecisions,
} from "@linguist-agent/cat-data";

interface CliOptions {
  projectId: string;
  batchIds: string[];
  minBatches: number;
  acceptWarningPatterns: string[];
  decisionReason?: string;
  decidedBy: string;
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run primary:readiness -- --project <project_id> --batch <batch_id> --batch <batch_id> [--min-batches <n>] [--accept-warning <pattern> --decision-reason <reason>]",
      "",
      "Example:",
      "  npm run primary:readiness -- --project synthetic-game-project --batch b1 --batch b2",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { projectId: "", batchIds: [], minBatches: 2, acceptWarningPatterns: [], decidedBy: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      out.projectId = argv[++i] ?? "";
      continue;
    }
    if (arg === "--batch") {
      const value = argv[++i];
      if (!value) usage();
      out.batchIds.push(value);
      continue;
    }
    if (arg === "--min-batches") {
      const value = Number(argv[++i] ?? "");
      if (!Number.isInteger(value) || value < 1) usage();
      out.minBatches = value;
      continue;
    }
    if (arg === "--accept-warning") {
      const value = argv[++i];
      if (!value) usage();
      out.acceptWarningPatterns.push(value);
      continue;
    }
    if (arg === "--decision-reason") {
      const value = argv[++i];
      if (!value) usage();
      out.decisionReason = value;
      continue;
    }
    if (arg === "--decided-by") {
      const value = argv[++i];
      if (!value) usage();
      out.decidedBy = value;
      continue;
    }
    usage();
  }
  if (!out.projectId || out.batchIds.length < out.minBatches) usage();
  // M1: separate authoring from gating. Accepting a delivery warning requires BOTH an
  // explicit reason AND an explicit, accountable --decided-by that is not the running
  // command's own identity, so a warning can never be silently self-waived to green.
  if (out.acceptWarningPatterns.length) {
    if (!out.decisionReason) usage();
    const blockedAuthors = new Set(["", "primary:readiness", "completion:audit", "rc:gate", "rc:status"]);
    if (blockedAuthors.has(out.decidedBy.trim())) {
      throw new Error(
        "Accepting a readiness warning requires an explicit accountable --decided-by <name> that is not the gate command itself (e.g. a person or reviewing role). Authoring and gating must not be the same actor.",
      );
    }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const checkedAt = new Date().toISOString();
const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as { version: string };
const reportDir = join(cwd, "data", "reports");
await mkdir(reportDir, { recursive: true });
const beta = await runBetaDeliveryCandidate(cwd, {
  projectId: options.projectId,
  batchIds: options.batchIds,
  minBatches: options.minBatches,
  reportDir,
});
for (const pattern of options.acceptWarningPatterns) {
  await appendReadinessDecision(cwd, {
    projectId: options.projectId,
    kind: "accept_warning",
    warningPattern: pattern,
    reason: options.decisionReason ?? "",
    decidedBy: options.decidedBy,
  });
}
const readinessDecisionEvents = await readReadinessDecisions(cwd, options.projectId);
const readinessDecisionSummary = summarizeReadinessDecisions(cwd, options.projectId, readinessDecisionEvents);
const readinessDecisionMatches = matchReadinessDecisions(beta.warnings, readinessDecisionEvents);
const reportPath = join(reportDir, `la_primary_use_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
const report = buildPrimaryUseReadiness({
  checkedAt,
  version: packageJson.version,
  projectId: options.projectId,
  reportPath,
  beta,
  risks: parseKnownRisksMarkdown(await readFile(join(cwd, "docs", "KNOWN_RISKS.md"), "utf8")),
  readinessDecisions: {
    summary: readinessDecisionSummary,
    matches: readinessDecisionMatches,
  },
});
await writeFile(reportPath, renderPrimaryUseReadinessMarkdown(report), "utf8");

console.log(`LA primary-use readiness ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Beta report: ${report.betaReportPath}`);
console.log(`Checks: ${report.checks.map((check) => `${check.id}:${check.status}`).join(", ")}`);
if (report.failures.length) {
  console.log("Primary-use readiness failures:");
  for (const failure of report.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
