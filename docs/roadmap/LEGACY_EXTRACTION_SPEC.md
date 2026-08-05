# 旧仓逻辑提取规格（LEGACY_EXTRACTION_SPEC）

- 日期：2026-07-25
- 依据：《LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md》v1.0（Batch 8：PB-080 / PB-083 / PB-084）
- 性质：**调研草案**。本文档只为工单备料，正式实现范围、接口与落点以各工单为准。
- 旧仓：`/Users/<local>/Desktop/linguist-agent`（冻结，只读参考；本次调研未触碰 `data/**`，未做任何 git 操作）
- 新仓：`/Users/<local>/Desktop/linguist-agent-next`

## 调研方法与旧仓背景

三个目标文件全部位于旧仓 `packages/cat-data/src/`。旧仓 `cat-data` 的持久化模型是
"workspace JSON 文件 + project_manifest + cat_core_storage 遗留层"，新仓已改为
`packages/linguist-cat-store` 的 node:sqlite（`repositories/tm-units.ts`、`term-entries.ts`、
`qa-findings.ts`、`proposals.ts`）。因此判定主线很清晰：

- **纯函数 / 纯契约**（输入输出都是内存对象）→ 可原样提取，仅需类型对接；
- **触达磁盘 workspace、外部 CLI、嵌入式 Python 的部分** → 必须重写。

新仓既有约定（落点建议遵循之）：文件名为 kebab-case；core/formats 测试后缀 `.test.ts`，
store 为 `.nodetest.ts`；`linguist-cat-formats/src/adapters/` 已有 `csv.ts` / `xliff.ts` /
`json.ts`，新格式解析器应按此模式新增。

---

## PB-080：TM/TB 管理（导入 + 检索 + TM 复用路由）

计划要求：导入 TMX / CSV TM、term CSV/TBX、exact/fuzzy search、term status、case
sensitivity、notes、UI 管理、Tool 查询；不做向量检索。

### 1. `tm_candidate_pipeline.ts` —— TM 优先候选路由器

- 旧仓路径：`packages/cat-data/src/tm_candidate_pipeline.ts`（325 行）
- 导出符号：
  - 常量 `SAFE_HIGH_FUZZY_SCORE`
  - 类型 `CandidatePipelineRoute` / `CandidateModelInvocation` / `CandidateStatus` /
    `CandidatePipelineInput` / `CandidateRepetition` / `TranslationCandidate` /
    `CandidatePipelinePlan`
  - 函数 `candidatePipelineCacheKey`、`planTmFirstCandidatePipeline`、
    `proposalInputFromCandidatePlan`
  - 类 `CandidatePipelineCache`（内存 Map，无持久化）
- 依赖清单：
  - npm 包：无；node 内建：`node:crypto`
  - 旧仓内部（**运行时**）：`./tm.js` 的 `effectiveTmAuthority`、
    `isHardExactTmAuthority`（均为约 15 行的纯函数，tm.ts:94-107）
  - 旧仓内部（**仅类型**）：`./proposals.js` 的 `SegmentProposalInput`、
    `./tm.js` 的 `TmMatch`
  - 系统命令：无
- 判定：**可原样提取（主体）**。全文件无任何 I/O、无外部进程，是纯粹的"输入 TM
  匹配 + 重复段 + 约束快照 → 输出路由计划"的确定性路由器，且契约自带
  `authority: "candidate_only"` / `canCommit: false`，与新仓 proposal 门禁语义一致。
- 重写要点（仅两处适配，非逻辑重写）：
  1. 随迁提取 `effectiveTmAuthority` / `isHardExactTmAuthority` 及 `TmMatch` 所需
     的 `TmEntry.origin` / `sourceKind` 词表；新仓 `repositories/tm-units.ts` 的
     `TmUnit.origin` 目前只是 `string?`，PB-080 导入时需把旧词表
     （`reviewed|client_tm|mt|imported|unknown` × `client_import|customer_return|
     batch_confirm|manual|legacy`）落进 schema/迁移。
  2. `proposalInputFromCandidatePlan` 返回旧 `SegmentProposalInput`（含
     `changeType`、`reason`，无 `baseRevision`）；新仓
     `linguist-cat-core/src/proposal.ts` 的 `CreateProposalInput` 要求
     `baseRevision`、没有 `changeType` 概念。需写一个小适配层：`reason` 并入
     `evidenceRefs` 或 `warnings`，`baseRevision` 由调用方从当前 segment 取。
- 建议新仓落点：
  - `packages/linguist-cat-core/src/tm-candidate-pipeline.ts`（主体 + 随迁的
    authority 判定，可同文件或拆 `tm-authority.ts`）
  - proposal 适配留在调用侧（tools 层或 IPC 层），不进 core。

### 2. `tm_import.ts` —— TMX / SDLTM / 表格 TM 导入

- 旧仓路径：`packages/cat-data/src/tm_import.ts`（258 行）
- 导出符号：类型 `TmImportRow` / `TmImportResult`；函数 `parseTmxRows`、
  `parseSdltmRows`、`importTmxMemory`、`importSdltmMemory`、`importTmTable`
- 依赖清单：
  - npm 包：无；node 内建：`node:child_process`（`execFileSync`）、
    `node:fs/promises`、`node:path`
  - 旧仓内部：`createTmStore`（tm.js，JSON 文件存储）、`createWorkspace`
    （workspace.js）、`readProjectLocalePair` / `readProjectManifest`
    （project_manifest.js）、`extractMappedRows`（workbook_mapping.js）
  - 系统命令：**`sqlite3` CLI**（tm_import.ts:102，
    `execFileSync("sqlite3", ["-readonly", "-json", path, sql])` 读 SDLTM）
- 判定：**拆分处理 —— 解析纯函数可原样提取，SDLTM 读取与导入编排必须重写**。
- 重写要点：
  1. **可提取**：`parseTmxRows` 及其全部辅助（`decodeXml`、`decodeSdlSegment`、
     `langMatches`、`localName`、`collectTuvSegments`，tm_import.ts:28-89）是纯
     正则 XML 解析，无 I/O，可整体搬走。`decodeSdlSegment` 对 SDLTM 内联
     `<Value>` 标签的清洗逻辑在 SDLTM 重写时也要复用。
  2. **必须重写**：`sqliteJsonRows` / `parseSdltmRows`（tm_import.ts:99-145）。
     已核实线索属实——依赖系统 `sqlite3` CLI 并把 stdout 当 JSON 解析。新仓
     store 本就是 node:sqlite，应改用 `node:sqlite` 的 `DatabaseSync` 以只读
     方式直接开 `.sdltm` 文件执行同一条 SQL（`translation_units` ⋈
     `translation_memories`），去掉外部进程与 256MB maxBuffer 的权宜。
  3. **必须重写**：`persistTmRows` / `importTmxMemory` / `importSdltmMemory` /
     `importTmTable`（tm_import.ts:147-258）。它们深度耦合旧 workspace runtime
     （manifest 解析路径、locale 对读取、JSON 文件 store）。新仓导入编排应直接
     写 `repositories/tm-units.ts`（当前只读，PB-080 需按 schema.ts 补写路径与
     迁移），locale 对从 store 的项目记录取。
- 建议新仓落点：
  - `packages/linguist-cat-formats/src/adapters/tmx.ts`（`parseTmxRows` 及辅助，
    对齐既有 csv/xliff adapter 模式）
  - `packages/linguist-cat-formats/src/adapters/sdltm.ts`（node:sqlite 版 SDLTM
    读取 + SDL 段清洗）
  - `packages/linguist-cat-store/src/tm-import.ts`（导入编排：解析结果 →
    tm-units repository 批量写入 + `TmImportResult` 统计）
  - IPC 暴露：`apps/electron/src/main/lib/linguist/`（导入命令与进度，归 PB-080
    工单细化）

### 3. `termbase.ts` —— TBX / SDLTB / 表格术语库

- 旧仓路径：`packages/cat-data/src/termbase.ts`（720 行）
- 导出符号（节选）：类型 `TermbaseEntry` / `TermbaseOverride` /
  `TermbaseConflict` / `TermbaseImportResult` / `TermbaseMatch` /
  `SdltbConceptMeta`；纯函数 `parseSdltbIndexCsv`、`parseSdltbConceptsCsv`、
  `pairsFromSdltbIndexes`、`sdltbTableForLang`、`parseTbxPairs`、
  `auditTermbaseConflicts`、`resolvePreferredTermbaseEntries`；I/O 函数
  `importTermbaseTable` / `importTbxTermbase` / `importSdltbTermbase` /
  `readTermbaseEntries` / `writeTermbaseEntries` / `upsertTermbaseOverride` /
  `lookupTermbase` 等
- 依赖清单：
  - npm 包：无；node 内建：`node:child_process`（`execFile`）、`node:util`、
    `node:fs/promises`、`node:path`
  - 旧仓内部：workspace.js、project_manifest.js、term_history.js、
    workflow_artifacts.js、locale.js、cat_core_storage.js、workbook_mapping.js
  - 系统命令：**mdbtools**（`mdb-tables`、`mdb-export`，termbase.ts:227/234，
    用于读 SDLTB 的 Access .mdb 容器）
- 判定：**拆分处理 —— TBX/CSV 解析与冲突裁决纯函数可原样提取，SDLTB 容器读取
  与全部读写编排必须重写**。
- 重写要点：
  1. **可提取**：`parseTbxPairs`（纯 XML 正则解析）、`parseSdltbIndexCsv` /
     `parseSdltbConceptsCsv` / `pairsFromSdltbIndexes` / `sdltbTableForLang`
     （纯 CSV/字符串逻辑，重写 SDLTB 时仍是其解析内核）、
     `auditTermbaseConflicts` / `resolvePreferredTermbaseEntries`（纯内存裁决；
     注意后者依赖旧 `TermHistoryIndex` 类型，新仓无对应物，需裁掉 history 维度
     或等 PB 工单决定是否重建 term history）。
  2. **必须重写**：`runMdb` / `listSdltbTables` / `exportSdltbTable` /
     `importSdltbTermbase`。已核实线索属实——SDLTB 读取完全建立在系统
     mdbtools 上（ENOENT 时提示 `brew install mdbtools`）。是否在新仓保留
     mdbtools 这一系统依赖、或 PB-080 首版只做 TBX/CSV，需工单决策；若保留，
     建议隔离在 formats 的 `sdltb.ts` adapter 内，污染面不外溢。
  3. **必须重写**：全部 `read*/write*/upsert*/import*` 编排——旧实现写
     `termbase.json` / `termbase_overrides.json` 并过 cat_core_storage 遗留层；
     新仓改为 `repositories/term-entries.ts`（node:sqlite）。
- 建议新仓落点：
  - `packages/linguist-cat-formats/src/adapters/tbx.ts`（`parseTbxPairs`）
  - `packages/linguist-cat-formats/src/adapters/sdltb.ts`（若保留 mdbtools：
    容器读取 + 随迁的 CSV 解析纯函数）
  - `packages/linguist-cat-core/src/termbase-resolution.ts`（冲突审计与
    preferred 裁决纯逻辑）
  - `packages/linguist-cat-store/src/term-import.ts`（导入编排 → term-entries
    repository）

### 4. `workbook_mapping.ts` —— 表格（XLSX/CSV）列映射与抽取

- 旧仓路径：`packages/cat-data/src/workbook_mapping.ts`（1259 行）
- 导出符号：约 12 个类型（`WorkbookPreview` / `WorkbookMappingCandidate(s)` /
  `WorkbookRows` / `WorkbookCellStyle` 等）+ 6 个 async 函数
  （`readWorkbookRows`、`readWorkbookNativePreview`、`readWorkbookSheetPage`、
  `previewWorkbookMapping`、`suggestWorkbookMappingCandidates`、
  `extractMappedRows`）
- 依赖清单：
  - npm 包：无；node 内建：`node:child_process`、`node:os`、`node:fs` 等
  - 旧仓内部：`project_manifest.js`
  - 系统命令：**python3 + openpyxl**。已核实线索属实：文件内嵌两段 Python
    源码（`OPENPYXL_STREAM_SCRIPT` workbook_mapping.ts:219-505、
    `RAW_XLSX_STREAM_SCRIPT`），经
    `execFileAsync(workbookPython(), ["-c", ...])` 执行
    （workbook_mapping.ts:772/788）；解释器候选路径还硬编码了
    `~/.cache/codex-runtimes/...`（workbook_mapping.ts:139-146）。
- 判定：**不可整体提取 —— 引擎必须重写，列名启发式纯逻辑可随迁**。
- 重写要点：
  1. XLSX 读取引擎整体重写：去掉内嵌 Python 与解释器探测。选项：纯 JS XLSX
     解析库（需新增依赖，工单决策）或首版只支持 CSV/TSV 导出路径。注意新仓
     `linguist-cat-formats` 已有 `adapters/csv.ts`，delimited 路径可能已覆盖。
  2. **可随迁的纯逻辑**：列别名表（`SOURCE_ALIASES` / `TARGET_ALIASES` /
     `NOTE_ALIASES`，workbook_mapping.ts:134-136）与候选打分/建议启发式——
     与引擎解耦，对 PB-080 的"表格 TM/术语导入"直接有用。
  3. `extractMappedRows` 是 tm_import/termbase 表格导入的共同依赖，重写时需
     与新仓 formats adapter 输出契约对齐（sheet/headers/rows 三元组）。
- 建议新仓落点：
  - `packages/linguist-cat-formats/src/workbook-mapping.ts`（别名表 + 映射
    建议/打分的纯逻辑）
  - XLSX adapter（若工单决定支持）按 `adapters/` 模式新增；CSV 路径复用既有
    `adapters/csv.ts`

---

## PB-083：Review Skill 和 Finding（Independent Critic）

计划要求：Review 只产生 Finding 或修订 Proposal，不能直接 Commit。

### `independent_critic.ts` —— 独立评审产物契约

- 旧仓路径：`packages/cat-data/src/independent_critic.ts`（222 行）
- 导出符号：
  - 常量 `INDEPENDENT_CRITIC_CATEGORIES`（fidelity / naturalness / terminology /
    voice / consistency）
  - 类型 `IndependentCriticCategory` / `IndependentCriticSeverity` /
    `IndependentCriticFindingDraft` / `IndependentCriticSubject` /
    `IndependentCriticIdentity` / `IndependentCriticFinding` /
    `IndependentCriticArtifact` / `IndependentCriticRequest` /
    `IndependentCriticPlan` / `CriticTargetedRepairScope`
  - 函数 `planIndependentCritic`（仅高风险段触发评审规划）、
    `createIndependentCriticArtifact`（建产物 + 独立性断言：critic 与候选生产者
    必须不同 execution 且不同 actor）、`parseIndependentCriticArtifact`
    （严格解析 + artifactId/artifactHash 完整性校验）、
    `targetedRepairScopeFromCriticArtifact`（只圈定 finding/segment 范围）
- 依赖清单：
  - npm 包：无；node 内建：`node:crypto`
  - 旧仓内部（**运行时**）：`./write_policy.js` 的 `isCitableEvidenceSource`
    ——其实体只是 `Boolean(value.trim()) && !isAuditOnlyEvidenceSource(value)`
    加 6 条审计专用前缀正则（write_policy.ts:16-23, 54-60），约 12 行可随迁
  - 系统命令：无
- 判定：**可原样提取**。无 I/O、无外部进程、无 proposal/target 写依赖；产物
  契约自带 `authority: "advisory_finding"` / `canCommit: false`，与 PB-083
  "Review 不能直接 Commit"的硬约束逐字吻合。
- 重写要点（仅适配）：
  1. 随迁 `isCitableEvidenceSource` / `isAuditOnlyEvidenceSource` /
     `AUDIT_ONLY_EVIDENCE_PATTERNS` 为独立小模块（不要迁整个 write_policy.ts，
     它牵挂在旧 batch_workspace / qa_write_gate 上）。
  2. 代码风格转新仓约定（kebab-case 文件名、无分号、单引号）；严重度词表
     `info|warning|blocking` 与新仓 `QaFindingSeverity` 一致，类别词表可在
     工单中决定是否并入 QA finding code 体系。
  3. 本文件只是**产物契约与校验**；真正调用 LLM 产出 finding draft 的
     Review Skill 执行体属于 tools/IPC 层新增工作，不在提取范围。
- 建议新仓落点：
  - `packages/linguist-cat-core/src/independent-critic.ts`（全部契约与纯函数）
  - `packages/linguist-cat-core/src/evidence.ts`（随迁的可引用证据判定，供
    critic 与后续 proposal 证据校验共用）

---

## PB-084：Batch Consistency

计划要求：只检查并修复命中 Segment（repeated source / terminology / character
names / punctuation / voice profile）；禁止全 Batch 无差别重翻。

### `batch_consistency_repair.ts` —— 一致性命中投影与定点修复输入

- 旧仓路径：`packages/cat-data/src/batch_consistency_repair.ts`（79 行）
- 导出符号：
  - 类型 `BatchConsistencyFinding` / `BatchConsistencyPass`
  - 函数 `buildBatchConsistencyPass`（把既有 QA 报告中 status=open 且 code 属于
    一致性集合的 finding 投影成 advisory pass，附 locked 标记；**不重查不重跑**）、
    `targetedRepairProposalInputs`（仅把显式选中且未锁定的 finding 转成修复
    proposal 输入，带 segment 匹配/锁定/非空校验）
- 依赖清单：
  - npm 包：无；node 内建：无
  - 旧仓内部（**全部仅类型**）：`./proposals.js` 的 `SegmentProposalInput`、
    `./quality_audit.js` 的 `QualityAuditReport` / `QualityFinding`
  - 系统命令：无
- 判定：**可原样提取**。零运行时依赖，79 行全是纯投影/校验逻辑；
  `authority: "advisory_finding"` / `canCommit: false` 与"只修复命中 Segment"
  的计划约束一致。
- 重写要点（类型对接，三处差异要在工单中定夺）：
  1. 新仓 `QaFinding`（linguist-cat-core/src/qa-finding.ts）**没有
     `evidenceSources` 字段**（仅 id/segmentId/code/severity/message/status），
     旧逻辑会把 finding 的 evidenceSources 透传进修复 proposal。映射选项：
     塞进 `CreateProposalInput.evidenceRefs`（需 store 侧能反查），或首版丢弃。
  2. 新仓 `CreateProposalInput` **没有 `changeType`**，旧 `changeType()` 映射
     （terminology/consistency/style）无处安放——可并入 warnings 或直接丢弃。
  3. 一致性 code 集合（`TERM_PREFERRED_MISSING` 等 5 个）来自旧 QA 规则目录；
     新仓规则目录属 PB-070 范畴，PB-084 落地时需确认这些 code 已存在或对齐
     新命名。
  4. QA 报告来源由旧 `QualityAuditReport` 改为 store 的
     `repositories/qa-findings.ts` 查询结果。
- 建议新仓落点：
  - `packages/linguist-cat-core/src/batch-consistency.ts`（投影 + 定点修复输入
    构造的纯逻辑）
  - QA finding 读取走 `packages/linguist-cat-store` 的 qa-findings repository；
    IPC 暴露放 `apps/electron/src/main/lib/linguist/`

---

## 汇总判定表

| 提取物 | 判定 | 一句话理由 |
| --- | --- | --- |
| `tm_candidate_pipeline.ts` | 可原样提取（主体） | 纯确定性路由器，仅 node:crypto + 两个 15 行纯函数运行时依赖；仅 proposal 输出类型需适配新 `CreateProposalInput` |
| `independent_critic.ts` | 可原样提取 | 纯产物契约 + 哈希校验，唯一运行时依赖是 12 行可随迁的证据可引用判定 |
| `batch_consistency_repair.ts` | 可原样提取 | 79 行零运行时依赖的纯投影，仅需对接新 `QaFinding`/`CreateProposalInput` 类型 |
| `tm_import.ts` | 拆分：解析可提取，导入须重写 | TMX 解析纯函数可直接搬；SDLTM 读取走 `sqlite3` CLI、导入编排耦合旧 workspace JSON runtime |
| `termbase.ts` | 拆分：解析/裁决可提取，读写须重写 | TBX/CSV 解析与冲突裁决是纯函数；SDLTB 依赖系统 mdbtools，读写走旧 JSON workspace |
| `workbook_mapping.ts` | 引擎须重写，启发式可随迁 | XLSX 引擎是内嵌 Python（openpyxl）经外部解释器执行；列别名/打分纯逻辑可提取 |

## 遗留问题（交工单决策）

1. SDLTB 是否保留 mdbtools 系统依赖，还是 PB-080 首版只做 TBX/CSV。
2. XLSX 支持是否引入 JS 解析库（新依赖），或首版仅 CSV/TSV。
3. 旧 `changeType` / `evidenceSources` 在新 proposal/QA 模型中的映射口径
   （evidenceRefs / warnings / 丢弃）。
4. `resolvePreferredTermbaseEntries` 依赖的 term history 维度是否重建。
