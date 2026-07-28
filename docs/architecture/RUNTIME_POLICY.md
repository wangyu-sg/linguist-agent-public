# Runtime Policy — Pi 为唯一可见 Runtime（D-002 / PB-011）

> 产品决策 **D-002**：首个版本只向用户展示 **Pi runtime**。Claude/Pi 双内核概念从 UI 隐藏；
> Claude 实现代码、测试与打包同步**全部保留**，不做删除。
> 本文件记录：隐藏了什么、Claude 仍可从何处触达、以及何时重新评估 Claude 移除。

## 1. 默认值：新会话一律 Pi

| 决策点 | 位置 | 行为 |
| --- | --- | --- |
| 全局默认常量 | `apps/electron/src/types/settings.ts`（`DEFAULT_AGENT_RUNTIME = 'pi'`） | 设置缺省即 pi |
| 设置读取回退 | `apps/electron/src/main/lib/settings-service.ts` | `agentRuntime` 缺省回退 pi |
| 新建 Agent 会话 IPC | `apps/electron/src/main/ipc.ts`（`CREATE_SESSION`） | `getSettings().agentRuntime ?? 'pi'` |
| 会话管理器默认参数 | `apps/electron/src/main/lib/agent-session-manager.ts`（`createAgentSession`） | 默认 `'pi'` |
| 渲染进程默认 atom | `apps/electron/src/renderer/atoms/agent-atoms.ts`（`agentRuntimeAtom`） | 默认 `'pi'` |
| 自动任务（Automation） | `apps/electron/src/main/lib/automation-manager.ts`、`renderer/atoms/automation-atoms.ts` | 新建默认 pi |
| 远程 Bot（飞书桥） | `apps/electron/src/main/lib/feishu-bridge.ts` | 缺省回退 pi（PB-011 修正） |
| 快速任务窗口 / 语音输入 / 托盘入口 | 均汇入上述 `CREATE_SESSION` 路径 | 继承设置默认 pi |

历史兼容：已存在的会话/自动任务若持久化记录缺失 runtime，仍按 Claude 兼容
（`?? 'claude'` 回退仅用于**历史数据**，不用于新建）。这些回退不得改为 pi——
它们保护旧会话的可恢复性。

## 2. 隐藏 vs 删除

**隐藏（UI 门控，代码保留）**——统一由 `apps/electron/src/renderer/lib/feature-flags.ts`
的 `AGENT_RUNTIME_SWITCHER_VISIBLE`（当前 `false`）控制（PB-012 起从原
`lib/runtime-policy.ts` 迁入统一开关模块，清单见 `docs/architecture/FEATURE_FLAGS.md`）：

- Agent 输入工具栏的内核切换器 `AgentRuntimeSelector`（`renderer/components/agent/AgentView.tsx`）
- 自动任务表单「Agent 内核」选择器 `AutomationRuntimeSelector`（`renderer/components/automation/AutomationFormView.tsx`）
- 渠道设置里每个渠道的 Claude Agent Core 徽章（`renderer/components/settings/ChannelSettings.tsx`）

恢复双内核 UI 时把开关改回 `true` 即可，无需找回代码。

**保留未动**：

- Claude runtime 全部实现：`agent-orchestrator.ts` 的 claude 分支、`runtime-routing-agent-adapter.ts`、
  `@anthropic-ai/claude-agent-sdk` 依赖与 esbuild external 配置
- `scripts/sync-runtime-deps.ts` 把 Claude SDK 同步进打包 node_modules 的流程（**必须保持可用**）
- Claude 相关全部测试（含 `agent-session-manager.test.ts` 的 claude 会话用例）
- `updateSessionAgentRuntime` IPC（逐会话切换 runtime 的主进程能力）

## 3. 维护者如何触达 Claude

UI 隐藏后，Claude 仍可通过以下方式到达（仅供维护/调试）：

1. 在 `~/.linguist-agent/settings.json`（开发模式 `~/.linguist-agent-dev/settings.json`）写入
   `"agentRuntime": "claude"` —— 之后新建的 Agent 会话默认使用 Claude。
2. 通过 `updateSessionAgentRuntime` IPC 把单个会话切到 Claude（主进程校验
   `isAgentRuntime`，能力未删）。
3. 把 `AGENT_RUNTIME_SWITCHER_VISIBLE` 改回 `true`，恢复全部切换 UI。

## 4. 对后续 LA Project 会话的约束

未来的 LA Project 会话（执行计划 Batch 3/4 及以后）**只允许创建 Pi 会话**：
不得在新的用户可见入口中暴露 runtime 选择，不得把 Claude 设为新路径的默认值。
历史数据的 Claude 兼容回退不在此限。

## 5. 何时重新评估 Claude 移除

仅当 **第一条完整 CAT 路径（端到端真实任务验收）在 Pi runtime 上通过** 之后，
才重新评估是否删除 Claude runtime 实现。在此之前：隐藏 ≠ 删除，Claude 代码、
测试、打包同步一律保留（见 §2）。
