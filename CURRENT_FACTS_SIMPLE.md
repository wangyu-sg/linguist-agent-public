# Linguist Agent 当前事实

核验日期：2026-09-04。本文是当前动态事实唯一人工入口；代码、manifest、锁文件和真实运行输出优先于文字说明。

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
| CAT Core / Formats / Store / Tools | `0.0.23` / `0.0.13` / `0.0.42` / `0.0.37` |
| CAT Schema | `19` |
| CAT Tool Count | `32` |

工具数由 `LINGUIST_CAT_TOOL_NAMES` 与工厂实际返回集合确认；本轮开始前已是 32，旧文档与优化方案写成 31 属于漏记。本轮没有新增或删除 CAT 工具。

触点分类、具体理由、上游来源与退役条件只在 [proma-touchpoints.json](./docs/architecture/proma-touchpoints.json) 维护，不在本页复制计数。

## 当前实现

- 完整 Proma Agent / Chat + Linguist 第三模式，Pi-only；四岗位 Prompt 真源为 [resources/linguist-roles](./resources/linguist-roles)。岗位身份在已有持久化用户消息后固定，委派子会话固定岗位。
- MCP 桥接与固定 Proma 文件逐字一致；未获得等价证据的原生生命周期、安全和浏览器修复继续保留为临时偏差。
- 项目快捷切换刷新主进程权威列表，无主会话时创建，旧请求不能提交可见状态；同步设置落盘成功后一起切换 Workspace / Session / Agent Tab / 模式。`resetView:false` 保留内部工具页合同。
- Agent Host Extension 与 App Mode Registry 是主要宿主组合入口；其他产品级 Renderer 触点必须逐项登记。
- 产品启动、加载、欢迎页读取同一身份配置，第一章介绍 Agent / Chat / Linguist；FAQ 对照持久化岗位与导出规则。
- CAT 双绑定、冻结范围、CAS、locked、结构门禁与 Store 合同未变；普通 Agent 不获得 CAT 写权限。

## 本轮验证与发布证据

- 已运行的本地关键测试与类型检查通过，0 failure；包括根 `test`、MCP loopback、项目切换 Store 回归、身份合同、boundary、fusion、Host Seam、sync replay。未将本地结果写成当前远程 CI 结论，精确数量以运行日志为准。
- 最终目录包 `smoke:pack`、artifact 完整性和完整 `smoke:vertical` 执行通过；隔离实际窗口验证 Agent / Chat、项目切换、绑定会话与右侧 CAT、QA、导出重导和重启恢复。模型请求使用本地假模型；原生 Open/Save 保持 MANUAL，不能把执行通过写成完整合同覆盖。
- 目录包 Info.plist 的 App 版本、产品名和 App ID 与配置一致；ASAR 哈希、独立提交和精确文件清单见 [本周期验证记录](./docs/release/VALIDATION_0_17_70.md)。
- 首次临时 HOME 启动出现 Keychain 阻塞；无真实凭据截图使用仓库已有 smoke 配置，不证明真实密钥存储通过。
- 已通过 GitHub API 核实 [v0.17.69 公开 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.69) 非 draft，含安装包和更新元数据。未修改本机安装版，未验证其当前哈希或自动升级链。
- 本周期新版本已完成代码与发布准备，真实 Provider 门禁未完成，尚未发布；发布产物主要用于作者本人安装与自动更新，不承诺公众支持或跨平台资格。

真实 Provider 四岗位迷你全链尚未取得测试配置与运行证据。语言质量对照、真实平台互操作和人工可用性见 [TODO](./TODO.md) 与 [已知限制](./docs/release/KNOWN_LIMITATIONS.md)；不得用自动探针补记。
