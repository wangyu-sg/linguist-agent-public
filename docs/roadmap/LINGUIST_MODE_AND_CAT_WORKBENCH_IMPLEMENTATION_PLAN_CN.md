# Linguist Agent 三模式融合与 CAT Workbench 产品化实施计划

> **版本**：1.0
> **编制日期**：2026-07-27
> **实施起点**：`wangyu-sg/linguist-agent-public` 初次候选提交 `185eb16`。该
> 提交只用于说明本计划的历史差异基线；当前公开分支坐标见
> `docs/release/PUBLIC_MIRROR_MANIFEST.md`。
> **上游基线**：Proma `702a822`
> **适用工作仓库**：以私有最新工作仓库为准；开始实施前必须记录实际 HEAD 与本基线差异
> **产品阶段**：个人日用 Alpha，不面向公众发布
> **实施方式**：一个可执行工单一个提交；禁止整份计划一次性“大爆炸式”实施

---

# 0. 执行摘要

本计划正式确定 Linguist Agent 的产品路线：

```text
Agent | Chat | Linguist
```

其中：

- **Agent**：完整保留 Proma 原生通用 Agent。
- **Chat**：完整保留 Proma 原生普通对话。
- **Linguist**：新增的专业本地化工作模式。

Linguist 模式不是第三套 Agent Runtime，也不是独立的聊天产品。它是：

```text
Proma 原生 Agent 产品能力
+
Linguist Agent 专业 CAT Workbench
+
一层很薄、可审计的 CAT ↔ Agent 上下文桥
```

最终界面应形成：

```text
┌────────────────────────────────────────────────────────────────────┐
│ [Agent] [Chat] [Linguist]                         全局搜索 / 控制    │
├──────────────┬────────────────────────────────────┬────────────────┤
│ Linguist     │ CAT Workbench                      │ Proma Agent    │
│ 项目/文件     │ 双语 Segment Grid                  │ 原生消息流      │
│ 最近项目      │ 手工编辑、状态、QA、Proposal        │ 原生 Thinking   │
│ 项目会话      │                                    │ 原生 Tool Cards │
│              │                                    │ 原生 Composer   │
├──────────────┴────────────────────────────────────┴────────────────┤
│ TM │ 术语 │ QA │ 上下文/证据 │ 预览        可调整高度 Bottom Dock   │
├────────────────────────────────────────────────────────────────────┤
│ 已确认 / 总数 · 字数 · 草稿 · 当前段 · 快捷键                      │
└────────────────────────────────────────────────────────────────────┘
```

核心产品原则：

> **Agent 是 CAT 的副驾驶，不是进入 CAT 的大门。**

用户不打开 Agent，也必须能像使用传统 CAT 一样完成：

```text
导入 → 浏览 → 手工翻译 → TM/术语 → QA → 确认 → 导出
```

打开 Agent 后，Proma 原生 Agent 自动获得当前项目、文件、活动 Segment、已选 Segment 和 QA 上下文，并通过现有 CAT Tools 产生 Proposal；Proposal 在 CAT Grid 中显示、接受或拒绝，而不是让模型直接覆盖译文。

---

# 1. 本计划的权威范围

## 1.1 本计划替代什么

本计划替代当前候选中以下产品与前端方向：

1. 将 Localization Project 作为独立 `activeView="projects"` 全屏页面的方式。
2. 在 `ProjectDetailPanel` 内使用 `Chat / 建议 / CAT / QA / Artifacts / Files` 内部标签承载日常工作。
3. 默认先进入项目 Dashboard，再进入 CAT 的路径。
4. CAT 与项目 Chat 互斥、打开项目 Chat 会离开 CAT 的交互。
5. `CatContextRail` 作为 CAT 唯一上下文区的布局。
6. 为 Linguist 单独重写 Agent Rail、Composer、Thinking、工具卡或审批卡的任何方案。
7. 在当前 `CatWorkspace.tsx` 上继续堆放 Reference Manager、Style Guide、Voice Profile、Context Docs、QA 和更多管理卡片的增量打补丁路线。

## 1.2 本计划不替代什么

以下内容继续由《Linguist Agent 个人日用 Alpha 收口计划》约束：

- 日常 CI 和 Release Workflow 修正。
- Bun / Action /依赖固定。
- 产品身份与数据根迁移。
- Provider 一次性迁移。
- Electron 安全配置。
- Project Session fail-closed 与永久解绑。
- 导出不得覆盖原稿或受管数据。
- G10 长线程、性能和 Axe 收口。
- G8 真实游戏文本盲评。
- 14 天自由日用与功能冻结。

本计划只是把原计划中缺失的“Proma 与 LA 产品融合”和“真正可工作的 CAT Workbench”补全，并调整执行顺序。

## 1.3 冲突优先级

若文档冲突，执行优先级为：

```text
当前私有工作仓库实际代码和测试
>
本计划明确规定的产品融合与 CAT Workbench 事项
>
个人日用 Alpha 收口计划的工程/安全/G8/G10/日用事项
>
当前公开候选的历史执行报告
>
旧 LA 平台蓝图与旧仓文档
```

## 1.4 私人研究规格

`THREE_APPS_PIXEL_SPEC.md` 可以作为私有施工研究输入，用于理解：

- Proma 的原生组件、状态和桌面产品结构；
- Codex 的 Agent 交互与信息密度；
- OpenWorker 的简洁布局；
- 传统 CAT 的生产工作形态。

但最终公开镜像必须删除私人逆向材料、原始品牌资产、原始文案导出、反编译路径和其他敏感研究内容。

---

# 2. 当前代码事实

实施模型不得把下面内容当成“设计建议”，而应先在当前私有 HEAD 上逐项核对。

## 2.1 当前模式只有 Agent 与 Chat

当前：

```ts
export type AppMode = 'chat' | 'agent' | 'scratch'
```

`ModeSwitcher.tsx` 只注册：

```text
Agent
Chat
```

滑块宽度按两个模式硬编码为 `calc(50% - ...)`。

目标：

```ts
export type PrimaryAppMode = 'agent' | 'chat' | 'linguist'
```

`Scratch` 保留为 Tab/工具面，不再作为用户主模式。

## 2.2 当前 Localization Project 绕开 Tab 系统

当前：

```text
LeftSidebar 点击项目
→ activeView = "projects"
→ MainArea 直接渲染 ProjectsView
→ TabBar / TabContent 被替换
```

目标：

```text
ProjectsView 只负责项目列表与管理
→ 打开项目
→ 创建/聚焦 LocalizationProjectTab
→ MainArea 仍然使用 Proma TabBar + TabContent
```

## 2.3 当前 Tab 数据模型假设所有 Tab 都有 sessionId

当前 `TabItem`：

```ts
interface TabItem {
  id: string;
  type: TabType;
  sessionId: string;
  title: string;
}
```

目标必须改为判别联合：

```ts
type TabItem =
  | SessionTab
  | PreviewTab
  | ScratchTab
  | TutorialTab
  | LocalizationProjectTab;
```

Localization Project Tab 不得伪造一个 Agent `sessionId` 充当 Project ID。

## 2.4 当前项目详情默认不是编辑器

当前 `ProjectDetailPanel` 内部拥有：

```text
Chat
建议
CAT
QA
Artifacts
Files
```

目标：

- 项目日常入口直接是 Editor。
- 项目管理、备份、健康、资源配置进入项目设置。
- 项目 Agent 作为 Workbench 右栏或完整 Agent Tab。
- Proposal、QA、Artifact 通过 Grid、Bottom Dock、Agent Activity 和项目设置被发现，不再形成一套内部导航系统。

## 2.5 当前 CAT 是功能演示形态

当前 `CatWorkspace.tsx`：

- 约 780 行；
- 每页 200；
- 固定行高 88；
- Grid 高度固定 430px；
- Reference Manager、Style Guide、Voice Profile、Context Docs 堆在 Grid 上方；
- `CatContextRail` 另起一套右栏；
- TM 只展示，没有 Replace/Insert 工作动作；
- Workbench 状态是全局 Atom，不按 Project 隔离。

已有正确资产必须保留：

- 分页和 TanStack Virtual；
- Segment 查询；
- `expectedRevision` CAS；
- locked row；
- Tag/Placeholder；
- Selection；
- QA 跳转；
- Proposal 接受/拒绝；
- typed IPC；
- CAT Core / Store / Tools hard rails。

## 2.6 当前项目对话会离开项目页面

当前 `ProjectChatsSection`：

```text
点击项目对话
→ useOpenSession('agent')
→ appMode='agent'
→ activeView='conversations'
```

目标：

- Workbench 右栏显示同一个项目绑定 Agent Session；
- 项目会话可从 Linguist Sidebar 切换；
- “在完整标签页打开”时再进入原生 Agent Tab；
- Workbench 仍然保留并可恢复。

## 2.7 Proma 原生 AgentView 已经具备所需能力

当前 `AgentView.tsx` 已经负责：

- Pi Agent Session；
- 流式消息；
- Thinking；
- 工具活动；
- Markdown；
- Composer；
- 模型选择；
- Runtime 切换；
- 权限；
- Queue / Steer；
- 附件；
- Compaction；
- Retry / Recovery；
- Context Usage；
- 语音等 Proma 原生能力。

禁止为 Linguist 复制这些行为。

## 2.8 项目 Session Binding 与 CAT Tools 已经存在

已有项目 Session Binding：

```text
Agent Session
→ frozen Linguist project binding
→ CAT Tools resolve bound Project
```

已有 CAT Tools 遵守：

- Project ID 不来自模型输入；
- Agent 只创建 Proposal；
- Agent 不直接 Commit Segment；
- QA/Critic/Consistency 也不能绕过人工接受；
- 结果不暴露绝对路径。

本计划只建立 UI 和上下文桥，不重写这些安全规则。

---

# 3. 最终产品心智模型

用户只需要理解三个模式：

## 3.1 Agent

完整 Proma 通用 Agent，原行为保持：

- Agent Session；
- Tools；
- Skills；
- MCP；
- Queue / Steer；
- Thinking；
- Plan；
- Attachments；
- Automations；
- Bots；
- Preview；
- Scratch；
- 其他已有能力。

## 3.2 Chat

完整 Proma 普通 Chat，原行为保持。

## 3.3 Linguist

专业本地化模式：

- 本地化项目；
- 项目文件/批次；
- CAT Segment Grid；
- TM / TB / Glossary；
- Style Guide / Voice / Context；
- Proposal；
- Deterministic QA；
- Review；
- Export；
- Proma 原生 Agent 副驾驶。

Linguist 是产品模式，不是：

- 新 Agent Runtime；
- 新消息系统；
- 新 Session Store；
- 新 Composer；
- 新权限模型；
- 新模型选择器；
- 新 Thinking Renderer。

---

# 4. 目标信息架构

## 4.1 顶部模式切换

当前：

```text
Agent | Chat
```

目标：

```text
Agent | Chat | Linguist
```

用户标签固定为 `Linguist`，辅助 Tooltip 可为“本地化模式”。

模式切换必须：

- 不破坏 Agent / Chat 的最后会话恢复；
- Linguist 恢复上次项目 Tab；
- 无项目时显示 Linguist 项目空态；
- 不将 Scratch 作为第三/第四主模式；
- 在折叠侧栏中也有第三个 icon-only 按钮。

## 4.2 Linguist Sidebar

建议结构：

```text
+ 新建本地化项目

本地化项目
  完美诸神 0626
    当前项目会话 A
    术语审查
  GTE Localize
  NBA 项目

最近打开
  Chapter 3
  Event Text

底部保留 Proma 全局能力入口
  Automations
  Bots
  Skills
  Settings
```

规则：

- 单击项目：直接打开 Editor。
- 单击项目会话：打开该项目 Editor，并在右栏选择对应 Session；不得离开 Linguist。
- 项目行 `+`：创建项目绑定 Agent Session，然后在右栏打开。
- 项目菜单：项目设置、导入、备份、归档、删除。
- Projects 管理首页保留，但不是日常编辑入口。
- Agent / Chat 的侧栏内容不得因此改变。

## 4.3 Localization Project Tab

新增真正的项目 Tab：

```ts
interface LocalizationProjectTab {
  id: `linguist-project:${string}`;
  type: 'linguist-project';
  projectId: string;
  title: string;
}
```

Tab 必须：

- 使用 Proma 原生 TabBar；
- 可与 Agent、Chat、Scratch、Preview 并列；
- 关闭不删除项目；
- 再开恢复上次编辑位置；
- 可显示绑定 Agent Session 的 running/completed 指示；
- 不伪造 Session ID；
- 持久化时能从已删除/归档 Project 安全恢复为 repair state。

## 4.4 项目管理与日常编辑分离

`ProjectsView` 最终只负责：

- 项目列表；
- 新建项目；
- 导入项目；
- 健康状态；
- 归档/恢复；
- 项目设置入口。

`LocalizationProjectTab` 负责日常工作。

---

# 5. 目标 CAT Workbench

## 5.1 总体布局

```text
┌───────────────────────────────────────────────────────────────────┐
│ 项目名  源语言→目标语言  进度  保存状态        [Agent] [项目设置]  │
│ 文件/批次  搜索  状态筛选  QA筛选        [编辑] [确认并前进]       │
├─────────────┬──────────────────────────────────┬──────────────────┤
│ Asset       │ Segment Grid                     │ Native Agent     │
│ Navigator   │                                  │ Workspace rail   │
│             │ ID | Source | Target | Status QA │                  │
│ 可折叠       │                                  │ 可折叠/可调整宽度  │
├─────────────┴──────────────────────────────────┴──────────────────┤
│ TM 匹配 | 术语 | QA | 上下文/证据 | 预览              Bottom Dock │
├───────────────────────────────────────────────────────────────────┤
│ 已确认/总数 · 字数 · 草稿 · 当前段 · 快捷键                      │
└───────────────────────────────────────────────────────────────────┘
```

## 5.2 Workbench Toolbar

必须显示：

- Project 名；
- Locale pair；
- 当前 Asset/Batch；
- `confirmed / total`；
- 保存状态；
- 搜索；
- Segment 状态筛选；
- QA 筛选；
- 编辑状态；
- 确认并前进；
- Agent Rail 开关；
- Project Settings。

不应显示：

- 备份管理的完整 UI；
- TM/TB 数据库导入管理表；
- Style Guide 全文编辑器；
- Voice Profiles 管理表；
- Context Documents 管理表；
- Project Health 详细卡；
- 大块项目 Dashboard 数据。

## 5.3 Asset Navigator

职责：

- 文件/批次树；
- 每个 Asset 的 Segment 计数和进度；
- QA 数量；
- 当前选中；
- 搜索/折叠；
- 宽度可调整、可折叠；
- 切换 Asset 不丢该 Asset 的 last active segment。

不承担：

- 文件导入设置；
- 原始路径展示；
- 备份和健康修复；
- CAT 数据写入真相。

## 5.4 Segment Grid

最少列：

```text
选择 | ID | Source | Target | Status | QA
```

必须支持：

- 10k Segment 虚拟化；
- 分页加载；
- Source/Target Tag Chip；
- locked Segment；
- active row；
- multi-selection；
- Proposal indicator；
- QA indicator；
- Revision/CAS；
- status；
- 双击/Enter 编辑；
- `Cmd/Ctrl+Enter` 确认并前进；
- `Esc` 放弃当前编辑；
- `ArrowUp/ArrowDown` 切行；
- IME composition 期间不提交；
- 粘贴与 Tag/Placeholder 保护；
- Active row 可扩展显示长文本；
- 非活动行在保证信息密度的前提下限制高度。

建议使用 TanStack Virtual 的测量能力，或“稳定基础行高 + active row 展开”方案；不得继续固定所有行 88px 且只显示两行。

## 5.5 Target Editor

Target Editor 必须是可独立测试的组件，负责：

- 文本编辑；
- Tag/Placeholder Chip；
- Cursor/selection；
- Undo/Redo；
- IME；
- Replace/Insert；
- Dirty state；
- Save/Cancel；
- locked/read-only；
- CAS conflict。

不得将业务真相只保存在编辑器内部。

## 5.6 Bottom Dock

Tabs：

```text
TM 匹配
术语
QA
上下文/证据
预览
```

要求：

- 可拖动高度；
- 可折叠；
- 高度和当前 Tab 按 Project 持久化；
- 随 Active Segment 更新；
- 键盘可进入；
- 不遮挡当前编辑；
- 窄窗口可切换为 overlay/sheet。

### TM Tab

每条显示：

- 匹配百分比；
- 来源（Project/Client/Imported）；
- Source；
- Target；
- exact/fuzzy 类型；
- `替换`；
- `插入`。

行为：

- Replace：替换整个 Target 草稿；不直接持久化，仍需保存/确认。
- Insert：插入 Target Editor 当前光标；无焦点时追加到末尾或明确禁用。
- locked Segment 禁用。
- 操作必须遵守 Tag/Placeholder 规则。

### Terms Tab

每条显示：

- Source term；
- Target term；
- status/priority；
- note；
- `插入`。

### QA Tab

- 只显示当前 Segment 的 Finding；
- 支持跳转、定位、标记处理；
- 项目级 QA 浏览通过筛选或专门面板完成；
- 不允许每行显示同一个项目级 QA 总数作为该 Segment 状态。

### Context/Evidence Tab

- Style/Voice/Context/TM 来源摘要；
- Evidence provenance；
- 可跳转来源；
- Agent proposal evidence；
- 不提供项目资源的全量管理 UI。

### Preview Tab

- 导出预览或格式相关预览；
- 只读；
- 与项目原稿隔离。

## 5.7 Workbench Status Bar

必须显示：

- 已确认 / 总数；
- Source/Target 字数；
- 草稿数；
- 当前 Asset；
- 当前 Segment；
- Tag/QA 简要计数；
- 主要快捷键提示。

---

# 6. 原生 Proma Agent 复用合同

## 6.1 绝对禁止重做的组件

不得新建或保留以下第二套组件：

```text
LinguistAgentRail
LinguistAgentView
LinguistComposer
LinguistConversation
LinguistAgentMessages
LinguistThinkingBlock
LinguistToolCard
LinguistApprovalCard
LinguistModelPicker
LinguistPermissionPicker
LinguistQueue
LinguistSteer
```

若现有代码中已经出现等价重复实现，应在新 Workbench 验证后删除。

## 6.2 允许的改造方式

优先为 Proma 原生 `AgentView` 增加表示层参数：

```ts
interface AgentViewProps {
  sessionId: string;
  presentation?: 'full' | 'rail';
  headerActions?: React.ReactNode;
  contextSummary?: readonly ComposerContextChip[];
  onOpenFullView?: () => void;
}
```

要求：

- `presentation='full'` 与当前 Agent 模式视觉和行为完全一致；
- `presentation='rail'` 只改变布局密度、宽度、Header 和部分标签显示；
- 同一 Session Store；
- 同一 Streaming；
- 同一 Message Renderer；
- 同一 Thinking；
- 同一 Tool Activity；
- 同一 Composer；
- 同一 Queue/Steer；
- 同一 Approval；
- 同一 Model/Runtime/Permission；
- 同一错误恢复。

若 `AgentView.tsx` 因体积无法安全嵌入，可提取一个共享内部组件：

```text
AgentWorkspaceCore
├─ AgentHeader
├─ AgentMessages
└─ AgentComposer
```

但 Agent 模式和 Linguist 模式必须同时切换到该共享实现；禁止复制一份再修改。

## 6.3 Rail 布局规则

推荐宽度：

```text
默认 420px
最小 340px
最大 600px
```

要求：

- 可调整；
- 可折叠；
- 项目级持久化；
- 小窗口自动变为 Sheet/overlay；
- 可“在完整 Agent Tab 中打开”；
- 关闭 Rail 不停止 Session；
- Session running 时 Tab/Sidebar 有状态指示。

---

# 7. Linguist Context Bridge

## 7.1 目的

只解决一件事：

> 在不新建消息系统和不扩大权限的前提下，让 Proma Agent 明确知道当前用户正在处理哪个项目、哪个文件、哪个 Segment、选择了哪些 Segment、正在查看哪个 QA Finding。

## 7.2 结构化上下文

新增共享类型：

```ts
interface LinguistTurnContextV1 {
  schemaVersion: 1;
  projectId: string;
  assetId?: string;
  activeSegmentId?: string;
  selectedSegmentIds: string[];
  activeQaFindingId?: string;
  capturedAt: string;
  uiRevision: number;
}
```

限制：

- 只包含 opaque ID；
- 不包含绝对路径；
- 不包含整段项目文本；
- `selectedSegmentIds` 有明确上限；
- 发送时创建不可变快照；
- Project ID 必须与 Session Binding 一致；
- 不允许 Renderer 通过 Context 切换 Session 的 Project Binding。

## 7.3 Composer Context Chip

原生 Proma Composer 上方显示：

```text
[完美诸神] [活动公告] [段 001] [已选 12 段]
```

Chip 是 UI 提示，不是权限授权。

支持：

- 清除 Segment selection context；
- 保留 Project binding；
- Tooltip 显示 scope；
- 窄 Rail 自动折叠成摘要。

## 7.4 发送链路

建议扩展当前发送 API，而不是把隐藏上下文拼进用户文本：

```ts
sendAgentMessage({
  sessionId,
  content,
  attachments,
  linguistContext,
})
```

Main Process 必须：

1. 验证 Session 存在；
2. 验证 Session Binding 的 Project ID；
3. 验证 `linguistContext.projectId` 一致；
4. 验证所有 Segment 属于绑定项目；
5. 截断超出上限的 selection；
6. 将 Context 作为 Host-owned structured context 提供给 Agent/Tools；
7. 不把 Context 伪装成用户自然语言；
8. 不改变 Tool 的 Project authority。

## 7.5 Project Mutation Event

Agent CAT Tools 在 Main/Service 中修改 Proposal、QA、Artifact 等项目状态后，Renderer 必须收到窄事件：

```ts
interface LinguistProjectMutationEvent {
  projectId: string;
  revision: number;
  kind:
    | 'proposal-created'
    | 'proposal-reviewed'
    | 'segment-updated'
    | 'qa-updated'
    | 'asset-updated'
    | 'project-updated';
  segmentIds?: string[];
  proposalIds?: string[];
  qaFindingIds?: string[];
}
```

Workbench 根据事件：

- 只刷新命中的页/行；
- 更新 Proposal/QA 指示；
- 不全量重载项目；
- 不依赖轮询；
- duplicate revision 不重复应用；
- gap 时重新拉取项目摘要/当前页。

## 7.6 Tool Result 与 CAT 导航

在 Proma 原生 Tool Renderer 扩展点增加 CAT 专用结果渲染，不新建消息列表。

例：

```text
已为 12 个 Segment 创建 Proposal
[在 CAT 中查看]
```

点击后：

- 切到 `Linguist`；
- 打开对应 Project Tab；
- 定位 Segment；
- 高亮命中行；
- 保持 Agent Session。

CAT Tool Result 结构可增加 backward-compatible 的：

```text
projectId
segmentIds
proposalIds
qaFindingIds
```

Project ID 必须由 Host binding 生成，不允许来自模型参数。

---

# 8. Workbench UI 状态

当前全局 Atom 会导致项目之间串状态。目标改为按 Project 分区。

## 8.1 UI 状态类型

```ts
interface LinguistWorkbenchUiState {
  projectId: string;
  activeAssetId?: string;
  activeSegmentId?: string;
  selectedSegmentIds: string[];
  search: string;
  segmentStatusFilter?: LinguistSegmentStatus;
  qaFilter?: string;
  assetNavigatorOpen: boolean;
  assetNavigatorWidth: number;
  bottomDockOpen: boolean;
  bottomDockTab: 'tm' | 'terms' | 'qa' | 'context' | 'preview';
  bottomDockHeight: number;
  agentRailOpen: boolean;
  agentRailWidth: number;
  activeProjectAgentSessionId?: string;
  lastVisitedAt: string;
}
```

## 8.2 真相边界

UI 状态可以持久化：

- active asset；
- active segment；
- selection；
- filters；
- panel width/open；
- active project agent session。

UI 状态不得成为真相：

- Segment target；
- status；
- revision；
- locked；
- Proposal；
- QA；
- Artifact；
- Project health；
- Agent Session binding。

这些继续来自 Main/CAT Store/Proma Session Store。

## 8.3 持久化

可用 Jotai `atomFamily`、Map atom 或现有 settings 写入；要求：

- 以 Project ID 为 key；
- schema version；
- 项目删除时清理；
- 读取非法状态时使用安全默认值；
- 不存客户文本；
- 不在 localStorage 复制项目内容。

---

# 9. 项目设置与工作区清理

以下功能从 Workbench 主体移入 `ProjectSettingsSheet` 或项目管理页：

- 项目元信息；
- 导入/资产管理；
- TM / TB 数据库管理；
- Style Guide 管理；
- Voice Profiles；
- Context Documents；
- Sentence Patterns；
- Backups；
- Health；
- Archive；
- 删除。

Workbench Bottom Dock 只显示当前工作相关的匹配和引用，不显示管理表。

项目设置应优先复用 Proma/Radix 原生：

- Sheet；
- Tabs；
- Dialog；
- Select；
- Menu；
- Toast；
- Form controls。

---

# 10. 工程硬规则

## 10.1 不改 Proma 的成熟行为

除非工单明确要求，禁止修改：

- Agent runtime；
- Chat runtime；
- Agent message protocol；
- Streaming；
- Thinking；
- Queue / Steer；
- Permission；
- Model/Provider；
- Compaction；
- Automation；
- Bots；
- Skills；
- MCP；
- Preview；
- Scratch；
- Updater。

## 10.2 最小 Proma Core Touchpoints

维护：

```text
docs/architecture/PROMA_CORE_TOUCHPOINTS.md
```

每次修改 Proma 原生文件，记录：

- 文件；
- 修改理由；
- 是否能通过 extension prop 完成；
- 上游合并风险；
- 对 Agent/Chat 的回归测试。

优先：

```text
新增 Linguist feature 目录
>
给 Proma 组件增加窄 prop/slot
>
修改 Proma 内部行为
```

## 10.3 单一实现

代码搜索必须证明：

- 一个 Agent Message Renderer；
- 一个 Thinking Renderer；
- 一个 Agent Composer；
- 一个 Approval 系统；
- 一个 Queue/Steer；
- 一个 Project Binding authority；
- 一个 Segment Store authority；
- 一个 Proposal accept/reject path。

## 10.4 不新增依赖

本计划所需技术已存在：

- React；
- Jotai；
- Tailwind；
- Radix/Shadcn primitives；
- TanStack Virtual；
- TipTap；
- Sonner；
- Playwright Core；
- Axe。

非经独立 Decision 工单，不新增 UI/状态/编辑器依赖。

## 10.5 禁止静默降级

- Project 绑定损坏不能静默变普通 Agent。
- Agent Rail Session 创建失败必须显示恢复动作。
- CAT Tool 失败不能只在 Console。
- Revision conflict 不得覆盖。
- Project Tab 恢复失败必须进入 repair state。
- Context mismatch 必须拒绝发送或移除错误 Context，不能猜。

---

# 11. 实施工单总览

工单前缀：`LF`（Linguist Fusion）。

类型：

- `ticket`：可以直接执行；
- `epic`：必须拆子工单，不可直接执行；
- `gate`：只验证，不写实现；
- `decision`：需要产品决定，不得由模型擅自决定。

## Phase 0：控制面与可信基线

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-000 | ticket | 注册本计划、盘点当前私有 HEAD、生成代码事实差异 | 无 |
| LF-001 | ticket | 建立当前 Agent/Chat/Projects/CAT 的打包截图与 happy-path baseline | LF-000 |
| LF-002 | ticket | 冻结旧 Project/CAT 产品面：仅 P0 修复，不再加功能 | LF-000 |
| LF-003 | ticket | 建立每批必跑 Packaged Vertical Smoke | LF-001 |
| LF-004 | ticket | 建立 Proma core touchpoint 与禁止重复 Agent 组件的架构测试 | LF-000 |

## Phase 1：三模式与一等 Project Tab

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-010 | ticket | AppMode 正式加入 `linguist`，Scratch 退出主模式 | LF-000 |
| LF-011 | ticket | ModeSwitcher 改为 Agent/Chat/Linguist 三段，保留前两项回归 | LF-010 |
| LF-012 | ticket | 折叠侧栏增加 Linguist 模式按钮 | LF-011 |
| LF-013 | ticket | TabItem 改为判别联合，加入 LocalizationProjectTab | LF-010 |
| LF-014 | ticket | 实现 `openLocalizationProject` 和最后项目恢复 | LF-013 |
| LF-015 | ticket | TabContent 渲染 LocalizationProjectWorkbench | LF-014 |
| LF-016 | ticket | Tab 状态、关闭、持久化、MRU 和 status indicator 支持 Project Tab | LF-015 |
| LF-017 | gate | Agent/Chat/Linguist 模式与 Tab 回归 Gate | LF-011~016 |

## Phase 2：Linguist Sidebar

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-020 | ticket | 抽出共享 Project list loader/cache，避免 SideBar 和 ProjectsView 双取数漂移 | LF-014 |
| LF-021 | ticket | 建立 LinguistSidebarContent | LF-020 |
| LF-022 | ticket | 项目单击直接进入 Editor | LF-021 |
| LF-023 | ticket | 项目会话在 Sidebar 中显示和创建 | LF-021 |
| LF-024 | ticket | 最近项目、上次 Project/Asset/Segment 恢复 | LF-022 |
| LF-025 | ticket | 保留 Project 管理首页并从 Sidebar 提供次级入口 | LF-021 |
| LF-026 | gate | Linguist 导航可发现性与恢复 Gate | LF-020~025 |

## Phase 3：Proma 原生 Agent 嵌入

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-030 | ticket | Characterize AgentView full 模式，建立防回归测试 | LF-004 |
| LF-031 | ticket | 给 AgentView 增加 `presentation='full'|'rail'`，不复制行为 | LF-030 |
| LF-032 | ticket | Project Agent Session 选择、懒创建和恢复 | LF-023,031 |
| LF-033 | ticket | Workbench 嵌入 Proma 原生 Agent rail | LF-032 |
| LF-034 | ticket | Agent Rail 可调整、折叠和项目级持久化 | LF-033 |
| LF-035 | ticket | “在完整 Agent Tab 中打开”与返回 Linguist | LF-033 |
| LF-036 | ticket | Agent/Chat 全模式回归和重复组件扫描 | LF-031~035 |
| LF-037 | gate | Native Agent Reuse Gate | LF-030~036 |

## Phase 4：手工 CAT Workbench

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-040 | ticket | Project-scoped Workbench UI state | LF-015 |
| LF-041 | ticket | Workbench Shell、Toolbar、Status Bar | LF-040 |
| LF-042 | ticket | Asset Navigator | LF-041 |
| LF-043 | ticket | 新 Segment Grid，迁入虚拟化/分页/CAS/locked/selection | LF-041 |
| LF-044 | ticket | TargetEditor 与 IME/Tag/Undo/Replace/Insert | LF-043 |
| LF-045 | ticket | 保存、取消、确认并前进、Revision Conflict | LF-044 |
| LF-046 | ticket | Proposal/QA/Status 行内指示与当前行详情 | LF-043 |
| LF-047 | ticket | 键盘工作流与可访问 Grid 语义 | LF-044,045 |
| LF-048 | gate | 无 Agent 手工 CAT 完整 Gate | LF-040~047 |

## Phase 5：Bottom Dock

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-050 | ticket | Bottom Dock 壳、拖动高度、项目级持久化 | LF-040 |
| LF-051 | ticket | TM Match Panel + Replace/Insert | LF-044,050 |
| LF-052 | ticket | Term Match Panel + Insert | LF-044,050 |
| LF-053 | ticket | Segment QA Panel + 跳转/处理 | LF-046,050 |
| LF-054 | ticket | Context/Evidence Panel | LF-050 |
| LF-055 | ticket | Preview Panel | LF-050 |
| LF-056 | gate | Language Resource Dock Gate | LF-050~055 |

## Phase 6：Agent ↔ CAT 融合

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-060 | ticket | 定义 LinguistTurnContextV1 和严格验证 | LF-040,032 |
| LF-061 | ticket | 原生 Composer 显示 Context Chips | LF-031,060 |
| LF-062 | ticket | 每 Turn 发送不可变 Context Snapshot | LF-061 |
| LF-063 | ticket | CAT Tool 产生 Project Mutation Event | LF-062 |
| LF-064 | ticket | Workbench 按 mutation 增量刷新 | LF-063 |
| LF-065 | ticket | CAT Tool Result 使用 Proma 原生 Tool Renderer 扩展展示 | LF-031,063 |
| LF-066 | ticket | Tool Result 点击定位 Project/Segment | LF-065 |
| LF-067 | ticket | Proposal Inline Diff 与 Grid Accept/Reject | LF-046,064 |
| LF-068 | ticket | 选中 Segment 的 Agent 翻译/审校/QA 工作流 | LF-062,067 |
| LF-069 | gate | Agent-CAT Fusion Gate | LF-060~068 |

## Phase 7：项目设置与 Legacy 清理

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| LF-070 | ticket | 建立 ProjectSettingsSheet | LF-041 |
| LF-071 | ticket | 移入 Import/Assets/TM/TB/Style/Voice/Context | LF-070 |
| LF-072 | ticket | 移入 Backup/Health/Archive/Delete | LF-070 |
| LF-073 | ticket | ProjectsView 收敛成管理首页 | LF-071,072 |
| LF-074 | ticket | 删除 ProjectDetailPanel 内部 Chat/建议/CAT/QA/Artifact/Files 导航 | LF-069,073 |
| LF-075 | ticket | CatContextRail 功能迁入 Bottom Dock 后删除 | LF-056,067 |
| LF-076 | ticket | 删除旧 CatWorkspace 产品布局，保留必要纯函数/测试 | LF-048,056,069 |
| LF-077 | ticket | 退役 `activeView='projects'` 日常工作路径和 ProjectsSidebarEntry | LF-026,074 |
| LF-078 | gate | Legacy UI Deletion Gate | LF-074~077 |

## Phase 8：个人 Alpha 工程收口

下列事项来自既定个人日用 Alpha 计划。

| ID | 类型 | 目标 | 依赖 |
|---|---|---|---|
| AC-001 | ticket | Push/PR CI、固定 Bun/Actions、根测试零失败 | LF-000 |
| AC-002 | ticket | Release Workflow fail-closed、去除 `build:resources || true` | AC-001 |
| AC-003 | ticket | 数据根迁到 `.linguist-agent`，产品身份与 Provider 导入 | LF-069 |
| AC-004 | ticket | 所有 BrowserWindow 显式安全选项 | AC-001 |
| AC-005 | ticket | Project Binding fail-closed 与永久解绑 | LF-032 |
| AC-006 | ticket | Export 防覆盖原稿/受管目录 | LF-048 |
| AC-007 | ticket | G10 长线程首载/补载/跳转 | AC-001 |
| AC-008 | ticket | serious/critical Axe 清零 | LF-069 |
| AC-009 | gate | G10 Product Qualification Gate | AC-007,008 |
| AC-010 | gate | G8 真实游戏文本 Fast/Balanced/Best 盲评 | LF-069,AC-001 |
| AC-011 | gate | 14 天自由日用 | LF-078,AC-003~010 |

---

# 12. 关键工单详细施工说明

以下关键工单必须按正文执行；其他工单也须使用第 16 章模板生成施工票。

## LF-000：计划接管与当前事实更新

### 唯一目标

让本计划成为产品融合与 CAT Workbench 的唯一执行权威，同时不覆盖个人 Alpha 工程计划。

### 必须读取

- 当前 Git HEAD、branch、status、upstream；
- `ModeSwitcher.tsx`；
- `app-mode.ts`；
- `tab-atoms.ts`；
- `MainArea.tsx`；
- `TabContent.tsx`；
- `LeftSidebar.tsx`；
- `AppShell.tsx`；
- `right-rail-policy.ts`；
- `ProjectsView.tsx`；
- `ProjectDetailPanel.tsx`；
- `ProjectChatsSection.tsx`；
- `CatWorkspace.tsx`；
- `CatContextRail.tsx`；
- `AgentView.tsx`；
- Project Session Binding；
- CAT Tool Factory；
- 当前执行账本和 Alpha 计划。

### 必须产出

```text
docs/roadmap/LINGUIST_FUSION_CURRENT_REALITY.md
docs/roadmap/LINGUIST_FUSION_QUEUE.md
docs/roadmap/linguist-fusion-queue.json
docs/roadmap/LINGUIST_FUSION_EXECUTION_LEDGER.md
```

### 不能做

- 不改生产代码；
- 不改数据；
- 不重写旧工单状态；
- 不开始 LF-010；
- 不创建第二份不同目标的 UI 蓝图。

### 验收

- 记录实际 HEAD；
- 标记与 `185eb16` 的差异；
- 队列可机器验证；
- 旧 Project/CAT UI 明确 frozen；
- Alpha 工程计划仍有效。

---

## LF-003：Packaged Vertical Smoke

### 唯一目标

每个影响 Renderer、Main、Preload、Tab、Agent、CAT Tool 或 Store 的 Batch，必须验证真实打包 Electron，而不是只跑源码单测。

### 必须覆盖三条路径

#### A. Agent

```text
冷启动
→ Agent 模式
→ 发送“你能帮我做什么”
→ Thinking/工具/流式 final 可见
→ Stop/Retry 正常
```

#### B. Chat

```text
切 Chat
→ 创建或打开 Chat
→ 发送消息
→ 流式 final
→ 切回 Agent 状态不丢
```

#### C. Linguist（在相关功能完成后逐步扩展）

```text
切 Linguist
→ 打开 synthetic Project
→ CAT Grid 出现
→ 编辑并保存一段
→ TM Replace
→ 选 3 段调用 Agent
→ Proposal 出现在 Grid
→ QA
→ 导出
→ 重启恢复
```

### 规则

- 测试必须启动 `out/.../Linguist Agent.app` 或等价打包产物；
- Fake Model 可以验证管线，但 G8 不可用 Fake Model；
- 任何断言失败，Batch 不得标 `packaged_verified`；
- 不允许只靠源码字符串 grep；
- 不允许将 skipped 写成 passed。

---

## LF-013：TabItem 判别联合

### 唯一目标

支持一等 Localization Project Tab，不破坏 Agent、Chat、Preview、Scratch、Tutorial。

### 目标类型

```ts
type SessionTab = {
  id: string;
  type: 'chat' | 'agent';
  sessionId: string;
  title: string;
};

type LocalizationProjectTab = {
  id: `linguist-project:${string}`;
  type: 'linguist-project';
  projectId: string;
  title: string;
};

type TabItem = SessionTab | PreviewTab | ScratchTab | TutorialTab | LocalizationProjectTab;
```

### 修改要求

- `activeSessionIdAtom` 只对 Session/Preview 返回 ID；Project Tab 返回 null；
- `tabStreamingMapAtom` 可通过项目当前 Agent Session 映射状态；未映射则 idle；
- `getPersistableTabState` 支持 Project Tab；
- `openTab` 拆成 `openSessionTab` 和 `openLocalizationProjectTab`，或接受判别输入；
- Preview 只绑定 Agent Session，不绑定 Project Tab；
- `updateTabTitle` 支持 Project title；
- `closeTab` 不删除 Project；
- `ensureScratchPadTab` 不丢 Project Tab；
- 旧持久化数据可读；
- invalid Project Tab 进入 repair state，不 crash。

### RED Tests

- 打开/关闭/恢复 Project Tab；
- Agent→Linguist→Chat→Linguist；
- Preview owner 逻辑不受影响；
- Project Tab 无 `sessionId` 时类型安全；
- 持久化 round-trip；
- Project 已删除时安全恢复。

---

## LF-031：AgentView 原生复用

### 唯一目标

同一个 AgentView 行为实现同时服务 full 与 rail。

### 禁止

- 复制 `AgentView.tsx`；
- 复制 Message Renderer；
- 复制 Input；
- 另建 Session Store；
- 通过 iframe 嵌入 Agent 页面；
- 用 CSS 隐藏大量行为后另写简版。

### 推荐步骤

1. 为当前 full 模式建立截图/DOM/交互 characterization。
2. 识别布局差异，而非行为差异。
3. 新增 `presentation` prop。
4. 将 Header 宽度、Messages container、Composer padding、toolbar overflow 作为 presentation style。
5. Rail 使用同一 hooks、store、messages、input。
6. Agent full 模式所有基线必须保持。

### Rail 可改变

- Header 高度；
- 标题显示；
- Toolbar 收进 overflow；
- Messages 横向 padding；
- Composer 紧凑布局；
- Context chips；
- “完整打开”按钮。

### Rail 不可改变

- Streaming；
- Thinking；
- Tool lifecycle；
- Queue/Steer；
- Approval；
- Attachments；
- Model/Permission/Runtime；
- Retry；
- Compaction；
- Session persistence。

### 验收

- Agent 模式截图与行为无意外变化；
- Rail 中可完成完整消息发送；
- 相同 Session 在 rail/full 打开时消息一致；
- 不重复注册 global listener；
- 代码搜索无第二实现。

---

## LF-043：Segment Grid 重建

### 唯一目标

用生产型 Grid 替换固定 430px、固定 88px 的演示布局，复用现有数据、分页、虚拟化和 CAS。

### 保留

- `linguistCatQuery`；
- 每页 200 或仓库确认后的现行策略；
- `expectedRevision`；
- `linguistCatEditSegment`；
- selection；
- active segment；
- virtual utils 中真正通用的函数；
- locked/tag/QA/Proposal 数据契约。

### 新结构

```text
SegmentGrid
├─ SegmentGridHeader
├─ VirtualSegmentViewport
│  └─ SegmentRow
│     ├─ SelectionCell
│     ├─ IdCell
│     ├─ SourceCell
│     ├─ TargetCell / TargetEditor
│     ├─ StatusCell
│     └─ QaCell
└─ GridLiveRegion
```

### 行高策略

允许二选一，由实现模型根据现有 virtualizer 选择风险更低者：

1. `measureElement` 动态测量；或
2. 稳定普通行高 + Active row 展开。

禁止继续所有行固定 88px 且长文本两行截断。

### QA 规则

- 行 QA 数只来自该 Segment；
- 项目级 QA 总数放 Toolbar/Status；
- 点击 QA cell 打开 Bottom Dock QA Tab；
- blocking 与 warning 不能只靠颜色。

### 性能

- 10k rows；
- 滚动不持续阻塞主线程；
- 只渲染可视区域；
- Segment 更新只刷新命中行；
- 不把整个项目复制进 React state。

---

## LF-051：TM Replace/Insert

### 唯一目标

让 TM 从“只读展示”变成真正生产操作。

### Replace

```text
点击替换
→ 写入 TargetEditor 草稿
→ 标记 dirty
→ 不立即写数据库
→ 用户保存/确认时走 CAS
```

### Insert

```text
点击插入
→ 插入当前 editor selection/caret
→ 保持其它文本
→ 无活动 editor 时禁用并提供 tooltip
```

### Hard rails

- locked 禁用；
- Tag/Placeholder 校验；
- 不允许 TM 直接 commit；
- 来源和 match score 可见；
- Exact/Fuzzy 区分；
- 操作可 Undo；
- Screen reader 有动作描述。

---

## LF-060：LinguistTurnContext

### 唯一目标

建立可验证的每 Turn 项目 UI 上下文，不改变 Project Binding authority。

### RED Tests

- Session 项目与 Context 项目不一致 → 拒绝；
- Segment 不属于 Project → 拒绝；
- selected IDs 超上限 → 有界截断并明确标记；
- 无 active Segment → 允许 Project-only；
- Chat/普通 Agent 不发送 Linguist Context；
- Rail/full 同 Session context snapshot 一致；
- Context 变更只从下一消息生效；
- 历史 Turn 保存自己的 Context snapshot；
- Context 不含客户文本和绝对路径。

---

## LF-065：CAT Tool Result Renderer

### 唯一目标

复用 Proma 原生工具卡框架，以 LA 专属摘要展示 CAT Tool 结果。

### 示例

```text
翻译建议
已为 12 个片段创建建议
[在 CAT 中查看]
```

```text
确定性 QA
检查 653 个片段，发现 8 个问题
[查看问题]
```

### 不做

- 不新建 Timeline；
- 不新建 Tool Card 基础组件；
- 不把所有原始 JSON 默认展开；
- 不把绝对路径显示给用户；
- 不在卡片中直接接受全部 Proposal。

---

## LF-067：Proposal Inline Diff

### 唯一目标

Agent Proposal 在目标行中成为一等可审查对象。

### 状态

```text
无建议
Pending Proposal
Conflict
Accepted
Rejected
Superseded
```

### Grid 表现

- Proposal badge；
- Target current vs proposed inline diff；
- Accept；
- Reject；
- Evidence；
- conflict 提示；
- 批量接受前显示影响数量；
- locked 绝不能接受；
- 接受后按后端返回 revision 更新；
- Agent Timeline 同步显示结果。

### 权限

只有用户/UI accept path 能 commit；Agent Tool 永远不能调用 accept。

---

# 13. 阶段 Gate

## G-F0：可信基线

必须满足：

- 当前 HEAD 已记录；
- Agent/Chat/Project/CAT 截图和 smoke；
- CI 至少能运行关键测试；
- 旧 UI frozen；
- 没有未记录用户数据变更。

## G-F1：三模式与 Tab

必须满足：

- `Agent | Chat | Linguist`；
- Agent/Chat 原行为通过；
- Project 是一等 Tab；
- 切换和重启恢复；
- 项目点击一次进入 Editor。

## G-F2：原生 Agent 复用

必须满足：

- Workbench 右栏确实是原生 AgentView；
- 同一 Session rail/full 数据一致；
- Queue/Steer/Thinking/Approval/Model 可用；
- 无第二套 Agent 组件。

## G-F3：手工 CAT

必须在真实打包 App 完成：

1. 打开 Project；
2. 直接进入上次 Segment；
3. 不开 Agent；
4. 编辑 Target；
5. 使用 Tag/Placeholder；
6. 保存；
7. 确认并前进；
8. 使用 TM Replace；
9. 插入术语；
10. 运行/查看 QA；
11. 导出且不覆盖原稿；
12. 重启恢复。

## G-F4：Agent-CAT Fusion

必须在真实打包 App 完成：

1. 选中 3 个 Segment；
2. 右栏 Composer 显示 Context Chip；
3. 请求翻译；
4. Agent 使用现有 CAT Tool；
5. Grid 出现 3 条 Proposal；
6. Agent Tool Card 显示结果；
7. 点击卡片定位行；
8. 接受 2 条、拒绝 1 条；
9. Agent Timeline 与 Grid 同步；
10. 切 full Agent 再返回，状态不丢。

## G-F5：Legacy 删除

必须满足：

- Project 日常工作不再用 `activeView='projects'`；
- ProjectDetail 内部工作 Tabs 删除；
- CatContextRail 删除；
- 旧 CatWorkspace 产品布局删除；
- `rg` 无旧消费者；
- 数据、Store、Tools 未删除；
- 回滚不产生第二真相源。

## G-ALPHA：个人日用 Alpha

必须满足：

- CI 全绿；
- G-F0~F5；
- G10；
- G8；
- 数据根、Provider、Binding、Export 安全完成；
- 无已知数据损失/崩溃/项目错绑；
- 开始 14 天自由日用。

---

# 14. 验证矩阵

## 14.1 自动测试

### 类型与架构

- `AppMode` exhaustiveness；
- `TabItem` exhaustiveness；
- `apps/electron/src/renderer/features/linguist` 不出现重复 Agent 基础组件；
- Linguist features 可 import Proma Agent components；反向禁止 Proma core import Linguist feature；
- CAT Core 不 import React/Electron/Proma UI。

### 模式

- Agent mode restore；
- Chat mode restore；
- Linguist mode restore；
- collapsed sidebar；
- no-project empty state；
- deleted/archived project recovery。

### CAT

- 10k rows；
- paging；
- CAS conflict；
- locked；
- tags；
- search/filter；
- selection；
- active row；
- IME；
- keyboard；
- TM replace/insert；
- Term insert；
- QA current segment；
- Proposal accept/reject。

### Agent Integration

- project session lazy create；
- context mismatch；
- selected IDs validation；
- mutation event ordering；
- tool result navigate；
- rail/full same session；
- no duplicate listener；
- queue/steer；
- permission request；
- retry/compaction。

## 14.2 Packaged Electron

每个 Batch 至少：

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
cd apps/electron
bun run smoke:pack
bun run smoke:g0
```

若私有仓脚本已更新，以 LF-000 记录的 canonical commands 为准；不得自行发明或跳过。

## 14.3 视觉尺寸

- 480×600；
- 1024×700；
- 1280×820；
- 大屏；
- Light；
- Dark；
- 200% zoom；
- Reduced Motion。

## 14.4 Accessibility

- ModeSwitcher roving focus/ARIA；
- Tab keyboard；
- Grid role/row/column；
- row selection announcements；
- locked reason；
- QA severity text；
- Bottom Dock tabs；
- Agent rail label；
- Resize handles keyboard alternative；
- serious/critical Axe = 0；
- VoiceOver 手工记录。

---

# 15. 删除映射

| 旧实现 | 新实现 | 删除条件 |
|---|---|---|
| `activeView='projects'` 日常入口 | Linguist mode + Project Tab | G-F1、F5 |
| `ProjectsSidebarEntry` 主入口 | LinguistSidebarContent | LF-026 |
| ProjectDetail 内部 Chat Tab | Native Agent rail / full Agent Tab | LF-037、069 |
| ProjectDetail 内部 CAT Tab | LocalizationProjectWorkbench | LF-048 |
| ProjectDetail 内部 Proposal Tab | Grid inline diff + Agent Tool Card | LF-067 |
| `CatContextRail` | Bottom Dock | LF-056、067 |
| 旧 `CatWorkspace` 页面布局 | 新 Workbench | LF-048、056、069 |
| 全局 CAT UI atoms | Project-scoped state | LF-040 |
| 项目上方 Reference/Style/Voice/Context 管理块 | ProjectSettingsSheet | LF-071 |
| 自定义 LA Agent Rail（若存在） | Proma AgentView rail | LF-037 |

删除时不得删除：

- CAT Core；
- CAT Store；
- CAT Tools；
- Project Session Binding；
- Project Service；
- Revision/CAS；
- Proposal/QA/Evidence/Export；
- 迁移与数据。

---

# 16. 每张工单固定模板

```markdown
# LF-XXX — 工单名称

## Kind
Ticket / Epic / Gate / Decision

## 唯一目标
一个可验证的不变量。

## 依赖
列出全部完成工单。

## 当前调用链
列出入口、状态、IPC、后端、存储、输出。

## 不变量
1.
2.
3.

## 修改范围
### 新建
- path

### 修改
- path

### 删除
- path（只有删除门满足时）

## 明确不做
- 不修改无关模式
- 不复制 Proma Agent 组件
- 不改 CAT hard rails
- 不读写真实 data

## 实施步骤
1. 阅读源文件和测试。
2. 先写失败/characterization test。
3. 实现最小完整行为。
4. 运行精确测试。
5. 运行 typecheck/full tests。
6. 运行 packaged smoke（适用时）。
7. 更新 execution ledger。
8. 独立 commit。

## RED Tests
- test name
- input
- expected

## Packaged Verification
- exact steps
- screenshot/log artifact

## 回滚
说明如何整票回滚，不产生双真相。

## 完成定义
- 代码
- 测试
- 打包验证
- 文档
- 无未授权范围扩张

## 未解决事项
只记录，不伪造完成。
```

---

# 17. 实现 Agent 的固定规则

1. 每次只执行一张 `Executable=yes` 工单。
2. Epic/Gate/Decision 不得直接写生产代码。
3. 不跳依赖。
4. 每张 Ticket 独立 commit。
5. 不 squash。
6. 不使用 `as any` 绕类型。
7. 不空 `catch`。
8. 不使用 `|| true` 掩盖失败。
9. 不把 skipped 写成 passed。
10. 不将 source-string test 当 UI 行为证明。
11. 不读取或修改真实用户数据，除非工单和用户明确授权。
12. 不复制 Proma Agent 基础组件。
13. 不创建第二套消息、Composer、Thinking、Approval、Queue。
14. 不让 Agent 直接 Commit Segment。
15. 不取消 CAS、locked、Tag、QA hard rails。
16. 不为了小 diff 保留永久 Legacy 路径。
17. 迁移完成后按删除门物理删除旧 UI。
18. 每个涉及 UI/IPC/Agent/CAT 的 Batch 必跑真实打包 App。
19. 若 Packaged smoke 失败，停止后续依赖工单。
20. 若需要产品决定，标 `BLOCKED_DECISION`，继续不依赖该决定的工单。

---

# 18. 第一次交给实现 Agent 的原文提示词

```text
你将实施《Linguist Agent 三模式融合与 CAT Workbench 产品化实施计划》。

目标产品：
Agent | Chat | Linguist 三模式。

核心规则：
- Agent 和 Chat 完整保留 Proma 原生行为。
- Linguist 是专业本地化模式，不是新 Runtime。
- CAT 可完全脱离 Agent 手工工作。
- Workbench 右侧 Agent 必须复用 Proma 原生 AgentView、消息、Thinking、Tool、Composer、模型、权限、Queue/Steer、Approval、Retry 和 Compaction。
- 禁止创建第二套 Linguist Agent Rail / Composer / Conversation / Thinking / Tool Card。
- Agent 只产生 Proposal，不能直接覆盖 Segment。

本轮只执行 LF-000，不执行 LF-001 或任何后续工单。

必须完成：
1. 记录当前工作仓库路径、分支、HEAD、upstream、git status。
2. 比较当前 HEAD 与计划基线 185eb16；列出已发生的相关变更。
3. 阅读计划列出的当前关键文件。
4. 更新当前事实报告、机器化队列和执行账本。
5. 将旧 Projects/CAT UI 标记为 frozen：除 P0 bugfix 外不再新增功能。
6. 明确本计划只替代产品融合/CAT Workbench 路线，个人日用 Alpha 的 CI、安全、数据根、G10、G8、14 天日用继续有效。
7. 运行 roadmap/docs 验证与仓库现有 typecheck；不得改生产代码。
8. 创建独立 commit：docs(LF-000): establish linguist fusion control plane
9. 输出修改文件、命令结果、实际 HEAD 和下一张可执行工单，然后停止。

禁止：
- 开始 ModeSwitcher 修改
- 修改 AgentView
- 修改 CatWorkspace
- 修改数据
- 自动推送公开仓库
- 创建另一份不同目标的总蓝图
```

---

# 19. 后续每轮给 Agent 的短提示词

```text
继续执行 LINGUIST_FUSION_QUEUE 中下一张依赖全部满足、Executable=yes 的工单。

严格遵守：
- 一票一提交；
- 先 RED/characterization test；
- 不扩大范围；
- 不复制 Proma Agent 组件；
- 不改变 Agent/Chat 现有行为；
- 不绕过 CAT Proposal/CAS/locked/QA hard rails；
- 涉及 UI、IPC、Agent、CAT 时必须运行真实 packaged smoke；
- 更新 execution ledger；
- 完成后停止。
```

---

# 20. 用户验收清单

用户不需要审代码，只需要在每个 Gate 亲自观察以下内容。

## 三模式

- 红框处出现 Agent / Chat / Linguist。
- Agent 原样能用。
- Chat 原样能用。
- Linguist 打开后显示本地化项目。

## 入口

- 点击最近项目一次就进入 CAT。
- 不再先看项目 Dashboard。
- 切走再回来仍是刚才的 Segment。

## 手工 CAT

- 不开 Agent 也能翻译。
- 原文/译文/状态/QA 清楚。
- 长文本能看、能编辑。
- TM 能替换和插入。
- 术语能插入。
- `确认并前进`顺手。
- 导出不覆盖原稿。

## Agent 融合

- 右边是 Proma 原生 Agent，不是缩水版。
- 当前选择显示在 Composer 上方。
- 让 Agent 翻译选中段落后，建议出现在表格里。
- 点击 Agent 的结果能跳到对应行。
- 接受/拒绝后两边同步。
- Agent 关闭后 CAT 仍然完整。

## 成品感

- 不再像“Proma 里嵌一个项目后台”。
- 项目编辑是第一等工作区。
- Agent 是副驾驶。
- 页面没有一堆项目管理卡压在表格上方。
- 工作区信息密度接近传统 CAT，但保留 Proma 的现代 UI。

---

# 21. 最终完成定义

本计划完成不等于“组件都存在”。必须同时满足：

1. `Agent | Chat | Linguist` 三模式稳定。
2. Agent/Chat 无回归。
3. Localization Project 是一等 Tab。
4. 一次点击进入 CAT。
5. CAT 可以无 Agent 独立完成工作。
6. Workbench 使用生产型双语 Grid、Bottom Dock 和状态栏。
7. 右栏复用 Proma 原生 AgentView。
8. 没有第二套 Composer、Thinking、Tool、Approval、Queue。
9. Agent Context 与 Project Binding 严格一致。
10. Agent 只创建 Proposal。
11. Proposal 在 Grid 中可审查和接受/拒绝。
12. CAT Tool Result 可定位到 Segment。
13. 旧 Project 内部工作 Tabs 和旧 CatContextRail 已删除。
14. 每个 Batch 都有打包 App 纵向验证。
15. 10k Segment、长 Thread、Axe、键盘、IME 达标。
16. CI、数据根、安全、导出保护完成。
17. G8 真实盲评完成。
18. 进入 14 天个人自由日用。
19. 日用期间无重复数据损失、崩溃、错绑项目或核心工作流阻断。
20. 公开镜像前删除私人研究规格与敏感资料，再进行最终代码审校。

---

# 22. 最终产品一句话

> **Linguist Agent 是完整 Proma Agent 与专业 CAT Workbench 共用同一项目、同一会话和同一工作流的桌面本地化产品：Agent、Chat 全部保留，Linguist 成为第三种一等模式；CAT 是主驾驶，Agent 是原生副驾驶。**
