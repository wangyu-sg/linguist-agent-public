# Linguist Agent 实施队列

基线：`64bcb15b`。方向授权：用户已明确批准 LA 进行大改。执行约束：每次只能执行本文件登记为 `Kind=ticket` 且 `Executable=yes` 的一个 `LA-XXX`；本文件不授权批量实施，也不允许跳过依赖。

## 1. 命令缩写

每张工单列出的命令均须运行；缩写展开如下：

- **B**：`npm run typecheck`；`npm --prefix apps/desktop run typecheck`；`git diff --check`。
- **R**：`npm test`。
- **D**：`npm --prefix apps/desktop test`。
- **M**：`npm run mac:test`。
- **F**：B + R + D + M；若工单涉及发布，再执行 `docs/HANDOFF.md` 当前完整 release/RC 命令集。

测试命令统一使用不会触发联网安装的 `npm exec --no -- tsx`；受控环境若阻止其本地 IPC pipe，必须在同一机器的允许执行环境重跑，不能把 EPERM 当作测试通过。

## 2. 工单元数据登记表

`Kind` 仅允许 `ticket | epic | gate | decision`。只有 `Kind=ticket` 且 `Executable=yes` 的条目可以直接交给实现 Agent。Epic 与 Gate 只定义边界和退出条件，**禁止直接执行**；开始实施前必须另建依赖、范围、迁移、回滚与验收均明确的独立子工单。Decision 记录必须先由用户、法律或架构所有者裁定的事项，也不可直接执行。

<!-- ROADMAP_TICKETS_BEGIN -->
| ID | Kind | Risks | Executable | Dependencies | Phase |
|---|---|---|---|---|---|
| LA-BASE | gate | — | no | — | Baseline |
| LA-000 | ticket | R-029 | yes | LA-BASE | 0 |
| LA-001 | ticket | R-001 | yes | LA-000 | 0 |
| LA-002 | ticket | R-002 | yes | LA-000 | 0 |
| LA-003 | ticket | R-003 | yes | LA-000 | 0 |
| LA-004 | ticket | R-004 | yes | LA-000 | 0 |
| LA-005 | ticket | R-005 | yes | LA-000 | 0 |
| LA-006 | ticket | R-008 | yes | LA-001 | 0 |
| LA-007 | ticket | — | yes | LA-002 | 0 |
| LA-008 | ticket | R-016 | yes | LA-001, LA-003 | 1 |
| LA-009 | ticket | R-017 | yes | LA-008 | 1 |
| LA-010 | ticket | R-018 | yes | LA-008 | 1 |
| LA-011 | ticket | R-018, R-019 | yes | LA-010 | 1 |
| LA-012 | ticket | R-019 | yes | LA-011 | 1 |
| LA-013 | ticket | — | yes | LA-009, LA-010, LA-011 | 1 |
| LA-014 | ticket | R-007 | yes | LA-001, LA-010 | 2 |
| LA-015 | ticket | R-007 | yes | LA-014 | 2 |
| LA-016 | ticket | — | yes | LA-014 | 2 |
| LA-017 | epic | R-002 | no | LA-009, LA-010, LA-015, LA-016 | 2 |
| LA-018 | ticket | R-006 | yes | LA-005, LA-015 | 2 |
| LA-019 | ticket | R-005, R-031 | yes | LA-017, LA-018 | 2 |
| LA-020 | epic | R-004 | no | LA-004, LA-018 | 2 |
| LA-021 | ticket | R-009 | yes | LA-000 | 3 |
| LA-022 | ticket | R-010 | yes | LA-021 | 3 |
| LA-023 | ticket | R-011 | yes | LA-008, LA-021, LA-062 | 3 |
| LA-024 | epic | R-011 | no | LA-022, LA-023 | 3 |
| LA-025 | epic | R-011 | no | LA-024 | 3 |
| LA-026 | ticket | R-015 | yes | LA-021 | 3 |
| LA-027 | ticket | — | yes | LA-010, LA-016 | 3 |
| LA-028 | ticket | R-021 | yes | LA-025 | 4 |
| LA-029 | ticket | R-021 | yes | LA-025, LA-028 | 4 |
| LA-030 | epic | R-022 | no | LA-017, LA-025 | 4 |
| LA-031 | ticket | R-022 | yes | LA-030 | 4 |
| LA-032 | ticket | R-003 | yes | LA-003, LA-009, LA-013, LA-014 | 4 |
| LA-033 | ticket | — | yes | LA-009, LA-032 | 4 |
| LA-034 | ticket | — | yes | LA-025, LA-029, LA-033 | 4 |
| LA-035 | ticket | — | yes | LA-033, LA-034 | 4 |
| LA-036 | ticket | — | yes | LA-035 | 4 |
| LA-037 | ticket | — | yes | LA-036 | 4 |
| LA-038 | ticket | R-020 | yes | LA-008 | 5 |
| LA-039 | ticket | R-014, R-020 | yes | LA-038 | 5 |
| LA-040 | ticket | R-012, R-020 | yes | LA-039 | 5 |
| LA-041 | ticket | R-013 | yes | LA-039, LA-040 | 5 |
| LA-042 | ticket | — | yes | LA-008, LA-038 | 5 |
| LA-043 | ticket | — | yes | LA-012, LA-042 | 5 |
| LA-117 | ticket | R-011 | yes | LA-106, LA-043 | 5 |
| LA-118 | ticket | R-011 | yes | LA-117 | 5 |
| LA-119 | ticket | R-011 | yes | LA-118 | 5 |
| LA-120 | ticket | R-011 | yes | LA-119 | 5 |
| LA-121 | ticket | R-011 | yes | LA-120 | 5 |
| LA-122 | ticket | R-009 | yes | LA-121 | 5 |
| LA-123 | ticket | R-027 | yes | LA-008, LA-010, LA-014, LA-023, LA-038 | 7 |
| LA-124 | ticket | R-027 | yes | LA-123 | 7 |
| LA-125 | ticket | R-027 | yes | LA-123, LA-124 | 7 |
| LA-126 | ticket | R-027 | yes | LA-124, LA-125 | 7 |
| LA-127 | ticket | R-027 | yes | LA-126 | 7 |
| LA-128 | ticket | R-011 | yes | LA-098 | 3 |
| LA-129 | ticket | R-023 | yes | LA-017, LA-049, LA-060 | 6 |
| LA-130 | ticket | R-023 | yes | LA-017, LA-049, LA-061 | 6 |
| LA-131 | ticket | R-023 | yes | LA-129, LA-130 | 6 |
| LA-132 | ticket | R-023 | yes | LA-129, LA-131 | 6 |
| LA-133 | ticket | R-023 | yes | LA-130, LA-131 | 6 |
| LA-044 | ticket | — | yes | LA-042, LA-043 | 6 |
| LA-045 | ticket | — | yes | LA-011, LA-042 | 6 |
| LA-046 | ticket | — | yes | LA-014, LA-038, LA-042 | 6 |
| LA-047 | ticket | R-028 | yes | LA-025, LA-034, LA-042 | 6 |
| LA-048 | ticket | — | yes | LA-029, LA-030, LA-042 | 6 |
| LA-049 | ticket | — | yes | LA-046, LA-047, LA-048 | 6 |
| LA-050 | epic | R-023 | no | LA-017, LA-049, LA-060, LA-061 | 6 |
| LA-051 | gate | R-028 | no | LA-043, LA-044, LA-045, LA-046, LA-047, LA-048, LA-049 | 6 |
| LA-052 | ticket | R-025 | yes | LA-000 | 7 |
| LA-053 | ticket | R-024 | yes | LA-000 | 1 |
| LA-054 | ticket | R-026 | yes | LA-053 | 7 |
| LA-055 | epic | R-027 | no | LA-008, LA-010, LA-014, LA-023, LA-038 | 7 |
| LA-056 | epic | — | no | LA-019, LA-020, LA-025, LA-040, LA-050, LA-055 | 7 |
| LA-057 | gate | — | no | LA-051, LA-054, LA-056 | 7 |
| LA-058 | gate | R-026 | no | LA-057 | 7 |
| LA-059 | decision | R-030 | no | LA-000 | 0 |
| LA-060 | ticket | R-023 | yes | LA-000 | 0 |
| LA-061 | ticket | R-023 | yes | LA-000 | 0 |
| LA-062 | decision | R-011 | no | LA-000 | 3 |
| LA-063 | ticket | R-005 | yes | LA-005 | 0 |
| LA-064 | ticket | R-008 | yes | LA-006 | 0 |
| LA-065 | ticket | R-003 | yes | LA-003 | 0 |
| LA-066 | ticket | R-003 | yes | LA-003 | 0 |
| LA-067 | ticket | R-016 | yes | LA-008 | 1 |
| LA-068 | ticket | R-002 | yes | LA-009, LA-010, LA-015, LA-016 | 2 |
| LA-069 | epic | R-002 | no | LA-068 | 2 |
| LA-070 | ticket | R-002 | yes | LA-068 | 2 |
| LA-071 | ticket | R-002 | yes | LA-068 | 2 |
| LA-072 | ticket | R-002 | yes | LA-069, LA-070, LA-071 | 2 |
| LA-073 | ticket | R-002 | yes | LA-068 | 2 |
| LA-074 | ticket | R-002 | yes | LA-073 | 2 |
| LA-075 | ticket | R-002 | yes | LA-074 | 2 |
| LA-076 | ticket | R-004, R-005 | yes | LA-004, LA-018 | 2 |
| LA-077 | ticket | — | yes | LA-076 | 2 |
| LA-078 | ticket | R-004 | yes | LA-077 | 2 |
| LA-079 | ticket | — | yes | LA-076 | 2 |
| LA-080 | ticket | — | yes | LA-078, LA-079 | 2 |
| LA-081 | ticket | — | yes | LA-080 | 2 |
| LA-082 | ticket | R-004, R-005 | yes | LA-019, LA-081 | 2 |
| LA-083 | ticket | — | yes | LA-067 | 2 |
| LA-084 | ticket | R-011 | yes | LA-022, LA-023 | 3 |
| LA-085 | ticket | R-011 | yes | LA-023, LA-084 | 3 |
| LA-086 | ticket | R-011 | yes | LA-085 | 3 |
| LA-087 | ticket | R-011 | yes | LA-086, LA-102 | 3 |
| LA-088 | ticket | R-011 | yes | LA-085, LA-086 | 3 |
| LA-089 | ticket | R-011 | yes | LA-087, LA-088, LA-103, LA-105 | 3 |
| LA-090 | ticket | R-011 | yes | LA-089 | 3 |
| LA-091 | ticket | R-011 | yes | LA-084, LA-087, LA-089, LA-090 | 3 |
| LA-092 | ticket | R-011 | yes | LA-024, LA-084 | 3 |
| LA-093 | ticket | R-011 | yes | LA-024 | 3 |
| LA-094 | ticket | R-011 | yes | LA-024, LA-082, LA-092 | 3 |
| LA-095 | ticket | R-011 | yes | LA-024 | 3 |
| LA-096 | ticket | R-011 | yes | LA-024, LA-092 | 3 |
| LA-097 | ticket | R-011 | yes | LA-024, LA-092 | 3 |
| LA-098 | ticket | R-011 | yes | LA-097 | 3 |
| LA-099 | ticket | R-011 | yes | LA-024 | 3 |
| LA-100 | ticket | R-011 | yes | LA-093, LA-094, LA-095, LA-096, LA-097, LA-098, LA-099 | 3 |
| LA-101 | ticket | R-011 | yes | LA-092, LA-100 | 3 |
| LA-102 | ticket | R-011 | yes | LA-086 | 3 |
| LA-103 | ticket | R-011 | yes | LA-088 | 3 |
| LA-104 | ticket | R-011 | yes | LA-103 | 3 |
| LA-105 | ticket | R-011 | yes | LA-087, LA-088, LA-104 | 3 |
| LA-106 | ticket | R-011 | yes | LA-093 | 3 |
| LA-107 | ticket | R-011 | yes | LA-100, LA-101 | 3 |
| LA-108 | ticket | R-022 | yes | LA-017, LA-025 | 4 |
| LA-109 | ticket | R-022 | yes | LA-115 | 4 |
| LA-110 | ticket | R-022 | yes | LA-115 | 4 |
| LA-111 | ticket | R-022 | yes | LA-109, LA-110 | 4 |
| LA-112 | ticket | R-022 | yes | LA-111 | 4 |
| LA-113 | ticket | R-022 | yes | LA-108 | 4 |
| LA-114 | ticket | R-022 | yes | LA-113 | 4 |
| LA-115 | ticket | R-022 | yes | LA-114 | 4 |
| LA-116 | ticket | R-022 | yes | LA-109, LA-110 | 4 |
| LA-134 | ticket | R-032 | yes | LA-042, LA-043 | 6 |
| LA-135 | ticket | R-032 | yes | LA-134 | 6 |
| LA-136 | ticket | R-032 | yes | LA-134 | 6 |
| LA-137 | ticket | R-032 | yes | LA-134 | 6 |
| LA-138 | ticket | R-032 | yes | LA-137 | 6 |
| LA-139 | ticket | R-032 | yes | LA-134 | 6 |
| LA-140 | ticket | R-032 | yes | LA-139 | 6 |
| LA-141 | ticket | R-032 | yes | LA-134 | 6 |
| LA-142 | ticket | R-032 | yes | LA-134 | 6 |
| LA-143 | ticket | R-032 | yes | LA-141 | 6 |
| LA-144 | ticket | — | yes | LA-042 | 6 |
| LA-145 | ticket | — | yes | LA-014, LA-144 | 6 |
| LA-146 | ticket | — | yes | LA-139, LA-145 | 6 |
| LA-147 | ticket | — | yes | LA-145 | 6 |
| LA-148 | ticket | — | yes | LA-146, LA-147 | 6 |
<!-- ROADMAP_TICKETS_END -->

## 3. 已完成基线

| ID | 唯一不变量 | 证据 |
|---|---|---|
| LA-BASE | 原有工作树与两份规格形成可复现提交，审计不再追逐未提交状态 | commit `64bcb15b`；根/桌面 typecheck、根测试、桌面149+3、diff check通过；E5 acceptance因pack缺失仍开放 |

## 4. Phase 0：治理同步与立即止血

### 首三个安全/稳定工单

| ID | 唯一目标/不变量 | 依赖 | 修改范围与当前调用链 | 迁移/数据 | 必须新增测试与验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| **LA-001** | 任何 unknown/非法 permission mode 都稳定拒绝，绝不变成 `auto/full/allow` | LA-000 | `agentPermissions.ts::{normalizeAgentPermissionMode,presetRules,buildAgentPermissionContract}`；permission routes；settings persistence | 扫描旧值；合法值原样；非法原文备份并进入 repair/blocked，不自动改写 | `unknown-permission-mode-is-rejected`、missing/invalid API-to-session；`npm exec --no -- tsx tests/agent_permissions.test.ts`; `npm exec --no -- tsx tests/permission_decisions.test.ts`; B | 回退 strict parser commit；不得回退成 auto，可临时一律 ask/blocked |
| **LA-002** | 全进程只有一个 SandboxCoordinator 能执行 `updateConfig -> wrap/spawn` 临界区 | LA-000 | `catSandbox.ts`、`generalSandbox.ts`、CAT/General/Eval/Maintainer callers；禁止新增第二锁 | 无 schema；prepared command记录config hash | CAT↔CAT、CAT↔General、CAT↔Eval barrier/random interleaving；`npm exec --no -- tsx tests/cat_safety_kernel.test.ts`; `npm exec --no -- tsx tests/concurrency.test.ts`; B；`rg`仅一处`SandboxManager.updateConfig` | coordinator代理旧config builders；失败整工单回退，不留下半迁移caller |
| **LA-003** | mandatory prompt或未知有效预算不能产生可启动的 `ready` | LA-000 | `prompt_compiler.ts`、Team/Eval/General/CAT prepare callers | 不改持久化schema；当前受支持模型先录入显式且已验证的上下文预算；未知模型blocked，但不得把全部现有模型无条件判无效 | mandatory/tool/history/unknown-model overflow；当前支持模型budget fixture；`npm exec --no -- tsx tests/prompt_compiler.test.ts`; `npm exec --no -- tsx tests/team_run_plan.test.ts`; B | 调用方可回到旧compiler但外层guard必须保留blocked；已验证支持模型继续可用 |

### 其余止血

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-000 | `TODO.md` 作为人类入口，七份roadmap文档成为唯一自洽、机器可验证的详细重构控制面 | LA-BASE | 七份roadmap文档、`TODO.md`、docs index/context/handoff、validator；不改生产代码 | 保留现有RC gates，建立Kind/Risks/Executable与逐票规则 | `npm run roadmap:test`、docs/release checks；B | 纯文档回滚；不得留下第二份可执行总蓝图 |
| LA-004 | Stable Package preview 在目标archive获取后零 subprocess、零额外网络 | LA-000 | `package_center.ts::previewManagedPackageInstall/installDependenciesWithoutScripts`、routes | legacy package registry只读；preview plan schema如变化需版本兼容 | instrument child_process/fetch；file/git/url/shrinkwrap fixtures；`npm exec --no -- tsx tests/package_center.test.ts`; route test；B | 禁用Stable install优先于恢复npm preview |
| LA-005 | Stable 新 Run 不加载第三方 executable Extension | LA-000 | General resource authorization/session load、Task Package preflight、UI copy | 旧approval标legacy，不自动等价第一方/隔离approval | third-party blocked、first-party exact allowlist、existing Run freeze；extension/trust tests；B | 回滚仅可恢复固定第一方allowlist，不能开放任意已批准path |
| LA-006 | Stable UI/API 不提供 `full` permission preset | LA-001 | permission presets/routes/Settings；developer channel另票 | stored full -> blocked migration prompt；不静默转auto | API preset、Settings、old full fixture；permission/settings tests；B+D | 回滚可恢复developer-only选项，不恢复Stable |
| LA-007 | production sandbox phase不能由普通环境变量降为off/observe | LA-002 | sandbox config parsing/build channel | dev/test显式build capability；Stable非法值fail start | stable off/observe denial、dev explicit enable；CAT safety tests；B | 临时强制enforce；不回退环境宽松 |
| LA-059 | 在任何外部复用或公开声明前明确当前source-available/open-source状态与clean-room政策 | LA-000 | README/NOTICE/SECURITY/CONTRIBUTING/ADR；不复制第三方实现 | 不改代码数据；许可证选择仍由用户/法律决定 | 文档声明、依赖许可证扫描计划、禁止AGPL源码复制规则；docs check | 未决时维持source-available表述，不宣称open source |
| LA-060 | Stable 立即隐藏并禁用 Maintainer 的生产执行入口 | LA-000 | Maintainer routes/session/UI feature gate；仅保留只读诊断/导出 | 不删jobs/candidates；不迁移用户数据 | Stable route/UI absent、直接调用blocked、历史只读可见；maintainer tests；B+D | 可恢复只读诊断，不恢复production mutation |
| LA-061 | Stable 立即隐藏并禁用 Private Eval 的生产执行入口 | LA-000 | eval routes/`PipelineWorkspace` feature gate；评测数据只读 | 不删eval Task/corpus/artifacts | Stable route/UI absent、直接调用blocked、历史只读可见；eval tests；B+D | 可恢复只读历史，不恢复production execution |
| LA-063 | G1回归：Team child adapter测试必须以Stable executable Extension阻断为事实，同时证明纯Skill/Prompt仍可走server-owned RPC | LA-005 | `tests/team_child_rpc_adapter.test.ts`；只修测试迁移，不改生产行为 | 无 | `npm exec --no -- tsx tests/team_child_rpc_adapter.test.ts`; R；B | 回退测试迁移会恢复错误预期，禁止进入Gate |
| LA-064 | G1回归：runtime hook测试不得构造已删除的Stable `full` mode，并须保留`full`拒绝断言 | LA-006 | `tests/runtime_hooks.test.ts`；以`auto`覆盖自动批准语义，只修测试迁移 | 无 | `npm exec --no -- tsx tests/runtime_hooks.test.ts`; R；B | 不得恢复Stable full；测试回退会阻断Gate |
| LA-065 | G1回归：Team workflow活动测试必须提供显式已验证模型预算，不得依赖unknown budget启动 | LA-003 | `tests/subagent_task_activity_workflow.test.ts`；只补受支持模型budget fixture | 无 | `npm exec --no -- tsx tests/subagent_task_activity_workflow.test.ts`; R；B | 不得绕过Prompt launch guard；fixture缺失继续blocked |
| LA-066 | G1回归：workflow plan测试必须分别证明unknown budget保持awaiting_input、显式已验证budget才进入active | LA-003 | `tests/workflow_plan.test.ts`；只增加可切换budget fixture与双路径断言 | 无 | `npm exec --no -- tsx tests/workflow_plan.test.ts`; R；B | 不得把unknown budget设为默认有效 |

## 5. Phase 1：Contract、状态与 Pi 边界

| ID | 唯一目标/不变量 | 依赖 | 修改范围/调用链 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-008 | 所有新 Run 状态变化只经一个纯 transition table | LA-001,003 | Task contract、workflow/eval/active registry adapters | 旧status完整映射；不重写历史 | legal/illegal/double terminal/retry-stop property tests；projection/workflow tests；B | routes可继续旧DTO，但transition adapter为唯一写口 |
| LA-009 | 每次Turn/attempt持有不可变ExecutionSnapshot，显式设置变化创建新revision/epoch | LA-008 | resource manifests、model routes、Task Run events | legacy Run视为epoch0且只读；无猜测补值 | compatible switch/compaction/fork/resource freeze；resource/session tests；B | 新snapshot字段feature-gated；旧Run不转换写回 |
| LA-010 | application/coordinator只依赖 `AgentRuntimePort`，不依赖Pi原生session类型 | LA-008 | new port + Pi adapter；General先迁 | 无数据变更；runtime binding adapter | fake runtime完整General Task、Pi parity；general session/run tests；B | DI切回旧factory；不删旧factory |
| LA-011 | Pi事件在runtime adapter内归一化为canonical runtime events | LA-010 | Pi hooks/event mapping；coordinators | Task product event schema先不变 | mapping snapshots、unknown event诊断、order；runtime hooks/session tests；B | adapter可透传旧event mapper但不新增消费者 |
| LA-012 | retry中间错误永不成为Run terminal，且final前flush所有pending delta | LA-011 | RetryTerminalGate + stream coalescer | 无schema或用兼容event版本 | failure/willRetry permutations、cancel、final flush、20fps bound；self-healing/runtime tests；B | 可关闭coalescing；terminal gate不可宽松回退 |
| LA-013 | Session compaction先耐久写结构化handoff，再压缩准确session | LA-009,010,011 | runtime port/Task artifact or event/prompt rehydrate | handoff versioned；旧自由摘要只读 | pending decisions/resources/policy hashes preserved；compaction fixtures；B | 禁用compaction并建议新Run，不执行无handoff压缩 |
| LA-053 | 测试runner自动发现所有测试并按suite/shard运行 | LA-000 | package scripts/test config/CI；不依赖package-manager统一 | 旧清单生成manifest对比 | missing-test detection、old/new set parity、F | 旧chain保留一版比较 |
| LA-067 | G2回归：共享Task contract必须可由Desktop的Node strip-only测试加载，不能使用parameter property等不可擦除TS语法 | LA-008 | `task_workspace_contract.ts`中的Run transition error；Desktop Node test import边界 | 无schema、数据或行为变化 | 先保留`npm --prefix apps/desktop test`失败证据；增加strip-only import regression；B+D | 回退会恢复Desktop全套测试加载失败，因此不得通过Gate |

## 6. Phase 2：统一能力与隔离

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-014 | production tool无结构化capability metadata即拒绝注册 | LA-001,010 | tool catalogs/runtime extensions/policy registry | 为现有tool生成冻结inventory；缺项blocked | every-tool-declared、alias/unknown deny、mutation tests；tool catalog/permission tests；B | allowlist当前已审tool；不按名字默认safe |
| LA-015 | 所有文件read/list/search/write经单一FileCapabilityBroker | LA-014 | standalone grants、General/CAT/document/tool adapters | 复用realpath+fingerprint grants；加Run scope/expiry | outside/home/symlink/find/grep/new-file/revoke；security/CAT tests；B | 未迁工具Stable禁用；不能旁路broker |
| LA-016 | network/process/secret访问分别经显式broker与grant | LA-014 | web/bash/provider/package/document paths | 现有provider/runtime内部能力分类，不把secret存DB明文 | host/process template/secret denial；security tests；B | 关闭能力而非直连fallback |
| LA-017 | **Epic，禁止直接执行**：每个active Run在独立worker，安全配置不再是宿主全局可变状态 | LA-009,010,015,016 | supervisor/run-worker/RPC；必须先建立按General、CAT、Team、supervisor/RPC拆分的独立子工单 | ExecutionSnapshot一次bootstrap；event带worker id/epoch | 子工单分别覆盖heartbeat/crash/cancel/hard kill/cross-root isolation；F | profile级切回host仅限新Run；当前Run不热迁 |
| LA-018 | Extension只从批准字节的content-addressed只读staging加载 | LA-005,015 | resource snapshot/trust/staging/loader | legacy approval需重新stage/reapprove | verify-load swap、digest/tree/dynamic import；extension tests；B | Stable保持disabled；不回原path load |
| LA-019 | 第三方Extension只在独立host并通过capability RPC | LA-017,018 | extension-host/supervisor/Pi compatibility adapter | extension API版本化；unsupported feature blocked | fs/env/process/net denied、host crash isolated、timeout；F | Stable继续disabled；不回宿主执行 |
| LA-020 | **Epic，禁止直接执行**：Stable只安装声明式、自包含、签名 `.lapkg`，运行时不执行npm | LA-004,018 | 已拆为LA-076格式、LA-077签名、LA-078预览、LA-079 legacy盘点、LA-080激活、LA-081回滚、LA-082产品切换；不得直接实现Epic | legacy installed包disabled+reverify/repack；不删原tree | 全部子工单独立通过后才可关闭；signature/path/size/hash/atomic activation/rollback；F | 保留旧registry只读；不恢复Stable npm |
| LA-083 | Gate报告与Markdown/JSON执行账本必须双向一致，已存在的G2记录缺口不得带入G3 | LA-067 | roadmap validator、G2执行账本记录；不改生产代码 | 无schema、用户数据或产品行为变化 | 先证明G2报告无账本记录时validator失败；`npm run roadmap:test`；`npm run roadmap:validate`；B | 回退validator与账本补记；不删除任何Gate报告或标签 |
| LA-076 | `.lapkg` v1格式和纯静态verifier只接受声明式、自包含资源，拒绝任何可执行面 | LA-004,018 | new package-format module；strict manifest、archive path/size/count/hash、resource type allowlist；不接route/registry/UI | 无生产数据；只用synthetic archive；未知字段和未知resource type blocked | schema/duplicate ID/path traversal/symlink-hardlink/case+Unicode collision/size/count/hash；package-format tests；B | 未接生产，可整体移除；Stable继续禁用旧安装 |
| LA-077 | `.lapkg`签名验证覆盖规范化manifest与完整resource digest，未知或撤销key一律拒绝 | LA-076 | verifier signature envelope、Ed25519 adapter、注入式trust roots；不得内置未经决策的生产publisher key | 无生产trust迁移；测试key仅fixture；LICENSE/商业信任选择仍不猜测 | manifest/resource tamper、key substitution、unknown/revoked key、noncanonical envelope；signature tests；B | 无已批准trust root即blocked；不降级为hash-only approval |
| LA-078 | `.lapkg` Preview在目标archive取得后只做纯静态验证，零subprocess、零额外网络且planHash覆盖完整批准对象 | LA-077 | new preview service；接收已取得bytes/source descriptor；instrument process/network；暂不接production route | preview schema v1；无registry或用户数据写入；legacy npm preview保持stopgap blocked | subprocess/network sentinels、plan determinism、signature/tree/risk/source mutation、expiry；preview tests；B | 未接生产可移除；不得恢复npm/Git/Shell preview |
| LA-079 | legacy `installed-v1` 只读盘点并生成disabled/repack资格报告，不自动执行、删除、重签或激活 | LA-076 | legacy registry reader/report；不触碰真实`data/**`，测试仅synthetic roots | 每条记录保留原path/digest/risk，分类declarative-candidate或manual-review；原tree只读 | count/source/digest/missing/corrupt/executable classification；migration report fixtures；B | 删除报告即可；旧registry继续只读且disabled |
| LA-080 | 经签名Preview批准的声明式资源原子激活到唯一v2 registry/content root，绝不进入Pi/npm执行路径 | LA-078,079 | staging/verifier/activation service/v2 registry；route/UI仍不切换 | synthetic first；v1只读，v2为新包唯一writer；planHash与source digest重验 | stale plan/tamper/concurrent activation/package exists/tree hash/atomic rename/resource resolution no-extension；activation tests；B | 保留旧v1只读；失败删除未发布staging，不回旧npm writer |
| LA-081 | `.lapkg`激活失败或启动恢复能按准确activation revision回滚，不留下半激活registry/tree | LA-080 | activation journal/previous revision/recovery；fault injection at each rename/registry step | journal versioned；只处理v2 synthetic fixtures，不读取真实`data/**` | crash each step、rollback success/failure、orphan staging、idempotent recovery、previous revision integrity；recovery tests；B | 无法证明恢复时v2进入read-only blocked；不猜测完成 |
| LA-082 | Stable Package Center route/UI只暴露签名`.lapkg`预览与v2声明式资源，旧npm安装API和legacy执行解析永久退役 | LA-019,081 | package routes/resolver/workspace client/Settings；catalog可只读发现但不得直接安装npm包 | v1历史只读展示；v2为唯一新安装事实；不删除legacy tree | old endpoints 410/no npm、strict new DTO、active Run freeze、UI risk/signature copy、pure resources load、F | 可隐藏新安装入口；不得恢复旧npm route、legacy executable resolver或双writer |
| LA-068 | 建立版本化Run Worker RPC与Supervisor生命周期，但不迁移production profile | LA-009,010,015,016 | new run-worker protocol/supervisor/process adapter；不接生产route | synthetic execution bootstrap v1；无持久化schema | protocol validation、heartbeat、graceful cancel、timeout hard kill、crash classification；worker/supervisor tests；B | foundation未接生产，可整体移除；不得留下匿名spawn |
| LA-069 | **Epic，禁止直接执行**：General新Run只在Supervisor管理的独立worker执行 | LA-068 | 必须按LA-073不可变preflight、LA-074双向RPC、LA-075切换与parity逐票实施；不得直接执行Epic | 仅新Run；active host Run完成或停止，不热迁 | 子工单分别覆盖plan freeze、RPC lifecycle、start/retry/cancel/crash/reconnect与snapshot parity；F | 未完成全部子工单前保持现状；不得并存两个production authority |
| LA-070 | CAT与Eval新Run只在各自Supervisor worker中执行并保持原领域Gate | LA-068 | CAT/Eval session factories、coordinators、worker bootstrap；不改CAT schema | 仅新Run；旧Run只读/完成；proposal/evidence/QA/delivery保持canonical | CAT↔CAT、CAT↔General、CAT↔Eval cross-root；locked/proposal/QA/delivery parity；F | 禁用未迁profile；不得以host执行绕过sandbox或领域Gate |
| LA-071 | Team specialist新Run使用同一Supervisor worker协议和父Grant严格子集 | LA-068 | Team child launch、server-owned RPC/evidence scope、worker bootstrap | 当前child完成/停止；不迁移活跃child；Package Extension仍blocked | parent-child cancellation、read-only evidence、no sibling mutation、crash/timeout、Grant subset；F | 退回已验证read-only transport仅限新child；不恢复独立权限模型 |
| LA-072 | 删除production host内Agent执行fallback并证明所有active Run隔离 | LA-069,070,071 | composition root、legacy session factories/callers、architecture guard | parity报告后才删旧入口；不存在dual authority | 全profile parity、无host Pi session、cross-root randomized isolation、worker id/epoch events、dead-path scan；F | Gate失败保留Stable blocked/read-only；不得恢复双执行路径 |
| LA-073 | General启动前由Host编译可序列化、不可变且摘要完整的PreparationPlan，Session只能消费该Plan | LA-068 | resource/trust/grant/model/prompt-input preflight与session plan入口；不得在preflight创建Pi session | 仅新plan schema v1；旧Run不补写；无worker启动 | preflight零Extension执行、plan deterministic/serializable、全部input hash非空、source变化拒绝、tool/resource parity；B | preflight失败则新Run blocked；不得启动后重新发现或修补plan |
| LA-074 | General Worker通过版本化双向RPC准备Session并回传attestation；Host持久化精确ExecutionSnapshot后才可prompt | LA-073 | worker entry、session proxy、runtime events、permission/delegation request-response、attestation/activate/dispose | RPC schema v1；不接production coordinator | command/response correlation、plan/attestation mismatch、未activate prompt拒绝、permission/queue/events/disconnect/timeout/secret redaction；B | 删除未接生产的RPC；不得让worker写Task truth、自授Grant或在activation前执行 |
| LA-075 | 新General Run原子切换到Worker authority并通过host/worker行为parity | LA-074 | General coordinator composition、ActiveRun handle、worker id/epoch projection；移除新Run host factory | 切换点后仅新Run；active host Run完成/停止；无dual write | start/retry/cancel/crash/reconnect、queue/delegation、resource/snapshot parity、host session factory未调用；F | 仅后续新Run可切回host且须新票；当前Run不热迁 |

## 7. Phase 3：Storage、Transport、Logging

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-021 | 每个dataRoot同时只有一个持有效lease的writer | LA-000 | runtime startup/storage writer/Electron single-instance | lease含nonce/start/version；stale/PID reuse规则 | two-process contention/stale/lost lease；storage tests；B | 无lease即read-only/exit；不允许best-effort写 |
| LA-022 | 安全关键文件事务具备file+parent fsync与fault recovery | LA-021 | workspace/storage writer/task/package/decision critical paths | 按durability class迁移，不一次改所有cache | crash each step/disk full/rename failure；workspace/storage tests；B | 可退到read-only；不声称rename即durable |
| LA-062 | **Decision，已于2026-07-23批准且禁止直接执行**：`docs/adr/0001-sqlite-storage-boundary.md`裁定SQLite canonical结构化事实、内容寻址blob、备份/回滚、JSONL导出与schema migration边界 | LA-000 | ADR；不得在Decision提交创建数据库、迁移器或生产schema | 只读源码盘点；未读取真实`data/**`，规模与恢复测量保留为cutover Gate | ADR逐项记录已确认事实、未知、备选与退出门；docs/roadmap validator | LA-023仍仅建synthetic foundation；任何domain未过parity不得cutover |
| LA-023 | 建立SQLite WAL event/projection foundation，但尚不切生产writer | LA-008,021,062 | new storage package/schema/migrations/repos | synthetic fixtures only；JSON仍canonical；必须遵守LA-062 ADR | transaction/CAS/idempotency/crash tests；B | 删除新DB即可，无生产数据影响 |
| LA-024 | **Epic，禁止直接执行；已由LA-084、LA-085、LA-086、LA-087、LA-088、LA-089、LA-090、LA-091、LA-102、LA-103、LA-104、LA-105完成并关闭**：Task aggregate迁入SQLite且只有一个canonical writer | LA-022,023 | 子工单分别冻结backup、inventory、import/replay parity、aggregate boundary、repository readiness、Decision/queue/resource parity、composition seam、SQLite side repositories、唯一cutover、JSONL export、rollback/read-only旧writer | scan/backup/import/replay/compare/cutover；旧目录只读 | 每个子工单独立覆盖counts/sequence/cursor/projection/corrupt fixtures；Epic只验收，不直接改代码 | 整个Task aggregate切回旧writer+旧目录；不双写、不拆分authority |
| LA-025 | **Epic，禁止直接执行；已由LA-092、LA-093、LA-094、LA-095、LA-096、LA-097、LA-098、LA-099、LA-100、LA-101完成并关闭**：剩余结构化事实逐域迁入DB并使用内容寻址blob | LA-024 | 子工单分别负责blob、settings/grants/trust、Package、Memory、Library、CAT core、CAT gates、Workflow/Team/Eval、跨域backup/parity和旧writer关闭 | 每个域单独inventory/import/parity/single cutover；原文件保留 | 每个子工单独立覆盖orphan blob/dedupe/provenance/per-domain parity；Epic只验收 | 已通过的兼容窗口仍保留旧reader/backup；实际删除只可由LA-056独立子工单完成 |
| LA-084 | consistent SQLite backup/restore foundation只在持有writer authority时产生DB snapshot与校验manifest，绝不复制缺WAL的live DB | LA-022,023 | `storage-sqlite` backup/restore/checkpoint API；synthetic DB/blob manifest；不接production startup | versioned backup manifest；temp target后atomic publish；本票不导入用户数据 | WAL checkpoint/backup consistency、tamper/missing file、restore quick-check、fault cleanup；storage recovery tests；B | 删除未接线backup API与fixture；JSON/JSONL不受影响 |
| LA-085 | 冻结Task/Run/Event/Decision/queue/resource所有持久字段、顺序、revision与blob边界的versioned SQLite mapping contract | LA-023,084 | Task workspace contract、queue/resource/decision inventory与`storage-sqlite` schema migration；不接writer | synthetic fixtures覆盖Project与standalone、legacy schema版本、corrupt/torn尾记录分类 | schema/mapping completeness、unknown field/version blocked、migration ledger；Task/storage tests；B | 回退未接线schema migration；不得猜写未知legacy字段 |
| LA-086 | Task/Run/Event importer对synthetic legacy目录完成只读scan、ordered import、replay与semantic projection parity，不切writer | LA-085 | legacy Task reader + SQLite importer/parity report；Project/standalone synthetic roots only | source先backup/hash；重复import幂等；corrupt中间记录blocked、已支持torn尾规则保持 | count/sequence/cursor/event payload/projection/reopen parity、duplicate import、corrupt fixtures；recovery tests；B | 删除新DB/report；legacy仍唯一writer |
| LA-102 | 修复Task aggregate迁移边界：Task event/snapshot内嵌Decision，LA-087只能建立SQLite repository/cutover readiness，唯一production cutover由LA-089拥有 | LA-086 | roadmap validator、queue/risk/migration控制面；不修改production code/schema/data | 不迁移；明确一个aggregate、一个cutover owner、无依赖循环 | validator必须拒绝缺失/重复cutover owner及LA-087绕过boundary dependency；roadmap tests | 回退本控制面修订只会重新暴露冲突，不得据此执行旧LA-087 |
| LA-103 | 修复Project quality ledger的domain boundary：它是跨Task的Project/CAT governance事实，不属于LA-089 Task aggregate cutover | LA-088 | roadmap validator、queue/risk/migration控制面；不修改production code/schema/data | 不迁移；LA-088 parity证据保留，LA-089只切Task内嵌Decision+queue/profile，quality ledger继续JSONL唯一writer至LA-098 | validator必须强制Project quality ledger唯一cutover owner=LA-098、Task aggregate显式排除quality ledger、LA-089依赖LA-103；roadmap tests | 不得恢复两个cutover owner；替代方案仍须一个Project-level authority owner |
| LA-104 | 所有TaskWorkspace、message queue和Task Package profile调用通过install-once storage composition seam，默认仍为现有file backend且运行中不可换authority | LA-103 | cat-data workspace/queue storage contracts；cat-server profile persistence；不接SQLite、不改startup | 无数据迁移；未安装backend时保持原文件语义；安装后root mismatch和第二次安装fail closed | dispatch到synthetic alternate root、默认file regression、second install/root mismatch refusal；Task/queue/profile tests；B | 删除未接线resolver并恢复直接file factory；不得保留部分调用旁路 |
| LA-105 | SQLite Task aggregate backend补齐message queue与resource profile repository，并与LA-087 TaskWorkspace repository组成一个未接线backend | LA-087,088,104 | storage-sqlite queue/profile repositories、composition factory；不改production startup/marker | synthetic imported DB；queue/profile strict parse与projection CAS；Project quality ledger不接入 | queue order/status、profile revision/hash、concurrent CAS、reopen、authority loss、production import guard；recovery tests；B | 删除未接线side repositories/factory；file backend仍canonical |
| LA-087 | 建立完整Task aggregate的SQLite TaskWorkspace repository与startup cutover plan，但保持未接线、不得切production writer | LA-086,102 | SQLite-backed TaskWorkspace contract、composition factory、authority marker/cutover plan；Project与standalone同一repository | synthetic imported DB上验证create/open/append/replay/restart/concurrent command；不扫描真实root、不写legacy | TaskWorkspace contract/server route/Desktop parity、repository reopen/concurrency、production import guard；F | 删除未接线repository/factory；JSON/JSONL仍唯一writer |
| LA-088 | Decision、message queue与resource profile importer在只读legacy输入上证明revision/order/hash与Task关联parity，不切writer | LA-085,086 | quality/readiness/permission decisions、queue、resource profile readers与SQLite mapping | synthetic fixtures；invalid raw preserved并blocked；不补造authority/hash | counts/revision/order/status/scope/hash/plan parity、orphan Task、duplicate import；decision/queue/resource/recovery tests；B | 删除导入DB/report；legacy保持canonical |
<!-- TASK_AGGREGATE_CUTOVER_OWNER: LA-089 -->
<!-- TASK_AGGREGATE_EXCLUDES_PROJECT_QUALITY_LEDGER -->
| LA-089 | 只有Task repository与内嵌Decision/queue/resource importer及完整SQLite backend全部通过parity后，才将Task aggregate一次性切为SQLite唯一production writer；Project quality ledger不在本票cutover内 | LA-087,088,103,105 | startup inventory/migration、单一authority marker、LA-104/105 backend装配、旧Task writer guard | lease下backup -> import/Task-domain parity -> active mutation排空或blocked -> 单次authority marker -> SQLite backend；Task旧文件立即只读；Project quality ledger保持JSONL唯一writer | atomic Task+内嵌Decision/queue/resource authority、idempotency、reload、pending recovery、cutover crash、旧Task writer调用guard；F | 整个Task aggregate回到同一pre-cutover backup与旧writer；不得只回退其中一部分，也不得切quality ledger |
| LA-090 | canonical SQLite events可确定性生成versioned JSONL审计导出，导出永不成为可写事实源 | LA-089 | export service/CLI contract；不接import writer | explicit destination/staging；stable schema/version/hash；不含secrets | repeated export byte/semantic parity、cursor/order、redaction、partial write cleanup、re-import verifier read-only；B | 关闭导出；不恢复JSONL writer |
| LA-091 | Task旧writer进入只读兼容窗口且backup/restore/whole-domain rollback/no-dual-authority门全部可证明；已完成并关闭LA-024 | LA-084,087,089,090 | composition guards、migration report、legacy reader/authority marker、LA-024 Epic ledger | 不删除旧目录/reader；旧writer AST/runtime guard；rollback只允许完整Task域 | backup->cutover->restart->rollback->re-cutover、old writer denied、JSONL export parity、architecture scan；F | Gate失败即whole-domain rollback；LA-024已关闭，G4仍需阶段报告/tag |
| LA-092 | 建立未接线的SHA-256 blob store：只接受完整校验的immutable bytes，并以transactional ref manifest证明dedupe与orphan recovery | LA-024,084 | `storage-sqlite` blob API、staging/publish/ref manifest；只允许显式temporary root与authority；不迁现有domain或生产writer | content address按bytes；metadata transaction失败不得发布ref；原文件不删；CAS fixture不得被解释为domain cutover | digest mismatch、immutable/dedupe、orphan stage/blob/ref、concurrent publish、backup/restore manifest；recovery tests；B | 删除未被domain引用的新blob root与未接线API；原文件仍canonical |
| LA-093 | Settings、Grant与Trust逐域完成strict import/parity后单次切到SQLite唯一writer，secret仍只存Keychain/reference | LA-024 | settings/policy/grant/trust repositories与startup migration | invalid raw保留并blocked；scope/hash/revision不宽松归一；backup后single cutover | legal/invalid fixtures、grant expiry/revoke、trust digest、secret absence、rollback/no-dual-write；B | whole-domain回旧只读backup；SQLite表停止写 |
| LA-106 | server integration fixtures只使用合成临时 repo root 与 Pi agent dir；完整 Gate 测试不得扫描真实 `data/**` 或真实 `~/.pi/agent/trust.json` | LA-093 | test-only server root/agent-dir override guarded by explicit test mode；`tests/import_upload.test.ts`、`tests/asset_api.test.ts` 的临时 fixture 与清理 | 仅测试 harness；生产默认仍解析源码仓库 root；不读、不写真实 data 或 home trust | root server fixtures with synthetic root；assert no checkout `data/**` mutation；`npm exec --no -- tsx tests/import_upload.test.ts`；`npm exec --no -- tsx tests/asset_api.test.ts`；B；重新运行 G4 要求的完整安全子集 | 仅测试路径回退会重新阻断 G4；不得开放无条件的任意 root 覆盖 |
| LA-094 | `.lapkg` v2 Package registry/journal在保持签名、planHash与recovery语义下迁入SQLite，content bytes进入blob store | LA-024,082,092 | v2 registry/activation journal/recovery + blob refs；legacy v1继续只读disabled | inventory/hash/import/parity后single cutover；active activation先恢复或blocked | registry/tree/signature/source/plan parity、crash phases、rollback、old writer denied；Package/recovery tests；F | 回到完整v2 pre-cutover backup；不恢复npm/v1 writer |
| LA-095 | Confirmed Memory完整保留proposed/active/revoked/history/source/revision语义后切到SQLite，召回仍非Evidence | LA-024 | assistant memory repository/routes/tools；不含TDAI candidate migration | personal/project synthetic fixtures；strict import/parity；single cutover | counts/history/revision/scope/source/revoke/conflict、no auto activation、rollback/no-dual-write；memory tests；B | whole-domain回旧memory backup；召回可disabled，不猜数据 |
| LA-096 | Library catalog/block/locator元数据迁入SQLite且managed document bytes进入blob store，索引仍可重建而非authority | LA-024,092 | assistant library repository、managed docs、block/index builders | hash original -> blob -> metadata import/parity -> single cutover；source originals保留 | provenance/locator/block/count/hash、dedupe/orphan、lexical parity、index rebuild、rollback；library tests；B+D | metadata whole-domain回旧backup；blob保留无引用待安全GC；索引重建 |
| LA-097 | CAT batch/segment/asset/TM/TB结构化事实保留format/source digest、locked、tag、revision与检索语义后切为SQLite唯一writer | LA-024,092 | batch workspace、assets、segments、TM/TB repositories与routes；source files/blob refs分离 | 每类inventory/import/parity；任一类失败阻断整个CAT-core cutover；原Project tree备份 | row/source/tag/locked/revision/TM/TB counts与query parity、large synthetic project、rollback/no-dual-write；F | 整个CAT-core域回旧Project backup；不得只回segments |
<!-- PROJECT_QUALITY_LEDGER_CUTOVER_OWNER: LA-098 -->
| LA-098 | CAT proposal/evidence/QA/waiver/delivery/Project quality-ledger事务保持全部hard rails后切为SQLite唯一writer | LA-097 | proposal、evidence、quality、delivery、Project quality decision ledger repositories/tools/routes | 先只读import/replay/parity；Project quality ledger保持JSONL唯一writer直到本票single cutover；与CAT-core同project revision关联 | locked denial、tag/placeholder、evidence authority、QA/waiver/delivery hash、跨Task/Team ledger parity、rollback；F | 整个CAT-governance域回旧backup；不得绕过Gate继续写 |
| LA-128 | 同一 synthetic Project quality ledger 的 concurrent append 必须在首个异步等待前取得唯一 per-path queue，保证 sequence/hash/waiver 的线性顺序 | LA-098 | `quality_decision_ledger.ts`、并发 ledger regression；不改SQLite authority、schema、route 或 Electron | 无数据；legacy fallback 与 marker 后 fail-closed 行为保持；不新增第二 writer 或 cross-process 假承诺 | RED root suite 中 finding/waiver 并发重排；重复并发 ledger regression；B+R | 回退单一 queue 建立时机；不得用排序读取、吞掉错误、双写或放宽 hash/waiver 规则掩盖竞态 |
| LA-099 | Workflow/Team与Private Eval结构化状态在保留child scope、artifact refs和read-only production stopgap下迁入SQLite | LA-024 | workflow runs/team graph/eval Task links与artifact metadata；不重新开放Private Eval执行 | synthetic inventory/import/parity；eval corpus bytes不删不入DB；single cutover | status/child/task/artifact/delivery/eval score refs parity、blocked mutation、rollback/no-dual-write；F | whole-domain回旧只读backup；Private Eval保持disabled |
| LA-100 | 所有LA-025 domain在同一backup manifest/restore演练中通过跨域引用、blob ref与schema migration parity | LA-093,094,095,096,097,098,099 | backup coordinator、cross-domain verifier、migration report；不新增业务writer | consistent DB snapshot + blob manifest；restore到isolated synthetic root | missing/orphan blob、cross-domain FK/ref、schema upgrade/downgrade refusal、restore/replay/export；recovery tests；F | 任一域失败即不关闭LA-025；按manifest whole-domain rollback |
| LA-101 | legacy structured writers全部变为只读兼容入口且AST/runtime证明无永久dual write，完成后关闭LA-025 | LA-092,100 | composition/legacy writer guards、deletion-candidate evidence、LA-025 Epic ledger | 不删除旧reader/backup；每域authority marker唯一；兼容窗口按ADR保留 | production import graph、runtime write sentinels、fresh/restart/rollback、blob orphan report、full storage suite；F | Gate失败按受影响完整域rollback；LA-025保持open |
| LA-107 | SQLite architecture guard必须允许唯一列名的非业务 authority 跨域 backup/recovery helper使用底层 storage primitives，同时继续拒绝所有未列名的 production SQLite bypass | LA-100,101 | `tests/sqlite_storage.test.ts` 的 import-graph guard、`cross_domain_sqlite_backup.ts` 的 isolated recovery boundary；不得改业务 writer/cutover owner/marker | 无迁移、无 canonical data 写入、无 authority 改变；只为已存在的 non-authoritative aggregate backup/recovery module 建立窄 allowlist | 先复现当前 false positive；新增 allowlist/negative assertion，证明 guard 仍拒绝任意未列名非-owner storage import；`sqlite_storage.test.ts`、`sqlite_cross_domain_backup.test.ts`、`npm test`、B | 回退 guard policy 变更；不得把 allowlist 扩大为目录、glob 或 production writer 例外 |
| LA-026 | Desktop与runtime使用随机UDS + authenticated rendezvous/session credential | LA-021 | runtime-client/server launcher/auth | Keychain旧token过渡；Renderer仍不接触credential | port squatter/fake runtime/reconnect/permissions；transport tests；M | 一版loopback兼容仅限已认证升级，不长期双通道 |
| LA-027 | 全系统日志经统一结构化redaction入口 | LA-010,016 | logger/error mapping/diagnostics；禁止业务直接输出敏感payload | 旧日志不重写；retention与schema version | nested errors/headers/paths/customer text redaction；B | 禁止详细日志优先于未脱敏fallback |

## 8. Phase 4：Memory、Document、Prompt与质量

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-028 | 旧TDAI只读迁成MemoryCandidate，永不自动生效 | LA-025 | memory status/tools/bridge/scripts/migrator | inventory->candidate->user confirm->report->backup | zero capture/store、count/source/conflict、no auto recall；memory/TDAI tests；B | 保留旧数据只读；禁用迁移器写入 |
| LA-029 | Confirmed Memory支持scope/conflict/expiry与本地语义召回，仍非Evidence | LA-025,028 | assistant memory/retrieval/UI | active/proposed/revoked/history完整导入 | lexical+semantic gold、authority ordering、revocation；memory/library tests；B+D | semantic pack缺失时显式lexical-only，不伪装ready |
| LA-030 | **Epic，禁止直接执行**：Document Router统一native/light OCR/MinerU/optional backends输出 | LA-017,025 | document worker/capability/router/schema；native、light OCR、router、各optional backend须建独立子工单 | 现有document artifacts映射统一blocks | 子工单覆盖native-first、per-page route、offline/resource limits/provenance；document tests；B | backend缺失显式blocked/partial，不cloud fallback |
| LA-108 | 定义唯一严格的 `DocumentBackend`/probe/normalized block contract；任何后端输出均能保留文件 digest、page、bbox/cell、backend/version、OCR/confidence/correction provenance | LA-017,025 | 新的 document router contract、strict parser/validator、现有 `DocumentEvidenceV1`/document Artifact adapter；不改路由、不启动后端、不写 Project Truth | 无数据迁移；旧 evidence/artifact 只通过纯 adapter 映射，未知/无 provenance 输入显式拒绝 | RED strict-schema/unknown-field/invalid geometry/reading-order/provenance tests；adapter parity；`document_router_contract.test.ts`；B | 删除未接入的 contract/adapter；不得弱化旧 evidence 或创建第二 canonical artifact writer |
| LA-113 | 修正 `DocumentBackend.parse` 只接收显式、host-verified staged-input `DocumentParseRequest`，不能复用 probe 或接收任意 path | LA-108 | document router contract 的 parse request/input-ref validator与interface；不接入 backend/worker/route | 无数据迁移；解析输入只以 opaque host-staged ID + source digest 表示，结果仍绝不回传 path | RED missing parse-request export；source/input digest mismatch、unknown field、invalid page scope refusal；`document_router_contract.test.ts`；B | 回退本接口修正并停止后续 backend Ticket；不得用裸 path 或给 worker 暴露 Project 外路径 |
| LA-114 | `DocumentBackend.probe` 同样只接收 explicit host-staged input，因此可测量页级文本覆盖但不能读取任意 path | LA-113 | document router contract 的 probe/input-ref validator与interface；不接入 backend/worker/route | 无数据迁移；probe/parse共享同一opaque staging identity与source digest | RED missing staged probe input；probe source/input mismatch、unknown field、invalid page scope refusal；`document_router_contract.test.ts`；B | 回退接口修正并停止后续 backend Ticket；不得使 probe接收裸path |
| LA-115 | `DocumentBackendEstimate` 必须严格携带每页 native text coverage、reading-order状态与layout complexity，Router不得从空估计或文案猜测 | LA-114 | document router contract 的 estimate schema/validator；不接入 backend/worker/route | 无数据迁移；estimate只为后续Router选择提供不可变事实，不写 Artifact/Project Truth | RED missing page estimate；unknown field/coverage range/duplicate page/invalid reading-order refusal；`document_router_contract.test.ts`；B | 回退接口修正并停止后续 backend Ticket；不得让 Router以缺页估计选择OCR |
| LA-109 | native text/Office extractor 仅作为注册的 native backend，以逐页 probe 和完整 provenance 输出 LA-108 blocks；文本层足够时绝不触发 OCR | LA-115 | native PDF/Office adapter、page probe、统一 block mapper；不改 managed OCR/MinerU worker 或云路径 | 无存储迁移；现有 native extractors 仅在 parity 后改经 backend adapter，旧 direct caller 保留到 LA-111 删除门 | native text coverage/read-order、per-page page/bbox/provenance、native PDF no-OCR sentinel、Office mapping parity；`document_native_backend.test.ts`；B | feature flag/adapter回现有 native extractor；不得使 native failure静默转云或伪造 OCR provenance |
| LA-110 | managed PaddleOCR 仅作为注册的 local light-OCR backend，输出 LA-108 blocks并保持离线、file-grant、resource-limit和缺 capability fail-closed | LA-115 | existing OCR JSONL worker adapter、normalized block mapper、capability status/limit validation；不启用 MinerU/Unlimited-OCR/remote backend | 无数据迁移；复用现有 pinned managed capability和 Worker，direct Paddle artifact caller保留到 LA-111 parity 后删除 | missing/corrupt/unqualified pack denial、no network/secret/path escape、page geometry/confidence/provenance parity、oversize/time/page/output-limit refusal；`document_light_ocr_backend.test.ts`；security + B | 回现有 direct Paddle evidence path；不得增加 system/cloud fallback 或放宽 worker grant/limit |
| LA-116 | Router 只能消费 Host 私有、内容冻结且带完整 PDF 页清单的 staged document；不得把 grant 原路径、缺页清单或可变源交给 backend | LA-109,110 | staged copy/session、digest/page-inventory、opaque resolver lifecycle；不接路由、Worker、Artifact 或 capability install | 无 canonical 数据迁移；读取已授权 source 后以private temporary copy + digest + page inventory发布；dispose 删除临时副本；无法确定页数即 fail closed | source mutation 后 staged bytes/digest 不变、unknown/revoked handle拒绝、完整页清单、input-size/`pdfinfo` failure cleanup；`document_staging.test.ts`；B | 删除 staging session并保持 direct caller；不得以原path、form-feed猜测或不完整页集代替 |
| LA-111 | Document Router按页只在 native 与 qualified light OCR 间作可解释选择；复杂页若 optional backend未资格化必须 `blocked`/`partial`，不伪装成功 | LA-109,110,116 | router policy/composition、per-page request/result/artifact projection、existing direct document extraction entry migration；不实现 optional backend | 无数据迁移；先对既有 native/Paddle artifact做 block/provenance parity，随后删除 direct route choice，使 Router 成为唯一选择者 | mixed PDF per-page routing、native no-OCR sentinel、missing optional backend blocked/partial、no cloud fallback、frozen route provenance、old direct-choice import guard；`document_router.test.ts`；B+D | Router refusal时保留显式 legacy native/Paddle adapter仅限回滚；完成后不得永久保留并行 route chooser |
| LA-112 | Router只接受版本化、可复核的 benchmark policy profile；无合格证据时保持保守 native/light/blocked 选择，绝不宣称任一 heavy backend默认最佳 | LA-111 | benchmark fixture/profile schema、router policy loader、qualification evidence report；不得读取真实客户文档或下载 backend | 仅添加 synthetic fixture/report contract；真实 hardware/corpus qualification仍由 LA-031/release gate 记录，不写入 canonical project data | profile digest/version/unknown-field refusal、threshold reason trace、missing/expired profile conservative fallback、no marketing hard-code；`document_router_benchmark.test.ts`；B | 删除未接入 profile loader回保守 policy；不得把未资格化 MinerU/Unlimited-OCR 标为 ready |
| LA-031 | MinerU与Unlimited-OCR只能在资格化的optional backend启用 | LA-030 | qualification/install manifests/Settings Labs | fixed revision/digest/models/hardware matrix | CER/layout/table/memory/crash/license records；document qualification；M | 保持disabled；无系统/cloud fallback |
| LA-032 | Prompt Compiler 2.0计算完整request预算、包装untrusted sources，并提供预算所需的最小 `ModelContextRegistry` | LA-003,009,013,014 | prompt/minimal model-context registry/tool schemas/history/provider framing；只记录已验证context/output预算 | manifest version兼容；旧Run用旧hash只读；当前支持模型沿用LA-003验证条目 | tool/history/output reserve/known+unknown model/injection/bidi/zero-width；prompt tests；B | blocked或new Run；不回overBudget ready |
| LA-033 | 只扩展完整 `ExecutionProfile` 与模型质量路由（Fast/Balanced/Best） | LA-009,032 | model/settings/run planning/router；复用LA-032上下文预算，不另建第二个context registry | 旧模型选择映射为显式profile；不猜质量或工具能力 | profile plan snapshots、质量路由、显式model switch compatibility；B+D | 回到已知Balanced profile，不自动选择未知模型 |
| LA-034 | SegmentProfiler/ContextGraph只产生可追溯上下文，不成为authority | LA-025,029,033 | CAT context/evidence/retrieval | graph nodes绑定source hash/revision | relevance/provenance/stale invalidation；CAT context tests；B | 关闭graph回当前evidence retrieval |
| LA-035 | TM-first candidate pipeline在安全复用时跳过昂贵生成 | LA-033,034 | TM/proposals/router/cache | cache key覆盖source/context/constraints/assets/model/prompt | exact/fuzzy/diff repair/cache invalidation；TM/proposal tests；B | 关闭cache/route回单模型proposal，不绕gate |
| LA-036 | 高风险segment的独立Critic只提finding，不能直接commit | LA-035 | delegated roles/review priority/proposal gate | findings/artifacts versioned | critic independence、no self-approval、targeted repair；QA/Team tests；B | 关闭critic回deterministic QA+human review |
| LA-037 | Batch consistency pass只修命中segment，不重生成全批 | LA-036 | consistency checks/targeted repair | repair proposal保留causation/evidence | terminology/voice/repetition/locked rows、cost bounds；B | 只输出findings，不自动repair |

## 9. Phase 5：API、Electron与前端投影

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-038 | API外部输入全部由shared strict schema验证 | LA-008 | contracts + route groups + workspace client generation | endpoint逐组迁；稳定ErrorEnvelope | boolean/string/array/unknown/body/content-type；route tests；B | endpoint adapter可回旧handler，但strict prevalidator保留 |
| LA-039 | Electron main/preload迁TypeScript且共享同一IPC contract | LA-038 | desktop main/preload/build/package | 保持输出文件/asar allowlist兼容 | compile drift/security/package tests；B+D+M | manifest切回旧entry一版 |
| LA-040 | 删除generic `api.request`，Renderer只能调用固定capability IPC | LA-039 | preload/main/workspace client按feature迁 | route inventory；短期bridge仅承载未迁endpoint | untrusted frame/XSS/arbitrary method/path；D+M | feature级回旧bridge；完成后不可永久保留 |
| LA-041 | Renderer不能提交任意本机path；reveal/import/export使用opaque ID/handle | LA-039,040 | revealPath、pickers、artifact/project APIs | canonical path由main/server解析 | sensitive/path traversal/symlink/cancel；desktop security tests；D+M | 关闭reveal优先于恢复任意path |
| LA-042 | TaskProjectionStore仅由snapshot+ordered events重建产品事实 | LA-008,038 | workspace-store/task-events/app provider | 保持现有store facade逐feature迁；不要求等待SQLite迁移 | duplicate/gap/reload/background/decision/queue；D | adapter回现有store，禁止第二事实store |
| LA-043 | stream coalescing使UI更新有界且final/decision/tool不延迟错序 | LA-012,042 | GlobalEventProvider/timeline/store | 无schema | 20fps、final flush、page switch/background；D | 关闭UI动画/降频，不丢canonical event |
| LA-117 | root test discovery必须为每个child test建立受guard保护的临时synthetic repo/Pi-agent root；direct literal `npm run server` launcher若不继承该环境须在执行前拒绝 | LA-106,043 | `scripts/test-discovery.ts`、test-only synthetic-root helper与runner guard；不得改production root resolution或测试业务行为 | 每次root suite仅用可清理临时root；child可用自身更窄synthetic root；不得读取/写入checkout `data/**` 或home Pi trust | RED runner-env/per-child cleanup/direct-launch guard tests；server-root override regression；仅在安全审核确认后重新运行完整G5命令；B | 回退runner safety change并保持G5 blocked；不得用shell wrapper、筛选、环境覆盖或silent fallback伪造Gate |
| LA-118 | 每个 root-test child 的实际 `cwd` 必须是无 `data/**` 的合成 test-root；只显式暴露运行测试所需的白名单源码/fixture/config 视图，测试模块以 checkout 的绝对路径装载 | LA-117 | `scripts/test-discovery.ts`、`tests/test_discovery.test.ts` 与 G5 账本；不得改 production root resolution、server 行为或测试选择 | child 临时根只含 `.pi` synthetic settings、专属 Pi-agent 目录及 allowlisted `apps`、`contracts`、`docs`、`packages`、`patches`、`scripts`、`tests`、`node_modules` 和必要根配置；不链接 `data`、`.git`、home 或其他 checkout entries | RED synthetic-cwd/source-view/no-data/absolute-test-path characterization；`test_discovery`；安全 root roadmap subset；B；随后以直接 `npm test` 重跑 G5 | 回退 test-root view 并保持 G5 blocked；不得用 shell wrapper、筛选、环境覆盖、checkout cwd 或 silent fallback 伪造 Gate |
| LA-119 | 合成 child `.pi` 只能加入当前 root tests 所需的已跟踪静态项目材料：runtime constitution、Team agent profiles 与 memory-extension source；不得暴露 project settings、skills、npm package tree、其他 extensions、home trust 或 `data/**` | LA-118 | `scripts/test-discovery.ts`、`tests/test_discovery.test.ts` 与 G5 账本；不得改 Pi runtime、production root 或测试业务行为 | `.pi` 仍由 synthetic settings/skills/prompts 与专属 Pi-agent 目录拥有；只复制 `APPEND_SYSTEM.md`、`extensions/memory.ts`，只链接 `.pi/agents`；不加载或链接 `.pi/settings.json`、`.pi/npm`、其他 extensions | RED Pi material allowlist/absence characterization；`test_discovery`；`cat_prompt_isolation`、`team_role_agents`、`memory_tools`；随后继续直接 root G5 recheck；B | 回退这三个 static resource entries 并保持 G5 blocked；不得扩大为整个 `.pi`、用户 agent trust 或 shell/filter workaround |
| LA-120 | 合成 child cwd 只加入 Dev preset 所需的 tracked 根 `AGENTS.md` project context；不得以复制 README/docs 或外部祖先路径扩展 Pi context | LA-119 | `scripts/test-discovery.ts`、`tests/test_discovery.test.ts` 与 G5 账本；不得改 Dev/CAT preset、Pi runtime、production root 或测试业务行为 | 复制唯一 `AGENTS.md` 到 temporary cwd；它由 Pi `loadProjectContextFiles` 在 Dev preset 下读取；不得链接 checkout parent、`.git`、home、`data/**` 或其他 root prose | RED synthetic Dev-context presence/allowlist characterization；`test_discovery`；`cat_prompt_isolation`；随后继续直接 root G5 recheck；B | 回退唯一 copied context file 并保持 G5 blocked；不得关闭 Dev context、复制全部 root docs 或采用 shell/filter workaround |
| LA-121 | 合成 child `.pi` 只加入 Team child production loader 所需的 tracked `extensions/team-evidence-child.ts`；不得因此加载其他 project Extension 或 package tree | LA-120 | `scripts/test-discovery.ts`、`tests/test_discovery.test.ts` 与 G5 账本；不得改 Team runtime、Pi resource policy、production root 或测试业务行为 | 复制唯一 Team child extension 到 existing synthetic `.pi/extensions`；保留 `noExtensions` 默认与 synthetic settings，且不链接 `.pi/npm`、其他 extensions、home trust 或 `data/**` | RED Team-extension presence/absence characterization；`test_discovery`；`team_evidence_child_runtime`；随后继续直接 root G5 recheck；B | 回退唯一 extension file 并保持 G5 blocked；不得扩展为整 `.pi/extensions`、wrapper/filter 或 production-root fallback |
| LA-122 | data-root writer lease regression 必须读取 canonical Electron entry `apps/desktop/src/main.ts`，而非已由 LA-039 删除的 `main.mjs` | LA-121 | `tests/data_root_writer_lease.test.ts` 与 G5 账本；不得改 lease、Electron runtime 或 production source | 无数据迁移；只将 source guard 迁至唯一当前 entry | 已观察到旧路径 ENOENT 的 RED Gate failure；更新 guard；`data_root_writer_lease`；随后继续直接 root G5 recheck；B | 回退此测试迁移并保持 G5 blocked；不得恢复 `main.mjs`、dual entry 或跳过 Electron single-instance assertion |

## 10. Phase 6：UI合同与产品面收敛

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-044 | Composer/queue/steer只消费canonical Run/queue/decision状态 | LA-042,043 | composer/conversation/store | 现有行为保持；移除本地推断 | active/terminal/reload/keyboard/a11y；D | 保持旧view adapter，不恢复本地truth |
| LA-045 | Timeline统一Message/Activity/Decision/Artifact/Recovery item协议 | LA-011,042 | ConversationItems/TaskConversation/models | 历史Task投影兼容 | ordering/aggregation/virtualization/long thread；D | renderer adapter映射旧items |
| LA-046 | Decision Center恢复全部pending decision并显示scope/hash/expiry | LA-014,038,042 | permission/decision UI、Settings/Inspector | 旧decision类型映射；未知类型只读blocked | reload/duplicate/expire/revoke/reject；D+server tests | 回旧专用cards但backend decision仍唯一 |
| LA-047 | CAT Workspace在10k rows下保持revision/CAS、locked、tag、QA/delivery可用 | LA-025,034,042 | CAT grid/editor/inspector | 不改格式源；draft/proposal/commit层次保持 | 10k p95、conflict、keyboard、VO、200% zoom；D+M | 性能优化可回滚，不能回last-write-wins |
| LA-048 | Library/Memory/Document UI显示provenance、backend/job状态与修正入口 | LA-029,030,042 | Library/settings/artifact/inspector | existing artifacts readable | source navigation/reindex/partial/failed/correction；D | 缺backend显式unavailable |
| LA-049 | 一级导航收敛Chats/Projects/Library/Settings，功能不因移位消失 | LA-046,047,048 | shell/nav/Settings；Package移Settings；Maintainer/Eval降级 | route alias一个版本；不删数据 | shortcut/deep link/480px/discoverability；D+M | 恢复旧导航入口，不恢复重复业务逻辑 |
| LA-050 | **Epic，禁止直接执行**：Maintainer与Private Eval退出production执行面，迁至CI/tools。仅由 LA-129、LA-130、LA-131、LA-132、LA-133 完成后关闭 | LA-017,049,060,061 | Maintainer迁移、Eval迁移、历史导出、生产删除须分别建子工单 | jobs/eval corpus/artifacts只读可导出 | 子工单覆盖production route absent、tool parity、release checks；F | 暂留read-only route；不恢复production mutation |
| LA-129 | Maintainer 候选构建只由显式 developer/CI 工具执行，保留同一 plan-hash/isolated-worktree/validation 合同 | LA-017,049,060 | `scripts` tool、`maintainer.ts`、合成 tool tests；不重开 Stable route/UI | tool 输入显式 repo/target/output；不读真实 `data/**`；不写当前 runtime | RED tool contract；plan hash、worktree、validation parity；Stable route仍403；B+F | 删除新 tool entry；不得让 server 代为执行或恢复 route |
| LA-130 | Private Eval 只由显式 CI/developer harness 在合成 root 执行，保持 canonical single/team 运行合同 | LA-017,049,061 | `scripts` harness、private-eval canonical modules、合成 harness tests；不重开 Stable route/UI | harness 输入显式 fixture/root；production Eval history 不改写；不读真实 `data/**` | RED harness contract；single/team output/status parity；Stable route仍403；B+F | 删除 harness；不得将 execution 回接 production route/UI |
| LA-131 | Maintainer 与 Private Eval 历史只读导出具有一个显式工具合同，且不启动执行或写入历史 | LA-129,130 | shared export tool/DTO、synthetic history fixtures；不删除历史 | stdout/指定导出仅含已有 canonical facts；无隐式 root、无 reconciling write | RED empty/unknown/read-only/export-shape tests；B+F | 移除 export tool；不得以 export 名义执行或重写历史 |
| LA-132 | 在 Maintainer tool parity 与历史导出后移除 production Maintainer route/UI execution consumer | LA-129,131 | `maintainer_routes` server wiring、unused panel/route consumers、architecture deletion exception、tests/docs | 保留核心 tool 与历史 export；不删 candidate/report data | RED no-server-route/no-UI-consumer/architecture-exception tests；Maintainer tool parity；F | 恢复唯一 read-only compatibility route，不恢复 mutation |
| LA-133 | 在 Eval harness parity 与历史导出后移除 production Private Eval route/UI execution consumer | LA-130,131 | eval route/server wiring、Pipeline Eval consumer、tests/docs | 保留 CI harness 与历史 export；不删 eval corpus/artifacts | RED no-server-route/no-UI-consumer tests；single/team harness parity；F | 恢复唯一 read-only compatibility route，不恢复 execution |
| LA-051 | **Gate，禁止直接执行**：净化后的LA UI行为合同通过可重复截图/a11y/perf矩阵 | LA-043,044,045,046,047,048,049 | Playwright fixtures/tokens/components/`LA_UI_BEHAVIOR_SPEC.md`；未满足项另建子工单 | screenshot baseline版本化 | 480×600/1024×700/1280×820/200%/themes/motion/axe/VO/10k/long thread；M+manual P3 | 回滚视觉baseline，不回滚数据/安全contracts |

## 10.5. Phase 6+：Codex UI 复刻（用户 2026-07-24 授权）

**授权记录**：用户于 2026-07-24 明确指示：当前前端质量不足，要求按 `docs/ui/codex-ui-spec-full.md` 在私有仓库内进行大刀阔斧的复刻改造；用户确认该文档本身在私有仓库使用没有问题，公开推送前按 campaign 净化规则移除即可。因此：本组工单（LA-134 至 LA-142）把 `codex-ui-spec-full.md` 作为**私有实现目标**执行；`docs/ui/LA_UI_BEHAVIOR_SPEC.md` 仍是唯一公开 UI 行为合同；公开镜像净化清单不变（`codex-ui-spec-full.md` 与反编译材料仍排除在外）。既有边界不变：后端 canonical 事实、CAT hard rails、权限/安全 policy 永远高于视觉规格；不复制任何品牌资产、Logo、专有源码或完整内部文案；`CODEX_UI_CONTRACT.md` 的栈约束（不引入 Tailwind/Framer Motion/Radix 迁移）继续有效。

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-134 | 设计令牌层补全为单一事实源：语义按钮四态/状态/边框/elevation/superellipse 圆角引擎/图标与容器刻度/z-index 约定，dark 主题声明只存在一处 | LA-042,043 | `styles/tokens.css`、`styles/base.css`、token contract tests；不做组件重写，不改后端 | 现有 `--la-*` 名称保留；新增语义 token 增量映射；删除 dark 双块重复 | RED token contract（精确值、superellipse `@supports` 引擎、dark 单一来源、retired alias 仍禁）；`codex-ui-contract` 回归；D+B | 回退 token 增量；不得恢复双 dark 块或第二套色板 |
| LA-135 | 统一 46px 标题栏/拖拽区/traffic-light 安全区，删除 Workspace 回退 toolbar 与 `product-workspace.css` 双重 import | LA-134 | `styles.css`、`ProductToolbar`、`ProductWorkspace`、`Workspace` shell、shell CSS；不改 window options 安全参数 | 拖拽区语义不变；safe-header inset 经 CSS 变量；移除重复 chrome 而非新建 | RED shell chrome contract（46px 单一条、28px 残留、fallback toolbar 缺席、单一 import）；D+M | 回退 chrome 合并；不得恢复双 toolbar 或降低拖拽避让 |
| LA-136 | 侧栏与命令面板复刻：宽度 clamp、footer、行/状态徽标/pin hover、折叠浮层入场动画、cmdk 解剖（≤520px、item min-h 24px、radius-lg、分组、空态） | LA-134 | `WorkspaceSidebar`、workspace.css、`CommandPalette`/command-palette.css；不改 server-backed 选择逻辑 | 树/上下文菜单/徽标数据链不变；仅结构/样式/动效迁移 | RED sidebar/palette contract（clamp、footer 72px、running/unread 徽标、浮层动画、cmdk 尺寸）；D | 回退样式迁移；不得把导航状态移出 canonical scope |
| LA-137 | Composer chrome 复刻：squircle surface/elevation-prominent/backdrop/drag/blocked-inert、footer grid、附件区、placeholder 伪元素机制、slash 菜单 cmdk 解剖；BatchReady 与 TaskConversation 双装配收编为单一 composer 装配 | LA-134 | `AgentComposer`、composer-controls、composer.css、conversation-composer.css、`Workspace.tsx::BatchReady`、`TaskConversation` send 区；不改 send/queue/steer 语义 | canonical Run/queue 状态源不变；双装配合并为共享装配组件 | RED composer contract（surface/阴影/圆角/drag 态/footer 网格/placeholder）+ 单一装配 characterization；D | 回退 chrome 与装配合并；不得新建第二套 send 状态机 |
| LA-138 | 排队消息托盘复刻：max-h 30dvh、行解剖/拖柄/hover 操作、Retry/Edit/Delete/Steer/开关 queueing、暂停/中断补救文案、清空确认、行 0.18s 高度/透明度过渡 | LA-137 | `QueuedMessageList`、queued-message-model、composer CSS；queue server contract 不变 | server-owned queue 事实不变；仅呈现/交互迁移 | RED queue contract（尺寸/行操作全集/暂停态/确认框/过渡）；queued model 回归；D | 回退呈现迁移；不得本地伪造 queue 状态 |
| LA-139 | 线程流复刻：活动头行整行隐形按钮/aria-expanded/hover 提亮/双段色、Worked divider 标签+通栏 1px 线、回到底部 32px 圆钮+三点波浪、reasoning ≤140px+edge fade、文件列表 200px fade mask、时间戳 hover 浮现、user 气泡精修（show more/hover 操作） | LA-134 | `ConversationItems`、conversation-items.css、`TaskConversation`、conversation-shell.css；virtualizer/coalescer 不动 | canonical item 协议不变；仅结构/样式/交互迁移 | RED thread contract（各解剖类与尺寸/hover 规则/divider 结构）；conversation model 回归；D | 回退呈现迁移；不得改事件节流/virtualizer 语义 |
| LA-140 | Decision/Plan/工具卡复刻：审批卡 rounded-3xl 外壳/三段头/Reason 区/kbd Enter-Esc/分割按钮/命令预览 3 行折叠/文件预览 200px；Plan 卡摘要标题+删除线 todo+高度状态机+Step pill 进度环；工具卡双段色与 `· N times`；model-changed 内联分割线+ⓘ tooltip | LA-139 | `DecisionInteraction`、`PermissionRequestSurface`、ConversationItems、新 plan/tool 卡组件与 CSS；decisionBinding 服务端事实不变 | 历史 decision/activity 投影兼容；新增组件只消费 canonical 投影 | RED cards contract（外壳/按钮行/kbd/折叠阈值/plan 状态机/分割线）；decisions/permissions 回归；D | 回退卡片迁移；不得由 Renderer 推导 binding/expiry |
| LA-141 | Power Slider 完整化：Advanced 视图切换、Fast 模式（轨道粒子+切档 burst+toggle）、端点标签按住显示、Ultra 警告 shimmer、reset-to-default、键盘值播报 | LA-134 | `ComposerPowerSlider`、composer-power、composer CSS；ExecutionProfile 路由合同不变 | 既有 slider 像素规格保持；新增为增量 | RED slider contract（advanced/fast/粒子/警告/reset/aria 播报）；composer-power 回归；D | 回退增量；不得把 profile 语义改为猜测路由 |
| LA-142 | Motion 库落地：第 6 章 keyframes/弹簧缓动/错峰系统经 token 实现，reduced-motion 等价关闭 | LA-134 | tokens/base/各 feature CSS motion 区块；不引入动画库依赖 | 现有 keyframes 保留并归一到 token；新增补全缺口 | RED motion contract（关键 keyframes/参数/reduced-motion 覆盖）；D | 回退 motion 增量；不得引入 JS 动画依赖 |
| LA-143 | Power Slider 每档差异化动效：轨道填充随档渐变、切档粒子爆发、max 档环境粒子流；档位语义不变 | LA-141 | `ComposerPowerSlider`、composer.css、slider motion contract tests | 无数据；滑杆选择/持久化/播报语义不变；动效仅呈现层且 reduced-motion 可关 | RED slider motion contract（fill 渐变/spring、burst 12 粒子 .62s 曲线、max-only 粒子流、data-index）；composer-power 回归；D | 回退动效层；不得伪造 Fast 模式或改档位语义 |

## 10.6. Phase 6+：Agent Plan 与模型可视化回答（用户 2026-07-24 授权）

**授权记录**：用户于 2026-07-24 要求实现 LA 的结构化 todo/计划支持（工作进度可视化），并要求模型回答尽可能组件化、卡片化而不停留在文字。设计决定：todo 是 server-owned canonical 事实而非 UI overlay——经 `agent_plan` 版本化 artifact + rich artifact `todo_list` block + host-owned `update_plan` 工具落地；pi.dev 第三方 todo/plan 扩展（`@juicesharp/rpiv-todo`、`@narumitw/pi-plan-mode` 等）按 Stable 政策禁止加载，仅作 clean-room 行为参考。模型永远不得产出原始 HTML/JSX；一切可视化经 server 校验的声明式 schema。本组同时为后续"模型回答可视化"（chart/table/diff 等 block 对模型开放）确立同一通道。

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-144 | rich artifact schema v1 增加严格校验的 `todo_list` block（id/text/status: pending/in_progress/completed），Electron preview 与惰性 HTML 导出同步渲染 | LA-042 | `packages/cat-data/src/rich_artifact.ts`、`RichArtifactPreview`、inspector CSS、root/desktop block tests | 现有 block/artifact 兼容；纯增量，不新增 artifact type | RED schema block tests（parse/round-trip/非法 status 拒绝/HTML 导出删除线）；rich_artifact 回归；B+R+D | 回退 block 增量；不得放宽可执行标记禁令 |
| LA-145 | 新 artifact type `agent_plan` 与 host-owned `update_plan` 工具：server 校验 todo payload 后向 canonical Task workspace 写新版本 artifact（standalone/project 双 scope），工具带完整 capability metadata | LA-014,144 | `task_workspace_contract.ts` artifact 类型/校验、cat-tools 或 cat-runtime 工具定义+能力元数据、session 工具面注册、server 写入路径、activity 投影 | artifact 类型枚举增量；SQLite projection 复用既有 artifact 表无迁移；旧 Task 无该 type 不影响 | RED artifact type/tool contract（schema v1、版本递增、双 scope、未知 type 拒绝、capability metadata 完整、无 tool 不注册）；B+R+D | 回退 type/tool；不得让模型直接写 UI 状态或绕过 server 校验 |
| LA-146 | 时间线 Plan 卡（spec 05 §3.3 解剖：进度摘要标题、check 图标+删除线 todo 行、高度状态机）与 composer 上方 Step pill（进度环+Step n/N，取 active Run 最新 agent_plan 版本） | LA-139,145 | ConversationItems/conversation CSS、`TaskConversation` pill 区、renderer plan 模型 | 历史无 plan artifact 的 Task 不显示；只读 canonical 投影 | RED plan card/pill contract（摘要句、删除线、进度环、无 plan 不渲染、版本取最新）；D | 回退呈现层；不得由 Renderer 推导进度或伪造 todo 数据 |
| LA-147 | 新 artifact type `agent_present` 与 host-owned `agent_present` 工具：模型提交声明式 block 组合（markdown/table/chart/diff/file_reference；todo_list 专属 plan 工具，image/page_overlay 不开放），server 校验并盖章 generator/createdAt 后写 canonical 新 artifact（每次调用新 id）+ `artifact_update` activity；server_tool 桥按工具名路由分发 | LA-145 | `task_workspace_contract.ts` artifact 类型、cat-tools `present-answer-tool.ts`+index 导出、toolCapabilities `task-present` kind、generalSessionPlan 注册（不进 initial-active）、createGeneralAgentSession 实例化+prompt 行、agentRuntimePort 注入、general_worker_rpc 桥+SERVER_TOOL_NAMES+请求级分发、general_worker_runtime 路由、general_agent_runs 校验器/写入器/3 接线点 | artifact 类型枚举增量；无迁移；旧 Task 无该 type 不影响 | RED tool/artifact contract（严格校验、block allowlist、每次新 id、artifact_update activity、stale run 拒绝、capability metadata、桥解析、session 注册）；B+R+D | 回退 type/tool；模型不得产出原始 HTML/JSX；不得绕过 server 校验或让 Worker 直写 Task 真相 |
| LA-148 | 时间线 Answer 卡：`agent_present` artifact 在会话时间线渲染为卡片，复用既有 block 渲染（markdown/table/chart/diff/file_reference），只读 canonical 投影，多次 present 按时间序并列 | LA-146,147 | ConversationItems/conversation CSS、renderer present 模型、desktop 测试 | 历史无 present artifact 的 Task 不显示；只读 canonical 投影 | RED answer card contract（各 block 渲染、无 artifact 不渲染、时间序并列、数据不被 Renderer 改写）；D | 回退呈现层；不得由 Renderer 改写 block 数据或伪造 present 内容 |

## 11. Phase 7：工具链、删除、发布与治理

| ID | 唯一目标/不变量 | 依赖 | 修改范围 | 迁移 | 测试/验收命令 | 回滚 |
|---|---|---|---|---|---|---|
| LA-052 | npm成为唯一workspace/lock/install事实源且root覆盖apps | LA-000 | manifests/locks/pnpm/CI | 先生成/比较lock与artifact，再删旧 | clean npm ci、F、package hash parity | 保留当前双install结构直到完全等价 |
| LA-054 | CI按validate/unit/security/recovery/macos/release分层且依赖固定 | LA-053 | workflows/scripts | 不降低现有mac gate | workflow lint、local scripts、artifact upload、pinned SHA；F | 保留原CI直到新jobs全绿 |
| LA-055 | **Epic，禁止直接执行；已由 LA-123、LA-124、LA-125、LA-126、LA-127 完成并关闭**：composition root不含业务I/O/状态决定，依赖方向由CI强制 | LA-008,010,014,023,038 | 五张子票分别完成 application port、route transport、composition、import-boundary 与 Settings permission edge；禁止机械拆文件 | 无数据 | 子工单 RED/回归、完整 architecture graph、239-test synthetic root、Desktop/mac 均通过；routes不fs/Pi（只剩LA-050精确Maintainer FS例外）；B+R | 可回移动但不能复制authority |
| LA-123 | Application service port先冻结Task/Run/Settings/Package/Document route clusters的输入/输出/authority边界，不迁移route、不切writer | LA-008,010,014,023,038 | `cat-server` application contracts/adapters、现有route tests、architecture inventory | 无数据；既有行为和canonical writer不变 | RED inventory/port completeness；Task/Run/permission/storage route regressions；B | 移除未接线port；不得让route或composition猜测状态 |
| LA-124 | HTTP route只解析/验证/映射transport，并经LA-123 application port委托；route不直接执行FS、Pi session或状态决定 | LA-123 | `packages/cat-server/src/routes/**`与相邻route adapters；不改Electron/Task/CAT事实 | 逐cluster迁移；route alias/DTO保持；无数据 | 每个迁移cluster的route regression；AST/rg direct-FS/Pi/state-decision guard；B+R | 逐cluster revert到已验证application adapter；不得保留dual decision writer |
| LA-125 | server与Electron composition root只装配依赖/transport/lifecycle，不拥有领域I/O、Task/Run状态决定或Pi session业务编排 | LA-123,124 | `cat-server/src/server.ts`、Desktop main composition与已抽application services；不机械搬运业务代码 | 无数据；active Run、lease、cutover、CAT gates与Pi worker authority保持 | RED composition characterization；server/desktop integration and worker/route regressions；B+R | 回退单个已抽service wiring；不得重建隐式global或第二lifecycle |
| LA-126 | CI用可审计import graph强制application/route/composition依赖方向，并拒绝route direct FS/Pi和composition越界回归 | LA-124,125 | architecture guard/test-discovery/CI；不移动业务代码 | 无数据；allowlist只允许经审计的compatibility exception且有删除owner | RED forbidden-edge fixture；full graph/exception-owner test；CI local contract；B+R | 保留最后通过的guard与显式exception inventory；不得删除guard或以glob忽略违规 |
| LA-127 | Settings permission route 不直接导入 Pi runtime；权限模式/规则/contract 由既有 server-owned Settings application port 负责 | LA-126 | `agent_permission_routes.ts`、Settings application port、permission route tests、architecture exception；不改Decision/permission writer或Electron | 无数据；移除 LA-126 精确 exception，不新增权限默认、第二 writer 或 route-local fallback | RED direct-Pi edge；permission route/application regression；architecture graph 无该 exception；B+R | 回退该单一 port delegation；不得保留 route/runtime 双实现或 unknown->allow |
| LA-056 | **Epic，禁止直接执行**：只删除已迁完且AST/数据/测试证明无消费者的旧入口 | LA-019,020,025,040,050,055 | `DELETION_CANDIDATES.md`每个候选分别建独立删除子工单 | 备份/兼容窗口/迁移报告 | 每个子工单独立knip/rg/AST、migration fixtures、F | revert单项删除；不回永久双轨 |
| LA-057 | 发布候选通过人类blind review与真机P3，不用自动化替代 | LA-051,054,056 | release docs/evidence only +必要修复另开票 | isolated two-batch synthetic；不碰客户/managed runtime | `docs/HANDOFF.md`全命令、blind review、VO、real install | 未通过即不发布，不降低门槛 |
| LA-058 | **Gate，禁止直接执行**：signed/notarized Electron zip/dmg/checksum/SBOM支持clean install、upgrade、rollback、uninstall | LA-057 | release scripts/workflows/installer；每个平台/渠道失败项另建子工单 | 用户数据保留/backup manifest | 两个signed builds、notarization、Gatekeeper、rollback；release full set | 保留前一签名版本，禁止ad-hoc fallback |

## 12. 依赖摘要

```text
LA-000
  ├─ LA-001 permission stopgap
  ├─ LA-002 sandbox stopgap
  ├─ LA-003 prompt stopgap
  ├─ LA-004 package stopgap
  └─ LA-005 extension stopgap

Run/Runtime: LA-008 -> 009 -> 010 -> 011 -> 012/013
Security:    LA-014 -> 015/016 -> 017 -> 018 -> 019 -> 020
Packages:    LA-076 -> 077 -> 078; LA-076 -> 079; LA-078/079 -> 080 -> 081 -> 082 -> close LA-020
Storage:     LA-021 -> LA-022; LA-062 decision -> LA-023; LA-084 -> LA-085 -> LA-086 -> LA-102 -> LA-087; LA-086 -> LA-088 -> LA-103 -> LA-104; LA-087/LA-088/LA-104 -> LA-105; LA-087/LA-088/LA-103/LA-105 -> LA-089 -> LA-090 -> LA-091 -> close LA-024; LA-092 -> LA-093 -> LA-106; LA-093/LA-094/LA-095/LA-096/LA-097/LA-098/LA-099 -> LA-100 -> LA-101 -> close LA-025

G4 enablement: LA-106 is an executable Phase 3 test-safety ticket. It must complete before the Storage Gate can be rechecked; it does not itself close LA-024/LA-025 or authorize any later domain cutover.
G5 enablement: LA-117 established per-child roots but left checkout `cwd` reachable. The user explicitly authorized LA-118's precise no-`data/**` synthetic test-root view on 2026-07-24. Its fresh direct root suite first required tracked Pi materials (LA-119), Dev context (LA-120), and one Team child extension (LA-121), then exposed the stale deleted `main.mjs` test guard; LA-122 independently moved that guard to canonical `main.ts`. The subsequent direct full G5 recheck passed under the synthetic source view (`npm test` 231 discovered root tests with only the declared absent-E5-pack skip; security 29; recovery 19; Desktop/mac/typecheck/roadmap/release checks). G5 now permits LA-044 and Phase 6 private work only; it does not permit final verification, public-mirror work, release, merge, or any R-030-dependent action.
Knowledge:   LA-028/029; LA-108 -> LA-113 -> LA-114 -> LA-115 -> LA-109/110 -> LA-116 -> LA-111 -> LA-112 -> close LA-030 -> LA-031; LA-032 -> 033 -> 034 -> 035 -> 036 -> 037
Frontend:    LA-038 -> 039 -> 040/041; LA-042 -> 043 -> LA-117 -> LA-118 -> LA-119 -> LA-120 -> LA-121 -> LA-122 -> G5 passed -> 044-051
Tooling:     LA-053 (early) -> LA-054; LA-052 independent
Governance:  LA-059 decision (Phase 0); LA-060/061 stopgaps -> LA-129/LA-130 -> LA-131 -> LA-132/LA-133 -> close LA-050 epic
Release:     LA-123 -> LA-124 -> LA-125 -> LA-126 -> LA-127 -> close LA-055 -> LA-056 -> LA-057 -> LA-058
```

## 13. 每张工单的开始/完成门

开始前必须：读取蓝图对应章节、七份事实文档、工单列出的源码/测试；复述当前调用链；确认工作树状态；先写失败或characterization test。

完成时必须：只改变唯一不变量；列出文件与删除项；运行精确命令；说明数据迁移/回滚；更新权威文档；明确真机/生产/许可证等未关闭门。不得以“测试文件存在”代替本轮测试结果，不得用 unknown->allow、空catch、`|| true`、`as any` 或第二套状态机绕过问题。
