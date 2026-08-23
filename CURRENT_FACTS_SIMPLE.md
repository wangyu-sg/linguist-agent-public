# Linguist Agent 当前事实

核验日期：2026-08-23（Asia/Shanghai）

本文只记录可由代码、manifest、测试或真实运行输出确认的事实。历史报告不得覆盖本文。

## Git 与基线

- 当前施工分支：`codex/sync-proma-v0.17.59`。
- Proma 基线：`v0.17.59@4546c5f7d0fbfa4ed1d58aec63705fc75a9020c2`。
- LA 起点：`3cfb14ff09baea1c042356b93be2809fb11774c5`。
- 正式 merge：`f53612ca6566b58857173aa522fa73e229e5f08c`。
- 正式 merge 之后另含版本、基线账本、构建修复与文档收口；分支尚未推送或合入 `main`。

## 版本

| 层 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App / Electron | `0.17.60` / `43.2.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.101` |
| Agent Runtime | Pi `0.84.2`；不包含 Claude Agent SDK / Nowledge Runtime |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema / Tool count | `16` / `31` |

## 当前实现事实

- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench；没有第二套 Agent、Chat、Session、权限、Planning、Preview 或 Collaboration。
- 本轮一次 merge Proma v0.17.59；上游 Workspace metadata authority、atomic submit/queue、Agent UI 清理及其他原生能力直接继承，不建立兼容层。
- `submitOrEnqueueAgentMessage` 的即时提交路径继续携带冻结的 `linguistContext`；普通 Agent 与 Linguist rail/full 仍共用原生 `AgentView`、队列和工具生命周期。
- 上游已删除的 `AgentPlaceholder` 与旧 Provider/AppShell 包装路径保持删除；相关 touchpoint 与静态测试清单同步清理。
- Linguist Session 继续由 `workspaceId + linguistProjectId` 绑定项目；Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration 与 CAT Tools 在同一 runtime 组合。
- General 仍可选择性委派 Translator、Reviewer 或 Proofreader；子会话冻结 Segment 范围并共享 CAT Store，`linguistOutcome` 与子会话运行状态分开记录。
- CAT 写入继续经过 Session authority、revision CAS、locked 与结构规则；读取、QA 与 consistency repair 不获得直接提交权。
- CLI 构建脚本使用当前 Bun 的 `process.execPath` 启动 `bun build --compile`，不再依赖调用进程的 PATH 查找 Bun。
- v0.17.59 精确 Proma Core ledger 为 `263` 个触点：Permanent Product Fork `41`、Local Host Seam `221`、Temporary Deviation `1`。

## 本轮验证事实

- 全仓 typecheck 通过。
- upstream boundary `4/4`、fusion architecture `10/10`、Agent Full 合同 `17/17`、no-raw-palette `44/44` 通过。
- Electron Linguist `214/214` 通过。
- 全量 `bun test` 为 `1537 pass / 7 fail`；7 项均在既有 Pi MCP Streamable HTTP Session 恢复测试中，本轮没有新增失败。
- Electron main、CAT workers、Agent runtime、preload、renderer、CLI、Agent Island native、EventKit native 与 resources 构建均通过。根包装脚本在沙箱内因子进程 PATH 无 Bun 而未派发，验证改用其 package scripts 中列出的同等底层命令。
- `git diff --check`、baseline/deviations/touchpoints JSON 解析通过；公开身份与镜像清洁测试通过。

## 仍未取得的证据

- `smoke:pack`、packaged startup、packaged vertical，以及 Chat / Agent / Linguist 各一次真实运行。
- packaged app 中使用真实 Provider 完成 3–5 个匿名 Segment 的 General → Translator → Reviewer → Proofreader 全链。
- 同模型、同 reasoning 的真实语言任务对照。
- 真实 Phrase / memoQ 平台互操作、Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

这些项目保持 pending，不得由单元测试、Fake Model、未打包的 build 或旧安装版本冒充完成。
