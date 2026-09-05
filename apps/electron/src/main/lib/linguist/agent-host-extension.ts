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
  prepareSessionFile?: (sessionFile: string) => void
  executionScope: AgentExecutionScope
  promptOverlay: string
  turnContext?: Readonly<LinguistTurnContextV1>
  turnContextBlock: string
  composeTools: (input: ComposeHostToolsInput) => ComposedHostTools
}

export function resolveLinguistAgentHostExtension(input: {
  session: AgentSessionMeta
  turnContext: unknown
  onProjectMutation?: (event: LinguistProjectMutationEvent) => void
}): LinguistAgentHostExtension {
  const profile = resolveAgentProfile(input.session)
  const turnContext = validateLinguistTurnContextForAgentTurn(
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

  return {
    ...(profile.kind === 'linguist' ? { prepareSessionFile: normalizeLegacyCatSessionFile } : {}),
    executionScope: resolveAgentExecutionScope(input.session),
    promptOverlay: promptBuild?.prompt ?? '',
    ...(turnContext === undefined ? {} : { turnContext }),
    turnContextBlock: turnContext === undefined ? '' : buildLinguistTurnContextBlock(turnContext),
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
          turnContext,
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
