import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSafeLogger,
  redactLogContext,
  serializeSafeLogEvent,
} from "../packages/cat-data/src/safe_logging.js";
import {
  createServerDiagnostic,
  appendServerDiagnostics,
  readServerDiagnostics,
  serverDiagnosticsPath,
} from "../packages/cat-server/src/server_diagnostics.js";

const secret = "sk-live-customer-secret";
const customerText = "The unreleased character is secretly the final boss.";
const localPath = "/Users/customer/Client Alpha/secret.xliff";
const windowsPath = "C:\\Users\\customer\\Client Alpha\\secret.xliff";
const nestedError = new Error(`Failed ${localPath}?token=${secret}`);
Object.assign(nestedError, { code: "ECLIENT", authorization: `Bearer ${secret}` });
const circular: { self?: unknown } = {};
circular.self = circular;

const redacted = redactLogContext({
  request: {
    headers: {
      authorization: `Bearer ${secret}`,
      cookie: `session=${secret}`,
      "content-type": "application/json",
    },
    url: `https://example.invalid/path?token=${secret}&page=2`,
  },
  sourceText: customerText,
  target: customerText,
  detail: customerText,
  projectPath: localPath,
  filePath: windowsPath,
  nested: { error: nestedError },
  nestedCycle: circular,
  metrics: Array.from({ length: 101 }, (_, index) => index),
  tokenCount: 42,
});

const serialized = JSON.stringify(redacted);
for (const forbidden of [secret, customerText, localPath, windowsPath, "Bearer "]) {
  assert.equal(serialized.includes(forbidden), false, `log context leaked ${forbidden}`);
}
assert.match(serialized, /REDACTED/);
assert.match(serialized, /ECLIENT/);
assert.match(serialized, /content-type/);
assert.match(serialized, /tokenCount/);
assert.match(serialized, /CIRCULAR/);
assert.match(serialized, /TRUNCATED/);

const fixedNow = () => "2026-07-23T00:00:00.000Z";
const line = serializeSafeLogEvent({
  level: "error",
  event: "runtime.request_failed",
  context: { error: nestedError, sourceText: customerText },
}, fixedNow, () => "diagnostic-fixed");
assert.deepEqual(JSON.parse(line), JSON.parse(JSON.stringify({
  schemaVersion: 1,
  ts: "2026-07-23T00:00:00.000Z",
  diagnosticId: "diagnostic-fixed",
  level: "error",
  event: "runtime.request_failed",
  context: redactLogContext({ error: nestedError, sourceText: customerText }),
})));

const emitted: string[] = [];
const logger = createSafeLogger({
  write: (value) => emitted.push(value),
  now: fixedNow,
  createDiagnosticId: () => "diagnostic-logger",
});
logger.warn("runtime.retry_scheduled", { authorization: secret, attempt: 2 });
assert.equal(emitted.length, 1);
assert.equal(emitted[0]?.endsWith("\n"), true);
assert.equal(emitted[0]?.includes(secret), false);
assert.equal(JSON.parse(emitted[0]!).event, "runtime.retry_scheduled");
assert.equal(JSON.parse(emitted[0]!).diagnosticId, "diagnostic-logger");
assert.throws(
  () => serializeSafeLogEvent({ level: "info", event: "runtime.invalid_id" }, fixedNow, () => customerText),
  /diagnostic ID is invalid/,
);

const diagnostic = createServerDiagnostic({
  ts: fixedNow(),
  severity: "error",
  code: "project_manifest_unreadable",
  error: nestedError,
  path: localPath,
  projectId: "Client Alpha unreleased",
});
assert.equal(diagnostic.schemaVersion, 1);
assert.equal(diagnostic.message.includes(localPath), false);
assert.equal(diagnostic.path, "[REDACTED_PATH]");
assert.equal(diagnostic.projectId, "[REDACTED]");

const legacyRoot = await mkdtemp(join(tmpdir(), "la-safe-log-"));
try {
  const legacyPath = serverDiagnosticsPath(legacyRoot);
  await mkdir(join(legacyRoot, "data"), { recursive: true });
  const legacyLine = JSON.stringify({
    ts: fixedNow(),
    severity: "error",
    code: "project_manifest_unreadable",
    message: `Failed ${localPath} with Bearer ${secret}`,
    path: localPath,
  });
  await writeFile(legacyPath, `${legacyLine}\n`, "utf8");
  const [legacyDiagnostic] = await readServerDiagnostics(legacyRoot);
  assert.equal(JSON.stringify(legacyDiagnostic).includes(secret), false);
  assert.equal(JSON.stringify(legacyDiagnostic).includes(localPath), false);
  assert.equal(await readFile(legacyPath, "utf8"), `${legacyLine}\n`, "legacy logs remain read-only");
} finally {
  await rm(legacyRoot, { recursive: true, force: true });
}

const retentionRoot = await mkdtemp(join(tmpdir(), "la-log-retention-"));
try {
  const retained = createServerDiagnostic({
    ts: fixedNow(),
    severity: "warning",
    code: "mcp_discovery_failed",
    message: "A bounded diagnostic for retention testing.",
  });
  for (let index = 0; index < 10; index += 1) {
    await appendServerDiagnostics(retentionRoot, [retained], { maxBytes: 1_024 });
  }
  assert.ok((await stat(serverDiagnosticsPath(retentionRoot))).size <= 1_024);
  assert.ok((await stat(`${serverDiagnosticsPath(retentionRoot)}.1`)).size <= 1_024);
} finally {
  await rm(retentionRoot, { recursive: true, force: true });
}

const repoRoot = process.cwd();
const guardedSources = (
  await Promise.all(["packages", "apps/desktop/src"].map(async (root) => (
    await readdir(join(repoRoot, root), { recursive: true })
  ).filter((entry) => /\.(?:[cm]?js|tsx?)$/.test(entry) && !/\.test\./.test(entry)).map((entry) => join(root, entry))))
).flat().filter((relativePath) => ![
  "packages/cat-data/src/safe_logging.ts",
  // This command injects a user-facing CLI writer; its output is not retained as a product log.
  "packages/cat-server/src/install_resident.ts",
].includes(relativePath));
for (const relativePath of guardedSources) {
  const source = await readFile(join(repoRoot, relativePath), "utf8");
  assert.equal(
    /console\.(?:log|info|warn|error|debug)\s*\(/.test(source),
    false,
    `${relativePath} must use the shared safe logger instead of direct console output`,
  );
}

console.log("safe logging tests passed");
