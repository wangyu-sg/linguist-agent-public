import * as React from 'react'
import { Copy, FolderOpen, HardDriveDownload } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { MigrationWizard } from '@/features/linguist/migration/MigrationWizard'
import { refreshLinguistProjectListAtom } from '@/features/linguist/projects/project-list-atoms'
import { copyTextToClipboard } from '@/lib/clipboard'
import { SettingsSection } from './primitives'

const ARCHIVE_MIGRATION_PROMPT = `请帮我创建一个可迁移的 Linguist Agent 数据压缩包。

Linguist Agent 的本地数据通常存放在 ~/.linguist-agent。请按以下步骤处理：

1. 先确认当前数据文件夹的位置、计划生成的 ZIP 路径，以及压缩包是否可能包含会话记录、工作区配置、CAT 项目和本地文件。
2. 在开始压缩前向我展示范围并征得确认；不要删除、移动或修改原始数据文件夹。
3. 将完整的数据文件夹压缩为一个 ZIP 文件，并告诉我生成路径和文件大小。
4. 提醒我通过可信方式把 ZIP 传到新设备，并在新设备的 Agent 对话中附上该 ZIP，执行恢复、项目路径分配和索引重建。
5. 不要尝试导出系统钥匙串、OAuth 登录或其他系统级凭据；这些内容需要在新设备上重新登录或配置。`

const RESTORE_MIGRATION_PROMPT = `我正在恢复来自另一台设备的 Linguist Agent 数据，并已附上旧设备数据文件夹的 ZIP 压缩包。

请按以下步骤处理：

1. 先检查 ZIP 内容，并说明将要写入的本机 Linguist Agent 数据目录以及可能覆盖的文件；任何覆盖前先征得我的确认，并为现有数据创建可恢复备份。
2. 将压缩包解压到本机数据目录，按当前版本的数据结构完成必要迁移。
3. 为每个恢复的工作区核对对应的本地项目目录；旧设备路径不可用时，询问我如何重新分配或跳过。
4. 重建会话、工作区和本地文件索引，检查恢复的数据是否可读。
5. 完成后说明恢复的会话、工作区、CAT 项目和需要重新绑定的本地项目；不要尝试恢复系统钥匙串、API Key 或 OAuth 登录，缺失的凭据请提示我重新配置。`

export function MigrationSettings(): React.ReactElement {
  const [legacyWizardOpen, setLegacyWizardOpen] = React.useState(false)
  const refreshLinguistProjects = useSetAtom(refreshLinguistProjectListAtom)

  const handleOpenDataFolder = async (): Promise<void> => {
    try {
      await window.electronAPI.openMigrationDataFolder()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开数据文件夹')
    }
  }

  const handleCopyPrompt = (prompt: string, successMessage: string): void => {
    void copyTextToClipboard(prompt).then(
      () => toast.success(successMessage),
      () => toast.error('复制失败，请手动复制提示词'),
    )
  }

  if (legacyWizardOpen) {
    return (
      <MigrationWizard
        onExit={(dirty) => {
          setLegacyWizardOpen(false)
          if (dirty) refreshLinguistProjects()
        }}
      />
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="旧版 Linguist 项目"
        description="从旧版 Linguist Agent 数据根扫描、预览并选择性迁移项目。"
      >
        <button
          type="button"
          onClick={() => setLegacyWizardOpen(true)}
          className="flex min-h-10 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
        >
          <HardDriveDownload size={16} />
          打开旧版项目迁移
        </button>
      </SettingsSection>

      <SettingsSection
        title="迁移原理"
        description="先压缩完整的 Linguist Agent 数据文件夹，再在新设备上恢复并重新分配本地项目路径。"
      >
        <ol className="space-y-3 text-sm leading-6 text-muted-foreground">
          {[
            '在当前设备将完整数据文件夹压缩为 ZIP，原始数据保持不变。',
            '通过可信方式把 ZIP 传到新设备，并附到 Agent 对话中。',
            '在新设备恢复数据、重新分配本地项目目录并重建索引。',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </SettingsSection>

      <SettingsSection
        title="当前设备：创建迁移压缩包"
        description="先打开数据文件夹；随后可将提示词粘贴到 Agent 对话，由 Agent 协助创建 ZIP。"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleOpenDataFolder()}
            className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FolderOpen size={16} />
            打开数据文件夹
          </button>
          <button
            type="button"
            onClick={() => handleCopyPrompt(ARCHIVE_MIGRATION_PROMPT, '创建压缩包提示词已复制')}
            className="flex min-h-10 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            <Copy size={16} />
            复制创建压缩包提示词
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="新设备：恢复 Linguist Agent 数据"
        description="在新设备的 Agent 对话中附上 ZIP，再粘贴以下提示词完成恢复。"
      >
        <div className="relative rounded-lg border border-border/60 bg-muted/30 p-4 pr-14">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground">{RESTORE_MIGRATION_PROMPT}</pre>
          <button
            type="button"
            aria-label="复制恢复数据提示词"
            title="复制恢复数据提示词"
            onClick={() => handleCopyPrompt(RESTORE_MIGRATION_PROMPT, '恢复数据提示词已复制')}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Copy size={16} />
          </button>
        </div>
      </SettingsSection>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
        数据文件夹可能包含会话、CAT 项目、文件和配置。请仅通过可信渠道传输。系统钥匙串中的 API Key 和登录凭据不会随文件夹复制。
      </div>
    </div>
  )
}
