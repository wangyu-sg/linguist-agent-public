# Linguist Fusion 当前事实

更新日期：2026-08-11

## 基线

| 项目 | 当前事实 |
|---|---|
| Proma Base / formal merge | `v0.17.1@6094036d` / `96155d1a` |
| App / Electron | `0.17.3` / `43.2.0` |
| Bun / Pi | `1.3.14` / `0.82.1` |
| Shared | `0.1.95` |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.10 / 0.0.37 / 0.0.34` |
| CAT schema / Tool count | `15` / `31` |

产品结构是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Runtime 为 Pi-only；Claude 模型可经 Provider 使用。

## 当前实现

- 每个 CAT Project 绑定真实 Proma Workspace；Linguist Session 同时绑定 Workspace 与 CAT Project，直接继承 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration。
- General 可选择性委派三种专业岗位。子会话冻结 Segment 范围，使用共享 CAT Store，未引入强制流水线或第二套协作框架。
- Reviewer / Proofreader 用 `cat_confirm_segments` 记录逐段决策；阶段覆盖通过四层 IPC 投影到 Workbench。
- 术语由 Store 现有 matcher 匹配，再由 Core evaluator 统一分成 blocking / advisory。QA、上下文、写回和 verified export 不再各自重写规则。
- 五个最小本地化 Skill 走现有默认 Skill seed / upgrade 链；项目 Agent 设置复用 Proma 原生 Skills / Memory 组件。
- 受管 Context 图片通过现有 `cat_read_context_doc` 返回 Pi ImageContent；无 OCR 服务或图片数据库。
- 导入、Workbook Mapping、Tag、Phrase、memoQ、Voice / Exemplar、verified / as-is 导出继续使用既有 CAT Service / Store 边界。
- packaged 主进程只异步加载 ESM-only Pi 模块，避免 CJS `require()` 启动崩溃。
- About / Linguist Diagnostics 的 Proma Base 由 `linguist-build-metadata.ts` 展示，并由测试与 `proma-baseline.json` 对账；当前为 `v0.17.1@6094036d` / formal merge `96155d1a`。

## 已验证与未验证

- 自动与 packaged 证据见 [实施报告](../implementation/LA_PROMA_V0_17_1_IMPLEMENTATION_REPORT_2026-08-11.md)。
- 本机已安装并启动 `0.17.3`；上一 `0.17.2` 构建曾用真实 Provider 完成一次请求。
- 真实 Provider 四岗位代表性格式全链、真实 Phrase / memoQ、Native Open/Save、IME、VoiceOver 与 14 天日用仍待真实证据。

历史 v0.16.x 报告与旧 queue 只代表当时状态，不覆盖本页。
