import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCapabilityBroker } from "@linguist-agent/cat-data";
import {
  buildCatSandboxHealthReport,
  catSandboxPhaseFromEnv,
  evaluateCatSafetyToolCall,
} from "@linguist-agent/cat-runtime";

const options = { workspaceRoot: "/Users/test/linguist-agent", homeDir: "/Users/test" };

assert.throws(
  () => catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "off" }),
  /Stable runtime requires.*enforce/i,
);
assert.throws(
  () => catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "observe" }),
  /Stable runtime requires.*enforce/i,
);
assert.equal(catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "off" }, { allowUnsafePhase: true }), "off");
assert.equal(catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "observe" }, { allowUnsafePhase: true }), "observe");
assert.equal(catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "enforce" }), "enforce");
assert.throws(() => catSandboxPhaseFromEnv({ LA_CAT_SANDBOX_PHASE: "typo" }, { allowUnsafePhase: true }), /Invalid LA_CAT_SANDBOX_PHASE/);
assert.equal(buildCatSandboxHealthReport({ root: "/tmp/la-synthetic" } as never, { LA_CAT_SANDBOX_PHASE: "off" }, { allowUnsafePhase: true }).phase, "off");

assert.match(
  evaluateCatSafetyToolCall({ toolName: "read", input: { path: "~/.pi/agent/auth.json" } }, options)?.reason ?? "",
  /protected credential path/i,
);
assert.match(
  evaluateCatSafetyToolCall({ toolName: "grep", input: { path: "/Users/test/.ssh/../.ssh/config", pattern: "Host" } }, options)?.reason ?? "",
  /protected credential path/i,
);
assert.match(
  evaluateCatSafetyToolCall({ toolName: "read_file", input: { file_path: "/Users/test/linguist-agent/.env.local" } }, options)?.reason ?? "",
  /protected credential path/i,
);
assert.match(
  evaluateCatSafetyToolCall({ toolName: "read", input: { params: { options: { path: "~/.ssh/missing-key" } } }, }, options)?.reason ?? "",
  /protected credential path/i,
);
assert.match(
  evaluateCatSafetyToolCall({ toolName: "bash", input: { command: "cat .env.production" } }, options)?.reason ?? "",
  /protected credential path/i,
);
assert.equal(
  evaluateCatSafetyToolCall({ toolName: "grep", input: { path: "data/projects/p1/tm.json", pattern: "term" } }, options),
  undefined,
);
assert.match(
  evaluateCatSafetyToolCall({ toolName: "bash", input: { command: "\"/usr/bin/security\" find-generic-password -s com.linguist-agent.local-transport -w" } }, options)?.reason ?? "",
  /Keychain access/i,
);
assert.equal(
  evaluateCatSafetyToolCall({ toolName: "bash", input: { command: "npm test" } }, options),
  undefined,
);

for (const toolName of ["subagent", "wait", "subagent_supervisor", "intercom", "contact_supervisor"]) {
  assert.match(
    evaluateCatSafetyToolCall({ toolName, input: { agent: "worker", task: "translate" } }, options)?.reason ?? "",
    /canonical Task Run\/Agent lifecycle/i,
  );
}

// A symlink under the CAT workspace must not provide an escape hatch when the
// requested credential file has not been created yet (realpath() otherwise
// cannot resolve the final path).
const symlinkWorkspace = await mkdtemp(join(tmpdir(), "la-safety-kernel-"));
const fakeHome = await mkdtemp(join(tmpdir(), "la-safety-home-"));
const projectRoot = join(symlinkWorkspace, "customer-project");
const projectDataRoot = join(symlinkWorkspace, "data", "projects", "proj");
const outsideRoot = join(symlinkWorkspace, "outside");
await mkdir(join(fakeHome, ".ssh"), { recursive: true });
await mkdir(projectRoot, { recursive: true });
await mkdir(projectDataRoot, { recursive: true });
await mkdir(outsideRoot, { recursive: true });
await symlink(join(fakeHome, ".ssh"), join(symlinkWorkspace, "credential-link"), "dir");
await symlink(outsideRoot, join(projectRoot, "escape"), "dir");
try {
  assert.match(
    evaluateCatSafetyToolCall({ toolName: "read", input: { path: "credential-link/missing-key" } }, { workspaceRoot: symlinkWorkspace, homeDir: fakeHome })?.reason ?? "",
    /protected credential path/i,
  );
  const broker = await FileCapabilityBroker.create({
    cwd: symlinkWorkspace,
    grants: [projectRoot, projectDataRoot].map((rootPath, index) => ({
      id: `project-${index}`,
      rootPath,
      kind: "directory" as const,
      recursive: true,
      operations: ["read", "list", "search"] as const,
    })),
  });
  await broker.authorizePath(join(projectRoot, "brief.pdf"), "read");
  await broker.authorizePath(join(projectDataRoot, "asset.pdf"), "search");
  await assert.rejects(() => broker.authorizePath(join(outsideRoot, "secret.pdf"), "read"), /FILE_CAPABILITY_DENIED/);
  await assert.rejects(() => broker.authorizePath("~/Desktop/secret.pdf", "read"), /FILE_CAPABILITY_DENIED/);
  await assert.rejects(() => broker.authorizePath(join(projectRoot, "escape", "secret.pdf"), "read"), /FILE_CAPABILITY_DENIED/);
  const mixed = await broker.authorizeToolInput(
    { filesystem: { operations: ["read"], scope: "workspace-or-explicit-grant" } },
    { path: join(projectRoot, "brief.pdf"), tessdataPath: join(outsideRoot, "ocr") },
  );
  assert.equal(mixed.allowed, false);
  assert.match(
    evaluateCatSafetyToolCall({
      toolName: "document_parse",
      input: { path: join(projectRoot, "brief.pdf"), ocrServerUrl: "https://ocr.example/upload" },
    }, { workspaceRoot: symlinkWorkspace, homeDir: fakeHome })?.reason ?? "",
    /remote OCR is disabled/i,
  );
  await assert.rejects(() => broker.authorizePath(`@${join(fakeHome, "private.pdf")}`, "read"), /FILE_CAPABILITY_DENIED/);
} finally {
  await rm(symlinkWorkspace, { recursive: true, force: true });
  await rm(fakeHome, { recursive: true, force: true });
}

console.log("cat_safety_kernel tests passed");
