# Linguist Agent

Linguist Agent 是面向个人日常本地化工作的桌面 Agent：

> 完整 Proma Agent / Chat + Linguist 项目上下文、CAT 工具与工作台。

本项目是 [Proma](https://github.com/proma-ai/Proma) 的 AGPL-3.0 衍生作品。来源与固定基线见 [NOTICE.md](./NOTICE.md)、[ATTRIBUTION.md](./ATTRIBUTION.md) 和 [UPSTREAM_BASELINE.md](./docs/architecture/UPSTREAM_BASELINE.md)。

[English README](./README.en.md)

## 当前状态

当前是作者本人使用的 **个人 Alpha**，没有公众发布计划。基线固定为 Proma v0.16.10；Electron App `0.16.33`、Electron `43.2.0`、`@proma/shared 0.1.91`、Pi `0.82.1`、Claude Agent SDK `0.3.201`、CAT Core / Formats / Store / Tools `0.0.19 / 0.0.10 / 0.0.34 / 0.0.31`、CAT schema `15`，仓库使用 Bun `1.3.14`。

应用有三个并列模式：

- **Agent**：Proma 的完整通用 Agent，包括工具、文件、MCP、Skills、权限、Thinking、Queue / Steer、Planning 和 Automations。
- **Chat**：多 Provider 对话、附件、工具、上下文控制与并排比较。
- **Linguist**：项目、批次、TM/TB/Context、Segment 编辑、Proposal、QA、导入导出、Tag Profile、备份与恢复。

Linguist 复用同一个 `AgentView`、Session Store、Provider、模型、权限和 Proma Toolset，不另建受限 Agent 或第二套 Composer。

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
Proma Agent Runtime
├── Base Tools / MCP / Files / Permission / Model
└── Linguist Project Binding
    ├── 四岗位共享的 30 个 CAT Tools
    ├── Common Quality Contract + 当前岗位 Prompt
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
- `cat_import_resources` 可处理文件或小批目录，绝对路径直接使用，相对路径按 Session cwd 解析；权限体验只服从 Proma Session。
- `cat_export_asset` 支持 `verified` / `as-is`。`verified` 检查结构、格式与重新导入；默认不覆盖，用户明确要求时才原子覆盖普通文件。
- Tag Profile 的扫描、Candidate、编辑器提示、Proposal、QA 与 `verified` export 使用同一 Scanner；普通可翻译 `[Damage]` 不会被内置规则硬锁。
- Phrase split/master MXLIFF 按内容身份、Source hash、unit/context 与 placeholder 证据配对；`verified` 导出在 mapping 不完整或 stale 时阻断。
- memoQ MQXLIFF 使用专用 Adapter，保留 inline code、确认状态与审校批注；实机客户样本仍需逐样本验证。

项目缺失、归档或暂不可用时，Agent 对话仍可继续；CAT 工具如实返回项目状态，写入由 Store fail closed。用户仍可用 Proma 文件、Shell、OCR、Excel、MCP 等能力诊断或恢复项目。

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
├── sdk-config/
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

实现和自动回归不等于真实语言质量或产品资格。仍需完成同模型 Proma/Codex 对照、真实 Provider 四岗位全链、Native Open/IME/VoiceOver/键盘人工检查和从可用构建开始累计的 14 天日用。当前准确状态见 [SIMPLE_IMPLEMENTATION_STATUS.md](./docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)、[HANDOFF.md](./docs/HANDOFF.md) 和 [TODO.md](./TODO.md)。

## 许可

[AGPL-3.0](./LICENSE)。保留 Proma 与其他上游组件要求的版权、NOTICE 和第三方归属。
