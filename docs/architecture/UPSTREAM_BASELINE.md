# Upstream Baseline — Proma v0.19.1

> 更新日期：2026-08-29
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.1` / `3f1725c5b2e46c6aa85d64c175870c1fcb3bb5ed` |
| 本地起点 | `86fe58cd02d3a8f70b997909a5008999d7ad6151` |
| LA merge commit | `8819a4a0990dfedffb691bf1e5cc04cc78a0d6d5` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.63` / `0.19.1` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.2` |
| Shared | `0.1.66` |
| CAT Core / Formats / Store / Tools | `0.0.22 / 0.0.12 / 0.0.40 / 0.0.36` |
| CAT schema | `17` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
