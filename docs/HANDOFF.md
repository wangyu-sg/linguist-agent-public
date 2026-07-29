# Linguist Agent 当前交接

更新时间：2026-07-29

## 交付结论

`Linguist_Agent_Optimization_Blueprint_CN.md` 的工程实现已合入 `main`。当前产品仍是：

```text
完整 Proma Agent + Chat
+
Linguist Vertical Agent Profile + CAT Core / Store / Tools / Workbench
```

没有第二套 Agent Runtime、Composer、消息流、Thinking、Tool Card、权限流或 Session Store。

本轮完成的主要切片：

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
- 实现、安装与首轮文档 HEAD：`cd33ccf5210646fd37095e9e8e69787901831c37`
- 相对 `upstream/main`：ahead 243（远端结果文档提交前快照）
- Bun：`1.3.14`
- Electron App：`0.15.137`
- shared：`0.1.78`
- CAT Core / Store / Tools：`0.0.12` / `0.0.24` / `0.0.17`
- CAT schema：`13`
- 工作树：用户自有的两份 `electron-user-data-path*` 修改保持未暂存；本轮未改写。
- 辅助 Codex worktree 仍保留，主线所需提交均已 cherry-pick。

本文档提交位于上述实现 HEAD 之后；不要把文档提交 hash 当成实现自引用 hash。

## 干净提交态验证

最终矩阵在临时 detached clean worktree 上执行，未读取或写入真实用户数据根：

| 检查 | 结果 |
|---|---|
| frozen install | Bun 1.3.14，exit 0 |
| workspace typecheck | 11 / 11 |
| 根 Bun 测试 | 1,320 pass / 0 fail |
| Architecture boundaries | 4 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist | 164 pass / 0 fail |
| CAT Core | 116 pass / 0 fail |
| CAT Store | 209 pass / 0 fail |
| CAT Tools | 39 pass / 0 fail |
| license scan | 417 个第三方依赖；门禁通过 |
| Electron build | 通过；CAT job 与 integrity scrub worker 均生成 |
| runtime dependency sync | 137 个同步，25 个未安装 optional 合理跳过 |
| smoke:pack | 未签名 macOS arm64 App 打包通过 |
| packaged Agent / Chat / Linguist | 12 / 18 / 17 pass，均 0 fail；Linguist 另有 2 manual |

Packaged vertical 报告：

- `runStatus=passed`
- `coverageStatus=partial`
- `app.asar` SHA-256：`f32b15263a962d1777cd8663aee89323ae65374796611a01270a74dad8aa6c9f`
- 保持 blocked：Agent Stop/Retry packaged UI、Chat→Agent roundtrip、Native Open/Save。

这证明 clean source 可构建、可打包并通过现有自动纵向路径；不等于真实 Provider、全部新功能真机操作或 Release qualification。

## 本机安装

- `/Applications/Linguist Agent.app` 已由 `0.15.134` 替换为 clean HEAD 构建的 `0.15.137`。
- 安装版 `app.asar` SHA-256：`f32b15263a962d1777cd8663aee89323ae65374796611a01270a74dad8aa6c9f`，与 packaged vertical 产物一致。
- 安装后使用隔离 HOME / userData 启动成功，确认 1 个主窗口后退出；随后已按真实数据环境重新打开。
- 旧 `0.15.134` 位于废纸篓 `Linguist Agent 0.15.134 before 06ab8946.app`，可恢复。
- `/Applications/LinguistAgent.app`（无空格的另一 App）未修改。

## 外部状态

- 公开源码实现快照：`origin/main` 的 `9ed5e8dd113a06cde0e04ac5fae884303ebfad83`。
- 该快照以旧公开 `main` 为父，只含净化后的已提交树；本地 243 个施工提交和未提交文件没有进入公开历史。
- GitHub Actions CI Run `30450830504`：`success`；validate job 1m49s。
- frozen install、typecheck、根/CAT/Electron 测试、boundary、fusion、许可扫描和 Electron build 全部通过，AC-001 已关闭为 `integration_verified`。
- 这是公开源码镜像同步，不是公众安装包 Release。

## 下一步只剩证据

1. 真机 IME、Native Open/Save、VoiceOver、keyboard-only、拖拽/resize；
2. 真实 Provider/模型与真实客户格式样本；
3. Fast / Balanced / Best 真实游戏文本盲评；
4. 14 天连续个人日用。

通用文件撤销继续使用 Proma File Rewind；外部 MCP/程序副作用只记录，不承诺结构化回滚。不要把这些证据缺口解释为需要重写架构。
