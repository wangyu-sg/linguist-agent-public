# Linguist Agent 当前事实

核验日期：2026-09-23。本文是当前动态事实唯一人工入口；代码、manifest、锁文件和真实运行输出优先于文字说明。

## 当前发布与上一版本

`0.18.2` 已于 `2026-09-23T07:22:48Z`（北京时间 15:22:48）[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.18.2)，为 latest，非草稿、非预发布；源码/Tag 为 `a7679a5df7de8ecdad934f880c802ab92f118207`。提前移植 [Proma #2085](https://github.com/proma-ai/Proma/pull/2085) 的 GPT-6 Sol/Luna 支持与 Pi `0.87.1`，默认 Release 仅构建 macOS arm64；Proma 稳定源码基线仍为 `v0.19.57`。main CI `35830019276` 的类型、测试、边界、许可、构建与 arm64 打包纵向验证通过，Auto Release `35830663733` 成功。公开资产为 arm64 DMG、ZIP 和 `latest-mac.yml`；下载的 ZIP 大小与 SHA-512 匹配清单，解压后应用在宿主权限下通过深度严格签名验证，签名身份与已安装的 `0.18.1` 一致。真实 Codex 账号调用与用户执行的在线更新安装尚未验证。

上一已发布版本 `0.18.1` 于 `2026-09-22T14:35:44Z` [公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.18.1)，源码/Tag 为 `c85c7d8e206737adf92340001290f0bdf0a70620`。该版合入 Proma `v0.19.57` 与 Pi `0.86.1`，完成三模式界面和会话/右侧工作区状态修复。main CI `35739485354`、Auto Release `35740252627` 成功；用户随后授权替换日用安装，正式 arm64 包已安装并启动，点击检查更新显示“已是最新版本”。详见 [0.18.1 实施与发布验证](./docs/release/VALIDATION_0_18_1.md)。

替换前的日用 `0.17.75` 本地修复包缺少 `Contents/Resources/app-update.yml`；真实 updater 读取该安装配置复现 `ENOENT`，发生在网络请求与签名检查之前。正式 `0.18.0` 包配置正常。本轮经用户明确授权，以正式 `0.18.1` 包替换并备份旧应用，恢复更新检查；项目和会话保留。

再上一已发布版本：`0.18.0` 已[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.18.0)，源码/Tag 为 `a7c80c20`。main CI `35699307235` 与 Auto Release `35700030085` 成功，七项资产、更新文件哈希、两架构 macOS 签名及旧证书兼容性核验通过。正式 arm64 包隔离三模式验证通过；42 个独立语言小样及 6 次接续完成模型辅助评价。日用安装未替换，在线更新端到端未验证。详见 [0.18 记录](./docs/release/VALIDATION_0_18_0.md)，以下旧版本内容保留历史范围。

## 机器真源与当前值

依赖版本取自 manifest / bun.lock；Proma 与 Runtime 基线见 [proma-baseline.json](./docs/architecture/proma-baseline.json)。

| 项目 | 当前值 |
|---|---|
| App | `0.18.2` |
| Proma | `v0.19.57` |
| Proma commit | `4e96c5e859302c4a34618d45db352b29a7ebeb28` |
| Bun / Electron / Pi | `1.3.14` / `43.2.0` / `0.87.1` |
| React / Jotai / Vite | `18.3.1` / `2.20.3` / `6.4.3` |
| Shared | `0.1.73` |
| CAT Core / Formats / Store / Tools | `0.0.26` / `0.0.13` / `0.0.47` / `0.0.41` |
| CAT Schema | `19` |
| CAT Tool Count | `32` |

上一正式基线为 `v0.19.53`，双亲合并提交 `56bc3f29`，本地候选分支 `codex/la-upstream-v0.19.53-20260914`，起点 `9f0de928`。App `0.17.74` 已推送并[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.74)，Tag 指向 `d6d0a7ee`。CI `34844497883` 与 Auto Release `34845329153` 成功，macOS arm64/x64、Windows x64 安装包和更新清单共七项资产齐全；未覆盖日用安装。证据见 [上游更新与发布记录](./docs/release/UPSTREAM_0_19_53_2026_09_14.md)。


App `0.17.75` 已[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.75)，源码/Tag 为 `85aa7e5d`，Release run `35094944942` 成功，七项资产核验通过。用户随后授权用正式签名 arm64 包替换本机旧安装，验签及启动通过；自动更新链路未验证。详见 [发布记录](./docs/release/VALIDATION_0_17_75.md)。Shared DTO 为 `0.1.72`，CAT 版本按现有 manifest 校正，本轮未再次递增。

后续修复 `2468e3e2` 已加入原生全选填充、固定只读 DOM probe、Phrase Skill `1.0.6` 与 in-app-browser `1.1.3`，定向 Chromium 回归、类型、边界与构建通过。用户随后授权替换安装：本机现为该提交的 `0.17.75` arm64 修复版，沿用自更新证书，验签、启动与默认 Skill 同步通过；当时公开 Release 仍为 `85aa7e5d`。真实 Phrase 提速与自动更新链路未验证。见 [效率修复及安装记录](./docs/release/BROWSER_BATCH_FIX_2026_09_16.md)。

工具数由 `LINGUIST_CAT_TOOL_NAMES` 与工厂实际返回集合确认；本轮开始前已是 32，旧文档与优化方案写成 31 属于漏记。CAT 工厂仍为 32 个工具；Linguist Session overlay 另外提供 1 个 `linguist_working_copy` 文件工作副本工具，总计 33 个领域工具。

触点分类、具体理由、上游来源与退役条件只在 [proma-touchpoints.json](./docs/architecture/proma-touchpoints.json) 维护，不在本页复制计数。

## 当前实现

- Linguist 与 Agent 共享原生侧栏项目头、会话树及待办/日历/Obsidian/记忆/Skills/MCP/定时任务入口；右区沿用原生打开、关闭、最近访问和分屏逻辑，CAT 作为一项内容。领域侧栏仅提供数据和项目操作。
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

## 本次上游更新与界面收敛

- 源码基线为公开 Proma `v0.19.57`，Pi Runtime 升至 `0.86.1`。正式上游合并提交为 `b9417191`，候选收口提交为 `397a474f`，发布源码为 `c85c7d8e`；机读基线已记录上游合并身份，历史 `v0.19.53` 合并证据保留原范围。
- Linguist 与通用 Agent 共用的顶栏、消息、输入框和右侧工作区恢复原生布局与交互；Chat 保留 Proma 原生 Chat 路径，三模式的共享外壳与导航按上游恢复。保留 CAT 内容、项目身份与授权接缝。窄窗中的项目/岗位徽标限制在可用空间内，不挤掉标题及右区展开按钮。
- 修复最近访问顺序、旧异步项目导航抢焦点、Linguist 右区收起状态恢复、项目设置入口、同名受管预览覆盖和项目改名显示。新任务继续保留项目/岗位，同会话重试复用原轮次 CAT 范围。
- 终端事件由现有全局监听器收集，切到 Chat 或规划页仍保留后台终端；收起的子任务内容不再被误记为已查看。上述两项上游也存在，不归因为 LA 独立实现。
- Pi 使用原生轮末消息队列激活本轮工具发现的项目指令，规则交付前阻断同批访问，下一模型轮收到指令后再继续；保留路径范围及原生 transcript。
- Proma `0.19.62` 安装包只作为部分主界面对照。其公开 Tag 与 `v0.19.57` 指向同一 commit，但安装包包含公开源码未覆盖的同步接口；不把该包视为已完整合入的新源码基线，也不宣称全部功能等价。
- 本轮定向检查范围、实际打包界面证据、公开发布及资产核验状态见 [0.18.1 实施与发布验证](./docs/release/VALIDATION_0_18_1.md)。没有据此声称真实翻译任务提速或减少多少 token。

## 已保留的 UI 与批次行为

- CAT 仅在右侧原生工作区挂载；主区使用完整 Agent，会话切换恢复用户原生工作区状态。切换项目激活 CAT；当前项目头保持原生展开/收起行为，从预览返回可用 CAT 标签。预览使用当前宿主 sessionId。
- 修改建议默认当前批次 pending，列表及总数在 SQL 分页前过滤；历史 accepted 的正常 revision 增加不再显示版本冲突。
- QA 列表、数量、下一项和交付默认当前批次；项目历史从项目设置显式进入。TM/TB 与风格资料仍项目共用。
- 项目设置分为项目、批次、语言资产、Tag Profiles、维护与诊断；底部为辅助面板。切换或卸载 CAT 保留进程内草稿与撤销历史。
- 以下为已发布 0.17.73 的历史验证，不能代替当前版本：类型检查、默认回归与真实 Electron 浏览器检查通过；QA 主进程范围测试及 Store 批次分页测试通过。本地及远程六步打包验证通过（CAT 31 PASS / 0 FAIL / 2 MANUAL，辅助面板 26 PASS / 0 FAIL）；远程 CI 与 Release 均成功，macOS arm64/x64、Windows x64 安装包和更新清单齐全，以 [0.17.73 实施记录](./docs/release/VALIDATION_0_17_73.md) 为准。

- macOS 红绿灯窗口按钮有用户报告问题，复现条件与根因尚未核实；按用户要求留到下一轮，见 [TODO](./TODO.md)。

## 已发布版本的历史证据

- 2026-09-06 已将 Proma `v0.19.31`（`7a3721d7`）合并为 `b2c71810`，App 版本为 `0.17.71`；本地 `smoke:pack` 已确认 `esbuild 0.28.1` 及平台二进制进入 `app.asar.unpacked`。GitHub Actions Release run `34011582164` 发布成功，但 2026-09-07 核查确认其中 package-verify 仅输出 Bun 帮助，未执行打包或垂直验证；后续 CI `34012237919` 也存在同样空跑。2026-09-07 修复后的 CI `34078566618` 已真实执行：打包、依赖恢复、Agent、Chat、项目切换通过；Linguist 段落点击被底部面板遮挡，作业正确失败并上传报告与六步日志，该次垂直链路未通过。随后布局修复 `209c2640` 的 CI `34080231269` 已通过；下载 artifact 核验 HEAD 匹配、工作树干净、六步均 passed/exitCode=0 且日志非空，Linguist 为 21 PASS / 0 FAIL / 2 MANUAL。此结果仅覆盖该提交的 macOS arm64 packaged 自动链路，Native Open/Save 仍未验证，也不追溯证明已发布包。公开的 [Linguist Agent 0.17.71 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.71) 已包含 `latest-mac.yml`、`latest.yml`、macOS arm64/x64 DMG/ZIP 和 Windows x64 EXE。此前发布准备见历史 [0.17.70 验证记录](./docs/release/VALIDATION_0_17_70.md)，不得把该包哈希当作本轮结果。
- 默认集合覆盖真实 SQLite、Worker、SDK 转换和本地 HTTP；旧格式合成项目与 Pi 会话通过原译文/参考读取、备份、会话恢复、新轮写回、verified 导出、重导和损坏备份拒绝。上一轮具体命令、数量与边界见 [2026-09-05 实施记录](./docs/release/IMPLEMENTATION_2026_09_05.md)；9 月 6 日定向证据见 [2026-09-06 实施记录](./docs/release/IMPLEMENTATION_2026_09_06.md)。
- 最初原生候选暴露 ESM 加载和 utility 回调克隆两项集成回归，已修正。2026-09-06 本地记录中 `electron:build`、`smoke:pack` 与 `smoke:vertical` 通过，2026-09-07 CI 失败及后续修复复验分别记录如上；垂直证据仍按合同标记 partial，并保留原生 Open/Save 对话框人工阻断，不能把人工项折算为自动通过。
- 模型请求均使用合成资料和本地 Fake Provider；没有测试真实收费 Provider、真实 Keychain、原生 Open/Save 或语言质量。用户安装版保持原状，本轮未检查其哈希。

真实 Provider 四岗位迷你任务、质量对照和人工资格仍见 [TODO](./TODO.md) 与 [已知限制](./docs/release/KNOWN_LIMITATIONS.md)。
