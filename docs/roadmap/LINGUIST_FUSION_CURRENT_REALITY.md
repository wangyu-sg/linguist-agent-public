# Linguist Fusion 当前事实

> 更新日期：2026-08-06。代码、manifest、测试和真实运行输出优先于本文。

## 基线

| 项目 | 当前事实 |
|---|---|
| 仓库 / 分支 / 实现提交 | `/Users/<local>/Desktop/linguist-agent-next` / `main` / 以 `git HEAD` 为准 |
| Proma Base / formal merge | v0.16.8 `bde00f00` / `f3d2b431` |
| App / Electron | `0.16.17` / `43.2.0` |
| Bun / Pi / Claude | `1.3.14` / `0.82.1` / `0.3.201` |
| Shared | `0.1.84` |
| CAT Core / Formats / Store / Tools | `0.0.14 / 0.0.7 / 0.0.27 / 0.0.21` |
| CAT schema / Tool count | `15` / `19` |
| Proma core touchpoints | `257`，以 `proma-touchpoints.json` 为准 |

产品结构固定为完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Linguist 复用同一个 AgentView、ChatView、Session、Preview Tab 和 Host 状态。

## 本轮实现事实

- 批次是同一项目内持续到达的任务文件；语言资产是 TM/TB/Style Guide/Context。两者不再混成“全部资产”。
- 空项目可修改语言方向，已有批次/TM/TB 后 fail closed；当前会话明确附加或 `@file` 复制的单文件可兑换为 CAT Intake opaque token。
- XLSX 显式确认 Sheet/列映射，映射随批次持久化并用于导出；SDLXLIFF `mrk` 与 CSV/JSON detect 修复留在既有 adapter。
- TM/TB 使用候选 → 人工确认 → 权威层；原件进入受管 blob，批次和语言资产均复用 Proma Preview Tab。
- Import Verification 与引用感知 Undo 已实现；下游 Proposal/QA/Critic/Export/人工编辑/Job 任一引用都会阻止撤销。
- Context cursor 绑定项目事件序列；Segment、TM/TB、Style Guide mutation 均推动事件，旧 cursor 抛 `CONTEXT_DRIFT`。
- Execution Policy、专业质量合同、Canonical Prompt Contract、双 renderer、全局预算与 Translation Scope 已接入；CAT 工具由 17 增至 19。
- Proma 上游影响检查是本地只读 dry-run，不做 git mutation 或发布。

## 状态

| Ticket | 状态 | 当前事实 |
|---|---|---|
| LA-INTAKE-007 | DONE | 同事务 Verification + 六类引用感知 Undo。 |
| LA-FORMAT-005/006/007 | DONE | XLSX 映射、SDLXLIFF `mrk`、CSV/JSON 置信治理已实现。 |
| LA-CONTEXT-001/002/003 | DONE | cursor v2、最小上下文、冻结 scope 与完整 mutation event 覆盖。 |
| LA-SYNC-007 | IN_PROGRESS | 自动化 smoke 已实现，G0 19/19 通过；Native dialog 与 IME 仍缺人工证据。 |
| LA-HOST-002 | IN_PROGRESS | Companion 已实现并有自动回归，缺真实机器 roundtrip。 |
| LA-ALPHA-000 | TODO | 不以 unit/packaged 结果替代个人 Alpha Gate。 |
| LA-EVAL-001/003/004 | TODO | 真实模型、格式与 14 天日用证据未取得。 |

历史 v1、0.15.140 和旧 Gate 报告保留作历史证据，不覆盖本页。
