import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DocumentBackend, DocumentBackendEstimate, DocumentBackendParseResultV1 } from "@linguist-agent/cat-data";
import { DocumentRouter, loadDocumentRouterBenchmarkPolicy } from "@linguist-agent/cat-runtime";

const digest = "a".repeat(64);
const source = { sha256: digest, mimeType: "application/pdf" };
const input = { kind: "host-staged-file" as const, id: "benchmark-staged", sourceDigest: digest };

function backend(id: "native-text" | "light-ocr", estimate: DocumentBackendEstimate): DocumentBackend {
  return {
    id,
    version: `${id}-v1`,
    capabilities: { nativeText: id === "native-text", ocr: id === "light-ocr", layout: false, tables: false, formulas: false, multiPageReasoning: false },
    probe: async () => estimate,
    parse: async (): Promise<DocumentBackendParseResultV1> => ({ schemaVersion: 1, source, blocks: [] }),
  };
}

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`./fixtures/document-router-benchmark/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
}

test("Document Router accepts only an exact, current benchmark profile with auditable fixture evidence", async () => {
  const [profile, report] = await Promise.all([fixture("profile-v1.json"), fixture("synthetic-report-v1.json")]);
  assert.equal(profile.benchmarkReportSha256, createHash("sha256").update(JSON.stringify(report)).digest("hex"));
  const policy = loadDocumentRouterBenchmarkPolicy(profile, new Date("2026-07-24T12:00:00.000Z"));
  assert.equal(policy.source, "benchmark-profile");
  assert.equal(policy.policy.nativeTextCoverage, 0.8);
  assert.match(policy.reason, /benchmark profile.*synthetic/i);
  assert.match(policy.profileSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.throws(() => loadDocumentRouterBenchmarkPolicy({ ...profile, unexpected: true }, new Date("2026-07-24T12:00:00.000Z")), /unknown field/i);
  assert.throws(() => loadDocumentRouterBenchmarkPolicy({ ...profile, schemaVersion: 2 }, new Date("2026-07-24T12:00:00.000Z")), /schema version/i);
  const loaderSource = await readFile(new URL("../packages/cat-runtime/src/documentRouterBenchmarkPolicy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(loaderSource, /MinerU|Unlimited-OCR|best backend|always best/ui);
});

test("missing or expired benchmark profiles retain the conservative native/light/blocked policy", async () => {
  const profile = await fixture("profile-v1.json");
  assert.equal(loadDocumentRouterBenchmarkPolicy(undefined, new Date("2026-07-24T12:00:00.000Z")).source, "conservative-default");
  const expired = loadDocumentRouterBenchmarkPolicy({ ...profile, expiresAt: "2026-07-24T11:59:59.999Z" }, new Date("2026-07-24T12:00:00.000Z"));
  assert.equal(expired.source, "conservative-default");
  assert.match(expired.reason, /expired/i);
});

test("Document Router records the benchmark threshold that selected light OCR", async () => {
  const profile = await fixture("profile-v1.json");
  const router = new DocumentRouter({
    benchmarkProfile: profile,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    stage: async () => ({ source, input, pages: [1], resolveStagedInput: async () => "/never-exposed.pdf", dispose: async () => undefined }),
    backends: () => ({
      native: backend("native-text", { supported: true, reason: "native", pages: [{ page: 1, nativeTextCharacters: 10, nativeTextCoverage: 0.79, readingOrder: "verified", layoutComplexity: "simple" }] }),
      light: backend("light-ocr", { supported: true, reason: "light", pages: [] }),
    }),
  });
  const result = await router.route({ sourcePath: "/granted/source.pdf" });
  assert.equal(result.policy.source, "benchmark-profile");
  assert.equal(result.pages[0]?.backend?.id, "light-ocr");
  assert.match(result.pages[0]?.reason ?? "", /0\.79.*0\.80/u);
});
