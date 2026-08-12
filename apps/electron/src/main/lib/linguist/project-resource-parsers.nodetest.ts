import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import JSZip from 'jszip'
import { parseTermReference, parseTmReference } from './project-resource-parsers'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void
    close: () => void
  }
}

test('SDLTM 原生文件解析为项目 TM 条目', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'linguist-sdltm-test-'))
  const path = join(dir, 'memory.sdltm')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE translation_memories(
      id INTEGER PRIMARY KEY,
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL
    );
    CREATE TABLE translation_units(
      id INTEGER PRIMARY KEY,
      translation_memory_id INTEGER NOT NULL,
      source_segment TEXT,
      target_segment TEXT
    );
    INSERT INTO translation_memories VALUES (1, 'zh-CN', 'en-US');
    INSERT INTO translation_units VALUES (
      1,
      1,
      '<Segment><Elements><Text><Value>合成峡谷</Value></Text></Elements></Segment>',
      '<Segment><Elements><Text><Value>Synthetic Gorge</Value></Text></Elements></Segment>'
    );
  `)
  db.close()
  try {
    const parsed = await parseTmReference(
      { bytes: readFileSync(path), filename: 'memory.sdltm' },
      'zh-CN',
      'en-US',
    )
    assert.deepEqual(parsed.entries.map(({ source, target }) => ({ source, target })), [{
      source: '合成峡谷',
      target: 'Synthetic Gorge',
    }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('XLSX 明确列映射可注册为术语库', async () => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Terms" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>中文</t></is></c><c r="B1" t="inlineStr"><is><t>English</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>合成峡谷</t></is></c><c r="B2" t="inlineStr"><is><t>Synthetic Gorge</t></is></c></row></sheetData></worksheet>`)
  const parsed = await parseTermReference({
    bytes: await zip.generateAsync({ type: 'uint8array' }),
    filename: 'terms.xlsx',
    xlsxMapping: { sheetName: 'Terms', columns: { source: '中文', target: 'English' } },
  }, 'zh-CN', 'en-US')
  assert.deepEqual(parsed.entries.map(({ term, translation }) => ({ term, translation })), [{
    term: '合成峡谷',
    translation: 'Synthetic Gorge',
  }])
})
