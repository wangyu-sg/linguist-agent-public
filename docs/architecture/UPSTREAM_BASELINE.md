# Upstream Baseline — Proma v0.17.26

> 更新日期：2026-08-14
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.17.26` / `db94285a6c6eaeea6a75a3fcf9d67a22e8bc45ba` |
| 本地起点 | `42bc31896c02c65bf47a1b1bcda10efe54f0bbed` |
| LA merge commit | `0a09ee5e53e8ed647a4b130bce1d73c4631bd67e` |
| 施工分支 | `codex/release-upstream-v01726` |

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.34` / `0.17.26` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.82.1` |
| Shared | `0.1.98` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.34` |
| CAT schema | `16` |

## 保留差异

- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。
- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。
- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。
