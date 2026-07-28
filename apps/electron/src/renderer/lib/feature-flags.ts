/**
 * 产品功能开关（Feature Flags）—— 统一入口
 *
 * 产品面开关集中在本文件，禁止在组件里散落硬编码的 `if (false)`。
 * Linguist 是完整 Proma 上的专业模式，不能借开关隐藏通用能力。
 *
 * 详细清单（每个开关隐藏了什么、被隐藏的代码在哪、如何恢复）见
 * docs/architecture/FEATURE_FLAGS.md。
 */

/**
 * Agent runtime 切换 UI。
 *
 * 覆盖：
 * - Agent 输入工具栏的内核切换器（AgentView）
 * - 自动任务表单的「Agent 内核」选择器（AutomationFormView）
 * - 渠道设置里的 Claude Agent Core 徽章（ChannelSettings）
 *
 * 详见 docs/architecture/RUNTIME_POLICY.md。
 */
export const AGENT_RUNTIME_SWITCHER_VISIBLE: boolean = true

/**
 * 远程机器人 / 平台 Bridge 设置。
 *
 * 控制设置里的「远程连接」标签页（BotHubSettings），内含飞书、钉钉、
 * 微信（WeClaw）Bot 配置、机器人「用法」页与 Proma 品牌素材下载页
 * （PromaLogoSettings）。
 *
 * 主进程 Bridge 代码（feishu-bridge.ts、dingtalk-bridge*.ts、wechat-bridge.ts
 * 及其 IPC）不受此开关影响。
 */
export const REMOTE_BOTS_SETTINGS_VISIBLE: boolean = true

/**
 * 自动任务 / 定时任务（Automations）产品面。
 *
 * 覆盖：
 * - 侧边栏「自动任务」入口（展开态条目 + 收起态 Rail 按钮，LeftSidebar）
 * - 侧边栏合成的「自动任务」会话分组（LeftSidebar）
 * - 主区 automations 视图路由与任务表单（MainArea）
 * - 会话消息里的「来自 Proma 定时任务」徽章入口（SDKMessageRenderer）
 *
 * 主进程 automation-manager / 调度器完整保留，已创建的定时任务照常执行。
 */
export const AUTOMATIONS_VISIBLE: boolean = true

/**
 * Proma 商业推广面（D-007，ticket PB-012）。
 *
 * 隐藏：
 * - 渠道设置顶部的「Proma 商业版」推广卡片（ChannelSettings）
 * - 第三方 Base URL 风险确认弹窗里的 Proma 商业版推广段落（ChannelForm）
 * - 通用设置里的「Git/PR 标识」推广开关（GeneralSettings；仅隐藏开关 UI，
 *   主进程 git attribution 的默认值与行为不变）
 *
 * 功能性的新手引导（教程横幅、教程 Tab）不受影响。
 */
export const PROMA_PROMO_VISIBLE: boolean = false
