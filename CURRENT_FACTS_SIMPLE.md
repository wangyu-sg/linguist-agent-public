# Linguist Agent 当前事实

核验日期：2026-09-04（Asia/Shanghai）

本文只记录可由代码、manifest、测试或真实运行输出确认的事实。历史报告不得覆盖本文。

## Git 与基线

- 当前交付分支：`main`。
- Proma 基线：`v0.19.26@bbf577a8eb768225fdf1ac49ab9ef07a11413b24`。
- LA 起点：`7bbb743fb78803cf68fa53bedddc43ea7b7e3f02`。
- 正式 merge：`98f0ed125c4e619d0496e10279755e69643341f5`。
- 正式 merge 之后另含基线账本与 `0.17.69` 发布文档收口。

## 版本

| 层 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App / Electron | `0.17.69` / `43.2.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.69` |
| Agent Runtime | Pi `0.84.4`；不包含 Claude Agent SDK / Nowledge Runtime |
| CAT Core / Formats / Store / Tools | `0.0.23 / 0.0.13 / 0.0.42 / 0.0.37` |
| CAT schema / Tool count | `19` / `31` |

## 当前实现事实

- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench；没有第二套 Agent、Chat、Session、权限、Planning、Preview 或 Collaboration。
- 本轮一次 merge Proma v0.19.26；Brave / Tavily MCP 预设、系统浏览器打开入口、Fable 5.1 与子会话思考强度控制，以及文件面板修复直接继承上游。
- 普通 Agent 折叠侧栏中的项目预览恢复快捷切换：选择项目后打开该 Workspace 最近的普通主会话。
- `submitOrEnqueueAgentMessage` 的即时提交路径继续携带冻结的 `linguistContext`；普通 Agent 与 Linguist rail/full 仍共用原生 `AgentView`、队列和工具生命周期。
- Renderer 只通过 `agent-host-extension.tsx` 与 `app-mode-registry.ts` 两个锚点组合 Linguist；`AgentView` 沿用上游 `sessionId + embedded` 合同，AppShell / ModeSwitcher 不直接 import Linguist feature。
- QA 默认项目级列表并支持跨批次定位；窄视口 Agent rail 使用可关闭浮层，极窄视口左栏固定为图标栏且不改写用户偏好。
- 上游已删除的 `AgentPlaceholder` 与旧 Provider/AppShell 包装路径保持删除；相关 touchpoint 与静态测试清单同步清理。
- Linguist Session 继续由 `workspaceId + linguistProjectId` 绑定项目；Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration 与 CAT Tools 在同一 runtime 组合。
- General 仍可选择性委派 Translator、Reviewer 或 Proofreader；子会话冻结 Segment 范围并共享 CAT Store，`linguistOutcome` 与子会话运行状态分开记录。
- CAT 写入继续经过 Session authority、revision CAS、locked 与结构规则；读取、QA 与 consistency repair 不获得直接提交权。
- CLI 构建脚本使用当前 Bun 的 `process.execPath` 启动 `bun build --compile`，不再依赖调用进程的 PATH 查找 Bun。
- v0.19.26 Proma Core ledger 为 `236` 个生产触点：Product Fork `224`、Generated `2`、Host Seam `8`、Temporary Deviation `2`。
- Host Seam 验证器覆盖 `9` 个锚点；固定 v0.17.59 历史冲突 `9/9` 均能分类，并有一条 merge → resolver → overlay → verifier 集成回归。
- Proma 自动同步保留策略解析、manifest overlay 与历史冲突回放；CI checkout 拉取完整历史。
- 内部启动初始化失败直接终止，不再吞错后创建半初始化窗口；会话绑定 IPC 失败显式进入 unavailable 状态。
- 发布门禁继续显式列出关键回归，不保留独立的全量库存测试。

## 本轮验证事实

- 全仓 typecheck 通过；全仓测试 `282/282` 通过。
- upstream boundary `4/4`、fusion architecture `14/14`、Host Seam `9/9`、历史冲突分类 `9/9` 通过。
- 许可门禁通过，darwin-arm64 SBOM 与当前 `489` 个第三方生产依赖一致。
- `bun run electron:build` 通过；Electron main、CAT workers、Agent runtime、preload、renderer、CLI、Agent Island native、EventKit native 与 resources 均完成真实构建。
- 上一轮 `smoke:pack` 与 packaged artifact 完整性通过。
- 上一轮完整 `smoke:vertical` 运行通过：Pi Agent `15/15`、Chat `19/19`、Linguist `21/21`；报告 `runStatus=passed`、`coverageStatus=partial`，唯一自动化缺口为原生 Open/Save 对话框人工证据。
- `v0.17.69` GitHub Release 三平台构建与发布成功；macOS 更新元数据同时包含 arm64 / x64 ZIP 及校验值。本机安装版未替换，尚未记录安装后版本或哈希。
- `git diff --check`、baseline/deviations/touchpoints JSON 解析通过；公开身份与镜像清洁测试通过。

## 仍未取得的证据

- packaged app 中使用真实 Provider 完成 3–5 个匿名 Segment 的 General → Translator → Reviewer → Proofreader 全链。
- 同模型、同 reasoning 的真实语言任务对照。
- 真实 Phrase / memoQ 平台互操作、Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

这些项目保持 pending，不得由单元测试、Fake Model、未打包的 build 或旧安装版本冒充完成。
