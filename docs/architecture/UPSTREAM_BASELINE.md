# Upstream Baseline — Proma v0.19.26

> 更新日期：2026-09-05
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.26` / `20a5aa8f7c19b8e91949b5fd74b9eee40d767078` |
| 本地起点 | `e95752dd0bd768cef8b70f84f22e8f9f48d89882` |
| LA merge commit | `ed8aedd60577ab88d1cca1f092ac5645c1da2d8f` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.70` / `0.19.30` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.85.0` |
| Shared | `0.1.69` |
| CAT Core / Formats / Store / Tools | `0.0.24 / 0.0.13 / 0.0.43 / 0.0.38` |
| CAT schema | `19` |

## 保留差异

- 上游 `v0.19.26` 之后的主线提交已同步至 `20a5aa8f`；该提交尚未对应新的 Proma 稳定 Tag，版本栏继续保留稳定 Tag 作为兼容标识。
- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
