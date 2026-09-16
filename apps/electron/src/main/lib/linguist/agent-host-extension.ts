import { isDeepStrictEqual } from 'node:util'
import type { AutomationLinguistContext } from '@proma/shared'
import { createHash, randomUUID } from 'node:crypto'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  resolveAgentProfile,
  serializeLinguistTurnContextV1,
  type AgentSessionMeta,
  type LinguistProjectMutationEvent,
  type LinguistTurnContextV1,
} from '@proma/shared'
import { composeAgentTools, hashAgentToolComposition } from './agent-tool-composition'
import { resolveAgentExecutionScope, type AgentExecutionScope } from './agent-execution-scope'
import { buildLinguistPrompt } from './linguist-prompt-builder'
import { normalizeLegacyCatSessionFile } from './legacy-cat-session'
import { createEvidenceSubmissionObserver } from './evidence-submission'
import { getAgentSessionMeta } from '../agent-session-manager'
import { getLinguistProjectService } from './project-service'
import { recordLinguistRuntimeObservation } from './runtime-diagnostics'
import { resolveLinguistSessionCatTools } from './session-cat-tools'
import {
  buildLinguistTurnContextBlock,
  validateLinguistTurnContextForAgentTurn,
} from './turn-context-validator'

interface ComposeHostToolsInput {
  baseTools: ToolDefinition[]
  mcpServerNames: string[]
  modelProvider: string
  getModelId: () => string
}

interface ComposedHostTools {
  tools: ToolDefinition[]
  baseToolCount: number
  overlayToolCount: number
}

export interface LinguistAgentHostExtension {
  prepareSessionFile?: (sessionFile: string) => Promise<void>
  providerObserver?: ReturnType<typeof createEvidenceSubmissionObserver>
  executionScope: AgentExecutionScope
  promptOverlay: string
  turnContext?: Readonly<LinguistTurnContextV1>
  turnContextBlock: string
  composeTools: (input: ComposeHostToolsInput) => ComposedHostTools
}

export function resolveLinguistAgentHostExtension(input: {
  session: AgentSessionMeta
  turnContext: unknown
  automationContext?: AutomationLinguistContext
  onProjectMutation?: (event: LinguistProjectMutationEvent) => void
}): LinguistAgentHostExtension {
  const profile = resolveAgentProfile(input.session)
  if (input.automationContext && (
    input.turnContext !== undefined
    || input.automationContext.projectId !== input.session.linguistProjectId
    || input.automationContext.role !== input.session.linguistRole
    || !isDeepStrictEqual(input.automationContext, input.session.automationLinguistContext)
  )) throw new Error('定时任务范围与创建时冻结的会话绑定不一致')
  const turnContext = input.automationContext ? undefined : validateLinguistTurnContextForAgentTurn(
    input.turnContext,
    input.session,
    getLinguistProjectService,
  )?.context
  const promptBuild = profile.kind === 'linguist'
    ? buildLinguistPrompt(
      input.session as AgentSessionMeta & { linguistProjectId: string },
      getLinguistProjectService,
      { renderer: 'markdown' },
    )
    : undefined
  const turnContextSnapshot = turnContext === undefined
    ? undefined
    : serializeLinguistTurnContextV1(turnContext)
  const turnContextHash = turnContextSnapshot === undefined
    ? undefined
    : createHash('sha256').update(turnContextSnapshot).digest('hex')
  const runId = profile.kind === 'linguist'
    ? `agent-turn:${input.session.id}:${randomUUID()}`
    : undefined
  const providerObserver = profile.kind === 'linguist'
    ? createEvidenceSubmissionObserver(receipt => {
      const current = getAgentSessionMeta(input.session.id)
      if (current === undefined || current.linguistProjectId !== input.session.linguistProjectId) throw new Error('CAT Evidence session binding changed')
      const db = getLinguistProjectService().openProject(current.linguistProjectId!)
      if (db.readOnly) throw new Error('CAT Evidence project is read-only')
      db.stageEvidence.recordReceipt(receipt)
    }, () => console.warn('[Linguist] 参考提交回执未保存，覆盖仍未验证；后续只重试记账。'))
    : undefined

  return {
    ...(profile.kind === 'linguist' ? { prepareSessionFile: normalizeLegacyCatSessionFile } : {}),
    providerObserver,
    executionScope: resolveAgentExecutionScope(input.session),
    promptOverlay: promptBuild?.prompt ?? '',
    ...(turnContext === undefined ? {} : { turnContext }),
    turnContextBlock: input.automationContext
      ? `<linguist_automation_context trust="project-data">\n${JSON.stringify(input.automationContext)}\n</linguist_automation_context>\n这是任务创建时捕获的范围，不是当前 UI 选择。scope 缺失只表示项目上下文，不能据此处理全项目。`
      : turnContext === undefined ? '' : buildLinguistTurnContextBlock(turnContext),
    composeTools: ({ baseTools, mcpServerNames, modelProvider, getModelId }) => {
      let toolsetHash: string | undefined
      const catTools = profile.kind === 'linguist'
        ? resolveLinguistSessionCatTools(
          input.session,
          getLinguistProjectService,
          input.onProjectMutation,
          (toolCallId) => ({
            sessionId: input.session.id,
            runId: runId!,
            toolCallId,
            modelProvider,
            modelId: getModelId(),
            runtime: 'pi',
            linguistPromptVersion: promptBuild!.status.promptVersion,
            promptHash: promptBuild!.status.promptHash,
            ...(turnContextSnapshot === undefined
              ? {}
              : {
                  turnContextVersion: turnContext!.schemaVersion,
                  turnContextSnapshot,
                  turnContextHash: turnContextHash!,
                }),
            ...(toolsetHash === undefined ? {} : { toolsetHash }),
          }),
          providerObserver?.prepare,
          input.automationContext,
        ) as unknown as ToolDefinition[]
        : []
      const composition = composeAgentTools(profile, baseTools, () => catTools)
      const tools = [...composition.mergedTools]
      if (profile.kind === 'linguist') {
        toolsetHash = hashAgentToolComposition({
          toolNames: tools.map((tool) => tool.name),
          mcpServerNames,
        })
        recordLinguistRuntimeObservation(input.session.id, {
          runtime: 'pi',
          baseToolCount: composition.baseTools.length,
          overlayToolCount: catTools.length,
          observedAt: new Date().toISOString(),
        })
      }
      return {
        tools,
        baseToolCount: composition.baseTools.length,
        overlayToolCount: composition.overlayTools.length,
      }
    },
  }
}
