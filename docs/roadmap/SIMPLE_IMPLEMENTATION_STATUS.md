# Linguist Agent 简化重构状态

更新时间：2026-08-10

> 代码、manifest、测试和真实运行输出优先于本表。`DONE` 表示实现与自动回归完成，不等于真实模型质量、真机人工或 14 天日用证据。

## 状态

| Ticket | 状态 | 当前证据 |
|---|---|---|
| SIMPLE-000 | DONE | `CURRENT_FACTS_SIMPLE.md` 记录启动基线、数据备份和验证。 |
| SIMPLE-001 | DONE | 基线 CI 红灯根因已修复，继续施工前全套基线通过。 |
| SIMPLE-002 | DONE | Proma v0.16.10 已正式 merge；lock、SBOM/NOTICE、macOS arm64 packaged build、产物完整性和纵向 smoke 均已核验。 |
| CAP-001~005 | DONE | 四岗位同 Toolset；权限沿用 Proma；外部路径可读即导入；项目异常不再封死 Agent；岗位可切换。 |
| ROLE-001~005 | DONE | `general / translator / reviewer / proofreader` 类型、创建菜单、Header 切换、旧角色 decoder 与标题 hidden context 已实现。 |
| PROMPT-001~007 | DONE | 单一 Builder 内置 Common Contract，四岗位 Markdown 为岗位唯一真源；Digest 的 `complete / partial / skipped / truncated`、模型可见失败占位与 Markdown data fence 已恢复，旧 per-layer 矩阵和 Skill 双注入未恢复。 |
| FLOW-001~003 | DONE | Translator、全量双语 Reviewer、目标语 Proofreader 使用同一 CAT/Proma 能力；写回服从用户意图。 |
| FLOW-004 | DONE | Critic/Auditor 入口与公开工具已删除；旧 DB 记录只读保留。 |
| FLOW-005 | DONE | begin/finalize Translation Scope 不再公开或作为完成前置。 |
| FLOW-006 | DONE | 复用现有 Tool result / Proposal / QA 结果汇总，不增加新 Artifact 平台。 |
| IO-001~002 | DONE | `cat_import_resources` 支持文件/目录、auto 分类、去重、needsInput 与简单计数；原生单一入口支持多文件/文件夹，CSV 歧义分类 fail closed；`cat_import_asset` 为单文件 alias。 |
| IO-003 | DONE | Agent 与原生 UI 都提供 `validation: verified/as-is`；`as-is` 需明确确认，默认拒绝覆盖，显式原子覆盖。manifest 校验与复制由 ProjectDelivery 统一执行。 |
| IO-004 | DONE | 只读核验真实工作目录；客户正文、文件名和绝对路径未进入仓库。 |
| TAG-001~004 | DONE | Scanner 单一真源、未知形状扫描、Candidate 保存与 ReDoS/证据/重叠/Pair 验证完成。 |
| TAG-005~006 | DONE | Tag Profiles 三栏 UI、Candidate soft chip 与 Active/native hard chip 使用同一 Scanner。 |
| TAG-007 | DONE | 技术 Spike 采用原生 textarea + chip overlay：硬 Tag 仍可选择，但缺失/新增时禁止保存；IME/Undo 保持原生行为，未引入高风险 contenteditable 框架。 |
| PHRASE-001~004 | DONE | 内容身份配对、mapping、rehydration、`verified` 阻断与合成 round-trip 已实现；真实私有副本只读验证为 82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable。 |
| CLEAN-001~004 | DONE | 旧角色、默认 Critic、Execution Policy、Scope glue 与无调用 UI/类型已删除。 |
| CLEAN-005~006 | DONE | README、AGENTS、交接、当前事实、限制与架构文档已同步；旧统一蓝图与 80+ Ticket queue 已从 active 树删除。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需要同模型、同 reasoning 的真实语言任务对照；自动测试不能代替。 |
| VALID-002 | BLOCKED BY REAL SAMPLE | 需要真实 Provider 驱动四岗位完成翻译→审校→校对→交付；格式层冒烟不等于 Agent 全链。 |
| VALID-003 | BLOCKED BY REAL SAMPLE | 需要从可用构建开始累计 14 个真实日用日，不能在一次施工中伪造。 |

## 2026-08-10 核心施工

- DONE：直接写回与 Proposal 两种明确模式，四岗位共用 30 个 CAT Tools。
- DONE：术语批量 CRUD、冲突查询、revision cache matcher、10k/50k 规模回归与译后分级校验；尚无独立性能基准结论。
- DONE：统一资源导入/导出、Workbook Mapping 建议与复用、Voice Profile / approved exemplar 写入与检索。
- DONE：Full Agent Files / Changes、Linguist 展开态/mini rail 的共享“新会话 + 搜索”宿主结构、完整资产级 Reviewer/Proofreader、术语冲突并排保留、XLSX mapping 置信度/locked/歧义 fail-closed、approved exemplar 原生入口与 stale 替换。Planning / Agent Skills 绑定普通 Agent workspace，不显示在 Linguist 侧栏是域隔离。
- DONE：memoQ MQXLIFF 专用 Adapter 的 detect / import / modify / export / reimport 合成 fixture；真实客户样本保持待验证。
- DONE：未知 Tag 导入后自动扫描与 Validator 加固，默认不自动激活 Candidate。
- DONE：Prompt Builder 保留单一 `3.1.0` 合同；恢复 Digest 完整/部分/跳过/裁减、模型可见失败占位和 Markdown data fence；旧 per-layer 矩阵、Critic / Scope / 无用 glue 未恢复，Kimi K3 UX 通过 `0136a1d2` 合入。

## 不再维护

- `LA_UNIFIED_MASTER_PLAN_V2.md`
- `linguist-fusion-queue.json`
- `LINGUIST_FUSION_QUEUE.md`
- Proposal Critic / Auditor / Execution Policy / Translation Scope 作为 active 产品主线

这些内容仍可从 Git 历史查阅，但不得反向覆盖当前实现。

## 最终自动化证据

- typecheck：全部 11 个 workspace 通过。
- 测试：根 `1537/1537`（`6890` assertions）、Electron Linguist `207/207`、CAT Store `228/228`、CAT Tools `40/40`、boundary `4/4`、fusion architecture `9/9`。
- 依赖：SBOM/许可证核验 432 个生产依赖。
- `0.16.35` macOS arm64 packaged artifact integrity 与 vertical smoke 已通过：Agent `15/15`、Chat `19/19`、Linguist `21/21`（另有 `2 MANUAL`）；LF-003 `runStatus=passed`、coverage `partial`。已安装 `/Applications/Linguist Agent.app` `0.16.35`，`app.asar` SHA-256 `35cbb7dc6643736b29a10e579e5ffc658974960cda7bb76eb2400d6206493261` 与产物一致；旧 `0.16.34` 位于废纸篓可恢复。Native Open/Save、VoiceOver 与 IME 继续保留为真机人工项。
