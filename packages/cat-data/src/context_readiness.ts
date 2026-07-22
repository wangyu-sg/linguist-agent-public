import type { MemoryStatus } from "./memory-config.js";
import type { ProjectContextSnapshot } from "./project_context.js";

export type ContextReadinessStatus = "pass" | "warn" | "fail";

export interface ContextReadinessCheck {
  code: string;
  status: ContextReadinessStatus;
  message: string;
  nextAction?: string;
}

export interface ContextReadinessReport {
  status: ContextReadinessStatus;
  checkedAt: string;
  checks: ContextReadinessCheck[];
  nextActions: string[];
}

export interface ContextReadinessInput {
  projectContext: ProjectContextSnapshot;
  memory: MemoryStatus;
  session: {
    activeSessionId: string;
    sessions: Array<{
      id: string;
      isProjectSession?: boolean;
      contextPct?: number | null;
      compactionCount?: number;
      sessionName?: string;
      displayName?: string;
    }>;
  };
  workflows: {
    active: number;
    waitingApproval: number;
  };
  compaction: {
    nativeEnabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  };
}

function statusFromChecks(checks: ContextReadinessCheck[]): ContextReadinessStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function push(checks: ContextReadinessCheck[], check: ContextReadinessCheck): void {
  checks.push(check);
}

export function buildContextReadinessReport(input: ContextReadinessInput): ContextReadinessReport {
  const checks: ContextReadinessCheck[] = [];
  const projectSession = input.session.sessions.find((session) => session.id === input.session.activeSessionId || session.isProjectSession);
  const topSession = input.session.sessions[0];

  push(checks, {
    code: "project_context_loaded",
    status: input.projectContext.projectId ? "pass" : "fail",
    message: input.projectContext.projectId
      ? `Project context loaded for ${input.projectContext.projectId}.`
      : "Project context is missing.",
    nextAction: input.projectContext.projectId ? undefined : "Run project_onboard or project_refresh before agent work.",
  });

  push(checks, {
    code: "imported_batches_available",
    status: input.projectContext.coverage.totalBatches ? "pass" : "warn",
    message: input.projectContext.coverage.totalBatches
      ? `${input.projectContext.coverage.totalBatches} imported batch(es) exist; ${input.projectContext.coverage.visibleBatches} summary row(s) are included in this prompt preview.`
      : "No imported batches are visible in project context.",
    nextAction: input.projectContext.coverage.totalBatches ? undefined : "Import the customer batch before translation/review/delivery work.",
  });

  push(checks, {
    code: "project_health_checked",
    status: input.projectContext.health?.status ?? "warn",
    message: input.projectContext.health
      ? `Project health is ${input.projectContext.health.status}.`
      : "Project health has not been attached to this context packet.",
    nextAction: input.projectContext.health ? undefined : "Call project_context with includeHealth=true before review or delivery decisions.",
  });

  const freshness = input.projectContext.freshness;
  const missingAssets = freshness.detectedMissingAssets;
  const changedAssets = freshness.detectedChangedAssets;
  const missingBatchFiles = freshness.detectedMissingBatchFiles;
  push(checks, {
    code: "project_context_freshness",
    status:
      !freshness.projectRootExists || missingBatchFiles
        ? "fail"
        : missingAssets || changedAssets || freshness.manifestAgeHours > 168
          ? "warn"
          : "pass",
    message: `Project freshness: root=${freshness.projectRootExists ? "present" : "missing"}, manifest_age=${freshness.manifestAgeHours}h, missing_assets=${missingAssets}, changed_assets=${changedAssets}, missing_batch_files=${missingBatchFiles}.`,
    nextAction:
      !freshness.projectRootExists || missingBatchFiles
        ? "Fix project root/batch file paths before review or delivery."
        : missingAssets || changedAssets
          ? "Run project_refresh and re-confirm changed asset roles before trusting project context."
          : freshness.manifestAgeHours > 168
            ? "Run project_refresh because the project manifest is older than 7 days."
            : undefined,
  });

  push(checks, {
    code: "deterministic_project_session",
    status: projectSession ? "pass" : "fail",
    message: projectSession
      ? `Deterministic Pi project session is active: ${input.session.activeSessionId}.`
      : `No session matches deterministic project session id ${input.session.activeSessionId}.`,
    nextAction: projectSession ? undefined : "Open the project through LA project mode so Pi uses the exact project session id.",
  });

  const contextPct = topSession?.contextPct ?? 0;
  push(checks, {
    code: "context_budget",
    status: contextPct >= 90 ? "fail" : contextPct >= 75 ? "warn" : "pass",
    message: `Top session context usage is ${contextPct.toFixed(2)}%.`,
    nextAction:
      contextPct >= 90
        ? "Run CAT-aware compaction before continuing long review work."
        : contextPct >= 75
          ? "Consider CAT-aware compaction before a long multi-step task."
          : undefined,
  });

  push(checks, {
    code: "pi_native_compaction",
    status: input.compaction.nativeEnabled ? "pass" : "fail",
    message: input.compaction.nativeEnabled
      ? `Pi native compaction is enabled (reserve=${input.compaction.reserveTokens}, keepRecent=${input.compaction.keepRecentTokens}).`
      : "Pi native compaction is disabled.",
    nextAction: input.compaction.nativeEnabled ? undefined : "Enable Pi compaction in project settings/runtime overrides.",
  });

  const compactionCount = topSession?.compactionCount ?? 0;
  push(checks, {
    code: "compaction_history_visible",
    status: compactionCount > 0 || contextPct < 50 ? "pass" : "warn",
    message: compactionCount > 0
      ? `${compactionCount} compaction event(s) are visible in the project session.`
      : "No compaction event is visible in the current project session yet.",
    nextAction: compactionCount > 0 || contextPct < 50 ? undefined : "Run manual CAT-aware compaction or keep monitoring native compaction events.",
  });

  push(checks, {
    code: "memory_status",
    status: input.memory.status === "gateway_unreachable" ? "warn" : "pass",
    message: `Optional legacy TDAI recall is ${input.memory.status}; confirmed local memory remains Library-owned and non-evidence.`,
    nextAction: input.memory.nextAction,
  });

  const audit = input.memory.audit;
  push(checks, {
    code: "legacy_memory_recall_audit",
    status: input.memory.status === "gateway_unreachable" ? "warn" : "pass",
    message: audit?.lastSearchAt
      ? `Last optional legacy memory search completed at ${audit.lastSearchAt}.`
      : "Automatic turn capture is disabled; legacy TDAI has no required capture audit.",
    nextAction: input.memory.status === "gateway_unreachable" ? input.memory.nextAction : undefined,
  });

  push(checks, {
    code: "workflow_state",
    status: input.workflows.waitingApproval > 0 ? "warn" : "pass",
    message: input.workflows.active
      ? `${input.workflows.active} active workflow(s), ${input.workflows.waitingApproval} waiting for approval.`
      : "No active workflow is blocking the session.",
    nextAction: input.workflows.waitingApproval > 0 ? "Resolve pending workflow approval gates before write/export steps." : undefined,
  });

  const status = statusFromChecks(checks);
  return {
    status,
    checkedAt: new Date().toISOString(),
    checks,
    nextActions: checks.map((check) => check.nextAction).filter((action): action is string => Boolean(action)),
  };
}
