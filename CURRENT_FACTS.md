# Linguist Agent 当前核验事实

核验日期：2026-08-05

本文件只记录当前 v2 控制面已确认的事实。代码、package manifest、测试和真实运行输出优先于本文件；唯一 active 计划是 [LA_UNIFIED_MASTER_PLAN_V2.md](docs/roadmap/LA_UNIFIED_MASTER_PLAN_V2.md)，唯一 active machine queue 是 [linguist-fusion-queue.json](docs/roadmap/linguist-fusion-queue.json)。

## Git 与上游基线

| 项目 | 已确认事实 |
|---|---|
| 当前同步分支 | sync/proma-v0.16.8 |
| Proma 基线 | v0.16.8 / bde00f00323d6735a939d14dbce3b2f1a5b672bc |
| 正式 merge | f3d2b431996523a4aa75ec2b027dcf0e932ef08f |
| merge parents | 本地 b84d65ac79ecf681fac21cf740a589da4aedbed4；upstream bde00f00323d6735a939d14dbce3b2f1a5b672bc |
| 当前机读基线 | [proma-baseline.json](docs/architecture/proma-baseline.json) |
| 当前触点账本 | [proma-touchpoints.json](docs/architecture/proma-touchpoints.json) |
| 当前偏离账本 | [PROMA_DEVIATIONS.json](docs/architecture/PROMA_DEVIATIONS.json) |

正式 merge 相对 Proma v0.16.8 的历史登记仍保留在归档报告；当前收敛后的触点账本为 250 个：31 个 Permanent Product Fork、218 个 Local Host Seam、1 个 Temporary。8 个与 Linguist 无关的通用 UI 触点已退役。

## 产品与运行时（current manifest）

| 项目 | 已确认值 |
|---|---|
| Linguist Agent | 0.16.15 |
| Proma Electron App（upstream tag） | 0.16.8 |
| Electron | 43.2.0 |
| Bun | 1.3.14 |
| Pi runtime | 0.82.1 |
| Claude Agent SDK | 0.3.201 |
| shared | 0.1.82 |
| CAT Core / Store / Tools | 0.0.13 / 0.0.26 / 0.0.20 |
| CAT schema | 13 |
| Prompt contract | Profile 2.0.0 / Project Digest 1.0.0 / Turn Context 1 |
| Host contract version | 已有静态 renderer contracts/registry；未单独版本化，也没有独立 runtime version constant |

产品结构仍是完整 Proma Agent + Chat 底座，加上 Linguist Vertical Agent Profile 与 CAT Core / Store / Tools / Workbench。Linguist 不能成为第二套 Agent 或 Chat。

## v2 同步状态

| Ticket | 状态 | 已确认边界 |
|---|---|---|
| LA-SYNC-002 | DONE | Proma v0.16.8 已正式 merge 为 f3d2b431。 |
| LA-SYNC-003 | DONE | Runtime/Session reconciliation 已纳入 formal merge；后续 Host Contract 扩展另由 LA-HOST-000 跟踪。 |
| LA-SYNC-004 | DONE | Agent surface、sidebar、settings reconciliation 已纳入 formal merge，保持单一原生 Agent/Chat 实现。 |
| LA-SYNC-005 | DONE | Electron 43、lock 与 build/package 工作已验证 packaged gates。 |
| LA-SYNC-006 | DONE | v0.16.8 baseline、当前 250 条精确触点与 deviations ledger 已通过 current verification。 |
| LA-SYNC-007 | IN_PROGRESS | packaged smoke 已通过，但手工与受阻覆盖仍未满足。 |
| LA-HOST-000 | DONE | 静态 Host Contracts、Extension Registry 与 Linguist composition root 已建立；没有引入运行时插件系统。 |
| LA-HOST-004 | DONE | Rail/Full capability manifest 已接入原生 Agent 控件可见性；Companion Chat 为 true，File Panel 仍如实为 false。 |
| LA-HOST-005 | DONE | Host Parity capability-key canary 已加入共享 extension-registry 回归；Rail/Full 必须登记全部 Proma 宿主能力键。 |
| LA-HOST-002 | IN_PROGRESS | Companion Chat 已复用 Proma ChatView 并通过 packaged smoke；仍缺真实机器 roundtrip。 |
| LA-INTAKE-001 | IN_PROGRESS | Alpha 单文件 UI/Agent 已共用 ProjectDelivery.importAsset；完整 scan/plan/job coordinator API 有意延后。 |
| LA-INTAKE-006 | DONE | UI project IPC 与 Agent source-token bridge 共用 LinguistProjectService/ProjectDelivery.importAsset。 |
| LA-INTAKE-007 | TODO | 结构化 Verification Report 与引用感知的 Import Undo 尚未实现。 |
| LA-REVIEW-001 | DONE | 现有 `cat_submit_critic_review` 已承担 Proposal Critic；独立身份、snapshot 绑定和 advisory-only 语义已有包级回归。 |

## 2026-08-05 真实验证输出

| 检查 | 结果 | 资格说明 |
|---|---|---|
| smoke:pack | PASS | 使用临时 clang module cache 的 packaged build gate 通过。 |
| smoke:vertical | PASS | Agent 12/12、Chat 18/18、Linguist 21/21；报告 runStatus=passed、coverageStatus=partial。 |
| 2 个 MANUAL coverage gaps | 未完成 | 不得写成已人工验收。 |
| 3 个 BLOCKED coverage gaps | 未解除 | 不得写成完整 verification 或 release qualified。 |
| LF-048 Native Save 手工分支 | PASS | 隔离 packaged app 克隆：覆盖源文件被 INVALID_INPUT 拒绝、源 SHA 不变、安全导出可重导入。 |
| LF-048 真实 IME | BLOCKED | 当前 macOS 只有 ABC 输入源，未取得 compositionstart/compositionend 真实事件；不能用脚本事件代替。 |
| boundary | PASS | bun run check:boundaries 为 4/4。 |
| fusion architecture | PASS | 9/9。 |
| Electron typecheck | PASS | 当前 renderer metadata 与并行 Host 改动均通过。 |
| JSON parse / git diff --check | PASS | 基线、触点、偏离、queue JSON 均可解析；无 whitespace error。 |

因此 packaged 验证已通过，但整个 v0.16.8 验收和发布资格均未完成。implemented、packaged verified、real-machine/manual verified、release qualified 必须继续分开记录。

## 数据与安全边界

- 正式数据根是 .linguist-agent，开发数据根是 .linguist-agent-dev；测试和 smoke 必须使用精确临时 user-data-dir，不能读写真实用户根。
- CAT 项目继续使用每项目 cat.db；通用 Agent/Chat 配置继续以配置文件、JSON 和 JSONL 为权威源。
- Renderer 或模型不能以任意文件路径或 projectId 获取 CAT authority；归档/缺失项目的发送与 CAT mutation 必须 fail closed。
- 客户数据、userdata archive、恢复产物和私有扫描结果不得进入 Git。

## 仍未完成的工作

LA-SYNC-007 的 packaged 报告仍有 2 个手工和 3 个受阻覆盖缺口；其后单独取得的 Native Save 证据只关闭该子项，Native Open、真实 IME 和其他缺口仍未完成。当前 v2.1 queue 先推进 Host parity 与最小单文件 Intake/Proposal CAT 闭环；Agent 已可通过 opaque sourceToken 导入会话显式附件，目录扫描、durable Job、Memory、TEaR、Full-Scope Review、性能平台和低频 Adapter 已明确移出个人 Alpha，等待真实项目触发 successor Ticket。
