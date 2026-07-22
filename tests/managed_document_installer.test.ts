import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ManagedDocumentInstallError,
  installManagedDocumentCapability,
  previewManagedDocumentCapabilityInstall,
} from "../packages/cat-server/src/managed_document_installer.ts";

test("document install preview pins runtime, packages, models, hosts, and plan hash", () => {
  const plan = previewManagedDocumentCapabilityInstall("/tmp/la-runtime", "ocr");
  assert.equal(plan.runtime.distribution, "cpython-3.11.15+20260718-aarch64-apple-darwin-install_only_stripped");
  assert.equal(plan.packages.find((entry) => entry.name === "paddleocr")?.version, "3.7.0");
  assert.equal(plan.packages.find((entry) => entry.name === "paddlepaddle")?.version, "3.3.1");
  assert.deepEqual(plan.models.map((model) => model.name), ["PP-OCRv5_mobile_det", "PP-OCRv6_medium_rec", "PP-LCNet_x0_25_textline_ori"]);
  assert.deepEqual(plan.prerequisiteIds, ["python"]);
  assert.equal(plan.lifecycleScriptsDisabled, true);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.equal(previewManagedDocumentCapabilityInstall("/tmp/la-runtime", "ocr").planHash, plan.planHash);
});

test("a stale plan hash fails before any quarantine download", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-installer-"));
  await assert.rejects(
    installManagedDocumentCapability(root, { capabilityId: "python", planHash: "0".repeat(64) }),
    (error: unknown) => error instanceof ManagedDocumentInstallError && error.code === "plan_hash_mismatch",
  );
  await assert.rejects(stat(join(root, "data", "assistant", "capabilities", "documents", "python")));
});
