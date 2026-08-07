/**
 * Tag profile（PB-097）：项目级自定义 tag 族登记，纯数据 + normalize。
 *
 * 与 glossaryPolicy 一样，`tagProfile` 是 LinguistProject
 * 可选字段，PB-097 之前写入的 project.json 无此键；读取经
 * `normalizeTagProfile` 回落（缺失/非法 → undefined = 仅内置族），
 * 规范化值绝不主动回写。
 *
 * 族条目让项目可以登记内置族覆盖不到的游戏/富文本标记（如
 * `[Grm:Qty S="" P="" Idx=""]`、`[time(...)]`），登记后进入与内置族
 * 同一条确定性校验管线（见 tag-families.ts）。不做 LLM 自动发现
 * （discovery 归后续批次），项目族一律手工登记。
 */

export type LinguistTagFamilyClass = 'paired' | 'singleton'
export type LinguistTagCandidateKind = 'standalone' | 'opening' | 'closing'
export type LinguistTagCandidateStatus = 'candidate' | 'ignored'

export interface LinguistTagFamily {
  /** 稳定 id，签名与配对键的一部分（如 `grm-qty`）。 */
  id: string
  /** 正则源串；安全 lint 在编译期执行（tag-families.ts），非法/危险正则在扫描时静默跳过。 */
  pattern: string
  /** 正则 flags（缺省 g；扫描时强制带 g）。 */
  flags?: string
  /**
   * paired：开/闭成对标签，参与配平与嵌套校验。pattern 中命名捕获组
   * `(?<close>…)` 命中的匹配视为闭标签，其余视为开标签。
   * singleton：单发标签/占位符，只做多重集守恒。
   */
  class: LinguistTagFamilyClass
  /** 分开登记开/闭规则时覆盖默认的命名捕获组判定。 */
  kind?: LinguistTagCandidateKind
  /** paired 族的配对锚 id（缺省 = 自身 id）；开闭分属两条规则时用同一锚归并。 */
  pairWith?: string
  /** 激活条件：仅当段 targetLocale 命中（全串或 base 相等，忽略大小写）时生效；缺省全 locale 生效。 */
  targetLocales?: readonly string[]
  /** 人类可读备注（为何登记此族），不参与匹配。 */
  note?: string
  /** false 表示用户禁用，不进入硬保护扫描。 */
  enabled?: boolean
}

export interface LinguistTagProfileCandidate {
  id: string
  name: string
  pattern: string
  kind: LinguistTagCandidateKind
  pairKey?: string
  evidenceExampleIds: readonly string[]
  confidence: number
  explanation: string
  status: LinguistTagCandidateStatus
}

export interface LinguistTagProfile {
  families: readonly LinguistTagFamily[]
  candidates?: readonly LinguistTagProfileCandidate[]
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function normalizeFamily(value: unknown): LinguistTagFamily | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const id = nonEmptyString(raw.id)
  const pattern = nonEmptyString(raw.pattern)
  const familyClass = raw.class === 'paired' || raw.class === 'singleton' ? raw.class : undefined
  // id/pattern/class 是族条目的最小合法形态，缺任一整条丢弃（绝不抛错）。
  if (id === undefined || pattern === undefined || familyClass === undefined) return undefined
  const targetLocales = Array.isArray(raw.targetLocales)
    ? raw.targetLocales.filter((locale): locale is string => nonEmptyString(locale) !== undefined)
    : undefined
  return {
    id,
    pattern,
    class: familyClass,
    ...(raw.kind === 'standalone' || raw.kind === 'opening' || raw.kind === 'closing'
      ? { kind: raw.kind }
      : {}),
    ...(nonEmptyString(raw.flags) !== undefined ? { flags: raw.flags as string } : {}),
    ...(nonEmptyString(raw.pairWith) !== undefined ? { pairWith: raw.pairWith as string } : {}),
    ...(targetLocales !== undefined && targetLocales.length > 0 ? { targetLocales } : {}),
    ...(nonEmptyString(raw.note) !== undefined ? { note: raw.note as string } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
  }
}

function normalizeCandidate(value: unknown): LinguistTagProfileCandidate | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const id = nonEmptyString(raw.id)
  const name = nonEmptyString(raw.name)
  const pattern = nonEmptyString(raw.pattern)
  const explanation = nonEmptyString(raw.explanation)
  const kind = raw.kind === 'standalone' || raw.kind === 'opening' || raw.kind === 'closing'
    ? raw.kind
    : undefined
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : undefined
  if (!id || !name || !pattern || !explanation || !kind || confidence === undefined) return undefined
  const evidenceExampleIds = Array.isArray(raw.evidenceExampleIds)
    ? raw.evidenceExampleIds.filter((entry): entry is string => nonEmptyString(entry) !== undefined)
    : []
  return {
    id,
    name,
    pattern,
    kind,
    ...(nonEmptyString(raw.pairKey) !== undefined ? { pairKey: raw.pairKey as string } : {}),
    evidenceExampleIds,
    confidence,
    explanation,
    status: raw.status === 'ignored' ? 'ignored' : 'candidate',
  }
}

/**
 * 缺失/非法一律回落 undefined（= 仅内置族），绝不抛错；
 * 非法族条目整条丢弃，合法条目保留登记顺序（扫描时项目族按此顺序压内置族）。
 */
export function normalizeTagProfile(value: unknown): LinguistTagProfile | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const raw = record.families
  if (!Array.isArray(raw)) return undefined
  const families = raw
    .map((entry) => normalizeFamily(entry))
    .filter((family): family is LinguistTagFamily => family !== undefined)
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .map((entry) => normalizeCandidate(entry))
        .filter((candidate): candidate is LinguistTagProfileCandidate => candidate !== undefined)
    : []
  return families.length > 0 || candidates.length > 0
    ? { families, ...(candidates.length > 0 ? { candidates } : {}) }
    : undefined
}
