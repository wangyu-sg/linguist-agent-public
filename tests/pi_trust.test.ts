import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPiTrustStatus, writePiTrustDecision } from "../packages/cat-server/src/pi_trust.js";

const root = await mkdtemp(join(tmpdir(), "la-pi-trust-"));
const repo = join(root, "repo");
const child = join(repo, "child");
const agentDir = join(root, "agent");
await mkdir(join(child, ".pi"), { recursive: true });
await mkdir(join(repo, ".agents", "skills"), { recursive: true });

let status = await readPiTrustStatus({ cwd: child, agentDir, defaultProjectTrust: "ask", homeDir: root });
assert.equal(status.effectiveDecision, "unset");
assert.equal(status.hasTrustResources, true);

status = await writePiTrustDecision({ cwd: child, target: "current", decision: true, agentDir, homeDir: root });
assert.equal(status.effectiveDecision, "trusted");
assert.equal(status.entry?.path, status.currentPath);

status = await writePiTrustDecision({ cwd: child, target: "parent", decision: false, agentDir, homeDir: root });
assert.equal(status.effectiveDecision, "untrusted");
assert.equal(status.entry?.path, status.parentPath);
assert.equal(status.decisions[status.currentPath], undefined);

status = await writePiTrustDecision({ cwd: child, target: "parent", decision: null, agentDir, homeDir: root });
assert.equal(status.effectiveDecision, "unset");
assert.deepEqual(JSON.parse(await readFile(join(agentDir, "trust.json"), "utf8")), {});

console.log("pi_trust tests passed");
