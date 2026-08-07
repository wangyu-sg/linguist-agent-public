# Linguist Agent 简化重构事实基线

核验日期：2026-08-08（Asia/Shanghai）

本文件只记录代码、清单、测试和本机只读检查能够确认的事实。客户名称、正文和本机绝对路径不进入仓库。

## Git

- 核验起点 HEAD：`b5a65ef377c9816a24c756f06a8cf76bc4f1b947`（`main`，与 `origin/main` 一致）。
- 核验起点工作树：clean；SIMPLE-001 修复后改动见当前 `git status --short`。
- remotes：`origin` 为公开 Linguist Agent 仓库，`upstream` 为 Proma 仓库。
- 当前 Proma tag：`v0.16.8`；merge-base：`bde00f00323d6735a939d14dbce3b2f1a5b672bc`。
- 本地尚无 `v0.16.9` tag；SIMPLE-002 需要 fetch 后正式 merge。

## 固定版本

| 项目 | 核验值 |
|---|---|
| Bun | `1.3.14` |
| Electron App | `0.16.20`（SIMPLE-001 patch；核验起点 `0.16.19`） |
| Electron | `43.2.0` |
| React | `18.3.1` |
| Jotai | `2.17.1` |
| Vite | `6.0.3` |
| Shared | `0.1.85` |
| Claude Agent SDK | `0.3.201` |
| Pi Runtime | `0.82.1` |
| CAT Core | `0.0.14` |
| CAT Formats | `0.0.8` |
| CAT Store | `0.0.28`（SIMPLE-001 patch；核验起点 `0.0.27`） |
| CAT Tools | `0.0.23` |
| CAT schema | `15` |

版本值来自当前 `package.json`、`bun.lock` 与 `packages/linguist-cat-store/src/schema.ts`，不是旧报告。

## SIMPLE-001：初始失败与修复结果

- `bun install --frozen-lockfile`：通过。
- `bun run typecheck`：通过。
- 初始根 `bun test`：`1484 pass / 1 fail / 1 error`；原因是 `trados-reference-parsers.ts` 静态导入 `node:sqlite`，破坏了 CAT Store 已有的惰性运行时探测。改为复用 `loadDatabaseSync()` 后：`1485 pass / 0 fail`。
- 初始 CAT Store Node 测试：`228 pass / 1 fail`；原因是测试按 Node 版本猜测 `DatabaseSync#backup`，而实际运行时表面不同。改为核对探测结果与 fallback 说明一致后通过。
- 初始 Electron Linguist Node 测试：`209 pass / 2 fail`；原因是 Integrity Scrub 测试 Worker 继承了宿主无关且不允许的 `execArgv`。改为仅传测试 Worker 必需的 TypeScript loader 参数后：`211 pass / 0 fail`。
- `bun test packages/linguist-cat-core`：`123 pass / 0 fail`。
- CAT Tools Node 测试：`54 pass / 0 fail`。
- `bun run check:boundaries`：`4 pass / 0 fail`。
- `node --test tests/linguist-fusion-architecture.test.mjs`：`9 pass / 0 fail`。
- `bun run license:check`：通过，SBOM 与 432 个第三方生产依赖一致。
- `bun run electron:build`：通过；本机使用固定 Bun 执行脚本，Swift 模块缓存写入需要沙箱外构建权限。

## 当前角色与工具装配

- `AgentSessionMeta` 当前角色字段仍是 `linguistSessionRole?: 'reviewer' | 'auditor'`；缺省会话等价于旧 Assistant。
- Session 创建 IPC 当前只接受 `reviewer | auditor`；角色在通用元数据更新中被冻结。
- `composeAgentTools()` 已保持 Proma Base/MCP 在前、Linguist CAT overlay 在后的组合方向。
- 绑定项目的 Auditor 仍向 CAT 工厂传 `sessionMode: 'independent-audit'`，导致只暴露证据读取白名单。
- 当前公开 CAT 工具共 20 个：项目摘要、资产/片段读取、单资产导入/导出、上下文、Proposal snapshot/TM/TB、Proposal 创建/接受、QA、Critic、Consistency、句式/Context，以及 Translation Scope begin/finalize。
- `cat_submit_critic_review`、`cat_begin_translation_scope`、`cat_finalize_translation_scope` 仍默认公开；新简化方案尚未实施。

## 当前权限与异常语义

- Proma Session 的 `permissionMode` 已是基础工具和 MCP 的权限来源。
- Linguist 仍叠加两类额外限制：Intake 路径必须位于 Session workspace/附件授权范围；项目 missing/unavailable/archived 时 `checkLinguistSessionSendBlock()` 阻断整个 Agent send。
- CAT 写入已有 Store 级 revision CAS、locked、Tag/Placeholder/ICU、事务和只读项目保护；这些属于数据正确性，必须保留。

## 用户数据与备份/恢复

- 生产数据根由代码固定为 `~/.linguist-agent/`，开发根为 `~/.linguist-agent-dev/`。
- 本机只读检查确认生产 Session Index 存在，生产 Linguist root 下有 5 个项目目录；未记录名称或内容。开发 Linguist root 不存在。
- 测试与构建均使用临时根，没有读写真实项目。
- CAT Store 备份/恢复与 Electron 服务层备份/恢复测试通过，包括 manifest/hash、WAL、回滚、损坏拒绝、pre-restore snapshot 和 schema 15 身份校验。
- SIMPLE-002 前仍需对真实 `linguist/` 与 Session Index 做一次独立只读源备份；在该备份完成前不执行上游 merge。

## 尚未确认

- 真实项目的手工打开、翻译、审校、校对与导出尚未在本轮执行。
- macOS packaged smoke、真实目录导入、Phrase split/master round-trip 和 14 天日用尚无本轮证据；不得标记为完成。
