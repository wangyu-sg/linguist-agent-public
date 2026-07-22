import assert from "node:assert/strict";
import { buildContextReadinessReport, type ProjectContextSnapshot } from "@linguist-agent/cat-data";

const projectContext: ProjectContextSnapshot = {
  projectId: "proj",
  projectRoot: "/tmp/proj",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  manifestUpdatedAt: "2026-05-29T00:00:00.000Z",
  assetsByRole: { glossary: 1 },
  confirmedAssetRoles: [{ relPath: "terms.xlsx", role: "glossary" }],
  warnings: [],
  questions: [],
  batches: [{ batchId: "b1", format: "phrase_mxliff", segments: 10, confirmed: 8, draft: 2, new: 0, locked: 0 }],
  coverage: {
    totalAssets: 1,
    confirmedAssetRoles: 1,
    visibleConfirmedAssetRoles: 1,
    totalWarnings: 0,
    visibleWarnings: 0,
    totalQuestions: 0,
    visibleQuestions: 0,
    totalBatches: 1,
    visibleBatches: 1,
  },
  freshness: {
    checkedAt: "2026-05-29T00:02:00.000Z",
    projectRootExists: true,
    manifestAgeHours: 1,
    missingAssetPaths: [],
    assetsChecked: 1,
    assetsAvailable: 1,
    detectedMissingAssets: 0,
    sizeChangedAssetPaths: [],
    detectedChangedAssets: 0,
    missingBatchFiles: [],
    batchesChecked: 1,
    detectedMissingBatchFiles: 0,
  },
  health: {
    status: "pass",
    checkedAt: "2026-05-29T00:01:00.000Z",
    summary: {
      missingImports: 0,
      deliveryFailures: 0,
      deliveryWarnings: 0,
      unappliedProposalRows: 0,
      staleAssets: 0,
    },
    issues: [],
  },
  contextPolicy: {
    useToolsForEvidence: true,
    traceIsEvidence: false,
    lockedRowsImmutable: true,
    memoryIsRecallOnly: true,
  },
};

const ready = buildContextReadinessReport({
  projectContext,
  memory: {
    status: "ready",
    enabled: true,
    gatewayUrl: "http://127.0.0.1:8420",
    gatewayReachable: true,
    toolsAvailable: true,
    captureEnabled: false,
    cacheSafety: "tool_tail_only",
    userIdStrategy: "project_id",
    audit: {
      path: "/tmp/memory_audit.jsonl",
      total: 1,
      lastEvent: {
        ts: "2026-05-29T00:02:00.000Z",
        kind: "capture_success",
        gatewayUrl: "http://127.0.0.1:8420",
        projectId: "proj",
      },
      lastCaptureAt: "2026-05-29T00:02:00.000Z",
      consecutiveFailures: 0,
    },
  },
  session: {
    activeSessionId: "la-proj",
    sessions: [{ id: "la-proj", isProjectSession: true, contextPct: 4.5, compactionCount: 0, sessionName: "proj · review" }],
  },
  workflows: { active: 0, waitingApproval: 0 },
  compaction: { nativeEnabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
});
assert.equal(ready.status, "pass");
assert.equal(ready.checks.find((check) => check.code === "deterministic_project_session")?.status, "pass");
assert.equal(ready.checks.find((check) => check.code === "pi_native_compaction")?.status, "pass");
assert.equal(ready.checks.find((check) => check.code === "project_context_freshness")?.status, "pass");

const blocked = buildContextReadinessReport({
  projectContext: {
    ...projectContext,
    batches: [],
    freshness: {
      ...projectContext.freshness,
      missingAssetPaths: [],
      detectedMissingAssets: 25,
      missingBatchFiles: [],
      detectedMissingBatchFiles: 1,
    },
    health: { ...projectContext.health!, status: "fail" },
  },
  memory: {
    status: "gateway_unreachable",
    enabled: true,
    gatewayUrl: "http://127.0.0.1:8420",
    gatewayReachable: false,
    toolsAvailable: false,
    captureEnabled: false,
    cacheSafety: "tool_tail_only",
    userIdStrategy: "project_id",
    nextAction: "Start Gateway",
  },
  session: {
    activeSessionId: "la-proj",
    sessions: [{ id: "other", contextPct: 92, compactionCount: 0 }],
  },
  workflows: { active: 1, waitingApproval: 1 },
  compaction: { nativeEnabled: false, reserveTokens: 16384, keepRecentTokens: 20000 },
});
assert.equal(blocked.status, "fail");
assert.ok(blocked.nextActions.some((action) => /Gateway|compaction|project session|Import/.test(action)));
assert.equal(blocked.checks.find((check) => check.code === "context_budget")?.status, "fail");
assert.equal(blocked.checks.find((check) => check.code === "project_context_freshness")?.status, "fail");
assert.match(blocked.checks.find((check) => check.code === "project_context_freshness")?.message ?? "", /missing_assets=25/);

console.log("context_readiness tests passed");
