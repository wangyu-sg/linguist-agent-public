# Proma Core Touchpoints — v0.17.42

> 基线：`v0.17.42@28ca96a56828f23d0c08b9222569479eb007ee6c`
> 正式 merge：`34921b0cee92c78777cedef90bad3a8298522706`
> 机读真源：[proma-touchpoints.json](./proma-touchpoints.json)

| 集合 | 路径数 |
|---|---:|
| formal merge 全部变动 | 867 |
| 允许路径 | 599 |
| 仅公开路径占位符替换 | 4 |
| formal merge 已登记核心触点 | 264 |
| 当前精确 ledger | 265 |

当前分类为 Permanent Product Fork 42、Local Host Seam 222、Temporary Deviation 1；Linguist Extension 位于允许根，不计入核心触点。精确文件、票号和理由只维护在 JSON，避免双写漂移。

## 规则

1. CAT 领域代码优先进入 `apps/electron/src/**/linguist/`、`packages/linguist-*`、`resources/linguist-*` 与默认本地化 Skill 目录。
2. 修改 Proma Core 必须在同一变更中登记精确触点和理由；stale 条目同样会被 boundary test 拒绝。
3. `tests/upstream-boundary.test.ts` 同时检查 HEAD、tracked 工作树和 untracked 文件。
4. Temporary Deviation 目前仅 Pi compaction continuation context；下次 upstream sync 必须复核并在上游提供等价 hook 后删除。
5. 维护顺序固定为 baseline → 实际 diff → ledger → deviations → boundary + fusion。

不要扩大白名单来掩盖核心改动，也不要把“已登记”误解为永久合理。
