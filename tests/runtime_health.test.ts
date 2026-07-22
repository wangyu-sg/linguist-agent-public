import assert from "node:assert/strict";
import { buildCatRuntimeHealthReport } from "@linguist-agent/cat-runtime";

const healthy = buildCatRuntimeHealthReport({
  laVersion: "0.38.2",
  piCodingAgentVersion: "0.80.3",
  piAiVersion: "0.80.3",
  expectedPiVersion: "0.80.3",
  piSettings: {
    defaultProvider: "deepseek",
    defaultModel: "deepseek-v4-pro",
    sessionDir: "sessions",
    skills: ["./skills"],
    prompts: ["./prompts"],
    extensions: ["./extensions"],
    compaction: {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    },
    retry: {
      enabled: true,
      maxRetries: 3,
      provider: {
        maxRetries: 0,
        maxRetryDelayMs: 60000,
      },
    },
  },
  browserNoExtensions: true,
  browserCustomTools: true,
  browserBuiltinTools: true,
  browserDataStoreWriteGuard: true,
  browserNonCatToolResultsCitable: false,
  sandbox: {
    engine: "srt",
    phase: "enforce",
    denyWrite: { data: true, paths: ["/tmp/la/data"] },
    denyRead: {
      credentialPaths: ["~/.agent-reach", "~/.ssh", "~/.aws", "~/.codex", "~/.pi/agent/auth.json", "~/.config/gcloud/application_default_credentials.json", "~/Library/Keychains", "**/.env*"],
      agentReach: true,
      ssh: true,
      aws: true,
      genericToolKernel: true,
    },
    egress: {
      mode: "exact-host-allowlist",
      allowedDomains: ["api.deepseek.com", "api.tavily.com"],
      seedDomains: ["api.deepseek.com", "api.tavily.com"],
      allowedDomainCount: 2,
    },
  },
  projectSessionStrategy: "deterministic-project-session-id",
  residentRuntime: {
    label: "com.linguist-agent.server",
    supported: true,
    state: "manual",
    pid: 1234,
    port: 8787,
    uptimeSec: 42,
    repoRoot: "/tmp/la",
    logPath: "/tmp/la/data/logs/la-server.log",
    stdoutLogPath: "/tmp/la/data/logs/la-resident-server.out.log",
    stderrLogPath: "/tmp/la/data/logs/la-resident-server.err.log",
    launchAgentPlist: "/Users/test/Library/LaunchAgents/com.linguist-agent.server.plist",
    autostartInstalled: false,
    launchdLoaded: false,
    launchdRunning: false,
    loopbackOnly: true,
    plistHasSecrets: false,
    plistSecretMatches: [],
    manualStartCommand: "cd /tmp/la && LA_SERVER_PORT=8787 npm run la",
    stopCommand: "npm run stop",
    restartAction: "launchd",
    installCommand: "write /Users/test/Library/LaunchAgents/com.linguist-agent.server.plist",
    startCommand: "launchctl bootstrap gui/501 /Users/test/Library/LaunchAgents/com.linguist-agent.server.plist",
    uninstallCommand: "launchctl bootout gui/501 /Users/test/Library/LaunchAgents/com.linguist-agent.server.plist && rm /Users/test/Library/LaunchAgents/com.linguist-agent.server.plist",
    notes: ["diagnostic only"],
  },
  resources: [
    { source: "npm:@alexanderfortin/pi-tavily-tools", tools: ["web_search"] },
    { source: "npm:pi-web-access", tools: ["web_search", "fetch_content"] },
  ],
});

assert.equal(healthy.status, "pass");
assert.equal(healthy.browserSessionPolicy.toolSurface, "isolated-la-cat+server-resources");
assert.equal(healthy.browserSessionPolicy.builtinTools, true);
assert.equal(healthy.browserSessionPolicy.dataStoreWriteGuard, true);
assert.equal(healthy.browserSessionPolicy.nonCatToolResultsCitable, false);
assert.equal(healthy.sandbox.engine, "srt");
assert.equal(healthy.sandbox.phase, "enforce");
assert.equal(healthy.sandbox.denyWrite.data, true);
assert.equal(healthy.sandbox.denyRead.credentialPaths.includes("~/.pi/agent/auth.json"), true);
assert.equal(healthy.sandbox.denyRead.genericToolKernel, true);
assert.equal(healthy.sandbox.egress.mode, "exact-host-allowlist");
assert.deepEqual(healthy.sandbox.egress.seedDomains, ["api.deepseek.com", "api.tavily.com"]);
assert.equal(healthy.projectSessionPolicy.storage, "project-local-jsonl");
assert.equal(healthy.streamRulePolicy.phase, "blocker_abort_retry");
assert.equal(healthy.streamRulePolicy.finalChecks, true);
assert.equal(healthy.streamRulePolicy.abortRetry, "blockers_only_one_retry");
assert.equal(healthy.selfHealingPolicy.promptTooLong, "compact_and_retry_once");
assert.equal(healthy.selfHealingPolicy.toolFailure, "trace_visible_no_silent_fallback");
assert.equal(healthy.resourcePolicy.webSearchProvider, "npm:@alexanderfortin/pi-tavily-tools");
assert.equal(healthy.resourcePolicy.bridges.find((bridge) => bridge.id === "browser_automation")?.status, "blocked");
assert.equal(healthy.checks.find((check) => check.code === "web_session_bridge_policy_complete")?.status, "pass");
assert.equal(healthy.residentRuntime?.port, 8787);
assert.equal(healthy.residentRuntime?.autostartInstalled, false);
assert.equal(healthy.residentRuntime?.loopbackOnly, true);
assert.equal(healthy.residentRuntime?.plistHasSecrets, false);
assert.equal(healthy.checks.every((check) => check.status === "pass"), true);

// The stream-rule and self-healing checks are behavioral probes, not declarations:
// they run the real monitor/classifier/planner and report what was enforced.
const streamRuleCheck = healthy.checks.find((check) => check.code === "cat_stream_rules_abort_retry");
assert.equal(streamRuleCheck?.status, "pass");
assert.match(streamRuleCheck?.message ?? "", /verified behaviorally/);
const selfHealingCheck = healthy.checks.find((check) => check.code === "cat_self_healing_policy_visible");
assert.equal(selfHealingCheck?.status, "pass");
assert.match(selfHealingCheck?.message ?? "", /verified behaviorally/);

const unhealthy = buildCatRuntimeHealthReport({
  laVersion: "0.38.2",
  piCodingAgentVersion: "^0.80.3",
  piAiVersion: "0.75.5",
  expectedPiVersion: "0.80.3",
  piSettings: {
    compaction: { enabled: false },
    retry: { enabled: true },
  },
  browserNoExtensions: false,
  browserCustomTools: true,
  browserBuiltinTools: false,
  browserDataStoreWriteGuard: false,
  browserNonCatToolResultsCitable: true,
  sandbox: {
    engine: "none",
    phase: "off",
    denyWrite: { data: false, paths: [] },
    denyRead: { credentialPaths: [], agentReach: false, ssh: false, aws: false, genericToolKernel: false },
    egress: { mode: "off", allowedDomains: [], seedDomains: ["api.deepseek.com", "api.tavily.com"], allowedDomainCount: 0 },
  },
  projectSessionStrategy: "deterministic-project-session-id",
});

assert.equal(unhealthy.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "pi_coding_agent_version_exact")?.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "pi_compaction_enabled")?.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "browser_tool_surface_isolated")?.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "browser_data_store_write_guard")?.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "browser_non_cat_results_advisory")?.status, "fail");
assert.equal(unhealthy.checks.find((check) => check.code === "cat_self_healing_policy_visible")?.status, "pass");

console.log("runtime_health tests passed");
