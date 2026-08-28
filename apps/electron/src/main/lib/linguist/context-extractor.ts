import { extname } from 'node:path'
import {
  sha256Hex,
  type ContextExtraction,
  type ContextTextSection,
  type ExtractedContextAnchor,
} from '@linguist/cat-core'
import { extractXlsxContext } from '@linguist/cat-formats'
import { LinguistContextDocExtractError } from './errors'

export const CONTEXT_DOC_TEXT_EXTRACT_MAX_CHARS = 200_000

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}
const encoder = new TextEncoder()

interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>
}

interface OfficeParserModule {
  parseOfficeAsync(file: Buffer): Promise<string>
}

interface PdfJsModule {
  getDocument(src: {
    data: Uint8Array
    disableFontFace: boolean
    isEvalSupported: boolean
    useWorkerFetch: boolean
  }): { promise: Promise<PdfDocument> }
}

interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>
  }>
  destroy(): Promise<void> | void
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256Hex(encoder.encode(parts.join('\u0000'))).slice(0, 24)}`
}

function isPdfTextItem(item: unknown): item is { str: string; hasEOL?: boolean } {
  return typeof item === 'object' && item !== null
    && 'str' in item && typeof (item as { str: unknown }).str === 'string'
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes)
  let parserAcceptedDocument = false
  try {
    const mammoth = await import('mammoth') as unknown as MammothModule
    const result = await mammoth.extractRawText({ buffer })
    parserAcceptedDocument = true
    if (result.value.trim().length > 0) return result.value
  } catch {
    // 固定诊断在两种解析器均尝试后统一产出，不暴露解析器或路径细节。
  }
  try {
    const officeParser = await import('officeparser') as unknown as OfficeParserModule
    const text = await officeParser.parseOfficeAsync(buffer)
    parserAcceptedDocument = true
    if (text.trim().length > 0) return text
  } catch {
    // 同上。
  }
  throw new LinguistContextDocExtractError(
    parserAcceptedDocument ? 'DOCX_EMPTY_TEXT' : 'DOCX_PARSE_FAILED',
  )
}

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfJsModule
    const loading = pdfjs.getDocument({
      data: bytes.slice(),
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    })
    const pdf = await loading.promise
    try {
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent()
        const parts: string[] = []
        for (const item of content.items) {
          if (!isPdfTextItem(item)) continue
          parts.push(item.str)
          if (item.hasEOL) parts.push('\n')
        }
        pages.push(parts.join(' ').replace(/[ \t]+\n/g, '\n').trim())
      }
      if (pages.every((page) => page === '')) {
        throw new LinguistContextDocExtractError('PDF_EMPTY_TEXT')
      }
      return pages
    } finally {
      await pdf.destroy()
    }
  } catch (error) {
    if (error instanceof LinguistContextDocExtractError) throw error
    throw new LinguistContextDocExtractError('PDF_PARSE_FAILED')
  }
}

function textExtraction(
  sourceHash: string,
  texts: readonly string[],
  locator: (index: number) => ExtractedContextAnchor['locator'],
): ContextExtraction {
  const textSections: ContextTextSection[] = []
  const anchors: ExtractedContextAnchor[] = []
  let remaining = CONTEXT_DOC_TEXT_EXTRACT_MAX_CHARS
  let truncated = false
  texts.forEach((raw, index) => {
    const normalized = raw.trim()
    if (normalized === '' || remaining === 0) {
      if (normalized !== '') truncated = true
      return
    }
    const text = normalized.slice(0, remaining)
    if (text.length < normalized.length) truncated = true
    remaining -= text.length
    const anchorId = stableId('ctxa', sourceHash, String(index), text)
    const sectionId = stableId('ctxs', sourceHash, String(index), text)
    textSections.push({ id: sectionId, anchorId, text })
    anchors.push({ id: anchorId, locator: locator(index), textSectionId: sectionId })
  })
  return {
    textSections,
    media: [],
    anchors,
    warnings: truncated
      ? [{
          code: 'context_extraction.text_truncated',
          message: `Context text was capped at ${CONTEXT_DOC_TEXT_EXTRACT_MAX_CHARS} characters`,
        }]
      : [],
  }
}

export function formatContextExtractionText(extraction: ContextExtraction): string | undefined {
  if (extraction.textSections.length === 0) return undefined
  const anchors = new Map(extraction.anchors.map((anchor) => [anchor.id, anchor]))
  return extraction.textSections.map((section) => {
    const anchor = anchors.get(section.anchorId)
    return `[anchor=${section.anchorId}${anchor?.label === undefined ? '' : ` label=${JSON.stringify(anchor.label)}`}] ${section.text}`
  }).join('\n')
}

/** 统一 Context Extraction 边界；未知格式保留原件并显式返回未抽取警告。 */
export async function extractContext(
  bytes: Uint8Array,
  filename: string,
): Promise<ContextExtraction> {
  const extension = extname(filename).toLowerCase()
  const sourceHash = sha256Hex(bytes)
  if (extension === '.xlsx') return extractXlsxContext(bytes, filename)
  if (TEXT_EXTENSIONS.has(extension)) {
    const text = new TextDecoder('utf-8').decode(bytes)
    return textExtraction(sourceHash, text.split(/\n{2,}|\r?\n/), (index) => ({ kind: 'paragraph', index }))
  }
  if (extension === '.docx') {
    return textExtraction(sourceHash, (await extractDocx(bytes)).split(/\r?\n/), (index) => ({ kind: 'paragraph', index }))
  }
  if (extension === '.pdf') {
    return textExtraction(sourceHash, await extractPdfPages(bytes), (index) => ({ kind: 'page', page: index + 1 }))
  }
  const mimeType = IMAGE_MIME_TYPES[extension]
  if (mimeType !== undefined) {
    const mediaId = stableId('ctxm', sourceHash, filename)
    const anchorId = stableId('ctxa', sourceHash, mediaId)
    return {
      textSections: [],
      media: [{ id: mediaId, filename, mimeType, bytes, sha256: sourceHash }],
      anchors: [{
        id: anchorId,
        locator: { kind: 'image', mediaId },
        label: filename,
        mediaId,
      }],
      warnings: [],
    }
  }
  return {
    textSections: [],
    media: [],
    anchors: [],
    warnings: [{
      code: 'context_extraction.unsupported_format',
      message: `${extension || '(no extension)'} was preserved without extracted content`,
    }],
  }
}
