import {
  createTaskWorkspace,
  type TaskDecision,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";
import { TaskDecisionExecutionError } from "./task_decision_executor.js";

type InteractionAction = "submit" | "elaborate" | "cancel";

interface InteractionAnswer {
  decisionId: string;
  selectedOptionIds?: string[];
  responseText?: string;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAnswers(value: unknown): InteractionAnswer[] {
  if (!Array.isArray(value)) throw new TaskDecisionExecutionError(400, "answers must be an array.");
  const answers = value.map((entry, index): InteractionAnswer => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TaskDecisionExecutionError(400, `answers[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const decisionId = cleanString(row.decisionId);
    if (!decisionId) throw new TaskDecisionExecutionError(400, `answers[${index}].decisionId is required.`);
    if (row.selectedOptionIds !== undefined && (!Array.isArray(row.selectedOptionIds) || !row.selectedOptionIds.every((id) => typeof id === "string" && id.trim()))) {
      throw new TaskDecisionExecutionError(400, `answers[${index}].selectedOptionIds must be an array of non-empty strings.`);
    }
    const selectedOptionIds = Array.isArray(row.selectedOptionIds)
      ? row.selectedOptionIds.map((id) => (id as string).trim())
      : undefined;
    if (selectedOptionIds && new Set(selectedOptionIds).size !== selectedOptionIds.length) {
      throw new TaskDecisionExecutionError(400, `answers[${index}].selectedOptionIds must be unique.`);
    }
    return { decisionId, selectedOptionIds, responseText: cleanString(row.responseText) };
  });
  if (new Set(answers.map((answer) => answer.decisionId)).size !== answers.length) {
    throw new TaskDecisionExecutionError(400, "answers must not repeat a decisionId.");
  }
  return answers;
}

function selectedAnswer(decision: TaskDecision, answer: InteractionAnswer, action: InteractionAction): {
  selectedOptionIds: string[];
  responseText: string | null;
} {
  let selectedOptionIds = answer.selectedOptionIds ?? [];
  const responseText = answer.responseText ?? null;
  if (action === "elaborate") {
    if (!responseText) throw new TaskDecisionExecutionError(400, "elaborate requires responseText.");
    if (!decision.options.some((option) => option.id === "freeform")) {
      throw new TaskDecisionExecutionError(400, `Decision ${decision.id} does not offer a freeform answer.`);
    }
    if (selectedOptionIds.length && (selectedOptionIds.length !== 1 || selectedOptionIds[0] !== "freeform")) {
      throw new TaskDecisionExecutionError(400, "elaborate can only select the freeform option.");
    }
    selectedOptionIds = ["freeform"];
  } else if (decision.selectionMode === "freeform") {
    if (!responseText) throw new TaskDecisionExecutionError(400, `Decision ${decision.id} requires responseText.`);
    if (selectedOptionIds.length && (selectedOptionIds.length !== 1 || selectedOptionIds[0] !== "freeform")) {
      throw new TaskDecisionExecutionError(400, `Decision ${decision.id} can only select the freeform option.`);
    }
    selectedOptionIds = ["freeform"];
  } else if (decision.selectionMode === "single") {
    if (selectedOptionIds.length !== 1) throw new TaskDecisionExecutionError(400, `Decision ${decision.id} requires one selected option.`);
  } else if (decision.selectionMode === "multiple") {
    if (!selectedOptionIds.length) throw new TaskDecisionExecutionError(400, `Decision ${decision.id} requires at least one selected option.`);
  } else {
    throw new TaskDecisionExecutionError(409, `Decision ${decision.id} is not a native interaction question.`);
  }
  const optionIds = new Set(decision.options.map((option) => option.id));
  const unknown = selectedOptionIds.find((optionId) => !optionIds.has(optionId));
  if (unknown) throw new TaskDecisionExecutionError(400, `Decision option ${unknown} is not available.`);
  if (selectedOptionIds.includes("freeform") && !responseText) {
    throw new TaskDecisionExecutionError(400, `Decision ${decision.id} requires responseText for the freeform option.`);
  }
  return { selectedOptionIds, responseText };
}

function decisionActivity(
  decision: TaskDecision,
  now: string,
  outcome: "answered" | "cancelled",
  title: string,
  body: string | null,
): TaskRunEventDraft {
  return {
    type: "activity_append",
    agentThreadId: decision.requestedByThreadId,
    activity: {
      id: `${decision.id}.${outcome}`,
      taskId: decision.taskId,
      runId: decision.runId,
      agentThreadId: decision.requestedByThreadId,
      seq: 0,
      type: "decision",
      status: "done",
      actor: { kind: "human", id: "user", displayName: "User", agentThreadId: decision.requestedByThreadId },
      title,
      body,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [decision.id] },
      createdAt: now,
      updatedAt: now,
    },
  };
}

export async function executeTaskDecisionInteraction(input: {
  repoRoot: string;
  projectId: string;
  taskId: string;
  interactionId: string;
  body: unknown;
}) {
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    throw new TaskDecisionExecutionError(400, "Interaction body must be an object.");
  }
  const body = input.body as Record<string, unknown>;
  const action = body.action;
  if (action !== "submit" && action !== "elaborate" && action !== "cancel") {
    throw new TaskDecisionExecutionError(400, "action must be submit, elaborate, or cancel.");
  }
  const interactionId = input.interactionId.trim();
  if (!interactionId) throw new TaskDecisionExecutionError(400, "interactionId is required.");
  const reason = cleanString(body.reason) ?? null;
  const workspace = createTaskWorkspace(input.repoRoot);
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  const interaction = snapshot.decisions
    .filter((decision) => decision.interactionId === interactionId)
    .sort((left, right) => (left.questionIndex ?? 0) - (right.questionIndex ?? 0));
  if (!interaction.length) throw new TaskDecisionExecutionError(404, `Decision interaction ${interactionId} was not found.`);
  if (interaction.some((decision) => decision.kind !== "answer" || decision.artifactId
    || decision.options.some((option) => option.action !== "answer"))) {
    throw new TaskDecisionExecutionError(409, `Decision interaction ${interactionId} cannot execute canonical apply, waiver, approval, or delivery actions.`);
  }
  const runIds = new Set(interaction.map((decision) => decision.runId));
  if (runIds.size !== 1) throw new TaskDecisionExecutionError(409, `Decision interaction ${interactionId} spans more than one Run.`);
  const runId = interaction[0]!.runId;
  const run = snapshot.runs.find((candidate) => candidate.id === runId);
  if (action !== "cancel" && (!run || ["stopping", "stopped", "failed", "stale", "complete"].includes(run.status))) {
    throw new TaskDecisionExecutionError(409, `Decision interaction ${interactionId} is no longer active.`);
  }

  const answers = action === "cancel" ? [] : parseAnswers(body.answers);
  if (action === "submit" && !answers.length) throw new TaskDecisionExecutionError(400, "submit requires at least one answer.");
  if (action === "elaborate" && answers.length !== 1) throw new TaskDecisionExecutionError(400, "elaborate requires exactly one answer.");
  const byId = new Map(interaction.map((decision) => [decision.id, decision]));
  const now = new Date().toISOString();
  const expectedRequiredDecisionIds: string[] = [];
  const events: TaskRunEventDraft[] = [];

  if (action === "cancel") {
    const required = interaction.filter((decision) => decision.status === "required");
    if (!required.length) throw new TaskDecisionExecutionError(409, `Decision interaction ${interactionId} is already complete.`);
    for (const decision of required) {
      expectedRequiredDecisionIds.push(decision.id);
      events.push({
        type: "decision_upsert",
        agentThreadId: decision.requestedByThreadId,
        decision: { ...decision, status: "cancelled", reason, decidedAt: now },
      });
      events.push(decisionActivity(decision, now, "cancelled", "Question cancelled", reason));
    }
  } else {
    for (const answer of answers) {
      const decision = byId.get(answer.decisionId);
      if (!decision) throw new TaskDecisionExecutionError(409, `Decision ${answer.decisionId} is outside interaction ${interactionId}.`);
      if (decision.status !== "required") {
        throw new TaskDecisionExecutionError(409, `Decision ${decision.id} is already ${decision.status}.`);
      }
      const selected = selectedAnswer(decision, answer, action);
      const selectedOptionId = selected.selectedOptionIds[0]!;
      const labels = selected.selectedOptionIds.map((id) => decision.options.find((option) => option.id === id)!.label);
      expectedRequiredDecisionIds.push(decision.id);
      events.push({
        type: "decision_upsert",
        agentThreadId: decision.requestedByThreadId,
        decision: {
          ...decision,
          status: "recorded",
          selectedOptionId,
          selectedOptionIds: selected.selectedOptionIds,
          responseText: selected.responseText,
          reason,
          decidedAt: now,
        },
      });
      events.push(decisionActivity(decision, now, "answered", labels.join(", "), selected.responseText ?? reason));
    }
  }

  const updated = await workspace.appendGenerated({
    projectId: input.projectId,
    taskId: input.taskId,
    runId,
    expectedRequiredDecisionIds,
    events,
  });
  const pendingDecisionIds = updated.decisions
    .filter((decision) => decision.interactionId === interactionId && decision.status === "required")
    .sort((left, right) => (left.questionIndex ?? 0) - (right.questionIndex ?? 0))
    .map((decision) => decision.id);
  return { interactionId, pendingDecisionIds, snapshot: updated };
}
