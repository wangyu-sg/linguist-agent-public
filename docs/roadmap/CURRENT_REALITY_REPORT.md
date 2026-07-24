# Linguist Agent 当前仓库事实报告

审计日期：2026-07-22；LA-096 至 LA-101 增量更新：2026-07-23

审计对象：`/Users/wangyu/Desktop/linguist-agent`，基线提交 `64bcb15b`

用途：蓝图实施前的事实基线；不是已授权实现清单，也不证明已安装 App 或托管运行时状态。

## 1. 事实边界

- 已通读 `LA_Evolution_Master_Blueprint_for_Codex_CN.md` 与 `docs/ui/codex-ui-spec-full.md` 作为非执行性历史研究输入；公开实现合同为 `docs/ui/LA_UI_BEHAVIOR_SPEC.md`。同时通读根 `AGENTS.md`、`README.md`、`PRODUCT.md`、`docs/AGENT_CONTEXT.md`、`docs/HANDOFF.md`、`TODO.md`、`.pi/APPEND_SYSTEM.md`、`docs/DOCS_INDEX.md`、`docs/ARCHITECTURE.md`、`SECURITY.md`、`package.json`、各 `tsconfig`、桌面 manifest 和三份 GitHub Actions workflow。
- 运行时、Package、工具面与 Session 相关结论还核对了 `docs/RUNTIME_BORROWED_PATTERNS.md` 和 `docs/PI_RESOURCE_POLICY.md`；文档治理核对了 `docs/DOCUMENTATION_MAINTENANCE.md`。
- 蓝图 A.2 建议的英文路径 `docs/roadmap/LA_EVOLUTION_MASTER_BLUEPRINT.md` 不存在；实际输入文件是 `docs/roadmap/LA_Evolution_Master_Blueprint_for_Codex_CN.md`。本报告不创建第二份平行蓝图。
- 审计开始时工作树已有大量改动。用户明确确认这些改动可提交，并授权 LA 进入大改方向；经 typecheck、根测试、桌面测试和 diff check 后建立基线提交 `64bcb15b`。仓库提交仍不代表改动已发布或安装。
- 本轮没有启动生产运行时、没有读取 `data/**`、没有修改生产运行时或用户数据 schema，也没有用真实客户数据做验证。LA-023/085/086 只在未接线的 synthetic `storage-sqlite` package 中建立测试 schema、冻结映射合同，并用临时 Project/standalone Task 证明只读导入与 replay parity。

## 2. 已确认的当前架构

### 2.1 产品与仓库边界

- 唯一维护前端是 Electron：`apps/desktop`。`apps/mac` 与 `packages/cat-web` 已删除，不能复活。
- 后端包为 `packages/cat-data`、`cat-formats`、`cat-mcp`、`cat-runtime`、`cat-server`、`cat-tools`；`apps/desktop` 已纳入根 npm workspace，并由根 `package-lock.json` 解析。
- 根 `package-lock.json` 是 workspace 唯一安装事实，覆盖 `packages/*` 与 `apps/*`；CI 只执行根 `npm ci`。`apps/desktop/runtime/native-capabilities/package-lock.json` 是随包 Native Capability 的隔离闭包，`.pi/npm/package-lock.json` 是 Pi 源目录资产，二者都不是产品 workspace lockfile；`pnpm-workspace.yaml` 与 `apps/desktop/package-lock.json` 已删除。
- `TODO.md` 明确声明 RC feature freeze，且它是唯一未完成 backlog。用户已在本轮明确批准 LA 进入大改方向，但仓库治理文件尚未同步；实施必须先把该决策写入权威 backlog，再按 A.3 一次执行一个工单。

### 2.2 Canonical Task 与 Run 事实

已确认文件与函数：

- `packages/cat-data/src/task_workspace_contract.ts`：`TaskWorkspaceSnapshot`、`TaskRunRecord`、`TaskWorkspaceEvent`、`TaskRunStatus`。
- `packages/cat-data/src/task_workspace.ts`：`createTaskWorkspace()`、`open()`、`append()`/提交页、snapshot replay 和 event cursor。
- `packages/cat-server/src/routes/standalone_task_routes.ts`、`task_workspace_routes.ts`：standalone 与 Project Task transport。
- `packages/cat-server/src/active_agent_runs.ts`：`ActiveAgentRunRegistry`，保存进程内 live handle。
- `packages/cat-server/src/general_agent_runs.ts`：`GeneralAgentRunCoordinator`，协调 standalone General Run。
- `packages/cat-data/src/execution_profile.ts`：LA-033 的 immutable `ExecutionProfilePlan`；只接受显式 Fast/Balanced/Best route 或旧式直接模型选择生成的 `custom` profile，并从 LA-032 `PromptRequestBudget` 读取已验证 context/output 限额。
- `packages/cat-server/src/routes/workflow_routes.ts`：Team preflight/start/continue/stop/follow-up。
- `packages/cat-server/src/routes/eval_routes.ts`、`single_task_run_projection.ts`、`eval_task_run_projection.ts`：Eval/Single 到 canonical Task 的投影。

当前调用链：

```text
Electron renderer
  -> preload api.request / typed stream wrapper
  -> main requestRuntime / SSE stream
  -> signed local rendezvous -> authenticated random Unix-domain HTTP/SSE routes
  -> GeneralAgentRunCoordinator | task workspace routes | workflow routes | eval routes
  -> createGeneralAgentSession | createCatAgentSession | Team child transport
  -> TaskWorkspace append events
  -> snapshot.json + events.jsonl
  -> SSE Task events
  -> workspace-store applyTaskEvent；gap 时重新 open Task
```

事实与差距：

- durable Task projection 已存在，不能把仓库描述成“完全没有 canonical lifecycle”。
- 但没有找到蓝图目标 `transitionRun()`；多个 coordinator/route 直接构造带 `status` 的 Run 更新。
- 状态词汇不统一：`TaskRunStatus`、`CatWorkflowRunStatus`、Private Eval 状态、`ActiveAgentRunRegistry` 状态和 renderer terminal-status 集合各自存在。
- immutable 资源事实部分存在：`GeneralResourceSnapshot`、`TaskRunResourceManifest`、Task Package profile revision/hash。但没有统一 `ExecutionSnapshot`、`ConfigEpoch` 和全系统兼容性状态机。

测试证据：`tests/task_workspace_contract.test.ts`、`task_workspace.test.ts`、`task_workspace_routes.test.ts`、`single_task_run_projection.test.ts`、`eval_task_run_projection.test.ts`、`active_agent_runs.test.ts`、`team_workflow_foundation.test.ts`。

未知项：未做真实掉电 crash injection；未观察真实运行时中旧数据的状态分布。

### 2.2.1 本地 Transport

- LA-026 后，Desktop 默认从用户级 `0700` run 目录读取 `0600` rendezvous；记录只含随机 Unix socket、runtime instance、nonce、时间与 Keychain bootstrap token 的 HMAC，不把派生 Session credential 写入磁盘。
- Desktop 先校验 owner、权限、root containment 与 HMAC，再派生本次 runtime Session credential；`/api/health` 在 Unix transport 上也必须认证。重连会重新读取 rendezvous，固定 `127.0.0.1:8787` 抢占者不会收到 bootstrap 或 Session credential。
- Server 默认只监听一个随机、`0600` 的 Unix socket。仅显式 `LA_SERVER_PORT` 或 `LA_LOCAL_TRANSPORT_MODE=loopback` 的隔离测试/一版升级路径使用认证 loopback；两者不同时监听。LaunchAgent、Desktop installer 与本地更新健康检查已切到 authenticated rendezvous。
- 这不声称能防御已可读取同一用户 Keychain 的同 UID 原生恶意进程；若该攻击者进入正式威胁模型，仍需 XPC/audit-token/code-signing requirement 决策与真机验证。

### 2.2.2 结构化日志与诊断

- LA-027 后，backend 与 renderer 的产品日志统一经过 `packages/cat-data/src/safe_logging.ts`；输出是带 `schemaVersion: 1`、时间、级别、稳定事件名和 `diagnosticId` 的单行 JSON。
- Redactor 在 sink 前递归处理嵌套 Error、authorization/cookie/credential 字段、本机路径、客户内容字段、未知自由文本、循环引用与超限对象。Error stack 不进入记录；业务模块直接 `console.*` 由自动源码守卫阻止，resident installer 的注入式用户 CLI 输出是明确例外且不作为 retained product log。
- `server_diagnostics.jsonl` 在创建、append 和读取 legacy 行时都重新经过同一 redactor；旧文件不原地重写。活动文件默认限制为 5 MiB，并只保留一个 `.1` archive。当前没有声明现有历史日志已经被清理或真实 launchd 日志 retention 已经在安装机器验证。

### 2.3 Pi runtime 与 Session 边界

已确认文件与函数：

- `packages/cat-runtime/src/createGeneralAgentSession.ts`：`createGeneralAgentSession()`，直接使用 Pi `createAgentSession()`/`createAgentSessionRuntime()`。
- `packages/cat-runtime/src/createCatAgentSession.ts`：`createCatAgentSession()`，直接使用 Pi `createAgentSession()`。
- `packages/cat-runtime/src/createMaintainerAgentSession.ts`：`createMaintainerAgentSession()`。
- `packages/cat-server/src/general_agent_runs.ts` 和 `routes/workflow_routes.ts` 仍理解具体 Session 创建与执行细节。

没有找到 `AgentRuntimePort`。当前不是 runtime-agnostic 架构，但产品政策仍是 Pi-only；蓝图端口应隔离依赖，不应引入第二个 Agent runtime。

测试证据：`tests/general_agent_session.test.ts`、`general_agent_runs.test.ts`、`pi_sessions.test.ts`、`maintainer_agent_session.test.ts`、`private_eval_session.test.ts`。

未知项：未用 mock runtime 验证全部 General/CAT/Team/Eval 路径能否共享同一端口；没有真实 provider 断线观测。

### 2.4 权限、文件与 Sandbox

已确认风险：

- `packages/cat-runtime/src/agentPermissions.ts` 的 `AgentPermissionMode` 包含 `ask | auto | full | custom`。
- `normalizeAgentPermissionMode()` 对未知值返回 `auto`；`presetRules()` 对未知 preset 也回退 `AUTO_APPROVAL_RULES`；`custom` 的基础规则同样从 auto 开始。
- `packages/cat-server/src/routes/agent_permission_routes.ts` 将外部 patch 交给上述 normalize；未知输入因此可能被持久化为 auto。
- Settings 从 server 返回的 presets 渲染选项，因此生产 UI 可显示 `full`。
- 另一方面，permission decision action 的未知值默认 deny，CAT hard rails 仍独立执行；不能把整个权限系统概括为全面 fail-open。

文件授权现状：

- `packages/cat-data/src/standalone_file_grants.ts` 创建 realpath + inode fingerprint 的 grant，持久化后同步 Task scope；解析时重新 realpath 并核对 fingerprint。
- `packages/cat-runtime/src/generalRuntimeExtension.ts` 从已知参数键收集路径，校验 private workspace/grants 与 fileRead/fileWrite domain。
- `packages/cat-runtime/src/generalSandbox.ts`、`catSandbox.ts` 把允许读写根传给 Pi sandbox。
- 没有找到统一 `FileCapabilityBroker`。对路径字段的识别仍依赖工具参数名，CAT 与 General 的路径策略也不是同一个 broker。

Sandbox 现状：

- `catSandbox.ts` 支持 `off | observe | enforce`，由 `LA_CAT_SANDBOX_PHASE` 选择。
- `SandboxManager` 是 Pi 进程级配置；`catSandbox.ts` 以 module-level `activeSandboxConfigKey` 更新配置。
- `generalSandbox.ts` 有 module-level promise queue，但只串行化 General 的 wrap；没有看到横跨 CAT 与 General 的统一“配置 + wrap”临界区。

测试证据：`tests/agent_permissions.test.ts`、`permission_decisions.test.ts`、`cat_safety_kernel.test.ts`、`general_agent_session.test.ts`、`standalone_task_routes.test.ts`。

未知项：尚无证据证明并发 CAT/General Run 不会互相切换全局 sandbox 配置；也未证明所有第三方工具 path 字段都能被当前提取器识别。

### 2.5 Extension 与 Package Center

Extension 当前调用链：

```text
General Run resource discovery
  -> buildGeneralResourceSnapshot（先不执行）
  -> authorizeExecutableExtensions（canonical path + SHA approval）
  -> verifyGeneralResourceSnapshot
  -> DefaultResourceLoader(additionalExtensionPaths)
  -> 第三方 Extension 在 Agent 宿主进程加载
```

已存在 digest、路径和 TOCTOU 校验，但稳定渠道没有“先关闭第三方 executable Extension”这一蓝图门槛，也没有独立 Extension Host。

Package Center 当前 preview 调用链：

```text
previewManagedPackageInstall
  -> 获取 npm metadata 和 tarball
  -> 写入 data/assistant/capabilities/packages/.quarantine
  -> 解包
  -> installDependenciesWithoutScripts
  -> execFile("npm", ["install", "--ignore-scripts", ...])
  -> 静态审计 + tree hash + preview JSON
```

所以“Preview 零 subprocess、零依赖安装、除下载目标外零额外网络”不是当前事实。promotion 已有 `planHash`、风险确认、tree rehash 和 quarantine -> installed 移动。

LA-094 后，Package v2 的结构化 registry、activation journal、recovery block 和内容引用已由 `cat-server` 启动组合到 SQLite/WAL + content-addressed blob storage：启动在全局 data-root lease 下先执行 synthetic-only cutover/reopen，之后 Package route、activation、recovery 与 General resource resolver 使用同一 SQLite storage authority；registry records 绑定 `contentBlobRefId`，新激活同时发布 archive/resource bytes 的 CAS refs。旧 `registry-v2.json`、文件 journal/recovery 与 materialized content tree 只保留为 legacy/read-only backup 或派生验证对象，存在 SQLite authority marker 时旧 reader/writer 会 fail closed。此次只使用合成临时 roots，未读取真实 `data/**`、真实 Package registry、客户包或生产签名包；legacy 迁移只保证已验证 resource bytes，旧 archive bytes 若不存在不会被臆造。

测试证据：`tests/package_center.test.ts`、`package_center_routes.test.ts`、`task_run_resources.test.ts`、`team_package_preflight.test.ts`、`task_package_team_capability.test.ts`。

未知项：未对真实 npm registry 做网络封包观测；未证明 channel gating；未验证恶意依赖树对 host 的全部影响。

### 2.6 Prompt、Memory、Library、Document

- LA-032 后，`compilePrompt()` 仍返回可审计的 `CompiledPrompt`，但 `planPromptLaunch()` 对新的 `requestBudget` 提供 `ready | needs_compaction | blocked`：未登记模型、旧的仅`tokenBudget`输入、mandatory overflow 与 tool-schema overflow 都不能启动。`ModelContextRegistry` 只接受显式 provider/model 的 context window 与 output reserve；完整 v2 manifest 分别记录 prompt、tool schema、history、provider framing、safety/compaction reserve、available/required request token。
- LA-033 为 standalone General 的新 Run 将同一 `PromptRequestBudget` 解析为 hash-bound `ExecutionProfilePlan`，并把它随 Host-to-Worker General plan 冻结；默认旧模型偏好仅映射为已知 `balanced` compatibility route，显式 provider/model/effort 仅映射为 `custom`。Fast/Best 没有显式 route 时拒绝；不会按名称、价格、能力或工具支持猜选模型。profile 改变要求新的 runtime epoch，旧快照缺 profile 的 compact/fork 路径明确拒绝而不重新按当前设置漂移。
- LA-034 增加纯 `segment_context_graph.ts`：调用方必须从各 canonical owner 提供 source ID、SHA-256 与 revision，才可形成冻结的 Character/Quest/Scene/Dialogue/Terminology 建议节点、内容类型/风险/歧义 profile 与带 provenance 的 targeted retrieval。任一 provenance 的 source 缺失、hash 或 revision 变化会让整个派生节点/信号失效并从读取结果剔除。它没有 filesystem/SQLite/model/tool/route/UI 调用，不生成 CAT Evidence、proposal、target 或 Decision；`SegmentEvidenceSnapshot` 也不会因为这个模块被提升为 graph 或 authority。
- LA-035 增加纯 `tm_candidate_pipeline.ts`：请求的 content-addressed key 固定覆盖 Segment source hash/revision、LA-034 graph hash、constraint/asset snapshot hash、LA-033 execution profile + provider/model，以及 prompt hash 和 TM/repetition 输入。仅在 deterministic constraints 明确 `verified` 时，唯一 reviewed exact TM 或同 source hash/revision 的 confirmed repetition 才产生 `ready_for_proposal` 并标记跳过昂贵生成；安全高 fuzzy reviewed TM 只产生 `requires_diff_repair` seed，不能转为 proposal，冲突/unknown/advisory TM 均回到完整生成。缓存只在调用方提供的进程内 `CandidatePipelineCache` 中保存 immutable plan；计划器不调用模型、不扫描数据、不持久化缓存，也不写 proposal/target/Decision。
- LA-036 增加纯 `independent_critic.ts`：只有 high-risk Segment 可产生 strict、hash-bound 的 `IndependentCriticArtifact`。Critic execution 与 actor 都必须不同于候选生产者；fidelity/naturalness/terminology/voice/consistency finding 必须带 citable evidence，artifact 固定为 `advisory_finding`/`canCommit:false`。它不接现有 Quality/Team decision ledger、不创建 proposal；它能导出的 targeted repair scope 只含 artifact 内的 finding IDs 与该单一 Segment，不能生成或应用 target。
- LA-037 增加纯 `batch_consistency_repair.ts`：它只投影既有开放 `QualityAuditReport` 中的 terminology、duplicate-target、voice/register finding；不会重跑 QA 或重生成 Batch。每个 repair 必须精确匹配一个 finding ID 与其 segment，沿用该 finding 的 evidence，locked segment 明确拒绝，再构造既有 `SegmentProposalInput`；它本身不创建/应用 proposal。
- Team route 在开始新 Run 前从真实 `buildTeamEvidenceTools()` 的 name/description/parameters 投影计算 active tool-schema token；Private Eval 的 no-tool/no-session 请求也使用同一 v2 预算对象。task/evidence/style/findings/reference/transcript 被封装为有 SHA-256 的 `<untrusted_source>`，并转义 XML 边界、bidi 与 zero-width 控制字符。旧 manifest 仍只读兼容；不存在完整 request budget 的新 Run fail closed。
- LA-095 后，Confirmed Memory 已在 personal/project legacy scope 完成 synthetic-only SQLite/WAL cutover；LA-029 在同一唯一 SQLite writer 上增加 explicit personal/client/franchise/project/locale scope、`proposed`/`active`/`revoked`/`superseded`、validity、user-authored conflict key、user-only supersede、history、source refs 和 revision。旧 V1 entry 缺失 `validFrom` 时严格解释为 `createdAt`，不会重写历史输入。`assistant_memory_sqlite_cutover.ts` 启动前读取 legacy `memories.json`、保存 raw backup、校验 round-trip parity、发布 authority marker，并将旧 JSON writer 置为 fail-closed。Recall 仅由 Host 按当前请求做 lexical + managed local E5（缺 pack 时显式 lexical-only）检索、过滤过期和未解决显式冲突、按 Project -> Client/Franchise -> Locale -> Personal 排序后冻结到 General/CAT Run plan；Worker 不会枚举 live Memory。snapshot 带 memory ID/scope/revision/source/validity/selection reason，仍是 recall context，不是 CAT Evidence 或 Project Truth。CAT 只从 Project 与 manifest target locale 加 Personal 选择；Client/Franchise 不从 Project 猜测映射。TDAI/semantic index 仍未纳入 LA-095 数据迁移。
- LA-028 已冻结旧 TDAI capture/store/recall：`memory_search`/`memory_store` 不再进入 CAT 或 Pi Tool surface，Project 设置不再能开启 gateway，旧 `.pi` extension 和 `tdai:*` scripts 只会 fail closed。`tdai_memory_migration.ts` 只接收调用方显式提供的只读快照，生成带 source digest、pending status、重复/secret/PII/低价值排除和 identity-key conflict 的 `MemoryCandidate` plan；plan 不含被排除的 secret 文本。只有匹配 `planHash`、不覆盖的 exact-byte backup receipt 与 `confirmedBy: "user"` 才会让单条候选进入既有 Confirmed Memory writer；未确认候选永不参与 recall。没有扫描真实 TDAI 数据、没有猜测上游导出格式，也没有删除旧数据或外部 embedding bridge。
- LA-096 后，Library personal/project 的 catalog、block、locator 元数据由 `assistant-library.sqlite` projection/event streams 唯一写入；managed document bytes 进入 content-addressed blob store，旧 managed source files 只保留为可读 provenance/cache 与 marker-linked backup。`vectors.jsonl` 仍是可重建、非 canonical 的 semantic index；Project Truth 仍分布在项目资产、Task、TM、termbase、QA 与 decision ledger 文件中。
- `document_capabilities.ts` 管理本地 document capability；MinerU 按项目硬规则保持 fail-closed，当前没有资格化证据。LA-108 至 LA-116 提供 strict backend/result block contract、opaque staged input、page estimate、native/light adapters 与 `0700/0600` private staging。LA-111 已将 server/worker-owned `DocumentRouter` 接到 HTTP evidence 入口和 General 工具：每次调用冻结每页 native/light/blocked 选择及 backend/version/OCR provenance，复杂页在 optional structured-layout backend 未资格化时明确 blocked，不会伪装成功或 cloud fallback。经授权原路径只用于 Host staging；backend 只见 digest-bound temporary copy，且 `finally` 立即 dispose。按用户授权的暂定 server policy：64 MiB input、500 pages、20,000 blocks、32 MiB output、5 min timeout、native coverage 0.75，以及 server startup/每次 Router 调用的 24h crash-stage cleanup。缺/坏/未资格化 Paddle、digest/runtime/limit drift 都 fail closed；有完成页时 Artifact 记录 `partial` 和逐页原因，全部 blocked 则拒绝创建成功 Artifact。旧 API/Tool direct Paddle chooser 与未使用的 `routeDocumentExtraction` 已删除；`extractPaddleOcrEvidence` 仅保留为 qualified light adapter 的 worker bridge。PDF 与 PNG/JPEG/TIFF 被支持；DOCX/XLSX 缺 verified locator 继续 partial/refuse。LA-031 移除了 Asset parse 的 `PATH`/environment command activation；MinerU managed lock 必须携带 pinned runtime/package/model digest、macOS hardware、CER/reading-order/table/memory/crash/license evidence，未知或缺失字段一律 unqualified。没有合格记录，MinerU/Unlimited-OCR/remote 均未启用。LA-112 把可选的 native-text threshold profile 固化为 exact schema v1、profile/report SHA-256、有效期和逐页 trace：版本/字段无效即拒绝，缺失或过期则保持当前 0.75 baseline。唯一 checked-in 证据是 synthetic fixture/report；它不资格化任何 optional backend。策略未来若调整必须经版本化 server contract，不能由 Renderer 或调用方推导。

测试证据：`tests/prompt_compiler.test.ts`、`segment_context_graph.test.ts`、`tm_candidate_pipeline.test.ts`、`independent_critic.test.ts`、`batch_consistency_repair.test.ts`、`tm_fuzzy_retrieval.test.ts`、`constraint_pack.test.ts`、`proposals.test.ts`、`quality_audit.test.ts`、`team_quality_decision_ledger.test.ts`、`team_workflow_foundation.test.ts`、`segment_evidence.test.ts`、`project_context.test.ts`、`team_context_builder.test.ts`、`assistant_memory.test.ts`、`assistant_memory_evolution.test.ts`、`sqlite_assistant_memory.test.ts`、`assistant_library_routes.test.ts`、`runtime_hooks.test.ts`、`general_agent_session.test.ts`、`general_session_plan.test.ts`、`apps/desktop/tests/library-memory.test.ts`、`assistant_library.test.ts`、`document_capabilities.test.ts`、`document_qualification.test.ts`、`document_router_contract.test.ts`、`document_native_backend.test.ts`、`document_light_ocr_backend.test.ts`、`document_router.test.ts`、`document_router_benchmark.test.ts`。

未知项：LA-032 的 context/output 元数据来自当前 Pi runtime/builtin catalog 的数值校验，provider framing 仍是显式的中性请求投影估计，而非真实 provider tokenization/账单证据；LA-033 只将它用于 standalone General 的 profile route，不代表 General/CAT 已调用 PromptCompiler，也没有为 CAT/Team/Eval 增加质量 profile configuration/UI。Fast/Best 目前没有 standalone 的生产配置入口，故保持拒绝；profile plan 也不声明模型质量、价格、隐私、延迟或工具能力。LA-034 只验证了 synthetic caller-hydrated provenance 的纯派生/失效规则，未接入 server evidence hydration、CAT tools、Run snapshots、UI 或任何 unified Memory/Library/Project Truth authority，且不证明 graph 观测内容的真实性。LA-035 只证明了纯 route/cache-key 规则，不执行 model diff repair/full generation、不接 Batch semantic-continuity batching、persistent cache、server/router、CAT Tool/Run/UI 或实际 TM/constraint/asset revision hydration；`reuseSafety: verified` 仍须由现有 canonical constraint owner 证明，不能由候选计划器自行断言。LA-036 不启动 Critic、没有质量/风险实际校准、finding/repair 也未接 Quality/Team ledger、proposal、Run/Tool/UI；它只证明低/中风险不要求 Critic 与高风险 artifact 的格式/身份隔离。LA-037 不运行 quality audit，也没有自动 repair、proposal persistence、batch-level model work或 UI；它只锁定 audit finding 到单段、evidence-preserving proposal input。LA-095/029 只证明 synthetic V1 import/parity、scope/authority/conflict/expiry 与 injected-embedder semantic gold；实际 managed E5 pack、跨语言质量、性能和 index/rebuild 成本未资格化。Client/Franchise 仍要求用户输入显式 ID，尚无可信 Project mapping；没有真实 `data/**` distribution/scale、TDAI export adapter/inventory、批量 candidate confirmation/provenance store 或真实 packaged-app accessibility evidence。LA-096 仅证明 synthetic Library metadata/blob import、locator/block/search parity、dedupe、reindex 和旧 writer denial；真实 SQLite WAL 增长、blob 流式/GC、进程 kill/掉电、生产 rollback 与真实 TDAI 全量资产仍未验证。LA-109/110/116/111/112 仅以合成 PDF/PPTX、mock managed capability/Worker、injected page inspector 和 synthetic benchmark profile/report 证明 staged digest、page/slide provenance、no-OCR、light fail-closed/环境收窄/限制、Router route、threshold trace 与 staging cleanup。真实 `pdfinfo`、host staging rollback/cleanup、PDF text coverage、DOCX/XLSX locator、已安装 Paddle pack、OCR质量、资源消耗、隔离与离线行为、hardware/corpus benchmark仍未验证。

### 2.7 存储

- 大多数结构化域仍以JSON/JSONL为canonical persistence；Task/Run/event、内嵌Decision、Task queue与resource profile的production startup路径已由LA-089切到SQLite event/projection store，Package v2 registry/journal/recovery及其内容引用已由LA-094切到SQLite/WAL + CAS blob authority，Confirmed Memory 已由LA-095切到SQLite/WAL authority，Library metadata/blob 已由LA-096切到SQLite/WAL + CAS blob authority，CAT core 与CAT governance 已分别由LA-097/098完成 synthetic-only SQLite cutover，Workflow/Team 与 Private Eval 的结构化 metadata 已由 LA-099 完成 synthetic-only SQLite/WAL cutover。Eval corpus bytes与派生报告仍在文件域且不成为SQLite结构化事实。
- LA-100 已在合成 root 上把上述 LA-025 七个域的 authority marker、v2 SQLite snapshot 与 Package/Library/CAT-core CAS blob roots 收束到同一个 aggregate manifest，并只允许还原到新的 isolated root；它拒绝缺失或孤儿 blob、破损 foreign key、schema 升级/降级、marker/path 不一致和覆盖既有 root。LA-101 进一步以 AST startup/import-graph 断言与 marker runtime sentinels 证明 legacy structured write paths 均在 SQLite authority 前安装、或在 marker 后 fail closed；LA-025 因而关闭。两票都未接入新的业务 writer，也未读取真实 `data/**`。
- `workspace.ts::writeJsonFile()` 保留normal temp+rename，并为安全关键调用提供critical durability class；共享 `durable_file.ts` 执行file sync、rename/append和parent sync。合成fault injection已覆盖ENOSPC及rename前后，但未声称完成真实断电证明。
- `TaskWorkspace` 以durable append写事件页，再以durable atomic replace写派生 `snapshot.json`；open 可重放并修复 event 已落盘、snapshot 未更新的窗口。Task首次目录发布后也同步父目录。
- Task/grant/profile内部仍使用 module-level promise queue，但runtime现在会在任何startup migration/recovery前取得 `.data-root-writer-lease`；metadata位于runtime root而不随`data/` schema swap移动。第二进程和模糊owner fail closed，dead PID可接管，Electron另有single-instance lock。实际SIGKILL、PID reuse假阳性和外部破坏后的后台写仍未真机证明。
- Task、quality/readiness decisions、confirmed memory、Library metadata、grant/trust/settings、workflow state、runtime migration与Package registry/journal已进入critical durability class；TM/memory audit、Private Eval、Library semantic index/cache等仍有普通直写，不能一概宣称掉电强耐久。
- 仓库没有第三方SQLite driver；LA事实库使用Node内置`node:sqlite`，`tm_import.ts`另行只读调用系统`sqlite3`导入SDLTM。
- LA-023 新增的 `packages/storage-sqlite` 只使用当前 Node 22 的内置 `node:sqlite`，没有第三方 driver。schema-v1 foundation 启用 WAL、FULL synchronous、foreign keys 和 busy timeout，并在一个事务内提交 stream revision、events、projection 与 idempotency result；LA-085 将未接线 schema 迁到 v2，新增 hash-bound `legacy_task` mapping contract，逐实体冻结 Task snapshot/Run/Event、quality decision ledger、message queue 与 Task Package profile 的字段、顺序、revision/cursor 和 blob/reference 边界。
- LA-086 在该未接线package中增加显式authority约束的legacy Task importer。它只读取调用者给定的synthetic Task目录，先把`snapshot.json`和`events.jsonl`以SHA-256 manifest发布到新的backup目录，再严格解析、按sequence重放canonical event page，并将JSON语义等价的event payload与projection幂等写入SQLite。提交前会重新验证source digest和writer authority；unknown field/version、scope不匹配、corrupt middle record、backup后源变化或authority丢失均保持SQLite revision 0。已支持的torn final JSONL line会明确分类并忽略。Project、standalone、有事件、零事件、重复导入、reopen与stored projection parity均由临时fixture证明；没有production caller或writer切换。
- LA-102 修正了原storage队列的错误拆分：`TaskRunEventType`含`decision_upsert`且snapshot内嵌Decisions，因此LA-087不能先切“Task/Run/Event”再由LA-089切Decision而不产生双authority。当前合同规定LA-087只建立未接线SQLite TaskWorkspace repository/readiness；LA-089在LA-087与LA-088都通过后一次性切完整Task aggregate。Roadmap validator要求唯一cutover owner marker且拒绝绕过该边界依赖。
- LA-087 已把 `TaskWorkspace` 业务/重放引擎与文件持久化分开，并提供SQLite repository factory。Project与standalone共用同一repository；synthetic测试证明projection-only revision 0 Task可首次追加、reopen、legacy import后继续写、projection CAS并发拒绝、authority丢失拒绝。机器可读readiness marker仍记录它在LA-089装配前的`authority: unconnected`边界；唯一production cutover owner为LA-089。
- LA-088 已增加Task side-state importer。它要求对应Task aggregate先完成LA-086导入，先备份并哈希`snapshot.json`、可选`message_queue.json`、可选`resource-profile.json`和显式给定时的Project quality ledger，再验证Task内嵌Decision与SQLite projection相同、quality ledger sequence/hash chain、queue stored order/status、profile canonical sort/revision/hash。重复导入幂等；orphan Task、unknown field、scope/hash错误、source变化或authority丢失会阻断，且原始输入不被修补。LA-089只调用Task queue/profile路径并显式不提供Project quality ledger；后者的正式writer已由LA-098接管。
- LA-103 修正LA-088后暴露的domain boundary：Project quality ledger位于Project root，且被delivery/waiver/Team等跨Task流程共同写入，不是Task aggregate。LA-088的只读parity证据保留，LA-089只可切Task/内嵌Decision/queue/profile；Project quality ledger的唯一cutover owner为LA-098。Roadmap validator分别强制Task cutover owner=LA-089、Project quality ledger owner=LA-098，并要求LA-089依赖LA-103。
- LA-104 已将所有经由公共Task API的Workspace与message queue访问，以及cat-server的Task Package profile访问，收束到显式install-once persistence seam。未安装时仍调用原有file backend；安装后第二次安装和另一root都会fail closed，不能在运行中换authority。LA-104本身没有安装新backend，LA-105随后补齐未接线SQLite实现；只有LA-089才允许production startup在完成backup/import/parity后安装。
- LA-105 补齐了SQLite Task message queue与Task Package resource-profile repositories，并与LA-087的TaskWorkspace persistence组成同一个backend factory。queue/profile读取拒绝未知字段，写入在提交前复查storage authority，并使用exact projection CAS；synthetic测试覆盖stored order/status、profile revision/hash、并发冲突、空stream初始化、重开数据库和authority loss。该factory仍明确排除Project quality ledger，且只能由LA-089 cutover owner装配。
- LA-089 已把完整Task aggregate production authority接到startup：旧runtime schema迁移后、任何恢复任务和transport监听前，在data-root writer lease下扫描standalone与Project Task目录，逐Task发布workspace/side-state哈希备份，严格导入Task/内嵌Decision/queue/resource profile并验证SQLite projection inventory；只有全部通过才原子发布versioned authority marker并install-once装配SQLite backend。marker固定数据库路径、cutover baseline、source digests、成功backup root和`project-quality-ledger`排除项；重启会验证SQLite quick-check、baseline streams和备份digest。显式旧Task file factories的写入随后fail closed，公共Task API只写SQLite；启动恢复也在已安装authority下从canonical repository枚举，能覆盖SQLite-only新Task。Project quality ledger由LA-098独立startup owner接管，不能被Task aggregate shadow写入。以上只在synthetic roots验证；campaign没有读取或迁移真实`data/**`，真实历史规模、process-kill/power-loss和生产rollback仍未证明，LA-091的synthetic whole-domain rollback已证明。
- LA-090 已提供从任意canonical SQLite snapshot生成确定性schema-v1 JSONL审计文件的只读service与CLI。记录按SQLite stream inventory与event sequence稳定排序，使用opaque SHA-256 stream/event引用、canonical payload/projection digest和逐记录hash chain；raw payload/projection、原ID、路径与secret不会写入导出。相同snapshot重复导出byte-identical；显式绝对destination采用同目录staging、file sync和no-overwrite publish，失败清理partial；`verify`只读重算并逐字节比较，没有JSONL import writer。
- LA-084 在同一未接线package上增加受`assertOwned()` authority约束的一致online backup/restore：备份在staging中完成SQLite snapshot、schema/quick-check、文件sync和SHA-256/size manifest，第二次确认authority后才原子发布；restore先验证DB与可选blob清单，只写不存在的target，并在失败时清理本票创建的staging/已发布blob。Node online backup API要求最低22.16，因此package engine同步收紧。
- 生产`cat-server`已通过LA-089导入并装配Task foundation；LA-093接入LA-owned settings/grants/trust；LA-094又在同一 startup owner 下装配Package v2 SQLite registry/journal/recovery与CAS content refs；LA-095接入Confirmed Memory SQLite authority与CAT/General host-authored recall bridge；LA-096接入Library SQLite metadata/blob authority与CAT/General host persistence bridge；LA-097接入CAT-core manifest/batch/TM/termbase SQLite authority与batch source/master及manifest asset的CAS source refs，并通过同一 install-once persistence seam让Project health、CAT readers/writers和上传导入路径读写新authority。CAT-core 的 `asset-blocks`、typed index、vectors、source-context index 与 cross-process read-cache 是可重建/派生对象，不是canonical facts。`cat-runtime`、`cat-tools`与Desktop不直接依赖SQLite，而通过显式 host persistence seam/RPC 使用这些域。LA-091已补齐Task aggregate的whole-domain rollback：回滚读取当前SQLite完整Task/内嵌Decision/queue/profile投影，发布legacy-compatible文件和legacy authority marker；正常启动不会自动re-cutover，显式re-cutover创建全新SQLite候选并重新import/parity。LA-092的`ContentBlobStore`现在被LA-094用于Package资源/归档引用，也被LA-096用于Library managed document bytes，并由LA-097用于CAT source refs；它按完整bytes计算/验证SHA-256、只读CAS blob、dedupe与orphan inspection/recovery。LA-096的marker明确将vectors/index排除在authority之外，旧Library metadata writer在marker后拒绝。LA-097的marker明确保留原始Project tree和source files作为marker-linked backup/read-only provenance，旧batch/TM/termbase/manifest writers在marker后拒绝；read-cache只服务不能拥有SQLite的旧进程，丢失时fail closed且不成为第二writer。LA-093现在为LA-owned settings、standalone grants、Pi trust与Extension trust建立了严格source validator、原始bytes备份、payload/source digest、revision/CAS与startup single cutover；SQLite marker明确排除Provider secrets和Pi native settings，前者仍只走Keychain/reference，后者仍由Pi SettingsManager负责。LA-095的marker明确排除TDAI与semantic index，不把旧自动capture/store或语义索引伪装成已迁移；旧memory JSON writer在marker后拒绝。`notification_preferences`、team-role settings、project agent settings、global permission settings、standalone grants与trust readers/writers在安装authority后不再回读或写旧JSON。LA-106又把两个会启动server的integration fixture改为显式test mode下的合成临时repo root与Pi agent dir，并通过health instance id断言覆盖生效，避免完整Gate测试扫描checkout `data/**`或真实home trust。以上切换和parity只在synthetic temporary roots验证，campaign没有读取或迁移真实`data/**`或真实`~/.pi/agent/trust.json`。

测试证据：`tests/workspace_io.test.ts`、`task_workspace.test.ts`、`runtime_storage.test.ts`、`runtime_migrations.test.ts`、`runtime_schema_v2_migration.test.ts`、`quality_decision_ledger.test.ts`、`tests/sqlite_settings_grants_trust.test.ts`、`tests/notification_preferences.test.ts`、`tests/pi_trust.test.ts`、`tests/pi_extension_trust.test.ts`、`tests/sqlite_assistant_library.test.ts`及SQLite storage测试（含Task cutover/rollback、audit、CAS blob/ref、settings/grants/trust与Library strict import/parity/cutover cases）。

LA-062 已由用户/架构所有者在 2026-07-23 批准：未来以 SQLite WAL 作为结构化事实的唯一 canonical writer，以 SHA-256 内容寻址 blob 保存大型不可变内容，JSONL 只作为生成的审计/导出格式。该决定记录在 `docs/adr/0001-sqlite-storage-boundary.md`；Task aggregate cutover和LA-090生成式JSONL已部分落实该边界，其余域仍须逐域迁移。

未知项：没有真实数据规模、旧 schema 分布、未知历史字段、写放大、备份/导出时长、WAL增长、blob/GC规模、磁盘满、断电、跨进程竞争的量化证据；`node:sqlite` 在当前 Node 22 仍发出 experimental warning。synthetic证据不证明真实历史目录、真实Pi trust文件或真实Library managed docs可导入、安装恢复时间、真实审计文件规模、掉电或生产rollback；LA-093也尚未证明真实配置样本不存在旧未知字段、无效Grant或失效Extension staging。

### 2.7.1 LA-098 CAT governance 增量

- `packages/cat-server/src/cat_governance_sqlite_cutover.ts` 是 CAT governance 的唯一 startup owner；在 data-root writer lease、active-run 检查和 listen 前完成 synthetic/显式 root 的备份、严格导入、parity 与 authority marker。
- `packages/storage-sqlite/src/cat_governance_repository.ts` 将 Project quality decision ledger、proposal sets、quality checklist 和 export audit 分为 project-scoped SQLite streams/projections；proposal 中的 evidence references 原样保留，source/evidence bytes 不在本票重复建库。
- marker 后旧 ledger/proposal/checklist/export-audit writers fail closed；关闭进程内 repository 后，跨进程读取只能使用 marker-linked derived read-cache，零记录 project 也有显式空投影，cache 缺失直接拒绝，不形成第二 writer。
- 测试覆盖 ledger hash/idempotency、proposal/checklist CAS、locked/tag/placeholder 与 evidence-reference 保留、QA/waiver/delivery audit、cross-task/team ledger parity、empty-project recovery、active-run/authority boundary 和 old-writer denial。所有证据只来自 synthetic roots；真实 `data/**` 未读取。

### 2.7.2 LA-099 Workflow/Team/Private Eval 增量

- `workflow_eval_sqlite_cutover.ts` 是唯一 startup owner：在writer lease、active-run检查与listen前备份并导入Project workflow、workflow artifacts（含Team child scope/artifact refs）和Private Eval set/run/output/scorecard/blind-review metadata，然后发布单一authority marker。
- `segments.jsonl`、`references.jsonl`、`rubric.json`及派生Markdown reports属于Eval corpus/派生文件，明确不进入SQLite；Stable Private Eval mutation stopgap未改变。
- marker后Workflow、workflow artifacts和Eval structured writer只经SQLite seam；关闭进程内repository时不回退legacy writer。所有证据只来自synthetic roots。

### 2.7.3 LA-100/101 跨域恢复与 legacy-writer Gate 增量

- `packages/cat-server/src/cross_domain_sqlite_backup.ts` 是未接线的 aggregate backup/restore verifier：发现固定七个 LA-025 marker，验证 SQLite schema/quick-check/foreign-key、projection blob refs 与 CAS inspection，创建一个含嵌套 domain snapshots、marker digest 和 blob manifest 的总 manifest。
- 恢复只在新 synthetic root staging 后原子发布，逐域验证 SQLite replay/schema 与 blob/ref 完整性；任一 domain 的异常会清理候选 root，不会覆盖现有 authority。真实历史、跨进程 snapshot 时序、掉电/磁盘满与生产 rollback 仍未证明。
- `tests/sqlite_legacy_writer_gate.test.ts` 使用 TypeScript AST 固定七个 LA-025 startup cutover 必须位于 `createServer` 前，并逐个检查 Memory、Library、CAT core/governance、Workflow/Eval 和 Package 的 legacy structured writer guard。它还在 synthetic marker roots 上执行 Package、Memory、Library、CAT core/governance、Workflow/Eval 拒绝写入哨兵，并验证 Settings/Grant/Trust 只通过 startup-installed SQLite backend 写入。旧 reader、backup 和兼容入口保留；本票不删除任何历史文件。

### 2.8 Electron、IPC 与 UI

- LA-039 已将最高权限 Electron 入口迁为 `src/main.ts` 与 `src/preload.cts`，并由 `ipc-contract.cts` 统一 channel、stream envelope 与固定 App command；renderer 的 `AppCommand` 类型也直接取自该 contract。LA-040 再将普通 workspace transport 收敛为 `api:workspace-capability`：唯一的 `workspace-capabilities.cjs` 路径模板表按 capability 验证 pathname，preload 和 main 都重验，只有 main 从匹配项取得 HTTP method 后才调用 runtime。LA-041 添加 `native-file-handles.mjs`：选择器只给 renderer 短时 `{id,name}`，main 在每次使用时复核 canonical realpath、inode、用途和TTL；Project reveal 只收 Project ID，维护候选和 Rich Artifact export 只交付 opaque handle。build 产出 `dist/electron/{main.js,preload.cjs,ipc-contract.cjs,workspace-capabilities.cjs,native-file-handles.mjs}`，打包 allowlist 显式装载这组编译依赖，保持 renderer 输出与 asar 的最小面。
- renderer 的 `workspace-client.ts` 可以在本地把既有 method/path 调用映射为已登记 capability，但跨 Electron 边界不再传递 method，未知 capability、未知 pathname、capability/path 不匹配和额外 IPC 字段都会拒绝。不存在临时 generic `api.request` 或 `api:request` 双桥；流式 Chat/Task API 仍是其原有的固定 stream channel。
- LA-038 使所有经 server `readBody` 的 HTTP JSON body 先经过 `strict_api_contract.ts`：必须是 `application/json`、受既有限制的合法 JSON object，且顶层字段必须在统一 `API_REQUEST_BODY_FIELDS` 词表中；字段扫描测试会阻止未声明的 route `body.<field>` 穿过该关口。权限、standalone Task、Project Task 与 queue 另有 exact unknown-field schemas；响应 DTO 生成和 endpoint-level value/query schema coverage 仍未完成。
- `system:reveal-path` 及 renderer `revealPath(path)` 已删除；Project、维护候选与导出分别使用 Project ID 或短时 opaque handle。新建项目、Batch/Asset/Library/`.lapkg` 导入、Chat file grant 和文档证据也不再向 main/server提交 renderer 路径文本；main 是唯一将已验证 handle 解析为既有 server wire path 的 authority。
- Electron security 基线已较强：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`、拒绝 permission request/new window/webview/untrusted navigation。
- LA-042 在 `task-events.ts` 建立每个选中 Task 的 `TaskProjectionStore`：只接受服务端已解析 snapshot 的 `replace` 或有序 canonical event 的 `apply`，重复 cursor 不产生第二事实、gap 保留最后确认 projection 并触发 reload、晚到的低 cursor snapshot 不会回退。`workspace-store.ts` 订阅该投影并仅把它发布到既有 `WorkspaceState` facade；打开、创建、重命名、archive/restore、Decision 返回的 Task snapshot 都经同一 replace 边界，SSE 不再直接写 facade 中的 Task 事实。没有第二套完整 Run 真相；Store 仍过大，后台通知仍不是完整后台 projection。
- LA-043 在 `TaskConversation.tsx` 使用 `StreamEventCoalescer`：只有 `assistant_delta` 进入 50ms（至多约20fps）窗口；任何非 delta 包括 final、permission/Decision、tool 与 queue 先 flush 文本、再立即按序交付。窗口 hidden 时 flush，Task 切换时丢弃旧 Task 的暂存文本以避免跨页泄漏；canonical Task event/projection 未被节流。尚未抽出独立 Global Event Provider，真机长会话/后台调度仍未验证。
- G5 Product Gate 已 `PASSED（仅允许私有 campaign 继续）`：LA-038 至 LA-043 与 LA-117 至 LA-122 均保持独立提交。LA-118 的用户授权 no-`data/**` synthetic test-root view 使每个 root child 都从无 `data/**`、`.git`、home 和未列 checkout 项的临时 cwd 运行；LA-119 至 LA-121 只补入精确所需的 tracked Pi/Dev/Team 静态材料，LA-122 只将 stale lease source guard 从已删除的 `main.mjs` 迁至 canonical `main.ts`。此后的直接完整 recheck 通过：`npm test` 231 discovered root tests（managed E5 pack 缺失的已声明 skip）、security 29、recovery 19、Desktop 161+3、`mac:test`、build、root/Desktop typecheck、roadmap/release 检查、JSON parse 与 diff check。未读写 real `data/**`，且未恢复 dual entry/writer。此结论不是 E5 资格、OS sandbox、真实机器或公开发布证明；R-030 legal/release Decision 仅阻断公开镜像、外部 reuse/contribution 主张与发布，不能阻断私有 Ticket、测试、Gate 或最终私有验证。LA-044 与 Phase 6 可以继续，公开镜像仍须等待该 Decision。
- LA-044 已移除 Composer 的 local active-Run fallback：`TaskConversation` 只接受 snapshot 的 `activeRunId` 所指向的 Run；缺失或悬空 pointer 时不会从历史 `stopAvailable` 或最近 Run 推断 stop/steer/follow-up 状态。消息队列仍只来自 server `TaskMessageQueue` 与其返回的 mutation/SSE update；本地 sending/stopping 仅是请求 in-flight 呈现，不生成 Run/queue/Decision 事实。focused Composer/UI-contract 与完整 Desktop 161+3 测试和 root/Desktop typecheck 已通过。真实 reload、键盘和辅助技术操作仍需后续 UI Gate 的真机/截图矩阵。
- LA-045 将 server-projected `resumeAvailable` Team Run 表示为 first-class `recovery` timeline item；Message/Activity/Decision/Artifact/Process/Run 与 Recovery 继续由同一个 canonical chronology、排序和 virtualizer 流转。不是 Team 或不可恢复的 terminal Run 仍为既有 status item，未创建第二条恢复状态机。完整 Desktop 162+3 与类型检查通过；真机长线程和可发现性仍待 UI Gate。
- LA-046 已完成 server-owned Decision binding：canonical `TaskDecision.decisionBinding` 固化 schema v1、内容 SHA-256、Run plan hash 与 expiry。只允许 `cat-server` 创建和校验；当前暂定策略为自 `createdAt` 起 30 天，未来若需调整必须通过版本化 server contract，不能由 Renderer 或本地时钟推导。缺 binding 的 legacy snapshot 仍可读取但不可执行；schema、内容、plan 或 expiry 任一不匹配均以 409 fail-closed 拒绝并要求重新决策。取消操作保留，以清理过期请求。所有现有生产创建点（Team preflight/artifact、Pi extension question、pipeline Decision）均写入 binding；Desktop 只显示服务端 scope/hash/expiry 事实且将缺 binding 的卡片设为只读。合成 binding/route/UI contracts、根与 Desktop 类型检查和完整合成测试通过；未读取 `data/**`。这不证明已安装 Electron、真实时钟漂移或真实客户工作流。
- LA-047 保持现有 server CAS/409、locked、server-owned tag、virtualizer 与 QA/Delivery server authority，不重写 CAT 流程；只移除了 `CatWorkspace` 全批次状态统计对 selected unsaved draft buffer 的依赖。10k rows 的 filter/navigation synthetic p95 低于 50ms，编辑时全批统计只在 canonical target/status 或 batch 本身变化时重算；selected-row 字/词计数仍即时使用草稿。桌面合同也覆盖 grid 键盘导航、VoiceOver 行/列语义、200% zoom-equivalent reflow 及 QA/交付入口。该证据不等同于 installed Electron 的真实 10k rows、VoiceOver、GPU/内存或真实 QA/Delivery 操作。
- LA-048 已完成：Library/Memory 继续使用 LA-029 的 provenance/reindex/recall DTO；Document Inspector 只投影 canonical Router 的来源 digest/MIME、per-page backend/version、reason、block count 和 complete/partial/blocked 状态。用户修正通过 server `POST /api/documents/evidence/corrections` 按 `taskId/artifactId/blockId` 重新水合原 Artifact；只接受已有 text block，生成带 parent Artifact、source digest、locator、before/after 的新 reviewable Artifact 和 human Activity，原 OCR Router Artifact 与源文件不变。Renderer 不从 capability/time/local Artifact 推导 job，也不传入 scope/path/backend；无 backend 的 canonical blocked page 明确显示 unavailable。合成 route/UI 测试、242 root tests、Desktop 166+3、root/Desktop typecheck 通过；真机 managed pack、VoiceOver、客户文档与已安装 Electron 仍未验证。
- LA-049 已以现有实现的 characterization 结案：唯一 maintained shell 的侧栏保留 Chats、Projects（中文本地化为“项目”）、Library、Settings 四个可见目的地；Library 在所有 canonical scope 都以同一 `LibraryWorkspace` 投影，Settings 返回切换前 scope，Packages 位于 Settings。原生设置命令仍是同一 Settings surface 的 alias；Stable shell 不重新暴露 Private Eval 或 Maintainer execution。没有创建 URL/deep-link router 或第二个前端状态机：当前 Electron 没有 URL route contract，现有 native command 和 server-backed selection 是唯一导航入口。480px/mobile dismissal、键盘 command palette、项目/Task 树与现有数据都未迁移或删除。该结论来自源码/桌面合同；installed Electron 的实际发现性、VoiceOver、截图与迁移后的 CI/tools 入口仍待 Gate/LA-050。
- LA-050 现已按 Epic 规则分解为五张可独立验证的子票：LA-129 将 Maintainer 候选构建迁到 developer/CI tool，LA-130 将 Private Eval 迁到 harness，LA-131 提供二者的只读历史导出，LA-132 与 LA-133 分别在 parity 后删除 production Maintainer/Eval route/UI consumer。该分解本身不运行、删除或重新开放任何生产入口；Stable 的 LA-060/LA-061 403/read-only stopgap 继续生效。
- LA-129 已完成：`scripts/maintainer-candidate.ts` 是 Maintainer 候选构建的唯一显式 developer/CI 入口（根脚本 `maintainer:candidate`）。`preview` 要求显式 `--repo`/`--target-pi`/`--candidate-root`，`build` 要求显式 `--plan` 与逐字匹配的 `--plan-hash`，hash 不符在调用核心前拒绝；工具只委托保留的 `maintainer.ts` 核心（`previewMaintenance`/`buildMaintenanceCandidate`），isolated worktree、plan-hash 与 validation 合同不变，不启动 product Agent、不读写当前 runtime、不读真实 `data/**`，结果只写 stdout。合成 tool contract 先 RED（模块缺失）后通过；Stable Maintainer route 仍为 403（`maintainer_disabled_in_stable`）。根 243 个自动发现测试、Desktop 167+3、root/Desktop typecheck、`mac:test` 均通过；LA-130/131/132/133 未完成前 R-023 保持 open。未读取 `data/**`、客户内容、签名材料或托管 runtime。
- LA-134 已完成（Codex UI 复刻系列首票，用户 2026-07-24 授权见 §10.5）：`tokens.css` 在保留全部既有 `--la-*` 名称与值的同时补全语义按钮四态填充（primary/secondary/tertiary，dark primary 文字为近黑——规格中 dark primary 行与其自身 send-button 证据冲突，按组件证据取舍）、spec elevation（stroke/prominent/sidebar，dark 用 inset hairline）、图标刻度（14/16/18/24/28）、shell 尺度（46/36/40 toolbar、sidebar clamp、nav row 29px、settings row 64px、composer 28px/22px）、container 刻度与 z 层级（menu 70、overlay max）；圆角转为 superellipse 引擎（`@supports` 命中时 scale 1.25 + `corner-shape: superellipse(1.5)`，否则 scale 1 圆角）；重复的 `@media (prefers-color-scheme: dark)` 声明块已删除，`theme-choice.ts` 永远把有效主题（system 经 matchMedia 解析并监听 OS 变化）写入 `data-theme`，dark 声明全仓只有一处。RED 合同 5 项先行（其中一条正则按 optional-call 语法修正后转绿）；`codex-ui-contract` 12/12 回归、Desktop 172+3、root/Desktop typecheck 通过。组件未重写；LA-135 至 LA-142 未完成前 R-032 保持 open。
- LA-135 已完成：46px `.product-toolbar` 是唯一拖拽标题栏（高度改用 `--la-height-toolbar` token，交互元素保持 no-drag），main 根的 28px `.desktop-drag-region` 冗余条及其 CSS 已删除；traffic-light 安全 inset 经新 token `--la-safe-header-left: 78px`（x:16 + ~54px 按钮 + 呼吸位）驱动 show-sidebar 按钮；`Workspace` 的 `.workspace-toolbar` 回退栏（死代码，唯一消费者 ProductWorkspace 总传 `renderToolbar`）与其 CSS 已删除且 `renderToolbar` 改为必需 shell 输入；`product-workspace.css` 双重 import 收敛为 `ProductWorkspace.tsx` 单一组件 import（styles.css 全局 import 移除）。RED `shell-chrome.test.ts` 3 项先行；Desktop 175+3、root/Desktop typecheck、`mac:test` 通过。window options 安全参数未动。
- LA-136 已完成：侧栏宽度收敛为共享 token（`--workspace-sidebar-width: var(--la-sidebar-width)`），footer 达到 spec 72px 高；命令面板按 cmdk 解剖复刻——dialog 宽 `min(520px, 92vw)`、圆角 `--la-radius-takeover`（16px base，squircle 引擎下 20px）、结果列表 `min(440px, calc(90vh - 64px))`、`scrollbar-width: none` + `overscroll-behavior: contain`，新增 `groupCommandResults`（command-model 纯函数，顺序 命令→Chat→项目→Batch→Task）按类型分组渲染并保留扁平 `command-result-${index}` 索引（`aria-activedescendant` 不变）。行布局保留 LA 更丰富的双行结构（title+detail+type），不回退到 spec 单行 24px；pin/hover 为有意的持久化偏好功能，本票不复制，由关注分组（需要处理/运行中/最近）覆盖排序需求。RED `sidebar-palette.test.ts` 3 项先行；command-palette/workspace-sidebar/codex-ui-contract 回归、Desktop 178+3、typecheck 通过。导航状态仍来自 canonical scope，未新建前端状态机。
- LA-137 已完成：Composer surface 阴影改用 spec `--la-elevation-prominent` token（保留 LA 的 focus-within 增强态与 94% 底 + blur(20px) saturate(125%) backdrop 和 squircle 引擎）；slash 菜单圆角改用 `--la-radius-takeover`；附件区 padding 改为 spec 8px/6px、chip 圆角改为 composer-radius−8 的 12px（替换 pill）；placeholder 落地 spec 伪元素机制——label 携带 `data-placeholder`，`:placeholder-shown` 时 `::after` 绝对定位、单行省略、0.5 透明度、不拦截指针，原生 placeholder 保留可访问性但视觉透明（单行/多行两种 inset）。双装配合并：新 `composer/composer-workbench.tsx` 导出 `ComposerAssetControls`/`ComposerModelControls`，BatchReady 与 TaskConversation 不再各自手搭 asset/model disclosure（send/stop/create 语义仍归各自装配）。拖拽放文件与 blocked/inert 态非 LA 现有功能，本票不伪造，留待有真实特性时再立票。RED `composer-chrome.test.ts` 3 项先行（placeholder 断言改为规则块内逐属性后转绿）；codex-ui-contract/task-composer 回归、Desktop 181+3、typecheck、`mac:test` 通过。
- LA-138 已完成：排队托盘补齐 spec 行级动效与编辑态——新增 `@keyframes queued-row-enter`（opacity 0→1 + translateY(-2px)→0，`--la-duration-micro` 级，高度动画用位移暗示替代逐行测量，reduced-motion 由全局规则关闭）；编辑中的行暴露 `data-editing` 并将 handle/actions 降至 0.6 且不可点（编辑器保持交互，规则置于 hover 之后防止 hover 恢复）；行操作区补 spec 分组标签 `aria-label="Queued message actions"`（role=group）。既有全集保持：30dvh 上限、1px 行距、拖柄/操作 hover 浮现、Retry/Steer/Edit/Delete/Pause/Resume、暂停补救文案、interrupted/delivery_failed 原因、alertdialog 清空确认、server-owned queue 事实。RED `queued-tray.test.ts` 3 项先行；codex-ui-contract 回归、Desktop 184+3、typecheck 通过。
- LA-139 已完成：线程流落地 spec §7 两条已确证密度规则——会话时间戳（activity/document/process/artifact 的 `<time>`）默认 `opacity: 0`，仅 hover/focus-within 浮现（Run boundary 状态、思考计时、specialist 耗时等状态元素保持常显，键盘与读屏等价可达）；user 气泡新增 hover 浮现的行内复制操作（`conversation-human__copy`，aria `Copy message`/`Copied` 成对，1.6s 复位，`navigator.clipboard.writeText`，24px 圆形 ghost 钮）。ProcessGroup 双段色与 hover 提亮、`· N 次` 尾注、Worked divider、32px 回到底部+三点跳动此前已达标（本票回归锁定）；reasoning 140px 封顶不适用（LA reasoning 为 content-free，无正文可裁）。RED `thread-anatomy.test.ts` 2 项先行；codex-ui-contract 回归、Desktop 186+3、typecheck 通过。
- LA-140 已完成：审批卡外壳对齐 spec——`rounded-3xl` 20px + `--la-elevation-prominent`（替换 24px + shadow-large）；批准/拒绝按钮补 spec kbd 提示（`Allow once`/`Trust this summary` 带 `Enter`、`Deny`/`拒绝` 带 `Esc`，16px 高、rounded 6px、`currentColor 10%` 底、aria-hidden，键盘行为原本已由 approval-keys 承担）；Reason 区、3 行预览折叠、scope 分割菜单此前已达标。新增 model-change 时间线项：conversation-model 从 canonical `executionSnapshots` 推导相邻 Run 的 `(providerId, modelId)` 变化（旧 epoch/缺快照不产生，order -1 排在 Run started 前），渲染为 spec 内联分割线（两侧 1px 细线 + `Model changed from … to …` + ⓘ 警告 tooltip「切换模型后表现可能变化。/上下文可能自动压缩；从下一 Turn 生效。」hover/focus 浮现）；`itemSearchText`/`itemMatchesKind`/estimator 同步覆盖新 kind。Plan 卡/Step pill 不伪造（canonical 模型无结构化 todo 数据，需后端票据）；auto-review 卡（LA 无此特性）与文件预览 200px 列表（无结构化数据）同理不做。RED `decision-cards.test.ts` 2 项先行 + conversation-model 纯推导行为测试（只 gpt-a→gpt-b 产生一条、同模型/缺快照不产生、位于 started 边界前）；codex-ui-contract/decisions/permissions 回归、Desktop 188+3、root/Desktop typecheck 通过。
- LA-141 已完成：Power Slider 补 spec 端点刻度——按住拇指或键盘聚焦时（`holding = previewIndex !== null || thumbFocused`，根 `data-holding`）轨道两端浮现「更快 ↔ 更强」标签（aria-hidden，`--la-duration-micro` 透明度过渡，不拦截指针）；几何（24px 轨道/28px 拇指/4px 刻度）、0.3s spring、键盘映射、`{value}, {n} of 7.` 播报、复位钮经回归锁定此前已达标。Advanced 视图切换（模型+effort 捆绑）、Fast 模式粒子/burst/toggle（LA-033 下 Fast 无显式生产 route）、Ultra 用量警告（LA 无用量计费概念）均属服务端不存在的执行特性，按 hard rail 不伪造 UI，留待真实特性票据。RED `power-slider.test.ts` 2 项先行；codex-ui-contract/composer-power 回归、Desktop 190+3、typecheck 通过。
- LA-142 已完成（Codex UI 复刻系列收官票）：Motion 库按第 6 章落地——loading-shimmer 改用 spec `steps(48, end)` 颗粒感（2s 周期不变）；新增 token `--la-animate-pulse`（la-pulse 2s，`50% { opacity: 0.5 }`）并由待决权限徽标 `.workspace-task-pending-badge` 消费（徽标在决策前持续脉冲，reduced-motion 由全局规则关闭）；新增 @property 驱动的滚动边缘渐隐系统（`--la-top-fade/--la-bottom-fade` <length> 注册可插值 + `@keyframes la-edge-fade` 两端切换 + `.la-scroll-fade-y` 工具类 `animation-timeline: scroll(self block)` + mask 线性渐隐），由排队托盘 `.queued-message-list__scroll` 消费，不支持的引擎退化为声明默认值（仅底部 1rem 渐隐）不遮挡内容。Spec 其余 keyframes（browser-sidebar、sync-dot、snake、启动屏 blossom 等）对应 Codex 专有特性，LA 无对应表面不复制；`--la-ease-in`/`--la-cubic-enter` 等无消费者的 token 按仓库 PR 规则不空建。RED `motion-library.test.ts` 3 项先行（la-pulse 正则按 0.5 写法修正后转绿）；codex-ui-contract/queued-tray/workspace-sidebar 回归、Desktop 193+3、typecheck、`mac:test` 通过。R-032 随九票全部完成转为 mitigated by source evidence，视觉证据仍待 LA-051 截图矩阵与真机 P3。
- LA-143 已完成（用户 2026-07-24 追加要求：滑杆更漂亮、每档差异化动效）：Power Slider 新增三层呈现动效，档位语义不变——轨道填充随档渐变（`.composer-power-slider__fill` 蓝→强蓝渐变、12px 圆角、宽随拇指几何、`width 0.3s var(--la-ease-spring)` 过渡，opacity 0.22 不喧宾夺主）；切档粒子爆发（12 个确定性粒子、30° 间隔、6ms 错峰、76px 场、5px 粒子、`la-particle-burst .62s cubic-bezier(.25,1,.5,1)` spec 曲线、22% 过冲 1.28，commit 时触发、700ms 清理，拖拽与键盘 commit 均生效）；max 档环境粒子流（仅 `index === total - 1 && !disabled` 时 3 个 3px 白色光点带辉光沿轨道 2.6s 循环穿行，0.9s 错峰）。根新增 `data-index`。RED `power-slider-motion.test.ts` 3 项先行；power-slider/codex-ui-contract/composer-power 回归、Desktop 196+3、typecheck 通过。reduced-motion 由全局规则关闭全部三层。
- LA-144 已完成（Agent Plan 系列首票，用户 2026-07-24 授权结构化 todo 与模型可视化回答，登记见 §10.6）：rich artifact schema v1 新增严格校验的 `todo_list` block——`RichArtifactTodoItemV1`（id 稳定标识符/text ≤2000 字符/status 仅 `pending | in_progress | completed`），items ≤500、id 唯一、非空；惰性 HTML 导出同步渲染（status 标记、completed 删除线、惰性样式，CSP 不变）；Electron `RichArtifactPreview` 新增 block 渲染（✓/◐/○ 标记 + 删除线 + in_progress 强调色）与 inspector CSS。现有 7 种 block 与可执行标记禁令不变。RED root `rich_artifact_todo_block.test.ts` 3 项 + desktop `rich-artifact-todo.test.ts` 1 项先行；rich_artifact 回归、root 全量（tool capability manifest/roadmap/worker boundary 通过）、Desktop 197+3、root/Desktop typecheck、diff check 通过。
- LA-145 已完成：新 canonical artifact type `agent_plan`（contract 联合 + ARTIFACT_TYPES + v2 schema 枚举 + 双 renderer label map `工作计划`）与 host-owned `agent_plan_update` 工具全链接通——General Worker 新增 `server_tool` bridge kind（worker stub 只发 `bridge_request`，Host `answerServerToolBridge` 先经 `parseServerToolRequest` 严格校验再分发）；Host 处理器 `updateAgentPlanArtifact`（`general_agent_runs.ts` 导出）先 `parseAgentPlanUpdatePayload` 严格校验（title ≤1000、items 1-500、id 稳定标识、text ≤2000 无 NUL、status 枚举、id 唯一、无未知字段），再以稳定 artifact id `agent-plan:<taskId>` 经 `appendGenerated`（`expectedActiveRun` 双保险 + 先读 snapshot 校验 run 仍 active）写新版本 artifact（版本由 writer 递增）+ `plan` 类型 Activity（`refs.artifactIds`）；三个调用点（主 Run、compaction、fork）注入 handler，delegated read-only child 不注册。工具经 `toolSurface` 注册（hasDocumentContext 且非 readOnlyChild，不进 initial-active，模型经 capability_search 激活）、`toolCapabilities` 新 `task-plan` 能力 kind + manifest（cat-governance/non-picker）、`createUpdatePlanTool`（defineTool+Typebox，prompt 指引每 Chat 只维护一份计划）与系统提示行。Worker 不触碰 workspace（post-cutover 的 document-tools 模式不是模板）。RED `agent_plan_tool.test.ts` 6 项先行（type 契约/payload 严格性/版本递增+plan activity/stale run 拒绝/capability manifest/bridge 信封）+ `general_session_plan.test.ts` 补注册断言；focused 回归 7 项、root 全量（capability manifest/roadmap/worker boundary 通过）、Desktop 198+3（含并行落地的 LA-146 plan-model 单测）、root/Desktop typecheck、`mac:test` 通过。桥无 cancellation（记录为遗留风险）。
- LA-146 已完成（Agent Plan 系列收官）：`plan-model.ts` 纯模型（`latestAgentPlan` 取每 Task 最新 agent_plan 版本并解析 todo_list、`planProgress` 按 spec 顺序定当前步（首个 in_progress→首个 pending→全完成）、`planRingDashoffset` 100 单位进度环几何）；`PlanCard`（`ConversationItems.tsx`）按 spec §3.3 渲染——进度摘要标题（0 完成时「已创建包含 N 项的计划」，否则「共 N 项，已完成 M 项」）、整行可点 aria-expanded、chevron 90° 旋转、todo 行序号+状态图标+completed 删除线、7rem preview/20rem expanded 高度状态机（`--la-duration-panel` 过渡）；agent_plan artifact 在 ConversationRow 走 PlanCard 而非通用 Artifact 卡。`ConversationPlanPill`（导出）位于 composer 上方、权限面出现时不显示——进度环（pathLength 100 SVG、`--la-accent` fill、spring dashoffset 过渡）或全完成蓝点（spec §3.4 规则）+ `Step n / N` tabular-nums + hover/focus-within 弹出完整计划 popover。无 plan 的 Task 不渲染任何相关 UI，进度完全由 canonical 投影推导，Renderer 不伪造。RED `plan-card.test.ts` 2 项先行 + `plan-model.test.ts` 纯行为 3 项；codex-ui-contract 回归、Desktop 200+3、Desktop typecheck 通过。
- LA-054 将普通 CI 拆为 `validate`、`unit`、`security`、`recovery`、`macos` 和 `release` jobs：每个 job 从根 lock 安装，macOS job 保留 production build/test，validate 上传无敏感的 root test discovery 清单。三份 workflow 的 Actions 均固定到完整 SHA，`rc:status` 因会写 `data/reports` 未进入新 job。旧 full `legacy-verify` 暂时保留为测试回滚路径，直到私有分支的远端分层 jobs 实际全绿；本轮只证明本地 YAML、静态 contract 与等价命令，未触发远端 CI。
- LA-055 已按 Epic 规则由 LA-123 至 LA-127 分解、验收并关闭：分解时 `server.ts` 为 5,217 行，混合 HTTP/FS/Pi import、route/coordinator 装配与 Project Task Run 编排。五张子票依次限定 application port、route transport、composition wiring、import-boundary CI guard 与 Settings permission route 的 runtime edge；完整 architecture graph、239-test synthetic root、Desktop/mac 均通过。它不把 source-level 约束误报为 installed runtime/remote CI/真机或所有 server startup/General/Eval orchestration 已证明，也不以简单移动文件或新增全局 service 误报为架构收敛。
- LA-123 冻结了五个 server route application ports（Task/Run、Workflow、Settings、Package、Document）的 transport input/output 与 canonical authority，并将当前 Task/Workflow/Package/Document 的 direct FS/Pi imports 逐条登记为只由 LA-124 消除的 debt。该 inventory 不参与 production dispatch，不创建第二 service locator、writer 或 Run lifecycle；它只是后续迁移的可执行基线。
- LA-124 已清除 LA-123 登记的 route-local direct FS/Pi debt：Task capability allowlist 由 Task/Run application port 负责；Team tool-schema、Pi child evidence scope/role request、subagent output/activity 与 rollback 删除由 Workflow application port 负责；`.lapkg` regular-file/size/read policy 由 Package archive port 负责；Document evidence port 负责 grant realpath、managed OCR、Artifact bytes 和单个 canonical Task/Run/Activity/Artifact append。四个 route 不再直接 import `node:fs/promises` 或 `cat-runtime`，inventory 以 denial guard 固化。HTTP DTO、稳定错误码、已有 canonical writer、active-Run lease 与 Pi child authority 均未改变，未读写 real `data/**`。这不是把所有 coordinator 业务编排声称为已拆分；LA-125/LA-126 仍须分别收紧 composition wiring 与全图方向约束，installed runtime/真实 Package/Document/Provider/remote CI 也尚未验证。
- LA-125 已把 Project Task Run 的 durable projection、Pi worker session 创建/identity 绑定、extension interaction、queue/stop bridge、CAT stream-rule/self-healing retry、title sync 与 final event/chat projection 收进 `application/project_task_run_coordinator.ts`；`server.ts` 降至 4,150 行，只保留同一 keyed queue、共享 registry/queue/worker 的装配和 route runtime adapter。compaction 也由该 coordinator 负责。没有新 session、writer、global service locator 或 Electron lifecycle；active Run registry、TaskMessageQueue、CAT worker supervisor、Task/Run canonical writer 与 permission/Team authority 仍是既有单例。composition 和 worker-cutover characterization、Task route/projection/queue/stop/worker regressions、根 236-test synthetic suite、Desktop 164+3 和 typecheck 均通过。尚未证明 installed Electron/managed runtime、real Provider/Team child/Package/Document input、remote CI、真机可访问性、签名/公证或公开镜像；后续 LA-127 已移除 Settings permission route 的临时 runtime-import exception。
- LA-126 增加 `architecture:check`：它以 TypeScript AST 扫描 `cat-server` application、routes、server 与 Desktop main 的 import/组合边界，并在 CI `validate` job 运行。application 不得依赖 routes 或 server composition；route 不得直接依赖 `node:fs`/`cat-runtime`；server/Desktop 不得重新定义已迁出的 Project Task Run/compaction 或 CAT Task 状态。guard 还拒绝过期例外、重复例外、无 owner/reason 的例外，并要求每个例外的 owner 同时存在于执行队列与删除覆盖。LA-127 已删除 `agent_permission_routes.ts -> cat-runtime` 的精确临时例外及其删除候选；唯一剩余例外是由 LA-050 拥有删除的 production Maintainer route filesystem edge，且不是 glob 或永久允许。全图/fixture、CI contract、typecheck 通过；完整根/真机/remote CI、Provider、签名和公开镜像仍未验证。
- LA-127 将 Agent permission mode/rule patch 的严格 DTO 验证、locked-domain 拒绝及 contract 构造收进 `application/settings_permission_application_port.ts`。`agent_permission_routes.ts` 只解析/映射 transport 并调用该 Settings port；原有 global/project canonical settings writer、pending decision registry、Decision persistence、默认值及 Electron 都未改。路由不再直接 import Pi runtime，LA-126 的 Settings 例外和对应删除候选均已删除。permission application/route、import inventory 与完整 architecture graph、root 239-test synthetic suite 和 Desktop/mac 164+3 均通过；证据仍是 synthetic/source 级，不证明 installed runtime、真实 Provider/CI、真机可访问性、签名或公开镜像。
- LA-128 由 LA-127 的 full synthetic suite 发现：legacy Project quality ledger 在 `assertCatGovernanceLegacyAllowed()` 的 first await 后才登记 per-path append queue，三个并发 append 可绕过同一 queue，导致 finding/waiver 的 hash/sequence 顺序重排，`openFindings` 偶发为 1。修复将该 authority 检查移入已建立的同一路径 queue；同一进程的 legacy fallback 现在在线性 queue 内依次检查 marker、读取、hash、append，仍不对跨进程并发作未证明的承诺。原始 ledger 和新增 32-root concurrent regression、typechecks、architecture graph、239-test full synthetic root 及 Desktop/mac 164+3 均通过。没有变更 SQLite authority、schema、route、Electron、`data/**`、customer content 或第二 writer；真实跨进程、掉电和最大 Project ledger 仍是 R-011 未验证项。
- 对话使用 `useSyncExternalStore` 和 `@tanstack/react-virtual`；消息队列、Steer、Retry、权限请求恢复等能力在当前工作树中已有实现痕迹。
- UI 规格要求的若干尺寸/行为已出现：1280×820 默认、480×600 最小、46px titlebar、thread 宽度约束、reduced-motion。当前测试主要是源码/DOM contract，未形成完整 Playwright 截图矩阵。
- Package Center 已在 Settings；`PipelineWorkspace` 与 Maintainer 组件虽为保留的历史只读/迁移代码，却不构成 Stable 一级导航或生产执行入口。LA-050 仍需把其 retained implementation 迁至 CI/tools 并通过删除门。

测试证据：`tests/strict_api_contract.test.ts`、`local_transport_security.test.ts`、`agent_permissions.test.ts`、Task/queue/batch/asset/Library/workflow route tests、`apps/desktop/tests/{ipc-contract,workspace-capability-contract,native-file-handles,security,packaging,local-update}.test.mjs`、`permissions.test.ts`、`codex-ui-contract.test.ts`、`electron-acceptance-activity.spec.ts`、renderer model tests；desktop build/typecheck、root typecheck 已通过。

未知项：未运行真实 Electron/VoiceOver；LA-047 的 synthetic 10k filter/navigation p95 与 200% zoom-equivalent source/DOM contract 不替代真实 10k CAT rows、长线程、截图或 VoiceOver 操作；未创建真实签名 macOS 包，因此只验证了编译产物和 asar allowlist contract，未证明已安装包；共享 request vocabulary 不是响应 DTO 生成，非 Task/permission route 仍主要由既有 domain validator 约束其字段值；opaque native handle 的真实长时运行TTL、已安装 Electron/XSS 和 same-user native-process 行为仍未证明。

## 3. 蓝图前提中需要纠正的地方

1. **不是从零建立 canonical Task。** 当前已有 Task event log、snapshot replay、SSE 和 renderer gap recovery；迁移必须复用或转换，不能平行新建第二套状态。
2. **不是完全没有资源冻结。** General resource snapshot、Task run resource manifest、profile revision/hash 已存在；问题是没有统一成全 Run 的 Execution Snapshot/Epoch。
3. **不是所有权限路径都 fail-open。** 未知 permission mode 的确会变成 auto，但 decision action 未知会 deny，CAT hard rails 也存在。修复必须保持这些已正确的边界。
4. **Package preview 不是纯预览。** 当前会下载、写 quarantine、运行 npm 依赖安装；蓝图要求的是行为变更，不是简单重命名。
5. **前端不是完全缺失 Codex 风格能力。** 当前工作树已有虚拟化、queue/steer、事件恢复和多处视觉合同；剩余缺口应由可执行 UI matrix 决定，不能整页重写。
6. **蓝图尚未被登记为 canonical backlog。** 它已随 `64bcb15b` 提交，用户也已批准大改方向，但仍与 `TODO.md` 的 RC feature freeze 冲突；第一个治理动作必须同步权威 backlog，不能让两套“当前计划”并存。

## 4. 本轮未验证

- 已安装 App、托管 runtime、Keychain、签名/notarization、真实升级/回滚状态。
- 真实客户数据、生产数据 schema 分布和迁移耗时。
- Proma 源码或许可证逐文件审计；本轮只遵守 clean-room 禁止复制约束。
- 真机 UI、VoiceOver、OCR、MinerU、provider 断线、GPU/内存和 10k rows 性能。
- `64bcb15b` 是否已推送、是否进入发布分支，以及安装包是否包含该基线。

## 5. 本轮验证结果

- `npm run typecheck`：通过。
- `npm --prefix apps/desktop run typecheck`：通过。
- `npm test`：通过；`asset_rag_multilingual_eval` 因托管 E5 pack 缺失按测试合同跳过，未关闭该 acceptance gate。
- `npm --prefix apps/desktop test`：149 个桌面测试和 3 个 acceptance activity 测试通过。
- `git diff --check`：提交前通过。
- 未运行签名、公证、真实安装、真实 provider、VoiceOver 或客户数据测试。

### LA-097 增量验证（2026-07-23）

- `tests/sqlite_cat_core.test.ts`：通过；synthetic Project manifest、Batch/Segment、TM、termbase、override、source/blob refs、CAS、active-Run stopgap、marker 与跨进程只读 projection 均已覆盖。
- `tests/project_health.test.ts`、`qa_terminology.test.ts`、`constraint_pack.test.ts`、`segment_evidence.test.ts`、`evidence_tools.test.ts`、资产/TM 回归：通过。
- `npm run typecheck`：通过；`npm test` 自动发现 215 个 root tests 并通过；`asset_rag_multilingual_eval` 因 managed E5 pack 缺失按既有合同跳过，未关闭该 acceptance gate。
- `npm run test:security`：通过 29 个测试；`npm run test:recovery`：通过 18 个测试；`npm --prefix apps/desktop test`：151 个 Node 测试与 3 个 activity 测试通过；Desktop typecheck、`npm run mac:test`、`npm run release:check`：通过。
- 本票只在合成临时 root 执行；未读取、迁移、删除或改写真实 `data/**`、客户资产、公开镜像、签名凭据或安装运行时。真实 Project 规模、历史格式分布、WAL/Blob GC、process-kill、断电、磁盘满、生产 rollback 与真机性能仍未验证。

### LA-147 增量验证（2026-07-24）

- `tests/agent_present_tool.test.ts`（8）：先 RED（缺导出）后全绿——`agent_present` 进入 canonical artifact 类型且未知类型仍拒绝；payload 严格校验（空 blocks/缺 blocks/意外字段/可执行 HTML/未知 table 列拒绝；`todo_list`、`image`、`page_overlay` 不属于可呈现 block）；每次 present 写全新 artifact（version 1、id 互异）并附 `artifact_update` activity；stale Run 拒绝；capability metadata 齐备；桥信封按名解析；`routeGeneralServerTool` 按工具名分发、缺 handler 响亮报错；Run-backed session 注册但非 initial-active。
- 回归：`tests/agent_plan_tool.test.ts`、`general_session_plan.test.ts`、`rich_artifact.test.ts`、`rich_artifact_todo_block.test.ts`、`tool_capability_manifest.test.ts`、`task_workspace_contract.test.ts`、`strict_api_contract.test.ts` 通过。
- `npm run typecheck`、`npm --prefix apps/desktop run typecheck`：通过（两处 `Record<TaskArtifactType, string>` 标签映射与 v2 JSON schema enum 同步 `agent_present`）。
- `npm --prefix apps/desktop test`：200 Node + 3 isolated Electron activity 测试通过，EXIT=0。
- `npm test`：完整套件通过，EXIT=0（明细见 EXECUTION_LEDGER LA-147 条目）。
- 本票只在合成临时 root 执行；未读取、迁移、删除或改写真实 `data/**`、客户资产、公开镜像、签名凭据或托管运行时。

### LA-148 增量验证（2026-07-24）

- `apps/desktop/tests/present-card.test.ts`（1）：先 RED 后绿——`agent_present` artifact 绕过通用 artifact 卡，`PresentCard` 经纯模型 `agentPresentDocument` 解析 canonical 文档，非法/缺失文档不渲染（不伪造），block 原样传给共享 `RichArtifactBlockView`，默认展开、aria-expanded 切换、preview 限高、expanded 滚动、chevron 旋转、检查入口透传 canonical artifact。
- `src/renderer/conversation/present-model.test.ts`（2）：block 顺序与标题保真；非 present 类型/schemaVersion 不符/可执行 HTML/缺失文档均返回 null。
- 回归：`plan-card.test.ts`（2）、`plan-model.test.ts`、`conversation-model.test.ts` 通过；`npm --prefix apps/desktop run typecheck` 通过。
- `npm --prefix apps/desktop test`：完整套件通过（明细见 EXECUTION_LEDGER LA-148 条目）。
- 本票只改呈现层；未触碰 runtime、route、writer、schema、真实 `data/**`、客户资产、公开镜像、签名凭据或托管运行时。

### LA-130 增量验证（2026-07-24）

- `tests/private_eval_harness.test.ts`（6）：先 RED（模块缺失）后全绿——参数严格（缺 `--root`/`--adapter`、未知选项、非法 mode 拒绝）；production `data/` root 拒绝（测试经 `import.meta.url` 定位生产 data，cwd 无关，兼容 test-discovery 的 synthetic-root 套件）；single parity（status completed、2 outputs、`canonical_single_batch` manifest、referenceIncluded/writeMode 保持、每段 mechanicalQa、comparison report 落盘）；team parity（`canonical_team_workflow` manifest、隔离 `private-eval-*` 项目被清理）；generate 失败 → run failed 且 error 保留（不伪造成功）；Stable route POST 仍 403 `private_eval_disabled_in_stable` 且拒绝发生在读 body 前。
- CLI 冒烟：`npm run eval:private run --mode single` 于临时合成 root 完成（completed/2 outputs/report 落盘），随即删除临时目录。
- 回归：`tests/{eval_routes,private_eval,private_eval_canonical_single,private_eval_team_adapter,private_eval_session,eval_task_run_projection,sqlite_workflow_eval,maintainer_candidate_tool,harness_eval_smoke}.test.ts` 通过；`npm run typecheck`、`npm --prefix apps/desktop run typecheck`、`npm run mac:test` 通过。
- `npm test`：完整套件通过（明细见 EXECUTION_LEDGER LA-130 条目）。
- harness 全部运行在 `mkdtemp` 合成 root；未读取、改写或删除真实 `data/**`、Eval 历史、客户资产、公开镜像、签名凭据或托管运行时；production Eval route/UI 未重开。
