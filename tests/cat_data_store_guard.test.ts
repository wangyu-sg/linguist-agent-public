import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCatSandboxRuntimeConfig,
  guardNonCatToolCall,
  isInsideCatDataStore,
  sanitizeBashEnv,
  tagNonCatToolResult,
  validateSandboxAllowedDomains,
} from "@linguist-agent/cat-runtime";
import { createWorkspace, workspacePath } from "@linguist-agent/cat-data";

const repoRoot = await mkdtemp(join(tmpdir(), "la-cat-data-guard-test-"));
const workspace = createWorkspace(repoRoot, "proj");
const dataFile = workspacePath(workspace, "batches", "b1", "batch.json");

assert.equal(isInsideCatDataStore(workspace, dataFile), true, "absolute data path must be recognized");
assert.equal(isInsideCatDataStore(workspace, "data/projects/proj/batches/b1/batch.json"), true, "relative data path must be recognized");
assert.equal(isInsideCatDataStore(workspace, "scratch/output.txt"), false, "non-data relative path must be allowed");
assert.equal(isInsideCatDataStore(workspace, join(repoRoot, "customer", "data", "asset.txt")), false, "customer data folder outside LA data root is not the LA data store");

const blockedWrite = guardNonCatToolCall(
  { toolName: "write", input: { path: "data/projects/proj/batches/b1/batch.json" } },
  workspace,
);
assert.equal(blockedWrite?.block, true);
assert.match(blockedWrite?.reason ?? "", /data\/.*guard/i);

const blockedEdit = guardNonCatToolCall(
  { toolName: "edit", input: { file_path: dataFile } },
  workspace,
);
assert.equal(blockedEdit?.block, true);
assert.match(blockedEdit?.reason ?? "", /data\/.*guard/i);

const allowedWrite = guardNonCatToolCall(
  { toolName: "write", input: { path: "scratch/output.txt" } },
  workspace,
);
assert.equal(allowedWrite, undefined);

// Name-independent default-deny: a write verb the guard has never been told about by name must
// still be blocked when it targets the data store (this is the regression that the old exact-name
// "write"/"edit" check would have let through).
const blockedNovelWrite = guardNonCatToolCall(
  { toolName: "multi_edit", input: { file_path: dataFile } },
  workspace,
);
assert.equal(blockedNovelWrite?.block, true, "a novel write verb targeting data/ must be blocked");
assert.match(blockedNovelWrite?.reason ?? "", /data\/.*guard/i);

const blockedPatchVerb = guardNonCatToolCall(
  { toolName: "apply_patch", input: { edits: [{ file_path: dataFile }] } },
  workspace,
);
assert.equal(blockedPatchVerb?.block, true, "a multi-file patch verb targeting data/ must be blocked");

const blockedAltField = guardNonCatToolCall(
  { toolName: "create_file", input: { destination: "data/projects/proj/glossary.json" } },
  workspace,
);
assert.equal(blockedAltField?.block, true, "a write verb naming its target via an alternate field must be blocked");

// Read-only inspection and bash stay exempt: the guard must not regress legitimate reads of data/,
// and bash writes are contained at the OS sandbox layer rather than double-blocked here.
const allowedRead = guardNonCatToolCall(
  { toolName: "read", input: { file_path: dataFile } },
  workspace,
);
assert.equal(allowedRead, undefined, "read of a data/ file must remain allowed");

const allowedGrep = guardNonCatToolCall(
  { toolName: "grep", input: { path: "data/projects/proj" } },
  workspace,
);
assert.equal(allowedGrep, undefined, "grep over data/ must remain allowed");

const allowedBash = guardNonCatToolCall(
  { toolName: "bash", input: { command: `echo '{}' > ${dataFile}` } },
  workspace,
);
assert.equal(allowedBash, undefined, "bash is OS-sandbox contained, not blocked by the tool-call guard");

const advisory = tagNonCatToolResult({
  toolName: "web_search",
  content: [{ type: "text", text: "public reference" }],
  details: { source: "pi" },
  isError: false,
});
assert.equal((advisory?.details as { catRuntimeAdvisory?: { citable?: boolean } }).catRuntimeAdvisory?.citable, false);

const catResult = tagNonCatToolResult({
  toolName: "proposal_create",
  content: [{ type: "text", text: "proposal created" }],
  details: {},
  isError: false,
});
assert.equal(catResult, undefined, "CAT tools keep their normal CAT validation path");

const bashAudit = tagNonCatToolResult({
  toolName: "bash",
  input: { command: `cat ${dataFile} && echo '{}' > data/projects/proj/batches/b1/batch.json` },
  content: [{ type: "text", text: "done" }],
  details: {},
  isError: false,
});
const warnings = (bashAudit?.details as { catRuntimeAudit?: { warnings?: string[] } }).catRuntimeAudit?.warnings ?? [];
assert.ok(warnings.some((warning) => /data\/.*write/i.test(warning)), "bash audit should flag data write-looking commands");

assert.deepEqual(validateSandboxAllowedDomains(["api.deepseek.com", "api.tavily.com", "api.deepseek.com"]), [
  "api.deepseek.com",
  "api.tavily.com",
]);
for (const unsafe of [
  "*.example.com",
  "https://example.com",
  "example.com.",
  "exa mple.com",
  "attacker\u0000.example.com",
  "example.com%00.attacker.test",
  "localhost:8787",
]) {
  assert.throws(() => validateSandboxAllowedDomains([unsafe]), /exact host|wildcard|null byte|invalid/i, `unsafe host ${unsafe} must be rejected`);
}

const sandboxConfig = buildCatSandboxRuntimeConfig(workspace, {
  LA_BASH_ALLOWED_DOMAINS: "api.deepseek.com,api.tavily.com",
});
assert.ok(sandboxConfig.filesystem?.denyWrite?.some((entry) => entry.endsWith(join("data"))));
assert.ok(sandboxConfig.filesystem?.denyRead?.includes("~/.agent-reach"));
assert.ok(sandboxConfig.filesystem?.denyRead?.includes("~/.ssh"));
assert.ok(sandboxConfig.filesystem?.denyRead?.includes("~/.aws"));
for (const host of sandboxConfig.network?.allowedDomains ?? []) {
  assert.doesNotMatch(host, /[*\0/:\s]/);
}

const scrubbed = sanitizeBashEnv({
  PATH: "/usr/bin",
  HOME: "/Users/test",
  TAVILY_API_KEY: "secret",
  AWS_SECRET_ACCESS_KEY: "secret",
  SESSION_COOKIE: "secret",
  PLAIN_VALUE: "ok",
});
assert.equal(scrubbed.PATH, "/usr/bin");
assert.equal(scrubbed.HOME, "/Users/test");
assert.equal(scrubbed.PLAIN_VALUE, "ok");
assert.equal(scrubbed.TAVILY_API_KEY, undefined);
assert.equal(scrubbed.AWS_SECRET_ACCESS_KEY, undefined);
assert.equal(scrubbed.SESSION_COOKIE, undefined);

console.log("cat_data_store_guard tests passed");
