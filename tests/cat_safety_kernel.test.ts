import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCatSafetyToolCall } from "@linguist-agent/cat-runtime";

const options = { workspaceRoot: "/Users/test/linguist-agent", homeDir: "/Users/test" };

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
  const documentOptions = {
    workspaceRoot: symlinkWorkspace,
    homeDir: fakeHome,
    allowedDocumentRoots: [projectRoot, projectDataRoot],
  };
  assert.equal(
    evaluateCatSafetyToolCall({ toolName: "document_parse", input: { path: join(projectRoot, "brief.pdf") } }, documentOptions),
    undefined,
  );
  assert.equal(
    evaluateCatSafetyToolCall({ toolName: "document_search", input: { path: join(projectDataRoot, "asset.pdf"), phrase: "term" } }, documentOptions),
    undefined,
  );
  assert.match(
    evaluateCatSafetyToolCall({ toolName: "document_screenshot", input: { path: join(outsideRoot, "secret.pdf"), pages: "1" } }, documentOptions)?.reason ?? "",
    /outside the current Project scope/i,
  );
  assert.match(
    evaluateCatSafetyToolCall({ toolName: "document_parse", input: { path: "~/Desktop/secret.pdf" } }, documentOptions)?.reason ?? "",
    /outside the current Project scope/i,
  );
  assert.match(
    evaluateCatSafetyToolCall({ toolName: "document_parse", input: { path: join(projectRoot, "escape", "secret.pdf") } }, documentOptions)?.reason ?? "",
    /outside the current Project scope/i,
  );
  assert.match(
    evaluateCatSafetyToolCall({
      toolName: "document_parse",
      input: { path: join(projectRoot, "brief.pdf"), tessdataPath: join(outsideRoot, "ocr") },
    }, documentOptions)?.reason ?? "",
    /outside the current Project scope/i,
  );
  assert.match(
    evaluateCatSafetyToolCall({
      toolName: "document_parse",
      input: { path: join(projectRoot, "brief.pdf"), ocrServerUrl: "https://ocr.example/upload" },
    }, documentOptions)?.reason ?? "",
    /remote OCR is disabled/i,
  );
  assert.match(
    evaluateCatSafetyToolCall(
      { toolName: "document_parse", input: { path: `@${join(fakeHome, "private.pdf")}` } },
      { workspaceRoot: symlinkWorkspace, homeDir: fakeHome, allowedDocumentRoots: [symlinkWorkspace] },
    )?.reason ?? "",
    /outside the current Project scope/i,
  );
  assert.match(
    evaluateCatSafetyToolCall({ toolName: "document_parse", input: { path: join(projectRoot, "brief.pdf") } }, {
      workspaceRoot: symlinkWorkspace,
      homeDir: fakeHome,
    })?.reason ?? "",
    /outside the current Project scope/i,
  );
} finally {
  await rm(symlinkWorkspace, { recursive: true, force: true });
  await rm(fakeHome, { recursive: true, force: true });
}

console.log("cat_safety_kernel tests passed");
