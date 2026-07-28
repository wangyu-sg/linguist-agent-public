import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChannelSettings } from './ChannelSettings'

describe('ChannelSettings', () => {
  test('Given Linguist Agent 独立数据根 When 打开模型设置 Then 提供显式 Proma Provider 导入入口', () => {
    const html = renderToStaticMarkup(<ChannelSettings />)

    expect(html).toContain('从 Proma 导入')
    expect(html).toContain('添加配置')
  })
})
