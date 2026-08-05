# Linguist Agent v2.1 实施队列

更新时间：2026-08-05

> 唯一 active machine queue：[linguist-fusion-queue.json](./linguist-fusion-queue.json)。本文件只提供当前阶段的人读投影；完整 ticket 列表、依赖和 evidence 以 JSON 为准。

## 状态规则

只允许 TODO、IN_PROGRESS、BLOCKED、DONE、CANCELLED_WITH_REASON、VERIFIED_ALREADY_DONE。packaged verified、manual/real-machine verified 与 release qualified 是不同状态，不能相互替代。

## 当前 Phase 0

- LA-MASTER-000 与 LA-SYNC-001 已完成同步前控制面与数据保护。
- LA-SYNC-002 已正式 merge Proma v0.16.8 为 f3d2b431。
- LA-SYNC-003、LA-SYNC-004 已完成 Runtime/Session 和原生 surface/sidebar/settings reconciliation。
- LA-SYNC-005 已完成：smoke:pack PASS；smoke:vertical PASS。
- LA-SYNC-006 已完成 v0.16.8 baseline、触点与偏离账本的 current verification：boundary 4/4、fusion 9/9、Electron typecheck、JSON parse 与 diff check 均通过。
- LA-SYNC-007 保持 IN_PROGRESS：Agent 12/12、Chat 18/18、Linguist 21/21 通过，报告 `runStatus=passed`、`coverageStatus=partial`，但 2 个 MANUAL 与 3 个 BLOCKED coverage gaps 仍未解除。
- LA-HOST-000 与 LA-HOST-004 已完成：静态 Host Contracts/Registry 和 truthful capability manifest 已接入；未建立动态插件系统。

## v2.1 最小 Alpha 范围

先做 `LA-HOST-001/002/003/005`，再做受权单文件 `Intake → exact duplicate/格式预检 → Agent/UI 共用服务 → Verification`，复用既有 PB-097 Tag Model，收口 Proposal/QA 覆盖、Proposal Critic、Session 默认继承和已确认正确性修复。`LA-ALPHA-000` 是入口 Gate。

目录扫描、durable Import Job、3E Memory、TEaR、Full-Scope Review、长任务 Worker、性能/可观测性平台和低频格式 Adapter 已在 JSON 中标记 `CANCELLED_WITH_REASON`；Phrase rehydration 保持条件 `BLOCKED`，只有真实 split-MXLIFF 交付触发才重开。

| Ticket | 主题 | 状态 |
|---|---|---|
| LA-SYNC-002 | 正式 merge Proma v0.16.8 | DONE |
| LA-SYNC-003 | Runtime/Session 以上游为主合并 | DONE |
| LA-SYNC-004 | Agent Surface/Sidebar/Settings 合并 | DONE |
| LA-HOST-000 | 建立本地 Host Contracts 与 Extension Registry | DONE |
| LA-SYNC-005 | 依赖、Electron 43、Lock/SBOM/Build | DONE |
| LA-SYNC-006 | Baseline/Touchpoints/Deviations 重置 | DONE |
| LA-SYNC-007 | v0.16.8 完整验证与 packaged smoke | IN_PROGRESS |
| LA-HOST-004 | Host Capability Manifest | DONE |
| LA-ALPHA-000 | 最小个人 Alpha 入口 Gate | TODO |

其余 ticket 以 JSON v2.1 为准；不得以旧 v1 Gate、历史 packaged 结果或未来设计章节提前标记完成。
