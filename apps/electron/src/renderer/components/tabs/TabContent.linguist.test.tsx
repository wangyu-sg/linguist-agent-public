import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { tabsAtom, type LocalizationProjectTab } from '@/atoms/tab-atoms'
import { TabContent } from './TabContent'

function renderProjectTab(tab: LocalizationProjectTab): string {
  const store = createStore()
  store.set(tabsAtom, [tab])
  return renderToStaticMarkup(
    <Provider store={store}>
      <TabContent tabId={tab.id} />
    </Provider>,
  )
}

describe('TabContent Linguist Project Tab', () => {
  test('given 正常 Project Tab when 渲染内容 then 挂载会自行打开项目的工作台', () => {
    const html = renderProjectTab({
      id: 'linguist-project:prj-0000000000000001',
      type: 'linguist-project',
      projectId: 'prj-0000000000000001',
      title: '游戏本地化',
    })

    expect(html).toContain('正在打开本地化项目')
    expect(html).not.toContain('工作台正在准备中')
  })

  test.each([
    ['archived', '项目已归档，请先恢复项目。'],
    ['missing', '项目不可用，请修复或关闭此标签页。'],
  ] as const)('given %s repair state when 渲染内容 then 阻止进入工作台并显示恢复提示', (repairState, message) => {
    const html = renderProjectTab({
      id: 'linguist-project:prj-0000000000000001',
      type: 'linguist-project',
      projectId: 'prj-0000000000000001',
      title: '游戏本地化',
      repairState,
    })

    expect(html).toContain(message)
    expect(html).not.toContain('正在打开本地化项目')
  })
})
