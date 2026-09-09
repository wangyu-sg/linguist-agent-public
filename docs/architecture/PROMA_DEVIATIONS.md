# Proma Deviations — v0.19.37

> 机读真源：[PROMA_DEVIATIONS.json](./PROMA_DEVIATIONS.json)
> 当前基线与正式合并：[proma-baseline.json](./proma-baseline.json)

本账本说明差异的原因与退役条件。精确文件、所有者、接缝和理由以 [proma-touchpoints.json](./proma-touchpoints.json) 为准；不把已登记误作永久合理。

| 分类 | 当前生产触点 | 处理条件 |
|---|---:|---|
| Permanent Product Fork | 216 | 保留 LA 产品身份、独立数据根、发布与安全策略。 |
| Generated / Overlay | 2 | 每次同步重算 manifest 和构建标识。 |
| Local Host Seam | 11 | 上游提供等价、稳定且保留 Session authority 的合同后删除接缝。 |
| Temporary Deviation | 48 | 每次同步逐项核对生命周期、预览、安全与 continuation 回归；有等价证据后退役。 |
| Linguist Extension | 0 | 位于允许的 LA 路径，不计入 Proma Core 账本。 |

本轮 UI 收敛将右侧尺寸算法恢复到固定上游，精确账本相应减少一项。实现与本轮验证见 [0.17.73 实施记录](../release/VALIDATION_0_17_73.md)。

维护顺序为 baseline → 实际 diff → ledger → deviations → boundary + fusion。登记不能绕开权限、Session authority 或 CAT fail-closed；自动验证、打包验证、人工操作与产品资格分别记录。
