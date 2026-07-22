import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  buildCompletionAuditReport,
  buildPrimaryUseReadiness,
  createWorkspace,
  matchReadinessDecisions,
  parseKnownRisksMarkdown,
  readExportAuditRecords,
  readReadinessDecisions,
  renderPrimaryUseReadinessMarkdown,
  renderCompletionAuditMarkdown,
  runBetaDeliveryCandidate,
  summarizeReadinessDecisions,
  type RcRisk,
} from "@linguist-agent/cat-data";
import { catToolMetadataFor } from "@linguist-agent/cat-tools";
import {
  BROWSER_SESSION_POLICY,
  buildCatRuntimeHealthReport,
  buildCatSandboxHealthReport,
  CAT_PI_PACKAGE_RESOURCES,
  PROJECT_SESSION_STRATEGY,
  registerCatRuntimeHooks,
  validateCatToolResult,
} from "@linguist-agent/cat-runtime";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CliOptions {
  projectId: string;
  batchIds: string[];
  minBatches: number;
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run completion:audit -- --project <project_id> --batch <batch_id> --batch <batch_id> [--min-batches <n>]",
      "",
      "Example:",
      "  npm run completion:audit -- --project synthetic-game-project --batch b1 --batch b2",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { projectId: "", batchIds: [], minBatches: 2 };
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
    usage();
  }
  if (!out.projectId || out.batchIds.length < out.minBatches) usage();
  return out;
}

// H5: a real second source of P0/P1 risk — explicit in-code markers `LA-RISK:P0` /
// `LA-RISK:P1`. Any found are folded into the risk register so the gate is not satisfied
// purely by what a human did (or did not) type into KNOWN_RISKS.md.
async function scanInCodeRiskMarkers(cwd: string): Promise<RcRisk[]> {
  const lines = await new Promise<string[]>((resolveMarkers) => {
    // Scan product code only (packages + .pi), NOT scripts/ — this gate script itself
    // contains the marker literal, which would otherwise self-match.
    const child = spawn("git", ["grep", "-nE", "LA-RISK:(P0|P1)", "--", "packages", ".pi"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    // git grep exits 1 when there are no matches; that is not an error here.
    child.on("error", () => resolveMarkers([]));
    child.on("close", () => resolveMarkers(Buffer.concat(chunks).toString("utf8").split(/\r?\n/).filter(Boolean)));
  });
  return lines.map((line, index) => {
    const severity = /LA-RISK:P0/.test(line) ? "P0" : "P1";
    return {
      id: `LA-RISK-CODE-${index + 1}`,
      severity,
      status: "open" as const,
      area: "code-marker",
      summary: line.slice(0, 200),
    };
  });
}

// Derive the implementation checks from real behavior (run the hook registration,
// call the validators, and read the export audit produced by the beta run) instead
// of substring-grepping source files. A
// renamed symbol or commented-out line can no longer keep these checks green while
// the behavior is broken.
async function assessImplementation(): Promise<{
  toolMetadata: boolean;
  runtimeHooks: boolean;
  noSilentFallbackTrace: boolean;
  deliveryAudit: boolean;
}> {
  const workspace = createWorkspace(cwd, options.projectId);

  // runtime_hooks: register against a probe ExtensionAPI and confirm the three native
  // Pi hooks are actually wired.
  const hookEvents = new Set<string>();
  const probePi = {
    on: (event: string) => {
      hookEvents.add(event);
    },
    registerCommand: () => {},
    registerTool: () => {},
  } as unknown as ExtensionAPI;
  registerCatRuntimeHooks(probePi, workspace);
  const runtimeHooks =
    hookEvents.has("before_agent_start") && hookEvents.has("tool_call") && hookEvents.has("tool_result");

  // trace_no_silent_fallback: an empty CAT tool result must be flipped to isError.
  const emptyValidation = validateCatToolResult({ toolName: "tm_lookup", content: [], details: {}, isError: false });
  const noSilentFallbackTrace = emptyValidation?.isError === true;

  // tool_metadata: write tools carry real evidence requirements.
  const toolMetadata =
    Boolean(catToolMetadataFor("segment_set_target")?.requiresEvidenceFor?.length) &&
    Boolean(catToolMetadataFor("proposal_apply")?.requiresEvidenceFor?.length);

  // delivery_audit: the beta run actually exported AND produced parseable audit records.
  const auditRecords = await readExportAuditRecords(cwd, options.projectId);
  const deliveryAudit = beta.alpha.batches.some((batch) => Boolean(batch.export)) && auditRecords.length > 0;

  return {
    toolMetadata,
    runtimeHooks,
    noSilentFallbackTrace,
    deliveryAudit,
  };
}

async function gitTrackedRuntimeFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["ls-files", "data"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => errors.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `git ls-files exited ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8").split(/\r?\n/).filter(Boolean));
    });
  });
}

const options = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const checkedAt = new Date().toISOString();
const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
  version: string;
  dependencies?: Record<string, string>;
};
const piSettings = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8"));
const risks: RcRisk[] = parseKnownRisksMarkdown(await readFile(join(cwd, "docs", "KNOWN_RISKS.md"), "utf8"));
// H5: the P0/P1 gate previously trusted the hand-authored KNOWN_RISKS.md table alone,
// so an empty/under-populated register self-certified "no open P0/P1". Treat an empty
// register as unverified (an open P1) and fold in any explicit in-code risk markers
// (LA-RISK:P0 / LA-RISK:P1) so the gate is cross-checked against a second real source.
if (!risks.length) {
  risks.push({
    id: "KR-REGISTER-EMPTY",
    severity: "P1",
    status: "open",
    area: "process",
    summary: "KNOWN_RISKS.md register is empty; a register with zero rows cannot prove there are no open P0/P1 issues.",
  });
}
for (const marker of await scanInCodeRiskMarkers(cwd)) risks.push(marker);
const reportDir = join(cwd, "data", "reports");
await mkdir(reportDir, { recursive: true });
const beta = await runBetaDeliveryCandidate(cwd, {
  projectId: options.projectId,
  batchIds: options.batchIds,
  minBatches: options.minBatches,
  reportDir,
});
const readinessDecisionEvents = await readReadinessDecisions(cwd, options.projectId);
const readinessDecisionSummary = summarizeReadinessDecisions(cwd, options.projectId, readinessDecisionEvents);
const readinessDecisionMatches = matchReadinessDecisions(beta.warnings, readinessDecisionEvents);
const primaryReportPath = join(reportDir, `la_primary_use_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}_completion.md`);
const primary = buildPrimaryUseReadiness({
  checkedAt,
  version: packageJson.version,
  projectId: options.projectId,
  reportPath: primaryReportPath,
  beta,
  risks,
  readinessDecisions: {
    summary: readinessDecisionSummary,
    matches: readinessDecisionMatches,
  },
});
await writeFile(primaryReportPath, renderPrimaryUseReadinessMarkdown(primary), "utf8");

const runtimeHealth = buildCatRuntimeHealthReport({
  laVersion: packageJson.version,
  piCodingAgentVersion: packageJson.dependencies?.["@earendil-works/pi-coding-agent"] ?? "",
  piAiVersion: packageJson.dependencies?.["@earendil-works/pi-ai"],
  expectedPiVersion: packageJson.dependencies?.["@earendil-works/pi-coding-agent"] ?? "",
  piSettings,
  // Use the single-source runtime constants (not brittle source substring greps that
  // break the moment the literal is refactored) — same values createCatAgentSession applies.
  browserNoExtensions: BROWSER_SESSION_POLICY.noExtensions,
  browserCustomTools: BROWSER_SESSION_POLICY.useCustomTools,
  browserBuiltinTools: BROWSER_SESSION_POLICY.builtinTools,
  browserDataStoreWriteGuard: BROWSER_SESSION_POLICY.dataStoreWriteGuard,
  browserNonCatToolResultsCitable: BROWSER_SESSION_POLICY.nonCatToolResultsCitable,
  projectSessionStrategy: PROJECT_SESSION_STRATEGY,
  resources: CAT_PI_PACKAGE_RESOURCES,
  sandbox: buildCatSandboxHealthReport(createWorkspace(cwd, options.projectId)),
});

const reportPath = join(reportDir, `la_completion_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
const report = buildCompletionAuditReport({
  checkedAt,
  version: packageJson.version,
  projectId: options.projectId,
  reportPath,
  primaryUse: primary,
  runtimeHealthStatus: runtimeHealth.status,
  risks,
  trackedRuntimeFiles: await gitTrackedRuntimeFiles(cwd),
  implementation: await assessImplementation(),
});
await writeFile(reportPath, renderCompletionAuditMarkdown(report), "utf8");

console.log(`LA completion audit ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Primary-use report: ${report.primaryUseReportPath}`);
console.log(`Checks: ${report.checks.map((row) => `${row.id}:${row.status}`).join(", ")}`);
if (report.failures.length) {
  console.log("Completion audit failures:");
  for (const failure of report.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
