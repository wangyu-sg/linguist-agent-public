import { expect, test } from 'bun:test'
import { AGENT_RUNTIME_METHODS } from '@proma/shared'
import { getParentRequestTimeoutMs, ASK_USER_QUESTION_TIMEOUT_MS } from './agent-runtime-request-timeout'

const wait = (timeoutSeconds?: unknown) => ({
  toolName: 'mcp__collaboration__wait_for_delegations',
  input: { timeoutSeconds },
})

test('协作等待的 RPC 预算覆盖业务期限，其他工具保留原预算', () => {
  const customTool = AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL
  expect(getParentRequestTimeoutMs(customTool, wait(120))).toBe(125_000)
  expect(getParentRequestTimeoutMs(customTool, wait(121))).toBe(126_000)
  expect(getParentRequestTimeoutMs(customTool, wait())).toBe(3_605_000)
  expect(getParentRequestTimeoutMs(customTool, wait(7_200))).toBe(7_205_000)
  expect(getParentRequestTimeoutMs(customTool, { toolName: 'mcp__collaboration__continue_delegation' })).toBe(3_605_000)
  expect(getParentRequestTimeoutMs(customTool, { toolName: 'mcp__browser__observe' })).toBe(120_000)
  expect(getParentRequestTimeoutMs(AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL, { toolName: 'AskUserQuestion' })).toBe(ASK_USER_QUESTION_TIMEOUT_MS)
})

test('协作等待拒绝无效期限，不产生失控计时器', () => {
  const method = AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 7_201, '120']) {
    expect(() => getParentRequestTimeoutMs(method, wait(value))).toThrow('timeoutSeconds')
  }
})
