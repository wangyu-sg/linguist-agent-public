import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  buildRcGateReport,
  parseKnownRisksMarkdown,
  renderRcGateReport,
  type RcGateCommandResult,
} from "@linguist-agent/cat-data";

interface CliOptions {
  projectId?: string;
  batchIds: string[];
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run rc:gate -- [--project <project_id> --batch <batch_id> ...]",
      "",
      "Examples:",
      "  npm run rc:gate",
      "  npm run rc:gate -- --project synthetic-game-project --batch b1 --batch b2",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { batchIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      const value = argv[++i];
      if (!value) usage();
      out.projectId = value;
      continue;
    }
    if (arg === "--batch") {
      const value = argv[++i];
      if (!value) usage();
      out.batchIds.push(value);
      continue;
    }
    usage();
  }
  if (out.batchIds.length && !out.projectId) usage();
  return out;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runCommand(name: string, args: string[], options: { skip?: boolean } = {}): Promise<RcGateCommandResult> {
  const command = ["npm", ...args].map(shellQuote).join(" ");
  if (options.skip) return { name, command, status: "skipped" };
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("npm", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8").trim();
      resolve({
        name,
        command,
        status: code === 0 ? "pass" : "fail",
        exitCode: code,
        durationMs: Date.now() - started,
        output: output.length > 4000 ? `${output.slice(0, 4000)}\n...` : output,
      });
    });
    child.on("error", (error) => {
      resolve({
        name,
        command,
        status: "fail",
        exitCode: null,
        durationMs: Date.now() - started,
        output: error.message,
      });
    });
  });
}

const options = parseArgs(process.argv.slice(2));
const checkedAt = new Date().toISOString();
const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
const riskMarkdown = await readFile(join(process.cwd(), "docs", "KNOWN_RISKS.md"), "utf8");
const risks = parseKnownRisksMarkdown(riskMarkdown);
const reportDir = join(process.cwd(), "data", "reports");
await mkdir(reportDir, { recursive: true });
const reportPath = join(reportDir, `la_rc_gate_${checkedAt.replace(/[:.]/g, "-")}.md`);

const commands: RcGateCommandResult[] = [];
commands.push(await runCommand("typecheck", ["run", "typecheck"]));
commands.push(await runCommand("unit", ["test"]));
commands.push(await runCommand("desktop-client", ["run", "mac:test"]));
commands.push(await runCommand("runtime-health", ["run", "runtime:health"]));
commands.push(await runCommand("release-sync", ["run", "release:check"]));
commands.push(await runCommand("rc-regression", ["run", "rc:regression", "--", "--project", `rc-gate-regression-${checkedAt.replace(/[:.]/g, "-")}`]));
commands.push(await runCommand("rc-status", ["run", "rc:status"]));
if (options.projectId && options.batchIds.length) {
  const batchArgs = options.batchIds.flatMap((batchId) => ["--batch", batchId]);
  commands.push(await runCommand("rc-readiness-real", ["run", "rc:readiness", "--", "--project", options.projectId, ...batchArgs]));
  if (options.batchIds.length >= 2) {
    commands.push(await runCommand("beta-candidate-real", ["run", "beta:candidate", "--", "--project", options.projectId, ...batchArgs]));
    commands.push(await runCommand("primary-readiness-real", ["run", "primary:readiness", "--", "--project", options.projectId, ...batchArgs]));
    commands.push(await runCommand("completion-audit-real", ["run", "completion:audit", "--", "--project", options.projectId, ...batchArgs]));
  }
}

// The delivery envelope (beta/primary/completion against an isolated or real >=2-batch
// project) is the load-bearing evidence for "primary-use ready". Previously, invoking
// `rc:gate` with no project silently SKIPPED these and still reported pass, so a fresh
// checkout (where data/ is gitignored) could green the gate vacuously. Now the gate FAILS
// unless a >=2-batch project is supplied, so green can never be reported without actually
// exercising the delivery pipeline. `rc:regression` prepares a sanitized two-batch fixture
// for isolated verification without touching customer source files.
if (!(options.projectId && options.batchIds.length >= 2)) {
  commands.push({
    name: "real-delivery-verification",
    command: "npm run rc:gate -- --project <id> --batch <b1> --batch <b2>",
    status: "fail",
    output:
      "rc:gate requires an isolated or real customer-like project with at least two batches to verify delivery (beta/primary/completion). " +
      "Re-run with --project <id> --batch <b1> --batch <b2>. Skipping these checks must never report green.",
  });
}

const report = buildRcGateReport({
  checkedAt,
  reportPath,
  version: packageJson.version ?? "unknown",
  commands,
  risks,
});
await writeFile(reportPath, renderRcGateReport(report), "utf8");

console.log(`LA RC gate ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Commands: ${report.commands.map((row) => `${row.name}:${row.status}`).join(", ")}`);
if (report.failures.length) {
  console.log("RC gate failures:");
  for (const failure of report.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
