import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupRuntimeStorage,
  createProjectManifest,
  executeRuntimeStorageAction,
  parseAsset,
  previewRuntimeStorageAction,
  resolveRuntimeStorageRoots,
  runtimeStorageSummary,
} from "@linguist-agent/cat-data";
import { handleStorageRoute } from "../packages/cat-server/src/routes/storage_routes.js";

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

const repoRoot = await mkdtemp(join(tmpdir(), "la-runtime-storage-"));
const customerRoot = await mkdtemp(join(tmpdir(), "la-runtime-storage-project-"));
const testCacheRoot = await mkdtemp(join(tmpdir(), "la-runtime-storage-cache-"));
const testLogRoot = await mkdtemp(join(tmpdir(), "la-runtime-storage-log-"));
process.env.LA_RUNTIME_CACHE_ROOT = testCacheRoot;
process.env.LA_RUNTIME_LOG_ROOT = testLogRoot;
const projectId = "storage-test";
await createProjectManifest(repoRoot, customerRoot, { projectId, projectName: "Storage Test", sourceLanguage: "en-US", targetLanguage: "de-DE" });

await write(join(repoRoot, "data/projects/storage-test/batches/b1/batch.json"), "{}");
await write(join(repoRoot, "data/projects/storage-test/uploads/source.xliff"), "source");
await write(join(repoRoot, "data/projects/storage-test/asset_blocks.jsonl"), "{}\n");
await write(join(repoRoot, "data/projects/storage-test/_pi_sessions/session.jsonl"), "{}\n");
await write(join(repoRoot, "data/projects/storage-test/asset_parse/mineru/old-cache/file.txt"), "cache");
await write(join(testCacheRoot, "projects/storage-test/asset_parse/mineru/new-cache/file.txt"), "new cache");
await write(join(repoRoot, "data/projects/storage-test/exports/out.xliff"), "export");
await write(join(testLogRoot, "la-server.log"), "log");

const before = await runtimeStorageSummary(repoRoot);
const roots = resolveRuntimeStorageRoots(repoRoot);
assert.equal(before.policyVersion, 2);
assert.equal(before.roots.cacheRoot, roots.cacheRoot);
assert.equal(before.roots.logRoot, roots.logRoot);
assert.equal(before.projects.length, 1);
assert.ok(before.buckets.some((bucket) => bucket.storageClass === "state" && bucket.files >= 2));
assert.ok(before.buckets.some((bucket) => bucket.storageClass === "cache" && bucket.removableBytes > 0));
assert.ok(before.removableBytes > 0);

const preview = await previewRuntimeStorageAction(repoRoot, { action: "pruneCaches" });
assert.equal(preview.action, "pruneCaches");
assert.ok(preview.planHash);
assert.ok(preview.bytes > 0);
assert.ok(preview.paths.some((path) => path.includes("asset_parse")));
assert.equal(await readFile(join(repoRoot, "data/projects/storage-test/asset_parse/mineru/old-cache/file.txt"), "utf8"), "cache");

await assert.rejects(
  executeRuntimeStorageAction(repoRoot, { action: "pruneCaches", planHash: "stale" }),
  /Storage cleanup plan changed/,
);

const cleanup = await executeRuntimeStorageAction(repoRoot, { action: "pruneCaches", planHash: preview.planHash });
assert.ok(cleanup.deletedPaths.some((path) => path.includes("asset_parse")));
await assert.rejects(stat(join(repoRoot, "data/projects/storage-test/asset_parse")));
await assert.rejects(stat(join(testCacheRoot, "projects/storage-test/asset_parse")));
assert.equal(await readFile(join(repoRoot, "data/projects/storage-test/batches/b1/batch.json"), "utf8"), "{}");
assert.equal(await readFile(join(repoRoot, "data/projects/storage-test/uploads/source.xliff"), "utf8"), "source");

const workbookPath = join(customerRoot, "terms.xlsx");
await writeFile(workbookPath, "not a real workbook", "utf8");
const counterPath = join(customerRoot, "mineru-count.txt");
const fakeMineruPath = join(customerRoot, "fake-mineru.mjs");
await writeFile(fakeMineruPath, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(counterPath)}, "started", "utf8");
`, "utf8");
await chmod(fakeMineruPath, 0o755);
const previousMineruCommand = process.env.LA_MINERU_COMMAND;
process.env.LA_MINERU_COMMAND = fakeMineruPath;
try {
  const preview = await parseAsset(repoRoot, { projectId, assetPath: "terms.xlsx", mode: "mineru" });
  assert.equal(preview.mineruPreview?.status, "unavailable");
  await assert.rejects(readFile(counterPath, "utf8"));
} finally {
  if (previousMineruCommand === undefined) delete process.env.LA_MINERU_COMMAND;
  else process.env.LA_MINERU_COMMAND = previousMineruCommand;
}

function captureJson() {
  let payload: { status: number; data: any } | undefined;
  return {
    res: {} as any,
    json: (_res: any, status: number, data: unknown) => { payload = { status, data }; },
    get: () => {
      assert.ok(payload);
      return payload;
    },
  };
}

{
  const out = captureJson();
  const handled = await handleStorageRoute({ method: "GET" } as any, out.res, ["api", "storage", "summary"], {
    repoRoot,
    json: out.json,
    readBody: async () => ({}),
  });
  assert.equal(handled, true);
  const result = out.get();
  assert.equal(result.status, 200);
  assert.equal(result.data.runtimeRoot, repoRoot);
  assert.equal(result.data.policyVersion, 2);
  assert.equal(result.data.roots.cacheRoot, testCacheRoot);
  assert.equal(result.data.buckets.some((bucket: any) => bucket.storageClass === "cache"), false, "an unavailable MinerU request must not create a cache");
}

{
  const out = captureJson();
  await handleStorageRoute({ method: "POST" } as any, out.res, ["api", "storage", "actions", "preview"], {
    repoRoot,
    json: out.json,
    readBody: async () => ({ action: "deleteProjectCache", projectId }),
  });
  const result = out.get();
  assert.equal(result.status, 200);
  assert.ok(result.data.planHash);
}

{
  const out = captureJson();
  await handleStorageRoute({ method: "POST" } as any, out.res, ["api", "storage", "cleanup"], {
    repoRoot,
    json: out.json,
    readBody: async () => ({ action: "deleteOldReports" }),
  });
  const result = out.get();
  assert.equal(result.status, 200);
  assert.equal(result.data.mode, "preview");
  assert.ok(result.data.planHash);
}

{
  const out = captureJson();
  await handleStorageRoute({ method: "POST" } as any, out.res, ["api", "storage", "cleanup"], {
    repoRoot,
    json: out.json,
    readBody: async () => ({ action: "deleteProjectCache" }),
  });
  assert.equal(out.get().status, 400);
}

await rm(repoRoot, { recursive: true, force: true });
await rm(customerRoot, { recursive: true, force: true });
await rm(testCacheRoot, { recursive: true, force: true });
await rm(testLogRoot, { recursive: true, force: true });
console.log("runtime_storage tests passed");
