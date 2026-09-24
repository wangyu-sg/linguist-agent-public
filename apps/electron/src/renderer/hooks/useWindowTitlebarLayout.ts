import * as React from 'react'
import { detectIsMac, detectIsWindows } from '@/lib/platform'
import { getSidebarTitlebarLayout } from '@/lib/window-titlebar-layout'

/** 读取侧栏动画中的实际宽度；页面缩放时同步坐标，不使用包含 DPI 的 devicePixelRatio。 */
export function useWindowTitlebarLayout(shellRef: React.RefObject<HTMLDivElement>, sidebarRef: React.RefObject<HTMLDivElement>): void {
  React.useLayoutEffect(() => {
    const shell = shellRef.current!
    let previousZoom: number
    const update = (): void => {
      const zoomFactor = window.electronAPI.getWindowZoomFactor()
      if (detectIsMac() && zoomFactor !== previousZoom) {
        void window.electronAPI.syncWindowTitlebar()
        previousZoom = zoomFactor
      }
      const layout = getSidebarTitlebarLayout({
        isMac: detectIsMac(),
        isWindows: detectIsWindows(),
        zoomFactor,
        sidebarOccupiedWidth: sidebarRef.current!.getBoundingClientRect().width,
      })
      shell.style.setProperty('--titlebar-controls-left', `${layout.controlsLeft}px`)
      shell.style.setProperty('--titlebar-controls-top', `${layout.controlsTop}px`)
      shell.style.setProperty('--titlebar-controls-end', `${layout.controlsEnd}px`)
      shell.style.setProperty('--app-titlebar-height', `${layout.titlebarHeight}px`)
      shell.style.setProperty('--sidebar-top-inset', `${layout.sidebarTopInset}px`)
      shell.style.setProperty('--main-titlebar-leading-inset', `${layout.mainLeadingInset}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(sidebarRef.current!)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [shellRef, sidebarRef])
}
