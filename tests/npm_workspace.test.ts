import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { workspaces?: string[] };
const lockfile = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
  packages?: Record<string, { name?: string; link?: boolean }>;
};
const rootScripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const ciWorkflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

assert.deepEqual(packageJson.workspaces, ["packages/*", "apps/*"]);
assert.equal(lockfile.packages?.["apps/desktop"]?.name, "@linguist-agent/desktop");
assert.equal(lockfile.packages?.["node_modules/@linguist-agent/desktop"]?.link, true);
assert.equal(existsSync(path.join(root, "apps/desktop/package-lock.json")), false, "Desktop must use the root npm lockfile");
assert.equal(existsSync(path.join(root, "pnpm-workspace.yaml")), false, "npm is the only workspace authority");
assert.equal(existsSync(path.join(root, "apps/desktop/runtime/native-capabilities/package-lock.json")), true, "the packaged native-capability closure is not a workspace lockfile");
assert.match(rootScripts.scripts?.["desktop:build"] ?? "", /--workspace @linguist-agent\/desktop/);
assert.match(ciWorkflow, /cache-dependency-path: package-lock\.json/);
assert.doesNotMatch(ciWorkflow, /apps\/desktop\/package-lock\.json|npm --prefix apps\/desktop ci/);

process.stdout.write("npm workspace contract passed\n");
