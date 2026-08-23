# Linguist Agent 当前交接

更新时间：2026-08-23

## 当前状态

- 分支：`codex/sync-proma-v0.17.59`。
- 基线：Proma `v0.17.59@4546c5f7`；正式 merge `f53612ca`；本地起点 `3cfb14ff`。
- 当前版本：Electron `0.17.60`、Shared `0.1.101`、CAT Core / Formats / Store / Tools `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35`、schema `16`。
- Runtime：Pi `0.84.2` only；完整 Proma Agent + Chat + Linguist Vertical Agent Profile，无第二套 Host 能力。

## 本轮已完成

- 一次 merge Proma v0.17.59，解决 README、manifest、Agent Orchestrator、AgentView/AppShell、Shared 与 Feishu 合同冲突。
- 保留三模式、独立数据根、CAT authority、Linguist rail/full presentation 与 Collaboration 冻结范围。
- 修复 atomic submit 的即时路径遗漏 `linguistContext`；Renderer、Shared IPC 与主进程继续传递同一冻结快照。
- 接受上游删除的 `AgentPlaceholder`、旧 Agent Provider/AppShell Context，并清理对应 touchpoint 与过期测试条目。
- App 升至 `0.17.60`、Shared 升至 `0.1.101`；About/Diagnostics、baseline、touchpoints、deviations、README 与工程指南已对齐。
- CLI 编译改用当前 Bun 可执行文件，避免子进程依赖 PATH。

## 验证

- 全仓 typecheck 通过；boundary `4/4`、fusion `10/10`、Agent Full `17/17`、no-raw-palette `44/44`、Electron Linguist `214/214` 通过。
- 全量为 `1537 pass / 7 fail`；7 项均为既有 Pi MCP Streamable HTTP Session 恢复失败，本轮无新增失败。
- Electron main / workers / Agent runtime / preload / renderer / CLI / Agent Island / EventKit / resources 的底层构建阶段全部通过。
- 当前没有 `smoke:pack`、packaged startup、vertical smoke 或真实 Provider 四岗位全链证据；分支尚未推送或合入 `main`。

## 下一步

1. 运行 `smoke:pack`、packaged startup 与 vertical smoke，分别验证 Agent / Chat / Linguist。
2. 在 packaged app 中完成真实 Provider 四岗位全链。
3. 再做 Phrase / memoQ、Native Open/Save、IME、VoiceOver、键盘和 14 天日用。

当前事实见 [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md)，未完成项只列在 [TODO.md](../TODO.md)。
