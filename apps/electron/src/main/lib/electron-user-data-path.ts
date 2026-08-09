import { join } from 'node:path'

/** Chromium/Electron 自身配置根；与 ~/.linguist-agent 领域数据分开管理。 */
export const LINGUIST_ELECTRON_USER_DATA_DIR = 'com.linguistagent.app'

/** 显式测试/诊断目录优先，避免 packaged smoke 落入真实 Chromium 配置。 */
export function shouldSetDefaultElectronUserDataPath(argv: readonly string[]): boolean {
  return !argv.some(
    (argument) => argument === '--user-data-dir' || argument.startsWith('--user-data-dir='),
  )
}

export function resolveElectronUserDataPath(
  appDataPath: string,
  isPackaged: boolean,
  developmentInstance?: string,
): string {
  return join(
    appDataPath,
    isPackaged
      ? LINGUIST_ELECTRON_USER_DATA_DIR
      : `${LINGUIST_ELECTRON_USER_DATA_DIR}.dev${developmentInstance ? `-${developmentInstance}` : ''}`,
  )
}
