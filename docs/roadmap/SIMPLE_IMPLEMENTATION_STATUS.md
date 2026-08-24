# Linguist Agent 当前实施状态

更新时间：2026-08-23

> `DONE` 表示实现和自动回归完成，不等于 packaged、真实 Provider、真机人工或产品资格。

| 范围 | 状态 | 当前证据 |
|---|---|---|
| Proma v0.17.59 基线 | DONE | `4546c5f7` 已由 `f53612ca` 一次 merge；三模式、独立数据根和 CAT authority 保留。 |
| 上游 Agent/Workspace 集成 | DONE | Workspace metadata authority 与 atomic submit/queue 已合入；即时路径继续传递冻结 `linguistContext`。 |
| 原生 Agent UI 收敛 | DONE | 删除上游已废弃的 Placeholder/Provider 包装；rail/full 仍复用同一 `AgentView`。 |
| 岗位委派与完成证据 | DONE | 复用 Proma Collaboration；子会话继承双绑定和冻结范围；CAT Store 计算 `linguistOutcome`。 |
| 版本、基线与文档 | DONE | App `0.17.60`、Shared `0.1.63`；baseline / ledger / deviations / canonical facts 已同步。 |
| 自动回归 | DONE | typecheck、同步专项与全量 `1558 pass / 0 fail` 通过。 |
| 未打包 Electron build | DONE | main / workers / runtime / preload / renderer / CLI / Agent Island / EventKit / resources 均通过。 |
| Packaged 验证 | DONE WITH KNOWN FAILURES | `smoke:pack`、产物完整性与 Chat `19/19` 通过；完整 vertical 因 Pi 旧 `_partial` 断言和 Renderer rail 遮挡未通过。 |
| 真实 Provider 四岗位全链 | PENDING | 必须在当前 packaged app 内实际运行。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需同模型、同 reasoning 的真实语言任务对照。 |
| VALID-003 | BLOCKED BY ELAPSED USE | 需从当前可用构建开始累计 14 个真实日用日。 |

## 当前自动证据

- 全仓 typecheck；boundary `4/4`；fusion `10/10`；Agent Full `17/17`；no-raw-palette `44/44`。
- Electron Linguist `214/214`；全量 `1558 pass / 0 fail`。
- v0.17.59 精确 ledger `263`：Permanent `41`、Host Seam `221`、Temporary `1`。

## 证据边界

自动测试和未打包 build 只证明合同与构建路径；不能替代 packaged startup、真实 Provider 四岗位交接、真实平台互操作或人工可用性证据。
