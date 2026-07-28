/**
 * PB-100: LA design token contract tests
 *
 * Text-level assertions over globals.css and tailwind.config.js:
 *   1. New tokens exist in BOTH the :root and .dark blocks
 *      (motion tokens are :root-only by design).
 *   2. New color tokens follow the `H S% L%` channel format
 *      (--border-strong/--border-light are exempt: color-mix derived).
 *   3. A global `@media (prefers-reduced-motion: reduce)` rule exists and is
 *      NOT scoped inside any `.theme-*` class.
 *   4. tailwind safelist stays in sync with THEME_STYLES
 *      (defined in apps/electron/src/types/settings.ts, re-exported via atoms/theme.ts).
 *   5. Every CSS variable referenced by the new tailwind status-color
 *      mappings is actually defined in globals.css (typo-drift guard).
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const GLOBALS_CSS_PATH = join(REPO_ROOT, 'apps/electron/src/renderer/styles/globals.css')
const TAILWIND_CONFIG_PATH = join(REPO_ROOT, 'apps/electron/tailwind.config.js')
const THEME_TYPES_PATH = join(REPO_ROOT, 'apps/electron/src/types/settings.ts')

const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')
const tailwindConfig = readFileSync(TAILWIND_CONFIG_PATH, 'utf8')
const themeTypes = readFileSync(THEME_TYPES_PATH, 'utf8')

/** Tokens that must exist in both :root and .dark. */
const DUAL_SCOPE_TOKENS = [
  '--foreground-faint',
  '--success',
  '--success-soft',
  '--success-foreground',
  '--warning',
  '--warning-soft',
  '--warning-foreground',
  '--info',
  '--info-soft',
  '--info-foreground',
  '--scrim',
  '--border-strong',
  '--border-light',
] as const

/** Motion tokens: defined once in :root, intentionally absent from .dark. */
const ROOT_ONLY_TOKENS = [
  '--duration-instant',
  '--duration-fast',
  '--duration-normal',
  '--duration-slow',
  '--ease-standard',
  '--ease-enter',
] as const

/** color-mix derived tokens exempt from the HSL channel format check. */
const FORMAT_EXEMPT_TOKENS = new Set(['--border-strong', '--border-light'])

const HSL_CHANNEL_RE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/

/**
 * Returns the [start, end] ranges of every block whose selector matches
 * `selectorRe`. Start = regex match index, end = index just past the block's
 * matching closing brace. Naive brace pairing is fine here: none of the
 * blocks we inspect contain braces inside comments or strings.
 */
function findBlockRanges(source: string, selectorRe: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const match of source.matchAll(selectorRe)) {
    const openBrace = source.indexOf('{', match.index)
    if (openBrace === -1) continue
    let depth = 0
    let i = openBrace
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    ranges.push([match.index, i + 1])
  }
  return ranges
}

/** Concatenated body text of all blocks matching the selector. */
function combinedBlockBody(source: string, selectorRe: RegExp): string {
  return findBlockRanges(source, selectorRe)
    .map(([start, end]) => source.slice(source.indexOf('{', start) + 1, end - 1))
    .join('\n')
}

const rootBody = combinedBlockBody(css, /:root\s*\{/g)
const darkBody = combinedBlockBody(css, /(^|[\s,])\.dark\s*\{/g)

/** All declared values for a token within the given block body text. */
function tokenValues(blockBody: string, token: string): string[] {
  const re = new RegExp(`${token}:\\s*([^;]+);`, 'g')
  return [...blockBody.matchAll(re)].map((m) => m[1].trim())
}

describe('1. token dual-scope presence', () => {
  for (const token of DUAL_SCOPE_TOKENS) {
    test(`${token} defined in both :root and .dark`, () => {
      expect(tokenValues(rootBody, token).length).toBeGreaterThanOrEqual(1)
      expect(tokenValues(darkBody, token).length).toBeGreaterThanOrEqual(1)
    })
  }
  for (const token of ROOT_ONLY_TOKENS) {
    test(`${token} defined in :root only`, () => {
      expect(tokenValues(rootBody, token).length).toBeGreaterThanOrEqual(1)
      expect(tokenValues(darkBody, token).length).toBe(0)
    })
  }
})

describe('2. HSL channel format', () => {
  const colorTokens = DUAL_SCOPE_TOKENS.filter((t) => !FORMAT_EXEMPT_TOKENS.has(t))
  for (const token of colorTokens) {
    test(`${token} values match \`H S% L%\` in both scopes`, () => {
      const values = [...tokenValues(rootBody, token), ...tokenValues(darkBody, token)]
      expect(values.length).toBeGreaterThanOrEqual(2)
      for (const value of values) {
        expect(value).toMatch(HSL_CHANNEL_RE)
      }
    })
  }
  for (const token of FORMAT_EXEMPT_TOKENS) {
    test(`${token} is a color-mix derivation (exempt from channel format)`, () => {
      const values = [...tokenValues(rootBody, token), ...tokenValues(darkBody, token)]
      expect(values.length).toBeGreaterThanOrEqual(2)
      for (const value of values) {
        expect(value).toContain('color-mix(')
      }
    })
  }
})

describe('3. global reduced-motion rule', () => {
  const mediaRe = /@media \(prefers-reduced-motion: reduce\)\s*\{/g
  const themeBlockRanges = findBlockRanges(css, /\.theme-[\w-]+[^{}]*\{/g)

  test('at least one prefers-reduced-motion media block exists', () => {
    expect(findBlockRanges(css, mediaRe).length).toBeGreaterThanOrEqual(1)
  })

  test('a global (theme-unscoped) reduced-motion rule exists', () => {
    const globalBlocks = findBlockRanges(css, mediaRe).filter(([start, end]) => {
      const insideTheme = themeBlockRanges.some(([ts, te]) => start > ts && end < te)
      const body = css.slice(css.indexOf('{', start) + 1, end - 1)
      return !insideTheme && !body.includes('.theme-')
    })
    expect(globalBlocks.length).toBeGreaterThanOrEqual(1)
  })

  test('the global rule collapses animations/transitions for all elements', () => {
    const globalRe = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{/
    expect(css).toMatch(globalRe)
  })
})

describe('4. tailwind safelist stays in sync with THEME_STYLES', () => {
  function extractStringArray(source: string, keyRe: RegExp): string[] {
    const match = source.match(keyRe)
    if (!match) throw new Error(`array not found: ${keyRe}`)
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  test('safelist === THEME_STYLES minus default, prefixed with theme-', () => {
    const safelist = extractStringArray(tailwindConfig, /safelist:\s*\[([\s\S]*?)\]/).sort()
    const themeStyles = extractStringArray(themeTypes, /THEME_STYLES = \[([\s\S]*?)\]/)
    const expected = themeStyles
      .filter((style) => style !== 'default')
      .map((style) => `theme-${style}`)
      .sort()
    expect(safelist).toEqual(expected)
  })
})

describe('5. tailwind status-color mappings reference defined variables', () => {
  test('every new var(--x) referenced by tailwind config is defined in :root and .dark', () => {
    const referenced = new Set(
      [...tailwindConfig.matchAll(/var\((--(?:success|warning|info|scrim|foreground-faint)[\w-]*)\)/g)].map(
        (m) => m[1]
      )
    )
    // Sanity: the config must actually reference the full new set.
    expect(referenced.size).toBe(DUAL_SCOPE_TOKENS.length - 2) // minus border-strong/light (not in config)
    for (const token of referenced) {
      expect(tokenValues(rootBody, token).length).toBeGreaterThanOrEqual(1)
      expect(tokenValues(darkBody, token).length).toBeGreaterThanOrEqual(1)
    }
  })
})
