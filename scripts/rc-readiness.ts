import { runRcReadinessReport } from "@linguist-agent/cat-data";

interface CliOptions {
  projectId: string;
  batchIds: string[];
}
function usage(): never {
  throw new Error(
    [
      "Usage: npm run rc:readiness -- --project <project_id> [--batch <batch_id> ...]",
      "",
      "Example:",
      "  npm run rc:readiness -- --project synthetic-game-project --batch b1 --batch b2",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { projectId: "", batchIds: [] };
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
    usage();
  }
  if (!out.projectId) usage();
  return out;
}

const options = parseArgs(process.argv.slice(2));
const report = await runRcReadinessReport(process.cwd(), {
  projectId: options.projectId,
  batchIds: options.batchIds,
});

console.log(`LA RC readiness ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Batches: ${report.batches.map((batch) => `${batch.batchId}:${batch.status}`).join(", ")}`);
if (report.failures.length) {
  console.log("RC readiness failures:");
  for (const failure of report.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
