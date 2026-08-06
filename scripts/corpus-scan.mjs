/**
 * corpus-scan.mjs — LA-FORMAT-001 / LA-FORMAT-002 语料格式扫描器。
 *
 * 用途：对指定目录做只读扫描，产出格式 detect / import / export / roundtrip
 * 的真实频率矩阵（聚合数字），供后续 CAT Adapter 优先级决策引用。
 *
 * 运行方式（零新依赖；Node stdlib + @linguist/cat-formats workspace 包）：
 *   bun scripts/corpus-scan.mjs <目录> [--roundtrip-sample N] [选项...]
 *   node --experimental-transform-types \
 *     --import ./apps/electron/src/main/lib/linguist/test/register-ts-loader.mjs \
 *     scripts/corpus-scan.mjs <目录> [选项...]
 *
 * 选项：
 *   --roundtrip-sample N   每个格式 family 采样的 roundtrip 文件数（默认 3，0 = 跳过）
 *   --label <文本>          报告中的语料标签（默认 corpus）
 *   --private-report <路径> 私有详细报告（含相对文件名；只写仓库外路径）
 *   --json-out <路径>       聚合 JSON（不含路径/文件名/SHA，可共享）
 *   --tokens-out <路径>     脱敏自检 token 清单（含语料文件名 stem，只写仓库外）
 *   --check-doc <路径>      自检模式：校验公开文档是否泄漏（配合 --tokens 使用）
 *   --tokens <路径>         自检模式的 token 文件，可重复
 *
 * 脱敏纪律：
 * - stdout 只输出聚合进度与聚合计数，绝不打印文件名/路径；
 * - 私有报告才能包含相对文件名，且必须写到仓库外；
 * - --json-out 不含任何路径、文件名、SHA-256；
 * - --check-doc 用于公开文档落盘前自检（违规只报行号与规则类别，不回显 token）。
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CatFormatRegistry,
  CsvAdapter,
  FormatError,
  JsonAdapter,
  PhraseDocxAdapter,
  PhraseMxliffAdapter,
  SdlXliffAdapter,
  XliffAdapter,
  XlsxAdapter,
} from '@linguist/cat-formats'
import { assertRoundTrip } from '@linguist/cat-formats/testing'

/**
 * 导入体积上限。与生产代码 MAX_IMPORT_BYTES 保持一致：
 * apps/electron/src/main/lib/linguist/project-delivery.ts（50 MiB）。
 * 回归测试会断言两个值同步，防止此处漂移。
 */
export const IMPORT_SIZE_LIMIT_BYTES = 50 * 1024 * 1024

/** 体积分桶边界（字节）与标签。 */
const SIZE_BUCKET_EDGES = [64 * 1024, 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024]
const SIZE_BUCKET_LABELS = ['<64 KiB', '64 KiB-1 MiB', '1-10 MiB', '10-50 MiB', '>50 MiB']

/**
 * 候选扩展名：7 个生产 adapter 声明的扩展名（见 format-registry.ts）
 * 并集，再加上常见文档/本地化格式——后者必然 unsupported，
 * 但它们的数量正是后续 Adapter 优先级决策要引用的需求信号。
 */
export const CANDIDATE_EXTENSIONS = new Set([
  // adapter 覆盖
  '.xliff', '.xlf', '.mqxliff', '.sdlxliff', '.mxliff', '.docx',
  '.csv', '.tsv', '.json', '.xlsx',
  // 未覆盖的文档/本地化格式（需求信号）
  '.pdf', '.doc', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.txt', '.md', '.xml', '.tmx', '.tbx', '.po', '.pot', '.srt', '.vtt',
  '.resx', '.strings', '.properties', '.dita', '.ditamap', '.idml',
  '.html', '.htm', '.yml', '.yaml',
])

/**
 * 与生产一致的默认注册表（镜像 format-registry.ts 的 7 个 adapter 与注册顺序）。
 */
export function createProductionRegistry() {
  return new CatFormatRegistry()
    .register(new XliffAdapter())
    .register(new SdlXliffAdapter())
    .register(new PhraseMxliffAdapter())
    .register(new PhraseDocxAdapter())
    .register(new CsvAdapter())
    .register(new JsonAdapter())
    .register(new XlsxAdapter())
}

/** 体积 → 分桶标签。 */
export function classifySize(bytes) {
  for (let i = 0; i < SIZE_BUCKET_EDGES.length; i++) {
    if (bytes < SIZE_BUCKET_EDGES[i]) return SIZE_BUCKET_LABELS[i]
  }
  return SIZE_BUCKET_LABELS[SIZE_BUCKET_LABELS.length - 1]
}

/**
 * 错误 → 消毒类别：只保留错误类名与机器可读 code，
 * 剥离 message（其中可能含文件名、路径或内容片段）。
 */
export function sanitizeError(err) {
  if (err instanceof FormatError) return `${err.name}:${err.code}`
  const name = err instanceof Error ? err.name : 'NonErrorThrow'
  const code =
    err !== null &&
    typeof err === 'object' &&
    typeof err.code === 'string' &&
    /^[A-Z0-9_]+$/.test(err.code)
      ? `:${err.code}`
      : ''
  return `${name}${code}`
}

/** 确定性（码元序）遍历；忽略隐藏项与符号链接；返回排序后的文件清单与跳过计数。 */
export async function walkFiles(root) {
  const files = []
  let skippedHidden = 0
  let skippedSymlinks = 0
  let dirErrors = 0

  async function walk(dir, relBase) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      dirErrors += 1
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        skippedHidden += 1
        continue
      }
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1
        continue
      }
      const abs = path.join(dir, entry.name)
      const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(abs, rel)
      } else if (entry.isFile()) {
        files.push({ absPath: abs, relPath: rel })
      }
      // 其他类型（socket/fifo 等）直接忽略
    }
  }

  await walk(root, '')
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  return { files, skippedHidden, skippedSymlinks, dirErrors }
}

/**
 * 扫描单个语料目录（只读）。返回聚合结果与逐文件记录；
 * 逐文件记录仅供私有报告使用，--json-out 不得包含。
 */
export async function scanCorpus(root, options = {}) {
  const roundtripSample = options.roundtripSample ?? 3
  const onProgress = options.onProgress ?? (() => {})
  const registry = options.registry ?? createProductionRegistry()

  const result = {
    label: options.label ?? 'corpus',
    root,
    ok: true,
    error: undefined,
    totalFiles: 0,
    totalBytes: 0,
    skippedHidden: 0,
    skippedSymlinks: 0,
    dirErrors: 0,
    extensionCounts: [], // [[ext, count]] 按 count 降序、ext 升序
    sizeBuckets: Object.fromEntries(SIZE_BUCKET_LABELS.map((l) => [l, 0])),
    categories: {
      detected: 0,
      unsupported: 0,
      non_document: 0,
      oversize: 0,
      detect_error: 0,
      read_error: 0,
    },
    families: {}, // adapterId -> count
    detectErrors: {}, // 消毒类别 -> count
    duplicates: { count: 0, bytes: 0 },
    roundtrip: { families: {} },
    files: [], // 私有：{ relPath, ext, size, category, adapter?, score?, sha256?, roundtrip? }
  }

  let rootStat
  try {
    rootStat = await fs.stat(root)
  } catch {
    result.ok = false
    result.error = 'root_not_readable'
    return result
  }
  if (!rootStat.isDirectory()) {
    result.ok = false
    result.error = 'root_not_directory'
    return result
  }

  const { files, skippedHidden, skippedSymlinks, dirErrors } = await walkFiles(root)
  result.skippedHidden = skippedHidden
  result.skippedSymlinks = skippedSymlinks
  result.dirErrors = dirErrors
  result.totalFiles = files.length

  const extCounts = new Map()
  const seenSha = new Map() // sha256 -> 首个 relPath（私有）
  const duplicateGroups = [] // 私有：[{sha256, relPaths}]
  let scanned = 0

  for (const file of files) {
    scanned += 1
    if (scanned % 500 === 0) onProgress(scanned)

    const ext = path.extname(file.relPath).toLowerCase()
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)

    let size = 0
    try {
      size = (await fs.lstat(file.absPath)).size
    } catch {
      result.categories.read_error += 1
      result.files.push({ relPath: file.relPath, ext, size: 0, category: 'read_error' })
      continue
    }
    result.totalBytes += size
    result.sizeBuckets[classifySize(size)] += 1

    const record = { relPath: file.relPath, ext, size, category: undefined }

    if (size > IMPORT_SIZE_LIMIT_BYTES) {
      record.category = 'oversize'
      result.categories.oversize += 1
      result.files.push(record)
      continue
    }
    if (!CANDIDATE_EXTENSIONS.has(ext)) {
      record.category = 'non_document'
      result.categories.non_document += 1
      result.files.push(record)
      continue
    }

    let bytes
    try {
      bytes = new Uint8Array(await fs.readFile(file.absPath))
    } catch {
      record.category = 'read_error'
      result.categories.read_error += 1
      result.files.push(record)
      continue
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    record.sha256 = sha256
    const firstSeen = seenSha.get(sha256)
    if (firstSeen === undefined) {
      seenSha.set(sha256, file.relPath)
    } else {
      result.duplicates.count += 1
      result.duplicates.bytes += size
      const group = duplicateGroups.find((g) => g.sha256 === sha256)
      if (group) group.relPaths.push(file.relPath)
      else duplicateGroups.push({ sha256, relPaths: [firstSeen, file.relPath] })
    }

    // detectBest 等价语义：detectAll 已按 score 降序，取首项即 best；
    // 全部 0 分即 FormatUnsupportedError。这里用 detectAll 以同时记录信心分。
    let matches
    try {
      matches = await registry.detectAll(bytes, path.basename(file.relPath))
    } catch (err) {
      record.category = 'detect_error'
      result.categories.detect_error += 1
      const category = sanitizeError(err)
      result.detectErrors[category] = (result.detectErrors[category] ?? 0) + 1
      result.files.push(record)
      continue
    }

    const best = matches[0]
    if (!best) {
      record.category = 'unsupported'
      result.categories.unsupported += 1
    } else {
      record.category = 'detected'
      record.adapter = best.adapter.id
      record.score = best.score
      result.categories.detected += 1
      result.families[best.adapter.id] = (result.families[best.adapter.id] ?? 0) + 1
    }
    result.files.push(record)
  }

  result.extensionCounts = [...extCounts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  )
  result.duplicateGroups = duplicateGroups

  // ---- Roundtrip 采样：每 family 确定性取前 N 个（按 relPath 排序，跳过重复内容）----
  const tmpBase = options.tmpBase ?? os.tmpdir()
  let roundtripDir
  if (roundtripSample > 0) {
    roundtripDir = await fs.mkdtemp(path.join(tmpBase, 'corpus-scan-rt-'))
  }
  try {
    for (const adapter of registry.list()) {
      const familyRecords = result.files.filter(
        (r) => r.category === 'detected' && r.adapter === adapter.id,
      )
      if (familyRecords.length === 0) continue
      const sampled = []
      const sampledSha = new Set()
      for (const record of familyRecords) {
        if (sampled.length >= roundtripSample) break
        if (record.sha256 !== undefined && sampledSha.has(record.sha256)) continue
        sampled.push(record)
        if (record.sha256 !== undefined) sampledSha.add(record.sha256)
      }
      const familyResult = { sampled: sampled.length, ok: 0, failed: 0, errors: {} }
      for (const record of sampled) {
        const outcome = await runRoundtrip(adapter, record, root, roundtripDir)
        record.roundtrip = outcome.ok ? 'ok' : outcome.category
        if (outcome.ok) {
          familyResult.ok += 1
        } else {
          familyResult.failed += 1
          familyResult.errors[outcome.category] = (familyResult.errors[outcome.category] ?? 0) + 1
        }
      }
      result.roundtrip.families[adapter.id] = familyResult
    }
  } finally {
    if (roundtripDir !== undefined) {
      await fs.rm(roundtripDir, { recursive: true, force: true })
    }
  }

  onProgress(scanned, true)
  return result
}

/**
 * 单文件真实 roundtrip：import → 修改 → export → 落盘 → 读回校验 → re-import。
 * 复用 @linguist/cat-formats/testing 的 assertRoundTrip 公共 harness；
 * 真实语料字节不是范式化产物，关闭 unmodified byte-stable 断言。
 */
async function runRoundtrip(adapter, record, root, roundtripDir) {
  try {
    const absPath = path.join(root, record.relPath)
    const bytes = new Uint8Array(await fs.readFile(absPath))
    const report = await assertRoundTrip(adapter, bytes, {
      filename: path.basename(record.relPath),
      assertByteStableUnmodified: false,
    })
    if (roundtripDir !== undefined) {
      const outPath = path.join(roundtripDir, `export-${Date.now()}-${Math.floor(Math.random() * 1e9)}.bin`)
      await fs.writeFile(outPath, report.exportedBytes)
      const readBack = new Uint8Array(await fs.readFile(outPath))
      const shaOut = createHash('sha256').update(report.exportedBytes).digest('hex')
      const shaBack = createHash('sha256').update(readBack).digest('hex')
      if (shaOut !== shaBack) return { ok: false, category: 'FsIntegrityError:SHA_MISMATCH' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, category: sanitizeError(err) }
  }
}

/** 私有详细报告（含相对路径，只允许写仓库外）。 */
export function renderPrivateReport(result, generatedAt) {
  const lines = []
  lines.push(`# 语料扫描私有报告 — ${result.label}`)
  lines.push('')
  lines.push(`- 扫描根目录: ${result.root}`)
  lines.push(`- 生成时间: ${generatedAt}`)
  lines.push(`- 导入体积上限: ${IMPORT_SIZE_LIMIT_BYTES} 字节`)
  lines.push('')
  if (!result.ok) {
    lines.push(`扫描未完成: ${result.error}`)
    lines.push('')
    return lines.join('\n')
  }
  lines.push(`## 聚合`)
  lines.push('')
  lines.push(`- 文件总数: ${result.totalFiles}`)
  lines.push(`- 总字节数: ${result.totalBytes}`)
  lines.push(`- 忽略隐藏项: ${result.skippedHidden}；符号链接: ${result.skippedSymlinks}；目录读取失败: ${result.dirErrors}`)
  lines.push(`- 重复文件: ${result.duplicates.count}（${result.duplicates.bytes} 字节）`)
  lines.push('')
  lines.push(`### 分类计数`)
  lines.push('')
  for (const [k, v] of Object.entries(result.categories)) lines.push(`- ${k}: ${v}`)
  lines.push('')
  lines.push(`### 扩展名频次`)
  lines.push('')
  lines.push('| 扩展名 | 数量 |')
  lines.push('|---|---|')
  for (const [ext, count] of result.extensionCounts) lines.push(`| ${ext || '(无扩展名)'} | ${count} |`)
  lines.push('')
  lines.push(`### 格式 family 分布`)
  lines.push('')
  for (const [family, count] of Object.entries(result.families)) lines.push(`- ${family}: ${count}`)
  lines.push('')
  lines.push(`### Roundtrip`)
  lines.push('')
  for (const [family, rt] of Object.entries(result.roundtrip.families)) {
    lines.push(`- ${family}: 采样 ${rt.sampled}，成功 ${rt.ok}，失败 ${rt.failed}，错误类别 ${JSON.stringify(rt.errors)}`)
  }
  lines.push('')
  if (result.duplicateGroups.length > 0) {
    lines.push(`## 重复文件组（SHA-256 相同）`)
    lines.push('')
    for (const group of result.duplicateGroups) {
      lines.push(`- ${group.sha256.slice(0, 12)}…`)
      for (const rel of group.relPaths) lines.push(`  - ${rel}`)
    }
    lines.push('')
  }
  lines.push(`## 逐文件明细`)
  lines.push('')
  lines.push('| 相对路径 | 扩展名 | 字节 | 分类 | adapter | 信心 | roundtrip |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const r of result.files) {
    lines.push(
      `| ${r.relPath} | ${r.ext} | ${r.size} | ${r.category} | ${r.adapter ?? ''} | ${r.score ?? ''} | ${r.roundtrip ?? ''} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** 聚合 JSON（可共享）：剔除一切路径、文件名、SHA 与逐文件明细。 */
export function toPublicJson(result) {
  return {
    label: result.label,
    ok: result.ok,
    error: result.error,
    importSizeLimitBytes: IMPORT_SIZE_LIMIT_BYTES,
    totalFiles: result.totalFiles,
    totalBytes: result.totalBytes,
    skippedHidden: result.skippedHidden,
    skippedSymlinks: result.skippedSymlinks,
    dirErrors: result.dirErrors,
    extensionCounts: result.extensionCounts,
    sizeBuckets: result.sizeBuckets,
    categories: result.categories,
    families: result.families,
    detectErrors: result.detectErrors,
    duplicates: result.duplicates,
    roundtrip: result.roundtrip,
  }
}

/**
 * 收集脱敏自检 token：语料文件 stem（拉丁 ≥4 字符 / 含 CJK ≥3 字符）、
 * 根目录路径分段，以及固定禁止词。token 清单本身敏感，只允许写仓库外。
 */
export function collectForbiddenTokens(result) {
  const tokens = new Set(['desktop', '翻译', 'users', 'wangyu', 'downloads'])
  for (const segment of result.root.split(path.sep)) {
    const s = segment.trim().toLowerCase()
    if (s.length >= 3) tokens.add(s)
  }
  for (const file of result.files) {
    const stem = path.basename(file.relPath, path.extname(file.relPath)).trim().toLowerCase()
    if (stem.length === 0) continue
    const hasCjk = /[一-鿿]/.test(stem)
    if ((hasCjk && stem.length >= 3) || (!hasCjk && stem.length >= 4)) tokens.add(stem)
  }
  return [...tokens].sort()
}

/**
 * 公开文档落盘前自检：不得含 "/"，不得含任何禁止 token（大小写不敏感）。
 * 违规只报行号与规则类别，绝不回显 token 本体。
 */
export function assertPublicDocSafe(content, tokens) {
  const violations = []
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    if (line.includes('/')) violations.push({ line: index + 1, kind: 'forbidden-slash' })
    const lower = line.toLowerCase()
    for (const token of tokens) {
      if (token.length > 0 && lower.includes(token.toLowerCase())) {
        violations.push({ line: index + 1, kind: 'forbidden-token' })
        break
      }
    }
  })
  return { ok: violations.length === 0, violations }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { roundtripSample: 3, tokens: [] }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--roundtrip-sample':
        args.roundtripSample = Number.parseInt(argv[++i] ?? '', 10)
        if (!Number.isInteger(args.roundtripSample) || args.roundtripSample < 0) {
          throw new Error('--roundtrip-sample 需要非负整数')
        }
        break
      case '--label':
        args.label = argv[++i]
        break
      case '--private-report':
        args.privateReport = argv[++i]
        break
      case '--json-out':
        args.jsonOut = argv[++i]
        break
      case '--tokens-out':
        args.tokensOut = argv[++i]
        break
      case '--check-doc':
        args.checkDoc = argv[++i]
        break
      case '--tokens':
        args.tokens.push(argv[++i])
        break
      default:
        if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`)
        positional.push(arg)
    }
  }
  args.dir = positional[0]
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // 自检模式：公开文档落盘前的脱敏校验
  if (args.checkDoc !== undefined) {
    if (args.tokens.length === 0) {
      process.stderr.write('error: --check-doc 需要至少一个 --tokens 文件\n')
      process.exit(2)
    }
    const content = await fs.readFile(args.checkDoc, 'utf8')
    const tokens = []
    for (const tokenFile of args.tokens) {
      const parsed = JSON.parse(await fs.readFile(tokenFile, 'utf8'))
      if (Array.isArray(parsed)) tokens.push(...parsed)
    }
    const { ok, violations } = assertPublicDocSafe(content, tokens)
    if (ok) {
      process.stdout.write('doc-check: pass\n')
      return
    }
    for (const v of violations) process.stdout.write(`doc-check: violation line ${v.line} (${v.kind})\n`)
    process.exit(3)
  }

  if (args.dir === undefined) {
    process.stderr.write(
      'usage: corpus-scan.mjs <目录> [--roundtrip-sample N] [--label X] [--private-report P] [--json-out J] [--tokens-out T]\n' +
        '       corpus-scan.mjs --check-doc <文件> --tokens <tokens.json> [--tokens ...]\n',
    )
    process.exit(2)
  }

  const root = path.resolve(args.dir)
  const result = await scanCorpus(root, {
    label: args.label ?? 'corpus',
    roundtripSample: args.roundtripSample,
    onProgress: (n, done) => {
      process.stdout.write(done === true ? `progress: scanned ${n} files (done)\n` : `progress: scanned ${n} files\n`)
    },
  })

  if (!result.ok) {
    process.stderr.write(`error: scan root not usable (${result.error})\n`)
    if (args.privateReport !== undefined) {
      await fs.writeFile(args.privateReport, renderPrivateReport(result, new Date().toISOString()), 'utf8')
    }
    if (args.jsonOut !== undefined) {
      await fs.writeFile(args.jsonOut, `${JSON.stringify(toPublicJson(result), null, 2)}\n`, 'utf8')
    }
    process.exit(2)
  }

  if (args.privateReport !== undefined) {
    await fs.writeFile(args.privateReport, renderPrivateReport(result, new Date().toISOString()), 'utf8')
  }
  if (args.jsonOut !== undefined) {
    await fs.writeFile(args.jsonOut, `${JSON.stringify(toPublicJson(result), null, 2)}\n`, 'utf8')
  }
  if (args.tokensOut !== undefined) {
    await fs.writeFile(args.tokensOut, `${JSON.stringify(collectForbiddenTokens(result), null, 2)}\n`, 'utf8')
  }

  // 终态聚合摘要（纯计数，绝无文件名/路径）
  const c = result.categories
  process.stdout.write(
    `summary [${result.label}]: files=${result.totalFiles} bytes=${result.totalBytes} ` +
      `detected=${c.detected} unsupported=${c.unsupported} non_document=${c.non_document} ` +
      `oversize=${c.oversize} detect_error=${c.detect_error} read_error=${c.read_error} ` +
      `duplicates=${result.duplicates.count}\n`,
  )
  for (const [family, count] of Object.entries(result.families).sort()) {
    const rt = result.roundtrip.families[family]
    const rtText = rt === undefined ? '' : ` roundtrip=${rt.ok}/${rt.sampled}`
    process.stdout.write(`summary [${result.label}]: family ${family} count=${count}${rtText}\n`)
  }
}

const invokedAs = process.argv[1] === undefined ? '' : path.resolve(process.argv[1])
if (invokedAs === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
