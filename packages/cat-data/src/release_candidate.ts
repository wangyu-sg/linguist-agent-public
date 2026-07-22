import { openCriticalRisks, type RcRisk } from "./rc_gate.js";

export type ReleaseCandidateCheckStatus = "pass" | "warn" | "fail";

export interface ReleaseCandidateCheck {
  id: string;
  status: ReleaseCandidateCheckStatus;
  summary: string;
  evidence?: string;
}

export interface ReleaseCandidateStatus {
  schemaVersion: 1;
  checkedAt: string;
  version: string;
  status: ReleaseCandidateCheckStatus;
  checks: ReleaseCandidateCheck[];
  failures: string[];
  warnings: string[];
}

export interface PiDependencyManifest {
  manifestPath: string;
  dependencies: Record<string, string | undefined>;
}

export interface ReleaseCandidateInput {
  checkedAt: string;
  version: string;
  piDependencies: Record<string, string | undefined>;
  piDependencyManifests?: PiDependencyManifest[];
  piSettings: {
    defaultProvider?: unknown;
    defaultModel?: unknown;
    sessionDir?: unknown;
    compaction?: { enabled?: unknown; reserveTokens?: unknown; keepRecentTokens?: unknown };
    retry?: { enabled?: unknown; maxRetries?: unknown; provider?: { maxRetries?: unknown } };
    skills?: unknown;
    prompts?: unknown;
    extensions?: unknown;
  };
  risks: RcRisk[];
  harnessSecurityEval?: {
    status: "pass" | "fail";
    fixturePath: string;
    caseCount: number;
    failed: number;
  };
  frontendSurfaceFiles: string[];
  docs: {
    changelogHasVersion: boolean;
    readmeHasVersion: boolean;
    projectOverviewHasVersion: boolean;
    runtimeBorrowedPatternsCurrent: boolean;
    todoHasRcFreeze: boolean;
  };
}

const piDependencyNames = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"] as const;
const exactPackageVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isExactPackageVersion(value: string | undefined): value is string {
  return typeof value === "string" && exactPackageVersionPattern.test(value);
}

function piDependencyManifests(input: ReleaseCandidateInput): PiDependencyManifest[] {
  if (input.piDependencyManifests?.length) return input.piDependencyManifests;
  return [{ manifestPath: "package.json", dependencies: input.piDependencies }];
}

function declaredPiPins(input: ReleaseCandidateInput): Array<{ manifestPath: string; name: string; version: string | undefined }> {
  return piDependencyManifests(input).flatMap((manifest) =>
    piDependencyNames
      .filter((name) => Object.prototype.hasOwnProperty.call(manifest.dependencies, name))
      .map((name) => ({
        manifestPath: manifest.manifestPath,
        name,
        version: manifest.dependencies[name],
      })),
  );
}

function evaluatePiPins(input: ReleaseCandidateInput): { ok: boolean; version?: string; evidence: string } {
  const pins = declaredPiPins(input);
  const declaredNames = new Set(pins.map((pin) => pin.name));
  const missingNames = piDependencyNames.filter((name) => !declaredNames.has(name));
  const versions = pins.map((pin) => pin.version).filter((version): version is string => typeof version === "string");
  const exactPins = pins.every((pin) => isExactPackageVersion(pin.version));
  const uniqueVersions = new Set(versions);
  const ok = pins.length > 0 && missingNames.length === 0 && exactPins && uniqueVersions.size === 1;
  return {
    ok,
    version: ok ? versions[0] : undefined,
    evidence: JSON.stringify({ pins, missingNames }),
  };
}

export const requiredFrontendSurfaceFiles = [
  "apps/desktop/src/main.mjs",
  "apps/desktop/src/preload.cjs",
  "apps/desktop/src/renderer/main.tsx",
  "apps/desktop/src/renderer/shell/ProductWorkspace.tsx",
  "apps/desktop/src/renderer/conversation/TaskConversation.tsx",
  "apps/desktop/src/renderer/cat/CatWorkspace.tsx",
  "apps/desktop/src/renderer/settings/SettingsWorkspace.tsx",
] as const;

function hasFile(files: string[], requiredFile: string): boolean {
  return files.some((file) => file === requiredFile || file.endsWith(requiredFile));
}

export function buildReleaseCandidateStatus(input: ReleaseCandidateInput): ReleaseCandidateStatus {
  const checks: ReleaseCandidateCheck[] = [];
  const add = (check: ReleaseCandidateCheck) => checks.push(check);
  add({
    id: "version_floor",
    status: /^0\.(9\d|[1-9]\d{2,})\.\d+$/.test(input.version) || /^[1-9]\d*\.\d+\.\d+$/.test(input.version) ? "pass" : "fail",
    summary: `Package version is ${input.version}.`,
    evidence: "v0.90+ / v1.0 is the release-candidate track.",
  });
  const piPins = evaluatePiPins(input);
  add({
    id: "pi_exact_pins",
    status: piPins.ok ? "pass" : "fail",
    summary: piPins.ok
      ? `Pi SDK/runtime dependencies are exact matching pins at ${piPins.version}.`
      : "Pi SDK/runtime dependencies must be exact matching version pins across package manifests and lockfile.",
    evidence: piPins.evidence,
  });
  const compaction = input.piSettings.compaction;
  add({
    id: "pi_native_compaction",
    status: compaction?.enabled === true && Number(compaction.reserveTokens) > 0 && Number(compaction.keepRecentTokens) > 0 ? "pass" : "fail",
    summary: "Pi native compaction is enabled with explicit reserve/keep token settings.",
    evidence: JSON.stringify(compaction ?? null),
  });
  const retry = input.piSettings.retry;
  add({
    id: "pi_retry_policy",
    status: retry?.enabled === true && typeof retry.maxRetries === "number" && typeof retry.provider?.maxRetries === "number" ? "pass" : "fail",
    summary: "Pi retry policy is explicit, including provider retry control.",
    evidence: JSON.stringify(retry ?? null),
  });
  const resourcesOk =
    input.piSettings.sessionDir === "sessions" &&
    Array.isArray(input.piSettings.skills) &&
    Array.isArray(input.piSettings.prompts) &&
    Array.isArray(input.piSettings.extensions);
  add({
    id: "pi_project_resources",
    status: resourcesOk ? "pass" : "fail",
    summary: "Project-local session/resources are configured through Pi settings.",
    evidence: JSON.stringify({
      sessionDir: input.piSettings.sessionDir,
      skills: input.piSettings.skills,
      prompts: input.piSettings.prompts,
      extensions: input.piSettings.extensions,
    }),
  });
  const criticalRisks = openCriticalRisks(input.risks);
  add({
    id: "known_risk_gate",
    status: criticalRisks.length ? "fail" : "pass",
    summary: criticalRisks.length ? `${criticalRisks.length} open P0/P1 risk(s) remain.` : "No open P0/P1 known risks remain.",
    evidence: criticalRisks.map((risk) => `${risk.id}:${risk.status}`).join(", ") || "none",
  });
  const harnessEval = input.harnessSecurityEval;
  const harnessOk = Boolean(harnessEval && harnessEval.status === "pass" && harnessEval.caseCount > 0 && harnessEval.failed === 0);
  add({
    id: "harness_security_eval",
    status: harnessOk ? "pass" : "fail",
    summary: harnessOk
      ? `Offline harness security eval passed ${harnessEval?.caseCount ?? 0} synthetic case(s).`
      : "Offline harness security eval must pass before RC.",
    evidence: harnessEval
      ? `${harnessEval.fixturePath}; status=${harnessEval.status}; cases=${harnessEval.caseCount}; failed=${harnessEval.failed}`
      : "missing",
  });
  const p2Open = input.risks.filter((risk) => risk.severity === "P2" && risk.status === "open");
  add({
    id: "known_p2_monitoring",
    status: p2Open.length ? "warn" : "pass",
    summary: p2Open.length ? `${p2Open.length} open P2 risk(s) still need monitoring.` : "No open P2 risks are marked open.",
    evidence: p2Open.map((risk) => `${risk.id}:${risk.summary}`).join("; ") || "none",
  });
  const missingFrontendFiles = requiredFrontendSurfaceFiles.filter((file) => !hasFile(input.frontendSurfaceFiles, file));
  add({
    id: "frontend_surface_boundary",
    status: missingFrontendFiles.length ? "fail" : "pass",
    summary: "Primary macOS frontend surfaces are present.",
    evidence: missingFrontendFiles.length ? `missing: ${missingFrontendFiles.join(", ")}` : requiredFrontendSurfaceFiles.join(", "),
  });
  const docsOk =
    input.docs.changelogHasVersion &&
    input.docs.readmeHasVersion &&
    input.docs.projectOverviewHasVersion &&
    input.docs.runtimeBorrowedPatternsCurrent &&
    input.docs.todoHasRcFreeze;
  add({
    id: "docs_synced",
    status: docsOk ? "pass" : "fail",
    summary: "Release-candidate docs mention the current version and RC freeze/gate state.",
    evidence: JSON.stringify(input.docs),
  });
  const failures = checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.summary}`);
  const warnings = checks.filter((check) => check.status === "warn").map((check) => `${check.id}: ${check.summary}`);
  return {
    schemaVersion: 1,
    checkedAt: input.checkedAt,
    version: input.version,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
    checks,
    failures,
    warnings,
  };
}

export function renderReleaseCandidateStatusMarkdown(status: ReleaseCandidateStatus): string {
  const lines: string[] = [];
  lines.push("# LA Release Candidate Status");
  lines.push("");
  lines.push(`Version: ${status.version}`);
  lines.push(`Checked: ${status.checkedAt}`);
  lines.push(`Status: ${status.status}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| ID | Status | Summary | Evidence |");
  lines.push("|---|---|---|---|");
  for (const check of status.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.summary.replace(/\|/g, "\\|")} | ${(check.evidence ?? "-").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## Failures");
  if (status.failures.length) {
    for (const failure of status.failures) lines.push(`- ${failure}`);
  } else {
    lines.push("- None.");
  }
  if (status.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of status.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
