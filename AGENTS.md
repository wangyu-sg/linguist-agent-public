# Linguist Agent / Proma 工程约定

本文件是 `/Users/<local>/Desktop/linguist-agent-next` 的当前执行指南。Linguist Agent 基于本地优先的 Electron AI 桌面 Agent Proma，仓库使用 Bun monorepo；主应用位于 `apps/electron`，共享包位于 `packages/*`。

## 用户约束

- 功能事实变化时保持本文件与 `README.md` 同步；修改这两份文档前需获得用户允许。
- 只使用 Bun，不混用 npm / pnpm：`bun run dev`、`bun run typecheck`、`bun test`。
- 注释、日志和用户可见的工程文档优先使用中文，保留必要技术术语。
- TypeScript 不使用 `any`；对象类型优先 `interface`，仅类型导入优先 `import type`。
- Renderer 状态统一使用 Jotai。
- 通用 Agent / Chat 数据优先使用配置文件、JSON 和 JSONL，不用 localStorage 作为权威持久化源。CAT 项目已经使用每项目 SQLite `cat.db`；不要把 SQLite 扩散到通用配置，也不要为了“纯文件”重写现有 CAT Store。
- 修改 JSON 配置或会话元数据时，使用 `apps/electron/src/main/lib/safe-file.ts` 的原子写封装，不直接 `writeFileSync`。
- 安装或升级依赖前先查官方来源与现有锁定，不默认使用 `latest`。
- 保持组件和模块可读；完成改动后主动简化，避免 God Module 和过度设计。
- UI 优先复用现有 Radix / Shadcn primitives、主题 token、卡片与层次；覆盖空状态、键盘操作、加载态和深浅主题，不另造设计系统。
- 采用 BDD：先写或确认可观察行为，再实现并回归，至少覆盖正常路径和主要边界。
- 不得把 implemented / unit verified / packaged verified / real-machine verified / release qualified 混写为同一状态。
- 公开文档、许可署名、提交说明和 Release metadata 中的作者姓名只允许使用 `Henry Wang` 或 `Wang Yu`；不得写中文姓名。公开推送前必须同时扫描当前公开树和将变为可达的提交历史。

## 工作规范

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns cleanly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Check documentation and types before assuming a dependency lacks a capability.
- Make architectural decisions for the long term. Do not accept a stopgap intended to be replaced later.
- Study how mature products solve the same problem and reuse proven patterns.

## 产品路线

Linguist Agent 不是精简版 Proma，也不是旧 LA 的继续修补。当前产品结构固定为：

```text
Proma 的完整 Agent + Chat 产品底座
+
Linguist Agent 的 Vertical Agent Profile + CAT Core / Store / Tools / Workbench
```

必须保留 Proma 的 Agent、Chat、Provider、Skills、MCP、Automations、远程桥、Preview、权限、Thinking、Queue / Steer、Planning、Workspace Memory、Files 和 Collaboration。Linguist 是第三个并列模式，不得复制或替换原生 Agent / Chat。

当前目标是作者本人使用的个人 Alpha；没有公开发布计划。签名、公证、跨平台发行和公开更新渠道不是默认阻断项，但安全和数据完整性仍必须 fail closed。

## 当前版本与技术栈

稳定上游基线是 Proma `v0.17.1@6094036d3f6f4363c44ce8a11155ecd531a80aae`。

| 层 | 当前事实 |
|---|---|
| Bun | `1.3.14`（根 `packageManager` 与 CI 固定） |
| Electron App | `@proma/electron 0.17.2` |
| Electron | `43.2.0` |
| React | `18.3.1` |
| Jotai | `2.20.2`（manifest range `^2.17.1`） |
| Vite | `6.4.1`（manifest range `^6.0.3`） |
| Shared | `@proma/shared 0.1.95` |
| Agent Runtime | 仅 `@earendil-works/pi-* 0.82.1` |
| CAT Core | `@linguist/cat-core 0.0.21` |
| CAT Formats | `@linguist/cat-formats 0.0.10` |
| CAT Store | `@linguist/cat-store 0.0.37` |
| CAT Tools | `@linguist/cat-tools 0.0.34` |
| CAT schema | `15` |

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
│   ├── session-core/                # 会话通用能力
│   ├── ui/                          # 共享 React UI
│   ├── linguist-cat-core/           # 纯 CAT 领域
│   ├── linguist-cat-formats/        # 格式 adapters
│   ├── linguist-cat-store/          # 每项目 cat.db / blobs / backup
│   ├── linguist-cat-tools/          # Session-bound Pi tools
│   └── linguist-legacy-migration/   # 旧数据迁移
├── resources/linguist-roles/        # 四岗位 Prompt 唯一真源
├── release-notes/
├── tests/
└── docs/
```

内部包继续使用 `workspace:*`。包名保留 `@proma/*` 是上游继承事实，不代表产品仍与 Proma 共用用户数据根。

## 常用命令

```bash
bun install --frozen-lockfile
bun run dev
bun run build
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

对单一变更优先运行最小相关测试，再运行 `bun run typecheck`。改 Runtime external、同步脚本或打包规则后至少运行 `bun run electron:build`；涉及发布产物时运行目标平台打包冒烟。`build:resources` 必须 fail closed，关键资源复制失败不得用 `|| true` 掩盖。

## 三模式与 Renderer

`PrimaryAppMode` 只有：

```ts
'agent' | 'chat' | 'linguist'
```

- Agent / Chat 必须保持原生 Proma 行为和界面。
- Linguist 使用一等 `LocalizationProjectTab` 和 project-scoped Jotai 状态。
- Workbench 内嵌同一个 `AgentView` 的 rail presentation；Full `AgentView` 保留 Proma Files / Changes 面板，rail 只承载对话。
- Agent 会话树排除带 `linguistProjectId` 的会话；Linguist 侧栏只展示项目绑定会话，并复用 Proma 的侧栏、搜索、项目头、会话行和树行为。
- Linguist 会话必须直接继承 Proma v0.17.1 的 Workspace、Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration，不新增第二套宿主能力。
- 点击项目进入 Workbench，点击会话进入 Full `AgentView`。项目归档、缺失或暂不可用时对话仍可继续，CAT mutation 由项目 Store 状态 fail closed。
- 禁止新增 `LinguistAgentView`、`LinguistComposer`、`LinguistThinkingBlock`、`LinguistToolCard`、`LinguistApprovalCard`、第二套 Agent Session Store 或第二套 Session tree 行为。
- CAT 编辑、Proposal、QA、TM/TB、Context、Preview 和设置位于 `renderer/features/linguist/**`。

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

Renderer 不得向 CAT 服务提交任意文件系统路径或任意 `projectId` authority。项目身份来自当前 Session binding 或主进程验证后的 Project Tab context。

项目重命名、活跃项目排序与 Linguist 会话复制都由主进程重新校验。排序请求必须是当前活跃项目 ID 的完整无重复排列；复制目标必须是其他活跃且健康的项目。Renderer 不得提交目标 binding、原生分叉 ID 或路径，复制失败必须回滚半成品且不得改变源会话。

所有 BrowserWindow 必须显式设置：

```ts
webPreferences: {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
}
```

## Agent Runtime、Workspace 与项目指令

- Proma 仅使用 **Pi Agent Runtime**。不要重新引入 Claude Agent SDK、Nowledge Mem 或其专属配置、session 语义、环境变量和打包依赖。Claude 模型仍可通过 Pi / Provider 使用。
- 用户项目的 `AGENTS.md` 由 `project-instruction-resolver.ts` 在已授权项目根内显式解析；禁止恢复 cwd、祖先目录或附加目录的环境式规则发现。
- Proma 受管工作区的 `AGENTS.md` 与用户项目的 `AGENTS.md` 有不同所有权边界，均须通过已验证的显式路径注入。
- 旧项目 `CLAUDE.md` 仅是兼容输入，不能自动覆盖、合并或删除用户文件。
- 改动 Agent 工具、权限或上下文路径时，检查工作区隔离、附加目录边界、会话恢复与 Automation / Collaboration 回归。

主进程构建 external：

- `electron`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`

打包前运行 `apps/electron/scripts/sync-runtime-deps.ts`，把 external runtime 依赖闭包同步到 appDir。`electron-builder.yml` 必须包含运行时 `node_modules`，并保留 Pi native 内容所需的 `asarUnpack`。每个平台 runner 只构建与宿主架构匹配的产物。

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

- 项目 Agent 可创建并接受 pending Proposal；读取工具不得写入；QA 和 consistency repair 不能直接提交 Segment。
- General 可选择性委派 Translator / Reviewer / Proofreader；子会话必须继承同一 `workspaceId + linguistProjectId` 并冻结 Segment 范围，不得把 Subagent 变成强制流水线。
- Reviewer / Proofreader 用 `cat_confirm_segments` 对冻结范围逐段记录 `unchanged / corrected / blocked`；读取一页或抽样不算完成。
- `Cmd/Ctrl+Enter` 确认当前阶段并前进，即使译文未改也必须可用；`Cmd/Ctrl+S` 只保存实际修改。
- Segment 写入必须经过 revision CAS、locked 与结构 hard-rule 检查。术语上下文、QA 与写回门禁共用 scope-aware evaluator；普通数字、换行、长度和 token 差异默认进入 QA，不作结构硬拦。
- 项目 Agent 可把批次以 `verified` 或 `as-is` 保存到用户指定的绝对本地路径；默认不覆盖，只有用户明确要求时才原子覆盖普通文件。
- 原生导入使用同一入口选择多文件或文件夹；原生导出提供 `verified` 和需显式确认的 `as-is`。Renderer 不得提交任意粘贴路径。
- 导出必须从受管 source blob 生成，先过 QA / 阶段预检并重新导入验证。
- 输出给模型和 renderer 的 DTO 不暴露绝对本机路径。

`LinguistProjectService` 是现有门面，内部按 lifecycle、resources、quality、delivery 和稳定类型合同分层。CAT Tool 工厂位于 `packages/linguist-cat-tools/src/factory.ts`；31 个工具按项目、参考、QA、Proposal、阶段确认、导入、交付、Tag、术语、Workbook 和 Voice 拆分，四岗位共享同一完整 Toolset。主进程必须重新校验 Session binding、文件可读性、交付模式与摘要，模型不得提交 `projectId`。

同一项目可持续接收多个批次；批次是任务源文件，语言资产是 TM/TB/Style Guide/Context 等项目级资料，不得混为“全部资产”。XLSX 批次与 TM/TB 导入必须确认 Sheet / 列 mapping；复用 mapping 时歧义必须 fail closed，`locked` 列贯穿预览、保存和导入。只有已确认当前阶段的 Segment 可设为 approved exemplar。原生 SDLTM / SDLTB 可导入；批次源文件与保留原件的语言资产复用 Proma Preview Tab。受管 Context 图片通过现有读取工具作为 Pi 视觉内容提供，不新增 OCR 平台或图片数据库。

## 数据目录

正式版使用 `~/.linguist-agent/`，开发版使用 `~/.linguist-agent-dev/`。通用配置使用原子 JSON / JSONL；SQLite 只用于 `linguist/projects/<project-id>/cat.db`。旧 `~/.proma(-dev)/channels.json` 只允许在用户从设置中明确选择 Provider-only 导入时读取，不得静默共用或迁移其他数据。

不要在测试、smoke 或打包验证中读写真实用户根；必须使用精确临时 `--user-data-dir` 与任务专用临时目录。

## Provider

Chat 与 Pi 支持多 Provider；Claude 模型通过 Anthropic 协议 Provider 使用，ChatGPT subscription 通过 Codex OAuth 路径使用。Provider 配置入口在“设置 → 模型配置”。

API Key 写入 `channels.json` 前必须经 Electron `safeStorage` 加密。Provider 导入失败必须零写入，并通过同目录原子替换提交最终配置。

## 默认 Skills、版本与提交

- 修改 `apps/electron/default-skills/<skill>/` 任意内容时，必须同步递增该 Skill `SKILL.md` frontmatter 的 `version` patch，确保老工作区获得更新。
- 每次提交至少递增对应交付物的 patch 版本；跨多个可发布包时逐个递增受影响包。
- `apps/electron/package.json` 是桌面应用版本，`packages/*/package.json` 是共享包版本。
- 仅在功能行为、安装方式或用户流程变化时更新 README / tutorial / release notes；修改 README 前先取得用户授权。
- 提交前检查 `git diff`，不要覆盖用户已有改动或提交无关文件。

## 架构触点

Proma 核心文件修改必须遵守：

- [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md)
- `docs/architecture/proma-touchpoints.json`
- `bun run check:boundaries`
- `node --test tests/linguist-fusion-architecture.test.mjs`

新 LA 代码优先放在已白名单的 Linguist 路径。不得让 CAT Core 反向依赖 Proma，也不得绕开触点登记修改 Proma 核心。

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
- `CURRENT_FACTS_SIMPLE.md`
- `docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md`
- `docs/roadmap/LINGUIST_FUSION_CURRENT_REALITY.md`

历史报告不得作为当前代码说明。G8 盲评、LF-048 的 IME / Native Open / Save、AC-009 产品资格和 AC-011 14 天日用在取得真实证据前必须保持 pending / blocked。
