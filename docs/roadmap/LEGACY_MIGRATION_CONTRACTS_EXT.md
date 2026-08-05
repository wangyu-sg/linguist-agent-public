# LEGACY_MIGRATION_CONTRACTS_EXT — 旧仓数据合约盘点补充（§16 未尽域）

- 日期：2026-07-25
- 依据：《LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md》v1.0，Batch 9（PB-090 ~ PB-094）
- 性质：**调研草案**。仅基于旧仓 `/Users/<local>/Desktop/linguist-agent`（已冻结）的源码/schema 只读调研，未打开旧仓 `data/**` 下任何真实数据文件，未经 PB-090 实现验证；实现时如对真实副本扫描结果与本文冲突，以实测为准并回写本文。
- 本文是 `docs/roadmap/LEGACY_MIGRATION_CONTRACTS.md`（下称"主文档"）的**补充**：展开主文档 §16 标注的未尽相邻存储域（assistant memory/library、workflow-eval、settings-grants-trust、lapkg），并补录调研中发现的其他主文档未覆盖存储。主文档已覆盖的 17 种结构不在此重复。

调研方法：与主文档相同——只读旧仓 `packages/` 源码（cat-data / cat-server / storage-sqlite），未做任何 git 操作，未触碰 `data/**`。下文所有相对路径均相对旧仓根。通用 event-projection store 表结构、`authority-v1.json` 双形态判定、只读打开要点见主文档 §1.2/§1.3，本文不再重复。

---

## 1. Assistant Memory（助手记忆）

- 定义：`packages/cat-data/src/assistant_memory.ts`，`AssistantMemoryFileV1{schemaVersion:1, scope, entries[], updatedAt}`。严格解析器 `parseAssistantMemoryFile()` 同时服务 SQLite cutover 与 legacy 只读适配。
- scope 五类：`personal | client:{clientId} | franchise:{franchiseId} | project:{projectId} | locale:{locale}`。**注意**：cutover 只枚举 personal + project 两种 scope（`assistant_memory_sqlite_cutover.ts` `discoverSources()`/`sourceIdFor()` 对 client/franchise/locale 直接 throw）；client/franchise/locale 仅有 legacy 路径函数，实际不会出现于 SQLite 域。
- `AssistantMemoryEntry{id, scope, kind: preference|fact|guidance, text, status: proposed|active|revoked|superseded, source:{taskId, activityId?, artifactId?}, revision, createdAt, updatedAt, validFrom?, validUntil?, conflictKey?, confirmedAt?, revokedAt?, supersededAt?, supersededBy?, history: AssistantMemoryHistoryEntry[]}`。`history[]` 为逐 revision 审计（action: proposed|confirmed|edited|revoked|superseded|validity_changed）；`conflictsWith` 是只读派生展示字段，**不落盘**。
- 存储形态：
  - SQLite：assistant-memory 域 `data/runtime/assistant-memory-sqlite-v1/assistant-memory.sqlite`；stream `assistant-memory-<sha256(JSON scope).hex.slice(0,48)>`（`packages/storage-sqlite/src/assistant_memory_repository.ts:27-30`），projection_json **即 `AssistantMemoryFileV1` 本体**（无包装）。repository readiness 声明 `evidencePolicy: "recall-only-not-citable"`。
  - legacy JSON（`assistant_memory.ts:241-247`）：
    - personal：`data/assistant/memory/memories.json`
    - project：`data/projects/{projectId}/memory/memories.json`
    - client/franchise/locale：`data/assistant/memory/scopes/{client|franchise|locale}/{id}/memories.json`
- authority marker：`data/runtime/assistant-memory-sqlite-v1/authority-v1.json`，`AssistantMemorySqliteAuthorityMarkerV1{schemaVersion:1, authority:"sqlite", databaseRelativePath, backupRootRelativePath, cutoverAt, scopes:[{sourceId, scope, sourceSha256, sourceBytes, entryCount, status:"valid"}], excludes:["tdai","semantic-index"]}`。marker `scopes[].sourceSha256` 可做 legacy 文件 digest 对账；cutover 备份在 `data/backups/assistant-memory-cutover-v1/attempt-*`（含 `import-report-v1.json`）。
- PB-090 意义：**记录 presence + 条数即可**（marker 有无、每 scope entryCount）。不属于 PB-090 点名输出，按域级 unsupported 处理，不阻断主流程；语义索引（embedding）被 marker 显式 exclude，无需寻找。
- PB-091 意义：**不迁移**。记忆是助手运行时状态（recall-only、不可引用为证据），不在 PB-091 必须保留字段清单（主文档 §14）内；`source.taskId` 回链的 Task 本身在 PB-093 也只迁为 archived transcript。如未来需要，可按 `AssistantMemoryFileV1` 整体导出为独立存档，与 CAT 数据迁移解耦。

---

## 2. Assistant Library（助手知识库）

- 定义：`packages/cat-data/src/assistant_library.ts`，`StoredLibraryCatalogV1{schemaVersion:1, scope, documents[], updatedAt}`；落盘/传输主体是 `LibraryMetadataFileV1{schemaVersion:1, scope, documents[], blocks[], updatedAt}`（catalog + blocks 合并形）。解析器 `parseLibraryMetadataFile()` 校验文档 id 唯一、无 orphan block。
- scope 两类：`personal | project:{projectId}`。
- `StoredLibraryDocumentV1{id(="library_"+sha256前24), originalName, managedRelPath, sourceDigest(文件字节 sha256), sizeBytes, extension, importedAt, updatedAt, blockCount, parserVersions[], contentBlobRefId?}`；`contentBlobRefId` **仅 SQLite authority 发布**，legacy JSON 无此字段。`LibraryBlockV1` = `AssetBlock`（主文档 §4 同型）+ `documentId`。
- 存储形态：
  - SQLite：assistant-library 域 `data/runtime/assistant-library-sqlite-v1/assistant-library.sqlite`；stream `assistant-library-<sha256(JSON scope).hex.slice(0,48)>`（`packages/storage-sqlite/src/assistant_library_repository.ts`），projection = `LibraryMetadataFileV1` 本体。**文档字节存同域 CAS blob-store** `data/runtime/assistant-library-sqlite-v1/blob-store`（布局见主文档 §12；refId = 内容 sha256）。
  - legacy 目录（`assistant_library.ts:139-155`）：scope 根 personal = `data/assistant/library/personal/`，project = `data/projects/{projectId}/library/`；下含：
    - `catalog.json`（v1，无 blocks）+ `blocks.jsonl`（每行一 `LibraryBlockV1`）——两者合并解析为 metadata；
    - `vectors.jsonl` — 可重建语义索引（marker `excludes:["semantic-index"]` 显式排除）；
    - `sources/{documentId}/{safeName}` — managed 文档字节（导入时 quarantine 写入并校验 sha256）。
- authority marker：`data/runtime/assistant-library-sqlite-v1/authority-v1.json`，`{schemaVersion:1, authority:"sqlite", databaseRelativePath, blobRootRelativePath, backupRootRelativePath, cutoverAt, scopes:[{sourceId, scope, catalogSha256, catalogBytes, blockCount, documentCount, blobCount, status:"valid"}], excludes:["semantic-index"]}`。备份 `data/backups/assistant-library-cutover-v1/attempt-*`（含 catalog/blocks/vectors/managed 全量副本 + `import-report-v1.json`）。
- PB-090 意义：**presence + catalog 级统计即可**（scope 数、documentCount/blockCount、`sourceDigest` 抽样重算）。`vectors.jsonl` 与 blocks 均为派生物，不必逐块校验。
- PB-091 意义：**不迁移**。知识库属助手资产而非 CAT 项目交付数据；文档字节有 `sourceDigest` 兜底，未来如需接管可按 digest 重新导入重建，无需进 PB-091 合约。

---

## 3. Workflow / Team / Private Eval（workflow-eval 域）

- 定义：`packages/cat-data/src/workflow_eval_storage.ts`（persistence seam，key/value 模型）、`packages/storage-sqlite/src/workflow_eval_repository.ts`（readiness：`domains:["workflow","workflow-artifacts","private-eval-metadata"]`，`excludes:["eval-corpus-bytes","eval-reports"]`）。负载类型分散在 `packages/cat-data/src/workflow_plan.ts`（workflow 定义，schemaVersion:1）、`workflow_artifacts.ts`（`WorkflowArtifacts`，无独立 schemaVersion）、`private_eval.ts`（`PrivateEvalSet/PrivateEvalRun/...`，无 schemaVersion）。
- 存储形态：
  - SQLite：workflow-eval 域 `data/runtime/workflow-eval-sqlite-v1/workflow-eval.sqlite`；stream `workflow-eval-<sha256(key).hex.slice(0,48)>`；projection 包装 = `{kind:"workflow-eval", key, value}`（`workflow_eval_repository.ts:20`），事件 `workflow_eval.updated`。
  - legacy JSON：key → 文件映射以 cutover 枚举为准（`workflow_eval_sqlite_cutover.ts` `sources()`，这是权威清单；注意主文档 §1.3 的 key 示例与此略有出入，**以本文为准**）：

  | key | legacy 路径（相对旧仓根） | 负载 |
  |---|---|---|
  | `artifacts/{projectId}` | `data/projects/{projectId}/workflow_artifacts.json` | `WorkflowArtifacts`（risk queue、phrase QA rows、platform backfill、checkpoints 等） |
  | `workflow/{projectId}/{workflowId}` | `data/projects/{projectId}/workflows/{workflowId}.json` | workflow 定义 v1（cutover 校验 projectId/workflowId 与路径一致） |
  | `eval/{evalSetId}/set` | `data/evals/private/{evalSetId}/eval_set.json` | `PrivateEvalSet` |
  | `eval/{evalSetId}/run/{runId}` | `data/evals/private/{evalSetId}/runs/{runId}/run.json` | `PrivateEvalRun` |
  | `eval/{evalSetId}/outputs/{runId}` | 同目录 `outputs.jsonl` | 逐段输出 |
  | `eval/{evalSetId}/scorecard/{runId}` | `data/evals/private/{evalSetId}/scorecards/{runId}.jsonl` | 评分卡 |
  | `eval/{evalSetId}/blind/{reviewId}` | `data/evals/private/{evalSetId}/blind_reviews/{reviewId}.json` | 盲审 |

  - **显式排除（留 legacy 文件、不进 SQLite）**：`data/evals/private/{id}/segments.jsonl`、`references.jsonl`、`rubric.json`（eval corpus bytes）与 eval 报告文件（`private_eval.ts:629-640`）。scanner 在 `data/evals/private/` 看到这些文件属正常，不是 orphan。
- authority marker：`data/runtime/workflow-eval-sqlite-v1/authority-v1.json`，`{schemaVersion:1, authority:"sqlite", databaseRelativePath, backupRootRelativePath, cutoverAt, records, excludes:["eval-corpus-bytes","eval-reports"]}`。备份 `data/backups/workflow-eval-cutover-v1/attempt-*`（`import-report-v1.json` 仅记 key 清单，无 digest）。
- PB-090 意义：**presence + 可选 key 枚举**。marker 有 `records` 计数可与 stream 数对账；workflow 定义可作 project 附属存在性交叉引用（`workflows/` 目录 ⇔ `workflow/*` streams）。
- PB-091 意义：**不迁移**。评估元数据与 workflow 执行产物属过程数据，非交付物；workflow 定义如需保留可按 v1 JSON 整体存档，不进 PB-091 必须字段合约。

---

## 4. Settings / Grants / Trust（settings-grants-trust 域）

- 定义：`packages/cat-data/src/structured_domain_storage.ts`（`StructuredStorageBackend` seam，未安装后端时 legacy 文件即事实源）、`packages/storage-sqlite/src/settings_grants_trust_repository.ts`（envelope/marker/校验全在此）。三 domain：`settings | grants | trust`。
- 存储形态：
  - SQLite：settings-grants-trust 域 `data/runtime/settings-grants-trust-sqlite-v1/settings-grants-trust.sqlite`；stream **`structured-{domain}-{scope}-{key}`（明文，可枚举）**；projection envelope `{schemaVersion:1, domain, key, scope, payload, payloadSha256}`，`payloadSha256 = sha256(JSON.stringify(payload))`；事件 `structured.{domain}.updated`。
  - legacy 源枚举（`packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts` `collectSettingsGrantsTrustSources()`，权威清单）：

  | sourceId | legacy 路径 | domain | key | scope |
  |---|---|---|---|---|
  | `projects/{projectId}/agent-settings.json` | `data/projects/{projectId}/agent_settings.json` | settings | `agent:{projectId}` | `project:{projectId}` |
  | `standalone/{taskId}/file-grants.json` | `data/assistant/tasks/{taskId}/file_grants.json` | grants | `{taskId}` | `task:{taskId}` |
  | `global/agent-permissions.json` | `data/runtime/agent_permissions.json` | settings | （全局键） | global |
  | `global/notifications.json` | `data/settings/notifications.json` | settings | （全局键） | global |
  | `global/team-role-settings.json` | `data/runtime/team_role_settings.json` | settings | `team-roles` | `global` |
  | `global/pi-extension-trust.json` | `data/runtime/pi_extension_trust.v2.json` | trust | （全局键） | global |
  | `global/pi-trust.json` | `~/.pi/agent/trust.json`（**仓库外**） | trust | （全局键） | global |

  - legacy 导入 envelope：`{schemaVersion:1(源解析失败时置 0 作 invalid), domain, key, scope, revision:0, payload, payloadSha256, secretRefs[]}`。铁律：`secretRefs` 只允许 `keychain:` 前缀引用；payload 递归禁含 secret/token/password/api_key/bearer/credential/private_key 字样键（`assertNoSecrets()`）。
  - file grant 的 payload 里 access 仅 `read | read_write`（`standalone_file_grants.ts`），与主文档 §2 的 permission 结论一致。
- authority marker：`data/runtime/settings-grants-trust-sqlite-v1/authority-v1.json`，`{schemaVersion:1, authority:"sqlite", databaseRelativePath, backupRootRelativePath, cutoverAt, sources:[{sourceId, domain, key, scope, sourceSha256, sourceBytes, payloadSha256, status:"valid"}], excludes:["provider-secrets","pi-native-settings"]}`。备份 `data/backups/settings-grants-trust-cutover-v1/attempt-{uuid}/`（含 `import-report-v1.json`，invalid 非零即阻断 cutover）。
- PB-090 意义：**presence + marker 读取即可**。可按 `structured-` 前缀枚举 stream 与 marker `sources[]` 对账；`pi-trust` 源在仓库外（`~/.pi/agent/`），scanner 不应越出数据根去找它，缺失记 note。**provider secrets 不在数据根**（Keychain），scanner 任何情况下不得尝试读取/迁移。
- PB-091 意义：**不迁移**。settings/grants/trust 是旧运行环境的授权与偏好状态，属新仓应重新建立的安全上下文（trust 决定尤其不可继承）；仅建议在迁移报告中附 presence 摘要供用户知情。

---

## 5. lapkg / Package v2（package-registry 域）

- 定义：`packages/cat-server/src/lapkg_activation.ts`（`LapkgRegistryV2`/`ActivatedLapkgRecordV2`，schemaVersion:2；`parseLapkgRegistry()` 逐字段校验）、`packages/cat-server/src/lapkg_activation_journal.ts`（journal/recovery block v1）、`packages/cat-server/src/lapkg_package_storage.ts`（存储 seam 与路径常量）。
- 存储形态：
  - legacy 根 `data/assistant/capabilities/packages-v2/`（`lapkgV2Root()`）：
    - `registry-v2.json` — `LapkgRegistryV2{schemaVersion:2, revision, packages: ActivatedLapkgRecordV2[]}`；record 含 `packageId, packageVersion, publisherId, license, activatedAt, activationRevision, previewPlanHash, source{schemaVersion:1, kind: local_file|catalog, sourceId, acquiredAt, expectedArchiveSha256}, signer{schemaVersion:1, keyId, payloadSha256, treeHash, verifiedAt, ...}, archiveSha256, manifestSha256, treeHash, contentDirectory(恒为 "content/{treeHash}"), contentBlobRefId?, resources[]`。
    - `content/{treeHash}/resources/...` — 逐资源文件；每资源 `{id, type, path("resources/"前缀), sha256, size, mediaType?}`，cutover 时逐字节重算 sha256 校验。
    - `activation-journal-v1.json` / `recovery-blocked-v1.json` — 可选的激活中断恢复记录（`lapkg_activation_journal.ts:44-49`）。
  - SQLite：package-registry 域 `data/runtime/package-registry-sqlite-v1/package-registry.sqlite`；**固定 3 条 stream**：
    - `lapkg.registry.v2` — projection = `LapkgRegistryV2` 本体；事件 `registry_updated`（payload 带 `registrySha256`）。
    - `lapkg.activation-journal.v1` — projection `{schemaVersion:1, present:boolean, journal?}`。
    - `lapkg.recovery-block.v1` — projection `{schemaVersion:1, present:boolean, block?}`（block: `{schemaVersion:1, activationId|null, reason, blockedAt}`）。
  - CAS blob：`data/assistant/capabilities/packages-v2/blob-store`（布局见主文档 §12）；content refId = `lapkg:sha256("{packageId}\0{packageVersion}\0{treeHash}")`（`lapkg_package_storage.ts:69-75`）；cutover 后 record 增挂 `contentBlobRefId`。
  - cutover 备份：`data/runtime/package-registry-sqlite-v1/legacy-v2-backup/registry-v2.json`。
- authority marker：`data/runtime/package-registry-sqlite-v1/authority-v1.json`，`{schemaVersion:1, authority:"sqlite", databaseRelativePath, blobRootRelativePath, backupRootRelativePath, cutoverAt, sourceRegistrySha256, packageCount}`。
- PB-090 意义：**presence + 对账**。marker `packageCount` ⇔ registry stream `packages.length`（cutover 代码即以此自验）；`sourceRegistrySha256` 可与 legacy `registry-v2.json` 重算比对；registry 内 `contentDirectory`/digest 字段已自校验，scanner 不必逐资源重算（量级允许时可抽验 blob `manifestSha256`）。
- PB-091 意义：**不迁移**。能力包是工具链资产（带签名/信任链），不是项目数据；新仓如需同名能力应按 treeHash 走自己的安装通道重装，继承旧激活记录反而会绕过新仓签名策略。

---

## 6. 其他 legacy-only 项目级存储（无 SQLite cutover，主文档未覆盖）

以下均只存在于 `data/projects/{projectId}/` 下、无任何 authority marker（纯 legacy JSON/JSONL，权威源即文件本身）。主文档 §16 点名的 term_history、glossary、voice_profile 在此一并补齐，另补录调研中新发现的同目录文件。

| 结构 | 定义文件 | 路径（相对项目根 `data/projects/{projectId}/`） | schemaVersion | 内容要点 |
|---|---|---|---|---|
| TermHistory | `packages/cat-data/src/term_history.ts:119` | `term_history.json` | 无 | `TermHistoryIndex{rows: TermHistoryRecord[], decisions: TermHistoryDecision[]}`；术语变更行（old/new source/target、finalConfirm、updateDate、updatedBy 等 17 字段）+ 按 source 的裁定（status: current\|deprecated\|conflict\|unconfirmed_later_row\|pending\|deleted，含 evidenceRows） |
| Glossary | `packages/cat-data/src/glossary.ts:51` | `glossary.json` | 无（裸数组） | `GlossaryEntry[]{id, source, target, note?, sourceFile, rowNo}`；delivery QA 的独立术语权威（与 TB 并列，`delivery_qa.ts:501`） |
| VoiceProfile | `packages/cat-data/src/voice_profile.ts:44` | `batches/{batchId}/voice_profile.json` | 1 | `{schemaVersion:1, profile: VoiceProfile\|null}`（容忍裸 profile 直接写入）；profile 含 `status: not_started\|draft\|confirmed`、`entries[]`（textType/speaker/register/toneMarkers/taboos 等）、`roster[]` |
| VoiceExemplars | `packages/cat-data/src/voice_exemplars.ts:52` | `voice_exemplars.jsonl` | 行级无（list 视图 v1） | JSONL，行 = `VoiceExemplar{id, textType, speaker, register, source, target, origin, evidenceSource, srcLang?, tgtLang?, createdAt}` |
| TagRules | `packages/cat-data/src/tag_rules.ts:10` | `tag_rules.json` | 1 | `TagRuleDocument{schemaVersion:1, projectId, generatedAt, updatedAt, rulesDigest("sha256:"+hex), rules[], disabledBuiltinIds[], onboarding, trace[]}` |
| CustomerReturns | `packages/cat-data/src/customer_returns.ts:38` | `customer_returns.json` | 1（容忍裸数组） | `{schemaVersion:1, reports: CustomerReturnLearnReport[]}`；report 含 `batchId, learnedAt, sourceFile, changedRows, reviewedTmUpdated, rows[{source, previousTarget, returnedTarget, rowNo, evidenceSource, ...}]` |
| ReadinessDecisions | `packages/cat-data/src/readiness_decisions.ts:26` | `readiness_decisions.jsonl` | 无（JSONL 事件） | 行 = `{ts, projectId, kind: accept_warning\|reopen_warning, warningPattern, reason, decidedBy}`；append-only |
| AssetMappingProfiles | `packages/cat-data/src/asset_mapping_profiles.ts:5` | `asset_mapping_profiles.json` | 无（裸数组） | `AssetMappingProfile[]`；id = `mapping-<sha1前12>`（由 projectId/assetPath/parseMode/confirmedMappings/confirmedAt 派生），列映射确认记录 |

- PB-090 意义：**必须扫描**（presence + 解析）。它们在项目目录内、纯 JSON 低成本，且含用户数据；全部按 legacy JSON 直读，无 marker 分支。解析失败入 health/errors，不阻断。
- PB-091 意义：分两类——
  - **建议随项目作只读存档迁移**：`term_history.json`、`glossary.json`（二者直接参与术语权威与 delivery QA 语义，丢弃会改变 QA 判定上下文）；`customer_returns.json`（客户返回学习记录，含 TM 回写 provenance）。
  - **不必迁移**（派生/配置，新仓可重建或不适用）：`voice_profile.json`、`voice_exemplars.jsonl`（文风资产，PB-091 清单外）、`tag_rules.json`（规则引擎产物，`rulesDigest` 可重算）、`readiness_decisions.jsonl`（旧 readiness 门槛的豁免记录，新仓无对应门槛）、`asset_mapping_profiles.json`（导入向导的列映射缓存，重导时重确认即可）。

---

## 7. 环境性 / 可重建 / 瞬态存储（scanner 可安全忽略）

以下在扫描中可能出现，均已确认**无迁移价值**，presence 都不必记（除非做 full inventory 标注）：

| 存储 | 定义文件 | 路径（相对旧仓根） | 忽略理由 |
|---|---|---|---|
| 本地 embedding pack | `packages/cat-data/src/local_embeddings.ts:61` | `data/assistant/capabilities/embeddings/multilingual-e5-small/{revision}/`（ONNX 模型 + tokenizer + `capability-lock.json`） | 可从 HuggingFace 按 lock 重下；memory/library marker 均显式 exclude semantic-index |
| Managed document capabilities | `packages/cat-data/src/document_capabilities.ts:133` | `data/assistant/capabilities/documents/{id}/`（python runtime / venv） | 可重装运行时；状态机 missing/corrupt/unqualified/ready/unsupported 为运行时任算 |
| Legacy Package Center v1 | `packages/cat-server/src/package_center.ts:178-196`、`legacy_package_inventory.ts` | `data/assistant/capabilities/packages/`（`catalog-v1.json`、`installed-v1.json`、`installed/`、`.quarantine/`） | 已被 packages-v2（§5）取代；v1 无签名信任链 |
| 文档暂存 | `packages/cat-runtime/src/documentRouter.ts:134` | `data/assistant/document-staging/` | 瞬态 staging，随任务结束清理 |
| Pi 设置审计 | `packages/cat-server/src/server.ts:1338-1342` | `data/runtime/pi_settings_audit.jsonl` | append-only 审计日志，旧 pi 设置变更的历史记录，无运行时语义 |
| Trusted extensions staging | `packages/cat-server/src/pi_extension_trust.ts:42-46` | `data/runtime/trusted-extensions/` | staged 扩展字节；信任决定本身已在 trust 域（§4） |
| Maintainer agent sessions | `packages/cat-server/src/maintainer_migration_agent.ts:20` | `data/assistant/maintainer/sessions/{planHash}/` | 维护 agent 工作目录 |
| 各域 cutover 备份 | 各 `*_sqlite_cutover.ts` | `data/backups/{domain}-cutover-v1/attempt-*/`、lapkg 的 `legacy-v2-backup/` | cutover 前 legacy 源的只读副本 + `import-report-v1.json`；可作 digest 对账参考，本身不迁 |
| 语义索引派生物 | §1/§2 | `vectors.jsonl`（library、asset_vectors）、memory tdai/semantic-index | marker excludes 明确排除；可重建 |

---

## 8. Scanner 读取清单（增量表，接续主文档 §15）

| # | 结构 | 权威源判定 | SQLite（stream 前缀 / 域） | legacy JSON 路径（相对旧仓根） | schemaVersion | scanner 要点 | PB-091 |
|---|---|---|---|---|---|---|---|
| 21 | Assistant Memory | authority-v1.json (assistant-memory) | assistant-memory `assistant-memory-*`（projection = 文件本体） | `data/assistant/memory/memories.json`、`data/projects/{id}/memory/memories.json`、`data/assistant/memory/scopes/{kind}/{id}/memories.json` | 1 | presence + entryCount 对账；域级 unsupported，不阻断 | 不迁移 |
| 22 | Assistant Library | authority-v1.json (assistant-library) | assistant-library `assistant-library-*` + 同域 blob-store | `{data/assistant/library/personal \| data/projects/{id}/library}/{catalog.json, blocks.jsonl, sources/}` | 1 | presence + document/block 计数；`sourceDigest` 抽验；`vectors.jsonl` 跳过 | 不迁移 |
| 23 | Workflow / Eval | authority-v1.json (workflow-eval) | workflow-eval `workflow-eval-*`（projection `{kind,key,value}`） | `data/projects/{id}/{workflow_artifacts.json, workflows/*.json}`、`data/evals/private/{id}/**` | workflow v1；eval 无 | key 清单以 cutover `sources()` 为准；`segments/references/rubric` 与报告是显式排除项，非 orphan；`records` 计数对账 | 不迁移 |
| 24 | Settings / Grants / Trust | authority-v1.json (settings-grants-trust) | settings-grants-trust `structured-{domain}-{scope}-{key}`（明文） | `agent_settings.json`、`file_grants.json`、`data/runtime/{agent_permissions, team_role_settings, pi_extension_trust.v2}.json`、`data/settings/notifications.json`、`~/.pi/agent/trust.json`（仓库外） | envelope v1 | presence + marker sources 对账；secrets 只在 Keychain，scanner 不碰；仓库外源缺失记 note | 不迁移 |
| 25 | lapkg / Package v2 | authority-v1.json (package-registry) | package-registry 固定 3 stream：`lapkg.registry.v2`、`lapkg.activation-journal.v1`、`lapkg.recovery-block.v1`；blob 根 `data/assistant/capabilities/packages-v2/blob-store` | `data/assistant/capabilities/packages-v2/{registry-v2.json, content/, activation-journal-v1.json, recovery-blocked-v1.json}` | registry v2 / journal v1 | `packageCount` ⇔ registry.packages.length；`sourceRegistrySha256` 重算比对 | 不迁移 |
| 26 | TermHistory | 无 marker（legacy 唯一） | — | `data/projects/{id}/term_history.json` | 无 | 纯 JSON 直读，必须扫描 | 建议只读存档迁移 |
| 27 | Glossary | 无 marker（legacy 唯一） | — | `data/projects/{id}/glossary.json` | 无（裸数组） | 必须扫描；QA 术语权威之一 | 建议只读存档迁移 |
| 28 | CustomerReturns | 无 marker（legacy 唯一） | — | `data/projects/{id}/customer_returns.json` | 1（容忍裸数组） | 必须扫描；含 TM 回写 provenance | 建议只读存档迁移 |
| 29 | VoiceProfile / VoiceExemplars | 无 marker（legacy 唯一） | — | `batches/{batchId}/voice_profile.json`、`voice_exemplars.jsonl` | 1 / 行级无 | presence + 解析 | 不迁移（可重建/清单外） |
| 30 | TagRules | 无 marker（legacy 唯一） | — | `data/projects/{id}/tag_rules.json` | 1 | presence；`rulesDigest` 可重算校验 | 不迁移 |
| 31 | ReadinessDecisions | 无 marker（legacy 唯一） | — | `data/projects/{id}/readiness_decisions.jsonl` | 无（JSONL） | presence 即可 | 不迁移 |
| 32 | AssetMappingProfiles | 无 marker（legacy 唯一） | — | `data/projects/{id}/asset_mapping_profiles.json` | 无（裸数组） | presence 即可 | 不迁移 |
| 33 | 环境性/瞬态存储（§7 全表） | — | — | embedding pack、capabilities/{documents,packages}、document-staging、cutover 备份等 | — | **安全忽略**；cutover 备份的 `import-report-v1.json` 可选作对账参考 | 不迁移 |

---

## 9. 补充边界与注意点

- 本文所有域的 SQLite 侧只读打开要点、`user_version > 2 → unsupported domain`、rollback（`authority:"legacy"`）识别，与主文档 §16 完全一致，不重复。
- 本文五个 SQLite 域的 marker 解析**只认 `authority:"sqlite"`**：memory/library/settings-grants-trust/lapkg 的 parse 函数对其他值直接抛错，workflow-eval 对已存在 marker 仅做 `JSON.parse` 强转不校验。主文档 §1.2 的 `authority:"legacy"`（rollback）分支来自 task-aggregate 域（`task_aggregate_legacy_rollback.ts`），不适用于本文各域；若实测在本文域出现其他 authority 值，记 invalid marker 后按 legacy 文件兜底读取。
- assistant-memory 的 client/franchise/locale scope 只有 legacy 路径函数、cutover 明确不支持——scanner 在 `data/assistant/memory/scopes/` 命中文件时按 legacy-only 读取并记 note（属正常存在，非异常）。
- workflow-eval 的 key 前缀以此文 §3 表为准（`artifacts/`、`workflow/`、`eval/`）；主文档 §1.3 示例 key（`project/{projectId}/workflow/{file}`）与 cutover 实现不符，属于主文档笔误级偏差，回写主文档时可一并修正。
- settings-grants-trust 的 legacy 源里 `~/.pi/agent/trust.json` 在数据根之外：scanner 边界 = 旧仓数据根，仓库外文件一律不读，presence 记 `external_reference`。
- `quality_audit.ts` 的 `QualityAuditReport`（schemaVersion:1）**运行时任算、不落盘**（findings 经 `qualityAuditFindingLedgerEvents()` 写入主文档 §9.1 的 ledger），无独立存储域。
