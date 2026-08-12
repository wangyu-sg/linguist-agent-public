# Linguist Agent 当前交接

更新时间：2026-08-12

## 当前状态

- 分支：`codex/proma-v0.17.15-workspace-unification`。
- 基线：Proma `v0.17.15@73e9d014`；正式 merge `2ade7e7e`；C0–C3 checkpoint `la-proma-v0.17.15-agent-core`。
- 当前版本：Electron `0.17.24`、Shared `0.1.97`、CAT Core / Formats / Store / Tools `0.0.21 / 0.0.11 / 0.0.38 / 0.0.34`、schema `15`。
- Runtime：Pi `0.82.1` only；完整 Proma Agent + Chat + Linguist Vertical Agent Profile，无第二套 Host 能力。

## 本轮已完成

- 一次 merge Proma v0.17.15，继承内嵌浏览器、Skill 使用记录、Workspace Memory 时间语境、MCP HTTP 恢复、worktree 持久化、预览与会话修复，同时保留三模式、独立数据根和 CAT authority。
- 删除新会话的第二套 LA workspace scope；Linguist 直接使用正常可见的 Proma Workspace workbench，旧目录只做一次不覆盖的历史文件复制。
- 修复 Orchestrator 丢弃 Linguist Workspace 的路径；同一 runtime 可同时组合原生 Workspace 能力与 CAT Tools，普通 Agent 不获得 CAT Tools。
- General 继续复用 Proma Collaboration 自主委派三岗位，并从 CAT Store 计算 `linguistOutcome`；运行结束不再冒充阶段覆盖完成。
- 合入 Kimi K1–K5 UI：原生 Workspace 行显示 Linguist 身份与入口，原生 Files 可直达，三岗位进度、五类格式错误和两层格式资格均消费共享 DTO。
- 保留 Reviewer / Proofreader 全量决策、共享 CAT Store、直接正式写回和非强制 Proposal 行为。
- 完成 XLIFF 小步加固：厂商路由、扩展名错配、同分歧义、direct-child target、SDL 嵌套 `mrk`、多 file native id 和原 bytes 返回；未向 Store 增加厂商分支。
- 上游 baseline、touchpoint ledger 和 deviations 已按 v0.17.15 重算；上游已吸收的 5 个旧触点已删除。

## 验证

- 全仓 typecheck 通过；CAT Formats `166/166`、boundary `4/4` 通过。
- Workspace / Collaboration 专项：agent-session `27`、binding/copy `13`、session CAT tools `11`、fusion architecture `10`，以及 migration/scope/integrity/diagnostics/delegation 回归通过。
- Renderer production build 与 Electron Linguist `213/213` 通过；全量为 `1539 pass / 11` 个既有失败，本轮无新增失败。
- Electron build 的 main、preload、renderer、CLI、Agent Island 已通过；EventKit native 因上游 `npx node-gyp install 24.3.0` 需要未授权的 headers 下载而停止。
- 当前分支未取得 `smoke:pack`、packaged startup、vertical smoke 或真实 Provider 四岗位全链证据。本机已安装的 `0.17.3` 属于上一轮，不能替代。

## 下一步

1. 用户明确允许 Node headers 下载后，把 EventKit 脚本收敛到 Bun 路径并完成 pack / packaged 验证。
2. 在 packaged app 中用匿名 3–5 Segment 完成真实 Provider 四岗位全链，核对 CAT Store 结构化证据与 `verified` 输出。
3. 再执行 Phrase / memoQ 实机互操作、Native Open/Save、IME、VoiceOver、键盘和 14 天日用。

当前事实见 [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md)，未完成项只列在 [TODO.md](../TODO.md)。
