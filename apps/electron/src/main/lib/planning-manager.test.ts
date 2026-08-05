import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const managerModulePath = join(import.meta.dir, 'planning-manager.ts')
const repoRoot = dirname(dirname(dirname(dirname(dirname(import.meta.dir)))))

function runVerifier(sourcePath: string, home: string, mode: 'seed' | 'reload' | 'invalid'): void {
  const result = spawnSync(process.execPath, [sourcePath, mode], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, PROMA_DEV: '1' },
    encoding: 'utf8',
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test('Given Planning JSON storage When data changes Then reload, rollback, CAS, cascades, and reminder claims remain correct', () => {
  const home = mkdtempSync(join(tmpdir(), 'linguist-planning-'))
  const sourcePath = join(home, 'verify-planning-manager.ts')
  const statePath = join(home, '.linguist-agent-dev', 'planning.json')
  const source = `
    import assert from 'node:assert/strict'
    import { existsSync, readFileSync } from 'node:fs'
    import { join } from 'node:path'
    import * as manager from ${JSON.stringify(managerModulePath)}

    const mode = process.argv[2]
    const configDir = join(process.env.HOME, '.linguist-agent-dev')
    const statePath = join(configDir, 'planning.json')
    const now = Date.now()

    if (mode === 'seed') {
      const todoGroup = manager.createPlanningGroup({ scope: 'todo', name: '工作' })
      const calendarGroup = manager.createPlanningGroup({ scope: 'calendar', name: '工作' })
      const tag = manager.createPlanningTag({ name: '重要' })
      const dueAt = now + 2 * 60 * 60 * 1000

      assert.ok(existsSync(statePath))
      const stableTodo = manager.createTodo({ title: '持久 Todo', dueAt, groupId: todoGroup.id, tagIds: [tag.id] })
      assert.ok(manager.getTodo(stableTodo.id).reminders.some((item) => item.origin === 'todo_due_at'))

      const beforeFailure = readFileSync(statePath, 'utf8')
      assert.throws(() => manager.createTodo({ title: '不应部分创建', tagIds: [tag.id, 'missing-tag'] }), /标签不存在/)
      assert.equal(readFileSync(statePath, 'utf8'), beforeFailure)

      const newerTodo = manager.updateTodo({ id: stableTodo.id, title: 'Todo 新版本', expectedUpdatedAt: stableTodo.updatedAt })
      assert.equal(newerTodo.title, 'Todo 新版本')
      assert.throws(() => manager.updateTodo({ id: stableTodo.id, title: 'Todo 旧版本', expectedUpdatedAt: stableTodo.updatedAt }), /其他窗口修改/)

      const event = manager.createCalendarEvent({ title: '稳定日程', startAt: now, groupId: calendarGroup.id, tagIds: [tag.id] })
      const newerEvent = manager.updateCalendarEvent({ id: event.id, title: '日程新版本', expectedUpdatedAt: event.updatedAt })
      assert.equal(newerEvent.title, '日程新版本')
      assert.throws(() => manager.updateCalendarEvent({ id: event.id, title: '日程旧版本', expectedUpdatedAt: event.updatedAt }), /其他窗口修改/)

      const cascadeTag = manager.createPlanningTag({ name: '待级联标签' })
      const taggedTodo = manager.createTodo({ title: '待级联标签 Todo', tagIds: [cascadeTag.id] })
      const taggedEvent = manager.createCalendarEvent({ title: '待级联标签日程', startAt: now, tagIds: [cascadeTag.id] })
      assert.equal(manager.deletePlanningTag(cascadeTag.id), true)
      assert.deepEqual(manager.getTodo(taggedTodo.id).tags, [])
      assert.deepEqual(manager.getCalendarEvent(taggedEvent.id).tags, [])

      const snoozedTodo = manager.createTodo({ title: '推迟提醒', dueAt: dueAt + 60_000 })
      const defaultReminder = manager.getTodo(snoozedTodo.id).reminders.find((item) => item.origin === 'todo_due_at')
      assert.ok(defaultReminder)
      assert.equal(manager.snoozePlanningReminder(defaultReminder.id, 10).origin, 'manual')
      manager.updateTodo({ id: snoozedTodo.id, dueAt: null, expectedUpdatedAt: snoozedTodo.updatedAt })
      assert.ok(manager.getTodo(snoozedTodo.id).reminders.some((item) => item.id === defaultReminder.id))

      const dueTodo = manager.createTodo({ title: '已到期提醒', dueAt: now - 1 })
      assert.ok(manager.claimDuePlanningReminders(now).some((item) => item.targetId === dueTodo.id))
      assert.equal(manager.claimDuePlanningReminders(now).some((item) => item.targetId === dueTodo.id), false)

      const linkedTodo = manager.createTodo({ title: '待级联 Todo' })
      const linkedEvent = manager.createCalendarEvent({ title: '关联 Todo 的日程', startAt: now, todoId: linkedTodo.id })
      assert.equal(manager.deleteTodo(linkedTodo.id), true)
      assert.equal(manager.getCalendarEvent(linkedEvent.id).todoId, undefined)
      assert.equal(manager.deletePlanningGroup('todo', todoGroup.id), true)
      assert.equal(manager.getTodo(stableTodo.id).groupId, undefined)
      assert.equal(manager.getCalendarEvent(event.id).groupId, calendarGroup.id)
      process.exit(0)
    }

    assert.equal(mode, 'reload')
    assert.ok(existsSync(statePath))
    const stableTodo = manager.listTodos().find((item) => item.title === 'Todo 新版本')
    assert.ok(stableTodo)
    assert.equal(stableTodo.groupId, undefined)
    assert.deepEqual(stableTodo.tags.map((tag) => tag.name), ['重要'])
    assert.ok(stableTodo.reminders.some((item) => item.origin === 'todo_due_at'))
    const linkedEvent = manager.listCalendarEvents().find((item) => item.title === '关联 Todo 的日程')
    assert.ok(linkedEvent)
    assert.equal(linkedEvent.todoId, undefined)
    assert.equal(manager.claimDuePlanningReminders(now).some((item) => item.targetTitle === '已到期提醒'), false)
  `

  writeFileSync(sourcePath, source)
  try {
    // 每次运行使用独立 HOME，确保不读取真实用户配置。
    runVerifier(sourcePath, home, 'seed')
    expect(existsSync(statePath)).toBe(true)
    expect(existsSync(join(home, '.linguist-agent-dev', 'planning.db'))).toBe(false)
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
    runVerifier(sourcePath, home, 'reload')

    const invalid = JSON.parse(readFileSync(statePath, 'utf8'))
    invalid.reminders.push({
      id: 'dangling-reminder', targetType: 'todo', targetId: 'missing-todo', triggerAt: Date.now(),
      status: 'pending', origin: 'manual', createdAt: Date.now(), updatedAt: Date.now(),
    })
    writeFileSync(statePath, JSON.stringify(invalid))
    const invalidSource = source.replace(
      "assert.equal(mode, 'reload')",
      "if (mode === 'invalid') { assert.throws(() => manager.listTodos(), /格式无效/); process.exit(0) }\n    assert.equal(mode, 'reload')",
    )
    writeFileSync(sourcePath, invalidSource)
    const invalidBefore = readFileSync(statePath, 'utf8')
    runVerifier(sourcePath, home, 'invalid')
    expect(readFileSync(statePath, 'utf8')).toBe(invalidBefore)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
