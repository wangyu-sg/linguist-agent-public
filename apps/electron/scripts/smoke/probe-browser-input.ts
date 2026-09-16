/** 真实受管 WebContents；只使用合成页面与隔离配置，绝不进入客户任务。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { app, BrowserWindow, webContents } from 'electron'
import { BrowserController } from '../../src/main/lib/browser-controller'
import { updateSettings } from '../../src/main/lib/settings-service'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '../../src/types/settings'
import type { BrowserSequenceStep } from '@proma/shared'

const deadline = setTimeout(() => { console.error('Browser fixture timed out'); app.exit(1) }, 45_000)
void app.whenReady().then(async () => {
  assert.ok(app.getPath('userData').includes('la-browser-input-'))
  updateSettings({ browserRiskDisclaimerVersion: BROWSER_RISK_DISCLAIMER_VERSION })
  const owner = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  const controller = new BrowserController()
  controller.setOwnerWindow(owner)
  const sessionId = 'input-fixture'
  const state = await controller.createNewTab(sessionId)
  const tabId = state.activeTabId
  const page = webContents.getAllWebContents().find(item => item.id !== owner.webContents.id)!
  let saved = ''
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => { setTimeout(() => { saved = body; response.end('saved') }, 80) })
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<textarea id="target"></textarea><script>document.querySelector('#target').value=${JSON.stringify(saved)}</script>`)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const fixtureUrl = `http://127.0.0.1:${address.port}`
  await owner.loadURL('about:blank')
  owner.showInactive()
  controller.setLayout({ sessionId, tabId, visible: true, revision: 1, bounds: {x:0,y:0,width:800,height:600} })
  await page.loadURL(fixtureUrl)
  await page.executeJavaScript(`document.body.innerHTML = '<textarea id="target">original</textarea><input id="other" value="untouched"><div id="cell">cell</div>'; window.keys=[]; document.addEventListener('keydown',e=>window.keys.push({key:e.key,meta:e.metaKey,ctrl:e.ctrlKey,shift:e.shiftKey})); document.querySelector('#target').focus(); true`)
  await page.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const target = { selector: '#target' }
  const current = { expression: `() => document.querySelector('#target').value` }
  await assert.rejects(controller.press(sessionId, 'Meta+A', tabId), /action/)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'original')
  await controller.press(sessionId, { action: { kind: 'key', key: 'a', modifiers: ['Meta'] }, target }, tabId)
  await controller.press(sessionId, { action: { kind: 'text', text: 'Meta+A' }, target }, tabId)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'Meta+A')
  await controller.press(sessionId, { action: { kind: 'key', key: 'a', modifiers: ['Control'] }, target }, tabId)
  await controller.press(sessionId, { action: { kind: 'text', text: 'Enter' }, target }, tabId)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'Enter')
  await controller.press(sessionId, { action: { kind: 'key', key: 'Home' }, target }, tabId)
  await controller.press(sessionId, { action: { kind: 'key', key: 'End', modifiers: ['Shift'] }, target }, tabId)
  await controller.press(sessionId, { action: { kind: 'text', text: '🧩' }, target }, tabId)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), '🧩')
  await controller.press(sessionId, { action: { kind: 'key', key: 'Enter', modifiers: ['Shift'] }, target }, tabId)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), '🧩\n')
  await controller.press(sessionId, { action: { kind: 'key', key: 'F8' }, target }, tabId)
  assert.equal(await page.executeJavaScript(`window.keys.at(-1).key`), 'F8')
  await page.executeJavaScript(`document.querySelector('#other').focus(); true`)
  await assert.rejects(controller.press(sessionId, { action: { kind: 'text', text: 'wrong' }, target }, tabId), /聚焦/)
  await assert.rejects(controller.press(sessionId, { action: { kind: 'text', text: 'wrong' }, target: { selector: '#cell', focus: 'activate' } }, tabId))
  assert.equal(await page.executeJavaScript(`document.querySelector('#other').value`), 'untouched')
  const steps: BrowserSequenceStep[] = [
    { kind: 'focus', target },
    { kind: 'press', action: { kind: 'key', key: 'a', modifiers: ['Meta'] }, target },
    { kind: 'press', action: { kind: 'text', text: 'exact 😀\n ' }, target, guard: { probe: current, expected: '🧩\n' } },
    { kind: 'check', probe: current, expected: 'exact 😀\n ' },
    { kind: 'read', probe: current },
  ]
  const result = await controller.act(sessionId, { tabId, steps })
  assert.ok('status' in result)
  assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(result.completedStepCount, 5)
  assert.equal(result.results.at(-1)?.value, 'exact 😀\n ')
  const mismatch = await controller.act(sessionId, { tabId, steps: [
    { kind: 'read', probe: current },
    { kind: 'press', action: { kind: 'text', text: 'NO' }, target, guard: { probe: current, expected: 'stale' } },
    { kind: 'press', action: { kind: 'text', text: 'NEVER' }, target },
  ] })
  assert.ok('status' in mismatch)
  assert.equal(mismatch.status, 'partial')
  assert.equal(mismatch.results[1]?.status, 'mismatch')
  assert.equal(mismatch.unexecutedFrom, 2)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'exact 😀\n ')
  // 后半段非法参数必须在前半段触碰页面前拒绝。
  await assert.rejects(controller.act(sessionId, { tabId, steps: [
    { kind: 'press', action: { kind: 'text', text: 'NO' }, target },
    { kind: 'read', probe: { expression: '() => {' } },
  ] }))
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'exact 😀\n ')
  for (const expression of [
    `() => { document.querySelector('#target').value='BAD'; return true }`,
    `() => Promise.resolve(true)`,
  ]) {
    const rejected = await controller.act(sessionId, { tabId, steps: [{ kind: 'read', probe: { expression } }] })
    assert.ok('status' in rejected && rejected.status === 'failed', JSON.stringify(rejected))
  }
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'exact 😀\n ')
  await page.executeJavaScript(`for(let i=0;i<5;i++){const input=document.createElement('textarea');input.id='row-'+i;input.value='old-'+i;document.body.append(input)}; true`)
  const five: BrowserSequenceStep[] = []
  for (let i = 0; i < 5; i++) {
    const probe = { expression: `(id) => document.querySelector('#'+id).value`, args: `row-${i}` }
    five.push({ kind: 'fill', target: { selector: `#row-${i}` }, text: `new-${i}`, guard: { probe, expected: `old-${i}` }, itemId: String(i) })
    five.push({ kind: 'check', probe, expected: `new-${i}` })
  }
  const fiveResult = await controller.act(sessionId, { tabId, steps: five })
  assert.ok('status' in fiveResult && fiveResult.status === 'completed', JSON.stringify(fiveResult))
  const conflict = await controller.act(sessionId, { tabId, steps: Array.from({ length: 5 }, (_, i) => ({
    kind: 'fill' as const, target: { selector: `#row-${i}` }, text: `second-${i}`,
    guard: { probe: { expression: `(id) => document.querySelector('#'+id).value`, args: `row-${i}` }, expected: i === 2 ? 'stale' : `new-${i}` },
  })) })
  assert.ok('status' in conflict && conflict.status === 'partial', JSON.stringify(conflict))
  assert.equal(conflict.completedStepCount, 2)
  assert.deepEqual(await page.executeJavaScript(`Array.from(document.querySelectorAll('[id^="row-"]'), x=>x.value)`), ['second-0', 'second-1', 'new-2', 'new-3', 'new-4'])
  const queuedA = controller.act(sessionId, { tabId, steps: [{ kind: 'fill', target, text: 'queued-A' }] })
  const queuedB = controller.act(sessionId, { tabId, steps: [{ kind: 'fill', target, text: 'queued-B', guard: { probe: current, expected: 'queued-A' } }] })
  for (const queued of await Promise.all([queuedA, queuedB])) assert.ok('status' in queued && queued.status === 'completed')
  // 虚拟化可复用同一输入节点，仍必须重新比对业务身份。
  await page.executeJavaScript(`document.querySelector('#target').dataset.row='another-row'; true`)
  const reused = await controller.act(sessionId, { tabId, steps: [{ kind: 'press', action: { kind: 'text', text: 'WRONG ROW' }, target, guard: { probe: { expression: `() => document.querySelector('#target').dataset.row` }, expected: 'original-row' } }] })
  assert.ok('status' in reused && reused.results[0]?.status === 'mismatch')
  const stopped = new AbortController()
  const pending = controller.act(sessionId, { tabId, steps: [
    { kind: 'read', probe: current },
    { kind: 'wait', probe: { expression: '() => false' }, expected: true },
    { kind: 'press', action: { kind: 'text', text: 'AFTER STOP' }, target },
  ] }, stopped.signal)
  setTimeout(() => stopped.abort(), 50)
  const stoppedResult = await pending
  assert.ok('status' in stoppedResult && stoppedResult.status === 'aborted', JSON.stringify(stoppedResult))
  assert.equal(stoppedResult.completedStepCount, 1)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'queued-B')
  // 输入已经派发但页面仍在处理时取消，不能将未知项记作成功或继续下一次写入。
  await page.executeJavaScript(`document.querySelector('#target').addEventListener('input', () => { const end=Date.now()+250; while(Date.now()<end) {} }, {once:true}); true`)
  const interrupted = new AbortController()
  const writing = controller.act(sessionId, { tabId, steps: [
    { kind: 'press', action: { kind: 'text', text: 'X' }, target },
    { kind: 'press', action: { kind: 'text', text: 'NEVER' }, target },
  ] }, interrupted.signal)
  setTimeout(() => interrupted.abort(), 60)
  const uncertain = await writing
  assert.ok('status' in uncertain && uncertain.status === 'unknown', JSON.stringify(uncertain))
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), 'queued-BX')
  await page.executeJavaScript(`document.querySelector('#target').addEventListener('input', async e => { const input=e.target; const value=input.value; await fetch('/', {method:'POST',body:value}); if(input.value===value) input.dataset.savedText=value }); true`)
  const durable = 'persisted 😀\n '
  const persisted = await controller.act(sessionId, { tabId, steps: [
    { kind: 'fill', target, text: durable },
    { kind: 'check', probe: current, expected: durable },
    { kind: 'wait', probe: { expression: `() => {const input=document.querySelector('#target');return {text:input.value,saved:input.dataset.savedText}}` }, expected: { text: durable, saved: durable } },
  ] })
  assert.ok('status' in persisted && persisted.status === 'completed', JSON.stringify(persisted))
  await page.loadURL(fixtureUrl)
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), durable)
  // 排队期间的超时立即返回；稍后获得队列也不得补写。
  const blockedQueue = new AbortController()
  const blocker = controller.act(sessionId, { tabId, steps: [{ kind: 'wait', probe: { expression: '() => false' }, expected: true }] }, blockedQueue.signal)
  const queueDeadline = await controller.act(sessionId, { tabId, timeoutMs: 250, steps: [{ kind: 'fill', target, text: 'QUEUED MUST NOT RUN' }] })
  assert.ok('status' in queueDeadline && queueDeadline.status === 'aborted' && queueDeadline.completedStepCount === 0)
  blockedQueue.abort()
  await blocker
  const originalRef = (await controller.observe(sessionId, tabId)).elements.find(item => item.editable)!.ref
  await controller.observe(sessionId, tabId)
  await assert.rejects(controller.press(sessionId, { action: { kind: 'text', text: 'STALE' }, target: { ref: originalRef } }, tabId))
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), durable)
  await page.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<a id="navigate" href="/next">next</a>');true`)
  const navigated = await controller.act(sessionId, { tabId, steps: [
    { kind: 'click', target: {selector:'#navigate'} },
    { kind: 'wait', probe: { expression: '() => false' }, expected: true },
    { kind: 'fill', target, text: 'AFTER NAVIGATION' },
  ] })
  assert.ok('status' in navigated && ['unknown','partial'].includes(navigated.status), JSON.stringify(navigated))
  assert.equal(await page.executeJavaScript(`document.querySelector('#target').value`), durable)

  // 合成富文本只编辑获准文字叶子；原生标签 identity、配对、变量和格式节点保持不变。
  await page.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<div id="rich"><span data-tag="open" contenteditable="false">{1}</span><b contenteditable="true" style="white-space:pre-wrap" id="rich-text">old</b><span data-tag="close" contenteditable="false">{/1}</span><span id="variable">{player}</span></div>'); window.originalTags = Array.from(document.querySelectorAll('[data-tag]')); true`)
  const richText = '— 😀 literal \\n with formatting'
  const rich = await controller.act(sessionId, { tabId, steps: [
    { kind: 'fill', target: { selector: '#rich-text' }, text: richText },
    { kind: 'check', probe: { expression: `() => document.querySelector('#rich-text').innerText` }, expected: richText },
    { kind: 'check', probe: { expression: `() => ({tags:Array.from(document.querySelectorAll('[data-tag]'),(node,index)=>({same:node===window.originalTags[index],kind:node.dataset.tag})),variable:document.querySelector('#variable').textContent,format:document.querySelector('#rich-text').tagName})` }, expected: { tags: [{same:true,kind:'open'},{same:true,kind:'close'}], variable:'{player}', format:'B' } },
  ] })
  assert.ok('status' in rich && rich.status === 'completed', JSON.stringify(rich) + await page.executeJavaScript(`document.querySelector('#rich-text').outerHTML`))
  // 陈旧 Saved 与失败保存均不能通过本次内容屏障；不继续确认。
  await page.executeJavaScript(`document.querySelector('#target').dataset.savedText='previous'; true`)
  const failedSave = await controller.act(sessionId, { tabId, steps: [
    { kind: 'fill', target, text: 'not persisted' },
    { kind: 'wait', timeoutMs: 100, probe: { expression: `() => document.querySelector('#target').dataset.savedText` }, expected: 'not persisted' },
    { kind: 'fill', target, text: 'UNSAFE CONTINUATION' },
  ] })
  assert.ok('status' in failedSave && failedSave.status === 'partial' && failedSave.completedStepCount === 1)
  assert.equal(saved, durable)
  // 延迟 TM 必须归属当前行且在确认前；空 TM 有效，TB 不算 TM。QA 阻断不得触发确认/完工。
  await page.executeJavaScript(`window.jobState='Accepted'; window.confirmed=0; window.tm={owner:'old-row',phase:'before-confirm',matches:[],tb:['term']}; window.qa='blocked'; document.body.insertAdjacentHTML('beforeend','<button id="confirm">确认句段</button><button id="complete">完成工作</button>'); document.querySelector('#confirm').onclick=()=>{window.confirmed++;window.tm={owner:'row',phase:'after-confirm',matches:[100],tb:[]}};document.querySelector('#complete').onclick=()=>window.jobState='Completed';setTimeout(()=>window.tm={owner:'row',phase:'before-confirm',matches:[],tb:['term']},80);true`)
  const tmProbe = { expression: `() => ({owner:window.tm.owner,phase:window.tm.phase,matches:window.tm.matches})` }
  const emptyTm = {owner:'row',phase:'before-confirm',matches:[]}
  const qaBlocked = await controller.act(sessionId, { tabId, steps: [
    {kind:'wait',probe:tmProbe,expected:emptyTm},
    {kind:'read',probe:tmProbe},
    {kind:'click',target:{selector:'#confirm'},guard:{probe:{expression:`() => window.qa`},expected:'clear'}},
  ] })
  assert.ok('status' in qaBlocked && qaBlocked.status === 'partial' && qaBlocked.completedStepCount === 2)
  assert.equal(await page.executeJavaScript('window.confirmed'), 0)
  await page.executeJavaScript(`window.qa='clear';true`)
  const confirmed = await controller.act(sessionId, { tabId, steps:[
    {kind:'click',target:{selector:'#confirm'},guard:{probe:tmProbe,expected:emptyTm}},
    {kind:'check',probe:{expression:`() => ({confirmed:window.confirmed,job:window.jobState})`},expected:{confirmed:1,job:'Accepted'}},
    {kind:'check',probe:tmProbe,expected:emptyTm},
    {kind:'click',target:{selector:'#complete'}},
  ] })
  assert.ok('status' in confirmed && confirmed.status === 'partial' && confirmed.completedStepCount === 2)
  assert.equal(await page.executeJavaScript('window.jobState'), 'Accepted')

  // 同条件比较原子操作与组合调用；不含模型往返或网站保存，不推断真实 Phrase 倍数。
  await page.executeJavaScript(`for(let i=0;i<5;i++){const input=document.createElement('textarea');input.id='perf-'+i;document.body.append(input)};true`)
  const timings: Array<{rows:number;mode:string;calls:number;elapsedMs:number}> = []
  for (const rows of [1, 5]) for (const mode of ['atomic', 'steps']) for (let sample=0;sample<3;sample++) {
    const edits: BrowserSequenceStep[] = []
    for (let row=0;row<rows;row++) edits.push(
      {kind:'press',target:{selector:'#perf-'+row,focus:'activate'},action:{kind:'key',key:'a',modifiers:['Meta']}},
      {kind:'press',target:{selector:'#perf-'+row},action:{kind:'text',text:` — row ${row} 😀\n `}},
      {kind:'read',probe:{expression:`(id) => document.querySelector('#'+id).value`,args:'perf-'+row}},
    )
    const start = performance.now()
    if (mode === 'steps') {
      const done=await controller.act(sessionId,{tabId,steps:edits})
      assert.ok('status' in done && done.status === 'completed')
    } else for (const step of edits) {
      if(step.kind==='press') await controller.press(sessionId,{target:step.target,action:step.action},tabId)
      else if (step.kind==='read') await controller.evaluate(sessionId,`(${step.probe.expression})(${JSON.stringify(step.probe.args)})`,tabId)
    }
    timings.push({rows,mode,calls:mode==='steps'?1:rows*3,elapsedMs:performance.now()-start})
  }
  console.log('BROWSER_FIXTURE_TIMINGS='+JSON.stringify(timings))
  console.log('BROWSER_SEQUENCE_COUNTS=' + JSON.stringify({ oneRow: result.completedStepCount, fiveEdits: fiveResult.completedStepCount, callsPerGroup: 1, timing: fiveResult.timing }))
  await controller.close(sessionId)
  server.close()
  owner.destroy()
  clearTimeout(deadline)
  console.log('BROWSER_INPUT_PASS')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
