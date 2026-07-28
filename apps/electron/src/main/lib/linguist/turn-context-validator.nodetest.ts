import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFixture, makeService, INPUT } from './test/service-testkit'
import {
  buildLinguistTurnContextBlock,
  validateLinguistTurnContextForAgentTurn,
  validateLinguistTurnContextForSession,
} from './turn-context-validator'

const CAPTURED_AT = '2026-07-27T08:00:00.000Z'

test('LF-060: bound session accepts a full context owned by its project', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ limit: 1 })[0]!
    const finding = service.runQa(project.id)[0]!

    const result = validateLinguistTurnContextForSession(
      {
        schemaVersion: 1,
        projectId: project.id,
        assetId: imported.assetId,
        activeSegmentId: segment.id,
        selectedSegmentIds: [segment.id],
        activeQaFindingId: finding.id,
        capturedAt: CAPTURED_AT,
        uiRevision: 4,
      },
      { linguistProjectId: project.id },
      service,
    )

    assert.equal(result.context.projectId, project.id)
    assert.equal(result.context.activeSegmentId, segment.id)
    assert.equal(result.selectionTruncated, false)
  } finally {
    service.closeAll()
  }
})

test('LF-060: project-only context is valid but unbound/mismatched session fails closed', () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const context = {
      schemaVersion: 1,
      projectId: project.id,
      selectedSegmentIds: [],
      capturedAt: CAPTURED_AT,
      uiRevision: 0,
    } as const

    assert.doesNotThrow(() =>
      validateLinguistTurnContextForSession(
        context,
        { linguistProjectId: project.id },
        service,
      ),
    )
    assert.throws(
      () => validateLinguistTurnContextForSession(context, undefined, service),
      /session is not bound/,
    )

    const other = service.createProject({ ...INPUT, name: 'Other' })
    assert.throws(
      () => validateLinguistTurnContextForSession(
        { ...context, projectId: other.id },
        { linguistProjectId: project.id },
        service,
      ),
      /does not match session binding/,
    )
  } finally {
    service.closeAll()
  }
})

test('LF-060: asset, segment and QA finding must exist inside the bound project', async () => {
  const service = makeService()
  try {
    const projectA = service.createProject(INPUT)
    const projectB = service.createProject({ ...INPUT, name: 'Other' })
    const importedB = await service.importAsset(projectB.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const dbB = service.openProject(projectB.id)
    const segmentB = dbB.segments.query({ limit: 1 })[0]!
    const findingB = service.runQa(projectB.id)[0]!
    const base = {
      schemaVersion: 1,
      projectId: projectA.id,
      selectedSegmentIds: [],
      capturedAt: CAPTURED_AT,
      uiRevision: 1,
    } as const
    const session = { linguistProjectId: projectA.id }

    assert.throws(
      () => validateLinguistTurnContextForSession(
        { ...base, assetId: importedB.assetId },
        session,
        service,
      ),
      /asset does not belong/,
    )
    assert.throws(
      () => validateLinguistTurnContextForSession(
        { ...base, selectedSegmentIds: [segmentB.id] },
        session,
        service,
      ),
      /segment does not belong/,
    )
    assert.throws(
      () => validateLinguistTurnContextForSession(
        { ...base, activeQaFindingId: findingB.id },
        session,
        service,
      ),
      /QA finding does not belong/,
    )
  } finally {
    service.closeAll()
  }
})

test('LF-062: bound Agent turn requires context while ordinary Agent rejects forged context', () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const context = {
      schemaVersion: 1,
      projectId: project.id,
      selectedSegmentIds: [],
      capturedAt: CAPTURED_AT,
      uiRevision: 0,
    } as const

    assert.throws(
      () => validateLinguistTurnContextForAgentTurn(
        undefined,
        { linguistProjectId: project.id },
        () => service,
      ),
      /requires a context snapshot/,
    )
    assert.throws(
      () => validateLinguistTurnContextForAgentTurn(
        context,
        { linguistProjectId: undefined },
        () => service,
      ),
      /not bound/,
    )
    assert.equal(
      validateLinguistTurnContextForAgentTurn(
        undefined,
        { linguistProjectId: undefined },
        () => service,
      ),
      undefined,
    )
  } finally {
    service.closeAll()
  }
})

test('LF-062: validated context becomes a host-owned structured block without customer text', () => {
  const context = {
    schemaVersion: 1,
    projectId: 'prj-0123456789abcdef',
    selectedSegmentIds: ['seg-0123456789abcdef'],
    capturedAt: CAPTURED_AT,
    uiRevision: 2,
  } as const

  const block = buildLinguistTurnContextBlock(context)

  assert.match(block, /^<linguist_turn_context schema_version="1">/)
  assert.match(block, /"projectId":"prj-0123456789abcdef"/)
  assert.doesNotMatch(block, /sourceText|targetText|\/Users\//)
})
