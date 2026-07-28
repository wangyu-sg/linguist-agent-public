# Linguist Agent 当前交接

更新时间：2026-07-29

## 交付结论

当前主线是完整 Proma Agent + Chat 与 Linguist CAT Workbench 的个人 Alpha。功能路线已稳定，不需要换底座或重写前端。

本轮收口已完成：

- 合入另一任务的 Context DOCX 修复；
- `LinguistProjectService` 2,063 → 986 行，内部拆为 resources / quality / delivery / contracts；
- CAT Tool Factory 1,045 → 60 行，12 个工具按领域拆分；
- 清理 Context DOCX、UX handoff 与 calibration 的 worktree/分支；
- 同步 README、AGENTS、队列、Current Reality、G10、Known Limitations；
- 更新本地 `linguist-agent-doc-sync` Skill。

## 当前代码基线

- 分支：`main`
- 最近生产/验证提交：`5ac2b60d fix(smoke): follow scoped QA waiver action`
- Electron 版本：`0.15.133`
- CAT Tools 版本：`0.0.13`
- worktree：仅 `/Users/<local>/Desktop/linguist-agent-next`

最终文档提交位于上述生产/验证提交之后；以 `git log -1` 为准。

## 已验证

| 检查 | 结果 |
|---|---|
| 全 workspace typecheck | 11 / 11 workspace，exit 0 |
| 根 Bun 测试 | 1,267 pass / 0 fail |
| Architecture boundaries | 3 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist nodetest | 143 / 143 |
| CAT Core + Formats | 246 pass / 0 fail |
| CAT Store nodetest | 139 pass / 0 fail |
| CAT Tools nodetest | 31 / 31 |
| Legacy Migration nodetest | 84 pass / 0 fail |
| Packaged Agent | 12 pass / 0 fail |
| Packaged Chat | 18 pass / 0 fail |
| Packaged Linguist | 17 pass / 0 fail / 2 manual |

完整 packaged vertical 在干净提交 `5ac2b60d` 上通过；自动覆盖状态是
`passed`，合同覆盖仍是 `partial`，因为 Agent Stop/Retry UI、Chat→Agent
roundtrip 和 Native Open/Save 仍是明确记录的人工/后续证据，不折算成自动通过。

## 本机安装

- 安装位置：`/Applications/Linguist Agent.app`
- 版本 / build：`0.15.133`
- `app.asar` SHA-256：`d85e40e82a5df1a9250858cf5d8bf5277a158aea24497a37fbfdb178d39312a2`
- 从安装位置使用临时 HOME 启动通过；窗口标题为 `Linguist Agent`，Chat / Agent / Linguist 三模式均可见。
- `/Applications/LinguistAgent.app`（无空格，版本 `2.32.7`）未被修改。

用户确认后，既有 `apps/electron/out/mac-arm64/Linguist Agent.app` 窗口已正常
退出；退出前确认无流式任务和未发送输入。对应的可再生打包副本已删除，回收约
816 MB；已安装 App 和 `out/smoke` 验证报告均保留。

## 用户数据边界

- 不触碰真实项目 `<real-project>`。
- 正式数据根是 `~/.linguist-agent/`；开发根是 `~/.linguist-agent-dev/`。
- Provider 只在「设置 → 模型配置」由用户显式从旧 Proma 导入。
- 测试与 smoke 必须使用临时 userData。

## 下一步

从 `/Applications/Linguist Agent.app` 启动已安装的 `0.15.133`，开始 14 天真实项目使用。只优先处理：

1. 崩溃、数据损坏、错绑、导出、恢复等 P0；
2. 频繁阻断翻译/审校的 P1 UX；
3. IME、Native Save、VoiceOver、键盘与拖拽的人工证据；
4. 真实游戏文本 Fast / Balanced / Best 盲评。

不新增格式、OCR、多 Agent Team、自动模型路由、扩展市场或公众发行工作。

## 仍阻断的 Gate

- LF-048：IME composition + Native Save 手工验证；
- AC-009：G10 人工产品资格；
- AC-010：真实文本盲评；
- AC-011：14 天连续个人日用。

这些是人工/使用证据缺口，不是继续推倒架构的理由。
