# Upstream Baseline — Proma v0.17.42

> 更新日期：2026-08-17
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.17.42` / `28ca96a56828f23d0c08b9222569479eb007ee6c` |
| 本地起点 | `abf0ba57d4892e71cdc650f6ad6bafbda0d1fdd6` |
| LA merge commit | `34921b0cee92c78777cedef90bad3a8298522706` |
| 施工分支 | `codex/sync-proma-v0.17.42` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.45` / `0.17.42` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.2` |
| Shared | `0.1.99` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema | `16` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
