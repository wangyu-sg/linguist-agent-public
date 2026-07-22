import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseQualityScorecardJsonl, renderQualityScorecardReport } from "@linguist-agent/cat-runtime";

async function defaultScorecardPaths(root: string): Promise<string[]> {
  const dir = join(root, "packages", "cat-runtime", "eval", "scorecards");
  const entries = await readdir(dir);
  return entries.filter((entry) => entry.endsWith(".jsonl")).sort().map((entry) => join(dir, entry));
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const cwd = process.cwd();
const args = process.argv.slice(2);
const outputPath = valueAfter(args, "--out");
const explicitPaths = args.filter((arg) => !arg.startsWith("--") && arg !== outputPath);
const paths = explicitPaths.length ? explicitPaths.map((path) => resolve(cwd, path)) : await defaultScorecardPaths(cwd);
const rows = [];
for (const path of paths) {
  rows.push(...parseQualityScorecardJsonl(await readFile(path, "utf8"), path));
}

const report = renderQualityScorecardReport(rows);
if (outputPath) {
  await writeFile(resolve(cwd, outputPath), report, "utf8");
} else {
  process.stdout.write(report);
}
