import { describe, expect, test } from 'bun:test'
import {
  matchTmCandidates,
  selectTmAgentEvidence,
  tmSourceHash,
} from './tm-matching'

interface CorpusCase {
  name: string
  query: string
  source: string
  expected: 'none' | 'fuzzy' | 'near-exact'
}

const candidate = (id: string, source: string, target = source) => ({
  unitId: id,
  source,
  target,
})

const lexicalCases: CorpusCase[] = [
  { name: 'Save is not Save game', query: 'Save', source: 'Save game', expected: 'none' },
  { name: 'Play is not Replay', query: 'Play', source: 'Replay', expected: 'none' },
  { name: 'OK is not OK continue', query: 'OK', source: 'OK, continue', expected: 'none' },
  { name: 'Home is not Home screen', query: 'Home', source: 'Home screen', expected: 'none' },
  { name: 'Back is not Back to menu', query: 'Back', source: 'Back to menu', expected: 'none' },
  { name: 'Open is not Reopen', query: 'Open', source: 'Reopen', expected: 'none' },
  { name: 'Run is not Runner', query: 'Run', source: 'Runner', expected: 'none' },
  { name: 'Close is not Close window', query: 'Close', source: 'Close window', expected: 'none' },
  { name: 'word order lowers score one', query: 'Player attacks the enemy', source: 'The enemy attacks player', expected: 'fuzzy' },
  { name: 'word order lowers score two', query: 'The wizard opens the gate', source: 'The gate opens the wizard', expected: 'fuzzy' },
  { name: 'word order lowers score three', query: 'Return to the main menu', source: 'Return the menu to main', expected: 'fuzzy' },
  { name: 'word order lowers score four', query: 'The guard blocks the door', source: 'The door blocks the guard', expected: 'fuzzy' },
  { name: 'word order lowers score five', query: 'The player finds a key', source: 'A key finds the player', expected: 'fuzzy' },
  { name: 'Chinese fuzzy one', query: '领取每日奖励吧', source: '领取任务奖励吧', expected: 'fuzzy' },
  { name: 'Chinese fuzzy two', query: '进入战斗准备界面', source: '进入战斗准备页面', expected: 'fuzzy' },
  { name: 'Chinese fuzzy three', query: '系统设置已保存', source: '系统设置已储存', expected: 'fuzzy' },
  { name: 'Chinese fuzzy four', query: '技能冷却中请稍候', source: '技能冷却中请稍等', expected: 'fuzzy' },
  { name: 'Chinese fuzzy five', query: '获得新的装备奖励', source: '获得新的装备报酬', expected: 'fuzzy' },
  { name: 'numeric variation one', query: 'Collect 100 coins', source: 'Collect 200 coins', expected: 'near-exact' },
  { name: 'numeric variation two', query: 'Deal 10 damage', source: 'Deal 100 damage', expected: 'near-exact' },
  { name: 'numeric variation three', query: 'Version 1.2.3 ready', source: 'Version 1.2.4 ready', expected: 'near-exact' },
  { name: 'numeric variation four', query: 'Earn 10% bonus', source: 'Earn 15% bonus', expected: 'near-exact' },
  { name: 'time variation', query: 'Wait 05:00 minutes', source: 'Wait 10:00 minutes', expected: 'near-exact' },
  { name: 'URL variation', query: 'Visit https://example.com/a', source: 'Visit https://example.com/b', expected: 'near-exact' },
  { name: 'placeholder name', query: 'You gained {x} XP', source: 'You gained {y} XP', expected: 'near-exact' },
  { name: 'inline tag name', query: 'Press <b>Start</b> now', source: 'Press <i>Start</i> now', expected: 'near-exact' },
  { name: 'inline tag id', query: 'Open <ph id="1"/> now', source: 'Open <ph id="2"/> now', expected: 'near-exact' },
  { name: 'printf placeholder', query: 'Use %s to continue', source: 'Use %d to continue', expected: 'near-exact' },
  { name: 'named placeholders', query: 'Build {name} at {time}', source: 'Build {name} at {date}', expected: 'near-exact' },
  { name: 'reordered placeholders', query: '{name} gained {x} XP', source: '{x} gained {name} XP', expected: 'near-exact' },
  { name: 'punctuation variation', query: 'Hello world', source: 'Hello, world', expected: 'near-exact' },
  { name: 'whitespace variation', query: 'Hello  world', source: 'Hello world', expected: 'near-exact' },
  { name: 'case variation', query: 'HELLO world', source: 'Hello world', expected: 'near-exact' },
  { name: 'long lexical variation one', query: 'The player attacks the enemy now', source: 'The player attacks the foe now', expected: 'fuzzy' },
  { name: 'long lexical variation two', query: 'Please review this translation before delivery', source: 'Please check this translation before delivery', expected: 'fuzzy' },
  { name: 'long lexical variation three', query: 'The reward appears after the battle ends', source: 'The reward appears when the battle ends', expected: 'fuzzy' },
  { name: 'long lexical variation four', query: 'Select a language from the settings menu', source: 'Choose a language in the settings menu', expected: 'fuzzy' },
  { name: 'long lexical variation five', query: 'A new mission begins today', source: 'A new challenge begins today', expected: 'fuzzy' },
]

describe('TM high-risk synthetic corpus', () => {
  test('covers every high-risk lexical and structural case without a contains floor', () => {
    for (const item of lexicalCases) {
      const matches = matchTmCandidates(item.query, [candidate(item.name, item.source)], { minimumScore: 0 })
      if (item.expected === 'none') {
        expect(matches, item.name).toHaveLength(0)
        continue
      }
      expect(matches[0]?.matchClass, item.name).toBe(item.expected)
      expect(matches[0]?.displayScore, item.name).toBeGreaterThan(0)
      if (item.expected === 'near-exact') {
        expect(matches[0]?.structure.safety, item.name).toBe('review')
      }
    }
  })

  test('keeps exact/context classes and ambiguity explicit', () => {
    const matches = matchTmCandidates('Charge', [
      {
        ...candidate('double', 'Charge', '充能'),
        contextKey: 'skill.charge',
        previousSourceHash: tmSourceHash('Before'),
        nextSourceHash: tmSourceHash('After'),
      },
      {
        ...candidate('single', 'Charge', '冲锋'),
        contextKey: 'skill.charge',
      },
      candidate('plain', 'Charge', '收费'),
    ], { context: { contextKey: 'skill.charge', previousSource: 'Before', nextSource: 'After' } })
    expect(matches.map((match) => match.matchClass)).toEqual(['double-context', 'context', 'exact'])
    expect(matches.every((match) => match.displayScore >= 100)).toBe(true)
    expect(matches.every((match) => match.variantCount === 3)).toBe(true)
    const evidence = selectTmAgentEvidence(matches)
    expect(evidence).toHaveLength(3)
    expect(evidence.every((item) => item.ambiguous)).toBe(true)
  })

  test('does not expose incompatible placeable counts to Agent', () => {
    const matches = matchTmCandidates('You gained {x} XP', [
      candidate('missing', 'You gained XP'),
      candidate('changed', 'You gained {y} XP'),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.structure.safety).toBe('review')
    expect(selectTmAgentEvidence(matches)).toHaveLength(1)
  })

  test('exact hashes include the language pair', () => {
    expect(tmSourceHash('Save', 'en', 'zh-CN')).not.toBe(tmSourceHash('Save', 'en', 'fr-FR'))
    expect(tmSourceHash(' Save ', 'en', 'zh-CN')).toBe(tmSourceHash('Save', 'en', 'zh-CN'))
  })
})
