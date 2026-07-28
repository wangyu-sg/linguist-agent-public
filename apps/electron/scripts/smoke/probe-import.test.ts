import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = readFileSync(join(import.meta.dir, 'probe-import.ts'), 'utf8')

describe('LF-048 packaged 手工 CAT Gate 合同', () => {
  test('given 当前 Linguist Workbench when 执行 Gate then 不再依赖已删除的 ProjectDetail 导航或 Agent', () => {
    expect(probe).toContain('本地化工作台')
    expect(probe).toContain('section[aria-label="Segment 编辑器"]')
    expect(probe).toContain('Segment Grid')
    expect(probe).toContain('语言资源')
    expect(probe).toContain('project-sessions-remain-empty')
    expect(probe).toContain('查看原始行')
    expect(probe).toContain('编辑原始行')
    expect(probe).not.toContain('section[aria-label="CAT 工作区"]')
    expect(probe).not.toContain('查看片段')
    expect(probe).not.toContain('编辑片段')
    expect(probe).not.toContain("getByRole('tab', { name: 'CAT'")
    expect(probe).not.toContain('Context Rail')
    expect(probe).not.toContain('返回项目列表')
  })

  test('given 无 Agent 手工工作流 when 探针完成 then 覆盖编辑、资源、QA、10k 与重启恢复', () => {
    for (const checkName of [
      'cat-edit-cancel',
      'cat-edit-save-tag-placeholder',
      'cat-edit-confirm-and-advance',
      'cat-edit-cas-conflict-no-overwrite',
      'cat-locked-fail-closed',
      'cat-tm-replace-draft',
      'cat-term-insert-draft',
      'cat-qa-without-agent',
      'pb033-assets-metadata-and-export-preflight',
      'pb033-archived-readonly-and-temp-home',
      'cat-10k-virtual-scroll-anchor',
      'cat-keyboard-a11y-row-navigation',
      'restart-recovers-manual-cat-state',
    ]) {
      expect(probe).toContain(`'${checkName}'`)
    }
  })

  test('given 系统级能力无法由 Playwright 可靠驱动 when 汇总证据 then 明确记为 MANUAL', () => {
    expect(probe).toContain("manual('real-ime'")
    expect(probe).toContain("manual('native-save-dialog'")
    expect(probe).not.toContain("manual('voiceover'")
    expect(probe).toContain('PASS / ${failed} FAIL / ${manualCount} MANUAL')
  })

  test('given --manual-verify when 人工完成 Native Save 与真实 IME then 探针自行核验磁盘和 CAT 权威状态', () => {
    expect(probe).toContain("const MANUAL_VERIFY = process.argv.includes('--manual-verify')")
    expect(probe).toContain('LF048_MANUAL_DONE')
    for (const label of [
      'artifact:',
      'source:',
      'safe-export:',
      'sentinel:',
      'ime-target:',
    ]) {
      expect(probe).toContain(label)
    }
    expect(probe).toContain('await waitForManualSentinel(sentinelPath)')
    expect(probe).toContain("'manual-native-save-artifact-and-rejection-verified'")
    expect(probe).toContain("'manual-ime-cat-state-verified'")
    expect(probe).toContain("cliField(verifiedExport, 'verify') === 'OK'")
    expect(probe).toContain('manualState.target === MANUAL_IME_TARGET')
    expect(probe).toContain('manualState.revision === 4')
    expect(probe).toContain('placeholderCount(MANUAL_IME_TARGET, \'{player}\') === 1')
    expect(probe).toContain('isStaleEditRejectedByCas(')
    expect(probe).toContain("addEventListener('compositionstart'")
    expect(probe).toContain('commandEnterDuringComposition')
    expect(probe).toContain("document.title = 'LF-048 Manual Verification'")
    expect(probe).toContain('await page.bringToFront()')
    expect(probe).toContain("execFileSync('/bin/cp', ['-cR'")
    expect(probe).toContain('CFBundleIdentifier')
    expect(probe).toContain('LF048_MANUAL_BUNDLE_ID')
    expect(probe).not.toContain("setPlistString(infoPlist, 'CFBundleName'")
    expect(probe).toContain("join(PACKAGED_APP, 'Contents', 'Resources', 'app.asar')")
    expect(probe).toContain('manualClone.sourceAsarSha === manualClone.clonedAsarSha')
    expect(probe).toContain('rmSync(manualClone.rootDir, { recursive: true, force: true })')
    expect(probe).toContain('MANUAL_SENTINEL_TIMEOUT_MS')
    expect(probe).toContain('element.isConnected')
    expect(probe).toContain('}, 150)')
    expect(probe).toContain('nativeSaveEvidence.rejectionObserved')
    expect(probe).toContain("text.includes('导出目标已存在')")
    expect(probe).toContain('sample < 20')
    expect(probe).toContain('p95 <= 200')
    expect(probe).not.toContain('JSON.parse(readFileSync(sentinelPath')
  })
})
