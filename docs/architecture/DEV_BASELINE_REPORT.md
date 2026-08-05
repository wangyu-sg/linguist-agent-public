# Dev Baseline Report — PB-003

> 工单：PB-003（原版 Proma 开发基线）。目标：不改产品代码，证明上游基线可安装、类型检查、测试、构建和开发启动。
> 执行时间：2026-07-25，本机 macOS（Apple Silicon，用户 M3 Mac）。

## 工具链版本（实测）

| 项 | 版本 | 来源 |
|---|---|---|
| Bun | `1.3.14` | 本票经官方脚本安装到 `~/.bun`（`curl -fsSL https://bun.sh/install`） |
| Node（系统） | `v22.22.2` | nvm |
| Node（Electron 内嵌） | `22.22.0` | `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron -e ...` 实测 |
| Electron | `39.5.1` | bun.lock 解析值 |
| Pi | `0.80.9` | overrides 锁定，含 `patches/@earendil-works%2Fpi-ai@0.80.9.patch` |

## 必跑命令实际结果

| 命令 | 结果 |
|---|---|
| `bun install --frozen-lockfile` | ✅ 1200 packages installed [144.69s] |
| `bun run typecheck` | ✅ 6/6 包 exit 0（shared、session-core、core、cli、ui、electron） |
| `bun test` | ⚠️ 480 pass / **2 fail** / 482 tests / 62 files（详见下文失败日志） |
| `bun run electron:build` | ✅ exit 0：esbuild main+preload、vite renderer（13.22s）、`build:cli` 编译 proma CLI（61MB）、resources 复制 |
| `bun run electron:dev`（实际启动） | ✅ 完整启动（详见下文），验证后手动停止 |

## `bun test` 两条失败日志（上游基线原样，未修）

```text
apps/electron/src/main/lib/agent-session-manager.test.ts:
SyntaxError: Export named 'BrowserWindow' not found in module '.../node_modules/electron/index.js'.

apps/electron/src/main/lib/channel-runtime-api-key.test.ts:
SyntaxError: Export named 'shell' not found in module '.../node_modules/electron/index.js'.
```

根因：这两个测试文件直接 `import { BrowserWindow / shell } from 'electron'`，在纯 Bun
运行时 `electron` npm 包只导出二进制路径字符串，无命名导出——需要在真 Electron
运行时内执行。属上游测试环境限制，非产品功能损坏。处置：本票不修上游；
PB-004 的真 Electron smoke harness 覆盖主进程行为后可再评估（记录为后续观察项）。

## 开发启动实际结果（`bun run electron:dev`，真机窗口）

日志关键行（`/tmp/pb003-electron-dev.log` 快照）：

```text
[配置] 已同步默认 Skill: automation / brainstorming / docx / ... (14 个)
[IPC] IPC 处理器注册完成
[配置] 已创建 Agent 工作区目录: /Users/<local>/.proma-dev/agent-workspaces
[配置] 已创建默认工作区
System tray created
[全局快捷键] 注册成功: quick-task → Alt+Space
[全局快捷键] 注册成功: show-main-window → CommandOrControl+Shift+P
[Bridge Registry] 自愈守护已启动
[定时任务] 调度器已启动，tick 周期 30s
[渠道管理] 已自动创建 DeepSeek 预设渠道
[设置] 已更新 keys: mainWindowState / tabState
```

无崩溃、无 preload 报错。Renderer 侧仅有 devtools `Autofill.enable wasn't found`
提示（Electron 已知良性噪音）。首次启动即自动创建默认工作区与 DeepSeek 预设渠道。

## macOS 权限

启动过程**未请求**任何系统权限弹窗（无辅助功能/通知/文件访问授权请求）。
全局快捷键（Alt+Space、Cmd+Shift+P）直接注册成功。

## Provider 配置是否需要真实 Key

**是**。首次启动只自动创建 DeepSeek 预设渠道；真实模型对话需要用户在设置中
填入真实 API Key。这正是 PB-004 要建立本地 Fake Model Server（OpenAI-compatible）
做 hermetic smoke 的原因——后续 smoke 不依赖外部 API 与额度。

## node:sqlite 探针（计划 §5.7 前置验证，Electron 39.5.1 / Node 22.22.0 实测）

| 项 | 结果 |
|---|---|
| `process.versions.node` | `22.22.0` |
| `require('node:sqlite')` + `DatabaseSync` 建表/写入/读取 | ✅ 可用 |
| `db.backup`（Backup API） | ❌ **不存在**（该 API 于 Node 23.4 加入，22.x 无） |
| `VACUUM INTO '<path>'` 备份后回读 | ✅ 可用（实测 rows 一致） |

结论：`node:sqlite` 满足 PB-024 Store 的主要需求；备份能力用 SQLite 内建
`VACUUM INTO` 兜底（非 native addon、不换 driver，符合计划 §5.7 约束）。
此结论写入 PB-024 的输入。

## 边界声明

- 未修改任何产品代码；唯一新增为本报告与账本；
- 环境副作用：安装 bun 至 `~/.bun`；dev 启动写入 `~/.proma-dev/`（Proma 预期行为）；
- 未配置真实 API Key；未做任何打包（属 PB-004）。
