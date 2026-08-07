# Upstream Baseline — Proma v0.16.9

> 工单：SIMPLE-002
> 重置日期：2026-08-08
> 机读真源：[proma-baseline.json](./proma-baseline.json)

本文件记录 Linguist Agent 当前的 Proma 基线；它替代 v0.16.8
账本。旧 v0.15.11 快照保存在
[docs/archive/UPSTREAM_BASELINE-v0.15.11-702a8221.md](../archive/UPSTREAM_BASELINE-v0.15.11-702a8221.md)，不再作为当前改动或验证的依据。

## 已确认的 Git 事实

| 项目 | 值 |
|---|---|
| upstream | https://github.com/proma-ai/Proma |
| Proma tag / commit | v0.16.9 / d08179d9b6e84a5ac8e33a7d70fc2e12dfde21cf |
| 正式 merge commit | 50a74398bb6f8949444593c2915a87a5f8964237 |
| merge 的本地 parent | 63f4bb8cca70958cac13f3abf1b0b6382dcbdd3c |
| merge 的 upstream parent | d08179d9b6e84a5ac8e33a7d70fc2e12dfde21cf |
| 承载分支 | sync/proma-v0.16.9-simple |

当前边界比较固定为：

    git diff --name-only d08179d9b6e84a5ac8e33a7d70fc2e12dfde21cf...HEAD

对正式 merge commit 50a74398 重算得到 **809** 个变动路径；其中 **549** 个落在产品扩展/文档/测试的允许路径，**256** 个 Proma 核心触点登记在 [proma-touchpoints.json](./proma-touchpoints.json)，另有 **4** 个文件仅做公开镜像本机路径占位符替换。这些数字只描述该正式 merge，不含其后的未提交工作。

## 运行时与产品版本

| 项目 | 已确认值 |
|---|---|
| Linguist Agent（current manifest） | 0.16.20 |
| Proma Electron App（upstream tag manifest） | 0.16.9 |
| Electron | 43.2.0（manifest: ^43.2.0） |
| Bun | 1.3.14 |
| Pi runtime | 0.82.1 |
| Claude Agent SDK | 0.3.201 |
| CAT schema | 15 |

Prompt 合同的已确认版本是 Profile 2.1.0、Quality Contract 1.0.0、Project Digest 1.0.0、Turn Context 1。当前已有静态 renderer Host Contracts 与 Extension Registry，但没有独立的 Host Contract runtime version constant；不得将它臆写成 v1。

## 验证边界

- 基线、机读触点和偏离分类由 LA-SYNC-006 维护。
- LA-SYNC-005 的打包结果与 LA-SYNC-007 的完整验收是不同状态：packaged smoke 通过不自动满足手工产品验收。
- 后续上游同步必须先更新 proma-baseline.json，再以真实 Git diff 重算触点；禁止沿用旧账本条目。
