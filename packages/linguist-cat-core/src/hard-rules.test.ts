import { describe, expect, test } from 'bun:test'
import { asAssetId, deriveSegmentId } from './ids'
import {
  DETERMINISTIC_HARD_RULE_CODES,
  runDeterministicHardRules,
  type DeterministicHardRuleCode,
  type DeterministicHardRuleInput,
} from './hard-rules'
import { compileTagFamilyRegex } from './tag-families'
import type { Segment } from './segment'

const assetId = asAssetId('ast-0000000000000001')
const segment: Segment = {
  id: deriveSegmentId(assetId, 0, 'cta'),
  assetId,
  ordinal: 0,
  key: 'cta',
  source: 'Buy {count} <b>HP-20</b> potions\\nNow\n{kind, select, rare {Rare} other {Normal}}',
  target: '',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  status: 'untranslated',
  locked: false,
  revision: 0,
  sourceHash: 'source-hash',
}

function run(overrides: Partial<DeterministicHardRuleInput> = {}) {
  return runDeterministicHardRules({
    segment,
    proposedTarget: '购买 {count} 个<b>HP-20</b>药水\\n现在\n{kind, select, rare {稀有} other {普通}}',
    requiredTerminology: [{ sourceTerm: 'potion', targetTerm: '药水' }],
    forbiddenTerms: ['违禁词'],
    ...overrides,
  })
}

describe('PB-052 确定性硬规则', () => {
  test('完整保留格式、换行、数字/标识符与术语时通过，结果可重复', () => {
    const first = run()
    expect(first).toEqual({ ok: true, violations: [] })
    expect(run()).toEqual(first)
  })

  test('locked、placeholder/tag、ICU、newline、number/token 均独立阻断', () => {
    const cases: Array<[DeterministicHardRuleCode, Partial<DeterministicHardRuleInput>]> = [
      [DETERMINISTIC_HARD_RULE_CODES.LOCKED_SEGMENT, { segment: { ...segment, locked: true } }],
      [DETERMINISTIC_HARD_RULE_CODES.PLACEHOLDER_SIGNATURE_MISMATCH, {
        proposedTarget: '购买个<b>HP-20</b>药水\\n现在\n{kind, select, rare {稀有} other {普通}}',
      }],
      [DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH, {
        proposedTarget: '购买 {count} 个HP-20药水\\n现在\n{kind, select, rare {稀有} other {普通}}',
      }],
      [DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH, {
        proposedTarget: '购买 {count} 个<b>HP-20</b>药水\\n现在\n{kind, select, other {普通}}',
      }],
      [DETERMINISTIC_HARD_RULE_CODES.NEWLINE_SIGNATURE_MISMATCH, {
        proposedTarget: '购买 {count} 个<b>HP-20</b>药水 现在 {kind, select, rare {稀有} other {普通}}',
      }],
      [DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH, {
        proposedTarget: '购买 {count} 个<b>HP-30</b>药水\\n现在\n{kind, select, rare {稀有} other {普通}}',
      }],
      [DETERMINISTIC_HARD_RULE_CODES.TOKEN_SIGNATURE_MISMATCH, {
        proposedTarget: '购买 {count} 个<b>药水</b>\\n现在\n{kind, select, rare {稀有} other {普通}}',
      }],
    ]
    for (const [code, overrides] of cases) {
      expect(run(overrides).violations.map((violation) => violation.code)).toContain(code)
    }
  })

  test('required terminology 与 forbidden term 是明确输入，不由 Agent 解释绕过', () => {
    expect(run({
      proposedTarget: '购买 {count} 个<b>HP-20</b>饮料\\n现在\n{kind, select, rare {稀有} other {普通}}',
    }).violations.map((violation) => violation.code)).toContain(
      DETERMINISTIC_HARD_RULE_CODES.REQUIRED_TERMINOLOGY_MISSING,
    )
    expect(run({
      proposedTarget: '购买 {count} 个<b>HP-20</b>药水（违禁词）\\n现在\n{kind, select, rare {稀有} other {普通}}',
    }).violations.map((violation) => violation.code)).toContain(
      DETERMINISTIC_HARD_RULE_CODES.FORBIDDEN_TERM_PRESENT,
    )
  })

  test('兼容旧命名分支 {name:a|b} 的 arity，并忽略位置 placeholder 自身数字', () => {
    const colonSegment = { ...segment, source: 'Choose {gender:he|she} {0}', target: '' }
    expect(runDeterministicHardRules({
      segment: colonSegment,
      proposedTarget: '选择 {gender:他|她} {0}',
    })).toEqual({ ok: true, violations: [] })
    expect(runDeterministicHardRules({
      segment: colonSegment,
      proposedTarget: '选择 {gender:他} {0}',
    }).violations.map((violation) => violation.code)).toContain(
      DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH,
    )
  })

  test('中文数字、编号与月份使用 canonical form，仍保留真实数字不一致阻断', () => {
    const codes = (source: string, proposedTarget: string) =>
      runDeterministicHardRules({
        segment: { ...segment, source, targetLocale: 'en-US' },
        proposedTarget,
      }).violations.map((violation) => violation.code)

    expect(codes('七号选手登场', 'No. 7 enters')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('第二十一集', 'Episode 21')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('七月见', 'See you in July')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('Second line', '第二行')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('一会儿见', 'See you soon')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('我十分满意', 'I am very satisfied')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('一点也不难', 'It is not difficult at all')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('七号选手登场', 'No. 8 enters')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
  })

  test('嵌套 ICU 分支也进入签名，不能只保留外层 branch key', () => {
    const nested = {
      ...segment,
      source: '{count, plural, one {{kind, select, rare {Rare} other {Normal}}} other {Items}}',
    }
    expect(runDeterministicHardRules({
      segment: nested,
      proposedTarget: '{count, plural, one {{kind, select, rare {稀有}}} other {项目}}',
    }).violations.map((violation) => violation.code)).toContain(
      DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH,
    )
  })
})

describe('PB-097 tag 族引擎', () => {
  const pb097Run = (
    source: string,
    proposedTarget: string,
    options: { tagProfile?: DeterministicHardRuleInput['tagProfile']; targetLocale?: string } = {},
  ) =>
    runDeterministicHardRules({
      segment: { ...segment, source, targetLocale: options.targetLocale ?? 'zh-CN' },
      proposedTarget,
      ...(options.tagProfile !== undefined ? { tagProfile: options.tagProfile } : {}),
    })
  const codesOf = (
    source: string,
    proposedTarget: string,
    options: { tagProfile?: DeterministicHardRuleInput['tagProfile']; targetLocale?: string } = {},
  ) => pb097Run(source, proposedTarget, options).violations.map((violation) => violation.code)

  test('BBCode 全族（不限五色）：[font]/[color] 缺失与 extra 同罪', () => {
    expect(codesOf('[font=宋体]字[/font]', '[font=宋体]字')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
    expect(codesOf('[color=#78dd54]暴击[/color]', '暴击')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
    // extra 与 missing 同罪：目标多出 [b] 也拦
    expect(codesOf('你好', '[b]你好[/b]')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
  })

  test('printf 全族：%.2f / %03d / %1$s / %% 守恒', () => {
    // %.2f 精度形是族管线增量覆盖（既有宽松签名抓不住）
    expect(codesOf('命中率 %.2f%%', '命中率')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH,
    )
    expect(codesOf('进度 50%%', '进度 50%')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH,
    )
    // %03d / %1$s 既有宽松签名已覆盖：报经典码，族码不重复报
    expect(codesOf('%1$s 你好', '你好')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.PLACEHOLDER_SIGNATURE_MISMATCH,
    )
    // 位置参数调序合法（多重集比较不比顺序）
    expect(pb097Run('%1$s 比 %2$s 大', '%2$s 比 %1$s 大')).toEqual({ ok: true, violations: [] })
  })

  test('反斜杠转义族：\\t \\r 守恒（\\n 另有 NEWLINE 兜底）', () => {
    expect(codesOf('第一行\\n第二行\\t缩进', '第一行\\n第二行')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH,
    )
  })

  test('属性守恒（旧仓缺口）：<color=#FFF> 改成 <color=#000> 即违规', () => {
    expect(codesOf('<color=#FFF>白</color>', '<color=#000>白</color>')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH,
    )
  })

  test('tag 调序合法（用户拍板：多重集比较不比顺序）', () => {
    expect(pb097Run('<b>甲</b><i>乙</i>', '<i>乙</i><b>甲</b>')).toEqual({ ok: true, violations: [] })
    expect(pb097Run('[b]甲[/b][i]乙[/i]', '[i]乙[/i][b]甲[/b]')).toEqual({ ok: true, violations: [] })
  })

  test('extra XML tag 与 missing 同罪', () => {
    expect(codesOf('你好', '<u>你好</u>')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH,
    )
  })

  test('成对 tag 栈算法：交叉嵌套 invalid，守恒多重集相等也拦', () => {
    const codes = codesOf('<b><i>甲</i></b>', '<b><i>甲</b></i>')
    expect(codes).toContain(DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH)
    expect(codes).not.toContain(DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH)
    // 源本身不配平时跳过目标配对校验（照抄源文不该被拦），守恒兜底
    expect(codesOf('<b>甲', '<b>甲')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH,
    )
  })

  test('ICU span 内 {N} 由族管线单独验，不被 withoutSpans 抹掉后漏检', () => {
    expect(codesOf(
      '{count, plural, one {{0} 个} other {{0} 个}}',
      '{count, plural, one {个} other {{0} 个}}',
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH)
    // ICU 分支体内的 {Rare} 是分支文本不是占位符，不误报
    expect(pb097Run(
      '{kind, select, rare {Rare} other {Normal}}',
      '{kind, select, rare {稀有} other {普通}}',
    )).toEqual({ ok: true, violations: [] })
  })

  test('项目族登记 [Grm:Qty …]：守恒 + 属性全量进签名 + 属性换序合法', () => {
    // 安全 lint 拒绝量词嵌套组，项目 pattern 用线性写法（属性守恒由签名层做）
    const tagProfile = {
      families: [{ id: 'grm-qty', pattern: '\\[Grm:Qty[^\\]]*\\]', class: 'singleton' as const }],
    }
    expect(codesOf('获得 [Grm:Qty S="" P="" Idx=""] 个', '获得 个', { tagProfile })).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
    // 空值属性也在签名里；改任一属性值即违规
    expect(codesOf(
      '获得 [Grm:Qty S="" P="" Idx=""] 个',
      '获得 [Grm:Qty S="3" P="" Idx=""] 个',
      { tagProfile },
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH)
    // tag 内属性换序不误判（属性多重集排序）
    expect(codesOf(
      '获得 [Grm:Qty S="" P="" Idx=""] 个',
      '获得 [Grm:Qty P="" S="" Idx=""] 个',
      { tagProfile },
    )).not.toContain(DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH)
    // 未登记时同形字面无内置族认领，不锁定（discovery 提示归后续票）
    expect(codesOf('获得 [Grm:Qty S=""] 个', '获得 个')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
  })

  test('项目族 targetLocales 激活条件：仅 target=ru 生效', () => {
    const tagProfile = {
      families: [{
        id: 'grm-qty',
        pattern: '\\[Grm:Qty[^\\]]*\\]',
        class: 'singleton' as const,
        targetLocales: ['ru'],
      }],
    }
    // zh-CN 不激活：丢 tag 不报
    expect(codesOf('获得 [Grm:Qty S=""] 个', '获得 个', { tagProfile, targetLocale: 'zh-CN' })).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
    // ru-RU 由 base 命中激活：丢 tag 即报
    expect(codesOf('获得 [Grm:Qty S=""] 个', '获得 个', { tagProfile, targetLocale: 'ru-RU' })).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
  })

  test('危险项目正则被安全 lint 静默跳过，绝不进热路径', () => {
    const tagProfile = {
      families: [{ id: 'evil', pattern: '(a+)+b', class: 'singleton' as const }],
    }
    expect(codesOf('aaa', 'bbb', { tagProfile })).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
    )
    expect(compileTagFamilyRegex('(a+)+b')).toBeNull()
    expect(compileTagFamilyRegex('a*')).toBeNull() // 禁空串匹配
    expect(compileTagFamilyRegex('x'.repeat(300))).toBeNull() // 长度上限
    expect(compileTagFamilyRegex('\\[ok\\]', 'gZ')).toBeNull() // 非法 flag
    expect(compileTagFamilyRegex('\\[ok\\]')).not.toBeNull()
  })
})
