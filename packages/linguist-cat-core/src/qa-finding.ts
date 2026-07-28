/**
 * QaFinding lifecycle. PB-070's deterministic rule engine produces open
 * findings; status changes remain explicit human review operations.
 *
 * PB-096 契约对齐：severity 换五档 L0–L4，新增 issueType（29 枚举）与
 * disposition（四值，创建时确定、与 status 状态机正交）。id 派生公式不变
 * （仍 segmentId+code+message），新字段不进 id，resolved/waived 历史不断链。
 */

import { InvalidStateTransitionError } from './errors'
import { deriveQaFindingId, type QaFindingId, type SegmentId } from './ids'
import {
  resolveQaIssueMapping,
  type QaFindingDisposition,
  type QaFindingSeverity,
  type QaIssueType,
} from './issue-type'

export type { QaFindingDisposition, QaFindingSeverity, QaIssueType } from './issue-type'

export type QaFindingStatus = 'open' | 'resolved' | 'waived'

export interface QaFinding {
  id: QaFindingId
  segmentId: SegmentId
  /** Stable rule code, e.g. 'NUMBER_MISMATCH'. */
  code: string
  severity: QaFindingSeverity
  /** 缺陷分类（29 枚举，含 other 兜底）。 */
  issueType: QaIssueType
  /** 处置（创建时确定；与 status 正交，状态机不动）。 */
  disposition: QaFindingDisposition
  message: string
  status: QaFindingStatus
}

/** Allowed status transitions: open -> resolved|waived, resolved|waived -> open. */
export const QA_FINDING_TRANSITIONS: Readonly<Record<QaFindingStatus, readonly QaFindingStatus[]>> = {
  open: ['resolved', 'waived'],
  resolved: ['open'],
  waived: ['open'],
}

export interface OpenQaFindingInput {
  segmentId: SegmentId
  code: string
  severity: QaFindingSeverity
  message: string
  /** 缺省时按 code 查静态映射表（未知码 other 兜底）。 */
  issueType?: QaIssueType
  /** 缺省时按 code 查静态映射表（未知码 defect 兜底）。 */
  disposition?: QaFindingDisposition
}

/**
 * Open a finding; the id is content-derived (same input, same id).
 * issueType/disposition 缺省从 code 静态映射表回填——单一事实来源在
 * issue-type.ts，调用方只在需要偏离表值（如术语策略升降级）时显式传入。
 */
export function openQaFinding(input: OpenQaFindingInput): QaFinding {
  const mapping = resolveQaIssueMapping(input.code)
  return {
    id: deriveQaFindingId(input.segmentId, input.code, input.message),
    segmentId: input.segmentId,
    code: input.code,
    severity: input.severity,
    issueType: input.issueType ?? mapping.issueType,
    disposition: input.disposition ?? mapping.disposition,
    message: input.message,
    status: 'open',
  }
}

/** Pure status transition enforcing QA_FINDING_TRANSITIONS. */
export function transitionQaFinding(finding: QaFinding, to: QaFindingStatus): QaFinding {
  const allowed = QA_FINDING_TRANSITIONS[finding.status]
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError('qa-finding', finding.status, to)
  }
  return { ...finding, status: to }
}
