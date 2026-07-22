import { runRealAlpha } from "@linguist-agent/cat-data";

interface CliOptions {
  projectId: string;
  batchIds: string[];
  buildAssets: boolean;
  exportBatches: boolean;
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run alpha:real -- --project <project_id> [--batch <batch_id> ...] [--no-assets] [--no-export]",
      "",
      "Example:",
      "  npm run alpha:real -- --project synthetic-game-project --batch b1",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { projectId: "", batchIds: [], buildAssets: true, exportBatches: true };
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
    if (arg === "--no-assets") {
      out.buildAssets = false;
      continue;
    }
    if (arg === "--no-export") {
      out.exportBatches = false;
      continue;
    }
    usage();
  }
  if (!out.projectId) usage();
  return out;
}

const options = parseArgs(process.argv.slice(2));
const report = await runRealAlpha(process.cwd(), {
  projectId: options.projectId,
  batchIds: options.batchIds,
  buildAssets: options.buildAssets,
  exportBatches: options.exportBatches,
});

console.log(`LA real alpha ${report.status}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Batches: ${report.batches.map((batch) => `${batch.batchId}:${batch.delivery.status}`).join(", ")}`);
if (report.p0p1DeliveryRisks.length) {
  console.log("P0/P1 delivery risks:");
  for (const risk of report.p0p1DeliveryRisks) console.log(`- ${risk}`);
  process.exitCode = 1;
}
