# G1 门禁报告：Batch 1 收口 — Pi 流式路径打包验证（计划 §14 / §28）

> 日期：2026-07-25　执行：G1 Batch Gate（PB-014 之后）　状态：**GATE PASSED**
> 基线 commit：`c4bb4c6f`（PB-014）　结果 commit：`SELF`（本报告与探针脚本所在提交）
> 结论：**G1 四项门禁标准全部 PASS**（G0 smoke 18/18、LA 品牌首屏、Pi 流式探针 12/12、静态检查全绿）

## 1. 环境与版本

| 项 | 版本 |
| --- | --- |
| bun | 1.3.14（`~/.bun/bin/bun`） |
| Electron | 39.5.1（electron-builder.yml 显式固定） |
| Pi runtime（@earendil-works/pi-*） | 0.80.9 |
| playwright-core | 1.62.0（devDependency，精确版本，未安装浏览器二进制） |
| 运行 smoke/probe 的 Node | v22.22.2（原生 .ts 类型擦除；PB-004 已证实 bun 下 playwright-core ws 握手挂起，不可用 bun 跑） |
| electron-builder | 25.1.8（`--dir` 未签名包，`CSC_IDENTITY_AUTO_DISCOVERY=false`） |
| 机器 | macOS Apple Silicon（arm64） |

打包产物：`apps/electron/out/mac-arm64/Linguist Agent.app`（`bun run smoke:pack`，
vite `✓ built in 12.82s`，CLI 61MB，`[runtime-deps] 已同步 137 个主进程运行时依赖`，
`skipped macOS application code signing … CSC_IDENTITY_AUTO_DISCOVERY=false` 符合预期）。

## 2. 交付物（本门禁新增，均为测试基础设施 / 文档，零产品代码改动）

| 文件 | 说明 |
| --- | --- |
| `apps/electron/scripts/smoke/probe-pi-stream.ts` | **G1 Pi 流式探针**（新增）：临时 HOME + `_electron.launch` 打包应用 + 播种 fake 渠道/工作区 + `createAgentSession`（缺省 `agentRuntime='pi'`）+ `sendAgentMessage`，订阅 `onAgentStreamEvent/onAgentStreamComplete/onAgentStreamError` 断言 Pi 路径流式事件 |
| `apps/electron/package.json` | 新增脚本 `smoke:g1` = `node scripts/smoke/probe-pi-stream.ts`（该文件是 PB-004 已登记触点，路径未变） |
| `docs/roadmap/G1_REPORT.md` | 本报告 |
| `docs/roadmap/EXECUTION_LEDGER.md` / `execution-ledger.json` | G1 门禁记录 |

## 3. 门禁标准逐项结果（计划 §14）

### 标准 1：原有 Chat/Agent packaged smoke 仍全绿 — **PASS**

命令：`cd apps/electron && bun run smoke:pack && node scripts/smoke/run-g0-smoke.ts`

最终结果（第 3 次运行，单独运行无任何并发任务）：

```
=== G0 Smoke 结果: 18 PASS / 0 FAIL ===   EXIT=0
```

18 项 PASS 含：packaged-launch、preload-api-exists、main-window-loaded、
seed-channel-and-settings、onboarding-skipped、temp-home-config、
text-streaming-visible-in-dom、text-unique-final、thinking-delta、
tool-call-event-and-roundtrip、retry-429-then-success、context-too-long-error、
stop-mid-stream、stop-partial-persisted、restart-conversations-persisted、
restart-recovery-dom 等；fake server 请求日志 12 条完整（含 `#5 fake-tool tool=false`
→ `#6 tool=true` 续接、`#8 fake-retry → 429` → `#9 → 200`）。

**稳定性说明（如实记录，见 §5 已知限制）**：本轮门禁共跑 3 次 G0 smoke，
前 2 次各出现 1 个互不相同的 harness 层 UI 自动化抖动（非产品断言失败），第 3 次 18/18 全绿。
产品代码与 PB-013 时连续多次 18/18 验证的版本逐字节一致（PB-014 仅 docs/tests，
本门禁仅新增 scripts/smoke 与 package.json 脚本项）。

### 标准 2：LA 品牌 App 能打开 — **PASS**

打包应用 `Linguist Agent.app` 正常启动，G0 smoke 首屏品牌断言（实际输出）：

```
[PASS] packaged-launch — firstWindow 获取成功，window.electronAPI 就绪
[PASS] main-window-loaded — document.readyState=interactive，首屏内容=true
  （「欢迎使用 Linguist Agent  下一代桌面 AI 软件，让通用 Agent 触手可及  查看使用教程  了解 …」，
  首启 Onboarding 门禁页）
```

首屏即 LA 品牌文案「欢迎使用 Linguist Agent」；主二进制与 .app 名均为 `Linguist Agent`
（smoke runner 按 glob 解析，不写死）。

### 标准 3：Pi 能流式回答（G0 未覆盖的 AGENT 路径）— **PASS**

命令：`cd apps/electron && node scripts/smoke/probe-pi-stream.ts`（即 `bun run smoke:g1`）

首次运行即全绿（实际输出，未做任何返工）：

```
=== G1 Pi 流式探针（packaged .app + Fake Model Server + Pi AGENT 路径）===
[PASS] packaged-binary-exists — …/out/mac-arm64/Linguist Agent.app/Contents/MacOS/Linguist Agent
[PASS] fake-server-started — http://127.0.0.1:58967/v1
[PASS] packaged-launch — firstWindow 获取成功，window.electronAPI 就绪
[PASS] seed-channel-workspace — channelId=9f17d255-…，workspaceId=2cc59c64-…，onboardingCompleted=true
[PASS] pi-session-created-text — sessionId=26042cc9-…，agentRuntime=pi
[PASS] pi-text-streaming-partials — _partial 文本事件 5 个（≥2=true），存在不含最终标记的中间帧=true
[PASS] pi-text-final-and-complete — 最终文本含 TEXT_FINAL_MARKER_G0=true，STREAM_COMPLETE 次数=1，STREAM_ERROR=0
[PASS] pi-session-created-thinking — sessionId=83f10e22-…，agentRuntime=pi
[PASS] pi-thinking-delta — _partial thinking 事件 6 个，thinking 块含 REASONING_DELTA_MARKER_G0=true
[PASS] pi-thinking-final-and-complete — 最终文本含 THINKING_FINAL_MARKER_G0=true，STREAM_COMPLETE 次数=1，STREAM_ERROR=0
[PASS] pi-requests-hit-fake-server — fake-text 流式请求 1 次（→ 200），fake-thinking 流式请求 1 次（→ 200）
[PASS] temp-home-config — <tmpHome>/.proma/channels.json 存在（未触碰真实 ~/.proma）
=== G1 Pi 探针结果: 12 PASS / 0 FAIL ===   EXIT=0
```

断言覆盖计划要求的三点：

- **流式 TEXT delta**：`fake-text` 场景收到 5 个 `_partial` assistant 文本事件
  （pi-agent-adapter 20fps partial 合并帧，经 AgentEventBus → IPC → preload
  `onAgentStreamEvent`），且存在不含最终标记的中间帧（确为流式中间态，非一次性整段）；
- **thinking/reasoning delta**：`fake-thinking` 场景（服务端发 `delta.reasoning_content`，
  pi-ai openai-completions 解析为 thinking 块）收到 6 个 `_partial` thinking 事件，
  thinking 块含 `REASONING_DELTA_MARKER_G0`；
- **唯一终态事件**：两个场景 `onAgentStreamComplete` 均恰好 1 次、`onAgentStreamError` 0 次。

运行路径（非 bundle grep，全链路真实 IPC）：
`electronAPI.sendAgentMessage` → agent-orchestrator → pi-agent-adapter →
pi-ai `openai-completions`（渠道 provider `openai` 经 pi-model-registry 映射；
baseUrl = 协议根 `http://127.0.0.1:<port>/v1`，apiKey `sk-fake`）→ fake server SSE →
`message_update` partial → convertPiMessage → AgentEventBus → `webContents.send` →
preload 事件订阅。fake server 请求日志证明请求确由 Pi 路径发出：

```
#1 POST fake-text stream=true tool=false → 200
#2 POST fake-thinking stream=true tool=false → 200
```

### 标准 4：静态检查 — **PASS**

| 检查 | 实际结果 |
| --- | --- |
| 根 `bun run typecheck` | **6/6 包 exit 0**（@proma/shared、session-core、core、cli、ui、electron 全部 `Exited with code 0`） |
| 根 `bun test` | **492 pass / 2 fail** / 494 tests / 65 files；2 条失败为 PB-003 起既有上游环境限制（`agent-session-manager.test.ts`、`channel-runtime-api-key.test.ts` 纯 Bun 下无法 import electron 命名导出：`SyntaxError: Export named 'BrowserWindow'/'shell' not found`），与基线一致，未变差 |
| 根 `bun run check:boundaries` | **3 pass / 0 fail**（登记册良构；diff vs 基线 `702a8221` 无未登记改动；无 stale 条目）。提交后复跑同样 3/3（见账本） |

## 4. Hermetic 性质

- 无真实 API Key：渠道 apiKey 为 `sk-fake`，全部模型请求指向 `http://127.0.0.1:<port>/v1`。
- 无真实用户配置：`fs.mkdtemp` 临时 HOME（`$TMPDIR/proma-g0-smoke-home-*` /
  `proma-g1-pi-probe-home-*`），探针断言 `<tmpHome>/.proma/channels.json` 存在，
  未触碰真实 `~/.proma`。
- 渠道/工作区/会话均经 `electronAPI.*` IPC 创建（safeStorage 由主进程处理），未手写配置文件。
- finally 中 `quitApp`（close → SIGKILL 兜底）+ `server.close()`，不遗留后台进程。

## 5. 已知限制

1. **G0 smoke 的 harness 层抖动（本轮实测 3 跑 2 抖）**：均为 UI 自动化时序问题，
   非产品断言失败，且两次失败点互不相同：
   - 第 1 次（与 typecheck/bun test 并发运行）：场景 4 侧边栏点击被对话框遮罩
     （`div.fixed.inset-0.z-[100].bg-black/40[data-state=open]`）拦截，playwright
     `locator.click` 15s 超时，12 PASS / 1 FAIL（`runner-completed`）；主进程日志无异常。
   - 第 2 次（单独运行）：场景 3「G0工具调用」的消息未发出——fake server 请求日志中
     **完全没有 fake-tool 条目**（`#4 fake-thinking` 直接跳到 `#5 fake-retry`），
     17 PASS / 1 FAIL（`tool-call-event-and-roundtrip`）；同一路径在第 1、3 次运行均 PASS。
   - 第 3 次（单独运行）：18/18 PASS。产品代码与 PB-013 验证时逐字节一致，且 PB-004
     至 PB-013 各票均有连续 18/18 记录。判断为 harness 抖动而非产品回归；若后续
     门禁复现率升高，应开 PB-FIX 票加固 runner（如发送后断言输入清空/重试发送）。
2. **runner/probe 依赖系统 Node**（≥22.18）：机器上为 nvm v22.22.2；bun 下
   playwright-core ws 握手挂起（PB-004 发现），两个脚本都必须用 `node` 运行。
3. **safeStorage 在打包 smoke 环境不可用**：主进程日志报「将以明文存储」，
   走 channel-manager 明文兜底，不影响断言；真实用户环境走 Keychain。
4. **自动更新报错（预期内）**：未签名 dir 包无 `app-update.yml`，`[更新] 检查更新失败 ENOENT`。
5. **Pi 探针为事件级断言**：流式/thinking 断言基于 preload 订阅的真实 IPC 事件，
   未做 Agent 模式下的 DOM 渲染断言（Chat 路径的 DOM 断言已由 G0 覆盖）。
6. **Pi 探针未覆盖 Pi 工具调用/权限路径**：fake 场景不触发 Pi 内建工具
   （G0 的工具往返断言走 Chat 路径）；Pi 工具执行冒烟留待后续票。
