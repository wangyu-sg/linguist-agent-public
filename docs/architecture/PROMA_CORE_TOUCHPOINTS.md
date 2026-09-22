# Proma Core Touchpoints — v0.19.57

> 基线：`v0.19.57@4e96c5e859302c4a34618d45db352b29a7ebeb28`
> 正式 merge：`b9417191d80d96e15a2702c9f8f927327312a970`
> 机读真源：[proma-touchpoints.json](./proma-touchpoints.json)

| 集合 | 路径数 |
|---|---:|
| Permanent Product Fork | 216 |
| Generated / Overlay | 2 |
| Main Host Seam | 8 |
| Renderer Host Seam | 3 |
| Temporary Deviation | 45 |
| 当前精确 ledger | 274 |

账本使用 schema v3；每个条目都记录 `kind`、`owner`、`mergePolicy`、具体理由，以及 Host Seam 的稳定 `hook`。Linguist Extension 位于允许根，不计入 Proma Core Touchpoint。精确文件只维护在 JSON，避免双写漂移。

## 规则

1. CAT 领域代码优先进入 `apps/electron/src/**/linguist/`、`packages/linguist-*`、`resources/linguist-*` 与默认本地化 Skill 目录。
2. 修改 Proma Core 生产代码必须在同一变更中登记精确触点、所有者、合并策略和真实理由；测试文件不进入生产触点账本，stale 条目同样会被 boundary test 拒绝。
3. `tests/upstream-boundary.test.ts` 同时检查 HEAD、tracked 工作树和 untracked 文件。
4. Main Host Seam 保留 Agent Extension、IPC、Preload、Collaboration 与跨 utility 恢复/请求观察；Collaboration 的同一 hook 跨委派工具与 Pi builtin 传递可信 Context。Renderer Host Seam 保留 AgentView、AppShell 和右侧工作区扩展三处；临时偏差包括 Pi 同任务作用域规则交付、compaction 与待上游化的通用修复，逐项退役条件以 JSON 为准。
5. 同步规则由 [proma-sync-policy.json](./proma-sync-policy.json) 管理；Anchor 和深层领域 import 由 `scripts/verify-host-seams.mjs` 验证。
6. 维护顺序固定为 baseline → 实际 diff → ledger → deviations → boundary + fusion。

不要扩大白名单来掩盖核心改动，也不要把“已登记”误解为永久合理。

## LA 领域方法资源

本轮新增允许根 `apps/electron/default-skills/game-localization/`，以及既有 Phrase Skill 的 `references/`。两者仅承载 LA 专业方法与定制覆盖合并指引；通用 Skills、Pi、Browser 和原生侧栏不因此获得新的修改范围。


## v0.19.57 差异复核

按官方 `v0.19.57` 与当前工作树的真实内容比较，退役 18 个已无差异的精确条目：MCP 前端数据 hook、消息队列/任务卡与工具任务渲染、消息基础组件、BrowserPanel/外部 URL helper、右栏 TabBar、FileBrowser 加载状态、顶部 Tab 布局/内容、文件路径 chip/helper、DiffTabContent/滚动恢复、会话拖入引用及 Shared manifest。每次同步仍以实际 diff 重算，不为这些文件保留永久修改许可。

保留理由从“LA 自有 rail/字号”改为可核对的能力：AgentView 仅组合项目轮次快照/附件 authority/续会话；右栏仅额外贡献 CAT；审批、任务聚合和输入布局继承上游。真实计划正文与压缩失败重试是通用临时偏差，已从产品身份条目重分类。

本轮新增 `pi-project-instruction-scope.ts` 的临时登记：Pi 0.86.1 在一次 prompt 内发现子目录规则后，`before_agent_start` 不会为下一模型轮再次执行；改为 `turn_end` 经原生 steer 队列交付并持久化，当前工具批仍先阻断。退出条件是上游提供等价同任务交付语义并通过真实 Pi session 回归。

右栏的另外两项临时行为在既有精确条目内说明，不扩大允许根：终端 IPC 收集移到全局 listener，避免组件卸载时丢后台事件；收起右栏不触发协作子会话“已查看”。保留挂载、真正可见和项目绑定是不同状态，不能互相替代。

本轮另外登记三处最小内部合同清理：FileBrowser 只接受唯一生产调用已提供的必填 `roots`，删除未使用的 `rootPath` 入口及两个专用 helper；Utility 启动删除零生产调用的取消分类器。目录加载保护与启动握手不变，均以精确条目记录，在上游完成等价删除后退役。

### 对应证据入口

- `apps/electron/src/main/lib/adapters/pi-project-instruction-scope.test.ts`：真实 Pi session、合成无网络模型流；同批阻断、下轮可见、重试执行和规则持久化。
- `apps/electron/src/renderer/features/linguist/projects/open-linguist-session.test.ts` 与 `apps/electron/src/renderer/hooks/useSyncActiveTabSideEffects.test.ts`：真实 Jotai 状态转换，覆盖 MRU、Preview、右栏偏好、导航代次与未保存表单。
- `apps/electron/src/renderer/features/linguist/projects/cat-editor.browser.test.ts`：隔离 renderer 场景覆盖项目设置入口、受管 Preview 身份、后台终端及宿主续会话；它不是安装版、真实模型或所有 UI 流程已通过的证明。
- `tests/proma-01957-composer-regression.test.ts`：任务终态、文件引用和原生会话拖入。

上述文件是可复跑的证据入口；通过情况、真实机器与发布资格分别记录，不能由触点登记推定。
