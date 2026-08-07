# Linguist Agent 当前交接

更新时间：2026-08-07

## 当前状态

- 仓库：`/Users/<local>/Desktop/linguist-agent-next`
- 分支：`main`；当前实现以 `git HEAD` 为准。
- 上游基线：Proma v0.16.8 / `bde00f00`；正式 merge：`f3d2b431`。
- 当前版本：Electron App `0.16.19`、Shared `0.1.85`、CAT Core / Formats / Store / Tools `0.0.14 / 0.0.8 / 0.0.27 / 0.0.23`、schema `15`。
- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Workbench；没有第二套 Agent、Chat 或 Preview。

## 本轮已实现

- Host/UI：项目级 segment 引用与校验、LA 附件、返回工作台、Companion 宽度复用、批次与语言资产统一走 Proma Preview Tab；Markdown 与旧版 Word 可读预览；Workbench 结构分隔只保留单一 hairline。
- 领域边界：同一项目可有多个批次；TM/TB/Style Guide/Context 是项目级语言资产。
- Intake：纸夹或明确 `@file` 复制到当前 Linguist 会话的单文件登记为 opaque-token 来源；导入后同事务 Verification；Undo 检查 Proposal、QA、Critic、Export、人工编辑与持久 Job 引用，命中即 fail closed。
- 格式：XLSX 显式 Sheet/列映射确认并持久化；SDLXLIFF 复杂 `mrk` 回写修复；CSV/JSON 低置信误识别收紧；私有语料扫描与脱敏格式矩阵完成。
- 语言资产：TM/TB 原件进入受管 blob；候选只有人工确认后才写权威层，确认前零 DB 写入；原件可用 Preview Tab 查看。
- Prompt/Runtime：Execution Policy 取代质量档位；恒定专业质量合同；Canonical Prompt Contract、XML/Markdown renderer、18k 全局预算；Pi markdown 动态 fence 隔离项目数据；新 LA Session 继承 Proma 默认 Runtime/Channel/Model。
- Context/Scope：cursor v2 + `CONTEXT_DRIFT`；人工 Segment 编辑、TM/TB 与 Style Guide mutation 现均写项目事件；20 个 CAT 工具包含 begin/finalize Translation Scope 和本地交付导出。
- Export：修复 SDLXLIFF 缺 `conf` 与局部重复 `sdl:seg id` 的状态回写；项目 Agent 可把通过预检和重新导入验证的批次保存到用户指定的新本地文件，但不能覆盖、上传或发送。
- Preview/Refresh：批次和保留原件的语言资产固定打开 Proma Preview Tab；批次与语言资产列表新增显式刷新。
- 同步工具：`scripts/proma-sync-impact.mjs` 提供只读上游影响报告。

机器状态以 [linguist-fusion-queue.json](./roadmap/linguist-fusion-queue.json) 为准。FORMAT-005/006/007、INTAKE-007 与 CONTEXT-001/002/003 已落地；LA-HOST-002、LA-SYNC-007、LA-ALPHA-000 和 EVAL 人工项未关闭。

## 已有自动验证

- 本轮受影响包 typecheck：CAT Formats、CAT Tools、Electron 均通过。
- 本轮聚焦回归：SDLXLIFF `19/19`、CAT Tools `45/45`、真实 Session 导出 `9/9`、Preview/Refresh UI `16/16`。
- boundary `4/4`；fusion architecture `9/9`。
- macOS arm64 packaged build 与完整性检查通过；`0.16.19` 已安装到 `/Applications/Linguist Agent.app` 并读取 manifest 复核版本。

这些是 unit / packaged evidence，不是真机人工或 release qualification。

## 仍需完成

1. 真机人工：Native Open/Save、真实 IME、Companion Chat roundtrip、VoiceOver/完整键盘与窄窗交互。
2. 完成 EVAL-001/003/004、14 天个人日用，再裁决 LA-ALPHA-000。

测试、smoke、打包只能使用临时 user-data-dir；私有语料报告、客户文件与真实用户根不得进入 Git。
