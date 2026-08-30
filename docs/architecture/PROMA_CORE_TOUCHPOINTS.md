# Proma Core Touchpoints — v0.19.5

> 基线：`v0.19.5@c261cbc5344a6d4a22d30de57e489efd0e56062d`
> 正式 merge：`cf2832f3ebb07a65a7af30d5834858b6a8dfec5b`
> 机读真源：[proma-touchpoints.json](./proma-touchpoints.json)

| 集合 | 路径数 |
|---|---:|
| Permanent Product Fork | 201 |
| Generated / Overlay | 2 |
| Main Host Seam | 5 |
| Renderer Host Seam | 3 |
| Temporary Deviation | 1 |
| 当前精确 ledger | 212 |

账本使用 schema v3；每个条目都记录 `kind`、`owner`、`mergePolicy`、具体理由，以及 Host Seam 的稳定 `hook`。Linguist Extension 位于允许根，不计入 Proma Core Touchpoint。精确文件只维护在 JSON，避免双写漂移。

## 规则

1. CAT 领域代码优先进入 `apps/electron/src/**/linguist/`、`packages/linguist-*`、`resources/linguist-*` 与默认本地化 Skill 目录。
2. 修改 Proma Core 生产代码必须在同一变更中登记精确触点、所有者、合并策略和真实理由；测试文件不进入生产触点账本，stale 条目同样会被 boundary test 拒绝。
3. `tests/upstream-boundary.test.ts` 同时检查 HEAD、tracked 工作树和 untracked 文件。
4. Main Host Seam 仅保留 Agent Extension、IPC、Preload 与 Collaboration；Collaboration 的同一 hook 跨委派工具与 Pi builtin 传递可信 Context。Renderer Host Seam 只保留 AgentView、AppShell 和右侧工作区扩展三处；Pi compaction continuation context 是唯一 Temporary Deviation。
5. 同步规则由 [proma-sync-policy.json](./proma-sync-policy.json) 管理；Anchor 和深层领域 import 由 `scripts/verify-host-seams.mjs` 验证。
6. 维护顺序固定为 baseline → 实际 diff → ledger → deviations → boundary + fusion。

不要扩大白名单来掩盖核心改动，也不要把“已登记”误解为永久合理。
