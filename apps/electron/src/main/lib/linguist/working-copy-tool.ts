import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LinguistTagProfile } from '@linguist/cat-core'
import { writeJsonFileAtomic } from '../safe-file'
import { isPathWithin } from '../terminal-agent-policy'
import { assembleWorkingCopy, prepareWorkingCopy, readWorkingJson } from './working-copy'

const parameters = Type.Object({
  operation: Type.Union([Type.Literal('prepare'), Type.Literal('assemble')]),
  sourcePath: Type.String({ description: 'Original source file relative to this project workspace-files root; original remains untouched. Do not pass a generated working result as the original source.' }),
  sourceLocale: Type.String({ minLength: 2 }),
  targetLocale: Type.String({ minLength: 2 }),
  previousResultPath: Type.Optional(Type.String({ description: 'For assemble only: previous complete bilingual working result to continue T→E→P. It must belong to the same original sourcePath. Only validated Target is reused; original source/IDs/locks/metadata remain authoritative.' })),
  decisionsPath: Type.Optional(Type.String({ description: 'For assemble: relative JSON with sourceSha256, groups[{segmentIds,decision:unchanged|corrected|blocked}], edits[{segmentId,baseRevision,target}], unresolved:string[]. When continuing previousResultPath, include previousResultSha256 from that artifactSha256 snapshot. Groups/edits describe this stage; unchanged preserves the current working Target. No omitted ID is considered reviewed.' })),
})

export function createWorkingCopyTool(resolveContext: () => { workspaceRoot: string; sessionId: string; tagProfile?: LinguistTagProfile }) {
  return {
    name: 'linguist_working_copy',
    label: '本地化工作副本',
    description: 'Prepare complete bilingual JSON through installed format adapters without importing into CAT. Read that file in coherent groups for full language judgment. Assemble explicitly reviewed groups and edits into one complete working result plus differences; reuse the original source SHA and baseRevision. Original files, CAT stages and external jobs are never changed. Output is a private JSON working artifact, not a native delivery export. Reuse existing artifacts; do not prepare again for each group. Use normal workspace file tools to maintain decisions, then assemble at a useful result boundary.',
    parameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error('操作已停止')
      if (params.operation === 'assemble' && !params.decisionsPath) throw new Error('assemble 需要 decisionsPath')
      if (params.operation === 'prepare' && params.previousResultPath) throw new Error('工作稿接续使用 assemble 和 previousResultPath，sourcePath 仍是原文件')
      const context = resolveContext()
      const baseline = await prepareWorkingCopy({ ...params, workspaceRoot: context.workspaceRoot })
      const assembled = params.operation === 'assemble'
        ? assembleWorkingCopy(baseline, readWorkingJson(context.workspaceRoot, params.decisionsPath!).value, context.tagProfile,
          params.previousResultPath === undefined ? undefined : readWorkingJson(context.workspaceRoot, params.previousResultPath))
        : undefined
      const result = assembled ?? baseline
      if (signal?.aborted) throw new Error('操作已停止')
      // 再核当前 Session binding；开发/切项目不能把产物写到旧授权目录。
      if (resolveContext().workspaceRoot !== context.workspaceRoot) throw new Error('工作区绑定已变化')
      const root = realpathSync(context.workspaceRoot)
      const directory = join(root, '.linguist', 'working-copies', baseline.sourceSha256, context.sessionId)
      // 逐层核真实路径，在已有父级为 symlink 时先拒绝，不沿链接 mkdir。
      let parent = root
      for (const part of ['.linguist', 'working-copies', baseline.sourceSha256, context.sessionId]) {
        const child = join(parent, part)
        mkdirSync(child, { recursive: true })
        parent = realpathSync(child)
        if (!isPathWithin(parent, root)) throw new Error('工作成果目录越界')
      }
      const output = join(directory, params.operation === 'prepare' ? 'bilingual.json' : 'result.json')
      writeJsonFileAtomic(output, result, true)
      const summary = {
        path: relative(root, output),
        artifactSha256: createHash('sha256').update(JSON.stringify(result, null, 2)).digest('hex'),
        sourceSha256: baseline.sourceSha256,
        segments: baseline.segments.length,
        format: baseline.formatId,
        warnings: baseline.warnings,
        ...(assembled ? { coverage: assembled.coverage, finalChangeCount: assembled.finalChanges.length, submitted: false, nextAction: assembled.nextAction } : {}),
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary) }], details: summary }
    },
  } satisfies ToolDefinition<typeof parameters>
}
