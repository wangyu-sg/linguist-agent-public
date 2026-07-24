import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePackageCenterRoute } from "../packages/cat-server/src/routes/package_center_routes.js";

let mutationAvailable = true;
let released = 0;
let invalidated = 0;
let previewed = 0;
let activated = 0;

const preview = {
  schemaVersion: 1 as const,
  mode: "preview" as const,
  planHash: "a".repeat(64),
  package: { id: "example.safe", version: "1.0.0", publisherId: "example", license: "MIT" },
  source: {
    schemaVersion: 1 as const,
    kind: "local_file" as const,
    sourceId: "picker:fixture",
    acquiredAt: "2026-07-22T12:00:00.000Z",
    expectedArchiveSha256: "b".repeat(64),
  },
  archiveSha256: "b".repeat(64),
  manifestSha256: "c".repeat(64),
  treeHash: "d".repeat(64),
  totalResourceBytes: 12,
  signer: {
    schemaVersion: 1 as const,
    packageId: "example.safe",
    packageVersion: "1.0.0",
    publisherId: "example",
    keyId: "example-2026",
    payloadSha256: "e".repeat(64),
    treeHash: "d".repeat(64),
    verifiedAt: "2026-07-22T12:00:00.000Z",
  },
  resources: [{ id: "review", type: "skill" as const, path: "resources/review/SKILL.md", sha256: "f".repeat(64), size: 12, mediaType: "text/markdown" }],
  resourceTypeCounts: { skill: 1 },
  executable: false as const,
  requestedCapabilities: [] as [],
  requiredRiskIds: ["skill_instructions" as const],
  createdAt: "2026-07-22T12:00:00.000Z",
  expiresAt: "2026-07-22T12:15:00.000Z",
};

async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, "http://127.0.0.1");
  let output: { status: number; data: unknown } | undefined;
  const handled = await handlePackageCenterRoute(
    Object.assign(new EventEmitter(), { method }) as IncomingMessage,
    {} as ServerResponse,
    url,
    url.pathname.split("/").filter(Boolean),
    {
      repoRoot: "/fixture",
      json: (_res, status, data) => { output = { status, data }; },
      readBody: async () => body,
      acquireCapabilityMutation: () => mutationAvailable ? () => { released += 1; } : undefined,
      invalidateResourceCatalogs: () => { invalidated += 1; },
      getCatalog: async () => ({
        schemaVersion: 1,
        source: "npm",
        docs: "https://pi.dev/docs/latest/packages",
        fetchedAt: "2026-07-20T00:00:00.000Z",
        total: 1,
        cursor: 1,
        stale: false,
        offline: false,
        items: [{ name: "alpha", version: "1.0.0", description: "discovery only", keywords: ["pi-package"], license: "MIT", publisher: null, publishedAt: null, weeklyDownloads: 2, npmUrl: "npm", piGalleryUrl: "pi", repositoryUrl: null }],
      }),
      listV2: async () => ({ schemaVersion: 2 as const, revision: 1, packages: [] }),
      inventoryLegacy: async () => ({
        schemaVersion: 1 as const,
        registryStatus: "missing" as const,
        registryPath: "/fixture/legacy.json",
        legacyInstalledRoot: "/fixture/installed",
        generatedAt: "2026-07-22T12:00:00.000Z",
        totalRecords: 0,
        counts: { declarativeCandidate: 0, manualReview: 0, corruptRecord: 0 },
        registryIssues: ["registry_missing"],
        entries: [],
      }),
      readArchive: async () => Buffer.from("signed fixture"),
      trustRoots: [],
      previewLapkg: async () => { previewed += 1; return preview; },
      activateLapkg: async () => {
        activated += 1;
        return { ...preview, packageId: preview.package.id, packageVersion: preview.package.version, activatedAt: preview.createdAt, activationRevision: 1, previewPlanHash: preview.planHash, contentDirectory: `content/${preview.treeHash}`, contentPath: "/fixture/content", source: preview.source, resources: preview.resources };
      },
    },
  );
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

assert.equal((await request("POST", "/api/package-center/install/preview", { name: "alpha", version: "1.0.0" })).status, 410);
assert.equal((await request("POST", "/api/package-center/install", {})).status, 410);
assert.equal(previewed, 0);
assert.equal(activated, 0);

const catalog = await request("GET", "/api/package-center/catalog");
assert.equal(catalog.status, 200);
assert.equal((catalog.data as { installMode: string }).installMode, "discovery_only");

const installed = await request("GET", "/api/package-center/installed");
assert.equal(installed.status, 200);
assert.equal((installed.data as { schemaVersion: number }).schemaVersion, 2);
assert.equal(JSON.stringify(installed.data).includes("/fixture/legacy.json"), false);
assert.equal(JSON.stringify(installed.data).includes("/fixture/installed"), false);

assert.equal((await request("POST", "/api/package-center/lapkg/preview", { archivePath: "/tmp/example.safe.lapkg", extra: true })).status, 400);
assert.equal((await request("POST", "/api/package-center/lapkg/preview", { archivePath: "/tmp/example.safe.tgz" })).status, 400);
const previewResult = await request("POST", "/api/package-center/lapkg/preview", { archivePath: "/tmp/example.safe.lapkg" });
assert.equal(previewResult.status, 200);
assert.equal(previewed, 1);

mutationAvailable = false;
assert.equal((await request("POST", "/api/package-center/lapkg/activate", { archivePath: "/tmp/example.safe.lapkg", expectedPlanHash: preview.planHash, preview })).status, 409);
assert.equal(activated, 0);
mutationAvailable = true;
const activatedResult = await request("POST", "/api/package-center/lapkg/activate", { archivePath: "/tmp/example.safe.lapkg", expectedPlanHash: preview.planHash, preview });
assert.equal(activatedResult.status, 201);
assert.equal(activated, 1);
assert.equal(invalidated, 1);
assert.equal(released, 1);

console.log("stable .lapkg Package Center route tests passed");
