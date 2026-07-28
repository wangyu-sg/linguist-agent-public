# Linguist Fusion Execution Ledger

> 本账本对应 `docs/roadmap/LINGUIST_MODE_AND_CAT_WORKBENCH_IMPLEMENTATION_PLAN_CN.md`，不覆盖旧 PB/Alpha 账本。每个 LF/AC 工单一票一提交；Gate 记录验证结果，Decision 记录用户决定。

## 当前指针

| 字段 | 值 |
|---|---|
| plan | `LINGUIST_MODE_AND_CAT_WORKBENCH_IMPLEMENTATION_PLAN_CN.md` v1.0 |
| repository | `/Users/<local>/Desktop/linguist-agent-next` |
| branch | `main` |
| LF-000 base HEAD | `7ed72f2990746f7831aa0b34c9ac1ca18e5d60c8` |
| LF-000 result commit | `SELF`（本票提交） |
| public candidate | `185eb16`（历史候选，不是当前 HEAD） |
| upstream baseline | `702a822` |
| current upstream | `upstream/main`，当前 HEAD ahead 103 commits |
| public push | 禁止；本轮没有推送 |

## LF-000 — 计划接管与当前事实更新

### Kind

Ticket，文档/控制面；无生产代码。

### 唯一目标

让 Fusion 计划成为三模式融合和 CAT Workbench 的执行权威，同时保留 Alpha 工程计划对 CI、安全、数据隔离、G8、G10 和 14 天日用的控制权。

### 已检查的入口与边界

```text
ModeSwitcher → app-mode
Tab atoms → MainArea → TabContent
LeftSidebar/AppShell/right-rail-policy
ProjectsView → ProjectDetailPanel → ProjectChatsSection/CatWorkspace/CatContextRail
AgentView
session-binding
packages/linguist-cat-tools/src/factory.ts
docs/roadmap/EXECUTION_LEDGER.md
docs/roadmap/execution-ledger.json
```

### 已记录的不变量

1. 当前模式仍是 Agent/Chat/Scratch；Linguist 尚未进入主模式。
2. 当前项目路由通过 `activeView='projects'` 绕过常规 Tab；Project 尚不是一等 Tab。
3. 当前 `TabItem` 假设存在 `sessionId`；不得用伪造 Agent session 表示 Project。
4. `AgentView` 是唯一成熟 Proma Agent 视图；后续只允许扩展表示层，不允许复制。
5. CAT hard rails、Project Binding authority、Proposal/CAS/locked/Tag/QA 资产继续保留。
6. 旧 Project/CAT UI 从本票起 frozen except P0。
7. LF 计划只替代产品融合/CAT Workbench 路线；Alpha 计划继续有效。

### 计划基线差异

```text
git merge-base 185eb16 HEAD
→ 702a8221bdeb6f3db7dc514b8e93e2a5a52f68df

git diff --stat 185eb16..HEAD
→ 31 files changed, 692 insertions(+), 122 deletions(-)
```

差异已按默认 Skill、Electron/锁文件/测试、G9/G10/G11 与发布文档、迁移探针、基线截图等类别写入 `LINGUIST_FUSION_CURRENT_REALITY.md`。

### 产出

- `docs/roadmap/LINGUIST_FUSION_CURRENT_REALITY.md`
- `docs/roadmap/LINGUIST_FUSION_QUEUE.md`
- `docs/roadmap/linguist-fusion-queue.json`
- `docs/roadmap/LINGUIST_FUSION_EXECUTION_LEDGER.md`

### 验证记录

| 命令 | 结果 | 说明 |
|---|---|---|
| `git status --short --branch` | 通过 | `main...upstream/main [ahead 103]`；仅用户计划文件未跟踪 |
| `git log -1 --format=...` | 通过 | HEAD 与提交主题已记录 |
| `git remote -v` | 通过 | 仅 `upstream`，未配置公开镜像推送 |
| `git merge-base 185eb16 HEAD` | 通过 | 共同祖先为 `702a8221...` |
| `git diff --stat 185eb16..HEAD` | 通过 | 31 files / +692 / -122 |
| `node` JSON parse | 通过 | `linguist-fusion-queue.json` 可解析；LF-000 后复跑 |
| `git diff --check` | 通过 | LF-000 文档无空白错误；提交前复跑 |
| `command -v bun` | 未通过（环境阻塞） | 当前 shell 没有 Bun |
| `bun run typecheck` | 未执行成功（环境阻塞） | 因 Bun 不存在返回 command not found；不伪造 passed |

### 明确未做

- 没有修改 `ModeSwitcher`、`app-mode`、`tab-atoms`、`MainArea`、`TabContent`、`AgentView`、`CatWorkspace` 或任意生产代码。
- 没有读取、写入、迁移或清理真实用户数据。
- 没有执行 LF-001、LF-002、LF-004 或任何后续生产工单。
- 没有把未跟踪的用户计划文件纳入本票。

### 当前未解决事项

- LF-001 仍需在可用 Bun/打包环境建立截图和 happy-path baseline。
- LF-003 仍需建立并执行真实 packaged vertical smoke。
- Bun 环境缺失需要由 AC-001/执行环境解决；这不是 LF-000 的代码失败。

### 下一张可执行工单

**LF-001：建立当前 Agent/Chat/Projects/CAT 的打包截图与 happy-path baseline。**

## 历史 Alpha 账本关系

旧的 `docs/roadmap/EXECUTION_LEDGER.md` 与 `docs/roadmap/execution-ledger.json` 仍记录 PB/G0-G11 和 Alpha 证据；本账本只新增 Fusion 队列，不重写历史工单状态。

## LF-002 — 冻结旧 Project/CAT 产品面

### Kind

Ticket，产品治理；不改变运行时行为。

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `554ac7fb966e05ade09d3511889de566edf7712c` |
| result commit | `SELF` |
| production code | 无 |
| user data | 未读取、未修改 |

### 完成内容

- 新增 `LINGUIST_LEGACY_UI_FREEZE.md`，精确列出受冻结文件和旧路由耦合点；
- 只有数据损失、安全/错绑、不可恢复阻断或崩溃可作为 P0 例外；
- 每个 P0 例外必须同提交给出复现、最小修复和回归证据；
- 记录新旧实现映射及 LF-078 前的删除门；
- 明确保留 CAT Core/Store/Tools、Binding、CAS、Proposal、QA、Evidence、Export、迁移和用户数据；
- 将用户提供的权威实施计划原样纳入版本控制，保证队列和删除 Gate 可复现。

### 验证

- Node 文档断言：冻结规则包含 LF-002/LF-078、P0 判定、删除保护和 Proma 完整能力保留；
- `git diff --check`：通过；
- 未执行 packaged smoke：本票没有运行时行为变化。

### 下一状态

LF-002 `unit_verified`。旧 UI 保留可用但不再新增产品功能；删除只在对应替代实现和 Gate 通过后发生。

## LF-004 — Proma Core 触点与单一 Agent 实现护栏

### Kind

Ticket，架构 characterization；无产品行为变化。

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `7469309e` |
| result commit | `SELF` |
| production code | 无 |
| user data | 未读取、未修改 |

### 完成内容

- 在 `PROMA_CORE_TOUCHPOINTS.md` 增加 Fusion 单一实现合同；
- 登记 Agent 工作区、消息、Thinking/Tool、Composer、Approval、Queue/Steer 的唯一 Proma 所有者和允许接入方式；
- 明确 CAT Core 不得依赖 React、Electron 或 `@proma/ui`；
- 新增零依赖架构测试，禁止计划 §6.1 的第二套 Linguist Agent 基础组件；
- 将现存 Proma → Linguist Renderer 反向 import 固定为封闭集合，只允许后续删除，禁止静默新增。

### 验证

- `node --test tests/linguist-fusion-architecture.test.mjs`：3 pass / 0 fail；
- `node --check tests/linguist-fusion-architecture.test.mjs`：通过；
- `git diff --check`：通过。

### 已知上限

静态架构测试能识别文件名、声明名和 import，但不能识别刻意改名后的语义复制；每个 Agent/CAT Fusion 工单仍需 review。

### 下一状态

LF-004 `unit_verified`；LF-030 的 AgentView full characterization 依赖已满足。

## AC-001 — Push/PR CI、固定 Bun/Actions、根测试零失败

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `69577951` |
| result commit | `SELF` |
| production code | 无；仅 CI、版本、测试隔离与文档 |
| user data | 未读取、未修改 |

### 完成内容

- 新增 Push / Pull Request / 手动触发 CI，覆盖 frozen install、typecheck、根测试、CAT 分层测试、Linguist 主进程测试、安全/架构/许可门禁和 Electron build；
- 固定 Bun 1.3.14、`@types/bun` 1.3.6，并将 GitHub Actions 固定到 commit SHA；
- 用共享 Electron mock 消除 Bun 全套测试的加载顺序污染，原有 2 个根测试失败归零；
- Release Workflow 本票只固定运行时与 Actions；fail-closed 依赖和资源复制失败处理留给 AC-002。

### 验证

- `bun install --frozen-lockfile`：通过；
- `bun run typecheck`：11 个 workspace 全通过；
- 相关主进程回归：20 pass / 0 fail；
- 根测试：除提交前必然报告 stale touchpoint 的边界用例外，989 pass / 0 个产品或单元失败；
- Workflow YAML 与触点 JSON 解析：通过；
- `node --test tests/linguist-fusion-architecture.test.mjs`：3 pass / 0 fail；
- 提交后必须复跑 `bun test tests/upstream-boundary.test.ts`，确认 HEAD 触点闭环。

### 下一状态

AC-001 `integration_verified`。真实 GitHub-hosted CI 尚未运行，不把本地验证写成远端 CI 已通过。

## LF-001 — 当前打包产品基线

### 提交边界

| 字段 | 值 |
|---|---|
| evidence source commit | `554ac7fb966e05ade09d3511889de566edf7712c` |
| commit base | `b192bb16` |
| result commit | `SELF` |
| production code | 无 |
| user data | 仅临时 HOME 的合成测试数据；未读取真实用户数据 |

### 完成内容

- 在固定 source commit 上重新构建 packaged App，并记录 App/asar 哈希；
- 留存 Agent、Chat、Projects、CAT 四张 1280×820 Light 截图及 SHA-256 manifest；
- 记录 G0 happy-path 与 G10 打包矩阵原始结果，不把失败或未执行项写成 Gate Passed。

### 验证与阻塞

- `smoke:pack`：通过；
- G0：8 PASS / 1 FAIL；首个文本流步骤被打开态模态遮罩拦截，后续步骤未执行；
- G10：35 PASS / 1 FAIL / 3 WARN；1000-turn 首开 10474ms，且 Agent/CAT/Projects 仍有 serious/critical Axe 规则；
- manifest：四张截图哈希通过。

### 下一状态

LF-001 `packaged_verified`，因为“建立真实基线”已完成；G-F0 仍为 `blocked`，不会因本票完成而自动放行。

## LF-010 — AppMode 加入 Linguist，Scratch 退出主模式

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `190b049f` |
| result commit | `SELF` |
| production code | Renderer 主模式类型、持久化归一化与既有入口适配 |
| user data | 未读取、未修改；仅定义历史 localStorage 值的兼容读取 |

### 完成内容

- `PrimaryAppMode` 固定为 `agent | chat | linguist`；
- 历史 `scratch` 与未知持久化值回落 Agent；
- Scratch、教程等继续作为原生 Tab/工具面，不再改变主模式；
- 未提前修改 ModeSwitcher、侧栏或 Project Tab 联合。

### 验证

- BDD：3 pass / 0 fail；
- AppMode 与 right-rail 相关回归：9 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-010 `unit_verified`；LF-011 与 LF-013 依赖已满足。

## LF-030 — AgentView Full 模式行为契约

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `1a879dec` |
| result commit | `SELF` |
| production code | AgentView 一个稳定 DOM 标记；无行为变化 |
| user data | 未读取、未修改 |

### 完成内容

- 用 5 个 BDD characterization 锁定 Agent Tab 到原生 AgentView 的路由；
- 锁定 Header、Messages、Composer、Toolbar、工具生命周期与 retry/fork/rewind/compact；
- 锁定 Permission/AskUser/ExitPlan inline、queue/interrupt steer、标题同步和 session-scoped Preview；
- 仅给 Full 根节点增加稳定标记，没有提前实现 rail/compact/CAT。

### 验证

- RED：4 pass / 1 fail（缺 Full 根标记）；
- GREEN：5 pass / 0 fail，39 个断言；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-030 `unit_verified`；LF-031 的最窄 presentation seam 可以开始。

## AC-002 — Release Workflow fail-closed

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `40981ce8` |
| result commit | `SELF` |
| production code | 构建脚本 fail-closed；无应用运行时行为变化 |
| user data | 未读取、未修改 |

### 完成内容

- CI Workflow 增加 reusable `workflow_call`；
- Release 先调用完整 CI，macOS arm64/x64 与 Windows x64 三个发布 job 都显式依赖验证成功；
- 删除独立但不阻塞发布的 license job，许可扫描由完整 CI 的同一门禁执行；
- macOS 三次打包全部失败时显式非零退出；
- `build:resources` 删除 `2>/dev/null || true`。

### 验证

- BDD RED：3 fail；
- BDD GREEN：3 pass / 0 fail；
- 两个 Workflow YAML 解析通过；
- `electron:build`：通过，资源复制步骤以无容错命令成功结束；
- `git diff --check`：通过。

### 下一状态

AC-002 `integration_verified`。尚未触发真实 tag Release，不把本地构建写成 GitHub Release 已通过。

## LF-011 — Agent/Chat/Linguist 三段切换器

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `b01a3726` |
| result commit | `SELF` |
| production code | ModeSwitcher 与两个纯函数 |
| user data | 未读取、未修改 |

### 完成内容

- ModeSwitcher 显示 Agent、Chat、Linguist 三个等宽入口；
- Agent/Chat 保留既有会话恢复，Linguist 仅切换主模式；
- 增加 tablist/tab、`aria-selected`、roving tabindex；
- 支持 Left/Right/Home/End，焦点与选中模式同步。

### 验证

- RED：模块缺失；
- GREEN：3 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过（仅既有 chunk/sonner 警告）；
- `git diff --check`：通过。

### 下一状态

LF-011 `unit_verified`；LF-012 依赖已满足。

## LF-031 — AgentView Full/Rail 单一实现

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `56d78fa1` |
| result commit | `SELF` |
| production code | 原生 AgentView/Header/Messages 的表示层参数与密度样式 |
| user data | 未读取、未修改 |

### 完成内容

- `AgentView` 增加默认 `full`、可选 `rail` presentation；
- rail 只收紧 Header、消息、Composer 与 Toolbar 样式，并取消嵌入式 Header 的窗口拖拽区；
- Streaming、Thinking、Tool、Queue/Steer、Approval、Attachments、Model/Permission/Runtime、Retry、Compaction 与持久化仍走同一实现；
- 没有新增任何 `LinguistAgent*` 第二套组件。

### 验证

- RED：4 pass / 2 fail；
- GREEN：6 pass / 0 fail，53 个断言；
- 重复 Agent 实现扫描：通过；
- `git diff --check`：通过；
- Electron typecheck 在 LF-013 收口后由主线复跑。

### 下一状态

LF-031 `unit_verified`；真正嵌入 Workbench 仍依赖 LF-032/LF-033。

## LF-012 — 折叠侧栏 Linguist 入口

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `a7d4efa1` |
| result commit | `SELF` |
| production code | 折叠 LeftSidebar 入口与共享 Session 恢复守卫 |
| user data | 未读取、未修改 |

### 完成内容

- 折叠 Rail 增加 Linguist 图标按钮、Tooltip、ARIA label 和 active 状态；
- Agent/Chat 继续恢复当前/最近/已开 Session；
- Linguist 只切主模式，绝不借普通 Session；
- 会话 Tab 访问对 LF-013 的判别联合显式收窄。

### 验证

- RED：缺少 Session 恢复类型守卫；
- GREEN：4 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-012 `unit_verified`；折叠与展开状态均可发现 Linguist。

## LF-013 — Localization Project Tab 判别联合

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `c9e6a2b0` |
| result commit | `SELF` |
| production code | Renderer Tab 判别联合、项目 Tab 恢复与状态映射 |
| user data | 未读取、未修改 |

### 完成内容

- `TabItem` 改为判别联合，新增不借用普通 Session 身份的 `LocalizationProjectTab`；
- 项目 Tab 支持打开、关闭、标题、持久化恢复与缺失/归档修复态；
- 项目流式状态通过 project → native Agent Session 映射复用原生 Agent atoms；
- 激活项目 Tab 会切换 Linguist 模式；Workbench 内容仍由 LF-015 接入。

### 验证

- BDD：项目 Tab 相关测试 6 pass / 0 fail；
- 相关 Session/外部运行回归：通过；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-013 `unit_verified`；LF-014 依赖已满足。

## AC-004 — BrowserWindow 显式安全边界

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `01e2a64e` |
| result commit | `SELF` |
| production code | Main Process 的 BrowserWindow webPreferences |
| user data | 未读取、未修改 |

### 完成内容

- 扫描 Main Process 全部五个生产 `BrowserWindow` 创建点；
- 主窗口、语音听写、快速任务和独立预览补齐 `sandbox: true` 与 `webSecurity: true`；
- 保持 `contextIsolation: true` 与 `nodeIntegration: false`，截图窗口基线已完整；
- 用 AST 契约测试防止后续新增窗口依赖 Electron 默认值。

### 验证

- BDD 安全契约与边界测试：4 pass / 0 fail；
- Electron typecheck：通过；
- Electron production build：通过（仅既有 Vite chunk/import.meta 警告）；
- `git diff --check`：通过。

### 下一状态

AC-004 `integration_verified`；所有当前生产 BrowserWindow 均显式固定四项安全选项。

## LF-003 — Packaged Vertical Smoke

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `5260898c` |
| result commit | `SELF` |
| production code | packaged smoke 总编排与 Pi probe 隔离参数 |
| user data | 使用临时 HOME/userData，未读取、未修改真实配置 |

### 完成内容

- 新增 `smoke:vertical`，只编排既有 package、G1 Agent、G0 Chat 和 G7 CAT probes；
- 打包失败立即把后续步骤记为 `not_reached`，任一步失败总入口非零退出；
- 报告记录 HEAD、dirty 文件、产物路径与 asar SHA-256；
- 未覆盖项固定记录为 `blocked`，不将 MANUAL 或新 Workbench 缺口写成通过；
- Pi probe 同时隔离 HOME 与 Electron userData，避免与日用实例争抢单实例锁。

### 实际 packaged 证据

- package / agent / chat / linguist-current 均 exit 0；
- Agent 12/12、Chat 18/18、当前冻结 CAT 11/11，另有 2 项 MANUAL；
- 报告 `runStatus=passed`、`coverageStatus=partial`；
- 4 项保持 BLOCKED：Agent Stop/Retry UI、Chat→Agent 状态往返、新 Workbench、原生 Open/Save。

### 验证

- BDD 合同：3 pass / 0 fail；
- 总编排 Node syntax：通过；
- `git diff --check`：通过。

### 下一状态

LF-003 `packaged_verified`；该工单建立了真实打包门禁，但不会提前宣称未完成的 Workbench 覆盖已通过。

## LF-014 — 打开与恢复 Localization Project

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `2bce1aa8` |
| result commit | `SELF` |
| production code | Project 打开编排、模式入口恢复、ProjectsView 卡片接线 |
| user data | 未读取、未修改 |

### 完成内容

- `openLocalizationProject` 先调用主进程 Project open，成功后才创建并激活 Project Tab；
- Project open 失败时保持现有 Tab、模式和会话选择不变；
- 展开/折叠 Linguist 入口恢复最后打开的 Project Tab；
- 没有 Project Tab 时进入项目管理面，不显示旧 Agent/Chat；
- ProjectsView 项目卡片改走一等 Project Tab。

### 验证

- BDD：14 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-014 `unit_verified`；LF-015 与 LF-020 依赖已满足。完整 Project Tab MRU 继续由 LF-016 负责。

## LF-020 — 共享 Project List Resource

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `3d520ce5` |
| result commit | `SELF` |
| production code | Linguist Project list Jotai resource 与 ProjectsView 消费 |
| user data | 未读取、未修改 |

### 完成内容

- 把项目列表加载收敛为共享 Jotai 异步资源；
- 同一 Store 的多个消费者共享 in-flight 请求、ready/error 状态与缓存；
- 创建、归档、迁移和详情返回统一触发 refresh；
- 未提前实现 LF-021 的 Sidebar 产品面，主进程继续作为唯一数据真源。

### 验证

- BDD：3 个共享资源行为测试；相关回归合计 7 pass / 0 fail；
- `git diff --check`：通过；
- Electron typecheck 在并行 LF-015 修复其测试夹具后由主线统一复跑。

### 下一状态

LF-020 `unit_verified`；LF-021 依赖已满足。

## LF-015 — Localization Project Workbench 挂载

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `c49003ba` |
| result commit | `SELF` |
| production code | TabContent 项目分支与 LocalizationProjectWorkbench |
| user data | 未读取、未修改 |

### 完成内容

- 正常 Project Tab 挂载真实 `LocalizationProjectWorkbench`；
- 冷启动恢复时工作台自行执行 Project open；
- 成功后过渡复用既有 `CatWorkspace`，打开失败显示类型化错误与重试；
- missing/archived repair state 继续 fail closed，不伪造 Session。

### 验证

- BDD 与相关 Tab 回归：11 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-015 `unit_verified`；LF-016 与 LF-040 依赖已满足。新 Workbench Shell 和旧布局退役仍分别归 LF-041/LF-076。

## LF-021 — Linguist Sidebar Content

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `7df03efd` |
| result commit | `SELF` |
| production code | 独立 LinguistSidebarContent 与 LeftSidebar 窄接线 |
| user data | 未读取、未修改 |

### 完成内容

- Linguist 展开侧栏改用独立内容模块，不复制 Agent/Chat 会话树；
- 直接复用 LF-020 共享项目列表与 refresh；
- 覆盖 loading、error/retry、empty 和活跃项目列表，并过滤归档项目；
- 未提前实现 LF-022～025 的打开、会话、恢复和管理行为。

### 验证

- BDD 与共享资源回归：7 pass / 0 fail；
- Renderer production build：通过；
- `git diff --check`：通过；
- 全仓 typecheck 待并行 LF-016 GREEN 后由主线复跑。

### 下一状态

LF-021 `unit_verified`；LF-022、LF-023、LF-025 依赖已满足。

## LF-016 — Project Tab 生命周期闭环

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `e6b3bed0` |
| result commit | `SELF` |
| production code | Tab atoms MRU、持久化恢复与最近 Project 选择 |
| user data | 未读取、未修改 |

### 完成内容

- 激活 Project Tab 纳入统一 MRU，Preview 仍归属原 Session；
- Project MRU 随 tabState 持久化，恢复时过滤无效/重复身份；
- 切回 Linguist 优先最近激活项目，旧数据回退最后打开项目；
- 关闭 Project 清理 MRU，但不删除项目或无关 Agent/Preview；
- mapped Agent Session 的 running/idle indicator 保持闭环。

### 验证

- RED：MRU helpers 不存在；
- GREEN：15 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-016 `unit_verified`；LF-017 的实现依赖已全部满足，待执行 Gate。

## LF-022 — 侧栏单击进入 Editor

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `cff60a91` |
| result commit | `SELF` |
| production code | Linguist Sidebar 项目按钮与打开编排接线 |
| user data | 未读取、未修改 |

### 完成内容

- 项目行改为可访问 button；
- 单击复用 `openLocalizationProject` 进入一等 Project Tab；
- 当前项目显示 active 样式与 `aria-current="page"`；
- 打开失败显示类型化 toast，现有导航和 Tab 保持不变。

### 验证

- BDD 与打开编排回归：9 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-022 `unit_verified`；LF-024 依赖已满足。G-F1 的“项目点击一次进入 Editor”实现条件已满足，仍需 packaged Gate。

## LF-040 — Project-scoped Workbench UI State

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `2af35a0f` |
| result commit | `SELF` |
| production code | Workbench project atom family 与旧 CAT 临时消费者迁移 |
| user data | 未读取、未修改 |

### 完成内容

- 一个 Map seam 按 projectId 隔离全部计划内 Workbench UI 状态；
- `CatWorkspace` 的 asset/search/status/selection/active segment 改为项目级；
- `CatContextRail` 读取项目级 active segment，旧临时 tab 留在组件本地；
- 同项目关闭/重开在本应用会话恢复，不同项目互不污染；
- 提供单项目清理 seam，不伪造尚不存在的 delete IPC。

### 验证

- BDD：3 pass / 0 fail；
- 相关回归：通过；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-040 `unit_verified`；LF-041、LF-050 与 LF-060 的 Workbench 状态依赖已满足。

## LF-023 — 项目 Agent Sessions

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `4bd8b110` |
| result commit | `SELF` |
| production code | Linguist Sidebar 的原生项目 Session 列表/选择/创建 |
| user data | 未读取、未修改 |

### 完成内容

- 直接复用 `agentSessionsAtom`，按项目绑定隔离并排除归档会话；
- 选择会话更新 Project→Agent Session 映射，保持 Project Workbench；
- 新建会话复用 `createForProject` IPC 与原生 freshness 列表更新；
- 项目未激活时先走既有 Project open；错误显示在对应项目下；
- 普通 Agent 会话与其他项目会话不会混入。

### 验证

- LF-023 BDD：7 pass / 0 fail；
- 相关 Tab/open/sidebar 回归：22 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-023 `unit_verified`；LF-032 的两个前置依赖（LF-023、LF-031）已满足。

## AC-007 — G10 长线程首载、补载与跳转

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `1ac2d873` |
| result commit | `SELF` |
| production code | Agent 历史窗口、顶部补载锚点与 minimap 跨窗口跳转 |
| user data | 打包探针仅使用临时 HOME/userData，未读取、未修改真实配置 |

### 完成内容

- 纠正旧 G10 的错误归因：约 10.5 秒主要来自探针等待错误 selector 的固定超时；
- Agent 首次只挂最近 120 个 group，完整历史继续留给搜索与 minimap；
- 顶部补载 120 个 group，并恢复原首条 DOM 锚点；
- minimap 命中未挂载消息时切换到目标附近窗口，较新历史可显式补载；
- Chat 分页和 Proma 通用 Agent 行为未改。

### 验证

- Agent 专项测试：22 pass / 0 fail；
- 全仓 typecheck：11 / 11；
- Renderer build 与 `smoke:pack`：通过；
- packaged long-thread probe：8 pass / 0 fail；
- 首开 451ms，顶部补载 104ms、锚点漂移 0.3px，第 500 轮跳转 1312ms。

### 下一状态

AC-007 `packaged_verified`；完整 G10 仍等待 AC-008 Axe 清零与 AC-009 Product Qualification Gate，不提前宣称产品资格通过。

## AC-008 — serious/critical Axe 清零

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `353c4e15` |
| result commit | `SELF` |
| production code | Proma 通用交互控件的可访问名称/结构/对比度、CAT Grid ARIA 结构与 Linguist 项目入口 |
| user data | 打包矩阵仅使用临时 HOME/userData，未读取、未修改真实配置 |

### 完成内容

- 将 Tab、会话、项目卡片中的嵌套交互元素改为同级原生按钮，并保留 Tab 中键关闭；
- 为 Agent、Chat、文件面板、语音、附件、发送、滚动与上下文用量控件补齐可访问名称；
- 为 Bottom Dock 补齐 tablist/tabpanel、roving tab focus 与方向/Home/End 键盘操作；
- 修正 CodeBlock 可聚焦滚动区域、虚拟 Segment Grid 的 row/rowgroup 所有权与关键低对比文字；
- 打包探针覆盖 Light/Dark、800/1024/1280、200% Zoom、Reduced Motion、1000-turn、10k Grid 和 Agent/CAT/Projects Axe。

### 验证

- 全仓测试：1188 pass / 0 fail；
- 全仓 typecheck：11 / 11；
- Renderer build 与 `smoke:pack`：通过；
- packaged PB-105 matrix：40 pass / 0 fail；
- Agent/CAT/Projects serious/critical Axe：0 / 0 / 0；
- 0.15.101 打包产物中，1000-turn 首开 111ms、顶部补载 94ms、中段跳转 1146ms；10k Grid 首屏 193ms。

### 下一状态

AC-008 `packaged_verified`。仍有 moderate landmark 规则；VoiceOver、完整键盘流、IME、拖拽 resize 与 DMG 真机属于 AC-009，不能据此宣称 G10 Product Qualification 已通过。

## LF-041 — Workbench Shell、Toolbar、Status Bar

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `edb70418` |
| result commit | `SELF` |
| production code | Linguist Workbench Shell、真实项目摘要、Toolbar/Status Bar 与四区 slot |
| user data | 未读取、未修改 |

### 完成内容

- Project Workbench 打开后加载真实 Project summary，不伪造字数、Tag、QA 或 dirty 状态；
- Shell 建立 Asset Navigator、Segment Grid、Native Agent Rail、Bottom Dock 四区契约；
- Toolbar 显示项目名、locale、确认进度、当前资产与已有面板开关；
- Status Bar 显示确认/草稿/当前资产/当前 Segment/选择数及既有快捷键；
- 手工保存、单条/批量 Proposal 审核后刷新真实摘要，避免进度陈旧。

### 验证

- RED：缺少 Shell 时专项失败；
- GREEN：Workbench/Shell/项目状态专项 10 pass / 0 fail；
- Electron typecheck：通过（子代理复跑）；
- `git diff --check`：通过。

### 下一状态

LF-041 `unit_verified`；LF-042、LF-043 与 LF-070 的前置依赖已满足，面板内容和编辑器行为仍由各自工单实现。

## LF-032 — Project Agent Session 选择、懒创建和恢复

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `bc45a722` |
| result commit | `SELF` |
| production code | Project Session 唯一真源、有效性回退、懒创建去重与 settings 恢复 |
| user data | 未读取、未修改 |

### 完成内容

- Project→原生 Agent Session 映射按绑定和 archived 状态校验；
- 精确选择持久化到 settings，重启失效时回退项目最新有效会话；
- 项目无会话时保持空，不因打开项目隐式创建；
- Agent rail/发送可复用 `ensureProjectAgentSession`，同项目并发首次需求只创建一次；
- Sidebar 创建/选择与 LF-040 Workbench 状态改读同一真源。

### 验证

- RED：缺少统一 atom/懒创建 seam 时专项失败；
- GREEN：Session 恢复、并发创建、Sidebar、Workbench 与 Tab 回归 28 pass / 0 fail；
- Electron typecheck：通过（子代理复跑）；
- `git diff --check`：通过。

### 下一状态

LF-032 `unit_verified`；LF-033、LF-060 与 AC-005 前置已满足。Agent rail 尚未挂载，首次需求调用由 LF-033/061 接入。

## LF-024 — 最近项目与 Workbench 位置恢复

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `c8db3978` |
| result commit | `SELF` |
| production code | Project MRU 复用与每项目 Asset/Segment 位置持久化 |
| user data | 未读取、未修改 |

### 完成内容

- 最近项目继续复用 LF-016 的 Project Tab MRU，不建立第二份最近列表；
- settings 只持久化每项目最后 Asset/Segment opaque ID，不复制 CAT 内容；
- 启动恢复不覆盖已经产生的运行期 Workbench 状态；
- 首次 CAT 查询后用主进程返回的真实 ID 清除失效引用，不猜测替代位置；
- missing/archived Project 继续由既有 repair state 阻断 Workbench。

### 验证

- 位置解析、恢复、隔离与失效引用专项：通过；
- 相关 Tab/open/Workbench 回归：22 pass / 0 fail；
- Renderer build：通过；
- `git diff --check`：通过。

### 下一状态

LF-024 `unit_verified`；LF-025 完成后可执行 LF-026 导航恢复 Gate。

## LF-033 — Workbench 嵌入 Proma 原生 Agent Rail

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `2ed9e95b` |
| result commit | `SELF` |
| production code | Workbench 原生 Agent rail 挂载与首次需求会话创建 |
| user data | 未读取、未修改 |

### 完成内容

- Workbench 的 Agent slot 直接挂载唯一原生 `AgentView presentation="rail"`；
- Rail 默认关闭，未展开时不挂载 AgentView、也不创建项目 Session；
- 首次展开复用 LF-032 的项目 Session 选择、恢复和并发创建去重；
- 创建/IPC 失败 fail closed，显示原因和重试动作；
- 项目切换继续按 Project→Session 真源隔离，没有第二套 Agent 行为组件。

### 验证

- Rail 会话复用、懒创建、失败重试与项目隔离：通过；
- Workbench Shell、Agent 单一实现与相关回归：28 pass / 0 fail；
- 全仓 typecheck：11 / 11（子代理完成态）；
- `git diff --check`：通过。

### 下一状态

LF-033 `unit_verified`；LF-034、LF-035 前置已满足，LF-037 仍等待 LF-034～036。

## LF-060 — LinguistTurnContextV1 与严格验证

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `b5b5ba21` |
| result commit | `SELF` |
| production code | Shared Turn Context V1 契约与主进程归属校验 seam |
| user data | 未读取、未修改 |

### 完成内容

- 定义固定字段的 `LinguistTurnContextV1`，只包含 opaque ID、时间与 UI revision；
- selected Segment 上限 100，超限截断并显式返回 `selectionTruncated`；
- 严格拒绝未知字段、错误版本、显式 undefined、正文和绝对路径；
- 构建结果深冻结，序列化键序确定；
- 主进程按冻结 Session binding 和真实项目库验证 Project/Asset/Segment/QA 归属；
- 未提前接入 Composer、发送快照或 mutation event。

### 验证

- Shared BDD：8 pass / 0 fail；
- 真实 CatStore 归属校验：3 pass / 0 fail；
- Shared / Electron typecheck：通过（子代理完成态）；
- `git diff --check`：通过。

### 下一状态

LF-060 `unit_verified`；LF-061 前置已满足，发送快照仍由 LF-062 单独接入。

## LF-025 — Project 管理次级入口

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `33655ed3` |
| result commit | `SELF` |
| production code | Sidebar 次级 Project 管理入口 |
| user data | 未读取、未修改 |

### 完成内容

- Linguist Sidebar 底部提供“管理项目”次级入口，复用既有 ProjectsView；
- 项目行的主路径仍直接打开 Editor，没有恢复旧的管理页日常跳转；
- 当前处于项目管理页时通过 `aria-current` 提供可见、可访问状态。

### 验证

- Sidebar BDD：8 pass / 0 fail；
- Renderer build：通过；
- `git diff --check`：通过。

### 下一状态

LF-025 `unit_verified`；LF-026 前置已满足。

## AC-005 — Project Binding fail-closed 与永久解绑

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `01e4eebd` |
| result commit | `SELF` |
| production code | 绑定异常发送闸门、永久解绑 IPC 与恢复 UI |
| user data | 未读取、未修改 |

### 完成内容

- 项目 missing 或服务 unavailable 时保留历史，但主进程在模型调用前阻断发送；
- 不再静默退化成普通 Agent，并返回稳定 TypedError 与明确恢复文案；
- 新增唯一、幂等、不可重绑定的永久解绑入口，同时清除项目快照和 reviewer 角色；
- 通告提供确认式解绑动作；成功后原会话沿用为完整普通 Proma Agent；
- packaged probe 更新为“missing 阻断 → UI 解绑 → 普通 Agent 发送成功”闭环。

### 验证

- 真实 Project Service / 会话索引 nodetest：16 pass / 0 fail；
- IPC 契约与纯展示 BDD：24 pass / 0 fail；
- Shared / Electron typecheck：通过；
- Packaged probe TypeScript 语法检查：通过；
- `git diff --check`：通过。

### 下一状态

AC-005 `unit_verified`；真实 packaged `.app` 闭环随后续整包 Smoke Gate 统一执行。

## LF-034 — Agent Rail 调整、折叠与项目级持久化

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `4ada28ee` |
| result commit | `SELF` |
| production code | 原生 Rail resize、窄窗 overlay 与项目布局恢复 |
| user data | 未读取、未修改 |

### 完成内容

- 复用 LF-033 原生 Agent Rail，不新增 Agent 实现；
- 拖动与键盘调整宽度，统一约束在 340–600px；
- 窄窗口切换为右侧 overlay，避免挤毁 CAT 主区；
- Rail 开合和宽度沿用既有 Workbench settings，按项目隔离并跨重启恢复。

### 验证

- Workbench Shell / 项目状态 BDD：12 pass / 0 fail；
- Electron typecheck：通过；
- Renderer build：通过；
- `git diff --check`：通过。

### 下一状态

LF-034 `unit_verified`；LF-037 仍等待 LF-035、LF-036。

## LF-061 — 原生 Composer Context Chips

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `3c1f0a6f` |
| result commit | `SELF` |
| production code | 原生 Composer 上下文摘要展示 |
| user data | 未读取、未修改 |

### 完成内容

- 唯一原生 Agent Composer 展示 Project、Asset、当前 Segment 与选择数量；
- tooltip 只展示 scope/opaque ID，不携带正文或本机路径；
- 窄 Rail 通过 CSS container query 折叠成一枚摘要；
- 清除动作只写回 `selectedSegmentIds=[]`，不改变冻结 Project binding、Asset 或 active Segment；
- 未提前实现 LF-062 的发送信封。

### 验证

- Composer / Project Agent Rail / Full Agent 契约：14 pass / 0 fail；
- Electron typecheck：通过；
- Renderer build：通过；
- `git diff --check`：通过。

### 下一状态

LF-061 `unit_verified`；LF-062 前置已满足。

## LF-035 — 完整 Agent Tab 与返回 Linguist

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `4b4e328c` |
| result commit | `SELF` |
| production code | 同一 Project Session 的 Rail/Full 往返 |
| user data | 未读取、未修改 |

### 完成内容

- Project Agent Rail 复用 `useOpenSession`，以同一 `sessionId` 打开原生 Full Agent Tab；
- 未新建 Agent、Composer、消息或工具组件；
- Full Agent 的项目绑定徽章可返回原 Linguist Project Tab；
- 返回后保留 Project Session 映射、Asset/Segment、选择集与 Rail 布局状态。

### 验证

- Rail/Full、Project Tab 恢复与重复组件契约：45 pass / 0 fail；
- Renderer build：通过；
- `git diff --check`：通过。

### 下一状态

LF-035 `unit_verified`；LF-036 前置只剩集成回归，LF-037 仍等待 LF-036。

## LF-036 — Agent/Chat 全模式回归与重复组件扫描

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `fd14e367` |
| result commit | `SELF` |
| production code | 无；只增加原生行为与架构防回归契约 |
| user data | 未读取、未修改 |

### 完成内容

- 覆盖 Agent Full、Project Rail、Chat Tab 的原生路由、消息、Composer、发送与停止链路；
- 扫描 Linguist feature，确认不存在第二套 Agent/Chat 基础组件；
- 将 LF-061 计划明确允许的 `AgentView.contextSummary` 窄 prop 登记为受控反向依赖，其他新增 importer 继续失败。

### 验证

- Full/Rail/Chat 与项目会话定向契约：14 pass / 0 fail；
- Fusion 架构护栏：3 pass / 0 fail；
- 重复组件扫描：通过；
- `git diff --check`：通过。

### 下一状态

LF-036 `unit_verified`；LF-037 可在整套 Native Agent 回归通过后判定。

## LF-042 — Asset Navigator

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `fd14e367` |
| result commit | `SELF` |
| production code | 真实资产导航、每资产进度/QA 聚合与 last active Segment |
| user data | 未读取、未修改 |

### 完成内容

- Navigator 展示真实资产、搜索、当前选择、每资产确认进度与开放 QA 数；
- Segment/QA 统计由 Store 各一次 `GROUP BY` 聚合，不加载 Segment 行；
- CAT 虚拟分页只返回静态资产元数据，不在每页重复聚合；
- 切换资产时保留该资产本应用会话内最后活动 Segment；
- Navigator 支持折叠、拖动和键盘调宽，按项目恢复开合与 180～420px 宽度；
- 未展示原始路径，也未把 CAT 写入真相放进 Navigator。

### 验证

- Store 聚合 nodetest：15 pass / 0 fail；
- Project Service / IPC nodetest：24 pass / 0 fail；
- Shared / Navigator / Workbench BDD：15 pass / 0 fail；
- Shared、Cat Store typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-042 `unit_verified`；LF-043 与 LF-070 可继续，完整手工 CAT Gate 仍等待 LF-043～047。

## LF-062 — 每 Turn 不可变 Context Snapshot

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `c0cc9809` |
| result commit | `SELF` |
| production code | 原生 Agent 发送/queue/steer 快照、主进程 authority、历史持久化 |
| user data | 未读取、未修改 |

### 完成内容

- Rail 与 Full Agent 在点击发送时从同一项目级 Jotai 真源同步冻结 V1 snapshot；
- 普通发送、后台软空闲、托管队列、steer 与 stale fallback 均沿用点击时的同一快照；
- 主进程在持久化与模型调用前校验 Session binding、Project/Asset/Segment/QA ownership；
- 普通 Agent 不携带 Linguist Context，伪造 Context fail closed；
- 验证后的 Context 以 host-owned 结构块注入，并随该用户 Turn 写入 JSONL 历史；
- Context 只含有界 opaque ID、时间与 UI revision，不含客户文本或绝对路径。

### 验证

- Shared/Workbench/Queue/历史 BDD：29 pass / 0 fail；
- 主进程 authority nodetest：5 pass / 0 fail；
- Fusion 架构与 Agent Full 契约：11 pass / 0 fail；
- Shared typecheck、Main/Renderer build、边界检查：通过；
- `git diff --check`：通过。

### 下一状态

LF-062 `unit_verified`；LF-063 可开始，Agent-CAT Fusion Gate 仍等待 LF-063～068。

## LF-043 — Segment Grid

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `8431df51` |
| result commit | `SELF` |
| production code | 新 Segment Grid 与既有查询/CAS 编排迁入 |
| user data | 未读取、未修改 |

### 完成内容

- 新 Grid 保留 Source/Target/Status/QA 列、locked、活动行和多选语义；
- 复用既有 200 段分页协议与 `@tanstack/react-virtual`，动态测量展开行；
- 只为可见/overscan 区间加载分页，刷新单页时保留其他已加载页；
- Target 保存继续使用主进程 `expectedRevision` CAS，冲突时刷新后端真值；
- Tag/Placeholder 以 Chip 展示，不改写原文；
- 未新增第二套 CAT 数据真源或依赖。

### 验证

- Segment Grid / virtual paging / edit seam：10 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- `git diff --check`：通过。

### 下一状态

LF-043 `unit_verified`；LF-044 与 LF-046 可开始，手工 CAT Gate 仍等待 LF-044～047。

## LF-050 — Bottom Dock 壳、拖动高度与项目级持久化

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `804cc0ad` |
| result commit | `SELF` |
| production code | Bottom Dock 壳、项目状态与 Workbench 布局接入 |
| user data | 未读取、未修改 |

### 完成内容

- 建立 TM、术语、QA、上下文/证据、预览五个可键盘进入的资源 Tab；
- Dock 跟随唯一的 Active Segment 状态，不复制 Segment 真相；
- 支持折叠、拖动高度以及方向键、Home、End 调整，统一约束在 160～480px；
- 桌面布局占用独立高度，窄窗口切换为底部 overlay；
- 开合、高度和当前 Tab 沿用既有 Workbench settings，按项目隔离并跨重启恢复。

### 验证

- Bottom Dock / Workbench Shell / 项目状态 BDD：17 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- `git diff --check`：通过。

### 下一状态

LF-050 `unit_verified`；LF-054 与 LF-055 可开始，Language Resource Dock Gate 仍等待 LF-051～055。

## LF-070 — Project Settings Sheet

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `50a2f201` |
| result commit | `SELF` |
| production code | Workbench 项目设置入口、Sheet 容器与项目元信息 |
| user data | 未读取、未修改 |

### 完成内容

- Workbench Toolbar 增加项目设置入口，使用项目级 Jotai 状态控制开合；
- 复用 Proma 已有 Sheet 与 Tabs，建立右侧唯一 Project Settings 容器；
- 展示项目名称、语言方向和质量策略，未复制项目业务真相；
- 资源与维护分类保留明确边界，不提前迁移 LF-071/LF-072 内容。

### 验证

- Project Settings / Workbench Shell BDD：7 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-070 `unit_verified`；LF-071 与 LF-072 可开始，Legacy UI 删除仍等待 LF-073～077。

## LF-037 — Native Agent Reuse Gate

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `be1d2348` |
| result commit | `SELF` |
| production code | 无 |
| user data | 未读取、未修改 |

### Gate 结论

`integration_verified`。

- Workbench Rail 与完整 Agent Tab 直接复用同一个原生 `AgentView` 和同一 Session ID；
- Queue/Steer、Thinking、Approval/AskUser、Permission 与 Model Selector 均保留在唯一原生行为链；
- Rail/Full 只改变 presentation 样式，消息、Composer、工具生命周期和恢复动作没有分叉；
- 架构扫描未发现第二套 Linguist Agent 基础组件，也未新增未登记的 Proma → Linguist 反向依赖。

### 验证

- Agent Full / Rail / Chat 行为契约：10 pass / 0 fail；
- Project Session / Rail / Queue BDD：13 pass / 0 fail；
- Fusion 架构护栏：3 pass / 0 fail；
- LF-070 前置执行的 Electron typecheck：通过；
- 上游边界：3 pass / 0 fail。

### 下一状态

G-F2 自动化与集成条件已满足；真实项目的完整 Agent↔CAT 操作仍归 LF-069/G-F4，不在本 Gate 冒充验证。

## LF-054 — Context / Evidence Panel

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `1ec85253` |
| result commit | `SELF` |
| production code | Bottom Dock 当前片段 Context / Evidence 只读面板 |
| user data | 未读取、未修改 |

### 完成内容

- 当前片段切换时读取 CAT Context 和 Style、Voice、Context、TM 来源摘要；
- 展示待审 Proposal 的 evidence/term refs，并标注 provenance；
- 已识别来源可定位到本面板来源摘要，术语引用切换到术语 Tab；
- 不包含导入、删除或其他项目资源管理动作。

### 验证

- Context / Evidence 与 Bottom Dock BDD：3 pass / 0 fail；
- `git diff --check`：通过；
- 全量 typecheck/build 待并行中的 LF-044/LF-063 工作树收口后统一复验。

### 下一状态

LF-054 `unit_verified`；Language Resource Dock Gate 仍等待 LF-051～053、LF-055。

## LF-044 — Target Editor

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `709f4b79` |
| result commit | `SELF` |
| production code | 独立 TargetEditor 与 Segment Grid 组合 |
| user data | 未读取、未修改 |

### 完成内容

- 从 Grid 抽出唯一 TargetEditor，保留既有 CAS 保存回调；
- IME 中间值合并为一个 Undo 步骤，支持 Cmd/Ctrl+Z、Redo、Cmd/Ctrl+Enter 与 Esc；
- Source Tag/Placeholder 以 Chip 展示，粘贴、Replace、Insert 均受守恒 hard rail 约束；
- Replace 替换未保存草稿，Insert 使用当前选区/光标，无焦点时追加；
- dirty、locked、archived 和保存状态不成为第二套 CAT 真相。

### 验证

- TargetEditor / Grid / keyboard / virtual BDD：17 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- `git diff --check`：通过。

### 下一状态

LF-044 `unit_verified`；LF-045、LF-047、LF-051 与 LF-052 前置已解锁。

## LF-063 — CAT Tool Project Mutation Event

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `2adc2a42` |
| result commit | `SELF` |
| production code | CAT 写工具 mutation、主进程 revision 与 typed preload 事件 |
| user data | 未读取、未修改 |

### 完成内容

- Proposal、QA、Critic 与 Batch Repair 仅在真实提交后发送 Project Mutation Event；
- Project ID 只来自冻结的 Session binding，模型参数不能选择或伪造项目；
- 主进程为每项目分配进程内单调 revision，并通过既有 Agent 运行链发送 typed 事件；
- 只读、check-only 与幂等重跑保持静默；Critic 仅在 Finding 需重开或 revision 变化时再次通知；
- 下行通知失败不反转已经提交的数据库结果，避免诱发重复写。

### 验证

- CAT Tools：30 pass / 0 fail；
- Session CAT Tools：6 pass / 0 fail；
- IPC Contract：18 pass / 0 fail；
- CAT Tools、Shared、Electron typecheck：通过；
- Main / Preload build：通过。

### 下一状态

LF-063 `unit_verified`；LF-064 与 LF-065 前置已解锁，Agent-CAT Fusion Gate 仍等待 LF-064～068。

## LF-071 — 项目资源迁入 Project Settings

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `f1e5aca4` |
| result commit | `SELF` |
| production code | Project Settings 资源页与既有资源组件组合 |
| user data | 未读取、未修改 |

### 完成内容

- Project Settings 增加资源页，集中 Import、Assets、TM、TB、句式、Style、Voice 与 Context；
- 直接复用 `ProjectAssetsSection`、`ReferenceManager`、`StyleGuidePanel`、`VoiceProfilePanel` 与 `ContextDocsPanel`；
- 各资源继续使用原有 IPC、校验、归档只读规则和单一数据真源；
- 导入后沿用 Workbench summary 刷新，不复制项目统计状态；
- 旧 ProjectsView 管理入口暂时保留，待 LF-073/074 有序收敛。

### 验证

- Project Settings / Workbench Shell BDD：8 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-071 `unit_verified`；LF-073 仍等待 LF-072，Legacy UI 删除仍等待 LF-073～077。

## LF-064 — Workbench 按 Mutation 增量刷新

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `802fe153` |
| result commit | `SELF` |
| production code | 项目级 mutation 状态、Grid/Proposal/QA/Context 增量刷新 |
| user data | 未读取、未修改 |

### 完成内容

- typed preload mutation 订阅按 Project 隔离并在卸载时退订；
- 每项目 revision 去重并丢弃乱序事件，gap 只回拉摘要与当前页；
- 正常事件仅刷新受影响的已加载 Segment 页、Proposal、QA 与活动 Context/资源 seam；
- 带筛选或搜索时回拉当前页，避免局部补丁破坏结果集顺序；
- 刷新状态只保留 opaque IDs、kind 与 revision，不复制 CAT 数据真相。

### 验证

- Mutation / Workbench BDD：15 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-064 `unit_verified`；LF-067 的 mutation 前置已满足，Agent-CAT Fusion Gate 仍等待 LF-065～068。

## LF-072 — Project Settings 维护与可恢复删除

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `4e76802c` |
| result commit | `SELF` |
| production code | Backup/Health/Archive 维护页、可恢复项目删除与 UI 状态清理 |
| user data | 未读取、未修改 |

### 完成内容

- Project Settings 启用维护页，直接组合既有 Backup、Health 与 Archive；
- 旧 ProjectsView 与新维护页共用归档确认、IPC、Toast 和刷新逻辑；
- 删除只允许已归档项目，并在 renderer 与主进程双重要求精确项目名确认；
- 完整项目目录原子移入数据根 `trash/`，索引写失败时移回；Agent Session 历史不级联删除；
- 删除成功后清理项目级 Workbench Jotai 状态、刷新项目列表并关闭对应 Project Tab；
- IPC 只返回 Project ID 与恢复目录 basename，不暴露绝对路径。

### 验证

- Settings / IPC / 错误契约 BDD：61 pass / 0 fail；
- Cat Store：128 pass / 0 fail；
- Electron Linguist node suite：130 pass / 0 fail；
- Electron / Shared / Cat Store typecheck 与 Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-072 `unit_verified`；LF-073 前置已满足，Legacy UI 删除仍等待 LF-073～077。

## LF-055 — Bottom Dock Preview Panel

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `e3890d5e` |
| result commit | `SELF` |
| production code | Bottom Dock 只读源文件预览与既有预览表面复用 |
| user data | 未读取、未修改 |

### 完成内容

- 将既有 Asset Preview 提取为 Dialog 与 Bottom Dock 共用的只读渲染表面；
- Preview Tab 读取项目级活动 Asset，并沿用主进程受控源文件预览 IPC；
- 文本、消毒后的 Office HTML 与不透明 `proma-file://` URL 三态保持原能力；
- 未选择 Asset 时显示空态，不引入保存、编辑或第二份预览数据。

### 验证

- Bottom Dock Preview BDD：2 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-055 `unit_verified`；LF-056 仍等待 LF-051～053。

## LF-045 — Target 保存、确认并前进与 Revision Conflict

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `fdbb9eef` |
| result commit | `SELF` |
| production code | Target 保存状态机、冲突恢复与可编辑行前进 |
| user data | 未读取、未修改 |

### 完成内容

- 保存结果显式区分 saved / conflict / failed，失败或冲突不再关闭 Editor；
- Revision Conflict 保留本地草稿，并要求用户选择加载最新译文或保留草稿后再重试；
- 保存、取消、确认并前进均有明确动作，Cmd/Ctrl+Enter 仅在 IME 结束后确认并前进；
- 前进跳过 locked 行、按需加载分页，并在当前 Asset 边界停止；
- archived、locked、Tag/Placeholder hard rail 与无修改草稿继续 fail closed。

### 验证

- Target / Grid / 编辑纯函数 BDD：23 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-045 `unit_verified`；LF-047 前置已满足，LF-048 仍等待 LF-046～047。

## LF-065 — CAT Tool Result 原生摘要

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `8d8972dd` |
| result commit | `SELF` |
| production code | Proma 原生 Tool Result CAT 摘要扩展 |
| user data | 未读取、未修改 |

### 完成内容

- 在既有 Tool Result 分派器为 `cat_*` 增加唯一窄扩展点；
- Project/Asset/Segment/TM/TB/Proposal/QA/Critic/Batch 结果显示稳定中文统计摘要；
- 摘要不渲染客户正文、文件名、绝对路径或模型返回的任意细节；
- 错误、未知工具和畸形 payload 继续使用原生通用结果；
- Tool Activity 文案补齐 Critic 与 Batch Consistency。

### 验证

- CAT Result / Tool Phrase BDD：4 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-065 `unit_verified`；LF-066 可提交，Agent-CAT Fusion Gate 仍等待 LF-066～068。

## LF-066 — Tool Result 点击定位 Project / Segment

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `6391fed8` |
| result commit | `SELF` |
| production code | host-owned Tool result 位置锚点、严格按钮与项目级导航 |
| user data | 未读取、未修改 |

### 完成内容

- Session binding 为 CAT 成功结果注入 Project ID 与最多一个 Segment anchor，模型不能提交或覆盖；
- 保留既有工具 DTO 字段，只增加独立 `segmentId` 导航锚点；
- Tool Card 只接受严格 Project/Segment ID，畸形、混合或路径值保持不可点击；
- 点击复用原生 Project Tab 打开链，再以项目级 `linguistCatGetContext` 校验 Segment 归属；
- 校验成功后清除筛选并聚焦虚拟行；错配、缺失或 IPC 失败安全降级到 Project 或无动作；
- Project open 响应的 Project/Health identity 不一致时 fail closed。

### 验证

- Renderer 导航与安全降级 BDD：13 pass / 0 fail；
- Session CAT node：6 pass / 0 fail；
- Cat Tools：30 pass / 0 fail；
- Electron / Cat Tools typecheck 与 Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-066 `unit_verified`；Agent-CAT Fusion Gate 仍等待 LF-067～068。

## LF-073 — ProjectsView 项目管理首页

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `5d927404` |
| result commit | `SELF` |
| production code | 项目管理首页、设置入口与 Project Tab 打开链收敛 |
| user data | 未读取、未修改 |

### 完成内容

- ProjectsView 不再把 ProjectDetailPanel 当作项目日常工作面；
- 卡片单击和“打开”统一复用 `openLocalizationProject` 创建或聚焦 Project Tab；
- 卡片提供常显、键盘可达的“设置”入口，直接复用 ProjectSettingsSheet；
- 管理首页保留新建、迁移、摘要、健康状态、归档及已归档分组；
- 设置内资源/恢复操作会刷新摘要与健康状态，归档/删除会关闭 Sheet 并刷新共享列表；
- 旧 ProjectDetailPanel 文件未提前删除，留给 LF-074 的依赖门。

### 验证

- Project 管理卡片与既有项目行为 BDD：14 pass / 0 fail；
- Monorepo typecheck：通过；
- Renderer production build：通过；
- 上游边界与 Fusion 架构：6 pass / 0 fail。

### 下一状态

LF-073 `unit_verified`；LF-074 仍等待 LF-069，Projects 管理首页不再承担日常 CAT 编辑。

## LF-046 — Grid 行内质量状态与当前行详情

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `3f7d5fde` |
| result commit | `SELF` |
| production code | Segment 行内状态、Proposal/QA 投影与当前行详情入口 |
| user data | 未读取、未修改 |

### 完成内容

- Grid 行内显示 Segment 状态、Proposal 待审/过期状态，以及该 Segment 的开放 QA 数量和最高严重度；
- QA 严重度使用明确文字与主题 token，不只依赖颜色；
- QA 查询只在 renderer 保留 `segmentId → count/highestSeverity` 轻量投影，不复制 Finding 正文；
- QA 未加载或查询失败与“已加载但为空”严格区分，避免把未知状态误报为无问题；
- 状态与 QA 单元格均可键盘聚焦，分别打开当前行 Context 与项目 QA Bottom Dock；
- 旧 Context Rail 只补充当前行标题与行号，数据继续来自既有项目 Context IPC。

### 验证

- Project renderer BDD：139 pass / 0 fail；
- no-raw-palette、上游边界与 Fusion 架构：55 pass / 0 fail；
- Electron typecheck：通过；
- Renderer production build：通过。

### 下一状态

LF-046 `unit_verified`；LF-053 与 LF-067 前置的一半已满足，LF-048 仍等待 LF-047。

## LF-047 — Grid 键盘工作流与可访问语义

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `3920fdbc` |
| result commit | `SELF` |
| production code | Grid roving focus、键盘导航、TargetEditor 快捷键与可访问状态 |
| user data | 未读取、未修改 |

### 完成内容

- Grid 明确总行/列、选择能力、归档只读、表头索引和键盘说明；
- 非活动虚拟行及其操作退出 Tab 顺序，活动行支持 Arrow/Home/End/Page 导航、Enter/F2 编辑与 Space 选择；
- 虚拟滚动后只在目标行尚未持有焦点时聚焦，避免编辑器挂载期间抢走 textarea 焦点；
- TargetEditor 支持 Cmd/Ctrl+S 保存、Cmd/Ctrl+Enter 确认并前进、Escape 取消及既有 Undo/Redo；
- 保存、取消后恢复编辑入口焦点；确认并前进由新行接管焦点；
- IME、CAS 冲突、locked/archived、Tag/Placeholder hard rail 保持 fail closed，并补充 busy/live status。

### 验证

- LF-047 定向 BDD：28 pass / 0 fail；
- Project renderer BDD：143 pass / 0 fail；
- 全仓 Bun tests：1133 pass / 0 fail；
- no-raw-palette、上游边界与 Fusion 架构：55 pass / 0 fail；
- Electron typecheck 与 Renderer production build：通过。

### 下一状态

LF-047 `unit_verified`；LF-048 的源码前置已齐，完整 Gate 仍要求当前 packaged App 手工 CAT 流。

## LF-051 — TM Match Panel + Replace/Insert

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `95cb795f` |
| result commit | `SELF` |
| production code | Bottom Dock TM 匹配、TargetEditor transient capability 与草稿 Replace/Insert |
| user data | 未读取、未修改 |

### 完成内容

- Bottom Dock 的 TM Tab 读取当前 Segment 的 TM matches，并显示 score、origin、Source/Target 及 Exact/Contains/Fuzzy；
- Replace 与 Insert 仅调用当前 TargetEditor 命令句柄，修改未保存草稿并保留 Undo，不直接调用保存或 Proposal IPC；
- Insert 保留 textarea 失焦前的 selection/caret；Tag/Placeholder hard rail 继续由 TargetEditor 单一实现；
- capability 按 Project 隔离，只保存 opaque Segment ID 与命令句柄，不保存草稿或客户文本；
- archived、locked、编辑器缺失、Segment 不匹配均禁用并提供可见及读屏原因；
- 请求状态绑定 Segment ID，切换行时旧 TM 结果不能作用于新编辑器。

### 验证

- LF-051 定向 BDD：34 pass / 0 fail；
- Project renderer BDD：153 pass / 0 fail；
- 全仓 Bun tests：1144 pass / 0 fail；
- no-raw-palette、上游边界与 Fusion 架构：55 pass / 0 fail；
- Electron typecheck、Renderer production build 与 `git diff --check`：通过。

### 下一状态

LF-051 `unit_verified`；LF-052 复用同一编辑器 capability，LF-056 仍等待 LF-052～053。

## LF-052 — Term Match Panel + Insert

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `1227aacf` |
| result commit | `SELF` |
| production code | Bottom Dock 术语匹配与 TargetEditor 草稿 Insert |
| user data | 未读取、未修改 |

### 完成内容

- Bottom Dock 的 Terms Tab 读取当前 Segment 的 term matches，展示术语、译文、状态、大小写、备注、匹配类型和冲突；
- Insert 只调用 LF-051 的 Project-scoped TargetEditor handle，修改当前 selection/caret 的未保存草稿并保留 Undo；
- 没有新增 save、Proposal、项目写入或第二套草稿状态；
- 不伪造后端 DTO 不存在的 priority；
- Project/Segment 切换时旧术语结果不可操作；archived、locked、编辑器缺失或身份不匹配均禁用并关联读屏原因；
- Tag/Placeholder hard rail 继续由 TargetEditor 单一实现。

### 验证

- LF-051/LF-052/Bottom Dock 定向 BDD：19 pass / 0 fail；
- 全仓 Bun tests：1152 pass / 0 fail；
- no-raw-palette、上游边界与 Fusion 架构：55 pass / 0 fail；
- Electron typecheck、Renderer production build 与 `git diff --check`：通过。

### 下一状态

LF-052 `unit_verified`；LF-056 仍等待 LF-053 与语言资源 Dock Gate。

## LF-067 — Proposal Inline Diff 与 Grid Accept/Reject

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `f770434f` |
| result commit | `SELF` |
| production code | Grid 行内 Proposal 审核、人工审核 mutation 与 Timeline 终态同步 |
| user data | 未读取、未修改 |

### 完成内容

- 活动 Grid 行显示 Current/Proposed 对照、Evidence、Warnings 与 Accept/Reject 操作；
- Accept 对 stale、locked、archived 状态 fail closed；Reject 允许清理 stale/locked Proposal，但 archived 项目仍 fail closed；
- 单条与批量审核复用 renderer-only Proposal IPC，携带 expected revision 与 idempotency key；批量操作必须先确认，Agent Tools 不暴露 Accept/Reject；
- 成功且非幂等重放的 UI 审核只发出一次 host-owned `proposal-reviewed` mutation；失败或重放不发事件；
- Workbench 根据 mutation 增量刷新，Agent Timeline 只从严格 Proposal ID 回查 Store 终态，不读取客户正文或本机路径，回查失败不伪造状态。

### 验证

- Renderer 定向 BDD：25 pass / 0 fail；
- Proposal IPC、Session CAT 与 Store nodetest：25 pass / 0 fail；
- `git diff --check`：通过；
- 未执行 packaged App 或真机验证。

### 下一状态

LF-067 `unit_verified`；LF-068 前置已满足，LF-069 仍等待 packaged/真机 Fusion Gate。

## LF-068 — 选中 Segment 的 Agent 翻译/审校/QA 工作流

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `fa2d61f7` |
| result commit | `SELF` |
| production code | Workbench Agent 快捷动作与原生 pending prompt Context 透传 |
| user data | 未读取、未修改 |

### 完成内容

- Project Agent Rail 增加翻译、审校与整个项目 QA 三个快捷动作，继续复用同一原生 Agent Session、Composer 与发送链；
- 翻译/审校处理当前片段或最多 50 个完整选择，不静默截断；无目标或超限时 fail closed，提示词只要求创建 Proposal，不直接接受或覆盖译文；
- QA 明确覆盖整个项目，并冻结不含 Asset/Segment 选择的项目级 Context，当前选择不改变检查范围；
- 快捷动作点击时冻结一次 Linguist Context，经既有 pending prompt 路径同时交给乐观消息与 `AgentSendInput`；
- 普通 Agent pending prompt 继续保持无 Linguist Context；没有新增 IPC、Agent、Composer、状态真源或依赖。

### 验证

- LF-068 定向 BDD：15 pass / 0 fail；
- 全仓 Bun tests：1175 pass / 0 fail；
- Electron typecheck、Renderer production build 与 boundaries：通过；
- `git diff --check`：通过；
- 未执行 packaged App 或真机验证。

### 下一状态

LF-068 `unit_verified`；LF-060～068 的源码依赖已齐，LF-069 仍需 packaged/真机 Agent-CAT Fusion Gate。

## LF-053 — Segment QA Panel + 跳转/处理

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `cc97aad4` |
| result commit | `SELF` |
| production code | Segment-scoped QA Findings Panel 与安全处置 |
| user data | 未读取、未修改 |

### 完成内容

- QA Panel 可按当前 Segment 查询 Finding，并沿用既有状态、严重度、处置筛选与分页 DTO，不建立第二份 Finding 缓存；
- Segment scope 切换时隔离异步结果，旧请求不能在新 Segment 下重新显示或操作；
- 跳转复用既有当前片段入口；Resolve 仅在开放 Finding 对应译文 revision 已推进后可用；
- Waive 必须提供非空且不超过 500 字符的原因，并提供可见、可读屏的校验反馈；
- Segment Panel 的 QA 运行仍明确扫描整个项目；归档项目只读且可跳转，运行、Resolve、Waive 全部 fail closed；
- 实现与 BDD 均位于既有 Linguist feature allowed-new 路径，没有新增 IPC、DTO、Store、状态真源或依赖。

### 验证

- LF-053 定向 BDD：7 pass / 0 fail；
- 全仓 tests、Electron typecheck、Renderer production build 与 boundaries：通过；
- `git diff --check`：通过；
- LF-056 packaged/真机 Language Resource Dock Gate 未执行。

### 下一状态

LF-053 `unit_verified`；LF-050～055 的源码票已齐，LF-056 保持 `pending`，等待 packaged/真机 Language Resource Dock Gate。

## LF-048 — 无 Agent 手工 CAT 完整 Gate

### 当前证据

- Segment Grid 已补齐鼠标双击进入 Target 编辑，继续复用既有 Enter/F2 与单击 Target 按钮入口；
- locked、archived、未加载行 fail closed；选择框、Accept/Reject、QA 等交互控件不会因行级双击误开编辑器；
- LF-048 探针合同 BDD：4 pass / 0 fail；
- 当前 packaged App 自动矩阵：20 pass / 0 fail / 2 manual；
- 自动矩阵覆盖双资产导入与 metadata、编辑/CAS/locked、TM/TB、QA、归档只读、10k Segment、20 次精确搜索和重启恢复；
- 10k 精确搜索 p95 为 149ms，门槛为 200ms；
- Electron typecheck 与 `git diff --check`：通过；
- 真实系统 IME composition 与 Native Save 选择原文件后的覆盖拒绝没有取得可靠自动化证据。

### 下一状态

LF-048 保持 `pending`；自动矩阵不能替代真实 IME 与 Native Save 手工证据，Gate 不宣称通过。

## AC-006 — Export 防覆盖原稿/受管目录

### 完成内容

- Native Save 使用 `COPYFILE_EXCL`，目标已存在时 fail closed，不覆盖原有字节；
- 目的地先解析现存父目录的 `realpath`，拒绝 Linguist Agent 受管数据根及其符号链接别名下的目标；
- 默认导出文件名为 `<原文件名（不含扩展名）>.translated.<targetLocale><扩展名>`，降低用户误选原文件的风险；
- 取消 Save 对话框后保留已验证的 staging artifact，继续作为可发现交付物，属于既有设计选择。

### 验证

- AC-006 定向测试：9 pass / 0 fail；
- CAT Store 全套测试：通过；
- Electron `test:linguist`：132 pass / 0 fail；
- CAT Store 与 Electron 两包 typecheck：通过；
- 未执行 packaged native Save。

### 下一状态

AC-006 `unit_verified`；packaged native Save 仍需在后续真实打包 Gate 验证。

## LF-026 — Linguist 导航可发现性与恢复 Gate

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `1c6c03ab` |
| result commit | `SELF` |
| production code | 无；只补强现有 PB-074 packaged 探针及其合同测试 |
| user data | 使用独立 tmp HOME，退出时已清理；未读取或修改真实用户数据 |

### Packaged App 证据

- 使用当前 `0.15.101` 打包应用运行 `node scripts/smoke/probe-pb074-e2e.ts --lf026-only`；
- Agent、Chat、Linguist 三模式均可发现并可往返；
- Linguist Sidebar 同时显示两个身份不同的项目，Project 管理首页可从次级入口进入；
- 单击项目进入一等 Project Tab，并恢复指定 Asset 与 Segment；
- 同一 tmp HOME 重启后仍回到 Linguist、相同 Project Tab、Asset 与 Segment；
- Sidebar 创建并选择项目 Agent Session 后，Workbench 不丢失，tab/location/session 均已持久化；
- 结果为 7 PASS / 0 FAIL / 1 MANUAL；MANUAL 仅记录 Playwright 未驱动 macOS 原生 Open Dialog，不属于 LF-026 Gate。
- 默认无参数 PB-074 纵向 smoke 同时为 17 PASS / 0 FAIL / 2 MANUAL，确认 Fake Model→CAT Tool→Proposal→QA hard rail→人工审核→export/reimport→重启恢复的 canonical 路径未被窄 Gate 改造破坏；两项 MANUAL 仅为原生 Open/Save Dialog。

### 验证

- LF-026/PB-074 探针合同测试：5 pass / 0 fail；
- Electron typecheck：通过；
- `git diff --check`：通过。

### 下一状态

LF-026 `packaged_verified`；LF-077 的导航依赖已满足，但仍需等待 LF-074。

## LF-069 — Agent-CAT Fusion Gate

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `b405897e` |
| result commit | `SELF` |
| production code | 无；新增独立 LF-069 packaged 探针与合同测试 |
| packaged artifact | `0.15.101`，`app.asar` SHA-256 `c6cf68fe3652e40b5366be546122218e59b4824e57b756ee7d03ae71e6094e2f` |
| user data | 使用独立 tmp HOME，退出时已清理；未读取或修改真实用户数据 |

### Packaged App 证据

- 在真实打包 App 选中 3 个 Segment，右栏 Context Chip 显示 `已选 3 段`；
- Fake Model 仅替代外部模型响应，Agent、Session binding、CAT Tool、Store、IPC 与 Renderer 均走打包应用真实生产路径；
- `cat_propose_translations` 被真实注册并调用，产生 3 个不同 Proposal；
- Proma 原生 Tool Row / Tool Card 可见，点击卡片能定位对应 Grid 行；
- 接受前两条、拒绝第三条后，Store、3 行 Grid 译文及 Agent Timeline 的 `已接受 2 · 已拒绝 1` 同步；
- 切换到完整 Agent Tab 后，先展开历史 `ProcessBlockGroup`，同一 Tool Card 与审核状态仍在；返回真实 Project Tab 后 Rail、Store 与 Grid 状态继续保持；
- 历史默认折叠是 `ProcessBlockGroup` 的既定行为，不是 Pi tool timeline 持久化丢失；探针按真实两层折叠交互验证。

### 验证

- `node scripts/smoke/probe-lf069-fusion.ts`：13 pass / 0 fail；
- LF-069 探针合同：6 pass / 0 fail，58 assertions；
- 探针明确不外推 G8 翻译质量或其他 Gate。

### 下一状态

LF-069 `packaged_verified`；LF-074、LF-076 与 AC-003 的对应依赖已满足。LF-075 仍等待 LF-056，LF-076 仍等待 LF-048 与 LF-056。

## LF-074 — 删除 ProjectDetail 内部工作导航

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `5cfe53c2` |
| result commit | `SELF` |
| production code | 删除 `ProjectDetailPanel.tsx` 与其唯一私有子组件 `ProjectChatsSection.tsx` |
| package version | `@proma/electron` 0.15.101 → 0.15.102 |
| user data | 无迁移、无读写 |

### 完成内容

- 调用图确认 `ProjectDetailPanel` 已无生产消费者，`ProjectChatsSection` 只被前者调用；
- 删除旧 ProjectDetail 内部 Chat / Proposal / CAT / QA / Artifacts / Files 导航，不建立第二套替代页面；
- Project 管理首页继续由 `ProjectsView` 承载，日常编辑继续进入一等 Project Tab 与 `LocalizationProjectWorkbench`；
- 保留 Project Session、ProjectAssets/Backups、Proposal、CAT Store/Tools、QA、Export 与用户数据实现。

### 验证

- `apps/electron/src` 与 `packages` 无两个已删除组件的残留引用；
- Electron typecheck：通过；
- Fusion architecture：3 pass / 0 fail；
- no-raw-palette、upstream boundary、JSON parse 与 `git diff --check`：通过。

### 下一状态

LF-074 `unit_verified`；LF-077 的前置条件已满足。LF-075/LF-076 仍须先完成对应 Gate 与能力等价验证。

## LF-017 — Agent/Chat/Linguist 模式与 Tab 回归 Gate

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `6fdb3912` |
| result commit | `SELF` |
| production code | 无；复用 LF-003 总入口与既有 packaged probes，只修正过期的覆盖说明 |
| packaged artifact | `0.15.102`，`app.asar` SHA-256 `b7c1c245cd2f98c63e0ecdd678b3c2e82d0c78a7a5b0044cc9efd797e130fd25` |
| user data | Agent、Chat、Linguist 探针均使用独立 tmp HOME；未读取或修改真实用户数据 |

### Packaged App 证据

- `bun run smoke:vertical` 从当前纯净 HEAD 重新构建真实未签名 packaged Electron；
- Agent 路径 12 PASS / 0 FAIL：冷启动、Pi Streaming、Thinking 与 final 通过；
- Chat 路径 18 PASS / 0 FAIL：Streaming、Thinking、Tool、Retry、Stop 与重启恢复通过；
- Linguist 路径 17 PASS / 0 FAIL / 2 MANUAL：三模式可发现、一等 Project Tab、单击项目进入 Editor、指定 Asset/Segment、切换与重启恢复，以及完整 Agent-CAT 交付纵向路径通过；
- 两项 MANUAL 仅是 Playwright 未驱动 macOS 原生 Open/Save Dialog，不属于 G-F1；
- 计划表把 LF-017 依赖写成 LF-011～016，但 G-F1 的“一次点击进入 Editor”实际上还需要 LF-022；当前 HEAD 已完成并验证 LF-022，因此本次 Gate 不受影响。

### 验证

- LF-003 总报告：4 个步骤全部退出码 0，工作区运行前为 clean；
- G-F1 五项要求全部有 packaged 证据；
- 总报告仍保持 `coverageStatus=partial`，不把 Agent Stop/Retry、Chat→Agent 往返或原生对话框缺口冒充完整产品资格。

### 下一状态

LF-017 `packaged_verified`；下一批继续 LF-048 与 LF-056。

## LF-077 — 退役 Projects 日常工作入口

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `ad03358e` |
| result commit | `SELF` |
| production code | 删除 Proma LeftSidebar 的旧 Projects 主入口及其专用 feature flag |
| package version | `@proma/electron` 0.15.102 → 0.15.103 |
| user data | 无迁移、无读写 |

### 完成内容

- 删除 LeftSidebar 展开态 `ProjectsSidebarEntry`、收起态 Rail 项目按钮及 `handleOpenProjects`；
- 删除只服务旧入口与回落逻辑的 `LINGUIST_PROJECTS_VISIBLE`；
- 保留完整 Agent / Chat / Linguist 模式入口，不改变 Proma 通用 Agent 能力；
- 保留 `activeView='projects'` 与 `ProjectsView`，但唯一生产入口是 Linguist Sidebar 的次级“管理项目”按钮；
- MainArea 与 AppShell Agent Rail 按 AppMode 共用项目管理路由归一化；从管理空态切回 Agent/Chat 时回到普通主区，不泄漏 ProjectsView 或错误隐藏 Agent Rail；
- 单击具体项目仍经 `openLocalizationProject` 进入一等 Project Tab，并把 `activeView` 切回 `conversations`；
- 没有 Project Tab 时进入管理空态仍属合法导航，不把管理能力错误删除。

### 验证

- Active View、Feature flag、Linguist Sidebar 与 open project 定向 BDD：21 pass / 0 fail；
- Fusion architecture：4 pass / 0 fail，新增护栏禁止恢复旧入口或专用开关；
- Electron typecheck、生产消费者扫描、JSON parse 与 `git diff --check`：通过。

### 下一状态

LF-077 `unit_verified`；LF-078 仍等待 LF-075 与 LF-076。

## LF-056 — Language Resource Dock Gate

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `168fb817` |
| result commit | `SELF` |
| production code | 无；复用 PB-074 packaged 探针，增加 LF-056 专用路径、BDD 合同与公共 Repository fixture |
| packaged artifact | `0.15.103`，`app.asar` SHA-256 `b7c1c245cd2f98c63e0ecdd678b3c2e82d0c78a7a5b0044cc9efd797e130fd25` |
| user data | 使用独立 tmp HOME，退出时已清理；未读取或修改真实用户数据 |

### Packaged App 证据

- `--lf056-only` 在真实打包 App 完成 15 PASS / 0 FAIL / 0 MANUAL；
- 资源入口、五个 canonical Tab、折叠/恢复、键盘 Tab 切换均通过；pointer drag 将高度从 240 调到 324，键盘 End 再调到 480；
- 主项目保存 Preview/480，干扰项目保存 Terms/160；来回切换与重启后两套状态分别恢复；
- 窄窗口使用 overlay；Preview 无可编辑控件，受管 Source blob 的 SHA-256 前后相同；
- TM Replace 与带 sentinel/caret 的 Insert 明确区分；它们及 Terms Insert 都只修改 TargetEditor 草稿，Undo 可恢复，Store target/revision 保持 `""@r0`；
- QA 可见 Finding 全部属于当前 Segment；切到第二个 Segment 后 TM、Terms、QA、Evidence 更新，切回首段后资源恢复；
- 首段 Style/Voice/Context/TM/Term evidence provenance 与术语跳转均通过；
- fixture 只调用 `CatStore` 公共 repositories，不直写 SQL、不增加生产 IPC 或测试专用产品入口。

### Terms 契约说明

LF-052 已确认当前 CAT DTO 的 authoritative 字段是 `preferred / forbidden / allowed / deprecated` status enum，没有独立 `priority`。本 Gate 验证真实 `preferred` 状态、Insert、Undo 与 draft-only，不伪造后端不存在的 priority 字段，也不借 Gate 扩张领域模型。

### 验证

- LF-026 / LF-056 探针合同：8 pass / 0 fail，100 assertions；
- 根 workspace typecheck：全部包通过；
- `git diff --check`：通过。

### 下一状态

LF-056 `packaged_verified`；LF-075 的删除前置条件已满足，LF-076 仍等待 LF-048 的两项真机证据。

## LF-075 — 删除旧 CatContextRail

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `907749a9` |
| result commit | `SELF` |
| production code | 删除 `CatContextRail` 及其唯一挂载、专用 Tab 类型与重复 refresh 状态 |
| package version | `@proma/electron` 0.15.103 → 0.15.104 |
| user data | 无迁移、无读写 |

### 完成内容

- 删除 `CatContextRail.tsx` 与 `CatWorkspace` 的唯一 import/render；
- 删除仅供旧 Rail 使用的 `CatContextTab` 和 `contextMutationRevision`；
- Bottom Dock 继续承载 TM、术语、当前段 QA 与 Context/Evidence，Grid 继续承载 Segment 详情、Proposal inline diff、单条/批量 Accept/Reject；
- TM、Terms 与 Context/Evidence 各自继续按 project mutation state 刷新；QA 继续复用项目级 capability 与 `qaRefreshToken`，没有丢失 mutation 更新；
- 清理 AppShell/right-rail-policy 的过期“两套 Rail”说明，Proma Agent Rail 判定逻辑不变；
- CAT Core、Store、Tools、Project Service、CAS、Proposal、QA、Evidence、Export 与项目级 Jotai 真源均保留。

### 验证

- Renderer 定向 BDD：110 pass / 0 fail；
- Fusion architecture：5 pass / 0 fail，并验证生产源码无 `CatContextRail` / `CatContextTab` 消费者；
- Electron typecheck、上游边界、JSON parse 与 `git diff --check`：通过；
- 独立 review 确认 Bottom Dock/Grid 等价覆盖，唯一 lockfile 版本漂移已修正。

### 下一状态

LF-075 `unit_verified`；LF-078 仍等待 LF-076，LF-076 仍需先补齐 LF-048 的两项真机 Gate 证据。

## LF-076 — 删除旧 CatWorkspace 产品布局

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `64ce1e1b` |
| result commit | `SELF` |
| production code | 旧 `CatWorkspace` 页面布局退役，控制器收敛为 `SegmentEditor` |
| package version | `@proma/electron` 0.15.104 → 0.15.105 |
| user data | 无迁移、无读写 |

### 完成内容

- 删除 `CatWorkspace.tsx`，保留原查询、虚拟分页、CAS 编辑、Proposal、QA 与 mutation 控制器行为并收敛为 `SegmentEditor.tsx`；
- 删除编辑器内重复的 Reference、Style Guide、Voice Profile 与 Context Docs 挂载；这些资源继续只由 Project Settings 管理；
- Workbench 直接挂载 `SegmentEditor → SegmentGrid`，没有新增 Store、IPC、持久化源或全局状态；
- Segment Editor 与 Grid 使用 `flex/min-h-0/overflow-hidden`，唯一 `overflow-auto` 保留在虚拟滚动视口；
- 删除不再使用的 `CatWorkspaceFilters` 类型；CAT Core、Store、Tools、Project Service、CAS、Proposal、QA、Evidence 与 Export 全部保留。

### 验证

- Workbench 定向 BDD：83 pass / 0 fail；
- Electron Linguist：132 pass / 0 fail；
- CAT Core / Store / Tools：260 pass / 0 fail；
- Fusion architecture 与 boundaries：9 pass / 0 fail；
- Electron typecheck 与 `git diff --check`：通过；
- 独立审查未发现 P0，确认没有第二状态源、Store 直连或 nested-scroll 代码回归。

### 偏差与下一状态

LF-076 `unit_verified`。按原依赖，删除前应先取得 LF-048 的真实 IME 与 Native Save 两项手工证据；本轮在自动矩阵 20/0、用户要求停止输入法自动化并继续代码主线后提前落地，因此这两项风险不会被文档写成已通过。LF-078 仍需独立聚合 Gate。

## AC-003 — 独立数据根与 Proma Provider 导入

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `e5ec9161` |
| result commit | `SELF` |
| production code | 全部当前用户数据改用 `.linguist-agent` / `.linguist-agent-dev`；增加 Provider-only 显式导入 |
| package version | `@proma/electron` 0.15.105 → 0.15.106；`@proma/shared` 0.1.66 → 0.1.67；`@proma/cli` 0.1.0 → 0.1.1 |
| user data | 测试只使用临时 HOME；未读取或修改真实用户数据 |

### 完成内容

- Electron、CLI、CAT、Agent、Chat、Skills、烟测与测试路径统一切到 `.linguist-agent`；开发模式使用 `.linguist-agent-dev`；
- 保留完整 Proma Agent / Chat 产品能力，只隔离数据根，不删除 Runtime、Provider、Session、Workspace、MCP 或 Skills；
- 「设置 → 模型配置」增加「从 Proma 导入」，只读取旧 `.proma(-dev)/channels.json`；
- 旧密钥先经 Electron `safeStorage` 解密，再写入当前数据根时重新加密；安全存储不可用或任一密钥解密失败时整体失败；
- 目标配置损坏时 fail-closed；导入先在内存完成，成功后通过同目录临时文件原子替换，不留下部分结果、提前迁移或直接截断目标文件；
- 打包烟测的明文凭据模式禁止执行导入，避免把旧 safeStorage 密文原样复制成不可用配置；
- 相同 Channel ID 确定性跳过且不覆盖；同 Provider 的不同账号允许并存；
- 不导入 Proma 会话、设置、工作区、机器人配置、信任规则或 CAT 数据；
- 同步 README、AGENTS、userData 与 Runtime 文档；被修改的三个默认 Skill 均递增 patch 版本。

### 验证

- Provider 导入、设置入口与 CLI 路径 BDD：13 pass / 0 fail；
- Electron Linguist nodetest：132 pass / 0 fail；
- 全 workspace typecheck：11 个包全部通过；
- upstream boundaries：3 pass / 0 fail；
- `git diff --check`：通过；
- 未执行 packaged / 真机导入，状态不提升为 `packaged_verified`。

### 下一状态

AC-003 `unit_verified`；继续 LF-078 Legacy UI Deletion 聚合 Gate。

## LF-078 — Legacy UI Deletion 聚合 Gate（自动部分）

### 提交边界

| 字段 | 值 |
|---|---|
| base commit | `0f4d62c3` |
| result commit | `SELF` |
| production code | 无；只增加跨 LF-074～077 的聚合架构护栏 |
| package version | 无变化 |
| user data | 无读写 |

### 自动证据

- `ProjectDetailPanel`、`ProjectChatsSection`、`CatContextRail`、`CatWorkspace`、`ProjectsSidebarEntry` 在生产 renderer 零声明、零消费者；
- 项目日常入口继续调用 `openLocalizationProjectTab` 并进入 `activeView='conversations'` 的一等 Project Tab；
- `LocalizationProjectWorkbench → SegmentEditor → SegmentGrid`、Bottom Dock 与 Project Settings 仍存在；
- CAT Core、Store、Tools、Project Service、Project IPC 与 Session CAT Tools 均保留；
- Project UI 不直接依赖 CAT Store/Tools、`node:sqlite`、`localStorage` 或 IndexedDB，不产生第二真相源；
- Fusion architecture：8 pass / 0 fail。

### 阻断与下一状态

LF-078 保持 `gate_blocked`，不是实现回退：当前 HEAD 尚未重打 packaged App，且 LF-076 的前置 LF-048 仍缺真实系统 IME 与 Native Save 选择原稿后的拒绝证据。自动聚合门已完成，不能替代这两项真机手工验收。
