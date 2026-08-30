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
  ConnectPlanningNativeConnectionInput,
  PlanningGroup,
  PlanningGroupScope,
  PlanningNativeConnection,
  PlanningNativeSyncConflict,
  PlanningNativeSyncEntity,
  PlanningReminder,
  PlanningReminderOrigin,
  PlanningReminderTargetType,
  PlanningSyncProfile,
  PlanningTag,
  ResolvePlanningNativeSyncConflictInput,
  SavePlanningSyncProfileInput,
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
  nativeConnectionId?: string
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
  nativeConnectionId?: string
  tagIds: string[]
}

interface PlanningSyncBinding {
  profileId: string
  targetId: string
  promaEntityId: string
  calendarItemIdentifier?: string
  calendarItemExternalIdentifier?: string
  lastSyncedHash?: string
  lastSyncedAt?: number
}

interface PlanningSyncOutboxRecord {
  id: string
  profileId: string
  targetId: string
  operation: 'upsert' | 'delete'
  promaEntityId: string
  nativeStartAt?: number
  attempts: number
  nextAttemptAt: number
  lastError?: string
  revision: number
  createdAt: number
  updatedAt: number
}

interface PlanningNativeBinding {
  connectionId: string
  promaEntityId: string
  calendarItemIdentifier: string
  dueDateOnly?: boolean
  recreatePending?: boolean
  lastNativeHash?: string
  lastSyncedAt?: number
}

interface PlanningNativeOutboxRecord {
  id: string
  connectionId: string
  operation: 'upsert' | 'hide'
  promaEntityId: string
  attempts: number
  nextAttemptAt: number
  lastError?: string
  revision: number
  createdAt: number
  updatedAt: number
}

interface PlanningSyncCleanupRecord extends PlanningSyncCleanupItem {
  nextAttemptAt: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

interface PlanningStoredConflict {
  id: string
  owner: 'connection' | 'profile'
  ownerId: string
  entity: PlanningNativeSyncEntity
  promaEntityId: string
  kind: 'changed' | 'deleted'
  nativeItem?: PlanningNativeExternalItem
  detectedAt: number
}

interface PlanningNativeSyncState {
  profiles: PlanningSyncProfile[]
  profileBindings: PlanningSyncBinding[]
  profileOutbox: PlanningSyncOutboxRecord[]
  cleanup: PlanningSyncCleanupRecord[]
  connections: PlanningNativeConnection[]
  connectionBindings: PlanningNativeBinding[]
  connectionOutbox: PlanningNativeOutboxRecord[]
  conflicts: PlanningStoredConflict[]
}

export interface PlanningSyncOutboxItem {
  id: string
  profile: PlanningSyncProfile
  operation: 'upsert' | 'delete'
  promaEntityId: string
  attempts: number
  revision: number
  calendarItemIdentifier?: string
  nativeStartAt?: number
}

export interface PlanningNativeExternalItem {
  calendarItemIdentifier: string
  calendarItemExternalIdentifier?: string
  promaIdentity?: string
  title: string
  notes?: string
  startAt?: number
  endAt?: number
  allDay?: boolean
  dueAt?: number
  priority?: Todo['priority']
  completed?: boolean
  completedAt?: number
  dueDateOnly?: boolean
  isRecurring?: boolean
  lastModifiedAt: number
}

export interface PlanningNativeOutboxItem {
  id: string
  connection: PlanningNativeConnection
  operation: 'upsert' | 'hide'
  promaEntityId: string
  calendarItemIdentifier: string
  dueDateOnly?: boolean
  recreatePending?: boolean
  attempts: number
  revision: number
}

export interface PlanningSyncCleanupItem {
  id: string
  entity: PlanningNativeSyncEntity
  targetId: string
  promaEntityId: string
  calendarItemIdentifier?: string
  nativeStartAt?: number
  attempts: number
}

interface PlanningState {
  schemaVersion: typeof PLANNING_STATE_VERSION
  groups: PlanningGroup[]
  tags: PlanningTag[]
  todos: StoredTodo[]
  calendarEvents: StoredCalendarEvent[]
  reminders: PlanningReminder[]
  todoSessionLinks: Record<string, TodoSessionLink[]>
  nativeSync?: PlanningNativeSyncState
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
    nativeSync: createEmptyNativeSyncState(),
  }
}

function createEmptyNativeSyncState(): PlanningNativeSyncState {
  return {
    profiles: [],
    profileBindings: [],
    profileOutbox: [],
    cleanup: [],
    connections: [],
    connectionBindings: [],
    connectionOutbox: [],
    conflicts: [],
  }
}

function nativeSync(state: PlanningState): PlanningNativeSyncState {
  return state.nativeSync ??= createEmptyNativeSyncState()
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

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isNativeEntity(value: unknown): value is PlanningNativeSyncEntity {
  return value === 'calendar' || value === 'reminder'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isPlanningNativeSyncState(value: unknown): value is PlanningNativeSyncState {
  if (!isRecord(value)) return false
  const arrays = [
    value.profiles,
    value.profileBindings,
    value.profileOutbox,
    value.cleanup,
    value.connections,
    value.connectionBindings,
    value.connectionOutbox,
    value.conflicts,
  ]
  if (arrays.some((items) => !Array.isArray(items))) return false
  return (value.profiles as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && isNativeEntity(item.entity) && isString(item.targetId)
      && isString(item.targetTitle) && isString(item.sourceTitle) && typeof item.enabled === 'boolean'
      && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))
    && (value.profileBindings as unknown[]).every((item) => isRecord(item)
      && isString(item.profileId) && isString(item.targetId) && isString(item.promaEntityId)
      && isOptionalString(item.calendarItemIdentifier) && isOptionalString(item.calendarItemExternalIdentifier)
      && isOptionalString(item.lastSyncedHash) && isOptionalTimestamp(item.lastSyncedAt))
    && (value.profileOutbox as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && isString(item.profileId) && isString(item.targetId)
      && (item.operation === 'upsert' || item.operation === 'delete') && isString(item.promaEntityId)
      && isOptionalTimestamp(item.nativeStartAt) && isNonNegativeInteger(item.attempts)
      && isTimestamp(item.nextAttemptAt) && isOptionalString(item.lastError)
      && Number.isInteger(item.revision) && Number(item.revision) >= 1
      && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))
    && (value.cleanup as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && isNativeEntity(item.entity) && isString(item.targetId)
      && isString(item.promaEntityId) && isOptionalString(item.calendarItemIdentifier)
      && isOptionalTimestamp(item.nativeStartAt) && isNonNegativeInteger(item.attempts)
      && isTimestamp(item.nextAttemptAt) && isOptionalString(item.lastError)
      && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))
    && (value.connections as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && isNativeEntity(item.entity) && isString(item.targetId)
      && isString(item.targetTitle) && isString(item.sourceTitle) && isString(item.sourceType)
      && typeof item.canWrite === 'boolean' && isTimestamp(item.connectedAt) && isTimestamp(item.updatedAt))
    && (value.connectionBindings as unknown[]).every((item) => isRecord(item)
      && isString(item.connectionId) && isString(item.promaEntityId) && isString(item.calendarItemIdentifier)
      && isOptionalBoolean(item.dueDateOnly) && isOptionalBoolean(item.recreatePending)
      && isOptionalString(item.lastNativeHash) && isOptionalTimestamp(item.lastSyncedAt))
    && (value.connectionOutbox as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && isString(item.connectionId)
      && (item.operation === 'upsert' || item.operation === 'hide') && isString(item.promaEntityId)
      && isNonNegativeInteger(item.attempts) && isTimestamp(item.nextAttemptAt)
      && isOptionalString(item.lastError) && Number.isInteger(item.revision) && Number(item.revision) >= 1
      && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))
    && (value.conflicts as unknown[]).every((item) => isRecord(item)
      && isString(item.id) && (item.owner === 'connection' || item.owner === 'profile')
      && isString(item.ownerId) && isNativeEntity(item.entity) && isString(item.promaEntityId)
      && (item.kind === 'changed' || item.kind === 'deleted')
      && (item.nativeItem === undefined || isRecord(item.nativeItem)) && isTimestamp(item.detectedAt))
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
    && isOptionalString(value.nativeConnectionId)
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
    && isOptionalString(value.nativeConnectionId)
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
  const sync = nativeSync(state)
  const profileIds = new Set(sync.profiles.map((item) => item.id))
  const connectionById = new Map(sync.connections.map((item) => [item.id, item]))
  if (!unique(sync.profiles.map((item) => item.id))
    || !unique(sync.profiles.map((item) => item.entity))
    || !unique(sync.connections.map((item) => item.id))
    || !unique(sync.connections.map((item) => `${item.entity}:${item.targetId}`))
    || !unique(sync.profileOutbox.map((item) => item.id))
    || !unique(sync.connectionOutbox.map((item) => item.id))
    || !unique(sync.cleanup.map((item) => item.id))
    || !unique(sync.conflicts.map((item) => item.id))) invalidPlanningState()
  for (const todo of state.todos) {
    if ((todo.groupId && !groupIds.has(`todo:${todo.groupId}`))
      || !unique(todo.tagIds)
      || todo.tagIds.some((id) => !tagIds.has(id))
      || (todo.nativeConnectionId && connectionById.get(todo.nativeConnectionId)?.entity !== 'reminder')) invalidPlanningState()
  }
  for (const event of state.calendarEvents) {
    if ((event.groupId && !groupIds.has(`calendar:${event.groupId}`))
      || (event.todoId && !todoIds.has(event.todoId))
      || !unique(event.tagIds)
      || event.tagIds.some((id) => !tagIds.has(id))
      || (event.endAt !== undefined && event.endAt < event.startAt)
      || (event.nativeConnectionId && connectionById.get(event.nativeConnectionId)?.entity !== 'calendar')) invalidPlanningState()
  }
  for (const reminder of state.reminders) {
    if (reminder.targetType === 'todo' ? !todoIds.has(reminder.targetId) : !eventIds.has(reminder.targetId)) invalidPlanningState()
  }
  for (const [todoId, links] of Object.entries(state.todoSessionLinks)) {
    if (!todoIds.has(todoId) || !unique(links.map((item) => item.sessionId))) invalidPlanningState()
  }
  if (sync.profileBindings.some((item) => !profileIds.has(item.profileId))
    || sync.profileOutbox.some((item) => !profileIds.has(item.profileId))
    || sync.connectionBindings.some((item) => !connectionById.has(item.connectionId))
    || sync.connectionOutbox.some((item) => !connectionById.has(item.connectionId))) invalidPlanningState()
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
  if (value.nativeSync !== undefined && !isPlanningNativeSyncState(value.nativeSync)) return invalidPlanningState()
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

function nativeOrigin(state: PlanningState, connectionId: string | undefined): Todo['nativeOrigin'] {
  if (!connectionId) return undefined
  const connection = nativeSync(state).connections.find((item) => item.id === connectionId)
  return connection ? {
    connectionId,
    targetTitle: connection.targetTitle,
    sourceTitle: connection.sourceTitle,
    canWrite: connection.canWrite,
  } : undefined
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
    nativeOrigin: nativeOrigin(state, todo.nativeConnectionId),
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
    nativeOrigin: nativeOrigin(state, event.nativeConnectionId),
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

/** EventKit locator 与修改时间不属于用户内容，不参与双向内容基线。 */
export function planningNativeCalendarHash(
  item: Pick<PlanningNativeExternalItem, 'title' | 'notes' | 'startAt' | 'endAt' | 'allDay'>,
): string {
  return JSON.stringify({
    title: item.title,
    notes: item.notes ?? null,
    startAt: item.startAt ?? null,
    endAt: item.endAt ?? null,
    allDay: Boolean(item.allDay),
  })
}

function removeNativeProjection(
  state: PlanningState,
  entity: PlanningNativeSyncEntity,
  promaEntityId: string,
  connectionId?: string,
): void {
  if (entity === 'reminder') {
    state.todos = state.todos.filter((todo) => todo.id !== promaEntityId
      || (connectionId !== undefined && todo.nativeConnectionId !== connectionId))
    state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === 'todo' && reminder.targetId === promaEntityId))
    delete state.todoSessionLinks[promaEntityId]
    for (const event of state.calendarEvents) {
      if (event.todoId === promaEntityId) event.todoId = undefined
    }
    return
  }
  state.calendarEvents = state.calendarEvents.filter((event) => event.id !== promaEntityId
    || (connectionId !== undefined && event.nativeConnectionId !== connectionId))
  state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === 'calendar_event' && reminder.targetId === promaEntityId))
}

function retryAt(attempts: number, now = Date.now()): number {
  return now + Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.min(Math.max(0, attempts - 1), 10))
}

function syncEntity(targetType: PlanningReminderTargetType): PlanningNativeSyncEntity {
  return targetType === 'todo' ? 'reminder' : 'calendar'
}

function putConflict(
  sync: PlanningNativeSyncState,
  input: Omit<PlanningStoredConflict, 'id' | 'detectedAt'>,
  now = Date.now(),
): void {
  const old = sync.conflicts.find((item) => item.owner === input.owner
    && item.ownerId === input.ownerId && item.promaEntityId === input.promaEntityId)
  if (old) Object.assign(old, input, { detectedAt: now })
  else sync.conflicts.push({ id: randomUUID(), ...input, detectedAt: now })
}

function enqueuePlanningSync(
  state: PlanningState,
  targetType: PlanningReminderTargetType,
  promaEntityId: string,
  operation: 'upsert' | 'delete',
  now = Date.now(),
  nativeStartAt?: number,
): void {
  const sync = nativeSync(state)
  const entity = syncEntity(targetType)
  const nativeBinding = sync.connectionBindings.find((item) => item.promaEntityId === promaEntityId)
  if (nativeBinding) {
    const connection = sync.connections.find((item) => item.id === nativeBinding.connectionId && item.entity === entity)
    if (!connection) throw new Error('系统集合连接已失效')
    if (!connection.canWrite) throw new Error('该系统集合为只读，不能在 Linguist Agent 中修改或删除')
    const old = sync.connectionOutbox.find((item) => item.connectionId === connection.id && item.promaEntityId === promaEntityId)
    if (old) Object.assign(old, {
      operation: operation === 'delete' ? 'hide' : 'upsert',
      attempts: 0,
      nextAttemptAt: now,
      lastError: undefined,
      revision: old.revision + 1,
      updatedAt: now,
    })
    else sync.connectionOutbox.push({
      id: randomUUID(), connectionId: connection.id,
      operation: operation === 'delete' ? 'hide' : 'upsert', promaEntityId,
      attempts: 0, nextAttemptAt: now, revision: 1, createdAt: now, updatedAt: now,
    })
    return
  }
  for (const profile of sync.profiles.filter((item) => item.entity === entity && item.enabled)) {
    const old = sync.profileOutbox.find((item) => item.profileId === profile.id && item.promaEntityId === promaEntityId)
    if (old) Object.assign(old, {
      targetId: profile.targetId, operation, nativeStartAt, attempts: 0,
      nextAttemptAt: now, lastError: undefined, revision: old.revision + 1, updatedAt: now,
    })
    else sync.profileOutbox.push({
      id: randomUUID(), profileId: profile.id, targetId: profile.targetId, operation,
      promaEntityId, nativeStartAt, attempts: 0, nextAttemptAt: now,
      revision: 1, createdAt: now, updatedAt: now,
    })
  }
}

function enqueueCleanup(
  sync: PlanningNativeSyncState,
  input: Omit<PlanningSyncCleanupItem, 'id' | 'attempts'>,
  now: number,
): void {
  const old = sync.cleanup.find((item) => item.entity === input.entity
    && item.targetId === input.targetId && item.promaEntityId === input.promaEntityId)
  if (old) Object.assign(old, input, { nextAttemptAt: now, lastError: undefined, updatedAt: now })
  else sync.cleanup.push({
    id: randomUUID(), ...input, attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
  })
}

function enqueueAllPlanningItems(state: PlanningState, profile: PlanningSyncProfile): void {
  const now = Date.now()
  if (profile.entity === 'calendar') {
    const from = now - 30 * 24 * 60 * 60 * 1_000
    const to = now + 18 * 30 * 24 * 60 * 60 * 1_000
    for (const event of state.calendarEvents.filter((item) => (item.endAt ?? item.startAt) >= from && item.startAt <= to)) {
      enqueuePlanningSync(state, 'calendar_event', event.id, 'upsert', now)
    }
  } else {
    for (const todo of state.todos.filter((item) => item.status === 'open')) {
      enqueuePlanningSync(state, 'todo', todo.id, 'upsert', now)
    }
  }
}

export function listPlanningSyncProfiles(): PlanningSyncProfile[] {
  return nativeSync(getPlanningState()).profiles.map((item) => ({ ...item })).sort((a, b) => a.entity.localeCompare(b.entity))
}

export function listEnabledManagedCalendarProfiles(): PlanningSyncProfile[] {
  return listPlanningSyncProfiles().filter((item) => item.entity === 'calendar' && item.enabled)
}

export function listPlanningSyncBindingIdentifiers(profileId: string, targetId: string): string[] {
  return nativeSync(getPlanningState()).profileBindings
    .filter((item) => item.profileId === profileId && item.targetId === targetId && item.calendarItemIdentifier)
    .map((item) => item.calendarItemIdentifier!)
}

export function listPlanningNativeConnections(entity?: PlanningNativeSyncEntity): PlanningNativeConnection[] {
  return nativeSync(getPlanningState()).connections
    .filter((item) => entity === undefined || item.entity === entity)
    .map((item) => ({ ...item }))
    .sort((a, b) => a.entity.localeCompare(b.entity)
      || a.sourceTitle.localeCompare(b.sourceTitle) || a.targetTitle.localeCompare(b.targetTitle))
}

export function connectPlanningNativeConnection(input: ConnectPlanningNativeConnectionInput): PlanningNativeConnection {
  const targetId = assertText(input.target.id, '系统集合', 1_000)
  const targetTitle = assertText(input.target.title, '系统集合名称', 500)
  const now = Date.now()
  let result!: PlanningNativeConnection
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    if (sync.profiles.some((item) => item.entity === input.entity && item.targetId === targetId)) {
      throw new Error('受管目标不能同时作为外部连接')
    }
    const old = sync.connections.find((item) => item.entity === input.entity && item.targetId === targetId)
    result = {
      id: old?.id ?? randomUUID(), entity: input.entity, targetId, targetTitle,
      sourceTitle: input.target.sourceTitle.trim().slice(0, 500), sourceType: input.target.sourceType,
      canWrite: input.target.canWrite, connectedAt: old?.connectedAt ?? now, updatedAt: now,
    }
    if (old) Object.assign(old, result)
    else sync.connections.push(result)
  })
  return { ...result }
}

export function disconnectPlanningNativeConnection(id: string): boolean {
  if (!nativeSync(getPlanningState()).connections.some((item) => item.id === id)) return false
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const connection = sync.connections.find((item) => item.id === id)
    if (!connection) return
    for (const binding of sync.connectionBindings.filter((item) => item.connectionId === id)) {
      removeNativeProjection(state, connection.entity, binding.promaEntityId, id)
    }
    sync.connections = sync.connections.filter((item) => item.id !== id)
    sync.connectionBindings = sync.connectionBindings.filter((item) => item.connectionId !== id)
    sync.connectionOutbox = sync.connectionOutbox.filter((item) => item.connectionId !== id)
    sync.conflicts = sync.conflicts.filter((item) => !(item.owner === 'connection' && item.ownerId === id))
  })
  return true
}

export function savePlanningSyncProfile(input: SavePlanningSyncProfileInput): PlanningSyncProfile {
  const targetId = assertText(input.target.id, '同步目标', 1_000)
  const targetTitle = assertText(input.target.title, '同步目标名称', 500)
  let result!: PlanningSyncProfile
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    if (sync.connections.some((item) => item.entity === input.entity && item.targetId === targetId)) {
      throw new Error('外部连接不能同时作为受管目标')
    }
    const old = sync.profiles.find((item) => item.entity === input.entity)
    const now = Math.max(Date.now(), (old?.updatedAt ?? 0) + 1)
    result = {
      id: old?.id ?? randomUUID(), entity: input.entity, targetId, targetTitle,
      sourceTitle: input.target.sourceTitle.trim().slice(0, 500),
      enabled: input.enabled ?? old?.enabled ?? true, createdAt: old?.createdAt ?? now, updatedAt: now,
    }
    const targetChanged = old !== undefined && old.targetId !== targetId
    if (targetChanged && old) {
      for (const binding of sync.profileBindings.filter((item) => item.profileId === old.id)) {
        enqueueCleanup(sync, {
          entity: old.entity, targetId: binding.targetId, promaEntityId: binding.promaEntityId,
          calendarItemIdentifier: binding.calendarItemIdentifier,
        }, now)
      }
      for (const pending of sync.profileOutbox.filter((item) => item.profileId === old.id && item.operation === 'upsert')) {
        enqueueCleanup(sync, {
          entity: old.entity, targetId: pending.targetId, promaEntityId: pending.promaEntityId,
          nativeStartAt: pending.nativeStartAt,
        }, now)
      }
      sync.profileBindings = sync.profileBindings.filter((item) => item.profileId !== old.id)
      sync.profileOutbox = sync.profileOutbox.filter((item) => item.profileId !== old.id)
      sync.conflicts = sync.conflicts.filter((item) => !(item.owner === 'profile' && item.ownerId === old.id))
    }
    if (old) Object.assign(old, result)
    else sync.profiles.push(result)
    if (result.enabled && (!old || targetChanged || !old.enabled)) enqueueAllPlanningItems(state, result)
  })
  return { ...result }
}

export function listDuePlanningSyncOutbox(now = Date.now(), limit = 25): PlanningSyncOutboxItem[] {
  const sync = nativeSync(getPlanningState())
  return sync.profileOutbox
    .filter((item) => item.nextAttemptAt <= now
      && !sync.conflicts.some((conflict) => conflict.owner === 'profile'
        && conflict.ownerId === item.profileId && conflict.promaEntityId === item.promaEntityId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit)
    .flatMap((item) => {
      const profile = sync.profiles.find((candidate) => candidate.id === item.profileId && candidate.enabled)
      if (!profile) return []
      const binding = sync.profileBindings.find((candidate) => candidate.profileId === item.profileId
        && candidate.targetId === item.targetId && candidate.promaEntityId === item.promaEntityId)
      return [{
        id: item.id, profile: { ...profile, targetId: item.targetId }, operation: item.operation,
        promaEntityId: item.promaEntityId, attempts: item.attempts, revision: item.revision,
        calendarItemIdentifier: binding?.calendarItemIdentifier, nativeStartAt: item.nativeStartAt,
      }]
    })
}

export function completePlanningSyncOutbox(
  item: PlanningSyncOutboxItem,
  identifiers?: { calendarItemIdentifier?: string; calendarItemExternalIdentifier?: string },
  nativeHash?: string,
): void {
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const current = sync.profileOutbox.find((candidate) => candidate.id === item.id && candidate.revision === item.revision)
    if (!current) return
    const profile = sync.profiles.find((candidate) => candidate.id === item.profile.id)
    const currentTarget = profile?.targetId === item.profile.targetId
    if (item.operation === 'delete' && currentTarget) {
      sync.profileBindings = sync.profileBindings.filter((binding) => !(binding.profileId === item.profile.id
        && binding.targetId === item.profile.targetId && binding.promaEntityId === item.promaEntityId))
    } else if (identifiers?.calendarItemIdentifier && currentTarget) {
      const binding = sync.profileBindings.find((candidate) => candidate.profileId === item.profile.id
        && candidate.promaEntityId === item.promaEntityId)
      const next: PlanningSyncBinding = {
        profileId: item.profile.id, targetId: item.profile.targetId, promaEntityId: item.promaEntityId,
        calendarItemIdentifier: identifiers.calendarItemIdentifier,
        calendarItemExternalIdentifier: identifiers.calendarItemExternalIdentifier,
        lastSyncedHash: nativeHash, lastSyncedAt: Date.now(),
      }
      if (binding) Object.assign(binding, next)
      else sync.profileBindings.push(next)
    } else if (identifiers?.calendarItemIdentifier) {
      enqueueCleanup(sync, {
        entity: item.profile.entity, targetId: item.profile.targetId, promaEntityId: item.promaEntityId,
        calendarItemIdentifier: identifiers.calendarItemIdentifier, nativeStartAt: item.nativeStartAt,
      }, Date.now())
    }
    sync.profileOutbox = sync.profileOutbox.filter((candidate) => !(candidate.id === item.id && candidate.revision === item.revision))
  })
}

export function failPlanningSyncOutbox(item: PlanningSyncOutboxItem, error: string): void {
  withPlanningTransaction((state) => {
    const current = nativeSync(state).profileOutbox.find((candidate) => candidate.id === item.id && candidate.revision === item.revision)
    if (!current) return
    current.attempts += 1
    current.nextAttemptAt = retryAt(current.attempts)
    current.lastError = error.slice(0, 1_000)
    current.updatedAt = Date.now()
  })
}

export function listDuePlanningSyncCleanup(now = Date.now(), limit = 25): PlanningSyncCleanupItem[] {
  return nativeSync(getPlanningState()).cleanup
    .filter((item) => item.nextAttemptAt <= now).sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit).map(({ nextAttemptAt: _next, lastError: _error, createdAt: _created, updatedAt: _updated, ...item }) => ({ ...item }))
}

export function completePlanningSyncCleanup(item: PlanningSyncCleanupItem): void {
  withPlanningTransaction((state) => {
    nativeSync(state).cleanup = nativeSync(state).cleanup.filter((candidate) => candidate.id !== item.id)
  })
}

export function failPlanningSyncCleanup(item: PlanningSyncCleanupItem, error: string): void {
  withPlanningTransaction((state) => {
    const current = nativeSync(state).cleanup.find((candidate) => candidate.id === item.id)
    if (!current) return
    current.attempts += 1
    current.nextAttemptAt = retryAt(current.attempts)
    current.lastError = error.slice(0, 1_000)
    current.updatedAt = Date.now()
  })
}

export function listDuePlanningNativeOutbox(now = Date.now(), limit = 25): PlanningNativeOutboxItem[] {
  const sync = nativeSync(getPlanningState())
  return sync.connectionOutbox
    .filter((item) => item.nextAttemptAt <= now
      && !sync.conflicts.some((conflict) => conflict.owner === 'connection'
        && conflict.ownerId === item.connectionId && conflict.promaEntityId === item.promaEntityId))
    .sort((a, b) => a.createdAt - b.createdAt).slice(0, limit)
    .flatMap((item) => {
      const connection = sync.connections.find((candidate) => candidate.id === item.connectionId)
      const binding = sync.connectionBindings.find((candidate) => candidate.connectionId === item.connectionId
        && candidate.promaEntityId === item.promaEntityId)
      return connection && binding ? [{
        id: item.id, connection: { ...connection }, operation: item.operation,
        promaEntityId: item.promaEntityId, calendarItemIdentifier: binding.calendarItemIdentifier,
        dueDateOnly: binding.dueDateOnly, recreatePending: binding.recreatePending,
        attempts: item.attempts, revision: item.revision,
      }] : []
    })
}

export function completePlanningNativeOutbox(
  item: PlanningNativeOutboxItem,
  identifiers?: { calendarItemIdentifier?: string },
): void {
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const current = sync.connectionOutbox.find((candidate) => candidate.id === item.id && candidate.revision === item.revision)
    if (!current) return
    const binding = sync.connectionBindings.find((candidate) => candidate.connectionId === item.connection.id
      && candidate.promaEntityId === item.promaEntityId)
    if (item.operation === 'hide') {
      removeNativeProjection(state, item.connection.entity, item.promaEntityId, item.connection.id)
      sync.connectionBindings = sync.connectionBindings.filter((candidate) => candidate !== binding)
    } else if (binding && identifiers?.calendarItemIdentifier) {
      binding.calendarItemIdentifier = identifiers.calendarItemIdentifier
      binding.recreatePending = false
      binding.lastNativeHash = undefined
      binding.lastSyncedAt = Date.now()
    }
    sync.connectionOutbox = sync.connectionOutbox.filter((candidate) => !(candidate.id === item.id && candidate.revision === item.revision))
  })
}

export function failPlanningNativeOutbox(item: PlanningNativeOutboxItem, error: string): void {
  withPlanningTransaction((state) => {
    const current = nativeSync(state).connectionOutbox.find((candidate) => candidate.id === item.id && candidate.revision === item.revision)
    if (!current) return
    current.attempts += 1
    current.nextAttemptAt = retryAt(current.attempts)
    current.lastError = error.slice(0, 1_000)
    current.updatedAt = Date.now()
  })
}

export function listPlanningNativeBindingIdentifiers(connectionId: string): string[] {
  return nativeSync(getPlanningState()).connectionBindings
    .filter((item) => item.connectionId === connectionId).map((item) => item.calendarItemIdentifier)
}

function hideMissingNativeBindings(
  state: PlanningState,
  connection: PlanningNativeConnection,
  existingIdentifiers: Set<string>,
): void {
  const sync = nativeSync(state)
  for (const binding of [...sync.connectionBindings]) {
    if (binding.connectionId !== connection.id
      || existingIdentifiers.has(binding.calendarItemIdentifier)
      || binding.recreatePending) continue
    const pending = sync.connectionOutbox.some((item) => item.connectionId === connection.id
      && item.promaEntityId === binding.promaEntityId)
    if (pending) {
      putConflict(sync, {
        owner: 'connection', ownerId: connection.id, entity: connection.entity,
        promaEntityId: binding.promaEntityId, kind: 'deleted',
      })
      continue
    }
    removeNativeProjection(state, connection.entity, binding.promaEntityId, connection.id)
    sync.connectionBindings = sync.connectionBindings.filter((item) => item !== binding)
  }
}

/** 精确 locator 查询确认系统端缺失后，移除对应投影；不会把有界日历查询误当完整快照。 */
export function hideMissingPlanningNativeConnectionItems(connectionId: string, existingIdentifiers: string[]): void {
  const connection = nativeSync(getPlanningState()).connections.find((item) => item.id === connectionId)
  if (!connection) return
  const existing = new Set(existingIdentifiers)
  withPlanningTransaction((state) => hideMissingNativeBindings(state, connection, existing))
}

/** EventKit 回流专用路径；不调用普通 CRUD，避免产生同步回声。 */
export function applyPlanningNativeConnectionItems(
  connectionId: string,
  items: PlanningNativeExternalItem[],
  options: { fullSnapshot?: boolean } = {},
): void {
  const connection = nativeSync(getPlanningState()).connections.find((item) => item.id === connectionId)
  if (!connection) return
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const now = Date.now()
    const seen = new Set<string>()
    for (const item of items) {
      if (!item.calendarItemIdentifier || !item.title) continue
      seen.add(item.calendarItemIdentifier)
      const binding = sync.connectionBindings.find((candidate) => candidate.connectionId === connectionId
        && candidate.calendarItemIdentifier === item.calendarItemIdentifier)
      if (item.isRecurring) {
        if (binding) {
          sync.connectionOutbox = sync.connectionOutbox.filter((candidate) => !(candidate.connectionId === connectionId
            && candidate.promaEntityId === binding.promaEntityId))
          removeNativeProjection(state, connection.entity, binding.promaEntityId, connectionId)
          sync.connectionBindings = sync.connectionBindings.filter((candidate) => candidate !== binding)
        }
        continue
      }
      const hash = JSON.stringify(item)
      if (binding?.lastNativeHash === hash) continue
      const localId = binding?.promaEntityId ?? randomUUID()
      if (binding && sync.connectionOutbox.some((candidate) => candidate.connectionId === connectionId
        && candidate.promaEntityId === localId)) {
        putConflict(sync, {
          owner: 'connection', ownerId: connectionId, entity: connection.entity,
          promaEntityId: localId, kind: 'changed', nativeItem: structuredClone(item),
        }, now)
        continue
      }
      const updatedAt = Math.max(now, item.lastModifiedAt || now)
      if (connection.entity === 'reminder') {
        const target = findTodo(state, localId)
        const values: StoredTodo = {
          id: localId, title: item.title.slice(0, 500), notes: item.notes,
          status: item.completed ? 'completed' : 'open', priority: item.priority ?? 'medium',
          dueAt: item.dueAt, nativeConnectionId: connectionId,
          createdAt: target?.createdAt ?? now, updatedAt,
          completedAt: item.completed ? (item.completedAt ?? now) : undefined,
          tagIds: target?.tagIds ?? [], groupId: target?.groupId, workspaceId: target?.workspaceId,
        }
        if (target) Object.assign(target, values)
        else state.todos.push(values)
      } else {
        if (!item.startAt) continue
        const target = findCalendarEvent(state, localId)
        const values: StoredCalendarEvent = {
          id: localId, title: item.title.slice(0, 500), notes: item.notes,
          startAt: item.startAt, endAt: item.endAt, allDay: Boolean(item.allDay),
          nativeConnectionId: connectionId, createdAt: target?.createdAt ?? now, updatedAt,
          tagIds: target?.tagIds ?? [], groupId: target?.groupId, workspaceId: target?.workspaceId,
          todoId: target?.todoId,
        }
        if (target) Object.assign(target, values)
        else state.calendarEvents.push(values)
      }
      const nextBinding: PlanningNativeBinding = {
        connectionId, promaEntityId: localId, calendarItemIdentifier: item.calendarItemIdentifier,
        dueDateOnly: item.dueDateOnly, recreatePending: false, lastNativeHash: hash, lastSyncedAt: now,
      }
      if (binding) Object.assign(binding, nextBinding)
      else sync.connectionBindings.push(nextBinding)
    }
    if (options.fullSnapshot) hideMissingNativeBindings(state, connection, seen)
  })
}

/** 受管 Calendar 回流路径；只有稳定 locator 或待完成 outbox marker 能恢复既有绑定。 */
export function applyManagedCalendarProfileItems(profileId: string, items: PlanningNativeExternalItem[]): void {
  const profile = nativeSync(getPlanningState()).profiles.find((item) => item.id === profileId
    && item.entity === 'calendar' && item.enabled)
  if (!profile) return
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const now = Date.now()
    for (const item of items) {
      if (!item.calendarItemIdentifier || !item.title || !item.startAt) continue
      let binding = sync.profileBindings.find((candidate) => candidate.profileId === profileId
        && candidate.targetId === profile.targetId
        && candidate.calendarItemIdentifier === item.calendarItemIdentifier)
      if (!binding) {
        const candidates = sync.profileBindings.filter((candidate) => candidate.profileId === profileId
          && candidate.targetId === profile.targetId
          && ((item.calendarItemExternalIdentifier !== undefined
              && candidate.calendarItemExternalIdentifier === item.calendarItemExternalIdentifier)
            || (item.promaIdentity !== undefined && candidate.promaEntityId === item.promaIdentity)))
        const marker = item.promaIdentity
          ? candidates.find((candidate) => candidate.promaEntityId === item.promaIdentity)
          : undefined
        if (candidates.length === 1 && marker && item.calendarItemExternalIdentifier
          && marker.calendarItemExternalIdentifier === item.calendarItemExternalIdentifier) binding = marker
        else if (candidates.length > 0) {
          for (const candidate of candidates) {
            putConflict(sync, {
              owner: 'profile', ownerId: profileId, entity: 'calendar',
              promaEntityId: candidate.promaEntityId, kind: 'changed', nativeItem: structuredClone(item),
            }, now)
          }
          continue
        }
      }
      if (item.isRecurring) {
        if (binding) {
          sync.profileOutbox = sync.profileOutbox.filter((candidate) => !(candidate.profileId === profileId
            && candidate.promaEntityId === binding.promaEntityId))
          removeNativeProjection(state, 'calendar', binding.promaEntityId)
          sync.profileBindings = sync.profileBindings.filter((candidate) => candidate !== binding)
        }
        continue
      }
      if (binding && binding.calendarItemIdentifier !== item.calendarItemIdentifier) {
        binding.calendarItemIdentifier = item.calendarItemIdentifier
        binding.calendarItemExternalIdentifier = item.calendarItemExternalIdentifier ?? binding.calendarItemExternalIdentifier
        binding.lastSyncedAt = now
      }
      const hash = planningNativeCalendarHash(item)
      if (binding?.lastSyncedHash === hash) continue
      const recoveredPending = !binding && item.promaIdentity
        ? sync.profileOutbox.some((candidate) => candidate.profileId === profileId
          && candidate.promaEntityId === item.promaIdentity && candidate.operation === 'upsert')
        : false
      const localId = binding?.promaEntityId ?? (recoveredPending ? item.promaIdentity! : randomUUID())
      const pending = (binding || recoveredPending) && sync.profileOutbox.some((candidate) => candidate.profileId === profileId
        && candidate.promaEntityId === localId)
      if (pending && !recoveredPending) {
        putConflict(sync, {
          owner: 'profile', ownerId: profileId, entity: 'calendar',
          promaEntityId: localId, kind: 'changed', nativeItem: structuredClone(item),
        }, now)
        continue
      }
      const target = findCalendarEvent(state, localId)
      const values: StoredCalendarEvent = {
        id: localId, title: item.title.slice(0, 500), notes: item.notes,
        startAt: item.startAt, endAt: item.endAt, allDay: Boolean(item.allDay),
        createdAt: target?.createdAt ?? now, updatedAt: Math.max(now, item.lastModifiedAt || now),
        tagIds: target?.tagIds ?? [], groupId: target?.groupId, workspaceId: target?.workspaceId,
        todoId: target?.todoId,
      }
      if (target) Object.assign(target, values)
      else state.calendarEvents.push(values)
      const nextBinding: PlanningSyncBinding = {
        profileId, targetId: profile.targetId, promaEntityId: localId,
        calendarItemIdentifier: item.calendarItemIdentifier,
        calendarItemExternalIdentifier: item.calendarItemExternalIdentifier,
        lastSyncedHash: hash, lastSyncedAt: now,
      }
      if (binding) Object.assign(binding, nextBinding)
      else sync.profileBindings.push(nextBinding)
    }
  })
}

/** 只有 locator 精确读取确认缺失的受管 Calendar 项才视为系统端删除。 */
export function hideMissingManagedCalendarProfileItems(
  profileId: string,
  targetId: string,
  existingIdentifiers: string[],
): void {
  const profile = nativeSync(getPlanningState()).profiles.find((item) => item.id === profileId
    && item.entity === 'calendar' && item.enabled && item.targetId === targetId)
  if (!profile) return
  const existing = new Set(existingIdentifiers)
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    for (const binding of [...sync.profileBindings]) {
      if (binding.profileId !== profileId || binding.targetId !== targetId
        || !binding.calendarItemIdentifier || existing.has(binding.calendarItemIdentifier)) continue
      const pending = sync.profileOutbox.some((item) => item.profileId === profileId
        && item.promaEntityId === binding.promaEntityId)
      const conflicted = sync.conflicts.some((item) => item.owner === 'profile'
        && item.ownerId === profileId && item.promaEntityId === binding.promaEntityId)
      if (pending && !conflicted) {
        putConflict(sync, {
          owner: 'profile', ownerId: profileId, entity: 'calendar',
          promaEntityId: binding.promaEntityId, kind: 'deleted',
        })
      }
      if (pending || conflicted) continue
      removeNativeProjection(state, 'calendar', binding.promaEntityId)
      sync.profileBindings = sync.profileBindings.filter((item) => item !== binding)
    }
  })
}

export function listPlanningNativeSyncConflicts(): PlanningNativeSyncConflict[] {
  const state = getPlanningState()
  const sync = nativeSync(state)
  return sync.conflicts.map((item) => {
    const connection = item.owner === 'connection'
      ? sync.connections.find((candidate) => candidate.id === item.ownerId)
      : undefined
    const profile = item.owner === 'profile'
      ? sync.profiles.find((candidate) => candidate.id === item.ownerId)
      : undefined
    const local = item.entity === 'reminder'
      ? findTodo(state, item.promaEntityId)
      : findCalendarEvent(state, item.promaEntityId)
    return {
      id: item.id,
      connectionId: item.owner === 'connection' ? item.ownerId : undefined,
      profileId: item.owner === 'profile' ? item.ownerId : undefined,
      entity: item.entity,
      promaEntityId: item.promaEntityId,
      title: local?.title ?? connection?.targetTitle ?? profile?.targetTitle ?? '系统事项',
      kind: item.kind,
      detectedAt: item.detectedAt,
    }
  }).sort((a, b) => b.detectedAt - a.detectedAt)
}

/** 冲突必须显式选择；保留系统才回流，保留本地才继续或重建出站版本。 */
export function resolvePlanningNativeSyncConflict(input: ResolvePlanningNativeSyncConflictInput): boolean {
  const current = nativeSync(getPlanningState()).conflicts.find((item) => item.id === input.id)
  if (!current) return false
  let applyConnection: { id: string; item: PlanningNativeExternalItem } | undefined
  let applyProfile: { id: string; item: PlanningNativeExternalItem } | undefined
  withPlanningTransaction((state) => {
    const sync = nativeSync(state)
    const conflict = sync.conflicts.find((item) => item.id === input.id)
    if (!conflict) return
    if (conflict.owner === 'connection') {
      const binding = sync.connectionBindings.find((item) => item.connectionId === conflict.ownerId
        && item.promaEntityId === conflict.promaEntityId)
      const connection = sync.connections.find((item) => item.id === conflict.ownerId)
      if (!binding || !connection) return
      if (input.resolution === 'keep_proma') {
        if (!connection.canWrite) throw new Error('该系统集合为只读，不能保留本地版本')
        if (conflict.kind === 'changed' && conflict.nativeItem) binding.lastNativeHash = JSON.stringify(conflict.nativeItem)
        if (conflict.kind === 'deleted') binding.recreatePending = true
        enqueuePlanningSync(state, connection.entity === 'reminder' ? 'todo' : 'calendar_event', conflict.promaEntityId, 'upsert')
      } else {
        sync.connectionOutbox = sync.connectionOutbox.filter((item) => !(item.connectionId === conflict.ownerId
          && item.promaEntityId === conflict.promaEntityId))
        if (conflict.kind === 'deleted') {
          removeNativeProjection(state, conflict.entity, conflict.promaEntityId, conflict.ownerId)
          sync.connectionBindings = sync.connectionBindings.filter((item) => item !== binding)
        } else if (conflict.nativeItem) applyConnection = { id: conflict.ownerId, item: structuredClone(conflict.nativeItem) }
      }
    } else {
      const binding = sync.profileBindings.find((item) => item.profileId === conflict.ownerId
        && item.promaEntityId === conflict.promaEntityId)
      if (!binding) return
      if (input.resolution === 'keep_proma') {
        if (conflict.kind === 'changed' && conflict.nativeItem
          && binding.calendarItemIdentifier === conflict.nativeItem.calendarItemIdentifier) {
          binding.lastSyncedHash = planningNativeCalendarHash(conflict.nativeItem)
          binding.lastSyncedAt = Date.now()
        } else {
          binding.calendarItemIdentifier = undefined
          binding.lastSyncedHash = undefined
        }
        enqueuePlanningSync(state, 'calendar_event', conflict.promaEntityId, 'upsert')
      } else {
        sync.profileOutbox = sync.profileOutbox.filter((item) => !(item.profileId === conflict.ownerId
          && item.promaEntityId === conflict.promaEntityId))
        if (conflict.kind === 'deleted') {
          removeNativeProjection(state, 'calendar', conflict.promaEntityId)
          sync.profileBindings = sync.profileBindings.filter((item) => item !== binding)
        } else if (conflict.nativeItem) {
          binding.calendarItemIdentifier = conflict.nativeItem.calendarItemIdentifier
          binding.calendarItemExternalIdentifier = conflict.nativeItem.calendarItemExternalIdentifier
          applyProfile = { id: conflict.ownerId, item: structuredClone(conflict.nativeItem) }
        }
      }
    }
    sync.conflicts = sync.conflicts.filter((item) => item.id !== input.id)
  })
  if (applyConnection) applyPlanningNativeConnectionItems(applyConnection.id, [applyConnection.item])
  if (applyProfile) applyManagedCalendarProfileItems(applyProfile.id, [applyProfile.item])
  return true
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
    enqueuePlanningSync(draft, 'todo', todo.id, 'upsert', now)
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
    enqueuePlanningSync(draft, 'todo', input.id, 'upsert', updatedAt)
  })
  return getTodo(input.id)
}

export function deleteTodo(id: string): boolean {
  if (!findTodo(getPlanningState(), id)) return false
  withPlanningTransaction((state) => {
    enqueuePlanningSync(state, 'todo', id, 'delete')
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
    enqueuePlanningSync(draft, 'calendar_event', event.id, 'upsert', now)
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
    enqueuePlanningSync(draft, 'calendar_event', input.id, 'upsert', updatedAt)
  })
  return getCalendarEvent(input.id)
}

export function deleteCalendarEvent(id: string): boolean {
  const old = findCalendarEvent(getPlanningState(), id)
  if (!old) return false
  withPlanningTransaction((state) => {
    enqueuePlanningSync(state, 'calendar_event', id, 'delete', Date.now(), old.startAt)
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

/** 读取提醒以在上层能力开关中核验其归属类型。 */
export function getPlanningReminder(id: string): PlanningReminder | undefined {
  const reminder = findReminder(getPlanningState(), id)
  return reminder ? copyReminder(reminder) : undefined
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
  const current = getPlanningState()
  const managedReminderIds = new Set(nativeSync(current).profileBindings
    .filter((binding) => nativeSync(current).profiles.some((profile) => profile.id === binding.profileId
      && profile.entity === 'reminder' && profile.enabled))
    .map((binding) => binding.promaEntityId))
  const due = current.reminders.filter((reminder) => (
    reminder.status === 'pending'
    && effectiveReminderTime(reminder) <= now
    && reminder.lastNotifiedAt === undefined
    && !(reminder.origin === 'todo_due_at' && reminder.targetType === 'todo'
      && managedReminderIds.has(reminder.targetId))
  ))
  if (due.length === 0) return []

  return withPlanningTransaction((state) => {
    const result: ActivePlanningReminder[] = []
    for (const reminder of state.reminders
      .filter((candidate) => candidate.status === 'pending'
        && effectiveReminderTime(candidate) <= now
        && candidate.lastNotifiedAt === undefined
        && !(candidate.origin === 'todo_due_at' && candidate.targetType === 'todo'
          && managedReminderIds.has(candidate.targetId)))
      .sort((left, right) => effectiveReminderTime(left) - effectiveReminderTime(right))) {
      reminder.lastNotifiedAt = now
      reminder.updatedAt = now
      const active = activeReminderFromState(state, reminder)
      if (active) result.push(active)
    }
    return result
  })
}
