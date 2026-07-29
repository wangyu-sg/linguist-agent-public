# Linguist Fusion 当前事实

> 更新日期：2026-07-29。代码、manifest、测试和真实运行输出优先于历史报告。

## 1. 可信基线

| 项目 | 当前事实 |
|---|---|
| 工作仓库 | `/Users/<local>/Desktop/linguist-agent-next` |
| 分支 | `main` |
| 实现与首轮文档 HEAD | `06ab894643253f64ce79deac45a293cd5d610b2b` |
| 固定 Proma 基线 | `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df` |
| 相对 `upstream/main` | ahead 242（安装文档提交前快照） |
| Bun | `1.3.14` |
| Electron App | `0.15.137` |
| shared | `0.1.78` |
| CAT Core / Store / Tools | `0.0.12` / `0.0.24` / `0.0.17` |
| CAT schema | `13` |
| worktree | 主工作区保留两份用户自有 `electron-user-data-path*` 修改；辅助 Codex worktree 仍在 |
| 发布范围 | 个人日用 Alpha；用户已授权公开源码同步，尚未制作公众 Release |

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
| 根 Bun 测试 | 1,320 pass / 0 fail |
| Architecture boundaries | 4 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist | 164 pass / 0 fail |
| CAT Core / Store / Tools | 116 / 209 / 39，均 0 fail |
| license scan | 417 个第三方依赖，门禁通过 |
| build / runtime sync | 通过；137 个 runtime 依赖同步 |
| smoke:pack | 未签名 macOS arm64 打包通过 |
| packaged Agent / Chat / Linguist | 12 / 18 / 17，均 0 fail；Linguist 另有 2 manual |

Packaged vertical 的 `runStatus=passed`、`coverageStatus=partial`。自动覆盖仍缺 Agent Stop/Retry packaged UI、Chat→Agent roundtrip 与 Native Open/Save，不能升级成完整产品资格。

## 6. 安装与外部状态

- `/Applications/Linguist Agent.app` 已替换为 clean HEAD 构建的 `0.15.137`；安装版 `app.asar` SHA-256 为 `f32b15263a962d1777cd8663aee89323ae65374796611a01270a74dad8aa6c9f`。
- 安装后使用隔离 HOME / userData 启动成功并确认 1 个窗口，随后已按真实数据环境重新打开；旧 `0.15.134` 在废纸篓中可恢复。
- 最近核对的公开仓 Actions Run `30408252952` 仍失败于 SDK Linux 平台包许可 allowlist。
- 本地修复、Actions Node 24 pin、许可扫描和完整矩阵均通过；用户已授权同步，但在真实 push/Run 完成前远端 CI 仍不能写成已绿。

## 7. 仍未完成的真实 Gate

- LF-048：真实 macOS IME composition 与 Native Open/Save；
- AC-009：VoiceOver、完整 keyboard-only、拖拽/resize；
- AC-010：真实游戏文本 Fast / Balanced / Best 盲评；
- AC-011：14 天连续个人日用；
- 真实 Provider/模型与代表性客户格式样本。

G9 的真实旧数据副本复跑已经通过，不得重新写成 pending。上述缺口是外部/人工证据，不是工程实现未落地。
