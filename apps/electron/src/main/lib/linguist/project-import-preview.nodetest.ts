import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { electronMock } from '../test/electron-mock'

mock.module('electron', { namedExports: electronMock })
const { LinguistProjectService } = await import('./project-service')
const { importProjectFile } = await import('./project-file-intake')

test('导入预检真实解析，Phrase 恢复要求不随扩展名改变', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'la-import-preview-'))
  const service = new LinguistProjectService({
    rootDir, applicationVersion: 'test', workspaceResolver: () => true,
  })
  service.init()
  try {
    const project = await service.createProject({
      name: 'Synthetic import', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'fixture-workspace',
    })
    const input = (paths: string[], dryRun: boolean) => ({ paths, recursive: false, kind: 'auto' as const, dryRun })
    const valid = join(rootDir, 'valid.xlf')
    writeFileSync(valid, '<xliff version="1.2"><file><body><trans-unit id="one"><source>Hello</source><target>你好</target></trans-unit></body></file></xliff>')
    const preview = await service.importResourcesFromPaths(project.id, rootDir, input([valid], true))
    assert.equal(preview.ready, 1)
    assert.equal(service.openProject(project.id).assets.listByProject().length, 0)
    const imported = await service.importResourcesFromPaths(project.id, rootDir, input([valid], false))
    assert.equal(imported.imported, 1)
    const duplicatePreview = await service.importResourcesFromPaths(project.id, rootDir, input([valid], true))
    assert.equal(duplicatePreview.ready, 0)
    assert.equal(duplicatePreview.skippedDuplicate, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([valid], false))).skippedDuplicate, 1)

    const malformed = join(rootDir, 'broken.xlf')
    writeFileSync(malformed, '<xliff version="1.2"><file><body><trans-unit id="one"><target>missing source</target></trans-unit></body></file></xliff>')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([malformed], true))).failed, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([malformed], false))).failed, 1)

    const malformedPhrase = join(rootDir, 'broken-phrase.mxliff')
    writeFileSync(malformedPhrase, '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>A</source><target>B</target></trans-unit></file></xliff>')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([malformedPhrase], true))).ready, 0)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([malformedPhrase], false))).imported, 0)

    const reversedWrapper = join(rootDir, 'reversed-wrapper.mxliff')
    writeFileSync(reversedWrapper, '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>&lt;u}hello{u></source><target>hello</target></trans-unit></body></file></xliff>')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([reversedWrapper], true))).ready, 0)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([reversedWrapper], false))).imported, 0)

    const sidecar = join(rootDir, 'working-copy.json')
    writeFileSync(sidecar, JSON.stringify({ artifactKind: 'linguist-working-copy', sourceSha256: 'a'.repeat(64) }))
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([sidecar], true))).ready, 0)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([sidecar], false))).imported, 0)

    const invalidTm = join(rootDir, 'invalid.tmx')
    writeFileSync(invalidTm, '<tmx><body><tu><tuv xml:lang="en"><seg>Only source</seg></tuv></tu></body></tmx>')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([invalidTm], true))).ready, 0)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([invalidTm], false))).imported, 0)
    const context = join(rootDir, 'guide.txt')
    writeFileSync(context, 'Synthetic style note')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([context], true))).ready, 1)
    assert.equal(service.openProject(project.id).contextDocs.count(), 0)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([context], false))).imported, 1)

    const phrase = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>'
    for (const extension of ['mxliff', 'xlf', 'xliff']) {
      const path = join(rootDir, `split.${extension}`)
      writeFileSync(path, phrase)
      const result = await service.importResourcesFromPaths(project.id, rootDir, input([path], true))
      assert.equal(result.ready, 0, `${extension} cannot claim ready without master`)
      assert.equal(result.needsInput, 1)
      await assert.rejects(service.importAsset(project.id, { filename: `split.${extension}`, bytes: Buffer.from(phrase) }), /master XLIFF/)
      await assert.rejects(importProjectFile(service, project.id, rootDir, path, 'batch'), /master XLIFF/)
    }

    const master = join(rootDir, 'master.xlf')
    writeFileSync(master, '<xliff version="1.2"><file><body><trans-unit id="one"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>')
    for (const extension of ['mxliff', 'xlf', 'xliff']) {
      const paired = await service.importResourcesFromPaths(project.id, rootDir, input([join(rootDir, `split.${extension}`), master], true))
      assert.equal(paired.ready, 1, `${extension} should parse with verified master`)
      assert.equal(paired.items.find((item) => item.filename === 'master.xlf')?.status, 'supporting')
    }
    assert.equal(service.openProject(project.id).assets.listByProject().length, 1)
    const importedPhrase = await service.importResourcesFromPaths(project.id, rootDir, input([join(rootDir, 'split.xlf'), master], false))
    assert.equal(importedPhrase.imported, 1)
    const phraseAssetId = importedPhrase.items.find((item) => item.filename === 'split.xlf')?.resourceId
    assert.ok(phraseAssetId)
    assert.equal(service.openProject(project.id).segments.query({ assetId: phraseAssetId })[0]?.source, 'Open <ph id="1">{0}</ph> world')
    const repeatPaths = [join(rootDir, 'split.xlf'), master]
    const repeatPreview = await service.importResourcesFromPaths(project.id, rootDir, input(repeatPaths, true))
    assert.equal(repeatPreview.skippedDuplicate, 1)
    assert.equal(repeatPreview.items.find((item) => item.filename === 'master.xlf')?.status, 'supporting')
    const repeatCommit = await service.importResourcesFromPaths(project.id, rootDir, input(repeatPaths, false))
    assert.equal(repeatCommit.skippedDuplicate, 1)
    assert.equal(repeatCommit.imported, 0)
    assert.equal(repeatCommit.items.find((item) => item.filename === 'master.xlf')?.status, 'supporting')
    const phraseDuplicate = await service.importResourcesFromPaths(project.id, rootDir, input([join(rootDir, 'split.xlf')], true))
    assert.equal(phraseDuplicate.skippedDuplicate, 1)
    assert.equal(phraseDuplicate.needsInput, 0)

    const native = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="native"><source>A <ph id="1">{0}</ph></source><target>B <ph id="1">{0}</ph></target></trans-unit></body></file></xliff>'
    const nativePath = join(rootDir, 'native.xliff')
    writeFileSync(nativePath, native)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([nativePath], true))).ready, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([nativePath], false))).imported, 1)

    const targetOnly = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="target-only"><source>Plain</source><target>Bad {0}</target></trans-unit></body></file></xliff>'
    const targetOnlyPath = join(rootDir, 'target-only.mxliff')
    writeFileSync(targetOnlyPath, targetOnly)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([targetOnlyPath], true))).needsInput, 1)
    await assert.rejects(service.importAsset(project.id, { filename: 'target-only.mxliff', bytes: Buffer.from(targetOnly) }), /target-only/)

    const targetWrapper = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="wrapper"><source>Hello</source><target>{u>Hello&lt;u}</target></trans-unit></body></file></xliff>'
    const targetWrapperPath = join(rootDir, 'target-wrapper.xlf')
    writeFileSync(targetWrapperPath, targetWrapper)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([targetWrapperPath], true))).needsInput, 1)
    await assert.rejects(service.importAsset(project.id, { filename: 'target-wrapper.xlf', bytes: Buffer.from(targetWrapper) }), /target-only/)

    const literal = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="literal"><source>Gain {0} points</source><target>获得 {0} 分</target></trans-unit></body></file></xliff>'
    const literalPath = join(rootDir, 'literal.xlf')
    const literalMasterPath = join(rootDir, 'literal-master.xlf')
    writeFileSync(literalPath, literal)
    writeFileSync(literalMasterPath, '<xliff version="1.2"><file><body><trans-unit id="literal"><source>Gain {0} points</source></trans-unit></body></file></xliff>')
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([literalPath, literalMasterPath], true))).ready, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([literalPath, literalMasterPath], false))).imported, 1)

    const repeatedTarget = join(rootDir, 'repeated-target.mxliff')
    const repeatedMaster = join(rootDir, 'repeated-master.xlf')
    const repeatedTargetText = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>A {0}</source><target>B {0} and {0}</target></trans-unit></body></file></xliff>'
    const repeatedMasterText = '<xliff version="1.2"><file><body><trans-unit id="one"><source>A <ph id="1">{0}</ph></source></trans-unit></body></file></xliff>'
    writeFileSync(repeatedTarget, repeatedTargetText)
    writeFileSync(repeatedMaster, repeatedMasterText)
    const assetsBefore = service.openProject(project.id).assets.listByProject().length
    const repeatedPaths = [repeatedTarget, repeatedMaster]
    const repeatedPreview = await service.importResourcesFromPaths(project.id, rootDir, input(repeatedPaths, true))
    assert.equal(repeatedPreview.ready, 0)
    assert.match(repeatedPreview.items.find((item) => item.filename === 'repeated-target.mxliff')?.message ?? '', /\[one\]/)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input(repeatedPaths, false))).imported, 0)
    assert.equal(service.openProject(project.id).assets.listByProject().length, assetsBefore)
    await assert.rejects(service.importAsset(project.id, {
      filename: 'repeated-target.mxliff', bytes: Buffer.from(repeatedTargetText),
      phraseMaster: { filename: 'repeated-master.xlf', bytes: Buffer.from(repeatedMasterText) },
    }), /unsupported-representation/)

    const unmatchedSplit = join(rootDir, 'unmatched-split.mxliff')
    const unmatchedMaster = join(rootDir, 'unmatched-master.xlf')
    writeFileSync(unmatchedSplit, '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Close {0}</source><target>关闭 {0}</target></trans-unit></body></file></xliff>')
    writeFileSync(unmatchedMaster, '<xliff version="1.2"><file><body><trans-unit id="other"><source>Unrelated source</source><target>无关译文</target></trans-unit></body></file></xliff>')
    const unmatchedPaths = [unmatchedSplit, unmatchedMaster]
    const unmatchedPreview = await service.importResourcesFromPaths(project.id, rootDir, input(unmatchedPaths, true))
    assert.equal(unmatchedPreview.ready, 0)
    assert.equal(unmatchedPreview.needsInput, 2)
    const unmatchedCommit = await service.importResourcesFromPaths(project.id, rootDir, input(unmatchedPaths, false))
    assert.equal(unmatchedCommit.imported, 0)
    assert.equal(unmatchedCommit.needsInput, 2)
    assert.equal(service.openProject(project.id).assets.listByProject().length, assetsBefore)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input([unmatchedMaster], true))).ready, 1)
    const duplicateWithWrongMaster = await service.importResourcesFromPaths(project.id, rootDir, input([join(rootDir, 'split.xlf'), unmatchedMaster], false))
    assert.equal(duplicateWithWrongMaster.imported, 0)
    assert.equal(duplicateWithWrongMaster.skippedDuplicate, 1)
    assert.equal(duplicateWithWrongMaster.items.find((item) => item.filename === 'unmatched-master.xlf')?.status, 'needs-input')
    await assert.rejects(service.importAsset(project.id, {
      filename: 'split.xlf', bytes: Buffer.from(phrase),
      phraseMaster: { filename: 'unmatched-master.xlf', bytes: Buffer.from('<xliff version="1.2"><file><body><trans-unit id="other"><source>Unrelated source</source><target>无关译文</target></trans-unit></body></file></xliff>') },
    }), /different mapping/)

    const conflictingSplit = join(rootDir, 'conflicting-split.mxliff')
    const tagCandidate = join(rootDir, 'tag-candidate.xlf')
    const literalCandidate = join(rootDir, 'literal-candidate.xlf')
    writeFileSync(conflictingSplit, '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Find {0}</source><target>找到 {0}</target></trans-unit></body></file></xliff>')
    writeFileSync(tagCandidate, '<xliff version="1.2"><file><body><trans-unit id="one"><source>Find <ph id="1">{0}</ph></source></trans-unit></body></file></xliff>')
    writeFileSync(literalCandidate, '<xliff version="1.2"><file><body><trans-unit id="one"><source>Find {0}</source></trans-unit></body></file></xliff>')
    const conflictingPaths = [conflictingSplit, tagCandidate, literalCandidate]
    const conflictingPreview = await service.importResourcesFromPaths(project.id, rootDir, input(conflictingPaths, true))
    assert.equal(conflictingPreview.ready, 0)
    assert.equal(conflictingPreview.needsInput, 3)
    assert.match(conflictingPreview.items.find((item) => item.filename === 'conflicting-split.mxliff')?.message ?? '', /解释不唯一/)
    assert.equal((await service.importResourcesFromPaths(project.id, rootDir, input(conflictingPaths, false))).imported, 0)
    assert.equal(service.openProject(project.id).assets.listByProject().length, assetsBefore)
  } finally {
    service.closeAll()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
