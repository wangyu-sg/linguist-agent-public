# Upstream Sync Policy — Proma 稳定版同步

> 更新日期：2026-08-25
>
> 当前基线：[Proma v0.17.59](./UPSTREAM_BASELINE.md)
>
> 自动流程：[upstream-sync.yml](../../.github/workflows/upstream-sync.yml)

## 同步原则

- 每 6 小时检查 Proma 最新 GitHub Release；已在当前基线时不产生分支或提交。
- 新稳定版只在 `automation/proma-<tag>` 候选分支合并，CI 通过后才快进 `main`、创建 LA Tag 与 Release；不跟随上游 `main` 的任意提交。
- 冲突按 [proma-sync-policy.json](./proma-sync-policy.json) 处理：LA overlay 和明确的上游接管路径自动处理；Host Seam、未登记路径或合同改变时快速失败并创建 Issue。
- [proma-baseline.json](./proma-baseline.json) 是版本与 merge 身份真源；[proma-touchpoints.json](./proma-touchpoints.json) 与 `PROMA_DEVIATIONS.json` 分别登记生产触点和偏差。
- 自动同步保留完整 Proma Agent / Chat 与 LA Vertical Agent Profile，不建立兼容层或第二套宿主能力。

## 候选分支门禁

候选分支复用常规 CI。上游接缝的最小专用检查是：

```bash
node scripts/verify-host-seams.mjs
node scripts/test-proma-sync-replay.mjs
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
```

CI 还运行 typecheck、关键回归、许可门禁、Electron build、`smoke:pack` 与 `smoke:vertical`。任何阶段失败都不会推进 `main` 或创建 Release。

## 人工同步

只在自动 resolver 报告合同变化时介入：从失败候选与影响报告定位根因，更新 Host Seam、policy 或 ledger，复用同一 CI 后再推进。历史演练和旧基线保留在 Git 与 `docs/archive/`，不作为当前策略。
