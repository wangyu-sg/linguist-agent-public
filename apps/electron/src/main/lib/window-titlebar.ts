import type { BrowserWindow } from 'electron'
import { getMacTitlebarLayout, IPC_CHANNELS } from '@proma/shared'

/** 绑定主窗口的缩放通知；坐标仅由主进程读取的缩放比例计算。 */
export function installMacWindowTitlebar(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  const sync = (): void => {
    win.setWindowButtonPosition(getMacTitlebarLayout(win.webContents.getZoomFactor()).buttonPosition)
  }
  win.webContents.ipc.handle(IPC_CHANNELS.WINDOW_SYNC_TITLEBAR, sync)
  win.webContents.on('did-finish-load', sync)
  win.on('leave-full-screen', sync)
}
