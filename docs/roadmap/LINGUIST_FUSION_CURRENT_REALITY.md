# Linguist Fusion 当前事实

> 更新日期：2026-07-30。代码、manifest、测试和真实运行输出优先于历史报告。

## 1. 可信基线

| 项目 | 当前事实 |
|---|---|
| 工作仓库 | `/Users/<local>/Desktop/linguist-agent-next` |
| 分支 | `main` |
| 本轮实现与安装 HEAD | `730a360e73d68992b6ca1855ab71234c62f86b33` |
| 固定 Proma 基线 | `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df` |
| 相对 `upstream/main` | ahead 257（本文档提交前快照） |
| Bun | `1.3.14` |
| Electron App | `0.15.140` |
| shared | `0.1.79` |
| CAT Core / Store / Tools | `0.0.12` / `0.0.25` / `0.0.17` |
| CAT schema | `13` |
| worktree | 主工作区只保留两份用户自有 `electron-user-data-path*` 修改未暂存；临时验证 worktree 不作为交付源 |
| 公开源码镜像 | 完整交互修复 `2fe3c472c6bdb80b73d6afbdb8e48c56614ccac5`；此前实现 `8660d32f`、菜单修复 `14331d30` |
| 发布范围 | 个人日用 Alpha；公开源码已同步，未制作公众安装包 Release |

本文档提交发生在实现 HEAD 之后，因此不尝试记录自引用的最终文档 commit。

## 2. 产品与架构事实

路线固定为：

```text
完整 Proma Agent + Chat 产品底座
+
Linguist Vertical Agent Profile + CAT Core / Store / Tools / Workbench
```

- `PrimaryAppMode = 'agent' | 'chat' | 'linguist'`。
- Agent / Chat 保持 Proma 原生能力；Linguist 是第三个并列主模式。
- Agent 与 Linguist 复用同一项目/会话树组件；Agent 排除带 `linguistProjectId` 的会话，Linguist 只显示项目绑定会话。
- Linguist 项目行支持创建会话、重命名、设置、归档、活跃顺序拖拽；统一归档入口覆盖会话、项目与缺失项目历史，受限状态下所有写操作 fail closed。
- Linguist 跨项目操作是复制而非迁移。主进程重新验证源 binding、目标项目和 Claude/Pi 原生分叉资格，失败回滚，副本不携带工作区文件、附件、委派、自动化或运行状态。
- 普通新会话可在 Agent、Chat、Linguist 间选择；Linguist Full Agent 不显示错误的 Agent/Chat 选择器，项目绑定会话不会恢复到 Agent 默认工作区。
- CAT 编辑器的 `Cmd/Ctrl+Enter` 可在译文未变化时确认当前阶段并前进；共享 Sheet 关闭按钮位于 Electron 非拖拽区，项目设置可直接关闭。
- Workbench Rail 与 Full Agent 复用同一个 `AgentView`、Session、消息、Thinking、工具、权限和 Store。
- Linguist Profile 在各 Runtime 的 Proma Base 上叠加 Profile、Role、Strategy、Project Digest 与冻结 Turn Context；缺层时显式 degraded，不静默退化成普通 Agent。
- 项目 Session 使用受管项目 CWD，Session actions 与实体类型 authority 在主进程校验。

## 3. CAT 与数据事实

当前主链：

```text
项目/资产
→ Session binding + Turn Context
→ 人工编辑或 Agent Proposal
→ Proposal Snapshot / Critic / 人工审核
→ QA / Consistency / 阶段确认
→ 运行摘要与可恢复变更
→ 交付预检
→ 安全导出与重新导入验证
→ Quick Health / Full Scrub / Backup / Restore
```

- 15 个 CAT Tool 的项目 authority 只来自 Session binding；renderer/模型不能提交任意路径或任意 projectId authority。
- Proposal 内容与 `proposal_issuances` 分离。v13 保存 Provider、Model、Runtime、Profile/Prompt/Digest hash、Turn Context、Toolset 等可审计 provenance，不保存隐藏思维。
- Segment 写入仍经人工操作、revision CAS、locked、Tag/Placeholder/ICU、Required/Forbidden 与 QA hard rails。
- QA 使用 Finding + occurrence + status event；Critic 是 advisory，不能直接提交 Segment。
- Stable ID v2 使用带版本和长度前缀的 SHA-256 tuple，保留 v1 读取兼容。
- 数据库在任何 migration 写入前验证 application_id、user_version、schema_migrations 与 `project.json` identity；未知数据库 fail closed。
- Job/Checkpoint、幂等 mutation、State Capsule、durable outbox 和 run changes 支持断点恢复与按运行 CAT undo。
- 通用文件走 Proma File Rewind；外部 MCP/程序副作用只记录。

## 4. 稳定性、性能与隐私事实

- QA / Consistency 与 Full Integrity Scrub 使用真实 worker thread。
- Quick Health 只做 DB/manifest/schema 与最多 20 个 source 的有界检查，UI 不再称为完整扫描。
- Full Scrub 检查全部 source/blob digest、SQLite integrity/FK/orphan、Proposal/Issuance/QA/Review、event/job/run、export 和 Session workspace；不可验证项结构化标记 unavailable。
- Backup 使用同目录 staging、完整验证、原子 rename 和 symlink 拒绝；Restore 使用 journal、预恢复快照、安装后复核和失败回滚。
- Export/诊断使用受管目录围栏、symlink/TOCTOU 防护、写后 digest 验证和默认脱敏。
- 批量 IPC、cursor/字节预算、listWithDiffs、有限缓存与 TargetEditor Undo 字符预算已落地。
- Prompt 版本/hash、tool composition hash、trace chain 和结构化 metrics 可诊断；不会自动上传客户文本、绝对路径、密钥或隐藏推理。

## 5. 干净提交态验证

最终矩阵在临时 detached clean worktree 上完成：

| 检查 | 结果 |
|---|---|
| frozen install | Bun 1.3.14，exit 0 |
| workspace typecheck | 11 / 11 |
| 根 Bun 测试 | 1,350 pass / 0 fail |
| Architecture boundaries | 4 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist | 175 pass / 0 fail |
| CAT Core / Store / Tools | 116 / 217 / 39，均 0 fail |
| license scan | 417 个第三方依赖，门禁通过 |
| build / runtime sync | 通过；137 个 runtime 依赖同步 |
| smoke:pack | 未签名 macOS arm64 打包通过 |
| packaged Agent / Chat / Linguist | 12 / 18 / 20，均 0 fail；Linguist 另有 2 manual |

Packaged vertical 的 `runStatus=passed`、`coverageStatus=partial`，`app.asar` SHA-256 为 `95066d73f003502f9792f6afe302df5b560e199ab0680834581818cfb23e5138`。项目菜单通过 `10,389` 个非背景像素的绘制检测；未改译文的审校段执行 `Cmd+Enter` 后阶段变为 `confirmed` 且 revision 保持 `0 → 0`；项目设置关闭按钮点击后 Sheet 隐藏。自动覆盖仍缺 Agent Stop/Retry packaged UI、Chat→Agent roundtrip 与 Native Open/Save，不能升级成完整产品资格。

## 6. 安装与外部状态

- 本轮起点源码与 `/Applications/Linguist Agent.app` 均为 `0.15.137`；旧文档中的 `0.15.134` 不是本轮起点事实。
- `/Applications/Linguist Agent.app` 已替换为 clean HEAD 构建的 `0.15.140`；安装版 `app.asar` SHA-256 为 `95066d73f003502f9792f6afe302df5b560e199ab0680834581818cfb23e5138`，与 packaged 产物一致。
- 安装版先隔离启动、再按正常用户数据环境重新打开，均确认 1 个主窗口。被替换的 `0.15.139` 在废纸篓 `Linguist Agent 0.15.139 before 730a360e.app` 中可恢复；`/Applications/LinguistAgent.app` 未修改。
- 公开完整交互修复快照 `2fe3c472c6bdb80b73d6afbdb8e48c56614ccac5` 已普通 fast-forward 到 `origin/main`，没有强推。
- GitHub Actions CI Run `30482338219` 成功；frozen install、typecheck、根/CAT/Electron 测试、boundary、fusion、许可扫描和 Electron build 全绿。
- AC-001 已升级为 `integration_verified`。公开源码 CI 绿色不等于签名安装包、人工产品资格或 Release qualification。

## 7. 仍未完成的真实 Gate

- LF-048：真实 macOS IME composition 与 Native Open/Save；
- AC-009：VoiceOver、完整 keyboard-only、拖拽/resize；
- AC-010：真实游戏文本 Fast / Balanced / Best 盲评；
- AC-011：14 天连续个人日用；
- 真实 Provider/模型与代表性客户格式样本。

G9 的真实旧数据副本复跑已经通过，不得重新写成 pending。上述缺口是外部/人工证据，不是工程实现未落地。
