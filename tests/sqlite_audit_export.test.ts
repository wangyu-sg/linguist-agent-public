import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeSqliteAuditCommand,
  exportSqliteAuditJsonl,
  SqliteEventProjectionStore,
  verifySqliteAuditJsonl,
} from "../packages/storage-sqlite/src/index.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const root = await mkdtemp(join(tmpdir(), "la-sqlite-audit-export-"));

try {
  const databasePath = join(root, "source.sqlite");
  const store = new SqliteEventProjectionStore(databasePath);
  store.append({
    commandId: "command-stream-b",
    streamId: "stream-b",
    expectedRevision: 0,
    events: [{
      id: "event-b-1",
      type: "message_recorded",
      occurredAt: "2026-07-23T21:00:02.000Z",
      payload: {
        text: "CUSTOMER SECRET TRANSLATION",
        authorization: "Bearer secret-token",
        sourcePath: "/Users/example/customer/source.xliff",
        nested: { z: 1, a: true },
      },
    }],
    projection: {
      status: "active",
      content: "PRIVATE PROJECT CONTENT",
      nested: { second: 2, first: 1 },
    },
  });
  store.append({
    commandId: "command-stream-a",
    streamId: "stream-a",
    expectedRevision: 0,
    events: [{
      id: "event-a-1",
      type: "run_started",
      occurredAt: "2026-07-23T21:00:00.000Z",
      payload: { modelId: "model-a", prompt: "DO NOT EXPORT ME" },
    }, {
      id: "event-a-2",
      type: "run_completed",
      occurredAt: "2026-07-23T21:00:01.000Z",
      payload: { usage: { outputTokens: 42, inputTokens: 21 } },
    }],
    projection: {
      content: "ANOTHER PRIVATE VALUE",
      status: "completed",
    },
  });
  store.close();
  const databaseBefore = await readFile(databasePath);

  const outputA = join(root, "audit-a.jsonl");
  const outputB = join(root, "audit-b.jsonl");
  const readonlyStore = new SqliteEventProjectionStore(databasePath, { readOnly: true });
  const first = await exportSqliteAuditJsonl({
    store: readonlyStore,
    destinationPath: outputA,
  });
  const second = await exportSqliteAuditJsonl({
    store: readonlyStore,
    destinationPath: outputB,
  });
  const bytesA = await readFile(outputA);
  const bytesB = await readFile(outputB);
  assert.deepEqual(bytesB, bytesA, "repeated exports from one SQLite snapshot must be byte-identical");
  assert.equal(first.sha256, sha256(bytesA));
  assert.deepEqual(second, { ...first, destinationPath: outputB });
  assert.equal(first.eventCount, 3);
  assert.equal(first.projectionCount, 2);
  assert.equal(first.recordCount, 7);

  const text = bytesA.toString("utf8");
  for (const forbidden of [
    "CUSTOMER SECRET TRANSLATION",
    "Bearer secret-token",
    "/Users/example/customer/source.xliff",
    "PRIVATE PROJECT CONTENT",
    "DO NOT EXPORT ME",
    "ANOTHER PRIVATE VALUE",
  ]) {
    assert.equal(text.includes(forbidden), false, `audit export must not contain ${forbidden}`);
  }
  assert.equal(text.includes("\"payload\":"), false);
  assert.equal(text.includes("\"projection\":"), false);
  assert.equal(text.includes("\"stream-a\""), false);
  assert.equal(text.includes("\"event-a-1\""), false);

  const records = text.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(records.map(({ ordinal }) => ordinal), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(records.map(({ recordType }) => recordType), [
    "header",
    "event",
    "event",
    "projection",
    "event",
    "projection",
    "trailer",
  ]);
  assert.deepEqual(
    records.filter(({ recordType }) => recordType === "event").map(({ sequence }) => sequence),
    [1, 2, 1],
    "events must be ordered by canonical stream inventory and then SQLite sequence",
  );
  for (let index = 1; index < records.length; index += 1) {
    assert.equal(records[index]?.previousHash, records[index - 1]?.hash);
  }
  assert.equal(records[0]?.previousHash, null);
  assert.equal(records.at(-1)?.eventCount, 3);
  assert.equal(records.at(-1)?.projectionCount, 2);

  const verified = await verifySqliteAuditJsonl({
    store: readonlyStore,
    auditPath: outputA,
  });
  assert.deepEqual(verified, {
    valid: true,
    sha256: first.sha256,
    eventCount: 3,
    projectionCount: 2,
    recordCount: 7,
  });

  const cliOutput = join(root, "audit-cli.jsonl");
  const cliExport = await executeSqliteAuditCommand([
    "export",
    "--database",
    databasePath,
    "--output",
    cliOutput,
  ]);
  assert.equal(cliExport.mode, "export");
  assert.deepEqual(await readFile(cliOutput), bytesA);
  const cliVerify = await executeSqliteAuditCommand([
    "verify",
    "--database",
    databasePath,
    "--input",
    cliOutput,
  ]);
  assert.equal(cliVerify.mode, "verify");
  assert.equal(cliVerify.valid, true);
  assert.deepEqual(
    await readFile(databasePath),
    databaseBefore,
    "export and verification must open the SQLite database read-only",
  );

  const tamperedPath = join(root, "audit-tampered.jsonl");
  const tampered = text.replace(/"sequence":1/u, "\"sequence\":99");
  await writeFile(tamperedPath, tampered);
  await assert.rejects(
    verifySqliteAuditJsonl({ store: readonlyStore, auditPath: tamperedPath }),
    /does not match the canonical SQLite snapshot/,
  );

  await assert.rejects(
    exportSqliteAuditJsonl({
      store: readonlyStore,
      destinationPath: "relative-audit.jsonl",
    }),
    /destinationPath must be absolute/,
  );
  await assert.rejects(
    exportSqliteAuditJsonl({
      store: readonlyStore,
      destinationPath: outputA,
    }),
    /destinationPath already exists/,
  );

  const failedOutput = join(root, "audit-failed.jsonl");
  class PublishRaceStore extends SqliteEventProjectionStore {
    override listProjections() {
      const projections = super.listProjections();
      writeFileSync(failedOutput, "competing writer\n", { flag: "wx" });
      return projections;
    }
  }
  const publishRaceStore = new PublishRaceStore(databasePath, { readOnly: true });
  await assert.rejects(
    exportSqliteAuditJsonl({
      store: publishRaceStore,
      destinationPath: failedOutput,
    }),
    /EEXIST/,
  );
  publishRaceStore.close();
  assert.equal(
    (await readdir(root)).some((name) => name.includes("audit-failed.jsonl.staging-")),
    false,
    "failed export must remove its partial staging file",
  );
  assert.equal(
    await readFile(failedOutput, "utf8"),
    "competing writer\n",
    "no-overwrite publish must preserve a destination created during the export race",
  );

  await assert.rejects(
    executeSqliteAuditCommand(["export", "--database", databasePath]),
    /requires exactly --database and --output/,
  );
  await assert.rejects(
    executeSqliteAuditCommand([
      "verify",
      "--database",
      databasePath,
      "--input",
      outputA,
      "--unknown",
      "value",
    ]),
    /unknown or duplicate option/,
  );
  readonlyStore.close();

  const moduleSource = await readFile(
    join(process.cwd(), "packages", "storage-sqlite", "src", "sqlite_audit_export.ts"),
    "utf8",
  );
  for (const forbiddenWriter of [".append(", ".replaceProjection(", ".initializeProjection("]) {
    assert.equal(
      moduleSource.includes(forbiddenWriter),
      false,
      `read-only audit module must not contain ${forbiddenWriter}`,
    );
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_audit_export.test.ts passed");
