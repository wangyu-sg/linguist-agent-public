import assert from "node:assert/strict";
import { NATIVE_CAPABILITY_PACKAGES } from "@linguist-agent/cat-runtime";

const expected = {
  subagents: {
    source: "npm:pi-subagents@0.35.1",
    integrity: "sha512-nIH6liO541FZ1RoeEu58Ligd59tiNw0/ODPgHh7uvx9Dk4UpWH08F84/l1+hXCzUgC85OCmyVtngWkZjcK94Cg==",
    extensionPath: "src/extension/index.ts",
    activation: "team",
    runtimeReadiness: "ready",
  },
  docparser: {
    source: "npm:pi-docparser@3.0.1",
    integrity: "sha512-t08KQlV6jnvXM9usnOWMyxLJL5rlwHjOO/Dy/GXF8x6PIvaFW7FGk4+l3a+HQq+nJJZQ9no9ETQuNg4ZYcN9tg==",
    extensionPath: "extensions/docparser/index.ts",
    activation: "core",
    runtimeReadiness: "ready",
  },
  ask: {
    source: "npm:@eko24ive/pi-ask@1.1.0",
    integrity: "sha512-eK02qhHH9RF5riexmjKqs+yDZheFX+6im3Dt8KnhS3EWZGvuwN/G1XvXg8SZscgGlqhJOrKPETau/dLs3xtXiQ==",
    extensionPath: "src/index.ts",
    activation: "main",
    runtimeReadiness: "ready",
  },
  research: {
    source: "npm:pi-web-access@0.13.0",
    integrity: "sha512-ny0bHisMWdobmu1hcMp/jqjaRh6pYrH7dctBK2CVyRF4ia7bP47RnOPYdG1yiks9ohtcanWir5Hl9EFap8h0zQ==",
    extensionPath: "la-headless.ts",
    activation: "on-demand",
    runtimeReadiness: "ready",
  },
  browser: {
    source: "npm:pi-agent-browser-native@0.2.67",
    integrity: "sha512-nl0+dFdzrQmptMD2ib9Eo5dWtutSvcH1r/4Z9QqMxhFnRE3wdtUuOe0gHSmiguwklxefT1TaThqEO0q2ieqMJg==",
    extensionPath: "dist/extensions/agent-browser/index.js",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "22.19.0",
    setupRequirement: "agent_browser_executable",
  },
  computer: {
    source: "npm:@injaneity/pi-computer-use@0.4.3",
    integrity: "sha512-kOURODGHXhlwUJAwv5PgxdCknjg88+274htEa2MaxnPLfEve9Mv8T28ymfH/kAFROVlRSfRshw3oNM6Sf1gD0A==",
    extensionPath: "extensions/computer-use.ts",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "20.6.0",
    setupRequirement: "signed_helper_accessibility_screen_recording",
  },
  vision: {
    source: "npm:@getpipher/vision@0.5.1",
    integrity: "sha512-mCKw0lUZ/PLI0DyS8Q5VyxJccIKbLXdRnTEOpPuPPgmCwBV9WJlK5MfPOkzOzExYp4Pz3C3eFBnlDQayAP5wHg==",
    extensionPath: "extensions/vision.ts",
    activation: "experimental",
    runtimeReadiness: "ready",
  },
} as const;

assert.equal(NATIVE_CAPABILITY_PACKAGES.length, Object.keys(expected).length);
assert.equal(new Set(NATIVE_CAPABILITY_PACKAGES.map((entry) => entry.id)).size, NATIVE_CAPABILITY_PACKAGES.length);

for (const [id, fields] of Object.entries(expected)) {
  const entry = NATIVE_CAPABILITY_PACKAGES.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing native capability package ${id}`);
  assert.equal(entry.source, fields.source);
  assert.equal(entry.integrity, fields.integrity);
  assert.equal(entry.extensionPath, fields.extensionPath);
  assert.equal(entry.activation, fields.activation);
  assert.equal(entry.runtimeReadiness, fields.runtimeReadiness);
  assert.equal(entry.minimumNodeVersion, "minimumNodeVersion" in fields ? fields.minimumNodeVersion : undefined);
  assert.equal(entry.setupRequirement, "setupRequirement" in fields ? fields.setupRequirement : undefined);
  assert.match(entry.source, /@\d+\.\d+\.\d+$/);
}

assert.ok(
  NATIVE_CAPABILITY_PACKAGES.every((entry) => !/(permission|advisor|tavily|workflow|memory|todo)/i.test(entry.source)),
  "native product profiles must not include packages that create parallel product truth",
);
assert.equal(
  NATIVE_CAPABILITY_PACKAGES.find((entry) => entry.id === "research")?.extensionPath,
  "la-headless.ts",
  "native research must use the server-owned headless wrapper",
);
assert.equal(
  NATIVE_CAPABILITY_PACKAGES.find((entry) => entry.id === "vision")?.extensionPath,
  "extensions/vision.ts",
  "native vision must exclude the package clipboard/paste extension",
);
assert.deepEqual(
  NATIVE_CAPABILITY_PACKAGES.filter(({ runtimeReadiness }) => runtimeReadiness === "setup_required").map(({ id }) => id),
  ["browser", "computer"],
  "browser and computer use must remain unavailable until their external executable/helper setup is verified",
);

console.log("native capability package tests passed");
