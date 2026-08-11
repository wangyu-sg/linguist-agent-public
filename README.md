# Linguist Agent

Linguist Agent 是面向个人日常本地化工作的桌面 Agent：

> 完整 Proma Agent / Chat + Linguist 项目上下文、CAT 工具与工作台。

本项目是 [Proma](https://github.com/proma-ai/Proma) 的 AGPL-3.0 衍生作品。来源与固定基线见 [NOTICE.md](./NOTICE.md)、[ATTRIBUTION.md](./ATTRIBUTION.md) 和 [UPSTREAM_BASELINE.md](./docs/architecture/UPSTREAM_BASELINE.md)。

[English README](./README.en.md)

## 当前状态

当前是作者本人使用的 **个人 Alpha**，没有公众发布计划。稳定基线是 Proma `v0.17.1@6094036`；Electron App `0.17.2`、Electron `43.2.0`、`@proma/shared 0.1.95`、Pi `0.82.1`、CAT Core / Formats / Store / Tools `0.0.21 / 0.0.10 / 0.0.37 / 0.0.34`、CAT schema `15`，仓库使用 Bun `1.3.14`。

应用有三个并列模式：

- **Agent**：Proma 的完整通用 Agent，包括工具、文件、MCP、Skills、受信项目指令、Workspace Memory、权限、Thinking、Queue / Steer、Planning、Collaboration 和 Automations。
- **Chat**：多 Provider 对话、附件、工具、上下文控制与并排比较。
- **Linguist**：项目、批次、TM/TB/Context、Segment 编辑、Proposal、QA、导入导出、Tag Profile、备份与恢复。

Agent 统一使用 **Pi Runtime**。Claude 模型仍可通过 Anthropic 协议 Provider 使用，但产品不再包含 Claude Agent SDK 或 Nowledge Mem Runtime。Linguist 复用同一个 `AgentView`、Session Store、Workspace、Provider、模型、权限和 Proma Toolset，不另建受限 Agent 或第二套 Composer。

## 四种岗位

项目会话可在创建时选择岗位，也可在同一会话中随时切换：

| 岗位 | 默认职责 |
|---|---|
| General | 导入、分析、术语、脚本、QA、导出和开放式项目任务 |
| Translator | 对声明范围完成生产级翻译与自检 |
| Reviewer | 全量审查 Source + 当前 Target，修正实质问题并保留正确译文 |
| Proofreader | 以目标语成品为中心校对和润色，需要时回看 Source |

岗位只改变默认 Prompt，不改变工具、MCP、文件、模型、Runtime 或用户选择的 permission mode。用户明确提出其他任务时，Agent 直接完成，不以岗位不符为由拒绝。

Proposal 是可见、可接受、可撤销的修改载体，承载 Agent 当前认为最好的正式建议；它不是低质量草稿，也不是 Reviewer 的前置条件。旧 Proposal Critic、Auditor、Execution Policy 和 Translation Scope 不再是 active 产品流程。

## CAT 工作流

```text
Proma Pi Agent Runtime
├── Workspace / Skills / MCP / AGENTS.md / Memory / Files / Planning / Collaboration
└── Linguist Project Binding
    ├── 四岗位共享的 31 个 CAT Tools
    ├── 内置 Common Quality Contract + 当前岗位 Markdown
    ├── Project Digest / Turn Context
    └── Linguist Domain Services
        ├── UI / IPC
        └── Agent Tools
```

关键边界：

- `@linguist/cat-core` 是纯领域层，不依赖 React、Electron、Proma UI、SQLite 或文件系统。
- `@linguist/cat-store` 管理每项目 `cat.db`、受管 source / blobs / exports / backups。
- `@linguist/cat-tools` 的项目身份只来自 Session binding；模型不能提交 `projectId`。
- UI 与 Agent 调用同一 `LinguistProjectService`；格式解析、事务、CAS、locked Segment、Tag/Placeholder/ICU、QA 和 round-trip 规则不重复实现。
- Prompt Builder 保留单一合同；Project Digest 以 `complete / partial / skipped` 和 `truncated` 暴露降级，失败时也向模型注入可见占位。
- General 可按任务选择性委派 Translator、Reviewer 或 Proofreader；子会话继承同一 Workspace 与 CAT 项目，并在创建时冻结 Segment 范围。岗位通过共享 CAT Store 交接，不复制译文到聊天。
- `cat_confirm_segments` 记录 `unchanged / corrected / blocked` 决策；Reviewer 只有覆盖冻结范围内全部 Segment 才算完成，Proofreader 独立写入 proofreading 阶段。
- 术语匹配、上下文、QA 与写回门禁共用同一 scope-aware evaluator；只有无冲突且适用范围明确的 required / forbidden 规则硬拦，数字、换行和普通 token 差异留给 QA。
- 受管 Context 图片通过现有 `cat_read_context_doc` 作为视觉内容提供给 Pi 模型，不新增 OCR 或图片数据库。
- Agent 的 `cat_import_resources` 可处理文件或小批目录；原生 UI 的单一入口支持多文件或文件夹。Renderer 不接受任意粘贴路径，路径 authority 留在主进程。
- Agent 与原生 UI 都支持 `verified` / `as-is` 导出；`as-is` 需要明确确认。两种模式都检查格式生成与重新导入，默认不覆盖。
- Tag Profile 的扫描、Candidate、编辑器提示、Proposal、QA 与 `verified` export 使用同一 Scanner。
- Phrase split/master MXLIFF 以内容证据配对；mapping 不完整或 stale 时阻断 `verified` 导出。
- memoQ MQXLIFF 使用专用 Adapter，保留 inline code、确认状态与审校批注；实机客户样本仍需逐样本验证。

Full `AgentView` 保留 Proma 的 Files / Changes 面板；Workbench rail 只承载对话。Linguist 会话直接继承其 Proma Workspace 的 Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration；CAT 项目绑定只增加领域上下文和工具，不复制宿主能力。

批次导航只显示真实批次，支持原位刷新，并在当前选择失效时收敛到首个有效批次。底部进度、草稿数和源文/译文字符数严格属于当前批次；阶段文案由项目工作流驱动，依次为“已确认 / 已审校 / 已校对”。

项目缺失、归档或暂不可用时，Agent 对话仍可继续；CAT 工具如实返回项目状态，写入由 Store fail closed。

## 本地数据

正式版使用 `~/.linguist-agent/`，开发版使用 `~/.linguist-agent-dev/`：

```text
~/.linguist-agent/
├── channels.json
├── conversations.json / conversations/*.jsonl
├── agent-sessions.json / agent-sessions/*.jsonl
├── agent-workspaces/
├── attachments/
├── settings.json
├── planning.json
└── linguist/
    ├── projects.json
    ├── projects/<project-id>/
    │   ├── project.json
    │   ├── cat.db
    │   ├── source/
    │   ├── blobs/
    │   ├── exports/
    │   └── backups/
    └── trash/
```

通用配置与会话使用 JSON / JSONL；SQLite 只用于每项目 CAT Store。API Key 写入 `channels.json` 前使用 Electron `safeStorage` 加密。

## 开发与验证

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
bun run --filter='@linguist/cat-tools' test
```

打包验证：

```bash
cd apps/electron
bun run build
bun run sync:runtime-deps
bun run smoke:pack
bun run smoke:vertical
```

测试与 smoke 必须使用任务专用临时 user-data-dir，不得读写真实用户根。

## 尚缺的真实证据

实现和自动回归不等于真实语言质量或产品资格。仍需完成同模型 Proma/Codex 对照、真实 Provider 四岗位全链、真实 Phrase/memoQ 互操作、Native Open/Save、IME、VoiceOver、键盘人工检查和从可用构建开始累计的 14 天日用。当前准确状态见 [SIMPLE_IMPLEMENTATION_STATUS.md](./docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)、[HANDOFF.md](./docs/HANDOFF.md) 和 [TODO.md](./TODO.md)。

## 许可

[AGPL-3.0](./LICENSE)。保留 Proma 与其他上游组件要求的版权、NOTICE 和第三方归属。
