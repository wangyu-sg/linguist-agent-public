# CAT Extraction Matrix（PB-020）

> 目的：在复制任何代码之前，识别旧 LA 仓库中哪些代码是真正的 CAT 领域资产、值得迁入新仓。
> 分析对象：`/Users/<local>/Desktop/linguist-agent`（分支 `legacy/platform`，冻结 tag `la-v2-legacy-freeze-2026-07-25`）。
> 本票只产分析文档，未复制任何代码；旧仓未做任何修改；未读取旧仓 `data/**` 下的真实客户内容（布局知识全部来自代码）。
> 依据：重建计划 §15 PB-020、§4 目标包、D-005 白名单 / D-004 黑名单。

## 图例

- **结论**：`copy` = 可基本逐字搬运（最多去掉 fs 便利函数）；`rewrite-small` = 领域内核可搬，但 IO/编排/依赖需小重写；`do-not-port` = 不迁移（理由见 §7）。
- **耦合**：对 Server/Runtime/Storage 的耦合度（none / light / heavy）+ 具体说明。
- **现有测试**：旧仓 `tests/` 下的测试文件与 assert 数（旧仓测试为顶层 assert 脚本风格，非 test-runner 用例计数，数字为 `assert.*` 调用数，粗略反映覆盖密度）。

## 1. 旧仓包清单

| 包 | src 文件数 | 性质 | 总体结论 |
|---|---|---|---|
| `packages/cat-formats` | 8 | 双语格式 Adapter（XLIFF/MXLIFF/SDLXLIFF/DOCX/CSV/TSV） | **全包可迁移**（D-005 白名单）→ `linguist-cat-formats` |
| `packages/cat-data` | 110 | CAT 领域模型/存储/QA/门 + 大量平台/运行时/评估代码混杂 | **约半数是 CAT 领域资产**，其余命中黑名单（见 §7） |
| `packages/cat-tools` | 27 | Pi `defineTool` 工具壳，handler 薄、业务在 cat-data | CAT 工具 ~20 个文件可迁 → `linguist-cat-tools` |
| `packages/storage-sqlite` | 14 | `node:sqlite` 事件投影存储（JSON blob，无领域 SQL 表） | CAT 域 2 个 repository + 迁移器知识可迁；其余平台向 |
| `packages/cat-runtime` | 40 | AgentRuntimePort/Sandbox/Compaction/ExtensionHost/Eval | **整体黑名单**（D-004） |
| `packages/cat-mcp` | 5 | MCP stdio 桥 | **整体黑名单**（旧通用 Transport） |
| `packages/cat-server` | 120 | HTTP 服务/路由/Worker/PackageCenter/Maintainer/权限 | **整体黑名单**（D-004 明示） |
| `apps/desktop` | — | Electron Renderer | 黑名单（旧 Renderer） |

测试：旧仓根 `tests/` 共 250 个 `*.test.ts`（另有 `tests/fixtures/`、`tests/helpers/`）；CAT 领域相关约 50 个文件（见 §4）。

## 2. 结论速览

- **干净可 copy（纯域、零或近零 IO）**：`cat-formats` 全部 8 文件；cat-data 的 `locale`、`tag_rules_core`、`tag_tokens`、`tag_rule_discovery`、`format_signatures`、`mechanical_text_qa`、`number_qa`、`qa_write_gate`、`write_policy`、`authority_policy`、`tm_candidate_pipeline`、`independent_critic`、`batch_consistency_repair`、`segment_context_graph`、`quality_waivers`/`delivery_waivers`、`asset_ingestion_contract`、`durable_file`。
- **rewrite-small（内核值钱、外壳要换）**：`batch_workspace`、`tm`、`termbase`、`glossary`、`term_history`、`proposals`、`quality_decision_ledger`、`delivery_qa`（含自研 ICU 解析器）、`quality_audit`、`delivery`、`delivery_readiness`、`constraint_pack`、`segment_evidence`、`project_scan`、`workbook_mapping`（打分函数）、`table_batch`、`document_assets`（纯 XML 抽取器）、`customer_returns`、`platform_ops`、`voice_*`、`project_context`/`project_health`、team 三个 gate（只搬领域检查）。
- **整体黑名单**：`cat-server`、`cat-runtime`、`cat-mcp` 全部；cat-data 的 task/workspace/runtime/eval/rc/private_eval/document-capability/grants 等平台文件（§7 逐条）。
- **最大移植债**：`workbook_mapping.ts` 内嵌 ~550 行 Python + 宿主特定 python 探测；`document_assets.ts` 依赖 `python3`/`pdftotext` 外部进程；`tm_import.ts` 同步 `execFileSync("sqlite3")`；`termbase.ts` 依赖 mdbtools CLI。这些外部进程依赖建议在重建时替换为库，而不是照搬。
- **测试缺口（风险）**：`termbase.ts`、`glossary.ts`、`term_history.ts`、`workbook_mapping.ts`、`table_batch.ts` 无专属测试（仅经 route/tool 测试间接覆盖）；`tm` 的专属测试很薄（9+4 asserts）。

## 3. 迁移矩阵

### 3.1 `cat-formats`（全部 → `linguist-cat-formats`）

共同特点：解析函数接受字符串内容（测试直接 `parseX(string)`），`node:fs/promises` 仅用于可选的文件读取便利函数；无 server/runtime 耦合。迁移时去掉 fs 便利函数（或改为注入 IO），其余可逐字搬运。

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-formats/src/phrase_mxliff.ts (642行) | Phrase MXLIFF 解析/回写；`InlineTag`/`PhraseSegment` 模型 | node:fs/promises(便利), path | 解析/写出纯 | none（fs 仅便利读取） | phrase_mxliff.test.ts（36 asserts） | linguist-cat-formats | copy |
| cat-formats/src/mqxliff.ts (414行) | memoQ MQXLIFF 解析/回写 + defects 写出 | fs(便利), crypto, path | 纯 | none | mqxliff.test.ts（56）+ 官方合成 fixture | linguist-cat-formats | copy |
| cat-formats/src/sdlxliff.ts (523行) | SDLXLIFF 解析/回写，确认级别，g-tag | fs(便利), path | 纯 | none | sdlxliff.test.ts（34）+ sdlxliff_gtag.test.ts（10） | linguist-cat-formats | copy |
| cat-formats/src/generic_xliff.ts (293行) | 通用 XLIFF 1.2/2.0 解析/回写 | fs(便利), path | 纯 | none | generic_batch_formats.test.ts（25，与 CSV 共用） | linguist-cat-formats | copy |
| cat-formats/src/table_csv.ts (149行) | CSV/TSV 双语表解析/回写 | fs(便利), path, table_columns | 纯 | none | generic_batch_formats.test.ts（同上） | linguist-cat-formats | copy |
| cat-formats/src/table_columns.ts (13行) | 表头别名（中英双语）与列识别 | 无 | 纯 | none | 经 table_csv 间接 | linguist-cat-formats | copy |
| cat-formats/src/phrase_bilingual_docx.ts (124行) | Phrase 双语 DOCX 回写 | **jszip**, fs(便利) | 半纯 | light（jszip 外部依赖，新仓需引入） | 经 delivery_export.test.ts 间接 | linguist-cat-formats | copy（保留 jszip） |
| cat-formats/src/index.ts (7行) | barrel | — | — | — | — | linguist-cat-formats | rewrite-small（重写成新 barrel） |

### 3.2 cat-data：纯域核心（→ `linguist-cat-core`）

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/locale.ts (17行) | BCP-47 locale 规范化/比较 | 无（Intl） | 纯 | none | 经各测试间接 | linguist-cat-core | copy |
| cat-data/src/tag_rules_core.ts (181行) | 项目标签规则模型 + 正则安全编译（ReDoS lint、flags 白名单）+ 上下文派生 | 无（文件头明示禁止 fs/crypto） | 纯 | none | tag_engine_unify.test.ts（21） | linguist-cat-core | copy |
| cat-data/src/tag_tokens.ts (360行) | 确定性标签分词器：14 条内置规则（xliff-paired、bbcode、placeholder-*、printf、game-color…）+ 源/目标计数校验 | tag_rules_core | 纯 | none | tag_rules_gate.test.ts（46） | linguist-cat-core | copy（注意模块级 `projectRuleRegexCache` 无界 Map） |
| cat-data/src/tag_rules.ts (188行) | tag_rules.json 读写 + 规则生命周期（candidate→active/disabled） | workspace, crypto | 逻辑纯、IO 烤死 | light（workspace fs） | 同上 + tag_rules_route/route 测试 | core（类型）+ store（IO） | rewrite-small |
| cat-data/src/tag_rule_discovery.ts (645行) | 从双语证据发现项目标签规则：确定性 bootstrap + LLM 提案 + 严格证据校验（LLM 以注入回调解耦） | tag_rules, crypto | 纯 | none（模型注入） | tag_rules_discovery.test.ts（58） | linguist-cat-core | copy |
| cat-data/src/format_signatures.ts (225行) | 格式签名提取/比对（native/project/rich-text 标签、占位符、**ICU 分支 arity**、换行），写入门控依据 | cat-formats, tag_tokens, tag_rules_core | 纯 | none | 经 tag_rules_gate / delivery_qa / icu_branch_arity_eval（15） | linguist-cat-core | copy（ICU 逻辑的真正所在地，必须与 delivery_qa 的 `icuSignatures` 一并纳入） |
| cat-data/src/mechanical_text_qa.ts (213行) | Xbench 式机械 QA：10 检查码（源=目标、一致性分组、UNPAIRED_SYMBOL/QUOTE、REPEATED_WORD、DOUBLE_SPACE…） | 无 | 纯 | none | 经 delivery_qa/quality_audit 间接 | linguist-cat-core | copy |
| cat-data/src/number_qa.ts (34行) | locale 容忍的数字多重集签名（千分位/小数逗号/月份/中文数字归一） | 无 | 纯 | none | 经 delivery_qa 间接 | linguist-cat-core | copy |
| cat-data/src/spelling_qa.ts (169行) | en-US 拼写 QA（可见文本提取管线 + 游戏词表 + coverage 元数据） | **nspell, word-list, dictionary-en**, locale | 检查纯；词典同步 fs 加载 | light（npm 词典包，仅英文） | 经 delivery_qa 间接 | linguist-cat-core | rewrite-small（词典改注入式异步加载；依赖需在新仓引入） |
| cat-data/src/qa_write_gate.ts (47行) | 单段写入前 QA 签名硬门：8 个 blocker code（NATIVE/PROJECT_TAG、RICH_TEXT、PLACEHOLDER、ICU_BRANCH_ARITY、NEWLINE…） | format_signatures, tag_rules(类型) | 纯 | none | qa_write_gate.test.ts（7） | linguist-cat-core | copy |
| cat-data/src/write_policy.ts (172行) | 段写入策略门：证据要求（term 类变更必须可引用证据，**工具 trace 不算证据**）+ tag 签名一致 | cat-formats, format_signatures, qa_write_gate, tag_rules | 纯 | light（跨包类型） | gate_evidence.test.ts（7） | linguist-cat-core | copy |
| cat-data/src/authority_policy.ts (53行) | 术语权威层级裁决（phrase_final_stage > style_guide > exact_compound_term > customer_override > local_proposal > base_term） | 无 | 纯 | none | authority_policy.test.ts | linguist-cat-core | copy |
| cat-data/src/tm_candidate_pipeline.ts (325行) | TM-first 候选路由：exact/重复段/高 fuzzy → skip-generation/diff-repair/full-generation；`authority:"candidate_only"`,`canCommit:false` 纪律 | tm/proposals(类型), crypto | 纯 | none | tm_candidate_pipeline.test.ts（28） | linguist-cat-core | copy |
| cat-data/src/independent_critic.ts (222行) | 独立批评者 advisory finding 工件：版本化、hash 链自检、强制与候选生产者不同执行体 | write_policy, crypto | 纯 | none | independent_critic.test.ts（17） | linguist-cat-core | copy（canonicalize/hash 脚手架与他处重复，重建抽共享 util） |
| cat-data/src/batch_consistency_repair.ts (79行) | QA 一致性 finding → advisory repair pass → proposal 输入（含 locked 段拦截） | proposals/quality_audit(类型) | 纯 | none | batch_consistency_repair.test.ts（8） | linguist-cat-core | copy |
| cat-data/src/segment_context_graph.ts (405行) | 段级上下文图（角色/任务/场景/术语节点+边）、provenance 新鲜度判定、advisory 检索；hash 绑定源快照 | crypto | 纯（注释明示无 fs/db/model） | none | segment_context_graph.test.ts（23） | linguist-cat-core | copy |
| cat-data/src/quality_waivers.ts (73行) + delivery_waivers.ts (74行) | 质量 finding 豁免（ignore_with_reason）/ 交付风险豁免（accepted_risk）——ledger 上的薄视图 | quality_decision_ledger | 纯投影 | light | quality_waiver_tool.test.ts（21） | linguist-cat-core | copy（两文件近乎复制粘贴，重建合并为一个 waiver 模块） |
| cat-data/src/asset_ingestion_contract.ts (166行) | 资产解析/映射契约类型层（AuthorityTier、AssetColumnMapping、preview/result 类型） | workbook_*(类型) | 纯（零 node 导入） | none | 经 asset_* 间接 | linguist-cat-core | copy |
| cat-data/src/durable_file.ts (72行) | 崩溃安全文件写：tmp+fsync+rename+父目录 fsync、追加写、6 个故障注入点 | node:fs | 基础设施（本职即 IO） | none（被多方使用） | durable_file.test.ts | linguist-cat-store | copy |

### 3.3 cat-data：Segment/Asset/Batch 模型与资产

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/batch_workspace.ts (733行) | **核心模型** `BatchSegment`(L38-69)/`CatBatch`(L71-86)/`SegmentRevisionConflictError`(L125) + 批次导入/句段写回/重复段传播 | fs, cat_core_storage, cat-formats, write_policy, tag_rules, tm | 模型+重复分组纯；import/update 带 fs+多副作用 | heavy（双存储后端分叉、模块级全局 `segmentMutationQueues` Map L137、确认时写 TM/source_context） | batch_workspace.test.ts（143） | core（模型+纯逻辑）+ store（持久化/编排） | rewrite-small |
| cat-data/src/project_manifest.ts (248行) | `ProjectManifest`(L23-38)/`AssetRoleDecision` 模型 + project.json 读写/刷新 diff | fs, workspace, project_scan, cat_core_storage | buildManifest/diff 纯；API 走 fs | heavy（双存储后端） | projects_index/import_upload 间接 | core（类型）+ store（IO）+ legacy-migration（布局） | rewrite-small |
| cat-data/src/project_scan.ts (557行) | 项目文件夹扫描、资产角色启发式分类、Phrase master XLIFF 配对、导入计划 | fs, path | 分类/配对纯；walk 触 fs | light（仅 fs 扫描） | project_context/import_upload 间接 | core（classifyFile/配对算法）+ store（walk） | rewrite-small |
| cat-data/src/table_batch.ts (181行) | XLSX 双语批次读取与译文回写（zip 内 sheet XML cell 改写） | **jszip**, fs, cat-formats | cellRef/XML 编解码纯 | light（jszip；正则改 XML 脆弱） | 无专属测试 | linguist-cat-formats | rewrite-small |
| cat-data/src/source_context.ts (73行) | 句段 source-context 行索引（坐标/masterId/resname 溯源） | workspace, batch_workspace | rowsFromBatch 纯 | light | 经 batch_workspace 间接 | core（类型）+ store（IO） | rewrite-small |
| cat-data/src/assets.ts (91行) | 项目资产文本读取 + 跨资产 grep（realpath 防逃逸） | fs, project_manifest, document_assets | 薄 IO 层 | light | asset_routes/asset_api 间接 | store | rewrite-small |
| cat-data/src/asset_blocks.ts (340行) | 资产→检索块索引 + 词法(bigram-Dice)/向量/混合(RRF) 检索 | fs, document_assets, asset_vectors, local_embeddings | scoreText/RRF 纯 | heavy（向量后端三选一纠缠） | asset_rag_*/asset_vectors 测试 | core（模型+评分）+ store（索引 IO） | rewrite-small |
| cat-data/src/asset_mapping_profiles.ts (53行) | 用户确认列映射 profile 持久化 | workspace, crypto | 薄持久层 | light | 经 workbook_tools 间接 | store | rewrite-small |
| cat-data/src/asset_parsing.ts (431行) | 资产解析编排 + 确定性/LLM 列映射建议（LLM 注入回调，设计干净） | workbook_mapping, project_manifest | 校验/prompt 纯 | heavy（间接 python 子进程） | 经 workbook_tools 间接 | core（校验+prompt）+ store（编排）；mineru stub 弃 | rewrite-small |
| cat-data/src/asset_typed_index.ts (561行) | workbook→类型化行索引(term/query/issue/style/reference)，候选确认写 TB | workbook_mapping, termbase, term_history, asset_blocks, fs | 分类/校验纯 | heavy（写四个存储；中英关键词表三处平行重复） | 经 workbook_tools 间接 | core（类型+分类+证据锚定校验）+ store | rewrite-small |
| cat-data/src/asset_vectors.ts (391行) | 资产向量索引（local E5 / legacy hash / TDAI 远端三后端），余弦检索 | local_embeddings, tdai_embedding_bridge, fs | cosine/校验纯 | heavy（embedding 后端+网络分支） | asset_vectors.test.ts | core（记录类型+cosine）+ store（索引）；**砍掉 legacy_hash/TDAI 分支** | rewrite-small |
| cat-data/src/document_assets.ts (423行) | docx/pptx/xlsx/pdf/图片→文本块抽取 | jszip, **child_process(python3/pdftotext)**, fs | `extractDocxBlocksFromDocumentXml`/`extractPptxBlocksFromSlideXml` 纯 | heavy（外部进程硬依赖） | document_* 测试（平台向多） | formats（纯 XML 抽取器 copy）；python/pdftotext 层**替换不搬** | rewrite-small |
| cat-data/src/workbook_asset_plan.ts (477行) | workbook 资产导入计划/执行：sheet 角色分类、术语/参考块分派落盘 | workbook_mapping, termbase, term_history, asset_blocks | termChangeDiagnostics 纯 | heavy（编排写 4 个存储） | 经 workbook_tools 间接 | core（类型+诊断）+ store（编排） | rewrite-small |
| cat-data/src/workbook_mapping.ts (1259行) | workbook(xlsx/csv/tsv/md) 读取、预览、列映射确定性打分、按映射抽取 | **child_process python3（内嵌 ~550 行 Python L219-768）**, fs | 打分函数组(L844-1039)/delimited/md 解析纯 | heavy（宿主特定 python 探测 L139-147：env+`~/.cache/codex-runtimes`） | 无专属测试 | core（类型+打分+delimited 解析 copy）；XLSX python 层**替换**（最大移植债） | rewrite-small |
| cat-data/src/demo.ts (44行) | demo 工作区种子 | tm, workspace | — | — | — | - | do-not-port（默认写 `<cwd>/tmp/demo-workspace`，无业务价值） |

### 3.4 cat-data：TM / TB / Glossary

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/tm.ts (504行) | TM 存储+查询（exact/contains/fuzzy/concordance）、reviewed 提升；`TmEntry`(L7)/`TmMatch`(L24)/`effectiveTmAuthority`(L94)/`scoreSource`(L147，CJK bigram Dice + token Jaccard) | fs, workspace, cat_core_storage, locale | 评分/authority 纯 | heavy（注册表注入+legacy JSON 双轨；**审计 `tm_audit.jsonl` append 绕过注入接口**；全量读改写 O(n)；进程内文件锁） | tm_fuzzy_retrieval.test.ts（9）、tm_reviewed_writeback.test.ts（4）——**薄** | core（评分+authority）+ store（单一后端存储） | rewrite-small |
| cat-data/src/tm_import.ts (258行) | TMX / SDLTM / 表格 TM 导入；`parseTmxRows`(L71) | **child_process（同步 execFileSync sqlite3 CLI）**, fs, workbook_mapping | TMX 解析纯 | heavy（外部 CLI+256MB buffer） | 经 tm 工具测试间接 | core/formats（TMX 解析）+ store（SDLTM 改 node:sqlite 库） | rewrite-small |
| cat-data/src/termbase.ts (720行) | TB 存储：SDLTB/TBX/表格导入、override、冲突审计、preferred 解析；`TermbaseEntry`(L14)/`auditTermbaseConflicts`(L402)/`resolvePreferredTermbaseEntries`(L442) | **child_process（mdbtools CLI）**, fs, cat_core_storage, term_history, workflow_artifacts | 解析/冲突/preferred 纯 | heavy（外部 CLI；`readPreferredTermbaseEntries` 跨 5 存储聚合、层级倒置） | **无专属测试**（qa_terminology 25 间接） | core（解析+冲突+preferred）+ store；mdbtools 依赖需替换/资格化 | rewrite-small |
| cat-data/src/term_history.ts (352行) | 术语变更日志 Excel 行解析→current/deprecated/conflict/pending/deleted 决策索引（中英双语列名启发式） | workspace, workbook_mapping(类型), authority_policy | `resolveTermHistoryDecisions`(L213) 状态机纯 | light（不走注入接口，永远 legacy 文件） | **无专属测试** | core（决策状态机）+ store | rewrite-small |
| cat-data/src/glossary.ts (217行) | 轻量 glossary（md/csv/tsv 导入、lookup、"冲突即不 binding"preferred 语义） | fs, project_manifest, workspace | 解析/preferred 纯 | light（fs 烤死无注入） | **无专属测试**（evidence_tools 36 间接） | core（preferred 语义；**建议与 TB 合并为一个术语抽象**）+ store | rewrite-small |
| cat-data/src/memory-audit.ts (37行) | 已退役 TDAI memory 的历史审计只读摘要（墓碑模块，无 append API） | workspace | 薄读取 | none | memory_tools.test.ts（10） | -（如需读旧数据，知识进 legacy-migration） | do-not-port |

### 3.5 cat-data：Proposal / Review / 写入策略

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/proposals.ts (438行) | 段级提案集创建/审批/应用/驳回/markdown 报告；`SegmentProposalSet`(L44，含 supersedes 链)、apply 逐条 try/catch 记 skipped | fs, workspace, write_policy, batch_workspace, cat_governance_storage | markdown 渲染纯 | heavy（三层读路径：persistence→read-cache→legacy；legacy 模式 apply 非事务） | proposals.test.ts（48） | core（类型+状态机+渲染）+ store（事务化 apply） | rewrite-small |
| cat-data/src/segment_evidence.ts (383行) | 段级证据快照聚合：TM+TB+glossary 并行查询→UI 卡片；authority rank 排序 | batch_workspace, tm, termbase, glossary, fs | 卡片/排序纯 | heavy（进程内 LRU 缓存假设单进程；O(段×TM) 全表查） | segment_evidence.test.ts（46） | core（快照类型+排序）+ store/tools（聚合） | rewrite-small |
| cat-data/src/quality_decision_ledger.ts (313行) | 质量/交付决策 append-only **hash 链**台账：logicalEventId 幂等、全量验链、`authorizeQualityLedgerExport`(L240) 导出授权门 | fs, durable_file, cat_governance_storage | hash/汇总纯 | heavy（每次 append 前全量读+验链 O(n)；进程内串行队列） | quality_decision_ledger.test.ts（29）+ _concurrency 测试 | core（链逻辑+授权规则）+ store（追加 IO） | rewrite-small |
| cat-data/src/quality_checklist.ts (198行) | 项目级自定义 QA checklist（regex 规则表 + mechanicalOptions） | fs, workspace, cat_governance_storage | compile/validate 纯 | light（regex lint 与 tag_rules_core 重复实现） | 经 delivery_qa 间接 | core（编译+执行）+ store | rewrite-small（去重 regex lint） |
| cat-data/src/agent_decisions.ts (64行) | 项目级已巩固指导决策（recall context，**非可引用证据**） | workspace | format 纯 | light（read 吞错返回 []，与损坏保护哲学相悖） | 经 decision_tools 间接 | store（+core 类型） | rewrite-small（修吞错） |
| cat-data/src/readiness_decisions.ts (76行) | 上线就绪警告的接受/重开决策日志 | workspace, durable_file | match 纯 | light（用户 pattern 直接 `new RegExp`——ReDoS 面） | readiness_decisions.test.ts | - | do-not-port（发布管理工具，非 CAT 交付域；且与 waiver 体系重叠） |

### 3.6 cat-data：QA 引擎与 Delivery Gate

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/delivery_qa.ts (627行) | 交付前段级 QA 主引擎：missing_target、residual_cjk、tag/placeholder/newline 签名、数字/email/url 多重集、**自研 ICU plural/select 签名解析器 `icuSignatures`(L161-199)**、termbase(blocker)/glossary(warning) 命中、review 决策模型 | batch_workspace, glossary, termbase, tm, quality_checklist, ledger, format_signatures, tag_rules, mechanical/number/spelling_qa | `runDeliveryQaOnSegments`/`reviewDeliveryQaReport` 纯 | heavy（scope 编排读 6 存储；zh→en 硬编码；与 quality_audit 大量重复实现） | delivery_qa.test.ts（94）、icu_branch_arity_eval.test.ts（15）、qa_terminology.test.ts（25） | core（纯引擎+ICU 解析器+review 模型）+ store（编排） | rewrite-small |
| cat-data/src/quality_audit.ts (855行) | 批次质量审计聚合：术语/TM 一致性、机械/签名检查、翻译腔 4 规则（residual_cjk_script、cjk_punctuation、nested_of_chain、mechanical_light_verb）、voice 检查、waiver 校验闭环 | 8 个存储 + 全部 QA 模块 | `findQualityIssues`/`findMechanicalQualityIssues`/`findExpressiveIssues` 纯 | heavy（855 行聚合器；与 delivery_qa 双实现漂移风险） | quality_audit.test.ts（36）、expressive_audit.test.ts（31） | core（find\* 纯函数）+ store（编排）；**与 delivery_qa 合并重复逻辑** | rewrite-small |
| cat-data/src/delivery.ts (1056行) | 交付检查 + 7 格式导出 + 导出审计 + **导出后 round-trip 验证（重解析序列化字节再比签名，失败不写盘）** + ledger 授权门；blocker 集 UNTRANSLATED_EDITABLE/LOCKED_TARGET_CHANGED/UNRESOLVED_PLACEHOLDER/签名 mismatch 等 | cat-formats 全部, batch_workspace, proposals, qa_write_gate, ledger, fs | blocker/waiver 拆分逻辑半纯、与 fs 交织 | heavy（1056 行 gate+导出+审计三合一；force=true 逃生门遍布） | delivery_export.test.ts（29）、delivery_gate_failure.test.ts（3）、delivery_readiness.test.ts（43） | core（blocker/waiver/round-trip 逻辑）+ store（导出 IO）；建议拆分 | rewrite-small |
| cat-data/src/delivery_readiness.ts (140行) | 只读 readiness 聚合：deriveStatus 优先级(fail>缺失>warn>proposed>pass) + nextActions | proposals, batch_workspace, delivery, quality_audit, fs | deriveStatus/nextActions 纯 | light | delivery_readiness.test.ts（43） | core（纯逻辑）+ store（聚合） | rewrite-small |
| cat-data/src/customer_returns.ts (160行) | 客户返稿 XLSX 学习：diff→reviewed TM(quality=100) + 历史报告；`findCustomerReturnChanges` 纯 | batch_workspace, table_batch, tm, fs | diff 纯 | light（信任假设强：无人工复核即最高权威） | customer_returns.test.ts（7）——薄 | core（diff）+ store（学习管道） | rewrite-small |
| cat-data/src/platform_ops.ts (570行) | Phrase 平台回填状态机(opened→…→readback_verified/blocked) + Phrase QA 抓取/忽略；平台 IO 经 `PhrasePlatformAdapter` 接口注入（好设计） | batch_workspace, qa_write_gate, tag_rules, workflow_artifacts | 状态机/分类半纯 | light（adapter 注入；风险关键字中英混杂匹配脆） | platform_ops.test.ts（20） | core（状态机+分类）+ tools（runner） | rewrite-small |
| cat-data/src/team_delivery_gate.ts (286行) | Team 交付门：delivery QA+readiness 去重合并、ledger、导出授权；`DELIVERY_QA_QUALITY_MIRRORS` 镜像去重表 | batch_workspace, delivery_qa, ledger, **task_workspace/workflow**（平台） | 去重/id 纯 | heavy（深绑 task/workflow 平台子系统） | team_delivery_gate.test.ts（46） | core（领域检查+镜像表）；task 编排部分不搬 | rewrite-small |
| cat-data/src/team_engineering_gate.ts (265行) | 本地化工程门：scope/input/delivery/constraints 四类检查码 + formatRules 文本 | batch_workspace, constraint_pack, delivery, task_workspace | 检查码逻辑半纯 | heavy（多处 `catch{}` 吞错转 blocker；绑 task 平台） | team_engineering_gate.test.ts（26） | core（检查码集） | rewrite-small |
| cat-data/src/team_quality_decision_ledger.ts (150行) | Team findings/decisions → 质量台账投影：scope 冲突检测、logicalEventId 幂等 | quality_decision_ledger, delivery_qa(类型), team_workflow(类型) | 半纯 | light | team_quality_decision_ledger.test.ts（18） | core（投影规则） | rewrite-small |
| cat-data/src/constraint_pack.ts (604行) | 段级生成约束包：TB/glossary/TM/重复组/tag/数字/voice → blocker/warning/advisory；`SegmentLookupInputs` **依赖注入样板**(L76) | 6 个存储 + cat-formats + tag_rules + voice_profile | `buildSegmentConstraintPack`（注入版）纯 | heavy（公开入口直接读 6 存储；tmAuthorityRank 与 segment_evidence 重复） | constraint_pack.test.ts（63） | core（约束语义+注入接口）+ store（快照入口） | rewrite-small |
| cat-data/src/cat_core_storage.ts (119行) + cat_governance_storage.ts (115行) | 持久化权威边界：注入接口 + **进程级全局 Map 注册表** + legacy JSON 回退 + read-cache | fs | — | heavy（隐式全局状态，测试需 reset 钩子） | sqlite_* 测试 | -（接口形状作为 linguist-cat-store 设计输入；代码不搬） | do-not-port（全局注册表模式废弃，构造参数注入替代） |

### 3.7 cat-data：Voice / 项目上下文（CAT 表达层，游戏本地化特化）

| 当前路径 | 领域职责 | 依赖 | 纯函数? | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|---|---|
| cat-data/src/voice_profile.ts (186行) | 批次 voice profile（文本类型/说话人/语域/禁忌语）draft→confirmed 状态机 | batch_workspace, workspace | roster/merge 纯 | light（`VoiceTextType` 游戏特化：dialogue/ui/skill_desc/lore，重建需泛化） | voice_route.test.ts（52）、voice_tools.test.ts（12） | core（类型+状态机）+ store | rewrite-small |
| cat-data/src/voice_exemplars.ts (200行) | 风格例句库 + reviewed TM 晋升门槛（quality=100+reviewed+语言对） | batch_workspace, tm, workspace | 过滤/拒绝规则纯 | light（delete 全量重写 JSONL 无锁） | 同上 | core（晋升规则）+ store | rewrite-small |
| cat-data/src/project_context.ts (381行) | 项目上下文包聚合（manifest+健康+batch 概览→模型/UX 上下文） | batch_workspace, project_health, project_manifest, fs | 格式化半纯 | light | project_context.test.ts（56） | core（打包逻辑）+ store | rewrite-small |
| cat-data/src/project_health.ts (238行) | 项目健康指标聚合 | batch_workspace, delivery, manifest, scan, termbase, tm, fs | 指标计算半纯 | light | project_health.test.ts（13） | core（指标）+ store | rewrite-small |

### 3.8 `cat-tools`（→ `linguist-cat-tools`）

框架说明：全部用 `@earendil-works/pi-coding-agent` 的 `defineTool`（即 Pi ToolDefinition 本体），handler 普遍很薄（schema 校验→调 cat-data→格式化 markdown）。**真正的业务逻辑在 cat-data**——只搬 cat-tools 拿到的是外壳。最大接缝：`process.cwd()` 被当作 project root 到处传（~15 文件），重建时需改为显式 project 上下文注入。

| 当前路径 | 工具/职责 | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|
| cat-tools/src/batch_workspace.ts | `batch_import_{phrase,sdlxliff,mqxliff,xliff,csv,xlsx}`、`batch_read`、`segment_set_target`、`batch_set_targets` | light（壳） | batch_workspace.test.ts | linguist-cat-tools | rewrite-small |
| cat-tools/src/delivery_tools.ts | `delivery_check`、`delivery_readiness`、`delivery_accept_risk`、`export_*` ×7 | light（`force` 绕门仅靠 prompt 约束） | delivery_* | linguist-cat-tools | rewrite-small |
| cat-tools/src/delivery_qa_tools.ts | `delivery_qa`（分页在壳内） | light | delivery_qa.test.ts | linguist-cat-tools | rewrite-small |
| cat-tools/src/quality_tools.ts | `quality_audit`、`quality_waiver`、`expressive_audit`、`constraint_pack` | light（EXPRESSIVE_CODES 硬编码在壳内） | quality_* | linguist-cat-tools | rewrite-small |
| cat-tools/src/proposal_tools.ts | `proposal_create/read/apply/report` | light | proposals.test.ts | linguist-cat-tools | rewrite-small |
| cat-tools/src/evidence_pack_tools.ts | `evidence_pack` | light | segment_evidence/gate_evidence | linguist-cat-tools | rewrite-small |
| cat-tools/src/evidence_tools.ts | `glossary_import_table`、`glossary_lookup`、`asset_grep`、`asset_read` | light | evidence_tools.test.ts（36） | linguist-cat-tools | rewrite-small |
| cat-tools/src/tm_lookup.ts | `tm_import_table/tmx/sdltm`、`tm_lookup`、`tm_concordance` | light | tm_* | linguist-cat-tools | rewrite-small |
| cat-tools/src/termbase_tools.ts | `termbase_import_{table,tbx,sdltb}`、`termbase_override`、`termbase_conflict_audit`、`termbase_lookup` | light（SDLTB 依赖 mdbtools，fail-loud） | qa_terminology | linguist-cat-tools | rewrite-small |
| cat-tools/src/project_onboard.ts | `project_onboard`、`project_read`、`project_refresh`、`project_health`、`project_context`（~200 行 markdown 格式化在壳内） | light | project_* | linguist-cat-tools | rewrite-small（格式化下沉 core） |
| cat-tools/src/workbook_tools.ts | `workbook_preview`、`workbook_mapping_candidates`、`workbook_asset_plan/import`、`asset_parse_preview`、`asset_mapping_suggest/profile_save` | light | 经 workbook 链路 | linguist-cat-tools | rewrite-small |
| cat-tools/src/customer_return_tools.ts | `customer_return_learn` | light | customer_returns | linguist-cat-tools | rewrite-small |
| cat-tools/src/decision_tools.ts | `record_decision` | light（ID 用 Date.now()+random） | — | linguist-cat-tools | rewrite-small |
| cat-tools/src/voice_tools.ts | `voice_profile_build/confirm`、`exemplar_lookup/add`；**壳内含真领域逻辑**（`draftEntriesFromRoster`/`defaultRegister` ~60 行） | light | voice_tools.test.ts（12） | linguist-cat-tools（壳内逻辑别丢） | rewrite-small |
| cat-tools/src/platform_ops_tools.ts | `platform_backfill_run`、`platform_phrase_qa_run`（输入为上游 Browser 工具观察值的跨工具协议） | light | platform_ops.test.ts | linguist-cat-tools（协议文档随行） | rewrite-small |
| cat-tools/src/asset_block_tools.ts | `asset_blocks_build`、`asset_block_search` | **heavy（硬编码 TDAI 外部网关 URL + 网络探测）** | asset_* | linguist-cat-tools（砍 TDAI 分支） | rewrite-small |
| cat-tools/src/tool_catalog.ts (833行) + tool_policy.ts | `CAT_TOOL_METADATA`（access/mutatesProject/writesSegments/requiresEvidenceFor）+ 策略装饰器（evidence 门） | light（catalog 自承 advisory，与 tool_policy 两套真相源可能漂移） | tool_catalog/tool_capability_manifest 测试 | linguist-cat-tools（成对迁移并合一真相源） | rewrite-small |
| cat-tools/src/team_evidence_tools.ts | Team 子进程只读证据面（scope 注入+脱敏） | **heavy（绑旧 server 编排：server-authored scope、cwd realpath 校验、`__team_scope__` hack）** | team_evidence_* | -（scope 机制属旧 server；只读工具来自兄弟模块） | do-not-port（scope 机制），概念参考 |
| cat-tools/src/assistant-library-tools.ts / assistant-memory-tools.ts | Library 检索 / 确认制长期记忆 | light | assistant_* 测试 | -（v1 是否保留 Library/Memory 概念未定） | do-not-port（v1 决策待定） |
| cat-tools/src/memory-tools.ts | TDAI 记忆运行时隔离开墓碑 stub | — | memory_tools.test.ts | - | do-not-port |
| cat-tools/src/web_bridge_tools.ts | `web_fetch`/`web_search`（Tavily、Keychain、网络） | heavy（网络+密钥为主体） | web_tool_parity | -（命中"旧通用 Transport/权限平台"黑名单；仅 evidence 格式化可参考） | do-not-port |
| cat-tools/src/present-answer-tool.ts / update-plan-tool.ts | host 呈现 artifact | light（非 CAT） | agent_present/plan 测试 | - | do-not-port（host/UI 层） |
| cat-tools/src/document-capability-tools.ts | standalone 文档能力（OCR/Office/MinerU） | **heavy（深绑旧 server Run/Artifact/file-grant 体系）** | document_capability_tools 测试 | - | do-not-port（assistant 文档能力，非 CAT 域） |
| cat-tools/src/index.ts | 工具组装入口（~60 工具的权威清单） | plumbing | — | linguist-cat-tools（重写；清单作 checklist） | rewrite-small |

### 3.9 `storage-sqlite`（CAT 相关部分）

整包使用 `node:sqlite`（`DatabaseSync`，Node ≥22.16，无 better-sqlite3），**单一通用事件投影存储**：所有领域数据以 JSON blob 存于通用表（`streams`/`events`/`projections`/`commands`/`mapping_contracts`），无领域 SQL 表；schema v2（`PRAGMA user_version`），WAL + `synchronous=FULL` + STRICT + `json_valid` CHECK。可迁移的是**流 ID 约定 + 投影 JSON 形状 + read-cache 布局**知识，而非 DDL。

| 当前路径 | 职责 | 耦合 | 现有测试 | 迁入目标 | 结论 |
|---|---|---|---|---|---|
| storage-sqlite/src/cat_core_repository.ts | CAT 核心 SQLite 持久化：batches/TM/termbase/manifest/source 字节（CAS blob）；流 `cat-core-{batch,tm,termbase,manifest,source}-<sha>`；写 read-cache JSON | node:sqlite | sqlite_cat_core.test.ts（22） | linguist-cat-store（schema/投影形状知识） | rewrite-small |
| storage-sqlite/src/cat_governance_repository.ts | CAT 治理持久化：质量台账（hash 链+logicalEventId 幂等）、checklist、提案集、导出审计 | node:sqlite | sqlite_cat_governance.test.ts（15） | linguist-cat-store（同上） | rewrite-small |
| storage-sqlite/src/task_mapping_contract.ts | LA-085 冻结字段级映射契约：5 个 legacy 来源每个实体的精确字段表、排序/revision 规则、blob 边界、excludedRuntimeFields | 纯数据 | sqlite_storage_task_mapping_contract 测试 | linguist-legacy-migration | **copy（旧布局权威字典）** |
| storage-sqlite/src/legacy_task_importer.ts | 旧 per-task 目录（`snapshot.json`+`events.jsonl`）导入：严格校验、事件回放、投影一致性、备份清单 | node:sqlite | sqlite_storage_task_importer.test.ts（34） | linguist-legacy-migration（校验规则/流程知识） | rewrite-small |
| storage-sqlite/src/legacy_task_side_importer.ts | per-task 侧状态（message_queue/resource-profile）+ **项目质量台账 hash 链验算（只验不算）** | node:sqlite | sqlite_storage_task_side_importer 测试 | linguist-legacy-migration（台账链验证知识=CAt 治理数据） | rewrite-small |
| storage-sqlite/src/sqlite_audit_export.ts | 整库只读审计导出/验证（`{readOnly:true}` 打开、quick_check、hash 链 JSONL） | node:sqlite | sqlite_audit_export 测试 | linguist-legacy-migration（**只读访问模式样板**） | rewrite-small |
| storage-sqlite/src/blob_store.ts | 文件系统 CAS 存储：`blobs/sha256/<2hex>/<digest>`、`refs/sha256/...`、0444、乐观 revision | fs | sqlite_blob_store 测试 | linguist-cat-store / legacy-migration（布局知识） | rewrite-small |
| storage-sqlite/src/index.ts | `SqliteEventProjectionStore` 通用事件投影存储 + 备份/恢复 + v1→v2 迁移 | node:sqlite | sqlite_storage 等 | -（作为 store 设计参考，不按原样搬） | rewrite-small（参考） |
| storage-sqlite/src/task_aggregate_backend.ts、task_workspace_repository.ts、settings_grants_trust_repository.ts、assistant_memory_repository.ts、assistant_library_repository.ts、workflow_eval_repository.ts | 任务聚合/设置授权信任/助手记忆/文库/工作流评估持久化 | node:sqlite | 各自 sqlite_* 测试 | -（平台向；assistant_* 是否保留待定；legacy 布局知识已录入 §5） | do-not-port |

### 3.10 `cat-runtime` / `cat-mcp` / `cat-server`（整体黑名单）

- **cat-runtime（40 文件）**：`agentRuntimePort.ts`（旧 AgentRuntimePort）、`extensionHost.ts`/`extension_host_entry.ts`（旧 Extension Host）、`createCatAgentSession.ts`/`createGeneralAgentSession.ts`/`createMaintainerAgentSession.ts`（会话组装，绑 Pi 内部）、`catSandbox.ts`/`generalSandbox.ts`（@anthropic-ai/sandbox-runtime）、`catSafetyKernel.ts`、`catCompaction.ts`/`runtimeCompaction.ts`、`runtimeEvent*.ts`、`quality_scorecard.ts`（human/llm judge 评估，属旧 Private Eval）、`catStreamRules.ts`、`catSelfHealing.ts`、`documentRouter.ts`、`harness_eval_contract.ts`、`teamEvidenceChildRuntime.ts` 等——**全部 do-not-port**（D-004：旧 AgentRuntimePort/Extension Host/Maintainer/Private Eval）。其中 CAT 语义（如 stream 规则、compaction 上下文形状）可作为新运行时设计参考，但不搬代码。
- **cat-mcp（5 文件）**：MCP stdio client/bridge/policy/config——**全部 do-not-port**（旧通用 Transport）。`policy.ts` 中 `catWriteEligible:false`、`mutationRisk`、`evidenceBehavior`、allowlist 状态机等 CAT 证据治理概念值得作为设计输入，代码不搬。
- **cat-server（120 文件）**：整体黑名单（D-004 明示）。唯二例外知识（非代码）：`*_sqlite_cutover.ts` 系列是"旧 JSON 文件→SQLite 域"最完整的映射地图（`inventoryLegacyTaskLocators`/`verifyCutoverStore` 枚举每域的流与文件），供 `linguist-legacy-migration` 参考；`tag_token_contract.ts` 的浏览器侧标签契约概念已体现在 tag_tokens 迁移中。

## 4. 领域测试与 synthetic fixtures 清单

### 4.1 可随迁移的领域测试（旧仓 `tests/`，顶层 assert 脚本风格）

格式类：`mqxliff.test.ts`(56 asserts)、`phrase_mxliff.test.ts`(36)、`sdlxliff.test.ts`(34)、`sdlxliff_gtag.test.ts`(10)、`generic_batch_formats.test.ts`(25)。
模型/批次：`batch_workspace.test.ts`(143)、`source_context`（经 batch_workspace 间接）。
TM/TB：`tm_fuzzy_retrieval.test.ts`(9)、`tm_reviewed_writeback.test.ts`(4)、`tm_candidate_pipeline.test.ts`(28)、`qa_terminology.test.ts`(25)。
Proposal/Evidence：`proposals.test.ts`(48)、`segment_evidence.test.ts`(46)、`gate_evidence.test.ts`(7)、`independent_critic.test.ts`(17)、`batch_consistency_repair.test.ts`(8)、`segment_context_graph.test.ts`(23)。
Tag/QA：`tag_engine_unify.test.ts`(21)、`tag_rules_gate.test.ts`(46)、`tag_rules_discovery.test.ts`(58)、`qa_write_gate.test.ts`(7)、`icu_branch_arity_eval.test.ts`(15)、`delivery_qa.test.ts`(94)、`quality_audit.test.ts`(36)、`expressive_audit.test.ts`(31)、`quality_decision_ledger.test.ts`(29) + `_concurrency`、`quality_waiver_tool.test.ts`(21)。
Delivery：`delivery_export.test.ts`(29)、`delivery_gate_failure.test.ts`(3)、`delivery_readiness.test.ts`(43)、`customer_returns.test.ts`(7)。
约束/平台操作：`constraint_pack.test.ts`(63)、`platform_ops.test.ts`(20)、`team_delivery_gate.test.ts`(46)、`team_engineering_gate.test.ts`(26)、`team_quality_decision_ledger.test.ts`(18)。
Voice/项目：`voice_tools.test.ts`(12)、`voice_route.test.ts`(52)、`project_context.test.ts`(56)、`project_health.test.ts`(13)。
存储/迁移：`sqlite_cat_core.test.ts`(22)、`sqlite_cat_governance.test.ts`(15)、`sqlite_storage_task_importer.test.ts`(34)、`sqlite_legacy_writer_gate.test.ts`(13)、`runtime_migrations.test.ts`(9)、`legacy_task_backfill.test.ts`(60)。

### 4.2 Synthetic fixtures（全部合成、无客户内容）

| fixture | 内容 | 结论 |
|---|---|---|
| `tests/fixtures/memoq/sample.mqxliff` | 官方合成 4 段 memoQ MQXLIFF（zh-CN→en-US，含 `mq:rxt` 占位符、color bpt/ept、`mq:ch` 换行；`synthetic-game-ui.xlsx`，tool 标记 "Linguist Agent synthetic fixture"） | **copy → linguist-cat-formats 测试** |
| `tests/phrase_mxliff.test.ts`、`sdlxliff.test.ts`、`sdlxliff_gtag.test.ts`、`generic_batch_formats.test.ts` 内联 XML/CSV 字符串 | Phrase/SDL/通用 XLIFF/CSV 合成样本（写在测试源码里） | 随测试一并迁移 |
| `tests/fixtures/document-router-benchmark/{profile-v1,synthetic-report-v1}.json` | 文档路由基准（平台评估） | do-not-port |
| `tests/fixtures/pi-ask-1.1.0/`、`pi-subagents-events.v1.jsonl`、`data_root_writer_lease_child.ts`、`mcp_echo_server.ts`、`helpers/synthetic_server_root.ts`、`prompt_budget_fixture.ts` | Pi/服务器 harness fixtures | do-not-port（平台） |
| `packages/cat-runtime/eval/fixtures/distillation/smoke-cases.json`、`harness/security-smoke.json` | 旧 Private Eval fixtures | do-not-port（黑名单） |

## 5. 旧数据布局知识（供 `linguist-legacy-migration`，全部来自代码，未读 data/**）

数据根 = 应用运行根下 `<root>/data`；项目内路径由 `workspace.ts:18` `workspacePath()` = `<root>/data/projects/<projectId>/...` 构造。SQLite 权威标记与只读投影缓存位于 `data/runtime/*-sqlite-v1/`（**不在** `data/projects/` 下）。

```
<root>/
├── .la-runtime-data-backups/            # 全量数据快照（schema-1-to-2-<hash>、legacy-task-backfill-<sha12>）
└── data/
    ├── .schema.json                     # 运行时数据 schema 标记 v2（缺失即 v1）——迁移器的版本 oracle
    ├── settings/notifications.json
    ├── projects/<projectId>/            # CAT 域心脏
    │   ├── project.json                 # ProjectManifest（schemaVersion 1：语言对、scan 快照、asset 角色、importPlan）
    │   ├── tm.json + tm_audit.jsonl     # TM 条目 + 审计追加（审计可能绕过 SQLite 注入仍存在）
    │   ├── termbase.json、termbase_overrides.json、term_history.json、glossary.json
    │   ├── tag_rules.json、quality_checklist.json
    │   ├── quality_decision_ledger.jsonl  # hash 链台账（schemaVersion 1，sequence 1..N，hash=sha256(去hash字段JSON)——只验不算）
    │   ├── agent_decisions.json、agent_settings.json、voice_exemplars.jsonl、customer_returns.json
    │   ├── memory_audit.jsonl（TDAI 墓碑）、readiness_decisions.jsonl
    │   ├── batches/<batchId>/batch.json            # CatBatch + BatchSegment[]
    │   │   ├── proposals/<proposalSetId>.json      # 提案集（supersedes 链）
    │   │   ├── reports/<proposalSetId>.md
    │   │   └── voice_profile.json
    │   ├── delivery_qa/<reportId>.json              # 交付 QA 报告（项目级，delivery_qa.ts）
    │   ├── exports/<batchId>.<ext> + exports/export_audit.jsonl
    │   ├── source_context_index.json、asset_blocks.jsonl、asset_vectors.jsonl、
    │   │   asset_typed_index.json、asset_mapping_profiles.json
    │   ├── workflows/<workflowId>.json、workflow_artifacts.json
    │   ├── task_workspace/tasks/<taskId>/{snapshot.json(v2), events.jsonl, message_queue.json?, resource-profile.json?}
    │   ├── memory/memories.json、library/{catalog.json,blocks.jsonl,vectors.jsonl,sources/…}
    │   ├── uploads/（源文件耐久副本）、asset_parse/（可重建缓存，后迁至 cache root）
    │   ├── chat.json（旧项目聊天 [{ts,kind,text,…}]）、agent_events.jsonl（**排除**：隐藏思考）、
    │   │   _pi_sessions/*.jsonl（**排除**：内部恢复）
    ├── assistant/                       # standalone/personal 范围（tasks/、memory/、library/personal/、home_chat.json…）
    ├── evals/private/<evalSetId>/       # 旧 Private Eval（黑名单；未链接的 run.json 明确不迁移）
    └── runtime/                         # 平台状态 + 全部 SQLite 库
        ├── cat-core-sqlite-v1/{cat-core.sqlite, authority-v1.json, blob-store/, read-cache/<pid>/{manifest.json,tm.json,termbase.json,batches/<bid>.json}}
        ├── cat-governance-sqlite-v1/{cat-governance.sqlite, authority-v1.json, read-cache/<pid>/{ledger.json,checklist.json,export-audit.json,proposals/…}}
        ├── task-aggregate-sqlite-v1/、assistant-memory-sqlite-v1/、assistant-library-sqlite-v1/、
        │   workflow-eval-sqlite-v1/、settings-grants-trust-sqlite-v1/、package-registry-sqlite-v1/
        └── agent_permissions.json、pi_extension_trust.v2.json、trusted-extensions/…（平台，不迁）
    └── backups/<domain>-cutover-v1/attempt-<uuid>/  # 各域 cutover 前原始文件备份 + import-report-v1.json
```

迁移器要点：
- **版本探测**：`data/.schema.json`（v2 标记；缺失=v1）。v1→v2 差异在 `runtime_migrations.ts`：task `snapshot.json`/`events.jsonl` 从扁平 `task.projectId` 改为 `task.owner={kind:"project",…}`。迁移器只读探测，**绝不执行**该变更迁移。
- **读取优先级**（旧仓运行时语义）：persistence(SQLite authority-v1.json 存在) → read-cache JSON → legacy `data/projects/...` JSON。迁移器应优先读 SQLite（只读 `DatabaseSync`，`sqlite_audit_export.ts` 是样板），回退 legacy JSON，并报告两者分叉。
- **映射字典**：`storage-sqlite/src/task_mapping_contract.ts`（LA-085 冻结契约）逐字段列出 5 个 legacy 来源可映射字段与 `excludedRuntimeFields`——**逐字迁移**。
- **排除清单**（来自 `legacy_task_backfill.ts`）：`agent_events.jsonl`（隐藏思考）、`_pi_sessions/**`（内部恢复）、未链接 `data/evals/private/**/run.json`；`thread.piSessionFile` 与资源路径字段是**引用而非字节**，不导入。
- **确定性 ID**：legacy-chat 任务 `legacy-chat-<sha256(projectId\0sessionId)[:24]>`、legacy-workflow `legacy-workflow-<sha[:24]>`、legacy-task 流 `legacy-task-<sha256(locator)[:48]>`——保持可重放。
- **质量台账**：hash 链只验证、绝不重算；`sequence` 必须 1..N 连续。
- **blob store**：`blob-store/{blobs/sha256/<2hex>/<digest>(0444), refs/sha256/<2hex>/<sha256(refId)>.json, .staging/, .locks/}`。

## 6. 推荐抽取顺序（映射 PB-021/023/024）

> 注：计划文档（LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md）不在两个仓库内，PB-021/023 的标题以计划 §4 包序推断；仅 PB-024=CAT Store 有新仓证据（DEV_BASELINE_REPORT/USERDATA_LAYOUT：node:sqlite 探针"供 PB-024 使用"、`cat.db`）。执行前请对照计划原文校准。

| 顺序 | 内容 | 目标包 | 映射票 | 依据 |
|---|---|---|---|---|
| S1 | 纯域核心：locale、tag_rules_core/tag_tokens/tag_rule_discovery、format_signatures（含 ICU）、mechanical/number_qa、qa_write_gate、write_policy、authority_policy、模型类型（BatchSegment/CatBatch/TmEntry/TermbaseEntry/Proposal 类型）、waivers、candidate_pipeline、independent_critic、batch_consistency_repair、segment_context_graph + §4.1 对应测试与 sample.mqxliff | `linguist-cat-core` | **PB-021** | 零 IO、零外部依赖（除可选拼写词典），可最先落地并立即跑通旧测试；为后续所有包提供类型与规则基座 |
| S2 | 格式 Adapter：cat-formats 全包 + table_batch(XLSX) + document_assets 纯 XML 抽取器 | `linguist-cat-formats` | PB-022（推断） | 仅依赖 core 类型；jszip 是唯一外部依赖 |
| S3 | CAT 工具业务逻辑重表达为 Pi ToolDefinitions（§3.8 的 20 个壳 + tool_catalog/tool_policy 合一） | `linguist-cat-tools` | **PB-023** | 依赖 core/formats；handler 薄，主要工作是 project 上下文注入替代 `process.cwd()` |
| S4 | 每项目 SQLite 存储（node:sqlite）：batch/TM/TB/glossary/proposal/ledger/checklist/export-audit 持久化 + durable_file + blob store；废弃全局注册表，构造参数注入；接口形状参考 cat_core/cat_governance_repository | `linguist-cat-store` | **PB-024** | node:sqlite 探针结论已就绪；S1-S3 的 rewrite-small 尾部（IO 层）在此收口 |
| S5 | 旧数据只读迁移器：布局知识（§5）+ task_mapping_contract（copy）+ 只读 SQLite 打开模式 + hash 链验证 | `linguist-legacy-migration` | 后续票（PB-025+，推断） | 依赖 S4 schema 定型；只读、绝不写旧仓 |
| S6（延后/决策项） | workbook_mapping XLSX 层（替换内嵌 Python）、document_assets python/pdftotext 替换、spelling_qa 词典注入、voice 泛化、Library/Memory 去留 | 视决策 | 后续票 | 外部进程依赖与产品决策阻塞，不应阻塞 S1-S5 |

## 7. 绝对不迁移清单（do-not-port，一句话理由）

**整包/整层**
- `cat-server`（120 文件）——D-004 明示黑名单（HTTP 服务/路由/Worker Supervisor/Package Center/Maintainer/权限平台/sqlite cutover 编排）。
- `cat-runtime`（40 文件）——旧 AgentRuntimePort/Extension Host/Sandbox/Compaction/Private Eval/Maintainer 会话。
- `cat-mcp`（5 文件）——旧通用 Transport（MCP 桥）。
- `apps/desktop`——旧 Renderer。
- `cat-tools/web_bridge_tools.ts`——网络+Keychain+凭据为主体（旧 Transport/权限平台）。
- `cat-tools/document-capability-tools.ts`——深绑旧 server Run/Artifact/file-grant 体系。
- `cat-tools/present-answer-tool.ts`、`update-plan-tool.ts`——host 呈现层，非 CAT。
- `cat-tools/team_evidence_tools.ts`——server-authored scope 机制属旧 server 编排。
- `cat-tools/memory-tools.ts`——TDAI 墓碑 stub。
- `cat-tools/assistant-library-tools.ts`、`assistant-memory-tools.ts`——Library/Memory 产品概念 v1 去留未定（决策项，非代码问题）。

**cat-data 平台/评估/运行时文件**
- `task_workspace_contract.ts`(1670行)/`task_workspace.ts`(1114行)——通用 Agent 任务平台契约（owner/scope 多态、pi-session 字段）；仅 `ProjectTaskScope`+CAT artifact 枚举可抽出，本体黑名单。
- `task_message_queue*.ts`、`task_aggregate_storage.ts`、`runtime_storage.ts`、`structured_domain_storage.ts`、`standalone_file_grants.ts`、`subagent_run_artifacts.ts`——任务平台/授权基础设施。
- `runtime_migrations.ts`、`legacy_task_backfill.ts`——变更式迁移器与平台回填；**知识**进 linguist-legacy-migration（§5），代码不搬（重建迁移器必须只读）。
- `private_eval.ts`(1236行)、`rc_*.ts`、`release_candidate.ts`、`real_alpha.ts`、`beta_candidate.ts`、`completion_audit.ts`、`primary_use_readiness.ts`、`readiness_decisions.ts`——旧 Maintainer/Private Eval 与发布 readiness 工具（D-004）。
- `team_workflow.ts`、`team_context_builder.ts`、`team_evidence_scope.ts`、`workflow_plan.ts`、`workflow_artifacts.ts`、`workflow_eval_storage.ts`——旧 Team/Workflow 编排（黑名单）；证据范围/权威决策概念已被 constraint_pack/write_policy 覆盖。
- `prompt_compiler.ts`、`execution_profile.ts`——模型路由/prompt 组装缝（绑旧运行时模型清单；CAT prompt 资产可日后再评估）。
- `document_capabilities.ts`、`document_light_ocr_backend.ts`、`document_native_backend.ts`、`document_qualification.ts`、`document_router_contract.ts`、`document_staging.ts`——assistant 文档能力/M minerU 管线（非 CAT 域，外部进程依赖）。
- `file_capability_broker.ts`、`runtime_capability_brokers.ts`——能力代理/网络代理（权限平台）。
- `local_embeddings.ts`、`tdai_embedding_bridge.ts`、`tdai_memory_migration.ts`——@huggingface/transformers 本地模型与腾讯遗产 TDAI；embedding 后端选型属新仓决策。
- `assistant_library.ts`、`assistant_memory.ts`、`context_readiness.ts`、`memory-config.ts`——Library/Memory 子系统（v1 决策待定）。
- `safe_logging.ts`、`rich_artifact.ts`、`demo.ts`、`memory-audit.ts`——日志脱敏（平台）、host artifact、demo 种子、TDAI 墓碑。
- `cat_core_storage.ts`、`cat_governance_storage.ts`——进程级全局注册表注入模式废弃（接口形状作 store 设计输入）。

## 8. 风险与注意事项

1. **双存储后端分叉**：`batch_workspace`/`project_manifest`/`tm`/`termbase`/`proposals` 等读路径都是"SQLite→read-cache→legacy JSON"三层，且由**进程级全局 Map 注册表**注入（`catCorePersistenceFor`）。搬运时若照抄会把隐式全局状态和迁移期双轨语义一起带过来——务必改构造参数注入、单一后端。
2. **审计泄漏**：`tm.ts` 的 `tm_audit.jsonl` append 绕过注入接口，SQLite 模式下仍写文件；迁移数据时两条真相可能分叉（§5 读取优先级必须处理）。
3. **外部进程依赖**：`workbook_mapping.ts`（内嵌 ~550 行 Python + 宿主特定 python 探测路径，含 `~/.cache/codex-runtimes`）、`document_assets.ts`（python3/pdftotext）、`tm_import.ts`（同步 `execFileSync sqlite3`）、`termbase.ts`（mdbtools CLI）。这是最大移植债，建议替换为库（xlsx 库 / node:sqlite / 纯 TS SDLTB 解析或资格化 mdbtools），不要照搬。
4. **重复实现漂移**：`delivery_qa` vs `quality_audit`（normalize/术语/TM 匹配两套）；`quality_checklist` vs `tag_rules_core`（regex lint 两套）；`segment_evidence` vs `constraint_pack`（tmAuthorityRank 两套）；`independent_critic`/`tm_candidate_pipeline`/`segment_context_graph`（canonicalize/hash/parse 脚手架三套）；`quality_waivers`/`delivery_waivers`/`readiness_decisions`（"接受风险"机制三套）。重建时应合并，否则继承漂移。
5. **测试缺口**：`termbase.ts`（720 行）、`glossary.ts`、`term_history.ts`、`workbook_mapping.ts`（1259 行）、`table_batch.ts` 无专属测试；`tm` 仅 13 asserts；`customer_returns` 仅 7。这些模块迁移时必须先补表征测试（characterization tests）再动结构。
6. **ICU 逻辑有两处**：`format_signatures.ts`（arity 签名提取/比对 + stripIcuBranchPlaceholders）与 `delivery_qa.ts:161-199`（`icuSignatures`/`icuBranchBodies`/`matchingBrace` 递归解析器）——两处都是手写启发式（不平衡括号直接 break 无报错），且严重级别不一致（write gate=blocker，delivery=warning，代码内有注释解释）。迁移时两份都要带，并考虑统一。
7. **游戏本地化特化渗入通用层**：`voice_profile.VoiceTextType`（dialogue/ui/skill_desc/lore）、tag_tokens 内置规则表中的 game-color/placeholder-caret、spelling_qa 游戏词表、project_scan/asset_typed_index 的中英混合关键词启发式。重建通用 CAT 层时需决定哪些下沉为"游戏 profile"。
8. **并发/性能假设**：大量存储是全量读改写 JSON + 进程内锁（`segmentMutationQueues`、`withTmFileLock`、`appendQueues`），跨进程不安全；ledger 每次 append 前全量读+验链 O(n)。S4（SQLite store）是修复点，不要在 S1-S3 提前优化。
9. **jszip 依赖**：cat-formats 的 DOCX 与 table_batch/document_assets 需要 jszip——新仓需确认引入（检查 bun.lock/政策）。
10. **客户数据隔离**：本矩阵全部布局知识来自代码；未来迁移器开发时同样只准读代码与合成 fixtures，真实 `data/**` 内容只能在用户显式授权的迁移演练中接触。
