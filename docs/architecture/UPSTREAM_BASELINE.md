# Upstream Baseline — Proma v0.17.15

> 更新日期：2026-08-12
> 机读真源：[proma-baseline.json](./proma-baseline.json)

| 项目 | 值 |
|---|---|
| upstream | `https://github.com/proma-ai/Proma` |
| tag / commit | `v0.17.15` / `73e9d014b56dfda7554011bc02cf8ee5af2c5493` |
| 本地起点 | `4471505e3217cd2a286a2f03531b18512274ccc5` |
| LA merge commit | `2ade7e7e045ce6beab817778b1b39f897045fdf3` |
| 施工分支 | `codex/proma-v0.17.15-workspace-unification` |
| 验证日期 | `2026-08-12` |

该 merge 相对 upstream 共变动 841 个路径：581 个允许路径、256 个已登记 Proma Core 触点、4 个仅做公开路径占位符替换；当前精确账本为 258 个触点，见 [proma-touchpoints.json](./proma-touchpoints.json)。

## 运行时与产品版本

| 项目 | 当前值 |
|---|---|
| Linguist Agent / upstream app | `0.17.28` / `0.17.15` |
| Electron / Bun | `43.2.0` / `1.3.14` |
| Pi Runtime | `0.82.1` |
| Shared | `0.1.98` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.34` |
| CAT schema | `16` |

## 已知差异

- Linguist Agent 保留独立产品身份、`~/.linguist-agent(-dev)` 数据根、三模式和 CAT Store；不会与 Proma 共用用户数据。
- Linguist 作为第三个 Vertical Agent Profile 组合进原生 Workspace / Session / Agent Runtime；CAT authority 仍由 `linguistProjectId` 和主进程校验提供。
- 新 Linguist 会话只使用 Proma 原生 Workspace workbench。旧 session workspace 只在原生 workbench 为空时做一次不覆盖的历史文件复制，不再作为运行时 scope。
- General 的岗位委派仍由 Proma Collaboration 执行；LA 只给结果附加 CAT Store 计算的阶段覆盖证据，不新增工作流引擎。
- CAT 格式包保留厂商路由、direct-child target、SDL 嵌套 `mrk` 和原始 bytes 门禁；Store 未增加厂商格式分支。

当前主进程只使用 Pi Runtime；Claude 模型通过 Provider 使用，不打包 Claude Agent SDK 或 Nowledge Runtime。Prompt 合同为 `3.1.0`；Host Contract 没有单独 runtime version，不得臆写。

后续上游同步必须先更新机读 baseline，再按真实 Git diff 重算 touchpoints / deviations，并分别执行 boundary、fusion、packaged 与人工验证。
