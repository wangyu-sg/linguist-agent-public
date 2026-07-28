# Feature Flags — v1 产品面开关（D-007 / PB-012）

> 产品决策 **D-007**：v1 不包含第三方扩展市场、团队/自动化/远程机器人等产品面。
> 所有「隐藏但不删除」的产品面开关集中在
> `apps/electron/src/renderer/lib/feature-flags.ts`——这是**唯一**的开关位置，
> 禁止在组件里散落硬编码的 `if (false)`。
>
> 恢复任一产品面：把对应开关改回 `true` 即可，无需其他改动。
> 守卫测试：`apps/electron/src/renderer/lib/feature-flags.test.ts`
> （断言开关集合完整；D-002/D-007 开关默认全为 `false`）。

## 开关清单

### `AGENT_RUNTIME_SWITCHER_VISIBLE = false`（D-002 / PB-011，PB-012 起迁入本模块）

- **隐藏什么**：Claude/Pi 双内核切换 UI——Agent 输入工具栏的内核切换器、
  自动任务表单的「Agent 内核」选择器、渠道设置里的 Claude Agent Core 徽章。
- **被隐藏的面在哪**：
  - `apps/electron/src/renderer/components/agent/AgentView.tsx`（`AgentRuntimeSelector`）
  - `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`（`AutomationRuntimeSelector`）
  - `apps/electron/src/renderer/components/settings/ChannelSettings.tsx`（`AgentCoreChips` 的 Claude 徽章）
- **完整策略**：见 `docs/architecture/RUNTIME_POLICY.md`（默认值矩阵、维护者触达 Claude 的路径）。
- **如何恢复**：开关改回 `true`。

### `REMOTE_BOTS_SETTINGS_VISIBLE = false`（D-007 / PB-012）

- **隐藏什么**：设置里的「远程连接」标签页（`BotHubSettings`），内含飞书、钉钉、
  微信（WeClaw）Bot 配置页、机器人「用法」页（`BotDefaultSettings`）与
  Proma 品牌素材下载页（`PromaLogoSettings`）。
- **被隐藏的面在哪**：
  - 入口门控：`apps/electron/src/renderer/components/settings/SettingsPanel.tsx`（`BOTS_TAB`）
  - 页面本体：`apps/electron/src/renderer/components/settings/BotHubSettings.tsx`
    （`FeishuSettings` / `DingTalkSettings` / `WeChatSettings` / `BotDefaultSettings` / `PromaLogoSettings`）
- **保留未动**：主进程 Bridge 实现与全部 IPC——`main/lib/feishu-bridge*.ts`、
  `dingtalk-bridge*.ts`、`wechat-bridge.ts`、`main/ipc.ts` 的飞书/钉钉/微信段落。
  已配置的 Bridge 照常自愈启动；只是 v1 没有配置入口。
- **如何恢复**：开关改回 `true`，「远程连接」标签页随设置导航一起恢复。

### `AUTOMATIONS_VISIBLE = false`（D-007 / PB-012）

- **隐藏什么**：自动任务（定时任务 / Automations）产品面——侧边栏入口（展开态条目
  + 收起态 Rail 按钮）、侧边栏合成的「自动任务」会话分组、主区 automations
  视图路由与任务表单、会话消息里的「来自 Proma 定时任务」徽章。
- **被隐藏的面在哪**：
  - `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
    （`AutomationSidebarEntry`、收起态 Rail 按钮、`automationGroup` 合成分组）
  - `apps/electron/src/renderer/components/tabs/MainArea.tsx`
    （`activeView === 'automations'` 路由与 `AutomationFormView` 的渲染门控；
    开关关闭时一律回落到普通会话视图）
  - `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`（`ScheduledRunBadge`）
  - 视图本体：`components/automation/AutomationsListView.tsx`、`AutomationFormView.tsx`
- **保留未动**：主进程 `automation-manager.ts` 调度器与通知服务完整保留，
  已创建的定时任务照常触发执行（其会话只是不再出现在侧边栏分组里）。
- **如何恢复**：开关改回 `true`。

### `PROMA_PROMO_VISIBLE = false`（D-007 / PB-012）

- **隐藏什么**：Proma 商业推广面——渠道设置顶部的「Proma 商业版」推广卡片
  （指向 proma.cool）、第三方 Base URL 风险确认弹窗里的 Proma 商业版推广段落、
  通用设置里的「Git/PR 标识」推广开关。
- **被隐藏的面在哪**：
  - `apps/electron/src/renderer/components/settings/ChannelSettings.tsx`（`PromaProviderCard`）
  - `apps/electron/src/renderer/components/settings/ChannelForm.tsx`（风险弹窗推广段落）
  - `apps/electron/src/renderer/components/settings/GeneralSettings.tsx`（「Git/PR 标识」`SettingsToggle`）
  - `apps/electron/src/renderer/components/settings/AppearanceSettings.tsx`（13 个 Proma logo 应用图标变体，PB-113 并入本开关：`VISIBLE_ICON_VARIANTS` flag off 时选择器仅剩 default/LA 图标；png 资产保留不删；已存变体高亮兜底回落 default，不改写用户存储值）
- **主进程同步点（PB-113）**：主进程无法引用 renderer 开关模块，`main/ipc.ts` 用同名同值常量 `PROMA_APP_ICON_VARIANTS_VISIBLE = false` 在 `resolveAppIconPath` 兜底（隐藏期间历史存储的 Proma 变体一律解析回 `icon.png`）。**恢复可见时两处必须一起改回。**
- **注意**：「Git/PR 标识」仅隐藏开关 UI；主进程 git attribution
  （`main/lib/agent-git-attribution.ts`，默认开启、`Made-with: Proma` trailer）
  行为不变。是否改默认属独立品牌决策，不在 PB-012 范围。
- **如何恢复**：开关改回 `true`。

## 刻意保持可见（判断记录）

- **教程 / 新手引导**：`TutorialBanner`、设置里的教程 Tab、教程 Tab 页——PB-010
  已改品牌为「Linguist Agent 使用教程」，属功能性 onboarding，非 Proma 营销，保留。
  （PB-113 已闭环：Tab label 改「使用教程」、标题统一走 `TUTORIAL_TAB_TITLE`、
  教程 H1 去品牌化；tutorial.md 正文约 40 处 Proma 品牌词未动，彻底重写另票。）
- **Memory 设置里的 Nowledge「实验性」说明**（`MemorySettings.tsx`）与关于页的
  WSL（实验性）选项（`AboutSettings.tsx`）：memory 属 v1 范围，这两处只是第三方
  集成的平台支持说明，不是独立的实验性产品面，保留。
- **渠道/模型配置、Agent 技能（Skills/MCP）、Chat 工具、语音输入**：均为 v1 范围，不动。

## PB-113 隐藏评估结论（2026-07-27，零代码，记档）

票面要求逐项评估「隐藏的产品面是否删代码」。结论：**全部维持隐藏不删**——

1. **Claude Runtime（AGENT_RUNTIME_SWITCHER_VISIBLE）**：维持隐藏不删。pi 为唯一 v1 runtime，但 Claude SDK 链路是上游既有能力，删除会增加 upstream sync 冲突面且无收益。
2. **Remote bots 设置（REMOTE_BOTS_SETTINGS_VISIBLE）**：维持隐藏不删。飞书/钉钉 bot 是通用 agent 远程入口能力，用户明确要保留通用 agent 功能。
3. **Automation（AUTOMATIONS_VISIBLE）**：判【相关】不移除。定时/事件自动化是通用 agent 基础能力，与「通用 agent + Gaming Localization」路线一致，仅维持 v1 隐藏。
4. **coding-only tools**：零代码——未发现需要按编码工具维度隐藏/删除的面。
5. **7 套特殊主题（AppearanceSettings 主题族）**：全保留。主题是个性化能力，非 Proma 营销面。
6. **Settings 分区结构**：全保留，不做重排删除。

原则：隐藏 ≠ 删除；只删「确定永不恢复且阻碍维护」的面，本票评估中没有此类面。

## 约束

- 新增「隐藏但不删除」的产品面时：**必须**在本模块加开关并在本文件登记，
  不得在组件里写一次性的 `if (false)`。
- 主进程代码（Bridge / 调度器 / IPC）不受渲染层开关影响，必须始终保持可编译、可运行。
