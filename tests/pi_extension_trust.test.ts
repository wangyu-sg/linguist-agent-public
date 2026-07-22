import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvePiExtensionEntries,
  listApprovedPiExtensionEntries,
  unknownPiExtensionEntries,
} from "../packages/cat-server/src/pi_extension_trust.js";

const root = await mkdtemp(join(tmpdir(), "la-pi-extension-trust-"));
const base = {
  type: "extension" as const,
  path: join(root, "fixture.ts"),
  resolvedPath: join(root, "fixture.ts"),
  source: "auto",
  scope: "user" as const,
  origin: "top-level" as const,
  sizeBytes: 24,
};

try {
  const first = { ...base, sha256: "a".repeat(64) };
  assert.deepEqual(await unknownPiExtensionEntries(root, [first]), [first]);

  await approvePiExtensionEntries(root, [first], { now: new Date("2026-07-20T12:00:00.000Z") });
  assert.deepEqual(await unknownPiExtensionEntries(root, [first]), []);
  assert.deepEqual(await listApprovedPiExtensionEntries(root), [{
    resolvedPath: first.resolvedPath,
    sha256: first.sha256,
    approvedAt: "2026-07-20T12:00:00.000Z",
  }]);

  const changed = { ...base, sha256: "b".repeat(64) };
  assert.deepEqual(await unknownPiExtensionEntries(root, [changed]), [changed], "changing executable bytes must invalidate the prior approval");
  await approvePiExtensionEntries(root, [changed], { now: new Date("2026-07-20T12:05:00.000Z") });
  assert.deepEqual(await listApprovedPiExtensionEntries(root), [{
    resolvedPath: changed.resolvedPath,
    sha256: changed.sha256,
    approvedAt: "2026-07-20T12:05:00.000Z",
  }], "a path keeps only its currently approved digest");

  console.log("Pi Extension trust tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
