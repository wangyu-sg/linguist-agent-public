import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertIsolatedRuntimeURL,
  inspectFixture,
  loadAcceptanceConfig,
  parseArguments,
  resolveCredential,
} from "./electron-acceptance-lib.mjs";

const options = parseArguments(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
const credential = await resolveCredential();
const report = {
  schemaVersion: 1,
  kind: "electron-acceptance-preflight",
  collectedAt: new Date().toISOString(),
  runtimeURL,
  ...(await inspectFixture(config, runtimeURL, credential)),
};

const outputDirectory = options.outputDirectory ?? "/private/tmp/linguist-agent-electron-acceptance";
await mkdir(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, `preflight-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({ outputPath, projects: report.inventory.projects.length, gaps: report.gaps }, null, 2));
if (report.gaps.length && !options.allowGaps) process.exitCode = 2;
