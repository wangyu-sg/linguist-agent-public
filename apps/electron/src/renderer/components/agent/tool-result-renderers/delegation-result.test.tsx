import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DelegationResultRenderer } from './delegation-result'

const REVIEWER_OUTCOME = {
  role: 'reviewer',
  stage: 'editing',
  total: 101,
  confirmed: 0,
  unchanged: 72,
  corrected: 29,
  blocked: 0,
  pending: 0,
  status: 'complete',
  decided: 101,
}

const TRANSLATOR_OUTCOME = {
  role: 'translator',
  stage: 'translation',
  total: 101,
  confirmed: 98,
  unchanged: 0,
  corrected: 0,
  blocked: 3,
  pending: 0,
  status: 'completed_with_blocks',
  decided: 101,
}

function renderResult(payload: unknown, isError = false): string {
  return renderToStaticMarkup(
    <DelegationResultRenderer result={JSON.stringify(payload)} isError={isError} />,
  )
}

describe('DelegationResultRenderer', () => {
  test('given 已结束但 CAT 未完成的审校委派 when 渲染 then 子会话状态与 CAT 阶段结果分行且不互相推断', () => {
    const html = renderResult({
      delegations: [
        {
          title: '审校当前批次',
          status: 'completed',
          linguistOutcome: {
            ...REVIEWER_OUTCOME,
            corrected: 24,
            blocked: 5,
            pending: 5,
            status: 'in_progress',
            decided: 96,
          },
        },
        {
          title: '复审修正段',
          status: 'running',
          linguistOutcome: REVIEWER_OUTCOME,
        },
      ],
    })

    // 子会话状态如实展示：已结束 / 运行中
    expect(html).toContain('已结束')
    expect(html).toContain('运行中')
    // “已结束”不推断为“已完成”：第一张卡是未完成（含阻塞），第二张才是已完成
    expect(html).toContain('审校覆盖 96 / 101 · 未修改 72 · 已修正 24 · 阻塞 5')
    expect(html).toContain('未完成')
    expect(html).toContain('审校覆盖 101 / 101 · 未修改 72 · 已修正 29 · 阻塞 0')
    expect(html).toContain('已完成')
    // 岗位标签
    expect(html).toContain('审校')
  })

  test('given 翻译委派带阻塞 when 渲染 then 显示确认口径与有阻塞', () => {
    const html = renderResult({ delegation: { title: '翻译批次', status: 'completed', linguistOutcome: TRANSLATOR_OUTCOME } })

    expect(html).toContain('翻译覆盖 98 / 101 · 阻塞 3')
    expect(html).toContain('有阻塞')
    expect(html).not.toContain('未修改')
  })

  test('given 普通委派（无 linguistOutcome） when 渲染 then 回退默认渲染器不显示岗位与覆盖', () => {
    const html = renderResult({
      delegations: [{ title: '整理 README', status: 'completed' }],
    })

    expect(html).not.toContain('覆盖')
    expect(html).not.toContain('审校')
    // 默认渲染器的 key-value 表格仍展示原始字段
    expect(html).toContain('delegations')
  })

  test('given 损坏的旧委派结果 when 渲染 then 安全回退默认结果而不崩溃', () => {
    const html = renderResult({ delegations: [null, { linguistOutcome: {} }] })

    expect(html).toContain('delegations')
    expect(html).not.toContain('覆盖')
  })
})
