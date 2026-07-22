import {
  applyProposalSet,
  createProposalSet,
  createTaskWorkspace,
  requireProjectTaskScope,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";

export class TaskDecisionExecutionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TaskDecisionExecutionError";
  }
}

function contentString(content: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function safeProposalSetId(taskId: string, decisionId: string): string {
  return `task-${taskId}-${decisionId}`.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 160);
}

export async function executeTaskDecision(input: {
  repoRoot: string;
  projectId: string;
  taskId: string;
  decisionId: string;
  optionId: string;
  reason: string;
}) {
  const optionId = input.optionId.trim();
  const reason = input.reason.trim();
  if (!optionId || !reason) throw new TaskDecisionExecutionError(400, "optionId and reason are required.");

  const workspace = createTaskWorkspace(input.repoRoot);
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  const decision = snapshot.decisions.find((row) => row.id === input.decisionId);
  if (!decision) throw new TaskDecisionExecutionError(404, `Decision ${input.decisionId} was not found.`);
  if (decision.interactionId) {
    throw new TaskDecisionExecutionError(
      409,
      `Decision ${input.decisionId} belongs to a grouped interaction; use the Task decision-interactions endpoint.`,
    );
  }
  if (decision.status !== "required") {
    throw new TaskDecisionExecutionError(409, `Decision ${input.decisionId} is already ${decision.status}.`);
  }
  const option = decision.options.find((row) => row.id === optionId);
  if (!option) throw new TaskDecisionExecutionError(400, `Decision option ${optionId} is not available.`);

  const artifact = decision.artifactId ? snapshot.artifacts.find((row) => row.id === decision.artifactId) : undefined;
  let applyInput: {
    batchId: string;
    segmentId: string;
    target: string;
    proposalSetId: string;
  } | undefined;
  let applyResult: Awaited<ReturnType<typeof applyProposalSet>> | undefined;
  if (option.action === "apply") {
    if (!artifact || artifact.type !== "segment_proposal") {
      throw new TaskDecisionExecutionError(409, "Apply requires a linked segment_proposal artifact.");
    }
    const artifactScope = requireProjectTaskScope(artifact.scope, "Proposal artifact");
    const taskScope = requireProjectTaskScope(snapshot.task.scope, "Proposal Task");
    const batchId = artifactScope.batchId ?? taskScope.batchId;
    const segmentId = contentString(artifact.content, "segmentId") ?? artifactScope.segmentIds[0];
    const target = contentString(artifact.content, "target", "candidateTarget", "proposedTarget");
    if (!batchId || !segmentId || !target) {
      throw new TaskDecisionExecutionError(409, "The proposal artifact is missing batch, segment, or candidate target scope.");
    }
    applyInput = {
      batchId,
      segmentId,
      target,
      proposalSetId: safeProposalSetId(input.taskId, input.decisionId),
    };
  }

  const now = new Date().toISOString();
  const artifactStatus = option.action === "reject" ? "rejected" : option.action === "request_change" ? "draft" : "accepted";
  const events: TaskRunEventDraft[] = [
    {
      type: "decision_upsert",
      agentThreadId: decision.requestedByThreadId,
      decision: { ...decision, status: "recorded", selectedOptionId: option.id, selectedOptionIds: [option.id], reason, decidedAt: now },
    },
    ...(artifact ? [{
      type: "artifact_upsert" as const,
      agentThreadId: decision.requestedByThreadId,
      artifact: { ...artifact, status: artifactStatus as "accepted" | "rejected" | "draft", version: artifact.version + 1, updatedAt: now },
    }] : []),
    {
      type: "activity_append",
      agentThreadId: decision.requestedByThreadId,
      activity: {
        id: `${decision.id}.recorded`,
        taskId: input.taskId,
        runId: decision.runId,
        agentThreadId: decision.requestedByThreadId,
        seq: Math.max(0, ...snapshot.activities.filter((row) => row.runId === decision.runId).map((row) => row.seq)) + 1,
        type: "decision",
        status: "done",
        actor: { kind: "human", id: "user", displayName: "User", agentThreadId: decision.requestedByThreadId },
        title: option.label,
        body: reason,
        tool: option.action === "apply" && artifact ? { name: "proposal_apply", effect: "write", target: requireProjectTaskScope(artifact.scope, "Proposal artifact").segmentIds[0] ?? null, outcome: "applied" } : null,
        refs: { artifactIds: artifact ? [artifact.id] : [], evidenceRefs: artifact?.provenance.evidenceRefs ?? [], decisionIds: [decision.id] },
        createdAt: now,
        updatedAt: now,
      },
    },
  ];
  return {
    snapshot: await workspace.appendGenerated({
      projectId: input.projectId,
      taskId: input.taskId,
      runId: decision.runId,
      expectedRequiredDecisionIds: [decision.id],
      beforeCommit: applyInput ? async () => {
        await createProposalSet(input.repoRoot, input.projectId, applyInput.batchId, {
          proposalSetId: applyInput.proposalSetId,
          title: `Task decision ${input.decisionId}`,
          overwrite: true,
          proposals: [{
            segmentId: applyInput.segmentId,
            proposedTarget: applyInput.target,
            reason,
            changeType: "translation",
            evidenceSources: artifact?.provenance.evidenceRefs ?? [],
            severity: "info",
          }],
        });
        applyResult = await applyProposalSet(
          input.repoRoot,
          input.projectId,
          applyInput.batchId,
          applyInput.proposalSetId,
          { confirm: true },
        );
        if (applyResult.applied.length !== 1) {
          throw new TaskDecisionExecutionError(
            409,
            applyResult.skipped[0]?.reason ?? "CAT apply gate did not apply the proposal.",
            { applyResult },
          );
        }
      } : undefined,
      events,
    }),
    applyResult,
  };
}
