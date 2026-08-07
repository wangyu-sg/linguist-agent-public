# Linguist Agent 简化重构状态

更新时间：2026-08-08

> 代码、manifest、测试和真实运行输出优先于本表。`DONE` 表示实现与自动回归完成，不等于真实模型质量、真机人工或 14 天日用证据。

## 状态

| Ticket | 状态 | 当前证据 |
|---|---|---|
| SIMPLE-000 | DONE | `CURRENT_FACTS_SIMPLE.md` 记录启动基线、数据备份和验证。 |
| SIMPLE-001 | DONE | 基线 CI 红灯根因已修复，继续施工前全套基线通过。 |
| SIMPLE-002 | DONE | Proma v0.16.9 已正式 merge；lock、SBOM/NOTICE、macOS arm64 packaged build、产物完整性和纵向 smoke 均已核验。 |
| CAP-001~005 | DONE | 四岗位同 Toolset；权限沿用 Proma；外部路径可读即导入；项目异常不再封死 Agent；岗位可切换。 |
| ROLE-001~005 | DONE | `general / translator / reviewer / proofreader` 类型、创建菜单、Header 切换、旧角色 decoder 与标题 hidden context 已实现。 |
| PROMPT-001~007 | DONE | Common Contract + 四岗位 Markdown 唯一真源；短 fallback 可继续运行；旧 Skill 双注入已删除。 |
| FLOW-001~003 | DONE | Translator、全量双语 Reviewer、目标语 Proofreader 使用同一 CAT/Proma 能力；写回服从用户意图。 |
| FLOW-004 | DONE | Critic/Auditor 入口与公开工具已删除；旧 DB 记录只读保留。 |
| FLOW-005 | DONE | begin/finalize Translation Scope 不再公开或作为完成前置。 |
| FLOW-006 | DONE | 复用现有 Tool result / Proposal / QA 结果汇总，不增加新 Artifact 平台。 |
| IO-001~002 | DONE | `cat_import_resources` 支持文件/目录、auto 分类、去重、needsInput 与简单计数；`cat_import_asset` 为单文件 alias。 |
| IO-003 | DONE | `cat_export_asset` 支持 final/draft、默认拒绝覆盖与显式原子覆盖。 |
| IO-004 | DONE | 只读核验真实工作目录；客户正文、文件名和绝对路径未进入仓库。 |
| TAG-001~004 | DONE | Scanner 单一真源、未知形状扫描、Candidate 保存与 ReDoS/证据/重叠/Pair 验证完成。 |
| TAG-005~006 | DONE | Tag Profiles 三栏 UI、Candidate soft chip 与 Active/native hard chip 使用同一 Scanner。 |
| TAG-007 | DONE | 技术 Spike 采用原生 textarea + chip overlay：硬 Tag 仍可选择，但缺失/新增时禁止保存；IME/Undo 保持原生行为，未引入高风险 contenteditable 框架。 |
| PHRASE-001~004 | DONE | 内容身份配对、mapping、rehydration、final 阻断与合成 round-trip 已实现；真实私有副本只读验证为 82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable。 |
| CLEAN-001~004 | DONE | 旧角色、默认 Critic、Execution Policy、Scope glue 与无调用 UI/类型已删除。 |
| CLEAN-005~006 | DONE | README、AGENTS、交接、当前事实、限制与架构文档已同步；旧统一蓝图与 80+ Ticket queue 已从 active 树删除。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需要同模型、同 reasoning 的真实语言任务对照；自动测试不能代替。 |
| VALID-002 | BLOCKED BY REAL SAMPLE | 需要真实 Provider 驱动四岗位完成翻译→审校→校对→交付；格式层冒烟不等于 Agent 全链。 |
| VALID-003 | BLOCKED BY REAL SAMPLE | 需要从可用构建开始累计 14 个真实日用日，不能在一次施工中伪造。 |

## 不再维护

- `LA_UNIFIED_MASTER_PLAN_V2.md`
- `linguist-fusion-queue.json`
- `LINGUIST_FUSION_QUEUE.md`
- Proposal Critic / Auditor / Execution Policy / Translation Scope 作为 active 产品主线

这些内容仍可从 Git 历史查阅，但不得反向覆盖当前实现。

## 最终自动化证据

- typecheck：全部 11 个 workspace 通过。
- 测试：根 `1479/1479`、Electron Linguist `181/181`、CAT Tools `36/36`、boundary `4/4`、fusion architecture `9/9`。
- 依赖与打包：SBOM/许可证核验 432 个生产依赖；macOS arm64 packaged artifact integrity 通过。
- packaged vertical：Pi `15 PASS / 0 FAIL`、Chat `19 PASS / 0 FAIL`、Linguist `21 PASS / 0 FAIL / 2 MANUAL`；合同覆盖仍为 partial，Native Open/Save 保留为真机人工项。
