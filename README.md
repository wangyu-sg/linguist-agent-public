# Linguist Agent

Linguist Agent 是一个面向个人日常本地化工作的桌面 Agent：

> Proma 的完整通用 Agent / Chat 产品能力 + Linguist Agent 的专业 CAT 内核与工作台。

本项目是 [Proma](https://github.com/proma-ai/Proma) 的 AGPL-3.0 衍生作品。Proma 的版权归原作者所有；来源与固定基线见 [NOTICE.md](./NOTICE.md)、[ATTRIBUTION.md](./ATTRIBUTION.md) 和 [UPSTREAM_BASELINE.md](./docs/architecture/UPSTREAM_BASELINE.md)。

[English README](./README.en.md)

## 当前状态

当前定位是供作者本人连续使用和改良的 **个人 Alpha**，没有面向公众发布计划。产品结构已经固定：不删除 Proma 的 Agent、Chat、Provider、Skills、MCP、Automations 或远程集成；Linguist 是其上的一等本地化模式。

当前 manifest 基线是 Electron App `0.16.16`（Electron `43.2.0`）、`@proma/shared 0.1.83`、Pi Runtime `0.82.1`、CAT Core / Formats / Store / Tools `0.0.14 / 0.0.7 / 0.0.27 / 0.0.21`，CAT schema `15`，仓库固定使用 Bun `1.3.14`。

应用提供三个并列主模式：

- **Agent**：完整通用 Agent 工作区，支持 Claude / Pi Runtime、工具、Thinking、权限、Queue / Steer、Skills、MCP 和工作区文件。
- **Chat**：多 Provider 对话、附件、工具、上下文控制与并排比较。
- **Linguist**：项目、批次（同一项目内反复到达的任务文件）、语言资产（TM / TB / Style Guide / Context）、虚拟化 Segment Grid、人工编辑、Proposal 审核、确定性 QA、导入验证/安全撤销、交付预检、导出、完整性扫描、备份与恢复。

Linguist 左侧栏固定为“项目 → 绑定会话”：会话行与 Agent 侧栏复用同一组件和树行为（状态、MiniMap、委派、置顶、最近会话与归档），Agent 模式则排除所有项目绑定会话。点击项目进入 Workbench，点击会话进入同一个 Full `AgentView`；跨项目操作是创建独立副本，成功后仍停留在源项目，并可从提示打开副本。

Linguist 是一等 Agent Profile：它在各 Runtime 的 Proma Base 上叠加版本化的 Profile、Role、专业质量合同、Execution Policy、Project Digest 与冻结的 Turn Context，并在缺层时显式 degraded，不静默退化成普通 Agent。Execution Policy 只控制是否按风险触发独立评审，不预支 Fast / Balanced / Best 的质量承诺。它嵌入同一个 `AgentView`，不会复制第二套 Composer、消息流、Thinking、Tool Card、权限或 Session Store。Agent 只能创建待人工审核的 Proposal，不能绕过 CAS、锁定项、Tag/QA/Required/Forbidden 规则直接提交 Segment。

CAT 编辑器中，`Cmd/Ctrl+Enter` 用于确认当前阶段并前进，即使译文没有变化也可执行；项目设置等右侧浮窗的关闭按钮在 Electron 标题栏区域保持可点击。

上游 v0.16.8 底座带来 Planning（Todo、日程、提醒与 Agent 引用）、Agent Island、统一项目/会话文件能力、Vision Relay、xAI OAuth 与更新后的 Pi Runtime。这些能力仍属于共享 Agent / Chat 底座，不能引入第二套 Linguist 状态或绕过 CAT authority；其自动、打包和真机资格仍须分别验证。

## 架构

```text
Linguist Agent Desktop App
├── Agent / Chat / Providers / Skills / MCP / Automations / 远程桥
├── Planning（Todo、日程、提醒、Agent 引用）
├── Agent Island（Agent 交互与 Planning 投影）
└── Linguist Mode
    ├── Workbench + 原生 Agent Rail
    ├── Session-bound CAT Tools
    ├── Electron Linguist Services / IPC
    └── @linguist/cat-core
        └── 纯领域模型、Proposal、Evidence、QA、Critic、Consistency
```

关键边界：

- `@linguist/cat-core` 不依赖 React、Electron、Proma UI 或 SQLite。
- `@linguist/cat-store` 负责每项目 `cat.db`、原始资产、备份与导出记录。
- `@linguist/cat-tools` 的项目身份只来自 Session binding，19 个工具按项目、参考资料、QA、Proposal/Critic、Intake 与 Translation Scope 分模块；Intake 目前只接受当前会话明确附加的单文件。
- 批次源文件与可保留原件的语言资产统一复用 Proma Preview Tab；TM/TB 导入先生成候选，只有人工确认后才进入权威层。
- XLSX 任务表导入必须人工确认 Sheet 与列映射；映射随批次持久化并用于导出。SDLXLIFF 复杂 `mrk` 与 CSV/JSON 低置信误识别均按现有 adapter fail closed。
- `LinguistProjectService` 保持单一对外接口，内部按生命周期、资源、质量与交付拆分。
- Proposal 内容与每次 Issuance/Provenance 分离持久化；长任务使用 Job/Checkpoint、幂等 mutation、durable outbox 和按运行撤销。
- 项目打开只做有界 Quick Health；Full Integrity Scrub 在独立 worker thread 中检查全量摘要、SQLite/引用链、导出与 Session workspace。
- 会话复制由主进程重新验证源 Session binding、目标项目活跃/健康状态与 Claude/Pi 原生分叉条件；Renderer 不能提交 binding、原生 ID 或路径。副本不携带工作区文件、`.context`、附件、委派、自动化或运行状态，失败时回滚半成品。
- Planning 与 Agent Island 复用通用主进程、preload 与 Jotai 合同；它们不授予 CAT 写入权限。
- Proma 核心触点受 [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md) 和架构测试约束。

## Agent Runtime 与模型渠道

Agent 会话提供两套可切换的运行时：

- **Claude Agent Runtime**：基于 `@anthropic-ai/claude-agent-sdk 0.3.201`，使用 Anthropic Messages API 或兼容端点。
- **Pi Agent Runtime**：基于 `@earendil-works/pi-coding-agent`、`pi-agent-core` 和 `pi-ai 0.82.1`，把已启用的渠道注册为 Pi provider，并承接工作区 Skills、用户 MCP Server、Automation / Collaboration 等通用能力。

当前渠道层包含 ChatGPT subscription/Codex OAuth 和 xAI（Grok/X 订阅）OAuth 的集成路径。模型、工具调用、推理、上下文长度和订阅可用性取决于用户配置、账号、地区与上游 Provider；这些集成不是对模型权限、价格或服务可用性的承诺。

Vision Relay 仅在用户配置后，将当前会话或用户附加的已授权目录中、可安全解码的图片发给单独配置的视觉模型，并以受限 JSON 文本返回给当前 Agent；它不会给文本模型任意路径读取或图片外发权限。

## 本地数据

正式版使用 `~/.linguist-agent/`，开发版使用 `~/.linguist-agent-dev/`：

```text
~/.linguist-agent/
├── channels.json
├── conversations.json
├── conversations/*.jsonl
├── agent-sessions.json
├── agent-sessions/*.jsonl
├── agent-workspaces/
├── attachments/
├── settings.json
├── sdk-config/
├── planning.json
└── linguist/
    ├── projects.json
    ├── projects/<project-id>/
    │   ├── project.json
    │   ├── cat.db
    │   ├── source/
    │   ├── blobs/
    │   ├── exports/
    │   └── backups/
    └── trash/
```

通用会话、设置和 Planning 使用 JSON / JSONL（Planning 权威源为原子 `planning.json`）；SQLite 只用于 CAT 项目的独立 `cat.db`。CAT 项目另有受管 source / blobs / exports / backups 目录。API Key 写入 `channels.json` 前经过 Electron `safeStorage` 加密。

旧 `~/.proma(-dev)/channels.json` 只会在用户从「设置 → 模型配置」显式执行 Provider-only 导入时读取；不会迁移 Proma 会话、设置、工作区或 CAT 数据。旧 Linguist 项目与会话的数据迁移入口位于「设置 → 数据迁移」。详见 [USERDATA_LAYOUT.md](./docs/architecture/USERDATA_LAYOUT.md)。

## 开发与验证

仓库固定使用 Bun `1.3.14`。

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
```

开发与构建：

```bash
bun run dev
bun run electron:build

cd apps/electron
bun run build
bun run sync:runtime-deps
bun run smoke:pack
bun run smoke:vertical
```

`build:resources` 是 fail-closed 步骤，关键资源复制失败不能被 `|| true` 掩盖。测试、smoke 和打包验证必须使用精确临时 `--user-data-dir`，不得读写真实用户数据根。

## 尚未完成的人工 Gate

代码实现和自动化验证不等于产品资格。当前仍需在真实使用中完成：

- 原生 IME composition 与 Native Open 手工验证；Native Save 防覆盖已在隔离 packaged app 克隆中通过；
- VoiceOver、完整键盘路径和拖拽手感；
- 同模型 Web Chat / 旧 LA / 新 LA 的统一专业质量盲评，以及覆盖率、成本和耗时证据；
- 真实 Provider/模型链路与真实客户格式样本回归；
- 14 天连续个人日用与问题回收。

签名、公证、公开更新渠道和跨平台发布不属于当前个人 Alpha 目标。完整状态见 [HANDOFF.md](./docs/HANDOFF.md)、[TODO.md](./TODO.md) 和 [LINGUIST_FUSION_QUEUE.md](./docs/roadmap/LINGUIST_FUSION_QUEUE.md)。

## 文档

文档入口与事实优先级见 [DOCS_INDEX.md](./docs/DOCS_INDEX.md)；维护规则见 [DOCUMENTATION_MAINTENANCE.md](./docs/DOCUMENTATION_MAINTENANCE.md)。

## 许可

[AGPL-3.0](./LICENSE)。保留 Proma 及其他上游组件要求的版权、NOTICE 和第三方归属。
