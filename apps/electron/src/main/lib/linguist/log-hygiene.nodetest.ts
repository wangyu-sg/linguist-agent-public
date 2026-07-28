/**
 * PB-110 主进程日志卫生（node --test）：钉住计划 §7.4「logs 不泄漏客户
 * 正文」在 linguist 服务层的纪律（cat-tools 包的等价断言见
 * tools.nodetest.ts 的 zero console 用例）。
 *
 * 做法：劫持 console.log/info/warn/error，跑一轮含敏感标记串的真实项目
 * 全流程（建项目 → 导入正文/译文均埋 SENTINEL 的 XLIFF → QA → 导出
 * staging → 健康检查），断言每一次 console 调用的参数序列化后都不含
 * SENTINEL。同时断言 SENTINEL 确实流过了管道（段与导出产物均含它），
 * 证明断言非空转。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INPUT, makeService } from './test/service-testkit'

const SENTINEL = 'SENTINEL_SECRET_7f3a9'

/** 正文与译文都埋 sentinel 的最小 XLIFF（全 translated，QA 无阻断项）。 */
const SENTINEL_XLIFF = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="sentinel.po" source-language="en" target-language="zh-CN" datatype="x-synthetic">
    <body>
      <trans-unit id="secret.alpha">
        <source>${SENTINEL} launch sequence</source>
        <target state="translated">启动序列 ${SENTINEL}</target>
      </trans-unit>
      <trans-unit id="secret.beta">
        <source>Second line with ${SENTINEL} inside</source>
        <target state="translated">第二行包含 ${SENTINEL}</target>
      </trans-unit>
    </body>
  </file>
</xliff>
`

function serialize(args: unknown[]): string {
  return args
    .map((arg) => {
      try {
        return JSON.stringify(arg) ?? String(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

test('PB-110: 含客户正文的全流程跑完，主进程 console 输出绝不含正文 sentinel', async () => {
  const service = makeService()
  const captured: string[] = []
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const capture = (...args: unknown[]) => {
    captured.push(serialize(args))
  }
  console.log = capture
  console.info = capture
  console.warn = capture
  console.error = capture
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: new TextEncoder().encode(SENTINEL_XLIFF),
      filename: 'sentinel.xliff',
    })
    assert.ok(imported.segmentCount > 0)

    // QA + 导出 staging + 健康检查：全流程的日志点都跑到
    service.runQa(project.id)
    const staged = await service.stageExport(project.id, imported.assetId)
    const health = service.checkProjectHealth(project.id)
    assert.equal(health.healthy, true)

    // sentinel 确实流过管道：段里有，导出产物里也有（断言非空转）
    const db = service.openProject(project.id)
    const segments = db.segments.query({ limit: 10 })
    assert.ok(segments.some((segment) => segment.source.includes(SENTINEL)))
    assert.ok(segments.some((segment) => segment.target.includes(SENTINEL)))
    const exportedFiles = service.listExportFiles(project.id)
    assert.equal(exportedFiles.length, 1)
    const exportedBytes = readFileSync(
      join(service.getProjectPaths(project.id).exportsDir, exportedFiles[0]!.filename),
      'utf8',
    )
    assert.ok(exportedBytes.includes(SENTINEL))
    assert.ok(staged.artifact.segmentCount > 0)
  } finally {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
    service.closeAll()
  }

  assert.ok(captured.length > 0, '全流程应产生日志（否则本断言空转）')
  for (const line of captured) {
    assert.ok(!line.includes(SENTINEL), `console 输出泄漏客户正文: ${line}`)
  }
})
