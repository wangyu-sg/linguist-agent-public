import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProposalCoverageBanner } from './ProposalInbox'

describe('Proposal Inbox 覆盖范围', () => {
  test('given 审校阶段包含无修改确认 when 展示项目级收件箱 then 区分覆盖与没有建议', () => {
    const html = renderToStaticMarkup(
      <ProposalCoverageBanner
        coverage={{
          workflowStage: 'editing',
          totalSegments: 102,
          confirmedSegments: 80,
        }}
      />,
    )

    expect(html).toContain('本轮覆盖：已审校 80 / 102')
    expect(html).toContain('未覆盖 22')
    expect(html).toContain('检查后无需修改')
    expect(html).toContain('没有建议本身不计为已覆盖')
  })
})
