# Linguist Legacy Project/CAT UI 冻结规则

> 生效工单：LF-002
> 生效条件：本文件与权威融合计划一同提交后生效。
> 适用阶段：直到 `LF-078`（Legacy UI Deletion Gate）通过。

## 目标

冻结当前旧的 Project/CAT 日常工作产品面，避免在迁移到 `Agent | Chat | Linguist` 三模式和新 Workbench 的过程中继续向旧路径堆叠功能。

冻结本身不改变用户可见行为；删除只由后续 LF 工单执行。LF-074 已删除零消费者的 `ProjectDetailPanel` 与 `ProjectChatsSection`；LF-075 已在 Bottom Dock 与 Grid 等价覆盖后删除 `CatContextRail`；LF-077 已删除 `ProjectsSidebarEntry` 日常入口，但保留 `activeView='projects'` 作为 Linguist 侧栏的次级项目管理路由。

## 受冻结的产品面

以下文件的旧产品布局和日常工作行为不得新增功能：

- `apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx`
- `apps/electron/src/renderer/features/linguist/projects/CatWorkspace.tsx`
- `apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts`

LF-074 已删除：

- `apps/electron/src/renderer/features/linguist/projects/ProjectDetailPanel.tsx`
- `apps/electron/src/renderer/features/linguist/projects/ProjectChatsSection.tsx`

下列文件仅冻结与旧 Project/CAT 日常入口相关的分支；其余 Proma 行为不受本文件限制：

- `apps/electron/src/renderer/atoms/active-view.ts` 中仅供次级管理入口使用的 `projects` 路由状态；
- `apps/electron/src/renderer/components/tabs/MainArea.tsx` 中的 `activeView === 'projects'` 全屏路由；

## 允许的 P0 例外

仅当现有功能出现下列任一问题时，才可修改受冻结范围：

1. 可能造成用户项目、Segment、Proposal、QA、导出或备份数据丢失、损坏或错写；
2. 安全边界被绕过，或项目/会话错绑造成跨项目数据暴露或修改；
3. 应用启动、打开已有项目或当前 Alpha 的既有关键编辑流程不可恢复地阻断；
4. 已有流程发生崩溃，且没有受支持的绕行方式。

每个 P0 例外必须在同一提交中包含：可复现问题、最小修复、针对回归的测试或打包验证证据，以及对本文件的引用。视觉调整、信息架构调整、更多管理卡片、更多格式入口、更多 CAT 面板、Agent 复制实现或“顺手重构”均不是 P0。

无法明确归类为 P0 的改动，一律进入后续 LF 工单的新实现路径。

## 新实现与删除门

| 冻结实现 | 后续替代实现 | 最早删除条件 |
|---|---|---|
| `activeView='projects'` 日常入口 | Linguist mode + Project Tab；原路由仅保留项目管理 | **LF-077 已退役** |
| `ProjectsSidebarEntry` 主入口 | `LinguistSidebarContent` | **LF-077 已删除** |
| `ProjectDetailPanel` 内部 Chat | 原生 Agent rail / 完整 Agent Tab | **LF-074 已删除** |
| `ProjectDetailPanel` 内部 CAT / Proposal | `LocalizationProjectWorkbench` + Grid inline diff | **LF-074 已删除** |
| `CatContextRail` | Bottom Dock + Grid inline review | **LF-075 已删除** |
| 旧 `CatWorkspace` 页面布局 | 新 Workbench / `SegmentEditor` | **LF-076 已删除；LF-048 两项手工 Gate 后补** |
| 全局 CAT UI atoms | project-scoped Workbench state | LF-040 |

删除前不得删除或替换：CAT Core、CAT Store、CAT Tools、Project Session Binding、Project Service、Revision/CAS、Proposal、QA、Evidence、Export、迁移逻辑或用户数据。

## 执行边界

- 新的产品能力只进入 LF 队列指定的 Linguist mode、Project Tab、Workbench、Bottom Dock 或原生 Agent 扩展点；
- 不复制 Proma 的 AgentView、消息、Thinking、Composer、Tool、Approval、Queue/Steer 或会话存储；
- 受冻结路径的 P0 修复仍遵守 `PROMA_CORE_TOUCHPOINTS.md`、单一实现、CAS/locked/Tag/QA hard rails 和禁止静默降级规则；
- 本规则不冻结完整 Proma Agent、Chat、Automations、Bots、Skills、MCP、Preview、Scratch 或 Provider 配置。

## 权威计划文件的版本控制决定

`docs/roadmap/LINGUIST_MODE_AND_CAT_WORKBENCH_IMPLEMENTATION_PLAN_CN.md` 在 LF-002 开始前是未跟踪文件，但它已经被 LF-000 事实报告、队列和本冻结规则作为权威来源引用。本票将其原样纳入版本控制：否则新克隆、历史审计和 `LF-078` 删除门都无法取得同一份规则来源。

纳入计划文件只记录用户已提供的规格，不代表对其产品决定作额外改写；若提交前其内容发生变化，应先重新审阅差异，而不是静默一并提交。
