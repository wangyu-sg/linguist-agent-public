import type {
  TaskArtifact,
  TaskDecision,
  TaskRun,
  TaskRunStatus,
  TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

export type PipelineOperation =
  | "quality_audit"
  | "quality_waiver"
  | "delivery_qa"
  | "delivery_qa_review"
  | "delivery_readiness"
  | "delivery_export"
  | "pipeline"
  | "eval";

export type CanonicalStatusTone = "neutral" | "running" | "waiting" | "stopping" | "stopped" | "complete" | "failed";

export interface CanonicalRunPresentation {
  label: string;
  tone: CanonicalStatusTone;
  terminal: boolean;
}

export interface PipelineRunView {
  run: TaskRun;
  operation: PipelineOperation;
  label: string;
  presentation: CanonicalRunPresentation;
}

export interface OwnedPipelineArtifact {
  artifact: TaskArtifact;
  run: TaskRun;
  operation: PipelineOperation;
  decisions: TaskDecision[];
}

export interface PipelineSnapshotView {
  runs: PipelineRunView[];
  quality: OwnedPipelineArtifact | null;
  review: OwnedPipelineArtifact | null;
  readiness: OwnedPipelineArtifact | null;
  latestExport: OwnedPipelineArtifact | null;
  eval: {
    outputs: TaskArtifact[];
    scorecards: TaskArtifact[];
    comparisons: TaskArtifact[];
  };
}

const PIPELINE_OPERATIONS = new Set<PipelineOperation>([
  "quality_audit",
  "quality_waiver",
  "delivery_qa",
  "delivery_qa_review",
  "delivery_readiness",
  "delivery_export",
]);

const OPERATION_LABELS: Record<PipelineOperation, string> = {
  quality_audit: "质量审计",
  quality_waiver: "质量决定",
  delivery_qa: "交付复核",
  delivery_qa_review: "复核决定",
  delivery_readiness: "交付准备度",
  delivery_export: "交付导出",
  pipeline: "CAT 流程",
  eval: "质量评估",
};

export function canonicalRunPresentation(status: TaskRunStatus): CanonicalRunPresentation {
  switch (status) {
    case "pending": return { label: "准备中", tone: "neutral", terminal: false };
    case "active": return { label: "运行中", tone: "running", terminal: false };
    case "awaiting_input": return { label: "需要输入", tone: "waiting", terminal: false };
    case "waiting": return { label: "等待中", tone: "waiting", terminal: false };
    case "stopping": return { label: "正在停止", tone: "stopping", terminal: false };
    case "stopped": return { label: "已停止", tone: "stopped", terminal: true };
    case "failed": return { label: "失败", tone: "failed", terminal: true };
    case "stale": return { label: "已中断", tone: "failed", terminal: true };
    case "complete": return { label: "已完成", tone: "complete", terminal: true };
  }
}

function operationForRun(snapshot: TaskWorkspaceSnapshot, run: TaskRun): PipelineOperation {
  if (run.mode === "eval") return "eval";
  const roleId = snapshot.agentThreads.find((thread) => thread.id === run.rootAgentThreadId)?.identity.roleId;
  return roleId && PIPELINE_OPERATIONS.has(roleId as PipelineOperation) ? roleId as PipelineOperation : "pipeline";
}

function newestFirst<T extends { updatedAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function newestOwnedArtifact(
  snapshot: TaskWorkspaceSnapshot,
  operations: ReadonlySet<PipelineOperation>,
  type: TaskArtifact["type"],
): OwnedPipelineArtifact | null {
  const runs = new Map(snapshot.runs.map((run) => [run.id, run]));
  for (const artifact of newestFirst(snapshot.artifacts.filter((candidate) => candidate.type === type))) {
    const run = runs.get(artifact.runId);
    if (!run) continue;
    const operation = operationForRun(snapshot, run);
    if (!operations.has(operation)) continue;
    return {
      artifact,
      run,
      operation,
      decisions: snapshot.decisions.filter((decision) => decision.artifactId === artifact.id),
    };
  }
  return null;
}

export function buildPipelineSnapshotView(snapshot: TaskWorkspaceSnapshot): PipelineSnapshotView {
  const runs = snapshot.runs
    .filter((run) => run.mode === "pipeline" || run.mode === "eval")
    .map((run): PipelineRunView => {
      const operation = operationForRun(snapshot, run);
      return { run, operation, label: OPERATION_LABELS[operation], presentation: canonicalRunPresentation(run.status) };
    })
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt) || left.run.id.localeCompare(right.run.id));
  const evalArtifacts = snapshot.artifacts.filter((artifact) => snapshot.runs.some((run) => run.id === artifact.runId && run.mode === "eval"));
  return {
    runs,
    quality: newestOwnedArtifact(snapshot, new Set(["quality_audit", "quality_waiver"]), "qa_report"),
    review: newestOwnedArtifact(snapshot, new Set(["delivery_qa", "delivery_qa_review"]), "qa_report"),
    readiness: newestOwnedArtifact(snapshot, new Set(["delivery_readiness"]), "delivery_readiness"),
    latestExport: newestOwnedArtifact(snapshot, new Set(["delivery_export"]), "delivery_export"),
    eval: {
      outputs: newestFirst(evalArtifacts.filter((artifact) => artifact.type === "eval_output")),
      scorecards: newestFirst(evalArtifacts.filter((artifact) => artifact.type === "eval_scorecard")),
      comparisons: newestFirst(evalArtifacts.filter((artifact) => artifact.type === "eval_comparison")),
    },
  };
}
