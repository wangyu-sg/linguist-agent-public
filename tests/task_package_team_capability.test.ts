import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamPackagePreflightBlockers } from "../packages/cat-server/src/task_package_profile.js";

const root = await mkdtemp(join(tmpdir(), "la-team-package-capability-"));

try {
  const extensionPath = join(root, "ui.ts");
  await writeFile(extensionPath, "export default function approved() {}\n", "utf8");
  const executable = {
    packageSource: "npm:example-package@1.2.3",
    resourceType: "extension" as const,
    path: extensionPath,
    executable: true,
    packageName: "example-package",
    version: "1.2.3",
    resourceId: "ui.ts",
    integrity: `sha256-${createHash("sha256").update(await readFile(extensionPath)).digest("base64")}`,
    enabledByPi: true,
    origin: "package" as const,
    scope: "global" as const,
  };

  assert.deepEqual(await teamPackagePreflightBlockers([executable]), []);

  assert.match((await teamPackagePreflightBlockers([
    { ...executable, executable: false },
  ]))[0]!, /digest-approved Package-origin Extensions/);

  assert.deepEqual(await teamPackagePreflightBlockers([
    { ...executable, resourceType: "skill" as const, executable: false },
    { ...executable, resourceType: "prompt" as const, executable: false },
  ]), []);

  assert.match((await teamPackagePreflightBlockers([
    executable,
    { ...executable, packageSource: "npm:second@1.0.0", packageName: "second", resourceId: "second.ts" },
  ]))[0]!, /at most one executable Package extension/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("task package Team capability tests passed");
