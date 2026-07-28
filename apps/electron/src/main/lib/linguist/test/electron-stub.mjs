// Minimal 'electron' stub for node --test runs (bun has mock.module; node
// does not). Loaded via loader-hooks.mjs only when a module under test
// statically imports 'electron'. Mirrors the bun-side stub in
// lib/agent-session-manager.test.ts: packaged-mode app + plaintext safeStorage.
// No BrowserWindow behavior is provided — main-process lib modules under test
// must not create windows.
export const app = {
  isPackaged: true,
  getPath: () => process.env.HOME ?? '/tmp',
  getVersion: () => '0.0.0-test',
  setAppUserModelId: () => {},
  getLocale: () => 'zh-CN',
}
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString('utf-8'),
}
export class BrowserWindow {}
export const clipboard = {}
export const dialog = {}
export const nativeImage = { createFromPath: () => ({}) }
export const nativeTheme = {}
export const powerMonitor = {}
export const powerSaveBlocker = {}
export const screen = {}
export const shell = {}
export const ipcMain = { handle: () => {}, on: () => {} }
export const ipcRenderer = { invoke: async () => undefined, send: () => {} }
export default {
  app,
  safeStorage,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
  ipcMain,
  ipcRenderer,
}
