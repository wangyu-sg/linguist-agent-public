# LEGACY_MIGRATION_CONTRACTS — 旧仓数据合约盘点（PB-090 Scanner 调研）

- 日期：2026-07-25
- 依据：《LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md》v1.0，Batch 9（PB-090 ~ PB-094）
- 性质：**调研草案**。仅基于旧仓 `/Users/<local>/Desktop/linguist-agent`（已冻结）的源码/schema 只读调研，未打开旧仓 `data/**` 下任何真实数据文件，未经 PB-090 实现验证；实现时如对真实副本扫描结果与本文冲突，以实测为准并回写本文。
- 用途：为 PB-090 Legacy Scanner 提供"读什么、按什么格式读"的合约清单，并标出 PB-091 必须保留字段在旧 schema 中的对应列/字段名。

调研方法：只读旧仓 `packages/` 源码（cat-data / cat-server / storage-sqlite 为主），未做任何 git 操作，未触碰 `data/**`。下文所有相对路径均相对旧仓根。

---

## 0. 悬案结论：三个 task_*_contract.ts 都存在

此前调研称"旧仓 grep 不到 `task_mapping_contract.ts`"，**结论更正：三个文件都存在**，确切路径与各自定义：

| 文件 | 路径 | 定义内容 |
|---|---|---|
| task_mapping_contract.ts | `packages/storage-sqlite/src/task_mapping_contract.ts` | `LEGACY_TASK_SQLITE_MAPPING_CONTRACT`（LA-085 冻结，`schemaVersion: 1`、`storageSchemaVersion: 2`）。逐实体列出 5 个 legacy source 允许映射的字段清单：`task_workspace`（snapshot/task/run/thread/activity/artifact/decision 等 26 个实体）、`task_run_event`（event_page/event）、`quality_decision_ledger`（event）、`task_message_queue`（queue/message）、`task_package_profile`（profile/selection/executable_approval）；并给出每个 source 的 ordering / revisions / blobBoundaries 语义与 `excludedRuntimeFields`。提供 `requireMappedLegacyFields()` 做未知字段校验——**这正是 PB-090 "unsupported fields" 输出的判定基准**。该合约同时被写入每个 SQLite 库的 `mapping_contracts` 表（domain=`legacy_task`），打开库时强制校验 hash。 |
| task_workspace_contract.ts | `packages/cat-data/src/task_workspace_contract.ts` | `TASK_WORKSPACE_SCHEMA_VERSION = 2`。Task workspace 的完整类型与解析器：`TaskWorkspaceSnapshot{schemaVersion, task, activeRunId, eventCursor, projectedAt, usage?, runs[], agentThreads[], activities[], artifacts[], decisions[]}`，以及 `TaskRecord/TaskRun/TaskAgentThread/TaskActivity/TaskArtifact/TaskDecision/TaskRunEvent(Page)` 等全部实体、状态机（Run status 迁移表）、execution snapshot/config change 时间线校验。snapshot JSON 的逐字段 parse 规则也在此文件。 |
| task_message_queue_contract.ts | `packages/cat-data/src/task_message_queue_contract.ts` | `TASK_MESSAGE_QUEUE_SCHEMA_VERSION = 1`。`TaskMessageQueue{schemaVersion, taskId, paused, pausedReason, messages[], updatedAt}` 与 `TaskQueuedMessage{id, taskId, runId, text, delivery:"follow_up", status:"queued"|"paused"|"failed", error?, createdAt, updatedAt}`，含不变式校验（paused 与 pausedReason 必须一致；paused 队列不得含 queued 消息等）。 |

另：mapping 合约里 `quality_decision_ledger` source 的字段清单（`projectId, batchId, workflowId, segmentId, findingId, code, severity, kind, decision, reason, evidenceRefs, actor, recordedAt, logicalEventId, schemaVersion, sequence, previousHash, hash`）与 `packages/cat-data/src/quality_decision_ledger.ts` 一致，可直接作为 ledger 的字段白名单。

---

## 1. 存储总览：数据根、SQLite 域与权威判定

### 1.1 数据根与项目目录

- 数据根 = `<repoRoot>/data/`（生产模式 `repoRoot` = 旧源码仓根，`packages/cat-server/src/server_root.ts`）。
- 项目枚举 = 扫描 `data/projects/{projectId}/` 子目录（`packages/cat-server/src/projects_index.ts`）；无中央索引文件。
- Writer lease：`.data-root-writer-lease/owner-v1.json`，scanner 只读、不申请。

### 1.2 双形态存储与 authority marker（scanner 的第一优先级判定）

旧仓经历过 SQLite cutover：每个域一个目录 `data/runtime/<domain>-sqlite-v1/`，内含：

- `authority-v1.json` — `{schemaVersion:1, authority:"sqlite"|"legacy", databaseRelativePath, backupRootRelativePath, ...}`。**marker 存在且 authority=sqlite → 该域 SQLite 库为权威源**，legacy JSON 只经 read-cache 投影读取（`packages/cat-data/src/cat_core_storage.ts:100-109`、`cat_governance_storage.ts`）；marker 不存在 → legacy JSON 仍是权威；authority="legacy" → 曾 rollback，legacy JSON 重新为权威。
- `<domain>.sqlite` — 实际库文件名以 marker 的 `databaseRelativePath` 为准（recutover 后可能改名，如 `task-aggregate-recutover-<uuid>.sqlite`）。

scanner 读取优先级：**① SQLite projections（marker 指示为权威时）→ ② read-cache JSON（交叉校验）→ ③ legacy `data/projects/{id}/*.json`**。注意 read-cache 文件名中 projectId/batchId 经 `encodeURIComponent` 并把 `%` 替换为 `_`（`cat_core_storage.ts` `safeCachePart`）。

8 个 SQLite 域（路径出处见各 cutover 文件）：

| 域 | 默认库路径（相对数据根上级，即旧仓根） | 内容 | CAS blob 根 |
|---|---|---|---|
| task-aggregate | `data/runtime/task-aggregate-sqlite-v1/task-aggregate.sqlite` | Task workspace snapshot + run events、message queue、resource profile | 无 |
| cat-core | `data/runtime/cat-core-sqlite-v1/cat-core.sqlite` | project manifest、batch/segments、TM、TB、source refs | `data/runtime/cat-core-sqlite-v1/blob-store` |
| cat-governance | `data/runtime/cat-governance-sqlite-v1/cat-governance.sqlite` | proposals、quality checklist、quality decision ledger、export audit | 无 |
| settings-grants-trust | `data/runtime/settings-grants-trust-sqlite-v1/settings-grants-trust.sqlite` | settings/grants/trust | 无 |
| assistant-memory | `data/runtime/assistant-memory-sqlite-v1/assistant-memory.sqlite` | assistant memory | 无 |
| assistant-library | `data/runtime/assistant-library-sqlite-v1/assistant-library.sqlite` | library catalog/blocks/vectors | 同域 `blob-store` |
| workflow-eval | `data/runtime/workflow-eval-sqlite-v1/workflow-eval.sqlite` | workflows、workflow artifacts、private eval 元数据 | 无 |
| package-v2 (lapkg) | `data/runtime/package-registry-sqlite-v1/package-registry.sqlite` | package registry/activation | `data/assistant/capabilities/packages-v2/blob-store` |

PB-090 点名输出主要落在前三个域 + legacy JSON；其余域按"presence/unsupported"处理即可。

### 1.3 通用 event-projection store（所有 SQLite 域同构）

定义：`packages/storage-sqlite/src/index.ts`，`SQLITE_STORAGE_SCHEMA_VERSION = 2`（落盘 `PRAGMA user_version = 2`）。表 DDL（`index.ts:294-358`）：

| 表 | 关键列 | 说明 |
|---|---|---|
| `schema_migrations` | `version PK, applied_at` | 迁移账本，最新必须为 2 |
| `streams` | `stream_id PK, revision` | 每聚合一条流，revision 为乐观并发版本 |
| `events` | `stream_id, sequence, event_id UNIQUE, event_type, occurred_at, payload_json(CHECK json_valid)`，`PK(stream_id, sequence)` | 追加式事件；payload 为 JSON |
| `projections` | `stream_id PK, revision, projection_json` | **领域状态主体在此：每 stream 一个 JSON 文档** |
| `commands` | `command_id PK, stream_id, request_json, result_json` | 幂等命令记录 |
| `mapping_contracts` | `domain PK, contract_version, max_source_schema_version, contract_hash, contract_json` | 必有 `domain='legacy_task'` 一行，hash 校验 |

scanner 只读打开要点：

- 优先读**副本**（复制 `.sqlite` + `-wal` 后打开，或 URI `immutable=1`）；生产库为 WAL + synchronous=FULL，伴生 `-wal`/`-shm`。
- `PRAGMA user_version` 必须 = 2；`> 2` 判 unsupported domain。
- 完整性检查：`PRAGMA quick_check`、`PRAGMA foreign_key_check`。
- stream_id 合法字符集 `^[A-Za-z0-9_.:-]{1,128}$`；stream digest 均为 `sha256(...).hex.slice(0,48)`。
- 事件双形态：canonical 事件 `payload.taskEvent = TaskRunEvent`；legacy 导入事件 `payload.legacyEvent` 且 `event_type` 带 `legacy.` 前缀（`task_workspace_repository.ts`、`legacy_task_importer.ts`）。

各 repository 的 stream_id 命名（scanner 按前缀即可枚举，不必复算 digest）：

| repository | stream_id 格式 |
|---|---|
| Task workspace | `legacy-task-<sha256(JSON(locator))>`；locator = `{kind:"standalone",taskId}` 或 `{kind:"project",projectId,taskId}` |
| Task side state | `legacy-queue-<d>`、`legacy-resource-<d>`、`legacy-quality-<d2>` |
| cat-core | `cat-core-{batch\|tm\|termbase\|manifest\|source}-<sha256(projectId\0id)>`；tm/termbase/manifest 的 id 恒为 `"root"`，source 的 id = `"{ownerKind}:{ownerId}"` |
| cat-governance | `cat-governance-{proposal\|checklist\|ledger\|export-audit}-<sha256(JSON([kind,...parts]))>` |
| assistant-memory / library | `assistant-memory-<sha256(JSON scope)>` / `assistant-library-<sha256(JSON scope)>` |
| workflow-eval | `workflow-eval-<sha256(key)>`，key 形如 `project/{projectId}/workflow/{file}`、`eval/{setId}/...` |
| settings/grants/trust | `structured-{domain}-{scope}-{key}`（明文） |
| lapkg | 固定 3 条：`lapkg.registry.v2`、`lapkg.activation-journal.v1`、`lapkg.recovery-block.v1` |

projection_json 外层包装：cat-core 为 `{schemaVersion:1, projectId, id, value}`（真实数据在 `.value`）；governance 为 `{kind:"proposal", projectId, batchId, proposalSet}`、`{kind:"ledger", projectId, events}` 等按 kind 包装。

---

## 2. Project index（派生，无独立持久文件）

- 定义：`packages/cat-server/src/projects_index.ts`（`ProjectSummary` / `BatchSummary`，`projects_index.ts:13-41`）。
- 存储形态：**无中央索引**。运行时扫描 `data/projects/` 子目录 + 逐目录读 `project.json` + 读各 batch 汇总而成。
- `ProjectSummary{projectId, name, root, updatedAt, assetCount, batches[]}`；`BatchSummary{schemaVersion:1, projectId, batchId, format, sourceLanguage, targetLanguage, segments, confirmed, draft, new, locked, workflowStage?, updatedAt}`。
- scanner 读取要点：
  - project list = `data/projects/*` 目录 ∪ cat-core/cat-governance SQLite stream 中出现的 projectId，双侧对账；不一致即 orphan 候选（PB-092）。
  - 目录存在但 `project.json` 缺失/不可解析 → 旧服务端发 `project_manifest_unreadable` diagnostic 并跳过；scanner 应列入 health/errors 而非跳过。
  - **权限字段结论**：旧仓 CAT 合约中**不存在 project 级 permission 字段**（全仓无 `"full"` 值；file grant 的 access 仅 `"read"|"read_write"`，`standalone_file_grants.ts`）。PB-092 的 invalid `full` permission 不是 manifest/旧 CAT 数据字段；若真实数据出现，记入 unsupported fields，且不得阻断 CAT 数据扫描。

---

## 3. ProjectManifest（project.json）

- 定义：`packages/cat-data/src/project_manifest.ts:23-38`，`schemaVersion: 1`。
- 存储形态：
  - SQLite：cat-core `manifest` stream（id 恒 `root`），projection `.value` 即 manifest；
  - read-cache：`data/runtime/cat-core-sqlite-v1/read-cache/{safeProjectId}/manifest.json`；
  - legacy JSON：`data/projects/{projectId}/project.json`。
- 字段：`projectId, projectName?, root, sourceLanguage, targetLanguage, createdAt, updatedAt, scan: ProjectScanReport, assetRoleDecisions[], phraseTagPairs, importPlan[], warnings[], questions[]`。
  - `root` = 项目源文件夹绝对路径（source roots 输出的来源；assets 的 `relPath` 相对它）。PB-092 "manifest root 已删除" 场景即此字段指向不存在的目录。
  - `assetRoleDecisions[] = {relPath, role, confidence, status:"inferred"|"confirmed", reasons[]}`。
  - `projectId` 由目录名 ASCII slug 派生（`inferProjectId`）。
- scanner 要点：manifest 可能只有 legacy JSON（未 cutover 的老项目）或只有 SQLite；两种形状一致，直接按 v1 解析；未知顶层键记入 unsupported。

### ProjectScanReport / assets（嵌于 manifest，无独立存储）

- 定义：`packages/cat-data/src/project_scan.ts:49-59`。
- 字段：`root, scannedAt, assets: DiscoveredAsset[], phraseTagPairs[{mxliff, masterXliff?, confidence, reason}], warnings[], questions[], importPlan[], suggestedActions[{assetPath, role, action, tool?, prerequisites[], reason, confidence}], countsByRole`。
- `DiscoveredAsset{path(绝对), relPath, name, ext, sizeBytes, role: AssetRole, confidence, reasons[], metrics?{transUnits?, sourceCount?, duplicateSourceGroups?, lockedMarkers?, placeholderMarkers?, targetCount?}}`；`AssetRole ∈ phrase_mxliff|master_xliff|xliff|mqxliff|sdlxliff|csv_batch|xlsx_batch|tm|termbase|glossary|source_table|style_guide|reference|image|unknown`。
- 这就是 PB-090 **assets 输出的直接来源**；`metrics` 仅文本类 asset 有。

---

## 4. Internal uploads/imports 与 asset 派生物

| 结构 | 定义文件 | 存储形态（legacy 路径，相对 `data/projects/{projectId}/`） | 关键字段 |
|---|---|---|---|
| 内部上传目录 | `packages/cat-server/src/server.ts`（`/api/projects/import-upload` 落点） | `uploads/` 目录（原始上传字节） | PB-092 "internal copy only" 场景的 managed source copy 落点；按文件枚举即可 |
| AssetBlock | `packages/cat-data/src/asset_blocks.ts:17-34` | `asset_blocks.jsonl`（每行一 block） | `blockId, assetPath, lineNo, blockType: heading\|table\|text\|image, text, sourceEngine: text_asset\|docx_asset\|pptx_asset\|pdf_asset\|xlsx_asset\|image_asset, role?, parserKind?, typedRowId?, authorityTier?, sourceDigest?(= asset 文件字节 sha256), page?, sheet?, slide?, bbox?, parserVersion?` |
| AssetTypedIndex | `packages/cat-data/src/asset_typed_index.ts:61-70` | `asset_typed_index.json`，`schemaVersion:1` | `{projectId, assetPath, generatedAt, sheets[], rows[], summary, warnings[]}`；row 含 `kind, role, action, authorityTier, parserKind, extractionSource, confidence, text, source?, target?, note?, status?, category?, fields, trace[]` |
| Asset 摄取合约 | `packages/cat-data/src/asset_ingestion_contract.ts` | 纯类型契约，无独立落盘 | scanner 只需识别类型 |

注：`asset_blocks.jsonl` / `asset_typed_index.json` / `asset_vectors.jsonl` / `source_context_index.json` 属可重建索引，PB-091 不必迁入，但 `sourceDigest` 可用于 digest 交叉校验。

---

## 5. Segments（CatBatch / BatchSegment）★ PB-091 核心

- 定义：`packages/cat-data/src/batch_workspace.ts:38-86`，`CatBatch.schemaVersion: 1`。
- 存储形态：
  - SQLite：cat-core `batch` stream（id = batchId），projection `.value` = CatBatch；
  - read-cache：`read-cache/{safeProjectId}/batches/{safeBatchId}.json`；
  - legacy JSON：`data/projects/{projectId}/batches/{safeBatchId}/batch.json`（batchId 落盘前经 `safeBatchId()` 清洗，`/:`→`-`）。
- `CatBatch{schemaVersion, format: phrase_mxliff|mqxliff|sdlxliff|xliff_1_2|xliff_2_0|csv_paste|xlsx_paste, projectId, batchId, sourceFile(绝对路径), masterFile?, sourceLanguage, targetLanguage, workflowStage?: translate|edit|proof|delivery, createdAt, updatedAt, tagReport, duplicateSourceGroups[{duplicateKey, source, count, segmentIds[], firstSegmentId}], segments: BatchSegment[]}`。
- `BatchSegment` 全字段（`batch_workspace.ts:38-69`，已逐字段核对）：

`index, id, masterId?, resname?, contextNote?, source, target, originalTarget?, rawSource, rawTarget, locked, status, duplicateKey, duplicateRole?: unique|first|repeat, duplicateOrdinal?, duplicateGroupSize?, duplicateFirstSegmentId?, placeholderCount, unresolvedPlaceholderCount, unresolvedRuntimePlaceholderCount?, unresolvedTagPlaceholderCount?, unresolvedPlaceholders?[], unresolvedRuntimePlaceholders?[], unresolvedTagPlaceholders?[], confirmationLevel?, tuId?, updatedAt?, updateReason?, updateChangeType?, updateEvidenceSources?[]`

- **PB-091 必须保留字段的对应名**：
  - Segment order → **`segments[]` 数组顺序（canonical）+ `segment.index` 显式序号**。
  - source → `segment.source`（rehydrated 显示态）；原始含占位符形态在 `rawSource`。
  - target → `segment.target`；导入时初始 target 在 `originalTarget?`（之后不随编辑变）；原始态 `rawTarget`。
  - locked → `segment.locked`。
  - QA 状态 → `segment.status: "new"|"draft"|"confirmed"` + `confirmationLevel?`（sdlxliff/mqxliff 原始确认级别）+ `tuId?`。
  - revisions 最终语义 → **旧仓无逐段修订历史链**；"最终语义"= 当前 `source/target` 值 + 乐观并发令牌 `segment.updatedAt?` + 最后一次修改元数据 `updateReason?/updateChangeType?/updateEvidenceSources?`。迁移保留这些即完整；勿伪造历史。流级修订在 SQLite `streams.revision` / `events.sequence`。
- scanner 要点：`format` 枚举外值、segment 上未列字段 → unsupported；`originalTarget/rawSource/rawTarget/confirmationLevel` 等按导入格式不同可能缺失，记 notes 不报错。

---

## 6. TM（Translation Memory）

- 定义：`packages/cat-data/src/tm.ts:7-22`（`TmEntry`）。**无 schemaVersion（裸数组）**。
- 存储形态：
  - SQLite：cat-core `tm` stream（id=`root`），projection `.value` = `TmEntry[]`；
  - read-cache：`read-cache/{safeProjectId}/tm.json`；
  - legacy JSON：`data/projects/{projectId}/tm.json`（裸 `TmEntry[]`）；
  - 审计（append-only）：`data/projects/{projectId}/tm_audit.jsonl`，每行 `{ts, action, entry|counts}`。
- `TmEntry{id, source, target, srcLang, tgtLang, origin: reviewed|client_tm|mt|imported|unknown, quality?, project?, note?, sourceKind?: client_import|customer_return|batch_confirm|manual|legacy, sourceBatchId?, sourceSegmentId?, createdAt?, updatedAt?}`。
- PB-091 保留要点：全量 entry + `origin/sourceKind`（决定权威级别）+ `sourceBatchId/sourceSegmentId`（回链 provenance）。`tm_import.ts` 只是 TMX/SDLTM/表格解析器，无独立存储。

---

## 7. TB（Termbase）

- 定义：`packages/cat-data/src/termbase.ts:14-37`。**无 schemaVersion**。
- 存储形态（注意两种形状不同，scanner 都要支持）：
  - SQLite / read-cache：cat-core `termbase` stream，单对象 `{entries: TermbaseEntry[], overrides: TermbaseOverride[]}`；
  - legacy JSON：**两个文件** `data/projects/{projectId}/termbase.json`（`TermbaseEntry[]`）+ `termbase_overrides.json`（`TermbaseOverride[]`）。
- `TermbaseEntry{id, source, target, srcLang, tgtLang, note?, conceptId?, fields?: Record<string,string[]>, sourceFile, sheetName?, rowNo, origin: sdltb|tbx|table|manual}`；`conceptId/fields` 仅 sdltb 来源有。
- `TermbaseOverride{source, target, srcLang?, tgtLang?, reason?, decidedBy?, ts?}`。

---

## 8. Proposals（SegmentProposalSet）

- 定义：`packages/cat-data/src/proposals.ts:26-57`，`schemaVersion: 1`。
- 存储形态：
  - SQLite：cat-governance `proposal` stream（parts = `[projectId, batchId, proposalSetId]`），projection `{kind:"proposal", projectId, batchId, proposalSet}`；
  - read-cache：`read-cache/{proj}/proposals/{batch}/{set}.json`（另有 `__index__` 聚合缓存）；
  - legacy JSON：`data/projects/{projectId}/batches/{batchId}/proposals/{proposalSetId}.json`；渲染报告 `batches/{batchId}/reports/{proposalSetId}.md`。
- `SegmentProposalSet{schemaVersion, projectId, batchId, proposalSetId, title, status: active|superseded|closed, supersedesProposalSetId?, supersededByProposalSetId?, closedAt?, createdAt, updatedAt, proposals[]}`。
- `SegmentProposal{proposalId, index, segmentId, source, originalTarget, proposedTarget, reason, changeType, evidenceSources: string[], severity?, status: proposed|applied|rejected|skipped, createdAt, updatedAt, appliedAt?, skipReason?}`。
- PB-091 对应：**artifact references ← `evidenceSources`**；QA 状态一部分 ← `status` + `appliedAt` + set 的 supersede 链。

---

## 9. QA 状态三件套（checklist / ledger / export audit）

### 9.1 QualityDecisionLedger（hash 链账本）

- 定义：`packages/cat-data/src/quality_decision_ledger.ts`；事件 `schemaVersion: 1`。
- 存储形态：SQLite cat-governance `ledger` stream（projection `{kind:"ledger", projectId, events[]}`）；read-cache `read-cache/{proj}/ledger.json`；legacy `data/projects/{projectId}/quality_decision_ledger.jsonl`（每行一事件）。
- 事件字段（与 mapping 合约一致）：`projectId, batchId?, workflowId?, segmentId?, findingId?, code?, severity?: blocker|major|minor|warning|advisory|info, kind: quality_finding|quality_waiver|delivery_finding|delivery_waiver|team_finding|team_decision|export_authorization, decision: open|ignore_with_reason|accepted_risk|authorized|blocked|accept|reject|query|fix_required, reason?, evidenceRefs?[], actor?, recordedAt?, logicalEventId?, sequence（从 1 连续）, previousHash?, hash`。
- scanner 要点：`hash = sha256(JSON.stringify(除 hash 外的事件))`，`previousHash` 链式——可整体校验链完整性，校验失败记 health/error 而不是丢弃；`logicalEventId` 为幂等键；**hash 原样保留，不得重算覆盖**。
- PB-091 对应：QA 状态 ← segmentId 相关事件（finding/waiver 的 decision）；artifact references ← `evidenceRefs`。

### 9.2 QualityChecklist

- 定义：`packages/cat-data/src/quality_checklist.ts:22-28`，`schemaVersion: 1`。
- 存储：governance `checklist` stream / read-cache `checklist.json` / legacy `data/projects/{projectId}/quality_checklist.json`。
- 字段：`projectId, updatedAt, mechanicalOptions, entries[{id, name, scope: source|target|either, pattern, flags?, severity: blocker|warning|info, status: active|disabled, message?}]`。

### 9.3 ExportAuditRecord（导出审计）

- 定义：`packages/cat-data/src/delivery.ts:95-121`，`schemaVersion: 1`。
- 存储：governance `export-audit` stream / legacy `data/projects/{projectId}/exports/export_audit.jsonl`。
- 关键字段：`auditId, exportedAt, projectId, batchId, format, outputPath, sourceFile, masterFile?, updatedSegments, missingIds[], deliveryStatus, rulesDigest, blockerCodes[], warningCodes[], deliveredTargets: [{segmentId, targetSha256, targetBytes}], force, role?: T|E|P, templateDocxPath?`。
- PB-091 对应：artifact references ← `outputPath` + `deliveredTargets[].targetSha256`（已交付 target 的逐段 digest）。

---

## 10. Task workspace（snapshot / events / queue / profile）

- 定义：`packages/cat-data/src/task_workspace_contract.ts`（v2，见 §0）、`task_message_queue_contract.ts`（v1）、`packages/cat-server/src/task_package_profile.ts`（v1）。
- Legacy JSON 布局（`packages/cat-data/src/task_workspace.ts:268-322`）：
  - standalone 任务：`data/assistant/tasks/{taskId}/`；project 任务：`data/projects/{projectId}/task_workspace/tasks/{taskId}/`。
  - 每任务目录文件：
    - `snapshot.json` — `TaskWorkspaceSnapshot{schemaVersion:2, task, activeRunId, eventCursor, projectedAt, usage?, runs[], agentThreads[], activities[], artifacts[], decisions[]}`。完整字段白名单见 mapping 合约 `task_workspace` source（26 实体）。
    - `events.jsonl` — 追加式 run 事件日志；行 = `{recordType:"task_run_event_page_v1", page:TaskRunEventPage}` 或裸 `TaskRunEvent{id, cursor, seq, taskId, runId, agentThreadId?, type: run_upsert|thread_upsert|activity_append|artifact_upsert|decision_upsert|usage_update, occurredAt, run?/thread?/activity?/artifact?/decision?/usageSource?/usage?}`。**末行撕裂（torn trailing line）可容忍**；`seq` 从 1 连续、id/cursor 唯一；游标格式 `${taskId}:${seq}`。
    - `message_queue.json` — `TaskMessageQueue`（v1，见 §0）。
    - `resource-profile.json` — `{schemaVersion:1, taskId, revision, selections[], executableApprovals[], updatedAt}`（仅 project 任务）。
    - 其他：`workspace/attachments/`（standalone）、`migration.json`（legacy Home 迁移标记）。
- SQLite 形态：task-aggregate 域，`legacy-task-*` / `legacy-queue-*` / `legacy-resource-*` / `legacy-quality-*` streams（§1.3）；projection = 完整 snapshot JSON。authority marker 中 per-task 记录 `workspaceSourceDigest/sideStateSourceDigest` 可做 digest 对照。
- PB-090/093 要点：`activities[]`（type=message 等）与 `agentThreads[]` 是聊天历史的 workspace 内载体；`TaskArtifact.content` **恒为 inline JSON**（无 blob 间接层）；`thread.piSessionFile` 是路径引用，不是字节。

---

## 11. Chat history（PB-093：只迁为 read-only archived transcript）

三载体并查 "chat history presence"：

| 载体 | 位置（相对旧仓根） | 格式 |
|---|---|---|
| Pi session 文件（canonical） | project：`data/projects/{projectId}/_pi_sessions/{fileTimestamp}_{sessionId}.jsonl`；global：`data/assistant/_pi_sessions/*.jsonl` | 树形 JSONL：首行 header `{type:"session", version:3, id, timestamp, cwd, parentSession?}`；entry `type ∈ message/compaction/branch_summary/custom_message/label/model_change/thinking_level_change/session_info/text`，id/parentId 树。旧文件 version 可为 1/2 |
| chat.json 镜像（扁平） | project：`data/projects/{projectId}/chat.json`；Home：`data/assistant/home_chat.json`、`data/assistant/chat.json` | JSON 数组，行 `{ts(ISO), kind: user\|assistant\|tool\|system\|error, text, sessionId?, sessionFile?, toolCallId?, usage?{inputTokens?, outputTokens?, totalTokens?, costUsd?, modelCalls?}}`（`legacy_task_backfill.ts:37-53`） |
| Task workspace 内 | §10 的 `snapshot.json` | `agentThreads[]`（含 `piSessionId/piSessionFile/piEntryId/branchPointEntryId/branchPosition` 指针）+ `activities[]` |

- 选中指针：`data/projects/{id}/agent_selected_session.json`、`data/assistant/agent_selected_session.json`（`{selectedSessionId?, selectedAt?, pendingBranchEntryId?, ...}`）。
- presence 判定建议：`_pi_sessions/` 有非空 `.jsonl`（只读 header 行 + 行数即可），或 `chat.json`/`home_chat.json` 为长度>0 数组，或 snapshot 含带 `piSessionId` 的 thread / 消息类 activity。无 sessionId 的 chat.json 行 → 记 `malformed_chat_session`。
- **永不导入**：`data/projects/{id}/agent_events.jsonl`（hidden reasoning trace）；`_pi_sessions` 只迁为 archived transcript artifact，不重建可执行会话（PB-093）。

---

## 12. Source digest 与 CAS blob store

- **CatCoreSourceRef（PB-091 source digest 的正主）**：`packages/cat-data/src/cat_core_storage.ts:13-22` — `{id, projectId, ownerKind: "batch"|"asset", ownerId, path, sha256, bytes, blobRefId}`。**仅存 SQLite cat-core `source` stream（无 read-cache、无 legacy JSON）**；`sha256` 即源文件内容 digest，`blobRefId` 指向 CAS blob（= 内容 sha256）。scanner 读不到 SQLite 时可用 `batch.sourceFile` 路径自行重算 sha256 兜底比对。
- CAS blob 布局（`packages/storage-sqlite/src/blob_store.ts`，各域 blob 根见 §1.2）：
  - `blobs/sha256/<前2位hex>/<64位hex>` — 内容寻址字节（落盘 0444）；
  - `refs/sha256/<前2位>/<sha256(refId)>.json` — `ContentBlobReferenceManifestV1{schemaVersion:1, refId, revision, createdAt, blobs[{schemaVersion:1, sha256, bytes}], manifestSha256}`；
  - `.staging/`、`.locks/` 可能有孤儿。
  - 读 blob 须重算 sha256 + 核字节数。
- legacy Task 的 source digest 公式（authority marker 中 `workspaceSourceDigest` 的记录值）：`legacy_task_importer.ts:95-106`（`sha256(JSON [{relativePath, sha256, bytes}...])`）；side state 为 `legacy_task_side_importer.ts:219-225`（name\0bytes\0 级联 sha256）。scanner 可复算对照。
- 其他 digest 落点：asset block 的 `sourceDigest`、export audit 的 `deliveredTargets[].targetSha256`、ledger 事件 `hash`。

---

## 13. Project health（无持久化，scanner 自算）

- 定义：`packages/cat-data/src/project_health.ts:31-52`（`ProjectHealthReport`）。**运行时任算，磁盘上无 health 文件**。
- 维度：`status: pass|warn|fail`、`summary{assets, suggestedActions, missingImports, addedAssets, removedAssets, changedAssets, batches, deliveryFailures, deliveryWarnings, unappliedProposalRows}`、`issues[{severity, code, message, assetPaths?, batchIds?, nextActions?}]`、`batches[{batchId, format, totalSegments, lockedSegments, status, blockers, warnings}]`。
- scanner 应按同维度重算：manifest.scan.assets vs 磁盘实况、batch delivery 状态、ledger 链、SQLite `streams.revision` vs `events` 最大 sequence、`PRAGMA quick_check`、blob 孤儿统计。

---

## 14. PB-091 必须保留字段 → 旧 schema 对照表

| PB-091 要求 | 旧仓位置 | 旧字段名 |
|---|---|---|
| Segment order | `batch.json` / cat-core `batch` stream | `CatBatch.segments[]` 数组顺序 + `BatchSegment.index` |
| source | 同上 | `BatchSegment.source`（原始态 `rawSource`） |
| target | 同上 | `BatchSegment.target`（初始态 `originalTarget?`，原始态 `rawTarget`） |
| locked | 同上 | `BatchSegment.locked` |
| revisions 最终语义 | 同上 + SQLite | 无逐段历史链；保留当前值 + `BatchSegment.updatedAt?/updateReason?/updateChangeType?/updateEvidenceSources?`；流级 `streams.revision`、`events.sequence`、`TaskArtifact.version` |
| TM | `tm.json` / cat-core `tm` stream | `TmEntry` 全字段（含 `origin, sourceKind, sourceBatchId, sourceSegmentId`） |
| TB | `termbase.json` + `termbase_overrides.json` / cat-core `termbase` stream | `TermbaseEntry` + `TermbaseOverride` 全字段 |
| QA 状态 | batch + governance | `BatchSegment.status/confirmationLevel`；proposal `status/appliedAt`；ledger 事件（`kind/decision/severity/reason`，hash 链原样保留）；checklist `entries[].status` |
| artifact references | proposals / ledger / export audit / task workspace | proposal `evidenceSources[]`；ledger `evidenceRefs[]`；ExportAuditRecord `outputPath`、`deliveredTargets[].targetSha256`；`activity.refs.artifactIds`、`TaskArtifact.id/version/provenance` |
| source digest | cat-core `source` stream / blob-store / authority marker | `CatCoreSourceRef.sha256/bytes/blobRefId`；marker `workspaceSourceDigest/sideStateSourceDigest`；兜底 = 对 `batch.sourceFile` 重算 sha256 |

不要求迁入旧 Agent Runtime state（PB-091）：`excludedRuntimeFields`（`ResolvedTaskRunResources.verifiedPiBinaryPath`、`TaskPackageResolvedResource.path`、live handles/credentials）明确排除。

---

## 15. Scanner 读取清单（汇总表）

| # | 结构 | 权威源判定 | SQLite（stream 前缀 / 域） | legacy JSON 路径（相对旧仓根） | schemaVersion | scanner 要点 |
|---|---|---|---|---|---|---|
| 1 | Project list / index | 派生 | cat-core `cat-core-manifest-*` ∪ 目录扫描 | `data/projects/*/project.json` | manifest v1 | 双侧对账列 orphan；目录无 manifest → health/error |
| 2 | ProjectManifest / source roots | authority-v1.json (cat-core) | cat-core `manifest` stream（id=root） | `data/projects/{id}/project.json` | 1 | `root` 即 source root；未知键 → unsupported |
| 3 | assets | 随 manifest | （嵌于 manifest projection） | （嵌于 project.json `scan.assets`） | 随 manifest | DiscoveredAsset 全量 + role decisions |
| 4 | internal uploads/imports | 文件系统 | — | `data/projects/{id}/uploads/` | — | 按文件枚举；PB-092 managed copy 落点 |
| 5 | asset 派生索引 | 文件系统 | — | `asset_blocks.jsonl`、`asset_typed_index.json` | typed index v1 | 可重建，不必迁；`sourceDigest` 可交叉校验 |
| 6 | Segments（batch） | authority-v1.json (cat-core) | cat-core `batch` stream | `data/projects/{id}/batches/{safeBatchId}/batch.json` | 1 | 数组序=order；保留 source/target/locked/status/updatedAt 等 |
| 7 | TM | authority-v1.json (cat-core) | cat-core `tm` stream | `data/projects/{id}/tm.json`（+`tm_audit.jsonl` 审计） | 无（裸数组） | 全量 TmEntry |
| 8 | TB | authority-v1.json (cat-core) | cat-core `termbase` stream `{entries,overrides}` | `termbase.json` + `termbase_overrides.json` | 无 | 两种形状都支持 |
| 9 | Proposals | authority-v1.json (governance) | cat-governance `proposal` stream | `batches/{batchId}/proposals/{setId}.json` | 1 | `evidenceSources/status/appliedAt` 必留 |
| 10 | QA ledger | authority-v1.json (governance) | cat-governance `ledger` stream | `quality_decision_ledger.jsonl` | 事件 v1 | 校验 sequence/previousHash/hash 链；hash 不重算 |
| 11 | Quality checklist | authority-v1.json (governance) | cat-governance `checklist` stream | `quality_checklist.json` | 1 | — |
| 12 | Export audit | authority-v1.json (governance) | cat-governance `export-audit` stream | `exports/export_audit.jsonl` | 1 | `deliveredTargets[].targetSha256` |
| 13 | Task workspace | authority-v1.json (task-aggregate) | task-aggregate `legacy-task-*` | `{data/assistant/tasks\|data/projects/{id}/task_workspace/tasks}/{taskId}/snapshot.json` + `events.jsonl` | 2 | events.jsonl 容忍 torn 末行；seq 连续 |
| 14 | Message queue | 同上 | task-aggregate `legacy-queue-*` | 同目录 `message_queue.json` | 1 | paused 不变式 |
| 15 | Resource profile | 同上 | task-aggregate `legacy-resource-*` | 同目录 `resource-profile.json`（仅 project 任务） | 1 | `revision/integrity` 原样保留 |
| 16 | Chat history presence | 文件系统 | — | `_pi_sessions/*.jsonl`、`chat.json`、`home_chat.json`、`agent_selected_session.json` | session header v3（旧可为 1/2） | presence 即可；PB-093 迁 archived transcript；`agent_events.jsonl` 永不导入 |
| 17 | Source digest / CAS | authority-v1.json (cat-core) | cat-core `source` stream + `blob-store/` | 无 | ref manifest v1 | `CatCoreSourceRef.sha256/blobRefId`；blob 重算校验 |
| 18 | health | 自算 | `PRAGMA quick_check` 等 | 全面对账 | — | 按 §13 维度重算，无持久文件 |
| 19 | unsupported fields | 自算 | `mapping_contracts` 表 + 各合约 | 同左 | contract v1 | 实体键集 − 合约白名单（mapping 合约 5 source + 各 v1 接口） |
| 20 | digest（scanner 输出） | 自算 | — | — | — | 复算 §12 各 digest 公式 + 对实际读取文件清单做 sha256 级联 |

---

## 16. 已知边界与注意点

- SQLite 只读：优先打开副本（`.sqlite` + `-wal`），或 `immutable=1`；`user_version > 2` → unsupported domain。
- `authority:"legacy"`（rollback）状态下 legacy JSON 重新成为权威，scanner 两种 marker 值都要识别。
- 可选字段按来源格式缺失（`originalTarget/rawSource/confirmationLevel/conceptId/fields/sourceDigest/masterFile` 等）→ 记 notes，不报错。
- 旧仓无 project 级 permission 字段；invalid `full` permission 若出现属于外部/新仓概念，记录后继续扫描（PB-092）。
- 相邻域（assistant memory/library、workflow-eval、settings-grants-trust、lapkg、term_history、glossary、voice_profile 等）本次未逐一展开；PB-090 如需 full inventory 可后续补一轮。
