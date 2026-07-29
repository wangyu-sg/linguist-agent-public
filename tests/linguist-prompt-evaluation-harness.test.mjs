import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

const DIMENSIONS = [
  'accuracy',
  'completeness',
  'naturalness',
  'character_voice',
  'terminology',
  'gameplay_clarity',
  'technical_integrity',
  'hallucination',
  'tool_call_count',
  'token_cost',
  'latency',
  'proposal_coverage',
  'qa_findings',
]

const CASES = [
  { id: 'ui-short', category: 'ui_short', source: 'PLAY', context: '主菜单按钮；最多 4 个汉字。' },
  { id: 'tutorial', category: 'tutorial', source: 'Hold {key} to block incoming attacks.', context: '首次战斗教学；保留 {key}。' },
  { id: 'combat-skill', category: 'combat_skill', source: '<b>Blood Rush</b>: Deal 120% ATK damage and gain 2 Fury.', context: '技能说明；ATK 与 Fury 已在术语库定义。' },
  { id: 'equipment', category: 'item_equipment', source: 'Traveler’s Boots +{speed}% Move Speed', context: '装备词条；保留 {speed}%。' },
  { id: 'dialogue', category: 'dialogue', source: 'Heh. You really thought I would surrender?', context: '傲慢、克制的反派；避免网络流行语。' },
  { id: 'plot-critical', category: 'plot_critical', source: 'The seal was never meant to keep them out. It kept us in.', context: '章节末反转；指代必须保留。' },
  { id: 'marketing', category: 'marketing', source: 'Forge your legend in a world that remembers every choice.', context: '商店页短描述；不得新增功能承诺。' },
  { id: 'monetization', category: 'monetization', source: 'Guaranteed featured hero within 80 pulls. Counter carries over.', context: '抽卡规则；数字与继承条件不得弱化。' },
  { id: 'icu-tags', category: 'variables_tags_icu', source: '{count, plural, one {<b># shard</b>} other {<b># shards</b>}}', context: 'ICU MessageFormat；结构与标签必须可解析。' },
  { id: 'term-conflict', category: 'terminology_conflict', source: 'Return to the Sanctuary.', context: '术语库同时出现“圣所”和“庇护所”；必须报告冲突，不得猜测。' },
  { id: 'missing-context', category: 'missing_context', source: 'I saw her by the bank.', context: '没有画面、说话人或前后文；应请求必要上下文或标记不确定性。' },
  { id: 'culture', category: 'culture_adaptation', source: 'Break a leg out there!', context: '赛前鼓励；目标语言为简体中文，不直译肢体伤害。' },
]

const FROZEN_SET = {
  version: '1.0.0',
  status: 'awaiting_model_evaluation',
  dimensions: DIMENSIONS,
  protocol: {
    variants: ['current', 'new'],
    randomizedOrderRequired: true,
    strategyNamesHiddenRequired: true,
    fixedModelVersionRequired: true,
    runsPerVariant: 2,
    review: ['human_blind', 'deterministic_qa'],
  },
  cases: CASES,
}
const FROZEN_SET_SHA256 = '33fab49a881c307f8d18d5965f407ab40d9324bc65e7fb9d21bfed0a199eba8a'

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildEvaluationRecords() {
  return CASES.flatMap((evaluationCase) => (
    FROZEN_SET.protocol.variants.flatMap((variant, variantIndex) => (
      Array.from({ length: FROZEN_SET.protocol.runsPerVariant }, (_, runIndex) => ({
        setVersion: FROZEN_SET.version,
        setSha256: FROZEN_SET_SHA256,
        status: 'not_scored',
        ...evaluationCase,
        variant,
        blindLabel: variantIndex === 0 ? 'B' : 'A',
        run: runIndex + 1,
        modelVersion: null,
        scores: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, null])),
        output: null,
        reviewerNotes: null,
      }))
    ))
  ))
}

const emitJsonl = process.argv.includes('--emit-jsonl')

if (emitJsonl) {
  process.stdout.write(`${buildEvaluationRecords().map((record) => JSON.stringify(record)).join('\n')}\n`)
} else {
  test('22.5: 冻结评估集覆盖规定场景且内容哈希稳定', () => {
    assert.equal(sha256(FROZEN_SET), FROZEN_SET_SHA256)
    assert.deepEqual(
      CASES.map(({ category }) => category),
      [
        'ui_short',
        'tutorial',
        'combat_skill',
        'item_equipment',
        'dialogue',
        'plot_critical',
        'marketing',
        'monetization',
        'variables_tags_icu',
        'terminology_conflict',
        'missing_context',
        'culture_adaptation',
      ],
    )
  })

  test('22.5: 离线 harness 只生成待盲评记录，不伪造模型输出或评分', () => {
    const records = buildEvaluationRecords()
    assert.equal(records.length, CASES.length * 2 * 2)
    assert.equal(FROZEN_SET.protocol.fixedModelVersionRequired, true)
    assert.equal(FROZEN_SET.protocol.randomizedOrderRequired, true)
    assert.equal(FROZEN_SET.protocol.strategyNamesHiddenRequired, true)
    assert.deepEqual(FROZEN_SET.protocol.review, ['human_blind', 'deterministic_qa'])
    for (const record of records) {
      assert.equal(record.status, 'not_scored')
      assert.equal(record.output, null)
      assert.equal(record.reviewerNotes, null)
      assert.deepEqual(Object.keys(record.scores), DIMENSIONS)
      assert.ok(Object.values(record.scores).every((score) => score === null))
    }
  })
}
