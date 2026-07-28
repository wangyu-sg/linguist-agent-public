import { describe, expect, test } from 'bun:test'
import * as featureFlags from './feature-flags'
import {
  AGENT_RUNTIME_SWITCHER_VISIBLE,
  AUTOMATIONS_VISIBLE,
  PROMA_PROMO_VISIBLE,
  REMOTE_BOTS_SETTINGS_VISIBLE,
} from './feature-flags'

describe('feature-flags 产品面开关', () => {
  test('模块暴露文档约定的完整开关集合', () => {
    expect(Object.keys(featureFlags).sort()).toEqual([
      'AGENT_RUNTIME_SWITCHER_VISIBLE',
      'AUTOMATIONS_VISIBLE',
      'PROMA_PROMO_VISIBLE',
      'REMOTE_BOTS_SETTINGS_VISIBLE',
    ])
  })

  test('given 完整 Agent 模式 when 启动应用 then runtime 切换入口默认可见', () => {
    expect(AGENT_RUNTIME_SWITCHER_VISIBLE).toBe(true)
  })

  test('given 完整 Proma 能力 when 打开设置 then 远程机器人入口默认可见', () => {
    expect(REMOTE_BOTS_SETTINGS_VISIBLE).toBe(true)
  })

  test('given 完整 Proma 能力 when 查看侧边栏 then 自动任务入口默认可见', () => {
    expect(AUTOMATIONS_VISIBLE).toBe(true)
  })

  test('D-007（PB-012）：Proma 商业推广面默认隐藏', () => {
    expect(PROMA_PROMO_VISIBLE).toBe(false)
  })
})
