# Proma Deviations — v0.19.37

> 机读真源：[PROMA_DEVIATIONS.json](./PROMA_DEVIATIONS.json)
> 当前基线与正式合并：[proma-baseline.json](./proma-baseline.json)

本账本说明差异的原因与退役条件。精确文件、所有者、接缝和理由以 [proma-touchpoints.json](./proma-touchpoints.json) 为准；不把已登记误作永久合理。

| 分类 | 当前生产触点 | 处理条件 |
|---|---:|---|
| Permanent Product Fork | 217 | 保留 LA 产品身份、独立数据根、发布与安全策略。 |
| Generated / Overlay | 2 | 每次同步重算 manifest 和构建标识。 |
| Local Host Seam | 11 | 上游提供等价、稳定且保留 Session authority 的合同后删除接缝。 |
| Temporary Deviation | 48 | 每次同步逐项核对生命周期、预览、安全与 continuation 回归；有等价证据后退役。 |
| Linguist Extension | 0 | 位于允许的 LA 路径，不计入 Proma Core 账本。 |

本轮删除 5 个已被上游吸收或退役的触点，增加共享原子 JSON 写入的安全修复触点。合并记录与验证见 [全仓库审查与优化记录](../release/REPOSITORY_AUDIT_2026_09_08.md)。

维护顺序为 baseline → 实际 diff → ledger → deviations → boundary + fusion。登记不能绕开权限、Session authority 或 CAT fail-closed；自动验证、打包验证、人工操作与产品资格分别记录。
