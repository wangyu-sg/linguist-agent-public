# G3 门禁报告：真实 Electron 全环 — 创建 Project、导入、重启、再次打开，数据完整（计划 §14 / PB-034）

> 日期：2026-07-26　执行：G3 Batch Gate（PB-034 之后）　状态：**GATE PASSED**
> 基线 commit：`a92f2920`（PB-033）　结果 commit：`SELF`（本报告与 PB-034 所在提交）
> 门禁标准（唯一硬标准）：**「真实 Electron：创建 Project、导入、重启、再次打开，数据完整。」**
> 结论：**真实打包应用（`smoke:pack` 产出的 .app）全环通过**——CLI 播种创建 Project + 导入真实 fixture（8+8 段），打包应用内创建项目对话（Pi Agent 会话绑定项目），重启应用后绑定/会话/段数据完整再现；归档项目会话被主进程硬阻断（到达模型前），项目目录缺失时会话降级可用、项目视图存活。四个常驻探针 59 项断言全绿，全部静态检查与测试基线不劣化。

## 1. 环境与版本

| 项 | 版本 |
| --- | --- |
| Node（探针/CLI 运行） | v22.22.2（playwright-core 的 ws upgrade 握手在 bun 下不可用，PB-004 起固化：**探针必须 node 运行**；cat-store 需 node:sqlite，CLI 同约束） |
| bun | 1.3.14（`~/.bun/bin/bun`，用于 typecheck / bun test / boundaries / smoke:pack） |
| 打包产物 | `apps/electron/out/mac-arm64/Linguist Agent.app`（`bun run smoke:pack`，electron-builder dir 产物） |
| 机器 | macOS Apple Silicon（arm64） |
| 数据 | mkdtemp 临时 HOME（`/var/folders/.../T/proma-pb03{2,3,4}-probe-home-*`），全部 synthetic fixtures（`tests/linguist-fixtures/`）；**不触碰真实 `~/.proma`**（每个探针均有 temp-home-isolation 断言） |
| 模型 | 本地 fake model server（`http://127.0.0.1:*`，脚本内拉起随探针退出）；除此外无网络 |

## 2. 交付物（PB-034 + 本门禁）

| 文件 | 说明 |
| --- | --- |
| `packages/shared/src/types/agent.ts`（**已登记触点**） | `AgentSessionMeta` 新增冻结可选字段 `linguistProjectId?` / `linguistProjectName?`（名称快照）；`ErrorCode` 新增 `linguist_project_archived` |
| `packages/shared/src/types/linguist.ts`（**已登记触点**，兼 PB-031/033） | `LINGUIST_SESSION_IPC_CHANNELS` 三通道常量 + 会话绑定线格式（`LinguistSessionBindingStatus = active/archived/missing` 等）；**24 错误码目录不变**（复用 PROJECT_NOT_FOUND / PROJECT_ARCHIVED / INVALID_INPUT） |
| `apps/electron/src/main/lib/agent-session-manager.ts`（**已登记触点**） | `createAgentSession` 第 6 可选参数 `linguistBinding`（唯一写入点）；`updateAgentSessionMeta` 白名单不含绑定字段且运行时强制保持原值（冻结，防 any 绕过）——无重绑定 API |
| `apps/electron/src/main/lib/linguist/session-binding.ts`（新增，白名单） | 绑定状态实时解析 `resolveLinguistBindingStatus`（index 查无 → `existsSync`+`project.json` 二次确认区分 archived/missing——store `getProject` 只读索引，**不做 fs 检查 missing 会被误报为 archived**，实测发现）；`createLinguistProjectChatSession` / `listLinguistProjectChatSessions` / `checkLinguistSessionSendBlock`（归档 → TypedError；missing/未绑定/服务不可解析 → fail-open） |
| `apps/electron/src/main/lib/agent-orchestrator.ts`（**已登记触点**） | **主进程强制点**：`sendMessage` preflight（agent-orchestrator.ts:1018，sessionMeta 加载后、channel_disabled 检查前）归档 → `reportPreflightError` 持久化 TypedError 并终止本轮；`queueMessage`（agent-orchestrator.ts:2670）同一闸门（throw） |
| `apps/electron/src/main/lib/linguist/session-ipc.ts` + `ipc-envelope.ts`（新增，白名单） | 三通道 handler 工厂（信封风格，零新错误码）；信封助手从 project-ipc.ts 抽取共享（project-ipc 逻辑不变的重构） |
| `apps/electron/src/main/ipc.ts` + `src/preload/index.ts`（**已登记触点**） | 三通道注册 + preload 扁平方法 `linguistSessions{CreateForProject,ListForProject,GetBinding}`（house 惯例） |
| `apps/electron/src/renderer/features/linguist/projects/ProjectChatsSection.tsx`（新增，白名单） | 详情面板 Chat tab 落地（role="tab" 真实选中态，替换「项目工作台即将推出」占位）：项目对话列表（recent 排序）+「新建项目对话」+ 空状态「尚无项目对话」；归档项目新建禁用 + 只读提示，列表仍可读可打开 |
| `apps/electron/src/renderer/features/linguist/session-binding/`（新增，白名单） | `useLinguistSessionBinding` hook、`LinguistSessionBindingBadge`（项目名 + 已归档/项目缺失）、`LinguistSessionBindingNotice`（归档只读/缺失降级横条）、`binding-utils.ts` 纯函数 |
| `apps/electron/src/renderer/components/agent/AgentHeader.tsx`（**已登记触点**） | 徽章/通告唯一挂载点；AgentView 未改动 |
| `apps/electron/src/main/lib/linguist/session-binding.nodetest.ts`（6 条）+ `session-ipc.nodetest.ts`（5 条） | node --test：状态三态/冻结/创建/列表/发送闸门；IPC 信封 happy + 校验负例 + 归档拒建 |
| `apps/electron/src/main/lib/linguist/test/{electron-stub.mjs,loader-hooks.mjs}` | 测试基建：bare `electron` specifier 打桩 + 目录导入解析（node 无 mock.module） |
| `apps/electron/src/main/lib/linguist/ipc-contract.test.ts`（+3 条）+ `renderer/.../binding-utils.test.ts`（+5 条） | bun 守卫：三通道名精确匹配/preload 与 ipc.ts 接线形状；绑定纯函数 |
| `apps/electron/scripts/smoke/probe-project-session.ts`（新增**常驻探针**，17 断言） | 真实 UI 驱动全环：CLI 播种 → Chat tab → 新建项目对话 → 徽章 → IPC 交叉核对 → 普通会话未绑定 → 归档 → 列表只读/新建禁用 → **发送被主进程阻断（fake server 0 请求 + JSONL 落盘 linguist_project_archived + 用户消息持久化）** → 历史可读 → 删项目目录重启 → missing 降级 + 项目视图存活 → tmp HOME 隔离 |
| `apps/electron/scripts/smoke/probe-projects-view.ts`（更新） | 第 6 断言随 Chat tab 落地更新：`role="tab"` 选中态 + 「尚无项目对话」空状态（旧「即将推出」占位断言移除） |
| `docs/roadmap/G3_REPORT.md`（本报告）、账本两文件、`docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md` | 门禁与登记（触点 43→47：4 新 + 3 追加） |

## 3. 门禁标准逐项结果

### 标准 1：真实 Electron 全环「创建 Project、导入、重启、再次打开，数据完整」— **PASS**

全部在 `smoke:pack` 打包应用（非 dev 模式）上以 mkdtemp 临时 HOME 实测，2026-07-26 真实运行输出：

| 子项 | 证据（探针断言，全 PASS） |
| --- | --- |
| **创建 Project** | CLI 播种 `create-project`（probe-project-session：`prj-195e4c7cefb885fd`「PB-034 绑定探针项目」；probe-import：`prj-fb2fa227eba0dedd` + 空项目 `prj-12ecb15a116da705`）；**UI 创建**（probe-projects-view：对话框填写提交 → 卡片出现，主进程 list 交叉核对一致 `prj-35e6123607674971`） |
| **导入** | CLI 播种导入真实 fixture：mini_dialogue.csv（8 段）+ mini_items.json（8 段）→ 打包应用卡片计数「16 段 · 2 资产」、详情资产区两行渲染（文件名/formatId/段数/截断 sha256），页内 `getSummary` 交叉核对 sha 与播种一致（probe-import 11/11） |
| **重启** | probe-project-session 第 7 腿：杀掉应用 → 删除项目目录 → 以**同一 tmp HOME** 重新启动打包应用（真实 relaunch，非 reload）；G0 smoke 另含两条重启恢复腿（restart-conversations-persisted / restart-recovery-dom）18/18 |
| **再次打开，数据完整** | 重启后：绑定会话仍在侧边栏（`relaunch-missing-degraded` 侧栏在场=true）；`listForProject`=1（绑定持久化，`relaunch-binding-persisted-app-alive`）；徽章按实时状态降级为「项目缺失」+ 降级通告；项目视图存活（列表可渲染）；归档腿历史消息完整可读（`archived-history-readable`：用户消息 + 类型化错误均渲染）；agent-sessions.json 落盘含绑定项目 id（`temp-home-isolation`） |

### 标准 2：归档只读的主进程硬强制（PB-034 硬规则 4）— **PASS**

- `send-blocked-main-level`：归档后 UI 发送 → STREAM_ERROR 含「只读」；**主进程 JSONL 会话日志落盘 `linguist_project_archived` TypedError**；用户消息仍持久化（会话可读语义）。
- `fake-server-no-request`：fake model server 请求数 **= 0**——发送在到达模型前被主进程闸门阻断（agent-orchestrator.ts:1018 preflight），非 UI 层禁用按钮的软约束。
- `archived-chat-list-readonly` / `archived-badge-notice`：项目对话列表可读、新建禁用、只读提示在场；会话头部徽章「已归档」+ 只读通告。
- `archive-via-ipc`：归档经 `linguistProjectsArchive` 真实写入 `archivedAt`。

### 标准 3：静态检查与测试基线 — **PASS**

| 检查 | 实际结果 |
| --- | --- |
| 根 `bun run typecheck` | **9/9 包 exit 0** |
| 根 `bun test` | 提交前 **641 pass / 3 fail**（644 总）：2 条为 PB-003 起既有上游环境限制（agent-session-manager.test.ts「Export named 'BrowserWindow' not found」、channel-runtime-api-key.test.ts「Export named 'shell' not found」，纯 Bun 无法 import electron 命名导出）+ 边界 stale-entry 检查对**未提交**新登记的固有失败（该测试 diff HEAD，登记与代码同票提交前必然 stale，PB-031 同型记录）；**提交后复跑 642 pass / 2 fail**（= PB-033 基线 634 + 新增 8：binding-utils 5 + ipc-contract 3），与基线一致不劣化 |
| `cd apps/electron && bun run test:linguist`（node --test） | **38 pass / 0 fail**（PB-033 基线 27 + 本票 11：session-binding 6 + session-ipc 5） |
| `bun test apps/electron/src/main/lib/linguist/ apps/electron/src/renderer/features/linguist/` | **54 pass / 0 fail**（main 22 = 19+3 契约守卫；renderer 32 = 27+5 绑定纯函数；确认 bun 不拾取 `*.nodetest.ts`） |
| `bun run check:boundaries` | 提交前 2/3（同上固有原因）→ **提交后复跑 3/3** |
| `cd apps/electron && bun run smoke:pack` | OK；产物 grep 证实：renderer 束含「尚无项目对话」与 `linguist-project-badge`，`dist/main.cjs` 含 `linguist.sessions`（6 处）与 `linguist_project_archived`，`dist/preload.cjs` 含 `linguist.sessions`（3 处） |

### 标准 4：四个常驻探针全绿（打包应用真实 UI 驱动）— **PASS**

| 探针（node 运行） | 结果 |
| --- | --- |
| `node scripts/smoke/probe-project-session.ts`（PB-034 新增） | **17 PASS / 0 FAIL**（逐项见 §4） |
| `node scripts/smoke/run-g0-smoke.ts`（G0 回归） | **18 PASS / 0 FAIL**（含重启恢复两腿；G0 既有面零回归） |
| `node scripts/smoke/probe-projects-view.ts`（PB-032 探针 + 本票更新断言） | **13 PASS / 0 FAIL**（Chat tab 选中 + 对话空状态新断言通过） |
| `node scripts/smoke/probe-import.ts`（PB-033 探针回归） | **11 PASS / 0 FAIL** |

## 4. PB-034 探针 17 断言实录（2026-07-26）

```
[PASS] packaged-binary-exists
[PASS] cli-seed — 项目 prj-195e4c7cefb885fd（mini_dialogue.csv=8 段）
[PASS] packaged-launch — 主窗口获取成功，window.electronAPI 就绪
[PASS] seed-channel — channelId=8934f449-1aa6-4694-95ba-6fb3a0da9785
[PASS] detail-chat-tab-real — Chat 标签可选中=true，空状态「尚无项目对话」=true
[PASS] create-project-chat-badge — 徽章可见=true，文案含项目名=true（「PB-034 绑定探针项目」）
[PASS] ipc-binding-cross-check — list=1，status=active，projectName=「PB-034 绑定探针项目」，runtime=pi，meta.linguistProjectId 一致
[PASS] normal-chat-unbound — 普通会话 linguistProjectId 缺省且 getBinding=null
[PASS] archive-via-ipc — linguistProjectsArchive(prj-195e4c7cefb885fd) archivedAt 写入=true
[PASS] archived-chat-list-readonly — 列表可读=true，新建禁用=true，只读提示=true
[PASS] archived-badge-notice — 徽章 archived=true，只读通告=true
[PASS] send-blocked-main-level — STREAM_ERROR 含「只读」=true，JSONL 落盘 linguist_project_archived=true，用户消息持久化=true
[PASS] fake-server-no-request — fake server 请求数=0（=0 证明发送在到达模型前被主进程阻断）
[PASS] archived-history-readable — 历史用户消息渲染=true，类型化错误渲染=true
[PASS] relaunch-missing-degraded — 侧栏会话在场=true，徽章 missing=true，降级通告=true
[PASS] relaunch-binding-persisted-app-alive — listForProject=1=true，status=missing，快照名=「PB-034 绑定探针项目」，project 缺省=true，项目视图存活=true
[PASS] temp-home-isolation — <tmpHome>/.proma/agent-sessions.json 存在且含绑定项目 id=true（未触碰真实 ~/.proma）
=== PB-034 探针结果：17 PASS / 0 FAIL ===   EXIT=0
```

## 5. Hermetic 性质

- 无真实用户数据：四个探针均以 mkdtemp 临时 HOME 启动打包应用，各自的 temp-home-isolation 断言核实数据落在临时 HOME 的 `.proma` 下；真实 `~/.proma` 不被触碰。
- 无网络：模型面为探针内拉起的 `127.0.0.1` fake server（随探针退出）；CLI 无网络调用。（应用 bootstrap 的自动更新检查访问本机打包产物缺失的 app-update.yml 即报错返回，属既有行为，不依赖外网结果。）
- 确定性：项目 id 由 `--seed` 决定；fixture 内容派生 sha 可复现比对。
- 无后台残留：探针 finally 关闭应用；fake server 随探针进程退出。

## 6. 已知限制

1. **macOS Keychain 提示（SecurityAgent，safeStorage）对本机探针不 hermetic**——PB-030/031/032/033 同型记录的延续，与本票代码无关：本轮 G0 与三个探针运行时各出现 1 次，kill 后应用回退明文存储（与基线日志同一语义）流程继续。probe-projects-view 有**两次**失败尝试均由此引起（首次 kill 时机偏晚、「新建项目」对话框未在预算内打开；第二次 `page.reload` 60s 预算被 stall 耗尽），主进程日志无异常；第三次以看门狗即时 kill 后 **13/13 通过**。如实记录，非代码回归。
2. **原生文件选择器不可被 Playwright 驱动**：probe-import 覆盖「到选择器为止」的接线（按钮在场/可用/归档禁用）+ CLI 播种真实数据下的渲染；完整导入流由 node --test（stub picker）覆盖；原生对话框端到端路径需人工 QA（PB-033 已记录）。
3. **绑定创建后无重绑定 API**（刻意）：`updateAgentSessionMeta` 白名单排除 + 运行时强制保持原值；改名只影响新项目（名称快照语义）；项目删除不可撤销 → 绑定会话永久 missing 降级（可读，发送不阻断）。
4. missing 判定需一次廉价 fs 检查（`existsSync` + 解析 `project.json`）——store `getProject` 只读索引，索引缺条目本身不区分「归档」与「目录缺失」；该检查在每次发送 preflight / getBinding 时执行（路径解析 + 小文件读，实测无感知开销）。
5. bun 无 node:sqlite → 服务/处理器/绑定测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，与 PB-030 起同一约束）。
6. 探针只覆盖 Pi runtime 路径（项目对话创建固定 `agentRuntime='pi'`）；Claude runtime 下的绑定会话发送闸门走同一 `checkLinguistSessionSendBlock`（orchestrator 公共 preflight），由 nodetest 覆盖闸门本身。

## 7. G3 结论

门禁唯一硬标准「真实 Electron：创建 Project、导入、重启、再次打开，数据完整」**达成**：打包应用全环实测通过（CLI 播种 + UI 创建/导入 + 真实重启腿 + 重启后绑定/会话/段数据完整再现），归档只读主进程硬强制实测生效（fake server 0 请求），missing 降级与项目视图存活实测通过，全部静态检查与测试基线不劣化（提交后 642/2、boundaries 3/3）。**G3 = GATE PASSED**。
