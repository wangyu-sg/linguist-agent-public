import { join } from 'node:path'

interface ElectronMockState {
  encryptionAvailable: boolean
  safeStorageAvailabilityChecks: number
  safeStorageEncryptCalls: number
  safeStorageDecryptCalls: number
  safeStorageDecryptErrorAtCall: number | null
}

const state: ElectronMockState = {
  encryptionAvailable: false,
  safeStorageAvailabilityChecks: 0,
  safeStorageEncryptCalls: 0,
  safeStorageDecryptCalls: 0,
  safeStorageDecryptErrorAtCall: null,
}

/**
 * Bun 的 module mock 在同一测试进程内共享；所有主进程测试必须复用同一导出面，
 * 避免先加载的测试让后续动态 import 缺少 Electron named export。
 */
export const electronMock = {
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? '/tmp', 'Library', 'Application Support'),
  },
  BrowserWindow: class {},
  MessageChannelMain: class {},
  WebContentsView: class {},
  clipboard: {},
  dialog: {},
  net: { fetch },
  nativeImage: { createFromPath: () => ({}) },
  nativeTheme: {},
  powerMonitor: {},
  powerSaveBlocker: {},
  screen: {},
  shell: {
    openExternal: async () => undefined,
  },
  safeStorage: {
    isEncryptionAvailable: () => {
      state.safeStorageAvailabilityChecks += 1
      return state.encryptionAvailable
    },
    encryptString: (value: string) => {
      state.safeStorageEncryptCalls += 1
      return Buffer.from(value)
    },
    decryptString: (value: Buffer) => {
      state.safeStorageDecryptCalls += 1
      if (state.safeStorageDecryptCalls === state.safeStorageDecryptErrorAtCall) {
        throw new Error('mock decrypt failed')
      }
      return value.toString('utf-8')
    },
  },
  session: {
    fromPartition: () => ({}),
  },
  utilityProcess: {
    fork: () => {
      throw new Error('utilityProcess is unavailable in this unit-test mock')
    },
  },
}

export function resetElectronMock(encryptionAvailable = false): void {
  state.encryptionAvailable = encryptionAvailable
  state.safeStorageAvailabilityChecks = 0
  state.safeStorageEncryptCalls = 0
  state.safeStorageDecryptCalls = 0
  state.safeStorageDecryptErrorAtCall = null
}

export function getSafeStorageAvailabilityChecks(): number {
  return state.safeStorageAvailabilityChecks
}

export function getSafeStorageEncryptCalls(): number {
  return state.safeStorageEncryptCalls
}

export function getSafeStorageDecryptCalls(): number {
  return state.safeStorageDecryptCalls
}

export function setSafeStorageDecryptErrorAtCall(call: number): void {
  state.safeStorageDecryptErrorAtCall = call
}
