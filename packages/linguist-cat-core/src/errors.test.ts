import { describe, expect, test } from 'bun:test'
import {
  DOMAIN_ERROR_CODES,
  DomainError,
  InvalidIdError,
  InvalidStateTransitionError,
  RevisionConflictError,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
} from './index'

describe('领域错误 code 稳定性', () => {
  test('全部 code 字面量固定（公共契约）', () => {
    expect(DOMAIN_ERROR_CODES).toEqual({
      SEGMENT_LOCKED: 'SEGMENT_LOCKED',
      REVISION_CONFLICT: 'REVISION_CONFLICT',
      STALE_PROPOSAL: 'STALE_PROPOSAL',
      UNKNOWN_SEGMENT: 'UNKNOWN_SEGMENT',
      INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
      INVALID_ID: 'INVALID_ID',
    })
  })

  test('各错误类的 code 与 name', () => {
    expect(new SegmentLockedError('seg-1').code).toBe('SEGMENT_LOCKED')
    expect(new RevisionConflictError('seg-1', 1, 2).code).toBe('REVISION_CONFLICT')
    const stale = new StaleProposalError('prp-1', 'seg-1', 1, 2)
    expect(stale.code).toBe('STALE_PROPOSAL')
    // StaleProposalError 是 RevisionConflictError 的子类：通用 CAS 处理器可同时捕获
    expect(stale).toBeInstanceOf(RevisionConflictError)
    expect(new UnknownSegmentError('seg-x').code).toBe('UNKNOWN_SEGMENT')
    expect(new InvalidStateTransitionError('proposal', 'accepted', 'rejected').code).toBe(
      'INVALID_STATE_TRANSITION',
    )
    expect(new InvalidIdError('bad', 'prj-<hex>').code).toBe('INVALID_ID')
  })

  test('全部错误均为 DomainError（可统一捕获）', () => {
    const errors: DomainError[] = [
      new SegmentLockedError('s'),
      new RevisionConflictError('s', 0, 1),
      new StaleProposalError('p', 's', 0, 1),
      new UnknownSegmentError('s'),
      new InvalidStateTransitionError('e', 'a', 'b'),
      new InvalidIdError('v', 'f'),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(DomainError)
      expect(err).toBeInstanceOf(Error)
      expect(typeof err.code).toBe('string')
    }
  })
})
