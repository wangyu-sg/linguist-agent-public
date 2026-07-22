import { runBetaDeliveryCandidate } from "@linguist-agent/cat-data";

interface CliOptions {
  projectId: string;
  batchIds: string[];
  minBatches: number;
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run beta:candidate -- --project <project_id> [--batch <batch_id> ...] [--min-batches <n>]",
      "",
      "Example:",
      "  npm run beta:candidate -- --project synthetic-game-project --batch b1 --batch b2",
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
  if (!out.projectId) usage();
  return out;
}

const options = parseArgs(process.argv.slice(2));
const report = await runBetaDeliveryCandidate(process.cwd(), {
  projectId: options.projectId,
  batchIds: options.batchIds,
  minBatches: options.minBatches,
});

console.log(`LA beta candidate ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Alpha report: ${report.alphaReportPath}`);
console.log(`Batches: ${report.alpha.batches.map((batch) => `${batch.batchId}:${batch.delivery.status}`).join(", ")}`);
if (report.failures.length) {
  console.log("Beta candidate failures:");
  for (const failure of report.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
