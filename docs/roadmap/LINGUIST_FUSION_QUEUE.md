# Linguist Fusion 执行队列

> 机器真源：`linguist-fusion-queue.json`。更新时间：2026-07-29。本文是人读投影；状态冲突时以机器文件和实际测试证据为准。

## 状态纪律

- `unit_verified`：精确行为/类型测试完成。
- `integration_verified`：跨包或构建链验证完成。
- `packaged_verified`：真实打包 App 自动验证完成。
- `real_machine_verified`：人工真机操作完成。
- `gate_blocked`：实现可能已完成，但规定的真实证据尚不齐。

不能把 `unit_verified` 或 `packaged_verified` 自动升级成产品资格通过。

## 当前产品约束

- 产品是完整 Proma Agent + Chat + Linguist CAT Workbench 的个人 Alpha。
- Proma 的 Provider、Skills、MCP、Automations、Bots、Preview、权限、Thinking、Queue / Steer 等能力继续保留。
- Linguist Rail 复用原生 `AgentView`，不得复制 Composer、Message、Thinking、Tool、Approval 或 Session Store。
- Agent 只能创建 Proposal；Segment 提交必须经人工接受、CAS、locked、Tag 与 QA hard rails。
- 当前没有公众发布计划，不以签名、公证或多平台发行阻断个人使用。

## Phase 0：控制面与基线

| ID | 内容 | 状态 |
|---|---|---|
| LF-000 | 注册计划与代码事实基线 | **unit_verified** |
| LF-001 | 打包截图与 happy-path baseline | **packaged_verified** |
| LF-002 | 冻结旧 Project/CAT 产品面 | **unit_verified** |
| LF-003 | Packaged Vertical Smoke | **packaged_verified** |
| LF-004 | Proma touchpoint 与单一 Agent 架构测试 | **unit_verified** |

## Phase 1：三模式与 Project Tab

| ID | 内容 | 状态 |
|---|---|---|
| LF-010~016 | `linguist` 模式、三段切换、一等 Project Tab、恢复/MRU | **unit_verified** |
| LF-017 | Agent/Chat/Linguist 与 Tab Gate | **packaged_verified** |

## Phase 2：Linguist Sidebar

| ID | 内容 | 状态 |
|---|---|---|
| LF-020~025 | 项目缓存、Sidebar、单击编辑、会话、位置恢复、管理入口 | **unit_verified** |
| LF-026 | 导航可发现性与恢复 Gate | **packaged_verified** |

## Phase 3：原生 Proma Agent 嵌入

| ID | 内容 | 状态 |
|---|---|---|
| LF-030~036 | AgentView characterization、rail presentation、项目 Session、嵌入/折叠/完整 Tab、回归 | **unit_verified** |
| LF-037 | Native Agent Reuse Gate | **integration_verified** |

Linguist 没有第二套 Agent UI；完整 Agent Tab 与 Workbench Rail 使用同一 Session 和消息/工具状态。

## Phase 4：手工 CAT Workbench

| ID | 内容 | 状态 |
|---|---|---|
| LF-040~047 | 项目状态、Workbench Shell、资产、虚拟 Grid、TargetEditor、保存/确认、行内状态、键盘语义 | **unit_verified** |
| LF-048 | 无 Agent 手工 CAT 完整 Gate | **gate_blocked** |

LF-048 自动矩阵为 20 pass / 0 fail / 2 manual；真实 macOS IME composition 与 Native Save 防覆盖仍需人工验证。

## Phase 5：Bottom Dock

| ID | 内容 | 状态 |
|---|---|---|
| LF-050~055 | Dock、TM、Terms、QA、Context/Evidence、Preview | **unit_verified** |
| LF-056 | Language Resource Dock Gate | **packaged_verified** |

## Phase 6：Agent ↔ CAT 融合

| ID | 内容 | 状态 |
|---|---|---|
| LF-060~068 | Turn Context、Context Chips、冻结快照、mutation、原生 Tool Renderer、定位、Proposal diff、选中段工作流 | **unit_verified** |
| LF-069 | Agent-CAT Fusion Gate | **packaged_verified** |

## Phase 7：设置与 Legacy UI 收口

| ID | 内容 | 状态 |
|---|---|---|
| LF-070~077 | Project Settings、资源/备份迁入、管理首页、旧 ProjectDetail/CatContextRail/CatWorkspace 日常路径退役 | **unit_verified** |
| LF-078 | Legacy UI Deletion Gate | **gate_blocked** |

架构扫描已确认旧 UI 生产消费者为零；Gate 仍受 LF-048 的两项手工证据约束，不能写成 Passed。

## Phase 8：个人 Alpha 工程收口

| ID | 内容 | 状态 |
|---|---|---|
| AC-001 | Push/PR CI、固定 Bun、根测试零失败 | **integration_verified** |
| AC-002 | Release/build resource fail closed | **integration_verified** |
| AC-003 | `.linguist-agent` 数据根与 Provider-only 导入 | **unit_verified** |
| AC-004 | BrowserWindow 显式安全选项 | **integration_verified** |
| AC-005 | Project Binding fail closed / 永久解绑 | **unit_verified** |
| AC-006 | Export 防覆盖原稿/受管目录 | **unit_verified** |
| AC-007 | 1000-turn 首载/补载/跳转 | **packaged_verified** |
| AC-008 | serious/critical Axe 清零 | **packaged_verified** |
| AC-009 | G10 Product Qualification | **gate_blocked** |
| AC-010 | G8 真实游戏文本盲评 | **gate_blocked** |
| AC-011 | 14 天自由日用 | **gate_blocked** |

## 2026-07-29 稳定化补充

- Context DOCX 真实解析与诊断修复已合入。
- `LinguistProjectService` 从 2,063 行拆为生命周期门面 + resources / quality / delivery / contracts。
- CAT Tool Factory 从 1,045 行拆为 60 行装配器 + project / reference / QA / proposal / runtime。
- 拆分后 Electron Linguist 143/143、CAT Tools 31/31，类型检查均通过。
- 所有辅助 worktree 与对应分支已清理，仅保留 `main`。
- 干净提交 `5ac2b60d` 的 packaged vertical 已通过：Agent 12/12、Chat 18/18、Linguist 17/17；Linguist 另有 2 项原生对话框 manual。
- `0.15.133` 已安装到 `/Applications/Linguist Agent.app`，安装位置隔离启动与三模式检查通过。

## 下一阶段

既有 `out` App 已正常退出且可再生打包副本已清理。从
`/Applications/Linguist Agent.app` 启动已安装的 `0.15.133`，开始 14 天真实项目使用。期间优先记录：

1. 数据安全、崩溃、错绑、导出或不可恢复问题；
2. 高频编辑、Proposal、QA、Context 和 Agent Rail 的 P1 UX；
3. IME、Native Save、VoiceOver 和完整键盘路径证据；
4. 真实游戏文本的 Fast / Balanced / Best 盲评。

暂不增加格式、OCR、多 Agent Team、自动模型路由或 Extension 市场。
