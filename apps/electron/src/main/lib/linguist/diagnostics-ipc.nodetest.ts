import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AgentSessionMeta } from '@proma/shared'
import {
  createLinguistDiagnosticsIpc,
  type LinguistDiagnosticsSavePicker,
} from './diagnostics-ipc'
import { recordLinguistRuntimeObservation } from './runtime-diagnostics'
import { INPUT, makeService, makeTempDir, readFixture } from './test/service-testkit'

const session = (
  projectId: string,
  overrides: Partial<AgentSessionMeta> = {},
): AgentSessionMeta => ({
  id: 'session-customer-secret',
  title: 'CUSTOMER_TITLE_SENTINEL',
  linguistProjectId: projectId,
  linguistProjectName: 'CUSTOMER_NAME_SENTINEL',
  linguistRole: 'reviewer',
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

test('LA-OBS-001: status exposes Prompt source and one refresh re-probes the same seam', async () => {
  const service = makeService()
  try {
    const project = service.createProject({ ...INPUT, name: '诊断项目' })
    const meta = session(project.id)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const segmentId = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!.id
    const jobId = 'job:diagnostics:1'
    db.runs.createJob({
      jobId,
      runId: 'run:diagnostics:1',
      sessionId: meta.id,
      strategy: 'balanced',
      segmentIds: [segmentId],
      provenance: {
        schemaVersion: 1,
        runtime: 'node-worker_threads',
        promptVersion: 'diagnostics-test-v1',
      },
    })
    db.runs.transitionJob(jobId, { sessionId: meta.id }, 'running')
    db.runs.ackEvents('renderer-workbench-v1', 1)
    let rolesRoot = join(makeTempDir(), 'missing')
    recordLinguistRuntimeObservation(meta.id, {
      runtime: 'pi',
      baseToolCount: 17,
      overlayToolCount: 8,
      observedAt: '2026-07-29T01:02:03.000Z',
    })
    const ipc = createLinguistDiagnosticsIpc({
      getService: () => service,
      getSession: (id) => id === meta.id ? meta : undefined,
      getConfigDir: () => join(makeTempDir(), '.linguist-agent-dev'),
      getRolesRoot: () => rolesRoot,
      isDevelopment: true,
    })

    const degraded = await ipc.getStatus({ projectId: project.id, sessionId: meta.id })
    assert.equal(degraded.ok, true)
    if (!degraded.ok) return
    assert.equal(degraded.data.prompt.roleSource, 'fallback')
    assert.equal(degraded.data.prompt.role, 'reviewer')
    assert.equal(degraded.data.prompt.projectDigestStatus, 'complete')
    assert.equal(degraded.data.prompt.projectDigestTruncated, false)
    assert.equal(degraded.data.prompt.charCount > 0, true)
    assert.equal(degraded.data.dev?.tools.base, 17)
    assert.equal(degraded.data.dev?.tools.overlay, 8)
    assert.equal(degraded.data.dev?.profile?.kind, 'linguist')
    assert.equal(degraded.data.dev?.profile?.role, 'reviewer')
    assert.match(degraded.data.dev?.sessionCwd ?? '', /agent-workspaces/)
    assert.equal(
      (degraded.data.dev?.metrics.promptProbeLatencyMs ?? -1) >= 0,
      true,
    )
    assert.equal(
      (degraded.data.dev?.metrics.promptProbeResultBytes ?? 0) > 0,
      true,
    )
    assert.deepEqual(degraded.data.dev?.metrics.qa, {
      openErrors: 0,
      openWarnings: 0,
      pendingProposals: 0,
    })
    assert.deepEqual(degraded.data.dev?.metrics.eventGap, {
      latestSequence: 2,
      acknowledgedSequence: 1,
      pending: 1,
    })
    assert.deepEqual(degraded.data.dev?.trace.availableFields, [
      'projectId',
      'sessionId',
      'runId',
      'jobId',
      'toolCallId',
      'eventSequence',
    ])
    assert.deepEqual(degraded.data.dev?.trace.unavailableFields, ['stepId'])
    assert.equal(degraded.data.dev?.trace.runId, 'run:diagnostics:1')
    assert.equal(degraded.data.dev?.trace.jobId, jobId)
    assert.equal(
      degraded.data.dev?.trace.toolCallId,
      `job:${jobId}`,
    )
    assert.deepEqual(degraded.data.dev?.recentJob, {
      status: 'running',
      jobId,
      runId: 'run:diagnostics:1',
      runtime: 'node-worker_threads',
      cursor: 0,
      total: 1,
    })
    assert.deepEqual(degraded.data.dev?.worker, {
      mode: 'node-worker_threads',
      status: 'running',
    })

    rolesRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', '..', '..',
      'resources', 'linguist-roles',
    )
    const retried = await ipc.getStatus({
      projectId: project.id,
      sessionId: meta.id,
      retry: true,
    })
    assert.equal(retried.ok, true)
    if (retried.ok) {
      assert.equal(retried.data.prompt.roleSource, 'bundle')
      assert.equal(retried.data.prompt.role, 'reviewer')
    }
  } finally {
    service.closeAll()
  }
})

test('LA-OBS-001: production status keeps Prompt health visible but omits Dev Diagnostics', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const meta = session(project.id)
    const ipc = createLinguistDiagnosticsIpc({
      getService: () => service,
      getSession: () => meta,
      getConfigDir: () => '/private/customer/path',
      isDevelopment: false,
    })

    const result = await ipc.getStatus({ projectId: project.id, sessionId: meta.id })

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(typeof result.data.prompt.promptHash, 'string')
      assert.equal(result.data.dev, undefined)
      assert.equal(JSON.stringify(result.data).includes('/private/customer/path'), false)
    }
  } finally {
    service.closeAll()
  }
})

test('LA-OBS-001: diagnostic preview is allowlisted and excludes customer text, names, ids, paths and secrets', async () => {
  const service = makeService()
  try {
    const project = service.createProject({ ...INPUT, name: 'CUSTOMER_PROJECT_SENTINEL' })
    const meta = session(project.id, {
      attachedDirectories: ['/private/CUSTOMER_PATH_SENTINEL'],
      attachedFiles: ['/private/API_KEY_sk-secret-sentinel.txt'],
    })
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const segmentId = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!.id
    db.runs.createJob({
      jobId: 'job:CUSTOMER_JOB_SENTINEL',
      runId: 'run:CUSTOMER_RUN_SENTINEL',
      sessionId: meta.id,
      strategy: 'balanced',
      segmentIds: [segmentId],
      provenance: {
        schemaVersion: 1,
        runtime: 'node-worker_threads',
      },
    })
    const ipc = createLinguistDiagnosticsIpc({
      getService: () => service,
      getSession: () => meta,
      getConfigDir: () => '/private/CUSTOMER_PATH_SENTINEL',
      isDevelopment: true,
    })

    const result = await ipc.previewBundle({ projectId: project.id, sessionId: meta.id })

    assert.equal(result.ok, true)
    if (!result.ok) return
    const serialized = JSON.stringify(result.data.bundle)
    for (const secret of [
      'CUSTOMER_PROJECT_SENTINEL',
      'CUSTOMER_TITLE_SENTINEL',
      'CUSTOMER_NAME_SENTINEL',
      'CUSTOMER_PATH_SENTINEL',
      'sk-secret-sentinel',
      'CUSTOMER_JOB_SENTINEL',
      'CUSTOMER_RUN_SENTINEL',
      project.id,
      meta.id,
    ]) {
      assert.equal(serialized.includes(secret), false, `诊断预览泄漏 ${secret}`)
    }
    assert.equal(result.data.bundle.privacy.redacted, true)
    assert.equal(result.data.bundle.privacy.autoUpload, false)
    assert.equal(result.data.bundle.privacy.contains.absolutePaths, false)
    assert.equal(result.data.bundle.privacy.contains.contentSnippets, false)
    assert.equal(result.data.bundle.privacy.contains.filenames, false)
    assert.equal(result.data.bundle.privacy.contains.hiddenReasoning, false)
  } finally {
    service.closeAll()
  }
})

test('LA-OBS-001: explicit bundle export uses exclusive verified write and never uploads', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const meta = session(project.id)
    const destination = join(makeTempDir(), 'linguist-diagnostics.json')
    const picker: LinguistDiagnosticsSavePicker = async () => ({
      canceled: false,
      filePath: destination,
    })
    const ipc = createLinguistDiagnosticsIpc({
      getService: () => service,
      getSession: () => meta,
      getConfigDir: () => makeTempDir(),
      isDevelopment: true,
    })

    const saved = await ipc.exportBundle(
      { projectId: project.id, sessionId: meta.id },
      picker,
    )

    assert.equal(saved.ok, true)
    if (!saved.ok || saved.data.cancelled) return
    assert.equal(existsSync(destination), true)
    assert.equal(saved.data.sizeBytes, readFileSync(destination).byteLength)
    assert.match(saved.data.sha256, /^[0-9a-f]{64}$/)
    assert.equal(JSON.parse(readFileSync(destination, 'utf8')).privacy.autoUpload, false)

    writeFileSync(destination, 'ORIGINAL')
    const blocked = await ipc.exportBundle(
      { projectId: project.id, sessionId: meta.id },
      picker,
    )
    assert.equal(blocked.ok, false)
    assert.equal(readFileSync(destination, 'utf8'), 'ORIGINAL')
  } finally {
    service.closeAll()
  }
})
