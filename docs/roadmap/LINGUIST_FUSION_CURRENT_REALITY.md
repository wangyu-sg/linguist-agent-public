# Linguist Fusion 当前事实

更新日期：2026-08-12

## 基线

| 项目 | 当前事实 |
|---|---|
| Proma Base / formal merge | `v0.17.15@73e9d014` / `2ade7e7e` |
| App / Electron | `0.17.24` / `43.2.0` |
| Bun / Pi | `1.3.14` / `0.82.1` |
| Shared | `0.1.97` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.38 / 0.0.34` |
| CAT schema / Tool count | `15` / `31` |

产品结构是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Runtime 为 Pi-only；Claude 模型可经 Provider 使用。

## 当前实现

- 一个 CAT Project 对应一个正常可见的 Proma Workspace。Linguist Session 使用原生 workbench cwd，并同时持有 `workspaceId + linguistProjectId`。
- 旧 session workspace 只作一次历史文件迁移来源；它不再参与 cwd、垃圾回收、诊断或 integrity scope。
- 原生 Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration 与 CAT Tools 在同一 Orchestrator 组合；普通 Agent 仍无 CAT 写权限。
- General 选择性委派三岗位。子会话冻结 Segment 范围、共享 CAT Store，返回 CAT Store 计算的 `linguistOutcome`，不引入强制流水线或第二套协作框架。
- Reviewer / Proofreader 的 `unchanged / corrected / blocked` 仍由 `cat_confirm_segments` 逐段记录；覆盖不足时 delegation 可结束，但 `linguistOutcome.status` 保持 `in_progress`。
- Agent 侧栏和项目设置复用原生 Workspace、Skills、MCP、AGENTS.md、Memory 与 Files；Workbench 只投影 Store 阶段覆盖、typed format error 和两层格式资格。
- XLIFF registry 对厂商扩展名错配和最高分并列 fail closed；通用 XLIFF 与 SDLXLIFF 只通过内部 span 替换允许的 direct target / `mrk` 内容，未知骨架原样保留。
- Proma v0.17.15 的浏览器、Skill usage、MCP HTTP 恢复、worktree、Preview 和 Session 修复直接继承，没有 Linguist 复制品。
- About / Linguist Diagnostics 的 Proma Base 由 `linguist-build-metadata.ts` 展示，并与 `proma-baseline.json` 对账；当前登记 `v0.17.15@73e9d014` / formal merge `2ade7e7e`。

## 已验证与未验证

- typecheck、格式包、boundary、fusion、Renderer build、Electron Linguist `213/213` 和 Workspace / Collaboration 专项自动回归已通过；全量为 `1539 pass / 11` 个既有失败。
- 当前分支 Electron build 停在 EventKit headers 准备权限；尚无 packaged startup、vertical 或真实 Provider 四岗位证据。
- 本机 `0.17.3` 是上一轮安装版本，不代表当前 `0.17.24`。
- 真实 Phrase / memoQ、Native Open/Save、IME、VoiceOver 与 14 天日用仍待真实证据。

历史 v0.17.1 / v0.16.x 报告与旧 queue 只代表当时状态，不覆盖本页。
