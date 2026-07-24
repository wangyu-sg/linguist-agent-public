# Linguist Agent 删除候选清单

基线：`64bcb15b`。本文件不是删除授权。任何候选只有在消费者迁移、数据兼容、测试和回滚门全部满足后才可删除；已删除项必须在其独立 Ticket 中留下证据和可逆的 Git 回滚路径。

## 1. 判定标签

- **retain**：蓝图应复用的当前资产。
- **hide/disable first**：先从 Stable/生产面关闭，保留兼容实现。
- **migrate then delete**：新入口完成并验证后删除。
- **investigate**：消费者/数据证据不足，禁止删除。

## 2. 删除候选工单覆盖

下表只登记可能删除、替换或从 Stable 隐藏的候选；`retain` 与运行时清理政策不属于删除工单。表内工单只是覆盖关系，仍须遵守对应 Ticket/Epic/Gate 的执行限制；LA-056 Epic 必须为每个实际删除动作另建独立子工单。

<!-- ROADMAP_DELETIONS_BEGIN -->
| Candidate | Tickets |
|---|---|
| full-permission-preset | LA-006 |
| unknown-permission-fallback | LA-001 |
| stable-executable-extension-load | LA-005, LA-018, LA-019 |
| package-preview-npm-installer | LA-004, LA-020 |
| generic-renderer-api-bridge | LA-040 |
| renderer-reveal-path | LA-041 |
| electron-main-preload-js | LA-039 |
| general-session-factory | LA-010, LA-056 |
| cat-session-factory | LA-010, LA-056 |
| production-maintainer | LA-060, LA-050, LA-129, LA-131, LA-132, LA-056 |
| production-private-eval | LA-061, LA-050, LA-130, LA-131, LA-133, LA-056 |
| team-special-runtime-rpc | LA-017, LA-071, LA-072, LA-056 |
| persona-product-lifecycle | LA-049, LA-056 |
| pipeline-top-level-surface | LA-049, LA-056 |
| package-center-top-level-nav | LA-049, LA-056 |
| selected-session-remnants | LA-009, LA-056 |
| task-json-writer | LA-024, LA-087, LA-089, LA-091, LA-056 |
| other-structured-json-writers | LA-025（已关闭）, LA-093, LA-094, LA-095, LA-096, LA-097, LA-098, LA-099, LA-100, LA-101（Gate通过，未删除）, LA-056 |
| cat-core-legacy-manifest-batch-tm-termbase-writers | LA-097, LA-056 |
| cat-governance-legacy-proposal-checklist-ledger-export-writers | LA-098, LA-056 |
| workflow-eval-legacy-structured-writers | LA-099, LA-056 |
| assistant-memory-json-writer | LA-095, LA-056 |
| legacy-tdai-runtime | LA-028, LA-056 |
| legacy-runtime-migrations | LA-056 |
| pnpm-workspace-and-desktop-lock | LA-052, LA-056 |
| manual-root-test-chain | LA-053, LA-056 |
| unpinned-release-actions | LA-054 |
| duplicated-current-state-docs | LA-000, LA-056 |
<!-- ROADMAP_DELETIONS_END -->

## 3. 生产路径候选

| 候选 | 标签 | 当前文件/函数与调用链 | 数据/消费者 | 测试 | 删除条件 | 未知/回滚 |
|---|---|---|---|---|---|---|
| `full` permission preset | hide/disable first | `agentPermissions.ts::AGENT_PERMISSION_PRESETS` -> permission route -> Settings select -> session decision | settings document；General/CAT UI | permission/settings tests | Stable contract 不再返回 full；developer gate 独立、默认关闭；旧值迁成 blocked/ask | 真实用户是否存有 full；回滚只恢复 developer gate，不恢复 Stable |
| unknown -> auto fallbacks | migrate then delete | `normalizeAgentPermissionMode`、`presetRules`、custom base | settings/API/session | permission tests | strict parser + migration fixture + stable error code 全覆盖 | 旧非法值数量未知；备份原值并阻断启动 |
| Stable executable Extension load | hide/disable first | snapshot -> authorization -> `DefaultResourceLoader(additionalExtensionPaths)` | trust approvals、Task resources | trust/extension tests | Stable 第三方 executable=blocked；第一方 allowlist 明确；后续 host parity | 已批准用户扩展清单未知；回滚仅恢复内容寻址 staging，不恢复原路径加载 |
| Package preview npm installer | eligible after dead-path proof | `package_center.ts::{previewManagedPackageInstall,promoteManagedPackageInstall,installDependenciesWithoutScripts}` | 只读catalog仍由该模块提供；legacy inventory独立；LA-094的SQLite registry/journal/blob authority不属于该删除候选 | package route/security/full tests | Stable旧写端点410且无caller；先把只读catalog拆出，再删除写实现；不得删除LA-094 SQLite authority或其legacy rollback evidence | 当前安装包依赖 npm 的数量未知；保留旧 registry/tree只读，不恢复writer |
| 通用 renderer API bridge | migrate then delete | preload `api.request` -> main `api:request` -> `requestRuntime` | `workspace-client.ts` 所有普通 API | security/client tests | 每个 endpoint 有 typed capability；AST/rg 无 caller；XSS blast-radius test | endpoint inventory需冻结；feature flag 可短期切回旧 bridge，不能永久双轨 |
| renderer path `revealPath(path)` | migrate then delete | preload/main handler；sidebar/Maintainer callers | Project/artifact/candidate paths | security tests | 只接受 artifact/project capability ID，main/server解析 canonical path | 非 Artifact 文件 reveal 用例未知；明确窄 capability 后迁 |
| `.mjs/.cjs` main/preload | migrate then delete | Electron entry/preload | packaging allowlist、desktop types | security/package tests | TS build产物与打包路径验证；contract drift test | electron-builder loader细节；保留一版可回滚入口 |
| `createGeneralAgentSession` | migrate then delete | General coordinator -> factory -> Pi | Pi sessions/resource snapshots | general session/run tests | AgentRuntimePort+SessionAssembler 覆盖 General；无 direct Pi callers | continuation/OAuth/resource parity必须逐项 fixture |
| `createCatAgentSession` | migrate then delete | project/Team/CAT runners -> factory -> Pi | Project sessions/CAT tools | CAT/team/session tests | 同一 assembler/profile 保持 CAT hard rails | 不允许以 General defaults 替代 CAT policy |
| `createMaintainerAgentSession` 与 production Maintainer routes/UI | hide/disable first | MaintainerPanel/routes -> maintainer session/worktree -> candidate installer | maintainer jobs/candidates | LA-060 stopgap tests；后续 maintainer tests | Stable 先隐藏并阻断 production mutation；LA-050 子工单完成开发/CI等价检查、历史导出与无消费者证明后，LA-056 才可删除 | 用户是否依赖本机自维护未知；候选数据保留只读/可导出；stopgap 不等于迁移完成 |
| Private Eval production routes/UI | hide/disable first | `eval_routes.ts`、private eval modules -> `PipelineWorkspace::EvalPanel` | `data/evals/private` + canonical Eval Tasks | LA-061 stopgap tests；后续 eval tests | Stable 先隐藏并阻断 production execution；LA-050 子工单完成 `tools/eval-harness` parity、历史可读和无生产消费者证明后，LA-056 才可删除 | 是否作为实际产品功能使用未知；数据不得删除；stopgap 不等于迁移完成 |
| Team 专用 runtime/RPC | migrate then delete | workflow routes -> role runners -> child RPC | workflow JSON、Task child threads | Team tests | Delegated Run 使用统一 lifecycle/event/grant；零 Package path parity | Team evidence/locked row/delivery gates必须保留 |
| Persona 独立产品语义 | investigate/migrate | composer/persona models + thread identity | persisted persona/thread metadata | persona/conversation tests | 明确 Role Recipe 映射、历史显示和导出 | 当前 canonical child identity仍有产品价值，不可直接删实体 |
| Pipeline 顶级产品面 | investigate | `PipelineWorkspace.tsx` | Quality/Delivery/Eval flows | pipeline/eval tests | 用户任务验证证明可由 Task progress/tools替代 | Quality/Delivery不可因去 Pipeline 而隐藏 |
| Package Center 顶级导航 | migrate then delete | shell/settings/package UI | package catalog/registry | settings/package tests | Settings > Resources 达成完整 discovery/preview/activation/recovery | 仅删导航，不删能力与历史数据 |
| selected-session/global selection remnants | investigate | Pi session settings/status、renderer remembered scope | session/control JSON/localStorage | session/scope tests | 区分 runtime binding 与 UI convenience；只有真正无 canonical consumer 才删 | 名称相似不等于同语义，需逐个引用图 |

## 4. 存储与遗留候选

| 候选 | 标签 | 当前路径/函数 | 保留理由 | 删除门 | 回滚 |
|---|---|---|---|---|---|
| Task `snapshot.json/events.jsonl` writer | migrate then delete | `task_workspace.ts` | 当前最强 canonical recovery 资产 | SQLite import+shadow compare+cutover+备份通过；新 writer唯一 | 旧目录只读备份，一键切回旧版本但不双写 |
| workflow/private-eval/library/TM 等直接 JSON/JSONL writers | migrate then delete | 各模块 `writeJsonFile`/`appendFile` | 现有业务真相 | 每类 repository parity + migration counts/hashes | 原文件不覆盖，manifest记录 |
| Confirmed Memory legacy JSON writer | migrate then delete | `assistant_memory.ts` legacy adapter；personal/project `memories.json` | LA-095 marker-linked raw backup/read-only rollback evidence | SQLite status/history/source/revision/scope parity；旧 writer denial；rollback/re-cutover policy | 真实历史分布、TDAI/semantic index不在LA-095删除门内 |
| Library legacy catalog/block writer | migrate then delete | `assistant_library.ts` legacy catalog/blocks writer；personal/project `catalog.json`、`blocks.jsonl` | LA-096 marker-linked raw backup/read-only provenance；managed source cache保留为derived/provenance cache；`vectors.jsonl`不是authority | SQLite metadata/blob provenance parity；旧 writer denial；reopen/reindex/orphan inspection；source/cache与blob回滚门；LA-056子工单才可删除旧入口 | 真实Library规模、历史source分布、blob GC、semantic index rebuild和生产rollback未验证；不得删除source cache或vectors作为本票副作用 |
| CAT-core legacy manifest/Batch/TM/termbase writers | migrate then delete | `project_manifest.ts`、`batch_workspace.ts`、`tm.ts`、`termbase.ts` 的 legacy JSON paths；`project.json`、`batches/*.json`、`tm.json`、`termbase.json` | LA-097 marker-linked whole CAT-core backup；source bytes与master bytes通过CAS refs保留；derived read-cache不是真相源，proposal/QA/delivery/ledger不在本票范围 | LA-097 strict import/parity、source digest、locked/tag/revision、TM/TB query/override、reopen、active-run block、old-writer denial；LA-056子工单且全CAT governance rollback/delete gate通过后才可删除 | 真实Project格式/规模、source分布、process-kill/power-loss、生产rollback未验证；不得只删除segment或旧source evidence |
| CAT governance legacy proposal/checklist/ledger/export writers | migrate then delete | `proposals.ts`、`quality_checklist.ts`、`quality_decision_ledger.ts`、`delivery.ts` 的 legacy JSON/JSONL paths；`quality_decision_ledger.jsonl`、`quality_checklist.json`、`batches/*/proposals/*.json`、`exports/export_audit.jsonl` | LA-098 marker-linked whole CAT-governance backup；proposal evidence refs保留在SQLite projection，evidence bytes与vectors/read-cache不重复迁移；旧入口只作read-only rollback evidence | LA-098 strict import/parity、ledger hash/idempotency、proposal/checklist CAS、locked/tag/placeholder、QA/waiver/delivery audit、empty-project cache、old-writer denial；LA-056子工单且全CAT governance rollback/delete gate通过后才可删除 | 真实最大Project/ledger/证据bytes规模、跨进程并发、process-kill/power-loss、production rollback未验证；不得只删除ledger或proposal writer，必须整域回滚 |
| Workflow/Team/Private Eval structured writers | migrate then delete | `workflow_plan.ts`、`workflow_artifacts.ts`、`private_eval.ts` 的workflow/run/output/scorecard/blind-review JSON paths | LA-099 marker-linked whole-domain backup；LA-100 aggregate manifest/isolated restore 已覆盖此域；Eval corpus/reference/rubric/report files不在结构化迁移或删除范围 | synthetic import/parity、active-run block、public seam write、old-writer denial、LA-100 aggregate restore；LA-056才可删除旧入口 | 真实Team/Eval历史、并发、process-kill/power-loss、production rollback未验证；Stable Eval仍只读 |
| `workspace.ts::writeJsonFile` | retain then narrow | 通用 atomic helper | 迁移期间仍服务配置/导出 | 结构化事实全部迁走后仅限非事实文件 | 不提前删除 |
| JSONL 审计导出 | retain | Task/events/ledger/audit | 可移植、可审计 | 不作为唯一 transactional writer即可 | SQLite 可重建导出 |
| 旧 TDAI memory runtime/tool/config/scripts | quarantine then delete | `memory-config.ts` inventory、`memory-tools.ts` quarantine、`.pi/extensions/memory.ts`、`tdai:*` scripts、`tdai_memory_migration.ts`；`tdai_embedding_bridge.ts`另列为asset-vector compatibility adapter | 可能含用户历史资产；LA-028 已禁 capture/store/recall，未删除历史入口文件 | 已资格化 export adapter 的全量 inventory -> pending MemoryCandidate -> source-digest/exclusion/conflict report -> exact-byte backup -> user confirmation；稳定版本后由LA-056子工单删除quarantine入口 | 原数据只读备份；绝不自动生效；不把独立 embedding adapter 当作记忆迁移证据 |
| legacy task backfill/runtime migrations | investigate | `legacy_task_backfill.ts`、`runtime_migrations.ts` | 已安装旧版本升级可能仍需要 | 支持版本政策明确且至少跨一个稳定兼容窗口 | release rollback需要旧 migrator时保留 |
| `.pi-subagents/**` runtime output | never commit/delete by cleanup policy | runtime data | 运行时临时/会话证据 | 只用既有 preview+planHash cleanup | 遵守 hard rail |

## 5. 工具链与仓库候选

| 候选 | 标签 | 当前消费者 | 测试/证据 | 删除条件 | 未知 |
|---|---|---|---|---|---|
| `pnpm-workspace.yaml` | deleted by LA-052 | 无 CI、manifest 或脚本消费者；npm 是唯一实际 workspace 路径 | `tests/npm_workspace.test.ts`、workflow/manifests、根 clean install | 根 workspace覆盖 `apps/*`；pnpm 无消费者；根 lock/build/full validation 通过 | 外部开发者的本地 pnpm 习惯未知；Git revert 可恢复文件，不能重建第二安装 writer |
| `apps/desktop/package-lock.json` | deleted by LA-052 | CI 与本地更新器的第二次 desktop 安装均已迁至根 workspace；Native Capability 自己的锁仍保留 | `tests/npm_workspace.test.ts`、local-update/desktop packaging tests、根 clean install | 根 workspace lock 的 14 项 desktop 直接依赖闭包 hash 与删除前 lock 一致；桌面 build/packaging contract/full validation 通过 | 未做签名/公证产物的真实机 byte-for-byte 对比；Git revert 可恢复旧 lock，不能恢复永久双安装 |
| 手工 root test chain | migrate then delete | CI、开发者 | `package.json`、本轮全测 | runner自动发现+遗漏测试检查+suite parity | 测试进程隔离/顺序依赖 |
| release workflow `actions/*@v4` | replace | beta/stable workflow | CI ordinary workflow已用SHA | 固定SHA并通过发布dry-run | action版本策略 |
| duplicated current-state docs | migrate then delete | README/context/handoff/TODO/docs index | documentation maintenance rules | 权威位置同步、docs tests通过、无当前消费者 | 不删除历史证据报告，仅降权 |

## 6. 明确保留，不应被“大改”误删

| 资产 | 文件/数据 | 原因 | 回归测试 |
|---|---|---|---|
| Canonical Task contract与event replay | `task_workspace_contract.ts`、`task_workspace.ts` | 新存储/状态机必须迁移其语义，不得平行重造 | Task contract/workspace/projection tests |
| CAT locked/proposal/evidence/QA/delivery gates | proposals、quality、delivery、decision ledger、tools | 产品护城河和硬安全边界 | CAT/QA/delivery/Team tests |
| General resource digest/TOCTOU验证思路 | resource snapshot/trust | 应升级为内容寻址，不应丢失摘要绑定 | resource/trust tests |
| Package planHash/quarantine/rehash/atomic activation思想 | Package Center | inert preview 后仍需这些阶段 | package tests |
| Runtime installer staging/rollback/health | desktop runtime installer | 当前强项，可复用到发布更新 | runtime installer tests |
| Confirmed Memory与Library provenance | assistant memory/library | 目标记忆层基础 | memory/library tests |
| Electron hardened defaults | desktop security/main | 迁移 TS/IPC 时必须保持 | security tests |
| Renderer snapshot+ordered event+gap recovery | workspace store/task-events | 目标 TaskProjectionStore 的现有基础 | task event/store tests |

## 7. 删除审查固定问题

每个删除 PR 必须回答：

1. `rg`/AST 是否证明没有生产消费者？
2. 历史数据能否仍被读取、导出或迁移？
3. 对应 hard rail 是否由新实现覆盖？
4. 新旧路径是否只保留一个 writer/authority？
5. 回滚是否会产生两个事实源或重放同一 mutation？
6. 哪些测试从旧实现迁到新实现，哪些恶意/恢复场景新增？
7. 真机/发布消费者是否仅靠仓库状态无法验证？
