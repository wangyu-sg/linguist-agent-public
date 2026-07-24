import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inventoryLegacyManagedPackages,
} from "../packages/cat-server/src/legacy_package_inventory.js";

const root = await mkdtemp(join(tmpdir(), "la-legacy-package-inventory-"));
const packageRoot = join(root, "data", "assistant", "capabilities", "packages");
const installedRoot = join(packageRoot, "installed");

function treeHash(files: Array<[string, string]>): string {
  const hash = createHash("sha256");
  for (const [path, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}

function record(input: {
  packageName: unknown;
  version: unknown;
  installPath?: string;
  hash?: string;
  extensions?: string[];
  risks?: Array<{ id: string; detected: boolean }>;
}): unknown {
  return {
    packageName: input.packageName,
    version: input.version,
    installedAt: "2026-07-20T04:00:00.000Z",
    installPath: input.installPath,
    planHash: "a".repeat(64),
    acceptedRiskIds: [],
    descriptor: {
      schemaVersion: 1,
      package: {
        name: input.packageName,
        version: input.version,
        source: `npm:${String(input.packageName)}@${String(input.version)}`,
        integrity: "sha512-fixture",
        tarball: "https://registry.invalid/fixture.tgz",
        license: "MIT",
        repository: null,
      },
      tier: "labs",
      trust: "approved",
      resources: {
        extensions: input.extensions ?? [],
        skills: ["./skills/review/SKILL.md"],
        prompts: [],
        themes: [],
      },
      dependencyClosure: [],
      lifecycleScripts: [],
      risks: input.risks ?? [{ id: "skill_instructions", detected: true }],
      compatibility: { node: null, piPeers: {}, runtime: "compatible", notes: [] },
      audit: {
        treeHash: input.hash,
        archiveBytes: 100,
        extractedBytes: 100,
        fileCount: 2,
        scannedTextFiles: 2,
        createdAt: "2026-07-20T03:00:00.000Z",
      },
    },
  };
}

try {
  const declarativePath = join(installedRoot, "declarative", "1.0.0");
  const declarativeFiles: Array<[string, string]> = [
    ["package.json", "{\"name\":\"declarative\",\"version\":\"1.0.0\"}"],
    ["skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nReview.\n"],
  ];
  for (const [path, content] of declarativeFiles) {
    await mkdir(join(declarativePath, path, ".."), { recursive: true });
    await writeFile(join(declarativePath, path), content);
  }

  const executablePath = join(installedRoot, "executable", "1.0.0");
  const executableFiles: Array<[string, string]> = [
    ["extensions/index.js", "export default () => {};\n"],
    ["package.json", "{\"name\":\"executable\",\"version\":\"1.0.0\"}"],
    ["skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nReview.\n"],
  ];
  for (const [path, content] of executableFiles) {
    await mkdir(join(executablePath, path, ".."), { recursive: true });
    await writeFile(join(executablePath, path), content);
  }

  const missingPath = join(installedRoot, "missing", "1.0.0");
  const registryPath = join(packageRoot, "installed-v1.json");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(registryPath, JSON.stringify([
    record({ packageName: "declarative", version: "1.0.0", installPath: declarativePath, hash: treeHash(declarativeFiles) }),
    record({
      packageName: "executable",
      version: "1.0.0",
      installPath: executablePath,
      hash: treeHash(executableFiles),
      extensions: ["./extensions/index.js"],
      risks: [{ id: "extension_code", detected: true }],
    }),
    record({ packageName: "missing", version: "1.0.0", installPath: missingPath, hash: "b".repeat(64) }),
    record({ packageName: "mismatch", version: "1.0.0", installPath: declarativePath, hash: "c".repeat(64) }),
    record({ packageName: "outside", version: "1.0.0", installPath: "/tmp/not-owned-by-la", hash: "d".repeat(64) }),
    record({ packageName: 42, version: "1.0.0", installPath: declarativePath, hash: treeHash(declarativeFiles) }),
  ], null, 2));

  const report = await inventoryLegacyManagedPackages(root, { now: new Date("2026-07-22T12:00:00.000Z") });
  assert.equal(report.registryStatus, "present");
  assert.equal(report.totalRecords, 6);
  assert.deepEqual(report.counts, { declarativeCandidate: 1, manualReview: 5, corruptRecord: 1 });
  const declarative = report.entries.find((entry) => entry.packageName === "declarative");
  assert.equal(declarative?.classification, "declarative_candidate");
  assert.equal(declarative?.original.installPath, declarativePath);
  assert.equal(declarative?.original.treeHash, treeHash(declarativeFiles));
  assert.deepEqual(declarative?.detectedRiskIds, ["skill_instructions"]);
  assert.equal(report.entries.find((entry) => entry.packageName === "executable")?.reasons.includes("executable_extension"), true);
  assert.equal(report.entries.find((entry) => entry.packageName === "missing")?.reasons.includes("installed_tree_missing"), true);
  assert.equal(report.entries.find((entry) => entry.packageName === "mismatch")?.reasons.includes("tree_digest_mismatch"), true);
  assert.equal(report.entries.find((entry) => entry.packageName === "outside")?.reasons.includes("install_path_outside_legacy_root"), true);
  assert.equal(report.entries[5]?.classification, "manual_review");
  assert.equal(report.entries[5]?.reasons.includes("corrupt_registry_record"), true);

  await writeFile(registryPath, "not-json");
  const corrupt = await inventoryLegacyManagedPackages(root, { now: new Date("2026-07-22T12:00:00.000Z") });
  assert.equal(corrupt.registryStatus, "corrupt");
  assert.equal(corrupt.totalRecords, 0);
  assert.deepEqual(corrupt.registryIssues, ["registry_json_invalid"]);

  console.log("legacy Package inventory tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
