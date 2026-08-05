import * as React from 'react'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiffPanelTabBar } from './DiffPanelTabBar'

test('chatOnly Host 只暴露 Companion Chat，不误开放文件面板', () => {
  const html = renderToStaticMarkup(
    <DiffPanelTabBar
      activeTab="chat"
      onTabChange={() => {}}
      showChatTab
      chatOnly
    />,
  )

  expect(html).toContain('问答')
  expect(html).not.toContain('文件改动')
  expect(html).not.toContain('>文件<')
})
