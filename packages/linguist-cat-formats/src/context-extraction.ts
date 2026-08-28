import JSZip from 'jszip'
import type {
  ContextExtraction,
  ContextMedia,
  ExtractedContextAnchor,
} from '@linguist/cat-core'
import { sha256Hex } from './hash'
import { FormatParseError } from './errors'
import { descendants, parseXml } from './xml-parser'
import { parseAttrs } from './adapters/xliff-xml'
import {
  attrValue,
  columnLettersFromIndex,
  elementAttrByLocalName,
  resolveZipPath,
  scanElements,
} from './adapters/xlsx'
import { parseXlsxWorkbook } from './workbook'

const PARSER_ID = 'xlsx_context'
const encoder = new TextEncoder()

interface PackageRelationship {
  target: string
  external: boolean
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256Hex(encoder.encode(parts.join('\u0000'))).slice(0, 24)}`
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

function relationshipsPath(partPath: string): string {
  return `${directoryOf(partPath)}/_rels/${basenameOf(partPath)}.rels`
}

function mimeTypeOf(filename: string): string {
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

async function relationships(
  zip: JSZip,
  partPath: string,
  filename: string,
): Promise<Map<string, PackageRelationship>> {
  const relsPath = relationshipsPath(partPath)
  const entry = zip.file(relsPath)
  if (entry === null) {
    throw new FormatParseError(PARSER_ID, filename, `${relsPath} missing for referenced drawing/media`)
  }
  const doc = parseXml(await entry.async('uint8array'), PARSER_ID, filename)
  const result = new Map<string, PackageRelationship>()
  for (const relation of descendants(doc, 'relationship')) {
    const id = relation.getAttribute('Id')
    const target = relation.getAttribute('Target')
    if (id !== null && id !== '' && target !== null && target !== '') {
      result.set(id, {
        target,
        external: relation.getAttribute('TargetMode') === 'External',
      })
    }
  }
  return result
}

function coordinate(anchor: Element, name: 'from' | 'to'): { row: number; col: number } | undefined {
  const point = descendants(anchor, name)[0]
  if (point === undefined) return undefined
  const row = Number(descendants(point, 'row')[0]?.textContent)
  const col = Number(descendants(point, 'col')[0]?.textContent)
  return Number.isInteger(row) && row >= 0 && Number.isInteger(col) && col >= 0
    ? { row: row + 1, col }
    : undefined
}

async function extractWorkbookMedia(
  zip: JSZip,
  workbookHash: string,
  filename: string,
  sheets: readonly { name: string; partPath: string }[],
): Promise<Pick<ContextExtraction, 'media' | 'anchors' | 'warnings'>> {
  const media = new Map<string, ContextMedia>()
  const anchors: ExtractedContextAnchor[] = []
  const warnings: ContextExtraction['warnings'] = []

  for (const sheet of sheets) {
    const sheetEntry = zip.file(sheet.partPath)
    if (sheetEntry === null) {
      throw new FormatParseError(PARSER_ID, filename, `${sheet.partPath} disappeared during drawing extraction`)
    }
    const sheetText = new TextDecoder('utf-8', { fatal: true })
      .decode(await sheetEntry.async('uint8array'))
    const drawingSpans = scanElements(sheetText, 'drawing', 0, sheetText.length, (detail) => {
      throw new FormatParseError(PARSER_ID, filename, detail)
    })
    if (drawingSpans.length === 0) continue
    const sheetRelationships = await relationships(zip, sheet.partPath, filename)

    for (const drawingSpan of drawingSpans) {
      const drawingId = attrValue(parseAttrs(drawingSpan.attrsRaw), 'id')
      const drawingRelationship = drawingId === undefined ? undefined : sheetRelationships.get(drawingId)
      if (drawingRelationship === undefined || drawingRelationship.external) {
        throw new FormatParseError(PARSER_ID, filename, `sheet ${JSON.stringify(sheet.name)} has an unresolved drawing relationship`)
      }
      const drawingPath = resolveZipPath(directoryOf(sheet.partPath), drawingRelationship.target)
      const drawingEntry = zip.file(drawingPath)
      if (drawingEntry === null) {
        throw new FormatParseError(PARSER_ID, filename, `drawing part ${drawingPath} is missing`)
      }
      const drawingDoc = parseXml(await drawingEntry.async('uint8array'), PARSER_ID, filename)
      const drawingRelationships = await relationships(zip, drawingPath, filename)
      const placements = [
        ...descendants(drawingDoc, 'twoCellAnchor'),
        ...descendants(drawingDoc, 'oneCellAnchor'),
        ...descendants(drawingDoc, 'absoluteAnchor'),
      ]
      for (const placement of placements) {
        const blip = descendants(placement, 'blip')[0]
        const embedId = blip === undefined ? undefined : elementAttrByLocalName(blip, 'embed')
        const imageRelationship = embedId === undefined ? undefined : drawingRelationships.get(embedId)
        if (imageRelationship === undefined || imageRelationship.external) {
          throw new FormatParseError(PARSER_ID, filename, `drawing ${drawingPath} has an unresolved embedded image`)
        }
        const mediaPath = resolveZipPath(directoryOf(drawingPath), imageRelationship.target)
        const mediaEntry = zip.file(mediaPath)
        if (mediaEntry === null) {
          throw new FormatParseError(PARSER_ID, filename, `embedded image ${mediaPath} is missing`)
        }
        const bytes = await mediaEntry.async('uint8array')
        const mediaId = stableId('ctxm', workbookHash, mediaPath)
        if (!media.has(mediaId)) {
          const mediaFilename = basenameOf(mediaPath)
          const mimeType = mimeTypeOf(mediaFilename)
          media.set(mediaId, {
            id: mediaId,
            filename: mediaFilename,
            mimeType,
            bytes,
            sha256: sha256Hex(bytes),
          })
          if (mimeType === 'application/octet-stream') {
            warnings.push({
              code: 'xlsx_context.unsupported_media_type',
              message: `embedded media ${JSON.stringify(mediaFilename)} was preserved but its MIME type is unsupported`,
            })
          }
        }
        const from = coordinate(placement, 'from')
        const cell = from === undefined ? undefined : `${columnLettersFromIndex(from.col)}${from.row}`
        anchors.push({
          id: stableId('ctxa', workbookHash, sheet.name, drawingPath, embedId ?? mediaPath, cell ?? 'absolute'),
          locator: {
            kind: 'image',
            mediaId,
            sheet: sheet.name,
            ...(from === undefined ? {} : { row: from.row, cell }),
          },
          label: `${sheet.name}${cell === undefined ? '' : `!${cell}`}: ${basenameOf(mediaPath)}`,
          mediaId,
        })
      }
    }
  }
  return { media: [...media.values()], anchors, warnings }
}

/** 完整 XLSX Context 适配器：多 Sheet 文本、物理单元格和 drawing 媒体共享一套锚点。 */
export async function extractXlsxContext(
  bytes: Uint8Array,
  filename: string,
): Promise<ContextExtraction> {
  const workbook = await parseXlsxWorkbook(bytes, { filename })
  const textSections: ContextExtraction['textSections'] = []
  const anchors: ContextExtraction['anchors'] = []
  for (const sheet of workbook.sheets) {
    const rows = [...sheet.skippedRowsAboveHeader, ...sheet.headers, ...sheet.rows]
      .sort((left, right) => left.rowNo - right.rowNo)
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.value === '') continue
        const anchorId = stableId('ctxa', workbook.report.sourceSha256, sheet.name, cell.ref)
        const sectionId = stableId('ctxs', workbook.report.sourceSha256, sheet.name, cell.ref, cell.value)
        textSections.push({ id: sectionId, anchorId, text: cell.value })
        anchors.push({
          id: anchorId,
          locator: { kind: 'sheet', sheet: sheet.name, row: row.rowNo, cell: cell.ref },
          label: `${sheet.name}!${cell.ref}`,
          textSectionId: sectionId,
        })
      }
    }
  }
  const zip = await JSZip.loadAsync(bytes)
  const extractedMedia = await extractWorkbookMedia(
    zip,
    workbook.report.sourceSha256,
    filename,
    workbook.sheets,
  )
  return {
    textSections,
    media: extractedMedia.media,
    anchors: [...anchors, ...extractedMedia.anchors],
    warnings: [
      ...workbook.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
      ...extractedMedia.warnings,
    ],
  }
}
