import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import {
  LocalTransportError,
  createLocalTransportSecurity,
  readLocalJsonBody,
  resolveLocalTransportToken,
} from "../packages/cat-server/src/local_transport_security.js";

const security = createLocalTransportSecurity({ token: "local-secret" });

assert.deepEqual(
  security.authorize({ method: "GET", pathname: "/api/health" }),
  { allowed: true, public: true },
);
assert.equal(security.authorize({ method: "POST", pathname: "/api/health" }).status, 401);
assert.equal(security.authorize({ method: "GET", pathname: "/api/projects" }).status, 401);
assert.equal(
  security.authorize({ method: "GET", pathname: "/api/projects", authorization: "Bearer wrong" }).status,
  401,
);
assert.deepEqual(
  security.authorize({ method: "GET", pathname: "/api/projects", authorization: "Bearer local-secret" }),
  { allowed: true, public: false },
);
assert.equal(
  security.authorize({
    method: "GET",
    pathname: "/api/projects",
    origin: "https://malicious.example",
    authorization: "Bearer local-secret",
  }).status,
  403,
);
assert.deepEqual(security.responseHeaders(), {});

const unixSecurity = createLocalTransportSecurity({ token: "session-secret", publicHealth: false });
assert.equal(unixSecurity.authorize({ method: "GET", pathname: "/api/health" }).status, 401);
assert.deepEqual(
  unixSecurity.authorize({ method: "GET", pathname: "/api/health", authorization: "Bearer session-secret" }),
  { allowed: true, public: false },
);

const browserEnabled = createLocalTransportSecurity({ token: "local-secret", allowedOrigins: ["http://127.0.0.1:9999"] });
assert.deepEqual(
  browserEnabled.authorize({ method: "OPTIONS", pathname: "/api/projects", origin: "http://127.0.0.1:9999" }),
  { allowed: true, public: true },
);
assert.deepEqual(browserEnabled.responseHeaders("http://127.0.0.1:9999"), {
  "access-control-allow-origin": "http://127.0.0.1:9999",
  vary: "Origin",
});

assert.deepEqual(await readLocalJsonBody(Readable.from([Buffer.from('{"ok":true}')]), 32), { ok: true });
await assert.rejects(
  readLocalJsonBody(Readable.from([Buffer.alloc(33, 1)]), 32),
  (error: unknown) => error instanceof LocalTransportError && error.status === 413,
);

assert.equal(await resolveLocalTransportToken({ envToken: "from-env", platform: "linux" }), "from-env");
let stored: string | undefined;
const generated = await resolveLocalTransportToken({
  platform: "darwin",
  readKeychain: async () => undefined,
  writeKeychain: async (value) => { stored = value; },
  randomToken: () => "generated-token",
});
assert.equal(generated, "generated-token");
assert.equal(stored, "generated-token");

let rewriteCount = 0;
assert.equal(await resolveLocalTransportToken({
  platform: "darwin",
  readKeychain: async () => "existing-token",
  writeKeychain: async () => { rewriteCount += 1; },
}), "existing-token");
assert.equal(rewriteCount, 0, "an existing installation token must not be rewritten during server startup");

console.log("local_transport_security tests passed");
