# Proma Drift 审计

`scripts/audit-proma-drift.mjs` 只读比较当前分支与
`docs/architecture/proma-baseline.json` 指定的 Proma commit，并把每个差异归入：

- `la-owned`
- `product-fork`
- `host-seam`
- `generated`
- `cosmetic-drift`
- `stale`
- `accidental`

运行：

```bash
node scripts/audit-proma-drift.mjs
```

基线、Git ref、触点账本或审计规则不可读时命令返回非零。输出为 JSON；
`highConflictFiles` 按非 LA 自有文件的差异行数列出高频冲突候选，`stale` 表示账本仍登记但相对基线已无差异。

分类规则位于 `proma-drift-audit.json`。未命中规则的差异一律归为 `accidental`，交由人工复核。
