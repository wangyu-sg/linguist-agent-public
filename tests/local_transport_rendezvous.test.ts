import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createRuntimeRendezvous,
  deriveRuntimeSessionCredential,
  prepareRuntimeTransportRoot,
  publishRuntimeRendezvous,
  secureRuntimeSocket,
} from "../packages/cat-server/src/local_transport_rendezvous.js";
import {
  readVerifiedRuntimeRendezvous,
  requestUnixRuntime,
  runtimeTransportPaths,
} from "../apps/desktop/src/runtime-transport.mjs";
import { inspectRuntime, requestRuntime } from "../apps/desktop/src/runtime-client.mjs";

const root = await mkdtemp("/tmp/la-rendezvous-");
const { rendezvousPath } = runtimeTransportPaths(root);
const socketPath = join(root, "runtime-a.sock");
const bootstrapToken = "bootstrap-secret";
const instanceId = "instance-a";

await mkdir(root, { recursive: true, mode: 0o700 });
try {
  assert.deepEqual(
    await inspectRuntime({
      LA_LOCAL_API_TOKEN: bootstrapToken,
      LA_RUNTIME_TRANSPORT_ROOT: root,
    }),
    {
      status: "offline",
      message: "无法连接本机 Linguist Agent runtime。",
      baseURL: "unix://authenticated-rendezvous",
    },
    "a clean first install must report offline before requiring a credential or connecting anywhere",
  );
  await chmod(root, 0o755);
  await prepareRuntimeTransportRoot(root);
  assert.equal((await lstat(root)).mode & 0o777, 0o700);
  const record = createRuntimeRendezvous({
    bootstrapToken,
    runtimeInstanceId: instanceId,
    socketPath,
    nonce: "nonce-a",
    issuedAt: "2026-07-23T00:00:00.000Z",
  });
  assert.throws(() => createRuntimeRendezvous({
    bootstrapToken,
    runtimeInstanceId: instanceId,
    socketPath: `/${"x".repeat(110)}.sock`,
  }), /Unix-domain limit/);
  assert.equal(record.transport, "unix");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.socketPath, socketPath);
  assert.equal(Object.hasOwn(record, "sessionCredential"), false, "the session credential must never be written to disk");
  assert.equal(
    deriveRuntimeSessionCredential(bootstrapToken, record),
    deriveRuntimeSessionCredential(bootstrapToken, { ...record }),
  );

  await publishRuntimeRendezvous(rendezvousPath, record);
  await chmod(root, 0o755);
  await assert.rejects(
    readVerifiedRuntimeRendezvous({ rendezvousPath, bootstrapToken, expectedRoot: root }),
    /directory permissions/i,
  );
  await chmod(root, 0o700);
  const verified = await readVerifiedRuntimeRendezvous({
    rendezvousPath,
    bootstrapToken,
    expectedRoot: root,
  });
  assert.equal(verified.socketPath, socketPath);
  assert.equal(verified.sessionCredential, deriveRuntimeSessionCredential(bootstrapToken, record));

  const tampered = JSON.parse(await readFile(rendezvousPath, "utf8"));
  tampered.socketPath = join(root, "fake.sock");
  await writeFile(rendezvousPath, JSON.stringify(tampered), { mode: 0o600 });
  await assert.rejects(
    readVerifiedRuntimeRendezvous({ rendezvousPath, bootstrapToken, expectedRoot: root }),
    /signature/i,
    "a fake runtime cannot redirect the Desktop by replacing the socket path",
  );

  await publishRuntimeRendezvous(rendezvousPath, record);
  await chmod(rendezvousPath, 0o644);
  await assert.rejects(
    readVerifiedRuntimeRendezvous({ rendezvousPath, bootstrapToken, expectedRoot: root }),
    /permissions/i,
  );
  await chmod(rendezvousPath, 0o600);

  let fakePortHits = 0;
  const fakePortServer = createServer((_request, response) => {
    fakePortHits += 1;
    response.end("fake");
  });
  await new Promise<void>((resolve) => fakePortServer.listen(0, "127.0.0.1", resolve));

  let expectedAuthorization = `Bearer ${deriveRuntimeSessionCredential(bootstrapToken, record)}`;
  let unixServer = createServer((request, response) => {
    assert.equal(request.headers.authorization, expectedAuthorization);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ runtime: "a" }));
  });
  await new Promise<void>((resolve) => unixServer.listen(socketPath, resolve));
  await secureRuntimeSocket(socketPath);
  assert.equal((await lstat(socketPath)).mode & 0o777, 0o600);
  try {
    const response = await requestUnixRuntime({
      rendezvousPath,
      bootstrapToken,
      expectedRoot: root,
      method: "GET",
      path: "/api/health",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { runtime: "a" });
    assert.equal(fakePortHits, 0, "the default transport must never probe a fixed loopback port");
    const desktopResponse = await requestRuntime({ method: "GET", path: "/api/health" }, {
      LA_LOCAL_API_TOKEN: bootstrapToken,
      LA_RUNTIME_TRANSPORT_ROOT: root,
    });
    assert.equal(desktopResponse.status, 200);
    assert.deepEqual(desktopResponse.data, { runtime: "a" });
    assert.equal(fakePortHits, 0, "the integrated Desktop client must not probe the loopback squatter");
  } finally {
    await new Promise<void>((resolve, reject) => unixServer.close((error) => error ? reject(error) : resolve()));
    await rm(socketPath, { force: true });
  }

  const nextSocketPath = join(root, "runtime-b.sock");
  const nextRecord = createRuntimeRendezvous({
    bootstrapToken,
    runtimeInstanceId: instanceId,
    socketPath: nextSocketPath,
    nonce: "nonce-b",
    issuedAt: "2026-07-23T00:01:00.000Z",
  });
  await publishRuntimeRendezvous(rendezvousPath, nextRecord);
  expectedAuthorization = `Bearer ${deriveRuntimeSessionCredential(bootstrapToken, nextRecord)}`;
  unixServer = createServer((request, response) => {
    assert.equal(request.headers.authorization, expectedAuthorization);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ runtime: "b" }));
  });
  await new Promise<void>((resolve) => unixServer.listen(nextSocketPath, resolve));
  try {
    const response = await requestUnixRuntime({
      rendezvousPath,
      bootstrapToken,
      expectedRoot: root,
      method: "GET",
      path: "/api/health",
    });
    assert.deepEqual(await response.json(), { runtime: "b" }, "reconnect must reread the signed rendezvous");
  } finally {
    await new Promise<void>((resolve, reject) => unixServer.close((error) => error ? reject(error) : resolve()));
    await rm(nextSocketPath, { force: true });
    await new Promise<void>((resolve, reject) => fakePortServer.close((error) => error ? reject(error) : resolve()));
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("local transport rendezvous tests passed");
