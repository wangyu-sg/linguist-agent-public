import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleWorkingCopy, prepareWorkingCopy, readWorkingJson, workingCopyPath } from './working-copy'
import { createWorkingCopyTool } from './working-copy-tool'

test('文件审校复用格式适配器，保留完整原文、显式裁定与旧版本', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-copy-'))
  try {
    const source = 'key,source,target\na,开始,Begin\nb,取消,Cancel\nc,继续,Continue\n'
    writeFileSync(join(root, 'input.csv'), source)
    const input = { workspaceRoot: root, sourcePath: 'input.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const baseline = await prepareWorkingCopy(input)
    expect(baseline.segments).toHaveLength(3)
    const [a, b] = baseline.segments
    const decisions = {
      sourceSha256: baseline.sourceSha256,
      groups: [{ segmentIds: [a!.id], decision: 'corrected' }, { segmentIds: [b!.id], decision: 'unchanged' }],
      edits: [{ segmentId: a!.id, baseRevision: a!.revision, target: 'Start' }],
      unresolved: ['第三句尚未裁定'],
    }
    const result = assembleWorkingCopy(baseline, decisions)
    expect(result.coverage).toEqual({ total: 3, unchanged: 1, corrected: 1, blocked: 0, undecided: 1 })
    expect(result.segments[1]).toBe(baseline.segments[1])
    expect(result.segments[0]!.revision).toBe(a!.revision)
    expect(result.submitted).toBe(false)
    expect(readFileSync(join(root, 'input.csv'), 'utf8')).toBe(source)
    expect(() => assembleWorkingCopy(baseline, { ...decisions, groups: [] })).toThrow('corrected')
    expect(() => assembleWorkingCopy(baseline, { ...decisions, sourceSha256: '0'.repeat(64) })).toThrow('原文件已变化')
    expect(() => assembleWorkingCopy(baseline, { ...decisions, edits: [{ ...decisions.edits[0], baseRevision: a!.revision + 1 }] })).toThrow('版本不一致')
    expect(() => assembleWorkingCopy({ ...baseline, segments: [{ ...a!, locked: true }, ...baseline.segments.slice(1)] }, decisions)).toThrow('LOCKED')
    const tool = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'session-1' }))
    const prepared = await tool.execute('prepare', { operation: 'prepare', sourcePath: 'input.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }, undefined)
    expect(prepared.details.path).not.toContain(root)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify(decisions))
    const assembled = await tool.execute('assemble', { operation: 'assemble', sourcePath: 'input.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US', decisionsPath: 'decisions.json' }, undefined)
    expect(assembled.details.coverage?.undecided).toBe(1)
    expect(JSON.parse(readFileSync(join(root, assembled.details.path), 'utf8')).changes).toHaveLength(1)
    symlinkSync(tmpdir(), join(root, 'outside'))
    expect(() => workingCopyPath(root, '../')).toThrow('工作文件不在')
    expect(() => workingCopyPath(root, 'outside')).toThrow('工作文件不在')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('T→E→P 接续保留前阶段译文，阶段差异与累计差异各有真实范围', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-tep-'))
  try {
    const source = 'key,source,target\na,开始,Begin\nb,取消,Cancel\n'
    writeFileSync(join(root, 'input.csv'), source)
    const params = { sourcePath: 'input.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const baseline = await prepareWorkingCopy({ ...params, workspaceRoot: root })
    const [a, b] = baseline.segments
    const tool = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'T' }))
    const decisionsPath = 'decisions.json'
    writeFileSync(join(root, decisionsPath), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      groups: [{ segmentIds: [a!.id], decision: 'corrected' }, { segmentIds: [b!.id], decision: 'unchanged' }],
      edits: [{ segmentId: a!.id, baseRevision: a!.revision, target: 'Start' }], unresolved: [],
    }))
    const t = await tool.execute('T', { ...params, operation: 'assemble', decisionsPath }, undefined)
    const priorT = readWorkingJson(root, t.details.path)
    expect(priorT.sha256).toBe(t.details.artifactSha256)
    await expect(prepareWorkingCopy({ ...params, workspaceRoot: root, sourcePath: t.details.path })).rejects.toThrow('previousResultPath')

    writeFileSync(join(root, decisionsPath), JSON.stringify({
      sourceSha256: baseline.sourceSha256, previousResultSha256: t.details.artifactSha256,
      groups: [{ segmentIds: [a!.id], decision: 'unchanged' }, { segmentIds: [b!.id], decision: 'corrected' }],
      edits: [{ segmentId: b!.id, baseRevision: b!.revision, target: 'Cancel.' }], unresolved: [],
    }))
    const eTool = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'E' }))
    const e = await eTool.execute('E', { ...params, operation: 'assemble', decisionsPath, previousResultPath: t.details.path }, undefined)
    expect(e.details.path).not.toBe(t.details.path)
    expect(readWorkingJson(root, t.details.path).sha256).toBe(priorT.sha256)
    const eResult = JSON.parse(readFileSync(join(root, e.details.path), 'utf8'))
    expect(eResult.segments.map((item: { target: string }) => item.target)).toEqual(['Start', 'Cancel.'])
    expect(eResult.changes).toHaveLength(1)
    expect(eResult.changes[0].previousTarget).toBe('Cancel')
    expect(eResult.finalChanges).toHaveLength(2)
    expect(eResult.coverage).toEqual({ total: 2, unchanged: 1, corrected: 1, blocked: 0, undecided: 0 })

    const pDecisions = {
      sourceSha256: baseline.sourceSha256, previousResultSha256: e.details.artifactSha256,
      groups: [{ segmentIds: [a!.id, b!.id], decision: 'unchanged' }], edits: [], unresolved: [],
    }
    writeFileSync(join(root, decisionsPath), JSON.stringify(pDecisions))
    const p = await eTool.execute('P', { ...params, operation: 'assemble', decisionsPath, previousResultPath: e.details.path }, undefined)
    const pResult = JSON.parse(readFileSync(join(root, p.details.path), 'utf8'))
    expect(pResult.segments.map((item: { target: string }) => item.target)).toEqual(['Start', 'Cancel.'])
    expect(pResult.changes).toHaveLength(0)
    expect(pResult.finalChanges).toHaveLength(2)
    expect(pResult.submitted).toBe(false)
    expect(readFileSync(join(root, 'input.csv'), 'utf8')).toBe(source)

    // 前一工作稿已经变化时，原文件 SHA 和 revision 不变也不能套用旧判断。
    await expect(tool.execute('stale', { ...params, operation: 'assemble', decisionsPath, previousResultPath: p.details.path }, undefined)).rejects.toThrow('审读快照')
    const tampered = structuredClone(pResult)
    tampered.segments[0].source = '另一个原文'
    expect(() => assembleWorkingCopy(baseline, { ...pDecisions, previousResultSha256: 'f'.repeat(64) }, undefined,
      { value: tampered, sha256: 'f'.repeat(64) })).toThrow('源文、身份')
    const forgedMeta = structuredClone(pResult)
    forgedMeta.segments[0].context = { speaker: 'forged' }
    const restored = assembleWorkingCopy(baseline, { ...pDecisions, previousResultSha256: 'f'.repeat(64) }, undefined,
      { value: forgedMeta, sha256: 'f'.repeat(64) })
    expect(restored.segments[0]!.context).toEqual(baseline.segments[0]!.context)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
