# Linguist Agent 当前交接

更新时间：2026-08-06

## 当前状态

- 仓库：`/Users/<local>/Desktop/linguist-agent-next`
- 分支：`main`；本轮实现提交为 `9a5353d2`。
- 上游基线：Proma v0.16.8 / `bde00f00`；正式 merge：`f3d2b431`。
- 当前版本：Electron App `0.16.16`、Shared `0.1.83`、CAT Core / Formats / Store / Tools `0.0.14 / 0.0.7 / 0.0.27 / 0.0.21`、schema `15`。
- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Workbench；没有第二套 Agent、Chat 或 Preview。

## 本轮已实现

- Host/UI：项目级 segment 引用与校验、LA 附件、返回工作台、Companion 宽度复用、批次与语言资产统一走 Proma Preview Tab；移除重复预览弹窗、收起栏最近会话和重复 Skills 入口。
- 领域边界：同一项目可有多个批次；TM/TB/Style Guide/Context 是项目级语言资产。
- Intake：导入后同事务 Verification；Undo 检查 Proposal、QA、Critic、Export、人工编辑与持久 Job 引用，命中即 fail closed。
- 格式：XLSX 显式 Sheet/列映射确认并持久化；SDLXLIFF 复杂 `mrk` 回写修复；CSV/JSON 低置信误识别收紧；私有语料扫描与脱敏格式矩阵完成。
- 语言资产：TM/TB 原件进入受管 blob；候选只有人工确认后才写权威层，确认前零 DB 写入；原件可用 Preview Tab 查看。
- Prompt/Runtime：Execution Policy 取代质量档位；恒定专业质量合同；Canonical Prompt Contract、XML/Markdown renderer、18k 全局预算；Pi markdown 动态 fence 隔离项目数据；新 LA Session 继承 Proma 默认 Runtime/Channel/Model。
- Context/Scope：cursor v2 + `CONTEXT_DRIFT`；人工 Segment 编辑、TM/TB 与 Style Guide mutation 现均写项目事件；19 个 CAT 工具包含 begin/finalize Translation Scope。
- 同步工具：`scripts/proma-sync-impact.mjs` 提供只读上游影响报告。

机器状态以 [linguist-fusion-queue.json](./roadmap/linguist-fusion-queue.json) 为准。FORMAT-005/006/007、INTAKE-007 与 CONTEXT-001/002/003 已落地；LA-HOST-002、LA-SYNC-007、LA-ALPHA-000 和 EVAL 人工项未关闭。

## 已有自动验证

- workspace typecheck：11/11。
- 根测试：1481 pass / 0 fail。
- CAT Store 229/229；CAT Tools 52/52；CAT Formats 158/158。
- boundary 4/4；fusion/prompt/sync Node tests 15/15。
- packaged build 与完整性检查通过；PB-074 21 PASS / 0 FAIL / 2 MANUAL。
- G0 packaged mode roundtrip：19 PASS / 0 FAIL。

这些是 unit / packaged evidence，不是真机人工或 release qualification。

## 仍需完成

1. 真机人工：Native Open/Save、真实 IME、Companion Chat roundtrip、VoiceOver/完整键盘与窄窗交互。
2. 完成 EVAL-001/003/004、14 天个人日用，再裁决 LA-ALPHA-000。

测试、smoke、打包只能使用临时 user-data-dir；私有语料报告、客户文件与真实用户根不得进入 Git。
