# Linguist Agent 当前事实

核验日期：2026-09-05。本文是当前动态事实唯一人工入口；代码、manifest、锁文件和真实运行输出优先于文字说明。

## 机器真源与当前值

依赖版本取自 manifest / bun.lock；Proma 与 Runtime 基线见 [proma-baseline.json](./docs/architecture/proma-baseline.json)。

| 项目 | 当前值 |
|---|---|
| App | `0.17.70` |
| Proma | `v0.19.26` |
| Proma commit | `bbf577a8eb768225fdf1ac49ab9ef07a11413b24` |
| Bun / Electron / Pi | `1.3.14` / `43.2.0` / `0.84.4` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.69` |
| CAT Core / Formats / Store / Tools | `0.0.24` / `0.0.13` / `0.0.43` / `0.0.38` |
| CAT Schema | `19` |
| CAT Tool Count | `32` |

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
- Prompt 合同 `3.1.3`；Digest、Stage 和工具共用完整项目规则。必要术语/冲突不能被可选限额清空，资料不够时明确显示缺口。

## 本轮验证与发布证据

- 本轮是基于起点 `8fe9fe2e` 的本地候选，App 版本保持不变；没有推送、PR、Tag、Release、生产数据迁移或安装替换。此前发布准备见历史 [0.17.70 验证记录](./docs/release/VALIDATION_0_17_70.md)，不得把该包哈希当作本轮结果。
- 默认集合覆盖真实 SQLite、Worker、SDK 转换和本地 HTTP；旧格式合成项目与 Pi 会话通过原译文/参考读取、备份、会话恢复、新轮写回、verified 导出、重导和损坏备份拒绝。具体命令、数量与边界见 [本轮实施记录](./docs/release/IMPLEMENTATION_2026_09_05.md)。
- 最初原生候选暴露 ESM 加载和 utility 回调克隆两项集成回归，已修正。最终 smoke:vertical 通过，实际窗口验证 Agent/Chat、项目切换、绑定 CAT 故障恢复、utility→HTTP→Receipt、导出重导与重启；完整合同仍为 partial。候选哈希和精确结果见本轮实施记录。
- 模型请求均使用合成资料和本地 Fake Provider；没有测试真实收费 Provider、真实 Keychain、原生 Open/Save 或语言质量。用户安装版保持原状，本轮未检查其哈希。

真实 Provider 四岗位迷你任务、质量对照和人工资格仍见 [TODO](./TODO.md) 与 [已知限制](./docs/release/KNOWN_LIMITATIONS.md)。
