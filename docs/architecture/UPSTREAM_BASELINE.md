# Upstream Baseline — Proma v0.19.5

> 更新日期：2026-08-30
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.5` / `c261cbc5344a6d4a22d30de57e489efd0e56062d` |
| 本地起点 | `c11e0f6b3d5f33cda53f9a780a6f4d6bac2733ed` |
| LA merge commit | `cf2832f3ebb07a65a7af30d5834858b6a8dfec5b` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.65` / `0.19.5` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.4` |
| Shared | `0.1.66` |
| CAT Core / Formats / Store / Tools | `0.0.22 / 0.0.12 / 0.0.41 / 0.0.36` |
| CAT schema | `18` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
