# Linguist Agent

Linguist Agent 是一个面向个人日常本地化工作的桌面 Agent：

> Proma 的完整通用 Agent / Chat 产品能力 + Linguist Agent 的专业 CAT 内核与工作台。

本项目是 [Proma](https://github.com/proma-ai/Proma) 的 AGPL-3.0 衍生作品。Proma 的版权归原作者所有；来源与固定基线见 [NOTICE.md](./NOTICE.md)、[ATTRIBUTION.md](./ATTRIBUTION.md) 和 [UPSTREAM_BASELINE.md](./docs/architecture/UPSTREAM_BASELINE.md)。

[English README](./README.en.md)

## 当前状态

当前定位是供作者本人连续使用和改良的 **个人 Alpha**，没有面向公众发布计划。主体路线已经稳定，不再更换 Proma 底座，也不把 Proma 的 Agent、Chat、Skills、MCP、Automations 或远程集成删掉。

当前自动验证基线为 Electron `0.15.139`、shared `0.1.79`、CAT Store `0.0.25`；干净源码构建出的打包应用与本机安装应用的 `app.asar` 已核对一致。自动化通过不代表下文人工 Gate 已完成。

应用提供三个并列主模式：

- **Agent**：Proma 原生完整 Agent 工作区，支持 Claude / Pi Runtime、工具、Thinking、权限、Queue / Steer、Skills、MCP 和工作区文件。
- **Chat**：Proma 原生多 Provider 对话、附件、工具、上下文控制与并排比较。
- **Linguist**：项目、资产、虚拟化 Segment Grid、人工编辑、Proposal 审核、TM / TB、Context、确定性 QA、阶段确认、运行摘要/安全撤销、交付预检、导出、完整性扫描、备份与恢复。

Linguist 左侧栏固定为“项目 → 绑定会话”：会话行与 Agent 侧栏复用同一组件和树行为（状态、MiniMap、委派、置顶、最近会话与归档），Agent 模式则排除所有项目绑定会话。点击项目进入 Workbench，点击会话进入同一个 Full `AgentView`；跨项目操作是创建独立副本，成功后仍停留在源项目，并可从提示打开副本。

Linguist 是一等 Agent Profile：在 Proma Base 上叠加版本化的 Profile、Role、Fast / Balanced / Best Strategy、Project Digest 与每轮 Context。它嵌入同一个 Proma `AgentView`，不会复制第二套 Composer、消息流、Thinking、Tool Card、权限或 Session Store。Agent 只能创建待人工审核的 Proposal，不能绕过 CAS、锁定项、Tag/QA/Required/Forbidden 规则直接提交 Segment。

## 架构

```text
Proma Desktop App
├── Agent / Chat / Skills / MCP / Automations / Providers
└── Linguist Mode
    ├── Workbench + 原生 Agent Rail
    ├── Session-bound CAT Tools
    ├── Electron Linguist Services / IPC
    └── @linguist/cat-core
        └── 纯领域模型、Proposal、Evidence、QA、Critic、Consistency
```

关键边界：

- `packages/linguist-cat-core` 不依赖 React、Electron、Proma UI 或 SQLite。
- `packages/linguist-cat-store` 负责每项目 `cat.db`、原始资产、备份与导出记录。
- `packages/linguist-cat-tools` 的项目身份只来自 Session binding，15 个工具按项目、参考资料、QA、Proposal/Critic 分模块。
- `LinguistProjectService` 保持单一对外接口，内部按生命周期、资源、质量与交付拆分。
- Proposal 内容与每次 Issuance/Provenance 分离持久化；长任务使用 Job/Checkpoint、幂等 mutation、durable outbox 和按运行撤销。
- 项目打开只做有界 Quick Health；Full Integrity Scrub 在独立 worker thread 中检查全量摘要、SQLite/引用链、导出与 Session workspace。
- 会话复制由主进程重新验证源 Session binding、目标项目活跃/健康状态与 Claude/Pi 原生分叉条件；Renderer 不能提交 binding、原生 ID 或路径。副本不携带工作区文件、`.context`、附件、委派、自动化或运行状态，失败时回滚半成品。
- Proma 核心触点受 [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md) 和架构测试约束。

## 数据目录

正式版使用 `~/.linguist-agent/`，开发版使用 `~/.linguist-agent-dev/`；CAT 数据位于其 `linguist/` 子目录。通用会话和设置继续使用 JSON / JSONL，CAT 项目使用独立 SQLite 数据库与受管 source/blobs/exports 目录。

旧 `~/.proma(-dev)/channels.json` 只会在用户从「设置 → 模型配置」显式执行 Provider 导入时读取；不会迁移 Proma 会话、设置、工作区或 CAT 数据。旧 Linguist 项目与会话的数据迁移入口位于「设置 → 数据迁移」。详见 [USERDATA_LAYOUT.md](./docs/architecture/USERDATA_LAYOUT.md)。

## 开发与验证

仓库固定使用 Bun 1.3.14。

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
```

开发与构建：

```bash
bun run dev
bun run electron:build

cd apps/electron
bun run smoke:pack
bun run smoke:vertical
```

CI 覆盖 frozen install、类型检查、根测试、CAT 分层测试、Linguist 主进程测试、架构边界、许可扫描和 Electron build。

## 尚未完成的人工 Gate

代码实现和自动化验证不等于产品资格。当前仍需在真实使用中完成：

- 原生 IME composition 与 Native Save 防覆盖手工验证；
- VoiceOver、完整键盘路径和拖拽手感；
- Fast / Balanced / Best 的真实游戏文本盲评；
- 真实 Provider/模型链路与真实客户格式样本回归；
- 14 天连续个人日用与问题回收。

签名、公证、公开更新渠道和跨平台发布不属于当前个人 Alpha 目标。完整状态见 [HANDOFF.md](./docs/HANDOFF.md)、[TODO.md](./TODO.md) 和 [LINGUIST_FUSION_QUEUE.md](./docs/roadmap/LINGUIST_FUSION_QUEUE.md)。

## 文档

文档入口与事实优先级见 [DOCS_INDEX.md](./docs/DOCS_INDEX.md)；维护规则见 [DOCUMENTATION_MAINTENANCE.md](./docs/DOCUMENTATION_MAINTENANCE.md)。

## 许可

[AGPL-3.0](./LICENSE)。保留 Proma 及其他上游组件要求的版权、NOTICE 和第三方归属。
