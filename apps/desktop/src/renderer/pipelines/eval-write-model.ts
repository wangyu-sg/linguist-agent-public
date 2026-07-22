import type {
  EvalDimensionDTO,
  PrivateEvalBlindReviewInputDTO,
  PrivateEvalRunDTO,
} from "../data/workspace-client.ts";

export const EVAL_DIMENSIONS: ReadonlyArray<{ id: EvalDimensionDTO; label: string }> = [
  { id: "adequacy", label: "语义充分性" },
  { id: "terminology", label: "术语" },
  { id: "hard_constraints", label: "硬约束" },
  { id: "function_strategy_fit", label: "功能与策略适配" },
  { id: "genre_voice_fit", label: "类型与角色语气" },
  { id: "styleguide_application", label: "风格指南应用" },
  { id: "fluency_idiomaticity", label: "流畅与地道" },
  { id: "overediting_risk", label: "过度编辑风险" },
  { id: "delivery_readiness", label: "交付就绪度" },
];

export function completedEvalRuns(
  runs: Iterable<PrivateEvalRunDTO>,
  evalSetId: string,
  projectId: string,
  taskId: string,
): { single: PrivateEvalRunDTO[]; team: PrivateEvalRunDTO[] } {
  const eligible = Array.from(runs).filter((run) => (
    run.evalSetId === evalSetId
    && run.projectId === projectId
    && run.taskId === taskId
    && run.status === "completed"
  ));
  return {
    single: eligible.filter((run) => run.mode === "single_agent"),
    team: eligible.filter((run) => run.mode === "team_workflow"),
  };
}

export function buildBlindReviewInput(
  runs: Iterable<PrivateEvalRunDTO>,
  projectId: string,
  taskId: string,
  input: {
    evalSetId: string;
    singleRunId: string;
    teamRunId: string;
    seed: string;
    sampleSize?: number;
  },
): PrivateEvalBlindReviewInputDTO {
  const { single, team } = completedEvalRuns(runs, input.evalSetId, projectId, taskId);
  if (!single.some((run) => run.runId === input.singleRunId)) {
    throw new Error("请选择当前 Eval Task 中已完成的 Single Agent Run。");
  }
  if (!team.some((run) => run.runId === input.teamRunId)) {
    throw new Error("请选择当前 Eval Task 中已完成的 Team Run。");
  }
  if (input.singleRunId === input.teamRunId) {
    throw new Error("盲评需要两个不同的 Run。");
  }
  const seed = input.seed.trim();
  if (!seed) throw new Error("盲评 seed 不能为空。");
  const sampleSize = input.sampleSize;
  if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize < 1)) {
    throw new Error("抽样句段数必须是正整数。");
  }
  return {
    runIds: [input.singleRunId, input.teamRunId],
    seed,
    ...(sampleSize === undefined ? {} : { sampleSize }),
  };
}

export function parseIssueCategories(value: string): string[] {
  return Array.from(new Set(value.split(/[，,]/u).map((part) => part.trim()).filter(Boolean)));
}
