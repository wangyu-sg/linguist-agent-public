# Upstream Baseline — Proma v0.17.1

> 更新日期：2026-08-11
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.17.1` / `6094036d3f6f4363c44ce8a11155ecd531a80aae` |
| 本地起点 | `3f53e7b66c10734d88455ad65ded51acc46ab33e` |
| 正式 merge | `96155d1ad2f131e10fd2f0a6998ec13573aa2ead` |
| 施工分支 | `codex/la-proma-v0.17.1` |

正式 merge 相对 upstream 共变动 828 个路径：569 个允许路径、255 个已登记 Proma Core 触点、4 个仅做公开路径占位符替换。后续实施把当前精确触点 ledger 更新为 261 个。

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.2` / `0.17.1` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.82.1` |
| Shared | `0.1.95` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.10 / 0.0.37 / 0.0.34` |
| CAT schema | `15` |

当前主进程仅使用 Pi Runtime；Claude 模型通过 Provider 使用，不打包 Claude Agent SDK 或 Nowledge Runtime。Prompt 合同为 `3.1.0`；Host Contract 没有单独 runtime version，不得臆写。

后续上游同步必须先更新机读 baseline，再按真实 Git diff 重算 touchpoints / deviations，并分别执行 boundary、fusion、packaged 与人工验证。
