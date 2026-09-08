# Upstream Baseline — Proma v0.19.37

> 更新日期：2026-09-08
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.37` / `a987ec88fcfa05dd2448dc0ccdd9824a4b510dc6` |
| 本地起点 | `e940e1bd3586b77827b023a4b37f0e9c0f5766e1` |
| LA merge commit | `4a7cbcecf3b0be635a6dd49f71bff70f6ac9edb1` |
| 施工分支 | `codex/la-audit-upstream-20260908` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.72` / `0.19.37` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.85.0` |
| Shared | `0.1.71` |
| CAT Core / Formats / Store / Tools | `0.0.24 / 0.0.13 / 0.0.44 / 0.0.39` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
