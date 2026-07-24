import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireDataRootWriterLease,
  dataRootWriterLeaseOwnerPath,
  DataRootWriterLeaseError,
} from "../packages/cat-server/src/data_root_writer_lease.js";

function waitForMessage(child: ReturnType<typeof fork>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    child.once("message", (message) => resolve(message as Record<string, unknown>));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && code !== 0 && code !== 2) reject(new Error(`lease child exited ${code}`));
    });
  });
}

const roots: string[] = [];
try {
  const root = await mkdtemp(join(tmpdir(), "la-data-root-lease-"));
  roots.push(root);
  const first = await acquireDataRootWriterLease(root, {
    pid: 101,
    now: new Date("2026-07-23T01:00:00.000Z"),
    productVersion: "2.32.7-test",
    isProcessAlive: (pid) => pid === 101,
  });
  assert.equal(first.owner.productVersion, "2.32.7-test");
  await assert.rejects(
    acquireDataRootWriterLease(root, { pid: 202, productVersion: "test", isProcessAlive: (pid) => pid === 101 }),
    (error: unknown) => error instanceof DataRootWriterLeaseError && error.code === "DATA_ROOT_WRITER_LEASE_HELD",
  );
  await first.assertOwned();
  await mkdir(join(root, "data"));
  await rename(join(root, "data"), join(root, "data.previous"));
  await mkdir(join(root, "data"));
  await first.assertOwned();
  await first.release();

  const stale = await acquireDataRootWriterLease(root, {
    pid: 303,
    productVersion: "stale",
    isProcessAlive: () => false,
  });
  const replacement = await acquireDataRootWriterLease(root, {
    pid: 404,
    productVersion: "replacement",
    isProcessAlive: () => false,
  });
  await assert.rejects(stale.assertOwned(), (error: unknown) =>
    error instanceof DataRootWriterLeaseError && error.code === "DATA_ROOT_WRITER_LEASE_LOST");
  await assert.rejects(stale.release(), (error: unknown) =>
    error instanceof DataRootWriterLeaseError && error.code === "DATA_ROOT_WRITER_LEASE_LOST");
  await replacement.release();

  const ambiguousRoot = await mkdtemp(join(tmpdir(), "la-data-root-lease-ambiguous-"));
  roots.push(ambiguousRoot);
  const ambiguousOwner = dataRootWriterLeaseOwnerPath(ambiguousRoot);
  await mkdir(join(ambiguousOwner, ".."), { recursive: true });
  await writeFile(ambiguousOwner, "not-json\n", "utf8");
  await assert.rejects(
    acquireDataRootWriterLease(ambiguousRoot, { productVersion: "test", isProcessAlive: () => false }),
    (error: unknown) => error instanceof DataRootWriterLeaseError && error.code === "DATA_ROOT_WRITER_LEASE_AMBIGUOUS",
  );

  const processRoot = await mkdtemp(join(tmpdir(), "la-data-root-lease-process-"));
  roots.push(processRoot);
  const childPath = join(process.cwd(), "tests", "fixtures", "data_root_writer_lease_child.ts");
  const holder = fork(childPath, [processRoot, "hold"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  assert.equal((await waitForMessage(holder)).kind, "acquired");
  const contender = fork(childPath, [processRoot, "once"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const rejected = await waitForMessage(contender);
  assert.equal(rejected.kind, "error");
  assert.match(String(rejected.message), /already owns the data root/u);
  await new Promise<void>((resolve) => contender.once("exit", () => resolve()));
  holder.send({ kind: "release" });
  await new Promise<void>((resolve) => holder.once("exit", () => resolve()));
  await assert.rejects(readFile(dataRootWriterLeaseOwnerPath(processRoot), "utf8"), /ENOENT/u);

  const desktopMain = await readFile(join(process.cwd(), "apps", "desktop", "src", "main.ts"), "utf8");
  assert.match(desktopMain, /app\.requestSingleInstanceLock\(\)/u);
  const server = await readFile(join(process.cwd(), "packages", "cat-server", "src", "server.ts"), "utf8");
  assert.ok(server.indexOf("acquireDataRootWriterLease") < server.indexOf("migrateRuntimeDataSchemaV2(repoRoot"),
    "the dataRoot lease must be acquired before startup migration writes");

  console.log("data root writer lease tests passed");
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
