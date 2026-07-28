/**
 * FakeAdapter — trivial line-based bilingual format used to prove the
 * round-trip harness. TEST FIXTURE: never registered in any production
 * registry by default (the registry starts empty; registration is explicit).
 *
 * Format ("ftsv"): UTF-8 text, one segment per line:
 *
 *   KEY<TAB>SOURCE[<TAB>TARGET]
 *
 * - keys are unique, non-empty, tab-free; fields never contain raw tabs;
 * - a line without the TARGET field means target === '';
 * - ids = keys (segment ids derive from asset + ordinal + key, see
 *   bindImportedSegments, so they are stable across re-imports);
 * - export uses the original bytes as the template: lines stay in original
 *   order, only the TARGET field is (re)written, unmodified input
 *   round-trips byte-stable (given canonical LF input).
 */

import { fnv1a64 } from '@linguist/cat-core'
import type {
  CatFormatAdapter,
  CatFormatExportInput,
  CatFormatImportInput,
  ImportedCatAsset,
  ImportedCatSegment,
} from '../adapter'
import { FormatExportError, FormatParseError } from '../errors'
import { sha256Hex, type HashFn } from '../hash'

export const FAKE_ADAPTER_ID = 'fake_tsv'

interface ParsedLine {
  key: string
  source: string
  target: string
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}

/** Builds canonical ftsv fixture bytes from rows. */
export function encodeFakeTsv(rows: ReadonlyArray<{ key: string; source: string; target?: string }>): Uint8Array {
  const text =
    rows.map((row) => `${row.key}\t${row.source}` + (row.target ? `\t${row.target}` : '')).join('\n') + '\n'
  return new TextEncoder().encode(text)
}

export class FakeAdapter implements CatFormatAdapter {
  readonly id: string = FAKE_ADAPTER_ID
  readonly extensions = ['.ftsv']

  constructor(private readonly hash: HashFn = sha256Hex) {}

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (looksBinary(input)) return 0
    if (filename.toLowerCase().endsWith('.ftsv')) return 0.9
    try {
      this.parseLines(this.decode(input, '<detect>'), '<detect>')
      return 0.4
    } catch {
      return 0
    }
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const text = this.decode(bytes, filename)
    const lines = this.parseLines(text, filename)
    const seen = new Set<string>()
    const segments: ImportedCatSegment[] = lines.map((line, ordinal) => {
      if (seen.has(line.key)) {
        throw new FormatParseError(this.id, filename, `line ${ordinal + 1}: duplicate key ${JSON.stringify(line.key)}`)
      }
      seen.add(line.key)
      return {
        ordinal,
        key: line.key,
        source: line.source,
        target: line.target,
        sourceLocale,
        targetLocale,
        status: line.target === '' ? 'untranslated' : 'draft',
        locked: false,
        revision: 0,
        sourceHash: fnv1a64(line.source),
      }
    })
    return {
      asset: {
        formatId: this.id,
        originalFilename: filename,
        sourceSha256: await this.hash(bytes),
        segmentCount: segments.length,
      },
      segments,
      warnings: [],
      originalBytes: bytes,
    }
  }

  async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const { originalBytes, asset, segments } = input
    const { lines, trailingNewline } = this.parseTemplate(originalBytes, asset.originalFilename)

    const byKey = new Map<string, (typeof segments)[number]>()
    for (const segment of segments) {
      const key = segment.key ?? ''
      if (byKey.has(key)) {
        throw new FormatExportError(this.id, `duplicate segment key ${JSON.stringify(key)} in export input`)
      }
      byKey.set(key, segment)
    }
    const templateKeys = new Set(lines.map((line) => line.key))
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }

    const out = lines.map((line) => {
      const segment = byKey.get(line.key)
      if (!segment) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(line.key)} missing from export input; refusing to skip it silently`,
        )
      }
      if (segment.source !== line.source) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(line.key)}: source text differs from the original template; sources are never rewritten on export`,
        )
      }
      return `${line.key}\t${line.source}` + (segment.target !== '' ? `\t${segment.target}` : '')
    })
    return new TextEncoder().encode(out.join('\n') + (trailingNewline ? '\n' : ''))
  }

  private decode(bytes: Uint8Array, filename: string): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'input is not valid UTF-8', { cause: err })
    }
  }

  private parseLines(text: string, filename: string): ParsedLine[] {
    return this.parseTemplate(new TextEncoder().encode(text), filename).lines
  }

  private parseTemplate(bytes: Uint8Array, filename: string): { lines: ParsedLine[]; trailingNewline: boolean } {
    const text = this.decode(bytes, filename)
    const trailingNewline = text.endsWith('\n')
    const body = trailingNewline ? text.slice(0, -1) : text
    if (body === '') return { lines: [], trailingNewline }
    const rawLines = body.split('\n')
    const lines = rawLines.map((raw, index): ParsedLine => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      const fields = line.split('\t')
      if (fields.length < 2 || fields.length > 3 || fields[0] === '') {
        throw new FormatParseError(
          this.id,
          filename,
          `line ${index + 1}: expected KEY<TAB>SOURCE[<TAB>TARGET] with a non-empty key`,
        )
      }
      return { key: fields[0]!, source: fields[1]!, target: fields[2] ?? '' }
    })
    return { lines, trailingNewline }
  }
}

/**
 * NEGATIVE FIXTURE: an adapter that silently drops segments with empty
 * targets on export (writes the file without those lines instead of
 * failing). The harness must catch this with FormatSegmentLostError on
 * re-import. Never use outside tests.
 */
export class BadSegmentDropAdapter extends FakeAdapter {
  override readonly id = 'fake_tsv_dropper'

  override async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const kept = new Map(
      input.segments.filter((segment) => segment.target !== '').map((segment) => [segment.key ?? '', segment]),
    )
    const text = new TextDecoder('utf-8').decode(input.originalBytes)
    const trailingNewline = text.endsWith('\n')
    const body = trailingNewline ? text.slice(0, -1) : text
    const out = body
      .split('\n')
      .filter((line) => kept.has(line.split('\t')[0] ?? ''))
      .map((line) => {
        const segment = kept.get(line.split('\t')[0] ?? '')!
        return `${segment.key}\t${segment.source}\t${segment.target}`
      })
    return new TextEncoder().encode(out.join('\n') + (trailingNewline ? '\n' : ''))
  }
}
