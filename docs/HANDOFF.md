# Linguist Agent 当前交接

更新时间：2026-08-05

## 当前结论

Proma v0.16.8 已在 sync/proma-v0.16.8 上正式 merge 为 f3d2b431996523a4aa75ec2b027dcf0e932ef08f。当前收敛、QA 事件闭环、Linguist auto-title 修复、CAT exact-duplicate preflight、Session-scoped Reference 回归、Companion Chat Host、Host Parity canary、最小 Agent Intake bridge 与 Proposal Critic 状态收敛已实现；边界登记和 packaged 验证基线提交到 `d4bc0b5d`，Agent Intake bridge 与状态登记提交到 `d4c642ce` / `d22aa215`，Host parity canary 提交到 `8fede6fd` / `87a5393b`；v2.1 的唯一 active 计划为 [LA_UNIFIED_MASTER_PLAN_V2.md](./roadmap/LA_UNIFIED_MASTER_PLAN_V2.md)，唯一 active machine queue 为 [linguist-fusion-queue.json](./roadmap/linguist-fusion-queue.json)。

LA-SYNC-002 至 LA-SYNC-006、LA-HOST-000/001、LA-HOST-003、LA-HOST-004/005、LA-CORRECT-001/002/003、LA-DATA-001、LA-TAG-000/003、LA-INTAKE-003/005/006、LA-REVIEW-001 已完成；收敛提交为 `48fb9923`，PB-074 模式标签修复为 `21554805`，QA 事件闭环为 `962f21c7`，auto-title 修复为 `024f51c0`，exact-duplicate preflight 为 `be1ed6fd`，引用隔离回归为 `daec672d`，Companion Chat Host 实现为 `d348df66`，边界登记为 `d4bc0b5d`，Host parity canary 为 `8fede6fd` / `87a5393b`。LA-HOST-002 仍为 IN_PROGRESS（实现回归与 packaged smoke 已通过，等待真实机器 Companion Chat roundtrip），LA-SYNC-007 保持 IN_PROGRESS，不得因为 packaged smoke 已通过而关闭；LA-INTAKE-001 仍为 IN_PROGRESS，当前只完成共享单文件路径，完整 scan/plan/job coordinator API 有意延后；LA-INTAKE-007 仍未完成，缺少结构化 import verification 与条件撤销。

## 已确认基线

| 项目 | 当前事实 |
|---|---|
| Proma Base | v0.16.8 / bde00f00323d6735a939d14dbce3b2f1a5b672bc |
| formal merge | f3d2b431996523a4aa75ec2b027dcf0e932ef08f |
| local parent | b84d65ac79ecf681fac21cf740a589da4aedbed4 |
| Electron App / Electron | 0.16.15 / 43.2.0 |
| Bun / Pi / Claude / CAT schema | 1.3.14 / 0.82.1 / 0.3.201 / 13 |
| baseline / touchpoints / deviations | docs/architecture/proma-baseline.json / proma-touchpoints.json / PROMA_DEVIATIONS.json |

## 已确认验证

- smoke:pack：PASS（使用临时 clang module cache）。
- smoke:vertical：PASS，Agent 12/12、Chat 18/18、Linguist 21/21；`runStatus=passed`、`coverageStatus=partial`。
- 仍未满足：2 个 MANUAL 和 3 个 BLOCKED coverage gaps。它们阻止 LA-SYNC-007、手工/真实机器资格和 release qualification。
- LF-048 Native Save 已在隔离 packaged app 克隆中手工通过；覆盖源文件被拒绝、源 SHA 不变、安全导出可重导入。
- 真实 IME 仍 BLOCKED：当前 macOS 只有 ABC 输入源；Native Open 仍未手工验证。

## 下一步

1. 继续取得 LA-SYNC-007 剩余手工与受阻覆盖证据；不要把 packaged 通过升级成 release qualified。
2. 按 v2.1 queue 继续 Proposal/QA 覆盖与正确性收口；Intake 005/006 已完成，Intake 007 的 verification/undo、目录扫描、durable Job、Memory、TEaR、Full-Scope Review、性能平台和低频 Adapter 等取消项不得插队。

## 安全与历史纪律

- 测试、smoke 和打包只能使用精确临时 user-data-dir；不得读写真实用户根。
- 客户数据、userdata archive、恢复产物和私有扫描结果不得进入 Git。
- 历史 v1 Gate 与 0.15.140 资料保留在 docs/archive/ 和历史报告中，只能作为历史上下文。
