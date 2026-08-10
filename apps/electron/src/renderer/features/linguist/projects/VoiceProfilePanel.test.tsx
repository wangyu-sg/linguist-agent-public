import { describe, expect, test } from 'bun:test'
import { Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { VoiceProfilePanel } from './VoiceProfilePanel'

describe('VoiceProfilePanel', () => {
  test('given Voice 区 when 项目可写 then 可让 Agent 从已确认台词总结角色声音', () => {
    const html = renderToStaticMarkup(
      <Provider>
        <VoiceProfilePanel projectId="prj-0000000000000001" archived={false} />
      </Provider>,
    )
    expect(html).toContain('让 Agent 从已确认台词总结角色声音')
  })
})
