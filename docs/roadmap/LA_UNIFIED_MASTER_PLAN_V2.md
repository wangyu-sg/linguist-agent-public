# Linguist Agent 统一实施总蓝图 v2.1

**副标题：Proma v0.16.8 收敛、完整宿主继承与最小个人 Alpha；长尾能力按真实证据触发**

- 文档状态：**唯一权威实施计划 / Single Source of Truth**
- 制定日期：2026-08-04（Asia/Singapore）
- 适用仓库：`wangyu-sg/linguist-agent-public`
- 当前公开事实：公开 `UPSTREAM_BASELINE.md` 仍登记 Proma `v0.15.11-1-g702a8221`；公开 `main` 的精确本地 HEAD、未提交修改和已实施票据必须由实施 Agent 在本地重新核验
- 目标 Proma 基线：`v0.16.8`，tag commit `bde00f00323d6735a939d14dbce3b2f1a5b672bc`
- 上游跨度：从公开 LA 基线 `702a8221...` 到 `v0.16.8`，GitHub Compare 显示 **77 commits / 274 files**；从 `v0.16.1` 到 `v0.16.8` 为 **34 commits / 132 files**
- 实施范围：**只修改 Linguist Agent 当前仓库；暂不向 Proma 官方仓库提交 Issue、PR 或代码**
- 文档取代：此前所有 LA 优化蓝图、Intake 蓝图、Prompt 计划、Review 实施队列和 2026-07-30 版统一蓝图，均以本文件为准
- 核心边界：本计划是“完成并开始真实使用”的执行计划，不是无限扩展愿望清单；所有新增能力必须服从阶段 Gate、真实使用证据和停止规则

---

## 快速导航

1. 最终产品决策与停止规则
2. Phase 0：同步 Proma v0.16.8，并建立本地收敛基线
3. Phase 1：Embedded Agent Host 等价性与 Proma 新能力继承
4. Phase 2：Project Intake 与真实 CAT 格式
5. Phase 2B：Tag Intelligence、编辑器原子锁定与 Phrase master-XLIFF 恢复
6. Phase 3：零预支质量、Prompt v3、翻译与完整审校
7. Phase 4：规则、Context、Runtime 与数据正确性
8. Phase 5：Chunked Job、Checkpoint 与性能
9. Phase 6：Web Chat 对照评估与 14 天日用
10. Phase 7：只作用于 LA 仓库的上游同步自动化
11. 一次性 Legacy CAT Parity Audit、Ticket 队列、迁移、测试与 Definition of Done

> **2026-08-05 实施覆盖（v2.1）**：本文件后续章节保留为长期设计参考，但当前机器队列的唯一执行范围是 `docs/roadmap/linguist-fusion-queue.json` 的最小 Alpha 列表。Proma 的 Agent、Chat、Provider、Skills、MCP、Automations、Preview、Permission、Thinking、Queue/Steer、文件和 Runtime 能力继续完整继承；“收敛”只删除 LA 曾经重复添加的通用增强，不删除 Proma 原生功能。
>
> 当前 Alpha 只推进：Host parity、受权单文件 Intake → exact-duplicate/格式预检 → Agent/UI 共用服务 → Verification、既有 PB-097 Tag Model 接线、Proposal/QA 覆盖、Proposal Critic、Session 默认继承与已确认的正确性修复。目录扫描、durable Import Job、3E Memory、TEaR、Full-Scope Review、长任务 Worker、性能/可观测性平台和低频格式 Adapter 已明确移出当前 Alpha；队列中以 `CANCELLED_WITH_REASON` 记录，不得作为当前阻断。
>
> `LA-ALPHA-000` 是个人 Alpha 入口 Gate。未通过前，不能以蓝图中的未来接口、模拟覆盖或“代码已写”宣布完成；通过后才开始最小对照评估和 14 天日用。下一次真实项目触发的长尾需求必须创建 successor Ticket，而不是把已取消票据直接复活。

---

## 0. 文档治理：旧蓝图全部作废

实施者必须将下列旧计划视为历史材料，不得混合执行：

- `LA_OPTIMIZATION_BLUEPRINT_PROMA_OVERLAY_2026-07-29.md`
- `Linguist_Agent_Optimization_Blueprint_CN.md`
- `Linguist_Agent_Intake_Host_Parity_Prompt_Format_Optimization_Plan_2026-07-30.md`
- `Linguist_Agent_Post_Refactor_Extreme_Review_2026-07-30.md` 中的旧实施顺序
- `Linguist_Agent_Unified_Master_Implementation_Blueprint_2026-07-30.md`
- 仓库中与上述方案重复、冲突或仍以 Fast / Balanced / Best 为质量档位的旧 Roadmap

处理方式：

1. 不必删除历史文档；将其移动到 `docs/archive/`，或在首行加入醒目的 `SUPERSEDED` 标记。
2. 所有旧文档必须指向本蓝图，避免实施 Agent 同时读取到相互冲突的要求。
3. 当前机器可读队列只允许有一份；建议新增：
   - `docs/roadmap/LA_UNIFIED_MASTER_PLAN_V2.md`（本文件）
   - `docs/roadmap/la-unified-queue-v2.json`（由实施者从本文件 Ticket 生成）
4. 每完成一个 Ticket，只更新本计划的状态和证据，不再建立新的总蓝图。
5. 新发现的旧 LA 能力只能先进入 `LEGACY_CAPABILITY_AUDIT.md`，不得因此再次推翻总蓝图。
6. 除格式正确性阻断项外，任何“看起来也许有用”的功能都必须先经过真实使用证据，再进入实施队列。

---

# 1. 最终产品决策

## 1.1 一句话定义

> **Linguist Agent 是建立在 Proma 完整通用 Agent 平台之上的游戏本地化垂直工作系统。它继承 Proma 的全部通用能力，再叠加 CAT 项目、上下文、工具、规则、质量流程和专业工作台。**

目标不是：

```text
Proma Agent
Chat
另一套独立 CAT Agent Runtime
```

目标是：

```text
Proma Agent Runtime / Session / Composer / Tool UI / Models / MCP / Skills
                              +
Linguist Vertical Extension
  ├─ Linguist App Mode 与 Shell
  ├─ CAT Project / Asset / Segment
  ├─ Project Intake
  ├─ TM / TB / Context / Project Memory
  ├─ Translation / Proposal / QA / Review / Audit
  ├─ 游戏本地化 Prompt Contract
  └─ Coverage / Provenance / Recovery
```

## 1.2 不可动摇的十三项原则

### P-01：Proma 是唯一 Agent 平台基座

不得复制第二套：

- Agent Loop
- Session Store
- Composer
- Messages / Thinking / Tool Card
- Permission / AskUser
- Queue / Steer
- Model selector
- SidePanel / Preview / References
- Runtime adapter

### P-02：Linguist 是“基础能力继承 + 专业叠加”，不是基础能力替换

正确组合：

```text
Proma 当前完整能力
+ Proma 未来新增 OCR / Excel / PDF / Browser / File / MCP / Model 能力
+ Linguist CAT Tools
+ Linguist Prompt / Context / Project Scope
```

禁止在 Linguist 侧维护一份静态 Proma 工具白名单；否则上游新增能力不会自动进入 LA。

### P-03：保留完整自主性和 `bypassPermissions`

本计划不实施 CAT-only 沙箱，不禁止 Bash、Read、Write、Edit、MCP 或未来 Proma 工具。

风险治理采用：

```text
明确项目执行范围
+ 结构化 CAT 写入
+ Run Summary
+ Provenance
+ 可恢复变更
+ 诚实显示不可自动撤销的副作用
```

而不是削弱 Agent。

### P-04：标准 CAT 成果走结构化工作流

通用工具负责扩大能力：OCR、Excel、脚本、搜索、文档提取、批量分析。

正式本地化成果尽量通过结构化工具进入：

- Asset / TM / TB / Context Import
- Proposal
- QA Finding
- Review Artifact
- Audit Report
- Export / Delivery Check

Proposal 的含义是“Agent 当前认为应进入正式译文的最佳版本，等待人工确认”，不是低质量草稿。

### P-05：零预支质量

> **任何翻译、审校、复核或审核流程，都必须把自己当成缺陷进入交付前的最后一道防线。后续还有其他模型或人工，只能是纵深防御，不能成为本轮降低标准的理由。**

### P-06：取消质量意义上的 Fast / Balanced / Best

所有任务只有一个质量目标：**专业、可交付、当前证据下的最佳结果**。

资源和成本由这些变量控制：

- 模型
- 模型原生 reasoning effort
- 是否启用独立二审
- 是否允许外部研究
- 并发度与批次大小
- 时间 / Token 预算

它们叫 `Execution Policy`，不得被包装成不同质量承诺。

### P-07：完整审校必须覆盖声明范围，而不是只看 Proposal

现有 candidate-only Reviewer 改名为 `Proposal Critic`。

任何 Full-Scope Reviewer 都不得把“有 Proposal 的 Segment”当作审查范围。Scope 由 Asset/Segment manifest 决定；无 Proposal、未改动、看似流畅都不能成为跳过理由。

新增真正的 `Full-Scope Reviewer / Editor`：检查完整 Source、当前 Target、上下文和所有 Proposal，包括没有 Proposal 的 Segment。

### P-08：LA 相比 Web Chat 的优势必须可证明

LA 不能只靠更长角色提示词证明价值。真正优势必须来自：

- 完整项目范围
- 项目记忆与动态上下文检索
- TM / TB / Style / Entity / Voice
- 确定性 QA
- Coverage Ledger
- Translate → Estimate → Refine 闭环
- Source-first 审校
- Proposal / Revision / Diff / Provenance
- 大任务恢复和不漏段

### P-09：暂不向 Proma 官方做任何贡献

本阶段所有通用扩展缝、宿主重构、同步脚本和测试都只在 LA 仓库实现。

待作者本人长期实际使用稳定后，再单独评估哪些通用改造适合整理成对 Proma 的贡献。当前实施 Agent：

- 不得创建 Proma Issue；
- 不得创建 Proma PR；
- 不得修改 Proma 官方仓库；
- 不得为“未来上游合并”牺牲当前 LA 可用性。

### P-10：上游更新默认继承，LA 偏离必须显式登记

任何隐藏、禁用、复制或重写 Proma 通用功能的行为都是例外，必须登记在 `PROMA_DEVIATIONS.md`，并在每次同步时重新评估。

### P-11：Tag 由结构、规则与 LLM 协作识别，但只由统一 Tag Model 执行

Tag 处理不允许继续分裂成“Core 一套正则、编辑器另一条固定正则、导出再单独猜测”。统一优先级：

```text
Native format inline code
→ Approved project tag profile
→ Built-in placeholder/tag profile
→ Deterministic suspicious-pattern discovery
→ LLM profile proposal
→ Strict validator
→ Candidate / Approved lifecycle
```

LLM 用于发现和解释未知模式，不直接绕过验证把任意字符串永久锁死。

### P-12：旧 LA 能力只做一次有边界的审计，不进行无限回填

旧 LA 不是功能清单真理。一次性对照后，每项只允许进入四类：

```text
A. 正确性必需：不做会破坏真实交付或数据
B. 真实高频价值：已有工作样本证明
C. 已被新架构/Proma 覆盖：不迁
D. 推测性或过度复杂：明确放弃/延后
```

Phrase master-XLIFF rehydration 属于 A 类；LLM Tag Discovery 属于 B 类高价值，但须在 PB-097 现有引擎上续建，禁止重复实现。

### P-13：先形成可日用闭环，再扩展长尾能力

完成 Proma 同步、Host 断点、Project Intake 最小闭环、质量 Prompt/Harness 和当前真实格式阻断后，必须进入真实使用 Gate。不得因为又发现一个旧功能而无限推迟日用。

---

# 2. 当前事实与实施前强制核验

## 2.1 已经完成、不得重复重写的能力

根据当前公开代码和此前交付记录，下列方向已经落地，实施者应先验证，而不是重新开发：

- Proma Base + Linguist Tool Overlay；
- Linguist Rail / Full 共用同一个 `AgentView`；
- Linguist Session 绑定项目和角色；
- Linguist 项目专属执行目录；
- Linguist Sidebar 与 Session 管理的基础闭环；
- CAT Core / Formats / Store / Tools 分包；
- Proposal、CAS、Locked、Revision；
- QA Finding / Occurrence / Status Event 的改造基础；
- Proposal Content / Issuance / Provenance；
- Reviewer Proposal Snapshot 和 `pass / issues / abstain`；
- Durable Project Event Outbox；
- Run Summary 与部分结构化 Undo；
- Worker / Job 的初步框架；
- Stable ID、数据库身份、Backup / Restore、Integrity / Export 基础；
- Prompt Stack v2 的 Profile / Role / Strategy / Project Digest / Turn Context 分层。

本计划是在上述基础上收口，不是再次推倒重来。

## 2.2 当前公开基线与上游事实

截至 2026-08-04，可由公开官方页面确认：

- Proma 最新稳定 Release 为 `v0.16.8`，tag commit `bde00f0`，发布于 2026-08-03；
- 从 Proma `v0.16.1` 到 `v0.16.8`：34 commits、132 files changed；
- 从 LA 公开登记的 Proma 基线 `702a8221...` 到 `v0.16.8`：77 commits、274 files changed；
- Proma `v0.16.8` 的 Electron App 版本为 `0.16.8`，Electron `^43.2.0`，Pi `0.82.1`，Claude Agent SDK `0.3.201`，并引入/打包 `sharp`；
- 当前公开 LA `UPSTREAM_BASELINE.md` 仍登记 `702a8221...` / `v0.15.11-1-g702a8221`；
- 当前公开 LA README 仍描述 Fast / Balanced / Best Strategy，这一质量语义由本计划废弃；
- 当前公开 LA 已确立“Proma 完整通用能力 + Linguist CAT 层”的产品路线，但本地最新 Worktree 可能已领先公开状态，必须以本地事实为准。

Proma v0.16.1—v0.16.8 与 LA 最相关的新增能力：

```text
v0.16.1
  Settings Workspace、统一 / 菜单、文件面板、本地文件夹项目、
  Pi compaction 续跑、网络重试、运行中切模型、Stop 修复

v0.16.3
  文件面板恢复双来源、Composer @ / & / ～ 引用回归并完善

v0.16.5
  Agent Island、系统/面板拖拽文件与文件夹引用、语音输入反馈、
  标题生成加固与 OAuth 标题并行生成

v0.16.7
  Grok OAuth、渠道额度、Windows Clipboard/Island 修复

v0.16.8
  Vision Relay、外部普通文件拖入转 @file、Pi 上下文溢出恢复、
  sharp 生产打包、OAuth 代理、模型输出上限判定修复
```

企业版 Skills 分发属于上游商业能力：LA 不复制、不伪造、不作为当前个人 Alpha 的实施目标。

## 2.3 实施 Agent 的第一项输出：`CURRENT_FACTS.md`

在改任何生产代码前，必须在本地仓库生成一次事实报告：

```text
当前日期
当前 branch / HEAD
origin / upstream URL
工作区是否干净
未提交文件清单
当前 LA 版本
当前 Proma baseline
当前 Electron / Pi / Claude SDK / Bun 版本
main 相对 upstream v0.16.8 的 ahead / behind
从当前真实 merge-base 到 v0.16.8 的 commits/files changed
真实双边改动文件数
真实 Git 冲突文件数
当前全部测试结果
当前打包 smoke 结果
当前用户数据根与项目数据库 schema
PB-097 Tag Profile 引擎的真实实现与调用点
编辑器 Tag 保护是否复用同一 Scanner
LLM Tag Discovery / Candidate lifecycle 是否存在
Phrase master-XLIFF rehydration 是否存在
旧 LA 源码/迁移矩阵的可访问位置
当前格式 Detect / Import / Export / Round-trip 矩阵
```

Kimi 或任何外部分析中的“72 个重叠文件”“约 10 个硬冲突”等数字只可作为提示，不得作为事实源。实施者必须基于当前本地 Worktree 重算。

## 2.4 数据保护前置条件

同步和迁移前必须：

1. 提交或 stash 所有未提交改动；
2. 创建 `pre-proma-0.16.8-sync` tag；
3. 备份：
   - `~/.linguist-agent/`
   - `~/.linguist-agent-dev/`
   - 当前所有 `linguist/` CAT 项目目录；
4. 对备份生成 manifest 和 hash；
5. 后续 migration / smoke 只使用副本，禁止首先在唯一真实项目上验证。

---

# 3. 目标架构：Proma 薄分叉 + 本地内置 Linguist Extension

## 3.1 不是运行时插件平台

本计划不建设可下载、动态安装的第三方插件 ABI，也不把 Linguist 拆成另一款应用。

推荐形态：

```text
Proma Upstream Code
  ├─ Agent / Chat / Session / Models / Tools / SidePanel / Settings
  └─ Local Host Contracts（只在 LA fork 内）
          ↓ compile-time registration
Linguist Built-in Extension
  ├─ App Mode contribution
  ├─ Agent Profile contribution
  ├─ Agent Surface host contribution
  ├─ Settings contribution
  ├─ IPC module contribution
  ├─ File source / command contribution
  └─ Project Intake / Workbench
          ↓
packages/linguist-*
```

物理目录可逐步收敛为：

```text
apps/electron/src/extensions/linguist/
  extension.ts
  main/
  renderer/
  shared/
  tests/

packages/
  linguist-cat-core/
  linguist-cat-formats/
  linguist-cat-store/
  linguist-cat-tools/
  linguist-prompts/          # 可选，新 Prompt Contract 稳定后再拆
  linguist-evals/            # 可选，评估数据结构与 runner
```

立即搬目录不是目标。先建立依赖方向和注册缝，再按触点自然迁移。

## 3.2 最小本地扩展合同

建议新增本地 Host Contract：

```ts
interface PromaExtension {
  id: string;
  appModes?: AppModeContribution[];
  agentProfiles?: AgentProfileContribution[];
  settingsSections?: SettingsContribution[];
  ipcModules?: IpcModuleContribution[];
  fileSources?: FileSourceContribution[];
  commands?: CommandContribution[];
}
```

Linguist 在 Composition Root 注册：

```ts
registerExtensions([
  linguistExtension,
]);
```

### Agent Profile Contribution

```ts
interface AgentProfileContribution {
  id: string;

  decodeProfile(metadata: unknown): AgentProfile | null;

  contributeTools(
    context: AgentRunContext,
    baseTools: readonly AgentTool[],
  ): Promise<readonly AgentTool[]>;

  contributePromptLayers(
    context: AgentRunContext,
  ): Promise<readonly PromptLayer[]>;

  contributeSkills(
    context: AgentRunContext,
  ): Promise<readonly SkillReference[]>;

  resolveExecutionScope(
    context: AgentRunContext,
  ): Promise<ExecutionScope | null>;

  beforeRun?(context: AgentRunContext): Promise<void>;
  afterRun?(result: AgentRunResult): Promise<void>;
}
```

核心要求：`baseTools` 必须来自 Proma 当前标准 Tool Builder；Linguist 只能追加，不得复制 Proma 工具清单。

### App Mode Contribution

```ts
interface AppModeContribution {
  id: string;
  label: string;
  icon: React.ReactNode;
  renderSidebar(): React.ReactNode;
  renderMain(): React.ReactNode;
  restoreNavigationState?(): void;
}
```

### Agent Surface Context

```ts
interface AgentSurfaceContextValue {
  sessionId: string;
  presentation: 'page' | 'linguist-rail' | 'linguist-full';
  hostCapabilities: {
    references: boolean;
    companionChat: boolean;
    filePanel: boolean;
    preview: boolean;
    slashMenu: boolean;
    modelControls: boolean;
  };
}
```

凡组件已经获得显式 `sessionId`，不得再通过全局 `currentAgentSessionIdAtom` 猜测会话。

### IPC Module Contribution

不要立即开放任意 Channel。建议：

```ts
interface IpcModuleContribution {
  namespace: string;
  commands: Readonly<Record<string, ValidatedIpcCommand>>;
}
```

Preload 只暴露一次受验证的 namespaced bridge，Command 必须在注册表中、输入输出都经过 Runtime Schema。

## 3.3 Proma Core 的所有权规则

每次冲突按领域处理：

- Agent Runtime、Session lifecycle、Retry、Compaction、Model switching、Stop：**上游实现优先**；Linguist 通过 Agent Profile 叠加。
- AgentView、Composer、Messages、SidePanel、References、File Panel：**上游组件优先**；Linguist 只提供 Host Context / Presentation。
- Settings：采用上游 Settings Workspace；Linguist 贡献 Section。
- LeftSidebar：上游拥有 Shell 和共享 Session Item；Linguist 贡献 Mode Sidebar 内容。
- CAT Project、Store、Proposal、QA、Review、Intake：Linguist 拥有。
- Branding、App ID、User data root：LA 产品分叉拥有，登记为永久 deviation。

---
# 4. 总实施顺序与里程碑

必须按依赖关系执行。除非 Ticket 明确标记可并行，否则不得跳阶段。

| 阶段 | 目标 | 退出条件 |
|---|---|---|
| Phase 0 | 同步 Proma v0.16.8，并收窄宿主分叉 | v0.16.8 新能力在 Agent 与 LA Host 可用；测试、打包、旧数据 smoke 通过；基线重置 |
| Phase 1 | 修复真实 UI 断点和 Session/Surface 等价性 | 引用、右侧问答、标题、@file、Vision Relay、File Panel、Slash、Stop、模型控制在 LA Rail/Full 可用 |
| Phase 2 | 建立 Project Intake，并开放 Agent 导入 | Agent 能扫描、规划、导入、验证当前已支持的 Asset/TM/TB/Context |
| Phase 2B | 统一 Tag Intelligence 与 Phrase 恢复 | PB-097 不重复实现；未知 Tag 可发现/审批；编辑器原子保护；Phrase master 配对和 round-trip 可验证 |
| Phase 3 | 重构质量、Prompt、翻译和完整审校 Harness | 统一专业质量合同；取消质量档位；Full-Scope Review 和 Coverage Ledger 可用 |
| Phase 4 | 修复规则、Context、Runtime 和数据正确性 | 已知 P0/P1 逻辑错误有回归测试，Prompt/Context 契约稳定 |
| Phase 5 | 真正分块、可恢复、可扩展 | 10k/50k 段任务不全量占用 Main；Job 可恢复、可取消、无重复副作用 |
| Phase 6 | 证明 LA 比 Web Chat 更强并进入日用 | 同模型盲测稳定优于 Web Chat；完成真实项目和 14 天日用 Gate |
| Phase 7 | 建立 LA 仓库内上游同步自动化 | 新 Proma stable tag 自动开同步 PR、生成影响报告、跑完整 Gate；不自动发布 |

---

# 5. Phase 0：同步 Proma v0.16.8 与本地宿主收敛

## 5.1 目标

本阶段不是“把版本号追到最新”，而是完成一次可重复的上游收敛：

1. 将 Proma `v0.16.8` 的全部开源通用能力纳入 LA；
2. 保留标准 Git fork 的共同祖先和完整 merge history；
3. 以上游 Runtime、Agent Surface、Composer、Settings、File/Reference 为唯一基础实现；
4. 通过 LA 仓库内的窄 Host Contract 恢复 Linguist Overlay；
5. 验证 Vision Relay、`@file` 拖入、标题生成、Pi 恢复等新增能力在 LA 中不是“有按钮、没宿主”；
6. 重置 baseline、touchpoint 和 deviation；
7. 为下一次快速更新建立自动化，但不未经验证自动发布。

## 5.2 Git 与数据保护策略

实施前：

```bash
git status --short
git remote -v
git fetch upstream --tags
# 提交或 stash 所有真实改动
git tag pre-proma-0.16.8-sync-<date>
git switch -c sync/proma-v0.16.8
git merge --no-ff v0.16.8
```

硬要求：

- 一次正式 merge；
- 不逐提交 cherry-pick 77 个提交；
- 不 rebase 已公开 main；
- 不通过复制新文件“伪装同步”；
- 冲突可按子系统提交，但最终保留清晰 merge 关系；
- 使用副本验证 CAT 数据，禁止把唯一真实项目作为迁移试验品。

备份：

```text
~/.linguist-agent/
~/.linguist-agent-dev/
所有 managed CAT project
当前安装 App 与 app.asar（用于回退和 diff）
```

每份备份必须有 manifest、schema 版本和 hash。

## 5.3 合并顺序与所有权

### 0A：运行环境、依赖和打包

采用上游：

- Electron `43.2.0`；
- Pi `0.82.1`；
- Claude Agent SDK `0.3.201`（只保留上游仍支持的程度）；
- `sharp`、Vision Relay runtime deps；
- Agent Island native build；
- upstream `sync:runtime-deps` 和外部依赖规则。

恢复 LA：

- branding / productName / appId；
- `~/.linguist-agent(-dev)` 数据根；
- linguist workspace packages；
- CAT worker / sqlite / resources / format fixtures；
- license/SBOM/NOTICE。

禁止手工拼 `bun.lock`。根据最终 package manifest 重新生成，并以 frozen install 验证。

### 0B：Agent Runtime、Pi 与 Session

上游优先：

- compaction 与 context overflow recovery；
- 网络/流式错误 retry；
- Stop、Queue、Steer、delegation；
- 运行中预选模型与 reasoning；
- Vision Relay；
- OAuth / proxy / output token family 判断；
- title generation pipeline。

Linguist 只通过 Agent Profile 叠加：

```text
Project binding
Execution scope/CWD
Prompt layers
CAT tools
Run summary/provenance hooks
```

禁止把旧 LA orchestrator 大块压回上游新版。

### 0C：Composer、References、Files、Agent Surface

必须以上游 v0.16.8 的完整 AgentView/Composer 为基线，保留：

- `/` 命令；
- `@` 文件；
- `&` Session；
- Todo/Calendar mention；
- 系统文件与文件夹拖拽；
- 外部普通文件复制到会话私有目录后转 `@file`；
- 路径含空格的编码与展示；
- File Panel 双来源；
-附件 fallback；
- queue/auto-send/retry 中的引用一致性；
- Vision Relay 图片链路。

Linguist 只允许新增显式 `sessionId`、`presentation`、Host capability 和 context chip/slot。

### 0D：Sidebar、Session Row 与 Agent Island

采用上游共享 Session Item、pin/archive/delete/preview、状态同步。

Linguist 只贡献：

- CAT Project → bound sessions 投影；
- Project row menu；
- 当前项目会话选择；
- Linguist badge/context；
- Agent Island 中对 Linguist Session 的可识别状态（仅在上游该能力启用的平台）。

不得为了 Agent Island 复制第二套会话状态机。macOS 26 前上游禁用时，LA 跟随上游，不自行强开。

### 0E：Settings 与模型/渠道

直接采用上游 Settings Workspace、Grok OAuth、渠道配置和 reasoning controls。

Linguist 只贡献 Section：

```text
Project defaults
Prompt/quality contract version
Intake defaults
Tag profiles
Privacy / diagnostics
```

企业 Skills 分发不属于开源个人版目标，不做假入口。

### 0F：IPC / Preload / File Source

先完成 merge，再建立本地 `IpcModuleContribution` 和 `FileSourceContribution`。Project Intake、Tag Discovery 等新能力必须使用 namespaced validated module，不再向中心 IPC 无限追加。

## 5.4 v0.16.1—v0.16.8 功能继承矩阵

| 上游能力 | 普通 Agent | LA Rail | LA Full | 实施要求 |
|---|---:|---:|---:|---|
| Pi compaction / overflow 续跑 | 必须 | 必须 | 必须 | 同一 Runtime；长翻译 Job 回归 |
| 网络/流式自动恢复 | 必须 | 必须 | 必须 | mutation 幂等；不复制 retry |
| 运行中切换模型/reasoning | 必须 | 必须 | 必须 | Session policy 与 UI 真源一致 |
| Stop / Queue / Steer | 必须 | 必须 | 必须 | Rail 不能丢 Stop |
| `/` 统一菜单 | 必须 | 必须 | 必须 | Skill/MCP/File/Folder/Session 全继承 |
| `@` 文件与文件夹引用 | 必须 | 必须 | 必须 | 显式 Session scope |
| 外部拖入普通文件 → `@file` | 必须 | 必须 | 必须 | LA 私有 CWD、空格路径、retry 全链路 |
| File Panel 双来源 | 必须 | 自动展开/入口 | 必须 | 可贡献 CAT managed source，不复制面板 |
| Vision Relay | 必须 | 必须 | 必须 | 图片/扫描参考资料；打包含 sharp |
| 自动标题加固 | 必须 | 必须 | 必须 | 优先复用上游 Title pipeline；只加 Linguist context/fallback |
| Agent Island | 上游支持平台 | 同一状态源 | 同一状态源 | 不阻断核心日用；不得复制状态机 |
| Grok OAuth / 新渠道 | 必须 | 必须 | 必须 | LA 不维护模型白名单 |
| Settings Workspace | 必须 | 同一入口 | 同一入口 | Linguist Section contribution |
| Voice input | 必须 | 必须 | 必须 | Composer parity，非 CAT 专属实现 |
| Scratch/Todo 修复 | 自动继承 | 不阻断 | 不阻断 | 无 Linguist 专属工作 |

## 5.5 自动标题策略因 v0.16.5 调整

旧蓝图要求新建独立 `SessionTitleService`。v0.16.5 已加固多个 Agent 渠道的标题生成，因此新原则是：

1. 先识别并复用 Proma 当前统一 title pipeline；
2. 修复其对 Linguist bound session 的触发条件；
3. 给标题请求补充极短的 Linguist context（project name 仅作为背景，不强制重复）；
4. 用户手动命名后永不覆盖；
5. 上游标题失败时才使用本地第一条 Prompt fallback；
6. 不维护第二套模型请求、重试和 provider adapter。

## 5.6 Claude 与 Adapter

- 若 v0.16.8 仍保留 Claude Runtime，完整 CAT Toolset 必须能初始化；根级 Union Schema 修复仍保留。
- 若上游隐藏/移除 Claude，不通过 LA 旧 flag 强行暴露。
- Provenance 记录实际 Runtime/SDK/tool overlay；不要把不完全枚举的 native tools 宣称成完整 hash。

## 5.7 Baseline 重置

合并完成后：

1. 归档旧 `UPSTREAM_BASELINE.md` 和 `PROMA_CORE_TOUCHPOINTS.md` 快照；
2. 新基线：Proma `0.16.8` / `bde00f0...`；
3. 重新计算 LA 相对新基线的实际 Patch Set；
4. 删除被上游吸收的条目；
5. 分类：Permanent Product Fork / Local Host Seam / Linguist Extension / Temporary Deviation；
6. 新建/更新 `PROMA_DEVIATIONS.md` 与机读 JSON；
7. About/Diagnostics 显示 LA version、Proma Base、commit、CAT schema、Prompt contract、Host contract；
8. Touchpoint 数量建立预算：新增触点必须说明为什么现有 seam 不足。

## 5.8 Phase 0 Gate

自动：

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
bun run electron:build
cd apps/electron && bun run smoke:pack
cd apps/electron && bun run smoke:vertical
```

打包 App 手动验证：

- 旧 Session / Settings / CAT Project 加载；
- sqlite、Worker、backup/restore/export；
- Pi compaction 与 overflow 继续；
- Vision Relay 真图片；
- 外部文件拖入转 `@file`，含空格路径；
- queue、auto-send、retry 后引用仍正确；
- Stop、模型/reasoning 切换；
- LA Rail/Full 不丢任何上述能力；
- `sharp`、Agent Island native resource 和 ASAR 打包没有缺失；
- userData 不与 Proma 混用。

只有 Phase 0 全绿，才允许继续大规模 Linguist 功能改造。

---
# 6. Phase 1：Embedded Agent Host 等价性与用户可见断点

## 6.1 核心不变量

> Proma Agent 新增的通用能力，默认必须在普通 Agent、LA Rail 和 LA Full 三个宿主形态中成立。

“组件出现”不等于“能力接入”。所有能力必须具备正确 Session Scope、对应 Host 和可见反馈。

## 6.2 修复“为 Agent 引用”

### 根因模型

引用 Map 已按 `sessionId` 保存，但 Composer 显示可能依赖全局 `currentAgentSessionIdAtom`。嵌入式 LA 中：

```text
AgentView 显示 Linguist Session B
全局普通 Agent current session 为 A 或 null
引用写入 B，显示却读取 A
```

### 实施

新增明确的 Session-scoped API：

```ts
quotedSelectionAtomFamily(sessionId)
referenceDraftAtomFamily(sessionId)
```

统一 Agent Reference 数据结构：

```ts
type AgentReference =
  | TextSelectionReference
  | FileReference
  | FolderReference
  | SessionMessageReference
  | CatSegmentReference
  | CatAssetReference
  | ProjectContextReference;
```

要求：

- Composer 以传入的 `sessionId` 读取引用；
- 发送、消费、清除、恢复均使用同一 Session ID；
- 引用 Chip 明确显示来源；
- App 重启后，未发送 Draft 的引用按 Proma 原生策略恢复或明确清除；
- 不在普通 Agent 与 LA 间串引用。

## 6.3 修复“打开右侧问答”

### 目标行为

LA Rail 中选择历史文本并点击“打开右侧问答”：

```text
Rail 自动展开为 Linguist Full
→ 左侧保留当前 Linguist Agent Session
→ 右侧打开同一 Agent 的 Companion Chat
→ 选区以引用 Chip 出现
→ 不切换到普通 Agent Mode
```

### 实施

抽取共享 Host：

```tsx
<AgentCompanionPanelHost
  sessionId={sessionId}
  host="linguist"
/>
```

SidePanel 状态必须 Session-scoped：

```ts
agentCompanionPanelStateAtomFamily(sessionId)
```

不得只设置普通 Agent Shell 的全局 SidePanel 开关。

## 6.4 Agent / Linguist 自动命名（复用 Proma v0.16.5+ 标题管线）

建立共享 `SessionTitleService`：

```ts
type TitleOrigin =
  | 'default'
  | 'project-default'
  | 'first-prompt-fallback'
  | 'generated'
  | 'manual';
```

### 触发规则

- 首个完整 Turn 结束后异步生成一次；
- 输入：第一条用户请求、第一条最终回复、简短 Tool Intent、项目名（背景）；
- 输出 8–24 个中文字符或 3–10 个英文词；
- 不把绝对路径、客户隐私、长文件名直接作为标题；
- 生成失败时使用清理后的第一句；
- 用户手动改名后永不覆盖；
- 菜单提供“重新生成标题”；
- Project 名只做分组，不再作为所有 Session 的永久同名标题。

示例：

```text
项目：示例本地化项目
Session：导入并核验第一批审校资产
Session：第 10 集完整双语审校
Session：整理本批 TM/TB 与角色术语
```

## 6.5 Host Capability Manifest

每种 Agent 宿主显式声明：

```ts
interface AgentHostCapabilities {
  references: boolean;
  companionChat: boolean;
  filePanel: boolean;
  preview: boolean;
  attachments: boolean;
  slashMenu: boolean;
  modelControls: boolean;
  queueAndSteer: boolean;
  permissions: boolean;
}
```

如果 Rail 空间不足，正确策略是自动展开或显示明确入口，不是保留一个无效按钮。

## 6.6 Host Parity 回归矩阵

| 功能 | Agent Page | LA Rail | LA Full |
|---|---:|---:|---:|
| 文本引用 | ✓ | ✓ | ✓ |
| 文件/文件夹引用 | ✓ | ✓ | ✓ |
| 附件 | ✓ | ✓ | ✓ |
| `/` 命令 | ✓ | ✓ | ✓ |
| Side Q&A | ✓ | 自动展开后 ✓ | ✓ |
| File Panel | ✓ | 自动展开/显式入口 | ✓ |
| Preview | ✓ | ✓ | ✓ |
| Stop | ✓ | ✓ | ✓ |
| Queue / Steer | ✓ | ✓ | ✓ |
| 运行中预选模型 | ✓ | ✓ | ✓ |
| Reasoning setting | ✓ | ✓ | ✓ |
| AskUser / Permission | ✓ | ✓ | ✓ |
| Hover Preview | ✓ | ✓ | ✓ |
| Auto-title | ✓ | ✓ | ✓ |

新增 E2E/Component Harness，未来每次 Proma 同步必须运行该矩阵。

## 6.7 Phase 1 Gate

真实打包 App 完成以下场景：

1. 在 LA Rail 引用上一条 Agent 回复，Chip 立即可见，发送后内容正确；
2. 切普通 Agent，再返回 LA，引用不串 Session；
3. 点击右侧问答，LA 保持 Linguist Mode，Companion Chat 可见；
4. 第一个 Turn 后会话自动命名；手动重命名后不再被覆盖；
5. `/`、File Panel、Stop、Model、Reasoning 在 LA Rail/Full 与普通 Agent 一致；
6. 普通 Agent 无回归。

---
# 7. Phase 2：Project Intake——让 LA 从工作目录开始接管项目

## 7.1 当前缺口

Agent 可以读取目录、识别文件、检查已有项目，却没有结构化导入工具，因此会正确地回答：

```text
我能读取现有 Asset / Segment、查询 TM / TB、创建 Proposal、运行 QA，
但当前会话没有新增 Asset / TM / TB / Context 的导入接口。
```

这不是模型问题，而是产品缺少 `Project Intake` 子系统。

## 7.2 目标体验

用户可以说：

```text
导入一下这批资产：
/Users/<local>/Desktop/translation-work/example-project/review-batch
```

Agent 应完成：

```text
1. 扫描目录
2. 判断 Asset / TM / TB / Context / Delivery / Unknown
3. 检查当前项目已导入资源和哈希
4. 识别 exact duplicate、同源不同版本和可能重复内容
5. 生成 Import Plan
6. 自动执行安全、明确的导入项
7. 对冲突项作出保守但不打断的处理：跳过并报告，或仅在必须决定时询问
8. 跟踪 Job 进度和失败
9. 验证导入数量、语言对、Segment、TM/TB 条目和 hash
10. 输出结构化 Run Summary
```

## 7.3 共享 `ProjectIntakeCoordinator`

UI 和 Agent 不得各写一套导入逻辑：

```text
UI Import
Agent Intake Tools
CLI / Future Automation
         ↓
ProjectIntakeCoordinator
         ↓
Format Detection / Parser / Project Service / Store / Jobs
```

建议接口：

```ts
interface ProjectIntakeCoordinator {
  scan(input: ScanImportInput): Promise<ImportCandidateSet>;
  plan(input: PlanImportInput): Promise<ImportPlan>;
  execute(input: ExecuteImportInput): Promise<ImportJob>;
  getJob(jobId: string): Promise<ImportJobSnapshot>;
  cancelJob(jobId: string): Promise<void>;
  verify(jobId: string): Promise<ImportVerificationReport>;
}
```

## 7.4 Agent Intake Tools

### `cat_scan_import_candidates`

输入：

```ts
{
  rootPath: string;
  recursive?: boolean;
  maxDepth?: number;
  includeHidden?: boolean;
}
```

输出：

```ts
{
  scanId: string;
  rootPathDisplayName: string;
  candidates: Array<{
    candidateId: string;
    relativePath: string;
    detectedFormat: string | null;
    role: 'asset' | 'tm' | 'tb' | 'context' | 'delivery' | 'unknown';
    confidence: number;
    size: number;
    sha256: string;
    languageHints: string[];
    duplicateStatus:
      | 'new'
      | 'exact-project-duplicate'
      | 'same-corpus-different-version'
      | 'possible-semantic-duplicate'
      | 'unknown';
    support: 'supported' | 'detect-only' | 'unsupported';
    warnings: string[];
  }>;
}
```

### `cat_plan_project_import`

输入 `scanId + projectId + policy`，输出明确计划：

```ts
{
  planId: string;
  projectSnapshot: string;
  actions: Array<{
    candidateId: string;
    action: 'import' | 'skip' | 'defer' | 'unsupported';
    targetRole: 'asset' | 'tm' | 'tb' | 'context';
    reasonCode: string;
    expectedEffects: {
      assets?: number;
      segments?: number;
      tmEntries?: number;
      termEntries?: number;
      contextDocuments?: number;
    };
  }>;
  ambiguities: Array<{
    candidateIds: string[];
    issue: string;
    recommendedAction: string;
  }>;
}
```

### `cat_execute_project_import`

要求：

- 绑定计划 hash 和项目 event sequence；
- 默认执行 `action=import` 且无冲突项；
- 幂等；
- 产生 durable Import Job；
- 记录 provenance；
- 不通过 Bash 直接改 `cat.db`。

### `cat_get_import_job`

返回阶段、进度、当前文件、错误、可重试项和已提交 checkpoint。

### `cat_cancel_import_job`

取消尚未提交的后续 Chunk；已提交的资源保留并在结果中明确列出。

### `cat_verify_import`

校验：

- 输入文件 hash；
- 实际导入资源；
- Segment/TM/TB/Context 数量；
- 语言对；
- 重复和缺失；
- Parser warnings；
- Project health；
- 可撤销范围。

## 7.5 Candidate Scanner

Scanner 负责：

- 扩展名；
- MIME / magic；
- XML root / namespace；
- ZIP entries；
- SQLite schema（只读取表名和版本，不读取客户文本）；
- OLE stream names；
- 文件大小、mtime、hash；
- 当前项目已有 blob/source hash；
- 相同目录内重复组。

不得只按扩展名判断。

## 7.6 文件角色分类

目录名和文件名只是弱证据：

```text
for review     → 倾向 asset/review source
交付           → 倾向 delivery，默认不重复导入
source         → 倾向 original source，可能与双语文件重复
TMTB           → 倾向 TM/TB
reference      → 倾向 Context
```

最终分类应组合：

- 容器/格式检测；
- 文件内语言对元数据；
- 目录语义；
- 当前项目资源；
- hash / lineage；
- Segment fingerprint；
- 用户当前任务。

## 7.7 Duplicate 与 Lineage

### Exact Duplicate

相同文件 hash 已在项目中：默认跳过，报告已有资源 ID。

### Same Corpus, Different Version

可使用：

- source segment fingerprints；
- external file IDs；
- filename/version hint；
- segment count；
- source hash sequence；
- bilingual pair overlap。

建立：

```ts
interface ImportLineage {
  lineageId: string;
  relation:
    | 'exact-copy'
    | 'revision-of'
    | 'derived-delivery'
    | 'source-of-bilingual'
    | 'unknown-related';
  parentResourceId?: string;
  confidence: number;
  evidence: string[];
}
```

不得因为文件名相似就自动覆盖已有 Asset。

## 7.8 Intake 自动化策略

支持：

```ts
type IntakeExecutionPolicy =
  | 'plan-only'
  | 'auto-safe'
  | 'auto-all-supported';
```

默认推荐 `auto-safe`：

- 新、已支持、语言对明确、无重复冲突：自动导入；
- exact duplicate：自动跳过；
- 同源不同版本：默认不覆盖，导入为新版本或 defer，按项目策略；
- unsupported：不假装成功，列出；
- 真正需要业务判断时才 AskUser。

## 7.9 Import Job 与恢复

状态：

```text
created
scanning
planned
importing
verifying
completed
completed_with_warnings
paused_transient
cancelled
failed_terminal
```

每个文件/Chunk 有稳定幂等键：

```text
projectId + planHash + candidateHash + role + parserVersion
```

崩溃恢复：

- 已提交资源不重复导入；
- 未提交候选从 checkpoint 继续；
- 失败项可单独 retry；
- Project Event / Run Summary 记录完整变更集。

## 7.10 Undo 语义

Import Undo 只对满足条件的资源开放：

- 导入后尚未产生人工编辑、Proposal、QA、Review、Export 等下游引用；
- 删除不会破坏其他资源；
- 事务中清理 Asset / Segment / Resource / Blob 引用。

如果不可安全撤销，UI 明确显示：

```text
本次导入不可一键完全撤销，原因：已有 12 条 Proposal 引用该 Asset。
```

## 7.11 当前格式支持的第一步

先把项目已经支持的格式通过 Intake 正式开放，不要等新 Adapter：

### Asset / Bilingual

- XLIFF
- SDLXLIFF
- Phrase / Memsource MXLIFF
- Phrase bilingual DOCX
- CSV
- JSON
- XLSX

### TM

- TMX
- CSV

### TB

- TBX
- CSV

### Context

- 当前项目已经支持解析/保存的 DOCX、PDF、TXT、Markdown、表格和图片/OCR 等，实际列表由实施者核对 Project Resource Parser 与 Proma v0.16.8 文件能力后确定；
- 对图片或扫描资料优先复用 Vision Relay / Proma 文件能力做理解和候选抽取，但正式导入仍进入 Context Resource 与 provenance；
- Vision Relay 输出不能直接伪装为原文事实，必须保留来源文件、页/图引用、模型和置信度。

## 7.12 本地 CAT Corpus Scanner

实施者必须扫描：

```text
/Users/<local>/Desktop/translation-work
```

新增脚本：

```bash
bun scripts/scan-cat-corpus.ts \
  "/Users/<local>/Desktop/translation-work"
```

### 隐私要求

默认只输出：

- 扩展名；
- 数量和大小分布；
- magic/MIME；
- XML root/namespace；
- ZIP entry 名；
- SQLite 表名；
- OLE stream 名；
- hash 重复组；
- detect/import/export/roundtrip 支持状态。

不得：

- 打印客户正文；
- 上传文件或内容；
- 将客户文件名和目录结构提交到公开仓库；
- 将扫描报告提交 Git。

输出存到 gitignored 的：

```text
.local/reports/cat-corpus-scan-<date>.json
.local/reports/cat-format-matrix-<date>.md
```

需要深入分析某个格式时，只选最小样本并先复制到临时私有目录；公开测试必须使用合成 fixture。

## 7.13 新格式优先级

扫描后按真实频率和业务价值排序，不按网上“常见格式列表”臆测。

推荐顺序：

1. 当前已支持格式的 Agent Intake；
2. 用户目录中高频、当前阻断工作的 TM/TB 格式，例如实际出现的 `.sdltm` / `.sdltb`；
3. 用户目录中高频的其他 CAT 双语格式；
4. 游戏本地化常见源格式，如 PO、RESX、ARB、YAML、字幕等，仅在真实项目出现后实现；
5. 低频专有格式采用转换器/外部工具适配，而非立即自写完整 Parser。

每个 Adapter 的完成标准：

```text
Detect
→ Parse
→ Preserve technical structure
→ Import
→ Export / Round-trip（若格式要求）
→ Synthetic fixture
→ Corruption / encoding tests
→ Versioned adapter metadata
```

## 7.14 Phase 2 Gate

在真实副本项目中，用户只发一句路径指令，Agent 能：

- 识别已有 SDLXLIFF exact duplicate；
- 避免重复导入 delivery 版本；
- 导入当前支持的 TM/TB/Context；
- 对不支持的 SDLTM/SDLTB 给出明确格式状态，而不是模糊说权限不足；
- 完成 Import Job、Verification 和 Run Summary；
- App 重启后 Job 状态和结果仍可追踪。

---
# 7B. Phase 2B：Tag Intelligence、编辑器原子保护与 Phrase master-XLIFF 恢复

## 7B.1 本阶段的定位

本阶段不是“再加一堆 Tag 功能”，而是收回一个会直接决定 CAT 可交付性的基础能力：

```text
识别正确的结构
→ 在编辑器中不可被无意破坏
→ 翻译/审校/QA 使用同一事实
→ 导出恢复原平台需要的真实 inline code
```

传统 CAT 的稳定链路通常是：格式解析器提供 native inline code，Regex Tagger 处理客户自定义模式，编辑器使用原子 Tag Token，QA/导出再次验证。LA 应采用同样的分层，只把 LLM 放在“未知模式发现与解释”层，而不是让 LLM 直接决定所有锁定。

## 7B.2 先确认 PB-097 的真实状态

实施者必须在 `CURRENT_FACTS.md` 给出：

- `Tag profile 正则执行/识别引擎` 的入口、数据结构和测试；
- built-in profile、自定义 project profile、pair/nesting/signature、ReDoS 校验是否存在；
- 哪些模块实际调用该引擎：Proposal gate、QA、Reviewer、Editor、Export；
- 编辑器是否仍用单独固定 `PROTECTED_TOKEN_PATTERN`；
- `LLM discovery`、Candidate lifecycle 是否存在；
- 旧 `tag_rule_discovery.ts` 或等价代码是否仍可访问。

已存在的 PB-097 执行引擎禁止重复实现。新工作只补：统一调用、自动 discovery、候选审批和原子编辑。

## 7B.3 统一 Tag Object Model

新增/收敛纯领域模型：

```ts
type TagTrustLevel =
  | 'native-format'
  | 'approved-profile'
  | 'builtin-profile'
  | 'candidate-high'
  | 'candidate-low';

interface TagToken {
  tokenId: string;
  familyId: string;
  source: string;
  raw: string;
  normalizedSignature: string;
  span: { start: number; end: number };
  kind: 'opening' | 'closing' | 'empty' | 'placeholder';
  pairKey?: string;
  required: boolean;
  movable: boolean;
  copyable: boolean;
  deletable: boolean;
  trust: TagTrustLevel;
  originRef?: string;
}
```

同一 `TagScanner` 必须驱动：

```text
编辑器渲染
Proposal hard rule
QA
Full-Scope Reviewer evidence
Consistency
Export / round-trip
```

禁止编辑器维护另一套不认识项目 Profile 的 regex。

## 7B.4 信任优先级

### Level 1：Native Format Tags

来自 XLIFF/SDLXLIFF/MXLIFF 等 Adapter 的结构化 inline code。最高可信度，直接原子保护；保留原始 ID、pair、data ref、canCopy/canDelete/canReorder 等可用信息。

### Level 2：Approved Project Profiles

用户批准或从可信旧项目迁移的 Profile。直接保护并进入硬规则。

### Level 3：Built-in Profiles

printf、ICU、Mustache、`${...}`、XML/HTML、常见游戏 Token 等。按 Asset 的 Placeholder Profile 启用，避免万能正则。

### Level 4：Discovery Candidates

确定性扫描和 LLM 提议形成的候选。未批准前：

- 可在编辑器显示“疑似 Tag”；
- 默认不成为不可豁免的项目硬规则；
- 高置信且明显技术型 Token 可临时阻止无意删除，但必须允许一键取消；
- 不能自动改写历史译文。

## 7B.5 Deterministic Discovery

先不用 LLM，扫描整个项目/Asset：

- 重复 delimiter shape；
- opening/closing 对称；
- source 中高频出现、目标中高保留；
- 内部包含稳定 key、数字或参数；
- 与普通自然语言的边界；
- 位置与上下文分布；
- 现有 Target 中的守恒率；
- 与 native/built-in Profile 的重叠。

输出 candidate group，而不是直接生成 regex：

```ts
interface TagPatternCandidate {
  candidateId: string;
  examples: CandidateExample[];
  positiveCount: number;
  negativeCounterExamples: CandidateExample[];
  shapeSignature: string;
  suggestedKind?: TagToken['kind'];
  deterministicScore: number;
  status: 'new' | 'proposed' | 'approved' | 'rejected' | 'disabled';
}
```

## 7B.6 LLM Tag Profile Discovery

LLM 接收经过脱敏和数量限制的候选证据，输出结构化提议：

```ts
interface TagProfileProposal {
  candidateId: string;
  explanation: string;
  regexSource: string;
  flags: string;
  openingCapture?: number;
  closingCapture?: number;
  pairKeyCapture?: number;
  variableCaptures: number[];
  suggestedRequired: boolean;
  confidence: number;
  knownFalsePositiveRisks: string[];
}
```

Prompt 核心约束：

- 任务是提出可验证规则，不是直接批准；
- 必须说明哪些部分是文字、哪些是变量；
- 必须给反例；
- 不得用宽泛 `.*` 吞掉自然语言；
- 不得输出可灾难回溯的正则；
- 不确定就 abstain。

LLM 可以使用 Proma 的最新模型与 reasoning，但结果必须进入严格 Validator。

## 7B.7 Strict Validator

每条 Proposal 必须经过：

1. 正则编译和 ReDoS/复杂度检查；
2. 禁止空匹配、零宽无限循环；
3. 正例覆盖率；
4. 反例误报率；
5. 与已批准 Profile 重叠；
6. 全项目 dry-run；
7. source/target 守恒模拟；
8. pair/nesting 回放；
9. 最大输入性能；
10. 用户可读样本预览。

只有 Validator 通过才可进入 `candidate-high`，用户批准后才成为 active project profile。

## 7B.8 Candidate UI 与生命周期

项目设置或 Intake Review 增加：

```text
疑似 Tag 模式
├─ 证据数量
├─ 正例/反例
├─ 建议显示方式
├─ Regex 与风险
├─ 在当前项目命中的 Segment
└─ [批准] [编辑规则] [拒绝] [稍后]
```

状态持久化并记录：

- creator：deterministic / model / user；
- model/prompt hash；
- validator version；
- approvedBy/At；
- profile version；
- disabled reason。

旧 Candidate 不随扫描重跑自动复活；新的证据形成新的 occurrence/version。

## 7B.9 编辑器原子 Tag 保护

当前若仍是纯 textarea + 保存前比较，不足以替代传统 CAT 的 Tag lock。

目标：

```text
正文文本 | [TAG CHIP] | 正文文本 | [PLACEHOLDER CHIP]
```

要求：

- 光标不能进入原子 Token 内部；
- Backspace/Delete 只能整体选择，删除 required tag 时阻止或明确确认；
- 支持从 Source 复制/插入缺失 Tag；
- pair tag 可显示关联；
- 粘贴、IME、undo/redo、selection、键盘导航稳定；
- candidate tag 有不同视觉和一键取消；
- 屏幕阅读器有可读 label；
- 序列化回纯文本保持 byte/token 一致。

实施策略：先做独立 `TagAwareEditorModel` 和序列化测试，再决定使用 Tiptap/ContentEditable 或现有编辑器的 token overlay。不得在没有 IME/undo 设计的情况下直接把 textarea 替换成复杂富文本。

最小过渡版：

1. 编辑器使用统一 TagScanner；
2. Tag span 只读 overlay；
3. 编辑操作映射到 text spans；
4. 保存前仍有硬验证；
5. 真正富文本原子节点在测试通过后启用。

## 7B.10 Phrase master-XLIFF Rehydration

这是格式正确性必需项，不是普通增强。

### 目标

对 Phrase 分拆 MXLIFF 中的 `{1}`、`{2}` 等占位引用：

```text
识别 split 文件
→ 找到可信 master XLIFF/MXLIFF
→ 建立文件与 trans-unit/segment 配对
→ 恢复真实 inline code object
→ 编辑/QA 使用真实 Tag signature
→ 导出时重建平台可重新导入的文件
→ round-trip 重新解析验证
```

### 配对证据

按可信度：

1. 格式内显式 master reference；
2. project/package manifest；
3. stable document/trans-unit IDs；
4. source hash / segment order / tag signature；
5. 文件名只作为低可信提示。

不得仅凭同目录和相似文件名自动配对。

### 映射模型

```ts
interface PhraseMasterBinding {
  bindingId: string;
  splitAssetId: string;
  masterFileDigest: string;
  strategyVersion: string;
  confidence: number;
  verified: boolean;
}

interface PhraseTagRehydrationMap {
  segmentStableId: string;
  placeholderOrdinal: number;
  masterInlineCodeId: string;
  rawMasterFragmentRef: string;
  sourceSignature: string;
}
```

### 阻断条件

- master 不唯一；
- segment 身份无法稳定配对；
- placeholder 数量或顺序不匹配；
- source signature 与 master 冲突；
- target 引用缺失/重复；
- round-trip 后格式解析失败。

出现阻断时不得“猜一个最像的”导出。UI/Agent 必须报告具体 Segment 和证据。

### 测试

- 旧 LA 合成 fixture；
- split/master 正常配对；
- master 缺失、多候选、版本不一致；
- 重复 `{1}`、嵌套、顺序变化；
- unchanged segment byte preservation；
- changed target rehydration；
- Phrase 再导入 smoke（能自动化则自动化，否则使用解析器/fixture 验证）。

**Gate：在下一次正式 Phrase split-MXLIFF 交付前必须完成。**

## 7B.11 一次性 Legacy CAT Parity Audit

新增文档：

```text
docs/migration/LEGACY_CAPABILITY_AUDIT.md
```

审计输入：

- 旧 LA 源码；
- `CAT_EXTRACTION_MATRIX.md`；
- 旧测试名称和 fixture；
- 新 LA 当前代码；
- 用户真实项目格式扫描。

每项记录：

```text
Legacy capability
Old implementation/tests
New equivalent
Parity: full / partial / absent / superseded
Real-work evidence
Correctness impact
Complexity
Decision: implement-now / backlog / discard
Ticket
```

重点核查但不预判都要迁移：

- Tag Rule Discovery / Candidate lifecycle；
- Phrase master rehydration；
- SDLTM / SDLTB；
- project scanner / asset role classifier；
- Segment Context Graph；
- workbook mapping；
- TM candidate pipeline；
- Entity / Voice memory；
- delivery QA；
- 写入授权/证据策略；
- 旧格式的 preserve/round-trip 技巧。

### 审计停止规则

- 审计只做一次，输出决策；
- A 类正确性项进入当前 Roadmap；
- B 类必须有真实项目证据；
- C/D 类明确关闭，不保留模糊“以后也许”；
- 审计完成后不得再因单个旧文件重写总蓝图；
- 新发现进入普通 Ticket，等待真实使用排序。

## 7B.12 Phase 2B Gate

必须满足：

- PB-097 现有引擎被复用且调用点统一；
- 编辑器、Proposal、QA、Review、Export 使用同一 TagScanner/Tag Model；
- 未登记模式可扫描、由 LLM 提议、严格验证、人工批准；
- Candidate 不会因重跑覆盖人工拒绝/禁用状态；
- required Tag 不能被无意拆坏；
- IME、粘贴、undo/redo、键盘和无障碍回归通过；
- Phrase master rehydration 有阻断式错误处理和 round-trip fixture；
- Legacy audit 已完成分类，但没有触发无边界功能回填。

---

# 8. Phase 3：质量体系、Prompt v3 与翻译/审校 Harness 重构

## 8.1 根本问题

当前旧 Prompt 的隐性语义包括：

```text
Fast = 可靠批量初稿
Balanced = 合理成本下的高质量候选
Best = 最高质量 + 更强审校
Reviewer = 不重新审整批，只判断指定 Proposal
```

这会产生质量责任稀释：

- 前序 Agent 认为后面会有人补救；
- 后序 Reviewer 只看 Proposal，无法发现没有 Proposal 的旧错误；
- 再增加更多审校批次也可能永远看不到第一轮遗漏；
- 用户选择 Fast / Balanced 时，系统主动降低质量承诺；
- LA 与同模型 Web Chat 相比，反而可能因工作流提示而表现更保守。

本阶段废弃这套语义。

## 8.2 新质量模型

### 唯一质量目标

```ts
type QualityTarget = 'professional-delivery';
```

### 独立的执行资源设置

```ts
interface ExecutionPolicy {
  modelId: string;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'provider-default';
  independentReview: 'off' | 'risk-based' | 'full-scope';
  externalResearch: 'disabled' | 'public-facts-only' | 'allowed';
  maxParallelism: number;
  preferredChunkSize?: number;
  tokenBudget?: number;
  timeBudget?: number;
}
```

说明：

- `reasoningEffort` 控制模型内部计算；
- `independentReview` 控制是否建立独立审校视角；
- `externalResearch` 控制是否使用 Proma 通用网络/文档能力；
- 这些设置不能改变“每轮都以专业交付为目标”的质量合同。

### 旧 Session 迁移

```text
Fast     → professional-delivery + 原模型 reasoning 默认/较低资源建议
Balanced → professional-delivery + provider-default
Best     → professional-delivery + higher reasoning + independentReview=risk-based/full-scope
```

迁移后 UI 不再展示 Fast / Balanced / Best 作为质量名称。保留旧字段只用于兼容读取，并在写回时迁移到 `executionPolicy`。

## 8.3 统一“零预支质量合同”

该合同由 Translator、Editor、Proposal Critic、Full-Scope Reviewer 和 Auditor 共同继承。

```xml
<professional_quality_contract version="3">
你是当前声明范围内的最终质量责任人。

你的交付必须达到可用于正式项目的专业标准，而不是等待后续人员补救的草稿。
将本轮视为缺陷进入交付前的最后一次阻止机会。

不得因为后续可能还有模型、审校员或人工审核，而减少本轮的检索、核对、
修订或完整性检查。后续检查只是纵深防御，不能替代本轮责任。

对声明范围内的每个 Segment：
1. 完整保留源文的意义、功能、关系、语气和信息；不得漏译、增译、误译或擅自改写。
2. 遵守项目 mandatory rules、术语、世界观、角色声音、文本功能、风格和区域规范。
3. 保留 Tag、占位符、变量、ICU、数字、代码和不可翻译 Token。
4. 译文必须符合目标语言自然表达，不以逐字对应代替准确。
5. 不得仅因个人偏好修改本来正确的译文。
6. 能确定的问题必须解决；证据不足时，给出当前证据支持度最高的方案，
   并精确标记仍需业务决策的歧义。
7. 未完成范围覆盖、确定性 QA 和材料性错误复核前，不得宣称任务完成。

在内部完成必要分析与核对。面向用户只输出结构化结论、Proposal、Finding、
证据、覆盖范围和未解决项；不要输出冗长思维过程。
</professional_quality_contract>
```

## 8.4 Prompt Engineering 原则

新版 Prompt 不依赖“你是有二十年经验的天才本地化专家”式形容词堆砌。

采用：

```text
明确职责
+ 不可妥协的质量合同
+ 精确任务范围
+ 项目事实和动态证据
+ 工具与输出契约
+ Harness 强制完成标准
+ Eval 驱动迭代
```

不要求模型展示 Chain-of-Thought。只要求内部完成分析并输出可审计结果。

## 8.5 Canonical Prompt Contract

不要为每个 Provider 手工维护语义不同的 Markdown。先建立类型化语义规范：

```ts
interface LinguistPromptContract {
  contractVersion: string;
  qualityContract: ProfessionalQualityContract;
  role:
    | 'translator-editor'
    | 'proposal-critic'
    | 'full-scope-reviewer'
    | 'auditor'
    | 'project-intake';
  executionPolicy: ExecutionPolicy;
  projectDigest: ProjectDigest;
  projectMemoryRefs: ProjectMemoryReference[];
  scopeManifest: ScopeManifest;
  retrievedEvidence: RetrievedEvidence;
  completionCriteria: CompletionCriteria;
  outputContract: OutputContract;
}
```

再按模型/Runtime 能力渲染：

- reasoning model：简洁、直接、明确成功标准；
- Claude/XML 友好模型：结构化 XML 区块；
- generic instruction model：更显式步骤和输出 Schema；
- 所有 Renderer 语义一致，只有表达形式不同。

## 8.6 Prompt Stack v3

推荐顺序：

```text
Layer 0  Proma Base Agent
Layer 1  Professional Quality Contract（恒定、短）
Layer 2  Role Contract
Layer 3  Execution Policy（资源，不是质量）
Layer 4  Project Digest / Mandatory Rules
Layer 5  Dynamic Project Memory / Evidence
Layer 6  Scope Manifest / Coverage State
Layer 7  Turn Request
Layer 8  Output / Finalization Contract
```

### 总预算

必须有真正的全局 Budget Allocator：

```ts
interface PromptBudgetAllocation {
  totalChars: number;
  fixedReserve: number;
  qualityContract: number;
  role: number;
  projectDigest: number;
  dynamicEvidence: number;
  scope: number;
  turn: number;
  outputContract: number;
}
```

最终强断言：

```ts
finalPrompt.length <= totalBudget
```

截断顺序：

1. 不裁剪技术不变量、Scope ID、Segment ID；
2. 优先裁剪低置信 TM 和重复示例；
3. 再裁剪非 mandatory Style 解释；
4. 永不把完整 Source 裁成空字符串后仍标记已处理；
5. 记录每层裁剪字数和原因。

## 8.7 证据优先级

统一为：

```text
1. 技术和数据事实
   revision / locked / tag / placeholder / file structure / source text

2. 明确的项目强制规则
   mandatory style / required term / forbidden term / client instruction

3. 用户明确指定的例外
   必须明确针对某条规则；普通“翻译这一批”不构成覆盖

4. 当前 Segment 及文档上下文
   speaker / function / previous-next / scene / UI context

5. 已批准的项目记忆
   entity / voice / accepted exemplar / approved TM

6. 普通 TM / TB / reference

7. 外部公共事实与模型推断
```

证据冲突必须显式记录，不能默默选择低优先级证据。

## 8.8 Project Memory：3E 结构

为了让 LA 真正超过 Web Chat，引入项目级、可查询、可更新的记忆：

### Essence

- 项目/作品摘要；
- Asset/章节/场景摘要；
- 风格、受众、平台；
- 剧情状态；
- 当前范围的功能说明。

### Exemplar

- 已人工接受的优质 Source–Target 对；
- 角色/文本类型/功能标签；
- 验收状态；
- 是否存在 QA/Review 问题；
- 版本和来源。

### Entity

- 角色、称谓、阵营、关系；
- 地点、道具、技能、系统名；
- 性别、单复数、代词；
- 角色声音、口癖、正式度；
- 术语和别名；
- 首次/最近出现位置。

建议数据接口：

```ts
interface ProjectKnowledgeStore {
  upsertEssence(...): Promise<void>;
  upsertEntity(...): Promise<void>;
  approveExemplar(...): Promise<void>;
  retrieveForSegments(input: KnowledgeRetrievalInput): Promise<ProjectKnowledgeBundle>;
}
```

默认只用已批准或高置信知识影响正式译文；模型推断的实体必须标记 `candidate`，不得悄悄变成项目事实。

## 8.9 动态上下文检索

每个 Segment 不需要全量 Project Dump。批量工具应返回：

```ts
interface SegmentTranslationContext {
  segmentId: string;
  assetId: string;
  revision: number;
  source: string;
  currentTarget: string;
  function?: string;
  speaker?: EntityRef;
  previous?: NeighborContext;
  next?: NeighborContext;
  requiredTerms: TermMatch[];
  forbiddenTerms: TermMatch[];
  preferredTerms: TermMatch[];
  acceptedExemplars: ExemplarMatch[];
  entityFacts: EntityFact[];
  topTm: TmMatch[];
  technicalSignature: TechnicalSignature;
  ambiguityFlags: string[];
}
```

检索排序应基于：

- 同角色；
- 同文本功能；
- 同 Asset / 场景；
- 同实体；
- Source 相似度；
- 已接受程度；
- 近因性；
- 质量状态。

## 8.10 Translator / Production Editor 角色

现有 `project-assistant` 重命名或重写为：

```text
Translator / Production Editor
```

角色定义：

```xml
<translator_editor_contract>
你的职责是为声明范围生成当前证据下可正式采用的最佳译文，并通过 Proposal 提交。
Proposal 是版本控制和人工确认载体，不是低标准草稿。

对每个 Segment 执行：
1. 理解 Source 的意义、功能、关系、语气和技术结构。
2. 检索必要的项目上下文、实体、术语和已批准范例。
3. 生成或修订目标译文。
4. 从 Source → Target 复核完整性与准确性。
5. 从目标语言读者视角复核自然度、角色声音和文本功能。
6. 运行确定性 QA；修复所有可解决的材料性问题。
7. 只有在 Coverage Ledger 完整后才提交完成状态。

不得以“后续会有 Reviewer”作为降低本轮标准的理由。
</translator_editor_contract>
```

## 8.11 Translate → Estimate → Refine Harness

对于每个 Chunk：

```text
Translate
→ 生成当前最佳译文

Estimate
→ 以 MQM 风格估计 accuracy / omission / addition / terminology /
   voice / naturalness / technical integrity 的材料性风险

Refine
→ 修订所有可解决问题

Deterministic QA
→ 检查 Tag / Placeholder / ICU / Number / Required / Forbidden 等

Reconcile
→ 更新 Coverage Ledger 和 Proposal
```

这个流程由 Harness 管理状态，不依赖 Prompt 让模型记住自己做到了哪一步。

## 8.12 翻译 Coverage Ledger

数据模型：

```ts
type TranslationSegmentState =
  | 'pending'
  | 'context-ready'
  | 'translated'
  | 'estimated'
  | 'refined'
  | 'qa-passed'
  | 'proposal-created'
  | 'blocked'
  | 'stale'
  | 'explicitly-skipped'
  | 'failed';

interface TranslationScopeLedger {
  scopeId: string;
  declaredSegmentIds: string[];
  entries: Record<string, {
    state: TranslationSegmentState;
    baseRevision: number;
    proposalId?: string;
    blockingReason?: string;
    evidenceSnapshotHash?: string;
  }>;
}
```

完成等式：

```text
requested
=
proposal-created
+ blocked
+ stale
+ explicitly-skipped
+ failed
```

其中 `failed > 0` 或未解释的 `pending > 0` 时，不得输出“全部完成”。

## 8.13 自审不是独立 Reviewer

Translator 内部完成完整自审，这是主流程的一部分。

UI 用词：

- `翻译并自审`
- `完整审校`
- `检查此 Proposal`

不得把 Assistant 自审按钮标成“独立审校”。

## 8.14 Proposal Critic

保留现有 Snapshot 流程，但诚实改名：

```text
Proposal Critic
```

职责：

- 判断指定 Proposal 相对当前 Target 是否更好；
- 检查 Proposal 是否引入新错误；
- 检查该改动是否符合当前上下文；
- 支持 `pass / issues / abstain`；
- 不代表整个 Asset 已审校。

Critic Artifact UI 必须显示：

```text
局部改动检查，不是完整范围审校
```

## 8.15 Full-Scope Reviewer / Editor

### 核心职责

```xml
<full_scope_reviewer_contract>
你是当前声明范围的完整双语审校责任人，而不是 Proposal 的局部评论者。

你必须检查完整声明范围。没有 Proposal、没有改动、译文表面流畅，
都不能成为跳过 Segment 的理由。

你可以对任何存在材料性问题的 Segment 提出修订，
无论该问题是否由当前 Proposal 引入。

先基于 Source、上下文、项目规则和技术约束独立建立每段应传达的意义与功能，
再检查当前 Target 和所有 Proposal，以降低被已有候选锚定的风险。

不要因个人措辞偏好修改正确译文。明确区分：
critical / major / minor / preference。
preference 不得伪装成质量错误。

在 Coverage Ledger 证明全部范围已审前，不得提交完整 pass。
</full_scope_reviewer_contract>
```

### Source-first 两阶段揭示

阶段 A：

```text
Source
Context
Project mandatory rules
Entities / terminology / technical structure
```

Reviewer 输出内部结构化 `Source Review Brief`：

- core meaning；
- function；
- intent；
- mandatory information；
- ambiguity；
- technical constraints。

阶段 B 才显示：

```text
Current Target
Pending Proposals
Existing QA / Critic artifacts（按 policy）
```

然后比较并提交 Verdict / Findings / Review Proposals。

### 新工具

```text
cat_create_review_scope
cat_get_source_review_brief
cat_submit_source_understanding
cat_get_target_review_snapshot
cat_submit_scope_review
cat_create_review_proposals
cat_finalize_scope_review
```

### Review Coverage Ledger

```ts
type ReviewSegmentState =
  | 'unreviewed'
  | 'source-understood'
  | 'target-revealed'
  | 'passed'
  | 'issues-found'
  | 'abstained'
  | 'stale'
  | 'failed';
```

完成等式：

```text
declared
=
passed
+ issues-found
+ abstained
+ stale
+ failed
```

只有 `unreviewed = 0` 才能 finalize；`stale` 和 `failed` 必须在结论中显式列出。

## 8.16 Review Severity 与无错不改

统一：

```text
critical：会导致功能/法律/严重语义问题，不可交付
major：明显误译、漏译、关键术语/角色/功能错误
minor：真实但局部的质量问题，不改变核心意义
preference：多个正确方案中的个人偏好，不应作为阻断 Finding
```

Reviewer 的目标不是制造修改量。统计必须包括：

- true positive；
- false positive；
- unnecessary edit；
- preference masquerading as issue。

## 8.17 Auditor

Auditor 检查流程证据、覆盖、来源和限制，不只输出聊天文本。

新增：

```text
cat_submit_audit_report
```

结构：

```ts
interface AuditReport {
  auditId: string;
  scopeId: string;
  evidenceSnapshotHash: string;
  verdict: 'pass' | 'issues' | 'inconclusive';
  coverage: CoverageSummary;
  findings: AuditFinding[];
  limitations: string[];
  promptVersion: string;
  modelId: string;
  toolsetProvenance: ToolsetProvenance;
}
```

规则：没有 Proposal 不等于没有问题；证据不足时不得返回 pass。

## 8.18 Project Intake Role Prompt

```xml
<project_intake_contract>
你的目标是把用户指定目录中的本地化资源安全、完整、可追踪地纳入当前项目。

先扫描并分类，再检查项目已有资源、重复、版本关系、语言对和格式支持。
不要因为能够读取文件就假装已经完成结构化导入。

对明确、安全、受支持且无冲突的资源，按当前执行策略自动导入；
对 exact duplicate 自动跳过并说明；
对同源不同版本、覆盖风险或格式不支持项，保留原文件并明确报告。

必须在导入后验证实际资源、条目数量、Segment 数、语言对、hash 和 warnings。
没有 Verification Report 时，不得宣称导入完成。
</project_intake_contract>
```

## 8.19 外部研究与隐私

LA 保留 Proma 完整研究能力，但 Project 设置应有：

```ts
externalResearchPolicy:
  | 'disabled'
  | 'public-facts-only'
  | 'allowed';
```

`public-facts-only` 下：

- 可查公开游戏设定、现实世界术语和文化事实；
- 不将未公开脚本、客户文案、完整 Segment 发送到搜索引擎；
- 搜索 Query 使用实体名或抽象问题，不复制敏感正文；
- 外部证据低于项目强制事实。

## 8.20 Degraded 行为

Prompt/Context 部分缺失时，不一律阻断，但语义必须真实：

- Translator：可继续，标记缺失证据；不得把高不确定结果描述为已充分验证；
- Proposal Critic：Snapshot 缺失必须 abstain；
- Full-Scope Reviewer：Source/Target/Scope 不完整不得 finalize pass；
- Auditor：证据不完整返回 inconclusive；
- Intake：没有 Verification 不得 completed；
- UI 显示具体缺失层，而不是笼统 `degraded=true`。

## 8.21 Prompt Version / Hash / Provenance

每次 Run 保存：

```text
promptContractVersion
rendererVersion
qualityContractHash
rolePromptHash
projectDigestHash
memorySnapshotHash
scopeSnapshotHash
executionPolicy
model/provider/runtime
Proma base version
Linguist overlay version
```

`version` 和 `hash` 不得混用。

## 8.22 Phase 3 Gate

必须具备以下行为：

1. UI 不再把 Fast / Balanced / Best 作为质量档位；
2. 同一个任务切 reasoning effort 时，质量合同和完成标准不变；
3. Translator 必须完成 Translate–Estimate–Refine、QA 和 Ledger；
4. Proposal Critic 明确只检查局部 Proposal；
5. Full-Scope Reviewer 能发现没有 Proposal 的现有 Target 错误；
6. Reviewer Source-first 阶段无法先看到 Target；
7. 未覆盖完整 Scope 时服务器拒绝 finalize；
8. Prompt 总预算有强断言和可观测截断报告；
9. 所有角色均继承零预支质量合同；
10. Prompt Eval 中不存在“后续还有审校，所以初稿即可”的指令或行为期望。

---
# 9. Phase 4：剩余正确性、规则、Context 与 Runtime 收口

本阶段汇总此前 Review 中仍未确认实施的缺陷。实施者必须先验证当前代码；若已由 Proma 0.16.8 同步或其他提交解决，则提交证据并关闭 Ticket，不得重复修改。

## 9.1 Tool Schema：根级 Union 兼容

问题：某 CAT Tool 使用根级 `Type.Union`，而 Claude/MCP 适配器可能要求根级 Object。

统一规范：所有公开 Agent Tool 输入根级使用 Object；判别式语义在字段层表达：

```ts
Type.Object({
  verdict: Type.Union([
    Type.Literal('pass'),
    Type.Literal('issues'),
    Type.Literal('abstain'),
  ]),
  findings: Type.Optional(Type.Array(FindingSchema)),
  reason: Type.Optional(Type.String()),
})
```

执行层校验：

- `pass` → findings 必须为空；
- `issues` → findings 至少一条；
- `abstain` → reason 必须存在。

用**完整真实 CAT Toolset**测试 Pi、Claude（若仍启用）和其他 Adapter，不再只用人造 Object canary。

## 9.2 Session Execution Policy 真源

旧 Session 的 Strategy 漂移问题迁移为新语义：

- Project 设置只保存“新建 Session 的默认 Execution Policy”；
- 已存在 Session 使用自己的冻结 policy；
- UI 同时可显示“本会话”和“项目默认”；
- 修改项目默认不悄悄改变旧 Session；
- 可通过“创建新会话并采用当前默认”显式切换。

Prompt、UI、Run Provenance、CWD manifest 全部从 Session policy 读取。

## 9.3 数字硬规则误判

禁止无条件把普通英文词映射成数字：

```text
May I enter?
March forward!
First, open the menu.
August is waiting.
One last chance.
```

建立三类：

```text
Hard Numeric Token
  12, 1st, 50%, Chapter 3, May 12, 12 May 2026

Contextual Numeric Candidate
  Chapter One, the first level, one more chance

Lexical Word / Proper Name
  May I, march forward, August as a name, First as discourse marker
```

只有明确 Hard Token 进入不可豁免 Gate；Contextual Candidate 进入 Soft QA。

回归测试必须覆盖日期、月份、人名、动词、序数话语标记、罗马数字、百分比、小数、范围和本地化数字格式。

## 9.4 术语状态一致性

统一：

```ts
requiredTerminology
preferredTerminology
forbiddenTerminology
```

语义：

- required：明确匹配且应出现时可作为 error/hard requirement；
- preferred：warning/suggestion，不自动等同 required；
- forbidden：明确命中时 error；
- status 在 Proposal Gate、QA、Prompt Context、Reviewer 中完全一致。

## 9.5 Term Match Policy

替换裸 `text.includes(term)`：

```ts
type TermMatchPolicy =
  | 'exact'
  | 'whole-word'
  | 'phrase'
  | 'substring'
  | 'regex';
```

默认：

- 空格语言：Unicode-aware whole-word / phrase；
- CJK：最长连续字符串匹配；
- Token/Code：exact；
- regex：用户明确配置并做 ReDoS 防护。

禁止空字符串、全空白或规范化后为空的 Term。

性能初期可建规范化索引；真实出现瓶颈后引入 Aho–Corasick/Trie，不为理论规模过早复杂化。

## 9.6 ICU / Placeholder / Tag Profiles

- 使用成熟 ICU MessageFormat AST Parser；
- Adapter 声明 Placeholder Profile；
- 分别支持 printf、C#、Python、Java、Mustache、HTML/XML、游戏自定义 Token；
- Source/Target 比较 AST 或 token multiset，不使用一个万能正则；
- 加 property-based / fuzz tests；
- 错误解析不得误判成“无约束”。

## 9.7 Locked Segment

Locked 表示不可修改，不表示内容一定正确：

- QA 可报告；
- Full-Scope Reviewer 必须检查；
- Proposal 创建必须阻止；
- UI 标记“只能在源系统修复/申请解锁”；
- 一致性分析可参考，但不得自动把 locked 当金标准。

## 9.8 Locale-aware QA

下列规则不得只用全局正则：

- source=target；
- 残留 Latin/CJK；
- 大小写；
- 标点；
- 空格；
- 品牌名、URL、代码、缩写、人名；
- 可保留英文专名。

规则输入需要 locale pair、segment type、allowlist、entity/term status 和 script ratio。

## 9.9 Prompt 总预算、引用与序列化

- 实施全局 budget allocator；
- Style Guide 使用内部稳定 `referenceId`，不伪造网页 Citation 标记；
- `TechnicalConstraint.valueJson` 先 runtime schema 验证，再 canonical serialize；
- 无效数据标记 `invalid_reference_data`，不直接把 raw JSON 塞入高优先级 Prompt；
- Project Digest hash 对规范化结构计算。

## 9.10 Project Digest Cache

当前若缓存命中发生在数据库读取后，无法减少主要成本。

新缓存键：

```text
projectId
+ projectEventSequence
+ promptDigestVersion
+ localePair
+ knowledgeSnapshotVersion
```

Event sequence 未变化时直接返回缓存。影响 Project Rules、TM/TB、Entity、Style、Settings 的 mutation 使其失效。

## 9.11 `includeProjectRules`

Translation Context 的该参数必须二选一：

1. 真正返回结构化规则：

```ts
projectRules: Array<{
  ruleId: string;
  category: string;
  severity: string;
  summary: string;
  referenceId: string;
}>;
```

2. 删除参数及 cursor/hash 中的伪影响。

不得保留 No-op Contract。

## 9.12 Snapshot-bound Cursor

Translation Context cursor：

```ts
{
  v: 2,
  projectId: string,
  projectEventSequence: number,
  requestHash: string,
  offset: number
}
```

下一页时：

- sequence 相同 → 正常；
- 项目已变 → `CONTEXT_DRIFT`；
- 普通交互可让 Agent显式重新开始；
- Translation/Review Job 必须使用一致 Snapshot。

## 9.13 不允许空 Source 消耗 Cursor

最低不可裁剪字段：

```text
segmentId
assetId
revision
完整 source
locked
technical signature
```

如果剩余字节预算放不下最小核心：

```text
contexts=[]
cursor 不推进
minimumRequiredBytes=<n>
```

不得返回空 Source 却把 Segment 标记成已读取。

## 9.14 Turn Context V2

当前 UI Turn Context 若只是选择指针，应升级或改名。

建议：

```ts
interface LinguistTurnScopeV2 {
  projectId: string;
  projectEventSequence: number;
  assetId?: string;
  selectedSegments: Array<{
    segmentId: string;
    assetId: string;
    revision: number;
    sourceHash: string;
    targetHash: string;
  }>;
  createdAt: string;
}
```

真正长任务另建 `ScopeSnapshot`，不把 UI 选择变化带入已经开始的 Run。

## 9.15 QA 自动 Resolve 事件

Repository 返回完整 Change Set：

```ts
{
  observed: QaFinding[];
  createdIds: string[];
  updatedIds: string[];
  resolvedIds: string[];
  affectedSegmentIds: string[];
}
```

Outbox / Renderer Event 必须包含自动 resolved ID，避免数据库状态已变但 UI 未刷新。

## 9.16 Session Index / JSONL Runtime Validation

使用 TypeBox/Zod Codec：

```text
parse
→ version migrate
→ 单条损坏隔离
→ quarantine
→ 其余 Session 继续加载
```

输出脱敏 `session-corruption-report.json`。一个坏 Session 不得让整个 App 或项目卡死。

## 9.17 新 Linguist Session 继承 Proma 当前默认

不再硬编码 Pi 或某模型。新建 Session 应继承当前 Proma Agent 默认：

- runtime；
- provider/channel；
- model；
- reasoning effort；
- permission mode；
- thinking settings。

Linguist Profile 只叠加项目身份和专业能力。

## 9.18 Toolset Provenance

避免把无法枚举的 SDK 原生工具称为“完整 Toolset Hash”。拆分：

```ts
interface ToolsetProvenance {
  hostAdapterVersion: string;
  sdkVersion: string;
  basePreset: string;
  nativeToolsetEnumerated: boolean;
  promaExplicitToolsHash?: string;
  mcpManifestHash: string;
  linguistOverlayHash: string;
}
```

## 9.19 Undo 与文档诚实性

UI 区分：

```text
可结构化撤销：pending Proposal / 可逆 Import / CAT state
不可保证撤销：Bash 文件操作 / 外部 MCP / 已导出文件 / 外部服务
```

按钮命名：

```text
撤销本次可恢复的 CAT 变更
```

README 的绝对表述改为：标准 CAT 写入走 Proposal 和结构化流程；LA 同时继承 Proma 完整通用能力。

## 9.20 Auditor 与 Reviewer Provenance

修复：

- prompt version 与 prompt hash 分开；
- producer/reviewer/auditor 的 model/runtime/prompt/context/toolset 证据完整；
- Proposal Critic 与 Full-Scope Review 的 UI、表和统计不混用；
- Reviewer pass 代表 Scope，不代表项目其他范围。

## 9.21 Phase 4 Gate

每个问题都有：

- 最小失败 fixture；
- 单元测试；
- 跨层集成测试；
- 迁移/兼容测试；
- 打包 App smoke（适用时）。

不得以“测试总数增加”代替针对上述不变量的测试。

---

# 10. Phase 5：长任务、Worker、Checkpoint 与规模化

## 10.1 当前风险

已有 Worker/Job 不代表真正增量。若流程仍是：

```text
Main 读取全部 Segment / Terms
→ clone 整个数组给 Worker
→ Worker 一次处理大尾段
→ 完成后才写 checkpoint
```

则 10k–50k Segment 仍会出现内存峰值、Main 卡顿、取消迟钝和崩溃后大范围重做。

## 10.2 统一 Chunked Job Engine

所有长任务统一使用：

```text
Job Coordinator
→ keyset page
→ load chunk
→ worker/model execute
→ transaction commit
→ durable checkpoint
→ emit event
→ cancellation check
→ next chunk
```

适用：

- Project Intake；
- Translation；
- Full-Scope Review；
- QA；
- Consistency；
- Integrity Scrub；
- Large Export / Round-trip；
- Project Memory extraction。

## 10.3 Job 数据模型

```ts
interface DurableJob {
  jobId: string;
  type: string;
  projectId: string;
  scopeSnapshotId: string;
  status:
    | 'created'
    | 'running'
    | 'paused-transient'
    | 'cancel-requested'
    | 'cancelled'
    | 'failed-terminal'
    | 'completed'
    | 'completed-with-warnings';
  cursor: string | null;
  completedUnits: number;
  totalUnits: number;
  lastCheckpointAt: string;
  retryCount: number;
  inputHash: string;
  workerVersion: string;
}
```

Chunk 幂等键：

```text
jobId + chunkKey + inputSnapshotHash + workerVersion
```

## 10.4 Keyset Pagination

不要用大 offset 扫描 SQLite：

```sql
WHERE segment_id > :last_segment_id
ORDER BY segment_id
LIMIT :chunk_size
```

若业务排序不是 ID，使用稳定复合 key。

推荐初始 Chunk：

- deterministic QA：500–1000；
- Context/Review：50–250；
- LLM Translation：按 token 预算动态 5–50；
- Import：按文件或 parser chunk；
- Integrity：500–2000 records。

基准后调整，不硬编码到 Prompt。

## 10.5 Main / Worker 责任

Main：

- IPC；
- Job lifecycle；
- per-project command queue；
- checkpoint；
- event emission。

Worker：

- 大量 parsing；
- deterministic QA；
- term matching；
- consistency analysis；
- integrity hash；
- non-Electron CPU-heavy work。

LLM Runtime：

- 接收当前 Chunk 和精确上下文；
- 不持有整个项目内存；
- 通过 Tool / Job API 提交结果。

## 10.6 Proma v0.16.8 Compaction / Overflow 续跑与 Vision Relay 集成

Proma 会在 Context Compaction 后继续 Agent，但 LA 不能只依赖对话历史记忆。

每个长任务在外部保存 `State Capsule`：

```ts
interface LinguistRunStateCapsule {
  jobId: string;
  scopeId: string;
  currentChunk: string;
  ledgerSummary: CoverageSummary;
  unresolvedAmbiguities: string[];
  pendingToolActions: string[];
  promptContractVersion: string;
  projectSnapshot: string;
}
```

Compaction 后将精简 Capsule 注入下一轮；实际真源仍在 Store/Job，不在 Prompt。

## 10.7 取消与恢复

- Cancel 最迟在当前 Chunk 后生效；
- UI 一秒内显示 `cancel-requested`；
- App 崩溃后将 `running` 标为 `paused-transient`；
- 重启可 Resume；
- 已提交 Chunk 不重复副作用；
- Model/Provider 错误只重试当前 Chunk；
- 达到重试上限后保留其他成功结果并列出失败范围。

## 10.8 Batch IPC 与 N+1

新增/确认：

- `proposals.listWithDiffs`
- `segments.getRevisionContextBulk`
- `qa.listFindings(cursor)`
- `reviews.listCoverage(cursor)`
- `jobs.getMany`
- `projectMemory.retrieveBulk`

Renderer 不得为 200 条列表发 201 次 IPC。

## 10.9 Tool Result Budget

```text
content：给模型的简短摘要和下一步
structuredDetails：Renderer 使用的小型结构数据
artifactRef：大结果的存储引用
cursor：后续获取
```

禁止在 `content` 和 `details` 复制同一大 DTO。

## 10.10 性能基准

固定 synthetic fixtures：

```text
1k / 10k / 50k segments
100k TM entries
20k terms
10k proposals
10k QA findings
500 sessions
长 Agent thread + 多次 compaction
```

目标初值：

- 编辑保存 p95 < 100ms（不含 Provider）；
- Main event loop 无 >200ms 大块工作；
- Proposal Inbox O(page size)；
- Cancel UI 响应 <1s；
- 10k Segment 项目启动不全量加载；
- 50k Segment QA 可持续进度、可取消、可恢复；
- Worker 崩溃不导致 App 整体退出。

## 10.11 Phase 5 Gate

故障注入：

```text
第 3 Chunk 提交后 App 崩溃
Provider 流中断
DB busy
磁盘满
Worker crash
用户取消
Segment 中途被人工修改
Project rules 中途更新
重复 Tool Call
```

恢复后：

- 已成功 Chunk 不重复；
- stale 输入不覆盖新 revision；
- Ledger 完整；
- UI 和数据库一致；
- 所有副作用有明确状态。

---
# 11. Phase 6：证明 LA 比 Web Chat 更强

## 11.1 诚实基线

对于少量独立文本，如果使用相同顶级模型、相同 reasoning、相同项目资料和一份优秀人工 Prompt，当前 LA 尚未被证明一定比 Web Chat 译得更好。

本阶段目标不是证明“CAT 界面更复杂”，而是验证：

```text
结构化项目上下文
+ 动态记忆
+ 全范围覆盖
+ 确定性 QA
+ Translate–Estimate–Refine
+ Source-first Full Review
+ Revision / Proposal / Provenance
```

是否为同一个模型带来可测量的质量和可靠性提升。

## 11.2 三组对照

固定同一模型、同一 reasoning effort、同一温度和同一允许资料：

### A：Web Chat Baseline

- 用户把原文/译文和必要资料复制给模型；
- 使用本地化专家人工编写的最佳 Prompt；
- 不使用 LA Tool/Harness。

### B：旧 LA Baseline

- 同一模型；
- 当前公开版本旧 Prompt / Reviewer；
- 保存结果作为回归基线。

### C：新版 LA

- 零预支质量合同；
- 动态 3E Context；
- Translate–Estimate–Refine；
- Coverage Ledger；
- Full-Scope Reviewer；
- deterministic QA。

## 11.3 真实测试集

使用私有、脱敏或授权数据，覆盖：

- MOBA 技能、装备、英雄台词、系统 UI；
- FPS 操作、战术、任务和装备；
- RPG 任务、剧情、对白和世界观；
- 体育游戏菜单、解说和赛事语境；
- 暗黑奇幻叙事；
- 多义短字符串；
- 长对话与跨段指代；
- 角色声音；
- 术语冲突；
- Placeholder、Tag、ICU、富文本；
- 当前 Target 中存在、但没有 Proposal 的隐藏错误；
- 同源不同版本；
- 长项目 Compaction 后继续；
- 真实 Asset/TM/TB/Context Intake。

测试数据不得提交公开仓库。公开仓库只保留合成 fixture 和评分 Schema。

## 11.4 人工盲评

由用户以本地化专家身份盲评，隐藏系统来源。

MQM 风格维度：

```text
Critical / Major / Minor
Accuracy
Mistranslation
Omission
Addition
Terminology
Character Voice
Register / Style
Naturalness
Context Consistency
Technical Integrity
Locale Convention
Unnecessary Edit
```

必须特别记录：

- Reviewer 漏检；
- Reviewer 误报；
- preference 被当成 issue；
- 无 Proposal Segment 的新发现率。

## 11.5 工程指标

```text
Scope 漏段率
Coverage Ledger 一致性
Proposal 接受率
人工最终编辑距离
首次交付 Major Error / 千段
Full Reviewer 新发现率
Proposal Critic true positive rate
Reviewer false positive rate
不必要修改率
Tool Call 数
总 Token / 成本
耗时
崩溃恢复成功率
Compaction 后完成率
```

## 11.6 Prompt / Model 版本控制

- Pin 模型 snapshot 或记录精确 model ID；
- 记录 Prompt Contract、Renderer、Project Memory 版本；
- 修改 Prompt 前先跑当前基线；
- 不允许只展示成功案例；
- 每个质量声称必须有 Eval Run ID。

## 11.7 通过标准

新版 LA C 至少满足：

1. 与 A 相比，Critical/Major Error 显著下降或至少不劣；
2. 技术完整性错误显著低于 A；
3. 漏段率为 0 或所有未完成项均被 Ledger 明确解释；
4. Full-Scope Reviewer 能发现 A/B 中 candidate-only review 看不到的错误；
5. 不必要修改率在可接受范围；
6. 同一任务重复运行的波动可解释；
7. 成本增加与质量增益成比例；
8. 若某模型在 Web Chat 上更强，必须承认并分析 LA Context/Harness 的问题，不能修改评分标准。

## 11.8 14 天日用 Gate

连续 14 天真实个人使用，记录：

- 项目类型；
- 每日 Session / Segment 规模；
- Import 成功率；
- 卡顿、崩溃和恢复；
- Prompt/Context 失误；
- Proposal 接受/拒绝；
- Reviewer 增益；
- 文件 Round-trip；
- 需要回到 Web Chat 的场景和原因。

结束后生成 `PRIVATE_DAILY_USE_REPORT.md`，只提交脱敏结论。

## 11.9 真机体验 Gate

- 中文 IME composition；
- Native Save 防覆盖；
- VoiceOver；
- 完整键盘操作；
- 拖拽；
- 大窗口/小窗口；
- Rail/Full/Side Q&A；
- 文件引用和 Slash Menu；
- 长列表和虚拟化；
- macOS arm64 packaged App；
- 真实 Provider Tool Loop。

---

# 12. Phase 7：本地上游同步自动化

## 12.1 目标

自动跟上 Proma 的含义：

```text
自动发现新稳定 Tag
→ 自动创建同步分支
→ 自动执行正式 merge
→ 自动处理机械差异
→ 自动生成影响报告
→ 自动跑测试和打包
→ 自动开 LA 仓库 PR
→ 人工只处理语义冲突
```

不等于未经验证自动发布，也不向 Proma 官方提交任何东西。

## 12.2 `proma-baseline.json`

```json
{
  "version": "0.16.8",
  "tag": "v0.16.8",
  "commit": "bde00f00323d6735a939d14dbce3b2f1a5b672bc",
  "syncedAt": "2026-08-04",
  "hostContractVersion": 1
}
```

## 12.3 Upstream Sync Workflow

建议 `.github/workflows/sync-proma.yml`：

1. 定时或手动触发；
2. 查询 Proma 最新稳定 release tag；
3. 与 baseline 比较；
4. 创建 `sync/proma-vX.Y.Z`；
5. `git merge --no-ff <tag>`；
6. 执行机械脚本：
   - 恢复 LA branding / appId；
   - 重新生成 lockfile；
   - 重新生成 SBOM/NOTICE；
   - 更新 baseline candidate；
   - 重新计算 touchpoints；
7. 生成 `UPSTREAM_IMPACT_REPORT.md`；
8. 跑 CI、build、packaged smoke；
9. 在 LA 仓库开 PR；
10. 若冲突或 Contract 失败，标记 `requires-semantic-review`。

## 12.4 Impact Report

必须包含：

```text
Old Proma base
New Proma base
Commit/file count
Changed host contract areas
Changed Agent Surface files
Changed Runtime/Session files
Changed Settings/Sidebar/IPC files
Dependency/Electron changes
New Proma user-facing capabilities
Deleted/deprecated capabilities
LA deviations affected
Host Parity tests affected
Manual verification checklist
```

## 12.5 自动合并条件

仅当：

- 无未解决冲突；
- Host Contract 未破坏；
- 上游测试通过；
- LA 测试通过；
- Inheritance Canary 通过；
- Embedded Host Parity 通过；
- macOS packaged smoke 通过；
- 旧 CAT Project 数据 smoke 通过；
- 无新增未登记 Proma Core touchpoint；
- 所有 deviation 仍有有效理由；

才允许在 LA 仓库自动合并同步 PR。

即使自动合并，也不得自动创建正式发布或覆盖用户安装包。

## 12.6 `git rerere`

可用于重复机械冲突：

- Product Name；
- appId；
- README badge；
- Builder 字段。

不得信任 rerere 自动处理：

- Agent Orchestrator；
- AgentView / Composer / SidePanel；
- Session lifecycle；
- Settings；
- IPC contracts。

## 12.7 Core Touchpoint Budget

新增门禁：

```text
除 Composition Root 和明确 Host Contract 外，
Proma-owned modules 不得 import Linguist feature 内部代码。
```

每次新功能先问：

1. 能否完全放在 Linguist Extension？
2. 能否通过现有 Host Contract？
3. 必须改 Proma Core 时，是否可增加一个通用本地 seam？
4. 是否登记 deviation 和 sunset condition？

目标是 touchpoint 随时间下降，不是只把增长记录得更详细。

## 12.8 暂不贡献上游

所有 local generic seam 暂时保留在 LA fork。

后续只有在：

- LA 实际使用稳定；
- Seam API 经多次 Proma 升级验证；
- 不含 Linguist 业务代码；
- 用户主动决定联系 Proma 作者；

才另起新计划讨论贡献。此蓝图不包含该工作。

---

# 13. 横向工作：可观测性、隐私、恢复与前端生命周期

## 13.1 Trace Chain

统一：

```text
projectId
sessionId
turnId
agentRunId
jobId
toolCallId
transactionId
scopeId
proposalIssuanceId
reviewId
qaRunId
importPlanId
projectEventSequence
```

## 13.2 指标

记录但默认脱敏：

- Tool latency / result bytes；
- SQLite lock wait / transaction duration；
- Worker queue / crash / restart；
- QA segments/sec；
- Translation/Review coverage；
- Proposal accept/reject/stale；
- Context compaction；
- Job retry/cancel/recovery；
- Prompt layer bytes / truncation；
- Import detect/parse/verify；
- Host parity capability failures。

## 13.3 默认隐私

日志不得默认记录：

- 完整 Source / Target；
- 客户文件名；
- 绝对路径；
- TM/TB 正文；
- API Key；
- Prompt 中客户内容。

使用 hash、长度、locale、rule code、status 和 duration。诊断包在用户明确导出前显示预览和脱敏结果。

## 13.4 Backup / Restore / Export 复核

此前已实现的能力需要在 Electron 43 同步后重做故障注入：

- 磁盘满；
- 权限变化；
- WAL/SHM；
- 部分 blob 缺失；
- schema 新旧不兼容；
- restore 过程中崩溃；
- rollback 失败；
- symlink；
- TOCTOU；
- 同名项目；
- backup 篡改。

## 13.5 前端生命周期

验证并补齐：

- Atom family / cache LRU 与 Project Tab dispose；
- Target Editor Undo 次数或字符预算；
- 选择超过上限时不静默截断；
- Proposal/QA/Review/Job 聚合状态；
- 保存、冲突、离线、stale 的明确状态；
- 500 个 Session/Project 打开关闭的内存回归。

---
# 13B. 实施优先级、真实使用分叉与停止规则

## 13B.1 必须先做

```text
P0：事实冻结、数据备份、Proma v0.16.8 merge、打包/旧数据回归
P0：LA Host 引用/Companion/@file/Vision/Stop/Model parity
P0：现有支持格式的 Agent Intake
P0（条件触发）：下一次 Phrase split-MXLIFF 交付前完成 rehydration
P1：零预支质量、Full-Scope Review、Coverage Ledger
P1：Tag Scanner 统一；未知 Tag discovery 与编辑器保护
```

## 13B.2 可以在日用后继续

- 低频 CAT Adapter；
- Agent Island 的 Linguist 专属美化；
- 多 Agent 评审编排；
- 高级 Entity/Voice 自动挖掘；
- 更复杂的可安装插件 ABI；
- 对 Proma 上游的贡献准备。

## 13B.3 真实使用分叉

Phase 0、Phase 1 和 Intake 最小闭环完成后，不必等待所有 Phase 结束才开始使用。建立 `DOGFOOD_BLOCKERS.md`：

- 遇到数据/格式正确性阻断：提升为当前 P0；
- 遇到质量显著不足：进入 Prompt/Eval Ticket；
- 只是“也许更酷”：留在 backlog；
- 连续两个真实项目未触发的长尾能力不得插队。

## 13B.4 不再重出总蓝图

后续 Proma `0.16.x/0.17.x` 更新由 Sync Bot 和 impact report 处理；旧 LA 新发现由 Legacy Audit 普通 Ticket 处理。除产品目标发生根本变化，不再生成新的全局蓝图。

---

# 14. 机器可执行 Ticket 队列

## 14.1 状态规则

每个 Ticket 状态只允许：

```text
TODO
IN_PROGRESS
BLOCKED
DONE
CANCELLED_WITH_REASON
VERIFIED_ALREADY_DONE
```

`DONE` 必须附：

- commit SHA；
- changed files；
- tests；
- migration；
- packaged smoke；
- remaining risk。

发现当前代码已经实现时，使用 `VERIFIED_ALREADY_DONE`，附源码和测试证据，不重复改造。

## 14.2 总览

| Ticket | 主题 | 优先级 | 依赖 |
|---|---|---:|---|
| LA-MASTER-000 | 当前事实、旧蓝图作废、基线冻结 | P0 | 无 |
| LA-SYNC-001 | 备份、Tag、同步分支 | P0 | MASTER-000 |
| LA-SYNC-002 | 正式 merge Proma v0.16.8 | P0 | SYNC-001 |
| LA-SYNC-003 | Runtime/Session 以上游为主合并 | P0 | SYNC-002 |
| LA-SYNC-004 | Agent Surface/Sidebar/Settings 合并 | P0 | SYNC-002 |
| LA-HOST-000 | 建立本地 Host Contracts 与 Extension Registry | P0 | SYNC-003/004 |
| LA-SYNC-005 | 依赖、Electron 43、Lock/SBOM/Build | P0 | SYNC-003/004 |
| LA-SYNC-006 | Baseline/Touchpoints/Deviations 重置 | P0 | SYNC-005 |
| LA-SYNC-007 | v0.16.8 完整验证与 packaged smoke | P0 | SYNC-006 |
| LA-HOST-001 | Session-scoped Reference | P0 | HOST-000 |
| LA-HOST-002 | Linguist Companion Chat / Side Q&A | P0 | HOST-001 |
| LA-HOST-003 | Agent/Linguist Auto-title | P1 | SYNC-007 |
| LA-HOST-004 | Host Capability Manifest | P1 | HOST-000 |
| LA-HOST-005 | Embedded Host Parity Suite | P0 | HOST-001/002/004 |
| LA-INTAKE-001 | ProjectIntakeCoordinator | P0 | SYNC-007 |
| LA-INTAKE-002 | Candidate Scanner / Classifier | P0 | INTAKE-001 |
| LA-INTAKE-003 | Duplicate / Lineage / Import Plan | P0 | INTAKE-002 |
| LA-INTAKE-004 | Durable Import Job | P0 | INTAKE-003 |
| LA-INTAKE-005 | Agent Intake Tools | P0 | INTAKE-004 |
| LA-INTAKE-006 | UI 使用同一 Intake Coordinator | P1 | INTAKE-004 |
| LA-INTAKE-007 | Verification / Summary / Conditional Undo | P0 | INTAKE-005/006 |
| LA-FORMAT-001 | 私有 CAT Corpus Scanner | P0 | SYNC-007 |
| LA-FORMAT-002 | 真实格式矩阵与优先级报告 | P0 | FORMAT-001 |
| LA-FORMAT-003 | 高频 TM Adapter（按扫描结果） | P1 | FORMAT-002 |
| LA-FORMAT-004 | 高频 TB Adapter（按扫描结果） | P1 | FORMAT-002 |
| LA-TAG-000 | PB-097 事实核验与统一 Tag Model | P0 | INTAKE-001/SYNC-007 |
| LA-TAG-001 | Deterministic + LLM Tag Discovery | P1 | TAG-000 |
| LA-TAG-002 | Candidate lifecycle / Validator / UI | P1 | TAG-001 |
| LA-TAG-003 | 编辑器原子 Tag 保护 | P1 | TAG-000/TAG-002 |
| LA-PHRASE-001 | Phrase master-XLIFF pairing / rehydration | P0 条件触发 | TAG-000/FORMAT-002 |
| LA-LEGACY-001 | 一次性 Legacy CAT Parity Audit | P1 | MASTER-000/TAG-000 |
| LA-QUALITY-001 | Execution Policy 取代质量档位 | P0 | SYNC-007 |
| LA-QUALITY-002 | 零预支质量合同 | P0 | QUALITY-001 |
| LA-PROMPT-001 | Canonical Prompt Contract / Renderer | P0 | QUALITY-002 |
| LA-PROMPT-002 | 全局 Prompt Budget / Evidence / Degraded | P0 | PROMPT-001 |
| LA-MEMORY-001 | 3E Project Knowledge Store | P1 | PROMPT-001 |
| LA-MEMORY-002 | 动态 Knowledge Retrieval | P1 | MEMORY-001 |
| LA-TRANS-001 | Translation Scope / Coverage Ledger | P0 | QUALITY-002 |
| LA-TRANS-002 | Translate–Estimate–Refine Harness | P0 | TRANS-001/PROMPT-002 |
| LA-REVIEW-001 | Reviewer 改名 Proposal Critic | P0 | QUALITY-002 |
| LA-REVIEW-002 | Full Review Scope / Ledger | P0 | TRANS-001 |
| LA-REVIEW-003 | Source-first Review Tools | P0 | REVIEW-002 |
| LA-REVIEW-004 | Full-Scope Reviewer / Review Proposals | P0 | REVIEW-003/PROMPT-002 |
| LA-REVIEW-005 | Structured Audit Report | P1 | REVIEW-002 |
| LA-CORRECT-001 | Tool root schema Object contract | P0 | SYNC-007 |
| LA-CORRECT-002 | Numeric lexical ambiguity | P0 | SYNC-007 |
| LA-CORRECT-003 | Term status / match policy | P0 | SYNC-007 |
| LA-CORRECT-004 | ICU / Placeholder profiles | P1 | CORRECT-003 |
| LA-CONTEXT-001 | Snapshot-bound Cursor / Project Rules | P0 | PROMPT-002 |
| LA-CONTEXT-002 | Minimum Context / no empty Source | P0 | CONTEXT-001 |
| LA-CONTEXT-003 | Turn Scope V2 / Scope Snapshot | P1 | CONTEXT-001 |
| LA-DATA-001 | QA complete Change Set / Outbox | P0 | SYNC-007 |
| LA-DATA-002 | Session/Message Codec + Quarantine | P1 | SYNC-007 |
| LA-DATA-003 | Toolset / Prompt / Review Provenance | P1 | PROMPT-001 |
| LA-RUNTIME-001 | Linguist Session inherit Proma defaults | P0 | SYNC-007/QUALITY-001 |
| LA-JOB-001 | Unified Chunked Job Engine | P1 | INTAKE-004 |
| LA-JOB-002 | Chunked QA / Consistency / Integrity | P1 | JOB-001 |
| LA-JOB-003 | Chunked Translation / Full Review | P1 | JOB-001/TRANS-002/REVIEW-004 |
| LA-JOB-004 | Compaction State Capsule | P1 | JOB-003 |
| LA-PERF-001 | Batch IPC / N+1 收口 | P1 | SYNC-007 |
| LA-PERF-002 | 1k/10k/50k 性能 Fixture | P1 | JOB-002/003 |
| LA-OBS-001 | Trace / Metrics / Privacy Diagnostics | P2 | JOB-001 |
| LA-RESILIENCE-001 | Backup/Restore/Export 故障注入 | P1 | SYNC-007 |
| LA-UI-001 | Cache / Undo / Selection / Aggregate Status | P2 | HOST-005 |
| LA-EVAL-001 | Web Chat / 旧 LA / 新 LA 基准 | P0 | TRANS-002/REVIEW-004 |
| LA-EVAL-002 | Prompt/Model Regression Harness | P0 | EVAL-001 |
| LA-EVAL-003 | 真实格式 Round-trip / Provider Matrix | P1 | FORMAT-003/004 |
| LA-EVAL-004 | 14 天日用与人工 Gate | P0 | 全部核心阶段 |
| LA-UPSYNC-001 | Proma Sync Bot / Impact Report | P1 | SYNC-006/HOST-005 |
| LA-DOCS-001 | README/ADR/旧蓝图/产品文案统一 | P0 | QUALITY/REVIEW 完成 |

---

# 15. Ticket 详细定义

## LA-MASTER-000 — 当前事实与计划唯一性

**目标**：让实施者只依据本蓝图和当前代码事实工作。

**交付**：

- `CURRENT_FACTS.md`；
- 旧蓝图全部标记 superseded；
- 本计划进入仓库；
- 生成 `la-unified-queue.json`；
- 当前全套测试结果。

**验收**：仓库搜索 `Fast Strategy`、旧蓝图路径和旧实施队列时，不会出现多个同时标为 active 的计划。

**非目标**：本 Ticket 不修改生产代码。

---

## LA-SYNC-001 — 同步前保护

**目标**：确保合并失败、数据库损坏或打包升级都可恢复。

**交付**：

- clean worktree；
- `pre-proma-0.16.8-sync` tag；
- 用户数据和 CAT 项目备份；
- backup manifest/hash；
- `sync/proma-v0.16.8` branch。

**验收**：从备份恢复到独立测试 userData 后，至少能打开一个真实项目副本。

---

## LA-SYNC-002 — 正式合并 Proma v0.16.8

**目标**：保留完整上游历史和共同祖先。

**交付**：一次 `--no-ff` merge，生成初始冲突清单和 subsystem ownership report。

**验收**：`git log --graph` 清晰显示 Proma v0.16.8 merge parent；无 cherry-pick 伪同步。

---

## LA-SYNC-003 — Runtime / Session 合并

**目标**：完整继承 Compaction/overflow continuation、retry、Vision Relay、runtime/model setting lifecycle、delegation、Stop、外部拖入 `@file` 与标题生成加固。

**实施规则**：

- 上游代码先成立；
- Linguist 通过 profile hook 加 tools/prompt/CWD；
- 不复制 retry/compaction；
- 保留 Session metadata migration。

**验收**：普通 Agent 与 LA 使用同一 Runtime 测试；模拟 compaction 后 LA Job 继续，Stop 不消失。

---

## LA-SYNC-004 — Agent Surface / Sidebar / Settings 合并

**目标**：采用上游 v0.16.8 的 Composer、Slash、References、File Panel、Vision Relay、Settings Workspace、Hover Preview 与拖入 `@file` 链路。

**交付**：

- Agent Surface 只有一套；
- Sidebar Shell/Contribution；
- Settings Section registry；
- LA Rail/Full presentation；
- 无旧 Settings Dialog 复制。

**验收**：Host Parity 初始 smoke；普通 Agent 和 Chat 无回归。

---

## LA-HOST-000 — 本地 Extension Registry

**目标**：降低以后合并冲突，但不建设运行时插件平台。

**交付**：

- `PromaExtension`；
- `AgentProfileContribution`；
- `AppModeContribution`；
- `AgentSurfaceContext`；
- `SettingsContribution`；
- 初始 `IpcModuleContribution`；
- composition root 注册 Linguist。

**约束**：只在 LA repo；不得向 Proma 提 PR。

**验收**：除 composition root/host contracts 外，不新增 Proma Core → Linguist 反向 import。

---

## LA-SYNC-005 — Electron 43 与依赖重建

**目标**：真实验证平台升级，不把依赖冲突当机械文本问题。

**交付**：

- Electron 43.2.0；
- Pi / Claude SDK 与上游一致；
- lockfile 重建；
- SBOM/NOTICE；
- runtime deps pack；
- macOS arm64 package。

**验收**：`node:sqlite`、Worker、ASAR、PDF/Excel、CAT Store、Backup/Restore smoke 全过。

---

## LA-SYNC-006 — Baseline 与 Deviation 重置

**目标**：让下一次同步只看到 v0.16.8 之后的 LA 差异。

**交付**：

- 新 `proma-baseline.json`；
- 新 touchpoint ledger；
- `PROMA_DEVIATIONS.md/json`；
- About version metadata；
- stale touchpoint 删除。

**验收**：boundary test 使用新 baseline；所有登记项相对新基线确实存在。

---

## LA-SYNC-007 — v0.16.8 Release Gate

**目标**：建立可用的新基础版本。

**验收**：第 5.8 节全部命令、macOS packaged smoke、旧数据 smoke、Vision Relay、`@file`、标题与 Host feature smoke 全绿。

**停止条件**：该 Ticket 未完成前，不开始大规模 Prompt/Intake UI 改造。

---

## LA-HOST-001 — Session-scoped Reference

**目标**：修复 LA 中“为 Agent 引用”不可见/串会话。

**交付**：

- reference atom family；
- unified reference model；
- Composer/Selection/Send 同一 sessionId；
- unit + embedded host test。

**验收**：两个 LA Session 和一个普通 Agent 并行引用，不串数据。

---

## LA-HOST-002 — Companion Chat Host

**目标**：“打开右侧问答”在 LA 真正显示。

**交付**：

- shared companion panel host；
- session-scoped panel state；
- Rail auto-expand；
- 保持 Linguist mode。

**验收**：按钮点击后新 Chat 可见、引用存在、关闭/重开状态正确。

---

## LA-HOST-003 — Auto-title

**目标**：普通 Agent 和 LA 都有可读任务标题。

**交付**：Title service、origin metadata、fallback、manual lock、regenerate action。

**验收**：首轮后自动命名；手动标题永不被覆盖；路径不泄露。

---

## LA-HOST-004 — Host Capability Manifest

**目标**：组件知道当前 Host 能显示什么，不靠 appMode 猜。

**验收**：无效 capability 不显示无效按钮；Rail 需更大空间时自动展开。

---

## LA-HOST-005 — Embedded Host Parity Suite

**目标**：未来 Proma 新功能不能在 LA 中半接入。

**交付**：第 6.6 节矩阵自动测试 + packaged smoke checklist。

**验收**：人为新增一个 canary Proma capability，LA Rail/Full 自动继承或测试明确失败。

---

## LA-INTAKE-001 — ProjectIntakeCoordinator

**目标**：UI/Agent/未来自动化共享导入业务逻辑。

**验收**：Coordinator 不依赖 Renderer；UI 旧导入流程可经它完成；Agent 尚未暴露工具也能在测试调用。

---

## LA-INTAKE-002 — Scanner / Classifier

**目标**：识别文件角色、格式、语言和支持状态。

**验收**：对混合 synthetic directory 产生稳定 CandidateSet；损坏/伪扩展名文件不误识别。

---

## LA-INTAKE-003 — Duplicate / Lineage / Plan

**目标**：避免重复导入和误覆盖版本。

**验收**：exact duplicate、delivery、source-vs-bilingual、revision-of 均有 fixture；Plan hash 可重现。

---

## LA-INTAKE-004 — Durable Import Job

**目标**：导入可追踪、可取消、可恢复、幂等。

**验收**：中途 crash 后 resume，无重复资源；cancel 后 Summary 精确。

---

## LA-INTAKE-005 — Agent Intake Tools

**目标**：Agent 能结构化 Scan/Plan/Execute/Get/Cancel/Verify。

**验收**：用户给出真实目录副本，只用 Agent 完成受支持资源导入；不通过 Bash 直接写 DB。

---

## LA-INTAKE-006 — UI 共用 Intake

**目标**：UI 与 Agent 导入结果完全一致。

**验收**：同一 fixture 通过 UI/Agent 产生相同 Plan 和 Store state。

---

## LA-INTAKE-007 — Verification / Undo

**目标**：导入不以“Parser 没报错”作为完成。

**验收**：Verification 可发现数量/语言/hash/缺失不一致；有下游引用时 Undo 被正确拒绝。

---

## LA-FORMAT-001 — 私有 Corpus Scanner

**目标**：用真实工作目录决定格式路线。

**验收**：扫描用户指定路径，报告不含正文，不进入 Git，公开日志不泄露客户信息。

---

## LA-FORMAT-002 — 格式矩阵

**目标**：形成 detect/import/export/roundtrip 的真实频率矩阵。

**交付**：私有详细报告 + 可提交的脱敏结论。

**验收**：后续 Adapter Ticket 必须引用真实数量和阻断场景。

---

## LA-FORMAT-003 / 004 — 高频 TM / TB Adapter

**目标**：根据扫描结果支持最有价值格式；预期候选包括 SDLTM/SDLTB，但不预先假定实现方式。

**实施前置**：研究容器、版本、许可、损坏行为和可否可靠 round-trip。

**验收**：synthetic fixture、真实私有副本导入、条目计数、locale、duplicate、corruption tests。

**非目标**：为追求“格式数量”实现无法可靠验证的半解析器。

---

## LA-TAG-000 — PB-097 事实核验与统一 Tag Model

**目标**：确认现有 Regex/Profile 引擎并让 Editor、Proposal、QA、Review、Export 共用同一 Scanner。

**验收**：不得重复实现；项目自定义 Profile 在编辑器中也可见；架构测试禁止第二套生产 Token regex。

## LA-TAG-001 — Deterministic + LLM Tag Discovery

**目标**：从真实项目发现未登记疑似 Tag，由 LLM 提议 Profile，由 Validator 判定。

**验收**：有正反例、ReDoS、空匹配、误报率、全项目 dry-run；LLM abstain 可持久化；无自动永久启用。

## LA-TAG-002 — Candidate lifecycle / Validator / UI

**目标**：建立 new/proposed/approved/rejected/disabled/versioned 生命周期和项目管理 UI。

**验收**：重扫不覆盖人工状态；批准后所有 CAT 子系统立即使用同一版本；有 provenance。

## LA-TAG-003 — 编辑器原子 Tag 保护

**目标**：Tag 作为不可拆 Token 操作，保留 IME、粘贴、undo/redo、键盘和无障碍。

**验收**：required token 不会被无意拆坏；Source 插入、pair 关联和 candidate 视觉可用；保存前硬验证仍保留。

## LA-PHRASE-001 — master-XLIFF pairing / rehydration

**目标**：恢复旧 LA 的 Phrase split/master 配对与 `{n}` → 真实 inline code 恢复。

**验收**：配对证据、版本/segment/signature 校验、阻断式错误、changed/unchanged round-trip fixture；正式 Phrase 交付前完成。

## LA-LEGACY-001 — 一次性 Legacy CAT Parity Audit

**目标**：逐项对照旧 LA 与新 LA，分类 A/B/C/D；不直接实现全部功能。

**验收**：输出 `LEGACY_CAPABILITY_AUDIT.md`、证据、决策和唯一 Ticket；审计后冻结，不再重写总蓝图。

## LA-QUALITY-001 — Execution Policy 迁移

**目标**：取消质量档位，质量统一，成本由模型/思考/二审等控制。

**交付**：Schema、Settings、Session migration、UI、Provenance。

**验收**：旧 Fast/Balanced/Best Session 可读；新 Session 不再写 quality tier；项目默认不改变旧会话。

---

## LA-QUALITY-002 — 零预支质量合同

**目标**：所有角色都承担本轮最终质量责任。

**验收**：Prompt golden tests 不含“初稿”“合理检查即可”“后续会审”式降级；角色专属 Prompt 都引用同一 Contract version。

---

## LA-PROMPT-001 — Canonical Contract / Renderer

**目标**：一个语义规范，多模型适配表达。

**交付**：typed Prompt Contract、reasoning/generic/XML renderers、version/hash tests。

**验收**：不同 renderer 的语义字段等价；不存在某 Provider 独有的质量降级。

---

## LA-PROMPT-002 — Budget / Evidence / Degraded

**目标**：Prompt 可预测、证据顺序正确、缺失语义诚实。

**验收**：极端 fixture 下总预算不超；mandatory rule 不被普通用户任务描述覆盖；Reviewer 缺 Scope 时不能 pass。

---

## LA-MEMORY-001 — 3E Knowledge Store

**目标**：持久化 Essence/Exemplar/Entity。

**验收**：candidate 与 approved 状态分离；接受的 Proposal 可生成 Exemplar 候选但不自动批准错误事实。

---

## LA-MEMORY-002 — 动态检索

**目标**：按 Segment 取高信号项目证据，而非全量注入。

**验收**：同角色/同功能/同实体的已接受范例排序靠前；低质量/被拒绝范例不进入正式 Context。

---

## LA-TRANS-001 — Translation Scope / Ledger

**目标**：不漏段，不靠模型自报完成。

**验收**：服务器端完成等式；pending/failed 未解释时拒绝 finalize；UI 显示精确覆盖。

---

## LA-TRANS-002 — TEaR Harness

**目标**：Translate–Estimate–Refine + deterministic QA 成为统一翻译流程。

**验收**：每个 Proposal 可追溯 draft/estimate/refine/QA；不是要求模型输出思维过程；失败可恢复。

---

## LA-REVIEW-001 — Proposal Critic 重命名

**目标**：消除“局部 Proposal 检查 = 完整审校”的误导。

**验收**：UI、Tool、Artifact、统计、Prompt 全部使用 Proposal Critic；兼容旧 reviewer artifact 读取。

---

## LA-REVIEW-002 — Full Review Scope

**目标**：创建完整 Asset/Selection/Project 审校范围和 Ledger。

**验收**：Scope 固定 Segment IDs/revisions；没有 Proposal 的 Segment 也在范围内。

---

## LA-REVIEW-003 — Source-first Tools

**目标**：先独立理解 Source，再揭示 Target/Proposal。

**验收**：阶段 A API 不返回 Target/Proposal；未提交 Source Brief 不能进入阶段 B；snapshot hash 防漂移。

---

## LA-REVIEW-004 — Full-Scope Reviewer

**目标**：发现任何材料性问题并能为任意 Segment 创建 Review Proposal。

**验收**：测试中一个错误 Segment 没有旧 Proposal，Reviewer 仍能发现并修订；未覆盖全范围无法 pass。

---

## LA-REVIEW-005 — Structured Audit

**目标**：审计有正式 Artifact，不只是聊天文本。

**验收**：Audit Report 含 scope/evidence/coverage/findings/limitations/provenance；证据缺失返回 inconclusive。

---
## LA-CORRECT-001 — Root Tool Schema Contract

**目标**：完整 CAT Toolset 可被所有启用 Runtime 适配。

**验收**：真实 standard/audit/intake/review Toolset 遍历测试；无 root union；错误输入返回结构化 validation error。

---

## LA-CORRECT-002 — Numeric Ambiguity

**目标**：消除 May/March/First/August/One 等硬误杀。

**验收**：自然语言用例不阻断；明确日期/数值仍受保护；中英日期和章节 fixture 全过。

---

## LA-CORRECT-003 — Term Status / Match

**目标**：required/preferred/forbidden 语义统一，英文边界不误命中。

**验收**：`art` 不匹配 `start`；CJK 连续词可匹配；空 Term 被拒绝；QA/Proposal/Prompt 结论一致。

---

## LA-CORRECT-004 — ICU / Placeholder Profiles

**目标**：成熟 AST/Tokenizer 取代高风险万能正则。

**验收**：nested plural/select、apostrophe escaping、printf variants、XML/HTML、Mustache、游戏 Token fuzz tests。

---

## LA-CONTEXT-001 — Snapshot Cursor / Project Rules

**目标**：分页 Context 不混合项目版本，`includeProjectRules` 不再 no-op。

**验收**：第一页后修改 TB/Segment，再取下一页返回 `CONTEXT_DRIFT`；规则数据真实出现或参数被删除。

---

## LA-CONTEXT-002 — Minimum Context

**目标**：不能在没有 Source 的情况下消耗 Segment。

**验收**：极低预算返回 minimumRequiredBytes 且 cursor 不推进；完整 Source 永不半截标记已读。

---

## LA-CONTEXT-003 — Turn Scope V2

**目标**：UI 选择、Run Scope 和数据 Snapshot 语义分开。

**验收**：运行中切换 Grid 选择不改变已开始 Job；source/target hash/revision 可追踪。

---

## LA-DATA-001 — QA Complete Change Set

**目标**：自动 resolved Finding 进入 Outbox 和 UI。

**验收**：重跑使旧 finding resolved 时，event 包含 ID；Renderer 无需全量刷新即可更新。

---

## LA-DATA-002 — Session Codec / Quarantine

**目标**：磁盘单条损坏不拖垮整个 App。

**验收**：损坏一个 Session/JSONL，其他 Session 可加载；报告脱敏；可导出/删除 quarantine。

---

## LA-DATA-003 — Provenance

**目标**：正确记录 Prompt、Model、Runtime、Context、Toolset，不作虚假完整性声称。

**验收**：ToolsetProvenance 分拆；review/audit/import/translation 均可追溯；version/hash 不混用。

---

## LA-RUNTIME-001 — 继承 Proma 默认 Runtime

**目标**：新 LA Session 自动使用 Proma 当前模型、reasoning 和 permission 默认。

**验收**：更改 Proma 默认后新 LA Session 继承；旧 Session 保持冻结；不硬编码 Pi。

---

## LA-JOB-001 — Unified Chunked Job Engine

**目标**：建立通用 durable chunk/checkpoint/cancel/resume 基础。

**验收**：第 3 chunk 后 crash，重启从第 4 chunk 开始；duplicate invocation 不重复副作用。

---

## LA-JOB-002 — Chunked QA / Consistency / Integrity

**目标**：Main 不全量读取大项目，Worker 按 keyset chunk。

**验收**：50k fixture 有持续进度、低峰值、可取消；结果与小规模同步实现一致。

---

## LA-JOB-003 — Chunked Translation / Review

**目标**：LLM 长任务由外部 Scope/Ledger 管理，Compaction 不丢进度。

**验收**：Provider 中断只重试当前 chunk；人工编辑造成 stale 时不覆盖；Coverage 准确。

---

## LA-JOB-004 — Compaction State Capsule

**目标**：利用 Proma 0.16.8 继续能力，但不依赖压缩后的自然语言记忆。

**验收**：人为触发 compaction 后，Job ID/Scope/Ledger/未解决项保持；没有重复 Proposal。

---

## LA-PERF-001 — Batch IPC / N+1

**目标**：Proposal、Segment、Review、Job 列表按页/批量获取。

**验收**：20 条 Proposal 页面不是 21 次 IPC；200 段确认不爆发 200 次请求。

---

## LA-PERF-002 — 性能 Fixture

**目标**：性能回归成为 CI/本地 Gate。

**验收**：1k/10k 快速套件可在 CI 跑；50k 本地基准记录 event loop lag、memory、throughput。

---

## LA-OBS-001 — Trace / Diagnostics

**目标**：出现漏段、卡死、导入失败时能定位，不泄露客户文本。

**验收**：单个 Run 可串起 session/job/tool/transaction/event；诊断包默认无正文/绝对路径/API Key。

---

## LA-RESILIENCE-001 — 数据与文件故障注入

**目标**：在 Electron 43 和 Intake/Job 新路径下重验 Backup/Restore/Export。

**验收**：磁盘满、WAL、symlink、崩溃、rollback 失败等场景有自动/手动证据。

---

## LA-UI-001 — 前端生命周期收口

**目标**：长时间使用不积累 Atom/Undo/Session cache；批量行为不静默。

**验收**：500 次打开关闭内存趋稳；Undo 有预算；超过选择上限明确提示并可拆批。

---

## LA-EVAL-001 — 三组质量基准

**目标**：建立 Web Chat A、旧 LA B、新 LA C 的同模型对照。

**验收**：冻结数据、模型、reasoning、Prompt、评分表；结果盲化；可复跑。

---

## LA-EVAL-002 — Prompt / Model Regression Harness

**目标**：任何 Prompt、模型或上游 Runtime 更新前后都能量化比较。

**验收**：每次变更输出 quality/cost/coverage/false-positive diff；失败阻止“效果提升”声明。

---

## LA-EVAL-003 — Provider / Format Matrix

**目标**：真实 Provider Tool Loop 和真实 CAT Round-trip。

**验收**：至少覆盖当前用户主要 Provider、当前高频格式、macOS packaged App；失败有明确限制。

---

## LA-EVAL-004 — 14 天日用

**目标**：从高级 Alpha 进入可信个人生产工具。

**验收**：完整私有报告；阻断问题清零或有明确 workaround；列出仍需返回 Web Chat 的场景。

---

## LA-UPSYNC-001 — 本地 Sync Bot

**目标**：下次 Proma 更新自动开 LA repo PR 和影响报告。

**验收**：使用一个模拟上游 tag 跑全流程；不会向 Proma repo 写入；不会自动发布安装包。

---

## LA-DOCS-001 — 文档和产品语义统一

**目标**：代码、README、Help、Tooltip、Skills 和架构文档讲同一套事实。

必须更新：

- LA = Proma Base + Linguist Extension；
- full-power Agent；
- Proposal 是最佳建议版本，不是初稿；
- Proposal Critic vs Full-Scope Reviewer；
- 统一专业质量目标；
- Execution Policy；
- Project Intake；
- 可撤销范围；
- Proma Base version；
- 暂不公开发布/贡献上游。

**验收**：仓库搜索旧术语不会发现活动 Prompt 仍把 Fast 定义为初稿或把 Reviewer 定义为唯一完整审校。

---

# 16. 数据模型与 API 迁移清单

## 16.1 Session Metadata

目标：

```ts
interface LinguistAgentProfileV3 {
  kind: 'linguist';
  projectId: string;
  role:
    | 'translator-editor'
    | 'proposal-critic'
    | 'full-scope-reviewer'
    | 'auditor'
    | 'project-intake';
  executionPolicy: ExecutionPolicy;
  promptContractVersion: string;
}
```

迁移：

- 旧 `assistant` → `translator-editor`；
- 旧 `reviewer` → 根据 Session/Artifact 用途迁为 `proposal-critic`，不要自动声称 full-scope；
- 旧 `auditor` 保留；
- 旧 strategy → execution policy；
- 无法判断时保留 legacy marker 并在 UI 提示创建新 Session。

## 16.2 Review Tables

建议：

```text
review_scopes
review_scope_segments
source_review_briefs
scope_reviews
review_findings
review_proposals
review_coverage_events
```

现有 Critic Artifact 不删除；继续作为 `proposal_critic_reviews` 或兼容 view。

## 16.3 Translation Job Tables

```text
translation_scopes
translation_scope_segments
translation_attempts
translation_estimates
translation_refinements
translation_coverage_events
```

不要存私有 Chain-of-Thought；只存结构化质量分类、证据和最终可审计结果。

## 16.4 Project Memory Tables

```text
project_essences
project_entities
project_entity_aliases
project_exemplars
project_memory_events
```

所有自动抽取内容有 `candidate/approved/rejected/deprecated` 状态和 provenance。

## 16.5 Intake Tables

```text
intake_scans
intake_candidates
intake_plans
intake_plan_actions
import_jobs
import_job_items
import_verification_reports
resource_lineage
```

绝对源路径默认不写长期数据库；保存受控 path token / display name / hash。若需要恢复，使用安全 bookmark 或明确用户授权路径。

## 16.6 Tag Intelligence Tables

建议：

```sql
tag_profiles (
  profile_id, project_id, version, family_name, regex_source, flags,
  kind, required, status, origin_type, origin_ref,
  validator_version, created_at, approved_at, disabled_at
);

tag_pattern_candidates (
  candidate_id, project_id, shape_signature, deterministic_score,
  status, proposal_json, model_id, prompt_hash, created_at
);

tag_candidate_occurrences (
  occurrence_id, candidate_id, asset_id, segment_id,
  source_span_json, sample_hash, observed_at
);

tag_candidate_status_events (
  event_id, candidate_id, from_status, to_status,
  actor_type, actor_id, reason, created_at
);

phrase_master_bindings (
  binding_id, split_asset_id, master_digest, strategy_version,
  confidence, verified, created_at
);

phrase_tag_rehydration_map (
  binding_id, segment_stable_id, placeholder_ordinal,
  master_inline_code_id, raw_fragment_ref, source_signature
);
```

不得在重扫时用 REPLACE 清除人工拒绝/禁用历史。

## 16.7 Migration 纪律

- 只读 preflight；
- backup；
- transaction；
- schema marker；
- forward migration；
- 不支持 downgrade 时明确阻止旧版本打开；
- migration fixture 包括当前真实 schema 副本；
- App 崩溃后可检测 migration-in-progress 并恢复/回滚。

---

# 17. 测试总矩阵

## 17.1 Architecture Contracts

- Proma Core 不新增任意 Linguist import；
- Base Tool canary 自动进入 LA；
- Linguist Overlay 不覆盖同名 Proma Tool；
- AgentView/Composer/SidePanel 只有一套；
- App Mode/Settings/IPC 通过本地 registry；
- old blueprints 非 active。

## 17.2 Upstream Sync

- merge ancestry；
- baseline metadata；
- deviation ledger；
- dependency/lock/SBOM；
- Electron runtime；
- old data compatibility；
- Proma 0.16.8 user features。

## 17.3 Host Parity

覆盖第 6.6 节全部功能和三种 Host。

## 17.4 Intake

- mixed directory；
- nested folders；
- exact duplicate；
- same corpus different version；
- unsupported format；
- corrupted file；
- wrong extension；
- language mismatch；
- cancel/retry/crash；
- UI/Agent equivalence；
- verify mismatch；
- undo allowed/denied。

## 17.5 Translation

- zero-deferral Prompt；
- scope coverage；
- TEaR steps；
- QA fix loop；
- stale revision；
- blocked ambiguity；
- compaction continuation；
- retry idempotency；
- user edit concurrency。

## 17.6 Full Review

- Source-first withholding；
- no-proposal hidden error；
- full coverage；
- pass/issues/abstain；
- severity；
- preference false positive；
- stale snapshot；
- review proposal；
- auditor inconclusive。

## 17.7 Tag / Phrase

- built-in / approved / candidate trust priority；
- project profile 与 editor scanner 一致；
- deterministic discovery 正反例；
- LLM proposal schema / abstain；
- ReDoS、空匹配、宽泛 regex、重叠；
- Candidate status event 保留；
- IME、粘贴、undo/redo、selection；
- Source 插入和 required token；
- Phrase split/master 配对、错配、多候选；
- `{n}` 映射、pair/nesting、round-trip；
- property-based/fuzz token preservation。

## 17.8 Rules

- May/March/August/First/One；
- date/chapter/rank/numeric tokens；
- required/preferred/forbidden matrix；
- word boundary/CJK；
- ICU/printf/XML/Mustache；
- locale-aware source=target；
- locked findings；
- property-based/fuzz。

## 17.9 Context / Prompt

- total budget；
- layer truncation；
- evidence precedence；
- degraded role semantics；
- cursor drift；
- minimum context；
- project rules；
- digest cache；
- canonical serialization；
- provider renderers semantic parity。

## 17.10 Data / Recovery

- QA auto-resolve event；
- Session quarantine；
- Job crash；
- DB busy；
- disk full；
- Backup/Restore；
- symlink；
- migration；
- outbox gap；
- packaged App restart。

## 17.11 Evals

- Web Chat / old LA / new LA；
- model/reasoning matrix；
- hidden target errors；
- long context；
- reviewer discovery/false positives；
- technical integrity；
- cost/latency；
- repeated-run variance。

---

# 18. Release Gate 与阶段性版本

建议内部里程碑：

```text
M0 — Proma 0.16.8 Base Sync
M1 — Embedded Host Parity
M2 — Agent Project Intake
M3 — Professional Quality Contract + Translation Ledger
M4 — Full-Scope Review
M5 — Chunked Long-task Reliability
M6 — Qualified Personal Alpha
```

每个里程碑只有在对应 Phase Gate 完成后打 tag。不得因为“代码都写完了”跳过真实 packaged smoke 和数据副本验证。

---

# 19. 实施 Agent 的硬性工作纪律

## 19.1 先验证，再改

每个 Ticket 开始时先提交“当前事实”：

```text
相关文件
当前行为
失败复现
已有测试
是否已被 v0.16.8 解决
最小变更面
数据迁移风险
```

## 19.2 一次一个可验证 Slice

推荐：

```text
一个 Ticket
→ 一个或少量逻辑紧密的 commits
→ 测试
→ packaged smoke（需要时）
→ 更新 queue
```

禁止在修引用时顺手重写 Prompt、Store 和 Settings。

## 19.3 不做无关重构

- 不创建第二套 Agent；
- 不复制 Proma 组件；
- 不建设通用插件市场；
- 不向 Proma 官方发 PR；
- 不在没有真实数据前开发大量低频格式；
- 不为测试方便读取/提交客户正文；
- 不用大规模命名/格式化变化污染上游 merge。

## 19.4 数据安全

- 所有 destructive 测试用临时 userData；
- 真实项目只在副本上跑 migration；
- corpus scan 私有；
- 日志脱敏；
- 任何 schema migration 有 backup/rollback；
- Agent 不得通过脚本直接改真实 `cat.db` 以绕开服务层。

## 19.5 测试证据

完成报告模板：

```markdown
## Ticket

### Current facts

### Implemented

### Files changed

### Migration

### Tests

### Packaged smoke

### Data compatibility

### Remaining risk

### Commit SHA
```

## 19.6 失败时的行为

若遇到大范围不确定性：

- 不宣布完成；
- 保留已通过的独立 Slice；
- 将阻断写入 queue；
- 给出最小复现和证据；
- 不通过删测试、放宽断言或跳过 Gate 取得绿色。

---

# 20. 明确不做


- 不因为 Proma 发布节奏快就跟踪 upstream main；只同步官方 stable tag。
- 不为企业 Skills 分发复制闭源/商业功能。
- 不重写 PB-097 已存在的正则执行引擎。
- 不让 LLM 未经 Validator 和人工批准直接永久锁定未知模式。
- 不把所有旧 LA 功能重新塞回新 LA。
- 不在真实格式证据缺失时开发长尾 Adapter。
- 不让 Phrase rehydration 在配对不确定时静默猜测。

本蓝图不包含：

- 向 Proma 官方贡献；
- 可安装第三方插件平台；
- 多用户云端协作；
- 企业合规审计系统；
- 严格 CAT-only 权限沙箱；
- 移除 Proma Agent/Chat/MCP/Skills；
- 为追求数量支持所有 CAT 格式；
- 自动接受所有 Proposal；
- 自动发布公开安装包；
- 将用户私有工作目录上传到 CI 或公开仓库；
- 以多 Agent 数量替代质量评估；
- 强制输出模型思维链。

---

# 21. 最终 Definition of Done

## 架构

- LA 使用 Proma 0.16.8 完整基座；
- Linguist 是本地 compile-time extension；
- Base tools 自动继承；
- Host touchpoints 收窄且有 Contract；
- 新上游 tag 可自动开同步 PR。

## UI / Host

- Rail/Full 保持 Linguist 身份；
- Reference、Side Q&A、File Panel、Slash、Stop、Model、Reasoning 全部等价；
- Session 自动命名和管理完整。

## Intake

- Agent 能从真实目录 Scan/Plan/Import/Verify；
- UI 和 Agent 共用服务；
- 当前支持格式全部开放；
- 高频缺失格式由真实 corpus 数据决定；
- 导入可恢复、可追踪、可验证。

## Tag / Phrase

- Native/Profile/Candidate 使用统一 Tag Model；
- 编辑器提供真正的原子保护或经过 Gate 的等价实现；
- 自动 discovery 可解释、可验证、可审批、可禁用；
- 未登记疑似 Tag 不再只能靠用户手写 regex；
- Phrase split/master 可稳定配对和恢复；
- 无法证明正确时导出阻断而不是猜测；
- Legacy audit 完成并冻结范围。

## 翻译

- 所有任务统一专业质量目标；
- 没有 Fast=初稿；
- Translate–Estimate–Refine；
- deterministic QA；
- Coverage Ledger；
- 不漏段，不虚假完成。

## 审校

- Proposal Critic 与 Full-Scope Reviewer 分开；
- Full Review 先 Source 后 Target；
- 检查无 Proposal Segment；
- 完整覆盖；
- severity 和 preference 纪律；
- Structured Audit。

## 正确性

- 已知数字、术语、Context、Prompt Budget、Outbox、Session Codec 等问题有回归测试；
- Tool Schema 对启用 Runtime 可用；
- Session 继承 Proma 默认；
- Provenance 诚实。

## 稳定性

- 长任务真正 chunked；
- Compaction、重试、取消、崩溃恢复；
- 10k/50k 性能基准；
- Electron 43 packaged App 稳定；
- Backup/Restore/Export 故障验证。

## 价值证明

- 同模型、同 reasoning 的新 LA 相对 Web Chat 有可测量优势；
- 真实游戏文本盲评通过；
- 14 天个人日用通过；
- 剩余限制诚实记录。

---

# 22. 给实施 Agent 的启动指令

```text
你正在实施《Linguist Agent 统一实施总蓝图》。

本文件是唯一权威计划；所有旧蓝图均已作废。
先执行 LA-MASTER-000，输出 CURRENT_FACTS.md，不得直接开始改代码。

硬约束：
1. 只修改当前 Linguist Agent 仓库；不得向 Proma 官方创建 Issue/PR/提交。
2. 先正式 merge Proma v0.16.8，再做后续大改。
3. 不创建第二套 Agent Runtime，不复制 Proma Agent UI，不删 Proma 通用能力。
4. Linguist 必须自动继承 Proma 当前和未来的通用工具，再叠加 CAT 能力。
5. 取消 Fast/Balanced/Best 的质量等级；所有翻译和审校以专业交付为目标。
6. 后续审校不能成为前序降低标准的理由。
7. 现有 Reviewer 改名 Proposal Critic；新增完整范围、Source-first 的 Full-Scope Reviewer。
8. Project Intake、Coverage Ledger、Prompt/Context、Job 状态必须由 Harness/Store 保证，不能只写进 Prompt。
9. 用户私有 CAT 目录只做本地隐私安全扫描，不提交客户内容。
10. 每个 Ticket 先核验当前事实；已实现则提供证据，不重复重写。

严格按 Phase 0 → 1 → 2 → 2B → 3 → 4 → 5 → 6 → 7 的依赖推进。
每完成一个 Ticket，按本文件模板提交证据并更新机器队列。
```

---

# 23. 研究与事实依据

## 当前项目与上游

- Proma Releases：`https://github.com/proma-ai/Proma/releases`
- Proma v0.16.8：`https://github.com/proma-ai/Proma/releases/tag/v0.16.8`
- Proma v0.16.8 tag commit：`https://github.com/proma-ai/Proma/commit/bde00f00323d6735a939d14dbce3b2f1a5b672bc`
- Proma v0.16.1...v0.16.8 Compare：`https://github.com/proma-ai/Proma/compare/v0.16.1...v0.16.8`
- Proma 公开 LA baseline...v0.16.8 Compare：`https://github.com/proma-ai/Proma/compare/702a8221bdeb6f3db7dc514b8e93e2a5a52f68df...bde00f0`
- Proma v0.16.8 Electron manifest：`https://raw.githubusercontent.com/proma-ai/Proma/v0.16.8/apps/electron/package.json`
- LA repository：`https://github.com/wangyu-sg/linguist-agent-public`
- LA upstream baseline：`docs/architecture/UPSTREAM_BASELINE.md`
- LA core touchpoints：`docs/architecture/PROMA_CORE_TOUCHPOINTS.md`

## Prompt / Agent Engineering

- OpenAI, Reasoning best practices：`https://developers.openai.com/api/docs/guides/reasoning-best-practices`
- OpenAI, Prompt engineering：`https://developers.openai.com/api/docs/guides/prompt-engineering`
- OpenAI, Model guidance：`https://developers.openai.com/api/docs/guides/latest-model`
- Anthropic, Effective context engineering for AI agents：`https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents`
- Anthropic, Writing effective tools for agents：`https://www.anthropic.com/engineering/writing-tools-for-agents`
- Anthropic, Effective harnesses for long-running agents：`https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`
- Anthropic, Demystifying evals for AI agents：`https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents`

## CAT Tag / Format Standards

- OASIS XLIFF 2.0 Core：`https://docs.oasis-open.org/xliff/xliff-core/v2.0/xliff-core-v2.0.html`
- memoQ Regex Tagger：`https://docs.memoq.com/current/en/Workspace/regex-tagger.html`
- Phrase Tags (TMS)：`https://support.phrase.com/hc/en-us/articles/5709695024412-Tags-TMS`

## Translation / Review Research

- TEaR: Translate, Estimate, and Refine：`https://aclanthology.org/2025.findings-naacl.218/`
- Loong: 3E long-document translation memory：`https://arxiv.org/abs/2605.30274`
- MAATS multi-agent translation evaluation：`https://arxiv.org/abs/2505.14848`
- M-MAD multidimensional MT evaluation：`https://aclanthology.org/2025.acl-long.351/`
- LLM judge position bias：`https://aclanthology.org/2025.ijcnlp-long.18/`

这些研究用于支持设计方向，不替代 LA 自己的真实游戏本地化盲评。

---

# 24. 最终路线图（一页版）

```text
LA-MASTER-000：冻结本地事实、旧数据、PB-097 与格式现状
        ↓
正式 merge Proma v0.16.8
        ↓
以上游 Runtime / Agent Surface / Composer / Settings / Files 为主
        ↓
恢复 Linguist Overlay，重置 baseline / touchpoints / deviations
        ↓
修复 LA Host parity：引用、Companion Chat、@file、Vision Relay、标题、Stop、模型
        ↓
Project Intake：Scan → Plan → Import → Verify
        ↓
PB-097 复用与统一 Tag Model
        ↓
未知 Tag：Deterministic Discovery → LLM Proposal → Validator → Approve
        ↓
编辑器原子 Tag 保护
        ↓
Phrase master-XLIFF pairing / rehydration / round-trip
        ↓
一次性 Legacy CAT Parity Audit（只分类，不无限回填）
        ↓
零预支质量 Prompt + Translate → Estimate → Refine
        ↓
Proposal Critic 与 Full-Scope Source-first Reviewer 分离
        ↓
Coverage Ledger / Context Snapshot / Rules / Provenance 收口
        ↓
Chunked Jobs / Checkpoint / Compaction Capsule / 50k 性能
        ↓
同模型 Web Chat vs 旧 LA vs 新 LA 盲测
        ↓
真实项目 + 14 天日用
        ↓
Stable-tag Sync Bot（自动开 PR，不自动发布）
```

最终产品：

> **一个持续继承 Proma 最新通用 Agent 能力、同时拥有完整 CAT Intake、结构化 Tag、项目记忆、零预支质量、全范围审校和可恢复交付链路的个人游戏本地化工作系统。**

完成基本闭环后立即进入真实使用；长尾格式和旧功能只根据实际阻断与审计结论继续实施。
