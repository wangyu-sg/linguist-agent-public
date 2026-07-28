# Linguist Fusion 当前事实

> 更新日期：2026-07-29。本文只记录当前私有工作仓库的可验证事实；历史 PB/Gate 报告是证据，不是当前状态真源。

## 1. 可信基线

| 项目 | 当前事实 |
|---|---|
| 工作仓库 | `/Users/<local>/Desktop/linguist-agent-next` |
| 分支 | `main` |
| 最近生产 HEAD | `5ac2b60d2296c7b8fb7ea5221d7d1d1079c097f8` |
| 最近生产提交 | `fix(smoke): follow scoped QA waiver action` |
| 最近隐私护栏提交 | `ac434544 chore(privacy): enforce public identity attribution` |
| 公开净化快照 | `e877a211`（公共 main 的 Proma 历史父提交，不是独立远端分支） |
| 公开 main 合并点 | `b8ce7e0a`（保留旧公共 main 与 Proma 两侧历史） |
| 固定 Proma 基线 | `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df` |
| 相对 `upstream/main` | ahead 219 commits（隐私护栏提交后） |
| worktree | 仅主工作区；Context DOCX 与 UX/Proma calibration 辅助 worktree 已合入或确认等价后删除 |
| 发布范围 | 个人日用 Alpha；公开源码镜像已同步，但没有公众安装包发布计划 |

本文更新发生在最近代码 HEAD 之后，因此最终文档提交 hash 以 `git log -1` 为准；代码基线不做自引用 hash。

## 2. 产品事实

路线已固定为：

```text
完整 Proma Agent + Chat 产品底座
+
Linguist CAT Core / Store / Tools / Workbench
```

这不是“把 Proma 能力删到只剩翻译”。Agent、Chat、Provider、Skills、MCP、Automations、远程桥、Preview、Thinking、权限、Queue / Steer 均继续存在。Linguist 是第三个并列主模式。

### 三模式

- `PrimaryAppMode = 'agent' | 'chat' | 'linguist'`。
- Agent 和 Chat 保持 Proma 原生路径。
- Linguist 使用一等 Localization Project Tab、项目侧栏和 CAT Workbench。
- Workbench 复用原生 `AgentView` rail presentation，没有复制第二套 Composer、消息、Thinking、Tool、权限或 Session Store。

### CAT 主链

当前代码支持：

```text
项目创建
→ 资产导入
→ Session binding / Turn Context
→ 手工编辑或 Agent Proposal
→ 人工接受/拒绝
→ 确定性 QA / Critic / Batch consistency
→ T/E/P 阶段确认
→ 交付预检
→ 受管 source 导出与重新导入验证
→ 备份 / 恢复 / 可恢复删除
```

项目 authority 来自主进程验证后的 Project/Session binding，模型工具没有任意 projectId 写入口。Agent 不能直接提交 Segment，仍受人工确认、revision CAS、locked、Tag 和 QA hard rails 约束。

## 3. 大模块拆分事实

2026-07-29 完成两处行为等价拆分：

| 原模块 | 拆分前 | 当前门面 | 内部模块 |
|---|---:|---:|---|
| `LinguistProjectService` | 2,063 行 | 986 行 | resources 423、quality 386、delivery 305、types/parsers/report |
| CAT Tool Factory | 1,045 行 | 60 行 | project 177、reference 239、QA 134、proposal 447、runtime 95 |

外部调用面保持不变：

- IPC 与测试仍只依赖 `project-service.ts`；
- Pi/Electron 仍只调用 `createLinguistCatTools`；
- 工具名称、顺序、参数、独立审计白名单和 mutation 语义不变；
- 12 个 CAT Tool 的 Session authority 集中在 `tool-runtime.ts`。

## 4. 已完成的 Alpha 工程收口

- Push/PR CI、固定 Bun、根测试零容忍；
- Release build/resource 步骤 fail closed；
- `~/.linguist-agent(-dev)` 独立数据根；
- 「设置 → 模型配置」显式 Provider-only Proma 导入；
- 所有 BrowserWindow 显式 `contextIsolation/sandbox/nodeIntegration/webSecurity`；
- Project binding fail closed 与永久解绑；
- 导出防覆盖原稿和受管目录；
- 1000-turn 首载/补载/跳转修复；
- Agent/CAT/Projects serious/critical Axe 清零；
- 旧 ProjectDetail/CatWorkspace/CatContextRail 日常产品路径退役；
- Context DOCX 真解析、诊断与项目 mutation 刷新。

## 5. 最近验证

在最近代码 HEAD 上已确认：

| 检查 | 结果 |
|---|---|
| 全 workspace typecheck | 11 / 11 workspace，exit 0 |
| 根 Bun 测试 | 1,270 pass / 0 fail |
| 公开身份隐私护栏 | 1 pass / 0 fail；候选树、可达历史和 Git metadata 零命中 |
| 公开镜像净化护栏 | 1 pass / 0 fail；旧 LA 私有路径与真实项目标识零命中 |
| Architecture boundaries | 4 pass / 0 fail；公开路径净化只允许精确占位符替换 |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist nodetest | 143 pass / 0 fail |
| CAT Core + Formats | 246 pass / 0 fail |
| CAT Store / Tools / Legacy Migration nodetest | 139 / 31 / 84，均 0 fail |
| Packaged Agent / Chat / Linguist | 12 / 18 / 17，均 0 fail；Linguist 另有 2 项 manual |
| Project Service 拆分前后 | 同一 143 项行为回归全绿 |
| CAT Tool Factory 拆分前后 | 同一 31 项行为回归全绿 |

`/Applications/Linguist Agent.app` 已安装 `0.15.133`；安装后以临时 HOME
启动，Chat / Agent / Linguist 三模式均可见。完整命令与产物哈希见
`docs/HANDOFF.md`。

## 6. 仍未完成的真实 Gate

以下不得因为代码完成或自动测试通过而写成产品资格通过：

- **LF-048**：真实 macOS IME composition 与 Native Save 防覆盖手工验证；
- **AC-009 / G10 Product Qualification**：VoiceOver、完整键盘路径、拖拽/resize 等人工体验；
- **AC-010 / G8**：真实游戏文本 Fast / Balanced / Best 盲评；
- **AC-011**：14 天个人自由日用与问题回收。

G9 已在 2026-07-27 使用真实旧数据副本复跑通过；不要继续把它写成“等待真实副本”。

## 7. 下一步

最终 build 已安装；既有 `out` App 已正常退出，可再生打包副本也已清理。
从 `/Applications/Linguist Agent.app` 启动 `0.15.133` 并进入 14 天真实项目使用。
期间只收 P0/P1 稳定性、数据安全和高频 UX 问题，不扩格式、OCR、Agent Team、
模型路由或扩展市场。
