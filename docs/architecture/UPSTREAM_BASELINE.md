# Upstream Baseline — Proma v0.17.46

> 更新日期：2026-08-20
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.17.46` / `2a73cd6b7674935b0af1bd59d84b8db1195e77fe` |
| 本地起点 | `5cda029ca9b53beca2767c4c3e523b1037be92ad` |
| LA merge commit | `19584b802d31f37095714a4db48c6fa545cd2c32` |
| 施工分支 | `codex/sync-proma-v0.17.46` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.47` / `0.17.46` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.2` |
| Shared | `0.1.100` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema | `16` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
