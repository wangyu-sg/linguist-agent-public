# Proma Core Touchpoints — 上游修改边界登记

> 基线：`702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（upstream main at clone time，见 `UPSTREAM_BASELINE.md`）
> 机读登记：`docs/architecture/proma-touchpoints.json`
> 强制测试：`tests/upstream-boundary.test.ts`（`bun run check:boundaries`）

本文件登记自上游基线以来 **所有被修改的 Proma 核心文件**，每条注明所属票（PB/LF/AC）与修改原因。目的：防止后续贡献者（包括 AI 编码代理）随意改动 Proma 核心，保证未来 rebase / merge 上游时可审计。

## 规则（对后续所有批次有效）

1. **新 LA 代码必须进约定路径**，不得散落进 Proma 目录：
   - renderer：`apps/electron/src/renderer/features/linguist/**`
   - main 进程集成：`apps/electron/src/main/lib/linguist/**`
   - 新包：`packages/linguist-*/`
   - skills：`resources/linguist-skills/`
   - fixtures / 根级测试：`tests/`
   - 文档：`docs/` 任意位置
   - 打包 smoke harness：`apps/electron/scripts/smoke/`（既有）
   - 例外（白名单，见 `allowedNewPaths`）：`.gitignore`、`AGENTS.md`、`TODO.md`、`NOTICE.md`、`ATTRIBUTION.md`、`README*`、账本文件（在 `docs/` 内）
   - CI：`.github/workflows/ci.yml` 是 Fusion 新增门禁的精确白名单路径；既有 Release Workflow 仍按触点登记
2. **修改任何 Proma 核心文件**（不在上述白名单内的文件），必须在**同一 commit** 内：
   - 在 `proma-touchpoints.json` 登记 `file` + `ticket` + `reason`；
   - 在本文件对应票的分节下补一条人读记录。
3. **边界测试即强制执行**：`tests/upstream-boundary.test.ts` 对比 `git diff --name-only <baseline>...HEAD`：
   - 有改动文件既不在白名单也未登记 → **FAIL** 并列出文件；
   - 登记了但相对基线已无改动（stale 条目）→ **FAIL**。
   - 测试比较的是 **HEAD（已提交内容）**，因此必须在 **pre-push / 门禁阶段** 运行（未提交改动不在 diff 中）。git 不可用时测试跳过（打印警告），不会令套件失败。
4. colocated 测试（与 Proma 源文件同目录的 `*.test.ts`）虽是上游惯例，但仍属 Proma 区域新文件，同样要求登记（现有 2 条先例见下）。

## LF-004：Linguist Fusion 单一实现合同

> 架构测试：`tests/linguist-fusion-architecture.test.mjs`
> 运行：`node --test tests/linguist-fusion-architecture.test.mjs`

本合同补充 PB-014 的“修改文件登记”规则。PB-014 回答哪些 Proma 文件被修改；LF-004 回答 Linguist 是否复制了 Proma Agent 能力、CAT Core 是否发生反向依赖。

### Agent 基础能力的唯一所有者

| 能力 | Proma 原生所有者 | Linguist 允许的接入方式 |
| --- | --- | --- |
| Agent 工作区 | `components/agent/AgentView.tsx` | 复用同一组件；仅增加窄 `presentation` / slot |
| 消息流与渲染 | `AgentMessages.tsx`、`SDKMessageRenderer.tsx`、`ContentBlock.tsx` | 复用同一 Session Store 和 Renderer |
| Thinking / Tool Activity | `ContentBlock.tsx`、`ProcessBlockGroup.tsx` | 复用原生 content block 与工具生命周期 |
| Composer | `AgentView.tsx` 现有输入区与 `ai-elements/rich-text-input.tsx` | 仅传项目上下文 chip，不另建输入器 |
| Approval / AskUser | `PermissionBanner.tsx`、`AskUserBanner.tsx` | 复用原生请求队列和响应路径 |
| Queue / Steer | `AgentMessageQueue.tsx` 与 Agent atoms | 复用原生队列状态和操作 |

Linguist feature 禁止声明计划 §6.1 列出的第二套组件，包括 `LinguistAgentView`、`LinguistComposer`、`LinguistThinkingBlock`、`LinguistToolCard`、`LinguistApprovalCard` 和 `LinguistQueue`。架构测试守卫明确的文件名与声明名；语义等价但刻意改名的复制仍需代码审查拦截。

### CAT Core 纯领域合同

`packages/linguist-cat-core` 可以依赖自身相对模块和无 UI 的 Node 标准库能力，但生产源码及运行时依赖不得引入：

- `react` / `react-dom`；
- `electron`；
- `@proma/ui`。

React 展示、Electron IPC、Proma Agent 适配分别留在 Renderer、Main/Preload 和 CAT Tools 装配缝，不能反向进入 CAT Core。

### 当前 Proma → Linguist 组合触点

LF-004 建立时存在三个反向 import，架构测试将它们作为封闭集合：允许后续删除，不允许新增 importer。

| 文件 | 当前原因 | 收窄方向 |
| --- | --- | --- |
| `components/tabs/MainArea.tsx` | 应用组合根渲染旧 Projects 页面 | Linguist Project Tab 落地后由组合根装配 Workbench |
| `components/agent/AgentHeader.tsx` | 项目 Session binding 徽章/提示 | 改为窄 header slot / context summary prop |
| `components/agent/SidePanel.tsx` | 旧项目 Deliverables rail | 新 Workbench 验证后删除旧接线 |

新增 Linguist 能力的优先顺序保持：

```text
Linguist feature 内组合 Proma 原生模块
>
给 Proma 原生模块增加窄 prop / slot
>
修改 Proma 内部行为
```

## AC-001：正常 CI 与根测试零失败

- `.github/workflows/ci.yml`（精确白名单）— Push/PR/手动触发验证，覆盖 frozen install、typecheck、根测试、CAT 分层测试、安全/架构门禁、许可扫描和 Electron build；Actions 固定 commit SHA，Bun 固定 1.3.14。
- `.github/workflows/release.yml` — Actions 固定 commit SHA，Bun 固定 1.3.14；发布任务依赖收口留给 AC-002。
- `package.json` / `bun.lock` / `apps/electron/package.json` — 固定 Bun 与 `@types/bun`，同步 patch 版本。
- `apps/electron/src/main/lib/test/electron-mock.ts`（新文件）与四个主进程测试 — 统一 Bun 全套测试共享的 Electron mock 导出面，消除测试加载顺序导致的 2 个根测试失败。
- `tests/upstream-boundary.test.ts` — 触点票号校验接受 PB/LF/AC 三类执行票。

## LF-010：主模式加入 Linguist

- `atoms/app-mode.ts` / `app-mode.test.ts` — 主模式收敛为 Agent/Chat/Linguist，历史 scratch 或损坏值回落 Agent。
- `components/shortcuts/GlobalShortcuts.tsx` / `components/welcome/WelcomeEmptyState.tsx` — 主模式入口不再把 Scratch 当作第四种模式。
- `hooks/useOpenSession.ts` — Scratch、教程等辅助 Tab 保持 Agent 主模式；未提前伪造 Localization Project Tab。
- `apps/electron/package.json` / `bun.lock` — Electron patch 同步到 0.15.48。

## LF-030：Agent Full 模式行为契约

- `components/agent/AgentView.tsx` — 原生 Full 根节点增加稳定 `data-agent-presentation="full"` 标记；零布局/行为变化。
- `tests/agent-full-mode-contract.test.ts`（根测试白名单）— 锁定原生 Header、Messages、Composer、工具生命周期、恢复动作、审批、队列/Steer、标题与 Preview 接线。
- `apps/electron/package.json` / `bun.lock` — Electron patch 同步到 0.15.49。

## AC-002：Release Workflow fail-closed

- `.github/workflows/ci.yml`（精确白名单）— 增加 `workflow_call`，让 Release 复用 AC-001 的完整验证而不复制步骤。
- `.github/workflows/release.yml` — 三个平台发布构建都 `needs: validate`；许可扫描包含在完整 CI 中；macOS 第三次失败显式 `exit 1`。
- `apps/electron/package.json` / `bun.lock` — `build:resources` 不再吞掉复制失败，Electron patch 同步到 0.15.50。
- `tests/release-workflow-fail-closed.test.ts`（根测试白名单）— 锁定上述发布链合同。

## AC-003：Linguist Agent 独立数据根与显式 Provider 导入

- CLI、主进程各持久化服务、Renderer 路径说明、Shared 配置契约与内置 Skills 统一改用 `~/.linguist-agent/`；开发版使用 `~/.linguist-agent-dev/`。
- `config-paths.ts` 是唯一根目录 seam；会话、工作区、附件、工具、Bots、代理、主题、用户档案和系统提示词不再与 Proma 静默共用。
- `electron-user-data-path.ts` / `.test.ts` 显式隔离 Electron Chromium userData、缓存与 SingletonLock；命令行 `--user-data-dir` 覆盖仅供隔离烟测等显式启动场景使用。
- 旧 `~/.proma(-dev)/channels.json` 只可由用户从「设置 → 模型配置」显式导入 Provider；不自动迁移 Session、Settings 或项目。
- `apps/cli`、Electron/Shared 包与受影响 default skills 均按版本契约递增；零新依赖。

## LF-011：三段主模式切换器

- `components/app-shell/ModeSwitcher.tsx` — Agent/Chat/Linguist 三段入口；Linguist 只切主模式，不伪造 Agent 会话。
- `mode-switcher-utils.ts` / `.test.ts` — 三等分滑块及可访问键盘循环导航的纯函数与 BDD。
- `hooks/useSwitchAppMode.ts`（兼 LF-014）— 所有入口共享模式恢复策略：Agent/Chat 复用原生 Session，Linguist 恢复 Project Tab，避免侧栏、快捷键与主区状态分裂。
- `apps/electron/package.json` / `bun.lock` — Electron patch 同步到 0.15.51。

## LF-031：AgentView 原生复用 seam

- `components/agent/AgentView.tsx` — 新增默认 `full`、可选 `rail` presentation；同一 SessionProvider、Messages、Composer、Queue/Approval。
- `AgentHeader.tsx` / `AgentMessages.tsx` — compact 只改变 Header/消息间距与嵌入式拖拽区。
- `tests/agent-full-mode-contract.test.ts`（根测试白名单）— Full 契约扩为 Full/Rail 单一实现合同。
- `apps/electron/package.json` / `bun.lock` — Electron patch 同步到 0.15.52。

## LF-012：折叠侧栏 Linguist 入口

- `components/app-shell/LeftSidebar.tsx` — 折叠 Rail 增加 icon-only Linguist 按钮、Tooltip 与 active 状态。
- `ModeSwitcher.tsx` / `mode-switcher-utils.ts` / `.test.ts` — Agent/Chat 恢复 Session，Linguist 只切主模式；判别 Tab 安全收窄。
- `apps/electron/package.json` / `bun.lock` — Electron patch 同步到 0.15.53。

## 登记总览

| 票 | 触点数（按主票归组） | 主题 |
| --- | --- | --- |
| PB-004 | 2 | 打包 smoke harness（package.json 脚本 + 锁文件） |
| PB-010 | 19 | LA minimal branding |
| PB-011 | 3 | Pi 成为唯一可见 runtime（D-002） |
| PB-012 | 8 | 统一 Feature Flags（D-007） |
| PB-013 | 3 | Projects 导航壳 |
| PB-014 | 1 | 本票：check:boundaries 脚本 |
| PB-022 | 0（+1 多票共改） | cat-formats 包：workspace 锁文件条目（与 PB-004 同一条目） |
| PB-024 | 0（+1 多票共改） | cat-store 包：workspace 锁文件条目（追加到 bun.lock 条目） |
| PB-030 | 0（+3 多票共改） | 主进程 CAT 项目服务接线：index.ts 启动/退出钩、package.json 脚本 + devDeps、bun.lock |
| PB-031 | 4 | Linguist 项目 typed IPC：ipc.ts 通道注册、preload 方法面、shared types 契约（+桶文件） |
| PB-032 | 0（+3 多票共改） | Project 列表与创建 UI（视图本体在白名单路径；feature-flags / active-view / MainArea 仅注释更新） |
| PB-033 | 0（+3 多票共改） | 导入 UI：getSummary 契约扩展 assets 列表（shared types + ipc.ts / preload 注释随动；服务/处理器/UI 在白名单路径） |
| PB-034 | 4（+3 多票共改） | 项目会话绑定：AgentSessionMeta 绑定字段 + ErrorCode（shared agent.ts）、agent-session-manager 绑定写入/冻结、agent-orchestrator 归档发送闸门、AgentHeader 徽章/通告挂载点（+ shared linguist.ts 契约 / ipc.ts / preload 三处既有条目追加） |
| PB-040 | 0（+2 多票共改） | 常驻项目 Skill：agent-orchestrator 在既有 additionalSkillPaths 缝按绑定注入、electron-builder.yml extraResources 收编 resources/linguist-skills（Skill 本体/解析/测试/探针全在白名单路径） |
| PB-041 | 0（+1 多票共改） | 只读 CAT 工具包：workspace 锁文件条目（追加到 bun.lock 条目） |
| PB-042 | 0（+3 多票共改） | CAT 工具接入 Pi customTools：agent-orchestrator 装配缝追加（既有条目）、package.json 新增 @linguist/cat-tools devDep（既有条目）、bun.lock（既有条目）；解析模块/测试/探针全在白名单路径 |
| PB-043 | 3（+2 多票共改） | CAT Tool Activity 中文语义短语与辅助显示名；Electron patch 版本同步到 package.json/bun.lock |
| PB-044 | 0（+2 多票共改） | Project Chat 打包真机 smoke；fake 场景/探针在白名单，Electron patch 版本同步到 package.json/bun.lock |
| PB-050 | 0（+1 多票共改） | Proposal Domain/Repository：实现位于白名单 packages/linguist-*；bun.lock 同步 cat-core/cat-store patch 版本 |
| PB-051 | 0（+5 多票共改） | Proposal Tool：六工具接线在白名单；复用既有 Tool Activity 入口；package/bun 版本同步 |
| PB-052 | 0（+2 多票共改） | 确定性硬门位于白名单 cat-core；Electron package/bun 版本同步 |
| PB-063 | 0（+6 多票共改） | Context Rail：只读 getContext 契约经 shared/ipc/preload 既有触点接线；UI/处理器/测试在 Linguist 白名单；package/bun 版本同步 |
| PB-071 | 2（+8 多票共改） | QA Tool/UI：四个 QA IPC、Agent 活动文案、共享契约；另修复 Hermetic Smoke 的 Keychain 弹窗 |
| PB-072 | 0（+4 多票共改） | Export staging：导出 QA 阻断稳定码与 workspace 版本同步 |
| PB-073 | 0（+5 多票共改） | Native Save：主进程 staging → `dialog.showSaveDialog` → copy；renderer 只交项目/资产 ID |
| PB-074 | 0（+2 多票共改） | G7 自动纵向探针与 `smoke:g7` 入口；原生 Open/Save 真机步骤明确保留人工验证 |
| PB-080 | 0（+6 多票共改） | TM/TB 管理：reference 五通道与原生导入 picker 经既有触点接线；解析器/仓储/schema v4/UI/测试全在白名单；cat-formats 新增 @xmldom/xmldom runtime dep |
| PB-081 | 0（+4 多票共改） | XLSX adapter：解析器/测试在白名单 cat-formats；shared 导入白名单加 xlsx、picker 标签同步；cat-formats 新增 jszip runtime dep |
| PB-086 | 0（+3 多票共改） | SDLXLIFF adapter：独立 adapter 复用 xliff-xml 层；shared 白名单加 sdlxliff；零新依赖 |
| PB-087 | 0（+3 多票共改） | Phrase MXLIFF adapter：独立 adapter 复用 xliff-xml 层；shared 白名单加 mxliff；零新依赖 |
| PB-088 | 0（+3 多票共改） | Phrase bilingual DOCX adapter：jszip+正则扫描段行（cells[0]=id/cells[3]=source/cells[4]=target）；shared 白名单加 docx；零新依赖 |
| PB-083 | 0（+1 多票共改） | Independent Critic：契约提取进 cat-core 白名单、schema v5/工具/评审 Skill 均在 Linguist 白名单；仅 Electron 版本同步走既有触点 |
| PB-082 | 0（+7 多票共改） | 质量策略档 Fast/Balanced/Best：策略表/project.json 字段/工具注入在白名单；shared 契约、main/preload 通道注册、会话角色冻结、版本同步走既有触点 |
| PB-084 | 0（+1 多票共改） | Batch Consistency：投影进 cat-core 白名单、第十个工具在 cat-tools 白名单；仅 Electron 版本/注释同步走既有触点 |
| PB-090 | 0（+1 多票共改） | Legacy Scanner：新包 linguist-legacy-migration 在白名单 packages/linguist-*；仅 bun.lock 登记新 workspace 包走既有触点 |
| PB-091 | 0（+1 多票共改） | Legacy Project Import：导入器在同白名单包内演进；仅 bun.lock 工作区依赖登记走既有触点 |
| PB-092 | 0 | 损坏/跨 root 处置层：全部在白名单包内（disposition/extract/import 增量）；零依赖零触点变化 |
| PB-093 | 0 | Legacy Chat Transcript：全部在白名单包内（chat-transcript/extract/import 增量）；零依赖零触点变化 |
| PB-094 | 0（+5 多票共改） | Migration UI/Report：shared 契约、main/preload 通道注册、electron 版本与 lock 追平走既有触点；编排服务与向导 UI 在白名单 |
| PB-100 | 2（新触点） | LA Design Tokens：globals.css 与 tailwind.config.js 两个新触点（@layer base 尾部增量块零重排）；token 值 LA 原创带来源标注 |
| PB-095 | 0（+7 多票共改） | 项目资产六类：schema v6/五仓储/blobs/两新工具/注入模块/IPC 编排/四面板全在白名单；shared 契约、main/preload/orchestrator 接线、版本同步走既有触点 |
| PB-096 | 0（+4 多票共改） | QA 契约对齐+Xbench 覆盖：契约层/schema v7/批次1检查/迁移映射/面板全在白名单；shared 契约与双端版本同步走既有触点 |
| PB-097 | 0 | Tag profile 引擎：族注册表/匹配管线/配平栈/tagProfile 字段全在白名单；三处校验链调用点接线在白名单；零触点变化 |
| PB-101 | 11（+2 多票共改） | Thread/Composer 精修：agent 组件族与 ai-elements/message、ui/spinner 共 11 条新触点；SDKMessageRenderer/AgentView 追加；divider 纯逻辑 colocated；契约测试在白名单 tests/ |
| PB-102 | 26（+8 多票共改） | Shell/Right Rail 精修：Skills 降 footer、right-rail-policy 编排纯函数、交付物区（ linguist.exports.list 只读通道）、布局锚点 token、settings/agent-skills 等 26 条新触点；shared/ipc/preload/LeftSidebar/globals.css/tailwind.config 等 8 条既有追加 |
| PB-103 | 7（+4 多票共改） | Approval/Plan/Compaction 精修：三 banner inline 化（AgentMessages inlineBanner 插槽）、permission-scope 纯函数、Plan 条件展示、压缩失败重试、审批族 raw palette 迁移，7 条新触点；AgentView/AgentMessages/SDKMessageRenderer/AskUserBanner 既有追加 |
| PB-111 | 0（+3 多票共改） | Backup/Restore：全量备份+manifest+verify+整体替换恢复+回滚全在白名单；shared/ipc/preload 既有追加 |
| PB-110 | 0 | CAT 安全审查：八项证明全部落白名单（cat-store/main linguist）；日志纪律修复与 importAsset 次序调换零触点变化 |
| PB-104 | 1（+2 多票共改） | CAT 视觉精修：九项票面全部落在白名单 features/linguist/；review token 三件套追加 globals.css/tailwind.config.js；MigrationImportDialog 29 处 raw palette 迁移为新触点；linguist 域 8 文件纳入 no-raw-palette 契约（tests/ 白名单） |
| PB-113 | 4（+2 多票共改） | 隐藏评估与去品牌化：AppearanceSettings/tab-atoms/tutorial-service/tutorial.md 四条新触点；ipc.ts（图标解析主进程兜底）与 SettingsPanel（教程 Tab 标签）既有追加；六项评估结论零删除（FEATURE_FLAGS.md 记档） |
| PB-114 | 0（+3 多票共改） | 签名/公证/更新：electron-builder.yml publish 改指 wangyu-sg/linguist-agent-public + win fileAssociations 显示名补改 LA；package.json/bun.lock 版本 0.15.42；凭据项 blocked 记 docs/release/PB114_RELEASE_READINESS.md |
| PB-115 | 1（+5 多票共改） | 公开发行治理：NOTICE/ATTRIBUTION/SECURITY/CONTRIBUTING/THIRD_PARTY_NOTICES/SBOM 全套 + license:scan 门禁；release.yml（基线文件首次修改，license-scan job）为新触点，SECURITY/CONTRIBUTING/THIRD_PARTY_NOTICES/scripts/ 入 allowedNewPaths；AboutSettings/agent-orchestrator/根 package.json/package.json(electron)/bun.lock 五既有追加；user-agent.ts 回退不改（UA 服务端白名单） |
| PB-089 | 0（+5 多票共改） | CAT 资产源文件预览（计划外增补票）：linguist.project.previewAssetSource 三态分派；shared 契约/ipc/preload/package.json/bun.lock 五既有追加；service/handler/UI/nodetest 全在白名单 |
| AC-008 | 14（+14 多票共改） | 原生界面无障碍收口：图标按钮名称、嵌套交互修复、键盘可达与 Axe 色彩对比回归 |
| LF-074 | 0（+2 多票共改） | 删除零消费者 ProjectDetail 工作导航；Electron 版本与 lock 走既有触点 |
| LF-077 | 1（+8 多票共改） | 登记 active-view BDD；Projects 日常入口退役复用既有导航、Shell、版本触点 |
| LF-075 | 0（+5 多票共改） | 删除白名单内 CatContextRail；Shell 注释、Rail policy 与 Electron 版本走既有触点 |
| LF-082 | 4（+2 多票共改） | Linguist Rail / Full 复用原生 Session tree、actions 与项目级 presentation |
| LF-080 | 2（+7 多票共改） | AgentProfile、项目 Session CWD、Proma/CAT Overlay 契约及 CI Node 24 收口 |
| LF-084 | 0（+3 多票共改） | Proposal 列表单 JOIN diff DTO、rules/performance workspace 版本与 ICU parser 锁定 |
| LF-085 | 1（+3 多票共改） | CAT Tool Result 保持单份持久化，并分别为 Pi 模型与原生 Renderer 安全投影 |
| LF-086 | 0（+4 多票共改） | 导出安全与可观测性：Diagnostics IPC、typed bridge/DTO、Runtime 真实观测接线 |
| LF-087 | 0（+3 多票共改） | Stable ID v2：shared 与原生 CAT Tool Result 同时接受历史 v1 和完整 SHA-256 v2 |
| LF-088 | 0（+5 多票共改） | Quick Health、Full Integrity Scrub 与恢复完整性：独立 worker、typed IPC/bridge、受管备份恢复 |
| LF-089 | 0（+2 多票共改） | Proposal Issuance 与 Required 术语：当前 Turn 的真实生成 provenance 接入既有 Agent 编排，shared 扩展兼容 DTO |

合计 **222 条**（其中 62 条属多票共改文件，完整清单见 proma-touchpoints.json——ticket 字段以逗号列出全部相关票；代表性文件：apps/electron/package.json、main/ipc.ts、preload/index.ts、agent-orchestrator.ts、packages/shared/src/types/linguist.ts、AgentView.tsx、SDKMessageRenderer.tsx、AgentMessages.tsx、LeftSidebar.tsx、globals.css、tailwind.config.js、bun.lock 等）。

## PB-004：打包 Electron 基线与 Hermetic Smoke

- `apps/electron/package.json`（兼 PB-010）— 新增 `smoke:pack`/`smoke:g0` 脚本与 devDep `playwright-core@1.62.0`（精确版本）；PB-010 改 description。
- `bun.lock` — playwright-core 锁文件条目。

## PB-010：LA 品牌基础（minimal branding）

- `apps/electron/electron-builder.yml`（兼 PB-040）— appId `com.linguistagent.app`（开发值，正式签名身份 PB-114 定）、productName `Linguist Agent`、copyright 加 LA 衍生行、麦克风用途文案、fileAssociations 显示名；扩展名与 publish 配置不变。PB-040 追加 extraResources 一项（见 PB-040 节）。
- `apps/electron/resources/icon-source.png` / `icon.svg` / `icon.png` / `icon.icns` / `icon.ico` — PB-010 follow-up：恢复冻结旧仓内 LA 自有设计；源图保留在仓内并生成三种平台格式。
- `apps/electron/resources/proma-logos/icon.svg`、`iconTemplate.png`、`iconTemplate@2x.png`、`iconTemplate@3x.png` — macOS 托盘 Template 图标替换为原创 LA 字形，路径不变。
- `apps/electron/resources/generate-icons.sh` — 统一委托给图标生成器，避免日后恢复为紫色字母图标。
- `apps/electron/scripts/generate-la-icon.mjs`（新文件）— 从 `icon-source.png` 重建 PNG/ICNS/ICO；位于 Proma scripts 区，故登记。
- `apps/electron/src/main/index.ts` — 单实例锁提示、启动错误对话框产品名。
- `apps/electron/src/main/menu.ts` — macOS 应用菜单产品名。
- `apps/electron/src/main/tray.ts` — 托盘 tooltip 产品名。
- `apps/electron/src/renderer/index.html` — document title。
- `apps/electron/src/renderer/App.tsx`、`components/agent/AskUserBanner.tsx`、`components/onboarding/OnboardingView.tsx`、`components/quick-task/QuickTaskApp.tsx`、`components/settings/AboutSettings.tsx`（另加「基于 Proma 构建 (AGPL-3.0)」归属行并链接上游）、`components/tutorial/TutorialBanner.tsx`、`components/voice-dictation/VoiceDictationApp.tsx` — shell UI 用户可见产品名字符串。

## PB-011：Pi 成为唯一可见 Runtime（D-002）

- `apps/electron/src/main/lib/feishu-bridge.ts` — 远程 Bot 建会话缺省回退 `?? 'claude'` → `?? 'pi'`（对齐 settings-service 缺省）。
- `apps/electron/src/main/lib/settings-service.test.ts`（新文件）— colocated 测试 3 条：缺省解析为 pi；持久化 claude 覆盖仍被尊重。
- `apps/electron/src/renderer/components/agent/AgentView.tsx`（兼 PB-012）— AgentRuntimeSelector 由开关门控隐藏；组件保留。
- `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`（兼 PB-012）— 「Agent 内核」选择器块由开关门控隐藏。
- `apps/electron/src/renderer/components/settings/ChannelSettings.tsx`（兼 PB-012）— 渠道行 Claude Agent Core 徽章门控隐藏。

## PB-012：隐藏 v1 不需要的产品面（D-007，统一 Feature Flags）

- `apps/electron/src/renderer/lib/feature-flags.ts`（新文件）— 统一开关模块，替代散落的 `runtime-policy.ts`（已删）；colocated 于 Proma renderer/lib 因 Proma 组件需直接 import，故登记。
- `apps/electron/src/renderer/lib/feature-flags.test.ts`（新文件）— colocated 守卫测试（开关集合完整性 + 默认值断言）。
- `apps/electron/src/renderer/components/settings/SettingsPanel.tsx` — BOTS_TAB 门控。
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（兼 PB-013）— 自动任务入口 / Rail 按钮 / 合成分组门控。
- `apps/electron/src/renderer/components/tabs/MainArea.tsx`（兼 PB-013）— automations 路由与表单门控。
- `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` — ScheduledRunBadge 门控。
- `apps/electron/src/renderer/components/settings/ChannelForm.tsx` — 风险弹窗内商业版推广段落门控。
- `apps/electron/src/renderer/components/settings/GeneralSettings.tsx` — 「Git/PR 标识」推广开关门控（仅 UI）。
- `apps/electron/src/renderer/components/agent/AgentView.tsx`、`automation/AutomationFormView.tsx`、`settings/ChannelSettings.tsx` — import 迁移至 feature-flags（见 PB-011 条目）。

## PB-013：Projects 导航壳

- `apps/electron/src/renderer/atoms/active-view.ts` — `ActiveView` 联合类型新增 `'projects'`。
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（兼 PB-012）— 新增 `ProjectsSidebarEntry`（展开态 + 收起态 Rail）与切换回调。
- `apps/electron/src/renderer/components/tabs/MainArea.tsx`（兼 PB-012）— `projects` 全屏路由 + 开关回落门控。

## PB-014：上游修改边界测试（本票）

- `package.json`（根）— 新增 `check:boundaries` 脚本（`bun test tests/upstream-boundary.test.ts`）。
- 本文件与 `proma-touchpoints.json`、`tests/upstream-boundary.test.ts` 均在白名单路径内（`docs/`、`tests/`），无需登记。

## PB-022：格式 Adapter 接口 + round-trip 测试 Harness

- `bun.lock`（兼 PB-004）— 新增 `packages/linguist-cat-core` 与 `packages/linguist-cat-formats` 的 workspace 锁文件条目（bun install 自动写入；PB-021 未跑 install，两条一并记入；无外部依赖）。

## PB-024：建立 linguist-cat-store

- `bun.lock`（兼 PB-004, PB-022）— 新增 `packages/linguist-cat-store` 的 workspace 锁文件条目（bun install 自动写入；无外部依赖）。

## PB-030：主进程 Linguist 项目服务（LinguistProjectService）

- `apps/electron/src/main/index.ts`（兼 PB-010）— bootstrap 内经 `safeRun('initLinguistProjectService', …)` 接线服务实例化（含 node:sqlite 探针；sqlite 不可用时服务自报降级，不阻断启动）；`before-quit` 增加 `closeAllLinguistProjectHandles()` 清理。IPC handler 注册属 PB-031，本票不含。服务本体全部位于白名单新路径 `apps/electron/src/main/lib/linguist/`。
- `apps/electron/package.json`（兼 PB-004, PB-010）— 新增 `test:linguist` 脚本（node --test 运行 `*.nodetest.ts`；bun 无 node:sqlite）与 devDeps `@linguist/cat-core`/`@linguist/cat-formats`/`@linguist/cat-store`（workspace:*，对齐 @proma/* 既有登记方式）。
- `bun.lock`（兼 PB-004, PB-022, PB-024）— 上述 devDeps 的 workspace 锁文件条目（bun install 自动写入；无外部依赖）。

## PB-031：Linguist 项目 Typed IPC（计划 §7.2 六通道）

- `apps/electron/src/main/ipc.ts` — 注册 `linguist.projects.{list,create,open,import,getSummary,archive}` 六个通道的薄适配器；处理器逻辑（输入校验 / 结果信封 / 导入选择器流程）位于白名单新文件 `apps/electron/src/main/lib/linguist/project-ipc.ts`，此处仅接线并为导入通道注入真实 `dialog.showOpenDialog` picker（renderer 永不提交路径/字节，计划 §7.4）。全通道返回 `LinguistIpcResult<T>` 信封（稳定错误码；刻意偏离 house「直返 + throw」惯例——Electron invoke 会丢弃抛出错误的自定义 code 属性）。
- `apps/electron/src/preload/index.ts` — `ElectronAPI` 接口与实现各新增 6 个方法（`linguistProjects{List,Create,Open,Import,GetSummary,Archive}`），按 house 扁平方法惯例经 contextBridge 暴露。
- `packages/shared/src/types/linguist.ts`（新文件）— PB-031 机读契约：6 通道名常量、24 个稳定错误码目录（IPC 2 + 服务 4 + store 8 + format 4 + domain 6）、`LinguistIpcResult<T>` 信封、请求/响应线格式类型（领域类型 JSON 镜像）、校验常量（id/locale 形状、长度上限、导入扩展名白名单与 50MB 上限）。
- `packages/shared/src/types/index.ts` — 桶文件追加 `export * from './linguist'`。
- cat-store 仓库新增 `countByProject()` / `countByStatus()`（getSummary 的廉价计数）位于白名单 `packages/linguist-*`，无需登记。

## PB-032：Project 列表与创建 UI（仅注释级触点；视图本体在白名单路径）

- 视图本体全部位于白名单新路径 `apps/electron/src/renderer/features/linguist/projects/`（ProjectsView 重写 + ProjectCard / ProjectCreateDialog / ProjectDetailPanel / projects-atoms / project-utils + 测试），无需登记。
- 以下三条为**仅注释更新**（陈旧描述随真实页面落地修正，无逻辑改动），ticket 字段追加 PB-032：
  - `apps/electron/src/renderer/lib/feature-flags.ts`（兼 PB-012）— `LINGUIST_PROJECTS_VISIBLE` 注释由「导航壳」更新为真实页面说明（开关值不变）。
  - `apps/electron/src/renderer/atoms/active-view.ts`（兼 PB-013）— `projects` 视图注释更新（联合类型/逻辑不变）。
  - `apps/electron/src/renderer/components/tabs/MainArea.tsx`（兼 PB-012、PB-013）— `projects` 路由注释更新（路由逻辑不变）。

## PB-033：导入 UI（getSummary 契约扩展 assets；UI/服务/处理器在白名单路径）

- 导入 UI 与服务/处理器扩展全部位于白名单路径：`apps/electron/src/renderer/features/linguist/projects/`（ProjectDetailPanel 资产区 + 新增 ProjectAssetsSection）、`apps/electron/src/main/lib/linguist/`（project-service.ts 的 getProjectSummary 追加资产元数据列表；project-ipc.ts 注释随动），无需登记。
- `packages/shared/src/types/linguist.ts`（兼 PB-031）— 契约扩展：`LinguistProjectSummary` 新增 `assets: LinguistAssetInfo[]`（资产元数据列表：assetId / filename / formatId / segmentCount / sourceSha256，按创建序，与 assetCount 同源）。getSummary 通道不变、无新 IPC 通道；24 个错误码目录不变。
- `apps/electron/src/main/ipc.ts`（兼 PB-031）— getSummary 注册处注释随契约扩展更新（仅注释，接线不变）。
- `apps/electron/src/preload/index.ts`（兼 PB-031）— `linguistProjectsGetSummary` 文档注释随契约扩展更新（仅注释，方法面不变）。
- `apps/electron/src/preload/index.ts`（兼 PB-031）— `linguistProjectsGetSummary` 文档注释随契约扩展更新（仅注释，方法面不变）。

## PB-034：项目会话绑定（Project → Session Binding；会话栈/契约/徽章触点）

- `packages/shared/src/types/agent.ts` — `AgentSessionMeta` 新增 `linguistProjectId?` / `linguistProjectName?`（项目绑定 + 名称快照，创建时冻结；普通会话绝不携带）；`ErrorCode` 新增 `linguist_project_archived`（归档项目绑定会话发送被拒的 preflight TypedError 码）。
- `apps/electron/src/main/lib/agent-session-manager.ts` — 绑定写入与冻结：`createAgentSession` 新增第 6 可选参数 `linguistBinding`（仅项目内创建路径传入）；`updateAgentSessionMeta` 类型白名单刻意不含绑定字段，并在运行时强制保持原值（防御 any 断言绕过）——无任何重绑定 API。
- `apps/electron/src/main/lib/agent-orchestrator.ts`（兼 PB-040）— 归档发送闸门（主进程强制点，非仅 renderer）：`sendMessage` preflight 在会话元数据加载后调用 `checkLinguistSessionSendBlock`（白名单 `lib/linguist/session-binding.ts`），归档 → `reportPreflightError` 持久化 TypedError 并终止本轮；`queueMessage` 流式追加同一闸门。missing / 未绑定 / 服务不可解析放行（fail-open，规则 5 降级语义）。PB-040 追加常驻项目 Skill 注入（见 PB-040 节）。
- `apps/electron/src/renderer/components/agent/AgentHeader.tsx` — 徽章/通告挂载点：标题行 `LinguistSessionBindingBadge`（项目名 + 已归档/项目缺失状态），头部下方 `LinguistSessionBindingNotice`（归档只读 / 缺失降级横条）；组件均在白名单 `features/linguist/session-binding/`，AgentView 未改动。
- `packages/shared/src/types/linguist.ts`（兼 PB-031, PB-033）— 契约扩展：`LINGUIST_SESSION_IPC_CHANNELS` 三通道常量（createForProject / listForProject / getBinding）+ 会话绑定线格式类型；24 个错误码目录不变（复用 PROJECT_NOT_FOUND / PROJECT_ARCHIVED / INVALID_INPUT）。
- `apps/electron/src/main/ipc.ts`（兼 PB-031, PB-033）— 注册三个 `linguist.sessions.*` 通道的薄适配器（同一信封约定；处理器逻辑在白名单 `lib/linguist/session-ipc.ts`）。
- `apps/electron/src/preload/index.ts`（兼 PB-031, PB-033）— `linguistSessions{CreateForProject,ListForProject,GetBinding}` 三方法（接口 + 实现）。
- 绑定解析/创建/列表/发送闸门逻辑、IPC 处理器与信封公共件提取（ipc-envelope.ts，自 project-ipc.ts 纯搬移）、测试 loader 的 electron stub 与目录导入支持、nodetest、renderer 徽章/通告/项目对话区、打包探针 probe-project-session.ts，全部位于白名单路径（`main/lib/linguist/`、`renderer/features/linguist/`、`scripts/smoke/`），无需登记。

## PB-040：常驻项目 Skill（Project Assistant Skill；打包/注入缝触点）

- `apps/electron/electron-builder.yml`（兼 PB-010）— extraResources 新增仓根 `resources/linguist-skills/` → `linguist-skills`（对照 `../../tutorial` 既有仓根资源模式）：常驻项目 Skill 只进应用 Resources，**不**像 default-skills 那样同步到 `~/.proma`（避免用户可改；注入完全由主进程按会话绑定控制）。
- `apps/electron/src/main/lib/agent-orchestrator.ts`（兼 PB-034）— `sendMessage` 的 Pi queryOptions 装配处，既有 `additionalSkillPaths` 缝（原仅工作区会话注入 `getWorkspaceSkillsDir(slug)`）追加 `resolveLinguistSessionSkillPaths(sessionMeta, getLinguistProjectService)`（白名单 `lib/linguist/project-skill.ts`）：项目绑定会话 active/archived 注入内置 `project-assistant` Skill；missing / 普通会话 / 服务不可解析不注入（fail closed）。每次发送实时重解析（resume 走同一解析自然一致），Skill 列表不持久化进会话状态。queueMessage 无需改动——复用 sendMessage 建立的活跃 Pi 会话。
- Skill 本体（`resources/linguist-skills/project-assistant/SKILL.md`，七条不变量 + 零能力授予）、解析模块与 nodetest（`main/lib/linguist/project-skill.ts` / `project-skill.nodetest.ts`）、bun 内容门禁（`tests/linguist-project-skill.test.ts`）、打包探针（`scripts/smoke/probe-project-skill.ts` + fake-model-server opt-in system prompt 捕获），全部位于白名单路径（`resources/linguist-skills/`、`main/lib/linguist/`、`tests/`、`scripts/smoke/`），无需登记。

## PB-041：只读 CAT 工具（linguist-cat-tools 包；仅锁文件触点）

- `bun.lock`（兼 PB-004, PB-022, PB-024, PB-030）— 新增 `packages/linguist-cat-tools` 的 workspace 锁文件条目（bun install 自动写入；新外部依赖仅 `@earendil-works/pi-coding-agent@0.80.9` 与 `typebox@1.1.38` 的**既有锁定版本**引用，无新增第三方包；bun install 顺带重排 chalk/jiti/semver 的 hoist 归位（chalk4 消费方全保留嵌套 4.x，`build:main` 实测通过））。
- 工具包本体（`packages/linguist-cat-tools/`，五个只读 Pi ToolDefinition + 绑定解析接口 + 分页/错误模块 + 测试）与 cat-store 的读取扩展（`SegmentsRepository.count`、只读 `TmUnitsRepository`/`TermEntriesRepository`）全部位于白名单 `packages/linguist-*`，无需登记；agent-orchestrator 的 customTools 装配缝接线属 PB-042，本票未触碰任何 Proma 核心源文件。

## PB-042：CAT 工具接入 Pi customTools（装配缝/依赖触点）

- `apps/electron/src/main/lib/agent-orchestrator.ts`（兼 PB-034, PB-040）— `sendMessage` 的 Pi customTools 装配处（`piCustomTools = [...piBuiltinTools, ...piMcpTools]`）追加 `resolveLinguistSessionCatTools(sessionMeta, getLinguistProjectService)`（白名单 `lib/linguist/session-cat-tools.ts`，仅 pi runtime 构建）：普通会话 `[]`（普通 Chat Tool 列表无 CAT）；项目绑定会话 active/archived/missing 均装配五个只读 CAT 工具——missing 时工具调用抛 `PROJECT_MISSING`（文档化选择：失败对模型可读）；archived 发送已被 PB-034 闸门阻断，工具 inert。合并前 `assertNoLinguistCatToolNameConflict` 对既有 piBuiltinTools/piMcpTools 撞名 fail loud（cat_* 必须全局唯一）。工具数组每次发送重建、绑定状态每次工具调用实时重解析（resume 走同一构造自然一致；queueMessage 复用 sendMessage 建立的活跃 Pi 会话，无需改动）。Permission 回调、stop/retry 闸门、MCP 桥接均未触碰。
- `apps/electron/package.json`（兼 PB-004, PB-010, PB-030）— 新增 devDep `@linguist/cat-tools`（workspace:*，对齐 PB-030 三个 @linguist/* 既有登记方式；esbuild 束进 main.cjs，无运行时新增第三方包）。
- `bun.lock`（兼 PB-004, PB-022, PB-024, PB-030, PB-041）— apps/electron 新增 `@linguist/cat-tools` devDep 的锁文件条目（bun install 自动写入；无新增第三方包）。
- 会话解析模块（`main/lib/linguist/session-cat-tools.ts`：绑定 → resolveProject 实时解析器 + 冲突防线）、nodetest（`session-cat-tools.nodetest.ts`）、fake-model-server 的 `fake-cat-segments` 场景与 opt-in tools 捕获、打包探针 `scripts/smoke/probe-cat-tools.ts`，全部位于白名单路径（`main/lib/linguist/`、`scripts/smoke/`），无需登记。

## PB-043：CAT Tool Activity 文案

- `apps/electron/src/renderer/components/agent/tool-phrase.ts` — 复用 Proma 既有 Tool Activity 单一短语入口，为五个 CAT 工具增加用户可理解的中文主标题；`cat_get_segments` 显示「读取 N 个片段」，`cat_search_terms` 显示搜索词，其余使用稳定语义文案。Agent `ContentBlock` 与 Chat `ChatToolBlock` 已共同调用该入口，无需新增渲染组件。
- `apps/electron/src/renderer/components/agent/tool-utils.ts` — 为 Process Group 的图标 aria-label 等辅助面补齐五个中文 display name，避免回退为 `cat_*`。
- `apps/electron/src/renderer/components/agent/tool-phrase.test.ts` — BDD 守卫：五工具语义文案、缺省参数回退、内部函数名不作为显示名。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— Electron patch 版本 0.15.12→0.15.13。

## PB-044：Project Chat 真机 Smoke

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— Electron patch 版本 0.15.13→0.15.14。
- 精确 G4 脚本复用白名单 `apps/electron/scripts/smoke/`：fake model 新增 `fake-cat-summary`（`cat_project_summary` + 多 chunk final），`probe-cat-tools.ts` 新增「总结这个项目」打包应用 round-trip 断言，并修正多轮同会话等待逻辑为按完成计数递增，避免旧 completion 提前满足后续等待。

## PB-050：Proposal Domain 和 Repository

- `bun.lock`（兼 PB-004/PB-022/PB-024/PB-030/PB-041/PB-042/PB-043/PB-044）— 同步白名单包 `@linguist/cat-core` / `@linguist/cat-store` patch 版本到 0.0.1；无新增第三方依赖。
- Proposal 生命周期、原子批量创建/接受、重复幂等、pending 查询、stale expiry 与 node 测试全部位于白名单 `packages/linguist-*`，无需登记其他触点。

## PB-051：`cat_propose_translations` Proposal Tool

- `apps/electron/src/renderer/components/agent/tool-phrase.ts` / `tool-utils.ts` / `tool-phrase.test.ts`（兼 PB-043）— 在既有统一 Tool Activity 入口追加「创建 N 条翻译建议」与辅助显示名；不新增平行渲染组件。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.15、cat-store/cat-tools 0.0.2；无新增第三方依赖。
- ToolDefinition、会话 provenance 接线、真实 SQLite 行为测试和打包探针更新均位于白名单 `packages/linguist-*`、`main/lib/linguist/`、`scripts/smoke/`，无需登记其他触点。

## PB-052：确定性硬规则

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.16、cat-core 0.0.2、cat-tools 0.0.3；无新增第三方依赖。
- 纯规则核心、测试与 Proposal Tool 接入全部位于白名单 `packages/linguist-*`，无需登记其他触点。

## PB-053：Proposal 人工审核 IPC

- `packages/shared/src/types/linguist.ts`（兼 PB-031/PB-033/PB-034）— 新增七个 `linguist.proposals.*` 人工审核通道及 Proposal/diff/CAS/idempotency 线类型；24 个错误码目录不变。
- `packages/shared/package.json` — 同步 `@proma/shared` patch 版本 0.1.43→0.1.44；无依赖变化。
- `apps/electron/src/main/ipc.ts`（兼 PB-031/PB-033/PB-034）— 薄注册七个 Proposal 通道；全部处理逻辑位于白名单 `main/lib/linguist/proposal-ipc.ts`，且不注册为 Agent tools。
- `apps/electron/src/preload/index.ts`（兼 PB-031/PB-033/PB-034）— `ElectronAPI` 接口与实现新增七个 `linguistProposals*` 方法。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.17、shared 0.1.44、cat-store 0.0.3；无新增依赖。
- Proposal schema v2、原子幂等 Repository、IPC 处理器和测试均位于白名单 `packages/linguist-*` / `main/lib/linguist/`，无需登记其他触点。

## PB-054：Proposal Inbox

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.18；无新增依赖。
- Inbox UI、文本差异工具与测试位于白名单 `renderer/features/linguist/projects/`；G5 fake-model 场景与打包纵向探针位于白名单 `scripts/smoke/`，无需登记其他触点。

## PB-060：CAT Tab 和数据查询

- `packages/shared/src/types/linguist.ts`（既有触点）— 新增只读 `linguist.cat.query`、Segment/分页结果线类型与分页/搜索边界常量；24 个稳定错误码不变。
- `packages/shared/package.json` — 同步 `@proma/shared` patch 版本 0.1.44→0.1.45；无依赖变化。
- `apps/electron/src/main/ipc.ts`（既有触点）— 薄注册 CAT query；校验/查询逻辑位于白名单 `main/lib/linguist/cat-workspace-ipc.ts`。
- `apps/electron/src/preload/index.ts`（既有触点）— 新增单一只读 `linguistCatQuery` 方法。
- `apps/electron/package.json` / `bun.lock`（既有触点）— 同步 Electron 0.15.19、shared 0.1.45；无新增依赖。
- Service、UI、Jotai filters/selected IDs 与测试均位于 Linguist 白名单；打包探针位于 `scripts/smoke/`，无需登记其他触点。

## PB-061：虚拟化 Segment Grid

- `packages/shared/src/types/linguist.ts`（既有触点）— CAT query 增加 `includeIndex` / `segmentIds`，首个过滤请求获取稳定 ID 索引，后续 200 行窗口不重复传输。
- `packages/shared/package.json` — 同步 `@proma/shared` 0.1.45→0.1.46。
- `apps/electron/package.json` — 新增经官方文档/npm 核对的精确 MIT 依赖 `@tanstack/react-virtual@3.14.7`，同步 0.15.20。
- `bun.lock` — 锁定 react-virtual 3.14.7 / virtual-core 3.17.5，同步 workspace patch 版本；同时由 bun 修正既有两个 workspace 锁版本与 package.json 的不一致。
- cat-store ID 索引、虚拟 Grid、窗口工具与 10k 打包探针位于 Linguist 白名单，无其他 Proma 核心触点。

## PB-062：人工编辑与 CAS

- `packages/shared/src/types/linguist.ts`（既有触点）— 新增 `linguist.cat.editSegment`、Segment id pattern 与 expectedRevision 请求/Segment 响应；错误码目录不变。
- `packages/shared/package.json` — 同步 `@proma/shared` 0.1.46→0.1.47。
- `apps/electron/src/main/ipc.ts`（既有触点）— 薄注册人工 CAS edit；处理逻辑位于白名单 `cat-workspace-ipc.ts`，不进入 Agent tools。
- `apps/electron/src/preload/index.ts`（既有触点）— 新增 `linguistCatEditSegment`。
- `apps/electron/package.json` / `bun.lock`（既有触点）— 同步 Electron 0.15.21、shared 0.1.47；无新增依赖。
- Service CAS、Grid 编辑态、IME/键盘测试与真机探针均位于 Linguist 白名单，无其他 Proma 核心触点。

## PB-063：Context Rail

- `packages/shared/src/types/linguist.ts`（既有触点）— 新增只读 `linguist.cat.getContext` 与当前 Segment/待审 Proposal 响应契约；错误码目录不变。
- `packages/shared/package.json` — 同步 `@proma/shared` 0.1.47→0.1.48。
- `apps/electron/src/main/ipc.ts`（既有触点）— 薄注册只读 getContext；校验与查询逻辑位于白名单 `cat-workspace-ipc.ts`。
- `apps/electron/src/preload/index.ts`（既有触点）— 新增 `linguistCatGetContext`。
- `apps/electron/package.json` / `bun.lock`（既有触点）— 同步 Electron 0.15.22、shared 0.1.48；无新增依赖。
- Rail、Jotai tab/current Segment 状态、真实 SQLite 测试与打包探针均位于 Linguist 白名单，无其他 Proma 核心触点。

## PB-064：CAT Grid Proposal Review

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.23；无新增依赖。
- Grid/Rail 审核 UI、批量 revision 映射与测试位于 Linguist renderer 白名单；fake model 多轮修正和打包纵向探针位于 `scripts/smoke/`。复用 PB-053 的七个人工审核 IPC，没有新增 Agent 写工具或 Proma 核心写通道。

## PB-065：CAT 键盘与无障碍

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.24；无新增依赖。
- 行焦点/键盘逻辑、读屏标签与纯函数测试位于 Linguist renderer 白名单；10k p95、键盘和同 HOME 重启断言位于 `scripts/smoke/`。没有新增 IPC 或 Proma 核心源文件。

## PB-070：确定性 QA Core

- `bun.lock`（既有多票触点）— 同步 `@linguist/cat-core` 0.0.3；无新增依赖。
- 11 条确定性 QA 规则、类型和 BDD 测试全部位于 `packages/linguist-cat-core/` 白名单；未接触 Proma 主进程、renderer 或 Agent 工具。

## PB-071：QA Tool 与 UI

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— QA Finding 线格式、四个 CAT QA IPC 契约与 `@proma/shared` 0.1.48→0.1.49。
- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts`（既有触点）— 薄接线 `runQa`、`listQaFindings`、`resolveQaFinding`、`waiveQaFinding`；实现和校验位于白名单 `main/lib/linguist/`。
- `apps/electron/src/renderer/components/agent/{tool-phrase.test.ts,tool-phrase.ts,tool-utils.ts}`（既有触点）— Agent 活动显示为中文 QA 语义，绝不暴露 `cat_*` 内部名称。
- `apps/electron/package.json`（既有触点）— 同步 Electron 0.15.25；无新增依赖。
- `apps/electron/src/main/lib/{channel-manager.ts,channel-runtime-api-key.test.ts}` — 仅 Hermetic Smoke 环境跳过 safeStorage，避免临时 HOME 导致 macOS Keychain 的旧 `@proma/electron` 密钥恢复弹窗；正常运行仍加密。
- QA repository/tool/UI、SQLite 与打包探针均位于 Linguist 白名单；Agent 只拥有运行/读取工具，没有 resolved/waived 工具。

## PB-072：Export Adapter

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— 新增 `EXPORT_BLOCKED_BY_QA` 稳定错误码，并同步 shared 0.1.49→0.1.50；开放 blocking Finding 只能经 PB-071 人工 resolve/waive 消除，不能以导出参数绕过。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.26、cat-store 0.0.6 和 shared 0.1.50；无新增依赖。
- staging/reimport 校验、digest、artifact metadata 与项目服务均位于 Linguist 白名单；PB-073 才把主进程持有的 staging 文件接到 native Save dialog，renderer 不持有源路径。

## PB-073：Native Save

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— 新增 `linguist.exports.saveAsset` 与无路径的导出结果 wire，shared 0.1.50→0.1.51。
- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts`（既有触点）— 注册并暴露原生 Save 流程；白名单 `export-ipc.ts` 在主进程完成 verified staging → `dialog.showSaveDialog` → `copyFileSync`，renderer 仅传 `projectId` 和 `assetId`。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.27、cat-store 0.0.7 与 shared 0.1.51；无新增依赖。
- 所有路径只保留在主进程：响应 artifact 只有 id、assetId、digest、段数和创建时刻；取消、归档、阻断 QA、非法 asset 都不会打开 native Save dialog。

## PB-074：完整纵向 E2E

- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 新增 `smoke:g7`，同步 Electron 0.15.27→0.15.28；无新增依赖。
- fake model 场景和打包纵向探针均位于白名单 `apps/electron/scripts/smoke/`：模型必须从真实 `cat_get_segments` 结果读取 segment id/revision 后才创建 Proposal；原生 Open/Save 面板与 UI 复导入继续作为人工真机 Gate，不伪造自动通过。

## PB-080：TM/TB 管理（Reference）

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— 新增 `LINGUIST_REFERENCE_IPC_CHANNELS` 五通道常量、`LINGUIST_REFERENCE_ID_PATTERN` 与 TM/TB 线类型（term status 四态、caseSensitive、preferred 冲突标记）；`LinguistCatContextResult` 增加 tmMatches/termMatches；shared 0.1.51→0.1.52；稳定错误码目录不变。
- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts`（既有触点）— 注册并暴露 queryTm/queryTerms/import/upsertTerm/delete 五方法；import 通道由主进程注入真实 `dialog.showOpenDialog` picker，白名单 `reference-ipc.ts` 完成解析与入库，renderer 不提交路径/字节；archived 项目在原生 picker 打开前即被拒绝。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.29、cat-formats 0.0.1、cat-store 0.0.8、cat-tools 0.0.5、shared 0.1.52；cat-formats 新增 runtime dep `@xmldom/xmldom@^0.8.11`（TMX/TBX 解析，MIT；xml-parser 拒绝内部实体声明防 XXE）。
- TMX/TBX/CSV 解析器（packages/linguist-cat-formats）、TM/TB 仓储与 schema v4 迁移（term status + case_sensitive + 查询索引，packages/linguist-cat-store）、ReferenceManager UI（白名单 renderer 路径）与全部测试均在 Linguist 白名单/allowedNewPaths 内，无新增触点登记。

## PB-081：XLSX 双语格式 Adapter

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— `LINGUIST_IMPORT_FILE_EXTENSIONS` 末尾增加 `'xlsx'`（picker 动态消费）；shared 0.1.52→0.1.53；错误码目录不变。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 同步 Electron 0.15.30、cat-formats 0.0.2、shared 0.1.53；cat-formats 新增 runtime dep `jszip@^3.10.1`（XLSX zip 容器读写，MIT/GPL-3.0 双许可取 MIT）。
- XlsxAdapter、测试与注册均位于白名单：adapter 纯字节转换（jszip + @xmldom 读值、自写 namespace 容忍扫描器做 sheet 字符串手术）；未修改导出直接返回原始字节满足字节稳定硬规则；格式注册表第四个 adapter 与 picker 显示标签在白名单路径同步。
- 范围决策：PB-081 计划列表 PO/XLSX/SRT/VTT/ASS 中只有 XLSX 有旧仓真实需求证据（旧导入路由 .xlsx + office workers + workbook_mapping），PO/SRT/VTT/ASS 本轮不做、留待需求出现单独立票；Trados（SDLXLIFF）与 Phrase（MXLIFF / bilingual DOCX）经用户 2026-07-26 明确为常态需求，立项 PB-086/PB-087/PB-088，各自独立提交。

## PB-086：Trados SDLXLIFF Adapter

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— `LINGUIST_IMPORT_FILE_EXTENSIONS` 末尾增加 `'sdlxliff'`；shared 0.1.53→0.1.54；错误码目录不变。
- `apps/electron/package.json`（既有多票触点）— SDLXLIFF adapter 接入与 picker 标签同步 0.15.31；零新依赖（bun.lock 不变）。
- 独立 `SdlXliffAdapter`（id `sdlxliff_1_2`）位于白名单 cat-formats：分段 trans-unit（`<seg-source><mrk mtype="seg" mid>`）按 mrk 拆段、`<sdl:seg locked>` 与 conf 状态映射（语义提取自旧仓 sdlxliff.ts，provenance 已登记）；detect 置信度与 XliffAdapter 不互抢（registry 测试锁定）；`xliff.ts` 仅 `statusFromXliff` 加 export，零行为变化。
- 用户授权扩围（2026-07-26：Trados 为常态需求）；sdl: 元数据不回写、tag 逐字往返（与 memoQ 政策一致），偏差全文见 sdlxliff.ts 头注释。

## PB-087：Phrase MXLIFF Adapter

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— `LINGUIST_IMPORT_FILE_EXTENSIONS` 末尾增加 `'mxliff'`；shared 0.1.54→0.1.55；错误码目录不变。
- `apps/electron/package.json`（既有多票触点）— Phrase MXLIFF adapter 接入与 picker 标签同步 0.15.32；零新依赖（bun.lock 不变）。
- 独立 `PhraseMxliffAdapter`（id `phrase_mxliff_1_2`）位于白名单 cat-formats：平坦 trans-unit 模型（与 XLIFF 同形），`m:locked`/`translate="no"` → locked、`m:confirmed` 级别映射 translated/reviewed（无 confirmed 回退 statusFromXliff）、group `x-key-note` 经 `m:para-id` 兜底 context.note（语义提取自旧仓 phrase_mxliff.ts / batch_workspace.ts，provenance 已登记）；detect 置信度与 XliffAdapter/SdlXliffAdapter 不互抢（registry 测试锁定）；零行为变化复用 xliff-xml 层。
- 用户授权扩围（2026-07-26：Phrase 为常态需求）；`m:` 元数据不回写、tag/占位符逐字往返（与 memoQ/SDLXLIFF 政策一致），偏差全文见 phrasemxliff.ts 头注释。

## PB-088：Phrase Bilingual DOCX Adapter

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有触点）— `LINGUIST_IMPORT_FILE_EXTENSIONS` 末尾增加 `'docx'`；shared 0.1.55→0.1.56；错误码目录不变。
- `apps/electron/package.json`（既有多票触点）— Phrase bilingual DOCX adapter 接入与 picker 标签同步 0.15.33；零新依赖（bun.lock 不变，jszip 为 PB-081 既有 dep）。
- 独立 `PhraseDocxAdapter`（id `phrase_bilingual_docx_1`）位于白名单 cat-formats：段行判定（≥5 `<w:tc>` + 首格含 `:` + 跳表头）与写侧 rewriteCellText/replaceNthCell 语义提取自旧仓 phrase_bilingual_docx.ts（provenance 已登记），列布局 [ID, ICU, #, Source, Target, Status, Comment] 经第三方 OSS 格式知识交叉验证；detect 与 XlsxAdapter 不互抢（word/ vs xl/ 条目）；普通 DOCX 刻意不认领。
- 用户授权扩围（2026-07-26：Phrase 为常态需求）；`{N}` 占位符逐字往返、状态码目录不臆测（非空 target 一律 draft，原值只读 surfaced 到 context.note），偏差全文见 phrasedocx.ts 头注释。

## PB-083：Independent Critic（Review Skill 和 Finding）

- `apps/electron/package.json`（既有多票触点）— `cat_submit_critic_review` 工具接线（session-cat-tools 注入 criticSkillBytes）与评审 Skill 资产同步 0.15.34；零新依赖（bun.lock 不变）。
- 契约提取全部落在 Linguist 白名单：`packages/linguist-cat-core` 新增 `independent-critic.ts`（旧仓 independent_critic.ts 全量提取）与 `evidence.ts`（write_policy 证据判定随迁，provenance 已登记）；cat-store schema v5 `critic_artifacts` 表与 repository；cat-tools 第九个工具（身份/哈希运行时派生，同会话评审被独立性闸门拒绝）；评审 Skill 资产 `resources/linguist-skills/project-reviewer/`（extraResources 整目录自动随包）。
- 计划硬约束"Review 只产生 Finding 或修订 Proposal，不能直接 Commit"结构性落实：工具只写 advisory artifact + QA Finding 行，无任何段/目标写路径；修订走既有 cat_propose_translations 人工审核链。
- 评审会话启动编排与技能注入切换不做，属 PB-082 Best 档。

## PB-082：质量策略档 Fast / Balanced / Best（计划 §21）

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有多票触点）— `SET_QUALITY_PROFILE` 通道、`LinguistQualityProfile` 线类型（镜像重定义，cat-core 为真源）、`LinguistProjectInfo.qualityProfile`（必有值，边界 toProjectInfo 收敛）、createForProject 请求 `role?: 'reviewer'` 与 `ChatSessionInfo.role`；shared 0.1.56→0.1.57。
- `packages/shared/src/types/agent.ts`（PB-034 既有触点）— `AgentSessionMeta.linguistSessionRole?: 'reviewer'`（缺省=assistant 刻意不落库；与绑定同属创建时冻结）。
- `apps/electron/src/main/ipc.ts` / `apps/electron/src/preload/index.ts`（既有多票触点）— 注册 setQualityProfile 通道与 preload 方法。
- `apps/electron/src/main/lib/agent-session-manager.ts`（PB-034 既有触点）— 冻结字段扩展 linguistSessionRole：updateAgentSessionMeta 白名单不含，展开 updates 后强制恢复原值（含 any 断言绕过）。
- `apps/electron/package.json`（既有多票触点）— renderer 三段选择器/评审徽标/「独立评审」按钮编排同步 0.15.35；零新依赖（bun.lock 不变）。
- 策略本体全部落在 Linguist 白名单：cat-core `quality-profile.ts`（normalize 缺省 balanced 永不抛错、三档策略表、刻意不做模型 Router）、project.json 可选 `qualityProfile?`（旧文件兼容、不回写）、cat-store `setQualityProfile`（projects.json + project.json 同步）、project-skill 注入矩阵（评审会话只注入 project-reviewer；普通项目会话注入 project-assistant + strategy-<profile>；任何解析故障 fail closed）、三个 strategy Skill 资产目录（extraResources 整目录随包）。
- 归档拒绝落在服务层（LinguistProjectArchivedError，同 editSegment/runQa 模式）而非 cat-store——store 错误目录无 archived 码且本票无新码（subagent 偏离记录，合理）。
- 评审发起编排走既有通道：ProposalInbox「独立评审」按钮（所有档可见，归档禁用）→ createForProject(role:'reviewer') → sendMessage 评审指令 → 跳转新会话；不做自动 critic 编排、不做 Router。

## PB-084：Batch Consistency（批量一致性定点修复）

- `apps/electron/package.json`（既有多票触点）— 装配层 session-cat-tools 注释同步（9→10 工具）0.15.36；零新依赖（bun.lock 不变）；装配层无功能改动（工厂数组自动包含新工具）。
- 投影与工具全部落在 Linguist 白名单：cat-core `batch-consistency.ts`（旧仓 batch_consistency_repair.ts 投影语义提取，provenance 已登记；7 码一致性集合、按 source 分组、多数 target 计票建议、advisory_finding/canCommit:false 烧死）；cat-tools 第十个工具 `cat_run_batch_consistency`（check-only 内存 runQa+合并去重零写库；repair 走 cat_propose_translations 同一 proposal 仓储路径，绝不写段）。
- 计划硬约束「只修复命中 Segment，禁止全 Batch 无差别重翻」结构性落实：repair 输入只来自投影（当前 target 与组建议值不一致的未锁定段），已一致段幂等跳过；锁定段参与计票但绝不生成 proposal。

## PB-090：Legacy Scanner（只读旧布局扫描 CLI）

- `bun.lock`（既有多票触点）— 登记新 workspace 包 @linguist/legacy-migration 0.0.1（零 npm 依赖）；并同步 HEAD 既有但 lock 滞后的 5 个版本漂移（漂移先于本票存在，零依赖解析变化）。
- scanner 全部落在白名单新包 `packages/linguist-legacy-migration`：旧布局常量/最小解码/SQLite 只读探针（`DatabaseSync(path, {readOnly:true})`，src 零写 API）/六情形信号/双轨 digest；CLI 模式复刻 cat-store（表驱动、严格白名单 flag、语义化 exit code、可注入 IO）。
- 只读红线结构性落实：src 目录无 writeFile/appendFile/mkdir；只读冒烟（扫描前后目录快照逐字节相等 + 固定时钟两次 stdout 全等）进 node --test。
- 判定边界：scanner 只输出信号（root-missing/internal-copy-only/orphan 双向/invalid permission/sqlite-legacy-divergence），处置决策归 PB-091/092；quarantine 旧仓无 CAT 对应物（已确认）。

## PB-091：Legacy Project Import（旧项目导入新 Project）

- `bun.lock`（既有多票触点）— @linguist/legacy-migration 0.0.1→0.0.2 新增 @linguist/cat-core/-formats/-store 三个 workspace 依赖；零 npm 依赖解析变化。
- 导入器全部落在白名单包内（extract/map/import/report-import + CLI import 子命令）：写库全走 store 公共 API（createProject/assets.insert/importMany/insertOpen+transition/saveAssetSource），绕过 adapter 直建 Segment 行；不经 LinguistProjectService。
- 保留硬项落实：segment order（ordinal=数组序）、source/target 1:1、locked 1:1、revisions 最终语义（旧无历史表→revision=0 无历史行）、TM/TB（幂等 importMany）、QA 状态（最新 report+ledger review→open/waived）、artifact references（source blob+exports 原样复制+proposals/ledger 归档）、source digest（PB-090 同算法入 sidecar）。
- 不伪造原则：source 全丢→合成 digest+导出不可用标注；xliff_2_0 原样记录+exportUnavailable；丢弃字段按域逐项计数上报。

## PB-092：损坏与跨 root 项目处置层

- 零 Proma 触点变化：全部改动在白名单包 `packages/linguist-legacy-migration`（disposition.ts 新建、extract/import/sqlite-probe/cli 增量）；零新 npm/workspace 依赖，bun.lock 不变。
- 六 blocker 情形处置结构性落实：invalid permission 永不阻断只回声；root-missing 走 uploads→blob-store→lost 链；external source 用户选择（--external-source=copy|reference，reference 不读 external 字节、路径记 sidecar）；v2 managed copy 经 source_refs 从 CAS blob-store 恢复（读时重算 sha256+核字节数）；orphan 默认 quarantined（零写盘+完整机读报告+exit 5）可 --salvage-orphan 救数；quarantine=报告内第 6 类 disposition 无物理隔离（只读红线下"不导入+机读记录"即隔离）。
- chat 三载体：chat.json 字节归档、_pi_sessions 清单、agent_events.jsonl 永不导入；chat-only 项目建 metadata-only（archived-only，零 asset 不伪造）。

## PB-093：Legacy Chat Transcript（旧聊天只读归档转录）

- 零 Proma 触点变化：全部改动在白名单包 `packages/linguist-legacy-migration`（chat-transcript.ts 新建、extract/import/report-import/cli/index 增量）；零新依赖，bun.lock 不变；包版本 0.0.3→0.0.4。
- 旧聊天不迁入可继续会话（计划 §22）：chat.json 行一次性渲染为静态 Markdown `legacy-archive/chat/transcript.md`（纯函数、零 Date.now/Math.random、archivedAt 全注入时钟），原文 verbatim 不转义；tool 行只有旧 Runtime 单行摘要（args/result 从不入 chat.json，未虚构）；session 分组按首行 ts 码元序+sessionId 平局序；malformed 行进 tilde 围栏附录并计数。
- PB-094 Verify 钩子：transcript 计划在写盘前计算（dry-run/conflict 报告同样携带），报告 `chat.transcript{path,sha256,bytes,sessions,rows,malformedRows,unassignedRows}|null` 的 sha256 即可由重渲染独立比对；`_pi_sessions/*.jsonl` 字节逐字归档（extract 保留字节引用，写入的=哈希过的），`ArchiveEntry.kind` 增 `'chat-transcript'|'pi-session'`。

## PB-094：Legacy Migration UI/Report（迁移向导）

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有多票触点）— `LINGUIST_MIGRATION_IPC_CHANNELS` 三通道组（pickAndScan/import/progress 事件）+ 9 个迁移向导线类型（ScanReport/ImportReport 的 UI 投影，刻意非全镜像）；shared 0.1.57→0.1.58。
- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts`（既有多票触点）— 薄注册 pickAndScan/import 两个 handle（picker 注入 dialog.showOpenDialog openDirectory；PROGRESS 单向事件 event.sender.send+isDestroyed 守卫）；preload 3 个 typed API（进度订阅返回 unsubscribe）。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— devDep @linguist/legacy-migration（workspace:*）与版本同步 0.15.37；lock 仅 workspace 登记+版本追平（+4/−3 行，零 npm 解析变化）。
- 编排与 UI 全部落在白名单：主进程 `migration-service.ts`（scan 会话留存、import→verify 循环、每项目 setImmediate 让出、degraded 防御 STORE_SQLITE_UNAVAILABLE）+ `migration-ipc.ts`（electron-free 信封工厂）；renderer `features/linguist/migration/` 向导三件套；`ProjectsView.tsx`（白名单内）CTA+EmptyState 两入口与整页切换。
- §7.4 铁律结构性落实：目录选择全部主进程做，旧根路径由服务在 pickAndScan 时留存为会话状态，import 只接受上次扫描出现过的 id（路径分隔符拒绝），renderer 从不上行路径/字节。
- Verify 并入 import：transcript sha256 重渲染比对（确定性前提=importSelected 每项目钉住单一时钟使 sidecar.importedAt===archivedAt）+ 落盘字节比对 + CatStore readOnly 重开五项计数；篡改两分支各有 nodetest 锁定。

## PB-100：LA Design Tokens（设计令牌层）

- `apps/electron/src/renderer/styles/globals.css`（**新触点**）— `@layer base` 既有 token 区尾部追加 LA 增量块（status success/warning/info 各三件套、--foreground-faint、--scrim、--border-strong/--border-light color-mix 派生、--duration-*/--ease-* motion 变量、全局 reduced-motion 规则），:root/.dark 双套；既有 2455 行零重排，特殊主题不强制覆写新 token（继承合理默认）。
- `apps/electron/tailwind.config.js`（**新触点**）— theme.extend 增量：colors 增 status 三色+scrim+faint（HSL 通道+<alpha-value> 照既有写法）、fontSize 语义阶梯（badge 10/xs 11/sm 12/base 13/lg 14/heading 16-24，base 刻意 16→13px 对齐仓内事实密度）、transitionDuration/TimingFunction 指向 motion 变量；safelist/keyframes/animation 不动。
- token 值全部 LA 原创并带来源标注（`docs/design/LA_DESIGN_TOKENS.md`，草案转正式）；规格书原文与三家品牌资产不入仓；accent 主色保持现状待用户拍板（§8-①）；34 处 raw palette 状态色迁移归 PB-101~104；proma- 前缀 localStorage 键不动。
- 契约测试 `tests/design-tokens.test.ts`（37 条：双套齐备/HSL 三通道格式/全局 reduced-motion 非主题限定/safelist↔THEME_STYLES 同步/config↔css 变量交叉断言），为 PB-105 矩阵预留 token 回归门。

## PB-095：项目资产六类（Style Guide/术语+句式/TM/Context/Tech Constraints/Game DNA）

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有多票触点）— `LINGUIST_ASSETS_IPC_CHANNELS` 五通道组（query/upsert/delete/importContextDoc/importSentencePatterns）与六类线类型（含 ContextDoc.previewUrl 仅 image 下发；term 条目扩 module/category/imageRef）；shared 0.1.58→0.1.59。
- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts`（既有多票触点）— 五通道薄注册（importContextDoc 注入主进程 picker；registerPreviewUrl 注入既有 registerPromaFilePath token 门控协议）与五个 typed 方法。
- `apps/electron/src/main/lib/agent-orchestrator.ts`（既有多票触点）— systemPrompt 尾部经 `buildLinguistProjectAssetsPrompt` 兼容 seam 注入项目资产；LF-079 在同一 seam 上演进为分层 Prompt overlay。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 版本同步 0.15.37→0.15.38；零新依赖，lock 仅两行版本字段。
- 存储与编排全部落在 Linguist 白名单：cat-store schema v6 单迁移（style_guide_rules/sentence_patterns/context_docs/tech_constraints/voice_profiles 五表 + term_entries 三列，照 v4 多语句先例）、blobs.ts 原子写、五个 repository；cat-tools 第 11/12 个工具 `cat_search_sentence_patterns`/`cat_read_context_doc`（分页硬顶 clamp+note 惯例）；main/lib/linguist 新增 assets-ipc/project-assets-prompt（均 electron-free 可测）；renderer 四面板 + 三 utils。
- 图片显示链接论修正：coder 首轮判「无先例」，主 agent 复核发现 `local-file-protocol.ts`（proma-file:// token 门控）正是先例并打回补课——image 条目经 registerPromaFilePath 下发不透明 URL（TTL 1h/realpath 围栏），路径解析双重 realpath 围栏在项目 blobs 目录内，越界/缺字节一律降级省略不抛错。
- 边界划出（归后续票）：Context 向量/lexical 检索、DOCX/PDF 文本抽取、tech_constraints 的 QA 消费（PB-097）、segments.context_json 台本元数据写入、旧仓资产数据迁移、LLM tag discovery、screenshot_ref 的 IPC 写入与显示。

## PB-096：QA 契约对齐（L0-L4/disposition/29 issue_type）+ Xbench 类检查覆盖

- `packages/shared/src/types/linguist.ts` / `packages/shared/package.json`（既有多票触点）— QA 契约五档 severity + disposition + issueType 全链路 DTO；CatRunQaResult 改 severityCounts/dispositionCounts；disposition 筛选 IPC 契约；shared 0.1.59→0.1.60。
- `apps/electron/package.json` / `bun.lock`（既有多票触点）— 版本同步 0.15.38→0.15.39；零新依赖，lock 仅两处版本字段。
- 契约单一事实来源在白名单 cat-core `issue-type.ts`（29 枚举 + QA_CODE_ISSUE_MAPPING 静态表 + 未知码兜底 other/L2/defect）；finding id 派生公式不变（segmentId+code+message），resolved/waived 历史不断链。
- schema v7（白名单 cat-store）：qa_findings ADD issue_type/disposition 两列 + 按 code 静态表 SQL UPDATE 回填 severity 三值→五值（CRITIC_% 保留旧档映射）；迁移顺序刻意 disposition 先行（依赖旧三值判 info）。
- 批次 1 Xbench 类检查 15 新码全在白名单 cat-core qa-core.ts（括号/引号配平、叠词、双空格、首尾空白、email/url/alphanumeric 多重集、异源同译、换行入 QA、全角/CJK 泄漏 locale 感知、glossary_conflict、upper/camelcase opt-in）；既有 11 码 code/message 零改动仅补契约三元组。
- 术语接线修复既有缺口（factory.ts/project-service.ts 的 runProjectQa 无参调用）：term_entries → QaRunOptions，glossaryPolicy strict/prefer(默认)/off 项目级可选字段（qualityProfile 先例，normalize 回落不回写）；forbidden 恒定 L1 阻断，preferred 按策略升降级。
- critic 契约扩展（白名单）：CRITIC_* 直接产五档 severity + issueType，disposition=needs_review；导出闸门改 open 的 L0+L1 计数。
- PB-091 迁移层（白名单）：mapQaSeverity 三值→五值（blocker→L1/warning→L2/advisory→L4，placeholder/tag/icu blocker 特判 L0）；open/waived 逻辑与 waiver_reason 不动。
- 明确不做：批次 2（依赖 PB-097 tag profile）、批次 3（拼写 nspell/checklist 正则，不引新依赖）；replaceForProject 清 CRITIC_ 行保留现状+注释。

## PB-097：Tag profile 正则自识别引擎

- 零 Proma 触点变化：全部改动在 Linguist 白名单（cat-core tag-families/tag-profile/hard-rules/qa-core/issue-type；cat-store project-index/proposals；cat-tools factory；main/lib/linguist/proposal-ipc）。
- 旧仓八缺陷逐条修复：BBCode 泛化全族+项目族登记补漏族；printf 全族（%1$s/%.2f/%03d/%%）；多重集比较取代逐位（用户拍板允许调序）；栈算法配平+交叉嵌套拦截；extra=missing 同罪；属性全量进签名（空值属性计入）；ReDoS lint 移植（长度 240/嵌套量词拒绝/禁空串）。
- 签名形态 `kind:familyId:骨架|排序属性多重集`；项目族优先级压内置族，编译 memoize；tagProfile 挂 project.json 可选字段（normalizeTagProfile 回落不回写，同 qualityProfile/glossaryPolicy 先例）；targetLocales 激活条件。
- 新 violation code 三枚（TAG_PLACEHOLDER_FAMILY_MISMATCH/TAG_FAMILY_MISMATCH/TAG_PAIRING_MISMATCH）按 PB-096 契约落 L0 defect（placeholders_variables/format_tags）；XML 守恒复用既有 TAG_SIGNATURE_MISMATCH；占位符族与既有宽松签名去重。
- 校验链四处接线（factory.ts:400/:457/:685+:735、proposals.ts:249、proposal-ipc editAndAccept）；缺省=仅内置族，PB-052 既有测试零破坏；editSegment 人工编辑路径维持既定设计 QA 兜底。
- 明确不做：编辑器 span 锁、LLM discovery/onboarding、tech_constraints 的 QA 消费联动（均归后续）。

## PB-101：Thread 与 Composer 视觉精修（计划 §23）

- 新触点 11 条（agent 组件族 9 + ai-elements/message.tsx + ui/spinner.tsx）：均为渲染层最小 diff 精修——Thinking 双态标签、Worked/Model changed 两个纯派生 divider、retry 横幅等 22 站点 raw palette→status token、spinner motion-reduce 静态降级与尺寸注释修正、user bubble 精修（共享组件，Chat 同生效）、tool-result 状态徽章三件套化。
- `SDKMessageRenderer.tsx` / `AgentView.tsx`（既有触点追加）— content-visibility 原生窗口化（不引 JS 虚拟化库，isStreaming 不启用，StickToBottom/minimap 兼容性注释块）与 amber 提示条迁移。
- 纯逻辑 colocated `turn-divider-utils.ts`（14 测试）；契约测试 `tests/no-raw-palette.test.ts`（白名单，7 文件断言+3 条登记豁免：diff 增删色/shell $ 提示符绿）。
- 数据层零改动；max-width 72rem 不动（布局锚点归 PB-102）；steer 打断语义不做；Thinking 默认展开偏好保留（OpenWorker 默认折叠不采用）。

## PB-102：Shell 与 Right Rail 精修（计划 §23）

- 新触点 26 条：right-rail-policy.ts/.test.ts（Rail 上下文编排纯函数 + 6 例契约测试：Agent=会话视图才显示 Agent Rail，projects/CAT 视图槽位让位给 CatWorkspace 内 CatContextRail，两套 Rail 不合并）、AppShell.tsx（判定收敛）、SidePanel.tsx（会话文件 Tab 挂 DeliverablesSection）、agent-skills 5 文件、chat 2 文件、diff 2 文件、session-preview 1 文件、settings 12 文件（raw palette 状态色迁语义 token，spinner 补 motion-reduce）。
- 既有追加 8 条：shared/types/linguist.ts（LIST 通道 + 三类型，响应绝无路径 §7.4）、main/ipc.ts 与 preload/index.ts（通道注册/桥接）、LeftSidebar.tsx（Skills 一级入口降 footer 小图标区 + 5 处迁色 + var(--sidebar-w)）、ChannelForm.tsx/SettingsPanel.tsx（迁色）、globals.css/tailwind.config.js（6 个布局锚点 token 增量，toolbar/settings-row/sidebar-w/markdown-wide）。
- 交付物链路全部在白名单免登区：main/lib/linguist/（listExportFiles 只读读盘 + list handler + nodetest/ipc-contract 断言）与 renderer/features/linguist/（DeliverablesSection：点击回走 PB-073 native Save 既有链路，零新路径通道）；no-raw-palette 契约测试在白名单 tests/（+26 文件断言、+6 条装饰豁免含理由与命中数断言）。
- 明确不做：persona 手风琴/Inbox/TodoPanel/合并两套 Rail/数据层改动；toolbar 高度与 64rem 锚点在本域无确定性命中未强行应用（token 就位待后续批次）；交付物「直接打开/Finder 显示」需新通道留后续票。

## PB-103：Approval / Plan / Compaction 精修（计划 §23）

- 新触点 7 条：permission-scope.ts/.test.ts（作用域摘要纯函数 + 15 用例）、PermissionBanner.tsx（scope 摘要行 + dangerLevel 文字徽章 + decisionReason 行 + green/amber 迁 success/warning）、ExitPlanModeBanner.tsx（Plan 仅 toolInput.plan 非空时渲染，默认展开可折叠）、TaskProgressOverlay.tsx（压缩 failed 态「重试压缩」按钮 + green 迁 success）、TaskProgressCard.tsx 与 ContextUsageBadge.tsx（raw palette 迁 token）。
- 既有追加 4 条：AgentView.tsx（三 banner 改经 inlineBanner 传入，hasBannerOverlay/hasBlockingRequests 与 composer 显隐逐字未改）、AgentMessages.tsx（inlineBanner 插槽 + InlineBannerScrollIntoView 复用 StickToBottom + onRetryCompaction 透传）、SDKMessageRenderer.tsx（PermissionDeniedNotice amber 迁 warning，保持只读）、AskUserBanner.tsx（容器样式随行）。
- Model changed divider 票面项由 PB-101 已覆盖（turn-divider-utils 测试全绿），本票零改动；error recovery 票面项由既有 _errorActions 体系覆盖，PermissionDeniedNotice 不造新语义。
- 契约测试在白名单 tests/（+6 文件断言、+2 条 mention-suggestions 装饰豁免：emerald Server 图标与 violet Sparkles 图标）；数据流/契约/shared 包零改动。

## PB-104：CAT 视觉精修（计划 §23）

- 票面九项全部落在白名单 features/linguist/（零新触点）：ROW_HEIGHT 108→88、source /60 vs target 主文本层级、diff 红绿登记豁免保持视觉、QA 列「有问题（N）」warning 化、Terms 冲突 warning、状态列彩色徽章（untranslated muted/draft info/translated success/reviewed review + Lock 图标）、批量条 sticky bottom-2、空态字号与重试按钮统一、rail 窄视口 min-h 改 xl 断点限定。
- violet 评审色 token 化：globals.css/.dark 各加 --review 三件套（violet-500 色相族，light 258 60% 44% / dark 258 75% 70%），tailwind 对齐三件套结构；ProjectChatsSection 评审角色徽章与 CatWorkspace 建议待审 pill 迁 review。
- MigrationImportDialog.tsx 唯一新触点（29 处/17 行 raw palette 全迁，amber-50/200/950 块级一族 → warning-soft/warning-foreground 体系）；globals.css/tailwind.config.js 既有追加。
- no-raw-palette 契约（tests/ 白名单）：+8 linguist 文件断言（新增 LINGUIST_DIR 常量）、+4 条 diff 增删色豁免（ProposalInbox/CatContextRail 各 2，理由对齐 PB-101 ContentBlock diff 豁免）；linguist 域复核仅剩 4 条豁免行命中。
- 明确不做：网格内术语高亮、ContextRail/QA 面板 error 重试（无现成回调不建数据流）、rail 折叠抽屉、虚拟化/分页/50 上限逻辑、PB-096 QA 契约。

## PB-110：CAT 安全审查（计划 §24）

- 零 Proma 触点变化：全部改动在白名单（packages/linguist-cat-store 的 project-database.saveAssetSourceForImport 与 asset-source.nodetest；apps/electron/src/main/lib/linguist/ 的 importAsset 次序调换、project-assets-prompt/project-skill 日志纪律修复、log-hygiene.nodetest 新文件与五个 nodetest 增补）。
- 八项票面证明矩阵：1~5、7 项由既有强制点+测试已证明（侦察逐条 file:line 在案）；本票补齐——工具级归档写拒绝（STORE_READ_ONLY 且零写入）、proposal-ipc 七通道归档腿、主进程 console 无正文自动化钉住（SENTINEL 全流程）、三处 error.message 透传改 name/code 纪律、importAsset 两步次序对齐 blob 先行（崩溃窗口只留孤儿 blob，不留「行在 blob 缺」导出硬失败态）。
- 已知限制（记账本）：archive 与在途写事务竞态、exports//source/ symlink 攻击面（本机威胁模型外）、export 用户自选目的地覆盖磁盘原文件（原生 Save 语义）。

## PB-111：Backup / Restore（计划 §24）

- 既有追加 3 条：shared/types/linguist.ts（四通道+两错误码+备份名白名单双正则+线类型）、main/ipc.ts 与 preload/index.ts（注册/桥接）。零新触点。
- 全部实现落白名单：cat-store（backup.ts 重写全量目录备份+manifest+verifyBackup、restore.ts 整体替换+pre-restore 快照+失败回滚、errors.ts 两新码、store.ts 门面、restore.nodetest 8 例+backup.nodetest 改写 4 例）、main/lib/linguist/（service 三方法+project-ipc 四 handler+backup-restore.nodetest 7 例）、renderer features/linguist/（ProjectBackupsSection 备份区+恢复预览对话框、ProjectDetailPanel 接入）。
- 关键语义：verify（逐文件 sha256+quick_check+只读打开 fail closed）→ pre-restore 快照 → tmp+rename/目录 aside-staging 三段替换 → 失败自动回滚；旧两文件备份显式不可恢复（STORE_BACKUP_LEGACY）仅可预览降级；归档项目可备份可预览不可恢复；pre-restore 快照不在白名单形状内、不可经 API 恢复（手动找回用）。

## PB-113：隐藏评估与图标/教程去品牌化（计划 §24）

- 新触点 4 条：`AppearanceSettings.tsx`（13 个 Proma logo 图标变体并入 PROMA_PROMO_VISIBLE 门控，VISIBLE_ICON_VARIANTS，flag off 选择器仅剩 default/LA 图标；png 资产保留不删；已存变体高亮兜底回落 default 不改写存储）、`tab-atoms.ts`（TUTORIAL_TAB_TITLE 去 Proma 品牌化）、`tutorial-service.ts`（欢迎对话教程附件文件名）、`resources/tutorial.md`（H1，正文品牌词保留另票）。
- 既有追加 2 条：`main/ipc.ts`（resolveAppIconPath 增 PROMA_APP_ICON_VARIANTS_VISIBLE 主进程常量兜底——隐藏期间历史存储的 Proma 变体一律解析回 icon.png；主进程无引用 renderer 开关先例，同名同值常量注释互相指引）、`SettingsPanel.tsx`（教程 Tab 标签「使用教程」、标题改用 TUTORIAL_TAB_TITLE 常量）。
- 六项隐藏评估结论（零代码、记档于 docs/architecture/FEATURE_FLAGS.md）：Claude Runtime 维持隐藏不删、remote bots 维持隐藏不删、Automation 判【相关】保留通用 agent 能力、coding-only tools 零代码、7 套特殊主题全保留、settings 分区全保留。
- 已知限制：tutorial.md 正文约 40 处 Proma 品牌词（作者署名/proma.cool 推广/releases 链接）未动，彻底重写另票；欢迎对话文案（会话名/欢迎词/`model: 'Proma'`）超一句话修正范围，待拍板单票处理。

## PB-114：签名、公证和更新（计划 §24）

- 既有追加 3 条：`electron-builder.yml`（publish 从 ErlichLiu/Proma 改指 wangyu-sg/linguist-agent-public——计划 PB-116 指定公开仓，此前「publish 刻意不变」冻结解除；win fileAssociations 显示名补改 LA 对齐 mac 端）、`package.json`/`bun.lock`（版本 0.15.42）。零新触点。
- 票面 11 项逐项裁定与实测记录见 `docs/release/PB114_RELEASE_READINESS.md`：smoke:pack 全链路 ✓（runtime-deps 137 个同步）、产物 bundle id/版本/asar+unpacked 实测通过、DMG 256MB 实测产出；Developer ID 与公证 blocked（无凭据，本地产物 adhoc 为正确行为）；update channel 代码就绪、实通 blocked（公开仓未建）；app 级版本回滚不建设（allowDowngrade=false 刻意，StoreSchemaTooNewError fail-closed 防降级损坏，回滚路径=重装旧 DMG+PB-111 备份恢复）。

## PB-115：公开发行治理（计划 §24）

- 既有追加 5 条：`AboutSettings.tsx`（Proma 链接统一 proma-ai/Proma + Source Code 行 AGPL §13 + Third-Party Notices 行）、`agent-orchestrator.ts`（「报告问题」外链统一）、根 `package.json`（license-checker-rseidelsohn devDep + license:scan 脚本）、`apps/electron/package.json` 与 `bun.lock`（版本 0.15.43 + 锁文件）。零新触点。
- 新触点 1 条：`.github/workflows/release.yml`（基线文件，PB-115 首次修改：license-scan job）。白名单：NOTICE.md、ATTRIBUTION.md、README.md（allowedNewPaths 原文覆盖）；SECURITY.md、CONTRIBUTING.md、THIRD_PARTY_NOTICES.md、scripts/（本票追加进 allowedNewPaths，随 NOTICE.md 先例）；docs/release/ 全套（SBOM.md + sbom-full.json 415 个第三方包实测）。
- 主 agent 裁决回退：`packages/core/src/providers/user-agent.ts` 等三文件**不改**——UA 字符串带服务端白名单校验（Kimi Coding Plan），URL 是功能性凭据非展示链接；已 git checkout 回退并记入账本。
- 复核结论（PB115_COMPLIANCE_DRAFTS.md 文末）：OpenWorker/Codex 源码复制零命中；context-window.ts 常量为观察值不冲突政策；77 个 M 文件许可头惯例不存在，全局 NOTICE/ATTRIBUTION 覆盖 AGPL §5(a)，逐文件头另票。

## PB-089：CAT 资产源文件预览（计划外增补票，用户拍板选项 A）

- 既有追加 5 条：`packages/shared/src/types/linguist.ts`（独立通道组 LINGUIST_ASSET_PREVIEW_IPC_CHANNELS + 三态 union 契约）、`main/ipc.ts` 与 `preload/index.ts`（注册/桥接，转换栈惰性 import 注入）、`package.json`/`bun.lock`（版本 0.15.44）。零新触点。
- 全部实现落白名单：`project-service.ts` resolveAssetSourcePath（realpath 双重围栏到 source/，照搬 resolveContextDocBlobPath 形状；显式点击语义故缺失/越界抛 StoreNotFoundError 不静默降级）、`project-ipc.ts` previewAssetSource handler（ast- id 严格校验、text 200k 截断护栏、docx/xlsx 转换、未知扩展名降级 proma-file:// url 态；零字节/零路径过 IPC）、`ProjectAssetsSection.tsx` 预览按钮（归档不禁用）+ 新建 `LinguistAssetPreview.tsx`（主 agent 补 DOMPurify 消毒对齐 DiffTabContent 先例）、`asset-preview.nodetest.ts` 10 例（三态/截断/缺 blob/符号链接越界/归档可读/INVALID_INPUT/INTERNAL）。
- 范围裁决：pdf/tmx 不做（pdf 非 CAT 资产、tmx 属 reference 域，账本记限制）；归档项目允许预览（纯读）。

## LF-013：Localization Project Tab 判别联合

- `apps/electron/src/renderer/atoms/tab-atoms.ts` 与 colocated 测试（既有/新触点）— `TabItem` 收敛为判别联合，新增不携带普通 `sessionId` 的 `LocalizationProjectTab`；项目 Tab 的流式状态只通过 project → native Agent Session 映射复用原生 Agent atoms。
- `ScratchPadView.tsx`、`scratch-pad-opener.ts`、`GlobalShortcuts.tsx`、`TabBar.tsx`、`TabBarItem.tsx`、`TabContent.tsx`、`useOpenSession.ts`、`useSyncActiveTabSideEffects.ts`、`external-agent-run.ts`、`renderer/main.tsx`（既有/新触点）— 调用方使用判别字段收窄；项目 Tab 支持标题、关闭、持久化恢复和缺失/归档修复态，本票仅提供安全占位，Workbench 渲染留给 LF-015。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.54；零新依赖。

## AC-004：BrowserWindow 显式安全边界

- `apps/electron/src/main/index.ts`（既有触点）— 主窗口显式固定 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。
- `detached-preview-window.ts`、`quick-task-window.ts`、`voice-dictation-window.ts`（新触点）— 三类辅助窗口补齐同一组显式安全选项；截图窗口基线已完整，无需改动。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.55；零新依赖。

## LF-003：Packaged Vertical Smoke

- `apps/electron/scripts/smoke/probe-pi-stream.ts`（新触点）— Pi Agent packaged probe 增加临时 `--user-data-dir`，与临时 HOME 共同隔离 Electron 单实例锁和用户配置。
- `apps/electron/package.json` / `bun.lock`（既有触点）— 增加 `smoke:vertical` 总入口并同步 Electron 包 patch 版本至 0.15.56；零新依赖。
- 总编排、合同测试和证据说明落在既有 smoke/tests/docs 白名单；复用 G1/G0/G7，不复制 Playwright 或 Fake Model harness。

## LF-014：打开与恢复 Localization Project

- `ModeSwitcher.tsx`、`LeftSidebar.tsx`（既有触点）— 展开/折叠 Linguist 入口统一恢复最后打开的 Project Tab；没有项目 Tab 时进入项目管理面，不借 Agent/Chat Session。
- `components/welcome/WelcomeView.tsx` — Linguist 空 Tab 启动时执行同一恢复；无 Project Tab 时进入项目管理空态，不误建 Agent/Chat draft。
- `hooks/useSwitchAppMode.ts` 与 `lib/linguist-navigation.ts`（后者兼 LF-016）— 集中所有模式入口的 Project MRU 恢复与 Jotai 导航状态切换，避免 Proma 组件各自反向 import Linguist feature。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.57；零新依赖。
- 打开编排与 BDD 测试位于 Linguist feature 白名单：先经 Project IPC 成功打开，再创建/激活 Project Tab；失败保持原导航不变。`ProjectsView` 只把卡片入口改接该编排，旧详情实现暂留后续退役票。

## LF-020：共享 Project List Resource

- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.58；零新依赖。
- 实现全部位于 Linguist feature 白名单：以 Jotai `atomWithRefresh` + `unwrap` 提供 loading/error/ready 与显式 refresh 的最小共享接口；同一 Store 内复用 in-flight Promise 和最近结果，主进程仍是数据真源。
- `ProjectsView` 改读共享资源，创建、归档、迁移和详情返回统一失效缓存；Sidebar 消费留给 LF-021，不提前新增产品面。

## LF-015：Localization Project Workbench 挂载

- `components/tabs/TabContent.tsx` 与 colocated `TabContent.linguist.test.tsx`（既有/新触点）— 正常 Project Tab 直接挂载 `LocalizationProjectWorkbench`；missing/archived repair state 保持阻断，不伪造 Session 身份。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.59；零新依赖。
- Workbench 与测试落在 Linguist feature 白名单：冷恢复自行调用 Project open，类型化错误可重试；成功后过渡复用既有 `CatWorkspace`，不提前复制 LF-040/041 的项目状态与新 Shell，也不提前删除 LF-076 的旧布局。

## LF-021：Linguist Sidebar Content

- `components/app-shell/LeftSidebar.tsx`（既有触点）— 展开 Linguist 模式只接入独立 `LinguistSidebarContent`，不复刻 Agent/Chat 会话树。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.60；零新依赖。
- Sidebar 实现与 SSR BDD 测试位于 Linguist feature 白名单：直接消费 LF-020 共享资源，覆盖 loading/error+retry/empty/活跃项目四态并过滤归档；点击 Editor、项目会话和管理入口仍分别留给 LF-022/023/025。

## LF-016：Project Tab 生命周期闭环

- `renderer/atoms/tab-atoms.ts` 与 colocated 测试（既有触点）— 激活 Tab 统一维护 MRU；Preview 仍归属 Session，Project 使用自身 Tab ID；关闭时过滤失效 MRU，状态 indicator 继续映射原生 Agent Session。
- `components/tabs/TabSwitcher.tsx` 与 `renderer/lib/linguist-navigation.ts`（兼 LF-014）— Ctrl+Tab 候选纳入 Project Tab，并按 Project MRU/indicator 激活同一 Linguist 导航状态；Agent/Chat 切换路径不变。
- `renderer/main.tsx`（既有触点）— `tabState` 可选持久化 MRU，恢复时只接纳仍有效的 Session/Project 身份并订阅 MRU 变化；旧状态无 MRU 仍兼容。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.61；零新依赖。
- 最近项目选择与 BDD 增量位于 Linguist feature 白名单：优先 Project MRU，旧数据回退最后打开；关闭 Project 不删除项目、不带走无关 Agent/Preview。

## LF-022：侧栏单击进入 Editor

- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.62；零新依赖。
- 实现全部位于 Linguist feature 白名单：项目行改为可访问 button，复用 LF-014 `openLocalizationProject`，当前项目以 `aria-current="page"` 标识；失败复用类型化错误且底层保证导航不变。
- 未提前实现项目会话、最近上下文恢复或管理入口（LF-023～025）。

## LF-040：Project-scoped Workbench UI State

- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.63；零新依赖。
- 实现全部位于 Linguist feature 白名单：单个 Map seam `linguistWorkbenchUiStateAtomFamily(projectId)` 隔离资产、Segment、selection、filters、QA、面板布局与 active Agent Session；只存 opaque ID/UI 数据，不镜像 CAT 真相。
- 既有 `CatWorkspace` 与 `CatContextRail` 迁入项目 seam；关闭/重开同项目保留本应用会话状态，不同项目不串。LF-041 的 Shell/Toolbar 尚未实现，布局字段仅按计划定义默认值。

## LF-023：项目 Agent Sessions

- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.64；零新依赖。
- 实现全部位于 Linguist feature 白名单：Sidebar 直接过滤原生 `agentSessionsAtom` 的项目绑定会话，排除普通/其他项目/归档会话；创建走既有 `linguistSessionsCreateForProject`，列表更新复用 freshness helper。
- 选择/创建只更新 Project→native Agent Session 映射并保持 Project Workbench；项目未激活时先复用 LF-014 打开编排。未提前实现 LF-032 的完整懒创建/恢复或 LF-033 Agent rail。

## AC-007：G10 长线程首载、补载与跳转

- `AgentMessages.tsx` / `SDKMessageRenderer.tsx`（既有触点）— Agent 历史首次只挂最近 120 个 group；顶部补载保持 DOM 锚点，流式 turn 仍落最近窗口。
- `agent-message-window.ts` / `.test.ts`、`scroll-minimap.tsx`（新触点）— 最小纯函数窗口 seam 与 BDD；minimap 命中未挂载历史时先切换目标窗口，再复用既有滚动定位。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.65；零新依赖。
- smoke 探针位于既有 `scripts/smoke/` 白名单：修正错误会话 selector，并提供 `--long-thread-only` 专项；打包实测 8/8，通过首开、顶部补载锚点和第 500 轮跳转。

## LF-041：Workbench Shell、Toolbar、Status Bar

- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.66；零新依赖。
- Shell、摘要加载、CAT 内容接线与 BDD 全部位于 Linguist feature 白名单；直接复用 LF-040 项目级布局状态，不新增第二套状态容器。
- Toolbar/Status Bar 只展示真实 Project summary 与已有快捷键；Asset Navigator、Agent Rail、Bottom Dock 预留 React slot，具体内容仍归 LF-042、LF-033、LF-050。

## LF-032：Project Agent Session 选择、懒创建和恢复

- `project-agent-session-atoms.ts` / `.test.ts`（新触点）— Project→原生 Agent Session 唯一真源；校验项目绑定与归档状态，失效选择回退到最新有效会话。
- `tab-atoms.ts` / `.test.ts`、`renderer/main.tsx`（既有触点）— 保留兼容导出与 indicator 回归；启动恢复、debounce 保存及 beforeunload 同步保存项目 Session 选择。
- `src/types/settings.ts`（新触点）— settings 只保存 Project/Session opaque ID 映射；不复制 Session、CAT 或项目内容。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.67；零新依赖。
- 选择/创建 seam 与 Workbench/Sidebar 接线位于 Linguist feature 白名单；首次打开项目不会创建 Agent Session，同项目并发首次需求只发一次创建 IPC。

## LF-024：最近项目与 Workbench 位置恢复

- `renderer/main.tsx`、`src/types/settings.ts`（既有触点）— 在既有 Tab 持久化批次中保存/恢复每项目最后 Asset/Segment opaque ID，不复制 CAT 内容，异步启动回填不覆盖运行期状态。
- Workbench 位置解析、项目隔离和 CAT 真源校验位于 Linguist feature 白名单；失效引用只清除，不猜测替代 ID。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.68；零新依赖。

## LF-033：Workbench 嵌入原生 Agent Rail

- 实现全部位于 Linguist feature 与根测试白名单：Workbench 按项目状态懒挂载 `ProjectAgentRail`，内部唯一行为实现仍是 `AgentView presentation="rail"`。
- Rail 默认关闭；首次展开才复用 LF-032 会话选择/创建 seam，失败显式阻断并可重试，不新增 Composer、Messages、Store 或全局 Listener。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.69；零新依赖。

## LF-060：LinguistTurnContextV1 严格契约

- `packages/shared/src/types/linguist-turn-context.ts` / `.test.ts`（新触点）与 `types/index.ts`（既有触点）— 固定 V1 字段、opaque ID、100 个选择上限、显式截断标记、深冻结与确定性序列化；未知字段、路径、正文和错误版本一律拒绝。
- 主进程项目/Session/Asset/Segment/QA 归属校验位于 Linguist main 白名单；Context 只能描述冻结绑定，不能改变绑定。
- `packages/shared/package.json`、`apps/electron/package.json`、`bun.lock`（既有触点）— shared 0.1.61、Electron 0.15.70；零新依赖。

## LF-025：Project 管理次级入口

- 实现与 BDD 测试均位于 Linguist feature 白名单；Sidebar 项目行仍直达 Editor，只复用既有 `activeView='projects'` 提供“管理项目”次级入口。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.71；零新依赖。

## AC-005：Project Binding fail-closed 与永久解绑

- `packages/shared/src/types/agent.ts` / `linguist.ts`（既有触点）— 增加 missing/unavailable TypedError、四态绑定与永久解绑 IPC 契约。
- `main/lib/agent-session-manager.ts`（既有触点）— 常规更新仍冻结绑定，仅专用幂等入口可永久清除项目快照和 reviewer 角色。
- `main/ipc.ts` / `preload/index.ts`（既有触点）— 接线 `linguist.sessions.detachBinding`；缺失或服务不可用时主进程发送闸门 fail closed。
- UI、服务处理器、BDD 与 packaged probe 位于 Linguist/Smoke 白名单；未复制 Agent 发送实现。
- `packages/shared/package.json`、`apps/electron/package.json`、`bun.lock`（既有触点）— shared 0.1.62、Electron 0.15.72；零新依赖。

## LF-034：Agent Rail 可调整、折叠和项目级持久化

- Workbench Rail 使用原生 Pointer Capture 与可访问 separator；宽度限制 340–600px，键盘支持方向键、Home、End。
- 窄窗口复用同一 Rail 作为右侧 overlay；开合与宽度写入既有项目级 Workbench 偏好，不新建状态真源。
- `src/types/settings.ts`（既有触点）— 项目偏好增加 `agentRailOpen` / `agentRailWidth`。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.73；零新依赖。

## LF-061：原生 Composer Context Chips

- `components/agent/AgentView.tsx`（既有触点）— 只增加可选 `contextSummary` 展示缝，输入器仍是唯一原生 RichTextInput。
- Context Chips 与组装逻辑位于 Linguist feature 白名单；普通 Agent 不渲染空壳，清除只影响 selected Segments。
- `renderer/styles/globals.css`（既有触点）— 用原生 container query 在 ≤360px Rail 折叠为一枚摘要。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.74；零新依赖。

## LF-035：完整 Agent Tab 与返回 Linguist

- Project Agent Rail 通过既有 `useOpenSession` 打开同一 Session 的原生 Full Agent Tab，不复制消息、Composer 或工具行为。
- Full Agent 的项目绑定徽章复用 `openLocalizationProject` 返回原 Project Tab，并保留该项目 Workbench 状态。
- 实现与 BDD 位于 Linguist feature / 根测试白名单。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 包 patch 版本同步至 0.15.75；零新依赖。

## LF-036：Native Agent 全模式回归

- 不改生产代码；根契约覆盖 Agent Full、Project Rail 与 Chat 的原生路由、消息、Composer、发送/停止和恢复行为。
- Fusion 架构护栏登记 LF-061 已批准的 `AgentView.contextSummary` 窄 prop，仍拒绝其他未登记的 Proma → Linguist importer。

## LF-042：Asset Navigator

- Navigator 与 UI 状态位于 Linguist feature 白名单；搜索、选择、每资产最后活动 Segment、开合与约束宽度均复用项目级 Jotai 状态，并通过既有 settings seam 按项目恢复布局。
- `packages/shared/src/types/linguist.ts` 与契约测试（既有/新触点）— Summary 资产增加真实状态计数和开放 QA 数，CAT 分页继续只返回静态元数据。
- Store 聚合实现位于 `packages/linguist-*` 白名单；每类统计均为一次 `GROUP BY` 查询。
- `packages/shared/package.json`、`apps/electron/package.json`、`bun.lock`（既有触点）— Shared 0.1.63、Electron 0.15.76、Cat Store 0.0.11；零新依赖。

## LF-062：每 Turn 不可变 Context Snapshot

- `renderer/main.tsx` 通过既有组合根向原生 `AgentView` 注入同步 snapshot capture；Agent 组件不新增 Linguist feature 反向依赖。
- `AgentView`、原生 message queue 与 `agent-service` 只透传同一冻结 snapshot，普通发送、queue、steer 和 fallback 不建立第二条行为链。
- `agent-orchestrator.ts` 在持久化和模型调用前验证 binding/ownership，注入 host-owned 结构块并将 snapshot 随用户 Turn 保存。
- `packages/shared/src/types/agent.ts` 增加可选 V1 Context 线类型；Shared 0.1.64、Electron 0.15.77，零新依赖。

## LF-043：Segment Grid

- 新 Grid、虚拟分页与 BDD 均位于 Linguist feature 白名单；复用既有 `@tanstack/react-virtual`、CAT Query 与 CAS IPC。
- 分页合并保留已加载行，单页刷新不会清空其他虚拟窗口；无新状态真源。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.78；零新依赖。

## LF-050：Bottom Dock 壳

- Dock、标签页与 BDD 位于 Linguist feature 白名单；复用项目级 Workbench Jotai 状态和既有 settings seam。
- 高度限制 160～480px，支持 Pointer Capture、键盘调整、折叠与窄窗口 overlay；活动片段沿用 Grid 的唯一项目状态。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.79；零新依赖。

## LF-070：Project Settings Sheet

- Sheet 与 BDD 位于 Linguist feature 白名单；入口复用 Workbench Toolbar，开合状态仍归属项目级 Jotai 状态。
- 复用既有 Proma Sheet/Tabs 组件，只建立唯一设置容器与项目元信息边界；资源和维护内容留给 LF-071/LF-072。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.80；零新依赖。

## LF-054：Context / Evidence Panel

- Panel 与 BDD 位于 Linguist feature 白名单；复用既有 CAT Context、资源查询 IPC 与 Bottom Dock 项目状态。
- 只读取当前 Segment 的 Style/Voice/Context/TM 摘要和 Proposal evidence；不复制全量资源管理 UI。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.81；零新依赖。

## LF-044：Target Editor

- 独立 Editor 与 BDD 位于 Linguist feature 白名单；Grid 只组合该组件，继续复用既有 CAS 保存回调。
- IME、Undo/Redo、Tag/Placeholder hard rail 与 Replace/Insert 均只操作未保存草稿；locked/archived 不可写。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.82；零新依赖。

## LF-063：CAT Tool Project Mutation Event

- CAT Tools 仅在真实写入后报告受影响的 Segment/Proposal/QA opaque ID；只读、check-only 与幂等重跑静默。
- `agent-orchestrator.ts` / `agent-service.ts` 复用原生 Agent 运行链发出主进程可信事件；Project ID 来自 Session binding。
- `preload/index.ts` 与 Shared 契约只暴露 typed subscribe/unsubscribe，不开放 renderer 伪造 mutation 的入口。
- `packages/shared/package.json`、`packages/linguist-cat-tools/package.json`、`apps/electron/package.json` 与 `bun.lock` 同步至 0.1.65 / 0.0.8 / 0.15.83；零新依赖。

## LF-071：Project Settings 项目资源

- 资源页实现与 BDD 全部位于 Linguist feature 白名单，直接组合既有资源组件与 IPC。
- 旧管理入口保留至后续 Legacy 收敛票；本票不复制 Import、TM/TB 或项目资源真相。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.84；零新依赖。

## LF-064：Workbench Mutation 增量刷新

- 项目级 Jotai mutation 状态只保存 opaque IDs 与单调 revision；重复、乱序和跨项目事件不进入刷新链。
- Grid 仅回拉受影响的已加载页；revision gap 或筛选集可能变化时回拉当前页，不复制项目数据。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.85；零新依赖。

## LF-072：Project Settings 维护与可恢复删除

- 维护页直接复用既有 Backup、Health 与 Archive 能力；归档入口在旧/新页面共用同一 hook。
- 删除由主进程强制“已归档 + 精确项目名确认”，完整项目目录移入数据根 `trash/`，不级联删除 Agent Session。
- `components/ui/confirm-dialog.tsx` 仅增加 `confirmDisabled`，项目名未精确匹配前不能提交。
- Shared / Preload 只暴露 typed request/result 与恢复目录 basename，renderer 不接触绝对路径。
- `packages/linguist-cat-store/package.json`、`packages/shared/package.json`、`apps/electron/package.json` 与 `bun.lock` 同步至 0.0.12 / 0.1.66 / 0.15.86；零新依赖。

## LF-055：Bottom Dock Preview Panel

- Bottom Dock 直接复用既有 `linguistProjectsPreviewAssetSource` 主进程围栏与源文件预览组件，只增加嵌入式只读表面。
- 活动 Asset 来自项目级 Workbench Jotai 状态；无选择时显示空态，不复制资产正文或新增编辑路径。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.87；零新依赖。

## LF-045：Target 保存与 Revision Conflict

- 新 Segment Grid 继续复用既有 CAS 编辑 IPC；保存结果只扩展为 saved/conflict/failed 三态。
- Revision Conflict 保留草稿，必须由用户明确选择加载最新译文或基于最新 revision 保留草稿后才可重试。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.88；零新依赖。

## LF-065：CAT Tool Result 原生摘要

- `tool-result-renderers/index.tsx` 只为 `cat_*` 接入一个窄 renderer；错误、未知或畸形 payload 继续回退 Proma `DefaultResultRenderer`。
- `cat-result.tsx` 仅显示统计摘要，隐藏客户正文和本机路径；Tool Activity 既有短语表补齐 Critic 与 Batch Consistency。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.89；零新依赖。

## LF-066：CAT Tool Result 定位 Project / Segment

- CAT Tools 的成功结果由 Session binding 宿主注入 Project ID 与最多一个 Segment anchor；模型没有对应入参，既有 DTO 字段不被覆盖。
- `cat-result.tsx` 仅为严格 ID 显示导航按钮；组合根复用 `openLocalizationProject` 和 Project-scoped Context 校验后更新项目 Jotai 状态。
- `renderer/main.tsx` 挂载唯一 initializer；`atoms/cat-result-navigation-atoms.ts` 只携带 opaque ID 和 revision。
- `packages/linguist-cat-tools/package.json`、`apps/electron/package.json` 与 `bun.lock` 同步至 0.0.9 / 0.15.90；零新依赖。

## LF-073：Projects 管理首页收敛

- `ProjectsView` 不再消费 `ProjectDetailPanel`；卡片/打开动作统一复用 `openLocalizationProject` 进入一等 Project Tab。
- 项目设置直接复用 LF-070～072 的 Sheet；管理首页保留项目列表、新建、迁移、健康状态、归档与设置入口。
- `MainArea.tsx` 仅同步路由注释，明确 `activeView='projects'` 是管理首页。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.91；零新依赖。

## LF-074：删除 ProjectDetail 内部工作导航

- 删除白名单路径内已无生产消费者的 `ProjectDetailPanel.tsx` 与其唯一私有子组件 `ProjectChatsSection.tsx`；不新增替代页面、不触碰 Project Session、CAT Store/Tools 或现有 Workbench。
- `tests/no-raw-palette.test.ts` 移除已删除文件的静态扫描项，其他 Linguist token 防回归范围不变。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.101 → 0.15.102；零新依赖。

## LF-077：退役 Projects 日常工作入口

- `components/app-shell/LeftSidebar.tsx`（既有触点）— 删除展开态 `ProjectsSidebarEntry`、收起态 Rail 项目按钮和共享切换回调；完整 Agent/Chat/Linguist 模式入口不变。
- `renderer/lib/feature-flags.ts` 与测试（既有触点）— 删除只服务旧入口的 `LINGUIST_PROJECTS_VISIBLE`；其余 Proma 功能开关不变。
- `components/tabs/MainArea.tsx`、`components/app-shell/AppShell.tsx`、`renderer/atoms/active-view.ts` 与 `active-view.test.ts`（既有触点）— 保留 `activeView='projects'`，但仅作为 `LinguistSidebarContent` 次级“管理项目”入口的管理路由；主区与 Agent Rail 共用模式归一化，日常项目工作继续由一等 Project Tab 承载。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.102 → 0.15.103；零新依赖。

## LF-082：Linguist Rail / Session 原生管理面

- `components/app-shell/LeftSidebar.tsx`（既有触点）— 删除确认改由实体类型分派，不再从当前 appMode 推测 Chat / Agent；普通 Agent 会话行复用共享 Session item / actions，既有委派、移动、状态与预览能力不变。
- `components/session-tree/AgentSessionTreeItem.tsx`、`AgentSessionActionsMenu.tsx`、`session-actions.ts` 与 `session-actions.test.ts`（新触点）— 提取普通 Agent / Linguist 共用的最小标题编辑、会话动作菜单与 typed 删除分派；Linguist 不开放跨项目移动，不建立第二套 Session store/runtime。
- `src/types/settings.ts`（既有触点）— Workbench 位置新增 `closed | rail | full` presentation；旧 `agentRailOpen` 只读兼容并在下一次保存时迁移。
- Rail / Full、Linguist Session fallback、Project menu 与 BDD 均位于 Linguist feature 白名单；继续复用同一个 `AgentView`、项目级 Jotai 状态和已有稳定 IPC。
- 按主任务协调，本提交不修改 `apps/electron/package.json`、`bun.lock` 或版本号；零新依赖。

## LF-075：删除旧 CatContextRail

- 删除 Linguist 白名单路径内的 `CatContextRail.tsx`、`CatWorkspace` 唯一挂载点、专用 `CatContextTab` 与重复的 context mutation revision；
- Bottom Dock 继续承载 TM、术语、QA、Context/Evidence，Grid 继续承载 Segment 详情、Proposal inline diff 与 Accept/Reject；CAT Store、Tools、Project Service 与 Jotai 项目状态不变；
- `components/app-shell/AppShell.tsx`、`right-rail-policy.ts` 及测试（既有触点）仅删除已失效的“两套 Rail”注释，不改变 Proma Agent Rail 判定；
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.103 → 0.15.104；零新依赖。

## LF-046：Grid 行内质量状态与当前行详情

- Segment Grid 复用既有 Proposal、QA Finding 与项目级 Workbench Jotai 状态，行内显示状态、Proposal、开放 QA 数量和最高严重度。
- QA 单元格与当前行详情入口只切换既有 Bottom Dock；不建立第二套项目数据或写入链。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.92；零新依赖。

## LF-047：Grid 键盘与可访问语义

- Segment Grid 只扩展 Linguist feature 内既有虚拟行、TargetEditor 与纯键盘函数；不改 Proma Tab、Composer 或全局焦点系统。
- Grid/row/column、selection、locked/archived、快捷键、busy/live 状态均使用原生 ARIA；非活动行操作退出 Tab 顺序。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.93；零新依赖。

## LF-051：TM Match Panel 与草稿操作

- Bottom Dock TM 面板复用既有 CAT Context IPC 与 TargetEditor；Replace/Insert 只修改当前未保存草稿，不新增写库或保存路径。
- Project-scoped transient atom 只保存当前 Segment ID 与编辑命令句柄，不持久化、镜像或跨项目传递客户文本。
- locked、archived、编辑器缺失、Segment 不匹配与 Tag/Placeholder 违规均 fail closed；TM score、origin 与 Exact/Contains/Fuzzy 明确可见。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.94；零新依赖。

## LF-052：Term Match Panel 与草稿插入

- Bottom Dock 术语面板复用 LF-051 的 Project-scoped TargetEditor capability 与 CAT Context IPC；Insert 只修改当前 selection/caret 草稿。
- 面板只展示后端真实 term/translation/status/caseSensitive/note/matchType/conflict 字段，不虚构 priority。
- Project/Segment 切换、编辑器缺失、locked、archived 与 Tag/Placeholder 违规均 fail closed；不新增保存或写库路径。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.95；零新依赖。

## LF-067：Proposal Inline Review 与审核终态同步

- `apps/electron/src/main/ipc.ts` 只为既有 renderer-only Proposal 审核注入 host-owned mutation 广播；仅真实、成功且非幂等重放的写入发出 `proposal-reviewed`。
- `apps/electron/src/renderer/components/agent/tool-result-renderers/cat-result.tsx` 及测试只对严格 Proposal ID 回查 Store 终态，并在 `proposal-reviewed` 后刷新摘要；失败不伪造审核状态。
- Grid、Proposal IPC 与 Store 实现均位于既有 Linguist allowed-new 路径，不新增 Proma 核心触点。
- `apps/electron/package.json`、`packages/linguist-cat-store/package.json` 与 `bun.lock` 同步至 0.15.96 / 0.0.13；零新依赖。

## LF-068：选中 Segment 的 Agent 翻译/审校/QA 工作流

- `apps/electron/src/renderer/atoms/agent-atoms.ts` 只让原生 `AgentPendingPrompt` 可选携带动作点击时冻结的 Linguist Context；普通 Agent pending prompt 保持无 Context。
- `apps/electron/src/renderer/components/agent/AgentView.tsx` 及定向 BDD 继续复用原生 pending prompt、乐观消息和 `AgentSendInput` 路径，并传递同一冻结 Context。
- Project Agent 快捷动作实现与 BDD 位于 Linguist allowed-new 路径，不登记为 Proma 核心触点；没有新增 IPC、Agent、Composer 或状态真源。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.97；零新依赖。

## LF-053：Segment QA Panel + 跳转/处理

- Segment-scoped QA Panel、处置围栏与 BDD 全部位于 Linguist feature allowed-new 路径，不登记为 Proma 核心触点。
- 复用既有 QA list/run/resolve/waive IPC 与 Workbench 当前片段状态；没有新增 IPC、DTO、Store 或状态真源。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.98；零新依赖。

## LF-048：无 Agent 手工 CAT Gate 源码缺口

- Segment Grid 双击编辑及 BDD 位于既有 Linguist feature allowed-new 路径，不登记为 Proma 核心触点。
- 双击继续复用既有 Target 编辑入口；没有新增 IPC、DTO、Store、状态真源或依赖。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.99；零新依赖。

## AC-006：Export 防覆盖原稿/受管目录

- `apps/electron/src/main/lib/linguist/export-ipc.ts` 及测试位于既有 Linguist main allowed-new 路径；CAT Store 版本文件位于 `packages/linguist-*` allowed-new 路径，均不登记为 Proma 核心触点。
- Native Save 使用 `COPYFILE_EXCL` 拒绝已存在目标，并以父目录 `realpath` 拒绝受管数据根及符号链接别名；默认文件名由 CAT Store 生成 `.translated.<locale>` 后缀。
- `apps/electron/package.json` / `bun.lock`（既有触点）— Electron 0.15.100、CAT Store 0.0.14；零新依赖。

## AC-008：原生界面无障碍收口

- 既有 Agent、侧栏、Tab、会话预览与消息组件补齐图标按钮中文 aria-label、可达焦点和切换状态语义；时间、非选中模式及会话预览小号状态文字提升对比度，收口 Axe 检查。
- Sticky User Message 改为消息流内不透底导航条；窄 Rail 使用单行摘要且只有按钮接收点击，避免遮挡消息与 CAT Tool 操作。
- `ChatHeader.tsx`、`ChatInput.tsx`、`ContextSettingsPopover.tsx`、`ToolSelectorPopover.tsx`、`ModelSelector.tsx`、`SystemPromptSelector.tsx` — 补齐完整 Chat 标题、Composer、模型搜索、工具 Switch 与 Popover 图标按钮的中文 aria-label；置顶、并排与思考模式补 aria-pressed，提示词动作改用键盘可达菜单项。
- `LeftSidebar.tsx` 与 `TabBarItem.tsx` 移除嵌套交互控件：会话选择与关闭标签均由相邻原生 button 承担，键盘焦点可见。
- 新增 `conversation.tsx`、`speech-button.tsx`、`ChatMessageItem.tsx`、`DiffPanelTabBar.tsx`、`CodeBlock.tsx` 触点及三处定向 BDD；`CodeBlock` 可键盘聚焦并说明水平滚动。
- `apps/electron/package.json` / `packages/ui/package.json` / `bun.lock`（既有触点）— Electron 0.15.101、UI 0.1.10；零新依赖。

## LF-080：Agent Vertical Profile、Execution Scope 与能力继承契约

- `packages/shared/src/types/agent-profile.ts` 及 BDD 新增判别式 `AgentProfile`：Linguist
  项目身份、角色与策略只从持久化 Session metadata 解析；历史会话兼容
  assistant / balanced，且项目身份优先于残留 `workspaceId`。
- `packages/shared/src/types/agent.ts` / `index.ts` 与
  `apps/electron/src/main/lib/agent-session-manager.ts`（既有触点）— 冻结并导出
  `linguistStrategy`；Fork 保留完整绑定，Fork / Rewind / Delete 统一走 Execution
  Scope，Linguist Session 删除时把 CWD 移入受管 Trash。
- `apps/electron/src/main/lib/agent-orchestrator.ts`（既有触点）— Send / Rewind
  不再按当前 UI mode 或临时入参猜 cwd；Proma Base Tool/MCP 原样继承，Linguist
  只追加 CAT Overlay。Pi 使用原生 customTools，Claude 复用同一 ToolDefinition
  经进程内 SDK MCP 注入；重名 fail loud，Plan 模式未知或写 CAT 工具默认拒绝。
- Execution Scope、Session Workspace、Tool Composer 与 Claude MCP adapter 位于
  `main/lib/linguist/` allowed-new 路径；不复制 `cat.db`，不新增第二 Runtime、
  AgentView 或 Session Store。
- `.github/workflows/ci.yml`（allowed-new）与 `release.yml`（既有触点）使用已核验
  的 Node 24 Action commit；license scanner 补齐 SDK 0.3.201 四个 Linux 平台包
  的显式专有许可登记，不以通配符放行未来包。
- `packages/shared/package.json` 0.1.73→0.1.74；
  `apps/electron/package.json` 0.15.134→0.15.135；零新依赖。

## LF-079：Linguist Prompt Overlay 复用 Proma Base

- `apps/electron/src/main/lib/agent-orchestrator.ts`（既有多票触点）— 在既有 `buildSystemPrompt` / Claude `claude_code` preset 之后只构建一次 Linguist Prompt overlay，Pi 与 Claude 两条原生 Runtime 追加同一 Profile / Role / Strategy / Project Digest；Proma Base、Provider、Permission、Thinking 与 Tool 装配保持原所有者。
- 分层 Prompt composer、同版本内置 fallback、项目数据边界、Digest 缓存与测试均位于 `main/lib/linguist/**`、`resources/linguist-skills/**` 和根 `tests/**` 白名单；零新依赖。

## LF-083：Durable Job / Recovery / Project Event Outbox

- `packages/shared/src/types/linguist.ts`、`packages/shared/package.json` 与
  `bun.lock`（既有触点）— 新增项目事件 list/ack 通道、版本化事件/进度 DTO；
  shared 0.1.75→0.1.76，cat-store 0.0.21→0.0.22，cat-tools
  0.0.14→0.0.15；零新依赖。
- `apps/electron/src/main/ipc.ts` 与 `apps/electron/src/preload/index.ts`
  （既有触点）— 仅增加 durable event gap pull/显式 ack 的四层薄接线；
  处理器、重连补拉与 Jotai 消费位于既有 Linguist 白名单。
- `apps/electron/package.json`（既有触点）— 主进程构建/监听增加独立 CAT QA
  worker entry，生产路径使用 `node:worker_threads`；按主任务协调不修改
  Electron 版本。
- Job/checkpoint、mutation idempotency、run summary/undo、SQLite outbox、
  QA worker runner 与一致性 advisory adapter 均位于 `packages/linguist-*`
  或 `main/lib/linguist/**` 白名单；复用同一 `cat.db`、事务、revision CAS
  与 Session authority，零新依赖。LF-084 的显式 consistency plan/apply
  mutation 已接入同一原子 receipt/outbox；一致性生产 worker 尚未接线，
  本票不把 adapter 记为完整 LA-PERF-002。

## LF-084：Rules / Performance hard gates 与批量上下文

- `packages/shared/src/types/linguist.ts`（既有触点）— Proposal 列表项直接携带
  Store 单 JOIN 生成的 diff DTO；Renderer 不再逐条发起详情 IPC。
- `packages/shared/package.json` / `bun.lock`（既有触点）— shared 同步至
  0.1.75；CAT Core 精确锁定 `@formatjs/icu-messageformat-parser@3.5.15`，
  并同步 cat-core / cat-store / cat-tools 至 0.0.10 / 0.0.21 / 0.0.14。
- `docs/release/sbom-full.json`（`docs/` 白名单）— 依生产闭包重生成 417 项
  SBOM；新增 parser 与其 skeleton parser 均为 MIT，许可门禁通过。
- hard rules、consistency plan/apply、批量 Store 查询、opaque context cursor 与
  benchmark 均位于 `packages/linguist-*` 或 Electron Linguist 白名单；本票不改
  Job/Outbox/Idempotency schema，也不登记尚未合并的 CAT worker/job runner。
- 按集成边界，本提交不递增 `apps/electron/package.json`；Electron 源码版本由
  主任务统一同步。

## LF-085：CAT Tool Result 模型/UI 投影

- `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`（新触点）— 复用 Pi
  `convertToLlm` seam，在请求模型前把 `cat_*` 的结构化 `details` 临时变为
  text content；持久化消息仍只有短摘要与单份 DTO，普通工具及不可序列化值不变。
- `ContentBlock.tsx`、`tool-result-renderers/cat-result.tsx` 与既有 BDD（多票共改）
  — Renderer 只在能够生成脱敏统计摘要时读取 `tool_use_result`；补齐新增四类
  CAT 工具摘要，未知或畸形 payload 继续展示短 content，不展开客户正文。
- 投影纯函数和测试位于 `main/lib/linguist/**` 白名单；零新依赖。

## LF-086：安全导出与 Linguist Diagnostics

- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts` /
  `packages/shared/src/types/linguist.ts`（既有多票触点）— 接线 Linguist-only
  Diagnostics 状态、脱敏预览与显式导出，并扩展导出 digest / size / time /
  project revision 线类型；处理器、加固复制和 UI 均位于 Linguist 白名单路径。
- `apps/electron/src/main/lib/agent-orchestrator.ts`（既有多票触点）— 在既有
  Runtime tool 组合完成后只记录真实 Runtime、Base / Overlay tool 数与时间，
  供同一 Diagnostics seam 使用；不复制 Agent Session 状态。
- 诊断包默认 allowlist 脱敏、仅用户预览后显式导出且不上传；Prompt 降级状态与
  `retry: true` 重新探测复用真实 Prompt 构建。零新依赖、零 schema 变化。

## LF-087：Stable ID v2 跨层兼容

- `packages/shared/src/types/linguist.ts`（既有多票触点）— 内容派生
  Asset、Segment、Proposal、QA、TM/TB 与项目资产校验同时接受历史 v1 和
  新建的完整 SHA-256 v2；随机 Project ID 保持既有 v1 契约。
- `tool-result-renderers/cat-result.tsx` 与既有 BDD（多票共改）— 直接复用
  shared Proposal 校验；历史 Timeline 与新结果均可回查 Store，畸形 digest
  继续 fail closed。
- 生成、Store、main handler、smoke fixture 与其余测试均位于 Linguist
  白名单；没有复制 Agent UI、状态源或 Runtime，零新依赖。

## LF-088：Quick Health、Full Integrity Scrub 与恢复完整性

- `apps/electron/src/main/ipc.ts` / `src/preload/index.ts` /
  `packages/shared/src/types/linguist.ts`（既有多票触点）— 接线 Quick Health 与
  Full Integrity Scrub 的 typed contract、进度、取消和原生脱敏报告保存；
  renderer 不提交路径或 project authority。
- `apps/electron/src/main/index.ts`（既有触点）— 退出前终止 Integrity workers；
  `apps/electron/package.json`（既有触点）— build/watch 在保留 QA + Consistency
  CAT worker 的同时构建独立 Integrity worker。
- worker/service/UI 与 Store integrity/backup/restore 均位于 Linguist 白名单；
  Full Scrub 使用 `node:worker_threads`，备份 staging 原子提交、恢复 fail closed。
  不改 schema、数据 provenance、依赖、lock 或版本号。

## LF-089：Proposal Issuance 与 Required 术语生产语义

- `apps/electron/src/main/lib/agent-orchestrator.ts`（既有多票触点）— 每个发送
  Turn 在局部闭包中复用一次 `buildLinguistProjectAssetsPromptWithStatus`，
  把真实 Runtime / Provider / Model、Prompt 状态、验证后的 Turn Context
  稳定快照与最终 Tool composition hash 传给 Pi / Claude 共用的 CAT tools；
  不新增全局可变 provenance，也不让 Renderer 提交 authority。
- `packages/shared/src/types/linguist.ts`（既有多票触点）— 术语状态增加
  `required`，Proposal diff 增加兼容的 issuance count / latest provenance DTO；
  历史线格式仍可缺省新字段。
- Proposal Issuance v13 migration、历史 backfill、Required / Forbidden 中央 hard
  gate、Critic provenance、Store / Tool / IPC / Renderer 接线与 BDD 均位于
  `packages/linguist-*` 或 Electron Linguist 白名单；保留 v12 Harness 的
  job/event/run_changes/receipt/outbox 结构与 Stable ID v2，零新依赖。
