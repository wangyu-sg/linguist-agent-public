# Linguist Agent 当前交接

更新时间：2026-07-30

## 交付结论

`Linguist_Agent_Optimization_Blueprint_CN.md` 的工程实现已合入 `main`。当前产品仍是：

```text
完整 Proma Agent + Chat
+
Linguist Vertical Agent Profile + CAT Core / Store / Tools / Workbench
```

没有第二套 Agent Runtime、Composer、消息流、Thinking、Tool Card、权限流或 Session Store。

本轮完成的主要切片：

- Agent 与 Linguist 复用同一项目/会话树；Agent 排除项目绑定会话，Linguist 只显示绑定会话，并统一置顶、最近会话、折叠、委派、归档和 MiniMap 行为；
- 项目创建、重命名、活跃排序、归档/删除、只读归档/缺失历史、全局搜索路由与轻量起始页；项目操作菜单同时支持左键和右键，打包 smoke 会验证菜单实际绘制；
- Linguist 的跨项目动作改为“复制到其他项目”：主进程复核 binding、目标健康和 Claude/Pi 分叉资格，失败回滚，成功留在源项目并可打开副本；
- 新会话欢迎页按上下文区分三模式：普通 Agent/Chat 可选 Agent、Chat、Linguist；Linguist Full Agent 不显示错误的模式选择器，绑定会话不会泄漏到 Agent 默认工作区；
- CAT 编辑器在译文未变化时仍可用 `Cmd/Ctrl+Enter` 确认当前阶段并前进；共享 Sheet 的关闭按钮退出 Electron 标题栏拖拽区，项目设置右上角可以直接关闭；
- Linguist 一等 Agent Profile、Rail/Full 同会话 Shell、原生 Session actions 与项目 CWD；
- Profile → Role → Strategy → Project Digest → Turn Context 的版本化 Prompt 组合、降级状态和离线评估集；
- Translation Context、Proposal Snapshot、pass/issues/abstain、Critic→QA 与 QA 事件生命周期；
- CAT Tool 结果投影/原生 UI、15 个 Session-bound 工具、选择/缓存/Undo 预算；
- Job/Checkpoint、幂等 mutation、State Capsule、durable outbox、运行摘要与安全 CAT undo；
- Required/Forbidden hard gate、ICU/placeholder、Consistency plan/apply、批量查询与 QA/Consistency worker；
- Stable ID v2、数据库身份写前校验、schema v13 Proposal Issuance/Provenance；
- 安全导出、trace/metrics/脱敏诊断、Quick Health、worker-thread Full Integrity Scrub；
- staging 原子备份、symlink 拒绝、故障注入、恢复 journal、回滚快照与恢复后复核。

## 当前代码基线

- 分支：`main`
- 本轮实现与安装 HEAD：`730a360e73d68992b6ca1855ab71234c62f86b33`
- 相对 `upstream/main`：ahead 257（本文档提交前快照）
- Bun：`1.3.14`
- Electron App：`0.15.140`
- shared：`0.1.79`
- CAT Core / Store / Tools：`0.0.12` / `0.0.25` / `0.0.17`
- CAT schema：`13`
- 工作树：用户自有的两份 `electron-user-data-path*` 修改保持未暂存；本轮未改写。
- 临时 clean/public worktree 只用于验证与净化镜像，不是交付源。

本文档提交位于上述实现 HEAD 之后；不要把文档提交 hash 当成实现自引用 hash。

## 干净提交态验证

最终矩阵在临时 detached clean worktree 上执行，未读取或写入真实用户数据根：

| 检查 | 结果 |
|---|---|
| frozen install | Bun 1.3.14，exit 0 |
| workspace typecheck | 11 / 11 |
| 根 Bun 测试 | 1,350 pass / 0 fail |
| Architecture boundaries | 4 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist | 175 pass / 0 fail |
| CAT Core | 116 pass / 0 fail |
| CAT Store | 217 pass / 0 fail |
| CAT Tools | 39 pass / 0 fail |
| license scan | 417 个第三方依赖；门禁通过 |
| Electron build | 通过；CAT job 与 integrity scrub worker 均生成 |
| runtime dependency sync | 137 个同步，25 个未安装 optional 合理跳过 |
| smoke:pack | 未签名 macOS arm64 App 打包通过 |
| packaged Agent / Chat / Linguist | 12 / 18 / 20 pass，均 0 fail；Linguist 另有 2 manual |

Packaged vertical 报告：

- `runStatus=passed`
- `coverageStatus=partial`
- `app.asar` SHA-256：`95066d73f003502f9792f6afe302df5b560e199ab0680834581818cfb23e5138`
- Linguist 项目菜单绘制检测：`10,389` 个非背景像素，避免“DOM 已打开但视觉不可见”回归。
- 未改译文的审校段执行 `Cmd+Enter` 后：按钮可用、阶段变为 `confirmed`、译文保持不变、revision 保持 `0 → 0`。
- 项目设置关闭按钮：按钮可见，点击后 Sheet 隐藏。
- 保持 blocked：Agent Stop/Retry packaged UI、Chat→Agent roundtrip、Native Open/Save。

这证明 clean source 可构建、可打包并通过现有自动纵向路径；不等于真实 Provider、全部新功能真机操作或 Release qualification。

## 本机安装

- 本轮起点源码与 `/Applications/Linguist Agent.app` 均为 `0.15.137`，不是旧记录中的 `0.15.134`。
- `/Applications/Linguist Agent.app` 已替换为 clean HEAD 构建的 `0.15.140`。
- 安装版 `app.asar` SHA-256：`95066d73f003502f9792f6afe302df5b560e199ab0680834581818cfb23e5138`，与 packaged vertical 产物一致。
- 安装版先用隔离 userData 启动并确认 1 个主窗口，再按正常用户数据环境重新打开；当前进程健康且有 1 个主窗口。
- 被替换的 `0.15.139` 位于废纸篓 `Linguist Agent 0.15.139 before 730a360e.app`，其 `app.asar` SHA-256 为 `091971f36f6b075d49159fc0b4d6f2cac6683148fa548aefb078eaf6aea32567`，可恢复。
- `/Applications/LinguistAgent.app`（无空格的另一 App）未修改。

## 外部状态

- 共享侧栏/会话复制实现快照：`8660d32fd330d74284db1acb6a82d72b6efb6ec4`；GitHub Actions CI Run `30478305394` 成功。
- 项目菜单修复快照：`14331d30cd61470cc0a47878cf31a7724479cae7`；GitHub Actions CI Run `30480198628` 成功。
- `0.15.140` 完整交互修复快照：`2fe3c472c6bdb80b73d6afbdb8e48c56614ccac5`；GitHub Actions CI Run `30482338219` 成功。
- 三个快照都以当时最新公开 `main` 为父，只含净化后的已提交树；本地施工历史和未提交文件没有进入公开历史，推送均为普通 fast-forward。
- frozen install、typecheck、根/CAT/Electron 测试、boundary、fusion、许可扫描和 Electron build 全部通过，AC-001 已关闭为 `integration_verified`。
- 这是公开源码镜像同步，不是公众安装包 Release。

## 下一步只剩证据

1. 真机 IME、Native Open/Save、VoiceOver、keyboard-only、拖拽/resize；
2. 真实 Provider/模型与真实客户格式样本；
3. Fast / Balanced / Best 真实游戏文本盲评；
4. 14 天连续个人日用。

通用文件撤销继续使用 Proma File Rewind；外部 MCP/程序副作用只记录，不承诺结构化回滚。不要把这些证据缺口解释为需要重写架构。
