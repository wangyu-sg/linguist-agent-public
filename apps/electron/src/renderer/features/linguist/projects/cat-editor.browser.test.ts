import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('CAT 浏览器：草稿与保存隔离、Linguist/Agent/Chat 导航竞态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'la-cat-editor-'))
  try {
    await build({
      absWorkingDir: resolve(import.meta.dir, '../../../../..'),
      stdin: {
        resolveDir: import.meta.dir,
        loader: 'tsx',
        contents: `
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider, createStore } from 'jotai'
import { SegmentEditor } from './SegmentEditor'
import { openLinguistAgentSession, openLinguistProjectFilesPanel } from './open-linguist-session'
import { openLocalizationProject } from './open-localization-project'
import { selectProjectAtom } from '@/host/project-switch'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useSwitchAppMode } from '@/hooks/useSwitchAppMode'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeTabIdAtom, projectCurrentAgentSessionIdMapAtom } from '@/atoms/tab-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { clearLinguistWorkbenchUiStateAtom, createLinguistTargetEditorDraftAtom,
  linguistTargetEditorCapabilityAtomFamily, linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'

window.catEditorCheck = (async () => {
const results = []
const check = (label, condition) => results.push({ label, ok: Boolean(condition) })
const tick = () => new Promise(resolve => setTimeout(resolve, 30))
const store = createStore()
const projectId = 'project-browser-test'
const assetA = 'ast-aaaaaaaaaaaaaaaa'
const assetB = 'ast-bbbbbbbbbbbbbbbb'
const segment = (assetId, ordinal) => ({ id: assetId + '-' + ordinal, assetId, ordinal,
  source: 'source ' + ordinal, target: 'original ' + ordinal, sourceLocale: 'en-US',
  targetLocale: 'zh-CN', status: 'draft', locked: false, revision: 1, sourceHash: 'hash' })
const a = Array.from({ length: 80 }, (_, index) => segment(assetA, index))
const b = [segment(assetB, 0)]
const assets = [assetA, assetB].map(assetId => ({ assetId, filename: assetId,
  formatId: 'xliff', segmentCount: assetId === assetA ? a.length : b.length, sourceSha256: 'hash' }))
let finishSave
let failSave = false
const confirmedSegments = []
window.electronAPI = {
  linguistCatQuery: async ({ assetId, offset, limit }) => {
    const segments = assetId === assetB ? b : a
    return { ok: true, data: { assets, total: segments.length,
      segments: segments.slice(offset, offset + limit), segmentIds: segments.map(item => item.id) } }
  },
  linguistProposalsListPending: async () => ({ ok: true, data: [] }),
  linguistCatListQaFindings: async () => ({ ok: true, data: { items: [], hasMore: false } }),
  linguistCatEditSegment: ({ segmentId, target }) => new Promise(resolve => {
    finishSave = () => {
      if (failSave) { resolve({ ok: false, error: { code: 'INTERNAL', message: 'test' } }); return }
      const index = a.findIndex(item => item.id === segmentId)
      a[index] = { ...a[index], target, revision: a[index].revision + 1 }
      resolve({ ok: true, data: a[index] })
    }
  }),
  linguistCatGetContext: async ({ segmentId }) => ({ ok: true, data: { segment: a.find(item => item.id === segmentId) } }),
  linguistCatConfirmStage: async ({ segmentId }) => {
    confirmedSegments.push(segmentId)
    const index = a.findIndex(item => item.id === segmentId)
    a[index] = { ...a[index], currentStageState: 'confirmed', revision: a[index].revision + 1 }
    return { ok: true, data: a[index] }
  },
}
store.set(linguistWorkbenchUiStateAtomFamily(projectId), { activeAssetId: assetA })
const root = createRoot(document.getElementById('root'))
const mount = () => root.render(<Provider store={store}><SegmentEditor projectId={projectId} archived={false} workflowStage="translation" /></Provider>)
const input = value => {
  const textarea = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
const openEditor = () => document.querySelector('[data-target-edit]').click()
const shortcut = (key, shiftKey = false) => document.querySelector('textarea')
  .dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true }))
function NavigationProbe() {
  const openSession = useOpenSession()
  const switchMode = useSwitchAppMode()
  React.useEffect(() => { window.openSession = openSession; window.switchMode = switchMode })
  return null
}
try {
  mount(); await tick(); await tick()
  openEditor(); await tick(); input('draft before scroll'); await tick()
  const viewport = document.querySelector('[data-testid="cat-virtual-scroll"]')
  viewport.scrollTop = 4500; viewport.dispatchEvent(new Event('scroll')); await tick(); await tick()
  check('滚动确实卸载原编辑行', !document.querySelector('[data-cat-row-index="0"]'))
  viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll')); await tick(); await tick()
  if (!document.querySelector('textarea')) openEditor()
  await tick()
  check('滚动返回保留草稿', document.querySelector('textarea').value === 'draft before scroll')
  input('draft before remount'); await tick()
  flushSync(() => root.render(null)); mount(); await tick(); await tick()
  if (!document.querySelector('textarea')) openEditor()
  await tick()
  check('工作区重新挂载保留草稿', document.querySelector('textarea').value === 'draft before remount')
  shortcut('z'); await tick()
  check('重新挂载保留撤销历史', document.querySelector('textarea').value === 'draft before scroll')
  shortcut('z', true); await tick()
  check('重做恢复最近草稿', document.querySelector('textarea').value === 'draft before remount')
  input('submitted'); await tick()
  shortcut('Enter')
  await tick()
  check('保存请求确实进入等待', typeof finishSave === 'function')
  check('等待保存时 textarea 只读', document.querySelector('textarea').readOnly)
  shortcut('z'); await tick()
  check('保存等待期间不接受撤销', document.querySelector('textarea').value === 'submitted')
  check('保存等待期间不接受 Dock 替换', !store.get(linguistTargetEditorCapabilityAtomFamily(projectId)).handle.replace('late input'))
  flushSync(() => root.render(null)); mount(); await tick(); await tick()
  check('保存等待期间重新挂载仍只读', document.querySelector('textarea').readOnly)
  store.set(linguistWorkbenchUiStateAtomFamily(projectId), { activeAssetId: assetB })
  await tick(); await tick()
  check('已切换到 B 批次', document.querySelector('[data-cat-row-index="0"]').dataset.segmentId === b[0].id)
  store.set(linguistWorkbenchUiStateAtomFamily(projectId), { activeSegmentId: b[0].id })
  await tick()
  const activeInB = store.get(linguistWorkbenchUiStateAtomFamily(projectId)).activeSegmentId
  finishSave(); await tick(); await tick()
  check('A 保存回执不会替换 B 行内容', document.querySelector('[data-cat-row-index="0"]').getAttribute('aria-label').includes('source 0') && !document.querySelector('[role="grid"]').textContent.includes('submitted'))
  check('延迟确认只作用于 A 段', confirmedSegments.length === 1 && confirmedSegments[0] === a[0].id)
  check('延迟确认不改变 B 当前片段', store.get(linguistWorkbenchUiStateAtomFamily(projectId)).activeSegmentId === activeInB)
  store.set(linguistWorkbenchUiStateAtomFamily(projectId), { activeAssetId: assetA })
  await tick(); await tick()
  check('成功保存清除临时草稿', !document.querySelector('textarea') && document.querySelector('[role="grid"]').textContent.includes('submitted'))
  openEditor(); await tick(); input('kept after failure'); await tick()
  failSave = true; shortcut('s'); await tick()
  flushSync(() => root.render(null)); mount(); await tick(); await tick()
  finishSave(); await tick(); await tick()
  check('卸载后保存失败仍保留可编辑草稿', document.querySelector('textarea').value === 'kept after failure' && !document.querySelector('textarea').readOnly)
  flushSync(() => root.render(null))
  a[0] = { ...a[0], target: 'remote edit', revision: a[0].revision + 1 }
  mount(); await tick(); await tick()
  check('卸载期间外部更新触发冲突且保留草稿', document.querySelector('textarea').value === 'kept after failure' && document.body.textContent.includes('译文已有更新'))
  Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保留我的草稿').click()
  await tick(); await tick()
  check('保留草稿可解除冲突', document.querySelector('textarea').value === 'kept after failure' && !document.body.textContent.includes('译文已有更新'))
  shortcut('z'); await tick()
  check('冲突处理后的撤销基线为最新译文', document.querySelector('textarea').value === 'remote edit')
  shortcut('Escape'); await tick()
  check('取消清除临时草稿', store.get(createLinguistTargetEditorDraftAtom(projectId, a[0].id)) === undefined)
  openEditor(); await tick(); input('project-scoped draft'); await tick()
  check('其他项目无法读到同名片段草稿', store.get(createLinguistTargetEditorDraftAtom('other-project', a[0].id)) === undefined)
  document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await tick(); input('输入法草稿'); await tick()
  flushSync(() => root.render(null)); mount(); await tick(); await tick()
  check('组合输入卸载后仍保留文字且不锁死', document.querySelector('textarea').value === '输入法草稿' && !store.get(createLinguistTargetEditorDraftAtom(projectId, a[0].id)).state.composing)
  flushSync(() => root.render(null))
  store.set(clearLinguistWorkbenchUiStateAtom, projectId)
  check('删除项目清除临时草稿', store.get(createLinguistTargetEditorDraftAtom(projectId, a[0].id)) === undefined)

  const sessions = ['A', 'B', 'native'].map(id => ({ id, title: id, workspaceId: id,
    ...(id === 'native' ? {} : { linguistProjectId: id }), createdAt: 1, updatedAt: 1 }))
  store.set(agentSessionsAtom, sessions)
  store.set(projectCurrentAgentSessionIdMapAtom, new Map([['A', 'A'], ['B', 'B']]))
  const finishOpen = new Map()
  const opened = projectId => ({ ok: true, data: { project: { id: projectId }, health: { projectId } } })
  const openProject = ({ projectId }) => new Promise(resolve => finishOpen.set(projectId, () => resolve(opened(projectId))))
  window.electronAPI.updateSettings = async () => {}
  window.electronAPI.updateSettingsSync = () => true
  window.electronAPI.listAgentSessions = async () => sessions
  const olderA = openLinguistAgentSession(store, 'A', openProject)
  const newerB = openLinguistAgentSession(store, 'B', openProject)
  finishOpen.get('B')(); await newerB
  finishOpen.get('A')(); await olderA
  check('Linguist A/B 响应逆序仍停在 B', store.get(currentAgentSessionIdAtom) === 'B')
  const projectA = openLocalizationProject(store, 'A', openProject)
  const sessionB = openLinguistAgentSession(store, 'B', openProject)
  finishOpen.get('B')(); await sessionB; finishOpen.get('A')(); await projectA
  check('项目与会话打开入口共享代际', store.get(currentAgentSessionIdAtom) === 'B')
  const lateLinguist = openLinguistAgentSession(store, 'A', openProject)
  await store.set(selectProjectAtom, { workspaceId: 'native' })
  finishOpen.get('A')(); await lateLinguist
  check('原生项目切换取消旧 Linguist 导航', store.get(currentAgentSessionIdAtom) === 'native' && store.get(appModeAtom) === 'agent')
  let finishNative
  window.electronAPI.listAgentSessions = () => new Promise(resolve => { finishNative = () => resolve(sessions) })
  const lateNative = store.set(selectProjectAtom, { workspaceId: 'native' })
  const latestLinguist = openLinguistAgentSession(store, 'B', openProject)
  finishOpen.get('B')(); await latestLinguist; finishNative(); await lateNative
  check('Linguist 导航取消旧原生项目切换', store.get(currentAgentSessionIdAtom) === 'B' && store.get(appModeAtom) === 'linguist')
  root.render(<Provider store={store}><NavigationProbe /></Provider>); await tick(); await tick()
  for (const type of ['agent', 'chat']) {
    const pending = openLinguistAgentSession(store, 'A', openProject)
    window.openSession(type, type === 'agent' ? 'native' : 'chat', type)
    await tick()
    const selectedTab = store.get(activeTabIdAtom)
    finishOpen.get('A')(); await pending; await tick()
    check('普通 ' + type + ' 会话取消旧 Linguist 导航', store.get(activeTabIdAtom) === selectedTab && store.get(appModeAtom) === type)
  }
  const beforeModeSwitch = openLinguistAgentSession(store, 'A', openProject)
  window.switchMode('agent'); await tick()
  finishOpen.get('A')(); await beforeModeSwitch; await tick()
  check('模式切换取消旧 Linguist 导航', store.get(currentAgentSessionIdAtom) === 'native' && store.get(appModeAtom) === 'agent')
  const beforeSameMode = openLinguistAgentSession(store, 'A', openProject)
  window.switchMode('agent'); finishOpen.get('A')(); await beforeSameMode; await tick()
  check('重选当前模式也取消旧 Linguist 导航', store.get(currentAgentSessionIdAtom) === 'native' && store.get(appModeAtom) === 'agent')
  let finishCreate
  window.electronAPI.linguistSessionsCreateForProject = () => new Promise(resolve => {
    finishCreate = () => resolve({ ok: true, data: { id: 'C', title: 'C', workspaceId: 'C', linguistProjectId: 'C', createdAt: 1, updatedAt: 1 } })
  })
  const lateFiles = openLinguistProjectFilesPanel(store, 'C', async ({ projectId }) => opened(projectId))
  const afterFiles = openLinguistAgentSession(store, 'B', openProject)
  finishOpen.get('B')(); await afterFiles; finishCreate(); await lateFiles
  check('Files 入口延迟创建不会重启过期导航', store.get(currentAgentSessionIdAtom) === 'B')
} catch (error) {
  results.push({ label: String(error.stack || error), ok: false })
}
return results
})()
`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'check.js'),
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><style>
      [role="grid"] { height: 420px; width: 900px; display:flex; flex-direction:column; }
      [data-testid="cat-virtual-scroll"] { height: 360px; overflow:auto; flex:1; }
      [data-cat-row-index] { position:absolute; top:0; left:0; min-height:72px; width:100%; }
    </style></head><body><div id="root"></div><script src="check.js"></script></body></html>`)
    await writeFile(join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, width: 1000, height: 800,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false,
            webSecurity: true, backgroundThrottling: false } })
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        const results = await window.webContents.executeJavaScript('window.catEditorCheck')
        console.log('CAT_EDITOR_CHECK=' + JSON.stringify(results))
        app.exit(0)
      }).catch(error => { console.error(error); app.exit(1) })
    `)
    const electronExecutable = createRequire(import.meta.url)('electron') as string
    const browser = Bun.spawn([
      electronExecutable,
      `--user-data-dir=${join(directory, 'browser-profile')}`,
      join(directory, 'main.cjs'),
    ], { stdout: 'pipe', stderr: 'pipe' })
    const [output, errors, status] = await Promise.all([
      new Response(browser.stdout).text(), new Response(browser.stderr).text(), browser.exited,
    ])
    expect(status, errors).toBe(0)
    const result = output.match(/CAT_EDITOR_CHECK=(.+)/)?.[1]
    expect(result, output).toBeDefined()
    const checks = JSON.parse(result!) as Array<{ label: string; ok: boolean }>
    expect(checks.filter(check => !check.ok), JSON.stringify(checks, null, 2)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
