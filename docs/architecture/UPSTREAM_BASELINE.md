# Upstream Baseline — Proma v0.19.26

> 更新日期：2026-09-04
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.19.26` / `bbf577a8eb768225fdf1ac49ab9ef07a11413b24` |
| 本地起点 | `7bbb743fb78803cf68fa53bedddc43ea7b7e3f02` |
| LA merge commit | `98f0ed125c4e619d0496e10279755e69643341f5` |
| 施工分支 | `main` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.69` / `0.19.26` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.84.4` |
| Shared | `0.1.69` |
| CAT Core / Formats / Store / Tools | `0.0.23 / 0.0.13 / 0.0.42 / 0.0.37` |
| CAT schema | `19` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
