import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskDecision,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { BatchSegment, SegmentTagContract } from "../data/workspace-client.ts";

export interface SegmentTaskItems {
  activities?: readonly TaskActivity[];
  artifacts?: readonly TaskArtifact[];
  decisions?: readonly TaskDecision[];
}

export type InspectorSelection =
  | { kind: "artifact"; artifact: TaskArtifact }
  | { kind: "activity"; activity: TaskActivity }
  | { kind: "decision"; decision: TaskDecision }
  | {
      kind: "segment";
      segment: BatchSegment;
      tagView?: SegmentTagContract;
      taskItems?: SegmentTaskItems;
    };

export type InspectorLinkedSelection = Exclude<InspectorSelection, { kind: "segment" }>;

export interface InspectorFollowUpTarget {
  threadId: string;
  displayName: string;
  roleLabel: string;
  source: "artifact" | "activity";
  artifactId?: string;
  activityId?: string;
}

export function activityDetailBody(activity: TaskActivity): string | null {
  if (activity.type === "message" || activity.type === "final_response") return null;
  return activity.body?.trim() || null;
}

export function followUpTargetForSelection(
  selection: InspectorSelection,
  threads: readonly TaskAgentThread[],
): InspectorFollowUpTarget | null {
  if (selection.kind !== "artifact" && selection.kind !== "activity") return null;
  const threadId = selection.kind === "artifact"
    ? selection.artifact.provenance.agentThreadId
    : selection.activity.agentThreadId;
  const thread = threads.find((candidate) => candidate.id === threadId);
  if (!thread || thread.identity.kind !== "specialist" || !thread.canReceiveUserMessage) return null;
  return {
    threadId,
    displayName: thread.identity.displayName,
    roleLabel: thread.identity.roleLabel,
    source: selection.kind,
    ...(selection.kind === "artifact"
      ? { artifactId: selection.artifact.id }
      : { activityId: selection.activity.id }),
  };
}

export function segmentLinkedItems(
  segmentId: string,
  taskItems: SegmentTaskItems | undefined,
): InspectorLinkedSelection[] {
  if (!taskItems) return [];
  const items: Array<{ createdAt: string; selection: InspectorLinkedSelection }> = [
    ...(taskItems.activities ?? [])
      .filter((activity) => activity.refs.segmentIds?.includes(segmentId))
      .map((activity) => ({ createdAt: activity.createdAt, selection: { kind: "activity" as const, activity } })),
    ...(taskItems.artifacts ?? [])
      .filter((artifact) => artifact.scope.kind === "project" && artifact.scope.segmentIds.includes(segmentId))
      .map((artifact) => ({ createdAt: artifact.createdAt, selection: { kind: "artifact" as const, artifact } })),
    ...(taskItems.decisions ?? [])
      .filter((decision) => decision.scope.kind === "project" && decision.scope.segmentIds.includes(segmentId))
      .map((decision) => ({ createdAt: decision.createdAt, selection: { kind: "decision" as const, decision } })),
  ];
  return items
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((item) => item.selection);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function artifactEvidence(artifact: TaskArtifact): {
  refs: string[];
  content: unknown;
} {
  const refs = new Set(artifact.provenance.evidenceRefs);
  for (const value of stringArray(artifact.content.evidenceRefs)) refs.add(value);
  return {
    refs: [...refs],
    content: artifact.content.evidence,
  };
}

const fieldLabels: Record<string, string> = {
  constraints: "约束",
  contextManifestRef: "上下文清单",
  data: "数据",
  error: "错误",
  evalSetId: "评估集",
  evidence: "证据",
  evidenceRefs: "证据引用",
  executionManifest: "执行清单",
  findings: "发现",
  function: "功能",
  kind: "类型",
  manifest: "清单",
  message: "说明",
  mode: "模式",
  notes: "备注",
  promptManifest: "提示清单",
  proposedTarget: "建议译文",
  report: "报告",
  segmentId: "句段",
  source: "源文",
  status: "状态",
  target: "译文",
  text: "内容",
  type: "类型",
};

export function inspectorFieldLabel(key: string): string {
  const known = fieldLabels[key];
  if (known) return known;
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced ? spaced[0]!.toLocaleUpperCase() + spaced.slice(1) : key;
}
