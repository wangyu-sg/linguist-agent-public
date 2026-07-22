import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syncVersions } from "./version-sync.js";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const version = packageJson.version;

const requiredMarkers: Array<[string, string]> = [
  ["CHANGELOG.md", `[${version}]`],
  ["README.md", `v${version}`],
  ["AGENTS.md", `Product version: \`${version}\``],
  ["TODO.md", `Current product version: \`${version}\``],
  ["docs/AGENT_CONTEXT.md", `Product version: \`${version}\``],
  ["docs/HANDOFF.md", `Product version: \`${version}\``],
  ["docs/PROJECT_OVERVIEW.md", `v${version}`],
  ["docs/ARCHITECTURE.md", `Linguist Agent \`${version}\``],
  ["docs/CLAUDE.md", `Current LA version is \`${version}\``],
  ["docs/RUNTIME_BORROWED_PATTERNS.md", `current product version is \`${version}\``],
];

const failures: string[] = [];

try {
  await syncVersions(root, version, { check: true });
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

for (const [path, marker] of requiredMarkers) {
  const text = await readFile(join(root, path), "utf8");
  if (!text.includes(marker)) failures.push(`${path} missing ${marker}`);
}

if (failures.length) {
  console.error(`Release check failed for ${version}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`release check passed for ${version}`);
}
