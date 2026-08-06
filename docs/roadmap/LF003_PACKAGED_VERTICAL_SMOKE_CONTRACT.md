# LF-003：Packaged Vertical Smoke 证据合同

## 运行入口

从 `apps/electron` 执行：

```bash
PATH="$HOME/.bun/bin:$PATH" node scripts/smoke/run-vertical-smoke.ts
```

建议主线在 `apps/electron/package.json` 增加同义入口：

```json
"smoke:vertical": "node scripts/smoke/run-vertical-smoke.ts"
```

LF-003 本票不修改并行施工中的 `package.json`，避免版本和 lockfile 冲突。

## 执行顺序

1. `smoke:pack`：从当前工作区重新构建真实 packaged Electron；
2. G1：复用 Pi Agent packaged probe；
3. G0：复用 Chat packaged probe；
4. G7：复用当前 CAT packaged vertical probe。

总入口不复制 Playwright launch、Fake Model Server、临时 HOME 或清理逻辑。每个
probe 仍负责自己的隔离和断言。

## Fail-closed 规则

- 打包失败时，后续步骤必须是 `not_reached`，不得运行陈旧产物；
- 任一已执行步骤退出码非零，总入口退出码必须非零；
- 报告中的 `passed` 只代表该命令本次退出码为零；
- `blocked` 不能折算成 `passed`；
- `MANUAL` 不能折算成自动验证；
- 只有 `coverageStatus=complete` 且全部步骤通过，才可宣称完整三路径合同通过。

每次运行覆盖写入：

```text
apps/electron/out/smoke/vertical/
├── vertical-smoke-report.json
├── package.log
├── agent.log
├── chat.log
└── linguist-current.log
```

报告固定记录实际 Git HEAD、工作区是否 dirty 及 `git status --porcelain` 路径清单、
时间、命令、退出码、App 路径、`app.asar` SHA-256、各步骤状态和未覆盖项。这样不会把
包含未提交改动的本地构建错误标注成某个纯净 HEAD 的产物。

## 当前覆盖边界

| 路径 | 当前自动证据 | 尚未覆盖 |
|---|---|---|
| Agent | packaged 冷启动、Pi 发送、Streaming、Thinking、final、Stop（流式收敛）与 Retry（同会话重发） | — |
| Chat | packaged 创建、Streaming、Thinking、Tool、Retry、Stop、重启恢复、Chat→Agent 往返状态保持 | — |
| Linguist | Linguist Mode、Project Tab、Workbench、Agent-CAT、Proposal、QA、导出验证、重启恢复 | macOS 原生 Open/Save Dialog |

G-F1 已由当前 packaged vertical 覆盖。总报告仍固定为 `coverageStatus=partial`，因为
macOS 原生 Open/Save Dialog 尚未自动化；
该缺口继续记录为 `blocked`，不能提前改写为完整产品资格通过。
