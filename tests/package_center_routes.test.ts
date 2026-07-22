import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePackageCenterRoute } from "../packages/cat-server/src/routes/package_center_routes.js";

let mutationAvailable = true;
let released = 0;
let invalidated = 0;
let promoted = 0;

async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  const url = new URL(path, "http://127.0.0.1");
  let output: { status: number; data: any } | undefined;
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
        total: 2,
        cursor: 2,
        stale: false,
        offline: false,
        items: [
          { name: "alpha", version: "1.0.0", description: "alpha browser", keywords: ["pi-package"], license: "MIT", publisher: null, publishedAt: null, weeklyDownloads: 2, npmUrl: "npm", piGalleryUrl: "pi", repositoryUrl: null },
          { name: "beta", version: "2.0.0", description: "beta office", keywords: ["pi-package"], license: "MIT", publisher: null, publishedAt: null, weeklyDownloads: 1, npmUrl: "npm", piGalleryUrl: "pi", repositoryUrl: null },
        ],
      }),
      listInstalled: async () => [],
      previewInstall: async (_root, input) => ({ mode: "preview", planHash: "a".repeat(64), descriptor: { package: { name: input.name, version: input.version } }, requiredRiskIds: ["extension_code"], expiresAt: "2026-07-21T00:00:00.000Z", docs: "pi" } as any),
      promoteInstall: async (_root, input) => {
        promoted += 1;
        return { packageName: input.name, version: input.version, descriptor: { trust: "approved" } } as any;
      },
    },
  );
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

const catalog = await request("GET", "/api/package-center/catalog?q=office&cursor=0&limit=10");
assert.equal(catalog.status, 200);
assert.equal(catalog.data.items.length, 1);
assert.equal(catalog.data.items[0].name, "beta");

const installed = await request("GET", "/api/package-center/installed");
assert.equal(installed.status, 200);
assert.equal(installed.data.corePolicy.length, 4);

const preview = await request("POST", "/api/package-center/install/preview", { name: "alpha", version: "1.0.0" });
assert.equal(preview.status, 200);
assert.deepEqual(preview.data.requiredRiskIds, ["extension_code"]);

mutationAvailable = false;
assert.equal((await request("POST", "/api/package-center/install", {})).status, 409);
assert.equal(promoted, 0);
mutationAvailable = true;
const promotedResult = await request("POST", "/api/package-center/install", {
  planHash: "a".repeat(64),
  name: "alpha",
  version: "1.0.0",
  confirmedVersion: "1.0.0",
  acceptedRiskIds: ["extension_code"],
});
assert.equal(promotedResult.status, 201);
assert.equal(promoted, 1);
assert.equal(invalidated, 1);
assert.equal(released, 1);

console.log("package center route tests passed");
