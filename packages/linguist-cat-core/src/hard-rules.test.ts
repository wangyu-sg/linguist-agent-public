import { describe, expect, test } from 'bun:test'
import { asAssetId, deriveSegmentId } from './ids'
import {
  DETERMINISTIC_HARD_RULE_CODES,
  runDeterministicHardRules,
  type DeterministicHardRuleCode,
  type DeterministicHardRuleInput,
} from './hard-rules'
import { compileTagFamilyRegex } from './tag-families'
import { normalizeTagProfile } from './tag-profile'
import { runQa } from './qa-core'
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
    forbiddenTerms: [{ sourceTerm: 'potion', term: '违禁词' }],
    ...overrides,
  })
}

describe('PB-052 确定性硬规则', () => {
  test('完整保留格式、换行、数字/标识符与术语时通过，结果可重复', () => {
    const first = run()
    expect(first).toEqual({ ok: true, violations: [] })
    expect(run()).toEqual(first)
  })

  test('locked、placeholder/tag、ICU 等结构问题独立阻断', () => {
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
    ]
    for (const [code, overrides] of cases) {
      expect(run(overrides).violations.map((violation) => violation.code)).toContain(code)
    }
  })

  test('换行、数字和一般字母数字 token 仅进入 QA，不阻断写回', () => {
    const cases: Array<[DeterministicHardRuleCode, string]> = [
      [
        DETERMINISTIC_HARD_RULE_CODES.NEWLINE_SIGNATURE_MISMATCH,
        '购买 {count} 个<b>HP-20</b>药水 现在 {kind, select, rare {稀有} other {普通}}',
      ],
      [
        DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
        '购买 {count} 个<b>HP-30</b>药水\\n现在\n{kind, select, rare {稀有} other {普通}}',
      ],
      [
        DETERMINISTIC_HARD_RULE_CODES.TOKEN_SIGNATURE_MISMATCH,
        '购买 {count} 个<b>药水</b>\\n现在\n{kind, select, rare {稀有} other {普通}}',
      ],
    ]
    for (const [code, proposedTarget] of cases) {
      const input = {
        segment,
        proposedTarget,
        requiredTerminology: [{ sourceTerm: 'potion', targetTerm: '药水' }],
      }
      expect(runDeterministicHardRules(input).violations.map((item) => item.code)).not.toContain(code)
      expect(runDeterministicHardRules(input, { includeAdvisory: true }).violations.map((item) => item.code)).toContain(code)
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
    expect(run({
      segment: { ...segment, source: 'Buy a drink' },
      proposedTarget: '购买违禁词',
    }).violations.map((violation) => violation.code)).not.toContain(
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
      }, { includeAdvisory: true }).violations.map((violation) => violation.code)

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

  test('英文月份和序数的词汇用法不误触发数字硬门', () => {
    const codes = (source: string, proposedTarget: string) =>
      runDeterministicHardRules({
        segment: { ...segment, source, targetLocale: 'zh-CN' },
        proposedTarget,
      }, { includeAdvisory: true }).violations.map((violation) => violation.code)

    const lexicalCases: ReadonlyArray<readonly [string, string]> = [
      ['May I enter?', '我可以进来吗？'],
      ['March forward!', '向前进！'],
      ['August is waiting.', '奥古斯特在等候。'],
      ['First, open the menu.', '首先打开菜单。'],
      ['One last chance.', '最后一次机会。'],
    ]
    for (const [source, target] of lexicalCases) {
      expect(codes(source, target)).not.toContain(
        DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
      )
    }
    expect(codes('May 12, 2026', '2026年5月12日')).not.toContain(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
    )
    expect(codes('12 May', '5月12日')).not.toContain(
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

  test('空译文、非法 Unicode 与 NUL 作为 Proposal hard gate fail closed', () => {
    const codes = (proposedTarget: string) =>
      runDeterministicHardRules({
        segment: { ...segment, source: 'Save {name}' },
        proposedTarget,
      }).violations.map((violation) => violation.code)

    expect(codes('   ')).toContain(DETERMINISTIC_HARD_RULE_CODES.EMPTY_TARGET)
    expect(codes(`保存 ${String.fromCharCode(0xd800)}`)).toContain(
      DETERMINISTIC_HARD_RULE_CODES.INVALID_TARGET_ENCODING,
    )
    expect(codes('保存\u0000{name}')).toContain(
      DETERMINISTIC_HARD_RULE_CODES.INVALID_TARGET_ENCODING,
    )
  })

  test('使用完整 ICU grammar 拒绝坏语法，并守恒 offset 与 number skeleton', () => {
    const codes = (source: string, proposedTarget: string) =>
      runDeterministicHardRules({
        segment: { ...segment, source },
        proposedTarget,
      }).violations.map((violation) => violation.code)

    expect(codes(
      '{count, plural, offset:1 =0 {None} one {One} other {# items}}',
      '{count, plural, offset:1 =0 {无} one {一项}}',
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.ICU_SYNTAX_INVALID)
    expect(codes(
      '{count, plural, offset:1 =0 {None} one {One} other {# items}}',
      '{count, plural, offset:2 =0 {无} one {一项} other {# 项}}',
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH)
    expect(codes(
      'Price: {price, number, ::currency/USD}',
      '价格：{price, number, ::currency/CNY}',
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH)
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

  test('通用反斜杠转义不冒充结构 placeholder', () => {
    expect(codesOf('第一行\\n第二行\\t缩进', '第一行\\n第二行')).not.toContain(
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

  test('分开登记的 opening/closing 规则按 pairWith 真实配对', () => {
    const tagProfile = {
      families: [
        { id: 'box-open', pattern: '\\[box\\]', class: 'paired' as const, kind: 'opening' as const, pairWith: 'box' },
        { id: 'box-close', pattern: '\\[/box\\]', class: 'paired' as const, kind: 'closing' as const, pairWith: 'box' },
      ],
    }
    expect(pb097Run('[box]甲[/box]', '[box]乙[/box]', { tagProfile })).toEqual({ ok: true, violations: [] })
    expect(codesOf('[box]甲[/box]', '甲[/box][box]', { tagProfile })).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH,
    )
    expect(codesOf('<box>[box]甲[/box]</box>', '<box>[box]乙</box>[/box]', { tagProfile })).toContain(
      DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH,
    )
  })

  test('标准 ICU 分支内编号参数不因避开全局多重集而漏检', () => {
    expect(codesOf(
      '{count, plural, one {{0} 个} other {{0} 个}}',
      '{count, plural, one {个} other {{0} 个}}',
    )).toContain(DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH)
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

describe('LA018 ICU 语言类别兼容', () => {
  const check = (source: string, target: string, targetLocale = 'en-US') => runDeterministicHardRules({
    segment: { ...segment, source, targetLocale }, proposedTarget: target,
  })
  test('S01–S07：合法 plural/调序通过，变量、select、数值分支和语法损坏拒绝', () => {
    const cases: Array<[string, string, boolean]> = [
      ['{count, plural, other {获得#枚徽章}}', '{count, plural, one {Gain # badge} other {Gain # badges}}', true],
      ['{count, plural, other {获得#枚徽章}}', '{coins, plural, one {Gain # badge} other {Gain # badges}}', false],
      ['{kind, select, member {会员通道} guest {访客通道} other {普通通道}}', '{kind, select, premium {Member entrance} guest {Guest entrance} other {Main entrance}}', false],
      ['{count, plural, =0 {没有徽章} other {#枚徽章}}', '{count, plural, one {# badge} other {# badges}}', false],
      ['{count, plural, other {#枚徽章}}', '{count, plural, one {# badge} other {# badges}', false],
      ['<b>{name}</b>获得{count}枚徽章。', '{count} badges awarded to <b>{name}</b>.', true],
      ['轮到{player}。', "It is {enemy}'s turn.", false],
    ]
    for (const [source, target, allowed] of cases) expect(check(source, target).ok).toBe(allowed)
  })
  test('S08：实际换行变字面转义仍进入明确 QA', () => {
    const result = runDeterministicHardRules({
      segment: { ...segment, source: '准备。\n出发。' }, proposedTarget: 'Ready.\\nGo.',
    }, { includeAdvisory: true })
    expect(result.violations.some(item => item.code === 'NEWLINE_SIGNATURE_MISMATCH')).toBe(true)
  })
  test('新增分支可复制编号占位符与嵌套 select；丢失或改身份仍拒绝', () => {
    const source = '{count, plural, other {{kind, select, rare {<b>{0}</b>稀有} other {{0}普通}}}}'
    const target = '{count, plural, one {{kind, select, rare {<b>{0}</b> rare} other {{0} normal}}} other {{kind, select, rare {<b>{0}</b> rare} other {{0} normal}}}}'
    expect(check(source, target).ok).toBe(true)
    expect(check(source, target.replace('<b>{0}</b>', '<b>{1}</b>')).ok).toBe(false)
    expect(check(source, target.replace('<b>{0}</b>', '')).ok).toBe(false)
    expect(check(source, target.replace('rare {', 'premium {')).ok).toBe(false)
  })
  test('合法去掉重复类别，非法目标类别/offset/ordinal 变化仍拒绝', () => {
    expect(check('{count, plural, one {#个} other {#个}}', '{count, plural, other {#个}}', 'zh-CN').ok).toBe(true)
    expect(check('{count, plural, other {#}}', '{count, plural, few {#} other {#}}').ok).toBe(false)
    expect(check('{count, plural, offset:1 other {#}}', '{count, plural, offset:2 other {#}}').ok).toBe(false)
    expect(check('{count, plural, other {#}}', '{count, selectordinal, other {#}}').ok).toBe(false)
    expect(check('{count, plural, one {{bonus}} other {{name}}}', '{count, plural, other {{name}}}', 'zh-CN').ok).toBe(false)
  })
})

describe('LA018 显式项目 plural 属性语法', () => {
  const family = {
    id: 'synthetic-inflection', pattern: '\\[Inflect[^\\]]*\\]', class: 'singleton' as const,
    targetLocales: ['en'],
    grammar: { kind: 'plural-attributes' as const, tagName: 'Inflect', argumentAttribute: 'arg', formAttributes: ['one', 'other'] },
  }
  const check = (source: string, target: string) => runDeterministicHardRules({
    segment: { ...segment, source, targetLocale: 'en-US' }, proposedTarget: target,
    tagProfile: normalizeTagProfile({ families: [family] }),
  })
  test('源无grammar时合法目标词形可加入；属性调序与本地化词形合法', () => {
    expect(check('获得{0}枚徽章', 'Gain {0} [Inflect arg="0" one="badge" other="badges"]').ok).toBe(true)
    expect(check('{count} [Inflect arg="count" one="徽章" other="徽章"]', '{count} [Inflect other="badges" one="badge" arg="count"]').ok).toBe(true)
  })
  test('源已有 grammar 不能借普通占位符换绑另一个运行参数；关联重排合法', () => {
    const source = '{0} item[Inflect arg="0" one="" other="s"]; {1} bonus'
    expect(check(source, '{0} item[Inflect arg="1" one="" other="s"]; {1} bonus').ok).toBe(false)
    const both = '{0}[Inflect arg="0" one="item" other="items"] {1}[Inflect arg="1" one="bonus" other="bonuses"]'
    expect(check(both, '{1}[Inflect arg="1" one="bonus" other="bonuses"] {0}[Inflect arg="0" one="item" other="items"]').ok).toBe(true)
    expect(check('{0} item; {1} bonus', '{0} item; {1}[Inflect arg="1" one="bonus" other="bonuses"]').ok).toBe(true)
  })
  test('坏索引/属性/括号/隐藏运行结构拒绝；已有语法的独有变量不得丢失', () => {
    for (const target of [
      '{0} [Inflect arg="1" one="badge" other="badges"]',
      '{0} [Inflect arg="0.5" one="badge" other="badges"]',
      '{0} [Inflect arg="0" one="badge"]',
      '{0} [Inflect arg="0" one="badge" one="badges" other="badges"]',
      '{0} [Inflect arg="0" one="badge" other="badges" unknown="x"]',
      '{0} [Inflect arg="0" one="badge" other="badges"',
      '{0} [Inflect arg="0" one="<b>badge</b>" other="badges"]',
    ]) expect(check('获得{0}枚徽章', target).ok).toBe(false)
    expect(check('[Inflect arg="count" one="徽章" other="徽章"]', 'Badges').ok).toBe(false)
    expect(runQa([{ ...segment, source: '{0}', target: '{0} [Inflect arg="1" one="badge" other="badges"]', targetLocale: 'en-US' }], {
      tagProfile: normalizeTagProfile({ families: [family] }),
    }).some(finding => finding.code === 'TAG_FAMILY_MISMATCH' && finding.severity === 'L0')).toBe(true)
  })
  test('无grammar声明仍守恒，未指定适用locale或未知策略不得开启豁免', () => {
    for (const profile of [
      { families: [{ id: family.id, pattern: family.pattern, class: family.class }] },
      { families: [{ ...family, targetLocales: [] }] },
      { families: [{ ...family, grammar: { ...family.grammar, kind: 'unknown' } }] },
    ]) {
      expect(runDeterministicHardRules({
        segment: { ...segment, source: '{0}', targetLocale: 'en-US' },
        proposedTarget: '{0} [Inflect arg="0" one="badge" other="badges"]',
        tagProfile: normalizeTagProfile(profile),
      }).ok).toBe(false)
    }
  })
})
