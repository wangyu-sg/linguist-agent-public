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
import { ProposalInbox } from './ProposalInbox'
import { QaFindingsPanel } from './QaFindingsPanel'
import { restorePersistedTabState, tabsAtom } from '@/atoms/tab-atoms'
import { openLinguistPreview } from './linguist-preview-open'
import { openPreviewInStore } from '@/components/diff/preview-opener'
import { previewFilesMapAtom } from '@/atoms/preview-atoms'
import { useGlobalAgentListeners } from '@/hooks/useGlobalAgentListeners'
import { useAgentHostExtension } from '@/host/agent-host-extension'
import { useLinguistSidebarActions } from '../sidebar/useLinguistSidebarActions'
import { LinguistSessionBindingBadge } from '../session-binding/LinguistSessionBindingBadge'
import { agentSidePanelOpenAtomFamily, agentTerminalTabsAtom } from '@/atoms/agent-atoms'
import { openLinguistAgentSession, openLinguistProjectFilesPanel } from './open-linguist-session'
import { openLocalizationProject } from './open-localization-project'
import { selectProjectAtom } from '@/host/project-switch'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useSwitchAppMode } from '@/hooks/useSwitchAppMode'
import { agentSessionsAtom, currentAgentSessionIdAtom, openWorkspaceComponentAtom, closeWorkspaceComponentAtom, agentDiffPanelTabAtom } from '@/atoms/agent-atoms'
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
function NavigationProbe({ sessionId = 'native' }) {
  const openSession = useOpenSession()
  const switchMode = useSwitchAppMode()
  const host = useAgentHostExtension(sessionId)
  React.useEffect(() => { window.openSession = openSession; window.switchMode = switchMode; window.hostExtension = host })
  return null
}
function SidebarActionsProbe({ session }) {
  const actions = useLinguistSidebarActions()
  React.useEffect(() => { window.sidebarActions = actions })
  return <LinguistSessionBindingBadge session={session} />
}
function GlobalListenersProbe() { useGlobalAgentListeners(); return null }
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
  for (const sessionId of ['A', 'native']) {
    store.set(currentAgentSessionIdAtom, sessionId)
    const catState = store.get(linguistWorkbenchUiStateAtomFamily(projectId))
    for (const component of ['todos', 'calendar', 'automations', 'skills', 'mcp', 'memory', 'vault']) {
      store.set(openWorkspaceComponentAtom, component)
      check(sessionId + ' 打开 ' + component + ' 沿用会话', store.get(currentAgentSessionIdAtom) === sessionId && store.get(agentDiffPanelTabAtom).get(sessionId) === component)
      store.set(closeWorkspaceComponentAtom, component)
      check(sessionId + ' 关闭 ' + component + ' 回到基础工作区', store.get(agentDiffPanelTabAtom).get(sessionId) === (sessionId === 'A' ? 'linguist' : 'files'))
    }
    check(sessionId + ' 原生面板不改变 CAT 状态', store.get(linguistWorkbenchUiStateAtomFamily(projectId)) === catState)
  }
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
  const beforePreviewTab = store.get(activeTabIdAtom)
  openLinguistPreview('B', (id, file) => openPreviewInStore(store, id, file),
    { kind: 'batch', projectId: 'B', assetId: assetB, filename: 'same.xliff', formatId: 'xliff' })
  check('预览保留中心会话且使用明确宿主', store.get(activeTabIdAtom) === beforePreviewTab && store.get(previewFilesMapAtom).get('B').length === 1)
  openLinguistPreview('B', (id, file) => openPreviewInStore(store, id, file),
    { kind: 'batch', projectId: 'B', assetId: assetA, filename: 'same.xliff', formatId: 'xliff' })
  check('同名受管批次保留独立预览身份', store.get(previewFilesMapAtom).get('B').length === 2)
  openLinguistPreview('B', (id, file) => openPreviewInStore(store, id, file),
    { kind: 'batch', projectId: 'B', assetId: assetB, filename: 'same.xliff', formatId: 'xliff' })
  check('重开同一受管批次复用原Tab', store.get(previewFilesMapAtom).get('B').length === 2)
  const oldUi = { tabs: [{ id: 'linguist-project:A', type: 'linguist-project', projectId: 'A', title: '项目 A' },
    { id: '__preview__:B', type: 'preview', sessionId: 'B', title: '只剩标题' }], activeTabId: 'linguist-project:A' }
  const restored = restorePersistedTabState(oldUi, new Set(['A', 'B']), new Map([['A', { id: 'A', title: 'A' }]]))
  check('旧项目及预览恢复为合法原生会话', restored.activeTabId === 'A' && restored.tabs.every(tab => tab.type === 'agent') && restored.tabs.map(tab => tab.sessionId).join(',') === 'A,B')
  check('旧状态归一幂等', JSON.stringify(restorePersistedTabState(restored, new Set(['A', 'B']), new Map())) === JSON.stringify(restored))
  let finishAList
  const requests = []
  const diff = (id, status) => ({ proposal: { id, segmentId: id, status, warnings: [], evidenceRefs: [], termRefs: [],
    createdAt: '2026-09-09', runId: id }, originalOrdinal: 1, source: id, currentTarget: '译文', proposedTarget: '译文',
    currentRevision: 1, baseRevision: 0, locked: false })
  window.electronAPI.linguistProposalsList = request => {
    requests.push(request)
    if (request.assetId === assetA) return new Promise(resolve => { finishAList = () => resolve({ ok: true, data: { items: [diff('old-A', 'pending')], total: 1, offset: 0, hasMore: false } }) })
    return Promise.resolve({ ok: true, data: { items: [diff('new-B', request.status === 'pending' ? 'pending' : 'accepted')], total: 1, offset: 0, hasMore: false } })
  }
  const inbox = assetId => root.render(<Provider store={store}><ProposalInbox key={assetId} projectId={projectId} assetId={assetId} archived={false} onChanged={async () => {}} /></Provider>)
  inbox(assetA); await tick(); inbox(assetB); await tick(); finishAList(); await tick()
  check('建议默认当前批次待处理且迟到 A 不覆盖 B', requests.at(-1).assetId === assetB && requests.at(-1).status === 'pending' && document.body.textContent.includes('new-B') && !document.body.textContent.includes('old-A'))
  check('pending 即使文字一致仍提示版本冲突', document.body.textContent.includes('版本冲突'))
  const statusSelect = document.querySelector('#proposal-status-filter')
  statusSelect.value = 'all'; statusSelect.dispatchEvent(new Event('change', { bubbles: true })); await tick(); await tick()
  check('全部历史仍只查询 B 且 accepted 不报冲突', requests.at(-1).assetId === assetB && !requests.at(-1).status && document.body.textContent.includes('已应用') && !document.body.textContent.includes('版本冲突'))
  const qaRequests = []
  window.electronAPI.linguistCatListQaFindings = async request => { qaRequests.push(request); return { ok: true, data: { items: [], total: 0, offset: 0, hasMore: false } } }
  root.render(<Provider store={store}><QaFindingsPanel projectId={projectId} activeAssetId={assetB} archived={false} onJump={() => {}} onChanged={async () => {}} refreshToken={0} /></Provider>); await tick(); await tick()
  check('QA 默认查询当前批次', qaRequests.at(-1).assetId === assetB)
  root.render(<Provider store={store}><QaFindingsPanel projectId={projectId} archived={false} onJump={() => {}} onChanged={async () => {}} refreshToken={0} /></Provider>); await tick(); await tick()
  check('未选批次不请求全项目 QA', qaRequests.length === 1 && document.body.textContent.includes('选择批次后查看 QA'))

  let projectName = '旧项目名'
  window.electronAPI.linguistProjectsList = async () => ({ ok: true, data: [{ id: 'B', name: projectName }] })
  window.electronAPI.linguistProjectsRename = async ({ name }) => { projectName = name; return { ok: true, data: { id: 'B', name } } }
  window.electronAPI.linguistSessionsGetBinding = async () => ({ ok: true, data: { binding: { projectId: 'B', projectName: '旧项目名', status: 'active' } } })
  store.set(agentSidePanelOpenAtomFamily('B'), false)
  store.set(agentDiffPanelTabAtom, new Map([['B', 'files']]))
  root.render(<Provider store={store}><SidebarActionsProbe session={sessions[1]} /></Provider>); await tick(); await tick()
  await window.sidebarActions.settings('B'); await tick()
  check('同项目设置入口展开右区并进入CAT', store.get(agentSidePanelOpenAtomFamily('B')) && store.get(agentDiffPanelTabAtom).get('B') === 'linguist' && store.get(linguistWorkbenchUiStateAtomFamily('B')).projectSettingsOpen)
  await window.sidebarActions.rename('B', '新项目名'); await tick(); await tick()
  check('项目改名刷新徽标且不改会话标题', document.body.textContent.includes('新项目名') && store.get(agentSessionsAtom).find(session => session.id === 'B').title === 'B')

  root.render(<Provider store={store}><NavigationProbe /></Provider>); await tick(); await tick()
  check('普通会话继续新任务沿用原生创建入口', window.hostExtension.createContinuationSession === undefined)
  store.set(agentSessionsAtom, previous => previous.map(session => session.id === 'B' ? { ...session, linguistRole: 'reviewer' } : session))
  const continuationRequests = []
  window.electronAPI.linguistSessionsCreateForProject = async input => {
    continuationRequests.push(input)
    return continuationRequests.length === 1 ? { ok: true, data: { id: 'B-continuation', linguistProjectId: 'B', linguistRole: input.role } }
      : { ok: false, error: { code: 'INTERNAL', message: '创建失败证据' } }
  }
  let ordinaryCreationCount = 0
  window.electronAPI.createAgentSession = async () => { ordinaryCreationCount++; throw new Error('不应使用普通创建') }
  root.render(<Provider store={store}><NavigationProbe sessionId="B" /></Provider>); await tick(); await tick()
  const continuation = await window.hostExtension.createContinuationSession()
  check('LA继续新任务保留来源项目和岗位', continuation.linguistProjectId === 'B' && continuation.linguistRole === 'reviewer' && JSON.stringify(continuationRequests[0]) === JSON.stringify({ projectId: 'B', role: 'reviewer' }))
  let continuationError = ''
  try { await window.hostExtension.createContinuationSession() } catch (error) { continuationError = error.message }
  check('LA继续创建失败明确报错且不降级普通会话', continuationError === '创建失败证据' && ordinaryCreationCount === 0)

  // 只挂载应用级监听器，不挂载右栏：Chat/规划页也必须保留后台终端事件。
  const terminalListeners = new Map()
  window.electronAPI = new Proxy(window.electronAPI, { get(target, name) {
    if (String(name).startsWith('on')) return callback => { terminalListeners.set(name, callback); return () => terminalListeners.delete(name) }
    if (name === 'getPendingRequests') return async () => ({ exitPlans: [] })
    if (['listActiveAgentSessionSnapshots', 'listActiveAgentSessions', 'getQueuedAgentMessages'].includes(name)) return async () => []
    if (name === 'setVisibleAgentStreamSession') return async () => {}
    return target[name]
  } })
  store.set(currentAgentSessionIdAtom, null)
  root.render(<Provider store={store}><GlobalListenersProbe /></Provider>); await tick(); await tick()
  const backgroundTerminal = { sessionId: 'B', terminalId: 'background-terminal', title: '后台终端' }
  terminalListeners.get('onAgentTerminalOpen')?.(backgroundTerminal)
  check('右栏未挂载仍收集后台终端', store.get(agentTerminalTabsAtom).get('B')?.length === 1)
  check('后台终端不抢当前会话焦点', store.get(currentAgentSessionIdAtom) === null)
  terminalListeners.get('onAgentTerminalClose')?.(backgroundTerminal)
  check('右栏未挂载仍清理已关闭终端', !store.get(agentTerminalTabsAtom).has('B'))
  flushSync(() => root.render(null))
  check('全局终端监听随应用根清理', !terminalListeners.has('onAgentTerminalOpen') && !terminalListeners.has('onAgentTerminalClose'))

} catch (error) {
  results.push({ label: String(error.stack || error), ok: false })
}
return results
})()
`,
      },
      bundle: true,
      format: 'iife',
      loader: { '.mp3': 'file', '.webp': 'file' },
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
