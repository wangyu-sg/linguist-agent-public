# Linguist Agent 当前交接

更新时间：2026-09-03

## 当前状态

- 分支：`main`。
- 基线：Proma `v0.19.23@1ab22a17`；正式 merge `8ff00976`；本地起点 `f95e1880`。
- 当前版本：Electron `0.17.68`、Shared `0.1.68`、CAT Core / Formats / Store / Tools `0.0.23 / 0.0.13 / 0.0.42 / 0.0.37`、schema `19`。
- Runtime：Pi `0.84.4` only；完整 Proma Agent + Chat + Linguist Vertical Agent Profile，无第二套 Host 能力。

## 本轮已完成

- 一次 merge Proma v0.19.23；会话拖入输入框引用、单一委派观察 Tab、Vault 折叠侧栏及 Markdown / Preview / Changes 修复直接采用上游实现。
- 保留三模式、独立数据根、CAT authority、Linguist rail/full presentation 与 Collaboration 冻结范围。
- 修复 atomic submit 的即时路径遗漏 `linguistContext`；Renderer、Shared IPC 与主进程继续传递同一冻结快照。
- 接受上游删除的 `AgentPlaceholder`、旧 Agent Provider/AppShell Context，并清理对应 touchpoint 与过期测试条目。
- App 发布版本为 `0.17.68`，Shared 为 `0.1.68`；baseline、touchpoints 与当前事实文档已对齐。
- CLI 编译改用当前 Bun 可执行文件，避免子进程依赖 PATH。
- Renderer Host Seam 已收敛到 Agent extension 与 app mode registry；Composer context 构建移入无环依赖的纯模块，极窄视口强制折叠不再留下无效展开动作。
- 同步验证器现覆盖 `9` 个 Host 锚点；固定历史冲突 `9/9` 均能分类，并有一条 merge → resolver → overlay → verifier 集成回归；touchpoint ledger 为 `229` 个生产触点。
- Proma 自动同步保留策略解析、manifest overlay 与历史回放；CI 使用完整 Git 历史，并移除未被消费的 drift 报告和重复静态 seam 测试。
- 内部启动初始化改为 fail fast；Linguist 会话绑定解析失败显式进入 unavailable 状态。
- Store、Tools 与根测试入口继续使用显式关键回归列表。

## 验证

- 全仓 typecheck 通过；默认 CI 关键回归 `355/355`、boundary `4/4`、fusion `14/14`、Host Seam `9/9`、历史冲突分类 `9/9` 通过。
- 许可门禁通过；darwin-arm64 SBOM 已与当前 `489` 个第三方生产依赖同步。
- Electron main / workers / Agent runtime / preload / renderer / CLI / Agent Island / EventKit / resources 的底层构建阶段全部通过。
- 上一轮 `smoke:pack` 与产物完整性通过；完整 vertical 为 Agent `15/15`、Chat `19/19`、Linguist `21/21`，执行状态 passed。Native Open/Save 仍保留人工门禁；真实 Provider 四岗位全链仍无证据。

## 下一步

1. 在 packaged app 中完成真实 Provider 四岗位全链。
2. 再做 Phrase / memoQ、Native Open/Save、IME、VoiceOver、键盘和 14 天日用。

当前事实见 [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md)，未完成项只列在 [TODO.md](../TODO.md)。
