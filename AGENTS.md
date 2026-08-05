# AGENTS.md

本文件是 `/Users/<local>/Desktop/linguist-agent-next` 的当前执行指南。

## 用户约束

- 功能事实变化时保持本文件与 `README.md` 同步；修改这两份文档前需获得用户允许。
- 注释和日志优先使用中文，必要的专业术语保留英文。
- 安装或升级依赖前先查官方来源与现有锁定，不默认使用 `latest`。
- Renderer 状态统一使用 Jotai。
- 通用 Agent/Chat 数据优先用配置文件、JSON 和 JSONL，不用 localStorage 作为权威持久化源。
- CAT 项目已经使用每项目 SQLite `cat.db`；不要把 SQLite 扩散到通用配置，也不要为了“纯文件”重写现有 CAT Store。
- 保持组件和模块可读；完成改动后主动简化，避免 God Module 和过度设计。
- UI 使用现代方案，优先复用现有 Radix / Shadcn 风格 primitives、主题 token、卡片与层次；不要另造一套设计系统。
- 采用 BDD：先写或确认可观察行为，再实现并回归。
- 不得把“implemented / unit verified / packaged verified / real-machine verified / release qualified”混写为同一状态。
- 公开文档、许可署名、提交说明和 Release metadata 中的作者姓名只允许使用 `Henry Wang` 或 `Wang Yu`；不得写中文姓名。公开推送前必须同时扫描当前公开树和将变为可达的提交历史。

## 产品路线

Linguist Agent 不是精简版 Proma，也不是旧 LA 的继续修补。当前产品结构固定为：

```text
Proma 的完整 Agent + Chat 产品底座
+
Linguist Agent 的 Vertical Agent Profile + CAT Core / Store / Tools / Workbench
```

必须保留 Proma 的 Agent、Chat、Provider、Skills、MCP、Automations、远程桥、Preview、权限、Thinking、Queue / Steer 等完整能力。Linguist 是第三个并列模式，不得复制或替换原生 Agent/Chat。

当前目标是作者本人使用的个人 Alpha；没有公开发布计划。签名、公证、跨平台发行和公开更新渠道不是默认阻断项，但安全和数据完整性仍必须 fail closed。

## 当前版本与技术栈

| 层 | 当前事实 |
|---|---|
| Bun | `1.3.14`（根 `packageManager` 与 CI 固定） |
| Electron App | `@proma/electron 0.16.15` |
| Electron | `43.2.0` |
| React | `18.3.1` |
| Jotai | `2.17.1` |
| Vite | `6.0.3` |
| Shared | `@proma/shared 0.1.82` |
| Claude Runtime | `@anthropic-ai/claude-agent-sdk 0.3.201` |
| Pi Runtime（Electron App） | `@earendil-works/pi-* 0.82.1` |
| CAT Core | `@linguist/cat-core 0.0.13` |
| CAT Store | `@linguist/cat-store 0.0.26` |
| CAT Tools | `@linguist/cat-tools 0.0.20` |
| CAT schema | `13` |

不要从旧报告或 README 复制版本；以各 `package.json` 和 `bun.lock` 为准。

## Monorepo

```text
linguist-agent-next/
├── apps/
│   ├── electron/                    # Electron 主产品
│   └── cli/                         # 本地 CLI
├── packages/
│   ├── shared/                      # @proma/shared
│   ├── core/                        # Provider adapters
│   ├── ui/                          # 共享 React UI
│   ├── linguist-cat-core/           # 纯 CAT 领域
│   ├── linguist-cat-formats/        # 格式 adapters
│   ├── linguist-cat-store/          # 每项目 cat.db / blobs / backup
│   ├── linguist-cat-tools/          # Session-bound Pi tools
│   └── linguist-legacy-migration/   # 旧数据迁移
├── resources/linguist-skills/       # 仅项目 Session 注入的 LA Skills
├── tests/                           # 根架构/边界测试
└── docs/
```

内部包继续使用 `workspace:*`。包名保留 `@proma/*` 是上游继承事实，不代表产品仍与 Proma 共用用户数据根。

## 常用命令

```bash
bun install --frozen-lockfile
bun run dev
bun run electron:build
bun run electron:start
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
bun run --filter='@linguist/cat-tools' test
```

打包验证：

```bash
cd apps/electron
bun run build
bun run sync:runtime-deps
bun run smoke:pack
bun run smoke:vertical
```

`build:resources` 必须 fail closed；关键资源复制失败不得用 `|| true` 掩盖。

## 三模式与 Renderer

`PrimaryAppMode` 只有：

```ts
'agent' | 'chat' | 'linguist'
```

- Agent / Chat 必须保持原生 Proma 行为和界面。
- Linguist 使用一等 `LocalizationProjectTab` 和 project-scoped Jotai 状态。
- Workbench 内嵌同一个 `AgentView` 的 rail presentation。
- Agent 会话树必须排除带 `linguistProjectId` 的会话；Linguist 侧栏只展示项目绑定会话，并复用 Agent 的会话行与树行为。
- Linguist 中点击项目进入 Workbench，点击会话进入 Full `AgentView`；归档或缺失项目的历史只能只读打开，发送与 CAT mutation 必须 fail closed。
- 禁止新增 `LinguistAgentView`、`LinguistComposer`、`LinguistThinkingBlock`、`LinguistToolCard`、`LinguistApprovalCard` 或第二套 Agent Session Store。
- 禁止新增第二套 Session tree 状态、排序、委派、置顶、最近会话或 MiniMap 行为实现；项目域只提供分组与动作适配。
- CAT 编辑、Proposal、QA、TM/TB、Context、Preview 和设置位于 `renderer/features/linguist/**`。
- 上游 v0.16.8 的 Planning（Todo、日程、提醒和 Agent 引用）、Agent Island、统一项目/会话文件能力与 Pi `0.82.1` Runtime 都是同一 Agent/Chat 底座的一部分。通过既有 main service、preload 和 Jotai 合同接入；不得为 Linguist 新建第二套 Planning、Island 或文件 authority 状态。

核心 Renderer 组合仍在：

- `renderer/main.tsx`：全局初始化和 IPC listeners；
- `renderer/components/app-shell/`：模式、侧栏与主布局；
- `renderer/components/agent/`：唯一 Agent UI；
- `renderer/components/chat/`：唯一 Chat UI；
- `renderer/features/linguist/`：Linguist 组合层。

## IPC 约定

新增或修改 IPC 必须同步四层：

```text
@proma/shared 类型/通道
→ main handler/service
→ preload contextBridge
→ renderer Jotai/action
```

Renderer 不得向 CAT 服务提交任意文件系统路径或任意 projectId authority。项目身份来自当前 Session binding 或主进程验证后的 Project Tab context。

项目重命名、活跃项目排序与 Linguist 会话复制都由主进程重新校验。排序请求必须是当前活跃项目 ID 的完整无重复排列；复制目标必须是其他活跃且健康的项目。Renderer 不得提交目标 binding、原生分叉 ID 或路径，复制任一步失败必须回滚半成品且不得改变源会话。

所有 BrowserWindow 必须显式设置：

```ts
webPreferences: {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
}
```

## CAT 分层

```text
Linguist Workbench / Agent Rail
        ↓ IPC / Session binding
Electron Linguist Services
        ↓
@linguist/cat-tools / @linguist/cat-store
        ↓
@linguist/cat-core
```

`@linguist/cat-core` 生产代码不得依赖 React、Electron、`@proma/ui`、SQLite 或 Node 文件系统。

CAT 写入规则：

- 模型只能创建 pending Proposal；
- 读取工具不得写入；
- QA、Critic 和 consistency repair 不能直接提交 Segment；
- CAT 编辑器的 `Cmd/Ctrl+Enter` 表示确认当前阶段并前进，即使译文未改也必须可用；`Cmd/Ctrl+S` 仍只保存实际修改；
- Segment 写入必须经过人工操作、revision CAS、locked 与 hard-rule 检查；
- 导出必须从受管 source blob 生成，先过 QA / 阶段预检并重新导入验证；
- 输出给模型和 renderer 的 DTO 不暴露绝对本机路径。

`LinguistProjectService` 是兼容门面，内部拆分为：

- `project-service.ts`：生命周期、句柄、健康、备份与配置；
- `project-resources.ts`：TM/TB、语言资产、Context；
- `project-quality.ts`：Workbench 查询、编辑、阶段与 QA；
- `project-delivery.ts`：导入、交付预检与导出；
- `project-service-types.ts`：稳定调用合同。

CAT Tool 对外工厂是 `packages/linguist-cat-tools/src/factory.ts`；17 个工具按 `project-tools`、`reference-tools`、`qa-tools`、`proposal-tools`、`intake-tools` 拆分，`tool-runtime.ts` 集中 Session authority、通知与结果投影。Intake 当前只接受会话明确附加的单文件，不包含目录扫描或 Durable Import Job。

## 数据目录

正式版：

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

Planning 使用通用配置根中的原子 `planning.json`；SQLite 仍只用于 CAT 的每项目 `cat.db`。开发版使用 `~/.linguist-agent-dev/`。旧 `~/.proma(-dev)/channels.json` 只允许在用户从「设置 → 模型配置」明确选择 Provider-only 导入时读取，不得静默共用或迁移其他数据。

不要在测试、smoke 或打包验证中读写真实用户根；必须使用精确临时 `--user-data-dir` 与任务专用临时目录。

## Agent Runtime 与打包

主进程构建 external：

- `electron`
- `@anthropic-ai/claude-agent-sdk`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`

打包前运行 `apps/electron/scripts/sync-runtime-deps.ts`，把 external runtime 依赖闭包同步到 appDir。`electron-builder.yml` 必须包含运行时 `node_modules`，并对 Anthropic 与 Pi native 内容配置 `asarUnpack`。

Claude SDK 平台包由 `optionalDependencies` 固定为 `0.3.201`；Electron App 使用的 Pi runtime 包固定为 `0.82.1`。每个平台 runner 只构建与宿主架构匹配的产物。不要恢复旧的 `Codex-agent-sdk`、`cli.js` 或 0.2.x 打包说明。

## Provider

Chat 与 Pi 继续支持多 Provider；Claude Runtime 使用 Anthropic 协议或 ChatGPT subscription/Codex OAuth 路径。Provider 配置入口在「设置 → 模型配置」。

API Key 写入 `channels.json` 前必须经 Electron `safeStorage` 加密。Provider 导入失败必须零写入，并通过同目录原子替换提交最终配置。

## 版本规则

提交代码时递增所有受影响 workspace 包的 patch 版本。只修改文档、测试名称或注释时，若同时触及可发布包源码，也按受影响包递增。

修改 `apps/electron/default-skills/<skill>/` 任意内容时，必须同步递增该 Skill `SKILL.md` frontmatter 的 `version` patch；老工作区依赖 semver 比较获得更新。

## 架构触点

Proma 核心文件修改必须遵守：

- [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md)
- `docs/architecture/proma-touchpoints.json`
- `bun run check:boundaries`
- `node --test tests/linguist-fusion-architecture.test.mjs`

新 LA 代码优先放在已白名单的 Linguist 路径。不得为了方便让 CAT Core 反向依赖 Proma，也不得绕开触点登记直接修改 Proma 核心。

## 文档状态纪律

事实优先级：

```text
代码 / package.json / 测试 / 真实运行输出
> 机器队列与当前事实文档
> README / HANDOFF / TODO
> 历史 Gate 报告
```

当前入口：

- `docs/DOCS_INDEX.md`
- `docs/HANDOFF.md`
- `TODO.md`
- `docs/roadmap/linguist-fusion-queue.json`
- `docs/roadmap/LINGUIST_FUSION_CURRENT_REALITY.md`

历史报告不得被当作当前代码说明。G8 盲评、LF-048 的 IME/Native Open、AC-009 产品资格和 AC-011 14 天日用在取得真实证据前必须保持 pending / blocked；Native Save 防覆盖已有单独 packaged 手工证据。
