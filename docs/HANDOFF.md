# Linguist Agent 当前交接

更新时间：2026-08-23

## 当前状态

- 分支：`codex/maintenance-convergence`。
- 基线：Proma `v0.17.59@4546c5f7`；正式 merge `f53612ca`；本地起点 `3cfb14ff`。
- 当前版本：Electron `0.17.60`、Shared `0.1.63`、CAT Core / Formats / Store / Tools `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35`、schema `16`。
- Runtime：Pi `0.84.2` only；完整 Proma Agent + Chat + Linguist Vertical Agent Profile，无第二套 Host 能力。

## 本轮已完成

- 一次 merge Proma v0.17.59，解决 README、manifest、Agent Orchestrator、AgentView/AppShell、Shared 与 Feishu 合同冲突。
- 保留三模式、独立数据根、CAT authority、Linguist rail/full presentation 与 Collaboration 冻结范围。
- 修复 atomic submit 的即时路径遗漏 `linguistContext`；Renderer、Shared IPC 与主进程继续传递同一冻结快照。
- 接受上游删除的 `AgentPlaceholder`、旧 Agent Provider/AppShell Context，并清理对应 touchpoint 与过期测试条目。
- App 保持 `0.17.60`，Shared 跟随 Proma 基线恢复为 `0.1.63`；baseline、touchpoints、README 与工程指南已对齐。
- CLI 编译改用当前 Bun 可执行文件，避免子进程依赖 PATH。

## 验证

- 全仓 typecheck 通过；boundary `4/4`、fusion `10/10`、Agent Full `17/17`、no-raw-palette `44/44`、Electron Linguist `214/214` 通过。
- 全量为 `1558 pass / 0 fail`；同步专项 `14/14` 通过。
- Electron main / workers / Agent runtime / preload / renderer / CLI / Agent Island / EventKit / resources 的底层构建阶段全部通过。
- `smoke:pack` 与产物完整性通过；临时 HOME 下 Chat `19/19`。完整 vertical 未通过：Pi `12/15`，Linguist `11 pass / 1 fail / 1 manual`；真实 Provider 四岗位全链仍无证据。分支尚未推送或合入 `main`。

## 下一步

1. Kimi Renderer Host Seam 合并后修复 rail 遮挡，并按 Pi `0.84.2` 当前事件合同复核流式探针，再重跑 vertical smoke。
2. 在 packaged app 中完成真实 Provider 四岗位全链。
3. 再做 Phrase / memoQ、Native Open/Save、IME、VoiceOver、键盘和 14 天日用。

当前事实见 [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md)，未完成项只列在 [TODO.md](../TODO.md)。
