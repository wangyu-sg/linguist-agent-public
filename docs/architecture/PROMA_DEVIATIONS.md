# Proma Deviations — v0.17.59

> 机读真源：[PROMA_DEVIATIONS.json](./PROMA_DEVIATIONS.json)
> 基线：v0.17.59 / 4546c5f7d0fbfa4ed1d58aec63705fc75a9020c2
> formal merge：f53612ca6566b58857173aa522fa73e229e5f08c

本账本回答“为什么这不是上游代码、何时可以删掉”，而不是把每个差异都当作永久正当化。精确路径见 [proma-touchpoints.json](./proma-touchpoints.json)。v0.17.59 formal merge 登记 263 个触点；当前账本共 263 个。

| 分类 | 当前范围 | 处理 / sunset |
|---|---|---|
| **Permanent Product Fork** | 产品身份、独立数据根、发布、安全策略、资源、CLI、lock/manifest（41 个已登记触点） | 产品仍为独立 Linguist Agent 时无计划移除；产品身份改变时重新评估。 |
| **Local Host Seam** | Runtime/Session/IPC/Preload/Shared 与原生 Agent/Chat Shell 的组合缝（221 个已登记触点） | 上游提供等价、稳定且仍可 fail closed 的 Host Contract 后，在下一次上游同步逐项替换或删除。 |
| **Linguist Extension** | main/lib/linguist、features/linguist、packages/linguist-*、项目 skills | 不进入 Proma Core；CAT vertical 仍是产品能力时保留。 |
| **Temporary Deviation** | pi-agent-adapter.ts 的 compaction continuation context preservation（1 个触点） | Proma/Pi 提供等价的 typed host-owned continuation hook 后移除；下次上游同步必须复核。 |

## 禁止的解释

- “有 ticket”不等于可以绕开权限、Session authority 或 CAT fail-closed 约束。
- “上游尚未提供 API”不等于可以扩散改动；优先收窄为一个 Local Host Seam。
- “目前通过测试”不等于具有发布资格；packaged Gate、手工验收和受阻覆盖必须分别记录。

## 更新流程

每次上游同步后，先更新 [proma-baseline.json](./proma-baseline.json)，用实际 Git diff 重算触点，再复查此文件的分类和 sunset。删除已被上游吸收的条目，不能以旧票号保留 stale 记录。
