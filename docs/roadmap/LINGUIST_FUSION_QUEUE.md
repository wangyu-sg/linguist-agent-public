# Linguist Fusion 执行队列

> 机器真源：`linguist-fusion-queue.json`。更新时间：2026-07-29。状态冲突时以机器文件、代码和实际验证输出为准。

## 状态纪律

- `unit_verified`：精确行为/类型测试完成。
- `integration_verified`：跨包、构建或完整本地矩阵完成。
- `packaged_verified`：真实打包 App 自动路径完成。
- `real_machine_verified`：人工真机证据完成。
- `gate_blocked`：实现可能完成，但规定的远端、人工或持续使用证据仍缺。

不能把 `integration_verified` 或 `packaged_verified` 自动写成产品资格通过。

## 固定约束

- 产品是完整 Proma Agent + Chat + Linguist Vertical Agent Profile / CAT Workbench。
- Linguist Rail/Full 复用原生 `AgentView`、Session、消息、工具、Thinking、权限和 Store。
- 模型只能创建待审 Proposal；Segment 写入必须经人工操作、CAS、locked 与 hard rails。
- 当前是个人 Alpha，没有公众安装包发布计划。

## 既有融合路线

| 阶段 | ID | 内容 | 状态 |
|---|---|---|---|
| 控制面 | LF-000~004 | 计划基线、packaged smoke、touchpoint/单一 Agent 架构 | **integration_verified** |
| 三模式 | LF-010~017 | Linguist mode、一等 Project Tab、MRU/恢复 | **packaged_verified** |
| Sidebar | LF-020~026 | 项目/会话/位置/管理入口 | **packaged_verified** |
| 原生 Agent | LF-030~037 | AgentView rail/full 与同 Session | **integration_verified** |
| CAT Workbench | LF-040~048 | Grid、Editor、CAS、键盘、手工 Gate | **gate_blocked** |
| Bottom Dock | LF-050~056 | TM/TB/QA/Context/Preview | **packaged_verified** |
| Agent↔CAT | LF-060~069 | Turn Context、Tool、Proposal、原生结果 UI | **packaged_verified** |
| Legacy 收口 | LF-070~078 | Settings、旧 UI 退役、单一 Workbench | **gate_blocked** |

LF-048 / LF-078 仍只受真实 IME 与 Native Open/Save 证据阻断；旧 UI 生产消费者已经为零。

## 最新优化蓝图

| ID | 内容 | 状态 |
|---|---|---|
| LF-079 | Proma Base + Linguist Prompt overlay / Runtime 继承契约 | **integration_verified** |
| LF-080 | Vertical Agent Profile、Role、Execution Scope 与工具继承 | **integration_verified** |
| LF-081 | Assistant/Reviewer/Auditor、Fast/Balanced/Best、离线评估集 | **integration_verified** |
| LF-082 | Linguist Shell、Rail/Full、原生 Session actions 与项目 CWD | **integration_verified** |
| LF-083 | Job/Checkpoint、幂等、State Capsule、outbox、运行摘要与 CAT undo | **integration_verified** |
| LF-084 | hard rules、ICU/placeholder、Consistency、batch/perf、worker jobs | **integration_verified** |
| LF-085 | CAT Tool result budget/projection、原生 UI 与定位 | **integration_verified** |
| LF-086 | 安全导出、trace/metrics 与脱敏诊断 | **integration_verified** |
| LF-087 | Stable ID v2 + v1 读取兼容 | **integration_verified** |
| LF-088 | Quick Health、worker-thread Full Scrub、Backup/Restore fault matrix | **integration_verified** |
| LF-089 | schema v13 Proposal Issuance/Provenance 与 Required/Forbidden gate | **integration_verified** |
| LF-090 | 数据库 identity 写前验证与 migration fail closed | **integration_verified** |

这些状态表示工程实现与 clean 本地矩阵通过；现有 packaged vertical 没有逐项操作所有新 UI，所以不把 LF-079~090 标为 `packaged_verified`。

## 个人 Alpha 门禁

| ID | 内容 | 状态 |
|---|---|---|
| AC-001 | Push/PR CI、固定 Bun、根测试零失败 | **gate_blocked** |
| AC-002 | Release/build resource fail closed | **integration_verified** |
| AC-003 | `.linguist-agent` 数据根与 Provider-only 导入 | **unit_verified** |
| AC-004 | BrowserWindow 显式安全选项 | **integration_verified** |
| AC-005 | Project Binding fail closed / 永久解绑 | **unit_verified** |
| AC-006 | Export 防覆盖原稿/受管目录 | **integration_verified** |
| AC-007 | 1000-turn 首载/补载/跳转 | **packaged_verified** |
| AC-008 | serious/critical Axe 清零 | **packaged_verified** |
| AC-009 | G10 Product Qualification | **gate_blocked** |
| AC-010 | G8 真实游戏文本盲评 | **gate_blocked** |
| AC-011 | 14 天自由日用 | **gate_blocked** |

AC-001 的本地实现与矩阵已绿，但最近远端 Run `30408252952` 仍失败；本轮未 push，故保持 blocked。

## 最终验证快照

- 实现与首轮文档 HEAD：`06ab894643253f64ce79deac45a293cd5d610b2b`
- 版本：Electron `0.15.137`，CAT Core/Store/Tools `0.0.12/0.0.24/0.0.17`
- clean source：typecheck 11/11；根 1,320；Electron 164；Core 116；Store 209；Tools 39；boundary 4；fusion 9；均 0 fail。
- 许可：417 个第三方依赖，门禁通过。
- build/pack：通过；137 个 runtime 依赖同步。
- packaged vertical：Agent 12/0、Chat 18/0、Linguist 17/0/2 manual；`runStatus=passed`、`coverageStatus=partial`。
- `app.asar` SHA-256：`f32b15263a962d1777cd8663aee89323ae65374796611a01270a74dad8aa6c9f`。
- 本机 `/Applications/Linguist Agent.app` 已替换为 clean HEAD 构建的 `0.15.137`；隔离启动与 1 个主窗口已验证，旧 `0.15.134` 位于废纸篓。

## 下一步

只补远端/人工/持续使用证据：

1. 推送净化后的公开源码快照并重跑远端 CI；
2. IME、Native Open/Save、VoiceOver、keyboard-only、drag/resize；
3. 真实 Provider/模型、真实客户格式与三档盲评；
4. 14 天连续日用。

暂不新增格式、OCR、多 Agent Team、自动模型路由或 Extension 市场。
