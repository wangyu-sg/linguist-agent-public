import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDurableFile,
  writeDurableFileAtomic,
  type DurableFileFaultPoint,
} from "../packages/cat-data/src/durable_file.js";

const root = await mkdtemp(join(tmpdir(), "la-durable-file-"));
try {
  const path = join(root, "state", "critical.json");
  await writeDurableFileAtomic(path, "old\n");

  for (const point of ["before_write", "after_write", "after_file_sync", "before_rename"] satisfies DurableFileFaultPoint[]) {
    await assert.rejects(
      writeDurableFileAtomic(path, "new\n", { faultInjection: (current) => {
        if (current === point) throw new Error(`synthetic ${point}`);
      } }),
      new RegExp(`synthetic ${point}`),
    );
    assert.equal(await readFile(path, "utf8"), "old\n", `${point} must preserve the previous committed file`);
    assert.deepEqual(await readdir(join(root, "state")), ["critical.json"], `${point} must not leave a temporary file`);
  }

  await assert.rejects(
    writeDurableFileAtomic(path, "renamed\n", { faultInjection: (point) => {
      if (point === "after_rename") throw new Error("synthetic crash after rename");
    } }),
    /synthetic crash after rename/u,
  );
  assert.equal(await readFile(path, "utf8"), "renamed\n", "a post-rename crash must leave a complete old-or-new file");
  assert.deepEqual(await readdir(join(root, "state")), ["critical.json"]);

  const order: DurableFileFaultPoint[] = [];
  await writeDurableFileAtomic(path, "durable\n", { faultInjection: (point) => order.push(point) });
  assert.deepEqual(order, ["before_write", "after_write", "after_file_sync", "before_rename", "after_rename", "after_parent_sync"]);

  const events = join(root, "events", "events.jsonl");
  const appendOrder: DurableFileFaultPoint[] = [];
  await appendDurableFile(events, '{"n":1}\n', { faultInjection: (point) => appendOrder.push(point) });
  assert.deepEqual(appendOrder, ["before_write", "after_write", "after_file_sync", "after_parent_sync"]);
  assert.equal(await readFile(events, "utf8"), '{"n":1}\n');

  await writeFile(join(root, "state", "unrelated"), "keep", "utf8");
  await assert.rejects(
    writeDurableFileAtomic(path, "disk-full\n", { faultInjection: (point) => {
      if (point === "before_write") {
        const error = new Error("synthetic disk full") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
    } }),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOSPC",
  );
  assert.equal(await readFile(path, "utf8"), "durable\n");

  console.log("durable file tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
