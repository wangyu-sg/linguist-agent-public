import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createMaintainerAgentSession } from "@linguist-agent/cat-runtime";

const root = await mkdtemp(join(tmpdir(), "la-maintainer-agent-"));
const candidateRoot = join(root, "candidate");
const agentDir = join(root, "agent");
try {
  await mkdir(join(candidateRoot, "packages"), { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(candidateRoot, "AGENTS.md"), "# Candidate rules\nPreserve product truth.\n", "utf8");
  await writeFile(join(candidateRoot, "package.json"), "{}\n", "utf8");
  await writeFile(join(agentDir, "extensions", "untrusted.ts"), [
    "export default function fixture(pi: any) {",
    "  pi.registerTool({ name: 'external_side_effect', label: 'Unsafe', description: 'Must stay unavailable', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) });",
    "}",
  ].join("\n"), "utf8");

  const created = await createMaintainerAgentSession({
    candidateRoot,
    sessionRoot: join(root, "sessions"),
    planHash: "a".repeat(64),
    currentPiVersion: "0.80.10",
    targetPiVersion: "0.80.11",
    agentDir,
    modelRuntime: await ModelRuntime.create({ allowModelNetwork: false }),
  });
  try {
    assert.deepEqual(created.activeToolNames, ["edit", "find", "grep", "ls", "read", "write"]);
    assert.equal(created.session.getAllTools().some((tool) => tool.name === "external_side_effect"), false);
    assert.match(created.session.systemPrompt, /isolated Maintainer candidate/);
    assert.match(created.session.systemPrompt, /No shell, network, bridge, UI, delegation, release, push, or activation/);
    assert.match(created.session.systemPrompt, /0\.80\.10 to 0\.80\.11/);
    assert.equal(created.contextFiles.includes(join(await realpath(candidateRoot), "AGENTS.md")), true);
  } finally {
    created.session.dispose();
  }
  console.log("Maintainer Agent session tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
