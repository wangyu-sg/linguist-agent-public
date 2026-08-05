import { expect, test } from 'bun:test'
import {
  resolveModeContributions,
  resolveSettingsSections,
} from './mode-contributions'

test('模式贡献可组合、不会重复，未注册模式保持基础设置不变', () => {
  const baseSections = [{ id: 'general' }, { id: 'channels' }]
  const sections = resolveSettingsSections(
    baseSections,
    [
      { id: 'linguist-migration', modes: ['linguist'] },
      { id: 'general', modes: ['linguist'] },
    ],
    'linguist',
  )
  const sidebars = resolveModeContributions('linguist', [
    { id: 'linguist-projects', mode: 'linguist', value: 'projects' },
    { id: 'linguist-recent', mode: 'linguist', value: 'recent' },
    { id: 'linguist-projects', mode: 'linguist', value: 'duplicate' },
  ])

  expect(sections.map((section) => section.id)).toEqual(['general', 'channels', 'linguist-migration'])
  expect(sidebars).toEqual(['projects', 'recent'])
  expect(resolveSettingsSections(baseSections, [], 'agent')).toBe(baseSections)
  expect(resolveModeContributions('agent', [{ id: 'linguist-projects', mode: 'linguist', value: 'projects' }])).toEqual([])
})
