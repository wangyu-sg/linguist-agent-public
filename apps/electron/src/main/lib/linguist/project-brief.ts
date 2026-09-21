import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'

/** 相对绑定工作区的文件根；引用仅作导航，不增加文件权限。 */
export const PROJECT_BRIEF_PATH = '.linguist/project-brief.json'
const MAX_BRIEF_BYTES = 262_144
const Text = Type.String({ minLength: 1 })
const SourceRef = Type.Object({ ref: Text, version: Text, locator: Type.Optional(Text) })
export const PROJECT_BRIEF_SCHEMA = Type.Object({
  schemaVersion: Type.Literal(1),
  projectIdentity: Type.Object({ projectId: Text, sourceLocale: Text, targetLocale: Text }),
  purpose: Text,
  audience: Type.Optional(Text),
  sources: Type.Array(Type.Object({
    ref: Text,
    version: Text,
    coverage: Type.Union([Type.Literal('complete'), Type.Literal('partial'), Type.Literal('unknown')]),
    approvalProvenance: Type.Optional(Text),
  })),
  requirements: Type.Array(Type.Object({
    id: Text,
    statement: Type.Optional(Text),
    appliesTo: Type.Record(Type.String(), Type.Array(Text)),
    strength: Type.Union([Type.Literal('required'), Type.Literal('preferred'), Type.Literal('advisory')]),
    sourceRefs: Type.Array(SourceRef, { minItems: 1 }),
  })),
  referenceRoutes: Type.Array(Type.Object({ purpose: Text, ref: Text, version: Text })),
  unresolved: Type.Array(Type.Object({
    issue: Text,
    sourceRefs: Type.Array(SourceRef),
    affects: Type.Array(Text),
  })),
})

export interface ProjectBrief extends Static<typeof PROJECT_BRIEF_SCHEMA> {}
export interface BriefSourceVersion {
  version: string
  /** 已有 projectRules 的正文只从 Store 取得，派生文件不维护副本。 */
  ruleText?: string
}
export interface ProjectBriefDigest {
  lines: string[]
  includedRuleRefs: string[]
}

function resolveWorkspaceFile(workspaceRoot: string, relativePath: string): string | undefined {
  if (isAbsolute(relativePath)) throw new Error('项目简报引用必须相对绑定工作区')
  const path = join(workspaceRoot, relativePath)
  if (!existsSync(path)) return undefined
  const root = realpathSync(workspaceRoot)
  const canonical = realpathSync(path)
  const inside = relative(root, canonical)
  if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) {
    throw new Error('项目简报或引用不在绑定工作区内')
  }
  if (!statSync(canonical).isFile()) throw new Error('项目简报或引用不是普通文件')
  return canonical
}

/** 只对明确列出的工作区原件取内容版本，不把正文送入模型，也不扫描目录。 */
export function readWorkspaceBriefSource(workspaceRoot: string, ref: string): BriefSourceVersion | undefined {
  if (!ref.startsWith('workspace-file:')) return undefined
  const path = resolveWorkspaceFile(workspaceRoot, ref.slice('workspace-file:'.length))
  if (path === undefined) return undefined
  return { version: createHash('sha256').update(readFileSync(path)).digest('hex') }
}

/** 只读当前主文件；不会从 .bak 恢复旧基线、追随外部引用或写入覆盖声明。 */
export function readProjectBrief(input: {
  workspaceRoot: string
  identity: ProjectBrief['projectIdentity']
  resolveSource: (ref: string) => BriefSourceVersion | undefined
}): ProjectBriefDigest | undefined {
  const canonical = resolveWorkspaceFile(input.workspaceRoot, PROJECT_BRIEF_PATH)
  if (canonical === undefined) return undefined
  const info = statSync(canonical)
  if (!info.isFile() || info.size > MAX_BRIEF_BYTES) throw new Error('项目简报不是受支持大小的普通文件')
  const raw = readFileSync(canonical, 'utf8')
  const value: unknown = JSON.parse(raw)
  if (!Check(PROJECT_BRIEF_SCHEMA, value)) throw new Error('项目简报格式无效')
  const identity = value.projectIdentity
  if (identity.projectId !== input.identity.projectId
    || identity.sourceLocale !== input.identity.sourceLocale
    || identity.targetLocale !== input.identity.targetLocale) throw new Error('项目简报身份或语言对不匹配')

  const sources = new Map(value.sources.map(source => [source.ref, source]))
  if (sources.size !== value.sources.length
    || new Set(value.requirements.map(item => item.id)).size !== value.requirements.length) {
    throw new Error('项目简报包含重复身份')
  }
  const current = new Map(value.sources.map(source => [source.ref, input.resolveSource(source.ref)]))
  const includedRuleRefs: string[] = []
  const requirementLines = value.requirements.map(item => {
    const states = item.sourceRefs.map(ref => {
      const source = sources.get(ref.ref)
      if (!source) throw new Error('项目简报引用了未声明的来源')
      const actual = current.get(ref.ref)
      if (source.version !== ref.version || (actual && actual.version !== ref.version)) return 'stale'
      if (!actual) return 'unknown'
      return source.coverage === 'complete' ? 'current' : source.coverage
    })
    const state = states.includes('stale') ? 'stale'
      : states.includes('unknown') ? 'unknown' : states.includes('partial') ? 'partial' : 'current'
    const ruleRefs = item.sourceRefs.filter(ref => /^(style-rule|tech-constraint):/u.test(ref.ref))
    if (ruleRefs.length > 0 && item.statement !== undefined) throw new Error('已有项目规则只引用 ID/版本，不在简报复制正文')
    if (ruleRefs.length === 0 && item.statement === undefined) throw new Error('派生要求缺少正文或项目规则引用')
    // stale 项只路由回原件；旧要求不能继续作为当前强约定进入 Prompt。
    const statement = state === 'stale' ? '来源已变化，需核对相关原件'
      : item.statement ?? ruleRefs.map(ref => current.get(ref.ref)?.ruleText ?? '规则正文未取得').join('\n')
    if (state === 'current') includedRuleRefs.push(...ruleRefs.map(ref => ref.ref))
    return `- [${state}:${item.id}] ${JSON.stringify({ statement, strength: item.strength, appliesTo: item.appliesTo, sourceRefs: item.sourceRefs })}`
  })
  const hash = createHash('sha256').update(raw).digest('hex')
  return {
    includedRuleRefs,
    lines: [
      `### 项目必要要求（派生整理，非批准/逐段完成证明）`,
      `- 简报：${PROJECT_BRIEF_PATH}；sha256=${hash}`,
      `- 用途：${JSON.stringify(value.purpose)}${value.audience ? `；受众：${JSON.stringify(value.audience)}` : ''}`,
      ...requirementLines,
      ...value.unresolved.map(item => `- [未决] ${JSON.stringify(item)}`),
      ...value.sources.map(source => `- [来源整理声明] ${JSON.stringify(source)}；当前版本=${JSON.stringify(current.get(source.ref)?.version ?? '未核实')}`),
      ...value.referenceRoutes.map(route => `- [资料路由] ${JSON.stringify(route)}`),
    ],
  }
}
