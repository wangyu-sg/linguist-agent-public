/** 用真实 Electron WebContents 验证固定上游 popup 生命周期；仅合成 about:blank 页面。 */
import assert from 'node:assert/strict'
import { app, BrowserWindow, webContents } from 'electron'
import { BrowserController } from '../../src/main/lib/browser-controller'
import { updateSettings } from '../../src/main/lib/settings-service'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '../../src/types/settings'

const timeout = setTimeout(() => { console.error('FAIL popup lifecycle timeout'); app.exit(1) }, 30_000)
void app.whenReady().then(async () => {
  assert.ok(app.getPath('userData').includes('la-popup-'), '必须使用专用临时 user-data-dir')
  updateSettings({ browserRiskDisclaimerVersion: BROWSER_RISK_DISCLAIMER_VERSION })
  const owner = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  const controller = new BrowserController()
  controller.setOwnerWindow(owner)
  const initial = await controller.createNewTab('popup-fixture')
  const openerId = initial.activeTabId
  const opener = webContents.getAllWebContents().find(contents => contents.id !== owner.webContents.id)!
  await opener.loadURL('about:blank')
  await opener.executeJavaScript("window.open('about:blank', 'fixture'); true")
  const deadline = Date.now() + 5_000
  while (controller.listTabs('popup-fixture').tabs.length !== 2) {
    assert.ok(Date.now() < deadline, 'popup 未成为真实受管 Tab')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const popup = controller.listTabs('popup-fixture').tabs.find(tab => tab.openedByPopup)!
  assert.ok(popup)
  const child = webContents.getAllWebContents().find(contents => contents.id !== owner.webContents.id && contents.id !== opener.id)!
  await child.executeJavaScript("document.body.textContent = 'popup survives'; true")
  controller.selectTab('popup-fixture', openerId)
  controller.selectTab('popup-fixture', popup.tabId)
  const afterClose = await controller.closeTab('popup-fixture', openerId)
  assert.deepEqual(afterClose!.tabs.map(tab => tab.tabId), [popup.tabId])
  assert.equal(child.isDestroyed(), false)
  assert.equal(await child.executeJavaScript('document.body.textContent'), 'popup survives')
  const other = await controller.createNewTab('popup-fixture')
  controller.selectTab('popup-fixture', popup.tabId)
  await controller.closeTab('popup-fixture', other.activeTabId)
  assert.equal(await child.executeJavaScript('document.body.textContent'), 'popup survives')
  assert.equal(await controller.closeTab('popup-fixture', popup.tabId), null)
  owner.destroy()
  clearTimeout(timeout)
  console.log('PASS: real popup → switch → close opener → switch/close other → child content survives → close child')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
