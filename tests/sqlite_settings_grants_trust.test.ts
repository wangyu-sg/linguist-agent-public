import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  collectSettingsGrantsTrustSources,
} from "../packages/cat-server/src/settings_grants_trust_sqlite_cutover.js";
import {
  SqliteEventProjectionStore,
  StructuredDomainImportBlockedError,
  createSqliteSettingsGrantsTrustRepository,
  prepareSqliteSettingsGrantsTrustCutover,
  structuredPayloadSha256,
} from "@linguist-agent/storage-sqlite";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "la-093-"));
}

function authority() {
  return { assertOwned: async () => undefined };
}

function record(domain: "settings" | "grants" | "trust", key: string, scope: string, payload: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    domain,
    key,
    scope,
    revision: 0,
    payload,
    payloadSha256: structuredPayloadSha256(payload),
    secretRefs: [],
  };
}

async function main(): Promise<void> {
  const root = await tempRoot();
  const databasePath = join(root, "settings-grants-trust.sqlite");
  const store = new SqliteEventProjectionStore(databasePath);
  const backend = createSqliteSettingsGrantsTrustRepository({ store, authority: authority() });

  assert.equal(backend.read({ domain: "settings", key: "global", scope: "global" }), null);
  const initial = await backend.initialize({
    address: { domain: "settings", key: "global", scope: "global" },
    value: { enabled: true },
  });
  assert.equal(initial.revision, 0);
  assert.deepEqual(backend.read({ domain: "settings", key: "global", scope: "global" })?.payload, { enabled: true });

  const updated = await backend.write({
    address: { domain: "settings", key: "global", scope: "global" },
    expectedRevision: 0,
    expectedValue: { enabled: true },
    value: { enabled: false },
  });
  assert.equal(updated.revision, 1);
  await assert.rejects(
    () => backend.write({
      address: { domain: "settings", key: "global", scope: "global" },
      expectedRevision: 0,
      expectedValue: { enabled: true },
      value: { enabled: true },
    }),
    /revision|changed|conflict/i,
  );
  await assert.rejects(
    () => stat(join(root, "data", "runtime", "settings-grants-trust-sqlite-v1", "settings-grants-trust.sqlite")),
    /ENOENT|no such file/i,
  );

  const secretRecord = record("trust", "pi", "global", { providerToken: "must-not-be-stored" });
  assert.throws(
    () => backend.digestRecord({
      sourceId: "trust/pi.json",
      domain: "trust",
      key: "pi",
      scope: "global",
      raw: Buffer.from(JSON.stringify(secretRecord)),
      value: secretRecord,
    }),
    /Keychain\/reference|secret/i,
  );

  const validPayload = { schemaVersion: 1, taskId: "task-1", grants: [] };
  const validRecord = record("grants", "task-1", "task:task-1", validPayload);
  const raw = Buffer.from(JSON.stringify(validRecord));
  const digestRecord = await backend.digestRecord({
    sourceId: "grants/task-1.json",
    domain: "grants",
    key: "task-1",
    scope: "task:task-1",
    raw,
    value: validRecord,
  });
  assert.equal(digestRecord.domain, "grants");
  assert.equal(digestRecord.envelope.payload.secret, undefined);

  const invalidRaw = Buffer.from("{\"schemaVersion\":1,\"domain\":\"grants\",\"unknown\":true}");
  await assert.rejects(
    () => prepareSqliteSettingsGrantsTrustCutover({
      root,
      authority: authority(),
      activeRunCount: 0,
      sources: [{
        sourceId: "grants/task-1.json",
        domain: "grants",
        key: "task-1",
        scope: "task:task-1",
        raw: invalidRaw,
        value: JSON.parse(invalidRaw.toString("utf8")) as Record<string, unknown>,
      }],
    }),
    (error: unknown) => error instanceof StructuredDomainImportBlockedError
      && error.report.invalid.length === 1
      && error.report.invalid[0]?.rawSha256.length === 64,
  );

  const invalidSourceRoot = await tempRoot();
  await mkdir(join(invalidSourceRoot, "data", "runtime"), { recursive: true });
  const invalidSourceBytes = Buffer.from("{not-json");
  await writeFile(join(invalidSourceRoot, "data", "runtime", "agent_permissions.json"), invalidSourceBytes);
  const collected = await collectSettingsGrantsTrustSources(invalidSourceRoot, { piAgentDir: join(invalidSourceRoot, "pi-agent") });
  assert.equal(collected.length, 1);
  assert.equal((collected[0]?.value as Record<string, unknown>).schemaVersion, 0);
  assert.deepEqual(collected[0]?.raw, invalidSourceBytes);

  const validRoot = await tempRoot();
  const prepared = await prepareSqliteSettingsGrantsTrustCutover({
    root: validRoot,
    authority: authority(),
    activeRunCount: 0,
    sources: [{
      sourceId: "settings/global.json",
      domain: "settings",
      key: "global",
      scope: "global",
      raw,
      value: record("settings", "global", "global", { enabled: true }),
    }],
  });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.authority, "sqlite");
  assert.equal(prepared.repository.read({ domain: "settings", key: "global", scope: "global" })?.revision, 0);
  const backupBytes = await readFile(join(validRoot, prepared.marker.backupRootRelativePath, "settings", "global.json"));
  assert.deepEqual(backupBytes, raw);
  await prepared.close();
  const reopened = await prepareSqliteSettingsGrantsTrustCutover({
    root: validRoot,
    authority: authority(),
    activeRunCount: 0,
    sources: [],
  });
  assert.equal(reopened.status, "already-sqlite");
  await reopened.close();

  await assert.rejects(
    () => prepareSqliteSettingsGrantsTrustCutover({
      root: validRoot,
      authority: authority(),
      activeRunCount: 1,
      sources: [],
    }),
    /Agent Runs are active/i,
  );
  store.close();
  console.log("sqlite settings/grants/trust tests passed");
}

void main();
