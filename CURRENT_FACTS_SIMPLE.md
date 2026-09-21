# Linguist Agent 当前事实

核验日期：2026-09-22。本文是当前动态事实唯一人工入口；代码、manifest、锁文件和真实运行输出优先于文字说明。

## 本次候选

`0.18.0` 的工程回归和独立候选打包验证通过；真实语言验证尚未发出请求，等待本机 Keychain 授权界面恢复。尚未公开发布或替换日用安装。实现与验证状态见 [0.18 记录](./docs/release/VALIDATION_0_18_0.md)。上一公开版本仍为下述 `0.17.75`，不得把其验证结果算到当前候选。

## 机器真源与当前值

依赖版本取自 manifest / bun.lock；Proma 与 Runtime 基线见 [proma-baseline.json](./docs/architecture/proma-baseline.json)。

| 项目 | 当前值 |
|---|---|
| App | `0.18.0` |
| Proma | `v0.19.53` |
| Proma commit | `f99edbdb594407ab190b97ae073889c5d96637ab` |
| Bun / Electron / Pi | `1.3.14` / `43.2.0` / `0.85.1` |
| React / Jotai / Vite | `18.3.1` / `2.20.3` / `6.4.3` |
| Shared | `0.1.72` |
| CAT Core / Formats / Store / Tools | `0.0.26` / `0.0.13` / `0.0.47` / `0.0.41` |
| CAT Schema | `19` |
| CAT Tool Count | `32` |

Proma 基线已正式合并为 `v0.19.53`，双亲合并提交 `56bc3f29`，本地候选分支 `codex/la-upstream-v0.19.53-20260914`，起点 `9f0de928`。App `0.17.74` 已推送并[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.74)，Tag 指向 `d6d0a7ee`。CI `34844497883` 与 Auto Release `34845329153` 成功，macOS arm64/x64、Windows x64 安装包和更新清单共七项资产齐全；未覆盖日用安装。证据见 [上游更新与发布记录](./docs/release/UPSTREAM_0_19_53_2026_09_14.md)。


App `0.17.75` 已[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.75)，源码/Tag 为 `85aa7e5d`，Release run `35094944942` 成功，七项资产核验通过。用户随后授权用正式签名 arm64 包替换本机旧安装，验签及启动通过；自动更新链路未验证。详见 [发布记录](./docs/release/VALIDATION_0_17_75.md)。Shared DTO 为 `0.1.72`，CAT 版本按现有 manifest 校正，本轮未再次递增。

后续修复 `2468e3e2` 已加入原生全选填充、固定只读 DOM probe、Phrase Skill `1.0.6` 与 in-app-browser `1.1.3`，定向 Chromium 回归、类型、边界与构建通过。用户随后授权替换安装：本机现为该提交的 `0.17.75` arm64 修复版，沿用自更新证书，验签、启动与默认 Skill 同步通过；公开 Release 仍为 `85aa7e5d`。真实 Phrase 提速与自动更新链路未验证。见 [效率修复及安装记录](./docs/release/BROWSER_BATCH_FIX_2026_09_16.md)。

工具数由 `LINGUIST_CAT_TOOL_NAMES` 与工厂实际返回集合确认；本轮开始前已是 32，旧文档与优化方案写成 31 属于漏记。CAT 工厂仍为 32 个工具；Linguist Session overlay 另外提供 1 个 `linguist_working_copy` 文件工作副本工具，总计 33 个领域工具。

触点分类、具体理由、上游来源与退役条件只在 [proma-touchpoints.json](./docs/architecture/proma-touchpoints.json) 维护，不在本页复制计数。

## 当前实现

- Linguist 与 Agent 共享原生侧栏项目头、会话树及待办/日历/Obsidian/记忆/Skills/MCP/定时任务入口；关闭组件后回到当前会话的 CAT 或文件。领域侧栏仅提供数据和项目操作。
- 定时任务持久化项目、岗位和明确范围快照；来源删除后保留，跨工作区清除，reuse/daily 按完整绑定校验。只读摘要不创建 Stage；执行结束与业务完成分开显示。
- BrowserAct 在一个 tab 队列内执行至多 64 步、30 秒（含排队）；失败返回成功前缀和未执行范围。正式包携带的 Skill 与后续源码修复版本分开记录；真实 Phrase 保存/TM 与完整富文本操作尚未校准。

- 完整 Proma Agent / Chat + Linguist 第三模式，Pi-only；四岗位 Prompt 真源为 [resources/linguist-roles](./resources/linguist-roles)。岗位身份在已有持久化用户消息后固定，委派子会话固定岗位。
- MCP 桥接保持固定 Proma 合同；browser-controller 在原生队列上增加显式 text/key、实际输入节点检查与有界 steps。源码与固定 Proma 浏览器文件存在已登记差异。
- 项目快捷切换刷新主进程权威列表，无主会话时创建，旧请求不能提交可见状态；同步设置落盘成功后一起切换 Workspace / Session / Agent Tab / 模式。`resetView:false` 保留内部工具页合同。
- Agent Host Extension 与 App Mode Registry 是主要宿主组合入口；其他产品级 Renderer 触点必须逐项登记。
- 产品启动、加载、欢迎页读取同一身份配置，第一章介绍 Agent / Chat / Linguist；FAQ 对照持久化岗位与导出规则。
- CAT 结果自含正文/图片；最终请求经过 Pi SDK 和 utility 边界，以 HTTP 2xx 响应确认提交，旧工具级回执不计新覆盖。跨页正文按 UTF-16 区间累计；图片目录和规则均可继续读取。
- Stage 独立于 Session；范围/相关资料变化和显式重审创建新轮，恢复复用原轮。本轮完成同时要求当前 revision 的本人决定、必要证据覆盖和零阻断；不能借用其他会话或旧任务的资格。
- CAT 缺失/损坏时绑定会话仍可运行通用 Agent；归档只读。普通 General 协作不强制冻结空 CAT 范围，专业委派仍冻结范围。CAS、locked、受管 Source、结构检查与事务继续生效。
- Prompt 合同 `3.1.6`；报告/候选准备可用 `readOnly` Context，不创建或替换专业 Stage；规则按既有分页协议续读。必要术语/冲突不能被可选限额清空，资料不够时明确显示缺口。
- `cat_project_summary({})` 保持原概览；按 `assetId + includeDelivery=true` 才读取只读交付预检和当前会话专业任务摘要。它不运行 QA、不生成导出、不证明 QA 新鲜或 verified export。

## 本次上游更新

- Pi 五项 override 与四项 App 依赖均为 `0.85.1`，重试补丁仅重命名；冻结安装、类型检查、完整回归和构建通过。
- Exa 复用原生凭据与握手入口；DeepSeek Flash 候选默认不启用，共享上下文推断为 1M。用户已有模型 ID 与历史不自动改写。
- 原生 MCP 配置/OAuth、inactive Skill 管理、Copilot 额度、Markdown 多行表格、会话图片与 home 路径以及侧栏层级/滚动边界已合入。
- 本地真实 HTTP 验证 SDK 长缓存请求和重试分类；不等于真实 Provider 或 Exa 连接验证。干净提交 `e8ff739a` 的六步打包验证全部通过：Agent/Chat 各 19 项，CAT 31 项；辅助面板专项 26 项通过。原生 Open/Save 仍为 2 MANUAL，整体资格保持 partial，详见本次记录。

## 已保留的 UI 与批次行为

- CAT 仅在右侧原生工作区挂载；主区使用完整 Agent，会话切换恢复用户原生工作区状态。切换项目激活 CAT；当前项目头保持原生展开/收起行为，从预览返回可用 CAT 标签。预览使用当前宿主 sessionId。
- 修改建议默认当前批次 pending，列表及总数在 SQL 分页前过滤；历史 accepted 的正常 revision 增加不再显示版本冲突。
- QA 列表、数量、下一项和交付默认当前批次；项目历史从项目设置显式进入。TM/TB 与风格资料仍项目共用。
- 项目设置分为项目、批次、语言资产、Tag Profiles、维护与诊断；底部为辅助面板。切换或卸载 CAT 保留进程内草稿与撤销历史。
- 以下为已发布 0.17.73 的历史验证，不能代替当前候选：类型检查、默认回归与真实 Electron 浏览器检查通过；QA 主进程范围测试及 Store 批次分页测试通过。本地及远程六步打包验证通过（CAT 31 PASS / 0 FAIL / 2 MANUAL，辅助面板 26 PASS / 0 FAIL）；远程 CI 与 Release 均成功，macOS arm64/x64、Windows x64 安装包和更新清单齐全，以 [0.17.73 实施记录](./docs/release/VALIDATION_0_17_73.md) 为准。

- macOS 红绿灯窗口按钮有用户报告问题，复现条件与根因尚未核实；按用户要求留到下一轮，见 [TODO](./TODO.md)。

## 已发布版本的历史证据

- 2026-09-06 已将 Proma `v0.19.31`（`7a3721d7`）合并为 `b2c71810`，App 版本为 `0.17.71`；本地 `smoke:pack` 已确认 `esbuild 0.28.1` 及平台二进制进入 `app.asar.unpacked`。GitHub Actions Release run `34011582164` 发布成功，但 2026-09-07 核查确认其中 package-verify 仅输出 Bun 帮助，未执行打包或垂直验证；后续 CI `34012237919` 也存在同样空跑。2026-09-07 修复后的 CI `34078566618` 已真实执行：打包、依赖恢复、Agent、Chat、项目切换通过；Linguist 段落点击被底部面板遮挡，作业正确失败并上传报告与六步日志，该次垂直链路未通过。随后布局修复 `209c2640` 的 CI `34080231269` 已通过；下载 artifact 核验 HEAD 匹配、工作树干净、六步均 passed/exitCode=0 且日志非空，Linguist 为 21 PASS / 0 FAIL / 2 MANUAL。此结果仅覆盖该提交的 macOS arm64 packaged 自动链路，Native Open/Save 仍未验证，也不追溯证明已发布包。公开的 [Linguist Agent 0.17.71 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.71) 已包含 `latest-mac.yml`、`latest.yml`、macOS arm64/x64 DMG/ZIP 和 Windows x64 EXE。此前发布准备见历史 [0.17.70 验证记录](./docs/release/VALIDATION_0_17_70.md)，不得把该包哈希当作本轮结果。
- 默认集合覆盖真实 SQLite、Worker、SDK 转换和本地 HTTP；旧格式合成项目与 Pi 会话通过原译文/参考读取、备份、会话恢复、新轮写回、verified 导出、重导和损坏备份拒绝。上一轮具体命令、数量与边界见 [2026-09-05 实施记录](./docs/release/IMPLEMENTATION_2026_09_05.md)；9 月 6 日定向证据见 [2026-09-06 实施记录](./docs/release/IMPLEMENTATION_2026_09_06.md)。
- 最初原生候选暴露 ESM 加载和 utility 回调克隆两项集成回归，已修正。2026-09-06 本地记录中 `electron:build`、`smoke:pack` 与 `smoke:vertical` 通过，2026-09-07 CI 失败及后续修复复验分别记录如上；垂直证据仍按合同标记 partial，并保留原生 Open/Save 对话框人工阻断，不能把人工项折算为自动通过。
- 模型请求均使用合成资料和本地 Fake Provider；没有测试真实收费 Provider、真实 Keychain、原生 Open/Save 或语言质量。用户安装版保持原状，本轮未检查其哈希。

真实 Provider 四岗位迷你任务、质量对照和人工资格仍见 [TODO](./TODO.md) 与 [已知限制](./docs/release/KNOWN_LIMITATIONS.md)。
