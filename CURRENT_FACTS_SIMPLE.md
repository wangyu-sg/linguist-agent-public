# Linguist Agent 当前事实

核验日期：2026-09-08。本文是当前动态事实唯一人工入口；代码、manifest、锁文件和真实运行输出优先于文字说明。

## 机器真源与当前值

依赖版本取自 manifest / bun.lock；Proma 与 Runtime 基线见 [proma-baseline.json](./docs/architecture/proma-baseline.json)。

| 项目 | 当前值 |
|---|---|
| App | `0.17.71` |
| Proma | `v0.19.37` |
| Proma commit | `a987ec88fcfa05dd2448dc0ccdd9824a4b510dc6` |
| Bun / Electron / Pi | `1.3.14` / `43.2.0` / `0.85.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.3` / `6.4.3` |
| Shared | `0.1.71` |
| CAT Core / Formats / Store / Tools | `0.0.24` / `0.0.13` / `0.0.44` / `0.0.39` |
| CAT Schema | `19` |
| CAT Tool Count | `32` |

当前 worktree 的 Proma 稳定基线已推进到 `v0.19.37`，正式合并为 `4a7cbcec`；LA 保持独立应用版本 `0.17.71`。当前候选位于 `codex/la-audit-upstream-20260908`，尚未发布或替换本机安装版。

工具数由 `LINGUIST_CAT_TOOL_NAMES` 与工厂实际返回集合确认；本轮开始前已是 32，旧文档与优化方案写成 31 属于漏记。本轮没有新增或删除 CAT 工具。

触点分类、具体理由、上游来源与退役条件只在 [proma-touchpoints.json](./docs/architecture/proma-touchpoints.json) 维护，不在本页复制计数。

## 当前实现

- 完整 Proma Agent / Chat + Linguist 第三模式，Pi-only；四岗位 Prompt 真源为 [resources/linguist-roles](./resources/linguist-roles)。岗位身份在已有持久化用户消息后固定，委派子会话固定岗位。
- MCP 桥接和 browser-controller 与固定 Proma 文件逐字一致；其余未获得等价证据的原生生命周期与安全修复保留。
- 项目快捷切换刷新主进程权威列表，无主会话时创建，旧请求不能提交可见状态；同步设置落盘成功后一起切换 Workspace / Session / Agent Tab / 模式。`resetView:false` 保留内部工具页合同。
- Agent Host Extension 与 App Mode Registry 是主要宿主组合入口；其他产品级 Renderer 触点必须逐项登记。
- 产品启动、加载、欢迎页读取同一身份配置，第一章介绍 Agent / Chat / Linguist；FAQ 对照持久化岗位与导出规则。
- CAT 结果自含正文/图片；最终请求经过 Pi SDK 和 utility 边界，以 HTTP 2xx 响应确认提交，旧工具级回执不计新覆盖。跨页正文按 UTF-16 区间累计；图片目录和规则均可继续读取。
- Stage 独立于 Session；范围/相关资料变化和显式重审创建新轮，恢复复用原轮。本轮完成同时要求当前 revision 的本人决定、必要证据覆盖和零阻断；不能借用其他会话或旧任务的资格。
- CAT 缺失/损坏时绑定会话仍可运行通用 Agent；归档只读。普通 General 协作不强制冻结空 CAT 范围，专业委派仍冻结范围。CAS、locked、受管 Source、结构检查与事务继续生效。
- Prompt 合同 `3.1.4`；报告/候选准备可用 `readOnly` Context，不创建或替换专业 Stage；规则按既有分页协议续读。必要术语/冲突不能被可选限额清空，资料不够时明确显示缺口。
- `cat_project_summary({})` 保持原概览；按 `assetId + includeDelivery=true` 才读取只读交付预检和当前会话专业任务摘要。它不运行 QA、不生成导出、不证明 QA 新鲜或 verified export。

## 本轮审查与验证

全仓库覆盖范围、已复现问题、优化顺序、红绿回归与最终验证结果见 [2026-09-08 全仓库审查](./docs/release/REPOSITORY_AUDIT_2026_09_08.md)。本轮默认回归、浏览器行为检查、全仓类型检查、接缝、架构与 Electron build 已通过；最终候选的打包验证正在执行，完成结果以该记录为准。

## 已发布版本的历史证据

- 本轮已将 Proma `v0.19.31`（`7a3721d7`）合并为 `b2c71810`，App 版本为 `0.17.71`；本地 `smoke:pack` 已确认 `esbuild 0.28.1` 及平台二进制进入 `app.asar.unpacked`。GitHub Actions Release run `34011582164` 发布成功，但 2026-09-07 核查确认其中 package-verify 仅输出 Bun 帮助，未执行打包或垂直验证；后续 CI `34012237919` 也存在同样空跑。2026-09-07 修复后的 CI `34078566618` 已真实执行：打包、依赖恢复、Agent、Chat、项目切换通过；Linguist 段落点击被底部面板遮挡，作业正确失败并上传报告与六步日志，该次垂直链路未通过。随后布局修复 `209c2640` 的 CI `34080231269` 已通过；下载 artifact 核验 HEAD 匹配、工作树干净、六步均 passed/exitCode=0 且日志非空，Linguist 为 21 PASS / 0 FAIL / 2 MANUAL。此结果仅覆盖该提交的 macOS arm64 packaged 自动链路，Native Open/Save 仍未验证，也不追溯证明已发布包。公开的 [Linguist Agent 0.17.71 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.71) 已包含 `latest-mac.yml`、`latest.yml`、macOS arm64/x64 DMG/ZIP 和 Windows x64 EXE。此前发布准备见历史 [0.17.70 验证记录](./docs/release/VALIDATION_0_17_70.md)，不得把该包哈希当作本轮结果。
- 默认集合覆盖真实 SQLite、Worker、SDK 转换和本地 HTTP；旧格式合成项目与 Pi 会话通过原译文/参考读取、备份、会话恢复、新轮写回、verified 导出、重导和损坏备份拒绝。上一轮具体命令、数量与边界见 [2026-09-05 实施记录](./docs/release/IMPLEMENTATION_2026_09_05.md)；本轮定向证据见 [2026-09-06 实施记录](./docs/release/IMPLEMENTATION_2026_09_06.md)。
- 最初原生候选暴露 ESM 加载和 utility 回调克隆两项集成回归，已修正。2026-09-06 本地记录中 `electron:build`、`smoke:pack` 与 `smoke:vertical` 通过，2026-09-07 CI 失败及后续修复复验分别记录如上；垂直证据仍按合同标记 partial，并保留原生 Open/Save 对话框人工阻断，不能把人工项折算为自动通过。
- 模型请求均使用合成资料和本地 Fake Provider；没有测试真实收费 Provider、真实 Keychain、原生 Open/Save 或语言质量。用户安装版保持原状，本轮未检查其哈希。

真实 Provider 四岗位迷你任务、质量对照和人工资格仍见 [TODO](./TODO.md) 与 [已知限制](./docs/release/KNOWN_LIMITATIONS.md)。
