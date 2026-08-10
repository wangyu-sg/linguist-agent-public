# Linguist Agent 简化重构事实基线

核验日期：2026-08-10（Asia/Shanghai）

本文件只记录代码、清单、测试和本机只读检查能够确认的事实。客户名称、正文和本机绝对路径不进入仓库。

## Git

- 核验起点 HEAD：`b5a65ef377c9816a24c756f06a8cf76bc4f1b947`（`main`，与 `origin/main` 一致）。
- 核验起点工作树：clean；SIMPLE-001 修复后改动见当前 `git status --short`。
- remotes：`origin` 为公开 Linguist Agent 仓库，`upstream` 为 Proma 仓库。
- 当前 Proma tag：`v0.16.10`；commit：`72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a`。
- 正式 merge commit：`ea26177f36d59bd2781d7ff9264451a8430e2249`；承载分支：`integration/la-proma-0.16.10`。
- Kimi K3 Linguist UX 合并 commit：`0136a1d25e6e2c3c4c43cee6c90d24e0990aacf4`。

## 固定版本

| 项目 | 核验值 |
|---|---|
| Bun | `1.3.14` |
| Electron App | `0.16.34` |
| Electron | `43.2.0` |
| React | `18.3.1` |
| Jotai | `2.17.1` |
| Vite | `6.4.1`（manifest range `^6.0.3`） |
| Shared | `0.1.92` |
| Claude Agent SDK | `0.3.201` |
| Pi Runtime | `0.82.1` |
| CAT Core | `0.0.19` |
| CAT Formats | `0.0.10` |
| CAT Store | `0.0.34` |
| CAT Tools | `0.0.32` |
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

- `AgentSessionMeta` 当前角色字段为 `linguistRole?: 'general' | 'translator' | 'reviewer' | 'proofreader'`；旧字段只在读取时转换并删除。
- Session 创建、更新 IPC 与 Header/侧栏菜单支持四岗位；岗位可切换。
- `composeAgentTools()` 已保持 Proma Base/MCP 在前、Linguist CAT overlay 在后的组合方向。
- 四岗位获得同一套 30 个 CAT 工具；差异只由岗位提示词表达，不再有岗位工具白名单。
- 当前工具包含直接写入、术语闭环、Workbook Mapping、Voice Context、统一资源导入、`verified/as-is` 导出、未知 Tag 扫描与 Tag Profile 保存；不再公开 Critic 或 Translation Scope 工具。

## 当前权限与异常语义

- Proma Session 的 `permissionMode` 已是基础工具和 MCP 的权限来源。
- 资源导入接受绝对路径或相对 Session workspace 路径；目录递归有 500 条目上限且不跟随符号链接目录。项目 missing/unavailable/archived 不再阻断整个 Agent send，CAT 操作按项目状态 fail closed。
- CAT 写入已有 Store 级 revision CAS、locked、Tag/Placeholder/ICU、事务和只读项目保护；这些属于数据正确性，必须保留。

## 用户数据与备份/恢复

- 生产数据根由代码固定为 `~/.linguist-agent/`，开发根为 `~/.linguist-agent-dev/`。
- 本机只读检查确认生产 Session Index 存在，生产 Linguist root 下有 5 个项目目录；未记录名称或内容。开发 Linguist root 不存在。
- 测试与构建均使用临时根，没有读写真实项目。
- CAT Store 备份/恢复与 Electron 服务层备份/恢复测试通过，包括 manifest/hash、WAL、回滚、损坏拒绝、pre-restore snapshot 和 schema 15 身份校验。
- SIMPLE-002 前已对真实 `linguist/` 与 Session Index 做独立备份，并逐项验证副本一致；仓库中只记录结论，不记录本机路径或客户内容。

## 本轮最终证据与尚未确认

- 全量 typecheck 的 11 个 workspace 通过。
- 根 `1514/1514`（`6760` assertions）、Electron Linguist `185/185`、CAT Core `100/100`、CAT Formats `163/163`、CAT Store `228/228`、CAT Tools `40/40`、boundary `4/4`、fusion `9/9` 通过。
- macOS arm64 packaged artifact integrity 通过；纵向 smoke 为 Pi `15/0`、Chat `19/0`、Linguist `21/0/2 MANUAL`。
- 同一 packaged artifact 已安装为 `/Applications/Linguist Agent.app` `0.16.34`；安装后 `app.asar` SHA-256 与验证产物一致。旧 `0.16.21` 已移入废纸篓，可恢复。
- Phrase 真实私有副本验证为 82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable；客户数据未进入仓库。
- memoQ MQXLIFF 专用 Adapter 的合成 fixture、修改/导出/重导和回归已自动验证；真实 memoQ 客户样本尚未验证。
- 真实 Provider 四岗位全链、同模型对照、14 天日用和 Native Open/Save 等真机人工项尚未确认，不得标记为完成。
