# Linguist Agent 当前实施状态

更新时间：2026-08-12

> `DONE` 表示实现和自动回归完成，不等于 packaged、真实 Provider、真机人工或产品资格。

| 范围 | 状态 | 当前证据 |
|---|---|---|
| C0 Proma v0.17.15 基线 | DONE | `73e9d014` 已由 `2ade7e7e` 一次 merge；三模式、独立数据根和 CAT authority 保留。 |
| C1 一项目一 Workspace | DONE | 新 Linguist 会话使用原生 Workspace workbench；历史目录只做不覆盖迁移。 |
| C2 Workspace Runtime 能力 | DONE | Orchestrator 保留 workspaceId/slug；普通 Agent 无 CAT Tools，Linguist 同时有 Workspace 能力和 CAT Tools。 |
| C3 岗位委派与完成证据 | DONE | 复用 Proma Collaboration；子会话继承双绑定和冻结范围；`linguistOutcome.status` 由 CAT Store 覆盖计算。 |
| C4 最小自动验收 | DONE | Workspace / Agent Session / CAT Tools / Collaboration / 101 Segment 回归通过。 |
| C5 CAT 格式加固 | DONE | 6 个指定失败样例与 CAT Formats 全包 `166/166` 通过；无 Store 厂商分支。 |
| K1–K5 Workspace UX | DONE | 原生 Workspace、Files、阶段覆盖、typed format error 与两层资格 UI 已合入；无第二套 Agent/工作流状态机。 |
| C6 文档与基线 | IN PROGRESS | baseline / ledger / canonical facts 已同步；README / AGENTS 仍待用户明确文件级授权。 |
| Packaged 验证 | BLOCKED BY PERMISSION | EventKit native 需要准备 Node 24.3.0 headers；当前未获下载授权。 |
| 真实 Provider 四岗位全链 | PENDING | 必须在当前 packaged app 内实际运行，上一轮单次 Provider 请求不足以证明。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需同模型、同 reasoning 的真实语言任务对照。 |
| VALID-003 | BLOCKED BY ELAPSED USE | 需从当前可用构建开始累计 14 个真实日用日。 |

## 当前自动证据

- 全仓 typecheck 通过；CAT Formats `166/166`；boundary `4/4`。
- agent-session `27`、binding/copy `13`、session CAT tools `11`、fusion architecture `10`，以及 migration/scope/integrity/diagnostics/delegation 专项通过。
- Renderer production build、Electron Linguist `213/213` 通过；全量 `1539 pass / 11` 个既有失败，本轮无新增失败。
- Electron main / preload / renderer / CLI / Agent Island 构建通过；完整 build 尚未越过 EventKit native 阶段。

## 证据边界

自动测试只证明合同和代码路径；部分 build、旧安装版本和 Fake Model 都不能替代当前 packaged startup、真实 Provider 四岗位交接、真实平台互操作或人工可用性证据。
