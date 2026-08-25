# Linguist Agent 当前实施状态

更新时间：2026-08-25

> `DONE` 表示实现和自动回归完成，不等于 packaged、真实 Provider、真机人工或产品资格。

| 范围 | 状态 | 当前证据 |
|---|---|---|
| Proma v0.17.59 基线 | DONE | `4546c5f7` 已由 `f53612ca` 一次 merge；三模式、独立数据根和 CAT authority 保留。 |
| 上游 Agent/Workspace 集成 | DONE | Workspace metadata authority 与 atomic submit/queue 已合入；即时路径继续传递冻结 `linguistContext`。 |
| 原生 Agent UI 收敛 | DONE | 删除上游已废弃的 Placeholder/Provider 包装；rail/full 仍复用同一 `AgentView`。 |
| 岗位委派与完成证据 | DONE | 复用 Proma Collaboration；子会话继承双绑定和冻结范围；CAT Store 计算 `linguistOutcome`。 |
| 版本、基线与文档 | DONE | App `0.17.60`、Shared `0.1.63`；baseline / ledger / deviations / canonical facts 已同步。 |
| 自动回归 | DONE | `29` 个活跃测试文件；默认 CI 关键回归 `293/293` 通过。 |
| 未打包 Electron build | DONE | main / workers / runtime / preload / renderer / CLI / Agent Island / EventKit / resources 均通过。 |
| Packaged 验证 | DONE / PARTIAL COVERAGE | `smoke:pack` 与完整 vertical 运行通过：Agent `15/15`、Chat `19/19`、Linguist `21/21`；Native Open/Save 仍为人工门禁。 |
| 真实 Provider 四岗位全链 | PENDING | 必须在当前 packaged app 内实际运行。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需同模型、同 reasoning 的真实语言任务对照。 |
| VALID-003 | BLOCKED BY ELAPSED USE | 需从当前可用构建开始累计 14 个真实日用日。 |

## 当前自动证据

- 全仓 typecheck；默认 CI 关键回归 `293/293`；boundary `4/4`；fusion `10/10`；Host Seam `7/7`；历史冲突回放 `9/9`。
- v0.17.59 精确生产 ledger `208`：Product Fork `201`、Generated `2`、Host Seam `4`、Temporary Deviation `1`。

## 证据边界

Fake Model packaged vertical 不能替代真实 Provider 四岗位交接、真实平台互操作或人工可用性证据。
