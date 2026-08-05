import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type {
  AgentSessionMeta,
  LinguistDiagnosticBundle,
  LinguistDiagnosticBundleExportResult,
  LinguistDiagnosticBundlePreviewResult,
  LinguistDiagnosticsQaMetrics,
  LinguistDiagnosticsRequest,
  LinguistDiagnosticsStatus,
  LinguistIpcResult,
} from '@proma/shared'
import { resolveAgentProfile } from '@proma/shared'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import {
  buildLinguistProjectAssetsPromptWithStatus,
  getLinguistPromptCacheSize,
} from './project-assets-prompt'
import { getDefaultLinguistSkillsRoot } from './project-skill'
import { computeLinguistProjectRevision } from './project-revision'
import {
  getLinguistPromptRetryObservation,
  getLinguistRuntimeObservation,
  recordLinguistPromptRetry,
} from './runtime-diagnostics'
import {
  resolveLinguistSessionCatTools,
} from './session-cat-tools'
import { resolveLinguistSessionWorkspacePath } from './session-workspace'
import { SecureExportError, writeBytesVerified } from './secure-export'
import type { LinguistProjectService } from './project-service'

export interface LinguistDiagnosticsSavePickerOptions {
  title: string
  defaultPath: string
}

export interface LinguistDiagnosticsSavePickerResult {
  canceled: boolean
  filePath?: string
}

export type LinguistDiagnosticsSavePicker = (
  options: LinguistDiagnosticsSavePickerOptions,
) => Promise<LinguistDiagnosticsSavePickerResult>

interface DiagnosticsDependencies {
  getService: () => LinguistProjectService
  getSession: (sessionId: string) => AgentSessionMeta | undefined
  getConfigDir: () => string
  isDevelopment: boolean
  getSkillsRoot?: () => string | undefined
}

interface CollectedDiagnostics {
  status: LinguistDiagnosticsStatus & {
    dev: NonNullable<LinguistDiagnosticsStatus['dev']>
  }
  projectId: string
  sessionId?: string
}

function readRequest(input: unknown): LinguistDiagnosticsRequest {
  const record = assertRecord(input)
  const projectId = readProjectId(record)
  const sessionId = record.sessionId
  if (
    sessionId !== undefined
    && (
      typeof sessionId !== 'string'
      || sessionId.trim() === ''
      || sessionId.length > 200
    )
  ) {
    invalid('sessionId 必须是非空稳定 ID')
  }
  if (record.retry !== undefined && typeof record.retry !== 'boolean') {
    invalid('retry 必须是 boolean')
  }
  return {
    projectId,
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
    ...(record.retry === true ? { retry: true } : {}),
  }
}

function collectQaMetrics(service: LinguistProjectService, projectId: string): LinguistDiagnosticsQaMetrics {
  const db = service.openProject(projectId)
  let openErrors = 0
  let openWarnings = 0
  let pendingProposals = 0
  for (const asset of db.assets.listByProject()) {
    pendingProposals += db.proposals.countPendingByAsset(asset.id)
    openErrors += db.qaFindings.count({
      assetId: asset.id,
      status: 'open',
      severity: 'L0',
    }) + db.qaFindings.count({
      assetId: asset.id,
      status: 'open',
      severity: 'L1',
    })
    for (const severity of ['L2', 'L3', 'L4'] as const) {
      openWarnings += db.qaFindings.count({
        assetId: asset.id,
        status: 'open',
        severity,
      })
    }
  }
  return { openErrors, openWarnings, pendingProposals }
}

function collectDiagnostics(
  deps: DiagnosticsDependencies,
  request: LinguistDiagnosticsRequest,
): CollectedDiagnostics {
  const service = deps.getService()
  const project = service.getProject(request.projectId)
  const db = service.openProject(request.projectId)
  const session = request.sessionId === undefined
    ? undefined
    : deps.getSession(request.sessionId)
  if (
    request.sessionId !== undefined
    && (
      session === undefined
      || session.linguistProjectId !== request.projectId
    )
  ) {
    invalid('sessionId 不属于当前 Linguist 项目')
  }

  const promptSession = {
    linguistProjectId: request.projectId,
    ...(session?.linguistSessionRole === undefined
      ? {}
      : { linguistSessionRole: session.linguistSessionRole }),
  }
  const promptStartedAt = performance.now()
  const prompt = buildLinguistProjectAssetsPromptWithStatus(
    promptSession,
    deps.getService,
    {
      skillsRoot: deps.getSkillsRoot?.() ?? getDefaultLinguistSkillsRoot(),
    },
  )
  const promptProbeLatencyMs = Math.max(0, performance.now() - promptStartedAt)
  const retryScope = `${request.projectId}:${request.sessionId ?? 'project-default'}`
  if (request.retry === true) {
    recordLinguistPromptRetry(retryScope, !prompt.status.degraded)
  }
  const retry = getLinguistPromptRetryObservation(retryScope)
  const observation = getLinguistRuntimeObservation(session?.id)
  const profile = session === undefined ? undefined : resolveAgentProfile(session)
  const overlay = session === undefined
    ? 0
    : resolveLinguistSessionCatTools(session, deps.getService).length
  const latestJob = db.runs.getLatestJob()
  const latestEvent = db.runs.getLatestEvent()
  const eventSequence = latestEvent?.sequence ?? 0
  const eventAck = db.runs.getEventAck('renderer-workbench-v1')
  const runId = latestEvent?.runId ?? latestJob?.runId
  const jobId = latestEvent?.jobId
    ?? (latestEvent === undefined ? latestJob?.jobId : undefined)
  const toolCallId = latestEvent?.toolCallId
  const availableFields: NonNullable<
    LinguistDiagnosticsStatus['dev']
  >['trace']['availableFields'] = [
    'projectId',
    ...(session === undefined ? [] : ['sessionId' as const]),
    ...(runId === undefined ? [] : ['runId' as const]),
    ...(jobId === undefined ? [] : ['jobId' as const]),
    ...(toolCallId === undefined ? [] : ['toolCallId' as const]),
    'eventSequence',
  ]
  const unavailableFields: NonNullable<
    LinguistDiagnosticsStatus['dev']
  >['trace']['unavailableFields'] = [
    ...(runId === undefined ? ['runId' as const] : []),
    ...(jobId === undefined ? ['jobId' as const] : []),
    'stepId',
    ...(toolCallId === undefined ? ['toolCallId' as const] : []),
  ]
  const projectRevision = computeLinguistProjectRevision(project, db)
  const serviceStatus = service.getStatus()

  return {
    projectId: request.projectId,
    ...(session === undefined ? {} : { sessionId: session.id }),
    status: {
      projectRevision,
      prompt: {
        ...prompt.status,
        fallbackLayers: [...prompt.status.fallbackLayers],
      },
      dev: {
        ...(profile?.kind === 'linguist'
          ? {
            profile: {
              kind: 'linguist' as const,
              role: profile.role,
              strategy: profile.strategy,
            },
          }
          : {}),
        ...(session === undefined
          ? {}
          : {
            agentRuntime: observation?.runtime ?? session.agentRuntime ?? 'claude',
            sessionCwd: resolveLinguistSessionWorkspacePath(
              deps.getConfigDir(),
              request.projectId,
              session.id,
            ),
          }),
        tools: {
          base: observation?.baseToolCount ?? null,
          overlay: observation?.overlayToolCount ?? overlay,
          ...(observation === undefined ? {} : { observedAt: observation.observedAt }),
        },
        trace: {
          projectId: request.projectId,
          ...(session === undefined ? {} : { sessionId: session.id }),
          ...(runId === undefined ? {} : { runId }),
          ...(jobId === undefined ? {} : { jobId }),
          ...(toolCallId === undefined ? {} : { toolCallId }),
          eventSequence,
          availableFields,
          unavailableFields,
        },
        metrics: {
          promptProbeLatencyMs,
          promptProbeResultBytes: Buffer.byteLength(prompt.prompt, 'utf8'),
          qa: collectQaMetrics(service, request.projectId),
          retry: {
            attempts: retry?.attempts ?? 0,
            ...(retry === undefined
              ? {}
              : {
                lastAttemptAt: retry.lastAttemptAt,
                lastRecovered: retry.lastRecovered,
              }),
          },
          eventGap: {
            latestSequence: eventSequence,
            acknowledgedSequence: eventAck?.sequence ?? 0,
            pending: Math.max(0, eventSequence - (eventAck?.sequence ?? 0)),
          },
        },
        promptCacheSize: getLinguistPromptCacheSize(),
        recentJob: latestJob === undefined
          ? { status: 'not_available' as const }
          : {
              status: latestJob.status,
              jobId: latestJob.jobId,
              runId: latestJob.runId,
              runtime: latestJob.provenance.runtime,
              cursor: latestJob.cursor,
              total: latestJob.segmentIds.length,
            },
        worker: {
          mode: latestJob?.provenance.runtime === 'node-worker_threads'
            ? 'node-worker_threads'
            : 'not_observed',
          status: serviceStatus.degraded
            ? 'degraded'
            : latestJob?.status ?? 'idle',
        },
      },
    },
  }
}

function fingerprint(
  kind: 'project' | 'session' | 'run' | 'job' | 'tool-call',
  value: string,
): string {
  return createHash('sha256').update(`linguist-diagnostics:${kind}:${value}`).digest('hex')
}

function buildBundle(collected: CollectedDiagnostics): LinguistDiagnosticBundle {
  const { status } = collected
  const trace = status.dev.trace
  const availableTraceFields: LinguistDiagnosticBundle[
    'correlation'
  ]['availableTraceFields'] = [
    'projectFingerprint',
    ...(collected.sessionId === undefined ? [] : ['sessionFingerprint' as const]),
    ...(trace.runId === undefined ? [] : ['runFingerprint' as const]),
    ...(trace.jobId === undefined ? [] : ['jobFingerprint' as const]),
    ...(trace.toolCallId === undefined ? [] : ['toolCallFingerprint' as const]),
    'eventSequence',
  ]
  const unavailableTraceFields: LinguistDiagnosticBundle[
    'correlation'
  ]['unavailableTraceFields'] = [
    ...(trace.runId === undefined ? ['runFingerprint' as const] : []),
    ...(trace.jobId === undefined ? ['jobFingerprint' as const] : []),
    'stepId',
    ...(trace.toolCallId === undefined ? ['toolCallFingerprint' as const] : []),
  ]
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    privacy: {
      redacted: true,
      autoUpload: false,
      contains: {
        filenames: false,
        contentSnippets: false,
        customerText: false,
        absolutePaths: false,
        secrets: false,
        hiddenReasoning: false,
      },
    },
    correlation: {
      projectFingerprint: fingerprint('project', collected.projectId),
      ...(collected.sessionId === undefined
        ? {}
        : { sessionFingerprint: fingerprint('session', collected.sessionId) }),
      ...(trace.runId === undefined
        ? {}
        : { runFingerprint: fingerprint('run', trace.runId) }),
      ...(trace.jobId === undefined
        ? {}
        : { jobFingerprint: fingerprint('job', trace.jobId) }),
      ...(trace.toolCallId === undefined
        ? {}
        : { toolCallFingerprint: fingerprint('tool-call', trace.toolCallId) }),
      eventSequence: status.dev.trace.eventSequence,
      availableTraceFields,
      unavailableTraceFields,
    },
    projectRevision: status.projectRevision,
    prompt: status.prompt,
    metrics: status.dev.metrics,
    runtime: {
      agentRuntime: status.dev.agentRuntime,
      baseToolCount: status.dev.tools.base,
      overlayToolCount: status.dev.tools.overlay,
      promptCacheSize: status.dev.promptCacheSize,
      workerMode: status.dev.worker.mode,
      workerStatus: status.dev.worker.status,
      recentJobStatus: status.dev.recentJob.status,
    },
  }
}

export function createLinguistDiagnosticsIpc(deps: DiagnosticsDependencies) {
  return {
    getStatus(input: unknown): Promise<LinguistIpcResult<LinguistDiagnosticsStatus>> {
      return wrap(async () => {
        const collected = collectDiagnostics(deps, readRequest(input))
        return deps.isDevelopment
          ? collected.status
          : {
            projectRevision: collected.status.projectRevision,
            prompt: collected.status.prompt,
          }
      })
    },

    previewBundle(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistDiagnosticBundlePreviewResult>> {
      return wrap(async () => {
        const bundle = buildBundle(collectDiagnostics(deps, readRequest(input)))
        return {
          bundle,
          sizeBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
        }
      })
    },

    exportBundle(
      input: unknown,
      pickDestination: LinguistDiagnosticsSavePicker,
    ): Promise<LinguistIpcResult<LinguistDiagnosticBundleExportResult>> {
      return wrap(async () => {
        const request = readRequest(input)
        const service = deps.getService()
        const bundle = buildBundle(collectDiagnostics(deps, request))
        const picked = await pickDestination({
          title: '导出脱敏诊断包',
          defaultPath: `linguist-diagnostics-${bundle.createdAt.replace(/[:.]/g, '-')}.json`,
        })
        if (picked.canceled || picked.filePath === undefined) {
          return { cancelled: true }
        }
        const bytes = new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`)
        try {
          const verified = writeBytesVerified({
            managedRoot: service.rootDir,
            destinationPath: picked.filePath,
            bytes,
          })
          return {
            cancelled: false,
            filename: basename(picked.filePath),
            ...verified,
          }
        } catch (error) {
          if (error instanceof SecureExportError) invalid(error.message)
          throw error
        }
      })
    },
  }
}
