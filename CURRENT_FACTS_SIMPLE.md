# Linguist Agent 当前事实

核验日期：2026-08-12（Asia/Shanghai）

本文只记录可由代码、manifest、测试或真实运行输出确认的事实。历史报告不得覆盖本文。

## Git 与基线

- 当前施工分支：`codex/proma-v0.17.15-workspace-unification`。
- Proma 基线：`v0.17.15@73e9d014b56dfda7554011bc02cf8ee5af2c5493`。
- LA 起点：`4471505e3217cd2a286a2f03531b18512274ccc5`。
- 正式 merge：`2ade7e7e045ce6beab817778b1b39f897045fdf3`。
- C0–C3 checkpoint：`la-proma-v0.17.15-agent-core`，指向 `0516dfc302bd0df2c5c34ea52df37a9294130118`。
- K4/K5 合同 checkpoint：`la-proma-v0.17.15-k5-contracts`，指向 `dea669b4f9260bbf863537e59da79fb439a643dd`；Kimi UI 经审查后由 `7779ac4c` 合入主线。

## 版本

| 层 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App / Electron | `0.17.24` / `43.2.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.97` |
| Agent Runtime | Pi `0.82.1`；不包含 Claude Agent SDK / Nowledge Runtime |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.38 / 0.0.34` |
| CAT schema / Tool count | `15` / `31` |

## 当前实现事实

- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench；没有第二套 Agent、Chat、Session、权限、Planning、Preview 或 Collaboration。
- 一个 Linguist 项目对应一个正常可见的 Proma Workspace。新会话 cwd 直接使用原生 Workspace workbench，不再创建第二套 LA session workspace。
- 历史 session workspace 只在原生 workbench 为空时做一次不覆盖复制；旧目录不删除，`.claude`、Memory 和旧 manifest 不迁入。
- Linguist Runtime 保留 `workspaceId / workspaceSlug`，因此原生 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue、Collaboration 与 CAT Tools 可在同一 runtime 组合；同 Workspace 的普通 Agent 不获得 CAT Tools。
- General 可选择性委派 Translator、Reviewer 或 Proofreader，不强制三阶段。子会话继承同一 Workspace / CAT 项目并冻结 Segment 范围，通过共享 CAT Store 交接。
- 委派结束状态与 CAT 完成证据分离：`linguistOutcome` 返回岗位、阶段、`confirmed / unchanged / corrected / blocked / pending` 与 `status`；进程结束不再冒充 CAT 阶段完成。
- `cat_confirm_segments` 仍记录 Reviewer / Proofreader 的 `unchanged / corrected / blocked` 决策；Reviewer 冻结范围 100% 覆盖规则未放宽。
- Agent 侧栏仍使用原生 Workspace 行，只增加 Linguist 标记和 Workbench 入口；项目设置复用原生 Skills、MCP、AGENTS.md、Memory 和 Files。
- Workbench 直接展示 Translator / Reviewer / Proofreader 的 Store 覆盖；格式错误按五类 typed detail 给出下一步，格式资格严格分开“LA 内部验证”与“平台资格”。
- XLIFF 厂商内容优先于通用扩展名；保留的厂商扩展名错配和 Adapter 最高分并列均 fail closed。通用 XLIFF 只读写 direct-child target，SDLXLIFF 支持嵌套 `mrk`，多 `<file>` 可复用 native id，未修改导出直接返回原始 bytes。
- Store 未新增 SDL / Phrase / memoQ 路由硬编码；格式选择仍留在 format registry / adapter 层。

## 本轮验证事实

- 全仓 `bun run typecheck` 通过。
- CAT Formats `166/166` 通过；包含 direct target + alt-trans、SDL 嵌套 `mrk`、多 file 复用 id、原始 bytes、扩展名错配和同分歧义回归。
- upstream boundary `4/4` 通过；v0.17.15 当前精确 Proma Core ledger 为 `258` 个触点。
- Workspace / Session / Collaboration 相关回归已通过：agent-session `27`、binding/copy `13`、session CAT tools `11`、fusion architecture `10`，另有 migration/scope/integrity/diagnostics 和 delegation 专项测试。
- 合并后全量 `bun test` 为 `1539 pass / 11 fail`；11 项均为本轮前已存在的 palette/a11y/匿名合同与 MCP HTTP 恢复失败，本轮 K1–K5 没有新增失败。
- `bun run electron:build` 已完成 main、preload、renderer、CLI 和 Agent Island 构建；EventKit native 阶段因上游脚本调用 `npx node-gyp install 24.3.0` 且当前未获 headers 下载授权而停止。因此本分支尚未取得完整 build、packaged app 启动或 packaged vertical 证据。
- 本机已安装版本仍是上一轮 `0.17.3`；它不证明当前 `0.17.24` 分支可打包或运行。

## 仍未取得的证据

- 当前分支完整 Electron build、`smoke:pack`、packaged startup，以及 Chat / Agent / Linguist 各一次真实运行。
- packaged app 中使用真实 Provider 完成 3–5 个匿名 Segment 的 General → Translator → Reviewer → Proofreader 全链。
- 同模型、同 reasoning 的真实语言任务对照。
- 真实 Phrase / memoQ 平台互操作、Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

这些项目保持 pending，不得由单元测试、Fake Model、上一安装版本或部分 build 冒充完成。
