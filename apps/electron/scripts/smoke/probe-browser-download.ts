/** 合成网页下载：数据目录和下载目录都在临时 fixture 内。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { BrowserController } from '../../src/main/lib/browser-controller'
import { browserStateReceipt } from '../../src/main/lib/browser-operation-contract'
import { updateSettings } from '../../src/main/lib/settings-service'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '../../src/types/settings'

const deadline = setTimeout(() => { console.error('Browser download fixture timed out'); app.exit(1) }, 25_000)
void app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  assert.ok(userData.includes('la-browser-download-'))
  const downloads = join(userData, 'downloads')
  mkdirSync(downloads, { recursive: true })
  app.setPath('downloads', downloads)
  updateSettings({ browserRiskDisclaimerVersion: BROWSER_RISK_DISCLAIMER_VERSION })

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/file') {
      const delay = Number(url.searchParams.get('delay') ?? 10)
      const body = `batch=${url.searchParams.get('batch')}${delay > 100 ? 'x'.repeat(1024 * 1024) : ''}`
      response.setHeader('Content-Type', 'application/octet-stream')
      response.setHeader('Content-Disposition', 'attachment; filename="same.xlf"')
      response.setHeader('Content-Length', Buffer.byteLength(body))
      response.flushHeaders()
      const firstChunk = delay > 100 ? 512 * 1024 : 6
      response.write(body.slice(0, firstChunk))
      setTimeout(() => response.end(body.slice(firstChunk)), delay)
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    const batch = url.pathname === '/b' ? 'B' : 'A'
    response.end(`<title>Job ${batch}</title><button id="noop">noop</button><a id="download" href="/file?batch=${batch}&delay=10">download</a><a id="slow" href="/file?batch=${batch}&delay=1500">slow</a>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const owner = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  const controller = new BrowserController()
  controller.setOwnerWindow(owner)
  const sessionId = 'download-fixture'
  try {
    await owner.loadURL('about:blank')
    owner.showInactive()
    const a = await controller.createNewTab(sessionId, `${base}/a`)
    const aId = a.operationTabId
    const b = await controller.createDisplayTab(sessionId, `${base}/b`)
    assert.notEqual(b.activeTabId, aId)
    assert.equal(controller.resolveAgentTabId(sessionId), aId)
    controller.setLayout({ sessionId, tabId: aId, visible: true, revision: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } })

    const observed = await controller.observe(sessionId, aId)
    const noop = observed.elements.find((item) => item.name === 'noop')
    assert.ok(noop)
    const clickState = await controller.click(sessionId, noop.ref, aId)
    const clickReceipt = browserStateReceipt(clickState, aId, 'dispatched')
    assert.deepEqual(clickReceipt, { tabId: aId, url: `${base}/a`, title: 'Job A', documentRevision: clickState.tabs.find(tab => tab.tabId === aId)?.documentRevision, loading: false, operationStatus: 'dispatched' })
    assert.ok(!JSON.stringify(clickReceipt).includes('trace'))
    assert.ok(!JSON.stringify(clickReceipt).includes('tabs'))

    await assert.rejects(controller.act(sessionId, { tabId: aId, ref: 'invalid-ref', expectDownload: true, timeoutMs: 250 }, undefined, 'legacy-invalid'))
    const failedReceipt = controller.getDownload(sessionId, { operationId: 'legacy-invalid' })
    assert.ok('correlation' in failedReceipt)
    assert.equal(failedReceipt.correlation, 'unknown')
    assert.equal(failedReceipt.downloads.length, 0)

    const first = await controller.act(sessionId, { tabId: aId, expectDownload: true, timeoutMs: 5_000, steps: [
      { kind: 'click', target: { selector: '#download' } },
    ] }, undefined, 'download-a-1')
    assert.ok('download' in first && first.download)
    assert.equal(first.download.operationId, 'download-a-1')
    assert.equal(first.download.correlation, 'candidate', JSON.stringify(first))
    assert.equal(first.download.businessIdentityVerified, false)
    assert.equal(first.download.downloads[0]?.state, 'completed')
    const firstPath = first.download.downloads[0]?.filePath
    assert.ok(firstPath?.startsWith(downloads))
    assert.equal(await readFile(firstPath, 'utf8'), 'batch=A')

    const pending = await controller.act(sessionId, { tabId: aId, expectDownload: true, timeoutMs: 250, steps: [
      { kind: 'click', target: { selector: '#slow' } },
    ] }, undefined, 'download-a-2')
    assert.ok('download' in pending && pending.download)
    assert.equal(pending.download.operationId, 'download-a-2')
    assert.notEqual(pending.download.downloads[0]?.state, 'completed')
    assert.equal(controller.hasDownloadAttempt(sessionId, 'download-a-2'), true)
    await assert.rejects(controller.act(sessionId, { tabId: aId, expectDownload: true, timeoutMs: 250, steps: [
      { kind: 'click', target: { selector: '#slow' } },
    ] }, undefined, 'download-a-2'), /已派发/)
    let slowReceipt = controller.getDownload(sessionId, { operationId: 'download-a-2' })
    assert.ok('correlation' in slowReceipt)
    for (let i = 0; i < 10 && slowReceipt.downloads.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      slowReceipt = controller.getDownload(sessionId, { operationId: 'download-a-2' }) as typeof slowReceipt
    }
    assert.equal(slowReceipt.correlation, 'candidate')
    assert.equal(slowReceipt.downloads[0]?.state, 'in_progress')
    await controller.closeTab(sessionId, aId)
    controller.setLayout({ sessionId, tabId: b.activeTabId, visible: true, revision: 3, bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const other = await controller.act(sessionId, { tabId: b.activeTabId, expectDownload: true, timeoutMs: 5_000, steps: [
      { kind: 'click', target: { selector: '#download' } },
    ] }, undefined, 'download-b-1')
    assert.ok('download' in other && other.download)
    assert.equal(other.download.tabId, b.activeTabId)
    assert.equal(other.download.correlation, 'candidate')
    assert.equal(await readFile(other.download.downloads[0]!.filePath!, 'utf8'), 'batch=B')
    const partial = await controller.act(sessionId, { tabId: b.activeTabId, expectDownload: true, timeoutMs: 250, steps: [
      { kind: 'click', target: { selector: '#noop' } },
      { kind: 'check', probe: { selector: '#noop' }, expected: null },
    ] }, undefined, 'partial-no-download')
    assert.ok('status' in partial && partial.status === 'partial')
    assert.equal(partial.download?.downloads.length, 0)
    await new Promise((resolve) => setTimeout(resolve, 1_700))
    const settled = controller.getDownload(sessionId, { operationId: 'download-a-2' })
    assert.ok('correlation' in settled)
    assert.equal(settled.correlation, 'candidate')
    assert.equal(settled.downloads[0]?.state, 'completed')
    const secondPath = settled.downloads[0]?.filePath
    assert.ok(secondPath?.startsWith(downloads))
    assert.notEqual(secondPath, firstPath)
    assert.ok((await readFile(secondPath, 'utf8')).startsWith('batch=A'))
    assert.equal((await readdir(downloads)).length, 3)
    console.log('BROWSER_DOWNLOAD_PASS')
  } finally {
    await controller.close(sessionId)
    owner.close()
    server.close()
    clearTimeout(deadline)
    app.quit()
  }
}).catch((error) => { console.error(error); app.exit(1) })
