# G0 基线报告：打包 Electron 基线与 Hermetic Smoke（PB-004）

> 日期：2026-07-25　执行票：PB-004　状态：**packaged_app_verified**
> 计划条目：§10.3 G0 全部快乐路径项
> 结论：**18 PASS / 0 FAIL**（连续两次完整运行均 18/0，exit code 0）

## 1. 环境与版本

| 项 | 版本 |
| --- | --- |
| bun | 1.3.14（`~/.bun/bin/bun`） |
| Electron | 39.5.1（electron-builder.yml 显式固定） |
| Pi runtime（@earendil-works/pi-*） | 0.80.9 |
| playwright-core | 1.62.0（devDependency，精确版本，未安装浏览器二进制） |
| 运行 smoke runner 的 Node | v22.22.2（`~/.nvm/versions/node/v22.22.2/bin/node`） |
| electron-builder | 25.1.8 |
| 机器 | macOS Apple Silicon（arm64） |

**重要发现（harness 约束）**：smoke runner 必须用 **Node** 运行，不能用 bun。
playwright-core 的 `WebSocketTransport` 在 bun 的 `node:http` 兼容层下无法完成
Electron 主进程 inspector 的 WebSocket upgrade 握手（实测挂起直至 launch 超时；
同一握手用 curl 与 Node 均成功）。因此 `smoke:g0` 脚本为
`node scripts/smoke/run-g0-smoke.ts`（Node 22.18+ 原生类型擦除，直接跑 .ts，无需转译）。

## 2. 交付物

| 文件 | 说明 |
| --- | --- |
| `apps/electron/scripts/smoke/fake-model-server.ts` | Fake Model Server：OpenAI 兼容 `POST /v1/chat/completions`（SSE）+ `GET /v1/models`；场景按 model id 后缀（`fake-<scenario>`）选择，也支持 `x-fake-scenario` 头 |
| `apps/electron/scripts/smoke/run-g0-smoke.ts` | smoke runner：临时 HOME + `_electron.launch` 打包应用 + 播种 + 7 场景断言 + finally 清理 |
| `apps/electron/package.json` | 新增 `smoke:pack` / `smoke:g0` 脚本；devDependency `playwright-core@1.62.0`（精确版本） |
| `bun.lock` | playwright-core 锁文件更新 |

Fake Model Server 场景：`fake-text`（多 chunk 文本滴灌）、`fake-thinking`
（`delta.reasoning_content` + 正文）、`fake-tool`（`delta.tool_calls` 名称+arguments
分片，`finish_reason=tool_calls`；后续请求含 `role:"tool"` 消息时返回最终文本）、
`fake-retry`（首个流式请求 429 + `Retry-After: 1`，其后成功）、
`fake-context`（400 `context_length_exceeded`）、`fake-cancel`（400ms×120 慢速滴灌长流）。
非流式请求（标题生成）返回确定标题 `标题-<model>`。

**未改动任何产品运行时代码**（src/ 下零改动；diff 仅 package.json/bun.lock/scripts/smoke/docs）。

## 3. 运行命令

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd apps/electron
bun run smoke:pack   # = CSC_IDENTITY_AUTO_DISCOVERY=false bun run pack（build + electron-builder --dir，不签名）
bun run smoke:g0     # = node scripts/smoke/run-g0-smoke.ts（fake server + playwright runner）
```

打包输出（未签名，warning 符合预期）：

```
• packaging       platform=darwin arch=arm64 electron=39.5.1 appOutDir=out/mac-arm64
• skipped macOS application code signing  reason=, see https://electron.build/code-signing CSC_IDENTITY_AUTO_DISCOVERY=false
```

## 4. 断言运行路径说明（计划要求逐项标注）

全部断言均走 **Chat 运行时路径**：UI（ProseMirror 输入 + Enter）→
`electronAPI.sendMessage` → `chat-service` → `OpenAIAdapter` → SSE →
主进程 `webContents.send` → preload 事件 → React 渲染。
工具调用场景同样走 Chat 路径：chat-service 的工具续接循环对未注册工具返回
error result，随后携带 `role:"tool"` 消息发起续接请求，fake server 据此返回最终文本
（tool-result-then-final）。**未使用 Pi agent 路径**——Chat 模式已覆盖
`delta.tool_calls` 解析与完整工具往返，无需 `createAgentSession`。

DOM 断言：流式文本中间态、唯一最终文本、重启后历史消息可见（计划 §10.3 要求）。
事件级断言：思考 delta、工具调用事件、429 重试、上下文错误、停止
（经 preload 订阅 `onStreamChunk/onStreamReasoning/onStreamToolActivity/onStreamComplete/onStreamError`
——即真实主→渲染 IPC 管线，非 bundle grep）。

## 5. 计划 §10.3 快乐路径逐项结果

| §10.3 项 | 结果 | 证据（实际输出摘录） |
| --- | --- | --- |
| 干净构建 | PASS | `bun run smoke:pack`：vite `✓ built in 13.21s`，CLI 61MB，`[runtime-deps] 已同步 137 个主进程运行时依赖`，electron-builder `appOutDir=out/mac-arm64` |
| 打包启动 | PASS | `[PASS] packaged-launch — firstWindow 获取成功，window.electronAPI 就绪`；主进程日志 `[配置] 配置目录: ~/.proma/（正式版本）`、`[IPC] IPC 处理器注册完成`、`System tray created` |
| preload API | PASS | `[PASS] preload-api-exists — typeof window.electronAPI === 'object'` |
| 创建对话 | PASS | 主进程日志 `[对话管理] 已创建对话: G0文本流 (9f23d78b-…)`；`[PASS] temp-home-config — …/.proma/channels.json 存在`（临时 HOME，未触碰真实 ~/.proma） |
| 发送「你能帮我做什么」 | PASS | UI 路径：`[data-input-mode="chat"] .ProseMirror` 输入 + Enter；fake server 日志 `#1 POST fake-text stream=true → 200` |
| 流式文本可见（DOM） | PASS | `[PASS] text-streaming-visible-in-dom — 部分文本「你好！」已出现在 DOM，此时 STREAM_COMPLETE 未到达（确为流式中间态）` |
| 思考/工具活动 | PASS | `[PASS] thinking-delta — onStreamReasoning 收到 3 个 delta（含 REASONING_DELTA_MARKER_G0=true）`；`[PASS] tool-call-event-and-roundtrip — STREAM_TOOL_ACTIVITY(start, get_fake_weather)=true，服务端收到 role:"tool" 续接请求=true，最终文本 DOM=true`（fake server 日志 `#5 tool=false` → `#6 tool=true`） |
| 唯一最终 | PASS | `[PASS] text-unique-final — DOM 含 TEXT_FINAL_MARKER_G0=true，STREAM_COMPLETE=true，chunk 事件 4 个` |
| 停止 | PASS | `[PASS] stop-mid-stream — stop 前 chunk=2，1.6s 后 chunk=2（流已停止）`；`[PASS] stop-partial-persisted — 部分助手消息含 stopped=true 且内容含 CANCEL_DRIP_*=true` |
| 重启恢复 | PASS | 退出后同一临时 HOME 重启：`[PASS] restart-conversations-persisted — listConversations=["标题-fake-cancel","G0上下文超长","测试重试","标题-fake-tool","标题-fake-thinking","标题-fake-text"]，文本对话消息含 TEXT_FINAL_MARKER_G0=true`；`[PASS] restart-recovery-dom — 重启后侧边栏打开「标题-fake-text」，DOM 中 TEXT_FINAL_MARKER_G0 可见` |

附加场景（fake server 能力验证）：

- `[PASS] retry-429-then-success` — 首个流式请求 429（`Retry-After: 1`），客户端按
  sse-reader.ts:107-113 的首字节前重试（408/425/429/5xx，≤5 次）自动重试成功
  （日志 `#8 → 429`、`#9 → 200`），最终文本 DOM 可见。
- `[PASS] context-too-long-error` — `STREAM_ERROR 收到: openai API 错误 (400): {"error":{"message":"This model's maximum context length is 4096 tokens…`，错误经完整管线到达渲染进程。

两次完整运行结果：`=== G0 Smoke 结果: 18 PASS / 0 FAIL ===`（exit code 0）。

## 6. Hermetic 性质

- 无真实 API Key：渠道 apiKey 为 `sk-fake`，所有模型请求指向 `http://127.0.0.1:<port>/v1`。
- 无真实用户配置：`fs.mkdtemp` 临时 HOME，打包应用写入 `$HOME/.proma`（config dir 非
  Electron userData，config-paths.ts:24-57）；runner 断言 `tmpHome/.proma/channels.json` 存在。
- 渠道经 `electronAPI.createChannel` IPC 创建（safeStorage 由主进程处理），未手写 channels.json。
- finally 中 `quitApp`（close → 超时 SIGKILL 兜底）+ `server.close()`；
  运行后 `ps` 确认无残留 Proma / fake-server 进程。
- 临时目录（`$TMPDIR/proma-g0-smoke-*`）不入库；`out/`、`dist/`、`node_modules/` 均被 .gitignore 覆盖。

## 7. 已知限制

1. **safeStorage 在打包 smoke 环境不可用**：主进程日志
   `[渠道管理] safeStorage 加密不可用，将以明文存储`——渠道管理器有明文兜底
   （channel-manager.ts:255），不影响功能断言；真实用户环境走 Keychain 加密。
2. **自动更新报错（预期内）**：未签名 dir 包无 `app-update.yml`，`[更新] 检查更新失败 ENOENT`，
   对 smoke 无影响。
3. **思考块的 DOM 可见性**：reasoning 渲染在可折叠组件中，本次按事件级断言
   （preload `onStreamReasoning`，真实 IPC 事件）+ 最终文本 DOM；折叠块 DOM 断言未做。
4. **Agent（Pi）路径未覆盖**：Chat 路径已满足全部最低要求；Pi agent 的
   `createAgentSession`/`sendAgentMessage` 冒烟留待后续票。
5. **runner 依赖系统 Node**（≥22.18）：机器上为 nvm v22.22.2；CI/其他机器需保证 `node` 在 PATH。
6. 窗口竞争已处理：辅助窗口（快速任务/听写）与主窗口同载 index.html，runner 以
   `index.html 且无 ?window=` 过滤主窗口；此前偶发 `firstWindow()` 拿到辅助窗口导致超时，已修复并经两次连续运行验证。
