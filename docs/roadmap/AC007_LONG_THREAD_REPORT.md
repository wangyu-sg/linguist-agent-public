# AC-007：G10 长线程首载、补载与跳转验证

> 日期：2026-07-27
> 施工基线：`3d520ce5`
> 状态：`packaged_verified`

## 结论

1000-turn / 2000-message Agent 会话的专项打包验证为 **8 PASS / 0 FAIL**：

| 项目 | 结果 |
|---|---:|
| 最近消息窗口首开 | 451ms |
| 首条窗口消息挂载 | 252ms |
| 末尾消息挂载 | 317ms |
| 首载 DOM 消息数 | 120 / 完整历史 2000 |
| 顶部补载 | 104ms |
| 补载锚点漂移 | 0.3px |
| 消息导航跳转第 500 轮 | 1312ms |
| 跳转后 DOM 消息数 | 120 / 完整历史 2000 |

## 根因更正

旧 G10 探针报告的 `10522ms`，以及本票修复前复现的 `10566ms`，并不能证明
“React/Markdown 首挂载耗时约 10.5 秒”。

探针在开始计时后，先等待仅折叠侧栏存在的 `RailRecentButton`，超时固定为 10 秒；
展开侧栏实际使用带 `data-session-switch-title` 的会话行。10 秒超时后探针才执行
文本 fallback 并真正打开会话，因此旧分段计时把导航探针的等待错误算进了首挂载。

对 2000 条合成消息单独运行 `groupIntoTurns` 只需约 `0.8ms`。修正会话选择器后，
打包 App 的首开为 `451ms`。因此旧报告中的性能失败是真实可复现的探针失败，
但其“React 首挂载 10.4 秒”归因不成立。

## 产品修复

- Agent 长历史首次只挂最近 120 个 group，完整 SDK 消息和 minimap 数据仍保留；
- 滚动到顶部按 120 个 group 补载，按原首条 DOM 锚点恢复位置；
- minimap 搜索命中未挂载消息时，先切换到目标附近窗口，再执行定位；
- 目标窗口之后的较新消息使用明确的“加载较新消息”按钮继续补载；
- 流式输出始终回到最近窗口，不隐藏当前 turn；
- Chat 继续使用既有 IPC 分页路径，没有改变行为。

## 验证

```bash
# 仓库根目录
bun run typecheck

cd apps/electron
bun test \
  ./src/renderer/components/agent/agent-message-window.test.ts \
  ./src/renderer/components/agent/compaction-progress.test.ts \
  ./src/renderer/components/agent/turn-divider-utils.test.ts

bun run build:renderer
bun run smoke:pack
node scripts/smoke/probe-pb105-matrix.ts --long-thread-only
```

结果：

- Agent 相关测试：22 pass / 0 fail；
- 全仓 typecheck：11 / 11 包通过；
- Renderer production build：通过；
- `smoke:pack`：通过；
- packaged long-thread probe：8 pass / 0 fail。

## 范围说明

`--long-thread-only` 只执行 AC-007 相关的打包专项，避免把并行施工中的 CAT 导航变化
误计入本票。完整 G10 的 Axe 与新 Workbench 路径由 AC-008 / AC-009 重新验收。
