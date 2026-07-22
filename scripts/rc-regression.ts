import { runRcRegression } from "@linguist-agent/cat-data";

interface CliOptions {
  projectId?: string;
}

function usage(): never {
  throw new Error(
    [
      "Usage: npm run rc:regression -- [--project <project_id>]",
      "",
      "Example:",
      "  npm run rc:regression -- --project rc-regression-local",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      const value = argv[++i];
      if (!value) usage();
      out.projectId = value;
      continue;
    }
    usage();
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
const report = await runRcRegression(process.cwd(), options);

console.log(`LA RC regression ${report.status}`);
console.log(`Project: ${report.projectId}`);
console.log(`Report: ${report.reportPath}`);
console.log(`Milestones: ${report.milestones.map((row) => `${row.name}:${row.status}`).join(", ")}`);
if (report.status === "fail") process.exitCode = 1;
