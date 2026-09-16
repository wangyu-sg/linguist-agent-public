import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('真实 Chromium：组合键、焦点与同队列序列不会污染或错写正文', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'la-browser-input-'))
  try {
    await build({
      entryPoints: [resolve(import.meta.dir, '../../../scripts/smoke/probe-browser-input.ts')],
      outfile: join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      // 只将这个合成测试 bundle 的配置根固定到临时目录，不改宿主环境或真实用户根。
      define: { 'process.env.HOME': JSON.stringify(join(directory, 'home')) },
    })
    const processHandle = Bun.spawn([createRequire(import.meta.url)('electron') as string, `--user-data-dir=${join(directory, 'profile')}`, join(directory, 'main.cjs')], { stdout: 'pipe', stderr: 'pipe' })
    const [output, errors, status] = await Promise.all([new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(), processHandle.exited])
    expect(status, `${output}\n${errors}`).toBe(0)
    expect(output).toContain('BROWSER_INPUT_PASS')
    console.log(output.split('\n').filter(line => line.startsWith('BROWSER_')).join('\n'))
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60_000)
