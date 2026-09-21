import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { bindImportedSegments } from '@linguist/cat-formats'
import { deriveAssetId, runDeterministicHardRules, type Segment, type LinguistTagProfile } from '@linguist/cat-core'
import { LINGUIST_IMPORT_MAX_BYTES } from '@proma/shared'
import { isPathWithin } from '../terminal-agent-policy'
import { createDefaultCatFormatRegistry } from './format-registry'
import { readPickedFileWithinLimit } from './project-file-intake'

const WorkingDecisionSchema = z.object({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  previousResultSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  groups: z.array(z.object({
    segmentIds: z.array(z.string()).min(1),
    decision: z.enum(['unchanged', 'corrected', 'blocked']),
  }).strict()),
  edits: z.array(z.object({
    segmentId: z.string(),
    baseRevision: z.number().int().nonnegative(),
    target: z.string(),
  }).strict()),
  unresolved: z.array(z.string()),
}).strict()

const PreviousWorkingCopySchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal('linguist-working-copy'),
  sourcePath: z.string(),
  sourceSha256: z.string(),
  sourceLocale: z.string(),
  targetLocale: z.string(),
  formatId: z.string(),
  segments: z.array(z.object({
    id: z.string(), source: z.string(), target: z.string(), revision: z.number().int(),
    sourceLocale: z.string(), targetLocale: z.string(), locked: z.boolean(), key: z.string().optional(),
  })),
})

export interface LinguistWorkingCopy {
  schemaVersion: 1
  artifactKind: 'linguist-working-copy'
  sourcePath: string
  sourceSha256: string
  sourceLocale: string
  targetLocale: string
  formatId: string
  segments: Segment[]
  warnings: { code: string; message: string; segmentKey?: string }[]
}

export interface WorkingJsonSnapshot {
  value: unknown
  sha256: string
}

/** 仅受管工作区内的真实普通文件；工具结果不暴露绝对路径。 */
export function workingCopyPath(workspaceRoot: string, file: string): string {
  const root = realpathSync(workspaceRoot)
  if (isAbsolute(file)) throw new Error('请使用工作区文件的相对路径')
  const path = realpathSync(resolve(root, file))
  if (!isPathWithin(path, root)) throw new Error('工作文件不在当前工作区内')
  return path
}

export async function prepareWorkingCopy(input: {
  workspaceRoot: string
  sourcePath: string
  sourceLocale: string
  targetLocale: string
}): Promise<LinguistWorkingCopy> {
  const path = workingCopyPath(input.workspaceRoot, input.sourcePath)
  const { bytes, filename } = await readPickedFileWithinLimit(path, LINGUIST_IMPORT_MAX_BYTES)
  const adapter = await createDefaultCatFormatRegistry().detectBest(bytes, filename)
  if (adapter.id === 'json_i18n') {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/u, ''))
    if (typeof value === 'object' && value !== null && 'artifactKind' in value
      && value.artifactKind === 'linguist-working-copy') throw new Error('这是工作稿；sourcePath 使用原文件，并通过 previousResultPath 接续当前译文')
  }
  const imported = await adapter.import({ bytes, filename, sourceLocale: input.sourceLocale, targetLocale: input.targetLocale })
  return {
    schemaVersion: 1,
    artifactKind: 'linguist-working-copy',
    sourcePath: relative(realpathSync(input.workspaceRoot), path),
    sourceSha256: imported.asset.sourceSha256,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    formatId: adapter.id,
    segments: bindImportedSegments(imported.segments, deriveAssetId('working-copy', imported.asset.sourceSha256, basename(path))),
    warnings: imported.warnings,
  }
}

/** 候选只合并到派生工作稿；完整覆盖必须来自明确裁定，不取差异表补集。 */
export function assembleWorkingCopy(
  baseline: LinguistWorkingCopy,
  decisions: unknown,
  tagProfile?: LinguistTagProfile,
  previousResult?: WorkingJsonSnapshot,
) {
  const input = WorkingDecisionSchema.parse(decisions)
  if (input.sourceSha256 !== baseline.sourceSha256) throw new Error('原文件已变化；保留旧候选，重新判断受影响内容')
  if (input.previousResultSha256 !== previousResult?.sha256) throw new Error('工作稿版本与本阶段审读快照不一致；请只重评受影响内容')
  const current = previousResult === undefined ? baseline : resumeWorkingCopy(baseline, previousResult.value, tagProfile)
  const byId = new Map(current.segments.map(segment => [segment.id as string, segment]))
  const decisionsById = new Map<string, 'unchanged' | 'corrected' | 'blocked'>()
  for (const group of input.groups) {
    for (const id of group.segmentIds) {
      if (!byId.has(id) || decisionsById.has(id)) throw new Error(`裁定包含未知或重复句段：${id}`)
      decisionsById.set(id, group.decision)
    }
  }
  const edits = new Map<string, (typeof input.edits)[number]>()
  for (const edit of input.edits) {
    const segment = byId.get(edit.segmentId)
    if (!segment || edits.has(edit.segmentId)) throw new Error(`修订包含未知或重复句段：${edit.segmentId}`)
    if (edit.target === segment.target) throw new Error(`译文未变化，应记录 unchanged：${edit.segmentId}`)
    if (edit.baseRevision !== segment.revision) throw new Error(`修订版本不一致：${edit.segmentId}`)
    if (decisionsById.get(edit.segmentId) !== 'corrected') throw new Error(`修订缺少 corrected 裁定：${edit.segmentId}`)
    const validation = runDeterministicHardRules({ segment, proposedTarget: edit.target, ...(tagProfile ? { tagProfile } : {}) })
    if (!validation.ok) throw new Error(`结构/锁保护拒绝 ${edit.segmentId}：${validation.violations.map(v => v.code).join(', ')}`)
    edits.set(edit.segmentId, edit)
  }
  for (const [id, decision] of decisionsById) {
    if (decision === 'corrected' && !edits.has(id)) throw new Error(`corrected 缺少修订：${id}`)
  }
  const segments = current.segments.map(segment => edits.has(segment.id) ? { ...segment, target: edits.get(segment.id)!.target } : segment)
  return {
    ...baseline,
    // 文件候选不递增 CAT revision，不写 Stage，也不虚构正式提交回执。
    segments,
    ...(previousResult === undefined ? {} : { previousResultSha256: previousResult.sha256 }),
    groups: input.groups,
    changes: input.edits.map(edit => ({ ...edit, source: byId.get(edit.segmentId)!.source, previousTarget: byId.get(edit.segmentId)!.target })),
    finalChanges: segments.flatMap((segment, index) => {
      const original = baseline.segments[index]!
      return segment.target === original.target ? [] : [{ segmentId: segment.id, baseRevision: original.revision, source: original.source, previousTarget: original.target, target: segment.target }]
    }),
    unresolved: input.unresolved,
    coverage: {
      total: baseline.segments.length,
      unchanged: [...decisionsById.values()].filter(value => value === 'unchanged').length,
      corrected: edits.size,
      blocked: [...decisionsById.values()].filter(value => value === 'blocked').length,
      undecided: baseline.segments.length - decisionsById.size,
    },
    submitted: false,
    nextAction: input.unresolved.length > 0 || [...decisionsById.values()].includes('blocked') || decisionsById.size < baseline.segments.length
      ? '继续未裁定内容或必要查验；本文件不证明专业阶段完成。'
      : '核对约定的查验责任后，用正式写回工具及其真实回执继续；本文件未提交译文。',
  }
}

/** 只接续已核实的译文；标签、上下文、锁和原版本仍从原件重建。 */
function resumeWorkingCopy(baseline: LinguistWorkingCopy, value: unknown, tagProfile?: LinguistTagProfile): LinguistWorkingCopy {
  const previous = PreviousWorkingCopySchema.parse(value)
  if (previous.sourceSha256 !== baseline.sourceSha256 || previous.sourcePath !== baseline.sourcePath
    || previous.sourceLocale !== baseline.sourceLocale || previous.targetLocale !== baseline.targetLocale
    || previous.formatId !== baseline.formatId) throw new Error('上阶段工作稿不属于当前原文件与语言对')
  const byId = new Map(previous.segments.map(segment => [segment.id, segment]))
  if (byId.size !== previous.segments.length || byId.size !== baseline.segments.length) throw new Error('上阶段工作稿句段身份缺失或重复')
  const segments = baseline.segments.map(original => {
    const prior = byId.get(original.id)
    if (!prior || prior.source !== original.source || prior.revision !== original.revision
      || prior.locked !== original.locked || prior.sourceLocale !== original.sourceLocale
      || prior.targetLocale !== original.targetLocale || prior.key !== original.key) throw new Error('上阶段工作稿的源文、身份、原版本或锁不一致')
    if (prior.target !== original.target) {
      const validation = runDeterministicHardRules({ segment: original, proposedTarget: prior.target, ...(tagProfile ? { tagProfile } : {}) })
      if (!validation.ok) throw new Error(`上阶段工作稿结构/锁保护拒绝 ${original.id}：${validation.violations.map(item => item.code).join(', ')}`)
    }
    return { ...original, target: prior.target }
  })
  return { ...baseline, segments }
}

export function readWorkingJson(workspaceRoot: string, path: string): WorkingJsonSnapshot {
  const file = workingCopyPath(workspaceRoot, path)
  const stat = statSync(file)
  if (!stat.isFile() || stat.size > LINGUIST_IMPORT_MAX_BYTES) throw new Error('工作文件不是受支持大小的普通 JSON 文件')
  const bytes = readFileSync(file)
  if (bytes.byteLength > LINGUIST_IMPORT_MAX_BYTES) throw new Error('工作文件超过大小上限')
  return { value: JSON.parse(bytes.toString('utf8')) as unknown, sha256: createHash('sha256').update(bytes).digest('hex') }
}
