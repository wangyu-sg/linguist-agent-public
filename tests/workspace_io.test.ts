import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, readJsonlFile, writeJsonFile } from "@linguist-agent/cat-data";

const dir = await mkdtemp(join(tmpdir(), "la-workspace-io-"));
try {
  // writeJsonFile: creates parent dirs, writes valid JSON with trailing newline,
  // and leaves no tmp artifacts behind after the rename.
  const jsonPath = join(dir, "nested", "chat.json");
  await writeJsonFile(jsonPath, [{ kind: "user", text: "hello" }]);
  const raw = await readFile(jsonPath, "utf8");
  assert.equal(raw.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(raw), [{ kind: "user", text: "hello" }]);
  assert.deepEqual(await readJsonFile(jsonPath, []), [{ kind: "user", text: "hello" }]);
  assert.deepEqual(await readdir(join(dir, "nested")), ["chat.json"], "no tmp files may remain after a successful write");

  // readJsonFile: missing file returns the fallback.
  assert.deepEqual(await readJsonFile(join(dir, "missing.json"), { fallback: true }), { fallback: true });

  // readJsonFile: corrupt content must throw (never silently replaced by the
  // fallback) and the raw payload must be preserved in a .corrupt-* backup.
  const corruptPath = join(dir, "corrupt.json");
  await writeFile(corruptPath, '{"truncated": tru', "utf8");
  await assert.rejects(() => readJsonFile(corruptPath, []), /Invalid JSON in .*corrupt\.json/);
  const backup = (await readdir(dir)).find((entry) => entry.startsWith("corrupt.json.corrupt-"));
  assert.ok(backup, "corrupt JSON must be preserved in a .corrupt-* backup");
  assert.equal(await readFile(join(dir, backup), "utf8"), '{"truncated": tru');

  // readJsonlFile: a torn trailing line (crash mid-append) is tolerated…
  const tornPath = join(dir, "trace.jsonl");
  await writeFile(tornPath, `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n{"n": 3`, "utf8");
  assert.deepEqual(await readJsonlFile(tornPath), [{ n: 1 }, { n: 2 }]);

  // …but corruption anywhere else still fails loudly with the line number.
  const middleCorruptPath = join(dir, "trace-bad.jsonl");
  await writeFile(middleCorruptPath, `${JSON.stringify({ n: 1 })}\n{"n": broken\n${JSON.stringify({ n: 3 })}\n`, "utf8");
  await assert.rejects(() => readJsonlFile(middleCorruptPath), /Invalid JSONL in .* at line 2/);

  // readJsonlFile: missing file is an empty log.
  assert.deepEqual(await readJsonlFile(join(dir, "missing.jsonl")), []);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("workspace_io tests passed");
