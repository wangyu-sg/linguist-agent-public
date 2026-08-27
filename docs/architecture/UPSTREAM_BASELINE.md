# Upstream Baseline — Proma v0.18.2

> 更新日期：2026-08-27
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.18.2` / `92a635faa522d5d40544b06fdf74a28152012c71` |
| 本地起点 | `87f4843fef92a553a43f6de59d831832df6f0a42` |
| LA merge commit | `fc8e8f3d976e2a187b5c8fa610dbdbbd2bb42d79` |
| 施工分支 | `codex/proma-v0.18.2` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.61` / `0.18.2` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.2` |
| Shared | `0.1.63` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema | `16` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
