import { describe, expect, test } from 'bun:test'
import type { AssetId, SegmentId } from './ids'
import { resolveQaIssueMapping } from './issue-type'
import { QA_RULE_CODES, runQa, type QaRuleCode } from './qa-core'
import type { Segment } from './segment'

function segment(index: number, patch: Partial<Segment>): Segment {
  return {
    id: `seg-${index.toString(16).padStart(16, '0')}` as SegmentId,
    assetId: 'ast-0000000000000001' as AssetId,
    ordinal: index,
    source: 'Default source',
    target: '默认译文',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'translated',
    locked: false,
    revision: 0,
    sourceHash: `hash-${index}`,
    ...patch,
  }
}

describe('PB-070 deterministic QA Core', () => {
  test('covers the complete first-version rule catalog with stable severity', () => {
    const findings = runQa([
      segment(1, { source: 'Hello {name}', target: '你好' }),
      segment(2, { source: '<b>Hello</b>', target: '<i>你好</i>' }),
      segment(3, { source: 'Translate me', target: '' }),
      segment(4, { source: 'Use Save now', target: '请使用保存并包含禁词' }),
      segment(5, { source: 'Total 12 items', target: '共 13 项' }),
      segment(6, { source: ' padded ', target: '无空格' }),
      segment(7, { source: 'Stop!', target: '停下！！' }),
      segment(8, { source: 'Do not translate this', target: 'Do not translate this' }),
      segment(9, { source: 'A reasonably long source', target: '极其极其极其极其极其极其极其极其极其极其极其极其极其长的译文' }),
      segment(10, { source: 'Repeated source', target: '译文甲' }),
      segment(11, { source: 'Repeated source', target: '译文乙' }),
    ], {
      requiredTerminology: [{ sourceTerm: 'Save', targetTerm: '储存' }],
      forbiddenTerms: [{ sourceTerm: 'Save', term: '禁词' }],
    })
    const codes = new Set(findings.map((finding) => finding.code))
    const expected: QaRuleCode[] = [
      QA_RULE_CODES.PLACEHOLDER_MISMATCH,
      QA_RULE_CODES.TAG_MISMATCH,
      QA_RULE_CODES.EMPTY_TARGET,
      QA_RULE_CODES.FORBIDDEN_TERM,
      QA_RULE_CODES.REQUIRED_TERM,
      QA_RULE_CODES.NUMBER_MISMATCH,
      QA_RULE_CODES.WHITESPACE_MISMATCH,
      QA_RULE_CODES.REPEATED_PUNCTUATION,
      QA_RULE_CODES.SOURCE_EQUALS_TARGET,
      QA_RULE_CODES.INCONSISTENT_REPEATED_SOURCE,
      QA_RULE_CODES.TARGET_LENGTH_WARNING,
    ]
    expect([...codes].sort()).toEqual(expected.sort())
    // PB-096：每条 finding 的三元组与静态映射表一致（prefer 默认策略下无覆盖）
    for (const item of findings) {
      const mapping = resolveQaIssueMapping(item.code)
      expect(item.severity).toBe(mapping.severity)
      expect(item.issueType).toBe(mapping.issueType)
      expect(item.disposition).toBe(mapping.disposition)
    }
    // 契约定级抽查：占位符/标签 L0 defect；术语硬门 L1；普通数字仅 QA。
    const byCode = new Map(findings.map((item) => [item.code, item]))
    expect(byCode.get(QA_RULE_CODES.PLACEHOLDER_MISMATCH)?.severity).toBe('L0')
    expect(byCode.get(QA_RULE_CODES.TAG_MISMATCH)?.issueType).toBe('format_tags')
    expect(byCode.get(QA_RULE_CODES.FORBIDDEN_TERM)?.issueType).toBe('terminology_hard')
    expect(byCode.get(QA_RULE_CODES.NUMBER_MISMATCH)?.issueType).toBe('numbers_units_dates')
    expect(byCode.get(QA_RULE_CODES.NUMBER_MISMATCH)?.severity).toBe('L2')
    expect(byCode.get(QA_RULE_CODES.NUMBER_MISMATCH)?.disposition).toBe('needs_review')
    // required 缺失始终是硬错误。
    const required = byCode.get(QA_RULE_CODES.REQUIRED_TERM)
    expect(required?.severity).toBe('L1')
    expect(required?.issueType).toBe('terminology_hard')
    expect(required?.disposition).toBe('defect')
  })

  test('is deterministic, skips locked rows, and does not flag healthy content', () => {
    const segments = [
      segment(1, { source: 'Score: {score}', target: '得分：{score}' }),
      segment(2, { source: '<b>Total 12</b>', target: '<b>总计 12</b>' }),
      segment(3, { source: 'Locked', target: '', locked: true }),
    ]
    expect(runQa(segments)).toEqual([])
    expect(runQa(segments)).toEqual(runQa([...segments].reverse()))
  })

  test('短重复源文只有在相邻上下文相同且译文不同时才报告一致性问题', () => {
    const findings = runQa([
      segment(1, { source: '打开门', target: 'Open the door.' }),
      segment(2, { source: '啊', target: 'Ah.' }),
      segment(3, { source: '快走', target: 'Move!' }),
      segment(4, { source: '别动', target: "Don't move." }),
      segment(5, { source: '啊', target: 'Oh.' }),
      segment(6, { source: '回家', target: 'Go home.' }),
    ])
    expect(findings.filter((finding) =>
      finding.code === QA_RULE_CODES.INCONSISTENT_REPEATED_SOURCE)).toEqual([])
  })

  test('字幕 profile 容忍省略号/强调标点与正常中英扩展，general 规则保持原强度', () => {
    const subtitleSegments = [
      segment(1, {
        source: '你到底究竟想要我怎么做啊',
        target: 'What exactly do you want me to do...?!',
        sourceLocale: 'zh-CN',
        targetLocale: 'en-US',
      }),
    ]
    const generalCodes = runQa(subtitleSegments).map((finding) => finding.code)
    expect(generalCodes).toContain(QA_RULE_CODES.REPEATED_PUNCTUATION)
    expect(generalCodes).toContain(QA_RULE_CODES.TARGET_LENGTH_WARNING)

    const subtitleCodes = runQa(subtitleSegments, { profile: 'subtitle' })
      .map((finding) => finding.code)
    expect(subtitleCodes).not.toContain(QA_RULE_CODES.REPEATED_PUNCTUATION)
    expect(subtitleCodes).not.toContain(QA_RULE_CODES.TARGET_LENGTH_WARNING)
  })
})

describe('required / forbidden 术语硬规则矩阵', () => {
  const policySegments = () => [
    segment(1, { source: 'Use Save now', target: '请使用存档' }),
    segment(2, { source: 'Use Save now', target: '请使用禁词存档' }),
  ]
  const terms = {
    requiredTerminology: [{ sourceTerm: 'Save', targetTerm: '储存' }],
    forbiddenTerms: [{ sourceTerm: 'Save', term: '禁词' }],
  }

  test('required 在 strict 下为 L1 defect', () => {
    const findings = runQa(policySegments(), { ...terms, glossaryPolicy: 'strict' })
    const required = findings.find((finding) => finding.code === QA_RULE_CODES.REQUIRED_TERM)
    expect(required?.severity).toBe('L1')
    expect(required?.issueType).toBe('terminology_hard')
    expect(required?.disposition).toBe('defect')
  })

  test('off 也不能降级 required / forbidden', () => {
    const findings = runQa(policySegments(), { ...terms, glossaryPolicy: 'off' })
    const required = findings.find((finding) => finding.code === QA_RULE_CODES.REQUIRED_TERM)
    expect(required?.severity).toBe('L1')
    expect(required?.issueType).toBe('terminology_hard')
    expect(required?.disposition).toBe('defect')
    const forbidden = findings.find((finding) => finding.code === QA_RULE_CODES.FORBIDDEN_TERM)
    expect(forbidden?.severity).toBe('L1')
    expect(forbidden?.issueType).toBe('terminology_hard')
    expect(forbidden?.disposition).toBe('defect')
  })
})

describe('PB-096 批次 1：Xbench 类确定性检查', () => {
  test('机械文本检查：边缘空白/连续空格/不配对符号/不配对引号/重复词', () => {
    const findings = runQa([
      segment(1, { source: 'Hello', target: '你好 ' }),
      segment(2, { source: 'Hello world', target: '你好  世界' }),
      segment(3, { source: 'Brackets', target: '你好（世界' }),
      segment(4, { source: 'Quote', target: '他说"你好' }),
      segment(5, { source: 'Repeated', target: 'the the answer' }),
      segment(6, { source: "Apostrophe", target: "don't do it" }),
    ])
    const codes = findings.map((finding) => finding.code)
    expect(codes).toContain(QA_RULE_CODES.EDGE_WHITESPACE)
    expect(codes).toContain(QA_RULE_CODES.DOUBLE_SPACE)
    expect(codes).toContain(QA_RULE_CODES.UNPAIRED_SYMBOL)
    expect(codes).toContain(QA_RULE_CODES.UNPAIRED_QUOTE)
    expect(codes).toContain(QA_RULE_CODES.REPEATED_WORD)
    // 词内撇号不算不配对引号
    expect(findings.filter((finding) => finding.segmentId === segment(6, {}).id
      && finding.code === QA_RULE_CODES.UNPAIRED_QUOTE)).toEqual([])
  })

  test('email/url/alphanumeric 多重集；NEWLINE 映射进 QA', () => {
    const findings = runQa([
      segment(1, { source: 'Mail a@b.com now', target: '请联系 c@d.com' }),
      segment(2, { source: 'See https://a.com/x for details', target: '详见 https://b.com/y' }),
      segment(3, { source: 'Open A120 file', target: '打开 A121 文件' }),
      segment(4, { source: 'Line one\nLine two', target: '第一行第二行内容充足' }),
      segment(5, { source: 'Token-free source text', target: '无令牌译文内容充足' }),
    ])
    const codes = new Set(findings.map((finding) => finding.code))
    expect(codes.has(QA_RULE_CODES.EMAIL_MISMATCH)).toBe(true)
    expect(codes.has(QA_RULE_CODES.URL_MISMATCH)).toBe(true)
    expect(codes.has(QA_RULE_CODES.ALPHANUMERIC_MISMATCH)).toBe(true)
    expect(codes.has(QA_RULE_CODES.NEWLINE_MISMATCH)).toBe(true)
    // 无令牌段不误报
    expect(findings.some((finding) => finding.segmentId === segment(5, {}).id
      && (finding.code === QA_RULE_CODES.EMAIL_MISMATCH
        || finding.code === QA_RULE_CODES.URL_MISMATCH
        || finding.code === QA_RULE_CODES.ALPHANUMERIC_MISMATCH))).toBe(false)
  })

  test('zh→en 泄漏：全角标点与 CJK 残留；反向 locale 不触发', () => {
    const findings = runQa([
      segment(1, { source: '你好，世界', target: 'Hello，world', sourceLocale: 'zh-CN', targetLocale: 'en' }),
      segment(2, { source: '你好世界', target: 'Hello 残留', sourceLocale: 'zh-CN', targetLocale: 'en' }),
      segment(3, { source: 'Hello world', target: '你好，世界', sourceLocale: 'en', targetLocale: 'zh-CN' }),
    ])
    const codes = findings.map((finding) => finding.code)
    expect(codes).toContain(QA_RULE_CODES.FULLWIDTH_PUNCTUATION)
    expect(codes).toContain(QA_RULE_CODES.RESIDUAL_CJK)
    expect(findings.filter((finding) => finding.segmentId === segment(3, {}).id
      && (finding.code === QA_RULE_CODES.FULLWIDTH_PUNCTUATION
        || finding.code === QA_RULE_CODES.RESIDUAL_CJK))).toEqual([])
  })

  test('异源同译 TARGET_SOURCE_INCONSISTENCY；同源同译不触发', () => {
    const findings = runQa([
      segment(1, { source: 'Close the door', target: '关闭' }),
      segment(2, { source: 'Close the window', target: '关闭' }),
      segment(3, { source: 'Open the door', target: '打开门' }),
      segment(4, { source: 'Open the door', target: '打开门' }),
    ])
    const flagged = findings.filter((finding) => finding.code === QA_RULE_CODES.TARGET_SOURCE_INCONSISTENCY)
    expect(flagged.length).toBe(2)
    expect(flagged.every((finding) => finding.issueType === 'consistency')).toBe(true)
  })

  test('glossary_conflict：源文命中一词多译冲突组，产出 query finding', () => {
    const findings = runQa([
      segment(1, { source: 'Drink the Potion now', target: '喝下药水' }),
      segment(2, { source: 'No conflict here at all', target: '这里没有冲突' }),
    ], {
      glossaryConflicts: [{ sourceTerm: 'Potion', translations: ['药水', '药剂'] }],
    })
    const conflicts = findings.filter((finding) => finding.code === QA_RULE_CODES.GLOSSARY_CONFLICT)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]?.issueType).toBe('glossary_conflict')
    expect(conflicts[0]?.disposition).toBe('query')
    expect(conflicts[0]?.message).toContain('Potion')
  })

  test('uppercase/camelcase parity 默认关，opt-in 开启', () => {
    const segments = [
      segment(1, { source: 'Use the API key', target: '使用密钥' }),
      segment(2, { source: 'Call renderFrame now', target: '立即调用渲染' }),
    ]
    expect(runQa(segments).some((finding) =>
      finding.code === QA_RULE_CODES.UPPERCASE_TOKEN_MISMATCH
      || finding.code === QA_RULE_CODES.CAMELCASE_TOKEN_MISMATCH)).toBe(false)
    const enabled = runQa(segments, { checkUppercaseTokens: true, checkCamelCaseTokens: true })
    expect(enabled.some((finding) => finding.code === QA_RULE_CODES.UPPERCASE_TOKEN_MISMATCH)).toBe(true)
    expect(enabled.some((finding) => finding.code === QA_RULE_CODES.CAMELCASE_TOKEN_MISMATCH)).toBe(true)
  })
})

describe('PB-097 tag 族引擎 QA 映射', () => {
  test('占位符族/富文本族/配平嵌套三码进 finding，三元组与静态表一致', () => {
    const findings = runQa([
      // 占位符族增量（%.2f 既有宽松签名抓不住）
      segment(1, { source: '命中率 %.2f%%', target: '命中率' }),
      // 富文本族守恒（BBCode 全族）
      segment(2, { source: '[color=#78dd54]暴击[/color]', target: '暴击' }),
      // 成对配平/嵌套（交叉嵌套）
      segment(3, { source: '<b><i>甲</i></b>', target: '<b><i>甲</b></i>' }),
    ])
    const byCode = new Map(findings.map((finding) => [finding.code, finding]))
    const placeholder = byCode.get(QA_RULE_CODES.PLACEHOLDER_FAMILY_MISMATCH)
    expect(placeholder?.issueType).toBe('placeholders_variables')
    expect(placeholder?.severity).toBe('L0')
    expect(placeholder?.disposition).toBe('defect')
    const family = byCode.get(QA_RULE_CODES.TAG_FAMILY_MISMATCH)
    expect(family?.issueType).toBe('format_tags')
    expect(family?.severity).toBe('L0')
    expect(family?.disposition).toBe('defect')
    const pairing = byCode.get(QA_RULE_CODES.TAG_PAIRING_MISMATCH)
    expect(pairing?.issueType).toBe('format_tags')
    expect(pairing?.severity).toBe('L0')
    expect(pairing?.disposition).toBe('defect')
    for (const item of [placeholder, family, pairing]) {
      const mapping = resolveQaIssueMapping(item!.code)
      expect(item?.severity).toBe(mapping.severity)
      expect(item?.issueType).toBe(mapping.issueType)
      expect(item?.disposition).toBe(mapping.disposition)
    }
  })

  test('项目 tagProfile 族进 QA；缺省仅内置族不误报', () => {
    const tagProfile = {
      families: [{ id: 'grm-qty', pattern: '\\[Grm:Qty[^\\]]*\\]', class: 'singleton' as const }],
    }
    const withProfile = runQa([
      segment(1, { source: '获得 [Grm:Qty S=""] 个', target: '获得 个' }),
    ], { tagProfile })
    expect(withProfile.some((finding) => finding.code === QA_RULE_CODES.TAG_FAMILY_MISMATCH)).toBe(true)
    // 同一对段不带 profile：项目族未登记不锁定
    const withoutProfile = runQa([
      segment(1, { source: '获得 [Grm:Qty S=""] 个', target: '获得 个' }),
    ])
    expect(withoutProfile.some((finding) => finding.code === QA_RULE_CODES.TAG_FAMILY_MISMATCH)).toBe(false)
  })
})
