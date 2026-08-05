# Proma v0.16.8 合并冲突与 Ownership

日期：2026-08-05

正式同步从 `sync/proma-v0.16.8` 的 `b84d65ac` 执行：

```bash
git merge --no-ff --no-commit v0.16.8
```

目标 tag 为 `bde00f00323d6735a939d14dbce3b2f1a5b672bc`，共同祖先为 `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`。Git 报告 36 个冲突；以下清单也是 subsystem ownership 记录。

| Owner | 子系统 | 冲突文件 |
|---|---|---|
| Product Docs | 产品身份与执行约束 | `AGENTS.md`、`README.md`、`README.en.md` |
| Manifests / Shared | 依赖、版本、公共类型 | `apps/electron/package.json`、`package.json`、`bun.lock`、`packages/shared/package.json`、`packages/shared/src/types/agent.ts`、`packages/shared/src/types/index.ts` |
| Main / Runtime | composition root、IPC、Session、Runtime | `apps/electron/src/main/index.ts`、`apps/electron/src/main/ipc.ts`、`apps/electron/src/main/lib/agent-orchestrator.ts`、`agent-service.ts`、`agent-session-manager.ts`、`agent-workspace-manager.ts`、`voice-dictation-window.ts`、`apps/electron/src/preload/index.ts` |
| Agent Surface | 唯一 AgentView、消息、队列、文件与语音面 | `apps/electron/src/renderer/atoms/agent-atoms.ts`、`AgentMessages.tsx`、`AgentView.tsx`、`ContentBlock.tsx`、`SidePanel.tsx`、`TaskProgressOverlay.tsx`、`speech-button.tsx`、`agent-message-queue.test.ts` |
| Shell / Settings | 三模式 Shell、Sidebar、Settings、导航 | `active-view.ts`、`AppShell.tsx`、`LeftSidebar.tsx`、`SearchDialog.tsx`、`DiffChangesList.tsx`、`GeneralSettings.tsx`、`MemorySettings.tsx`、`MigrationSettings.tsx`、`nowledge-mem-prompt.md`、`GlobalShortcuts.tsx`、`useOpenSession.ts` |

## 合并规则

- Runtime / Session 以上游 v0.16.8 为主，保留 Linguist profile、CAT tool overlay、项目 binding、独立数据根和 fail-closed authority。
- Agent Surface 保留唯一 `AgentView` 的 `full | rail` presentation，同时吸收 upstream Planning、Reference、外部 `@file`、retry、compaction、Stop、Vision/voice 反馈。
- Shell 保留 `agent | chat | linguist` 三模式和一等 Project Tab；Planning 取代旧 `automations` active view，Linguist 不复制第二套 Session tree。
- `build:resources` 继续 fail closed；lockfile 以官方 v0.16.8 为种子，由 Bun `1.3.14` 根据合并后的 manifests 重建。
- 两份用户自有 `electron-user-data-path*` 改动不属于 merge，保存在 Git stash 与校验过的外部 patch，合并提交不得吸收。

最终完成状态、merge parents 与验证结果由 `CURRENT_FACTS.md` 和 active queue 在合并提交后补录。
