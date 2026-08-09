# Upstream Baseline — Proma v0.16.10

> 工单：SIMPLE-002
> 重置日期：2026-08-10
> 机读真源：[proma-baseline.json](./proma-baseline.json)

本文件记录 Linguist Agent 当前的 Proma 基线；它替代 v0.16.9
账本。旧 v0.15.11 快照保存在
[docs/archive/UPSTREAM_BASELINE-v0.15.11-702a8221.md](../archive/UPSTREAM_BASELINE-v0.15.11-702a8221.md)，不再作为当前改动或验证的依据。

## 已确认的 Git 事实

| 项目 | 值 |
|---|---|
| upstream | https://github.com/proma-ai/Proma |
| Proma tag / commit | v0.16.10 / 72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a |
| 正式 merge commit | ea26177f36d59bd2781d7ff9264451a8430e2249 |
| merge 的本地 parent | 34d73e27aaef46f3cead54b8fe2d3f2e7c3cecbe |
| merge 的 upstream parent | 72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a |
| 承载分支 | integration/la-proma-0.16.10 |

当前边界比较固定为：

    git diff --name-only 72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a...HEAD

对正式 merge commit ea26177f 重算得到 **808** 个变动路径；其中 **549** 个落在产品扩展/文档/测试的允许路径，**255** 个 Proma 核心触点登记在当时的 [proma-touchpoints.json](./proma-touchpoints.json)，另有 **4** 个文件仅做公开镜像本机路径占位符替换。这些数字只描述该正式 merge；后续实施将当前精确 ledger 更新为 **259** 个触点。

## 运行时与产品版本

| 项目 | 已确认值 |
|---|---|
| Linguist Agent（current manifest） | 0.16.33 |
| Proma Electron App（upstream tag manifest） | 0.16.10 |
| Electron | 43.2.0（manifest: ^43.2.0） |
| Bun | 1.3.14 |
| Pi runtime | 0.82.1 |
| Claude Agent SDK | 0.3.201 |
| CAT schema | 15 |

Linguist Prompt 使用单一 `LINGUIST_PROMPT_VERSION = 3.1.0`，岗位 Markdown 与 Common Contract 的唯一真源为 `resources/linguist-roles/`。当前已有静态 renderer Host Contracts 与 Extension Registry，但没有独立的 Host Contract runtime version constant；不得将它臆写成 v1。

## 验证边界

- 基线、机读触点和偏离分类由 LA-SYNC-006 维护。
- LA-SYNC-005 的打包结果与 LA-SYNC-007 的完整验收是不同状态：packaged smoke 通过不自动满足手工产品验收。
- 后续上游同步必须先更新 proma-baseline.json，再以真实 Git diff 重算触点；禁止沿用旧账本条目。
