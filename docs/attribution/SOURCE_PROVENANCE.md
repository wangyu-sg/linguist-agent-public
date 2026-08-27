# SOURCE_PROVENANCE — 代码来源登记

> 工单：PB-002（许可证与来源治理）
> 任何代码进入本仓时，必须在此登记来源。登记先于合入，不后补。

## 来源总表

| 来源 | 许可证 | 在本产品中的角色 | 是否直接继承代码 |
|---|---|---|---|
| `proma-ai/Proma` | AGPL-3.0 | 产品底座：Electron、Pi、Session、Streaming、Provider、UI、打包 | **是，主底座**（完整 git 历史） |
| `wangyu-sg/linguist-agent`（旧仓，私人） | AGPL-3.0（同作者） | CAT 内核、格式、TM/TB、Proposal、QA、Delivery、迁移 | 选择性提取到 `packages/linguist-*` |
| `andrewyng/openworker` | MIT | 极简信息架构、交付物导向、部分 UI 模式 | 仅按需 |
| `openai/codex` | Apache-2.0 | 开放仓中的协议、安全、Session/Turn 思路 | 按需，分清开源与闭源 |

## 基线固定

- 当前 Proma upstream baseline：`v0.18.2@92a635faa522d5d40544b06fdf74a28152012c71`
- 仓库初始 Proma root：`702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（历史来源，保留在 Git 记录中）
  （`docs/architecture/UPSTREAM_BASELINE.md`）
- 旧 LA 冻结点：tag `la-v2-legacy-freeze-2026-07-25`，commit `c2014227b34c45294dafe9bab6f65346f4c3a654`

## 复制登记规则

### 从 Proma 提取

- 保留全部上游版权与 AGPL-3.0 许可头；
- 不删除任何上游 `LICENSE`/版权声明；
- upstream 同步按 `docs/architecture/UPSTREAM_BASELINE.md` 的 SHA 做三方对照。

### 从旧 LA 提取（选择性，限计划 D-005 清单）

- 只允许提取：双语格式 Adapter、Segment/Asset/Batch 数据模型、TM/TB/Glossary、
  Proposal/Review、Locked/Placeholder/Tag/ICU 规则、Evidence/Provenance、
  QA/Delivery Gate、CAT Tool 与 Skill 业务逻辑、领域测试与 synthetic fixtures、
  旧数据只读迁移器；
- 禁止提取（D-004）：`cat-server` 整体、旧 General Run Coordinator、旧
  AgentRuntimePort、旧 Worker Supervisor、旧 Package Center、旧 Extension
  Host、旧 Maintainer/Private Eval、旧 Renderer、旧通用 Transport、旧权限平台；
- 每次提取在下表登记：来源文件路径（旧仓）、目标路径、对应 PB 工单。

### 从 OpenWorker 复制（MIT）

- 复制的每个文件保留原版权头与 MIT 许可证全文（或在文件头注明并集中于
  `docs/attribution/` 存档许可证文本）；
- 在下表登记：来源文件、commit、目标文件、修改说明。

### 从 openai/codex 复制（Apache-2.0）

- 保留 Apache-2.0 许可证文本与任何 `NOTICE` 内容；
- 每个被修改的复制文件头部加 "Modifications: ..." 说明；
- 在下表登记：来源文件、commit、目标文件、修改说明；
- **不得**把 OpenAI 闭源桌面客户端的任何内容（代码、文案、资源、文件/
  chunk/class 名）当作 codex 开源仓内容引入。

## 提取/复制登记（逐条追加）

| 日期 | 工单 | 来源（仓@commit:路径） | 目标路径 | 许可证处置 |
|---|---|---|---|---|
| 2026-07-25 | PB-001 | proma-ai/Proma@702a8221（整仓 clone） | 仓库根 | AGPL-3.0 保留，LICENSE 未动 |
| 2026-07-25 | PB-021 | 无逐字复制——按重建计划 schema 全新编写（仅参考旧仓 `cat-data/src/batch_workspace.ts` 的 SegmentRevisionConflictError 语义，未复制代码） | `packages/linguist-cat-core/`（整包新写） | AGPL-3.0 新代码 |
| 2026-07-25 | PB-022 | 无逐字复制——按计划 §6.1/§6.3 全新编写（Adapter 接口签名照计划原文；SHA-256 为 FIPS 180-4 标准算法的新实现，未复制第三方代码；未从旧仓 cat-formats 复制任何行） | `packages/linguist-cat-formats/`（整包新写） | AGPL-3.0 新代码 |
| 2026-07-25 | PB-023 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-formats/src/generic_xliff.ts` 的 XML 工具函数（decodeXmlInline/encodeXmlText/encodeXmlInline/encodeXmlAttr/parseAttrs/setAttr/findFirst）——逻辑照抄、风格适配（单引号/无分号）；`XliffAdapter` 本身（接口粘合/状态映射/模板导出）全新编写 | `packages/linguist-cat-formats/src/adapters/xliff-xml.ts` | AGPL-3.0（同作者） |
| 2026-07-25 | PB-023 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `tests/fixtures/memoq/sample.mqxliff`（合成 fixture，已读核实无客户数据）——逐字复制，sha256 a8422085… | `tests/linguist-fixtures/sample.mqxliff` | AGPL-3.0（同作者）合成 fixture |
| 2026-07-25 | PB-023（CSV leg） | 无逐字复制——`CsvAdapter`、fixtures、测试全部全新编写（仅参考旧仓 `packages/cat-formats/src/table_csv.ts`/`table_columns.ts` 的列别名思路与 csv_paste 语义；旧解析器按行切分不支持引号内嵌换行、写出整文件重编码不保字节，未复制任何行） | `packages/linguist-cat-formats/src/adapters/csv.ts`、`tests/linguist-fixtures/{mini_dialogue,terminology}.csv` | AGPL-3.0 新代码 |
| 2026-07-25 | PB-023（JSON leg） | 无逐字复制——`JsonAdapter`（含严格 RFC-8259 span 跟踪解析器）、fixture、测试全部全新编写（旧仓无等价 span 跟踪 JSON 模板实现；仅沿用本仓 CSV leg 的合成 key/warning 策略） | `packages/linguist-cat-formats/src/adapters/json.ts`、`tests/linguist-fixtures/mini_items.json` | AGPL-3.0 新代码 |

| 2026-07-25 | PB-024 | 无逐字复制——`@linguist/cat-store` 整包全新编写（pragma/migration 模式仅参考旧仓 `packages/storage-sqlite/src/index.ts` 的 WAL/synchronous=FULL/foreign_keys/busy_timeout/schema_migrations 做法与计划 §5.4/§5.7，未复制任何行；未复制旧仓 900 行 storage index） | `packages/linguist-cat-store/`（整包新写） | AGPL-3.0 新代码 |
| 2026-07-25 | PB-025 | 无逐字复制——CLI、interim 最小 QA、asset-source 存储能力全部全新编写（仅沿用本仓既有 domain/store 模式与错误风格，未读取旧仓实现） | `packages/linguist-cat-store/src/{cli,minimal-qa,asset-source}.ts` 及对应测试 | AGPL-3.0 新代码 |

| 2026-07-26 | PB-030 | 无逐字复制——主进程 LinguistProjectService 及配套模块（errors/paths/format-registry/testkit/测试）全部全新编写（沿用本仓 cat-store/cat-formats 错误模式与 main/lib 服务单例风格；`test/` 下两个 `.mjs` loader 复用本仓 `packages/linguist-cat-store/test/` 同名文件模式） | `apps/electron/src/main/lib/linguist/`（整目录新写）、`packages/linguist-cat-store/src/runtime.ts`（esbuild CJS 打包下 createRequire 基准修正） | AGPL-3.0 新代码 |
| 2026-07-26 | PB-041 | 无逐字复制——`@linguist/cat-tools` 整包全新编写（Pi ToolDefinition 形状以 node_modules `@earendil-works/pi-coding-agent` dist 类型为准，未复制 SDK 代码；错误/分页模式沿用本仓 cat-store/cat-core 既有风格；`test/` 下两个 `.mjs` loader 复用本仓 `packages/linguist-cat-store/test/` 同名文件模式）；cat-store 读取扩展（segments.count、tm-units/term-entries 只读仓库）同为新写 | `packages/linguist-cat-tools/`（整包新写）、`packages/linguist-cat-store/src/repositories/{tm-units,term-entries}.ts`、`packages/linguist-cat-store/src/repositories/segments.ts`（count 方法） | AGPL-3.0 新代码 |
| 2026-07-26 | PB-042 | 无逐字复制——会话 CAT 工具解析、冲突检查、fake model 场景与历史打包探针均按本仓既有 PB-034/PB-040 接缝全新编写；为修复 Electron CJS 启动回归，将 Pi `defineTool` 的类型保持行为改为本地泛型恒等函数（仅依据已安装包公开类型/运行时行为，未复制 SDK 文件） | `apps/electron/src/main/lib/linguist/session-cat-tools.ts`、历史 CAT Tools packaged 探针（已退役）、`packages/linguist-cat-tools/src/factory.ts` | AGPL-3.0 新代码 |
| 2026-07-26 | PB-052 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-data/src/{format_signatures,qa_write_gate,number_qa,delivery_qa}.ts` 的 brace/ICU 扫描、签名比对、数字 canonicalization 与术语命中思路——合并改写为单一纯函数硬门；删除 project tag runtime/waiver/IO，补标准嵌套 ICU、forbidden terms、稳定结构化 violation；测试按新 API 重写 | `packages/linguist-cat-core/src/{hard-rules.ts,hard-rules.test.ts}` | AGPL-3.0（同作者），文件头保留 adapted/modified 说明 |
| 2026-07-26 | PB-061 | 无逐字复制——按 TanStack Virtual 官方公开 API 全新编写 Grid 接入；新增精确依赖 `@tanstack/react-virtual@3.14.7`（其解析依赖 `@tanstack/virtual-core@3.17.5`），未复制依赖源码或示例代码 | `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,cat-virtual-utils.ts}` | 本仓新代码 AGPL-3.0；TanStack Virtual 依赖 MIT |
| 2026-07-26 | PB-010 follow-up | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `apps/desktop/resources/AppIcon.icns`（产品自有图标，未读取 `data/**`）——导出为保留源图，并以本仓脚本生成平台格式 | `apps/electron/resources/{icon-source.png,icon.png,icon.icns,icon.ico,icon.svg}`、`apps/electron/scripts/generate-la-icon.mjs` | AGPL-3.0（同作者）；保留来源与生成方式 |
| 2026-07-26 | PB-086 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-formats/src/sdlxliff.ts` 的 sdl 语义（parseSegDefs 的 sdl:seg-defs/mid 查找、isLockedAttr 真值表、statusFromConfirmation 的 conf→状态映射）——逻辑照抄、映射提升至本仓 4 档 SegmentStatus（conf="Translated"→'translated' 为有文档偏差）；`SdlXliffAdapter` 本身（mrk 拆段模型、模板导出、detect、契约粘合）全新编写；测试 fixture 形状参考旧仓 `tests/sdlxliff.test.ts` 内联合成 fixture（未逐字复制，无客户数据） | `packages/linguist-cat-formats/src/adapters/sdlxliff.ts` | AGPL-3.0（同作者） |
| 2026-07-26 | PB-087 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-formats/src/phrase_mxliff.ts` 的 phrase 语义（isLocked 的 `m:locked`/`locked` 真值表与 translate="no"、`m:confirmed` 真值规则、parseGroupContexts 的 group `m:para-id`→`x-key-note` context 查找）与 `packages/cat-data/src/batch_workspace.ts` 的 segmentStatus（confirmed→状态）——逻辑照抄、映射提升至本仓 4 档 SegmentStatus（`m:confirmed` 数字级别 ≥2→'reviewed'、其余真值→'translated' 为有文档偏差；无 confirmed 时回退 state/state-qualifier 同为有文档偏差）；`PhraseMxliffAdapter` 本身（扁平段模型、模板导出、detect、契约粘合）全新编写，旧仓 master XLIFF 配对与 `{n}` 占位符 rehydration 不在本 leg 范围（占位符逐字往返）；测试 fixture 形状参考旧仓 `tests/phrase_mxliff.test.ts` 内联合成 fixture（未逐字复制，无客户数据） | `packages/linguist-cat-formats/src/adapters/phrasemxliff.ts` | AGPL-3.0（同作者） |
| 2026-07-26 | PB-088 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-formats/src/phrase_bilingual_docx.ts` 的写侧语义（cellText 的 `<w:t>` run 拼接与实体解码、≥5 格段行判定、replaceNthCell、rewriteCellText——首个 `<w:t>` 写入并强制 `xml:space="preserve"`、其余 `<w:t>` 清空、无 `<w:t>` 时在 `</w:tc>` 前插入 `<w:p><w:r><w:t xml:space="preserve">`）——逻辑照抄；格式知识（内容表检测、逻辑列布局 [ID, ICU, #, Source, Target, Status, Comment]、表头 `Source (xx)`/`Target (xx)` 形状、段 id `<base32>:<index>` 形状、8-grid 变体 gridSpan 兼容）交叉参考第三方 OSS Supervertaler-Workbench `modules/phrase_docx_handler.py`（https://github.com/Supervertaler/Supervertaler-Workbench，仅格式知识参考，未抄码）；`PhraseDocxAdapter` 本身（段模型、status 保守映射空→untranslated/非空→draft、Status/# 列→context 设计、模板导出、detect、契约粘合）全新编写；测试 fixture 为 jszip 现场构造的合成 DOCX（无客户数据） | `packages/linguist-cat-formats/src/adapters/phrasedocx.ts` | AGPL-3.0（同作者）；Supervertaler 部分仅知识参考 |
| 2026-07-26 | PB-083 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-data/src/independent_critic.ts` 全量提取（类别/严重度词表、全部契约类型、planIndependentCritic/createIndependentCriticArtifact/parseIndependentCriticArtifact/targetedRepairScopeFromCriticArtifact——行为逐字保真含全部错误情形，风格转新仓 kebab-case/单引号/无分号；提取时新增 independentCriticCandidateHash/independentCriticProfileHash 两个哈希助手供工具运行时派生身份）与 `packages/cat-data/src/write_policy.ts` 的证据判定三符号随迁（AUDIT_ONLY_EVIDENCE_PATTERNS/isAuditOnlyEvidenceSource/isCitableEvidenceSource，write_policy 本体牵挂在旧 batch_workspace/qa_write_gate 上不迁）；schema v5 迁移、critic-artifacts repository、qaFindings.insertOpen、cat_submit_critic_review 工具、project-reviewer SKILL.md 全部全新编写（无 adapter，无第三方来源） | `packages/linguist-cat-core/src/{evidence,evidence.test,independent-critic,independent-critic.test}.ts`、`packages/linguist-cat-store/src/{schema.ts,repositories/critic-artifacts.ts,repositories/rows.ts,repositories/qa-findings.ts,critic-artifacts.nodetest.ts,qa-findings.nodetest.ts}`、`packages/linguist-cat-tools/src/{factory,types,index}.ts`、`apps/electron/src/main/lib/linguist/session-cat-tools.ts`、`resources/linguist-skills/project-reviewer/SKILL.md` | AGPL-3.0（同作者） |

| 2026-07-26 | PB-084 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` `packages/cat-data/src/batch_consistency_repair.ts`（79 行纯投影）的投影语义提取（open+一致性码过滤、按 source 分组、`advisory_finding`/`canCommit:false` 烧死契约、findingId 排序、locked 标记与「锁定段不修复」规则、定点修复→proposal 输入的转换形态）——逻辑照抄、类型对接新仓 QaFinding/CreateProposalInput（evidenceSources 与 changeType 按 LEGACY_EXTRACTION_SPEC 定夺丢弃，旧 5 码集合对齐新 7 码：确定性 4 码 ∪ CRITIC_CONSISTENCY/VOICE/TERMINOLOGY）；多数 target 建议计票、check-only 内存 runQa 合并去重、cat_run_batch_consistency 工具与全部测试全新编写（无第三方来源） | `packages/linguist-cat-core/src/{batch-consistency,batch-consistency.test}.ts`、`packages/linguist-cat-tools/src/{factory,types,index}.ts` | AGPL-3.0（同作者） |
| 2026-07-26 | PB-090 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 布局与存储语义提取（仅源码，未读 data/**）：`workspace.ts:17-19`（项目路径构造）、`runtime_migrations.ts:13-14,78-84`（.schema.json 版本 oracle 与 authority marker 字段）、`cat_core_storage.ts:46-109`（authority marker/read-cache 路径/safeCachePart/authority 激活时 legacy JSON 禁读）、`cat_core_repository.ts:35-38`（streamId 公式）、`storage-sqlite/index.ts:295-323`（streams/projections DDL，projection_json={value:entity}）、`project_manifest.ts:23-38`（manifest 字段表）、`batch_workspace.ts:38-86`（CatBatch/BatchSegment 与 status 域）、`settings_grants_trust_sqlite_cutover.ts:107-122`（agent_settings 键集与 permissionMode/thinkingLevel 合法值）、`projects_index.ts:103-121`（orphan 语义 warning/error 镜像）、`runtime_storage.ts:106-118` + 本仓 MATRIX §5（已知项目文件清单）、`legacy_task_backfill.ts:455-484`（chat.json 形状与排除清单）、`agentPermissions.ts:292-295`（"full" 即 invalid）——常量/字段表/信号语义照抄，scanner/report/CLI/测试全部新写；新仓侧 CLI 与 test loader 样板取自本仓 cat-store（loader 两文件逐字复制，同包内先例） | `packages/linguist-legacy-migration/`（整包新写） | AGPL-3.0（同作者） |
| 2026-07-26 | PB-091 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 数据模型语义提取（仅源码，未读 data/**）：`batch_workspace.ts:38-86`（BatchSegment/CatBatch 字段与 status 域）、`tm.ts:7-22`（TmEntry）、`termbase.ts:14-37,340-342,363-378,382-399`（TermbaseEntry/Override、normTerm、overrideToEntry note 公式、authorityTierForHistory 分组）、`term_history.ts:5-63,334-336`（term_history.json={rows,decisions} 与决策状态域）、`delivery_qa.ts:25-47,540-627`（DeliveryQaReport/Finding 形状、review 只持久化进 ledger 的 findingId 键语义）、`quality_decision_ledger.ts:73-89`（hash 链验证规则，只验不算）、`cat-server/src/server.ts:3478-3495`（uploads 命名 `<ts>-<safeName>` 后缀匹配依据）——字段表/公式/分组语义照抄；extract/map/import/report/CLI 与全部测试新写 | `packages/linguist-legacy-migration/src/{extract,map,import,report-import}.ts` 及 nodetest | AGPL-3.0（同作者） |
| 2026-07-27 | PB-092 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 语义提取（仅源码，未读 data/**）：`cat_core_storage.ts:13-22,117-119`（CatCoreSourceRef 形状与 `ownerKind:ownerId` id 规则）、`storage-sqlite/src/cat_core_repository.ts:181-213`（source_refs 为 kind='source' 投影、publishSourceRef 置 sha256/bytes/blobRefId）、`storage-sqlite/src/blob_store.ts:209`（CAS blob 路径 `blobs/sha256/<digest[:2]>/<digest>`）、`cat-server/src/cat_core_sqlite_cutover.ts:280-292`（cutover 对 batch.sourceFile/masterFile 发 batch 级 ref）、`cat-data/src/legacy_task_backfill.ts:148-170,378-391,466-483`（chat.json 行形状、无 sessionId 行=malformed_chat_session、agent_events.jsonl=hidden_reasoning_trace 永不导入、_pi_sessions 只留清单）——形状/规则语义照抄；disposition 推导、路由、blob-store 回退层、chat 归档与全部测试新写 | `packages/linguist-legacy-migration/src/{disposition,extract,import,sqlite-probe}.ts` 及 nodetest | AGPL-3.0（同作者） |
| 2026-07-27 | PB-093 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 语义提取（仅源码，未读 data/**）：`cat-server/src/server.ts:437-446`（ChatEvent 行形状：ts/kind 五域/text/sessionId/sessionFile/toolCallId/usage 七可选数值字段）、`cat-server/src/application/project_task_run_coordinator.ts:812,831,1239-1260`（tool 行=`tool_start <name>`/`tool_end <name> ok|error` 单行摘要，args/result 从不写入 chat.json；assistant 行带 usage；stop/error 分支写 system/error 行）——行形状/摘要语义照抄；transcript 渲染器、pi-session 字节归档、报告字段与全部测试新写（无第三方来源） | `packages/linguist-legacy-migration/src/{chat-transcript,extract,import,report-import,cli,index}.ts` 及 nodetest | AGPL-3.0（同作者） |
| 2026-07-27 | PB-095 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 语义提取（仅源码，未读 data/**）：`packages/cat-data/src/voice_exemplars.ts:11-23`（句式库字段模型：textType 分类/改前译文-建议译文对照/来源 origin 枚举→审批流 confirmed/pending/rejected）、`voice_profile.ts:7-24`（speaker 声口表：register/person/toneMarkers/taboos 字段集）、`termbase.ts:14-27`（fields 自由键值语义→术语 module/category/image_ref 三标注列）——字段语义照抄，存储从 async fs JSON/JSONL 重写为 node:sqlite 同步仓储（索引/分页/审批流状态机全新设计）；六类 schema v6、注入预算机制、IPC/UI、图片显示链全部新写（无第三方来源） | `packages/linguist-cat-store/src/{schema,blobs}.ts`、`repositories/{style-guide-rules,sentence-patterns,context-docs,tech-constraints,voice-profiles,term-entries}.ts` 及 PB-095 全量新文件 | AGPL-3.0（同作者） |
| 2026-07-27 | PB-096 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 语义提取（仅源码，未读 data/**）：`packages/cat-data/src/mechanical_text_qa.ts:58-115,150-211`（括号/引号配平栈匹配含全角族、叠词、异源同译分组归一）、`delivery_qa.ts:318-328,359-388`（email/url/alphanumeric 正则多重集、全角标点泄漏、CJK 残留 locale 感知）——检查逻辑照抄、风格适配新仓纯函数 QA 管线（契约三元组静态表/项目隔离/分页全新）；29 issue_type 契约来自用户自有《通用缺陷等级》（非仓内提取）；无第三方来源 | `packages/linguist-cat-core/src/{issue-type,glossary-policy,qa-core,qa-finding,independent-critic}.ts`、`packages/linguist-cat-store/src/{schema,qa-runner}.ts` 及 PB-096 全量改动 | AGPL-3.0（同作者） |
| 2026-07-27 | PB-097 | 旧仓 linguist-agent@`la-v2-legacy-freeze-2026-07-25` 语义提取（仅源码，未读 data/**）：`packages/cat-data/src/tag_tokens.ts:256-286`（优先级+overlap-claim 单扫描管线、项目族压内置族）、`tag_rules_core.ts:133-146`（compileTagRule ReDoS 启发式 lint：长度 240 上限/嵌套量词拒绝/禁空串匹配）——管线与 lint 语义照抄；族注册表/签名形态/多重集守恒/配平栈算法/tagProfile normalize 全部新写（旧仓逐位比较/无配平/extra 不拦/属性守恒缺口等八缺陷经用户拍板不按旧思路复制）；无第三方来源 | `packages/linguist-cat-core/src/{tag-families,tag-profile,hard-rules}.ts` 及 PB-097 全量改动 | AGPL-3.0（同作者） |
— 登记结束，后续逐条追加。
