# Linguist Agent 当前事实

核验日期：2026-08-27（Asia/Shanghai）

本文只记录可由代码、manifest、测试或真实运行输出确认的事实。历史报告不得覆盖本文。

## Git 与基线

- 当前交付分支：`main`。
- Proma 基线：`v0.18.2@92a635faa522d5d40544b06fdf74a28152012c71`。
- LA 起点：`87f4843fef92a553a43f6de59d831832df6f0a42`。
- 正式 merge：`fc8e8f3d976e2a187b5c8fa610dbdbbd2bb42d79`。
- 正式 merge 之后另含版本、基线账本、构建修复与文档收口。

## 版本

| 层 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App / Electron | `0.17.61` / `43.2.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.63` |
| Agent Runtime | Pi `0.84.2`；不包含 Claude Agent SDK / Nowledge Runtime |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema / Tool count | `16` / `31` |

## 当前实现事实

- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench；没有第二套 Agent、Chat、Session、权限、Planning、Preview 或 Collaboration。
- 本轮一次 merge Proma v0.18.2；统一右侧工作区、Terminal、浏览器操作、归档分组、窗口布局及 Workspace 稳定性修复直接继承上游。
- `submitOrEnqueueAgentMessage` 的即时提交路径继续携带冻结的 `linguistContext`；普通 Agent 与 Linguist rail/full 仍共用原生 `AgentView`、队列和工具生命周期。
- Renderer 只通过 `agent-host-extension.tsx` 与 `app-mode-registry.ts` 两个锚点组合 Linguist；`AgentView` 沿用上游 `sessionId + embedded` 合同，AppShell / ModeSwitcher 不直接 import Linguist feature。
- QA 默认项目级列表并支持跨批次定位；窄视口 Agent rail 使用可关闭浮层，极窄视口左栏固定为图标栏且不改写用户偏好。
- 上游已删除的 `AgentPlaceholder` 与旧 Provider/AppShell 包装路径保持删除；相关 touchpoint 与静态测试清单同步清理。
- Linguist Session 继续由 `workspaceId + linguistProjectId` 绑定项目；Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration 与 CAT Tools 在同一 runtime 组合。
- General 仍可选择性委派 Translator、Reviewer 或 Proofreader；子会话冻结 Segment 范围并共享 CAT Store，`linguistOutcome` 与子会话运行状态分开记录。
- CAT 写入继续经过 Session authority、revision CAS、locked 与结构规则；读取、QA 与 consistency repair 不获得直接提交权。
- CLI 构建脚本使用当前 Bun 的 `process.execPath` 启动 `bun build --compile`，不再依赖调用进程的 PATH 查找 Bun。
- v0.18.2 精确 Proma Core ledger 为 `204` 个生产触点：Product Fork `195`、Generated `2`、Host Seam `6`、Temporary Deviation `1`。
- Host Seam 验证器覆盖 `7` 个锚点；固定 v0.17.59 历史冲突 `9/9` 均能分类，并有一条 merge → resolver → overlay → verifier 集成回归。
- Proma 自动同步保留策略解析、manifest overlay 与历史冲突回放；CI checkout 拉取完整历史。
- 内部启动初始化失败直接终止，不再吞错后创建半初始化窗口；会话绑定 IPC 失败显式进入 unavailable 状态。
- 测试代码收敛为 `29` 个活跃测试文件、`296` 条门禁用例；不再保留独立的全量库存测试。

## 本轮验证事实

- 全仓 typecheck 通过；默认 CI 关键回归 `296/296` 通过。
- upstream boundary `4/4`、fusion architecture `10/10`、Host Seam `7/7`、历史冲突分类 `9/9` 通过。
- 许可门禁通过，darwin-arm64 SBOM 与当前 `433` 个第三方生产依赖一致。
- `bun run electron:build` 通过；Electron main、CAT workers、Agent runtime、preload、renderer、CLI、Agent Island native、EventKit native 与 resources 均完成真实构建。
- 上一轮 `smoke:pack` 与 packaged artifact 完整性通过。
- 上一轮完整 `smoke:vertical` 运行通过：Pi Agent `15/15`、Chat `19/19`、Linguist `21/21`；报告 `runStatus=passed`、`coverageStatus=partial`，唯一自动化缺口为原生 Open/Save 对话框人工证据。
- `git diff --check`、baseline/deviations/touchpoints JSON 解析通过；公开身份与镜像清洁测试通过。

## 仍未取得的证据

- packaged app 中使用真实 Provider 完成 3–5 个匿名 Segment 的 General → Translator → Reviewer → Proofreader 全链。
- 同模型、同 reasoning 的真实语言任务对照。
- 真实 Phrase / memoQ 平台互操作、Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

这些项目保持 pending，不得由单元测试、Fake Model、未打包的 build 或旧安装版本冒充完成。
