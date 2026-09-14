# Upstream Baseline — Proma v0.19.53

> 更新日期：2026-09-14
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.53` / `f99edbdb594407ab190b97ae073889c5d96637ab` |
| 本地起点 | `9f0de928697067e9e41841d7de8d04c5de317bd6` |
| LA merge commit | `56bc3f29b225c71f02f42483e10f1db8c3fcb2d5` |
| 施工分支 | `codex/la-upstream-v0.19.53-20260914` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.74` / `0.19.53` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.85.1` |
| Shared | `0.1.71` |
| CAT Core / Formats / Store / Tools | `0.0.24 / 0.0.13 / 0.0.45 / 0.0.39` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
