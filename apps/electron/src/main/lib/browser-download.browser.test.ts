import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('真实 Chromium：双标签动作回执和下载收据只使用合成页面与临时目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'la-browser-download-'))
  try {
    await build({
      entryPoints: [resolve(import.meta.dir, '../../../scripts/smoke/probe-browser-download.ts')],
      outfile: join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      define: { 'process.env.HOME': JSON.stringify(join(directory, 'home')) },
    })
    const processHandle = Bun.spawn([createRequire(import.meta.url)('electron') as string, `--user-data-dir=${join(directory, 'profile')}`, join(directory, 'main.cjs')], { stdout: 'pipe', stderr: 'pipe' })
    const [output, errors, status] = await Promise.all([new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(), processHandle.exited])
    expect(status, `${output}\n${errors}`).toBe(0)
    expect(output).toContain('BROWSER_DOWNLOAD_PASS')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 40_000)
