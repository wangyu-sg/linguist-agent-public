import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { LinguistProjectService } from './project-service'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'

function inlineCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
}

async function workbookBytes(target: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cover" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Strings" sheetId="2" r:id="rId2"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inlineCell('A1', 'Read me')}</row><row r="2">${inlineCell('A2', 'Cover only')}</row></sheetData></worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inlineCell('A1', 'String ID')}${inlineCell('B1', 'English')}${inlineCell('C1', 'Chinese')}${inlineCell('D1', 'Context')}${inlineCell('E1', 'Speaker')}${inlineCell('F1', 'Status')}</row><row r="2">${inlineCell('A2', 'menu.play')}${inlineCell('B2', 'Play')}${inlineCell('C2', target)}${inlineCell('D2', 'Main menu')}${inlineCell('E2', 'Narrator')}<c r="F2"><f>1+1</f><v>Draft</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="D2:E2"/></mergeCells></worksheet>`)
  return zip.generateAsync({ type: 'uint8array' })
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out))
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out))
  return out
}

test('Workbook Mapping: preview suggests columns, saves a profile, and reuses filename/header evidence', async () => {
  const root = makeTempDir()
  const service = new LinguistProjectService({
    rootDir: join(root, 'linguist'),
    entropy: makeEntropy('workbook-mapping'),
    now: makeClock(),
    workspaceCreator: () => 'ws-workbook',
  })
  service.init()
  const project = service.createProject({ name: 'Workbook', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const firstPath = join(root, 'game-001.xlsx')
  writeFileSync(firstPath, await workbookBytes('开始'))

  const preview = await service.previewWorkbookMapping(project.id, root, 'game-001.xlsx')
  assert.equal(preview.filename, 'game-001.xlsx')
  assert.equal(preview.sheets[0]?.state, 'hidden')
  const strings = preview.sheets.find((sheet) => sheet.name === 'Strings')!
  assert.deepEqual(strings.suggestion.columns, {
    key: 'String ID',
    source: 'English',
    target: 'Chinese',
    context: 'Context',
    speaker: 'Speaker',
    status: 'Status',
  })
  assert.equal(strings.suggestion.confidence, 0.95)
  assert.equal(strings.sampleRows[0]?.cells.find((cell) => cell.ref === 'F2')?.kind, 'formula-cached')
  assert.deepEqual(strings.mergedRanges, [{ ref: 'D2:E2', anchor: 'D2', coveredCells: 1 }])
  assert.equal(collectStrings(preview).some((value) => value.includes(root)), false)

  const reverse = service.createProject({ name: 'Reverse', sourceLocale: 'zh-CN', targetLocale: 'en' })
  const reverseSuggestion = (await service.previewWorkbookMapping(reverse.id, root, firstPath))
    .sheets.find((sheet) => sheet.name === 'Strings')!.suggestion.columns
  assert.equal(reverseSuggestion.source, 'Chinese')
  assert.equal(reverseSuggestion.target, 'English')

  const profile = await service.saveWorkbookMapping(project.id, root, firstPath, {
    name: 'Game workbook',
    filenamePattern: 'game-*.xlsx',
    sheetName: 'Strings',
    columns: strings.suggestion.columns as {
      key: string
      source: string
      target: string
      context: string
      speaker: string
      status: string
    },
  })
  assert.equal(service.getProject(project.id).workbookMappings?.[0]?.id, profile.id)

  const secondPath = join(root, 'game-002.xlsx')
  writeFileSync(secondPath, await workbookBytes('游玩'))
  const reusedPreview = await service.previewWorkbookMapping(project.id, root, secondPath)
  assert.equal(reusedPreview.matchedProfileId, profile.id)
  const imported = await service.importFileResource(project.id, root, 'game-002.xlsx', 'batch')
  assert.equal(imported.status, 'imported')
  const segments = service.openProject(project.id).segments.query({ limit: 10 })
  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.key, 'menu.play')
  assert.equal(segments[0]?.source, 'Play')
  assert.equal(segments[0]?.target, '游玩')
  assert.equal(segments[0]?.context?.note, 'Main menu')

  await assert.rejects(
    service.saveWorkbookMapping(project.id, root, firstPath, {
      sheetName: 'Strings',
      columns: { source: 'English', target: 'English' },
    }),
    /missing, ambiguous, or reused/,
  )
  service.closeAll()
})

test('Workbook Mapping: ambiguous filename/header profiles only reuse identical mapping semantics', async () => {
  const root = makeTempDir()
  const service = new LinguistProjectService({
    rootDir: join(root, 'linguist'),
    entropy: makeEntropy('workbook-mapping-ambiguity'),
    now: makeClock(),
    workspaceCreator: () => 'ws-workbook-ambiguity',
  })
  service.init()
  const firstPath = join(root, 'game-001.xlsx')
  const secondPath = join(root, 'game-002.xlsx')
  writeFileSync(firstPath, await workbookBytes('开始'))
  writeFileSync(secondPath, await workbookBytes('游玩'))
  const normal = {
    sheetName: 'Strings',
    columns: { key: 'String ID', source: 'English', target: 'Chinese', context: 'Context' },
  }

  const conflicting = service.createProject({ name: 'Conflicting', sourceLocale: 'en', targetLocale: 'zh-CN' })
  await service.saveWorkbookMapping(conflicting.id, root, firstPath, {
    ...normal,
    filenamePattern: 'game-*.xlsx',
  })
  await service.saveWorkbookMapping(conflicting.id, root, firstPath, {
    sheetName: 'Strings',
    filenamePattern: 'game-002.xlsx',
    columns: { key: 'String ID', source: 'Chinese', target: 'English', context: 'Context' },
  })
  assert.equal((await service.previewWorkbookMapping(conflicting.id, root, firstPath)).matchedProfileId, undefined)
  assert.equal((await service.previewWorkbookMapping(conflicting.id, root, secondPath)).matchedProfileId, undefined)

  const equivalent = service.createProject({ name: 'Equivalent', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const first = await service.saveWorkbookMapping(equivalent.id, root, firstPath, {
    ...normal,
    filenamePattern: 'game-*.xlsx',
  })
  const second = await service.saveWorkbookMapping(equivalent.id, root, firstPath, {
    ...normal,
    filenamePattern: 'game-002.xlsx',
  })
  assert.equal(
    (await service.previewWorkbookMapping(equivalent.id, root, firstPath)).matchedProfileId,
    [first.id, second.id].sort()[0],
  )
  const reused = await service.previewWorkbookMapping(equivalent.id, root, secondPath)
  assert.equal(reused.matchedProfileId, [first.id, second.id].sort()[0])
  service.closeAll()
})
