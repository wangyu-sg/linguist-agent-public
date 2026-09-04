# Changelog

本项目所有值得注意的变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### Changed

- 审计全部现存产品触点，将 51 个通用构建、安全、可访问性与界面状态修复改记可退役临时偏差；保留尚无固定基线等价证据的实现，并准备原生生命周期与安全补丁。

### Fixed

- 项目快捷切换先刷新权威会话、为无主会话的项目创建会话，再同步提交 Workspace、Agent Tab、模式与设置；迟到结果和创建/保存失败不会留下跨项目混合状态。

- 采用固定 Proma v0.19.26 的完整 Pi MCP 桥接实现，required MCP 失败冷却缓存限制为 64 项并淘汰最旧记录；退役该文件的本地产品分叉。

## [0.17.69] - 2026-09-04

### Added

- [Proma v0.19.26](https://github.com/proma-ai/Proma/releases/tag/v0.19.26) 新增 Brave 与 Tavily MCP 预设、系统浏览器打开入口，以及 Fable 5.1 与子会话思考强度控制。

### Changed

- Proma 基线由 [v0.19.23](https://github.com/proma-ai/Proma/releases/tag/v0.19.23) 升级至 [v0.19.26](https://github.com/proma-ai/Proma/releases/tag/v0.19.26)。

### Removed

- [Proma v0.19.26](https://github.com/proma-ai/Proma/releases/tag/v0.19.26) 移除旧教程链路与会话拖拽三点提示。

### Fixed

- 修复普通 Agent 模式折叠侧栏中的项目预览无法快捷切换项目的问题。
- [Proma v0.19.26](https://github.com/proma-ai/Proma/releases/tag/v0.19.26) 修复文件面板首次加载不稳定，以及新建文件夹未立即显示的问题。

## [0.17.68] - 2026-09-03

### Added

- [Proma v0.19.23](https://github.com/proma-ai/Proma/releases/tag/v0.19.23) 支持将会话拖入输入框生成引用、单一委派观察 Tab 与未查看完成状态，以及可折叠的 Vault 文件侧栏。

### Changed

- 折叠侧栏中的 Linguist 项目切换复用 Proma 原生项目预览弹层。
- Proma 基线由 [v0.19.16](https://github.com/proma-ai/Proma/releases/tag/v0.19.16) 升级至 [v0.19.23](https://github.com/proma-ai/Proma/releases/tag/v0.19.23)。

### Fixed

- 修复 HOK 翻译项目因 Segment 运行变更被完整性校验误判而无法打开的问题。
- [Proma v0.19.23](https://github.com/proma-ai/Proma/releases/tag/v0.19.23) 修复 Markdown 目录跳转空白与滚动恢复竞态、重复打开 Vault 笔记导致重挂载、已删除文件残留在改动列表、解析后路径无法定位预览，以及 Fable 5.1 推理兼容性问题。

## [0.17.67] - 2026-09-01

### Added

- TM Intelligence 2.0 的纯函数 Segment Matcher、强上下文匹配、TM 来源追踪、TMX 元数据与内联结构保存。
- Workbench TM 面板显示匹配类别、差异、来源、来源数量、结构安全状态和译文变体。
- [Proma v0.19.16](https://github.com/proma-ai/Proma/releases/tag/v0.19.16) 新增全量会话正文搜索、Markdown YAML Properties、表格与 LaTeX 编辑、长文目录导航和 Vault 滚动位置记忆。

### Changed

- Workbench 与 Agent 共用同一 Matcher；Agent Fuzzy 默认阈值为 85%，最多注入 2 条，并过滤短句和结构不兼容结果。
- TM 单元按具体 TU occurrence 保存，支持来源启用/禁用、优先级和语言对隔离的 Exact Hash。
- Proma 基线由 v0.19.5 升级至 [v0.19.16](https://github.com/proma-ai/Proma/releases/tag/v0.19.16)，统一 Agent 运行代际，并将项目根检查与会话分叉文件复制改为异步执行。

### Removed

- 移除旧的 Segment Match `contains` 类型、72% 子串保底和旧 Matcher 调用路径。

### Fixed

- Schema 19 迁移前先创建带 `fromSchema`/`toSchema` 记录的真实项目备份。
- 修复同源多译文未标记歧义、TMX `tuid`/属性/上下文/内联结构丢失以及迁移后 TM 来源不可追踪。
- [Proma v0.19.16](https://github.com/proma-ai/Proma/releases/tag/v0.19.16) 修复工作区标签滚动、预览刷新、浏览器焦点与弹窗隔离、Windows ConPTY、macOS 终端配置回读、终端关闭快捷键和禁用场景音效仍播放等问题。

## [0.17.65] - 2026-08-30

### Added

- [Proma v0.19.5](https://github.com/proma-ai/Proma/releases/tag/v0.19.5) Agent 终端支持选择并记住 Shell Profile，设置页新增 Todo、日程和 Obsidian 开关，右侧工作区标签栏支持拖动定位。

### Changed

- Proma 基线由 v0.19.1 升级至 [v0.19.5](https://github.com/proma-ai/Proma/releases/tag/v0.19.5)，Pi Agent 运行时升级至 0.84.4。
- 右侧工作区展开时占用全部主区域，原生 Agent 主区同步收起，不再保留重复的 Agent Rail。

### Fixed

- 修复 macOS 顶栏内容与交通灯重叠、Agent Rail 横条干扰，以及 CAT 底部面板背景半透明的问题。
- [Proma v0.19.5](https://github.com/proma-ai/Proma/releases/tag/v0.19.5) 修复 LiveMarkdown 渲染、预览选择引用、发送失败丢内容、Google Pi 接入、排队消息流路由、草稿可见性、Windows 标题栏点击区域和右侧面板刷新闪烁等问题。
- 修复 Bun 隔离式 workspace 下 EventKit 原生构建、依赖许可扫描和锁定版 Electron Builder 的解析路径。

## [0.17.64] - 2026-08-29

### Added

- T / E / P 任务阶段切换，统一筛选、Footer 和阶段进度口径。
- [Proma v0.19.1](https://github.com/proma-ai/Proma/releases/tag/v0.19.1) Obsidian Vault 工作区与 Scratch Pad 迁移、OfficeCLI 高保真 Office 预览、MCP/CLI 连接目录、右侧工作区双 Pane、目录终端和 GLM-5.3-Flash 推理深度支持。

### Changed

- CAT 工作台接入 Proma 原生右侧工作区；压缩工具栏并重排批次、语言资产和项目设置入口。
- 普通片段显示三行，当前编辑、Proposal 和 QA 异常行自动展开。
- [Proma v0.19.1](https://github.com/proma-ai/Proma/releases/tag/v0.19.1) 整合 MCP 与 Skills 入口，折叠侧栏保留会话入口，并持久化目录状态与滚动位置。

### Removed

- [Proma v0.19.1](https://github.com/proma-ai/Proma/releases/tag/v0.19.1) 移除改动页自动跳转和连接目录中的无效条目。

### Fixed

- 修复接受 Proposal 后错误标记“已确认”的问题，并自动修复仍未重新确认的旧项目记录。
- [Proma v0.19.1](https://github.com/proma-ai/Proma/releases/tag/v0.19.1) 修复预览误刷新、Git diff 汇总丢失、终端光标和裁剪、Agent 流交接、浏览器标签、窄右栏挤压、Skills 同步和委派完成态等问题。

### Security

- [Proma v0.19.1](https://github.com/proma-ai/Proma/releases/tag/v0.19.1) 补齐 MCP 配置写入、禁用、OAuth 代理和凭证绑定端点校验，并统一远程 Transport 的代理与释放策略。

## [0.17.63] - 2026-08-28

### Added

- 资产与证据工作流、Evidence Receipt，以及交付页“资产与证据覆盖”面板。

### Changed

- 未映射内容只提醒而不阻断；Full Review 和 Verified 导出检查必需证据覆盖，as-is Manifest 明示缺口。
- 完善原生 Agent Tab、工作台导航和打包回归。

### Fixed

- 修复项目 Agent 与委派会话的 CAT 绑定、标签页恢复和会话路由。
- 修复窄窗口布局、Segment 搜索焦点和标签页上下文保持。

## [0.17.62] - 2026-08-27

### Added

- [Proma v0.18.2](https://github.com/proma-ai/Proma/releases/tag/v0.18.2) 统一 Agent 右侧工作区、可见终端、浏览器原子操作、探索会话标签、改动目录树、按项目分组归档、宽侧栏双文件来源和 Windows 统一顶栏。

### Changed

- Proma 基线升级至 v0.18.2；同步 Overlay 保留 LA 版本并适配 node-pty，Host Seam 语义冲突改为直接阻断。
- [Proma v0.18.2](https://github.com/proma-ai/Proma/releases/tag/v0.18.2) Worktree 流程并入右侧标签，重整输入工具栏和模型选择器。

### Removed

- 移除四处已由上游覆盖的 Proma Core 定制。
- [Proma v0.18.2](https://github.com/proma-ai/Proma/releases/tag/v0.18.2) 移除启动页重复副标题。

### Fixed

- 修复固定按钮渐隐遮罩、底边线和触控板横向滚动。
- [Proma v0.18.2](https://github.com/proma-ai/Proma/releases/tag/v0.18.2) 修复右侧标签恢复与宽度、会话状态和协作进度、浏览器与预览联动、规划待办、记忆 Diff、中文 MCP、附件、模型选择和 Windows 项目指令解析等问题。

## [0.17.61] - 2026-08-25

### Added

- QA 全项目视图、仅当前片段筛选和跨批次跳转。
- Agent Rail 遮罩、Esc 关闭、焦点恢复和状态徽标说明。

### Changed

- 状态栏只保留当前阶段和非零指标，明确批次与项目口径，并将空运行信息收为单行。
- 译文框随内容增高并兼容 IME；200% 缩放时自动折叠侧栏。

### Fixed

- 修复编辑行被底部浮层遮挡和项目创建焦点问题。
- 初始化或会话绑定失败时改为明确失败，不再继续运行半初始化界面。

## [0.17.60] - 2026-08-23

### Added

- [Proma v0.17.59](https://github.com/proma-ai/Proma/releases/tag/v0.17.59) 改动面板新增记忆更新停靠区。

### Changed

- [Proma v0.17.59](https://github.com/proma-ai/Proma/releases/tag/v0.17.59) 改动扫描过滤 dotfile 目录。

### Removed

- [Proma v0.17.59](https://github.com/proma-ai/Proma/releases/tag/v0.17.59) 移除自定义工具配置变化时冗余的“Chat 工具已更新”提示。

### Fixed

- [Proma v0.17.59](https://github.com/proma-ai/Proma/releases/tag/v0.17.59) 修复 DeepSeek Flash Exp 视觉路由、Agent 消息瞬态失败、首次模型引导、停止残留运行和后台流刷新。

## [0.17.47] - 2026-08-20

### Added

- [Proma v0.17.46](https://github.com/proma-ai/Proma/releases/tag/v0.17.46) 浏览器最小化与最多 8 个后台会话的 LRU、地址栏普通文本搜索、独立豆包 API 和 Agent Plan。

### Changed

- [Proma v0.17.46](https://github.com/proma-ai/Proma/releases/tag/v0.17.46) 迁移火山方舟与豆包渠道，合并 Qwen 渠道并默认使用 Anthropic 协议，Kimi 模型 ID 改为 `kimi-k3`。

### Deprecated

- [Proma v0.17.46](https://github.com/proma-ai/Proma/releases/tag/v0.17.46) Qwen OpenAI 协议渠道标记为旧版；存量配置继续工作，但不再提供新建入口。

### Removed

- [Proma v0.17.46](https://github.com/proma-ai/Proma/releases/tag/v0.17.46) 移除 GLM-5.2 渠道预设和受管浏览器冗余的 Agent 活动状态栏。

### Fixed

- [Proma v0.17.46](https://github.com/proma-ai/Proma/releases/tag/v0.17.46) 修复 Agent 停止卡住、自动任务参数桥接、上下文整理完成态、流式与思考块、会话时长、Markdown 编辑器切换和跨会话文件变更归属。

## [0.17.45] - 2026-08-20

### Fixed

- 修复导航布局和 macOS 更新。

## [0.17.44] - 2026-08-19

### Added

- [Proma v0.17.42](https://github.com/proma-ai/Proma/releases/tag/v0.17.42) GLM-5.3 与 Doubao Seed 2.1 预设，以及受管浏览器跨标签跟随和 Agent 主动关闭。

### Changed

- [Proma v0.17.42](https://github.com/proma-ai/Proma/releases/tag/v0.17.42) 重写 Agent 长会话、流式与多会话性能；升级至 Pi 0.84.2 独立工具进程，并恢复规划工作流和 prompt-clarifier。

### Fixed

- 修复活动 Tab 关闭按钮不可点击，以及固定操作区下的 Tab 渐隐。
- [Proma v0.17.42](https://github.com/proma-ai/Proma/releases/tag/v0.17.42) 修复 Renderer 崩溃恢复、标题重命名、工具调用布局、历史模型身份、Agent 运行、浏览器导航、消息渲染、输入焦点、队列和委派重复等问题。

## [0.17.33] - 2026-08-14

### Added

- [Proma v0.17.26](https://github.com/proma-ai/Proma/releases/tag/v0.17.26) Agent 链接进入受管浏览器、工作日和每日窗口定时任务、模糊会话搜索、Windows 通知与托盘，以及 Qwen3.7 Flash 预设。

### Changed

- Proma 基线升级至 v0.17.26，并精简安装产物和发布说明。

### Fixed

- [Proma v0.17.26](https://github.com/proma-ai/Proma/releases/tag/v0.17.26) 修复浏览器 Popup、下载和受限 URL，语音初始化，输入焦点和队列，长会话渲染，调度校验，Markdown/Mermaid，跨平台 UI、模型、Skill、存储和自动更新。

## [0.17.30] - 2026-08-12

### Added

- 自动发布链路。

### Changed

- 将日常关键回归精简到 276 条，保留发布、数据安全、CAT 核心和架构边界覆盖。
- 调整发布产物和更新元数据。

### Fixed

- 修复 macOS 与 Windows 打包接缝。

## [0.17.29] - 2026-08-12

### Added

- 首次发布基于 Proma 的 Linguist 第三模式、CAT 项目工作流、项目 Agent、批次与语言资产管理、QA、Proposal、术语、上下文和交付能力。

### Changed

- Proma 基线升级至 v0.17.15，并统一 Linguist 项目区域设置与默认 Skills。

### Fixed

- 修复上游合并后的 CI 测试口径。

[Unreleased]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.69...HEAD
[0.17.69]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.68...v0.17.69
[0.17.68]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.67...v0.17.68
[0.17.67]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.65...v0.17.67
[0.17.65]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.64...v0.17.65
[0.17.64]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.63...v0.17.64
[0.17.63]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.62...v0.17.63
[0.17.62]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.61...v0.17.62
[0.17.61]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.60...v0.17.61
[0.17.60]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.47...v0.17.60
[0.17.47]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.45...v0.17.47
[0.17.45]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.44...v0.17.45
[0.17.44]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.33...v0.17.44
[0.17.33]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.30...v0.17.33
[0.17.30]: https://github.com/wangyu-sg/linguist-agent-public/compare/v0.17.29...v0.17.30
[0.17.29]: https://github.com/wangyu-sg/linguist-agent-public/tree/v0.17.29
