import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { qualifyManagedOfficePack } from "../packages/cat-server/src/document_qualification_runner.ts";

test("managed Office qualification accepts only the worker's complete 20-per-format offline report", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-office-qualification-"));
  const formats = ["docx", "xlsx", "pptx", "pdf"] as const;
  const result = await qualifyManagedOfficePack(root, join(root, "fixtures"), {
    inspectCapabilities: async () => ({
      python: { state: "ready" },
      office: { state: "ready" },
      ocr: { state: "missing" },
      mineru: { state: "unqualified" },
    } as any),
    runWorker: async (options) => [{
      ok: true,
      outputRoot: (options.request as any).outputRoot,
      outboundCustomerFileRequests: 0,
      fixtures: formats.flatMap((format) => Array.from({ length: 20 }, (_, index) => ({
        id: `${format}-${index + 1}`,
        format,
        sourceUnchanged: true,
        outputReopened: true,
        referencesPreserved: true,
        formulasPreserved: true,
      }))),
    }],
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.fixtureCounts, { docx: 20, xlsx: 20, pptx: 20, pdf: 20 });
  assert.equal(result.fixtureIds.length, 80);
  assert.equal(result.outboundCustomerFileRequests, 0);
});
