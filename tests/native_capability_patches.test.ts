import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NATIVE_CAPABILITY_PATCH_INTEGRITIES,
  applyNativeCapabilityPatch,
} from "../packages/cat-server/src/native_capability_patches.js";

const root = await mkdtemp(join(tmpdir(), "la-native-capability-patch-"));
const packageRoot = join(root, "pi-ask");
const targetPath = join(packageRoot, "src", "ask-tool.ts");
const indexPath = join(packageRoot, "src", "index.ts");
const fixtureRoot = join(process.cwd(), "tests", "fixtures", "pi-ask-1.1.0");
const overlayRoot = join(process.cwd(), "patches", "pi-ask-headless-v1", "src");

try {
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(targetPath, await readFile(join(fixtureRoot, "ask-tool.ts")));
  await writeFile(indexPath, await readFile(join(fixtureRoot, "index.ts")));

  const first = await applyNativeCapabilityPatch("pi-ask-headless-v1", packageRoot);
  assert.equal(first.changed, true);
  assert.equal(first.integrity, NATIVE_CAPABILITY_PATCH_INTEGRITIES["pi-ask-headless-v1"]);
  assert.deepEqual(first.targetPaths, ["src/index.ts", "src/ask-tool.ts"]);
  assert.deepEqual(await readFile(targetPath), await readFile(join(overlayRoot, "ask-tool.ts")));
  assert.deepEqual(await readFile(indexPath), await readFile(join(overlayRoot, "index.ts")));

  const second = await applyNativeCapabilityPatch("pi-ask-headless-v1", packageRoot);
  assert.equal(second.changed, false, "the controlled patch must be idempotent");

  await writeFile(targetPath, "tampered\n");
  await assert.rejects(
    () => applyNativeCapabilityPatch("pi-ask-headless-v1", packageRoot),
    /base is not the approved upstream file/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("native capability patch tests passed");
