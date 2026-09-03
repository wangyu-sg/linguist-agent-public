# Upstream Baseline — Proma v0.19.23

> 更新日期：2026-09-03
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.23` / `1ab22a17effd344c3f376538318efbf1628150ea` |
| 本地起点 | `f95e1880b75a0c1dcfd090f3e48303fdbd7bb4d2` |
| LA merge commit | `8ff00976ea91b83242f4c46a66d70d4dae129bac` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.68` / `0.19.23` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.4` |
| Shared | `0.1.68` |
| CAT Core / Formats / Store / Tools | `0.0.23 / 0.0.13 / 0.0.42 / 0.0.37` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
