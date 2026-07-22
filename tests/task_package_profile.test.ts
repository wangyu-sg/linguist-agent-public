import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyTaskPackageProfile,
  previewTaskPackageProfile,
  readTaskPackageProfile,
  taskPackageProfileHash,
} from "../packages/cat-server/src/task_package_profile.js";
import type { PiPackagesCatalog } from "../packages/cat-server/src/pi_packages.js";

const root = await mkdtemp(join(tmpdir(), "la-task-package-profile-"));
const packageRoot = join(root, "package");
const extensionPath = join(packageRoot, "extensions", "review.ts");
const skillRoot = join(packageRoot, "skills");
await mkdir(join(packageRoot, "extensions"), { recursive: true });
await mkdir(join(skillRoot, "nested"), { recursive: true });
await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "la-review-package", version: "1.2.3" }), "utf8");
await writeFile(extensionPath, "export default () => undefined;\n", "utf8");
await writeFile(join(skillRoot, "nested", "review.md"), "Initial nested guidance.\n", "utf8");

function catalog(projectTrusted: boolean): PiPackagesCatalog {
  return {
    docs: "",
    paths: { global: join(root, "global.json"), project: join(root, "project.json") },
    entries: [],
    global: [],
    project: [],
    configuredPackages: [],
    resources: {
      docs: "",
      projectTrusted,
      defaultProjectTrust: projectTrusted ? "always" : "ask",
      skippedMissingSources: [],
      counts: {
        extensions: { total: 1, enabled: 1, disabled: 0 },
        skills: { total: 1, enabled: 1, disabled: 0 },
        prompts: { total: 0, enabled: 0, disabled: 0 },
        themes: { total: 0, enabled: 0, disabled: 0 },
      },
      entries: [{
        type: "extensions",
        path: extensionPath,
        enabled: true,
        source: "npm:la-review-package@1.2.3",
        scope: "project",
        origin: "package",
        baseDir: packageRoot,
      }, {
        type: "skills",
        path: skillRoot,
        enabled: true,
        source: "npm:la-review-package@1.2.3",
        scope: "project",
        origin: "package",
        baseDir: packageRoot,
      }],
    },
    risk: { requiresConfirmation: true, executesThirdPartyCode: false, message: "" },
  };
}

const store = { repoRoot: root, projectId: "project-one", taskId: "task-one" };
const empty = await readTaskPackageProfile(store);
assert.equal(empty.revision, 0);
assert.deepEqual(empty.selections, []);

const selection = {
  packageSource: "npm:la-review-package@1.2.3",
  resourceType: "extension" as const,
  resourceId: "extensions/review.ts",
  enabled: true,
};
const untrusted = await previewTaskPackageProfile({
  profile: empty,
  catalog: catalog(false),
  desiredSelections: [selection],
});
assert.ok(untrusted.conflicts.some((row) => row.code === "project_not_trusted"));
assert.ok(untrusted.conflicts.some((row) => row.code === "executable_approval_required"));

const trustedCatalog = catalog(true);
const needsApproval = await previewTaskPackageProfile({
  profile: empty,
  catalog: trustedCatalog,
  desiredSelections: [selection],
});
assert.equal(needsApproval.resolvedResources.length, 1);
assert.ok(needsApproval.conflicts.some((row) => row.code === "executable_approval_required"));
const resource = needsApproval.resolvedResources[0]!;
const approval = {
  packageSource: resource.packageSource,
  version: resource.version,
  integrity: resource.integrity,
  approvedAt: "2026-07-17T00:00:00.000Z",
};
const ready = await previewTaskPackageProfile({
  profile: empty,
  catalog: trustedCatalog,
  desiredSelections: [selection],
  executableApprovals: [approval],
});
assert.deepEqual(ready.conflicts, []);
assert.match(ready.planHash, /^sha256-/);

const skillSelection = {
  packageSource: "npm:la-review-package@1.2.3",
  resourceType: "skill" as const,
  resourceId: "skills",
  enabled: true,
};
const nestedBefore = await previewTaskPackageProfile({
  profile: empty,
  catalog: trustedCatalog,
  desiredSelections: [skillSelection],
});
await writeFile(join(skillRoot, "nested", "review.md"), "Changed nested guidance.\n", "utf8");
const nestedAfter = await previewTaskPackageProfile({
  profile: empty,
  catalog: catalog(true),
  desiredSelections: [skillSelection],
});
assert.notEqual(
  nestedAfter.resolvedResources[0]?.integrity,
  nestedBefore.resolvedResources[0]?.integrity,
  "nested Package resource changes must invalidate the integrity fingerprint",
);
const outsideResource = join(root, "outside.md");
await writeFile(outsideResource, "outside package boundary\n", "utf8");
await symlink(outsideResource, join(skillRoot, "nested", "outside-link.md"));
await assert.rejects(
  () => previewTaskPackageProfile({ profile: empty, catalog: catalog(true), desiredSelections: [skillSelection] }),
  /Symbolic links are not valid Task Package resources/,
  "symlinked Package resources must be rejected instead of escaping the catalog boundary",
);
await unlink(join(skillRoot, "nested", "outside-link.md"));

const saved = await applyTaskPackageProfile({
  store,
  catalog: trustedCatalog,
  expectedRevision: 0,
  planHash: ready.planHash,
  selections: [selection],
  executableApprovals: [approval],
});
assert.equal(saved.revision, 1);
assert.equal(saved.selections[0]?.resourceId, selection.resourceId);
assert.match(taskPackageProfileHash(saved), /^sha256-/);
assert.deepEqual(await readTaskPackageProfile(store), saved);
assert.match(await readFile(join(root, "data/projects/project-one/task_workspace/tasks/task-one/resource-profile.json"), "utf8"), /"revision": 1/);

const unknown = await previewTaskPackageProfile({
  profile: saved,
  catalog: trustedCatalog,
  desiredSelections: [{ ...selection, resourceId: "extensions/missing.ts" }],
  executableApprovals: [approval],
});
assert.ok(unknown.conflicts.some((row) => row.code === "unknown_resource"));

console.log("task package profile tests passed");
