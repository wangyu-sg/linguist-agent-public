import type {
  AgentToolResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Segment } from '@linguist/cat-core'
import type { TSchema } from 'typebox'
import type {
  CatSegmentListItem,
  LinguistCatToolMutation,
  LinguistCatToolName,
  LinguistCatToolsDeps,
  ResolvedLinguistCatProject,
} from './types'

export const defineTool = <
  TParams extends TSchema,
  TDetails = unknown,
  TState = unknown,
>(
  tool: ToolDefinition<TParams, TDetails, TState>,
) => tool

/** 将 DTO 序列化；导航元数据只携带首个句段锚点，保持结果有界。 */
export function toolResult<TDetails extends object>(
  dto: TDetails,
  projectId?: string,
  segmentIds?: readonly string[],
): AgentToolResult<TDetails> {
  const details: TDetails = projectId === undefined
    ? dto
    : {
        ...dto,
        projectId,
        ...(segmentIds?.[0] !== undefined
          ? { segmentId: segmentIds[0] }
          : {}),
      }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(details, null, 2),
    }],
    details,
  }
}

export function toSegmentItem(segment: Segment): CatSegmentListItem {
  return {
    segmentId: segment.id as string,
    id: segment.id as string,
    assetId: segment.assetId as string,
    ordinal: segment.ordinal,
    originalOrdinal: segment.ordinal + 1,
    ...(segment.key !== undefined ? { key: segment.key } : {}),
    status: segment.status,
    locked: segment.locked,
    revision: segment.revision,
    source: segment.source,
    target: segment.target,
  }
}

export interface CatToolRuntime {
  deps: LinguistCatToolsDeps
  resolveBoundProject: (
    toolName: LinguistCatToolName,
    toolCallId: string,
  ) => ResolvedLinguistCatProject
  notifyMutation: (mutation: LinguistCatToolMutation) => void
  proposalRunId: (toolCallId: string) => string
}

/** 把宿主 authority 与通知策略集中在一处，具体 Tool 只实现领域行为。 */
export function createCatToolRuntime(
  deps: LinguistCatToolsDeps,
): CatToolRuntime {
  return {
    deps,
    resolveBoundProject(toolName, toolCallId) {
      const resolved = deps.resolveProject({ toolName, toolCallId })
      if (resolved instanceof Error) throw resolved
      return resolved
    },
    notifyMutation(mutation) {
      try {
        deps.onMutation?.(mutation)
      } catch {
        // 写入已经提交；通知失败不能伪装成失败并诱发模型重复写。
      }
    },
    proposalRunId(toolCallId) {
      return `run:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`
    },
  }
}
