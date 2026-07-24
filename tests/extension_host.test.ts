import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  launchIsolatedExtensionHost,
  type ExtensionHostPlanV1,
} from "@linguist-agent/cat-runtime";

const root = await mkdtemp(join(tmpdir(), "la-extension-host-test-"));

async function planFor(name: string, source: string): Promise<ExtensionHostPlanV1> {
  const extensionDirectory = join(root, name);
  await mkdir(extensionDirectory);
  const requestedPath = join(extensionDirectory, "extension.ts");
  await writeFile(requestedPath, source, { mode: 0o444 });
  const extensionPath = await realpath(requestedPath);
  const bytes = await readFile(extensionPath);
  return {
    schemaVersion: 1,
    apiVersion: 1,
    extensionPath,
    extensionSha256: createHash("sha256").update(bytes).digest("hex"),
    cwd: root,
    capabilityGrants: [],
  };
}

try {
  const generalSessionSource = await readFile(join(process.cwd(), "packages/cat-runtime/src/createGeneralAgentSession.ts"), "utf8");
  assert.doesNotMatch(generalSessionSource, /additionalExtensionPaths:\s*resourceSnapshot\.extensionPaths/u);
  assert.match(generalSessionSource, /External executable Extensions must use the isolated Extension Host/u);
  const catSessionSource = await readFile(join(process.cwd(), "packages/cat-runtime/src/createCatAgentSession.ts"), "utf8");
  assert.doesNotMatch(catSessionSource, /additionalExtensionPaths:\s*isolatedResources\?\.extensionPaths/u);
  assert.match(catSessionSource, /Isolated CAT executable Extensions must use the isolated Extension Host/u);

  await assert.rejects(
    launchIsolatedExtensionHost({
      schemaVersion: 1,
      apiVersion: 1,
      extensionPath: "/not-used",
      extensionSha256: "not-a-digest",
      cwd: "relative",
      capabilityGrants: undefined,
    } as unknown as ExtensionHostPlanV1),
    /EXTENSION_PLAN_INVALID/u,
  );

  const benign = await launchIsolatedExtensionHost(await planFor("benign", `
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "isolated_echo",
        label: "Isolated echo",
        description: "Echo one value without host authority.",
        parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
        execute: async (_id, params) => ({ content: [{ type: "text", text: String(params.value) }], details: { isolated: true } }),
      });
    }
  `));
  assert.deepEqual(benign.tools.map(({ name }) => name), ["isolated_echo"]);
  assert.deepEqual(await benign.invoke("isolated_echo", { value: "hello" }), {
    content: [{ type: "text", text: "hello" }],
    details: { isolated: true },
  });
  await benign.dispose();

  const secretPath = join(root, "outside-secret.txt");
  await writeFile(secretPath, "must-not-leak", { mode: 0o600 });
  const fsHost = await launchIsolatedExtensionHost(await planFor("fs-read", `
    import { readFileSync } from "node:fs";
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "steal_file", label: "Steal", description: "Attempt a forbidden read.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: readFileSync(${JSON.stringify(secretPath)}, "utf8") }], details: {} }),
      });
    }
  `));
  await assert.rejects(fsHost.invoke("steal_file", {}), /EXTENSION_CAPABILITY_DENIED/u);
  await fsHost.dispose();

  const processHost = await launchIsolatedExtensionHost(await planFor("process", `
    import { spawnSync } from "node:child_process";
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "spawn_process", label: "Spawn", description: "Attempt a forbidden process.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: String(spawnSync("/bin/echo", ["unsafe"]).status) }], details: {} }),
      });
    }
  `));
  await assert.rejects(processHost.invoke("spawn_process", {}), /EXTENSION_CAPABILITY_DENIED/u);
  await processHost.dispose();

  process.env.LA_EXTENSION_TEST_SECRET = "must-not-reach-child";
  const envHost = await launchIsolatedExtensionHost(await planFor("environment", `
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "read_env", label: "Env", description: "Read the sanitized environment.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: String(process.env.LA_EXTENSION_TEST_SECRET) }], details: {} }),
      });
    }
  `));
  assert.deepEqual(await envHost.invoke("read_env", {}), {
    content: [{ type: "text", text: "undefined" }],
    details: {},
  });
  await envHost.dispose();
  delete process.env.LA_EXTENSION_TEST_SECRET;

  const server = createServer((_request, response) => response.end("network-leak"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const networkHost = await launchIsolatedExtensionHost(await planFor("network", `
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "fetch_network", label: "Fetch", description: "Attempt forbidden network.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: await (await fetch("http://127.0.0.1:${address.port}")).text() }], details: {} }),
      });
    }
  `));
  await assert.rejects(networkHost.invoke("fetch_network", {}), /EXTENSION_CAPABILITY_DENIED/u);
  await networkHost.dispose();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  await assert.rejects(
    launchIsolatedExtensionHost(await planFor("unsupported", `
      import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
      export default function (pi: ExtensionAPI) {
        pi.registerCommand("unsafe", { description: "unsupported", handler: async () => undefined });
      }
    `)),
    /EXTENSION_API_UNSUPPORTED/u,
  );

  const timeoutHost = await launchIsolatedExtensionHost(await planFor("timeout", `
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "never", label: "Never", description: "Never settles.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => await new Promise(() => undefined),
      });
    }
  `), { requestTimeoutMs: 100 });
  await assert.rejects(timeoutHost.invoke("never", {}), /EXTENSION_HOST_TIMEOUT/u);
  await timeoutHost.dispose();

  const crashHost = await launchIsolatedExtensionHost(await planFor("crash", `
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function (pi: ExtensionAPI) {
      pi.registerTool({
        name: "crash", label: "Crash", description: "Crash only the isolated host.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => { process.exit(17); },
      });
    }
  `));
  await assert.rejects(crashHost.invoke("crash", {}), /EXTENSION_HOST_CRASHED/u);
  await crashHost.dispose();

  console.log("isolated Extension Host tests passed");
} finally {
  delete process.env.LA_EXTENSION_TEST_SECRET;
  await rm(root, { recursive: true, force: true });
}
