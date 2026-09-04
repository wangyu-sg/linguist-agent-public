# Linguist Agent 当前交接

更新时间：2026-09-04

## 0.17.70 分阶段执行：B

- 统一启动身份配置与构建校验，替换旧品牌图标和两模式截图；保留教程操作说明，移除无法代表当前界面的旧示例截图。FAQ 按真实持久化岗位规则更新。
- 新增 44 个身份/教程触点，4 个混有产品文案的临时偏差转产品触点；Host Seam 未增加，数量以 JSON 账本为准。
- 根测试、类型检查、边界、Host Seam、sync replay 与目录打包完整性检查通过；实际隔离应用检查欢迎页和三模式首章。截图实例无 Provider，Keychain 初次启动阻塞后采用仓库既有无凭据 smoke 配置，不代表真实凭据或 Provider 链通过。

## 0.17.70 分阶段执行：D

- 项目切换改为共享 Jotai 动作；最新请求才可提交，权威列表合并期间保留即时事件，空项目创建普通会话。现有 updateSettingsSync 原子持久化成功后同步提交界面，无第二套设置队列。resetView:false 仅用于内部工具页。
- 状态回归先复现 B Workspace + A Session，再覆盖创建、陈旧列表、A→B→A、排除特殊会话、创建/保存失败与工具页保持；这是 Store + IPC 替身证据，真实窗口链仍待最终打包验证。

## 0.17.70 分阶段执行：A2

- 审计 A1 后全部 223 个 product-fork：172 项保留、51 项转 temporary-deviation，本轮无生产代码删除。精确理由、来源提交与退役条件回写唯一 JSON 账本。品牌/数据根注释、主题 token、项目双绑定与 CAT 合同继续保留。
- 固定 bbf577a8 没有 EventKit before-quit 释放、显式窗口安全配置及强制 MCP stdio 凭据绑定的等价实现；调用链为 app before-quit → coordinator → service → addon disposeChanges，MCP validator/orchestrator 均传真实 entry。不能因通用性而删除。
- `docs/architecture/upstream-native-security.patch` 是基于固定上游的独立候选补丁（无 LA 产品身份），尚未发送 PR；其他通用改动按来源提交保留，待上游接收与真实合同复验。未向外部发送任何消息。
- 浏览器 f2ddb623 修复仍不在固定基线，保持 temporary-deviation。混合产品主题/宿主导航的文件不做拆分重构；具体差异与保留合同逐项登记。

## 0.17.70 分阶段执行：A1

- 本轮只完成方案 §3.2：`pi-mcp-tools.ts` 与固定 `bbf577a8` 基线完整一致。完整文件差异仅为有界失败缓存及其写入 helper；调用方仍由 Agent orchestrator 构建工具、app quit 释放连接，没有 LA 语义需要保留。
- 删除该文件的 product-fork，改为 take-upstream 同步策略；当前数量以 `docs/architecture/proma-touchpoints.json` 为准。
- 真实 loopback HTTP MCP 回归覆盖顺序 65 次失败、最旧项淘汰、保留项冷却、后台恢复、工具执行和 dispose 清理。运行：`bun test tests/pi-mcp-cooldown.test.ts`，需允许本地监听端口；不使用用户数据根或真实 Provider。
- 全仓 typecheck、根 test、MCP baseline、boundary、fusion、Host Seam、sync replay 与 electron:build 通过；构建使用临时 Clang/Swift 缓存避开默认缓存的沙箱写入限制。此证据不代表 packaged app 或真实 Provider 四岗位链通过。
- 下一轮执行 A2：完整 Fork 留／还／暂存审计，逐项比较 LA、固定基线与运行合同。工作流 A 尚未全部完成；B–E 未开始，产品版本与 CAT Schema 未变。

以下为此前 0.17.69 交接记录，验证结论属于此前轮次。

## 当前状态

- 分支：`main`。
- 基线：Proma `v0.19.26@bbf577a8`；正式 merge `98f0ed12`；本地起点 `7bbb743f`。
- 当前版本：Electron `0.17.69`、Shared `0.1.69`、CAT Core / Formats / Store / Tools `0.0.23 / 0.0.13 / 0.0.42 / 0.0.37`、schema `19`。
- Runtime：Pi `0.84.4` only；完整 Proma Agent + Chat + Linguist Vertical Agent Profile，无第二套 Host 能力。

## 本轮已完成

- 一次 merge Proma v0.19.26；Brave / Tavily MCP 预设、系统浏览器打开入口、Fable 5.1 与子会话思考强度控制，以及文件面板修复直接采用上游实现。
- 修复普通 Agent 折叠侧栏项目预览无法快捷切换项目的问题。
- 保留三模式、独立数据根、CAT authority、Linguist rail/full presentation 与 Collaboration 冻结范围。
- 修复 atomic submit 的即时路径遗漏 `linguistContext`；Renderer、Shared IPC 与主进程继续传递同一冻结快照。
- 接受上游删除的 `AgentPlaceholder`、旧 Agent Provider/AppShell Context，并清理对应 touchpoint 与过期测试条目。
- App 发布版本为 `0.17.69`，Shared 为 `0.1.69`；baseline、touchpoints 与当前事实文档已对齐。
- CLI 编译改用当前 Bun 可执行文件，避免子进程依赖 PATH。
- Renderer Host Seam 已收敛到 Agent extension 与 app mode registry；Composer context 构建移入无环依赖的纯模块，极窄视口强制折叠不再留下无效展开动作。
- 同步验证器覆盖 `9` 个 Host 锚点；固定历史冲突 `9/9` 均能分类，并有一条 merge → resolver → overlay → verifier 集成回归；touchpoint ledger 为 `236` 个生产触点。
- Proma 自动同步保留策略解析、manifest overlay 与历史回放；CI 使用完整 Git 历史，并移除未被消费的 drift 报告和重复静态 seam 测试。
- 内部启动初始化改为 fail fast；Linguist 会话绑定解析失败显式进入 unavailable 状态。
- Store、Tools 与根测试入口继续使用显式关键回归列表。

## 验证

- 全仓 typecheck 与测试 `282/282` 通过；boundary `4/4`、fusion `14/14`、Host Seam `9/9`、历史冲突分类 `9/9` 通过。
- 许可门禁通过；darwin-arm64 SBOM 已与当前 `489` 个第三方生产依赖同步。
- Electron main / workers / Agent runtime / preload / renderer / CLI / Agent Island / EventKit / resources 的底层构建阶段全部通过。
- 上一轮 `smoke:pack` 与产物完整性通过；完整 vertical 为 Agent `15/15`、Chat `19/19`、Linguist `21/21`，执行状态 passed。Native Open/Save 仍保留人工门禁；真实 Provider 四岗位全链仍无证据。
- `v0.17.69` GitHub Release 的 macOS arm64、macOS x64 与 Windows x64 构建均成功，`latest-mac.yml` 已核对为 `0.17.69`；未替换本机安装版。

## 下一步

1. 在 packaged app 中完成真实 Provider 四岗位全链。
2. 再做 Phrase / memoQ、Native Open/Save、IME、VoiceOver、键盘和 14 天日用。

当前事实见 [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md)，未完成项只列在 [TODO.md](../TODO.md)。
