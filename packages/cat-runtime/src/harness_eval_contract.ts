import type { CatWorkspace } from "@linguist-agent/cat-data";
import { catToolMetadataFor } from "@linguist-agent/cat-tools";
import { guardNonCatToolCall, tagNonCatToolResult } from "./catRuntimeExtension.js";
import { buildCatSandboxRuntimeConfig, sanitizeBashEnv, validateSandboxAllowedDomains } from "./catSandbox.js";

export type HarnessToolSource = "pi-inherited" | "builtin" | "cat-native" | "unknown";
export type HarnessSecurityEvalStatus = "pass" | "fail";

export interface HarnessToolSourceCase {
  id: string;
  kind: "tool_source";
  toolName: string;
  expectedSource: HarnessToolSource;
}

export interface HarnessDataWriteAttemptCase {
  id: string;
  kind: "data_write_attempt";
  // Any tool name: the data-store guard is name-independent (default-deny on non-exempt tools that
  // target data/), so the fixture must be able to assert novel write verbs are blocked.
  toolName: string;
  input: Record<string, unknown>;
  expected: "blocked" | "allowed";
}

export interface HarnessAdvisoryResultCase {
  id: string;
  kind: "advisory_result";
  toolName: string;
  contentText: string;
  expectedCitable: false;
}

export interface HarnessSandboxEgressCase {
  id: string;
  kind: "sandbox_egress";
  domains: string[];
  expected: "allowed" | "denied";
}

export interface HarnessSandboxFilesystemGuardCase {
  id: string;
  kind: "sandbox_fs_guard";
  expectedDenyRead: string[];
  expectedDenyWriteData: true;
}

export interface HarnessSecretEnvScrubCase {
  id: string;
  kind: "secret_env_scrub";
  inputEnv: Record<string, string>;
  expectedRemoved: string[];
  expectedRetained: string[];
}

export interface HarnessEvidencePromotionCase {
  id: string;
  kind: "evidence_promotion";
  advisoryToolName: string;
  catToolName: string;
  evidenceSource: string;
  excerpt: string;
  expectedBeforeCitable: false;
  expectedAfterCitable: true;
}

export type HarnessSecurityEvalCase =
  | HarnessToolSourceCase
  | HarnessDataWriteAttemptCase
  | HarnessAdvisoryResultCase
  | HarnessSandboxEgressCase
  | HarnessSandboxFilesystemGuardCase
  | HarnessSecretEnvScrubCase
  | HarnessEvidencePromotionCase;

export interface HarnessSecurityEvalFixture {
  schemaVersion: 1;
  id: string;
  description?: string;
  projectId: string;
  cases: HarnessSecurityEvalCase[];
}

export interface HarnessSecurityEvalCaseResult {
  caseId: string;
  kind: HarnessSecurityEvalCase["kind"];
  status: HarnessSecurityEvalStatus;
  expected?: unknown;
  observed?: unknown;
  details?: Record<string, unknown>;
}

export interface HarnessSecurityEvalResult {
  schemaVersion: 1;
  fixtureId: string;
  status: HarnessSecurityEvalStatus;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: HarnessSecurityEvalCaseResult[];
}

type HarnessToolResultContent = Array<{ type: "text"; text: string }>;

const BUILTIN_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "edit", "write", "bash"]);
const PI_INHERITED_TOOL_NAMES = new Set(["web_search", "web_extract", "fetch_content", "get_search_content"]);

function caseResult(
  testCase: HarnessSecurityEvalCase,
  status: HarnessSecurityEvalStatus,
  observed: unknown,
  expected?: unknown,
  details?: Record<string, unknown>,
): HarnessSecurityEvalCaseResult {
  return {
    caseId: testCase.id,
    kind: testCase.kind,
    status,
    expected,
    observed,
    ...(details ? { details } : {}),
  };
}

function toolResultContent(text: string): HarnessToolResultContent {
  return [{ type: "text", text }];
}

function advisoryCitable(details: unknown): unknown {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const advisory = (details as { catRuntimeAdvisory?: { citable?: unknown } }).catRuntimeAdvisory;
  return advisory?.citable;
}

export function resolveHarnessToolSource(toolName: string): HarnessToolSource {
  const metadata = catToolMetadataFor(toolName);
  if (metadata) return metadata.category === "bridge" ? "pi-inherited" : "cat-native";
  if (BUILTIN_TOOL_NAMES.has(toolName)) return "builtin";
  if (PI_INHERITED_TOOL_NAMES.has(toolName)) return "pi-inherited";
  return "unknown";
}

export function evaluateHarnessSecurityEvalCase(
  testCase: HarnessSecurityEvalCase,
  workspace: CatWorkspace,
): HarnessSecurityEvalCaseResult {
  switch (testCase.kind) {
    case "tool_source": {
      const observed = resolveHarnessToolSource(testCase.toolName);
      return caseResult(testCase, observed === testCase.expectedSource ? "pass" : "fail", observed, testCase.expectedSource);
    }
    case "data_write_attempt": {
      const guard = guardNonCatToolCall({ toolName: testCase.toolName, input: testCase.input }, workspace);
      const observed = guard?.block ? "blocked" : "allowed";
      return caseResult(testCase, observed === testCase.expected ? "pass" : "fail", observed, testCase.expected, {
        reason: guard?.reason,
      });
    }
    case "advisory_result": {
      const tagged = tagNonCatToolResult({
        toolName: testCase.toolName,
        content: toolResultContent(testCase.contentText),
        details: { fixtureCaseId: testCase.id },
        isError: false,
      });
      const observed = advisoryCitable(tagged?.details);
      return caseResult(testCase, observed === testCase.expectedCitable ? "pass" : "fail", observed, testCase.expectedCitable, {
        citable: observed,
      });
    }
    case "sandbox_egress": {
      let observed: "allowed" | "denied" = "allowed";
      let reason: string | undefined;
      try {
        validateSandboxAllowedDomains(testCase.domains);
      } catch (error) {
        observed = "denied";
        reason = error instanceof Error ? error.message : String(error);
      }
      return caseResult(testCase, observed === testCase.expected ? "pass" : "fail", observed, testCase.expected, {
        reason,
      });
    }
    case "sandbox_fs_guard": {
      const config = buildCatSandboxRuntimeConfig(workspace);
      const denyRead = config.filesystem?.denyRead ?? [];
      const denyWrite = config.filesystem?.denyWrite ?? [];
      const missingDenyRead = testCase.expectedDenyRead.filter((entry) => !denyRead.includes(entry));
      const denyWriteData = denyWrite.some((entry) => String(entry).endsWith("/data"));
      const pass = missingDenyRead.length === 0 && denyWriteData === testCase.expectedDenyWriteData;
      return caseResult(testCase, pass ? "pass" : "fail", pass, true, {
        denyRead,
        missingDenyRead,
        denyReadAgentReach: denyRead.includes("~/.agent-reach"),
        denyWriteData,
      });
    }
    case "secret_env_scrub": {
      const scrubbed = sanitizeBashEnv(testCase.inputEnv);
      const removed = testCase.expectedRemoved.filter((key) => scrubbed[key] === undefined);
      const retained = testCase.expectedRetained.filter((key) => scrubbed[key] === testCase.inputEnv[key]);
      const pass = removed.length === testCase.expectedRemoved.length && retained.length === testCase.expectedRetained.length;
      return caseResult(testCase, pass ? "pass" : "fail", pass, true, {
        removed,
        retained,
      });
    }
    case "evidence_promotion": {
      const advisory = tagNonCatToolResult({
        toolName: testCase.advisoryToolName,
        content: toolResultContent(testCase.excerpt),
        details: { fixtureCaseId: testCase.id },
        isError: false,
      });
      const beforeCitable = advisoryCitable(advisory?.details);
      const catTool = catToolMetadataFor(testCase.catToolName);
      const promoted = {
        citable: Boolean(catTool && testCase.evidenceSource && testCase.excerpt),
        recordedBy: testCase.catToolName,
        evidenceSource: testCase.evidenceSource,
      };
      const pass = beforeCitable === testCase.expectedBeforeCitable && promoted.citable === testCase.expectedAfterCitable;
      return caseResult(testCase, pass ? "pass" : "fail", promoted.citable, testCase.expectedAfterCitable, {
        beforeCitable,
        afterCitable: promoted.citable,
        recordedByCatTool: Boolean(catTool),
        evidenceSource: promoted.evidenceSource,
      });
    }
  }
}

export function evaluateHarnessSecurityEvalFixture(
  fixture: HarnessSecurityEvalFixture,
  workspace: CatWorkspace,
): HarnessSecurityEvalResult {
  const cases = fixture.cases.map((testCase) => evaluateHarnessSecurityEvalCase(testCase, workspace));
  const failed = cases.filter((testCase) => testCase.status === "fail").length;
  return {
    schemaVersion: 1,
    fixtureId: fixture.id,
    status: failed ? "fail" : "pass",
    summary: {
      total: cases.length,
      passed: cases.length - failed,
      failed,
    },
    cases,
  };
}
