# Linguist Agent 文档维护规则

更新时间：2026-08-08

## 事实优先级

文档冲突时按以下顺序裁决：

```text
代码 / package.json / 锁文件 / 测试 / 真实运行输出
> CURRENT_FACTS_SIMPLE.md / SIMPLE_IMPLEMENTATION_STATUS.md
> LINGUIST_FUSION_CURRENT_REALITY.md
> README / AGENTS / HANDOFF / TODO
> 历史 Gate、Release 与审计报告
```

历史报告保留当时的版本、命令和证据；需要更正时追加“后续更正”，不要把旧数字悄悄改成当前数字。

## 文档职责

| 文件 | 只记录什么 |
|---|---|
| `README.md` / `README.en.md` | 当前产品身份、架构、使用与开发入口 |
| `AGENTS.md` | 当前仓库执行约束、技术事实和安全边界 |
| `docs/HANDOFF.md` | 下一会话无需聊天历史即可继续的当前交接 |
| `TODO.md` | 仍未完成且可行动的事项 |
| `docs/DOCS_INDEX.md` | 文档地图与真源 |
| `CURRENT_FACTS_SIMPLE.md` | 简化重构启动时的 Git、数据、实现与验证事实 |
| `LINGUIST_FUSION_CURRENT_REALITY.md` | 可验证的当前代码/工作区事实 |
| `SIMPLE_IMPLEMENTATION_STATUS.md` | 当前简化方案 Ticket 状态；不伪造真实使用证据 |
| `docs/roadmap/*_REPORT.md` | 历史或专项证据 |

不要在 README、AGENTS 或 HANDOFF 中复制整份执行账本；应链接真源。

## 何时同步

出现以下任一变化时执行同步：

- 产品模式、用户流程、数据根或安全边界变化；
- 包版本、Runtime、构建/打包策略变化；
- Gate 状态或验证数字变化；
- worktree/分支、当前 HEAD 或下一步变化；
- 新增/删除 canonical 文档；
- 用户要求 deep doc sync、handoff 或 clean workspace。

README 与 AGENTS 的修改仍需用户允许；一次明确的“同步全部文档”授权可覆盖同一收口任务。

## 同步步骤

1. 先读代码、manifest、简化状态表和最新真实命令输出。
2. 搜索旧版本、旧数据根、旧 SDK、过期 Gate 结论、废弃 worktree 和“已完成/待完成”冲突。
3. 更新最小 canonical 集合。
4. 区分自动证据与人工证据。
5. 验证 JSON、链接和 Markdown 基础格式。
6. 公开同步前扫描当前公开树和将变为可达的提交历史；个人署名只允许 `Henry Wang` 或 `Wang Yu`。
7. 运行：

```bash
git diff --check
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
```

代码事实同时变化时还要运行相应 typecheck/test；最终交付按 `docs/HANDOFF.md` 记录完整命令。

## 禁止事项

- 不把已删除的统一蓝图、旧 queue、Proposal Critic、Auditor 或 Execution Policy 写回 active 产品；Git 历史只作历史证据。
- 不把 Fake Model 写成翻译质量证据。
- 不把 packaged smoke 写成 VoiceOver/IME/键盘人工验证。
- 不把个人 Alpha 写成公开 Release Candidate。
- 不从旧 `/Users/<local>/Desktop/linguist-agent` 复制状态覆盖当前仓库；旧仓只作历史/迁移证据。
- 不把未跟踪或临时目录中的唯一结论留给下一会话。
- 不写无法由仓库或真实输出验证的数字、commit 或版本。
- 不在公开文档、许可署名、提交说明或 Release metadata 中写作者的中文姓名；只使用 `Henry Wang` 或 `Wang Yu`。
