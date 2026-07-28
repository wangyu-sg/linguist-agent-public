import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = readFileSync(join(import.meta.dir, 'probe-cat-tools.ts'), 'utf8')

describe('CAT Tools packaged 探针合同', () => {
  test('given 当前 Segment 编辑器 when 审核 Proposal then 只使用现行行级无障碍名称', () => {
    expect(probe).toContain('section[aria-label="Segment 编辑器"]')
    expect(probe).toContain("name: '选择原始行 2'")
    expect(probe).toContain("name: '选择原始行 3'")
    expect(probe).toContain('section[aria-label="当前行翻译建议"]')
    expect(probe).toContain("name: 'Accept'")
    expect(probe).toContain("name: 'Reject'")
    expect(probe).not.toContain('section[aria-label="CAT 工作区"]')
    expect(probe).not.toContain('选择片段 ')
    expect(probe).not.toContain('Context Rail')
  })
})
