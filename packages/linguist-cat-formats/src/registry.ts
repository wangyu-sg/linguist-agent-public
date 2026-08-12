/**
 * CatFormatRegistry — explicit adapter registration + detect-based matching.
 *
 * The registry starts EMPTY: nothing (especially not test fixtures) is
 * registered by default. Consumers register the adapters they ship.
 */

import type { CatFormatAdapter } from './adapter'
import { FormatAmbiguousError, FormatUnsupportedError } from './errors'

export interface DetectedAdapter {
  adapter: CatFormatAdapter
  /** Confidence as returned by the adapter's own detect() (> 0). */
  score: number
}

export class CatFormatRegistry {
  private readonly adapters: CatFormatAdapter[] = []
  private readonly byId = new Map<string, CatFormatAdapter>()

  /** Registers an adapter. Throws (programmer error) on duplicate id. */
  register(adapter: CatFormatAdapter): this {
    if (this.byId.has(adapter.id)) {
      throw new Error(`CatFormatRegistry: adapter id "${adapter.id}" is already registered.`)
    }
    this.adapters.push(adapter)
    this.byId.set(adapter.id, adapter)
    return this
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  get(id: string): CatFormatAdapter | undefined {
    return this.byId.get(id)
  }

  /** All registered adapters, in registration order. */
  list(): CatFormatAdapter[] {
    return [...this.adapters]
  }

  /**
   * Runs every adapter's detect() and returns matches (score > 0) sorted by
   * score descending; callers must resolve top-score ties explicitly.
   */
  async detectAll(bytes: Uint8Array, filename: string): Promise<DetectedAdapter[]> {
    const scored: DetectedAdapter[] = []
    for (const adapter of this.adapters) {
      const score = await adapter.detect(bytes, filename)
      if (score > 0) scored.push({ adapter, score })
    }
    return scored.sort((a, b) => b.score - a.score)
  }

  /**
   * Best-match adapter for the given bytes/filename.
   * Throws FormatUnsupportedError when no adapter scores above 0 — an
   * unknown extension with no content match is a clear typed error, never
   * a silent fallback.
   */
  async detectBest(bytes: Uint8Array, filename: string): Promise<CatFormatAdapter> {
    const matches = await this.detectAll(bytes, filename)
    const lower = filename.toLowerCase()
    const extensionOwners = this.adapters.filter((adapter) =>
      adapter.extensions.some((extension) => lower.endsWith(extension.toLowerCase())),
    )
    if (extensionOwners.length > 0 && !extensionOwners.some((owner) => matches.some(({ adapter }) => adapter === owner))) {
      throw new FormatUnsupportedError(filename, extensionOwners.map((adapter) => adapter.id))
    }
    const best = matches[0]
    if (!best) {
      throw new FormatUnsupportedError(
        filename,
        this.adapters.map((a) => a.id),
      )
    }
    const ties = matches.filter((match) => match.score === best.score)
    if (ties.length > 1) {
      throw new FormatAmbiguousError(filename, best.score, ties.map(({ adapter }) => adapter.id))
    }
    return best.adapter
  }
}
