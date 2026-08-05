# POST-G7 开工包：Batch 8–11 施工准备

- 生成日期：2026-07-25
- 依据：《Linguist Agent：基于 Proma 的产品重建执行计划》v1.0（§21–§24 工单原文）
- 生成时主线状态：HEAD `7360c2ea feat(PB-073): add native save export`，Batch 7 剩 PB-074 + G7
- 性质：只读调研产物，不含产品代码。产品代码一律等 G7 过后串行施工。
- 标注约定：**【已确认】**= 本轮已在仓库/计划中核实；**【合理推测】**= 基于现有结构的推断；**【待验证】**= 需主线完成 PB-074/G7 后再核对。

## 0. 并行纪律（先读）

本仓是**单工作树、单分支 main**。任何两个 session 同时写产品代码，必然在 `bun.lock`、`docs/architecture/proma-touchpoints.json` 等全局文件上冲突；已实际发生过一次 PB-042 重复施工。

结论：

- **产品代码串行**：同一时刻只允许一个 session 施工 PB 工单。
- **可安全并行的只有**：docs/调研类 commit（如本文件）、只读分析。
- **跨 session 可见性**：交付物只有 ① 单独 commit 进 main、② 账本登记，另一个 session 才能看见。开工协议要求每票先 `git log`/`git status`/读账本自检；未提交的工作树文件对另一 session 既不可见，还可能被当半成品清掉或重做。

## A. Batch 8：PB-080~085（TM/TB/格式/质量）

### 最小依赖图

```text
PB-080 TM/TB 管理 ──→ 被 PB-082/083/084 消费（术语上下文、Review、一致性修复都要查 TM/TB）
PB-081 更多格式 ────→ 相对独立，只依赖 cat-formats / import-pipeline 现有结构
PB-082 Fast/Balanced/Best ──→ PB-083 Review Skill（Best 的独立 review pass）
                            └─→ PB-084 Batch Consistency（挂 Balanced/Best 流程）
                                  └─→ PB-085 人工盲评（三档都稳定后）──→ G8
```

建议顺序：080 → 082 → 083 → 084 → 085；081 可插在 080 之后任意点。

### 现有可复用模块 / 测试缝【已确认】

- `packages/linguist-cat-store/src/repositories/tm-units.ts`、`term-entries.ts`：PB-041 已建，PB-080 直接扩展。
- `packages/linguist-cat-formats`：格式解析包已存在，PB-081 在此加解析器。
- `repositories/qa-findings.ts` + `qa-runner.ts`（PB-070/071）：PB-083 的 Finding 落点。
- `repositories/proposals.ts`：PB-082 质量策略挂在 proposal 生成链路。
- `apps/electron/src/main/lib/linguist/`：`format-registry.ts`、`import-pipeline.ts`、`cat-workspace-ipc.ts`、`export-ipc.ts` 等是 IPC/UI 触点。
- 测试缝（确切命令）：
  - cat-store：`cd packages/linguist-cat-store && bun run test`（node --experimental-transform-types + `test/register-ts-loader.mjs`，跑 `src/**/*.nodetest.ts`）
  - electron：`cd apps/electron && bun run test:linguist`
  - 全仓基线：`bun run typecheck`、`bun test`、`bun run check:boundaries`
- 现有 fixture：`tests/linguist-fixtures/{mini_items.json, terminology.csv, mini_dialogue.csv, sample.mqxliff, placeholder_cases.xliff, mini_game_ui.xliff}`。
- **当时缺的 fixture**：PB-105 的 10k 性能样本（现已随矩阵退役）、`locked_segments.xliff`（PB-091/092/110 用）——G8 后补造，提前造会进他人工作树，故未提前创建。

### 旧仓可提取 / 不可提取【已确认；旧仓只读，禁读 `data/**`】

- 可提取（纯 TS 逻辑）：`tm_candidate_pipeline.ts`、`batch_consistency_repair.ts`、`independent_critic.ts`。
- 不可直接提取，须按新仓 `node:sqlite`/纯 TS 重写：`tm_import.ts`（execFileSync 调 sqlite3 CLI）、`termbase.ts`（mdbtools）、`workbook_mapping.ts`（嵌 Python）。

### 每票最小文件清单与验收命令【合理推测，开工时以当时代码为准】

- **PB-080 TM/TB 管理**（导入 TMX/CSV、term CSV/TBX、exact/fuzzy、term status、case sensitivity、notes、UI、Tool 查询；不做向量检索）
  - 改：`repositories/tm-units.ts`、`term-entries.ts`
  - 新：cat-store 内 `tm-import.ts`（TMX/CSV 纯 TS）、`tb-import.ts`（CSV/TBX）+ 各自 nodetest
  - 触点：`apps/electron` shared/types、IPC（cat-workspace-ipc 或新 tm-ipc）、preload、CAT Workspace UI
  - 验收：cat-store test + electron test:linguist + 全仓基线
- **PB-081 更多格式**（PO/XLSX/SRT/VTT/ASS，只做真实需求高的）
  - 改：`packages/linguist-cat-formats`、`format-registry.ts`、`import-pipeline.ts`、`asset-source.ts`
  - fixture：新增对应小样本
  - 验收：cat-formats/store nodetest + import-pipeline nodetest + 全仓基线
- **PB-082 Fast/Balanced/Best**（不做多模型 Router；Fast=大 batch/单次 proposal/仅确定性 QA，Balanced=中 batch/术语+上下文，Best=小 batch/proposal 后独立 review pass；用户仍自选模型）
  - 改：proposal 生成链路质量策略映射 + UI 选择器
  - 验收：proposal nodetest + 全仓基线
- **PB-083 Review Skill 和 Finding**（Review 只产 Finding 或修订 Proposal，不能直接 Commit）
  - 提取旧仓 `independent_critic.ts` 逻辑 → 新 review runner；产出只落 `qa-findings` 或修订 proposal
  - 测试须含"review 不产生 commit"断言
  - 验收：review nodetest + 全仓基线
- **PB-084 Batch Consistency**（只检查并修复命中 Segment：repeated source/terminology/character names/punctuation/voice profile；禁止全 Batch 无差别重翻）
  - 提取 `batch_consistency_repair.ts` 逻辑
  - 测试须含"未命中 segment 不被改动"断言
  - 验收：consistency nodetest + 全仓基线
- **PB-085 人工盲评**（Fast/Balanced/Best/人工原始/旧 LA 可选；记录准确性、自然度、术语、人工修改字符数、延迟、token/cost）
  - synthetic 双批 fixture + 评分记录表
  - **【阻塞】需真实 API Key + 用户人工评分，不能自动通过**
  - G8 Gate：Balanced 必须成可靠默认；Best 必须有可测收益，不能只更慢

## B. Batch 9：PB-090~094（Legacy 迁移）

### 迁移安全边界【已确认，计划 §22】

- 独立 CLI 只读**旧目录副本**，不启动旧 cat-server；不得修改原数据；G9 在复制样本上通过，绝不先改真实 `data/**`。
- 旧聊天 → `read-only archived transcript artifact`，不迁成可继续执行的 Proma Session（Runtime/Tool/Prompt/Session 语义不兼容）。
- 不迁旧 Agent Runtime state。
- 处理策略矩阵：有 managed source copy → 可导入并标记来源；只有聊天历史 → archive artifact；外部 source 仍存在 → 用户明确选择是否复制；全部 source 丢失 → metadata/history only，不伪造可运行项目。
- PB-091 必须保留：Segment order、source/target、locked、revisions 最终语义、TM/TB、QA 状态、artifact references、source digest。

### 仅可读取的旧仓非 data 文件【合理推测，开工时逐条确认】

- 旧仓 schema/manifest 定义与迁移相关合约：`task_workspace_contract.ts`、`task_message_queue_contract.ts`。
- **【待验证】** PB-020 矩阵里写的 `task_mapping_contract.ts` 在旧仓 grep 不到——PB-090 开工第一步先核对真实文件名，别按计划里的名字找。
- 旧仓 `docs/` 内的数据格式说明（不碰 `data/**`）。

### 必测情形（PB-092 损坏/跨 root/孤儿，覆盖 Release Blocker）【已确认】

- invalid `full` permission 不影响 CAT 数据扫描
- manifest root 已删除
- external root + managed uploads
- internal copy only
- orphan project
- quarantine
- 另需 `locked_segments.xliff` fixture 覆盖 locked 迁移

### 需用户动作

- **G9 需用户亲手复制一份旧数据样本**到测试目录；任何人不得直接读真实 `data/**`。

## C. Batch 10：PB-100~105（产品体验精修）

### Token/UI 改造触点【合理推测】

- **PB-100 LA Design Tokens**：新建 token 文件（colors/typography/spacing/radius/elevation/motion、light/dark、reduced motion），落在 `packages/ui` 或 apps/electron 样式层；不复制品牌资产。
- **PB-101 Thread 与 Composer**：在 Proma 现有组件上优化（user bubble、assistant document flow、Thinking live/collapsed、Tool group、Worked divider、Queue/Steer、model changed、recovery、max width、长 thread 虚拟化），不重写数据层。
- **PB-102 Shell 和 Right Rail**：吸收 OpenWorker 简化（一级导航减少、Right Rail 按上下文切换、交付物可发现、Settings 不占主流程）。
- **PB-103 Approval/Plan/Compaction**：inline Approval、scope、Model changed divider、Compaction status、error recovery、Plan 仅在真实计划数据存在时展示。
- **PB-104 CAT 视觉精修**：row density、source/target contrast、proposal diff、QA badges、term chips、batch action、empty/loading/error、窄视口。
- **PB-105 矩阵**：自动化（Light/Dark、1280×820、1024×700、最小窗口、200% zoom、reduced motion、1000-turn thread、10k Segment、axe）+ 手工（VoiceOver、keyboard only、IME、drag/resize、DMG 真机）。G10 不允许以源码字符串截图替代真实渲染。

### 资料入仓边界【已确认，计划 §24 PB-116 排除清单】

- **可入仓**：LA 自己的 token 定义、三客户端规格中提炼出的设计规格结论、OpenWorker（MIT）与 Codex（Apache）的 notice（若复制了代码）。
- **绝不入仓**：`data/**`、`.env*`、keys/tokens/credentials、客户文件、真实项目文本、私人评测、本机绝对路径、reverse-engineering docs、codex-teardown、asar-src、原始闭源文案库、第三方品牌资产、raw logs。
- `THREE_APPS_PIXEL_SPEC.md` 在 `~/Downloads`，属私人研究资料——规格结论可提炼进 docs，**原文不入仓**【合理推测，PB-100 开工时与用户确认】。

## D. Batch 11：PB-110~117（安全、发布、公开镜像）

### 可提前收集的证据【合理推测】

- G7/G9/G10 报告、账本记录、打包 smoke 输出——随做随留，PB-117 直接引用。
- PB-115 合规材料（AGPL LICENSE、NOTICE、ATTRIBUTION、SBOM、SECURITY、CONTRIBUTING、third-party notices）文本可提前起草。

### 必须等 Gate 的阻塞项【已确认】

- **PB-110 CAT 安全审查**（跨 Project 隔离、path 白名单、locked 不可 Proposal/Commit、stale revision 不可覆盖、export 不覆盖源文件、日志不泄漏正文、archived/missing fail closed、malformed 无部分写入）：需 G7 后 CAT 全链路稳定。
- **PB-111 Backup/Restore**：依赖 cat-store `backup.ts`（已实现 VACUUM INTO），但 restore preview/schema check/损坏备份/回滚需 G7 后整链验证。
- **PB-112 Proma Upstream Sync Rehearsal**：需 G7 smoke 可跑；只按登记的 touchpoints 解冲突。
- **PB-113 移除或长期隐藏无关 Proma 功能**：计划明文"只有在 G7/G10 后执行"；逐项评估（Claude Runtime、remote bots、automation、generic coding-only tools、unused themes/settings），先隐藏、确认无消费者后再删。
- **PB-117 最终审计包**：需 G7/G9/G10 全过。

### 需用户凭据 / 明确授权的动作【已确认】

- **PB-085**：真实 API Key + 人工盲评。
- **G9**：用户亲手复制旧数据样本。
- **PB-114**：Apple Developer ID / 公证凭据 / update channel；没有真实凭据时标 blocked，不伪造通过。另：`5dcd197a fix(PB-010): restore legacy LA app icon` 恢复的图标归属需在 PB-114 前确认（是否可用旧 LA 图标作为自有 app 图标）【待验证】。
- **PB-116**：目标公开仓 `wangyu-sg/linguist-agent-public`，只推候选分支 `audit/proma-based-candidate-v1`，**不得直接覆盖 main**。本地 `linguist-agent-public` 现为一个 "Initial public source release" 旧 LA 镜像 commit；公开仓必须保留 Proma 历史、AGPL 和 attribution。
- **任何 git push / 公开仓合并**：逐次经用户明确批准。
