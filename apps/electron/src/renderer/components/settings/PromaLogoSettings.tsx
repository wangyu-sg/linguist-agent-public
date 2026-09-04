import type * as React from 'react'
import { toast } from 'sonner'
import { SettingsSection } from './primitives'
import linguistIcon from '../../../../resources/icon.png'

/** 机器人头像使用与应用相同的 LA 产品图标。 */
export function PromaLogoSettings(): React.ReactElement {
  const download = async (): Promise<void> => {
    try {
      if (await window.electronAPI.saveResourceFileAs('icon.png', 'Linguist-Agent.png')) toast.success('图标已保存')
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return (
    <SettingsSection title="品牌 Logo" description="下载 Linguist Agent 图标用作机器人头像">
      <button type="button" onClick={() => void download()} className="inline-flex flex-col items-center gap-3 rounded-lg border border-border p-4 focus-visible:ring-2 focus-visible:ring-ring">
        <img src={linguistIcon} alt="Linguist Agent" className="size-32" />
        <span className="text-sm">下载 PNG 图标</span>
      </button>
    </SettingsSection>
  )
}
