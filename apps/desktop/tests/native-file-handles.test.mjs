import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNativeFileHandleRegistry } from "../src/native-file-handles.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "la-native-file-handle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("native file handles expose no path and refuse forged, mismatched, or replaced selections", async (t) => {
  const directory = await temporaryDirectory(t);
  const selected = join(directory, "reference.txt");
  const replacement = join(directory, "replacement.txt");
  await writeFile(selected, "original");
  await writeFile(replacement, "replacement");

  const registry = createNativeFileHandleRegistry({
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    now: () => 1_000,
  });
  const handle = await registry.issue(selected, "asset");

  assert.deepEqual(handle, {
    id: "la-native-file-00000000-0000-4000-8000-000000000001",
    name: "reference.txt",
  });
  assert.equal(await registry.resolve(handle, "asset"), await realpath(selected));
  await assert.rejects(
    () => registry.resolve({ ...handle, path: selected }, "asset"),
    /unsupported field/i,
  );
  await assert.rejects(() => registry.resolve(handle, "batch"), /not valid for batch/i);
  await assert.rejects(
    () => registry.resolve({ id: "la-native-file-00000000-0000-4000-8000-000000000002", name: "reference.txt" }, "asset"),
    /unknown or expired/i,
  );

  await rm(selected);
  await symlink(replacement, selected);
  await assert.rejects(() => registry.resolve(handle, "asset"), /changed after selection/i);
});

test("native file handles only resolve selected files inside the canonical project root", async (t) => {
  const directory = await temporaryDirectory(t);
  const project = join(directory, "project");
  const outside = join(directory, "outside.txt");
  const inside = join(project, "assets", "guide.md");
  await writeFile(outside, "outside");
  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(inside, "inside");

  let sequence = 0;
  const registry = createNativeFileHandleRegistry({
    randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
  const [insideHandle, outsideHandle] = await Promise.all([
    registry.issue(inside, "asset"),
    registry.issue(outside, "asset"),
  ]);

  assert.deepEqual(await registry.resolveProjectAssets([insideHandle], project), [{
    ...insideHandle,
    relPath: "assets/guide.md",
  }]);
  await assert.rejects(() => registry.resolveProjectAssets([outsideHandle], project), /not inside the canonical Project root/i);
});
