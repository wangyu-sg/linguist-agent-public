import assert from "node:assert/strict";
import { applyAgentRunToolOptions } from "@linguist-agent/cat-runtime";
import { parseAgentRunOptionsFromUrl } from "../packages/cat-server/src/agent_run_options.js";

const parsed = parseAgentRunOptionsFromUrl(new URL(
  "http://127.0.0.1/api/projects/demo/chat/stream?message=hi&noTools=builtin&tools=read,bash&excludeTools=write&excludeTool=edit&noExtensions=true&noSkills=1&noPromptTemplates=yes&noThemes=on&noContextFiles=true&noSession=true&projectTrustOverride=false&extension=/tmp/ext-a&extensions=/tmp/ext-b&skill=/tmp/skill&promptTemplate=/tmp/prompt&theme=/tmp/theme",
));
assert.equal(parsed?.noTools, "builtin");
assert.deepEqual(parsed?.tools, ["read", "bash"]);
assert.deepEqual(parsed?.excludeTools, ["write", "edit"]);
assert.deepEqual(parsed?.additionalExtensionPaths, ["/tmp/ext-a", "/tmp/ext-b"]);
assert.deepEqual(parsed?.additionalSkillPaths, ["/tmp/skill"]);
assert.deepEqual(parsed?.additionalPromptTemplatePaths, ["/tmp/prompt"]);
assert.deepEqual(parsed?.additionalThemePaths, ["/tmp/theme"]);
assert.equal(parsed?.noExtensions, true);
assert.equal(parsed?.noSkills, true);
assert.equal(parsed?.noPromptTemplates, true);
assert.equal(parsed?.noThemes, true);
assert.equal(parsed?.noContextFiles, true);
assert.equal(parsed?.noSession, true);
assert.equal(parsed?.projectTrustOverride, false);

assert.deepEqual(
  parseAgentRunOptionsFromUrl(new URL("http://127.0.0.1/api/projects/demo/chat/stream?message=hi&approve=true"))?.projectTrustOverride,
  true,
);
assert.deepEqual(
  parseAgentRunOptionsFromUrl(new URL("http://127.0.0.1/api/projects/demo/chat/stream?message=hi&noApprove=true"))?.projectTrustOverride,
  false,
);
assert.equal(parseAgentRunOptionsFromUrl(new URL("http://127.0.0.1/api/projects/demo/chat/stream?message=hi")), undefined);
assert.throws(
  () => parseAgentRunOptionsFromUrl(new URL("http://127.0.0.1/api/projects/demo/chat/stream?message=hi&noTools=maybe")),
  /noTools must be all or builtin/,
);
assert.throws(
  () => parseAgentRunOptionsFromUrl(new URL("http://127.0.0.1/api/projects/demo/chat/stream?message=hi&approve=true&noApprove=true")),
  /approve and noApprove cannot both be true/,
);

const allowlisted = applyAgentRunToolOptions(
  { cwd: "/repo", noTools: "all", excludeTools: ["write"] },
  { noTools: "builtin", tools: ["read"], excludeTools: ["bash", "write"] },
);
assert.deepEqual(allowlisted.tools, ["read"]);
assert.equal(allowlisted.noTools, undefined);
assert.deepEqual(allowlisted.excludeTools, ["write", "bash"]);

const disabledBuiltins = applyAgentRunToolOptions({ cwd: "/repo", tools: ["read", "bash"] }, { noTools: "builtin" });
assert.equal(disabledBuiltins.noTools, "builtin");
assert.equal(disabledBuiltins.tools, undefined);

console.log("agent_run_options tests passed");
