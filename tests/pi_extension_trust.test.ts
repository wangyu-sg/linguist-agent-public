import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvePiExtensionEntries,
  listApprovedPiExtensionEntries,
  unknownPiExtensionEntries,
  verifyApprovedPiExtensionStage,
} from "../packages/cat-server/src/pi_extension_trust.js";
import {
  useAuthorizedExtensionStages,
  verifyGeneralResourceSnapshot,
} from "../packages/cat-runtime/src/generalResourceSnapshot.js";

const root = await mkdtemp(join(tmpdir(), "la-pi-extension-trust-"));
const sourcePath = join(root, "fixture.ts");
let stagedDirectory: string | undefined;

function entry(bytes: string, resolvedPath = sourcePath) {
  return {
    type: "extension" as const,
    path: sourcePath,
    resolvedPath,
    source: "auto",
    scope: "user" as const,
    origin: "top-level" as const,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: Buffer.byteLength(bytes),
  };
}

try {
  const firstBytes = "export default function fixture() { return 'approved'; }\n";
  await writeFile(sourcePath, firstBytes);
  const first = entry(firstBytes, await realpath(sourcePath));
  assert.deepEqual(await unknownPiExtensionEntries(root, [first]), [first]);

  const approved = await approvePiExtensionEntries(root, [first], { now: new Date("2026-07-20T12:00:00.000Z") });
  stagedDirectory = await realpath(join(root, "data", "runtime", "trusted-extensions", `sha256-${first.sha256}`));
  assert.equal(approved.length, 1);
  assert.equal(approved[0].originalResolvedPath, first.resolvedPath);
  assert.equal(approved[0].sourceSha256, first.sha256);
  assert.equal(approved[0].stagedSha256, first.sha256);
  assert.match(approved[0].stagedPath, new RegExp(`trusted-extensions/sha256-${first.sha256}/extension\\.ts$`));
  assert.equal(await readFile(approved[0].stagedPath, "utf8"), firstBytes);
  assert.equal((await stat(approved[0].stagedPath)).mode & 0o222, 0, "staged bytes must be read-only");
  assert.deepEqual((await readdir(stagedDirectory)).sort(), ["extension.ts", "manifest.json"]);
  await verifyApprovedPiExtensionStage(approved[0]);
  assert.deepEqual(await unknownPiExtensionEntries(root, [first]), []);
  assert.deepEqual(await listApprovedPiExtensionEntries(root), approved);

  const stagedSnapshot = useAuthorizedExtensionStages({
    entries: [first],
    extensionPaths: [first.path],
    skillPaths: [],
    promptPaths: [],
    themePaths: [],
    contextFiles: [],
    appendSystemPrompt: [],
    resourceSetHash: "original-path-snapshot",
  }, approved);
  assert.deepEqual(stagedSnapshot.extensionPaths, [approved[0].stagedPath]);
  assert.equal(stagedSnapshot.entries[0].resolvedPath, approved[0].stagedPath);
  assert.notEqual(stagedSnapshot.resourceSetHash, "original-path-snapshot");
  await verifyGeneralResourceSnapshot(stagedSnapshot);

  await writeFile(sourcePath, "export default function fixture() { return 'changed'; }\n");
  assert.equal(await readFile(approved[0].stagedPath, "utf8"), firstBytes, "original-path replacement must not change approved bytes");
  await verifyGeneralResourceSnapshot(stagedSnapshot);
  const changed = entry(await readFile(sourcePath, "utf8"), await realpath(sourcePath));
  assert.deepEqual(await unknownPiExtensionEntries(root, [changed]), [changed]);

  await chmod(stagedDirectory, 0o755);
  const unexpectedPath = join(stagedDirectory, "outside.js");
  await writeFile(unexpectedPath, "export default 'unexpected';\n");
  await chmod(stagedDirectory, 0o555);
  await assert.rejects(() => verifyApprovedPiExtensionStage(approved[0]), /staged Extension tree changed/);
  await chmod(stagedDirectory, 0o755);
  await unlink(unexpectedPath);
  await chmod(stagedDirectory, 0o555);

  await chmod(approved[0].stagedPath, 0o644);
  await writeFile(approved[0].stagedPath, "tampered\n");
  await assert.rejects(() => verifyApprovedPiExtensionStage(approved[0]), /staged Extension bytes changed/);

  const dynamicPath = join(root, "dynamic.ts");
  const dynamicBytes = "export default async function fixture() { return import('./outside.js'); }\n";
  await writeFile(dynamicPath, dynamicBytes);
  const dynamic = { ...entry(dynamicBytes), path: dynamicPath, resolvedPath: await realpath(dynamicPath) };
  await assert.rejects(
    () => approvePiExtensionEntries(root, [dynamic]),
    /dynamic import.*not part of the approved staged closure/i,
  );

  await mkdir(join(root, "data", "runtime"), { recursive: true });
  await writeFile(join(root, "data", "runtime", "pi_extension_trust.v1.json"), JSON.stringify({
    schemaVersion: 1,
    approvals: [{ resolvedPath: dynamicPath, sha256: dynamic.sha256, approvedAt: "2026-07-20T12:00:00.000Z" }],
  }));
  assert.deepEqual(await unknownPiExtensionEntries(root, [dynamic]), [dynamic], "legacy path approvals must not become staged execution authority");

  console.log("Pi Extension trust tests passed");
} finally {
  if (stagedDirectory) {
    await chmod(stagedDirectory, 0o755);
    await chmod(join(stagedDirectory, "extension.ts"), 0o644);
    await chmod(join(stagedDirectory, "manifest.json"), 0o644);
  }
  await rm(root, { recursive: true, force: true });
}
