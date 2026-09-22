# Upstream Baseline — Proma v0.19.57

> 更新日期：2026-09-22
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.57` / `4e96c5e859302c4a34618d45db352b29a7ebeb28` |
| 本地起点 | `2e23c2acfb0c23fa4383917cf9f94e70396835ac` |
| LA merge commit | `b9417191d80d96e15a2702c9f8f927327312a970` |
| 施工分支 | `codex/la-proma-01957-ui` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.18.1` / `0.19.57` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.86.1` |
| Shared | `0.1.73` |
| CAT Core / Formats / Store / Tools | `0.0.26 / 0.0.13 / 0.0.47 / 0.0.41` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
