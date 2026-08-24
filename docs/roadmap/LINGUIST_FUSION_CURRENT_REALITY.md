# Linguist Fusion 当前事实

更新日期：2026-08-25

## 基线

| 项目 | 当前事实 |
|---|---|
| Proma Base / formal merge | `v0.17.59@4546c5f7` / `f53612ca` |
| App / Electron | `0.17.60` / `43.2.0` |
| Bun / Pi | `1.3.14` / `0.84.2` |
| Shared | `0.1.63` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.11 / 0.0.39 / 0.0.35` |
| CAT schema / Tool count | `16` / `31` |

产品结构是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Runtime 为 Pi-only；Claude 模型可经 Provider 使用。

## 当前实现

- Linguist Session 直接使用原生 Proma Workspace，并同时持有 `workspaceId + linguistProjectId`。
- Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration 与 CAT Tools 在同一 Orchestrator 组合；普通 Agent 无 CAT 写权限。
- v0.17.59 的 Workspace metadata authority 与 atomic submit/queue 已直接继承；冻结的 `linguistContext` 在 Renderer、IPC 与主进程即时提交路径中保持一致。
- Workbench rail 与 Full 继续挂载同一个原生 `AgentView`；上游删除的 Placeholder、旧 Agent Provider 与 AppShell Context 不再保留。
- Renderer 通过 Agent extension 与 app mode registry 两个锚点组合 Linguist，AgentView / AppShell 不直接依赖 Linguist feature。
- General 可选择性委派三岗位。子会话冻结 Segment 范围、共享 CAT Store，并返回与进程状态分离的 `linguistOutcome`。
- Reviewer / Proofreader 的 `unchanged / corrected / blocked` 继续由 `cat_confirm_segments` 逐段记录；覆盖不足时不得冒充阶段完成。
- About / Linguist Diagnostics 的 Proma Base 由 `linguist-build-metadata.ts` 展示，并与 `proma-baseline.json` 对账为 `v0.17.59@4546c5f7` / `f53612ca`。

## 已验证与未验证

- typecheck、boundary、fusion、Agent Full、no-raw-palette、Renderer `641/641` 与 Electron Linguist `214/214` 通过；全量为 `1595 pass / 0 fail`。
- Electron 未打包构建的 main、workers、runtime、preload、renderer、CLI、Agent Island、EventKit 与 resources 均通过。
- 本轮 `smoke:pack`、产物完整性与完整 packaged vertical 通过：Agent `15/15`、Chat `19/19`、Linguist `21/21`；Native Open/Save 仍为人工门禁，真实 Provider 四岗位证据仍缺失。
- 真实 Phrase / memoQ、Native Open/Save、IME、VoiceOver 与 14 天日用仍待真实证据。

历史 v0.17.1 / v0.16.x 报告与旧 queue 只代表当时状态，不覆盖本页。
