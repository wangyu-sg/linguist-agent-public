# PB-110 CAT 安全审查：证据与缺口（提前调研草案）

- **分析快照日期**：2026-07-25
- **依据**：`LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md` v1.0，Batch 11 / PB-110（计划文第 2293–2304 行）
- **代码基线**：HEAD `3293e8d2`（tag `pb-g7-vertical-product`，G7 已通过）+ 工作树未提交改动
- **性质**：提前调研草案，为 PB-110 正式审查预置证据索引与缺口清单；**正式审查结论以 PB-110 工单为准**，本文不替代该工单。
- **PB-080 in-flight 提示**：快照含另一工程师进行中的 PB-080（TM/TB 管理）未提交半成品，涉及 `packages/linguist-cat-tools/src/factory.ts`、`types.ts`、`packages/linguist-cat-store/src/repositories/tm-units.ts`、`term-entries.ts`、`schema.ts`（migration 4）、`packages/shared/src/types/linguist.ts`、新增 `apps/electron/src/main/lib/linguist/reference-ipc.ts` 等。本文以磁盘当前内容为准分析；**PB-080 落地后，第 1、6、7、8 项中涉及 TM/TB 的条目必须复核**。
- 路径均相对仓库根；引用形式为 `文件:行号`。

---

## 1. CAT Tool 不能跨 Project 操作 —— 部分

**现状证据**

- 工具入参在类型层面不含 projectId：`packages/linguist-cat-tools/src/types.ts:40-43`（`LinguistCatToolCallInfo` 只带 toolName/toolCallId）；工厂头注释 `factory.ts:4-7` 明示 projectId 只来自会话绑定。
- 每次调用经注入的 resolver 解析绑定项目：`factory.ts:102-106`；Electron 装配处 projectId 取自冻结的会话绑定，普通会话装配 0 个工具：`apps/electron/src/main/lib/linguist/session-cat-tools.ts:46-67`。
- 绑定创建即冻结、无重绑定 API（update 白名单不含绑定字段并运行时强制）：`session-binding.ts:9-14`。
- 结构性隔离：每项目独立 cat.db（`apps/electron/src/main/lib/linguist/paths.ts:26-37`；`packages/linguist-cat-store/src/store.ts:78-86`），工具只拿到绑定项目的 `ProjectDatabase` 句柄，不存在跨库通道。
- TM/TB 表内有 `project_id` 列且仓储强制项目过滤：`repositories/tm-units.ts:99-115`、`term-entries.ts`（同款 buildWhere）。

**已有测试**

- `packages/linguist-cat-tools/src/tools.nodetest.ts:686`「seeded rows are found (search is real, project-scoped)」：注入他项目 TM 行（`:694`）并断言不可见（`:707`）。
- `apps/electron/src/main/lib/linguist/session-binding.nodetest.ts:88`「binding freeze」：篡改元数据/操作另一项目不影响既有绑定。
- `session-cat-tools.nodetest.ts:183`：普通会话无 CAT 工具。

**缺口**

- 无"双项目端到端"负测试：绑定项目 A 的会话工具，用项目 B 的 segmentId/assetId 调用应全部 `UNKNOWN_SEGMENT`/`ASSET_NOT_FOUND` 且 B 库零变化。Segment/asset 隔离目前靠"每项目一库"的结构事实，无显式回归测试锁住。

**PB-110 建议**

- 补一个双项目测试：建 A、B 两项目，A 绑定工具以 B 的 id 读/提案，断言类型化拒绝 + B 库行数不变。

## 2. Tool 不接受任意 path —— 已有证据

**现状证据**

- 8 个工具的参数 schema 无任何 path 字段：`factory.ts:120`（summary）、`:157-160`（list）、`:200-213`（segments）、`:253-257`（tm）、`:297-299`（terms）、`:332-344`（propose）、`:397`（qa）、`:418-430`（findings）。
- 输出约束"无绝对路径"写入类型契约：`types.ts:11-14`。
- 导入通道：renderer 永不提交路径/字节；主进程原生 picker 选文件后自行读盘，交给服务的只有 `bytes + filename`：`apps/electron/src/main/lib/linguist/project-ipc.ts:159-206`；`ImportAssetInput` 定义 `project-service.ts:140-144`。
- 导出通道：renderer 只提交 project/asset id，目的地由主进程原生 Save 对话框产生：`export-ipc.ts:34-55`。
- source blob 文件名由 `assetId + extname(originalFilename)` 构成，与输入路径无关：`packages/linguist-cat-store/src/asset-source.ts:19-21`。
- IPC 入参 id 全部模式校验：`ipc-envelope.ts:37-43`；`packages/shared/src/types/linguist.ts:171-183`。

**已有测试**

- `tools.nodetest.ts:805`「output discipline」：递归扫描全部工具输出断言无绝对路径（`:826`）。
- `import-pipeline.nodetest.ts:126`「a path-like filename is metadata, never touched on disk」：含 `/` 的 filename 不被当路径读；blob 名无 `/`、`\`（`:140-143`）。
- `project-ipc.nodetest.ts:160`：主进程自行读取 picker 选中的文件。

**缺口**：工具/IPC 层未见实质缺口。

**PB-110 建议**：正式审查时按本条目逐一复核 schema 即可；可考虑把"filename 仅 basename 用于展示"在 renderer 契约注释中再强化一次（非阻断）。

## 3. locked segment 无法被 Proposal/Commit —— 已有证据

**现状证据**

- 域层硬规则：`packages/linguist-cat-core/src/segment.ts:59-62`（`assertSegmentEditable`）；提案接受侧 `proposal.ts:96`。
- 仓储在事务内先查 locked 再写：`repositories/proposals.ts:87`（创建）、`:184-214`（接受，经 cat-core `acceptProposal`）；直接编辑 `repositories/segments.ts:145-161`（`applyTargetEdit` 域校验在同一事务内）。
- Agent 工具面根本没有 accept/commit 类工具：`factory.ts:18-19`（永久封禁清单）；`cat_propose_translations` 预检硬规则时特意把 locked 留给 store 抛类型化错误：`factory.ts:354-365`。

**已有测试**

- `segments.nodetest.ts:116`：locked 编辑 → `SEGMENT_LOCKED`。
- `proposals.nodetest.ts:64`：多段提案遇 locked 整体原子回滚；`:161`：accept 遇 locked → `SEGMENT_LOCKED`，提案保持 pending。
- `tools.nodetest.ts:354`（`:428-429`）：工具路径 locked → `SegmentLockedError`；`:209`：工具清单无 accept/resolve/waive/commit。
- `apps/electron/src/main/lib/linguist/cat-workspace-ipc.nodetest.ts:78`：人工 IPC 编辑 locked 不覆盖。

**缺口**：未见实质缺口。

**PB-110 建议**：无需补测试；正式审查复跑上述用例并核对锁定入口（`setLocked`）的调用面是否符合"仅人工"约定。

## 4. stale revision 不能覆盖（乐观锁） —— 已有证据

**现状证据**

- 域层 CAS：`segment.ts:64-69`（`assertRevision` → `RevisionConflictError`）；提案侧 `proposal.ts:100-102`（`StaleProposalError`）。
- 仓储：编辑 CAS 在单事务内完成、绝不覆盖：`repositories/segments.ts:145-161`；提案创建时 baseRevision 校验 `proposals.ts:88-90`；幂等人工操作带 expectedRevision 复检 `proposals.ts:304-320`，幂等键表 `proposals.ts:322-349`（schema v2，`schema.ts:116-124`）。
- 事务失败整体回滚：`database.ts:76-95`。

**已有测试**

- `segments.nodetest.ts:96`：stale expectedRevision → `REVISION_CONFLICT`，行不变。
- `proposals.nodetest.ts:136`：stale accept → 全回滚；`:254`：expireStale 只标记 revision 漂移的 pending；`:277`/`:306`：幂等 accept/reject 的 revision 复检与部分选择回滚。
- `tools.nodetest.ts:354`（`:431-441`）：工具路径 stale → `StaleProposalError`。
- `cat-workspace-ipc.nodetest.ts:78`：stale 人工编辑不覆盖。

**缺口**：未见实质缺口。

**PB-110 建议**：复跑即可；可在审查记录中附 `RevisionConflictError`/`StaleProposalError` 穿透到 IPC 信封后的稳定 code 证据（`ipc-envelope.ts:49-59`）。

## 5. export 不覆盖源文件 —— AC-006 已解决

**现状证据**

- staging 只写项目 `exports/` 目录，文件名含内容摘要，tmp+rename 原子写：`packages/linguist-cat-store/src/export-staging.ts:111-141`（写盘 `:123-127`，原子写 `:100-104`）；模块头"Nothing ever writes back to source/" `:1-5`。
- 落账前重导入校验（逐段比对 target/source）：`export-staging.ts:60-96`；blocking QA 未清禁止 staging：`project-service.ts:817-823`。
- 交付边界：主进程把 staging 产物复制到原生 Save 对话框选定的目的地，响应不含任何路径。
- AC-006：`export-ipc.ts` 对现存父目录取 `realpath`，再拒绝 Linguist Agent 受管数据根及其符号链接别名下的目标；复制使用 `COPYFILE_EXCL`，目标已存在时返回稳定 `INVALID_INPUT`，不覆盖原字节。
- CAT Store 默认建议文件名为 `<原文件名（不含扩展名）>.translated.<targetLocale><扩展名>`，避免默认指向原始导入文件。

**已有测试**

- `export-staging.nodetest.ts`：staging 后 source 模板字节逐位不变，并断言默认建议文件名包含 `.translated.<targetLocale>`；重导入丢段时拒绝落账且 `exports/` 目录保持空。
- `project-service.nodetest.ts:257`：blocking QA 阻断、人工 waive 后导出且不动 source。
- `export-ipc.nodetest.ts`：覆盖正常流、取消流、归档/无效 id/QA 阻断，以及 AC-006 的既有目标不覆盖、受管根直达与符号链接别名拒绝。

**保留的设计选择**

- 取消对话框后 staging 产物与 exports 记录仍保留；它是已验证、可发现的项目交付物，不是用户目的地写入。

**结论**

- AC-006 已消除“Native Save 可覆盖已有用户文件或受管 source blob”的缺口；packaged native Save 尚未执行，不把单元/集成证据升级为真机证据。

## 6. logs 不泄漏客户正文 —— 部分

**现状证据**

- cat-tools 包零日志（以最简方式合规）：`factory.ts:15-16`。
- 服务/IPC 日志纪律写入模块头"只记 id/计数/错误码"：`project-service.ts:18-19`、`project-ipc.ts:23-24`；实际调用点均只含 id/计数/码：`project-service.ts:450`、`:461`、`:506`、`:583`、`:590`、`:678`、`:907-909`；`project-ipc.ts:201-203`；`export-ipc.ts:57-59`。
- 未类型化错误收敛为 INTERNAL 通用文案、日志只记 name：`ipc-envelope.ts:49-59`。

**已有测试**

- `tools.nodetest.ts:805-841`：工具全程 console 调用计数为 0（`:837`）。
- `project-ipc.nodetest.ts:305`、`session-ipc.nodetest.ts:162`：未类型化错误不泄漏内部信息。

**缺口**

- Pi 会话 JSONL 转录持久化含工具输出（即 segment 源文/译文）：`apps/electron/src/main/lib/agent-session-manager.ts:370-383`（超 256K 截断 `:359-362`）。这是产品数据而非应用日志，但 PB-110 必须把"logs"范围界定清楚并书面记录该数据面，否则"logs 不泄漏正文"的结论有歧义。
- Electron 侧无自动化"日志内容扫描"守护测试（零 console 断言只存在于 cat-tools 包）。
- 次要点：`session-binding.ts:134` 对非 Error 对象原样记日志；`project-skill.ts:73` 记 `error.message`（路径解析错误，可能带内部路径，非客户正文）。

**PB-110 建议**

- 明确 logs 范围（应用 console/日志文件 vs 会话转录），把转录含正文作为已记录的产品事实写入审查结论。
- 补一个 Electron 侧日志守护测试：跑一遍导入/编辑/导出，捕获 console 输出并断言不出现 fixture 正文串。
- 将 `session-binding.ts:134` 归一为只记 name/code。

## 7. archived/missing project fail closed —— 已有证据

**现状证据（archived）**

- 打开即降级：`openProject` 对归档项目强制只读且调用方无法覆盖，缓存句柄模式变化时重开：`project-service.ts:477-489`。
- store 双保险：只读句柄任何写操作先抛 `StoreReadOnlyError`：`database.ts:71-74`、`:80-81`。
- 服务层前置守卫：`assertProjectWritable` `project-service.ts:624-627`；`runQa :757`、`resolveQaFinding :784`、`waiveQaFinding :801`、`stageExport :815`、`editSegment :872`、`importAsset :891-893`；IPC 导入前置 `project-ipc.ts:172-175`。
- 会话发送闸门（orchestrator preflight 调用）：`session-binding.ts:117-147`。

**现状证据（missing）**

- missing 实时判定（索引无 id 或 project.json 缺失/不可解析）：`session-binding.ts:48-68`。
- 工具仍装配但 resolver 返回 `LinguistCatProjectMissingError`，调用即失败且对模型可读：`session-cat-tools.ts:52-61`。
- 未知 id 在索引层即 `STORE_NOT_FOUND` 并映射为 `PROJECT_NOT_FOUND`：`store.ts:78-80`；`errors.ts:102-113`。
- schema 过新 fail closed：`database.ts:158-159`。

**已有测试**

- archived：`project-service.nodetest.ts:69`（只读打开，store+service 双层拒绝写）、`:95`（缓存句柄强制只读）；`session-binding.nodetest.ts:119`（发送被主进程阻断）；`session-cat-tools.nodetest.ts:212`（重启后归档仍只读可读）；`tools.nodetest.ts:458`（归档可读且带 note）；`project-ipc.nodetest.ts:239`、`export-ipc.nodetest.ts:95`、`reference-ipc.nodetest.ts:58`（PB-080）；`store.nodetest.ts:39`、`database.nodetest.ts:145`。
- missing：`tools.nodetest.ts:758`（`BINDING_MISSING`/`PROJECT_MISSING`/store 错误穿透）；`session-cat-tools.nodetest.ts:183`（missing 装配抛错工具）；`project-ipc.nodetest.ts:121`（全通道 `PROJECT_NOT_FOUND`）；`project-service.nodetest.ts:230`；`store.nodetest.ts:31`；`database.nodetest.ts:96`（过新 schema 拒开）。

**缺口（设计事实，需审查裁定而非改代码）**

- missing 项目的会话发送是 fail-open 的成文设计（此时无项目能力依赖，保持会话可用）：`session-binding.ts:17-19`；测试 `session-binding.nodetest.ts:154`。CAT 操作本身仍 fail closed。
- 发送闸门在绑定状态解析异常时 fail open（防掀翻发送链路）：`session-binding.ts:121-136`。

**PB-110 建议**：正式审查裁定上述两处 fail-open 是否符合"archived/missing fail closed"的字面要求；若否，收紧并补测试。

## 8. malformed format 导入无部分写入（事务性） —— 部分

**现状证据**

- 管道顺序：归档拒绝 → 50MB 护栏 → 格式探测 → adapter 全量内存解析 → `insertImported` 单事务落库 → 写 source blob：`project-service.ts:889-917`。解析在任何写库之前完成，malformed 内容在 adapter 阶段抛出。
- asset + 全部 segment 单事务写入：`repositories/assets.ts:36-66`（头注释 `:29-35`）；事务实现 `database.ts:76-95`。
- TM/TB 参考库导入同样"先全量解析、后单事务"：`project-service.ts:662-681`；`tm-units.ts:176-210`；`term-entries.ts:128-129`（PB-080 in-flight）。

**已有测试**

- `assets.nodetest.ts:50`：插入中途失败整体回滚（无半资产状态）。
- `database.nodetest.ts:175`：多语句失败全回滚。
- adapter 层畸形输入：`adapters/csv.test.ts:240`、`adapters/json.test.ts:274`、`adapters/xliff.test.ts:225`、`testing/harness.test.ts:116`/`:123`（均断言 `FormatParseError`/`FORMAT_PARSE_ERROR`）。
- 服务层：`import-pipeline.nodetest.ts:104`（超限先于解析拒绝且 `listByProject` 为 0）、`:86`（垃圾字节 → `FORMAT_UNSUPPORTED`）。
- `references.nodetest.ts:231`：term 批次回滚（PB-080）。

**缺口**

- **两段式写入不原子（本审查发现的最实质缺口）**：`importAsset` 先 `insertImported` 提交 DB 行，再单独 `saveAssetSource` 写 blob（`project-service.ts:905-906`）。两步之间的 IO 失败（ENOSPC/EACCES 等）会留下"有资产行、无 source blob"的坏状态——健康检查能报出（`project-service.ts:552-580`），但无回滚/补偿，也无对应测试。
- 无服务级"malformed 内容（解析中途抛错）→ 零资产行 **且** 零 blob"的端到端断言；adapter 测试不触库，超限测试只断言行数未断言磁盘。

**PB-110 建议**

- 为 `importAsset` 加补偿：blob 写失败时回删已提交资产（或调整顺序先写 blob 再落库并校验），并补"blob 写失败 → 项目无残留资产"测试。
- 补服务级 malformed XLIFF/CSV 测试：断言导入抛 `FORMAT_PARSE_ERROR` 后 `assets.listByProject()` 为空且 `source/` 目录无新文件。

---

## 汇总表

| # | 安全属性 | 结论 | 关键缺口 |
|---|---------|------|---------|
| 1 | CAT Tool 不能跨 Project 操作 | 部分 | 缺双项目端到端负测试（结构隔离已在） |
| 2 | Tool 不接受任意 path | 已有证据 | — |
| 3 | locked 无法 Proposal/Commit | 已有证据 | — |
| 4 | stale revision 不能覆盖 | 已有证据 | — |
| 5 | export 不覆盖源文件 | AC-006 已解决 | — |
| 6 | logs 不泄漏客户正文 | 部分 | 会话 JSONL 转录含正文需书面界定；Electron 侧无日志内容守护测试 |
| 7 | archived/missing fail closed | 已有证据 | 两处成文 fail-open（missing 会话发送、闸门解析异常）需审查裁定 |
| 8 | malformed 导入无部分写入 | 部分 | `importAsset` 两段式写入（DB 行已提交、blob 未写）无补偿无测试 |

**统计：AC-006 已解决 1 项（5），已有证据 4 项（2/3/4/7），部分 3 项（1/6/8），缺失 0 项。**

**最严重缺口（一句话）**：导入管道 `importAsset` 先提交 asset/segment 行再单独写 source blob（`apps/electron/src/main/lib/linguist/project-service.ts:905-906`），两步之间的 IO 失败会留下"有资产行、无源文件"的坏项目状态，既无回滚补偿也无测试——这是八项中唯一真实存在的原子性缺口。
