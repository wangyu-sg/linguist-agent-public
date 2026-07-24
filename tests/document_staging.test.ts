import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupExpiredDocumentStaging, stagePdfDocument } from "@linguist-agent/cat-data";

test("Host PDF staging freezes bytes and exposes only an opaque handle with complete pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-staging-"));
  try {
    const source = join(root, "granted-source.pdf");
    const stagingRoot = join(root, "staging");
    await writeFile(source, "before-stage", "utf8");
    const staged = await stagePdfDocument({
      sourcePath: source,
      stagingRoot,
      maxInputBytes: 1024,
      inspectPageCount: async () => 2,
    });
    await writeFile(source, "after-stage", "utf8");

    assert.equal(staged.source.sha256, createHash("sha256").update("before-stage").digest("hex"));
    assert.deepEqual(staged.pages, [1, 2]);
    assert.deepEqual(staged.input, { kind: "host-staged-file", id: staged.input.id, sourceDigest: staged.source.sha256 });
    assert.equal(JSON.stringify(staged).includes(source), false);
    assert.equal(await readFile(await staged.resolveStagedInput(staged.input), "utf8"), "before-stage");
    await assert.rejects(
      () => staged.resolveStagedInput({ ...staged.input, id: "unknown" }),
      /Host staged document handle is unavailable/u,
    );

    const stagedPath = await staged.resolveStagedInput(staged.input);
    await staged.dispose();
    await assert.rejects(() => access(stagedPath));
    await assert.rejects(() => staged.resolveStagedInput(staged.input), /Host staged document handle is unavailable/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host PDF staging refuses oversized input or absent page inventory and cleans partial copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-document-staging-"));
  try {
    const source = join(root, "granted-source.pdf");
    const stagingRoot = join(root, "staging");
    await writeFile(source, "oversized", "utf8");
    await assert.rejects(
      () => stagePdfDocument({ sourcePath: source, stagingRoot, maxInputBytes: 1, inspectPageCount: async () => 1 }),
      /input exceeds the Host limit/u,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    await assert.rejects(
      () => stagePdfDocument({ sourcePath: source, stagingRoot, maxInputBytes: 1024, inspectPageCount: async () => { throw new Error("pdfinfo unavailable"); } }),
      /PDF page inventory failed/u,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    await assert.rejects(
      () => stagePdfDocument({ sourcePath: source, stagingRoot, maxInputBytes: 1024, maxPages: 1, inspectPageCount: async () => 2 }),
      /page count exceeds the Host limit/u,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    const stale = join(stagingRoot, "document-router-crashed");
    const fresh = join(stagingRoot, "document-router-fresh");
    const unrelated = join(stagingRoot, "other-private-state");
    await Promise.all([mkdir(stale), mkdir(fresh), mkdir(unrelated)]);
    const now = new Date("2026-07-24T12:00:00.000Z");
    await utimes(stale, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
    assert.equal(await cleanupExpiredDocumentStaging({ stagingRoot, maxAgeMs: 24 * 60 * 60 * 1000, now }), 1);
    assert.deepEqual((await readdir(stagingRoot)).sort(), ["document-router-fresh", "other-private-state"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
