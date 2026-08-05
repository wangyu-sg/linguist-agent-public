/**
 * 任务/日程 JSON 数据层。
 *
 * Todo、日程、分组、标签和提醒统一保存到配置目录中的 planning.json。
 * 每次写入均先在内存草稿中完成，再通过同目录临时文件原子替换，避免失败时留下部分状态。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { PLANNING_CONFLICT_ERROR } from '@proma/shared'
import type {
  ActivePlanningReminder,
  CalendarEvent,
  CalendarEventListQuery,
  CreateCalendarEventInput,
  CreatePlanningGroupInput,
  CreatePlanningReminderRequest,
  CreatePlanningTagInput,
  CreateTodoInput,
  PlanningGroup,
  PlanningGroupScope,
  PlanningReminder,
  PlanningReminderOrigin,
  PlanningReminderTargetType,
  PlanningTag,
  Todo,
  TodoListQuery,
  TodoSessionLink,
  UpdateCalendarEventInput,
  UpdatePlanningGroupInput,
  UpdatePlanningTagInput,
  UpdateTodoInput,
} from '@proma/shared'
import { getPlanningPath } from './config-paths'

const PLANNING_STATE_VERSION = 1

interface StoredTodo {
  id: string
  title: string
  notes?: string
  status: Todo['status']
  priority: Todo['priority']
  dueAt?: number
  groupId?: string
  workspaceId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  tagIds: string[]
}

interface StoredCalendarEvent {
  id: string
  title: string
  notes?: string
  startAt: number
  endAt?: number
  allDay: boolean
  groupId?: string
  workspaceId?: string
  todoId?: string
  createdAt: number
  updatedAt: number
  tagIds: string[]
}

interface PlanningState {
  schemaVersion: typeof PLANNING_STATE_VERSION
  groups: PlanningGroup[]
  tags: PlanningTag[]
  todos: StoredTodo[]
  calendarEvents: StoredCalendarEvent[]
  reminders: PlanningReminder[]
  todoSessionLinks: Record<string, TodoSessionLink[]>
}

let planningState: PlanningState | undefined

function createEmptyState(): PlanningState {
  return {
    schemaVersion: PLANNING_STATE_VERSION,
    groups: [],
    tags: [],
    todos: [],
    calendarEvents: [],
    reminders: [],
    todoSessionLinks: {},
  }
}

function getPlanningStatePath(): string {
  return getPlanningPath()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || isTimestamp(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isPlanningGroup(value: unknown): value is PlanningGroup {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && (value.scope === 'todo' || value.scope === 'calendar')
    && typeof value.name === 'string'
    && isOptionalString(value.color)
    && typeof value.sortOrder === 'number'
    && Number.isFinite(value.sortOrder)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
}

function isPlanningTag(value: unknown): value is PlanningTag {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isOptionalString(value.color)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
}

function isStoredTodo(value: unknown): value is StoredTodo {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && isOptionalString(value.notes)
    && (value.status === 'open' || value.status === 'completed')
    && (value.priority === 'low' || value.priority === 'medium' || value.priority === 'high')
    && isOptionalTimestamp(value.dueAt)
    && isOptionalString(value.groupId)
    && isOptionalString(value.workspaceId)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
    && isOptionalTimestamp(value.completedAt)
    && isStringArray(value.tagIds)
}

function isStoredCalendarEvent(value: unknown): value is StoredCalendarEvent {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && isOptionalString(value.notes)
    && isTimestamp(value.startAt)
    && isOptionalTimestamp(value.endAt)
    && typeof value.allDay === 'boolean'
    && isOptionalString(value.groupId)
    && isOptionalString(value.workspaceId)
    && isOptionalString(value.todoId)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
    && isStringArray(value.tagIds)
}

function isPlanningReminder(value: unknown): value is PlanningReminder {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && (value.targetType === 'todo' || value.targetType === 'calendar_event')
    && typeof value.targetId === 'string'
    && isTimestamp(value.triggerAt)
    && isOptionalTimestamp(value.snoozedUntil)
    && (value.status === 'pending' || value.status === 'acknowledged' || value.status === 'completed')
    && (value.origin === 'manual' || value.origin === 'todo_due_at')
    && isOptionalTimestamp(value.acknowledgedAt)
    && isOptionalTimestamp(value.lastNotifiedAt)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
}

function isTodoSessionLink(value: unknown): value is TodoSessionLink {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && isTimestamp(value.firstTouchedAt)
    && isTimestamp(value.lastTouchedAt)
}

function invalidPlanningState(): never {
  throw new Error('规划数据文件格式无效，已停止写入以保护现有数据')
}

function assertPlanningRelations(state: PlanningState): void {
  const unique = (ids: string[]): boolean => new Set(ids).size === ids.length
  if (!unique(state.groups.map((item) => item.id))
    || !unique(state.groups.map((item) => `${item.scope}:${item.name.toLocaleLowerCase()}`))
    || !unique(state.tags.map((item) => item.id))
    || !unique(state.tags.map((item) => item.name.toLocaleLowerCase()))
    || !unique(state.todos.map((item) => item.id))
    || !unique(state.calendarEvents.map((item) => item.id))
    || !unique(state.reminders.map((item) => item.id))) invalidPlanningState()

  const groupIds = new Set(state.groups.map((item) => `${item.scope}:${item.id}`))
  const tagIds = new Set(state.tags.map((item) => item.id))
  const todoIds = new Set(state.todos.map((item) => item.id))
  const eventIds = new Set(state.calendarEvents.map((item) => item.id))
  for (const todo of state.todos) {
    if ((todo.groupId && !groupIds.has(`todo:${todo.groupId}`))
      || !unique(todo.tagIds)
      || todo.tagIds.some((id) => !tagIds.has(id))) invalidPlanningState()
  }
  for (const event of state.calendarEvents) {
    if ((event.groupId && !groupIds.has(`calendar:${event.groupId}`))
      || (event.todoId && !todoIds.has(event.todoId))
      || !unique(event.tagIds)
      || event.tagIds.some((id) => !tagIds.has(id))
      || (event.endAt !== undefined && event.endAt < event.startAt)) invalidPlanningState()
  }
  for (const reminder of state.reminders) {
    if (reminder.targetType === 'todo' ? !todoIds.has(reminder.targetId) : !eventIds.has(reminder.targetId)) invalidPlanningState()
  }
  for (const [todoId, links] of Object.entries(state.todoSessionLinks)) {
    if (!todoIds.has(todoId) || !unique(links.map((item) => item.sessionId))) invalidPlanningState()
  }
}

function parsePlanningState(value: unknown): PlanningState {
  if (!isRecord(value) || value.schemaVersion !== PLANNING_STATE_VERSION) return invalidPlanningState()
  if (!Array.isArray(value.groups) || !value.groups.every(isPlanningGroup)) return invalidPlanningState()
  if (!Array.isArray(value.tags) || !value.tags.every(isPlanningTag)) return invalidPlanningState()
  if (!Array.isArray(value.todos) || !value.todos.every(isStoredTodo)) return invalidPlanningState()
  if (!Array.isArray(value.calendarEvents) || !value.calendarEvents.every(isStoredCalendarEvent)) return invalidPlanningState()
  if (!Array.isArray(value.reminders) || !value.reminders.every(isPlanningReminder)) return invalidPlanningState()
  if (!isRecord(value.todoSessionLinks)) return invalidPlanningState()
  if (!Object.values(value.todoSessionLinks).every((links) => Array.isArray(links) && links.every(isTodoSessionLink))) {
    return invalidPlanningState()
  }
  const state = value as unknown as PlanningState
  assertPlanningRelations(state)
  return state
}

function readPlanningState(): PlanningState {
  const path = getPlanningStatePath()
  if (!existsSync(path)) return createEmptyState()

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error('读取规划数据失败，已停止写入以保护现有数据')
  }

  try {
    return parsePlanningState(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error instanceof Error && error.message.includes('规划数据文件格式无效')) throw error
    throw new Error('规划数据文件损坏，已停止写入以保护现有数据')
  }
}

function writePlanningState(state: PlanningState): void {
  const path = getPlanningStatePath()
  const temporaryPath = [path, process.pid, randomUUID(), 'tmp'].join('.')
  try {
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // 清理失败不能覆盖原始写入错误。
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error('写入规划数据失败：' + message)
  }
}

function getPlanningState(): PlanningState {
  planningState ??= readPlanningState()
  return planningState
}

function withPlanningTransaction<T>(work: (draft: PlanningState) => T): T {
  const draft = structuredClone(getPlanningState()) as PlanningState
  const result = work(draft)
  writePlanningState(draft)
  planningState = draft
  return result
}

function assertText(value: string, field: string, max: number): string {
  const text = value.trim()
  if (!text || text.length > max) throw new Error(field + '不能为空且不能超过 ' + max + ' 字')
  return text
}

function assertTitle(value: string, type: string): string {
  return assertText(value, type + ' 标题', 500)
}

function assertTimestamp(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(field + ' 必须是有效时间戳')
  }
}

function assertRequiredTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(field + ' 必须是有效时间戳')
}

function assertScope(scope: PlanningGroupScope): void {
  if (scope !== 'todo' && scope !== 'calendar') throw new Error('分组 scope 无效')
}

function assertPriority(priority: Todo['priority']): void {
  if (priority !== 'low' && priority !== 'medium' && priority !== 'high') throw new Error('Todo priority 无效')
}

function assertTodoStatus(status: Todo['status']): void {
  if (status !== 'open' && status !== 'completed') throw new Error('Todo status 无效')
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit 必须是正整数')
  return Math.min(limit, 500)
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' })
}

function sameName(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

function copyGroup(group: PlanningGroup): PlanningGroup {
  return { ...group }
}

function copyTag(tag: PlanningTag): PlanningTag {
  return { ...tag }
}

function copyReminder(reminder: PlanningReminder): PlanningReminder {
  return { ...reminder }
}

function copyTodoSessionLink(link: TodoSessionLink): TodoSessionLink {
  return { ...link }
}

function findGroup(state: PlanningState, id: string, scope: PlanningGroupScope): PlanningGroup | undefined {
  return state.groups.find((group) => group.id === id && group.scope === scope)
}

function findTodo(state: PlanningState, id: string): StoredTodo | undefined {
  return state.todos.find((todo) => todo.id === id)
}

function findCalendarEvent(state: PlanningState, id: string): StoredCalendarEvent | undefined {
  return state.calendarEvents.find((event) => event.id === id)
}

function findReminder(state: PlanningState, id: string): PlanningReminder | undefined {
  return state.reminders.find((reminder) => reminder.id === id)
}

function targetExists(state: PlanningState, targetType: PlanningReminderTargetType, targetId: string): boolean {
  return targetType === 'todo' ? Boolean(findTodo(state, targetId)) : Boolean(findCalendarEvent(state, targetId))
}

function assertTagIdsExist(state: PlanningState, tagIds: string[]): string[] {
  const unique = [...new Set(tagIds)]
  for (const tagId of unique) {
    if (!state.tags.some((tag) => tag.id === tagId)) throw new Error('标签不存在')
  }
  return unique
}

function assertReminderInputs(inputs: { triggerAt: number }[]): void {
  for (const input of inputs) assertRequiredTimestamp(input.triggerAt, 'triggerAt')
}

function effectiveReminderTime(reminder: PlanningReminder): number {
  return reminder.snoozedUntil ?? reminder.triggerAt
}

function remindersForTarget(state: PlanningState, targetType: PlanningReminderTargetType, targetId: string): PlanningReminder[] {
  return state.reminders
    .filter((reminder) => reminder.targetType === targetType && reminder.targetId === targetId)
    .sort((left, right) => effectiveReminderTime(left) - effectiveReminderTime(right))
}

function tagsForTarget(state: PlanningState, targetType: PlanningReminderTargetType, targetId: string): PlanningTag[] {
  const target = targetType === 'todo' ? findTodo(state, targetId) : findCalendarEvent(state, targetId)
  if (!target) return []
  const tagsById = new Map(state.tags.map((tag) => [tag.id, tag]))
  return target.tagIds
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is PlanningTag => tag !== undefined)
    .sort(compareNames)
    .map(copyTag)
}

function todoSessionLinksForTodo(state: PlanningState, todoId: string): TodoSessionLink[] {
  return [...(state.todoSessionLinks[todoId] ?? [])]
    .sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
    .map(copyTodoSessionLink)
}

function hydrateTodo(state: PlanningState, todo: StoredTodo): Todo {
  const group = todo.groupId ? findGroup(state, todo.groupId, 'todo') : undefined
  return {
    id: todo.id,
    title: todo.title,
    notes: todo.notes,
    status: todo.status,
    priority: todo.priority,
    dueAt: todo.dueAt,
    groupId: todo.groupId,
    group: group ? copyGroup(group) : undefined,
    tags: tagsForTarget(state, 'todo', todo.id),
    reminders: remindersForTarget(state, 'todo', todo.id).map(copyReminder),
    sessionLinks: todoSessionLinksForTodo(state, todo.id),
    workspaceId: todo.workspaceId,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    completedAt: todo.completedAt,
  }
}

function hydrateCalendarEvent(state: PlanningState, event: StoredCalendarEvent): CalendarEvent {
  const group = event.groupId ? findGroup(state, event.groupId, 'calendar') : undefined
  return {
    id: event.id,
    title: event.title,
    notes: event.notes,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    groupId: event.groupId,
    group: group ? copyGroup(group) : undefined,
    tags: tagsForTarget(state, 'calendar_event', event.id),
    reminders: remindersForTarget(state, 'calendar_event', event.id).map(copyReminder),
    workspaceId: event.workspaceId,
    todoId: event.todoId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }
}

function addPlanningReminder(
  state: PlanningState,
  input: CreatePlanningReminderRequest,
  origin: PlanningReminderOrigin,
  now: number,
): PlanningReminder {
  const reminder: PlanningReminder = {
    id: randomUUID(),
    targetType: input.targetType,
    targetId: input.targetId,
    triggerAt: input.triggerAt,
    status: 'pending',
    origin,
    createdAt: now,
    updatedAt: now,
  }
  state.reminders.push(reminder)
  return reminder
}

/** 仅同步未推迟的自动 Todo 提醒；手动提醒与用户主动推迟的提醒绝不覆盖。 */
function syncTodoDueAtReminder(state: PlanningState, todoId: string, dueAt: number | undefined, now: number): void {
  const reminders = remindersForTarget(state, 'todo', todoId)
  const defaults = reminders.filter((reminder) => reminder.origin === 'todo_due_at')
  if (dueAt === undefined) {
    state.reminders = state.reminders.filter((reminder) => !(
      reminder.targetType === 'todo'
      && reminder.targetId === todoId
      && reminder.origin === 'todo_due_at'
      && reminder.status === 'pending'
      && reminder.snoozedUntil === undefined
    ))
    return
  }

  const movable = defaults.find((reminder) => reminder.status === 'pending' && reminder.snoozedUntil === undefined)
  if (movable) {
    movable.triggerAt = dueAt
    movable.lastNotifiedAt = undefined
    movable.updatedAt = now
    return
  }

  // 已推迟的默认提醒保持原样；存在任意手动待处理提醒时也不额外创建默认提醒。
  if (defaults.some((reminder) => reminder.status === 'pending') || reminders.some((reminder) => reminder.status === 'pending')) return
  addPlanningReminder(state, { targetType: 'todo', targetId: todoId, triggerAt: dueAt }, 'todo_due_at', now)
}

function setTodoRemindersCompleted(state: PlanningState, todoId: string, now: number): void {
  for (const reminder of state.reminders) {
    if (reminder.targetType === 'todo' && reminder.targetId === todoId && reminder.status === 'pending') {
      reminder.status = 'completed'
      reminder.updatedAt = now
    }
  }
}

function addTodoSessionLink(state: PlanningState, todoId: string, sessionId: string, now: number): void {
  const links = state.todoSessionLinks[todoId] ?? (state.todoSessionLinks[todoId] = [])
  const existing = links.find((link) => link.sessionId === sessionId)
  if (existing) {
    existing.lastTouchedAt = now
    return
  }
  links.push({ sessionId, firstTouchedAt: now, lastTouchedAt: now })
}

export function listPlanningGroups(scope: PlanningGroupScope): PlanningGroup[] {
  assertScope(scope)
  return getPlanningState().groups
    .filter((group) => group.scope === scope)
    .sort((left, right) => left.sortOrder - right.sortOrder || compareNames(left, right))
    .map(copyGroup)
}

export function createPlanningGroup(input: CreatePlanningGroupInput): PlanningGroup {
  assertScope(input.scope)
  const name = assertText(input.name, '分组名称', 100)
  if (input.sortOrder !== undefined && !Number.isFinite(input.sortOrder)) throw new Error('sortOrder 必须是有效数字')
  const now = Date.now()
  const group: PlanningGroup = {
    id: randomUUID(),
    scope: input.scope,
    name,
    color: input.color?.trim() || undefined,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  withPlanningTransaction((state) => {
    if (state.groups.some((candidate) => candidate.scope === group.scope && sameName(candidate.name, group.name))) {
      throw new Error('同一类型的分组名称已存在')
    }
    state.groups.push(group)
  })
  return copyGroup(findGroup(getPlanningState(), group.id, group.scope)!)
}

export function updatePlanningGroup(input: UpdatePlanningGroupInput): PlanningGroup | undefined {
  assertScope(input.scope)
  if (input.sortOrder !== undefined && !Number.isFinite(input.sortOrder)) throw new Error('sortOrder 必须是有效数字')
  const state = getPlanningState()
  const old = findGroup(state, input.id, input.scope)
  if (!old) return undefined
  const name = input.name === undefined ? old.name : assertText(input.name, '分组名称', 100)
  const color = input.color === undefined ? old.color : input.color?.trim() || undefined
  const sortOrder = input.sortOrder ?? old.sortOrder
  const updatedAt = Math.max(Date.now(), old.updatedAt + 1)

  withPlanningTransaction((draft) => {
    if (draft.groups.some((candidate) => candidate.id !== input.id && candidate.scope === input.scope && sameName(candidate.name, name))) {
      throw new Error('同一类型的分组名称已存在')
    }
    const target = findGroup(draft, input.id, input.scope)
    if (!target) return
    target.name = name
    target.color = color
    target.sortOrder = sortOrder
    target.updatedAt = updatedAt
  })
  return copyGroup(findGroup(getPlanningState(), input.id, input.scope)!)
}

export function deletePlanningGroup(scope: PlanningGroupScope, id: string): boolean {
  assertScope(scope)
  if (!findGroup(getPlanningState(), id, scope)) return false
  withPlanningTransaction((state) => {
    state.groups = state.groups.filter((group) => !(group.id === id && group.scope === scope))
    if (scope === 'todo') {
      for (const todo of state.todos) {
        if (todo.groupId === id) todo.groupId = undefined
      }
      return
    }
    for (const event of state.calendarEvents) {
      if (event.groupId === id) event.groupId = undefined
    }
  })
  return true
}

export function listPlanningTags(): PlanningTag[] {
  return [...getPlanningState().tags].sort(compareNames).map(copyTag)
}

export function createPlanningTag(input: CreatePlanningTagInput): PlanningTag {
  const now = Date.now()
  const tag: PlanningTag = {
    id: randomUUID(),
    name: assertText(input.name, '标签名称', 100),
    color: input.color?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  withPlanningTransaction((state) => {
    if (state.tags.some((candidate) => sameName(candidate.name, tag.name))) throw new Error('标签名称已存在')
    state.tags.push(tag)
  })
  return copyTag(getPlanningState().tags.find((candidate) => candidate.id === tag.id)!)
}

export function updatePlanningTag(input: UpdatePlanningTagInput): PlanningTag | undefined {
  const state = getPlanningState()
  const old = state.tags.find((tag) => tag.id === input.id)
  if (!old) return undefined
  const name = input.name === undefined ? old.name : assertText(input.name, '标签名称', 100)
  const color = input.color === undefined ? old.color : input.color?.trim() || undefined
  const updatedAt = Math.max(Date.now(), old.updatedAt + 1)
  withPlanningTransaction((draft) => {
    if (draft.tags.some((candidate) => candidate.id !== input.id && sameName(candidate.name, name))) {
      throw new Error('标签名称已存在')
    }
    const target = draft.tags.find((tag) => tag.id === input.id)
    if (!target) return
    target.name = name
    target.color = color
    target.updatedAt = updatedAt
  })
  return copyTag(getPlanningState().tags.find((tag) => tag.id === input.id)!)
}

export function deletePlanningTag(id: string): boolean {
  if (!getPlanningState().tags.some((tag) => tag.id === id)) return false
  withPlanningTransaction((state) => {
    state.tags = state.tags.filter((tag) => tag.id !== id)
    for (const todo of state.todos) todo.tagIds = todo.tagIds.filter((tagId) => tagId !== id)
    for (const event of state.calendarEvents) event.tagIds = event.tagIds.filter((tagId) => tagId !== id)
  })
  return true
}

export function listTodos(query: TodoListQuery = {}): Todo[] {
  const limit = normalizeLimit(query.limit)
  const state = getPlanningState()
  const rows = state.todos
    .filter((todo) => query.status === undefined || todo.status === query.status)
    .filter((todo) => query.dueBefore === undefined || (todo.dueAt !== undefined && todo.dueAt <= query.dueBefore))
    .sort((left, right) => {
      const statusOrder = (left.status === 'open' ? 0 : 1) - (right.status === 'open' ? 0 : 1)
      if (statusOrder !== 0) return statusOrder
      if (left.dueAt === undefined && right.dueAt !== undefined) return 1
      if (left.dueAt !== undefined && right.dueAt === undefined) return -1
      if (left.dueAt !== undefined && right.dueAt !== undefined && left.dueAt !== right.dueAt) return left.dueAt - right.dueAt
      return right.updatedAt - left.updatedAt
    })
  return (limit ? rows.slice(0, limit) : rows).map((todo) => hydrateTodo(state, todo))
}

export function getTodo(id: string): Todo | undefined {
  const state = getPlanningState()
  const todo = findTodo(state, id)
  return todo ? hydrateTodo(state, todo) : undefined
}

/** 将 Agent Session 与 Todo 去重关联；仅成功持久化的 Agent 写操作调用。 */
export function touchTodoSession(todoId: string, sessionId: string): void {
  if (!sessionId || !findTodo(getPlanningState(), todoId)) return
  const now = Date.now()
  withPlanningTransaction((state) => {
    if (findTodo(state, todoId)) addTodoSessionLink(state, todoId, sessionId, now)
  })
}

export function createTodo(input: CreateTodoInput): Todo {
  assertTimestamp(input.dueAt, 'dueAt')
  if (input.reminders !== undefined) assertReminderInputs(input.reminders)
  const state = getPlanningState()
  const tagIds = input.tagIds === undefined ? undefined : assertTagIdsExist(state, input.tagIds)
  const priority = input.priority ?? 'medium'
  assertPriority(priority)
  const now = Date.now()
  const todo: StoredTodo = {
    id: randomUUID(),
    title: assertTitle(input.title, 'Todo'),
    notes: input.notes?.trim() || undefined,
    status: 'open',
    priority,
    dueAt: input.dueAt,
    groupId: input.groupId,
    workspaceId: input.workspaceId || undefined,
    createdAt: now,
    updatedAt: now,
    tagIds: tagIds ?? [],
  }
  if (todo.groupId && !findGroup(state, todo.groupId, 'todo')) throw new Error('Todo 分组不存在')

  withPlanningTransaction((draft) => {
    draft.todos.push(todo)
    if (input.reminders !== undefined) {
      for (const reminder of input.reminders) {
        addPlanningReminder(draft, { targetType: 'todo', targetId: todo.id, triggerAt: reminder.triggerAt }, 'manual', now)
      }
    } else if (todo.dueAt !== undefined) {
      addPlanningReminder(draft, { targetType: 'todo', targetId: todo.id, triggerAt: todo.dueAt }, 'todo_due_at', now)
    }
    if (input.sessionId) addTodoSessionLink(draft, todo.id, input.sessionId, now)
  })
  return getTodo(todo.id)!
}

export function updateTodo(input: UpdateTodoInput): Todo | undefined {
  if (input.expectedUpdatedAt !== undefined) assertRequiredTimestamp(input.expectedUpdatedAt, 'expectedUpdatedAt')
  if (input.dueAt !== undefined && input.dueAt !== null) assertRequiredTimestamp(input.dueAt, 'dueAt')
  const state = getPlanningState()
  const old = findTodo(state, input.id)
  if (!old) return undefined
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== old.updatedAt) throw new Error(PLANNING_CONFLICT_ERROR)
  const tagIds = input.tagIds === undefined ? undefined : assertTagIdsExist(state, input.tagIds)
  const status = input.status ?? old.status
  assertTodoStatus(status)
  const priority = input.priority ?? old.priority
  assertPriority(priority)
  const groupId = input.groupId === undefined ? old.groupId : input.groupId ?? undefined
  if (groupId && !findGroup(state, groupId, 'todo')) throw new Error('Todo 分组不存在')
  const dueAt = input.dueAt === undefined ? old.dueAt : input.dueAt ?? undefined
  const updatedAt = Math.max(Date.now(), old.updatedAt + 1)
  const completedAt = status === 'completed' ? (old.completedAt ?? Date.now()) : undefined
  const title = input.title === undefined ? old.title : assertTitle(input.title, 'Todo')
  const notes = input.notes === undefined ? old.notes : input.notes.trim() || undefined
  const workspaceId = input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined

  withPlanningTransaction((draft) => {
    const target = findTodo(draft, input.id)
    if (!target || (input.expectedUpdatedAt !== undefined && target.updatedAt !== input.expectedUpdatedAt)) {
      throw new Error(PLANNING_CONFLICT_ERROR)
    }
    target.title = title
    target.notes = notes
    target.status = status
    target.priority = priority
    target.dueAt = dueAt
    target.groupId = groupId
    target.workspaceId = workspaceId
    target.updatedAt = updatedAt
    target.completedAt = completedAt
    if (tagIds !== undefined) target.tagIds = tagIds
    if (input.dueAt !== undefined && old.dueAt !== dueAt) syncTodoDueAtReminder(draft, input.id, dueAt, updatedAt)
    if (status === 'completed' && old.status !== 'completed') setTodoRemindersCompleted(draft, input.id, updatedAt)
  })
  return getTodo(input.id)
}

export function deleteTodo(id: string): boolean {
  if (!findTodo(getPlanningState(), id)) return false
  withPlanningTransaction((state) => {
    state.todos = state.todos.filter((todo) => todo.id !== id)
    state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === 'todo' && reminder.targetId === id))
    delete state.todoSessionLinks[id]
    for (const event of state.calendarEvents) {
      if (event.todoId === id) event.todoId = undefined
    }
  })
  return true
}

export function listCalendarEvents(query: CalendarEventListQuery = {}): CalendarEvent[] {
  const limit = normalizeLimit(query.limit)
  const state = getPlanningState()
  const rows = state.calendarEvents
    .filter((event) => query.from === undefined || (event.endAt ?? event.startAt) >= query.from)
    .filter((event) => query.to === undefined || event.startAt <= query.to)
    .sort((left, right) => left.startAt - right.startAt)
  return (limit ? rows.slice(0, limit) : rows).map((event) => hydrateCalendarEvent(state, event))
}

export function getCalendarEvent(id: string): CalendarEvent | undefined {
  const state = getPlanningState()
  const event = findCalendarEvent(state, id)
  return event ? hydrateCalendarEvent(state, event) : undefined
}

export function createCalendarEvent(input: CreateCalendarEventInput): CalendarEvent {
  assertRequiredTimestamp(input.startAt, 'startAt')
  if (input.endAt !== undefined) assertRequiredTimestamp(input.endAt, 'endAt')
  if (input.endAt !== undefined && input.endAt < input.startAt) throw new Error('日程 endAt 不能早于 startAt')
  if (input.reminders !== undefined) assertReminderInputs(input.reminders)
  const state = getPlanningState()
  const tagIds = input.tagIds === undefined ? undefined : assertTagIdsExist(state, input.tagIds)
  const now = Date.now()
  const event: StoredCalendarEvent = {
    id: randomUUID(),
    title: assertTitle(input.title, '日程'),
    notes: input.notes?.trim() || undefined,
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay ?? false,
    groupId: input.groupId,
    workspaceId: input.workspaceId || undefined,
    todoId: input.todoId || undefined,
    createdAt: now,
    updatedAt: now,
    tagIds: tagIds ?? [],
  }
  if (event.groupId && !findGroup(state, event.groupId, 'calendar')) throw new Error('日程分组不存在')
  if (event.todoId && !findTodo(state, event.todoId)) throw new Error('关联 Todo 不存在')

  withPlanningTransaction((draft) => {
    draft.calendarEvents.push(event)
    if (input.reminders !== undefined) {
      for (const reminder of input.reminders) {
        addPlanningReminder(draft, { targetType: 'calendar_event', targetId: event.id, triggerAt: reminder.triggerAt }, 'manual', now)
      }
    }
  })
  return getCalendarEvent(event.id)!
}

export function updateCalendarEvent(input: UpdateCalendarEventInput): CalendarEvent | undefined {
  if (input.expectedUpdatedAt !== undefined) assertRequiredTimestamp(input.expectedUpdatedAt, 'expectedUpdatedAt')
  if (input.startAt !== undefined) assertRequiredTimestamp(input.startAt, 'startAt')
  if (input.endAt !== undefined && input.endAt !== null) assertRequiredTimestamp(input.endAt, 'endAt')
  const state = getPlanningState()
  const old = findCalendarEvent(state, input.id)
  if (!old) return undefined
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== old.updatedAt) throw new Error(PLANNING_CONFLICT_ERROR)
  const tagIds = input.tagIds === undefined ? undefined : assertTagIdsExist(state, input.tagIds)
  const startAt = input.startAt ?? old.startAt
  const endAt = input.endAt === undefined ? old.endAt : input.endAt ?? undefined
  if (endAt !== undefined && endAt < startAt) throw new Error('日程 endAt 不能早于 startAt')
  const groupId = input.groupId === undefined ? old.groupId : input.groupId ?? undefined
  if (groupId && !findGroup(state, groupId, 'calendar')) throw new Error('日程分组不存在')
  const todoId = input.todoId === undefined ? old.todoId : input.todoId ?? undefined
  if (todoId && !findTodo(state, todoId)) throw new Error('关联 Todo 不存在')
  const title = input.title === undefined ? old.title : assertTitle(input.title, '日程')
  const notes = input.notes === undefined ? old.notes : input.notes.trim() || undefined
  const workspaceId = input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined
  const allDay = input.allDay ?? old.allDay
  const updatedAt = Math.max(Date.now(), old.updatedAt + 1)

  withPlanningTransaction((draft) => {
    const target = findCalendarEvent(draft, input.id)
    if (!target || (input.expectedUpdatedAt !== undefined && target.updatedAt !== input.expectedUpdatedAt)) {
      throw new Error(PLANNING_CONFLICT_ERROR)
    }
    target.title = title
    target.notes = notes
    target.startAt = startAt
    target.endAt = endAt
    target.allDay = allDay
    target.groupId = groupId
    target.workspaceId = workspaceId
    target.todoId = todoId
    target.updatedAt = updatedAt
    if (tagIds !== undefined) target.tagIds = tagIds
  })
  return getCalendarEvent(input.id)
}

export function deleteCalendarEvent(id: string): boolean {
  if (!findCalendarEvent(getPlanningState(), id)) return false
  withPlanningTransaction((state) => {
    state.calendarEvents = state.calendarEvents.filter((event) => event.id !== id)
    state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === 'calendar_event' && reminder.targetId === id))
  })
  return true
}

function createPlanningReminderWithOrigin(input: CreatePlanningReminderRequest, origin: PlanningReminderOrigin): PlanningReminder {
  assertRequiredTimestamp(input.triggerAt, 'triggerAt')
  const state = getPlanningState()
  if (!targetExists(state, input.targetType, input.targetId)) throw new Error('提醒目标不存在')
  const now = Date.now()
  let id = ''
  withPlanningTransaction((draft) => {
    const reminder = addPlanningReminder(draft, input, origin, now)
    id = reminder.id
  })
  return copyReminder(findReminder(getPlanningState(), id)!)
}

/** 外部工具和 UI 创建的提醒均为手动提醒，不会在 Todo/日程改期时被覆盖。 */
export function createPlanningReminder(input: CreatePlanningReminderRequest): PlanningReminder {
  return createPlanningReminderWithOrigin(input, 'manual')
}

export function deletePlanningReminder(id: string): boolean {
  if (!findReminder(getPlanningState(), id)) return false
  withPlanningTransaction((state) => {
    state.reminders = state.reminders.filter((reminder) => reminder.id !== id)
  })
  return true
}

export function updatePlanningReminder(id: string, triggerAt: number): PlanningReminder | undefined {
  assertRequiredTimestamp(triggerAt, 'triggerAt')
  const old = findReminder(getPlanningState(), id)
  if (!old || old.status !== 'pending') return undefined
  const now = Date.now()
  withPlanningTransaction((state) => {
    const target = findReminder(state, id)
    if (!target || target.status !== 'pending') return
    target.triggerAt = triggerAt
    target.snoozedUntil = undefined
    target.lastNotifiedAt = undefined
    target.origin = 'manual'
    target.updatedAt = now
  })
  return copyReminder(findReminder(getPlanningState(), id)!)
}

export function acknowledgePlanningReminder(id: string): PlanningReminder | undefined {
  const old = findReminder(getPlanningState(), id)
  if (!old || old.status !== 'pending') return undefined
  const now = Date.now()
  withPlanningTransaction((state) => {
    const target = findReminder(state, id)
    if (!target || target.status !== 'pending') return
    target.status = 'acknowledged'
    target.acknowledgedAt = now
    target.updatedAt = now
  })
  return copyReminder(findReminder(getPlanningState(), id)!)
}

export function snoozePlanningReminder(id: string, minutes: number): PlanningReminder | undefined {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('推迟分钟数必须在 1 到 10080 之间')
  const old = findReminder(getPlanningState(), id)
  if (!old || old.status !== 'pending') return undefined
  const now = Date.now()
  withPlanningTransaction((state) => {
    const target = findReminder(state, id)
    if (!target || target.status !== 'pending') return
    target.snoozedUntil = now + minutes * 60_000
    target.lastNotifiedAt = undefined
    target.origin = 'manual'
    target.updatedAt = now
  })
  return copyReminder(findReminder(getPlanningState(), id)!)
}

function activeReminderFromState(state: PlanningState, reminder: PlanningReminder): ActivePlanningReminder | undefined {
  if (reminder.targetType === 'todo') {
    const target = findTodo(state, reminder.targetId)
    if (!target) return undefined
    const hydrated = hydrateTodo(state, target)
    return {
      ...copyReminder(reminder),
      targetTitle: hydrated.title,
      group: hydrated.group,
      tags: hydrated.tags,
    }
  }
  const target = findCalendarEvent(state, reminder.targetId)
  if (!target) return undefined
  const hydrated = hydrateCalendarEvent(state, target)
  return {
    ...copyReminder(reminder),
    targetTitle: hydrated.title,
    group: hydrated.group,
    tags: hydrated.tags,
  }
}

export function listActivePlanningReminders(): ActivePlanningReminder[] {
  const now = Date.now()
  const state = getPlanningState()
  return state.reminders
    .filter((reminder) => reminder.status === 'pending' && effectiveReminderTime(reminder) <= now)
    .sort((left, right) => effectiveReminderTime(left) - effectiveReminderTime(right))
    .flatMap((reminder) => {
      const active = activeReminderFromState(state, reminder)
      return active ? [active] : []
    })
}

/** 返回新增到期提醒并标记已通知，避免每个 30 秒轮询周期重复播放声音。 */
export function claimDuePlanningReminders(now = Date.now()): ActivePlanningReminder[] {
  const due = getPlanningState().reminders.filter((reminder) => (
    reminder.status === 'pending'
    && effectiveReminderTime(reminder) <= now
    && reminder.lastNotifiedAt === undefined
  ))
  if (due.length === 0) return []

  return withPlanningTransaction((state) => {
    const result: ActivePlanningReminder[] = []
    for (const reminder of state.reminders
      .filter((candidate) => candidate.status === 'pending'
        && effectiveReminderTime(candidate) <= now
        && candidate.lastNotifiedAt === undefined)
      .sort((left, right) => effectiveReminderTime(left) - effectiveReminderTime(right))) {
      reminder.lastNotifiedAt = now
      reminder.updatedAt = now
      const active = activeReminderFromState(state, reminder)
      if (active) result.push(active)
    }
    return result
  })
}
