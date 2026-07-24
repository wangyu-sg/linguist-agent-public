import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/renderer/library/LibraryWorkspace.tsx", import.meta.url), "utf8");

test("Memory Center exposes explicit scope, conflict, expiry, and lexical-only recall state without presenting Memory as Evidence", () => {
  assert.match(source, /Client and Franchise have no inferred Project mapping/);
  assert.match(source, /Confirm & supersede conflict/);
  assert.match(source, /Expires at \(optional\)/);
  assert.match(source, /Lexical-only:/);
  assert.match(source, /memory is never client evidence/);
});
