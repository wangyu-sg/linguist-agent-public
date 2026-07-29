/**
 * Projects 页纯函数助手（ticket PB-032）
 *
 * 本模块刻意不含任何 React / IPC 依赖：排序、归档分组、表单预校验、
 * 错误码中文化、健康报告摘要、时间格式化、资产摘要截断（PB-033）
 * 全部为纯函数，bun test 直接驱动（project-utils.test.ts）。
 *
 * 校验规则镜像主进程 IPC（apps/electron/src/main/lib/linguist/project-ipc.ts
 * 的 readProjectName / readLocale）：renderer 预校验只为提前给出中文反馈，
 * 主进程仍是唯一权威校验方（计划 §7.4：renderer 不可信）。
 */

import {
  LINGUIST_IPC_ERROR_CODES,
  LINGUIST_LOCALE_MAX_LENGTH,
  LINGUIST_LOCALE_PATTERN,
  LINGUIST_PROJECT_NAME_MAX_LENGTH,
  LINGUIST_QUALITY_PROFILES,
  type LinguistIpcError,
  type LinguistIpcErrorCode,
  type LinguistProjectHealthCheckInfo,
  type LinguistProjectHealthReport,
  type LinguistProjectInfo,
  type LinguistQualityProfile,
} from '@proma/shared'

// ===== 质量策略档（PB-082，计划 §21）=====

/**
 * renderer 侧质量策略档兜底（主进程线上必有值，此处仅防御旧缓存/异常
 * payload）：未知/缺省一律 'balanced'，与主进程 normalizeQualityProfile 同语义。
 */
export function normalizeQualityProfileInfo(value: unknown): LinguistQualityProfile {
  return (LINGUIST_QUALITY_PROFILES as readonly string[]).includes(value as string)
    ? (value as LinguistQualityProfile)
    : 'balanced'
}

/** 三档展示选项（segmented 选择器渲染用；order 与契约一致）。 */
export const QUALITY_PROFILE_OPTIONS: readonly {
  profile: LinguistQualityProfile
  label: string
  /** 一句中文说明（选择器下方同步展示当前档说明）。 */
  description: string
}[] = [
  {
    profile: 'fast',
    label: 'Fast',
    description: '大批次单轮提案，每段仍先查 TM/术语库（速度来自批次与单轮，不跳查库），完成后跑确定性 QA。',
  },
  {
    profile: 'balanced',
    label: 'Balanced',
    description: '中批次提案，逐段先查 TM/术语库并结合上下文，完成后跑确定性 QA。',
  },
  {
    profile: 'best',
    label: 'Best',
    description: '小批次逐段查库精译，提案后请发起独立评审（评审 Finding 以 CRITIC_ 前缀进 QA 面板）。',
  },
]

/** 档位 → 一句中文说明（缺省/未知回落 balanced）。 */
export function describeQualityProfile(profile: LinguistQualityProfile): string {
  const option = QUALITY_PROFILE_OPTIONS.find((item) => item.profile === profile)
  return (option ?? QUALITY_PROFILE_OPTIONS[1]!).description
}

// ===== 列表排序与分组 =====

/**
 * 「最近」排序：当前定义为 updatedAt 降序（PB-032）。
 * ISO 8601 字符串可直接按字典序比较；若后续引入「最近打开」记录，
 * 在此替换排序键即可，调用方不变。
 */
export function sortProjectsByRecentDesc(
  projects: readonly LinguistProjectInfo[],
): LinguistProjectInfo[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 按 archivedAt 分为活跃 / 已归档两组，两组各自按「最近」降序。 */
export function partitionProjectsByArchived(projects: readonly LinguistProjectInfo[]): {
  active: LinguistProjectInfo[]
  archived: LinguistProjectInfo[]
} {
  const active: LinguistProjectInfo[] = []
  const archived: LinguistProjectInfo[] = []
  for (const project of projects) {
    if (project.archivedAt === undefined) active.push(project)
    else archived.push(project)
  }
  return { active: sortProjectsByRecentDesc(active), archived: sortProjectsByRecentDesc(archived) }
}

// ===== 表单预校验（镜像 IPC；返回中文错误文案，null = 通过）=====

/**
 * 项目名预校验。调用方发送前会 trim，故按 trim 后的值校验
 * （trim 后非空 + ≤120 必过 IPC 的 raw 校验）。
 */
export function validateProjectNameInput(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return '项目名称不能为空'
  if (trimmed.length > LINGUIST_PROJECT_NAME_MAX_LENGTH) {
    return `项目名称最长 ${LINGUIST_PROJECT_NAME_MAX_LENGTH} 个字符`
  }
  return null
}

/**
 * locale 预校验（BCP-47 形状，与 IPC 同一正则；刻意不查表）。
 * fieldLabel 用于错误文案（「源语言」/「目标语言」）。
 */
export function validateLocaleInput(value: string, fieldLabel: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return `${fieldLabel}不能为空`
  if (trimmed.length > LINGUIST_LOCALE_MAX_LENGTH) {
    return `${fieldLabel}最长 ${LINGUIST_LOCALE_MAX_LENGTH} 个字符`
  }
  if (!LINGUIST_LOCALE_PATTERN.test(trimmed)) {
    return `${fieldLabel}格式不正确（示例：en、zh-CN、zh-Hant-TW、pt-BR）`
  }
  return null
}

// ===== 错误码中文化 =====

/**
 * 稳定错误码（含项目排序与会话复制）的中文可读文案。
 * Record<LinguistIpcErrorCode, string> 由编译器保证与契约目录一一对应；
 * project-utils.test.ts 另有运行时完备性断言。
 */
export const LINGUIST_IPC_ERROR_MESSAGES: Record<LinguistIpcErrorCode, string> = {
  INVALID_INPUT: '输入不符合要求',
  INTERNAL: '发生内部错误，请重试',
  PROJECT_NOT_FOUND: '项目不存在或已被移除',
  PROJECT_ARCHIVED: '项目已归档，无法执行写操作',
  PROJECT_UNHEALTHY: '项目数据未通过健康检查，需要修复',
  IMPORT_TOO_LARGE: '导入文件超过大小限制',
  EXPORT_BLOCKED_BY_QA: '仍有阻断级 QA 问题，请先修复或在审核中填写豁免理由',
  DELIVERY_NOT_READY: '交付预检尚未通过，请先处理提案、确认句段并解决阻断级 QA',
  CONTEXT_DOC_EXTRACT_FAILED: 'DOCX 文本读取失败；文件可能损坏、加密、仅含图片或不是有效 DOCX',
  PROJECT_DELETE_REQUIRES_ARCHIVE: '请先归档项目，再执行删除',
  PROJECT_DELETE_CONFIRMATION_MISMATCH: '项目名称确认不匹配，已取消删除',
  PROJECT_ORDER_CONFLICT: '项目顺序已变化，请刷新后重试',
  SESSION_COPY_BLOCKED: '当前会话状态不能安全复制到其他项目',
  STORE_SQLITE_UNAVAILABLE: '本机 SQLite 运行时不可用，项目数据库暂无法访问',
  STORE_SCHEMA_TOO_NEW: '项目数据由更新版本的应用创建，请升级应用后再打开',
  STORE_NOT_FOUND: '项目存储不存在',
  STORE_INDEX_CORRUPT: '项目索引损坏',
  STORE_READ_ONLY: '项目存储为只读，无法写入',
  STORE_BUSY: '项目数据正被占用，请稍后重试',
  STORE_PROJECT_EXISTS: '同名项目已存在',
  STORE_ASSET_SOURCE_MISMATCH: '资产源文件校验不一致',
  STORE_BACKUP_CORRUPT: '备份未通过完整性校验，已拒绝恢复',
  STORE_BACKUP_LEGACY: '旧格式备份缺少完整性清单与源文件，不支持恢复',
  FORMAT_PARSE_ERROR: '文件解析失败',
  FORMAT_EXPORT_ERROR: '导出失败',
  FORMAT_SEGMENT_LOST: '导出会丢失段，已中止',
  FORMAT_UNSUPPORTED: '不支持的文件格式',
  SEGMENT_LOCKED: '段已锁定',
  REVISION_CONFLICT: '内容已被其他操作修改，请刷新后重试',
  STALE_PROPOSAL: '提案已过期',
  UNKNOWN_SEGMENT: '段不存在',
  INVALID_STATE_TRANSITION: '不允许的状态变更',
  INVALID_ID: 'ID 格式不合法',
}

/**
 * 把 IPC 错误信封渲染为一行中文可读文案，固定附稳定码后缀
 * （码是公开契约，便于支持与日志对齐）。输入错误与 DOCX 抽取错误的
 * message 只含校验规则/固定诊断，可安全透出帮助定位。
 */
export function describeLinguistIpcError(error: LinguistIpcError): string {
  const base = LINGUIST_IPC_ERROR_MESSAGES[error.code] ?? '发生未知错误'
  if (
    error.code === LINGUIST_IPC_ERROR_CODES.INVALID_INPUT
    || error.code === LINGUIST_IPC_ERROR_CODES.CONTEXT_DOC_EXTRACT_FAILED
  ) {
    return `${base}：${error.message}（${error.code}）`
  }
  return `${base}（${error.code}）`
}

// ===== Quick Health 报告 =====

/** 健康报告中未通过的检查项。 */
export function failedHealthChecks(
  health: LinguistProjectHealthReport,
): LinguistProjectHealthCheckInfo[] {
  return health.checks.filter((check) => !check.ok)
}

const HEALTH_CHECK_LABELS: Record<LinguistProjectHealthCheckInfo['id'], string> = {
  project_json: '项目元数据',
  cat_db_open: '翻译数据库',
  schema_version: '数据库版本',
  asset_sources: '资产源有界抽样',
}

/** 检查项 id → 中文标签；未知 id 原样返回（契约外 id 不 crash）。 */
export function describeHealthCheckId(id: string): string {
  return HEALTH_CHECK_LABELS[id as LinguistProjectHealthCheckInfo['id']] ?? id
}

/**
 * 失败检查项的一行摘要（仅含检查项标签与 detail 中的错误码/计数——
 * 契约保证 detail 绝无客户文本）。
 */
export function summarizeFailedHealthChecks(health: LinguistProjectHealthReport): string {
  return failedHealthChecks(health)
    .map((check) => {
      const label = describeHealthCheckId(check.id)
      return check.detail !== undefined ? `${label}（${check.detail}）` : label
    })
    .join('、')
}

// ===== 资产摘要（PB-033）=====

/**
 * SHA-256（64 hex）的截断展示：`前 12…后 4`（如 `7a3b67c1eab3…5030`）。
 * 截断仅为展示——完整值经复制按钮取得；短输入原样返回（不 crash）。
 */
export function truncateSha256(sha256: string): string {
  if (sha256.length <= 18) return sha256
  return `${sha256.slice(0, 12)}…${sha256.slice(-4)}`
}

// ===== 时间格式化 =====

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 当日零点的毫秒时间戳（本地时区）。 */
function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY_MS = 86_400_000

/**
 * 项目时间的人性化格式：今天 HH:mm / 昨天 HH:mm / 同年 M月d日 / 更早 yyyy年M月d日。
 * now 可注入以保证测试确定性；非法输入原样返回（不 crash）。
 */
export function formatProjectTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const dayDiff = startOfDayMs(now) - startOfDayMs(date)
  if (dayDiff <= 0) return `今天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (dayDiff < 2 * DAY_MS) return `昨天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}
