import { expect, test } from 'bun:test'
import { LINGUIST_BUILD_METADATA } from '../apps/electron/src/renderer/lib/linguist-build-metadata'

test('About 与诊断页显示机器登记的 Proma 基线', async () => {
  const baseline = await Bun.file(new URL(
    '../docs/architecture/proma-baseline.json',
    import.meta.url,
  )).json() as {
    upstream: { tag: string; commit: string }
    formalMerge: { commit: string }
  }

  expect(`v${LINGUIST_BUILD_METADATA.promaBaseVersion}`).toBe(baseline.upstream.tag)
  expect(String(LINGUIST_BUILD_METADATA.promaBaseCommit)).toBe(baseline.upstream.commit)
  expect(String(LINGUIST_BUILD_METADATA.formalMergeCommit)).toBe(baseline.formalMerge.commit)
})
