import {
  classifyCatRuntimeRecovery,
  createCatSelfHealingRetryState,
  planCatSelfHealingRetry,
  type CatRecoveryAction,
  type CatRecoveryKind,
  type CatRuntimeRecoveryInput,
} from "./catSelfHealing.js";
import { buildCatStreamRetryInstruction, createCatStreamRuleMonitor, shouldAbortForCatStreamViolation } from "./catStreamRules.js";
import type { CatSandboxHealthReport } from "./catSandbox.js";
import type { AgentPermissionContract } from "./agentPermissions.js";
import { buildPiResourcePolicyReport, type PiPackageResource, type PiResourcePolicyReport } from "./piResourcePolicy.js";

export type RuntimeHealthStatus = "pass" | "warn" | "fail";

export interface RuntimeHealthCheck {
  code: string;
  status: RuntimeHealthStatus;
  message: string;
  evidence?: unknown;
}

export interface ResidentRuntimeDiagnostics {
  label?: string;
  supported?: boolean;
  state?: "unsupported" | "manual" | "installed" | "running" | "error";
  pid: number;
  port: number;
  uptimeSec: number;
  repoRoot: string;
  logPath: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
  launchAgentPlist: string;
  autostartInstalled: boolean;
  launchdLoaded?: boolean;
  launchdRunning?: boolean;
  launchdPid?: number;
  loopbackOnly?: boolean;
  plistHasSecrets?: boolean;
  plistSecretMatches?: string[];
  manualStartCommand: string;
  stopCommand: string;
  restartAction: "manual" | "launchd" | "not_implemented";
  installCommand?: string;
  startCommand?: string;
  uninstallCommand?: string;
  notes: string[];
  lastError?: string;
}

export interface CatRuntimeHealthInput {
  laVersion: string;
  piCodingAgentVersion: string;
  piAiVersion?: string;
  expectedPiVersion: string;
  piSettings: Record<string, unknown>;
  browserNoExtensions: boolean;
  browserCustomTools: boolean;
  browserBuiltinTools: boolean;
  browserDataStoreWriteGuard: boolean;
  browserNonCatToolResultsCitable: boolean;
  projectSessionStrategy: "deterministic-project-session-id";
  resources?: PiPackageResource[];
  sandbox: CatSandboxHealthReport;
  residentRuntime?: ResidentRuntimeDiagnostics;
  permissionPolicy?: AgentPermissionContract;
}

export interface CatRuntimeHealthReport {
  status: RuntimeHealthStatus;
  versions: {
    la: string;
    piCodingAgent: string;
    piAi?: string;
    expectedPi: string;
  };
  piSettings: {
    defaultProvider?: unknown;
    defaultModel?: unknown;
    compaction?: unknown;
    retry?: unknown;
    sessionDir?: unknown;
    skills?: unknown;
    prompts?: unknown;
    extensions?: unknown;
  };
  browserSessionPolicy: {
    noExtensions: boolean;
    customTools: boolean;
    builtinTools: boolean;
    dataStoreWriteGuard: boolean;
    nonCatToolResultsCitable: boolean;
    toolSurface: "isolated-la-cat+server-resources" | "unknown";
  };
  projectSessionPolicy: {
    strategy: "deterministic-project-session-id";
    storage: "project-local-jsonl";
  };
  streamRulePolicy: {
    phase: "blocker_abort_retry";
    inputEvents: string[];
    finalChecks: boolean;
    abortRetry: "blockers_only_one_retry";
  };
  selfHealingPolicy: {
    promptTooLong: "compact_and_retry_once";
    outputCutoff: "continue_generation";
    timeoutReconnect: "reconnect_and_retry";
    providerRetry: "pi_retry_settings";
    toolFailure: "trace_visible_no_silent_fallback";
  };
  resourcePolicy: PiResourcePolicyReport;
  sandbox: CatSandboxHealthReport;
  residentRuntime?: ResidentRuntimeDiagnostics;
  permissionPolicy?: AgentPermissionContract;
  checks: RuntimeHealthCheck[];
}

function objectAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === "object" ? (next as Record<string, unknown>) : undefined;
}

function statusFromChecks(checks: RuntimeHealthCheck[]): RuntimeHealthStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function checkVersion(name: string, actual: string | undefined, expected: string): RuntimeHealthCheck {
  const ok = actual === expected;
  return {
    code: `${name}_version_exact`,
    status: ok ? "pass" : "fail",
    message: ok ? `${name} is pinned to ${expected}.` : `${name} must be pinned exactly to ${expected}; got ${actual ?? "missing"}.`,
    evidence: actual,
  };
}

function implementedBridgePolicyIsSafe(bridge: PiResourcePolicyReport["bridges"][number]): boolean {
  if (bridge.status !== "implemented") return true;
  if (bridge.mutationRisk === "read_only") return true;
  if (bridge.id !== "mcp") return false;
  return (
    bridge.mutationRisk === "per_tool_declared" &&
    bridge.controls.some((control) => control.id === "server_catalog" && control.state === "active") &&
    bridge.controls.some((control) => control.id === "per_tool_allowlist" && control.state === "active") &&
    bridge.controls.some((control) => control.id === "cat_write_gate" && control.state === "active")
  );
}

/**
 * Behavioral probe: exercises the real stream-rule monitor instead of merely
 * declaring the policy. A synthetic forbidden term remains abortable when a
 * caller explicitly supplies one. Missing source fragments in conversational
 * output are observable warnings; deterministic CAT write gates own rejection.
 */
function probeCatStreamRuleEnforcement(): RuntimeHealthCheck {
  const monitor = createCatStreamRuleMonitor({
    sourceText: "Equip {item_name} to continue",
    targetLocale: "en-US",
    forbiddenTerms: ["probe-forbidden-term"],
  });
  const streamed = monitor.observeDelta("Equip the probe-forbidden-term to continue");
  const finalized = monitor.finalize();
  const forbidden = streamed.find((violation) => violation.code === "forbidden_term");
  const missing = finalized.find((violation) => violation.code === "missing_required_fragment");
  const enforced =
    forbidden !== undefined &&
    missing !== undefined &&
    shouldAbortForCatStreamViolation(forbidden) &&
    !shouldAbortForCatStreamViolation(missing) &&
    missing.severity === "warning" &&
    missing.action === "observe_only" &&
    buildCatStreamRetryInstruction(forbidden).correctiveInstruction.length > 0 &&
    buildCatStreamRetryInstruction(missing).correctiveInstruction.length > 0;
  return {
    code: "cat_stream_rules_abort_retry",
    status: enforced ? "pass" : "fail",
    message: enforced
      ? "CAT stream rules verified behaviorally: explicit forbidden terms can abort; missing chat fragments warn while CAT writes remain gate-owned."
      : "CAT stream rule probe failed: blocker/warning ownership did not match the runtime contract.",
    evidence: {
      inputEvents: ["message_update:text_delta", "assistant_final"],
      abortRetry: "explicit_forbidden_only_one_retry;missing_fragment_observe_only",
      probe: {
        forbiddenTerm: forbidden ? `${forbidden.severity}:${forbidden.action}` : "not_detected",
        missingRequiredFragment: missing ? `${missing.severity}:${missing.action}` : "not_detected",
      },
    },
  };
}

interface SelfHealingProbeCase {
  probe: string;
  input: CatRuntimeRecoveryInput;
  kind: CatRecoveryKind;
  action: CatRecoveryAction;
  /** Whether the retry planner should grant a (one-shot) retry for this class. */
  retries: boolean;
}

const SELF_HEALING_PROBE_CASES: SelfHealingProbeCase[] = [
  { probe: "prompt_too_long", input: { message: "prompt too long" }, kind: "prompt_too_long", action: "compact_and_retry_once", retries: true },
  { probe: "output_cutoff", input: { message: "response truncated" }, kind: "output_cutoff", action: "continue_generation", retries: true },
  { probe: "timeout_reconnect", input: { message: "ECONNRESET" }, kind: "timeout_reconnect", action: "reconnect_and_retry", retries: true },
  { probe: "retryable_provider", input: { message: "429 rate limit" }, kind: "retryable_provider", action: "pi_provider_retry", retries: true },
  { probe: "tool_failure", input: { isToolError: true, toolName: "tm_lookup" }, kind: "tool_failure", action: "surface_tool_failure", retries: false },
];

/**
 * Behavioral probe: runs the real classifier and retry planner over one
 * canonical failure per recovery class, so the report can only green-certify
 * the self-healing policy the agent loops actually enact — including the
 * one-shot retry budget and the shared transient budget.
 */
function probeCatSelfHealingPolicy(): RuntimeHealthCheck {
  const failures: string[] = [];
  for (const entry of SELF_HEALING_PROBE_CASES) {
    const recovery = classifyCatRuntimeRecovery(entry.input);
    if (recovery.kind !== entry.kind || recovery.action !== entry.action) {
      failures.push(`${entry.probe} classified as ${recovery.kind}/${recovery.action}`);
      continue;
    }
    const state = createCatSelfHealingRetryState();
    const firstPlan = planCatSelfHealingRetry(recovery, state);
    const secondPlan = planCatSelfHealingRetry(recovery, state);
    const budgetOk = entry.retries ? firstPlan !== undefined && secondPlan === undefined : firstPlan === undefined;
    if (!budgetOk) {
      failures.push(`${entry.probe} retry budget mismatch`);
    }
  }
  const sharedState = createCatSelfHealingRetryState();
  planCatSelfHealingRetry(classifyCatRuntimeRecovery({ message: "ECONNRESET" }), sharedState);
  if (planCatSelfHealingRetry(classifyCatRuntimeRecovery({ message: "429 rate limit" }), sharedState) !== undefined) {
    failures.push("transient classes did not share a single retry budget");
  }
  const enforced = failures.length === 0;
  return {
    code: "cat_self_healing_policy_visible",
    status: enforced ? "pass" : "fail",
    message: enforced
      ? "Self-healing policy verified behaviorally: every recovery class maps to its declared action with a one-shot retry budget (transient classes share one)."
      : `Self-healing policy probe failed: ${failures.join("; ")}.`,
    evidence: {
      promptTooLong: "compact_and_retry_once",
      outputCutoff: "continue_generation",
      timeoutReconnect: "reconnect_and_retry",
      providerRetry: "pi_retry_settings",
      toolFailure: "trace_visible_no_silent_fallback",
      probedClasses: SELF_HEALING_PROBE_CASES.map((entry) => entry.probe),
    },
  };
}

export function buildCatRuntimeHealthReport(input: CatRuntimeHealthInput): CatRuntimeHealthReport {
  const compaction = objectAt(input.piSettings, "compaction");
  const retry = objectAt(input.piSettings, "retry");
  const providerRetry = objectAt(retry, "provider");
  const resourcePolicy = buildPiResourcePolicyReport(input.resources ?? []);
  const checks: RuntimeHealthCheck[] = [
    checkVersion("pi_coding_agent", input.piCodingAgentVersion, input.expectedPiVersion),
    checkVersion("pi_ai", input.piAiVersion, input.expectedPiVersion),
    {
      code: "pi_compaction_enabled",
      status: compaction?.enabled === true ? "pass" : "fail",
      message:
        compaction?.enabled === true
          ? "Pi native compaction is enabled in project settings."
          : "Pi native compaction must stay enabled for long project sessions.",
      evidence: compaction,
    },
    {
      code: "pi_retry_configured",
      status: retry?.enabled === true && typeof retry.maxRetries === "number" ? "pass" : "fail",
      message:
        retry?.enabled === true && typeof retry.maxRetries === "number"
          ? "Pi retry policy is explicit."
          : "Pi retry policy must be explicit instead of relying on hidden defaults.",
      evidence: retry,
    },
    {
      code: "pi_provider_retry_explicit",
      status: typeof providerRetry?.maxRetries === "number" ? "pass" : "fail",
      message:
        typeof providerRetry?.maxRetries === "number"
          ? "Provider retry maxRetries is explicit."
          : "Provider retry maxRetries must be explicit for predictable API behavior.",
      evidence: providerRetry,
    },
    {
      code: "browser_tool_surface_isolated",
      status: input.browserNoExtensions && input.browserCustomTools && input.browserBuiltinTools ? "pass" : "fail",
      message:
        input.browserNoExtensions && input.browserCustomTools && input.browserBuiltinTools
          ? "Product CAT sessions isolate global Pi resources and retain LA CAT tools plus server-selected Run resources."
          : "Product CAT sessions must isolate global Pi resources while keeping built-ins and LA CAT tools enabled.",
      evidence: {
        noExtensions: input.browserNoExtensions,
        customTools: input.browserCustomTools,
        builtinTools: input.browserBuiltinTools,
      },
    },
    {
      code: "browser_data_store_write_guard",
      status: input.browserDataStoreWriteGuard ? "pass" : "fail",
      message: input.browserDataStoreWriteGuard
        ? "CAT runtime keeps the data/** write guard as defense in depth around explicit CAT mutations."
        : "CAT runtime must retain defense-in-depth protection for data/** writes.",
      evidence: input.browserDataStoreWriteGuard,
    },
    {
      code: "browser_non_cat_results_advisory",
      status: input.browserNonCatToolResultsCitable === false ? "pass" : "fail",
      message: input.browserNonCatToolResultsCitable === false
        ? "Server-selected and built-in tool results are tagged advisory with citable:false."
        : "Server-selected and built-in tool results must stay non-citable until promoted through CAT evidence gates.",
      evidence: {
        nonCatToolResultsCitable: input.browserNonCatToolResultsCitable,
      },
    },
    {
      code: "web_session_bridge_policy_complete",
      status:
        ["web_search", "web_fetch", "browser_automation", "weather", "mcp"].every((id) =>
          resourcePolicy.bridges.some((bridge) => bridge.id === id),
        ) &&
        resourcePolicy.bridges.every((bridge) => implementedBridgePolicyIsSafe(bridge))
          ? "pass"
          : "fail",
      message:
        "Web/API bridge catalog declares implemented and planned bridge classes with mutation risk, evidence behavior, audit trail, and allowlist state.",
      evidence: resourcePolicy.bridges.map((bridge) => ({
        id: bridge.id,
        status: bridge.status,
        accessClass: bridge.accessClass,
        mutationRisk: bridge.mutationRisk,
        controls: bridge.controls.map((control) => `${control.id}:${control.state}`),
      })),
    },
    {
      code: "project_session_strategy_explicit",
      status: input.projectSessionStrategy === "deterministic-project-session-id" ? "pass" : "fail",
      message: "Project sessions use deterministic project-local session ids.",
      evidence: input.projectSessionStrategy,
    },
    {
      code: "pi_project_resources_configured",
      status:
        Array.isArray(input.piSettings.skills) &&
        Array.isArray(input.piSettings.prompts) &&
        Array.isArray(input.piSettings.extensions)
          ? "pass"
          : "warn",
      message:
        "Project .pi settings should explicitly list skills, prompts, and extensions so CLI resource discovery stays reviewable.",
      evidence: {
        skills: input.piSettings.skills,
        prompts: input.piSettings.prompts,
        extensions: input.piSettings.extensions,
      },
    },
    probeCatStreamRuleEnforcement(),
    probeCatSelfHealingPolicy(),
  ];

  return {
    status: statusFromChecks(checks),
    versions: {
      la: input.laVersion,
      piCodingAgent: input.piCodingAgentVersion,
      piAi: input.piAiVersion,
      expectedPi: input.expectedPiVersion,
    },
    piSettings: {
      defaultProvider: input.piSettings.defaultProvider,
      defaultModel: input.piSettings.defaultModel,
      compaction,
      retry,
      sessionDir: input.piSettings.sessionDir,
      skills: input.piSettings.skills,
      prompts: input.piSettings.prompts,
      extensions: input.piSettings.extensions,
    },
    browserSessionPolicy: {
      noExtensions: input.browserNoExtensions,
      customTools: input.browserCustomTools,
      builtinTools: input.browserBuiltinTools,
      dataStoreWriteGuard: input.browserDataStoreWriteGuard,
      nonCatToolResultsCitable: input.browserNonCatToolResultsCitable,
      toolSurface:
        input.browserNoExtensions && input.browserCustomTools && input.browserBuiltinTools
          ? "isolated-la-cat+server-resources"
          : "unknown",
    },
    projectSessionPolicy: {
      strategy: input.projectSessionStrategy,
      storage: "project-local-jsonl",
    },
    streamRulePolicy: {
      phase: "blocker_abort_retry",
      inputEvents: ["message_update:text_delta", "assistant_final"],
      finalChecks: true,
      abortRetry: "blockers_only_one_retry",
    },
    selfHealingPolicy: {
      promptTooLong: "compact_and_retry_once",
      outputCutoff: "continue_generation",
      timeoutReconnect: "reconnect_and_retry",
      providerRetry: "pi_retry_settings",
      toolFailure: "trace_visible_no_silent_fallback",
    },
    resourcePolicy,
    sandbox: input.sandbox,
    residentRuntime: input.residentRuntime,
    permissionPolicy: input.permissionPolicy,
    checks,
  };
}
