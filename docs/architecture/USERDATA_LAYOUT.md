# Linguist Agent userData 布局（AC-003）

> Linguist Agent 保留完整 Proma Agent / Chat 能力，但使用独立的数据根。旧 Proma
> 数据不会被自动迁移或与 Linguist Agent 混用。

## 1. 配置根目录

| 模式 | 目录 | 判定逻辑 |
| --- | --- | --- |
| 打包版（packaged） | `$HOME/.linguist-agent/` | `app.isPackaged === true` |
| 开发版（dev） | `$HOME/.linguist-agent-dev/` | `PROMA_DEV=1` 或未打包运行 |

统一入口是 `apps/electron/src/main/lib/config-paths.ts` 的
`getConfigDirName()` / `getConfigDir()`。CLI 使用同样的目录名，并允许
`--config-dir` 显式覆盖。

## 2. 当前数据布局

以下为主要键；完整路径定义以 `config-paths.ts` 为准：

- `channels.json` — Provider 与模型配置，API Key 由 Electron `safeStorage` 加密
- `settings.json` — 应用设置
- `conversations.json` + `conversations/{id}.jsonl` — Chat 对话
- `attachments/{conversationId}/` — 对话附件
- `agent-sessions.json` + `agent-sessions/{id}.jsonl` — Agent 会话
- `agent-workspaces.json` + `agent-workspaces/{slug}/` — Agent 工作区、MCP、Skills 与文件
- `default-skills/` — 内置 Skills 同步目标
- `system-prompts.json`、`chat-tools.json`、`automations.json`、`scratch-pad.md`
- `feishu*.json` / `dingtalk*.json` / `wechat*.json` — 远程机器人配置与绑定
- `linguist/` — CAT 项目索引、项目数据库、受管导入、导出、备份与迁移数据

## 3. 旧 Proma Provider 导入

入口位于「设置 → 模型配置 → 从 Proma 导入」。导入只读取旧 Proma 数据根中的
`channels.json`：

- 打包模式优先 `$HOME/.proma/channels.json`；
- 开发模式优先 `$HOME/.proma-dev/channels.json`；
- 首选路径不存在时，确定性检查另一模式的旧路径。

导入会先解密旧密钥，再用当前应用的 `safeStorage` 重新加密；若安全存储不可用、
任一密钥无法解密、源配置损坏或当前配置损坏，整个操作失败且不写入部分结果；
最终配置通过同目录临时文件原子替换，避免直接截断既有文件。烟测明文凭据模式禁止导入。
相同 Channel ID 视为冲突并跳过，不覆盖现有配置；同一 Provider 的不同账号可以并存。

不会导入 Proma 的会话、应用设置、工作区、机器人配置、信任规则、CAT 数据或其他文件。

## 4. 不变量

1. dev 与 packaged 数据不共享（`.linguist-agent-dev` 与 `.linguist-agent`）。
2. Proma 与 Linguist Agent 不共享数据根；Proma 根只在用户显式导入 Provider 时只读访问。
3. CAT 数据只进入当前数据根的 `linguist/` 子目录。
4. 测试与打包烟测使用临时 `HOME`，不得触碰真实用户目录。
