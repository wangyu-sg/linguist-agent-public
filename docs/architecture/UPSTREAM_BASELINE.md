# Upstream Baseline — Proma v0.19.31

> 更新日期：2026-09-06
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.31` / `7a3721d7cfe6e107b58c79e27a43fa463dac21ee` |
| 本地起点 | `855356a26fc418ea0fc56245b0c910a9abd015c7` |
| LA merge commit | `b2c71810d750e55d737942d7c3855da36bc8ad59` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.70` / `0.19.31` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.85.0` |
| Shared | `0.1.69` |
| CAT Core / Formats / Store / Tools | `0.0.24 / 0.0.13 / 0.0.43 / 0.0.38` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
