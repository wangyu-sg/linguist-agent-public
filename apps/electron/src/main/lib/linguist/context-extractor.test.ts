import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { extractContext } from './context-extractor'

async function minimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Keep both brand logos.</w:t></w:r></w:p></w:body>
    </w:document>`)
  return zip.generateAsync({ type: 'uint8array' })
}

function minimalPdf(text: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length + 31} >>\nstream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(source.length)
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(source)
}

describe('通用 Context extractor', () => {
  test('DOCX 与 PDF 产出可定位文本，独立图片产出视觉锚点', async () => {
    const docx = await extractContext(await minimalDocx(), 'brief.docx')
    expect(docx.textSections.map((section) => section.text).join(' ')).toContain('both brand logos')
    expect(docx.anchors[0]?.locator.kind).toBe('paragraph')

    const pdf = await extractContext(minimalPdf('Pull down, not collide.'), 'direction.pdf')
    expect(pdf.textSections[0]?.text).toContain('Pull down')
    expect(pdf.anchors[0]?.locator).toEqual({ kind: 'page', page: 1 })

    const png = await extractContext(new Uint8Array([137, 80, 78, 71]), 'frame.png')
    expect(png.media).toHaveLength(1)
    expect(png.anchors[0]?.locator.kind).toBe('image')
    expect(png.anchors[0]?.mediaId).toBe(png.media[0]?.id)
  })

  test('未知格式形成显式 warning，不伪造正文', async () => {
    const result = await extractContext(new Uint8Array([1, 2, 3]), 'evidence.bin')
    expect(result.textSections).toEqual([])
    expect(result.warnings[0]?.code).toBe('context_extraction.unsupported_format')
  })
})
