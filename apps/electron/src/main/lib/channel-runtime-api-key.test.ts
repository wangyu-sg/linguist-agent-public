import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@proma/shared'
import {
  electronMock,
  getSafeStorageAvailabilityChecks,
  getSafeStorageDecryptCalls,
  getSafeStorageEncryptCalls,
  resetElectronMock,
  setSafeStorageDecryptErrorAtCall,
} from './test/electron-mock'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalSmokePlaintextCredentials = process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS

mock.module('electron', () => electronMock)

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.linguist-agent')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

function writePromaChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.proma')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

function writePromaDevChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.proma-dev')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-runtime-key-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '1'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
  rmSync(join(tempHome, '.proma-dev'), { recursive: true, force: true })
  rmSync(join(tempHome, '.linguist-agent'), { recursive: true, force: true })
  resetElectronMock(true)
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  if (originalSmokePlaintextCredentials === undefined) {
    delete process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS
  } else {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = originalSmokePlaintextCredentials
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('渠道运行时认证解析', () => {
  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })

  test('Given 打包烟测环境 When 创建渠道 Then 不访问 Keychain', () => {
    const channel = channelManager.createChannel({
      name: 'Smoke',
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'smoke-api-key',
      models: [],
      enabled: true,
    })

    expect(channel.apiKey).toBe('smoke-api-key')
    expect(getSafeStorageAvailabilityChecks()).toBe(0)
  })

  test('Given 打包烟测明文凭据模式 When 导入 Proma Provider Then 拒绝复制密文', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '1'
    writePromaChannels([])

    expect(() => channelManager.importPromaProviderConfigs()).toThrow('打包烟测明文凭据模式不允许导入')
    expect(existsSync(join(tempHome, '.linguist-agent', 'channels.json'))).toBe(false)
  })

  test('Given Proma Provider 配置 When 显式导入 Then 只迁移 Provider 并重新加密密钥', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    writePromaChannels([
      {
        id: 'legacy-openai',
        name: '旧 OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: Buffer.from('legacy-secret').toString('base64'),
        models: [{ id: 'gpt-test', name: 'GPT Test', enabled: true }],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    writeFileSync(join(tempHome, '.proma', 'settings.json'), '{"themeMode":"dark"}', 'utf-8')
    writeFileSync(join(tempHome, '.proma', 'agent-sessions.json'), '{"sessions":[{"id":"legacy"}]}', 'utf-8')

    const result = channelManager.importPromaProviderConfigs()

    expect(result).toEqual({ importedCount: 1, skippedCount: 0 })
    expect(getSafeStorageDecryptCalls()).toBe(1)
    expect(getSafeStorageEncryptCalls()).toBe(1)
    expect(channelManager.decryptApiKey('legacy-openai')).toBe('legacy-secret')
    expect(existsSync(join(tempHome, '.linguist-agent', 'settings.json'))).toBe(false)
    expect(existsSync(join(tempHome, '.linguist-agent', 'agent-sessions.json'))).toBe(false)
  })

  test('Given 当前已有 Provider When 导入发生冲突 Then 确定性跳过且不覆盖', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    writeChannels([
      {
        id: 'current-provider',
        name: '当前 OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: Buffer.from('current-secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 10,
        updatedAt: 20,
      },
    ])
    writePromaChannels([
      {
        id: 'current-provider',
        name: '不得覆盖',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: Buffer.from('wrong-secret').toString('base64'),
        models: [],
        enabled: false,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'same-connection',
        name: ' 当前 OpenAI ',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1/',
        apiKey: Buffer.from('duplicate-secret').toString('base64'),
        models: [],
        enabled: false,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'new-provider',
        name: '新增 Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: Buffer.from('new-secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    expect(channelManager.importPromaProviderConfigs()).toEqual({
      importedCount: 2,
      skippedCount: 1,
    })
    expect(channelManager.getChannelById('current-provider')?.name).toBe('当前 OpenAI')
    expect(channelManager.decryptApiKey('current-provider')).toBe('current-secret')
    expect(channelManager.decryptApiKey('same-connection')).toBe('duplicate-secret')
    expect(channelManager.decryptApiKey('new-provider')).toBe('new-secret')
  })

  test('Given Proma 密钥无法解密 When 导入 Then 显式失败且不写入部分结果', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    const currentDir = join(tempHome, '.linguist-agent')
    const currentPath = join(currentDir, 'channels.json')
    const legacyTarget = '{"version":1,"channels":[]}'
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(currentPath, legacyTarget, 'utf-8')
    writePromaChannels([
      {
        id: 'would-import-first',
        name: '前置有效配置',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: Buffer.from('valid-secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'undecryptable-provider',
        name: '无法解密',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'invalid-ciphertext',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    setSafeStorageDecryptErrorAtCall(2)

    expect(() => channelManager.importPromaProviderConfigs()).toThrow('解密 API Key 失败')
    expect(readFileSync(currentPath, 'utf-8')).toBe(legacyTarget)
    expect(channelManager.getChannelById('would-import-first')).toBeUndefined()
    expect(channelManager.getChannelById('undecryptable-provider')).toBeUndefined()
  })

  test('Given 当前模式的 Proma 配置不存在 When 另一模式存在 Then 使用确定性后备路径', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    writePromaDevChannels([
      {
        id: 'dev-provider',
        name: 'Proma Dev Provider',
        provider: 'openai',
        baseUrl: 'https://dev.example.test/v1',
        apiKey: Buffer.from('dev-secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    expect(channelManager.importPromaProviderConfigs()).toEqual({
      importedCount: 1,
      skippedCount: 0,
    })
    expect(channelManager.decryptApiKey('dev-provider')).toBe('dev-secret')
  })

  test('Given 当前 Provider 配置损坏 When 导入 Then fail-closed 且保留原文件', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    const currentDir = join(tempHome, '.linguist-agent')
    const currentPath = join(currentDir, 'channels.json')
    const broken = '{"version":2,"channels":"broken"}'
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(currentPath, broken, 'utf-8')
    writePromaChannels([
      {
        id: 'must-not-import',
        name: '不得写入',
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        apiKey: Buffer.from('secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    expect(() => channelManager.importPromaProviderConfigs()).toThrow('当前 Provider 配置损坏，已取消导入')
    expect(readFileSync(currentPath, 'utf-8')).toBe(broken)
  })

  test('Given 系统安全存储不可用 When 导入 Then 拒绝复制未解密密文', () => {
    process.env.LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS = '0'
    resetElectronMock(false)
    writePromaChannels([
      {
        id: 'encrypted-provider',
        name: 'Encrypted',
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        apiKey: Buffer.from('secret').toString('base64'),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    expect(() => channelManager.importPromaProviderConfigs()).toThrow('系统安全存储不可用')
    expect(existsSync(join(tempHome, '.linguist-agent', 'channels.json'))).toBe(false)
  })
})
