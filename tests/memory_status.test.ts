import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryStatus, createWorkspace, inspectLegacyTdaiMemoryConfiguration } from "@linguist-agent/cat-data";

const confirmedOnly = buildMemoryStatus({ configurationDetected: false, legacyRecallWasConfigured: false });
assert.equal(confirmedOnly.status, "confirmed_memory_only");
assert.equal(confirmedOnly.toolsAvailable, false);
assert.equal(confirmedOnly.captureEnabled, false);
assert.equal(confirmedOnly.storeEnabled, false);
assert.equal(confirmedOnly.recallEnabled, false);
assert.equal(confirmedOnly.semantic.state, "disabled");
assert.match(confirmedOnly.nextAction, /Confirmed Memory/);

const root = await mkdtemp(join(tmpdir(), "la-memory-status-"));
const workspace = createWorkspace(root, "proj");
const noLegacyConfig = await inspectLegacyTdaiMemoryConfiguration(workspace);
assert.deepEqual(noLegacyConfig, { configurationDetected: false, legacyRecallWasConfigured: false });

const configPath = join(root, "data", "projects", "proj", "cat-agent-memory.json");
await mkdir(join(root, "data", "projects", "proj"), { recursive: true });
await writeFile(configPath, JSON.stringify({ enabled: true, gatewayUrl: "http://127.0.0.1:8420" }), "utf8");
const legacyConfig = await inspectLegacyTdaiMemoryConfiguration(workspace);
assert.deepEqual(legacyConfig, { configurationDetected: true, legacyRecallWasConfigured: true });

const migrationRequired = buildMemoryStatus(legacyConfig, {
  state: "ready",
  assetVectorIndex: "ready",
  embeddingModel: "la-local-e5",
  indexedBlocks: 12,
});
assert.equal(migrationRequired.status, "legacy_migration_required");
assert.equal(migrationRequired.legacyTdai.migration, "explicit_read_only_candidate_review_required");
assert.equal(migrationRequired.semantic.indexedBlocks, 12);
assert.match(migrationRequired.nextAction, /capture, store, and recall are disabled/);

console.log("memory_status tests passed");
