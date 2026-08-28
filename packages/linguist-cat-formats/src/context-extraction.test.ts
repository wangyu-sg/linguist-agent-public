import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { extractXlsxContext } from './context-extraction'

const WORKBOOK_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

async function anonymousHeterogeneousWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip()
  const rows = Array.from({ length: 79 }, (_, index) => {
    const row = index + 2
    return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>scene-${index + 1}</t></is></c><c r="B${row}" t="inlineStr"><is><t>${index === 0 ? 'pull down' : `direction-${index + 1}`}</t></is></c></row>`
  }).join('')
  const imageRelationships = Array.from({ length: 64 }, (_, index) =>
    `<Relationship Id="rIdImage${index + 1}" Type="${REL_NS}/image" Target="../media/frame-${index + 1}.png"/>`).join('')
  const imageAnchors = Array.from({ length: 64 }, (_, index) => {
    const row = index + 1
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>${row}</xdr:row></xdr:from>
      <xdr:to><xdr:col>2</xdr:col><xdr:row>${row + 1}</xdr:row></xdr:to>
      <xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage${index + 1}"/></xdr:blipFill></xdr:pic>
    </xdr:twoCellAnchor>`
  }).join('')
  zip.file('xl/workbook.xml', `<?xml version="1.0"?>
    <workbook xmlns="${WORKBOOK_NS}" xmlns:r="${REL_NS}"><sheets>
      <sheet name="Brief" sheetId="1" r:id="rId1"/>
      <sheet name="Hidden Notes" sheetId="2" state="veryHidden" r:id="rId2"/>
    </sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>
    </Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?>
    <worksheet xmlns="${WORKBOOK_NS}" xmlns:r="${REL_NS}">
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c><c r="B1" t="inlineStr"><is><t>Direction</t></is></c></row>
        ${rows}
      </sheetData>
      <drawing r:id="rIdDrawing"/>
    </worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0"?>
    <worksheet xmlns="${WORKBOOK_NS}"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Internal</t></is></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>Keep direction literal</t></is></c></row>
    </sheetData></worksheet>`)
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdDrawing" Type="${REL_NS}/drawing" Target="../drawings/drawing1.xml"/>
    </Relationships>`)
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}">
      ${imageAnchors}
    </xdr:wsDr>`)
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${imageRelationships}
    </Relationships>`)
  for (let index = 0; index < 64; index++) {
    zip.file(`xl/media/frame-${index + 1}.png`, new Uint8Array([137, 80, 78, 71, index]))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

describe('Context Extraction', () => {
  test('匿名异构 XLSX 提取 79 行、64 张嵌入图片及其 drawing 锚点', async () => {
    const extraction = await extractXlsxContext(await anonymousHeterogeneousWorkbook(), 'brief.xlsx')

    expect(extraction.textSections.some((section) => section.text === 'pull down')).toBe(true)
    expect(extraction.anchors.some((anchor) =>
      anchor.locator.kind === 'sheet'
      && anchor.locator.sheet === 'Brief'
      && anchor.locator.row === 2
      && anchor.locator.cell === 'B2')).toBe(true)
    expect(extraction.textSections.filter((section) => section.text.startsWith('scene-'))).toHaveLength(79)
    expect(extraction.media).toHaveLength(64)
    expect(extraction.media[0]?.filename).toBe('frame-1.png')
    expect(extraction.anchors.some((anchor) =>
      anchor.locator.kind === 'image'
      && anchor.locator.sheet === 'Brief'
      && anchor.locator.row === 2
      && anchor.locator.cell === 'B2')).toBe(true)
    expect(extraction.warnings.some((warning) => warning.code === 'xlsx_workbook.nonvisible_sheet_scanned')).toBe(true)
  })
})
