# Linguist Fusion 当前事实

> 更新日期：2026-08-05。代码、manifest、测试和真实运行输出优先于历史报告。
>
> v2.1 计划与唯一 active queue 分别是 [LA_UNIFIED_MASTER_PLAN_V2.md](./LA_UNIFIED_MASTER_PLAN_V2.md) 和 [linguist-fusion-queue.json](./linguist-fusion-queue.json)。完整当前事实见 [CURRENT_FACTS.md](../../CURRENT_FACTS.md)。

## 当前基线

| 项目 | 当前事实 |
|---|---|
| 工作仓库 / 分支 | /Users/<local>/Desktop/linguist-agent-next / sync/proma-v0.16.8 |
| 当前 cleanup HEAD | 87a5393b |
| Proma Base | v0.16.8 / bde00f00323d6735a939d14dbce3b2f1a5b672bc |
| formal merge | f3d2b431996523a4aa75ec2b027dcf0e932ef08f |
| formal merge parents | b84d65ac79ecf681fac21cf740a589da4aedbed4 / bde00f00323d6735a939d14dbce3b2f1a5b672bc |
| Linguist Agent / Electron | 0.16.15 / 43.2.0 |
| Bun / Pi / Claude / CAT schema | 1.3.14 / 0.82.1 / 0.3.201 / 13 |
| 精确 baseline | [proma-baseline.json](../architecture/proma-baseline.json) |
| 触点与偏离账本 | [proma-touchpoints.json](../architecture/proma-touchpoints.json) / [PROMA_DEVIATIONS.json](../architecture/PROMA_DEVIATIONS.json) |

formal merge 的 766/514/252 是历史 merge 统计；当前收敛后的触点账本为 250 条（31 Permanent Product Fork、218 Local Host Seam、1 Temporary），8 条非必要通用 UI 触点已退役。

## 产品与架构事实

路线固定为：

    完整 Proma Agent + Chat 产品底座
    + Linguist Vertical Agent Profile + CAT Core / Store / Tools / Workbench

- PrimaryAppMode 只有 agent、chat、linguist。
- Agent / Chat 保持 Proma 原生能力；Linguist 是第三个并列主模式。
- Workbench Rail 与 Full Agent 复用同一个 AgentView、Session、消息、Thinking、工具、权限与 Store。
- CAT authority 来自主进程验证后的 Session binding；Renderer 和模型不能提交任意路径或 projectId。
- 模型只能创建 pending Proposal；人工操作经 revision CAS、locked 与 hard-rule 检查后才可写 Segment。
- CAT Core 不依赖 React、Electron 或 Proma UI；Linguist 代码优先停留在 allowlisted vertical roots。

## 同步与验证状态

| Ticket | 状态 | 事实 |
|---|---|---|
| LA-SYNC-002 | DONE | Proma v0.16.8 formal merge 已完成。 |
| LA-SYNC-003 / LA-SYNC-004 | DONE | Runtime/Session 与原生 surface/sidebar/settings reconciliation 已在 merge 中。 |
| LA-SYNC-005 | DONE | smoke:pack PASS；smoke:vertical PASS。 |
| LA-SYNC-006 | DONE | baseline、touchpoints 与 deviations 已经 current verification。 |
| LA-SYNC-007 | IN_PROGRESS | Agent 12/12、Chat 18/18、Linguist 21/21 packaged coverage 通过；报告 runStatus=passed、coverageStatus=partial，2 个 MANUAL 与 3 个 BLOCKED coverage gaps 仍未解除。 |
| LA-HOST-000 / LA-HOST-004 | DONE | 静态 Host Contracts/Registry 与 truthful Rail/Full capability manifest 已接入；没有动态插件加载。 |
| LA-CORRECT-001/002/003 | DONE | 工具根 schema、数字词汇歧义和术语 whole-word 匹配已修复并分别通过包级回归。 |
| LA-DATA-001 | DONE | QA 重跑把 resolved finding IDs 和完成 segment IDs 写入 mutation 与 durable project event；cat-tools typecheck、39/39 测试通过。 |
| LA-HOST-003 | DONE | Linguist 默认会话复用 Proma 默认标题，首轮可进入统一 auto-title；显式标题不覆盖。 |
| LA-HOST-001 | DONE | Proma quotedSelectionMapAtom、历史选区入口与 Agent Composer/Send 共用 sessionId；Linguist/普通 Agent 隔离回归通过。 |
| LA-HOST-002 | IN_PROGRESS | Linguist 已接入复用 Proma ChatView 的 chat-only Companion Host；实现级回归、smoke:pack 与 smoke:vertical 已通过，仍缺真实机器 Companion Chat roundtrip。 |
| LA-HOST-005 | DONE | 现有 Agent Full/Chat/Companion 合同测试加 capability-key canary，Rail/Full 缺失新增 Proma 宿主能力键时会失败。 |
| LA-TAG-000 / LA-TAG-003 | DONE | PB-097 Tag Model、确定性校验和编辑器保护已有单一实现与回归证据。 |
| LA-INTAKE-001 | IN_PROGRESS | Alpha 单文件 UI/Agent 已共用 ProjectDelivery.importAsset；完整 scan/plan/job coordinator API 有意留到真实批量阻断后，不在当前 Alpha。 |
| LA-INTAKE-003 | DONE | 输入字节 SHA-256 精确重复在格式解析前跳过；新文件继续走既有格式探测并对 unsupported fail closed。 |
| LA-INTAKE-005 | DONE | `cat_list_intake_sources` / `cat_import_asset` 只接受当前会话显式附件的 opaque sourceToken，不暴露路径；导入复用 ProjectDelivery，包级与 Electron Linguist 回归通过。 |
| LA-INTAKE-006 | DONE | UI project IPC 与 Agent source-token bridge 都调用同一个 LinguistProjectService/ProjectDelivery.importAsset，没有第二套格式探测或写入路径。 |
| LA-INTAKE-007 | TODO | 现有导入已有 source hash、exact duplicate、source blob 与事务写入校验；结构化 Verification Report 和引用感知的 Import Undo 尚未实现。 |
| LA-REVIEW-001 | DONE | 现有 `cat_submit_critic_review` 已承担 Proposal Critic：独立身份、snapshot 绑定、advisory artifact 与 QA findings；包级回归覆盖独立性与 stale snapshot。 |

packaged gate 通过不等于 manual/real-machine verified，也不等于 release qualified。LF-048 Native Save 已另行手工通过；真实 IME 因当前机器只有 ABC 输入源而 BLOCKED，Native Open 仍待验证。

## 历史资料

旧 v1 的 0.15.140 历史证据、旧队列与 Gate 报告没有被删除，但不再覆盖当前状态。需要历史上下文时，使用 docs/archive/ 与各历史 Gate 报告，并明确标记为历史。
