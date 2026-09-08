import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.each([
  [2, undefined, undefined],
  [2, 'claude', undefined],
  [2, 'pi', 'existing-session'],
  [3, undefined, 'existing-session'],
  [4, undefined, 'existing-session'],
] as const)('版本 %s、Runtime %s 的任务冷读只迁移旧 Runtime 会话', (version, agentRuntime, expectedSessionId) => {
  const dir = mkdtempSync(join(tmpdir(), 'la-automation-restart-'))
  const path = join(dir, 'automations.json')
  try {
    writeFileSync(path, JSON.stringify({
      version,
      automations: [{ id: 'task', scheduleType: 'interval', sessionMode: 'reuse', intervalMinutes: 20, agentRuntime, lastSessionId: 'existing-session' }],
    }))
    const script = `
      import { mock } from 'bun:test';
      mock.module(${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))}, () => ({ getAutomationsPath: () => ${JSON.stringify(path)} }));
      const { listAutomations, setLastSessionId } = await import(${JSON.stringify(join(import.meta.dir, 'automation-manager.ts'))});
      console.log(JSON.stringify(listAutomations()[0]));
      setLastSessionId('task', 'new-pi-session');
    `
    const first = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    expect(first.stderr).toBe('')
    expect(first.status).toBe(0)
    const firstTask = JSON.parse(first.stdout.trim().split('\n').at(-1)!)
    expect(firstTask.lastSessionId).toBe(expectedSessionId)
    expect(firstTask.agentRuntime).toBeUndefined()

    const restarted = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    expect(restarted.stderr).toBe('')
    expect(restarted.status).toBe(0)
    expect(JSON.parse(restarted.stdout.trim().split('\n').at(-1)!).lastSessionId).toBe('new-pi-session')
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
