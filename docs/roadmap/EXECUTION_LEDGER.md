# Execution Ledger — Linguist Agent Rebuild (Proma-based)

> 计划：《Linguist Agent：基于 Proma 的产品重建执行计划》v1.0（2026-07-25）
> 机读账本：`docs/roadmap/execution-ledger.json`
> 本账本自 PB-001 起在新仓 `linguist-agent-next` 维护。PB-000 在旧仓执行，其完整记录见旧仓 `docs/roadmap/PB_REBUILD_EXECUTION_LEDGER.md` 与 `LEGACY_FREEZE_REPORT.md`（tag `la-v2-legacy-freeze-2026-07-25`）。
> 状态等级（计划 §3.3）：`implemented` → `unit_verified` → `integration_verified` → `packaged_app_verified` → `real_machine_verified` → `release_qualified`。禁止只写 `completed`。

## PB-000：冻结旧 LA（旧仓执行，存档引用）

- **状态**：`unit_verified`
- **repo**：`/Users/<local>/Desktop/linguist-agent`，分支 `legacy/platform`，tag `la-v2-legacy-freeze-2026-07-25`
- **baseCommit**：`60c504e55d098a96b78f26fdc08a14f506d5eb14` → **resultCommit**：`c2014227b34c45294dafe9bab6f65346f4c3a654`
- 详情见旧仓 `LEGACY_FREEZE_REPORT.md`。

## PB-001：创建 Proma 衍生新仓

- **状态**：`unit_verified`（git 级验证通过；install/typecheck/test/打包属 PB-003/PB-004）
- **依赖**：PB-000 ✅
- **baseCommit**：`702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（upstream main HEAD，基线 SHA）
- **resultCommit**：`SELF`（沿用旧仓账本惯例：包含本条目的不可变 commit 即 result 引用）
- **改动文件**：
  - `docs/architecture/UPSTREAM_BASELINE.md`（新增）
  - `docs/roadmap/EXECUTION_LEDGER.md`（新增，本文件）
  - `docs/roadmap/execution-ledger.json`（新增）
- **实际操作**：
  - `git clone https://github.com/proma-ai/Proma /Users/<local>/Desktop/linguist-agent-next`（完整历史）
  - `git remote rename origin upstream`
  - `origin`（私人远端）未配置：用户尚未准备，按计划记为待办，未伪造
  - 产品分支：`main` 即产品主线（计划 §11.2），未另建分支
  - 未改任何代码；未执行 install/typecheck/test
- **验证**：
  - `git log --oneline -5`：HEAD = 基线 SHA + 本票 docs commit
  - `git remote -v`：仅 `upstream → proma-ai/Proma`
  - `git status --short`：提交后干净
- **knownLimitations**：
  - 本机未安装 bun，PB-003 的 `bun install --frozen-lockfile` 前需先装 bun；
  - 无 `origin`，本仓 commits 目前仅存本机；
  - Electron 39.5.1 下 `node:sqlite` 可用性未验证（计划 §5.7 要求在 PB-003/PB-004 验证）。
- **rollback**：`git reset --hard 702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（仅回退本票 docs commit；如需整体回退则删除 `linguist-agent-next/` 目录）

## PB-002：许可证与来源治理

- **状态**：`unit_verified`（文档/配置级验证通过；无代码改动）
- **依赖**：PB-001 ✅
- **baseCommit**：PB-001 的 resultCommit（`85a7d69d`）
- **resultCommit**：`SELF`
- **改动文件**：
  - `NOTICE.md`（新增，根目录）：LA 为 Proma 衍生作品、整体 AGPL-3.0；Proma 版权保留；OpenWorker/MIT 与 codex/Apache-2.0 复制规则；开源 codex ≠ OpenAI 闭源客户端
  - `ATTRIBUTION.md`（新增，根目录）：四个来源的角色与许可
  - `docs/attribution/SOURCE_PROVENANCE.md`（新增）：来源总表、基线固定、四类复制登记规则、逐条登记表（已登记 PB-001 整仓 clone）
  - `docs/attribution/PRIVATE_RESEARCH_POLICY.md`（新增）：私人研究资料定义、存放位置、允许入仓的衍生成果边界、公开镜像前检查命令
  - `.gitignore`（追加）：`linguist-agent-research-private/`、`THREE_APPS_PIXEL_SPEC.md`、`codex-ui-spec-full.md`、`codex-teardown/`、`asar-src/`、`*.asar`、`*.dmg`
- **未做**：未改 `LICENSE`（Proma AGPL-3.0 原样保留）；未删除任何 Proma 版权；未提交任何逆向规格
- **验证**：
  - `shasum -a 256 LICENSE` 仍为 `0d96a4ff…9abcb0`（未动）
  - `git check-ignore` 验证新增排除规则生效
  - `git status --short` 提交后干净
- **knownLimitations**：
  - `docs/product/LA_PRODUCT_UI_SPEC.md` 尚未编写（属后续 UI 批次，私人规格在旧仓/下载目录，未迁入）；
  - 公开镜像前检查命令列入 Batch 11，本轮未执行（仓库尚无私有内容可误伤）。
- **rollback**：`git reset --hard 85a7d69d`

## PB-003：原版 Proma 开发基线

- **状态**：`real_machine_verified`（限定范围：install/typecheck/test/build/dev 启动均在本机实测通过；2 条上游测试失败为环境限制已记录，非本票引入）
- **依赖**：PB-001 ✅（bun 已在本票安装）
- **baseCommit**：PB-002 的 resultCommit（`9e234bd0`）
- **resultCommit**：`SELF`
- **改动文件**：`docs/architecture/DEV_BASELINE_REPORT.md`（新增，含全部实测日志）、账本
- **实测结果**（详见 DEV_BASELINE_REPORT.md）：
  - bun 1.3.14 安装至 `~/.bun`；`bun install --frozen-lockfile` ✅（1200 包）
  - `bun run typecheck` ✅ 6/6 包 exit 0
  - `bun test` ⚠️ 480 pass / 2 fail（`agent-session-manager.test.ts`、`channel-runtime-api-key.test.ts`：纯 Bun 下无法 import electron 命名导出，上游测试环境限制）
  - `bun run electron:build` ✅ exit 0
  - `bun run electron:dev` ✅ 真机完整启动（IPC、工作区、托盘、快捷键、调度器全部就绪，无 preload 错误），验证后停止
  - node:sqlite 探针：Electron 内嵌 Node 22.22.0，`DatabaseSync` ✅；`db.backup` ❌ 不存在（Node 23.4 才加入）；`VACUUM INTO` 兜底 ✅——结论供 PB-024 使用
- **macOS 权限**：启动未请求任何系统权限
- **Provider**：真实对话需真实 API Key（首启自动建 DeepSeek 预设渠道）→ PB-004 Fake Model Server 必要性确认
- **knownLimitations**：
  - 2 条上游测试失败未修（不属本票；PB-004 真 Electron harness 建立后再评估）；
  - 未做打包 smoke（属 PB-004）；
  - 环境副作用：`~/.bun` 安装、`~/.proma-dev/` 由 dev 启动创建。
- **rollback**：`git reset --hard 9e234bd0`（环境侧可选 `rm -rf ~/.bun ~/.proma-dev`）

## PB-004：打包 Electron 基线与 Hermetic Smoke

- **状态**：`packaged_app_verified`（打包应用上 18/18 断言通过，连续两次完整运行 exit 0；未做真实用户数据/真实 Key 验证，故不达 real_machine_verified）
- **依赖**：PB-003 ✅
- **baseCommit**：PB-003 的 resultCommit（`c58bc069`）
- **resultCommit**：`SELF`
- **改动文件**：
  - `apps/electron/scripts/smoke/fake-model-server.ts`（新增：OpenAI 兼容 Fake Model Server，6 场景 + 非流式标题响应）
  - `apps/electron/scripts/smoke/run-g0-smoke.ts`（新增：playwright-core `_electron` 打包应用 smoke runner）
  - `apps/electron/package.json`（新增 `smoke:pack`/`smoke:g0` 脚本 + devDep `playwright-core@1.62.0` 精确版本）
  - `bun.lock`（playwright-core 锁文件）
  - `docs/roadmap/G0_BASELINE_REPORT.md`（新增，含全部实测日志与逐项 PASS/FAIL）
  - 账本（本文件 + `execution-ledger.json`）
  - **未改动任何产品运行时代码**（src/ 零改动）
- **实测结果**（详见 G0_BASELINE_REPORT.md）：
  - `bun run smoke:pack` ✅ 未签名 dir 包 `out/mac-arm64/Proma.app`
  - `bun run smoke:g0` ✅ **18 PASS / 0 FAIL** ×2 次（clean build；打包启动；preload API；临时 HOME 配置；创建对话；发送「你能帮我做什么」；流式文本 DOM 中间态；thinking delta；tool call 事件 + role:"tool" 续接往返；唯一最终 DOM；429→重试成功；400 上下文错误；中途停止 + stopped 持久化；同 HOME 重启恢复 API+DOM）
  - 断言路径：全部 Chat 运行时路径（sendMessage → chat-service → OpenAIAdapter → SSE）；DOM 断言覆盖流式中间态/最终文本/重启可见；事件断言经 preload 真实 IPC 订阅
- **关键发现**：playwright-core 在 bun 下无法完成 Electron inspector ws 握手 → runner 必须用 Node（≥22.18，本机 nvm v22.22.2）运行；主/辅窗口同载 index.html，需按 `?window=` 过滤主窗口
- **knownLimitations**：
  - 打包 smoke 环境 safeStorage 不可用（明文兜底，channel-manager 既有逻辑）；
  - 未签名包自动更新 ENOENT 报错（预期内）；
  - reasoning 折叠块未做 DOM 断言（事件级覆盖）；
  - Pi agent 路径（createAgentSession）未覆盖，留待后续票。
- **rollback**：`git reset --hard c58bc069`（环境侧可选 `rm -rf apps/electron/out`）

## PB-010：LA 品牌基础（minimal branding）

- **状态**：`packaged_app_verified`（打包应用 18/18 断言通过；typecheck 6/6；`bun test` 480 pass / 2 既有环境失败与基线一致）
- **依赖**：PB-004 ✅
- **baseCommit**：PB-004 的 resultCommit（`155203c8`）
- **resultCommit**：`SELF`
- **改动文件**：
  - `apps/electron/electron-builder.yml`（appId `com.linguistagent.app`（开发值，最终签名身份 PB-114 定）、productName `Linguist Agent`、copyright 加 LA 衍生行、麦克风用途文案、fileAssociations 显示名；扩展名 `proma-backup`/`proma-share` 与 publish 配置不变）
  - `apps/electron/package.json`（description）
  - `apps/electron/src/renderer/index.html`（document title）
  - `apps/electron/src/main/menu.ts`（macOS 应用菜单）
  - `apps/electron/src/main/tray.ts`（托盘 tooltip）
  - `apps/electron/src/main/index.ts`（单实例锁提示、启动错误对话框）
  - `apps/electron/src/renderer/components/settings/AboutSettings.tsx`（关于页：Linguist Agent + 版本 + 「基于 Proma 构建 / Built on Proma (AGPL-3.0)」归属行并链接上游仓库）
  - `apps/electron/src/renderer/components/onboarding/OnboardingView.tsx`、`tutorial/TutorialBanner.tsx`、`App.tsx`、`quick-task/QuickTaskApp.tsx`、`agent/AskUserBanner.tsx`、`voice-dictation/VoiceDictationApp.tsx`（shell UI 用户可见产品名字符串）
  - `apps/electron/resources/icon.svg`、`icon.png`、`icon.icns`、`icon.ico`（原创 LA 字母图标，替换 Proma 条纹图标）
  - `apps/electron/resources/proma-logos/icon.svg`、`iconTemplate{,@2x,@3x}.png`（原创 LA 托盘 Template 图标，路径不变）
  - `apps/electron/scripts/generate-la-icon.mjs`（新增：SDF + 超采样纯数学绘制，仅需 pngjs，产物即上述图标）
  - `apps/electron/resources/generate-icons.sh`（头部注释/提示语与 LA 图标对齐）
  - `apps/electron/scripts/smoke/run-g0-smoke.ts`（打包产物路径改为 glob `out/mac-arm64/*.app`，不再写死 Proma.app）
  - `README.md`（替换为 LA 中文 README：Proma 衍生、AGPL-3.0、链接 NOTICE/ATTRIBUTION/UPSTREAM_BASELINE）
  - `README.en.md`（顶部加 LA 说明注记，Proma 原文保留）
  - `docs/architecture/USERDATA_LAYOUT.md`（新增：userData 子目录策略）
  - 账本（本文件 + `execution-ledger.json`）
- **图标方案**：自绘 "LA" 几何字母（L + A 笔画，A 横杠琥珀色点缀），SVG 为源（`resources/icon.svg`），由 `scripts/generate-la-icon.mjs` 以 SDF + 4x/2x 超采样盒式降采样渲染 PNG（1024/各 iconset 尺寸/256），`iconutil` 产出 icns，256 PNG 内嵌为 ico（PNG-in-ICO）；托盘 Template 为同字形无背景版本（22/44/66）。未复制 Proma/OpenAI/OpenWorker 任何品牌资产，未使用品牌字体。
- **后续修正（2026-07-26，`fix(PB-010)`）**：用户确认应恢复旧 LA 的既有自有设计；从冻结旧仓的 `apps/desktop/resources/AppIcon.icns` 导出并登记为 `resources/icon-source.png`，`icon.png`、`icon.icns`、`icon.ico` 与 `icon.svg` 均以此为源。生成脚本同步改为从该保留源重建三种平台格式，避免以后重新生成时回退为紫色字母图标；托盘 Template 未改。
- **未做（留后续票）**：
  - 设置子页/功能文案中仍有 "Proma" 字样（MemorySettings、ChannelForm、VoiceInputSettings、EnvironmentCheck*、Automations、AgentSkills 等）——属深度文案票，不在 minimal branding 范围；
  - `ChannelSettings` 的 Proma 商业版渠道推广卡（指向 proma.cool，第三方服务）与 `PromaLogoSettings`/`AppearanceSettings` 的 Proma 品牌 Logo 变体下载功能（`resources/proma-logos/proma-*.png`、`renderer/assets/bots/proma-logos/`）未动；
  - 最终签名身份（证书/Team ID/正式 appId）在 PB-114；
  - 配置根 `.proma`/`.proma-dev`、内部包名 `@proma/*`、IPC 频道名、localStorage 键、文件扩展名按票要求保持不变。
- **实测结果**：
  - `bun run typecheck` ✅ 6/6 exit 0
  - `bun test` ✅ 480 pass / 2 fail（与 PB-003 基线一致的两条上游环境限制失败，未变差）
  - `cd apps/electron && rm -rf out && bun run smoke:pack` ✅ 未签名 dir 包 `out/mac-arm64/Linguist Agent.app`
  - `bun run smoke:g0`（= `node scripts/smoke/run-g0-smoke.ts`）✅ **18 PASS / 0 FAIL**，exit 0
  - 后续修正：`node apps/electron/scripts/generate-la-icon.mjs` ✅；新 `icon.icns` 与打包 `Linguist Agent.app/Contents/Resources/icon.icns` SHA-256 一致（PNG 同样一致）
- **knownLimitations**：
  - 未签名 dir 包；bundle id 为开发值；
  - Dock 图标/应用名在已安装旧 Proma.app 的机器上并存（数据目录共享 `.proma`，属预期）；
  - 上文「未做」清单。
- **rollback**：`git reset --hard 155203c8`（环境侧可选 `rm -rf apps/electron/out`）

## PB-011：Pi 成为唯一可见 Runtime（D-002）

- **状态**：`packaged_app_verified`（打包应用 18/18 断言通过；typecheck 6/6；`bun test` 483 pass / 2 既有环境失败与基线一致）
- **依赖**：PB-010 ✅
- **baseCommit**：PB-010 的 resultCommit（`f13f1557`）
- **resultCommit**：`SELF`
- **产品决策**：D-002——首版只向用户展示 Pi runtime；隐藏 Claude/Pi 双内核 UI，但 Claude 实现代码、测试、`scripts/sync-runtime-deps.ts` 打包同步全部保留，未删一行；Claude 移除仅在第一条完整 CAT 路径通过后重新评估。完整策略见 `docs/architecture/RUNTIME_POLICY.md`（新建会话默认值矩阵、隐藏清单、维护者触达 Claude 的三条路径、Batch 3/4 只允许创建 Pi 会话的约束）。
- **改动文件**：
  - `apps/electron/src/renderer/lib/runtime-policy.ts`（新增：统一可见性开关 `AGENT_RUNTIME_SWITCHER_VISIBLE = false`，改回 true 即恢复双内核 UI）
  - `apps/electron/src/renderer/components/agent/AgentView.tsx`（输入工具栏 `AgentRuntimeSelector` 由开关门控隐藏；组件与 `handleAgentRuntimeChange` 保留）
  - `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`（「Agent 内核」选择器块连同双内核说明文案由开关门控隐藏；新草稿默认 runtime 本就走 `agentRuntimeAtom` 缺省 pi）
  - `apps/electron/src/renderer/components/settings/ChannelSettings.tsx`（渠道行 Claude Agent Core 徽章由开关门控隐藏，Pi 徽章保留）
  - `apps/electron/src/main/lib/feishu-bridge.ts`（远程 Bot 建会话缺省回退 `?? 'claude'` → `?? 'pi'`；settings-service 缺省本已是 pi，此为对齐兜底）
  - `apps/electron/src/main/lib/settings-service.test.ts`（新增 3 条：settings.json 缺失/缺字段时 agentRuntime 解析为 pi；维护者持久化 claude 覆盖仍被尊重）
  - `docs/architecture/RUNTIME_POLICY.md`（新增）
  - 账本（本文件 + `execution-ledger.json`）
- **既有默认值核查（无需改动，已确认为 pi）**：`types/settings.ts` `DEFAULT_AGENT_RUNTIME='pi'`、`settings-service.ts` 回退、`ipc.ts` `CREATE_SESSION` 与自动化 upsert、`agent-session-manager.ts` 默认参数、`agentRuntimeAtom`、`automation-manager.ts`/`automation-atoms.ts` 新建默认、`bridge-command-handler.ts`；快速任务窗口与语音输入均汇入 `CREATE_SESSION` 路径。历史数据兼容回退（旧会话/旧自动化缺 runtime 按 claude）刻意保留。
- **未做**：未删 Claude runtime 任何代码/测试/同步；未改 Pi adapter 内部；未动 chat-service；`updateSessionAgentRuntime` IPC 保留为维护者通道。
- **实测结果**：
  - `bun run typecheck` ✅ 6/6 exit 0
  - `bun test` ✅ 483 pass / 2 fail（480 基线 + 新增 3 条；2 条失败为 PB-003 起既有上游环境限制：`agent-session-manager.test.ts`、`channel-runtime-api-key.test.ts` 纯 bun 下无法 import electron 命名导出，未变差）
  - `cd apps/electron && rm -rf out && bun run smoke:pack` ✅ 未签名 dir 包 `out/mac-arm64/Linguist Agent.app`
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**，exit 0
- **knownLimitations**：
  - 维护者仍可在 settings.json 写 `"agentRuntime": "claude"` 使新建会话走 Claude（刻意保留的逃生门，见 RUNTIME_POLICY.md §3）；
  - 打包 smoke 全部断言走 Chat 运行时路径（PB-004 起即如此），Pi agent 路径仍未被 smoke 覆盖；
  - 编辑历史 Claude 自动任务时，模型选择区仍可能出现「Agent 兼容渠道」提示分支（隐藏路径兼容，不影响新建）。
- **rollback**：`git reset --hard f13f1557`（环境侧可选 `rm -rf apps/electron/out`）

## PB-012：隐藏 v1 不需要的产品面（D-007，统一 Feature Flags）

- **状态**：`packaged_app_verified`（打包应用 18/18 断言通过；typecheck 6/6；`bun test` 488 pass / 2 既有环境失败与基线一致）
- **依赖**：PB-011 ✅
- **baseCommit**：PB-011 的 resultCommit（`d8954aac`）
- **resultCommit**：`SELF`
- **产品决策**：D-007——v1 不包含第三方扩展市场、团队/自动化/远程机器人等产品面。隐藏不删除：全部开关集中在唯一模块 `apps/electron/src/renderer/lib/feature-flags.ts`（无散落 `if (false)`），任一开关改回 `true` 即恢复对应产品面，无需其他改动。完整清单与恢复方式见 `docs/architecture/FEATURE_FLAGS.md`。
- **开关清单（全部默认 `false`）**：
  - `AGENT_RUNTIME_SWITCHER_VISIBLE`（D-002/PB-011，本票从 `lib/runtime-policy.ts` 迁入统一模块，3 个消费方已改 import；原文件删除）
  - `REMOTE_BOTS_SETTINGS_VISIBLE`：设置「远程连接」标签页（BotHubSettings：飞书/钉钉/微信 Bot 配置 + 用法页 + PromaLogoSettings 品牌素材页）
  - `AUTOMATIONS_VISIBLE`：侧边栏自动任务入口（展开态 + 收起态 Rail）、侧边栏合成「自动任务」会话分组、主区 automations 路由与任务表单（MainArea 回落普通会话视图）、消息内「来自 Proma 定时任务」徽章
  - `PROMA_PROMO_VISIBLE`：渠道设置 Proma 商业版推广卡（proma.cool）、ChannelForm 第三方 Base URL 风险弹窗内商业版推广段落、通用设置「Git/PR 标识」推广开关
- **改动文件**：
  - `apps/electron/src/renderer/lib/feature-flags.ts`（新增，统一开关模块）
  - `apps/electron/src/renderer/lib/feature-flags.test.ts`（新增 5 条：开关集合完整性 + 各开关默认 false 守卫）
  - `apps/electron/src/renderer/lib/runtime-policy.ts`（删除，迁入 feature-flags.ts）
  - `apps/electron/src/renderer/components/settings/SettingsPanel.tsx`（`BOTS_TAB` 由开关门控）
  - `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（自动任务展开入口 / Rail 按钮 / 合成分组门控）
  - `apps/electron/src/renderer/components/tabs/MainArea.tsx`（automations 路由 + 表单渲染门控）
  - `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`（`ScheduledRunBadge` 门控）
  - `apps/electron/src/renderer/components/settings/ChannelSettings.tsx`（`PromaProviderCard` 门控 + import 迁移）
  - `apps/electron/src/renderer/components/settings/ChannelForm.tsx`（推广段落门控）
  - `apps/electron/src/renderer/components/settings/GeneralSettings.tsx`（Git/PR 标识开关门控）
  - `apps/electron/src/renderer/components/agent/AgentView.tsx`、`automation/AutomationFormView.tsx`（import 迁移至 feature-flags）
  - `docs/architecture/FEATURE_FLAGS.md`（新增）、`docs/architecture/RUNTIME_POLICY.md`（引用更新）
  - 账本（本文件 + `execution-ledger.json`）
- **保留未动**：主进程 Bridge/调度器/IPC 全部原样（`feishu-bridge*.ts`、`dingtalk-bridge*.ts`、`wechat-bridge.ts`、`automation-manager.ts`、`main/ipc.ts` 对应段落），已配置的 Bridge 与定时任务照常运行；chat / agent(Pi) / workspace / channels / skills / memory 等 v1 面未动。
- **刻意保持可见（判断记录）**：教程横幅与教程 Tab（PB-010 已改品牌为 Linguist Agent 教程，属功能性 onboarding 非营销）；MemorySettings 的 Nowledge「实验性」平台说明与 AboutSettings 的 WSL（实验性）选项（第三方集成说明，非独立实验性产品面）。
- **实测结果**：
  - `bun run typecheck` ✅ 6/6 exit 0
  - `bun test` ✅ 488 pass / 2 fail（483 基线 + 新增 5 条；2 条失败为 PB-003 起既有上游环境限制，未变差）
  - `cd apps/electron && bun run smoke:pack` ✅ 未签名 dir 包 `out/mac-arm64/Linguist Agent.app`
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**，exit 0
- **knownLimitations**：
  - 「Git/PR 标识」仅隐藏开关 UI，主进程 git attribution 默认仍开启（`Made-with: Proma` trailer 仍会附加）；是否改默认属独立品牌决策，建议后续品牌票处理；
  - SettingsPanel 教程 Tab label 仍为「Proma 教程」（文案品牌遗留，建议深度文案票处理）；
  - 已存在的自动任务会话在开关关闭时不出现在侧边栏任何分组（任务照常执行；开关恢复即回归）；
  - 打包 smoke 全部断言走 Chat 运行时路径（PB-004 起即如此），被隐藏面的恢复路径未被 smoke 覆盖。
- **rollback**：`git reset --hard d8954aac`（环境侧可选 `rm -rf apps/electron/out`）

## PB-013：Projects 导航壳

- **状态**：`packaged_app_verified`（打包应用 18/18 断言通过；typecheck 6/6；`bun test` 489 pass / 2 既有环境失败与基线一致）
- **依赖**：PB-012 ✅
- **baseCommit**：PB-012 的 resultCommit（`ebac1978`）
- **resultCommit**：`SELF`
- **范围**：产品 IA（计划 §9.2）侧边栏新增「项目」入口（位于 Chats 与设置之间）+ 主区 `projects` 视图路由 + 空状态壳页。仅导航壳：**不含** CAT、项目存储、IPC、创建逻辑，未动任何 Proma 会话逻辑；项目数据层与项目内 Chat / CAT / QA / Artifacts / Files 顶栏属 Batch 3。
- **开关**：新增 `LINGUIST_PROJECTS_VISIBLE = true`（`lib/feature-flags.ts`）——Projects 是 v1 FEATURE，默认可见，开关为对称与未来门控预留；改为 `false` 时侧边栏入口隐藏、MainArea projects 路由回落普通会话视图。已登记 `docs/architecture/FEATURE_FLAGS.md`（该文件标题与守卫测试同步更新：D-002/D-007 开关默认 false，本开关为例外默认 true）。
- **改动文件**：
  - `apps/electron/src/renderer/lib/feature-flags.ts`（新增开关）
  - `apps/electron/src/renderer/lib/feature-flags.test.ts`（开关集合完整性断言同步 + 新增 1 条：本开关默认 true）
  - `apps/electron/src/renderer/atoms/active-view.ts`（`ActiveView` 联合类型新增 `'projects'`）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx`（新增，空状态壳：标题「项目」+ 简述 + 「新建项目」占位按钮，点击 toast 提示「即将推出：项目功能将在后续版本提供」；布局约定对齐 AutomationsListView，自带 titlebar-drag-region）
  - `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（新增 `ProjectsSidebarEntry` 组件（样式对齐 AutomationSidebarEntry，无徽章）+ `handleOpenProjects` 切换回调；展开态条目插入对话列表与「已归档」入口之间，收起态 Rail 按钮插入底部设置头像上方；均用原生 `<button type="button">` 可键盘聚焦，样式/聚焦行为与既有条目一致）
  - `apps/electron/src/renderer/components/tabs/MainArea.tsx`（`activeView === 'projects'` 全屏路由（取代 TabBar + TabContent，同 automations/agent-skills 模式）+ 开关关闭时的回落门控）
  - `docs/architecture/FEATURE_FLAGS.md`（登记新开关）、账本（本文件 + `execution-ledger.json`）
- **验收对照**：
  - 侧边栏：展开态与收起态 Rail 均有「项目」入口，图标 + 标签 + active 态 + 键盘可聚焦，点击切换主区视图，再次点击回落对话视图 ✅
  - Tab/Session 原行为无回归：未触碰 tab-atoms / 会话逻辑；`bun test` 与打包 smoke（含会话持久化、重启恢复断言）全绿 ✅
  - 窄窗口可用：收起态 Rail 底部含「项目」按钮（FolderOpen 图标 + Tooltip「项目」）✅
  - 键盘聚焦：入口为原生 button，可 Tab 聚焦，focus ring 与其他条目一致（沿用相同 className 模式）✅
- **实测结果**：
  - `bun run typecheck` ✅ 6/6 exit 0
  - `bun test` ✅ 489 pass / 2 fail / 491 tests / 64 files（488 基线 + 新增 1 条；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `cd apps/electron && bun run smoke:pack` ✅ 未签名 dir 包 `out/mac-arm64/Linguist Agent.app`
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**，exit 0
- **knownLimitations**：
  - 「新建项目」为占位：仅 toast 提示，无创建逻辑/对话框/数据层（Batch 3 接入）；
  - 新代码目录约定 `features/linguist/` 由 PB-014 正式化，本票先行落地首个文件；
  - 打包 smoke 不覆盖 projects 路由点击路径（smoke 断言走 Chat 运行时路径，PB-004 起即如此）；projects 入口为纯渲染层切换，无 IPC。
- **rollback**：`git reset --hard ebac1978`（环境侧可选 `rm -rf apps/electron/out`）

## PB-014：上游修改边界测试（Proma Core Touchpoints 登记 + 边界强制）

- **状态**：`unit_verified`（边界测试正/反向断言 + 负向实测均通过；typecheck 6/6；`bun test` 无回归。本票为 docs/test-only，打包 smoke 不适用，未重跑 smoke:pack）
- **依赖**：PB-013 ✅
- **baseCommit**：PB-013 的 resultCommit（`ba548207`）
- **resultCommit**：`SELF`
- **范围**：建立（1）Proma 核心修改登记册——自基线 `702a8221` 起全部 39 个触点（人读 `docs/architecture/PROMA_CORE_TOUCHPOINTS.md` + 机读 `docs/architecture/proma-touchpoints.json`，每条含票号与原因，按 PB 票分组）；（2）自动化边界测试 `tests/upstream-boundary.test.ts`（3 条：登记册格式良构；diff vs 基线无未登记改动；无 stale 登记条目）；（3）根脚本 `bun run check:boundaries`。
- **规则（写入 PROMA_CORE_TOUCHPOINTS.md，对后续批次生效）**：新 LA 代码必须进约定路径（`renderer/features/linguist/`、`main/lib/linguist/`、`packages/linguist-*/`、`resources/linguist-skills/`、`tests/`、`docs/`、`apps/electron/scripts/smoke/`；白名单另含 `.gitignore`/`NOTICE.md`/`ATTRIBUTION.md`/`README*`）；修改任何 Proma 核心文件必须在**同一 commit** 内登记 JSON + MD（票号 + 原因）；边界测试即强制执行。
- **触点统计（39 条，按主票归组；6 条为多票共改）**：PB-004 ×2（apps/electron/package.json、bun.lock）；PB-010 ×18（electron-builder.yml、图标 ×8、generate-icons.sh、generate-la-icon.mjs、main/index.ts、menu.ts、tray.ts、index.html、App.tsx + 6 个 shell 组件品牌文案、AboutSettings 归属行）；PB-011 ×3（feishu-bridge.ts、settings-service.test.ts、AgentView/AutomationFormView/ChannelSettings 门控中归 PB-011 的 3 文件计入主票）；PB-012 ×8（feature-flags.ts/.test.ts、SettingsPanel、LeftSidebar、MainArea、SDKMessageRenderer、ChannelForm、GeneralSettings 等）；PB-013 ×3（active-view.ts、LeftSidebar、MainArea 的 PB-013 部分）；PB-014 ×1（根 package.json 新增 check:boundaries）。多票共改 6 文件：apps/electron/package.json、AgentView.tsx、AutomationFormView.tsx、ChannelSettings.tsx、LeftSidebar.tsx、MainArea.tsx。
- **边界测试行为**：比较 `git diff --name-only <baseline>...HEAD`（HEAD 已提交内容，未提交改动不在 diff 中），故须 pre-push/门禁运行；git 不可用或基线缺失时打印警告跳过，不令套件失败。
- **实测结果**：
  - `bun run typecheck` ✅ 6/6 exit 0
  - `bun test`（提交前）491 pass / 3 fail：2 条既有环境失败 + 1 条边界 stale-check（package.json 改动尚未提交，符合「比较 HEAD」的预期行为）；提交后复跑见下
  - **负向实测（证明测试会正确失败）**：临时 commit `2a0485a6`（改动未登记的 `apps/electron/src/main/lib/chat-service.ts` + 新建越界文件 `apps/electron/src/renderer/components/StrayLaWidget.ts`）→ `bun run check:boundaries` **FAIL**，报错准确列出两个越界文件（"Unregistered Proma-core modifications detected"），exit 1 → `git reset --hard HEAD~1` 还原，工作区干净
  - 提交后：`bun run check:boundaries` ✅ 3/3 pass；`bun test` ✅ 492 pass / 2 fail（2 条为 PB-003 起既有上游环境限制，未变差）
- **knownLimitations**：
  - 未提交/未跟踪改动不在 diff 中，本地开发期间测试可能漏报——须在 pre-push/CI 门禁运行；
  - 打包 smoke 本票不适用（docs/test-only），未重跑；
  - colocated 测试（settings-service.test.ts、feature-flags.test.ts）与 feature-flags.ts 属 LA 新文件但位于 Proma 目录（上游 colocated 惯例 / 需被 Proma 组件直接 import），已登记为例外触点。
- **rollback**：`git reset --hard ba548207`

## G1 门禁：Batch 1 收口（计划 §14 / §28）

- **状态**：`gate_passed`（四项门禁标准全绿；详见 `docs/roadmap/G1_REPORT.md`）
- **依赖**：PB-014 ✅
- **baseCommit**：PB-014 的 resultCommit（`c4bb4c6f`）
- **resultCommit**：`SELF`
- **范围**：门禁执行 + 测试基础设施。新增 G1 Pi 流式探针（补齐 G0 未覆盖的 Pi AGENT 路径打包冒烟），不改任何产品运行时代码（src/ 下零改动）。
- **改动文件**：
  - `apps/electron/scripts/smoke/probe-pi-stream.ts`（新增，PB-014 白名单路径）
  - `apps/electron/package.json`（新增 `smoke:g1` 脚本；该文件为 PB-004 已登记触点）
  - `docs/roadmap/G1_REPORT.md`（新增，逐项 PASS/FAIL + 实际日志证据）
  - 账本（本文件 + `execution-ledger.json`）
- **门禁逐项结果**：
  1. 原有 packaged smoke 仍全绿 ✅ `node scripts/smoke/run-g0-smoke.ts` → **18 PASS / 0 FAIL**，exit 0（第 3 次运行；前 2 次各 1 个互不相同的 harness 层 UI 自动化抖动，非产品断言失败，详见 G1_REPORT.md §5）
  2. LA 品牌 App 能打开 ✅ `Linguist Agent.app` 启动，首屏品牌断言 `[PASS] main-window-loaded — …「欢迎使用 Linguist Agent 下一代桌面 AI 软件…」（首启 Onboarding 门禁页）`
  3. Pi 能流式回答 ✅ `node scripts/smoke/probe-pi-stream.ts` 首次运行 **12 PASS / 0 FAIL**，exit 0：`fake-text` 场景 5 个 `_partial` 文本事件（含无最终标记的中间帧）+ STREAM_COMPLETE 恰好 1 次；`fake-thinking` 场景 6 个 `_partial` thinking 事件含 `REASONING_DELTA_MARKER_G0` + STREAM_COMPLETE 恰好 1 次；fake server 日志证明请求由 Pi 路径发出（`#1 fake-text stream=true → 200`、`#2 fake-thinking stream=true → 200`）
  4. 静态检查 ✅ `bun run typecheck` 6/6 exit 0；`bun test` 492 pass / 2 fail（2 条为 PB-003 起既有上游环境限制：纯 Bun 下 electron 命名导出不可 import，与基线一致）；`bun run check:boundaries` 3/3 pass（提交后复跑同）
- **knownLimitations**：
  - G0 runner 存在 harness 层 UI 抖动（本轮 3 跑 2 抖，失败点互不相同且均为自动化时序问题；产品代码与 PB-013 连续 18/18 验证版本逐字节一致）——若复现率升高应开 PB-FIX 加固 runner；
  - runner/probe 必须用系统 Node（≥22.18）运行，bun 下 playwright-core ws 握手挂起（PB-004 发现）；
  - safeStorage 明文兜底、未签名包自动更新 ENOENT 为打包 smoke 环境既有预期行为；
  - Pi 探针为事件级断言（真实 IPC 订阅），未做 Agent 模式 DOM 断言；未覆盖 Pi 工具执行/权限路径。
- **rollback**：`git reset --hard c4bb4c6f`（环境侧可选 `rm -rf apps/electron/out`）

## PB-020：CAT Extraction Matrix（CAT 抽取矩阵）

- **状态**：`unit_verified`（docs-only 票据；交付文档经逐节复核，`bun run check:boundaries` 通过；无代码改动，打包 smoke 不适用未重跑）
- **依赖**：PB-014 ✅
- **baseCommit**：G1 的 resultCommit（`939e52cb`）
- **resultCommit**：`SELF`
- **范围**：按重建计划 §15 PB-020，在复制任何代码之前识别旧 LA（`legacy/platform` 冻结分支）中真正值得迁移的 CAT 领域资产，产出 `docs/migration/CAT_EXTRACTION_MATRIX.md`（新增，唯一交付物）。分析方法：旧仓 `packages/` 全量清点（7 包 324 个 src 文件）+ 每文件 import 耦合扫描 + 分组深读（含 4 路并行只读分析）+ 测试/fixture 密度统计 + 旧数据布局从代码反推（未读 `data/**` 客户内容）。
- **矩阵内容**：旧仓包清单；~90 个 CAT 候选文件逐行矩阵（当前路径/领域职责/依赖/纯度/耦合/现有测试/迁入目标/结论）；领域测试与 synthetic fixtures 清单（含 `tests/fixtures/memoq/sample.mqxliff`）；旧数据布局知识（`data/projects/<id>/project.json` 等，供 linguist-legacy-migration）；推荐抽取顺序 S1-S6 映射 PB-021/023/024（PB-021/023 标题为 §4 包序推断，已在文中标注需对照计划原文校准，PB-024=Store 有新仓证据）；绝对不迁移清单（逐条理由）；10 条风险（双存储分叉/审计泄漏/外部进程依赖/重复实现漂移/测试缺口/ICU 两处实现/游戏特化渗入/并发假设/jszip 依赖/客户数据隔离）。
- **头条结论**：`cat-formats` 全包 + cat-data 约 18 个纯域文件可 copy；~35 个文件 rewrite-small（内核值钱、IO/编排/外部进程依赖要换）；`cat-server`/`cat-runtime`/`cat-mcp` 整体黑名单。最大移植债：`workbook_mapping.ts` 内嵌 ~550 行 Python、`document_assets.ts` 依赖 python3/pdftotext、`tm_import.ts` 同步 sqlite3 CLI、`termbase.ts` 依赖 mdbtools CLI。测试缺口：`termbase/glossary/term_history/workbook_mapping/table_batch` 无专属测试。
- **未做**：未复制任何代码（本票分析-only）；未读取旧仓 `data/**`；旧仓零改动（完成后 `git -C /Users/<local>/Desktop/linguist-agent status --porcelain` 与票前基线逐字节一致，仅票前已存在的 5 条 untracked）。
- **验证**：
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；本票改动全部位于白名单 `docs/` 路径）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 计划原文（LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md）不在两个仓库内，PB-021/023 标题按 §4 包序推断，仅 PB-024=Store 有新仓证据（DEV_BASELINE_REPORT node:sqlite 探针）；
  - 旧仓测试为顶层 assert 脚本风格，矩阵中测试计数为 `assert.*` 调用数，非 test-runner 用例数；
  - Library/Memory（assistant_library/assistant_memory 及对应工具）去留为产品决策项，矩阵默认 do-not-port(v1 待定）。
- **rollback**：`git reset --hard 939e52cb`

## PB-021：建立 linguist-cat-core 纯领域包

- **状态**：`unit_verified`（新包 typecheck exit 0、31 条领域测试全绿、根 `bun run typecheck` 7/7、`bun test` 与基线一致无回归、`check:boundaries` 3/3；未接入 store/tools，integration 属后续票）
- **依赖**：PB-020 ✅
- **baseCommit**：PB-020 的 resultCommit（`ca49e312`）
- **resultCommit**：`SELF`
- **范围**：按计划 §4.1 建立纯 TypeScript CAT 领域包 `@linguist/cat-core`（`packages/linguist-cat-core/`），零运行时依赖、零 IO（不 import Proma/Pi/Electron/Node fs/SQLite/React）。**全部代码按计划 schema 全新编写，未从旧仓逐字复制任何行**（仅参考旧仓 `batch_workspace.ts` 的 `SegmentRevisionConflictError` 语义，已登记 SOURCE_PROVENANCE.md）。本票不含 QA 规则/标签规则（PB-052/PB-070 范围）。
- **改动文件**：
  - `packages/linguist-cat-core/package.json`（新增：`@linguist/cat-core`，private，type module，exports `./src/index.ts`，`typecheck` 脚本对齐 house style，零 dependencies）
  - `packages/linguist-cat-core/tsconfig.json`（新增：extends 根 tsconfig）
  - `packages/linguist-cat-core/src/ids.ts`（新增：branded id 类型 ProjectId/AssetId/SegmentId/ProposalId/QaFindingId；FNV-1a 64 位确定性哈希；可注入熵 `EntropySource` + `createSeededEntropy`；`generateProjectId` 随机、`derive*Id` 内容派生；格式校验器）
  - `packages/linguist-cat-core/src/errors.ts`（新增：`DomainError` 基类 + 6 个类型化错误，稳定 code：SEGMENT_LOCKED/REVISION_CONFLICT/STALE_PROPOSAL/UNKNOWN_SEGMENT/INVALID_STATE_TRANSITION/INVALID_ID；StaleProposalError 继承 RevisionConflictError）
  - `packages/linguist-cat-core/src/project.ts`（新增：`LinguistProject`（schemaVersion 1，计划 schema 逐字段）+ `createProject`/`archiveProject`）
  - `packages/linguist-cat-core/src/asset.ts`（新增：`Asset`（id/projectId/formatId/originalFilename/sourceSha256/segmentCount）+ `createAsset`）
  - `packages/linguist-cat-core/src/segment.ts`（新增：`Segment`（计划 schema）+ `SegmentRevision` + `applyTargetEdit`（CAS：revision 不匹配抛 RevisionConflictError，绝不覆盖；locked 抛 SegmentLockedError；每次接受写入产生 revision 条目）+ lock/unlock + 确定性 `compareSegments`/`sortSegments`）
  - `packages/linguist-cat-core/src/proposal.ts`（新增：`TranslationProposal`（计划 schema）+ 生命周期 create(pending)→accept/reject/supersede；`acceptProposal` 强制 baseRevision CAS + 非锁定 + pending，stale 抛 StaleProposalError；接受后段更新 + 提案 accepted + revision 条目 source='proposal'）
  - `packages/linguist-cat-core/src/qa-finding.ts`（新增：`QaFinding` 类型（计划 PB-070 schema）+ open→resolved/waived 状态机不变量，无规则引擎）
  - `packages/linguist-cat-core/src/index.ts`（新增：barrel）
  - `packages/linguist-cat-core/src/{ids,segment,proposal,qa-finding,errors,serialization}.test.ts`（新增：31 条测试——revision 递增+CAS 冲突、locked 拒绝编辑与接受提案、stale 提案类型化拒绝、accept 全链路、supersede/reject 语义、确定性 ID 与稳定排序、全实体 JSON 往返、错误 code 稳定性）
  - `docs/attribution/SOURCE_PROVENANCE.md`（登记：本票全新编写、无逐字复制）
  - `docs/architecture/proma-touchpoints.json`（allowedNewPaths `packages/linguist-` → `packages/linguist-*`：原条目与 PROMA_CORE_TOUCHPOINTS.md 文档的 `packages/linguist-*/` 语义不一致（匹配器只对含 `*` 或以 `/` 结尾的条目做前缀匹配），属本票首次触发的潜在 bug，按文档语义修正；docs/ 白名单内，无需触点登记）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留 PB-022+）**：QA 规则/标签规则/ICU（PB-052/PB-070）；格式 Adapter（PB-022）；持久化（PB-024）；包未被任何消费方 import（依赖方向 cat-core ← formats ← store ← tools，消费方属后续票）。
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-core' typecheck` ✅ exit 0（新包被根 workspaces `packages/*` 自动收编，无需改根配置）
  - `bun run typecheck` ✅ 7/7 包 exit 0（含新包）
  - `bun test` ✅ 523 pass / 2 fail（492 基线 + 新增 31；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；首次提交后曾因登记册 `packages/linguist-` 缺 `*` 前缀匹配失败，修正登记册后复跑通过；全部新文件位于白名单 `packages/linguist-*` 与 `docs/`）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - `SegmentContext` 计划只引用未定义，本包取最小形状（note/origin/meta），后续票如需扩展在此演进；
  - 打包 smoke 不适用（纯领域包，无 Electron 面）；
  - 根 `bun.lock` 未变（新包零运行时依赖，devDep typescript 由根已提供）。
- **rollback**：`git reset --hard ca49e312`

## PB-022：格式 Adapter 接口 + round-trip 测试 Harness

- **状态**：`unit_verified`（新包 typecheck exit 0、20 条测试全绿、根 `bun run typecheck` 8/8、`bun test` 543 pass 与基线一致无回归、`check:boundaries` 3/3；无具体真实格式——XLIFF/CSV/JSON 属 PB-023）
- **依赖**：PB-021 ✅
- **baseCommit**：PB-021 的 resultCommit（`ac154fec`）
- **resultCommit**：`SELF`
- **范围**：按计划 §6.1/§6.3 建立 `@linguist/cat-formats`（`packages/linguist-cat-formats/`）：`CatFormatAdapter` 接口（签名照计划 §6.1 原文）、`ImportedCatAsset` 类型（asset 信息 + 段 + warnings + originalBytes echo + sourceSha256）、Adapter Registry（register/list/detectAll/detectBest，按 detect 分数降序、同分稳定保持注册顺序）、通用 round-trip 测试 harness（`src/testing/` 子路径导出）、`FakeAdapter` 测试夹具（不注册进任何生产 registry）、类型化格式错误（稳定 code）。**全部代码全新编写，未从旧仓 cat-formats 逐字复制任何行**（已登记 SOURCE_PROVENANCE.md）。
- **关键设计**：
  - 导入时段无 `id`/`assetId`（store 尚未分配资产）：`ImportedCatSegment = Omit<Segment, 'id' | 'assetId'>`，绑定用 `bindImportedSegments(segments, assetId)`——ID 由 assetId+ordinal+key 内容派生，重导入稳定；
  - 格式错误不继承 cat-core `DomainError`（其 `code` 字段类型为封闭联合 `DomainErrorCode`，子类化新 code 会破坏类型契约），改为复刻同模式：`FormatError` 基类 + 4 个稳定 code（FORMAT_PARSE_ERROR/FORMAT_EXPORT_ERROR/FORMAT_SEGMENT_LOST/FORMAT_UNSUPPORTED）；
  - SHA-256 为纯 TS 无依赖实现（`src/hash.ts`，FIPS 180-4 新实现），运行时无关（Node/浏览器均可 import），`HashFn` 可注入；测试与 node:crypto 交叉验证；
  - registry 默认空：FakeAdapter 与 harness 经 `./testing` 子路径导出，生产 import 面保持精简；
  - harness `assertRoundTrip(adapter, bytes, opts)`：import → 校验 sourceSha256 已记录 → 确定性建 project/asset（cat-core 注入熵）→ 绑定段 ID → 未修改导出字节稳定断言（可关）→ 经 cat-core `applyTargetEdit` CAS 修改子集目标 → 以 originalBytes 为模板导出 → 重导入 → 断言计数相等、ID 相等且有序、源文未变、未修改目标一致、已修改目标已应用、adapter 不变量逐段成立。静默丢段抛 `FormatSegmentLostError`（含丢失段 ID），绝不降级为 warning。
- **改动文件**：
  - `packages/linguist-cat-formats/package.json`（新增：`@linguist/cat-formats`，private，deps 仅 `@linguist/cat-core: workspace:*`，`.` 与 `./testing` 两个 exports）
  - `packages/linguist-cat-formats/tsconfig.json`（新增：extends 根 tsconfig）
  - `packages/linguist-cat-formats/src/errors.ts`（新增：FormatError + 4 类型化错误）
  - `packages/linguist-cat-formats/src/hash.ts`（新增：纯 TS SHA-256 + HashFn）
  - `packages/linguist-cat-formats/src/adapter.ts`（新增：CatFormatAdapter/ImportedCatAsset/ImportedCatSegment/bindImportedSegments）
  - `packages/linguist-cat-formats/src/registry.ts`（新增：CatFormatRegistry）
  - `packages/linguist-cat-formats/src/index.ts`（新增：barrel）
  - `packages/linguist-cat-formats/src/testing/{index,harness,fake-adapter}.ts`（新增：harness + FakeAdapter/BadSegmentDropAdapter 负夹具 + encodeFakeTsv）
  - `packages/linguist-cat-formats/src/{errors,hash,registry}.test.ts`、`src/testing/harness.test.ts`（新增：20 条测试——SHA-256 标准向量+node:crypto 交叉验证；错误 code 稳定性；registry 注册/排序/魔数胜过扩展名/未知扩展名→FORMAT_UNSUPPORTED；harness 正路径（默认修改子集、空目标编辑、CJK/Unicode、不变量断言）；负路径（静默丢段→FORMAT_SEGMENT_LOST、非法 UTF-8/缺 TAB 行→FORMAT_PARSE_ERROR 带行号、非字节稳定导出→FORMAT_EXPORT_ERROR、谎报 sourceSha256→FORMAT_PARSE_ERROR））
  - `docs/attribution/SOURCE_PROVENANCE.md`（登记：全新编写、无逐字复制）
  - `bun.lock`（workspace 锁文件条目：`@linguist/cat-core` 与 `@linguist/cat-formats`，bun install 自动写入，无外部依赖；PB-004 已登记触点，本票追加登记）
  - `docs/architecture/proma-touchpoints.json` + `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`（bun.lock 条目改为 PB-004, PB-022 多票共改；条目总数 39 不变，多票共改文件 6 → 7）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留 PB-023+）**：具体真实格式 adapter（XLIFF/CSV/JSON 等，PB-023 每格式一个 commit）；store 接入（PB-024）；registry 未被任何生产消费方使用。
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-formats' typecheck` ✅ exit 0
  - `bun test packages/linguist-cat-formats` ✅ 20 pass / 0 fail
  - `bun run typecheck` ✅ 8/8 包 exit 0（含新包）
  - `bun test` ✅ 543 pass / 2 fail（523 基线 + 新增 20；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；全部新文件位于白名单 `packages/linguist-*` 与 `docs/`）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 段 ID 由 ordinal+key 派生：静默丢段除计数外露外还会引起后续段 ID 漂移（harness 负路径测试已固化该行为）；
  - 字节稳定断言默认开启，要求输入为规范形式（canonical）字节；PB-023 真实格式如无法满足需在 adapter 测试内显式关闭并记录理由；
  - 打包 smoke 不适用（纯领域包，无 Electron 面）；
  - `bun.lock` 仅增 workspace 条目（PB-021 的包因当时未跑 install 一并记入），无外部依赖变化。
- **rollback**：`git reset --hard ac154fec`

## PB-023：迁入格式 Adapter（XLIFF leg 1/3）

- **状态**：`unit_verified`（包 typecheck exit 0、35 条包内测试全绿、根 `bun run typecheck` 8/8、`bun test` 558 pass 与基线一致无回归、`check:boundaries` 3/3）
- **说明**：XLIFF leg（1/3）——本 commit 仅含 XLIFF/MXLIFF adapter；CSV 与 JSON leg 由后续 commit 各自追加账本记录。
- **依赖**：PB-022 ✅
- **baseCommit**：PB-022 的 resultCommit（`49d18af6`）
- **resultCommit**：`SELF`
- **范围**：`XliffAdapter`（`packages/linguist-cat-formats/src/adapters/xliff.ts`，id `xliff_1_2`，扩展名 `.xliff/.xlf/.mqxliff`）支持 XLIFF 1.2 `<xliff><file><body><trans-unit>` 与 memoQ MQXLIFF 变体：source/target 提取、inline 标签（`<g>`/`<x/>`/`<ph>`/`<bpt>/<ept>`）在段字符串中逐字保留、`translate="no"`（trans-unit 或 file 级）与 `mq:locked` → locked、`id`→key（`resname` 兜底，再兜底合成 `#tu-<ordinal>` 并记 warning）、`note`→context.note、`resname`→context.origin、空/缺失/自闭合 `<target>` → 空 target + untranslated、`state`/`state-qualifier`/`mq:status` 保守状态映射（adapter 文件头有完整文档）、XML 实体与 CDATA、Unicode/CJK。导出为模板式：以 originalBytes 为模板按 key 定位 trans-unit，目标未变的段字节不动（未修改导出逐字节稳定，harness 默认断言开启且通过），仅重写被改段的 `<target>`（缺失时插到 `<source>` 后，非空写入带 `state="translated"`）；未知 key / 缺失段 / 源文不符 / 锁定段目标被改 → FormatExportError，绝不静默跳过。
- **来源**：`xliff-xml.ts` 的 XML 工具函数逻辑复制自旧仓 `cat-formats/src/generic_xliff.ts`（风格适配），`sample.mqxliff` fixture 逐字复制（合成，已读核实）——均已登记 SOURCE_PROVENANCE.md；adapter 本体与 fixtures `mini_game_ui.xliff`/`placeholder_cases.xliff` 全新编写。
- **改动文件**：
  - `packages/linguist-cat-formats/src/adapters/xliff-xml.ts`（新增：无依赖 XML 工具函数，逻辑复制自旧仓 generic_xliff.ts）
  - `packages/linguist-cat-formats/src/adapters/xliff.ts`（新增：XliffAdapter，全新编写）
  - `packages/linguist-cat-formats/src/adapters/xliff.test.ts`（新增：15 条测试）
  - `packages/linguist-cat-formats/src/index.ts`（导出 XliffAdapter/XLIFF_ADAPTER_ID）
  - `tests/linguist-fixtures/mini_game_ui.xliff`、`tests/linguist-fixtures/placeholder_cases.xliff`（新增合成 fixture，本仓自写）
  - `tests/linguist-fixtures/sample.mqxliff`（旧仓合成 fixture 逐字复制）
  - `docs/attribution/SOURCE_PROVENANCE.md`（两条复制登记）
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-formats' typecheck` ✅ exit 0
  - `bun test packages/linguist-cat-formats` ✅ 35 pass / 0 fail（20 基线 + 新增 15）
  - `bun run typecheck` ✅ 8/8 包 exit 0
  - `bun test` ✅ 558 pass / 2 fail（543 基线 + 新增 15；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；`tests/` 与 `packages/linguist-*` 均在 allowedNewPaths 白名单，无需新增登记）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 不支持 XLIFF 2.0（`<unit>/<segment>`）——import 抛 typed FORMAT_PARSE_ERROR 明确说明；
  - MQXLIFF 回写不更新 `mq:status`/`mq:lastchangedtimestamp`，也不把 `<ph>/<bpt>/<ept>` 载荷解包成 val= 占位符（旧仓 mqxliff.ts 行为）——标签逐字往返替代；
  - trans-unit 缺主 `<target>` 时，`<alt-trans>` 内的 target 可能被误当主 target（与旧仓解析器同行为）；alt-trans 其余内容字节不动；
  - 被修改段按规范形重编码（文本转义、标签逐字、CDATA 不重包），与非规范原始字节形态可能不同但解码内容一致；未修改段逐字节稳定；
  - 打包 smoke 不适用（纯领域包）；`bun.lock` 未变（零新增依赖，未引入 @xmldom/xmldom——沿用旧仓手写 XML 工具）。
- **rollback**：`git reset --hard 49d18af6`


## PB-023：迁入格式 Adapter（CSV leg 2/3）

- **状态**：`unit_verified`（包 typecheck exit 0、49 条包内测试全绿、根 `bun run typecheck` 8/8、`bun test` 572 pass 与基线一致无回归、`check:boundaries` 3/3）
- **说明**：CSV leg（2/3）——本 commit 仅含 CSV/TSV adapter；JSON leg 由后续 commit 追加账本记录。
- **依赖**：PB-022 ✅
- **baseCommit**：PB-023 XLIFF leg 的 resultCommit（`8800b2d7`）
- **resultCommit**：`SELF`
- **范围**：`CsvAdapter`（`packages/linguist-cat-formats/src/adapters/csv.ts`，id `csv_rfc4180`，扩展名 `.csv/.tsv`）RFC-4180 风格解析：引号字段、`""` 转义、引号内嵌入换行、CRLF/LF/孤立 CR 行尾、UTF-8 BOM 剥离（导出时重挂，未修改导出逐字节稳定——需 `TextDecoder ignoreBOM: true`，默认会吞 BOM，已固化进测试）。TSV 为同一 parser + tab 分隔符（引号语义保留，文件头有文档）；分隔符由表头 sniff（comma/tab/semicolon 候选中表头字段最多者胜，`.tsv` 时 tab 优先，任何候选下表头 <2 字段 => FORMAT_PARSE_ERROR）。列映射默认别名（归一化：trim+小写+去 `[\s_/-]`）：key=key/id/segmentid/uniquekey/唯一键，source=source/src/sourcetext/源文/原文（必需，缺失 => FORMAT_PARSE_ERROR），target=target/tgt/translation/targettext/译文/翻译（缺失 => 全空 target 且导出拒绝写改动），locked=locked/lock/锁定（true/yes/1 => locked，导出只读不写回），context=context/note/notes/comment/备注（=> context.note）；全部可用 `new CsvAdapter({ columns })` 显式覆盖（显式名不在表头 => FORMAT_PARSE_ERROR）。无 key 列或 key 单元格为空 => 合成 `#row-<ordinal>` + warning（code `csv.synthesized_key`）；重复 key => FORMAT_PARSE_ERROR。状态映射刻意最小：空 target => untranslated，否则 translated。行字段多于表头 => FORMAT_PARSE_ERROR（绝不静默丢数据）；少于表头 => 补 ''（导出时若该段 target 被改则在记录末尾补写单元格）。未闭合引号、闭引号后有多余字符 => FORMAT_PARSE_ERROR。导出为模板式：以 originalBytes 为模板按 key 定位行，target 未变的行字节不动（harness 字节稳定断言开启且通过，含 BOM/CRLF 变体），仅重写被改行的 target 字段原始 span（含分隔符/引号/换行时按 RFC 加引号）；未知 key / 缺失段 / 源文不符 / 锁定行 target 被改 / 无 target 列而有改动 / 导出输入重复 key => FormatExportError，绝不静默跳过。
- **来源**：无逐字复制——adapter、fixtures、测试全部全新编写（仅参考旧仓 `cat-formats/src/table_csv.ts`/`table_columns.ts` 的列别名思路与 csv_paste 语义；旧解析器按行切分不支持引号内嵌换行、写出时整文件重编码不保字节，本实现为按 RFC-4180 + 模板 span 重写新写）——已登记 SOURCE_PROVENANCE.md。
- **改动文件**：
  - `packages/linguist-cat-formats/src/adapters/csv.ts`（新增：CsvAdapter，全新编写）
  - `packages/linguist-cat-formats/src/adapters/csv.test.ts`（新增：14 条测试）
  - `packages/linguist-cat-formats/src/index.ts`（导出 CsvAdapter/CSV_ADAPTER_ID/CsvColumnMapping/CsvAdapterOptions）
  - `tests/linguist-fixtures/mini_dialogue.csv`（新增合成 fixture，8 段游戏对白：quoted 逗号、引号内嵌换行、`""` 转义、CJK、空 target、1 锁定行、speaker 在 key/context）
  - `tests/linguist-fixtures/terminology.csv`（新增合成 fixture，term,translation,note 6 行，供后续 TB 票复用）
  - `docs/attribution/SOURCE_PROVENANCE.md`（一条全新编写登记）
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-formats' typecheck` ✅ exit 0
  - `bun test packages/linguist-cat-formats` ✅ 49 pass / 0 fail（35 基线 + 新增 14）
  - `bun run typecheck` ✅ 8/8 包 exit 0
  - `bun test` ✅ 572 pass / 2 fail（558 基线 + 新增 14；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；`tests/` 与 `packages/linguist-*` 均在 allowedNewPaths 白名单，无需新增登记）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 表头行必需（首个非空记录）；无表头 CSV 拒绝导入；
  - 非字段首字符的 `"` 按字面处理（宽松，偏离严格 RFC）；闭引号后仅允许分隔符/行尾/EOF，否则 typed error；
  - 空行被跳过（不携带数据，其字节保留在导出模板中）；
  - locked 列导出只读（锁定状态变化不写回，只重写 target 文本）；CSV 无审校状态，status 仅 untranslated/translated；
  - 分隔符按文件 sniff，文件内混用分隔符视为畸形将解析失败；
  - 打包 smoke 不适用（纯领域包）；`bun.lock` 未变（零新增依赖）。
- **rollback**：`git reset --hard 8800b2d7`

## PB-023：迁入格式 Adapter（JSON leg 3/3，本票收口）

- **状态**：`unit_verified`（包 typecheck exit 0、65 条包内测试全绿、根 `bun run typecheck` 8/8、`bun test` 588 pass 与基线一致无回归、`check:boundaries` 3/3）
- **说明**：JSON leg（3/3）——本 commit 仅含 JSON adapter；**PB-023 三条腿（XLIFF/CSV/JSON）至此全部完成，本票收口**。
- **依赖**：PB-022 ✅
- **baseCommit**：PB-023 CSV leg 的 resultCommit（`a34421e5`）
- **resultCommit**：`SELF`
- **范围**：`JsonAdapter`（`packages/linguist-cat-formats/src/adapters/json.ts`，id `json_i18n`，扩展名 `.json`）按计划 §6.2 可配置 key/value 映射。两种形状：（1）flat/嵌套 i18n 键值对象——字符串叶成段，key 为 dotted path（路径段转义 `\`→`\\`、`.`→`\.`，raw key 含字面点不会与嵌套分隔符冲突）；**flat 是源文件语义：source=叶值、target 从 '' 开始（匹配游戏本地化 JSON 源文件），导出把被改 target 写进叶值产出译文文件，重导入将译文读作新源文（预期产品流，文件头与测试均有文档）**；空字符串叶是段；数字/布尔/null/嵌套数组不是段、作为模板内容逐字节保留。（2）顶层条目数组——字段名默认 id/source/target/locked，可 `new JsonAdapter({ arrayMapping })` 覆盖（即可配置映射）；source 字段必需（非对象条目或缺字符串 source => 跳过 + `json.entry_skipped` warning，绝不静默）；id 缺失/为空/重复 => 合成 `#idx-<ordinal>` + `json.synthesized_key` warning（同 CSV leg 策略）；`locked: true`（严格布尔）=> locked 段；缺 target 字段 => ''，导出被改时在 source 字段后插入 `"target": "..."`（空白风格按文件 sniff）。解析器为严格 RFC-8259 手写 parser（不用 JSON.parse），记录每个字符串/值 token 的 raw span + 解码值（`\"` `\\` `\uXXXX` 含代理对均解码）；重复 decoded key：import 取最后值（JSON.parse 语义）+ `json.duplicate_key` warning，导出拒绝（FormatExportError，按 key splice 有歧义绝不静默）；UTF-8 BOM 剥离解析、导出重挂（未修改导出逐字节稳定）。detect：二进制/非 UTF-8/非 JSON/无 i18n 内容 => 0；`.json`+内容 => 0.8；仅内容 => 0.4（低于 XLIFF/CSV 的 0.9/0.5，JSON 更通用）。导出模板式：未变 target 的叶字节不动（harness 字节稳定断言开启且通过，含 BOM 变体），仅重写被改叶的 raw span（JSON.stringify 规范转义）；未知 key / 缺失段 / 源文不符 / 锁定条目被改 / 导出输入重复 key / 模板含重复 raw key => FormatExportError。
- **来源**：无逐字复制——adapter、fixture、测试全部全新编写（旧仓无等价 span 跟踪 JSON 模板实现可参考；仅沿用 CSV leg 的合成 key/warning 策略）——已登记 SOURCE_PROVENANCE.md。
- **改动文件**：
  - `packages/linguist-cat-formats/src/adapters/json.ts`（新增：JsonAdapter，全新编写）
  - `packages/linguist-cat-formats/src/adapters/json.test.ts`（新增：16 条测试）
  - `packages/linguist-cat-formats/src/index.ts`（导出 JsonAdapter/JSON_ADAPTER_ID/JsonArrayMapping/JsonAdapterOptions）
  - `tests/linguist-fixtures/mini_items.json`（新增合成 fixture，8 段游戏物品：嵌套分组、CJK、`{count}` 占位符、`\n`/`\"`/`\\`/`\u00e9` 转义、空字符串叶、version/premium_only/event_end 非字符串叶）
  - `docs/attribution/SOURCE_PROVENANCE.md`（一条全新编写登记）
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-formats' typecheck` ✅ exit 0
  - `bun test packages/linguist-cat-formats` ✅ 65 pass / 0 fail（49 基线 + 新增 16）
  - `bun run typecheck` ✅ 8/8 包 exit 0
  - `bun test` ✅ 588 pass / 2 fail（572 基线 + 新增 16；2 条失败为 PB-003 起既有上游环境限制：agent-session-manager、channel-runtime-api-key 纯 Bun 下无法 import electron 命名导出，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；`tests/` 与 `packages/linguist-*` 均在 allowedNewPaths 白名单，无需新增登记）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - flat 形状的导出是「源文件 => 译文文件」语义（译文写进叶值），harness 的 source 保持断言不适用于被改叶——harness 对 flat 以 `modify: () => null` 验证字节稳定/绑定/重导入路径，被编辑导出的精确 splice 与重导入语义由专项测试固化；
  - 嵌套数组为不透明模板内容，其中字符串不成段（条目列表请用顶层数组形状）；
  - 缺失 target 字段的插入为行内（source 字段后 `, "target": "..."`，空格风格按文件 sniff），不复刻多行缩进；
  - locked 标志导出只读（锁定状态变化不写回，只重写 target 文本）；
  - 被编辑叶按 JSON.stringify 规范重编码（转义风格可能与原始 raw 形态不同，解码内容一致）；未动叶逐字节稳定；
  - 打包 smoke 不适用（纯领域包）；`bun.lock` 未变（零新增依赖）。
- **rollback**：`git reset --hard a34421e5`

## PB-024：建立 linguist-cat-store（每项目 SQLite 存储）

- **状态**：`unit_verified`（新包 typecheck exit 0、40 条 node --test 存储测试全绿、根 `bun run typecheck` 9/9、`bun test` 与基线一致无回归、`check:boundaries` 3/3；未接入 Electron 主进程/CLI，integration 属 PB-025+）
- **依赖**：PB-023 ✅
- **baseCommit**：PB-023 JSON leg 的 resultCommit（`8a127727`）
- **resultCommit**：`SELF`
- **范围**：按计划 §5.2/§5.4/§5.7 建立 `@linguist/cat-store`（`packages/linguist-cat-store/`）：每项目一个 `cat.db`（node:sqlite DatabaseSync），`projects.json` 项目索引 + 项目目录骨架，schema migrations（fail-closed），五个 repository（assets/segments/proposals/qa_findings/exports），VACUUM INTO 备份，只读打开模式。依赖 `@linguist/cat-core`（领域不变量全部由领域层执行）+ `@linguist/cat-formats`（ImportedCatAsset 绑定）。**全部代码全新编写，未从旧仓 storage-sqlite 复制任何行**（仅参考其 pragma/schema_migrations 模式，已登记 SOURCE_PROVENANCE.md）。
- **关键发现（node:sqlite 兼容性，实测）**：
  - **bun 1.3.14 完全没有 node:sqlite**（`import 'node:sqlite'` 抛 "No such built-in module"）——store 测试**无法**在 `bun test` 下运行；
  - 系统 Node v22.22.2 可跑：node:sqlite 自 22.5 起免 flag；`.ts` 测试经 `--experimental-transform-types`（cat-core 用了 constructor parameter properties，strip-only 模式不支持）+ 自定义 ESM resolve hook（house 风格扩展名省略的相对导入）+ workspace 符号链接解析全部实测通过；
  - 结论：store 测试套件以 `*.nodetest.ts` 命名（bun 的 `.test.ts` 匹配器不会拾取，根 `bun test` 计数不变），由包内 `bun run test`（= `node --test`）运行；`node:sqlite` 经 createRequire 惰性加载，`probeSqliteRuntime()` 在任何运行时安全返回探针结果；
  - Electron 39.5.1（Node 22.22.0）`db.backup()` 不存在（Node 23.4+），备份走 `VACUUM INTO` 兜底——探针 `hasBackupApi` 供将来切换。
- **设计要点**：
  - 计划 §5.2 目录布局逐字实现（`projects.json` + `projects/<id>/{project.json,cat.db,source/,blobs/,exports/,backups/}`）；linguist 根目录**一律构造注入**，绝不硬编码 `~/.proma`（测试全用 mkdtemp）；
  - 迁移：`schema_migrations(version, applied_at, description)`，有序迁移列表逐条事务应用；磁盘 schema 比代码新 → `StoreSchemaTooNewError`（STORE_SCHEMA_TOO_NEW，fail closed，只读打开同样拒绝）；
  - pragma：WAL + synchronous=FULL + foreign_keys=ON + busy_timeout=5000（可写打开；只读打开跳过 journal_mode）；测试逐项断言（含 busy_timeout 返回列名为 `timeout`、synchronous FULL=2 的实测修正）；
  - 类型化 store 错误复刻 cat-formats 模式：`StoreError` 基类 + 稳定 code（STORE_SQLITE_UNAVAILABLE/STORE_SCHEMA_TOO_NEW/STORE_NOT_FOUND/STORE_INDEX_CORRUPT/STORE_READ_ONLY/STORE_BUSY/STORE_PROJECT_EXISTS）；领域错误（REVISION_CONFLICT/SEGMENT_LOCKED/STALE_PROPOSAL/...）原样穿透，绝不包装；
  - 所有多语句写入走 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` 事务助手：资产导入（asset+全部 segments 一个事务）、CAS 段编辑（segment 更新 + revision 条目一个事务）、提案接受（提案状态 + 段更新 + revision 条目一个事务，stale/locked 回滚）、QA rerun（删 open + 插新一个事务）；回滚由诱发失败测试固化；
  - CAS/锁定/提案生命周期全部委托 cat-core（applyTargetEdit/acceptProposal/...），store 不重新实现领域规则；QA rerun 语义：替换 open findings、保留 resolved/waived 历史、同内容复发重开（内容派生 id + INSERT OR REPLACE）；
  - projects.json 原子写（同目录 tmp+rename，无残留）；索引损坏 → STORE_INDEX_CORRUPT 明确报错，绝不猜测重置；
  - 备份：`VACUUM INTO backups/cat-<timestamp>.db` + 复制 project.json；备份文件可只读重开且数据完整（测试固化）；restore 属 PB-111；
  - 确定性：clock/entropy 全链可注入（迁移 applied_at、revision createdAt、备份时间戳、项目 id）。
- **改动文件**：
  - `packages/linguist-cat-store/package.json`（新增：`@linguist/cat-store`，deps `@linguist/cat-core`/`@linguist/cat-formats` workspace:*；`typecheck` 脚本对齐 house style；`test` 脚本 = node --test 运行器）
  - `packages/linguist-cat-store/tsconfig.json`（新增：extends 根 tsconfig）
  - `packages/linguist-cat-store/src/errors.ts`（新增：StoreError + 7 个类型化错误 + sqlite errcode 翻译）
  - `packages/linguist-cat-store/src/runtime.ts`（新增：`probeSqliteRuntime()` + createRequire 惰性加载 + node:sqlite 最小结构类型）
  - `packages/linguist-cat-store/src/schema.ts`（新增：SCHEMA_VERSION=1 + 迁移列表，计划 §5.4 九表逐字）
  - `packages/linguist-cat-store/src/database.ts`（新增：CatDatabase——pragma、迁移应用、fail-closed、只读打开、事务助手、错误翻译）
  - `packages/linguist-cat-store/src/project-index.ts`（新增：ProjectIndex——projects.json CRUD/archive、原子写、项目目录骨架、project.json 读写、损坏检测）
  - `packages/linguist-cat-store/src/project-database.ts`（新增：ProjectDatabase——一个 cat.db + 五个 repository 的句柄）
  - `packages/linguist-cat-store/src/repositories/{rows,assets,segments,proposals,qa-findings,exports}.ts`（新增：全部参数化 SQL，row↔domain 单一映射点）
  - `packages/linguist-cat-store/src/backup.ts`（新增：VACUUM INTO 备份 + project.json 复制，backup API 探测分支）
  - `packages/linguist-cat-store/src/store.ts`（新增：CatStore 门面——项目生命周期 + openProject + backupProject）
  - `packages/linguist-cat-store/src/index.ts`（新增：barrel）
  - `packages/linguist-cat-store/src/testkit.ts`（新增：mkdtemp/确定性 clock/seeded entropy/合成 ImportedCatAsset 助手）
  - `packages/linguist-cat-store/src/{runtime,database,project-index,assets,segments,proposals,qa-findings,exports,backup,store}.nodetest.ts`（新增：40 条测试，node --test 运行）
  - `packages/linguist-cat-store/test/{loader-hooks,register-ts-loader}.mjs`（新增：node 运行器的扩展名省略导入 resolve hook，bun 从不加载）
  - `bun.lock`（workspace 锁文件条目，bun install 自动写入，无外部依赖；PB-004/PB-022 已登记触点，本票追加登记）
  - `docs/architecture/proma-touchpoints.json` + `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`（bun.lock 条目改为 PB-004, PB-022, PB-024 多票共改；条目总数 39 不变，多票共改文件 7 不变）
  - `docs/attribution/SOURCE_PROVENANCE.md`（登记：整包全新编写、无逐字复制）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留 PB-025+）**：restore（PB-111）；TM/TB 功能（term_entries/tm_units 仅建表，Batch 8）；source/blobs 内容写入（导入管道落 source 原始字节属 CLI/IPC 票）；Electron 主进程/CLI 接入（PB-025）；迁移扫描器（只读打开已备好）。
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-store' typecheck` ✅ exit 0
  - `cd packages/linguist-cat-store && bun run test` ✅ **40 pass / 0 fail**（node v22.22.2 --test；含迁移应用+too-new 拒绝、pragma 逐项、项目索引 CRUD/归档/损坏、1000 段单事务导入 sanity（<5s 断言，实测毫秒级）、CAS 成功/冲突/锁定、revision 历史、提案 accept/reject/supersede/stale+回滚、QA rerun 替换+状态机、exports 记录、备份只读重开数据完整、只读模式逐 repository 拒写）
  - `bun run typecheck` ✅ 9/9 包 exit 0（含新包）
  - `bun test` ✅ 588 pass / 2 fail（与 PB-023 基线逐数一致；`*.nodetest.ts` 不被 bun 拾取已实测确认；2 条失败为 PB-003 起既有上游环境限制，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交后复跑；全部新文件位于白名单 `packages/linguist-*` 与 `docs/`）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - bun 无 node:sqlite → 该包测试必须在 node 下跑（包内 `test` 脚本；根 `bun test` 不覆盖本包）；
  - `db.backup()` 在当前 Node/Electron 不存在，备份固定走 VACUUM INTO（探针 `hasBackupApi` 分支为将来 Node≥23.4 预留，当前死代码路径，未被测试覆盖）；
  - VACUUM INTO 目标已存在会失败——备份时间戳注入，同毫秒重复备份会报错（未做冲突重命名）；
  - node:sqlite 行为实测修正：synchronous FULL 查询值为 2、busy_timeout 查询列名为 `timeout`、`.get()` 返回 null-prototype 对象（deepEqual 需展开）；
  - 打包 smoke 不适用（纯存储包，无 Electron 面）。
- **rollback**：`git reset --hard 8a127727`

## PB-025：Headless CAT CLI Vertical Slice（含 store source blob 能力 + interim 最小 QA）

- **状态**：`integration_verified`（CLI 端到端切片以真子进程对 xliff/csv/json 三格式全通过：建项目→导入→列段→CAS 编辑→QA→导出→重导入比对，含全部正反路径与进程内只读重开库审计断言；typecheck 9/9、`bun test` 588/2 与基线一致、store nodetests 59/59、`check:boundaries` 3/3；无 Electron 面，不声明 packaged/real_machine）
- **依赖**：PB-024 ✅
- **baseCommit**：PB-024 的 resultCommit（`e450103c`）
- **resultCommit**：`SELF`
- **范围**：按计划 G2 前要求实现 headless CAT CLI 垂直切片。CLI 落于 `packages/linguist-cat-store/src/cli.ts`（§4 包清单无独立 CLI 包，入 cat-store 不丑化），node 下运行（node:sqlite），与包测试同一套 runner flags；7 子命令 `create-project/import/segments/edit/qa/export/verify`；`runCli(argv, io)` 注入 IO、`--seed`/`--now` 注入熵/时钟；stdout `key: value` + 集合 JSONL，stderr `error[<CODE>]`，退出码 0/1/2/3/4/5/6（用法/未找到/领域拒绝/格式错误/verify 不一致）。**同时补齐 PB-024 交接缺口**：`ProjectDatabase.saveAssetSource/readAssetSource`——原始字节持久化 `source/<assetId><ext>`（原子写、读写两侧校验 `sourceSha256`，新增稳定错误码 `STORE_ASSET_SOURCE_MISMATCH`，只读句柄拒写），主进程导入管道后续复用同一能力。**interim 最小 QA**（`src/minimal-qa.ts`，EMPTY_TARGET + {curly}/`<tag>` 占位符多重集比对，输出 cat-core `OpenQaFindingInput`，三处标注 interim，PB-070 替换，刻意不做成规则引擎）。全部代码全新编写（已登记 SOURCE_PROVENANCE.md）。
- **改动文件**：
  - `packages/linguist-cat-store/src/cli.ts`（新增：CLI 本体 + 文档化调用/退出码头注释）
  - `packages/linguist-cat-store/src/minimal-qa.ts`（新增：interim 最小 QA）
  - `packages/linguist-cat-store/src/asset-source.ts`（新增：source blob 文件名/原子写/读取助手）
  - `packages/linguist-cat-store/src/project-database.ts`（新增 `sourceDir`/`saveAssetSource`/`readAssetSource`）
  - `packages/linguist-cat-store/src/errors.ts`（新增 `STORE_ASSET_SOURCE_MISMATCH` + `StoreAssetSourceMismatchError`）
  - `packages/linguist-cat-store/src/index.ts`（barrel 导出新错误类与 `assetSourceFileName`）
  - `packages/linguist-cat-store/src/asset-source.nodetest.ts`（新增 7 条）、`src/minimal-qa.nodetest.ts`（新增 8 条）、`src/cli-slice.nodetest.ts`（新增 4 条：3 条逐格式端到端切片 + 1 条退出码矩阵）
  - `packages/linguist-cat-store/package.json`（新增 `cli` 脚本 = 文档化 node 调用）
  - `docs/attribution/SOURCE_PROVENANCE.md`（一条全新编写登记）
  - 账本（本文件 + `execution-ledger.json`）
- **未做**：QA Core（PB-070）；UI/IPC/Agent Tool（G2 后批次）；重复导入/同毫秒重复导出的冲突重命名（如实记为限制）；restore（PB-111）；TM/TB（Batch 8）。
- **验证（实测）**：
  - `bun run --filter='@linguist/cat-store' typecheck` ✅ exit 0
  - `cd packages/linguist-cat-store && bun run test` ✅ **59 pass / 0 fail**（40 基线 + 19 新增：asset-source 7、minimal-qa 8、cli-slice 4；切片每格式 ~16 次真 CLI 子进程调用，断言含未修改导出逐字节稳定、CAS 冲突 exit 4 + 正确 revision 成功、锁定段拒绝、QA 发现 planted 空目标与人为占位符失配、export→verify OK、篡改导出 exit 6、库内 exports 审计与 revision 历史）
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test` ✅ 588 pass / 2 fail（与 PB-024 基线逐数一致；2 条为 PB-003 起既有上游环境限制，未变差）
  - `bun run check:boundaries` ✅ 3/3 pass（提交前 + 提交后复跑）
  - 手工证据跑（`/tmp/g2-evidence-*` 三格式完整切片，真实输出摘录见 `docs/roadmap/G2_REPORT.md` §4）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - CLI 必须在 node 下运行（bun 无 node:sqlite）；`bun run cli` 仅为 spawn node 的壳；
  - 最小 QA 为 interim（两条规则；inline 标签逐字比对，合法改写标签属性的译文会误报），PB-070 整体替换；
  - 重复导入同一文件以 sqlite 主键冲突失败（退出码 1，未类型化）；同毫秒同内容重复导出会使审计记录 id 冲突；
  - `--now` 为单次调用常量；`segments --limit` 默认 500（export/qa/verify 内部自动分页取全量）；
  - 打包 smoke 不适用（纯 CLI/存储面）。
- **rollback**：`git reset --hard e450103c`

## G2 门禁：Batch 2 收口 — CLI Vertical Slice 完全通过（计划 §14）

- **状态**：`gate_passed`（门禁唯一硬标准达成：CLI 垂直切片对全部三种 fixture 格式完整通过；详见 `docs/roadmap/G2_REPORT.md`）
- **依赖**：PB-025 ✅
- **baseCommit**：PB-025 的 resultCommit（`SELF`，门禁执行与切片实现同提交）
- **resultCommit**：`SELF`
- **范围**：门禁执行 + 报告。新增 `docs/roadmap/G2_REPORT.md`（逐格式逐阶段真实 CLI 输出证据 + 全部验证命令与结果 + 环境 + 已知限制）；零产品代码改动（CLI/测试属 PB-025 本体）。
- **改动文件**：
  - `docs/roadmap/G2_REPORT.md`（新增）
  - 账本（本文件 + `execution-ledger.json`）
- **门禁逐项结果**：
  1. CLI Vertical Slice 完全通过（三格式）✅ — XLIFF/CSV/JSON 各在独立 mkdtemp root 走通 create-project→import→segments→CAS edit→qa→export→verify 全阶段；正反路径实测：CAS 陈旧 revision exit 4（`REVISION_CONFLICT`）、正确 revision 成功、锁定段 exit 4（`SEGMENT_LOCKED`，xliff/csv 两腿；json fixture 无 locked 条目已如实记录）、QA 发现 planted 空目标与人为占位符失配（rerun 后消除）、未修改导出逐字节稳定、export→verify `verify: OK`、篡改导出 exit 6 并指名 mismatch 段（真实输出证据见 G2_REPORT.md §4.1–4.3）
  2. 静态检查与测试基线 ✅ — `bun run typecheck` 9/9 exit 0；`bun test` 588 pass / 2 fail（2 条为 PB-003 起既有上游环境限制，与基线一致）；`cd packages/linguist-cat-store && bun run test` 59 pass / 0 fail；`bun run check:boundaries` 3/3（提交前 + 提交后复跑）
  3. Hermetic ✅ — 无网络、无真实用户数据、synthetic fixtures + mkdtemp roots、`--seed`/`--now` 注入保证确定性、无后台残留（G2_REPORT.md §5）
- **knownLimitations**：
  - CLI 必须 node 运行（node:sqlite；Electron 主进程接入天然满足）；
  - 最小 QA 为 interim，PB-070 替换（三处标注）；
  - 重复导入/同毫秒重复导出的冲突未类型化（见 PB-025 条目）；
  - 打包 smoke 不适用（无 Electron 面）。
- **G2 结论**：`gate_passed` — 自本提交起解除「未通过前禁止开始 UI 和 Agent Tool」限制。
- **rollback**：`git reset --hard e450103c`

## PB-030：主进程 Linguist 项目服务（LinguistProjectService）

- **状态**：`integration_verified`（服务级 node --test 15/15 + bun 纯逻辑 12/12 + store 回归 59/59 + typecheck 9/9 + 根 bun test 600/2 与基线一致 + check:boundaries 3/3 + 打包 smoke 18/18 + 打包应用实测 init 探针 OK；无 IPC/UI 面，不声明 packaged_app_verified——打包 smoke 不覆盖本服务行为）
- **依赖**：PB-025 ✅
- **baseCommit**：PB-025 的 resultCommit（`0b01bb62`）
- **resultCommit**：`SELF`
- **范围**：按计划 §4 在约定路径 `apps/electron/src/main/lib/linguist/` 建立主进程 CAT 项目服务。能力：项目 list/create/get/archive、项目路径解析、cat.db 句柄缓存（显式 close；归档项目一律只读打开——fail closed；归档时丢弃缓存句柄）、结构化健康检查（project.json 可解析 / cat.db 可开 / schema 版本匹配 / source blob sha256 抽查 20 上限）、备份（委托 store VACUUM INTO，返回 linguist 根相对路径）、导入管道 `importAsset(projectId, {bytes, filename})`（registry detectBest → adapter.import → insertImported 单事务 → saveAssetSource；>50MB 抛 IMPORT_TOO_LARGE；归档抛 PROJECT_ARCHIVED；FORMAT_UNSUPPORTED 等类型化错误原样穿透）。启动探针：init() 运行 probeSqliteRuntime()，sqlite 不可用 → degraded（索引仍可读写，DB 操作抛 STORE_SQLITE_UNAVAILABLE），主进程不崩溃。日志只记 id/计数/错误码（计划 §7.4），不记文件名/文本。全部代码全新编写（已登记 SOURCE_PROVENANCE.md）。
- **关键发现与修正（esbuild 打包兼容性，实测）**：esbuild `--format=cjs` 把 `import.meta` 替换为空对象（`import.meta.url === undefined`），cat-store `runtime.ts` 原 `createRequire(import.meta.url)` 在打包主进程里必抛 `ERR_INVALID_ARG_VALUE`、探针恒为不可用——**打包应用里 CAT 持久化会被静默降级**。修正为 `createNodeRequire()`：import.meta.url → `__filename`（CJS 束内即 dist/main.cjs）→ cwd 三级兜底；对 node:sqlite 内置模块基准只需合法。验证：整个 store 链 esbuild 打 CJS 束后 node 执行探针 ok:true + CatStore 建项/开库/migration 全通；打包应用手动启动实测输出 `[Linguist] CAT 项目服务已初始化（node v22.22.0，备份: VACUUM INTO）`。
- **promaWorkspaceId 关联决策**：创建项目时缺省按 agent-workspace-manager 的 id 约定（`randomUUID()`，同 createAgentWorkspace）分配工作区 **id 引用**写入项目元数据；调用方可显式传入既有工作区 id。**不创建真实 agent 工作区**（不写 agent-workspaces.json、不复制 skills——避免重名冲突与副作用）；真实工作区创建/绑定属 PB-034 会话逻辑。已在代码头注释与账本记录。
- **改动文件**：
  - `apps/electron/src/main/lib/linguist/project-service.ts`（新增：LinguistProjectService + 单例 init/get/closeAllLinguistProjectHandles）
  - `apps/electron/src/main/lib/linguist/errors.ts`（新增：LINGUIST_SERVICE_ERROR_CODES 四码 + 4 个类型化错误 + mapStoreError + errorCodeOf；store/format/domain 错误穿透约定）
  - `apps/electron/src/main/lib/linguist/paths.ts`（新增：resolveLinguistRootDir/projectPaths/toRootRelativePath 纯函数）
  - `apps/electron/src/main/lib/linguist/format-registry.ts`（新增：默认 registry 登记 Xliff/Csv/Json adapter）
  - `apps/electron/src/main/lib/linguist/project-service.nodetest.ts`（新增 9 条：生命周期/默认工作区分配器/归档只读+写拒绝/句柄缓存语义/健康+三类损坏报告/归档项目健康检查/备份可开副本/未找到映射）
  - `apps/electron/src/main/lib/linguist/import-pipeline.nodetest.ts`（新增 6 条：xliff/csv/json 端到端导入、不支持格式穿透、50MB+1 拒绝且零写入、类路径 filename 仅作元数据不触盘）
  - `apps/electron/src/main/lib/linguist/errors.test.ts` + `paths.test.ts`（新增 bun 纯逻辑测试 12 条：错误码契约/映射/穿透/路径解析/根外拒绝；不触 DB）
  - `apps/electron/src/main/lib/linguist/test/{loader-hooks,register-ts-loader}.mjs`（新增：node 运行器扩展名省略 resolve hook，复用 cat-store 同目录模式）、`test/service-testkit.ts`（mkdtemp/注入时钟熵/工作区分配器/fixture 读取助手）
  - `packages/linguist-cat-store/src/runtime.ts`（修正：createNodeRequire 三级基准，见上；allowedNewPaths 内无需登记）
  - `apps/electron/src/main/index.ts`（**已登记触点**：bootstrap 经 `safeRun('initLinguistProjectService', …)` 接线——仅实例化+探针，不注册 IPC（PB-031）；before-quit 增加 closeAllLinguistProjectHandles 清理）
  - `apps/electron/package.json`（**已登记触点**：新增 `test:linguist` 脚本 = node --test 跑 `*.nodetest.ts`；devDeps +@linguist/cat-core/cat-formats/cat-store workspace:*，对齐 @proma/* 惯例）
  - `bun.lock`（**已登记触点**：上述 devDeps 的 workspace 锁文件条目，bun install 自动写入，无外部依赖）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（三条既有条目 ticket 追加 PB-030；总览表补 PB-024 行（PB-024 改 bun.lock 原表漏记）+ 多票共改文件数 7→8；条目总数 39 不变）
  - `docs/attribution/SOURCE_PROVENANCE.md`（一条全新编写登记）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：IPC handler/schema（PB-031）、UI（PB-032）、导入 IPC 接线（PB-033）、真实 Proma 工作区创建/绑定与会话逻辑（PB-034）、restore（PB-111）。
- **验证（实测）**：
  - `cd apps/electron && bun run test:linguist` ✅ **15 pass / 0 fail**（node v22.22.2 --test；覆盖票要求全项：create/list/archive 生命周期、归档只读+写拒绝、健康报告 healthy+三类 broken、备份可开副本、xliff/csv/json fixture 端到端、超限拒绝、无路径 API 形状）
  - `bun test apps/electron/src/main/lib/linguist/` ✅ **12 pass / 0 fail**（bun 安全纯逻辑，不触 DB；确认 bun 不拾取 `*.nodetest.ts`）
  - `cd packages/linguist-cat-store && bun run test` ✅ **59 pass / 0 fail**（runtime.ts 修正在 node ESM 下零回归）
  - esbuild CJS 束探针：`esbuild --bundle --format=cjs`（store 整链）后 node 执行 → `PROBE {"ok":true,"node":"v22.22.2"}` + `DB_OK schemaVersion = 1`
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test` ✅ **600 pass / 2 fail**（588 基线 + 新增 12；2 条失败为 PB-003 起既有上游环境限制 agent-session-manager/channel-runtime-api-key，逐名核对未变差）
  - `bun run check:boundaries` ✅ 3/3（提交前；提交后复跑）
  - `cd apps/electron && bun run smoke:pack` ✅（esbuild 主束含服务全部模块，已 grep 证实）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**（含重启恢复两腿）
  - 打包应用手动启动（临时 HOME）✅ 主进程日志输出 `[Linguist] CAT 项目服务已初始化（node v22.22.0，备份: VACUUM INTO）`
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 本机首次 smoke 运行被 macOS Keychain 提示（SecurityAgent）卡死在渠道种子步骤（safeStorage 弹窗无人响应；与本票代码无关——7-25 基线日志显示当时 safeStorage 不可用直走明文）。`kill -9` SecurityAgent 后应用回退明文存储（与基线日志同一语义），复跑 18/18；该弹窗为本机环境态，非确定性复现，smoke harness 对其不 hermetic（如实记录）。
  - bun 无 node:sqlite → 服务测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，与 cat-store 同一约束）；
  - smoke 的 stdout 管道在 playwright launch 后才挂接，启动早期日志（含 `[Linguist]` init 行）不进 smoke artifacts——打包证据以手动启动实测为准；
  - promaWorkspaceId 为 id 引用（未建真实工作区，PB-034）；重复导入同一文件仍以 sqlite 主键冲突失败（未类型化，沿用 PB-025 限制）；
  - 健康检查 source 抽查上限 20 条（spot-check 语义，非全量）；`importAsset` 的 insertImported 与 saveAssetSource 非同一事务（blob 写失败会留无 blob 资产行，健康检查可检出）。
- **rollback**：`git reset --hard 0b01bb62`

## PB-031：Linguist 项目 Typed IPC（计划 §7.2 六通道）

- **状态**：`integration_verified`（处理器级 node --test 25/25 + bun 契约/形状守卫 7/7 + store 回归 62/62 + typecheck 9/9 + 根 bun test 与基线一致（提交后 607/2）+ check:boundaries 提交后 3/3 + 打包 smoke 18/18；无 renderer UI 面（PB-032/033），不声明 packaged_app_verified——打包 smoke 不覆盖通道行为）
- **依赖**：PB-030 ✅
- **baseCommit**：PB-030 的 resultCommit（`cc9a72f2`）
- **resultCommit**：`SELF`
- **范围**：按计划 §7.2 落地 6 个项目域 typed 通道（`linguist.projects.{list,create,open,import,getSummary,archive}`），三层结构：shared 契约（`packages/shared/src/types/linguist.ts`）→ 主进程处理器（`apps/electron/src/main/lib/linguist/project-ipc.ts`，不依赖 electron、node --test 直接驱动）→ ipc.ts 薄适配器（注入真实 `dialog.showOpenDialog` picker）→ preload 扁平方法（`linguistProjects{List,Create,Open,Import,GetSummary,Archive}`，house 惯例）。
- **关键设计决策（结果信封，刻意偏离 house 直返+throw 惯例）**：Electron `ipcRenderer.invoke` 会把 handler 抛出的错误包装为 "Error invoking remote method ..." 并丢弃自定义 `code` 属性，而稳定机器可读错误码是计划 §7.4 硬规则——故 6 通道全部返回 `LinguistIpcResult<T> = {ok:true,data}|{ok:false,error:{code,message}}` 信封。错误码目录 24 个（IPC 层 INVALID_INPUT/INTERNAL + 服务层 4 + store 8 + format 4 + domain 6 穿透）；已知类型化错误透传 code+message，未知错误收敛 INTERNAL + 通用文案（无 stack/内部文本泄露，日志只记 name）。已在 shared 契约头注释、project-ipc.ts 头注释、ipc.ts 注释三处记录该选择。
- **导入选择器流程（计划 §7.4 合规）**：handler 先校验 projectId 形状 → 服务校验项目存在/未归档（弹窗前失败，picker 调用计数有测试断言为 0）→ 主进程开原生 picker（filters: .xliff/.xlf/.mqxliff/.csv/.tsv/.json）→ 取消返回 `{cancelled:true}`（typed 结果，非错误）→ 主进程 stat 大小护栏（50MB，先于读盘；服务层对 bytes 还有第二道）→ 读盘 → `importAsset({bytes, filename: basename})`。renderer 永不提交路径/字节，返回服务结果 + 被选中文件 basename（展示元数据）。
- **open 语义**：打开（并缓存）项目 DB 句柄（归档强制只读）+ 返回元数据 + 健康报告（复用 PB-030 checkProjectHealth，spot-check 上限 20）——非 UI 导航。getSummary 走新增的窄方法 `getProjectSummary(id)`：元数据 + 资产 COUNT(*) + 段 GROUP BY status（cat-store 仓库新增 `countByProject()`/`countByStatus()`，不加载段行）。
- **改动文件**：
  - `packages/shared/src/types/linguist.ts`（新增，**已登记触点**：6 通道名常量 / 24 稳定错误码目录 / `LinguistIpcResult<T>` 信封 / 请求响应线格式（领域类型 JSON 镜像，@proma/shared 不依赖 linguist 包）/ 校验常量——id `prj-<16hex>`、BCP-47 形状 locale ≤35、name trim 非空 ≤120、workspaceId ≤128、导入扩展名白名单与 50MB 上限）
  - `packages/shared/src/types/index.ts`（**已登记触点**：桶文件追加 export）
  - `apps/electron/src/main/lib/linguist/project-ipc.ts`（新增：`createLinguistProjectIpc({getService})` 处理器工厂——输入校验（INVALID_INPUT）、错误映射（穿透/INTERNAL）、picker 抽象；服务惰性解析适配 bootstrap 注册先于 init 的顺序）
  - `apps/electron/src/main/ipc.ts`（**已登记触点**：6 通道薄适配器注册 + 导入通道注入真实 picker）
  - `apps/electron/src/preload/index.ts`（**已登记触点**：ElectronAPI 接口 + 实现各增 6 方法）
  - `apps/electron/src/main/lib/linguist/project-service.ts`（新增 `getProjectSummary(id)` 窄方法 + `LinguistProjectSummary` 类型；复用缓存句柄，归档自动只读）
  - `packages/linguist-cat-store/src/repositories/{assets,segments}.ts`（各增一个廉价计数只读方法；白名单路径无需登记）+ 对应 nodetest 追加 3 条
  - `apps/electron/src/main/lib/linguist/project-ipc.nodetest.ts`（新增 10 条：happy path 全通道、15 组校验负例 INVALID_INPUT、未知项目 4 通道 PROJECT_NOT_FOUND、导入取消/成功/归档拒前/超限/不支持格式/坏 id 不触发 picker、未类型化错误收敛 INTERNAL 不泄露内部文本）
  - `apps/electron/src/main/lib/linguist/ipc-contract.test.ts`（新增 7 条 bun 安全守卫：6 通道名精确匹配计划 §7.2、24 错误码目录完整性、id/locale 模式正反例、上限常量、preload/ipc.ts 源码形状断言）
  - `apps/electron/src/main/lib/linguist/test/service-testkit.ts`（追加 `fixturePath` 助手——picker stub 需真实文件路径）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（新增 4 条 PB-031 登记；总览表补 PB-031 行；条目总数 39→43，多票共改文件数 8 不变）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：renderer UI（PB-032 项目列表/摘要、PB-033 导入入口）；段级通道（query/CAS edit/QA，复用同信封模式与 open 缓存句柄）；真实 Proma 工作区创建/绑定（PB-034）；备份/恢复通道（PB-111）。
- **验证（实测）**：
  - `cd apps/electron && bun run test:linguist` ✅ **25 pass / 0 fail**（node v22.22.2 --test；PB-030 的 15 + 本票 10）
  - `bun test apps/electron/src/main/lib/linguist/` ✅ **19 pass / 0 fail**（PB-030 的 12 + 本票 7；确认 bun 不拾取 `*.nodetest.ts`）
  - `cd packages/linguist-cat-store && bun run test` ✅ **62 pass / 0 fail**（59 + 新增计数方法 3 条）
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test`（提交前）606 pass / 3 fail：2 条既有上游环境限制（agent-session-manager/channel-runtime-api-key，与基线一致）+ 边界 stale-entry 检查对 4 条**未提交**新登记的固有失败（该测试 diff HEAD，登记与代码同票提交前必然 stale）；提交后复跑 ✅ **607 pass / 2 fail** 与基线一致
  - `bun run check:boundaries`（提交前 2/3，同上固有原因）→ 提交后复跑 ✅ **3/3**
  - `cd apps/electron && bun run smoke:pack` ✅（esbuild 主束含 project-ipc 全链，已 grep 证实）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**（含重启恢复两腿）。**SecurityAgent 弹窗复现并处置**：首跑卡在 safeStorage 的 macOS Keychain 提示（SecurityAgent 进程挂起无人响应，应用 bootstrap 停在选择器播种前、主窗口未创建，smoke 报「未找到主窗口」2 PASS / 1 FAIL）——与 PB-030 记录同型、与本票代码无关（手动启动实测复现同一卡点后确认）；`kill -9` 该 SecurityAgent 提示进程后应用回退明文存储（与基线日志同一语义），复跑 18/18（复跑中段该提示又出现一次，再次 kill 后流程继续）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 本机打包 smoke 首跑再次遭遇 macOS Keychain 提示（SecurityAgent，safeStorage）挂起——bootstrap 卡住、主窗口未创建（2 PASS / 1 FAIL）；与本票代码无关（手动启动实测复现同一卡点；PB-030 同型记录）。`kill -9` 该提示进程后应用回退明文存储（与基线日志同一语义），复跑 18/18；smoke harness 对此机环境态不 hermetic（如实记录）；
  - bun 无 node:sqlite → 处理器测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，与 PB-030 同一约束）；
  - open 通道复用完整健康报告（source blob 抽查上限 20），为用户触发的低频操作可接受；如需更廉价的 open 摘要可后续拆分；
  - 导入大小护栏为 stat-then-read（TOCTOU 窗口由服务层 bytes 第二道护栏兜底）；picker 由用户选择文件，选择器过滤器之外的绕过（如手动输入文件名）由 registry detectBest 内容探测兜底（FORMAT_UNSUPPORTED）；
  - getSummary/open 对未归档项目缓存可写句柄（createProject 已预建 cat.db，无实际建库副作用）；degraded 模式下 DB 依赖通道以 STORE_SQLITE_UNAVAILABLE 信封降级（list/create 索引路径仍可用）；
  - 通道尚无 in-app UI 消费方（PB-032/033），打包 smoke 只覆盖应用启动不覆盖通道行为——通道行为证据以 node --test 为准。
- **rollback**：`git reset --hard cc9a72f2`

## PB-032：Project 列表与创建 UI（ProjectsView 真实页面）

- **状态**：`packaged_app_verified`（bun 纯逻辑 24/24 + typecheck 9/9 + 根 bun test 631/2 与基线一致 + check:boundaries 提交前 3/3 + 打包 smoke 18/18 + 打包应用 UI 探针 13/13——真实 UI 驱动走完 空状态→创建→列表→详情（健康）→归档→已归档分组 全环）
- **依赖**：PB-031 ✅
- **baseCommit**：PB-031 的 resultCommit（`51a6356f`）
- **resultCommit**：`SELF`
- **范围**：把 PB-013 的 ProjectsView 壳替换为真实「项目」页（全部位于白名单 `apps/electron/src/renderer/features/linguist/projects/`）。列表：挂载即 `linguistProjectsList({includeArchived:true})`，加载骨架 / 错误横幅（role="alert" + 重试）/ 空状态（真实创建 CTA）三态；活跃项目按「最近」（updatedAt 降序，代码内注记该定义可后续替换）排列为卡片；段/资产计数由 `linguistProjectsGetSummary` 逐卡并发补拉（不阻塞列表，失败单独降级「计数不可用」）。创建：Radix Dialog 表单（名称/源语言/目标语言），客户端预校验镜像 IPC 规则（trim 非空 ≤120；BCP-47 形状 ≤35——复用 shared 常量），提交成功 toast + 刷新，信封错误码映射为 24 码中文文案显示在对话框内。归档：ConfirmDialog → IPC → 刷新；已归档分组默认折叠（Collapsible），归档卡片虚线边框 + 「已归档」徽章视觉区分。打开：卡片点击 → `linguistProjectsOpen` → 最小详情头部（名称/语言对/时间/健康徽章/六格计数 + Chat/CAT/QA/Artifacts/Files「即将推出」占位）。
- **失败/修复渲染**：open 信封失败（PROJECT_UNHEALTHY / PROJECT_NOT_FOUND / STORE_* 等类型化错误）→ 可恢复错误态（中文文案 + 稳定码 + 重试/返回列表，不 crash）；open 成功但 healthy=false → 头部与卡片显示「需要修复」警告徽章（图标+文字，非纯色指示）+ 失败检查项清单（仅检查项标签 + detail 错误码/计数——契约保证无客户文本）。会话内 open 带回的健康报告以 React state 记录，驱动卡片角标。
- **数据纪律（计划 §9.5）**：atom 只放四个 UI 状态（创建对话框开合、表单草稿、选中项目 id、归档分组折叠态，`projects-atoms.ts`）；列表/摘要/健康报告以 React state 持当次 IPC 拉取结果，任何变更（创建/归档/返回列表）后重新拉取，无客户端真源镜像。导入 UI 整体留 PB-033（卡片/详情均无导入按钮，仅详情占位文案提及）。
- **改动文件**：
  - `apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx`（重写：壳 → 真实列表页 + 三态 + 归档确认 + 详情切换）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectCreateDialog.tsx`（新增：创建表单 + 预校验 + 错误码中文化）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectCard.tsx`（新增：项目卡片 + 归档/健康徽章 + 摘要占位三态）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectDetailPanel.tsx`（新增：最小详情——open 状态机 + 健康 + 计数 + 工作台占位）
  - `apps/electron/src/renderer/features/linguist/projects/projects-atoms.ts`（新增：四个 UI 状态 atom，§9.5）
  - `apps/electron/src/renderer/features/linguist/projects/project-utils.ts`（新增：纯函数——recent 排序/归档分组/预校验/24 码中文映射/健康摘要/时间格式化）
  - `apps/electron/src/renderer/features/linguist/projects/project-utils.test.ts`（新增 bun 测试 24 条：排序/分组/校验正反例/错误映射完备性（对照契约 24 码目录）/健康摘要/时间格式化注入 now 确定性）
  - `apps/electron/scripts/smoke/probe-projects-view.ts`（新增**常驻探针**：tmp HOME 起打包应用，真实 UI 驱动 13 断言——空状态/对话框开合/创建/卡片计数/IPC 真源交叉核对/详情健康/归档确认/归档分组展开/tmp HOME 隔离；node 运行，与 G0/G1 同一约束）
  - `apps/electron/src/renderer/lib/feature-flags.ts`、`atoms/active-view.ts`、`components/tabs/MainArea.tsx`（**已登记触点**：陈旧「导航壳」注释随真实页面落地更新，仅注释、零逻辑；三处登记 ticket 字段追加 PB-032）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（三条既有条目 ticket 追加 PB-032；总览表补 PB-032 行；条目总数 43 不变，多票共改文件数 8→10）
  - `docs/architecture/FEATURE_FLAGS.md`（LINGUIST_PROJECTS_VISIBLE 条目同步真实页面说明）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：导入 UI（PB-033，经 `linguistProjectsImport`，`{cancelled:true}` 为正常分支）；项目内工作台标签页 Chat/CAT/QA/Artifacts/Files 与段级通道消费（Batch 6）；「最近」= updatedAt（未记录最近打开）；归档项目的只读打开体验与列表一致（恢复/修复工具后续票）。
- **验证（实测）**：
  - `bun test apps/electron/src/renderer/features/linguist/` ✅ **24 pass / 0 fail**
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test`（提交前）✅ **631 pass / 2 fail**（607 基线 + 新增 24；2 条失败为 PB-003 起既有上游环境限制 agent-session-manager/channel-runtime-api-key，逐名核对未变差）
  - `bun run check:boundaries` ✅ 3/3（提交前；提交后复跑）
  - `cd apps/electron && bun run smoke:pack` ✅（dist/renderer 束含 `project-create-name`，已 grep 证实；最终代码二次打包后验证）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**（含重启恢复两腿）。**SecurityAgent 弹窗复现并处置**：首跑卡在 safeStorage 的 macOS Keychain 提示（与 PB-030/031 同型、与本票代码无关），`kill -9` 该提示进程后应用回退明文存储，流程继续并 18/18
  - `node scripts/smoke/probe-projects-view.ts` ✅ **13 PASS / 0 FAIL**（真实 UI 全环：空状态 → 创建（`prj-bf5c7b6ca459f414`）→ 卡片计数 0 段·0 资产 → 详情健康徽章 → 归档 → 已归档分组；主进程 list 交叉核对一致；数据落 tmp HOME 的 `.proma/linguist`。运行初同样出现一次 SecurityAgent 提示，kill 后继续）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 本机 smoke/探针运行再次遭遇 macOS Keychain 提示（SecurityAgent，safeStorage）——G0 与探针各出现一次，kill 后应用回退明文存储（与基线日志同一语义），均复跑/继续通过；与本票代码无关（PB-030/031 同型记录），harness 对此机环境态不 hermetic（如实记录）；
  - 探针只走 UI happy path + 真源交叉核对；错误横幅/需要修复徽章的损坏项目路径由 bun 纯逻辑测试与 PB-030/031 服务级测试覆盖（打包应用内人为造损坏项目会破坏 hermetic 性，未做）；
  - 健康角标仅反映会话内最近一次 open 的结果（列表首渲染不逐卡跑健康检查——open 全量健康报告含 source 抽查，逐卡跑代价不值得；PB-031 已注记）；
  - 「最近」排序 = updatedAt（创建/归档会改写；未记录最近打开时间）；
  - locale 输入为自由文本 + 形状校验（刻意不查表，与 IPC 同一策略）；创建后自动选中/自动打开新项目未做（保守交互，可后续评估）。
- **rollback**：`git reset --hard 51a6356f`

## PB-033：导入 UI（ProjectDetailPanel 资产区 + getSummary 资产列表扩展）

- **状态**：`packaged_app_verified`（nodetest 27/27 + bun 纯逻辑 27/27 + typecheck 9/9 + 根 bun test 634/2 与基线一致 + check:boundaries 3/3 + 打包 smoke G0 18/18 + 新探针 probe-import 11/11 + PB-032 探针回归 13/13）
- **依赖**：PB-032 ✅
- **baseCommit**：PB-032 的 resultCommit（`2829f7e5`）
- **resultCommit**：`SELF`
- **范围**：详情面板落地「资产（文件）」区（新文件 `ProjectAssetsSection.tsx`）。「导入文件」按钮 → `linguistProjectsImport`（主进程原生选择器 + 主进程读盘解析，renderer 永不提交路径/字节，计划 §7.4 由设计满足）；归档（只读）项目按钮禁用并附原因提示「已归档项目为只读，无法导入」。忙碌态为**诚实的 indeterminate**（role="status" 阶段文案「导入中（读取并解析文件）」+ 区块 aria-busy）——导入是单次 invoke（读取+解析+落库在主进程内完成），无分阶段事件流，**刻意不伪造 determinate 进度**。成功 → 成功 toast + 经 `onSummaryRefresh` 重拉 getSummary（真源）后新资产出现在列表；资产行 = 文件名 / formatId 徽章 / 段数 / 截断 SHA-256（`truncateSha256`，title 含完整值）+ 带 aria-label 的复制按钮 + 「导入于」（以导入完成即重拉时刻近似——领域 Asset 不携带导入时间戳）+ adapter 警告可展开（aria-expanded；警告仅存于导入结果，摘要不含，故仅刚导入行内联）。信封失败 → 行内 role="alert" 错误区（中文文案 + 稳定码，`describeLinguistIpcError`）+「重试」（重开选择器）；用户取消（`{cancelled:true}` 正常分支）→ 轻 toast「已取消导入」。同一项目多资产在列表累积。
- **getSummary 扩展（缺口的补齐方案）**：`LinguistProjectSummary` 新增 `assets: LinguistAssetInfo[]`（assetId / filename / formatId / segmentCount / sourceSha256，服务层 `listByProject()` 资产元数据行映射，按创建序，与 assetCount 同源；不加载段行 / source blob）。**通道不变、无新 IPC 通道、24 码目录不变**；触点登记三处（shared/types/linguist.ts 契约扩展 + main/ipc.ts 与 preload/index.ts 注释随动），服务/处理器在白名单 linguist 路径。
- **失败/异常语义**：归档项目导入被主进程在弹窗前拒绝（PROJECT_ARCHIVED，按钮层面已先行禁用）；超大文件（IMPORT_TOO_LARGE）、不支持格式（FORMAT_UNSUPPORTED）、解析失败（FORMAT_PARSE_ERROR）等全部经既有 24 码中文化走行内错误区；重复导入同一字节+文件名的资产在 store 层撞内容派生 id（UNIQUE → INTERNAL 信封，PB-024 设计），如实展示——专用类型化「重复资产」码刻意不在本票新增（留后续）。
- **数据纪律（计划 §9.5）**：无新 atom——导入忙碌/错误/最近导入结果/警告展开态均为组件局部 React state（短暂 UI 状态）；资产列表永远是 getSummary 当次拉取结果（ProjectDetailPanel 持有），导入成功后重拉，无客户端真源镜像。
- **改动文件**：
  - `packages/shared/src/types/linguist.ts`（**已登记触点**：新增 `LinguistAssetInfo` 线格式类型；`LinguistProjectSummary.assets` 扩展；注释更新）
  - `apps/electron/src/main/lib/linguist/project-service.ts`（白名单：`getProjectSummary` 映射 `listByProject()` 元数据行入摘要）
  - `apps/electron/src/main/lib/linguist/project-ipc.ts`（白名单：getSummary 注释随动，逻辑不变）
  - `apps/electron/src/main/ipc.ts`（**已登记触点**：GET_SUMMARY 注册处注释随动，仅注释）
  - `apps/electron/src/preload/index.ts`（**已登记触点**：`linguistProjectsGetSummary` 文档注释随动，方法面不变）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectAssetsSection.tsx`（新增：导入入口 + 忙碌/失败/取消三态 + 资产列表 + 警告展开 + 摘要复制）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectDetailPanel.tsx`（`refreshSummary` 重拉 + 资产区挂载 + 陈旧占位文案更新）
  - `apps/electron/src/renderer/features/linguist/projects/project-utils.ts`（新增纯函数 `truncateSha256`）+ `project-utils.test.ts`（3 条新 bun 测试）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectCard.tsx`（仅注释：导入入口位置说明随 PB-033 落地更新）
  - `apps/electron/src/main/lib/linguist/project-service.nodetest.ts`（新增服务级测试：空项目 assets=[] → 两次导入按创建序累积、字段与导入结果一一对应、恰好五键、64-hex sha）
  - `apps/electron/src/main/lib/linguist/project-ipc.nodetest.ts`（新增线格式测试：信封穿透的 assets 形状与导入结果一致）
  - `apps/electron/scripts/smoke/probe-import.ts`（新增**常驻探针**：启动前用 PB-025 headless CLI（`process.execPath` 运行）在 tmp HOME 的 `.proma/linguist` 根播种 项目A（2 资产）+ 项目B（空），再驱动打包应用——卡片计数 16 段·2 资产 / 详情资产区 / 导入按钮可用 / 行渲染（文件名·formatId·段数·截断摘要）/ 复制按钮 / 页内 getSummary 交叉核对（sha 与播种一致）/ 真实 UI 归档项目B后导入按钮禁用+只读提示 / tmp HOME 隔离，11 断言。**原生文件选择器不可被 Playwright 驱动**——完整导入流由 nodetest（stub picker）覆盖，原生对话框路径留人工 QA）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（三条既有条目 ticket 追加 PB-033；总览表补 PB-033 行；新增 PB-033 分节；条目总数 43 不变，多票共改文件数 10→13）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：determinate/分阶段导入进度（需主→渲染进度事件流，本票如实 indeterminate 并在 knownLimitations 记录）；原生对话框端到端驱动（人工 QA）；重复资产类型化错误码（现为 INTERNAL 穿透）；工作台标签页（Batch 6）。
- **验证（实测）**：
  - `cd apps/electron && bun run test:linguist` ✅ **27 pass / 0 fail**（node v22.22.2 --test；PB-031 的 25 + 本票 2：服务级 assets 形状 + IPC 线格式）
  - `bun test apps/electron/src/renderer/features/linguist/` ✅ **27 pass / 0 fail**（PB-032 的 24 + 本票 3）
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test` ✅ **634 pass / 2 fail**（631 基线 + 新增 3；2 条失败为 PB-003 起既有上游环境限制 agent-session-manager/channel-runtime-api-key，逐名核对未变差）
  - `bun run check:boundaries` ✅ 3/3（提交前；提交后复跑）
  - `cd apps/electron && bun run smoke:pack` ✅（dist/renderer 束含「导入中（读取并解析文件）」，已 grep 证实）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**（含重启恢复两腿）。**SecurityAgent 弹窗复现并处置**：全壳初始化触及 safeStorage 的 macOS Keychain 提示（SecurityAgent 进程挂起无人响应）——与 PB-030/031/032 同型、与本票代码无关；`kill -9` 该提示进程后应用回退明文存储（与基线日志同一语义），流程继续并 18/18
  - `node scripts/smoke/probe-import.ts` ✅ **11 PASS / 0 FAIL**（CLI 播种 `prj-614f11af2c92cb72`（8+8 段）→ 卡片计数 → 详情资产区 → 导入按钮可用 → 行渲染 → 复制按钮 → IPC getSummary 交叉核对（assets=2，sha 与播种一致）→ 归档禁用+提示；SecurityAgent 提示在 reload 时出现并被 kill，探针继续。前两次尝试在同一提示处超时（未识别前），处置后通过）
  - `node scripts/smoke/probe-projects-view.ts` ✅ **13 PASS / 0 FAIL**（PB-032 探针在 PB-033 打包上的回归；同样在 reload 时 kill 一次 SecurityAgent 提示）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 导入进度为诚实的 indeterminate（单次 invoke 无分阶段事件）；determinate/分阶段进度需主→渲染流式事件（后续票）；
  - 原生文件选择器不可被 Playwright 驱动：打包探针覆盖「到选择器为止」的 UI 接线（按钮在场/可用/归档禁用）与 CLI 播种真实数据下的资产区渲染；完整导入流（stub picker → 服务 → 摘要联动）由 node --test 覆盖；原生对话框端到端路径需人工 QA；
  - 警告展开渲染走的是「导入结果」路径（警告只存于导入结果，摘要不含），打包探针无法驱动导入故未覆盖该渲染——由纯逻辑与契约测试兜底；
  - 重复导入同一字节+文件名的资产在 store 层撞内容派生 id（UNIQUE → INTERNAL 信封），UI 如实走行内错误区；专用类型化码未在本票新增；
  - 资产行无真实导入时间戳（领域 Asset 不携带）；「导入于」仅对刚导入行显示，取导入完成（摘要重拉）时刻；
  - 本机 G0 与两个探针运行均复现 macOS Keychain 提示（SecurityAgent，safeStorage）——kill 后应用回退明文存储（与基线日志同一语义），全部通过；与本票代码无关（PB-030/031/032 同型记录），harness 对此机环境态不 hermetic（如实记录）；
  - bun 无 node:sqlite → 服务/处理器测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，与 PB-030 同一约束）。
- **rollback**：`git reset --hard 2829f7e5`

## PB-034：项目会话绑定（Project → Session Binding；项目对话 = Pi Agent 会话）

- **状态**：`packaged_app_verified`（nodetest 38/38（+11）+ bun 纯逻辑 54/54（+8）+ typecheck 9/9 + 根 bun test 提交后 642/2 与基线一致 + check:boundaries 提交后 3/3 + 打包 smoke G0 18/18 + 新探针 probe-project-session 17/17 + PB-032 探针回归 13/13（含本票更新断言）+ PB-033 探针回归 11/11）
- **依赖**：PB-033 ✅
- **baseCommit**：PB-033 的 resultCommit（`a92f2920`）
- **resultCommit**：`SELF`
- **范围**：项目对话**就是 Pi Agent 会话**（证据：PB-011 起 Pi 为唯一可见 runtime；Agent 会话栈已有完整持久化/流式/工作区机制，另起会话类型会重复整套栈）——会话元数据携带项目绑定，绑定随 `agent-sessions.json` 持久化。绑定 = `AgentSessionMeta` 新增两个冻结可选字段 `linguistProjectId?` / `linguistProjectName?`（名称快照；普通会话绝不携带）。唯一写入点：`createAgentSession` 第 6 可选参数 `linguistBinding`；**创建后冻结**——`updateAgentSessionMeta` 类型白名单刻意不含这两字段，并在运行时强制保持原值（防御 any 断言绕过），无任何重绑定 API。
- **绑定状态实时解析（关键实现发现）**：`resolveLinguistBindingStatus`（白名单 `main/lib/linguist/session-binding.ts`）按调用实时求值 active/archived/missing——store `getProject` 只读 `projects.json` 索引，索引缺条目本身**不区分**「已归档」与「目录缺失」，故 missing 需额外一次廉价 fs 检查（`existsSync` 项目目录 + 解析 `project.json`）；不做该检查 missing 会被误报为 archived（实测发现后修正）。状态不落库，永不腐化。
- **归档只读的主进程硬强制（硬规则 4）**：`agent-orchestrator.ts` `sendMessage` preflight（sessionMeta 加载后、`channel_disabled` 检查前，:1018）调用 `checkLinguistSessionSendBlock(sessionMeta, getLinguistProjectService)`——归档 → `reportPreflightError`（`ErrorCode` 新增 `linguist_project_archived`；持久化 TypedError 进会话 JSONL，用户消息照常落盘——会话可读语义）；`queueMessage`（:2670）同一闸门（throw）。missing / 未绑定 / 服务不可解析 → **fail-open**（规则 5 降级语义：会话保持可用）。renderer 另有徽章/通告/禁用按钮，但真实强制点在主进程（探针以 fake server 0 请求证实）。
- **新 IPC（信封风格，零新错误码）**：`linguist.sessions.{createForProject,listForProject,getBinding}` 三通道，handler 在白名单 `main/lib/linguist/session-ipc.ts`（复用 PB-031 信封——`ipcRenderer.invoke` 丢弃自定义 code 的既有论证）；信封助手抽取为 `main/lib/linguist/ipc-envelope.ts`（project-ipc.ts 逻辑不变的重构）。24 码目录不变（复用 PROJECT_NOT_FOUND / PROJECT_ARCHIVED / INVALID_INPUT）。preload 扁平方法 `linguistSessions{CreateForProject,ListForProject,GetBinding}`。
- **Renderer**：详情面板 Chat tab 落地（`role="tab"` 真实选中态，替换「项目工作台即将推出」占位）——`ProjectChatsSection.tsx`：项目对话列表（recent 排序）+「新建项目对话」+ 空状态「尚无项目对话」；归档项目新建禁用 + 只读提示、列表仍可读可打开。会话头部：徽章 `LinguistSessionBindingBadge`（项目名 + 已归档/项目缺失）+ 横条 `LinguistSessionBindingNotice`（归档只读/缺失降级），唯一挂载点 `AgentHeader.tsx`（**AgentView 未改动**）；组件/hook/纯函数在白名单 `renderer/features/linguist/session-binding/`。数据纪律（计划 §9.5）：绑定状态经 IPC 实时拉取，atom 不镜像真源。
- **改动文件**：
  - `packages/shared/src/types/agent.ts`（**已登记触点**：绑定两字段 + `linguist_project_archived` 错误码）
  - `packages/shared/src/types/linguist.ts`（**已登记触点**，兼 PB-031/033：三通道常量 + 会话绑定线格式；24 码目录不变）
  - `apps/electron/src/main/lib/agent-session-manager.ts`（**已登记触点**：`AgentSessionLinguistBinding` + createAgentSession 第 6 参数 + updateAgentSessionMeta 运行时冻结）
  - `apps/electron/src/main/lib/agent-orchestrator.ts`（**已登记触点**：sendMessage/queueMessage 两处归档发送闸门）
  - `apps/electron/src/main/lib/linguist/session-binding.ts`（新增，白名单：状态解析/创建/列表/发送闸门）
  - `apps/electron/src/main/lib/linguist/session-ipc.ts` + `ipc-envelope.ts`（新增，白名单；project-ipc.ts 信封抽取重构，逻辑不变）
  - `apps/electron/src/main/ipc.ts`（**已登记触点**：三通道注册）+ `apps/electron/src/preload/index.ts`（**已登记触点**：三个扁平方法）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectChatsSection.tsx`（新增）+ `ProjectDetailPanel.tsx`（Chat tab 落地 + 挂载对话区）
  - `apps/electron/src/renderer/features/linguist/session-binding/`（新增：useLinguistSessionBinding.ts / LinguistSessionBindingBadge.tsx（含 Notice）/ binding-utils.ts）
  - `apps/electron/src/renderer/components/agent/AgentHeader.tsx`（**已登记触点**：徽章/通告挂载点）
  - 测试：`session-binding.nodetest.ts`（6）+ `session-ipc.nodetest.ts`（5）+ `ipc-contract.test.ts`（+3）+ `binding-utils.test.ts`（+5）+ 测试基建 `test/electron-stub.mjs`（bare electron 打桩）与 `test/loader-hooks.mjs`（目录导入解析）
  - `apps/electron/scripts/smoke/probe-project-session.ts`（新增**常驻探针**，17 断言）+ `probe-projects-view.ts`（第 6 断言随 Chat tab 落地更新）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（4 条新登记 + 3 条既有追加；总览表补 PB-034 行；条目总数 43→47，多票共改文件数 13 不变）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：重绑定/解绑 API（刻意不做——冻结语义）；项目改名同步会话快照名（快照语义，刻意）；CAT/QA/Artifacts/Files 工作台标签页（Batch 6）；段级通道消费；missing 项目的会话清理工具。
- **验证（实测）**：
  - `cd apps/electron && bun run test:linguist` ✅ **38 pass / 0 fail**（node v22.22.2 --test；PB-033 的 27 + 本票 11）
  - `bun test apps/electron/src/main/lib/linguist/ apps/electron/src/renderer/features/linguist/` ✅ **54 pass / 0 fail**（main 22 + renderer 32；确认 bun 不拾取 `*.nodetest.ts`）
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test` 提交前 641 pass / 3 fail（2 条 PB-003 起既有上游环境限制逐名核对 + 边界 stale-entry 对未提交登记的固有失败，PB-031 同型）→ 提交后复跑 ✅ **642 pass / 2 fail**（634 基线 + 新增 8）
  - `bun run check:boundaries` 提交前 2/3（同上固有原因）→ 提交后复跑 ✅ **3/3**
  - `cd apps/electron && bun run smoke:pack` ✅（renderer 束含「尚无项目对话」/`linguist-project-badge`，dist/main.cjs 含 `linguist.sessions`×6 与 `linguist_project_archived`，preload.cjs 含 `linguist.sessions`×3，均已 grep 证实）
  - `node scripts/smoke/probe-project-session.ts` ✅ **17 PASS / 0 FAIL**（逐项见 G3_REPORT.md §4：CLI 播种 `prj-195e4c7cefb885fd`（8 段）→ Chat tab 真实可选中 → UI 新建项目对话 → 徽章含项目名 → IPC 交叉核对（runtime=pi，meta.linguistProjectId 一致）→ 普通会话未绑定 → IPC 归档 → 列表只读/新建禁用 → **发送主进程阻断（STREAM_ERROR 含「只读」+ JSONL 落盘 linguist_project_archived + 用户消息持久化 + fake server 0 请求）** → 历史可读 → 删项目目录**真实重启** → 徽章 missing + 降级通告 + 绑定持久化（listForProject=1）+ 项目视图存活 → tmp HOME 隔离）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**（含重启恢复两腿；G0 面零回归）
  - `node scripts/smoke/probe-projects-view.ts` ✅ **13 PASS / 0 FAIL**（PB-032 探针回归 + 本票更新的 Chat tab 断言；前两次尝试均被 SecurityAgent stall 干扰——见 knownLimitations——看门狗即时 kill 后通过）
  - `node scripts/smoke/probe-import.ts` ✅ **11 PASS / 0 FAIL**（PB-033 探针回归）
  - `git status --short` 提交后干净
- **knownLimitations**：
  - 本机探针运行继续遭遇 macOS Keychain 提示（SecurityAgent，safeStorage）——G0 与三个探针各 1 次，kill 后应用回退明文存储（与基线日志同一语义）流程继续；probe-projects-view 两次失败尝试均由此引起（stall 耗尽对话框/reload 超时预算，主进程日志无异常），看门狗即时 kill 后 13/13；与本票代码无关（PB-030/031/032/033 同型记录），harness 对此机环境态不 hermetic（如实记录）；
  - missing 判定依赖一次廉价 fs 检查（existsSync + project.json 解析），在发送 preflight / getBinding 时执行（实测无感知开销）；
  - 绑定无重绑定 API、名称快照不随项目改名更新（均为刻意的冻结/快照语义）；项目目录删除不可撤销 → 绑定会话永久 missing 降级（可读、发送不阻断）；
  - 原生文件选择器端到端路径仍需人工 QA（PB-033 已记录，本票未触及导入面）；
  - 探针只覆盖 Pi runtime 路径（项目对话固定 `agentRuntime='pi'`）；Claude runtime 的绑定会话走 orchestrator 公共 preflight 同一闸门，由 nodetest 覆盖；
  - bun 无 node:sqlite → 绑定/处理器测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，与 PB-030 起同一约束）。
- **rollback**：`git reset --hard a92f2920`

## G3 门禁：Batch 3 收口 — 真实 Electron：创建 Project、导入、重启、再次打开，数据完整（计划 §14）

- **状态**：`gate_passed`（门禁唯一硬标准达成：打包应用全环实测通过；详见 `docs/roadmap/G3_REPORT.md`）
- **依赖**：PB-034 ✅
- **baseCommit**：PB-034 的 resultCommit（`SELF`，门禁执行与 PB-034 同提交）
- **resultCommit**：`SELF`
- **范围**：门禁执行 + 报告。新增 `docs/roadmap/G3_REPORT.md`（全环证据 + 17 断言实录 + 全部验证命令与结果 + 环境 + 已知限制）；零产品代码改动（探针/测试属 PB-034 本体）。
- **改动文件**：
  - `docs/roadmap/G3_REPORT.md`（新增）
  - 账本（本文件 + `execution-ledger.json`）
- **门禁逐项结果**：
  1. 真实 Electron 全环 ✅ — 创建 Project（CLI 播种 `prj-195e4c7cefb885fd` / `prj-fb2fa227eba0dedd` + UI 创建 `prj-35e6123607674971` 主进程交叉核对）→ 导入（真实 fixture 8+8 段，卡片计数/资产区/sha 交叉核对一致）→ 重启（probe-project-session 真实 relaunch 腿 + G0 两条重启恢复腿）→ 再次打开数据完整（绑定会话侧边栏在场、listForProject=1、历史消息渲染、agent-sessions.json 落盘绑定 id、段/资产数据一致）（G3_REPORT.md §3 标准 1）
  2. 归档只读主进程硬强制 ✅ — fake model server 0 请求（到达模型前阻断）+ JSONL 落盘 `linguist_project_archived` + 用户消息持久化 + 列表只读/新建禁用/徽章/通告（§3 标准 2）
  3. 静态检查与测试基线 ✅ — typecheck 9/9；根 bun test 提交后 642 pass / 2 fail（2 条为 PB-003 起既有上游环境限制，与基线一致）；test:linguist 38/0；bun linguist 范围 54/0；check:boundaries 提交后 3/3（§3 标准 3）
  4. 四个常驻探针全绿 ✅ — probe-project-session 17/17、run-g0-smoke 18/18、probe-projects-view 13/13、probe-import 11/11（§3 标准 4）
  5. Hermetic ✅ — 四个探针各自 mkdtemp 临时 HOME + temp-home-isolation 断言、127.0.0.1 fake server、无真实用户数据、无后台残留（G3_REPORT.md §5）
- **knownLimitations**：
  - SecurityAgent（safeStorage Keychain 提示）对本机探针不 hermetic——PB-030~034 同型；本轮致 probe-projects-view 两次失败尝试，看门狗即时 kill 后 13/13（非代码回归，如实记录）；
  - 原生文件选择器端到端需人工 QA；
  - 绑定冻结/快照语义为刻意设计（无重绑定、快照名不随改名）；
  - bun 无 node:sqlite → node --test 约束同 PB-030 起各票。
- **G3 结论**：`gate_passed` — 真实 Electron 全环「创建 Project、导入、重启、再次打开，数据完整」达成。
- **rollback**：`git reset --hard a92f2920`

## PB-040：常驻项目 Skill（Project Assistant Skill；仅项目会话注入）

- **状态**：`packaged_app_verified`（nodetest 45/45（+7）+ bun 内容门禁 4/4 + typecheck 9/9 + 根 bun test 提交前 646/2 与基线一致 + check:boundaries 3/3 + 打包 smoke G0 18/18 + 新探针 probe-project-skill 10/10 + PB-032/033/034 探针回归 13/13、11/11、17/17）
- **依赖**：PB-034 ✅
- **baseCommit**：PB-034 的 resultCommit（`6987ad26`）
- **resultCommit**：`SELF`
- **范围**：计划 §8.1/§8.4 最小常驻项目 Skill——七条中文不变量逐字入 `resources/linguist-skills/project-assistant/SKILL.md`（frontmatter 仅 name/description/version，零工具授予、零机器路径），经既有 `additionalSkillPaths` 缝**只对项目绑定会话注入**，普通会话零注入。Skill 只声明工作守则：不注册工具、不扩大文件范围、不绕过 Proposal、不声称 QA 通过、不做交付（§8.4）。
- **Skill 到达模型的机制（关键实现发现）**：Pi SDK `DefaultResourceLoader`（`noSkills: true` + `additionalSkillPaths` + Proma override 白名单过滤）→ 含 SKILL.md 的目录即 Skill 根 → `_rebuildSystemPrompt` 把 `<available_skills>`（name/description/location）追加进 system prompt（Proma customPrompt 分支同样追加，前提是 read 工具在场——Proma 内建 `createReadToolDefinition` 即 `read`）→ 模型按需 read 正文。**不变量是建议性引导**：正文非每轮内联，模型读到才生效；`<location>` 为打包后绝对路径属 SDK 设计（「prompt 不含本机绝对路径」规则针对 Skill **正文**，由 bun 门禁强制执行）。
- **注入规则**（`main/lib/linguist/project-skill.ts` 的 `resolveLinguistSessionSkillPaths`，每次发送实时重解析、不落会话状态，resume 走同一解析自然一致）：普通会话（无 linguistProjectId）→ []；绑定 active → 注入；**绑定 archived → 仍注入**（如实记录的选择：归档会话发送已被 PB-034 主进程闸门阻断，Skill 注入与否不影响只读语义，保持「绑定在场且项目数据完整即注入」单一规则，不为不可达分支设特例）；绑定 missing → []（降级）；服务不可解析 / SKILL.md 缺失 → []（fail closed 记警告，绝不掀翻发送链路）。queueMessage 无需改动——复用 sendMessage 建立的活跃 Pi 会话。
- **路径解析**（`getDefaultProjectSkillDir`）：打包 = `process.resourcesPath/linguist-skills/project-assistant`（electron-builder extraResources 新增仓根 `resources/linguist-skills` → `linguist-skills`，对照 `../../tutorial` 模式；**只进 Resources，不同步 ~/.proma**——用户不可改，注入完全由主进程按绑定控制）；开发 = 束后 `dist/` 上溯三级到仓根（含 SKILL.md 才返回，否则 undefined 降级）。模块不 import electron（node --test 直驱；ESM 上下文无 __dirname/resourcesPath → undefined，测试经显式 skillDir + 临时 resourcesPath 注入，打包布局由探针端到端覆盖）。
- **Orchestrator 缝**（已登记触点，`agent-orchestrator.ts:1664`）：Pi queryOptions 装配处原 `...(workspaceSlug ? { additionalSkillPaths: [...] } : {})` 扩展为工作区 Skill 目录 + `resolveLinguistSessionSkillPaths(sessionMeta, getLinguistProjectService)` 合并数组；项目对话本无工作区（此前无任何 additionalSkillPaths），普通会话/无绑定保持原状零注入。
- **改动文件**：
  - `resources/linguist-skills/project-assistant/SKILL.md`（新增，白名单路径：七条不变量逐字 + 「CAT 工具由系统提供」指针 + 不授予能力声明；frontmatter name=linguist-project-assistant）
  - `apps/electron/electron-builder.yml`（**已登记触点**，兼 PB-010：extraResources 新增 linguist-skills 一项）
  - `apps/electron/src/main/lib/agent-orchestrator.ts`（**已登记触点**，兼 PB-034：additionalSkillPaths 缝扩展 + import）
  - `apps/electron/src/main/lib/linguist/project-skill.ts`（新增，白名单：解析规则 + 默认目录解析 + 注入规则单一真源）
  - `apps/electron/src/main/lib/linguist/project-skill.nodetest.ts`（新增 7 条：普通会话无/active 有/archived 有（记录选择）/missing 无/未知项目无/服务抛错 fail closed/SKILL.md 缺失降级/重启 resume 一致/默认目录两分支）
  - `tests/linguist-project-skill.test.ts`（新增 4 条 bun 内容门禁：七条不变量逐字在场、frontmatter 键白名单（无工具/权限授予）、全文无 POSIX 绝对路径/~/盘符/当前 homedir——「TM/TB」词内斜杠不计）
  - `apps/electron/scripts/smoke/probe-project-skill.ts`（新增**常驻探针**，10 断言；断言点如实记录：Skill 是否到达模型的唯一诚实端到端观测面 = 真实发往模型的 HTTP 请求体——fake model server 新增 opt-in `captureSystemPrompt`（默认关闭，既有探针零影响），直接断言请求体 system prompt 的 `<available_skills>`）
  - `apps/electron/scripts/smoke/fake-model-server.ts`（白名单路径：opt-in system prompt 捕获，加性可选字段）
  - `apps/electron/scripts/smoke/probe-projects-view.ts`（**预存在缺陷修复**，非 PB-040 功能：两处 `新建项目` 定位器 `.first()` 歧义——侧边栏「项目」分组头部有同名 aria-label 图标按钮（工作区分组入口，无文本内容，打开的是侧边栏内联输入而非对话框），本机时序下 DOM 序先于视图 CTA 被误中；改 `filter({ hasText: '新建项目' })` 两状态唯一。**base 复现证明非本票回归**：同一失败在 stash 掉本票两文件重打包后逐字节复现；对话框功能本身正常（诊断脚本逐按钮验证））
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（2 条既有条目追加 PB-040 + 总览表 PB-040 行；条目总数 47 不变，多票共改文件 13→15）
  - 账本（本文件 + `execution-ledger.json`）
- **未做（留后续票）**：不变量仅建议性引导（正文非每轮内联；CAT customTools 落地后由工具描述/闸门硬强制，Batch 4）；archived 注入与否不影响只读语义（发送闸门在上游）；Skill 无版本同步机制（不同于 default-skills 的 ~/.proma 同步——刻意，防用户篡改）；`<location>` 绝对路径泄漏属 SDK 设计未改。
- **验证（实测）**：
  - `bun run typecheck` ✅ 9/9 包 exit 0
  - `bun test tests/linguist-project-skill.test.ts` ✅ 4/4
  - `bun test` 提交前 ✅ **646 pass / 2 fail**（642 基线 + 新增 4；2 条为 PB-003 起既有上游环境限制逐名核对：agent-session-manager / channel-runtime-api-key 的 electron 模块导入）
  - `bun run check:boundaries` 提交前 ✅ 3/3（两触点文件相对基线本就有改动，无 stale；新文件全落白名单）
  - `cd apps/electron && bun run test:linguist` ✅ **45 pass / 0 fail**（node v22.22.2 --test；PB-034 的 38 + 本票 7）
  - `cd apps/electron && bun run smoke:pack` ✅（产物 `Contents/Resources/linguist-skills/project-assistant/SKILL.md` 在场；dist/main.cjs 含解析代码，均已证实）
  - `node scripts/smoke/probe-project-skill.ts` ✅ **10 PASS / 0 FAIL**（CLI 播种 → UI 新建项目对话 → 首发请求 system prompt 含 `<name>linguist-project-assistant</name>` 且 location 指向打包 `Contents/Resources/linguist-skills/project-assistant/SKILL.md` → 同会话第二条（resume 路径）仍含 → 普通会话请求不含 → tmp HOME 隔离）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ **18 PASS / 0 FAIL**
  - `node scripts/smoke/probe-project-session.ts` ✅ **17 PASS / 0 FAIL**（PB-034 回归）
  - `node scripts/smoke/probe-projects-view.ts` ✅ **13 PASS / 0 FAIL**（定位器修复后；修复前在本票构建 3 连失败 + base 构建 1 次复现，均为同一定位器歧义）
  - `node scripts/smoke/probe-import.ts` ✅ **11 PASS / 0 FAIL**（PB-033 回归）
- **knownLimitations**：
  - 本机探针运行继续遭遇 macOS Keychain 提示（SecurityAgent，safeStorage）——probe-project-skill 首次运行 1 次，kill 后应用回退明文存储流程继续（PB-030~034 同型记录），与本票代码无关；后续运行由 5s 看门狗护航；
  - 不变量为建议性引导（见「未做」）；`<location>` 绝对路径属 SDK 设计；
  - archived 仍注入为记录的选择（发送已被 PB-034 闸门阻断，规则单一优先）；
  - node --test ESM 上下文不覆盖开发 CJS 束的 __dirname 分支（由显式注入 + 打包探针 + bun 仓根布局门禁兜底）；
  - bun 无 node:sqlite → 解析矩阵测试必须 node 下跑（`test:linguist`；根 `bun test` 不覆盖 `*.nodetest.ts`，PB-030 起同一约束）。
- **rollback**：`git reset --hard 6987ad26`

## PB-041：只读 CAT 工具（read-only CAT Tools；计划 §7.3 v1 只读腿）

- **状态**：`unit_verified`
- **依赖**：PB-040 ✅
- **baseCommit**：PB-040 的 resultCommit（`8110ab77`）
- **resultCommit**：`SELF`
- **范围**：新包 `packages/linguist-cat-tools/`（`@linguist/cat-tools`）——计划 §7.3 v1 只读腿五个工具（`cat_project_summary` / `cat_list_assets` / `cat_get_segments` / `cat_search_tm` / `cat_search_terms`）实现为 Pi ToolDefinition（`defineTool`，形状以 SDK dist 类型为准：name/label/description/parameters(TypeBox)/execute→`{content, details}`）。propose/QA/export 工具留 PB-051/071/072；accept/commit 工具按计划 §7.3 第二清单**永久不做**。
- **绑定模型（计划 PB-041 硬规则）**：工具实现**绝不**接受来自模型输入的 projectId/assetId-from-nowhere——`createLinguistCatTools(deps)` 的 `deps.resolveProject(callInfo)` 由宿主注入，每次工具执行实时调用（返回 `ResolvedLinguistCatProject | LinguistCatToolError`；抛类型化错误等价穿透）。Electron 侧由 PB-042 从会话元数据实现；本票测试用 fakes。`callInfo` 只含 toolName/toolCallId，不含模型参数。
- **错误模型**：Pi 惯例为 **throw on failure**（pi-agent-core AgentTool 文档明示，内建 read 工具同款）——类型化 `LinguistCatToolError` 携带稳定 code（`BINDING_MISSING` / `PROJECT_MISSING` / `ASSET_NOT_FOUND` / `INVALID_ARGUMENT`），消息统一 `[CODE]` 前缀使 code 对模型可见；store/domain 类型化错误（STORE_SQLITE_UNAVAILABLE 等）原样穿透不包装。
- **输出约束（计划 §7.4）**：标准分页信封 `{items, total, limit, offset, hasMore}`；硬上限 segments 100 / assets 200 / TM/TB 50（超限 **clamp + note**，非错误——如实记录的选择）；total 走新增 `SegmentsRepository.count`（COUNT(*)，与 query 共享 WHERE 构造，不加载行）；ids 全为内容派生稳定 id；**零绝对路径**（递归扫描测试断言）；**零日志**（工具包无任何 console 调用，测试断言——「不记录客户文本」的最简合规）。
- **TM/TB**：tm_units/term_entries 表在 Batch 8 前为空——本票在 cat-store 新增**只读** `TmUnitsRepository`/`TermEntriesRepository`（project_id 作用域、LIKE 转义、search+count），空表返回 `{results: [], note}` 干净空结果而非错误；播种行测试证明搜索为真（非硬编码空）。
- **归档语义（如实记录）**：归档项目打开即只读（PB-030 fail-closed），只读对**读取**无影响——工具在归档只读句柄上正常工作，summary 携带 `archived: true` + note；写拒绝是 store/service 层职责，不在本票。
- **改动文件**：
  - `packages/linguist-cat-tools/`（整包新增：`src/{index,types,errors,pagination,factory}.ts`、`src/{pagination,errors}.test.ts`（bun 纯测试）、`src/tools.nodetest.ts`（node --test 真实 store）、`test/` 两个 `.mjs` loader（复用 cat-store 同名模式）、package.json/tsconfig.json）
  - `packages/linguist-cat-store/src/repositories/segments.ts`（白名单：新增 `count()`；WHERE 构造提取为共享函数防漂移）
  - `packages/linguist-cat-store/src/repositories/{tm-units,term-entries}.ts`（白名单新增只读仓库）
  - `packages/linguist-cat-store/src/{project-database,index}.ts`（白名单：仓库接线 + 导出）
  - `bun.lock`（**已登记触点**，追加 PB-041：workspace 锁文件条目；无新增第三方包——chalk/jiti/semver 的 hoist 归位随新 dependent 变为 pi-coding-agent 版本胜出，chalk4 消费方全保留嵌套 4.x，`build:main` 实测通过）
  - `docs/architecture/proma-touchpoints.json` + `PROMA_CORE_TOUCHPOINTS.md`（bun.lock 条目追加 PB-041 + 总览表 PB-041 行；条目总数 47 不变）
  - `docs/attribution/SOURCE_PROVENANCE.md`（整包新写登记）
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun run typecheck` ✅ **10/10** 包 exit 0（基线 9 + 新包）
  - `cd packages/linguist-cat-tools && bun run test` ✅ **14 pass / 0 fail**（node v22 --test：五工具 happy path、分页边界（offset 越界/clamp+note/hasMore/跨页顺序一致）、精确 id、assetId/status/search 过滤、LIKE 通配符字面化、空 TM/TB 干净空、播种行真搜索、绑定错误矩阵（unbound→BINDING_MISSING 五工具全测/missing→PROJECT_MISSING/resolver 抛 StoreSqliteUnavailableError 原样穿透）、归档只读句柄读取正常、递归无绝对路径扫描 + JSON round-trip + 零 console 输出、10k 段 21 次分页查询 p95<500ms 上限实测 ~ms 级且结果硬封顶 100 条）
  - `bun test`（包内纯测试）✅ 10/10（分页 clamp/INVALID_ARGUMENT 矩阵、错误码注册表稳定 + `[CODE]` 前缀）
  - 根 `bun test` ✅ **656 pass / 2 fail**（基线 646 + 新增 10；2 条为 PB-003 起既有上游环境限制逐名核对：agent-session-manager / channel-runtime-api-key 的 electron 模块导入）
  - `bun run check:boundaries`（提交后）✅ 3/3（新文件全落白名单 `packages/linguist-*`/`docs/`；bun.lock 为已登记条目）
  - `cd apps/electron && bun run test:linguist` ✅ 45/0（本票无 Electron 改动，回归确认）
  - `cd packages/linguist-cat-store && bun run test` ✅ 62/0（store 既有测试不受影响）
- **knownLimitations**：
  - `cat_list_assets` 的分页在内存切片（`listByProject()` 全量资产**元数据**行后 slice）——资产为文件级（数十量级），段级体量永不加载；与 PB-031 summary 同一数据源。段级分页走 SQL LIMIT/OFFSET + COUNT(*)。
  - 空 TM/TB 时 clamp note 被空结果 note 覆盖（limit 仍生效为 50；两 note 互斥，空结果语义优先）。
  - `now`/`entropy` deps 为 PB-051+ propose 腿预留，只读腿未使用（接口占位，文档明示）。
  - bun 无 node:sqlite → 行为测试必须 node 下跑（包 `test` 脚本；根 `bun test` 不覆盖 `*.nodetest.ts`，PB-030 起同一约束）。
- **rollback**：`git reset --hard 8110ab77`

## PB-042：将 CAT Tools 接入 Pi `customTools`

- **状态**：`real_machine_verified`
- **依赖**：PB-041 ✅
- **baseCommit**：`9e4d1415`
- **resultCommit**：`SELF`
- **范围**：项目绑定会话按冻结的 `linguistProjectId` 装配 PB-041 的 5 个只读 CAT 工具；普通会话不装配。工具调用时实时解析项目状态，missing 返回 `PROJECT_MISSING`；归档发送仍由 PB-034 主进程闸门阻断。合并前检查与内建/MCP 工具重名并 fail loud。
- **关键修复**：初次打包启动暴露 `ERR_PACKAGE_PATH_NOT_EXPORTED`：CAT 工厂运行时引入 ESM-only `@earendil-works/pi-coding-agent`，而 Electron 主进程为 CJS。已改为类型导入 + 本地类型保持恒等函数，并把该包移至 devDependency；打包应用随后可正常启动并完成工具 round-trip。
- **改动文件**：
  - `apps/electron/src/main/lib/agent-orchestrator.ts`、`apps/electron/package.json`、`bun.lock`（已登记 Proma 触点；Electron 版本 0.15.11→0.15.12）
  - `apps/electron/src/main/lib/linguist/session-cat-tools.ts`、`session-cat-tools.nodetest.ts`
  - `packages/linguist-cat-tools/src/factory.ts`、`tools.nodetest.ts`、`package.json`（0.0.0→0.0.1）
  - `apps/electron/scripts/smoke/fake-model-server.ts`、`probe-cat-tools.ts`
  - `docs/architecture/{proma-touchpoints.json,PROMA_CORE_TOUCHPOINTS.md}`、`docs/attribution/SOURCE_PROVENANCE.md`
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun run typecheck` ✅ 10/10
  - `cd apps/electron && bun run test:linguist` ✅ 49/0
  - `cd packages/linguist-cat-tools && bun run test` ✅ 14/0
  - `bun test` ✅ 656/2（2 条 PB-003 起既有 Electron/Bun 环境失败，未增加）
  - `bun run check:boundaries` ✅ 3/3
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 13/13（打包 App：项目会话向模型广告 5 个 CAT 工具；`cat_get_segments` 读取真实临时项目并把含 `Health Potion` 的 tool result 回送模型；resume 仍绑定；普通会话无 CAT）
- **knownLimitations**：
  - macOS `SecurityAgent` 在两个打包探针的渠道 seed 阶段各阻塞一次；按既有环境处置终止后 safeStorage 回退，探针全绿。该环境限制自 PB-030 起存在。
  - 本票只接入既有 5 个只读工具；Proposal/QA/export 写能力按后续票增加，accept/commit 工具仍严格不存在。
- **rollback**：`git reset --hard 9e4d1415`

## PB-043：Tool Activity 文案

- **状态**：`packaged_app_verified`
- **依赖**：PB-042 ✅
- **baseCommit**：`31ba4fa4`
- **resultCommit**：`SELF`
- **范围**：复用 Proma 既有 `getToolPhrase` 单一入口，为五个 CAT 工具增加中文活动主标题；Agent 与 Chat 渲染路径自动共享。`cat_get_segments` 显示「读取 N 个片段」，`cat_search_terms` 显示「搜索术语 “…”」，其余为检查项目摘要、查看项目文件、查找翻译记忆。辅助 display name 同步中文化，不以 `cat_*` JSON 函数名作主标题。
- **改动文件**：
  - `apps/electron/src/renderer/components/agent/tool-phrase.ts`、`tool-utils.ts`、`tool-phrase.test.ts`（Proma 触点已登记）
  - `apps/electron/package.json`、`bun.lock`（0.15.12→0.15.13；既有触点追加 PB-043）
  - `docs/architecture/{proma-touchpoints.json,PROMA_CORE_TOUCHPOINTS.md}`
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - `bun test apps/electron/src/renderer/components/agent/tool-phrase.test.ts` ✅ 2/2（12 assertions）
  - `bun run typecheck` ✅ 10/10
  - `bun test`（提交前）657 pass / 3 fail：新增文案测试已通过；2 条为 PB-003 起既有环境失败；第 3 条仅因边界测试按 HEAD 检查、当前触点尚未提交，提交后复跑。
  - `bun test`（提交后）✅ 658 pass / 2 fail（仅余两条既有环境失败）；`bun run check:boundaries` ✅ 3/3。
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅
  - `node scripts/smoke/run-g0-smoke.ts`：首次被 `SecurityAgent` 耗尽窗口超时（2 pass / 1 environment fail）；清理后同一产物重跑 ✅ 18/18。
- **knownLimitations**：
  - 本票没有为 CAT 结果增加专用可视化；仍复用既有展开结果面，符合仅改活动文案的票面范围。
  - macOS `SecurityAgent` 非 hermetic，首次 G0 失败已如实记录。
- **rollback**：`git reset --hard 31ba4fa4`

## PB-044：Project Chat 真机 Smoke

- **状态**：`real_machine_verified`
- **依赖**：PB-043 ✅
- **baseCommit**：`6f9dc85c`
- **resultCommit**：`SELF`
- **范围**：复用 PB-042 的打包态 CAT 工具探针，增加计划规定的精确脚本：项目会话发送「总结这个项目」→ fake model 请求 `cat_project_summary` → 打包 Electron 执行真实 CAT 工具并把含项目名的 tool result 回送模型 → fake model 以 3 个内容 chunk 流式返回 final。没有新增产品功能。
- **关键修复**：
  - `sendAndWaitComplete()` 改为等待当前会话的 complete 计数增加，避免同会话多轮时误把历史 complete 当本轮完成。
  - fake model 仅在最后一条消息为 `role:"tool"` 时进入 tool-result follow-up；原 `.some()` 会被会话历史中的旧工具消息误触发，导致后续独立工具轮次被跳过。
- **改动文件**：
  - `apps/electron/scripts/smoke/probe-cat-tools.ts`、`fake-model-server.ts`
  - `apps/electron/package.json`、`bun.lock`（0.15.13→0.15.14；既有 Proma 触点追加 PB-044）
  - `docs/architecture/{proma-touchpoints.json,PROMA_CORE_TOUCHPOINTS.md}`
  - 账本（本文件 + `execution-ledger.json`）
- **验证（实测）**：
  - 失败测试（实现前）✅：`node scripts/smoke/probe-cat-tools.ts` 因缺少 `FAKE_CAT_SUMMARY_TOOL_NAME` / `G4_SUMMARY_MARKER` 导出而失败。
  - 功能红测 ✅：初版场景暴露历史 tool message 误判，`g4-project-summary-roundtrip` 显示 tool=false/result=false；修正 follow-up 判定后通过。
  - `bun run typecheck` ✅ 10/10
  - `bun test` ✅ 658 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 14/14；G4 断言实录：`cat_project_summary=true`、tool result 含项目名、final marker 到达、5 个 text events、complete=true。
- **knownLimitations**：
  - 首次功能运行受 `SecurityAgent` safeStorage 弹窗影响而关闭；另一次由旧打包 App 进程占用 single-instance 锁导致无主窗口。清理精确进程后，同一产物 14/14；均为本机环境态，不是产品失败。
  - 这是确定性 fake model 的真实打包 Electron 工具往返，不是外部 Provider/公网 API 验证。
- **rollback**：`git reset --hard 6f9dc85c`

## G4 门禁：CAT Tool 与 Skill 接入 Pi

- **状态**：`gate_passed`
- **依赖**：PB-044 ✅
- **baseCommit**：`c5d878b9`
- **resultCommit**：`SELF`
- **范围**：仅执行 Batch 4 Gate、生成 `docs/roadmap/G4_REPORT.md` 并更新双账本；没有产品代码改动。
- **门禁结果**：
  1. 打包 Electron 精确主链 ✅：「总结这个项目」→ `cat_project_summary` → 真实 tool result 含项目名 → 5 个流式 text events → complete（probe-cat-tools 14/14）。
  2. Skill 与绑定 ✅：Project Skill 10/10；项目会话绑定/归档硬阻断/重启降级 17/17。
  3. Proma 回归 ✅：G0 18/18，覆盖 text/thinking/tool、Stop、Retry、context error、持久化与重启。
  4. 静态与单元 ✅：typecheck 10/10；test:linguist 49/49；cat-tools 14/14；boundaries 3/3；根 bun test 658/2（仅两条既有 PB-003 环境失败）。
  5. Hermetic ✅：临时 HOME + synthetic fixtures + 本地 fake model；不触碰真实用户数据。
- **knownLimitations**：
  - 清理了一条更早遗留的 `/tmp/pb042-head-check` 循环进程；它会持续抢 Electron single-instance，清理前运行不作为 Gate 证据。
  - `SecurityAgent` safeStorage 弹窗仍非 hermetic；逐次终止后应用按既有行为回落 plaintext，最终四个探针均完整退出码 0。
  - 本 Gate 不验证外部 Provider；写能力属于后续 Batch。
- **结论**：`gate_passed`；详见 `docs/roadmap/G4_REPORT.md`。
- **rollback**：`git reset --hard c5d878b9`

## PB-050：Proposal Domain 和 Repository

- **状态**：`integration_verified`
- **依赖**：G4 ✅
- **baseCommit**：`ddf87203`
- **resultCommit**：`SELF`
- **范围**：在既有 `cat-core` Proposal 生命周期和 `ProposalsRepository` 两个 seam 内补齐本票，不新增平行 service。Proposal 新增 `expired` 终态；Repository 新增原子批量创建/接受、pending 查询和 stale 过期，单条接口复用批量事务实现。
- **关键语义**：
  - 创建时主仓库强制 unknown/locked/baseRevision 检查；任一项失败整批回滚。
  - 内容派生 ID 相同且仍 pending 时幂等返回既有行；terminal Proposal 不得复活为 pending。
  - `acceptMany` 去重输入 ID，并在一个 `BEGIN IMMEDIATE` 事务中更新 Proposal、Segment 与 SegmentRevision；任一 stale/locked/not-found/非法状态使全选回滚。
  - `expireStale` 只把 `base_revision <> segment.revision` 的 pending Proposal 标为 expired；`listPending` 自动排除。
- **改动文件**：
  - `packages/linguist-cat-core/src/{proposal.ts,proposal.test.ts,index.ts}` + `package.json`（0.0.1）
  - `packages/linguist-cat-store/src/repositories/proposals.ts`、`src/proposals.nodetest.ts` + `package.json`（0.0.1）
  - `bun.lock`（既有 Proma 触点追加 PB-050；仅 workspace patch 版本，无新增依赖）
  - `docs/architecture/{proma-touchpoints.json,PROMA_CORE_TOUCHPOINTS.md}`
  - 账本（本文件 + `execution-ledger.json`）
- **TDD 实录**：
  - RED：`expireProposal` 导出不存在；duplicate pending 触发 SQLite UNIQUE；`insertPendingMany` / `acceptMany` / `expireStale` 方法不存在。
  - GREEN：core Proposal 21/21（含 serialization）；cat-store 68/68，其中 Proposal repository 12 条全绿。
- **验证（实测）**：
  - `bun test packages/linguist-cat-core/src/proposal.test.ts packages/linguist-cat-core/src/serialization.test.ts` ✅ 21/21
  - `cd packages/linguist-cat-store && bun run test` ✅ 68/68（PB-050 后 Proposal 子集 12 条）
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：659 pass / 2 fail（新增 1 个 bun 生命周期测试；仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - 单批最多 50 是 `cat_propose_translations` 的信任边界，留 PB-051 强制；Repository 本身不设业务批量上限。
  - stale accept 仍抛 `STALE_PROPOSAL` 并保持 pending（事务失败不得附带状态写）；调用 `expireStale` 才显式物化 expired 状态。
  - 内容派生 ID 不含 evidence/model/session 元数据；pending duplicate 采用 first-write-wins，terminal duplicate 明确拒绝，绝不改写历史归属。
- **rollback**：`git reset --hard ddf87203`

## PB-051：`cat_propose_translations` Proposal Tool

- **状态**：`packaged_app_verified`
- **依赖**：PB-050 ✅
- **baseCommit**：`93598fca`
- **resultCommit**：`SELF`
- **范围**：在既有 `createLinguistCatTools` 工厂内追加一个 Proposal ToolDefinition，直接复用 PB-050 `insertPendingMany` 深接口和 cat-store 既有 placeholder/tag QA，不新增平行 service。会话 resolver 注入 `sessionId` / `modelId` provenance；Tool Activity 复用 Proma 既有统一短语入口。
- **关键语义**：
  - 输入仅含 `segmentProposals`，不接受 `projectId`；每次 1–50 条，整批原子创建。
  - 空目标、placeholder/tag signature 不一致、unknown、locked、stale 均拒绝；任一失败不留下 Proposal。
  - 成功只写 pending Proposal 并返回 Proposal ID；Segment target/revision 保持不变。
  - 工具集合明确不含 accept/commit；归档项目由 cat-store read-only guard 拒绝 Proposal 写入。
- **改动文件**：
  - `packages/linguist-cat-tools/src/{factory.ts,types.ts,index.ts,tools.nodetest.ts}` + `package.json`（0.0.2）
  - `packages/linguist-cat-store/src/index.ts` + `package.json`（复用导出 minimalQaSegment，0.0.2）
  - `apps/electron/src/main/lib/linguist/session-cat-tools.ts` + nodetest（会话 provenance）
  - `apps/electron/src/renderer/components/agent/{tool-phrase.ts,tool-utils.ts,tool-phrase.test.ts}`（既有触点追加 PB-051）
  - `apps/electron/scripts/smoke/probe-cat-tools.ts`（打包产物六工具广告/resume 守卫）
  - `apps/electron/package.json`（0.15.15）、`bun.lock`、触点文档与双账本
- **TDD 实录**：
  - RED：工具未注册；随后暴露 factory 数量、provenance、binding 参数遗漏。
  - RED：空白目标被接受；加入 trim 信任边界与既有 deterministic placeholder/tag QA 后转绿。
  - RED：主进程会话创建的 Proposal 缺少 `sessionId`；在现有 session resolver 注入 metadata 后转绿。
  - RED：UI 回退显示原始 `cat_propose_translations`；复用统一 Tool Activity 映射后转绿。
- **验证（实测）**：
  - `cd packages/linguist-cat-tools && bun run test` ✅ 16/16（真实 node:sqlite）
  - `cd apps/electron && bun run test:linguist` ✅ 49/49
  - `bun test apps/electron/src/renderer/components/agent/tool-phrase.test.ts` ✅ 2/2（14 assertions）
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：659 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 14/14；项目会话首发/resume 含 6 个 CAT tools，普通会话 0 个。
- **knownLimitations**：
  - 打包探针证明新工具进入真实 packaged Pi tools 数组；Proposal 写入执行由主进程真实 SQLite 集成测试证明。完整 packaged「Agent 产生 Proposal → 用户接受 → Segment 更新」属于 G5，不在本票伪造。
  - 第一次探针被重新出现的 `/tmp/pb042-head-check` 遗留循环抢占 single-instance 后人工中止；终止 PID 88975 及子进程后，同一产物最终 14/14。
  - 最终探针遇到已知 SecurityAgent safeStorage 弹窗；终止该弹窗进程后按既有逻辑回落 plaintext 并完成。模型为本地 deterministic fake，不代表外部 Provider。
- **rollback**：`git reset --hard 93598fca`

## PB-052：确定性硬规则

- **状态**：`integration_verified`
- **依赖**：PB-051 ✅
- **baseCommit**：`e326417c`
- **resultCommit**：`SELF`
- **范围**：在纯 `@linguist/cat-core` 新增单一 `runDeterministicHardRules` 写入门，并替换 Proposal Tool 对 interim minimal QA 的直接依赖。规则整合自冻结旧仓四个纯 QA 模块并显著收窄：零 IO、零 waiver、零 Agent 解释通道、结构化稳定 violation；来源与修改范围已登记。
- **规则目录**：
  - locked segment；
  - `{name}` / `{0}` / printf / template placeholder 多重集；
  - XML/format tag 的 open/close/self + 结构 id 属性签名；
  - 标准 ICU plural/select/selectordinal（含嵌套 branch）与旧 `{name:a|b}` arity；
  - hard/literal newline；
  - required terminology / forbidden terms（显式规则输入）；
  - canonical number 与 alphanumeric token 多重集。
- **关键语义**：
  - 规则结果完全由输入确定；同输入逐字相同，不存在 waiver 参数。
  - Proposal Tool 在写 repository 前执行硬门；任一格式/数字规则失败返回稳定 rule code，整批零写入。
  - locked 仍由 PB-050 repository 抛领域 `SegmentLockedError`，避免工具层把稳定领域错误降格成通用参数错误。
- **改动文件**：
  - `packages/linguist-cat-core/src/{hard-rules.ts,hard-rules.test.ts,index.ts}` + `package.json`（0.0.2）
  - `packages/linguist-cat-tools/src/{factory.ts,tools.nodetest.ts}` + `package.json`（0.0.3）
  - `apps/electron/package.json`（0.15.16）、`bun.lock`
  - `docs/attribution/SOURCE_PROVENANCE.md`、触点文档、双账本
- **TDD 实录**：
  - RED：测试无法 import `./hard-rules`。
  - GREEN 后集成红：原 Proposal fixture 丢失源数字，3 条 node:sqlite 测试被新硬门正确拒绝；修正 fixture 保留数字后 16/16。
  - typecheck 首轮暴露测试中的 branded `AssetId` 与 rule code 宽化；改用 `asAssetId` 和精确联合类型后 10/10。
- **验证（实测）**：
  - `bun test packages/linguist-cat-core/src/hard-rules.test.ts packages/linguist-cat-core/src/proposal.test.ts` ✅ 21/21（硬规则 5 条）
  - `cd packages/linguist-cat-tools && bun run test` ✅ 16/16（真实 node:sqlite，含 newline/number 写前拒绝）
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：664 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - required/forbidden terminology 已是可执行纯规则，但当前 Project 尚无术语治理配置入口；PB-080 把真实 TB 状态映射进该输入。现阶段 Proposal Tool 执行格式/ICU/newline/number/token/locked 规则。
  - Project 自定义 tag rule registry 未迁入；当前 v1 三种格式的 XML/rich/format tag 由通用结构签名覆盖。若 PB-080 前出现非 XML 私有 tag 真实格式，再以显式规则输入扩展，不猜测。
  - 这不是 PB-070 的 Finding 生命周期/全项目 QA runner；本票只负责写入前硬阻断。
- **rollback**：`git reset --hard e326417c`

## PB-053：Proposal 人工审核 IPC

- **状态**：`integration_verified`
- **依赖**：PB-050、PB-052 ✅
- **baseCommit**：`40b48cfe`
- **resultCommit**：`SELF`
- **范围**：深化既有 `ProposalsRepository` 并薄接七个 typed IPC：pending 列表、diff、接受、拒绝、编辑后接受、批量接受、批量拒绝。写操作仅经 renderer preload 暴露，Pi customTools 仍只有六个 CAT 工具且没有 accept/commit。
- **关键语义**：
  - schema v2 新增项目内 `proposal_mutations` 幂等记录；同 key + 同请求逐字重放既有结果，同 key + 不同请求返回冲突，结果与 Proposal/Segment 变更同事务提交。
  - 所有接受/拒绝均校验 UI 提供的 `expectedRevision`；批量最多 50 且单事务，任一 stale/not-found/locked/非法状态整批回滚。
  - edit-and-accept 先跑 PB-052 硬规则；内容变化时创建新的内容派生 Proposal，原 Proposal 标 superseded，再接受新 Proposal，绝不改写原 Proposal 的内容身份。
  - 主进程信任边界校验 project/proposal id、revision、非空 idempotency key、非空编辑目标和 selection 去重；沿用既有 24 码信封目录。
- **改动文件**：
  - `packages/linguist-cat-store/src/{schema.ts,repositories/proposals.ts,index.ts,proposals.nodetest.ts}` + `package.json`（schema v2；版本 0.0.3）
  - `packages/shared/src/types/linguist.ts` + `package.json`（七通道与线类型；版本 0.1.44）
  - `apps/electron/src/main/lib/linguist/{proposal-ipc.ts,proposal-ipc.nodetest.ts,ipc-contract.test.ts}`
  - `apps/electron/src/{main/ipc.ts,preload/index.ts}` + `package.json`（0.15.17）
  - `apps/electron/scripts/smoke/run-g0-smoke.ts`（临时 `--user-data-dir`，修复与已安装应用共享单实例锁/localStorage 的 hermetic 缺口）
  - `bun.lock`、触点文档与双账本
- **TDD 实录**：
  - Repository RED：`acceptSelected` / `rejectSelected` / `editAndAccept` 不存在，12 pass / 3 fail；实现后 Proposal 子集 15/15。
  - IPC RED：`proposal-ipc.ts` 不存在；实现七通道后真实服务 + SQLite 集成 1/1。
  - 打包首轮暴露 smoke 仅替换 HOME、未隔离 Electron userData，已安装应用抢单实例锁；在既有 launch seam 加临时 userData 后成功独立启动。
- **验证（实测）**：
  - `cd packages/linguist-cat-store && bun run test` ✅ 71/71
  - `cd apps/electron && bun run test:linguist` ✅ 50/50
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：666 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.17 未签名产物）
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18；独立临时 userData 启动，已安装应用无需退出。期间已知 SecurityAgent 弹窗终止后回落 plaintext。
- **knownLimitations**：
  - 打包验证覆盖 main/preload 构建与 G0 回归；当前尚无 Proposal Review UI，因此未伪造 packaged Proposal 接受操作，状态保留 `integration_verified`。完整「Agent 产生 Proposal → 用户接受 → Segment 更新」由 PB-054 + G5 验证。
  - 幂等结果保存在各项目 `cat.db` 内，无跨项目 key 全局唯一要求；这是项目隔离语义。
  - schema v2 只追加新表，无 v1 数据重写；备份/恢复会自然包含该表。
- **rollback**：`git reset --hard 40b48cfe`

## PB-054：Proposal Inbox

- **状态**：`packaged_app_verified`
- **依赖**：PB-053 ✅
- **baseCommit**：`296d9bee`
- **resultCommit**：`SELF`
- **范围**：在 Project 详情新增独立「建议」页，消费 PB-053 的既有 typed preload API，完整展示 source、current/proposed target、差异、warnings、model/session、版本冲突与锁定状态，并提供接受、拒绝、编辑后接受。没有新增 Proposal mutation、Agent 写工具或第三方依赖。
- **关键语义**：
  - Inbox 只列 pending Proposal；每项 diff 从主进程读取当前 Segment revision，冲突/locked 时阻止接受与编辑，mutation 仍由主进程 CAS 最终裁决。
  - 每次人工操作生成唯一 idempotency key；成功后同时刷新 Inbox 与项目摘要，stale/revision/state 冲突会提示并重新读取。
  - 已归档项目只读；错误、空态、加载态和刷新均有可见状态。
  - 差异显示采用 Unicode 安全的共同前后缀算法，短译文场景无需新增 diff 依赖。
- **改动文件**：
  - `apps/electron/src/renderer/features/linguist/projects/{ProposalInbox.tsx,proposal-inbox-utils.ts,proposal-inbox-utils.test.ts,ProjectDetailPanel.tsx}`
  - `apps/electron/scripts/smoke/{fake-model-server.ts,probe-cat-tools.ts}`（G5 fake Proposal 场景与打包纵向断言；临时 Electron userData 隔离）
  - `apps/electron/package.json` + `bun.lock`（0.15.18；无新增依赖）
  - 触点文档与双账本
- **TDD 实录**：
  - RED：`proposal-inbox-utils.test.ts` 因差异工具模块不存在而失败；实现共同前后缀差异与冲突码识别后 2/2。
  - G5 探针在同一真实打包 App 内新增三项：Agent 只创建 Proposal、Inbox 展示建议、人工接受后 SQLite Segment target=`生命药水` 且 revision=1。
- **验证（实测）**：
  - `bun test apps/electron/src/renderer/features/linguist/projects/proposal-inbox-utils.test.ts` ✅ 2/2
  - 精确 UI/IPC 选择 ✅ 14/14；`cd apps/electron && bun run test:linguist` ✅ 50/50
  - `cd packages/linguist-cat-tools && bun run test` ✅ 16/16
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：668 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.18 未签名产物）
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 17/17；真实打包 Electron 完成 Agent Proposal → Inbox → 人工接受 → Segment revision 变化，且 Agent accept/commit/reject tools=0。
- **knownLimitations**：
  - 差异视图突出单个连续替换区；多处分散编辑不会生成最短编辑脚本。当前短译文审核足够，真实用户验证不足时再换成熟 diff 实现。
  - 批量选择 API 已在 PB-053 存在，但本票按计划只交付单项 accept/reject/edit；批量 Review 属 PB-064。
  - 打包探针使用确定性本地 fake model，不声称外部 Provider 验证。
  - 首次 channel seed 命中已知 macOS SecurityAgent safeStorage 弹窗；终止弹窗后应用按既有 plaintext 降级，完整探针退出码 0。
- **rollback**：`git reset --hard 296d9bee`

## G5 门禁：Translation Proposal

- **状态**：`gate_passed`
- **依赖**：PB-054 ✅
- **baseCommit**：`cd9dc5a9`
- **resultCommit**：`SELF`
- **范围**：仅执行 Batch 5 Gate、生成 `docs/roadmap/G5_REPORT.md` 并更新双账本；没有产品代码改动。
- **门禁结果**：
  1. 打包 Electron 精确主链 ✅：项目 Agent 调 `cat_propose_translations` 产生 pending Proposal；Project「建议」页可见；用户点击接受后 Segment target=`生命药水`、revision 0→1（probe-cat-tools 17/17）。
  2. Agent 权限边界 ✅：模型可见工具中 accept/commit/reject=0；Proposal 创建不写 Segment。
  3. Proposal 数据与硬规则 ✅：cat-store 71/71；cat-tools 16/16，覆盖 max-50、locked、CAS、placeholder/tag/ICU/newline/number/token 与原子回滚。
  4. Proma 回归 ✅：G0 打包 smoke 18/18；typecheck 10/10；test:linguist 50/50；boundaries 3/3；根 bun test 668/2（仅两条既有 PB-003 环境失败）。
  5. Hermetic ✅：临时 HOME + 独立 Electron userData + synthetic fixture + 本地 fake model；不触碰真实用户数据。
- **knownLimitations**：
  - 打包探针使用确定性本地 fake model，不验证外部 Provider。
  - Inbox 单项审核与共同前后缀差异的上限已在 PB-054 记录；批量 Review 属 PB-064。
  - 两个打包探针均命中已知 SecurityAgent safeStorage 弹窗；终止弹窗后应用按既有 plaintext 降级，完整运行退出码 0。
- **结论**：`gate_passed`；详见 `docs/roadmap/G5_REPORT.md`。
- **rollback**：`git reset --hard cd9dc5a9`

## PB-060：CAT Tab 和数据查询

- **状态**：`packaged_app_verified`
- **依赖**：G5 ✅
- **baseCommit**：`3be90253`
- **resultCommit**：`SELF`
- **范围**：启用 Project 独立 CAT tab，以一个只读 typed IPC 提供 asset list、Segment 分页、asset/status filter、source/target search 与同条件 COUNT；renderer 只保存筛选器和 opaque selected IDs，不把 Segment 真相放进 atom，也不耦合 Chat。
- **调用链**：`CatWorkspace` → preload `linguistCatQuery` → `linguist.cat.query` → `cat-workspace-ipc.ts` 信任边界 → `LinguistProjectService.queryCatWorkspace` → 既有 `AssetsRepository.listByProject` + `SegmentsRepository.query/count`。
- **关键语义**：
  - 主进程严格校验 project/asset id、四种 status、limit 1~200、offset≥0、search≤500；沿用 24 码信封，不新增错误码。
  - Segment query/count 复用同一既有 WHERE builder，搜索中的 `%/_` 仍按字面量处理。
  - UI 当前一页 100 行，原生 input/select，展示总数、分页和选择计数；selected IDs 使用 Jotai `ReadonlySet`，项目切换时清空。
  - 本票不提前实现 PB-061 虚拟化、PB-062 编辑、PB-063 Rail 或 PB-064 Proposal 操作。
- **改动文件**：
  - `packages/shared/src/types/linguist.ts` + `package.json`（只读 channel、线类型、边界常量；0.1.45）
  - `apps/electron/src/main/lib/linguist/{cat-workspace-ipc.ts,cat-workspace-ipc.nodetest.ts,project-service.ts,ipc-contract.test.ts}`
  - `apps/electron/src/{main/ipc.ts,preload/index.ts}` + `package.json`（0.15.19）
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,cat-workspace-atoms.ts,ProjectDetailPanel.tsx}`
  - `apps/electron/scripts/smoke/probe-import.ts`（临时 Electron userData + PB-060 真实 UI 查询/搜索/选择）
  - `bun.lock`、触点文档与双账本
- **TDD 实录**：
  - RED：`cat-workspace-ipc.nodetest.ts` 因 `cat-workspace-ipc.ts` 不存在而 `ERR_MODULE_NOT_FOUND`。
  - GREEN：真实 node:sqlite 项目导入 8 段，分页/asset list/count/search 与 6 类非法输入均通过，2/2。
- **验证（实测）**：
  - 精确 `cat-workspace-ipc.nodetest.ts` ✅ 2/2；IPC contract ✅ 14/14
  - `cd apps/electron && bun run test:linguist` ✅ 52/52
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：670 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.19 未签名产物）
  - `node scripts/smoke/probe-import.ts` ✅ 14/14；真实打包 UI 显示 16 段/两资产、搜索 Health 得 1 段、选择计数为 1，数据在临时 HOME。
- **knownLimitations**：
  - 当前是 PB-060 的分页数据浏览面，不声称 10k Grid 性能或 scroll anchor；PB-061 将在同一 tab 用 TanStack Virtual/Table 消费分页接口。
  - selected IDs 跨页/筛选保留但尚无批量动作；Proposal 批量操作属于 PB-064。
  - 原生导入 picker 仍无法由 Playwright 驱动，继续由真实服务 + stub picker 集成测试覆盖；本票未改变该路径。
  - 打包探针首次 channel seed 命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，完整探针 14/14、退出码 0。
- **rollback**：`git reset --hard 3be90253`

## PB-061：虚拟化 Segment Grid

- **状态**：`packaged_app_verified`
- **依赖**：PB-060 ✅
- **baseCommit**：`ca058f86`
- **resultCommit**：`SELF`
- **范围**：用 `@tanstack/react-virtual@3.14.7` 将 CAT tab 的分页列表替换为固定行高虚拟 Grid，列为 `# / Status / Source / Target / QA`；支持 10k、稳定 Segment key、滚动锚点、选中行与 locked 文案。没有引入 Table、第二份全量 atom 或编辑行为。
- **数据策略**：
  - 首个过滤请求只额外返回按 SQL 确定序排列的 10k Segment IDs，作为 Virtualizer stable key；正文仍按 200 行窗口从主进程读取。
  - renderer atom 只存 filters 与 selected ID Set；当前正文窗口仅存在组件 state，滚到新窗口后丢弃旧窗口，避免逐步缓存全量 Segment。
  - Virtualizer 固定估算/实际行高 68px、overscan 8；Source/Target 最多两行，避免测量变化导致锚点跳动。
  - QA 列先保留明确 `—`，真实 Finding 属 PB-070/071。
- **改动文件**：
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,cat-virtual-utils.ts,cat-virtual-utils.test.ts}`
  - `packages/linguist-cat-store/src/repositories/segments.ts` + `segments.nodetest.ts` + `package.json`（稳定 ID index；0.0.4）
  - `packages/shared/src/types/linguist.ts` + `package.json`（includeIndex/segmentIds；0.1.46）
  - `apps/electron/src/main/lib/linguist/{project-service.ts,cat-workspace-ipc.ts,cat-workspace-ipc.nodetest.ts}`
  - `apps/electron/package.json` + `bun.lock`（react-virtual 3.14.7 / virtual-core 3.17.5；Electron 0.15.20）
  - `apps/electron/scripts/smoke/probe-import.ts`（运行时生成 synthetic 10k CSV 并测真实打包 Grid）
  - 来源登记、触点文档与双账本
- **TDD 实录**：
  - RED 1：CAT IPC 测试读取 `segmentIds.length` 时 undefined。
  - RED 2：`cat-virtual-utils.test.ts` 因模块不存在失败。
  - GREEN：稳定 ID index + 跨页 window offset 计算 4/4；真实 IPC 2/2。
- **验证（实测）**：
  - `cat-virtual-utils.test.ts` ✅ 2/2；CAT IPC ✅ 2/2
  - `cd packages/linguist-cat-store && bun run test` ✅ 71/71
  - `cd apps/electron && bun run test:linguist` ✅ 52/52
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：672 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.20 未签名产物）
  - `node scripts/smoke/probe-import.ts` ✅ 18/18：10k 导入 339ms；单次端到端精确搜索 52ms（非 p95）；末行可见；DOM 16 rows；500ms 锚点漂移 0px；第 10000 行可选且显示「已锁定」。
- **knownLimitations**：
  - 52ms 是一次本机端到端样本，不是计划要求的 p95；G6 前需多次采样才可声明 p95≤200ms。
  - 固定 68px 行高与两行截断是本票的 Grid 性能取舍；PB-063 Context Rail 提供完整上下文，PB-062 编辑态可在当前行临时扩展。
  - 页面窗口采用丢弃式缓存；快速来回跨越 200 行边界会重新查询 SQLite。只有实测磁盘/IPC 成为瓶颈时才增加有界 LRU。
  - QA 列暂无 Finding，显示 `—`；不伪造 PB-070 状态。
  - 打包探针首次 channel seed 命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，完整探针退出码 0。
- **rollback**：`git reset --hard ca058f86`

## PB-062：人工编辑与 CAS

- **状态**：`packaged_app_verified`
- **依赖**：PB-061 ✅
- **baseCommit**：`a303dea1`
- **resultCommit**：`SELF`
- **范围**：在虚拟 Grid Target cell 增加显式人工编辑态；草稿本地保存，主进程 mutation 只走 `SegmentsRepository.applyTargetEdit(expectedRevision)`。支持 IME composition、multiline、Escape、Cmd+Enter、可见保存/取消按钮、locked/archived 禁编与冲突刷新；没有 auto-save。
- **调用链**：`TargetCell` → preload `linguistCatEditSegment` → `linguist.cat.editSegment` → `cat-workspace-ipc.ts` 校验 → `LinguistProjectService.editSegment` 归档守卫 → Repository CAS transaction（Segment + revision）。
- **关键语义**：
  - renderer 提交 `projectId/segmentId/target/expectedRevision`；主进程验证 id/type/revision≥0，不信任 DOM。
  - IME composition 期间 Cmd+Enter 返回 no-op；compositionend 后 Cmd+Enter 才保存。Escape 只丢本地草稿。
  - stale 返回 `REVISION_CONFLICT` 后重新取当前 200 行窗口，提示并显示并发内容，绝不覆盖。
  - 无状态/搜索过滤时成功后只替换当前 Map 行，保持虚拟滚动锚点；状态/搜索过滤在写后重查索引，避免已不匹配行残留。
  - 当前 Segment ID 进入 Jotai；draft/saving 只属于正在编辑的虚拟行。
- **改动文件**：
  - `packages/shared/src/types/linguist.ts` + `package.json`（edit channel/request/result；0.1.47）
  - `apps/electron/src/main/lib/linguist/{project-service.ts,cat-workspace-ipc.ts,cat-workspace-ipc.nodetest.ts,ipc-contract.test.ts}`
  - `apps/electron/src/{main/ipc.ts,preload/index.ts}` + `package.json`（0.15.21）
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,cat-workspace-atoms.ts,cat-edit-utils.ts,cat-edit-utils.test.ts,ProjectDetailPanel.tsx}`
  - `apps/electron/scripts/smoke/probe-import.ts`（IME/multiline/Escape/CLI 并发 CAS/locked 真机断言）
  - `bun.lock`、触点文档与双账本
- **TDD 实录**：
  - RED 1：真实 IPC 测试失败 `ipc.edit is not a function`。
  - RED 2：keyboard/IME 测试因 `cat-edit-utils.ts` 不存在失败。
  - GREEN：真实 SQLite multiline/CAS/stale/locked + 4 类非法输入 3/3；键盘纯逻辑 2/2。
- **验证（实测）**：
  - CAT IPC ✅ 3/3；edit utils + IPC contract ✅ 16/16
  - `cd apps/electron && bun run test:linguist` ✅ 53/53
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：674 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.21 未签名产物）
  - `node scripts/smoke/probe-import.ts` ✅ 21/21：composition 中未提交；multiline 保存 revision 1；Escape 不变；CLI 并发写 revision 2 后 UI 冲突刷新且未覆盖；第 10000 行 locked 编辑禁用。
- **knownLimitations**：
  - 按计划不做 auto-save；离开未保存编辑行会丢弃本地草稿，只有显式保存落盘。
  - 过滤条件下保存会重建 ID 索引并滚回结果顶部；保留过滤后相对锚点留到有真实长列表编辑反馈时再做。
  - 固定 108px 行高容纳双行 textarea 与操作提示；PB-063 Rail 提供完整上下文，未引入动态测量。
  - 真机并发由同一临时项目的外部 CLI 写模拟，不声称多设备同步。
  - 打包探针首次 channel seed 命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，完整探针 21/21、退出码 0。
- **rollback**：`git reset --hard a303dea1`

## PB-063：Context Rail

- **状态**：`packaged_app_verified`
- **依赖**：PB-062 ✅
- **baseCommit**：`c29eebe0`
- **resultCommit**：`SELF`
- **范围**：CAT Grid 右侧增加只读 Context Rail，含 Segment / TM / Terms / QA / Evidence 五个 Tab。当前 Segment 详情按 opaque id 从主进程读取，不依赖虚拟 Grid 当前加载窗口；Evidence 显示真实待审 Proposal 引用。
- **调用链**：Grid Source cell → `catActiveSegmentIdAtom` → `CatContextRail` → preload `linguistCatGetContext` → `linguist.cat.getContext` → `cat-workspace-ipc.ts` 校验 → `LinguistProjectService.getSegmentContext` → Segment/Proposal Repository。
- **关键语义**：
  - Rail 只读，不提前加入 PB-064 Proposal 操作。
  - Segment 与 pending Proposal 来自主进程 CatStore；滚动导致虚拟行卸载后详情仍可重取。
  - TM/TB 写入属于 PB-080，QA Finding 属于 PB-070；当前 Tab 明确显示暂无匹配/尚未运行，不伪造通过状态。
  - Evidence 只显示 Proposal 的 `evidenceRefs` / `termRefs`；没有真实引用时显示空态。
  - current Segment id 与 Rail tab 使用 Jotai；不在 renderer 保存 Segment 真相。
- **改动文件**：
  - `packages/shared/src/types/linguist.ts` + `package.json`（getContext channel/request/result；0.1.48）
  - `apps/electron/src/main/lib/linguist/{project-service.ts,cat-workspace-ipc.ts,cat-workspace-ipc.nodetest.ts,ipc-contract.test.ts}`
  - `apps/electron/src/{main/ipc.ts,preload/index.ts}` + `package.json`（0.15.22）
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,CatContextRail.tsx,cat-workspace-atoms.ts}`
  - `apps/electron/scripts/smoke/probe-import.ts`
  - `bun.lock`、触点文档与双账本
- **TDD 实录**：
  - RED：真实 SQLite IPC 测试失败 `ipc.getContext is not a function`。
  - GREEN：按 Segment id 返回真实 Segment 与 pending Proposal/evidence，非法 id 返回 `INVALID_INPUT`，4/4。
- **验证（实测）**：
  - CAT IPC ✅ 4/4；IPC contract/edit utils ✅ 16/16
  - `cd apps/electron && bun run test:linguist` ✅ 54/54
  - `cd packages/linguist-cat-store && bun run test` ✅ 71/71
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：674 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.22 未签名产物）
  - `node scripts/smoke/probe-import.ts` ✅ 22/22：真实 Segment、五 Tab、TM/Terms/QA/Evidence 空态及既有 10k/CAS 回归全部通过。
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18。
- **knownLimitations**：
  - TM/Terms 暂无写入面，真实匹配在 PB-080 接入；本票不读取空表后伪造建议。
  - QA Finding 在 PB-070 前不存在，因此 QA Tab 只显示“尚未运行”，不声称 QA 通过。
  - Evidence 当前只对应 pending Proposal 的显式引用；接受/拒绝操作属于 PB-064。
  - 打包探针首次 channel seed 命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，完整 probe 22/22、G0 18/18。
- **rollback**：`git reset --hard c29eebe0`

## PB-064：Proposal Review 集成

- **状态**：`packaged_app_verified`
- **依赖**：PB-063 ✅
- **baseCommit**：`c3541153`
- **resultCommit**：`SELF`
- **范围**：CAT Grid 显示待审/过期建议；Context Rail 展示 inline diff 并提供人工接受/拒绝；Grid 选择集复用 PB-053 的原子 selected IPC 批量审核（单次≤50）。Agent 仍无 accept/commit 工具。
- **调用链**：Grid/Rail → preload `linguistProposals*` / `linguistCatGetContext` → PB-053 Proposal IPC → Repository CAS transaction。批量操作先读取当前 Segment revision，不信任 Proposal 的旧 baseRevision。
- **关键语义**：
  - stale/locked/archived 禁止接受；stale 仍可拒绝。真实竞争冲突显示稳定码并刷新当前状态，绝不覆盖。
  - 批量接受/拒绝只包含当前选择中仍有 pending Proposal 的 Segment，超过 50 明确禁用。
  - fake model 的多轮 `cat-proposal` 场景只解析最新 user turn，避免历史 segmentId 污染后续工具调用。
- **改动文件**：
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,CatContextRail.tsx,proposal-inbox-utils.ts,proposal-inbox-utils.test.ts}`
  - `apps/electron/scripts/smoke/{fake-model-server.ts,probe-cat-tools.ts}`
  - `apps/electron/package.json` + `bun.lock`（Electron 0.15.23，无新增依赖）
  - 触点文档与双账本
- **TDD 实录**：
  - RED：批量审核 revision 映射测试因 `proposalMutationItems` 尚未导出而失败。
  - GREEN：映射仅保留 pending Proposal，并使用当前 Segment revision，Proposal utils 3/3。
  - 首次打包探针暴露 fake model 错取首个历史 segmentId；修正为最新 user turn 后完整探针 19/19。
- **验证（实测）**：
  - Proposal/edit utils ✅ 5/5；`cd apps/electron && bun run test:linguist` ✅ 54/54
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：675 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.23 未签名产物）
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 19/19：Agent Proposal、Grid/Rail diff、接受、批量拒绝、真实 revision 竞争冲突/stale。
  - `node scripts/smoke/probe-import.ts` ✅ 22/22：10k/CAS/Context Rail 回归。
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18。
- **knownLimitations**：
  - Proposal 列表在 CAT mount 与人工审核后刷新；若后台会话在 CAT 保持打开时新增建议，当前没有 Proposal push event，切换 Tab 后会重载。
  - inline diff 沿用 PB-054 的共同前后缀算法，不做词级 diff；复杂语言学 diff 只有出现明确审核需求时再引入。
  - 打包探针命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，三个探针均完整通过。
- **rollback**：`git reset --hard c3541153`

## PB-065：键盘与无障碍

- **状态**：`packaged_app_verified`
- **依赖**：PB-064 ✅
- **baseCommit**：`9e91a215`
- **resultCommit**：`SELF`
- **范围**：虚拟 Grid 行支持 ArrowUp/ArrowDown、有界滚动和可见焦点；Enter 进入 Target 编辑，既有 Escape/IME/Cmd+Enter 语义不变；“下一个未翻译”按真实查询结果循环定位。row/status/source/target/QA 提供读屏标签，状态与 Proposal 均有文字，不只靠颜色。
- **调用链**：行键盘事件 → `adjacentRowIndex` → TanStack Virtual `scrollToIndex` → 延迟页面加载 → DOM focus；未翻译快捷键 → 既有只读 `linguistCatQuery(status=untranslated, includeIndex=true)` → `nextSegmentId` → 同一虚拟焦点入口。
- **关键语义**：
  - interactive child 自己处理键盘，行 Arrow/Enter 只在 row 本体获得焦点时触发，避免 textarea 光标被劫持。
  - locked/archived 行 Enter 不进入编辑；边界 Arrow 不越界；未翻译定位末尾后回绕。
  - QA Finding 属 PB-070/071；当前“下一个 QA 问题”明确显示“尚未运行 QA”并禁用，不伪造 Finding。
- **改动文件**：
  - `apps/electron/src/renderer/features/linguist/projects/{CatWorkspace.tsx,cat-virtual-utils.ts,cat-virtual-utils.test.ts}`
  - `apps/electron/scripts/smoke/{probe-import.ts,probe-cat-tools.ts}`（键盘/a11y、20 次搜索 p95、同 HOME 重启）
  - `apps/electron/package.json` + `bun.lock`（Electron 0.15.24，无新增依赖）
  - 触点文档与双账本
- **TDD 实录**：
  - RED：`adjacentRowIndex` / `nextSegmentId` 尚未导出，测试模块加载失败。
  - GREEN：上下界行移动与匹配 ID 循环定位 2 个新增测试通过；与编辑键盘测试合计 6/6。
- **验证（实测）**：
  - 键盘/虚拟工具测试 ✅ 6/6；`cd apps/electron && bun run test:linguist` ✅ 54/54
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：677 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅（0.15.24 未签名产物）
  - `node scripts/smoke/probe-import.ts` ✅ 24/24：10k Grid、Arrow/焦点/读屏标签、Enter/Escape、Next untranslated；20 次搜索 p95=62ms≤200ms。
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 20/20：Agent Proposal 在 Grid 审核，同一临时 HOME 重启后译文恢复且 pending=0。
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18。
- **knownLimitations**：
  - “下一个 QA 问题”在真实 QA Finding 接入前明确禁用；PB-070/071 应复用当前虚拟焦点入口连接 open Finding ID 索引。
  - 只实现计划要求的上下行 Arrow；左右 Arrow 留给 textarea 光标/未来单元格导航，不额外建立二维焦点模型。
  - p95 为本机未签名打包应用、单次运行中的 20 个端到端样本，不外推为所有硬件基准。
  - 打包探针命中已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，三个探针完整通过。
- **rollback**：`git reset --hard 9e91a215`

## G6 门禁：CAT Workspace

- **状态**：`gate_passed`
- **依赖**：PB-065 ✅
- **baseCommit**：`6364ea75`
- **resultCommit**：`SELF`
- **范围**：仅执行 Batch 6 Gate、生成 `docs/roadmap/G6_REPORT.md` 并更新双账本；没有产品代码改动。
- **门禁结果**：
  1. 10k 真机打包应用 ✅：末行可见，DOM 13 rows，500ms 锚点漂移 0px；20 次端到端搜索 p95=62ms≤200ms（probe-import 24/24）。
  2. Grid Proposal Review ✅：项目 Agent 只能创建 Proposal；Grid/Rail 人工接受后 target=`生命药水`、revision=1；批量/冲突/stale 同样通过。
  3. 重启恢复 ✅：真正关闭 packaged Electron 并以同一临时 HOME 重启；已接受译文可见，pending Proposal=0（probe-cat-tools 20/20）。
  4. 键盘/a11y ✅：Arrow row focus、Enter edit、Escape、Next untranslated、显式 row/cell 标签和文字状态通过；QA 未运行入口诚实禁用。
  5. Proma 回归 ✅：G0 18/18；typecheck 10/10；test:linguist 54/54；cat-store 71/71；cat-tools 16/16；boundaries 3/3；根 bun test 677/2（仅既有两条环境失败）。
- **knownLimitations**：
  - QA Finding 属 PB-070/071；当前不伪造 Next QA issue。
  - p95 是当前机器未签名产物的 20 个样本，不外推为通用硬件结论。
  - fake model 不验证外部 Provider；SecurityAgent 终止后走既有 plaintext fallback。
- **结论**：`gate_passed`；详见 `docs/roadmap/G6_REPORT.md`。
- **rollback**：`git reset --hard 6364ea75`

## PB-070：QA Core

- **状态**：`unit_verified`
- **依赖**：G6 ✅
- **baseCommit**：`6393d83d`
- **resultCommit**：`SELF`
- **范围**：在纯 `@linguist/cat-core` 新增确定性 QA Core，覆盖计划首版 11 条规则：placeholder/tag/empty target/forbidden/required/number/whitespace/repeated punctuation/source equals target/inconsistent repeated source/target length。
- **调用链**：`runQa(segments, options)` → 复用 PB-052 `runDeterministicHardRules` 的结构签名与术语/数字判定 → 补充展示型规则 → 稳定按 Segment 顺序/code 输出 `OpenQaFindingInput[]`。
- **关键语义**：
  - empty、placeholder、tag、术语和数字为 blocking；空白、重复标点、源译相同、重复源文不一致与长度为 warning。
  - locked/空源文跳过；相同源文的多个非空 target 才触发 consistency；同一 Segment 同 code 去重。
  - 长度使用 Unicode code point；默认仅 source≥10 时检查 0.4~2.5 比例，阈值可由明确调用方覆盖。
- **改动文件**：
  - `packages/linguist-cat-core/src/{qa-core.ts,qa-core.test.ts,qa-finding.ts,index.ts}` + `package.json`（0.0.3）
  - `bun.lock`、触点文档与双账本
- **TDD 实录**：
  - RED：测试因 `./qa-core` 不存在而模块加载失败。
  - GREEN：完整 11 码目录/severity、健康内容、locked 与输入反序确定性 2/2；关联 hard-rule/lifecycle 合计 17/17。
- **验证（实测）**：
  - `bun test packages/linguist-cat-core/src/qa-core.test.ts packages/linguist-cat-core/src/hard-rules.test.ts packages/linguist-cat-core/src/qa-finding.test.ts` ✅ 17/17
  - `bun run typecheck` ✅ 10/10
  - 根 `bun test`：679 pass / 2 fail（仅 PB-003 起两条既有 Electron/Bun 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - 本票是纯规则核心，不持久化/展示 Finding；Repository、Tool 与 UI 属 PB-071。
  - required/forbidden term 由调用方显式传入；项目 TM/TB 管理在 PB-080 接入前不推测术语。
  - 长度阈值是可配置启发式 warning，不作为 blocking 导出门。
- **rollback**：`git reset --hard 6393d83d`

## PB-071：QA Tool 与 UI

- **状态**：`packaged_app_verified`
- **依赖**：PB-070 ✅
- **baseCommit**：`4fbffb29`（PB-070；其后 `5dcd197a` 为用户明确要求的独立图标修正）
- **resultCommit**：`SELF`
- **范围**：将 PB-070 的确定性 QA 接入每项目 SQLite、Pi 工具和 CAT Workspace。Agent 仅可 `cat_run_qa` / `cat_get_qa_findings`；用户 UI 才可在编辑后标记 resolved，或记录原因后 waive。
- **调用链**：Agent/UI → `@linguist/cat-tools` 或 renderer → preload → QA IPC → `LinguistProjectService` → `QaFindingsRepository` / `runQa`；UI 跳转复用 PB-065 的虚拟 Grid 焦点路径。
- **关键语义**：
  - run QA 以一次事务替换当前 open Finding，保留已 resolved/waived 的历史；相同问题再次出现时重开。
  - Finding 绑定产生时的 Segment revision；“标记解决”只允许该 Segment 已被人工编辑到更高 revision，waive 必填原因。
  - QA 面板支持 status/severity 筛选、分页、跳转、运行/重跑；10k Grid 不把总项目 Finding 数伪装成单行状态。
  - 临时 HOME 的打包 smoke 通过显式 `LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS=1` 不触发 macOS Keychain；正常应用未设置此变量，仍使用 safeStorage。
- **改动文件**：
  - `packages/linguist-cat-store/{package.json,src/{schema.ts,index.ts,qa-runner.ts,qa-runner.nodetest.ts,qa-findings.nodetest.ts,repositories/{rows.ts,qa-findings.ts}}}`（schema v3、revision/waiver、project runner）
  - `packages/linguist-cat-tools/{package.json,src/{types.ts,factory.ts,tools.nodetest.ts}}`（仅两项 QA Agent 工具）
  - `packages/shared/{package.json,src/types/linguist.ts}`（四 QA IPC 契约；0.1.49）
  - `apps/electron/src/main/{ipc.ts,lib/channel-manager.ts,lib/channel-runtime-api-key.test.ts,lib/linguist/{project-service.ts,cat-workspace-ipc.ts,cat-workspace-ipc.nodetest.ts,ipc-contract.test.ts,session-cat-tools.ts,session-cat-tools.nodetest.ts}}` + `src/preload/index.ts`
  - `apps/electron/src/renderer/{components/agent/{tool-phrase.ts,tool-phrase.test.ts,tool-utils.ts},features/linguist/projects/{QaFindingsPanel.tsx,CatWorkspace.tsx,CatContextRail.tsx}}`
  - `apps/electron/scripts/smoke/{fake-model-server.ts,probe-cat-tools.ts,probe-import.ts,run-g0-smoke.ts,probe-pi-stream.ts,probe-project-{session,skill}.ts,probe-projects-view.ts}` + Electron `package.json`（0.15.25）
  - 触点登记与双账本
- **TDD 实录**：
  - RED：store `qa-runner.nodetest.ts` 因 runner 不存在失败；GREEN：真实 SQLite 验证 revision、豁免原因与重跑生命周期。
  - RED：CAT tools / session tools 断言只有旧 6 个工具；GREEN：8 个工具中仅 QA 的 run/list 为新增，resolve/waive/commit 永不存在。
  - RED：IPC contract 缺四个 QA channel；GREEN：主进程、preload、稳定码信封与 renderer 工作流完整对齐。
- **验证（实测）**：
  - `cd packages/linguist-cat-store && bun run test` ✅ 72/72
  - `cd packages/linguist-cat-tools && bun run test` ✅ 17/17
  - `cd apps/electron && bun run test:linguist` ✅ 55/55；`bun test src/main/lib/channel-runtime-api-key.test.ts` ✅ 3/3
  - `bun run typecheck` ✅ 10/10；根 `bun test` ✅ 679 pass / 2 fail（PB-003 起既有 Electron/Bun 环境失败）；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅ 未签名 `out/mac-arm64/Linguist Agent.app`
  - `node scripts/smoke/probe-import.ts` ✅ 26/26：run/filter/jump、编辑后 resolve、带原因 waive、rerun、10k Grid/CAS/a11y 回归。
  - `node scripts/smoke/probe-cat-tools.ts` ✅ 21/21：Agent 运行 QA、读取结果、无 resolve/waive/commit 工具、同 HOME 重启回归。
  - `node scripts/smoke/run-g0-smoke.ts` ✅ 18/18，临时 HOME seed 无 Keychain 弹窗。
- **knownLimitations**：
  - required/forbidden terminology 仍是明确传入的确定性 QA 规则；项目 TB 管理和真实术语配置留 PB-080。
  - QA 解决/豁免不向 Agent 暴露；这是产品权限边界，不是工具能力缺失。
  - smoke plaintext 开关只用于 hermetic 临时 HOME；用户正常渠道凭证仍依赖 OS safeStorage，若用户自己的旧 Keychain 项损坏，需在 macOS 对话框中恢复默认并重新录入相应密钥。
- **rollback**：`git revert <PB-071 resultCommit>`（保留先前的 PB-010 图标修正）

## PB-072：Export Adapter

- **状态**：`integration_verified`
- **依赖**：PB-071 ✅
- **baseCommit**：`06a10b93`
- **resultCommit**：`SELF`
- **范围**：从已校验的 source blob 与当前 Segment target 生成每资产 staging artifact；不覆盖 source，先 reimport 验证，再写 digest 和 SQLite artifact metadata。开放 blocking QA 默认 fail closed，唯一放行路径是 PB-071 人工 resolve/带理由的 waive。
- **调用链**：human export action（PB-073 接 UI）→ `LinguistProjectService.stageExport` → per-asset `QaFindingsRepository.count` → `stageAssetExport` → format adapter export → reimport compare → `projects/<id>/exports/` 原子写入 → `ExportsRepository.record`。
- **关键语义**：
  - QA gate 按 asset 范围查询 `status=open AND severity=blocking`，不会被其他资产的历史 Finding 误阻；无 bypass 参数，waive reason 继续保存在 QA 审核记录中。
  - 每个 staging 文件名带 SHA-256 前缀；不同内容不复写旧 artifact，旧 metadata 永远指向其原始 digest。
  - reimport 必须保留相同 stable position / 有效文本（target 非空取 target，否则取 source）；丢段抛 `FORMAT_SEGMENT_LOST` 且不创建文件或 metadata。
- **改动文件**：
  - `packages/linguist-cat-store/{package.json,src/{export-staging.ts,export-staging.nodetest.ts,index.ts,repositories/qa-findings.ts}}`（0.0.6，staging/reimport/digest/metadata 与 asset QA 查询）
  - `apps/electron/src/main/lib/linguist/{project-service.ts,project-service.nodetest.ts,errors.ts,errors.test.ts,ipc-contract.test.ts}`（QA export gate 与 `EXPORT_BLOCKED_BY_QA`）
  - `packages/shared/{package.json,src/types/linguist.ts}`、`apps/electron/{package.json,src/renderer/features/linguist/projects/{project-utils.ts,project-utils.test.ts}}`、`bun.lock`（0.1.50 / 0.15.26 及中文错误文案）
  - Proma 触点登记与双账本
- **TDD 实录**：
  - RED：`export-staging.nodetest.ts` 引用不存在的 staging 模块而失败；GREEN：真实 SQLite source blob 经过 adapter export/reimport 后才原子写入，故意丢段 adapter 被 `FORMAT_SEGMENT_LOST` 拒绝且 exports/ 为空。
  - RED：服务测试调用不存在的 `stageExport`，并要求 blocking Finding 零 artifact；GREEN：按 asset 计数、人工 waive 后导出、source 字节不变与 metadata 记录均在真实 node:sqlite 验证。
  - RED：新增第 25 个稳定错误码使 IPC/renderer 完备性断言失败；GREEN：两处目录和中文文案表同步为 25，防止契约漂移。
- **验证（实测）**：
  - `cd packages/linguist-cat-store && bun run test` ✅ 74/74
  - `cd apps/electron && bun run test:linguist` ✅ 56/56
  - `bun test apps/electron/src/main/lib/linguist/errors.test.ts apps/electron/src/main/lib/linguist/ipc-contract.test.ts apps/electron/src/renderer/features/linguist/projects/project-utils.test.ts` ✅ 49/49
  - `bun run typecheck` ✅ 10/10；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅ 未签名 `out/mac-arm64/Linguist Agent.app`（0.15.26）。
- **knownLimitations**：
  - 本票只生成主进程持有的 staging artifact；native Save dialog、文件 copy 与用户成功反馈属于 PB-073，当前未伪造 renderer 导出入口。
  - QA waiver 理由持久化在对应 Finding；artifact metadata 记录 artifact 的 digest、段数与创建时刻，PB-080 前不新增宽泛审计 JSON 模型。
- **rollback**：`git revert <PB-072 resultCommit>`

## PB-073：Native Save

- **状态**：`integration_verified`
- **依赖**：PB-072 ✅
- **baseCommit**：`1c1735f5`
- **resultCommit**：`SELF`
- **范围**：资产行的人工导出入口、主进程 verified staging → 原生 Save dialog → copy 链路，以及 renderer-safe 的无路径导出契约；不增加 Agent 导出工具、不改变 PB-072 的 QA gate 或 source preservation。
- **调用链**：资产行「导出」→ preload `linguistExportsSaveAsset({projectId, assetId})` → `createLinguistExportIpc.saveAsset` → `stageExport`（blocking QA / reimport / digest）→ `dialog.showSaveDialog` → `copyFileSync` → 无路径 artifact 成功提示。
- **关键语义**：
  - renderer 输入仅有 `projectId` 和 `assetId`；响应 artifact 只有 id、assetId、SHA-256、段数和创建时刻，绝不泄露 staging、项目或用户目标路径。
  - 非法 asset、归档项目与 blocking QA 都在 native Save picker 前以稳定信封拒绝；取消是 `{cancelled:true}` 正常分支。
  - 原生默认文件名是原资产 basename，内部 digest 文件名只留在项目 `exports/` staging；copy 失败收敛为既有 `INTERNAL`，不泄露本机路径。
- **改动文件**：
  - `apps/electron/src/main/lib/linguist/{export-ipc.ts,export-ipc.nodetest.ts,project-service.ts}`、`packages/linguist-cat-store/src/export-staging.ts`（主进程交付链与默认 basename）
  - `packages/shared/{package.json,src/types/linguist.ts}`、`apps/electron/{package.json,src/main/ipc.ts,src/preload/index.ts}`、`bun.lock`（`linguist.exports.saveAsset` 契约与 0.0.7 / 0.1.51 / 0.15.27）
  - `apps/electron/src/renderer/features/linguist/projects/ProjectAssetsSection.tsx`（逐资产导出、忙碌/取消/失败/a11y 反馈）与 `apps/electron/scripts/smoke/probe-import.ts`（打包 UI 接线与 QA 筛选竞态等待）
  - `apps/electron/src/main/lib/linguist/ipc-contract.test.ts`、Proma 触点登记与双账本
- **TDD 实录**：
  - RED：新增 `export-ipc.nodetest.ts` 引用不存在的处理器，`test:linguist` 如预期报 `ERR_MODULE_NOT_FOUND`；GREEN：真实 SQLite 项目验证 staging/copy、取消、非法 asset、blocking QA、归档项目均符合信封与 picker 前置边界。
  - 契约测试固定唯一 Save 通道及 preload/main 接线；打包 UI 探针固定每资产导出按钮与非法 asset 在 native dialog 前拒绝。
- **验证（实测）**：
  - `cd packages/linguist-cat-store && bun run test` ✅ 74/74
  - `cd apps/electron && bun run test:linguist` ✅ 59/59；`bun test src/main/lib/linguist/ipc-contract.test.ts` ✅ 16/16
  - `bun run typecheck` ✅ 10/10；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `bun test` ⚠️ 681 pass / 2 fail：既有 pure-Bun 下 Electron named export 环境失败（`agent-session-manager.test.ts`、`channel-runtime-api-key.test.ts`），与本票无关。
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅ 未签名 `out/mac-arm64/Linguist Agent.app`（0.15.27）；`node scripts/smoke/probe-import.ts` ✅ 28/28（导出入口/预检、CAT 10k、QA、重启隔离均通过）。
- **knownLimitations**：
  - Playwright 无法驱动 macOS 原生 Save 面板；主进程 copy 由真实 SQLite + picker stub 验证，打包 UI 已验证入口与预检，但用户选择实际落盘目标的真机操作尚未手动验收，故不标记 `packaged_app_verified` 或 `real_machine_verified`。
  - 单次取消仍保留 PB-072 已验证的项目 staging artifact/metadata；它不会写用户目标，也不会触碰 source。
- **rollback**：`git revert <PB-073 resultCommit>`

## PB-074：完整纵向 E2E

- **状态**：`real_machine_verified`
- **依赖**：PB-073 ✅
- **baseCommit**：`0f22d8e1`
- **resultCommit**：`SELF`
- **范围**：新增打包应用的自动纵向探针：UI 创建项目与项目 Chat → preload 发送的模型工具往返 → Proposal → 人工接受 → QA blocking 导出 → 处理/豁免 → adapter export/reimport verify → 同 HOME 重启恢复。原生 Open/Save、用户选择目标后的 UI 重导入与重启后 CAT 核验由真机 Gate 完成，绝不以 CLI 伪装完成。
- **调用链**：`fake-cat-pb074` → `cat_get_segments` → 真实 tool result 中的 `id/revision` → `cat_propose_translations` → Context Rail 人工接受 → QA 人工豁免 → `LinguistProjectService` QA gate；导出 adapter reparse/持久化复用 PB-072/PB-073。
- **关键语义**：
  - fake model 不从用户提示偷取 Segment ID；只有收到真实 `cat_get_segments` 的 `items[0].id/revision` 后才创建 Proposal。
  - 导出前强制断言 `EMPTY_TARGET` 阻断真实 `linguistExportsSaveAsset`；接受后确认 `REPEATED_PUNCTUATION` 带原因豁免且 open/blocking 为零。
  - 自动探针只对可控制的打包 App 路径给 PASS；原生文件对话框两项始终打印 `MANUAL`，不计为通过。
- **改动文件**：
  - `apps/electron/scripts/smoke/{fake-model-server.ts,probe-pb074-e2e.ts}`（严格工具依赖 fake 场景与 11 项自动打包纵向断言）
  - `apps/electron/package.json` / `bun.lock`（`smoke:g7`，Electron 0.15.28）
  - Proma 触点登记与双账本
- **验证（实测）**：
  - `bun run typecheck` ✅ 10/10
  - `cd packages/linguist-cat-store && bun run test` ✅ 74/74；`cd apps/electron && bun run test:linguist` ✅ 59/59
  - 根 `bun test` ⚠️ 681 pass / 2 fail（仅 PB-003 起既有 pure-Bun Electron named export 环境失败）
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅ 未签名 `out/mac-arm64/Linguist Agent.app`（0.15.28）
  - `cd apps/electron && node scripts/smoke/probe-pb074-e2e.ts` ✅ **11 PASS / 0 FAIL / 2 MANUAL**：打包 App UI 项目/Chat、真实 Pi Tool result → Proposal、人工审核/QA、blocking gate、adapter reparse、重启恢复均通过。
  - 真机 Gate（同一 0.15.28 打包产物的隔离测试副本；仅为规避 macOS 单实例而修改 bundle ID/显示名并 ad-hoc 重签，`app.asar` 未改）✅ 临时 `HOME` / `--user-data-dir` 均实际落盘；native Open 导入 synthetic `mini_game_ui.xliff` 7 段 → 手动编辑 `欢迎回来，{player}！` → QA 0 Finding → native Save 至新目标 `mini_game_ui_g7.xliff` → 第二 CAT 项目 native Open 重导入 7 段并显示该译文 → 真实退出、同一临时根重启、再次打开 CAT 后仍显示 7 段与该译文。fixture SHA-256 `5a6ce10ce092…a6d90be`，导出 SHA-256 `50c4fc283583…8ede08a`（预期因译文变化而不同）。
- **knownLimitations**：
  - 自动 adapter `export/verify` 不等同于产品的 native Save IPC；native Save/用户目标 copy/UI 重导入已由上述真机步骤覆盖。
  - fake model 是 hermetic 测试模型，不代表用户的真实供应商 Key/模型质量；真实项目应先用副本做小范围验收。
  - 项目 Chat 由 UI 打开，消息经 preload IPC 发送；本票没有覆盖 Composer DOM 输入/发送控件。
- **rollback**：`git revert <PB-074 resultCommit>`

## G7 门禁：可交付纵向产品

- **状态**：`gate_passed`
- **依赖**：PB-074 ✅
- **baseCommit**：`b1ea513d`
- **resultCommit**：`SELF`
- **范围**：仅执行 Batch 7 Gate、生成 `docs/roadmap/G7_REPORT.md` 并更新双账本；没有产品代码改动。
- **门禁结果**：
  1. 完整纵向链 ✅：两条互补 packaged run 覆盖 UI 创建项目、7 段 XLIFF 导入、项目 Chat 真实 tool result → Proposal、人工接受、QA blocking/waiver、adapter export/reimport 与同 HOME 重启（PB-074 11 PASS / 0 FAIL / 2 MANUAL）。
  2. 原生文件流 ✅：隔离真机通过 native Open 导入 7 段 → 手动编辑 → QA 0 Finding → native Save → 第二 CAT 项目 native Open 重导入并显示译文 → 真正退出/重启后再核验 CAT 译文。
  3. 产品回归 ✅：typecheck 10/10；test:linguist 59/59；cat-store 74/74；cat-tools 17/17；boundaries 3/3；G0 18/18；probe-import 28/28；probe-cat-tools 21/21；根 bun test 681/2（仅既有 Electron/Bun 环境失败）。
- **knownLimitations**：
  - fake model 不验证外部 Provider 或真实项目的模型质量。
  - 自动项目 Chat 消息由 preload IPC 发送，不覆盖 Composer DOM；原生 Open/Save 已另行真机实测。
  - 仅验证当前 macOS arm64 未签名产物；签名、公证与其他平台留 Batch 11。
- **结论**：`gate_passed`；详见 `docs/roadmap/G7_REPORT.md`。
- **rollback**：`git reset --hard b1ea513d`

## PB-080：TM/TB 管理（Reference）

- **状态**：`integration_verified`
- **依赖**：G7 ✅
- **baseCommit**：`3293e8d2`
- **resultCommit**：`SELF`
- **范围**：计划 §21 PB-080——导入 TMX/CSV TM 与 term CSV/TBX；exact/fuzzy search；term status；case sensitivity；notes；UI 管理；Tool 查询。不做复杂向量检索。
- **施工记录**：本票由 Codex 施工至未提交半成品后停止，由 Kimi 接手：核验全部测试与类型、对齐一处过时测试断言（行为不变）、补触点登记（含 PB-073/074 漏记的 reason）、跑打包验证、补双账本并提交。
- **调用链**：renderer `ReferenceManager`（白名单 UI）→ preload `linguistReferences*` 五方法 → `LINGUIST_REFERENCE_IPC_CHANNELS` 五通道 → 白名单 `reference-ipc.ts` 校验 → `LinguistProjectService` → cat-formats TMX/TBX/CSV 解析 → cat-store tm-units/term-entries 仓储（schema v4）。import 通道由主进程注入真实 `dialog.showOpenDialog` picker，renderer 永不提交路径/字节；archived 项目在 picker 打开前即被拒绝。Context Rail 经只读 getContext 展示当前段 tmMatches/termMatches。
- **关键语义**：
  - TM：内容派生稳定 id；同源文不同译文共存；重复导入 unchanged 幂等；内容 id 冲突与跨项目写入被拒绝；read-only 项目句柄拒绝写。
  - 匹配：exact/contains/fuzzy 确定性打分（dice coefficient / token Jaccard + 阈值），排序确定性（exact < contains < fuzzy、score 降序）；score 是文字相似度，不是模型置信度，绝非向量检索（计划明确不做）。
  - 术语：status 四态（allowed/preferred/forbidden/deprecated）、caseSensitive、note；同一术语多个 preferred 译文只标 `conflict`，不擅自选第一条；批量导入事务回滚。
  - TMX/TBX 解析基于新增 runtime dep `@xmldom/xmldom@^0.8.11`（MIT）；xml-parser 拒绝内部实体声明防 XXE；locale 歧义不猜测，零有效翻译对/畸形 XML 明确失败；CSV 复用既有 RFC-4180 读取器（`parseDelimitedTable`），不复制第二套 parser。
  - 空库工具提示改为可行动文案（"Import TMX or CSV into this project…"）。
- **改动文件**：
  - `packages/linguist-cat-formats/{package.json,src/{xml-parser.ts,tmx.ts,tbx.ts,xml-import.test.ts,adapters/csv.ts,index.ts}}`（0.0.1）
  - `packages/linguist-cat-store/{package.json,src/{schema.ts,project-database.ts,index.ts,repositories/{tm-units.ts,term-entries.ts},references.nodetest.ts,database.nodetest.ts}}`（0.0.8）
  - `packages/linguist-cat-tools/{package.json,src/{factory.ts,types.ts,tools.nodetest.ts}}`（0.0.5）
  - `packages/shared/{package.json,src/types/linguist.ts}`（0.1.52；错误码目录不变）
  - `apps/electron/{package.json,src/main/ipc.ts,src/preload/index.ts,src/main/lib/linguist/{project-service.ts,reference-ipc.ts,reference-ipc.nodetest.ts,session-cat-tools.nodetest.ts},src/renderer/features/linguist/projects/{ReferenceManager.tsx,CatContextRail.tsx,CatWorkspace.tsx}}`（0.15.29）
  - `bun.lock`、Proma 触点登记（6 条既有条目追加 PB-080）与双账本
- **TDD 实录**：
  - 接手核验：`session-cat-tools.nodetest.ts` 两处空库 note 断言仍匹配旧文案而 RED；GREEN：对齐到 cat-tools 已更新的新文案（行为未改，测试追平）。
  - 测试覆盖：references.nodetest.ts 8 例（幂等/打分排序/项目隔离与 id 冲突/只读拒绝/upsert 项目域/大小写+状态+冲突排序/批量回滚）、reference-ipc.nodetest.ts 2 例（picker 导入后项目域可见；archived 拒绝先于 picker）、xml-import.test.ts 7 例（namespace 与 lang/locale 歧义不猜/畸形与零有效对明确失败/TBX v2+v3/拒绝内部实体声明）。
- **验证（实测）**：
  - `bun run typecheck` ✅ 10/10
  - `cd packages/linguist-cat-store && bun run test` ✅ 83/83；`cd packages/linguist-cat-tools && bun run test` ✅ 17/17；`bun test packages/linguist-cat-formats` ✅ 72/72
  - `cd apps/electron && bun run test:linguist` ✅ 61/61
  - 根 `bun test` ⚠️ 688 pass / 2 fail（仅 PB-003 起既有 pure-Bun Electron named export 环境失败）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` ✅ 未签名 `out/mac-arm64/Linguist Agent.app`（0.15.29；@xmldom 经 esbuild 束入主进程运行时无错）
  - `cd apps/electron && node scripts/smoke/probe-cat-tools.ts` ✅ 21 PASS / 0 FAIL（打包 CAT 探针回归）
- **knownLimitations**：
  - Reference UI/IPC 无打包 App 点击级探针；打包验证为构建 + 既有 CAT 探针回归，特性覆盖在主进程 nodetest 层（含真实 picker 注入与项目隔离）。
  - fuzzy 是确定性文字相似度（dice/token Jaccard），非向量语义检索；score 不表示模型置信度。
  - "notes" 落在术语 note 与 TM origin；TMX/TBX 未识别自定义属性不导入，locale 歧义与零有效对明确报错而非静默猜测。
- **rollback**：`git revert <PB-080 resultCommit>`

## PB-081：XLSX 双语格式 Adapter

- **状态**：`integration_verified`
- **依赖**：PB-080 ✅
- **baseCommit**：`176006a2`
- **resultCommit**：`SELF`
- **范围**：计划 §21 PB-081「更多格式」。范围决策：计划列表 PO/XLSX/SRT/VTT/ASS 中仅 XLSX 有旧仓真实需求证据（旧导入路由支持 .xlsx + office workers + workbook_mapping.ts），按「只有现有真实工作需求高的格式才做」只做 XLSX；PO/SRT/VTT/ASS 不做，需求出现时单独立票。Trados（SDLXLIFF）与 Phrase（MXLIFF / bilingual DOCX）经用户 2026-07-26 明确为常态需求，立项 PB-086/PB-087/PB-088（用户授权扩围，各自独立提交）。
- **施工记录**：adapter 与测试由 Kimi coder subagent 按 CSV adapter 契约施工，Kimi 复核 diff、独立重跑全部验收命令、补触点登记与双账本并提交。
- **关键语义**：
  - 纯字节 adapter（jszip 容器 + @xmldom 读 workbook/rels/sharedStrings 值 + 自写 namespace 容忍扫描器做 sheet 字符串手术）；import/export 共用同一条管线保证两侧 key/source/target 一致。
  - 列映射与 CSV adapter 同一套别名表（csv.ts 导出复用，未复制第二份）：key/source/target/locked/context + 中文别名；synthesized `#row-<ordinal>` key + warning；重复 key 报错。
  - 字节稳定硬规则：导出先全量校验（未知 key/丢段/源文不匹配/locked 变更/重复 key → FormatExportError），无改动直接返回 originalBytes；有改动仅替换目标 worksheet 条目，其余条目内容字节一致（测试显式断言）。
  - 变化 target 单元格改写为 inlineStr（保留 r/s 属性），不碰 sharedStrings.xml；XML 转义含 `\r`→`&#xD;`、C0 控制字符 `_xHHHH_`、字面 `_xHHHH_` 先 `_x005F_` 保护；首尾空白写 `xml:space="preserve"`。
- **改动文件**：
  - `packages/linguist-cat-formats/{package.json,src/{index.ts,adapters/{csv.ts,xlsx.ts,xlsx.test.ts}}}`（0.0.2；csv.ts 仅加 export 关键字，行为零变化；新增 runtime dep jszip@^3.10.1）
  - `packages/shared/{package.json,src/types/linguist.ts}`（0.1.53；导入白名单加 'xlsx'）
  - `apps/electron/{package.json,src/main/lib/linguist/{format-registry.ts,project-ipc.ts,ipc-contract.test.ts}}`（0.15.30；注册第四 adapter、picker 标签同步、契约断言同步）
  - `bun.lock`、Proma 触点登记（4 条既有条目追加 PB-081）与双账本
- **TDD 实录**：xlsx.test.ts 20 例（detect 置信度、表头别名含中文、synthesized key、重复 key、locked 读写与导出拒绝、未修改导出字节一致、修改导出→重导入 target 可见、未修改条目字节一致断言、XML 转义含 `_xHHHH_` 往返、多 sheet warning、公式/错误单元格行为）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-formats` ✅ 92/92（xlsx 20 + 既有 72）
  - `cd apps/electron && bun run test:linguist` ✅ 61/61
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - 仓根 `bun test` ✅ 708 pass / 2 fail（仅 PB-003 起既有 Electron named-export 环境失败，与本票文件无引用关系）
- **knownLimitations**：
  - v1 单 worksheet（第一个 sheet，多表给 `xlsx.multi_sheet` warning）；旧 LA 的交互式多 sheet 列映射 UI 未迁——约定式别名列覆盖常见表头，交互映射需求出现时单独立票。
  - 单元格按存储文本读取：数字不格式化、日期保持序列号；布尔读作 TRUE/FALSE；错误单元格读空 + warning；公式只读缓存值、永不求值。
  - 修改导出的 zip 容器字节可与原文件不同（未修改条目内容字节一致；未修改导出返回原始字节）。
  - 打包 App 未对本票重跑 smoke:pack（adapter 纯字节、jszip 为纯 JS；打包验证随下一打包票或 G8 覆盖）。
- **rollback**：`git revert <PB-081 resultCommit>`

## PB-086：Trados SDLXLIFF Adapter

- **状态**：`integration_verified`
- **依赖**：PB-081 ✅
- **baseCommit**：`f0806c5e`
- **resultCommit**：`SELF`
- **范围**：用户 2026-07-26 授权扩围（"实际项目里 Trados/Phrase 文件是常态需求"），Trados SDLXLIFF 双语格式支持。SDLXLIFF = XLIFF 1.2 + sdl: 命名空间。
- **施工记录**：Kimi coder subagent 施工（旧仓 sdlxliff.ts 语义提取 + provenance 登记），Kimi 复核 diff、独立重跑全部验收命令、补触点登记与双账本并提交。
- **关键语义**：
  - 独立 `SdlXliffAdapter`（不扩展 XliffAdapter）：分段 trans-unit（`<seg-source><mrk mtype="seg" mid>`）按 mrk 拆成多逻辑段（key=mid），与 XliffAdapter 的"一 unit 一段"模型在解析/导出三处分叉，扩展会浑浊契约并威胁既有 xliff 测试；`xliff.ts` 仅 `statusFromXliff` 加 export（零行为变化）。
  - locked：file/trans-unit `translate="no"` 整 unit 锁定；`<sdl:seg locked="1|true|yes|locked">` 按 mrk 锁定（与旧仓一致）。
  - status：空 target → untranslated；conf=ApprovedTranslation/ApprovedSignOff → reviewed；conf=Translated → translated（偏差：旧三档只能落 draft）；其余非空 → draft；非分段 unit 复用 plain-XLIFF `statusFromXliff`（偏差：旧一律 draft）。
  - detect 置信度与 XliffAdapter 不互抢（.sdlxliff+sdl 命名空间 0.95 vs 0.5；显式 .xliff/.mqxliff 改名文件按扩展名优先降级——已文档化；plain xliff 绝不误判 0 vs 0.9），registry 层测试锁定。
  - 导出硬规则同族：未修改返回原字节、分段 target 按 mrk inner splice、locked 拒绝、丢段报错；sdl: 元数据（conf/locked/modified_on）不回写、分段 target 不写 state=（避免误标兄弟段）、inline tag 逐字往返（与 memoQ 政策一致，偏差全文见 sdlxliff.ts 头注释）。
- **改动文件**：
  - `packages/linguist-cat-formats/{package.json,src/{index.ts,adapters/{sdlxliff.ts,sdlxliff.test.ts,xliff.ts}}}`（0.0.3；xliff.ts 仅加 export）
  - `packages/shared/{package.json,src/types/linguist.ts}`（0.1.54；白名单加 'sdlxliff'）
  - `apps/electron/{package.json,src/main/lib/linguist/{format-registry.ts,project-ipc.ts,ipc-contract.test.ts}}`（0.15.31；注册第五 adapter）
  - `docs/attribution/SOURCE_PROVENANCE.md`（sdl 语义提取与 fixture 形状参考登记）
  - Proma 触点登记（3 条既有条目追加 PB-086）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：sdlxliff.test.ts 13 例（detect 评分矩阵、registry 不互锁、mrk 拆段/locked/conf 映射、非分段映射、warning 路径、harness round-trip、byte-stable 抽查、mrk 补写/target 创建、错误路径）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-formats` ✅ 106/106（新 13 + 既有 93 不回归）
  - `cd apps/electron && bun run test:linguist` ✅ 61/61；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - sdl 字节被显式改名 `.xliff` 时按扩展名路由到 XliffAdapter（mrk 逐字留在单段、无 sdl 语义）——刻意的"扩展名优先"降级，改一行置信度即可切换为内容优先。
  - sdl: 元数据不回写；真实客户 sdlxliff 兼容性未验证（旧仓 outputs/ 下真实样本按纪律未触碰，需用户提供脱敏样本）。
  - 打包 App 未重跑 smoke:pack（零新依赖、纯字节 adapter；打包验证随 G8 覆盖）。
- **rollback**：`git revert <PB-086 resultCommit>`

## PB-087：Phrase MXLIFF Adapter

- **状态**：`integration_verified`
- **依赖**：PB-086 ✅
- **baseCommit**：`13139218`
- **resultCommit**：`SELF`
- **范围**：用户 2026-07-26 授权扩围（"实际项目里 Trados/Phrase 文件是常态需求"），Phrase (Memsource) MXLIFF 双语格式支持。MXLIFF = XLIFF 1.2 + `m:` 命名空间（`xmlns:m="http://www.memsource.com/mxlf/2.0"`）。
- **施工记录**：Kimi coder subagent 施工（旧仓 phrase_mxliff.ts / batch_workspace.ts 语义提取 + provenance 登记），Kimi 复核 diff（adapter 全文 + 接线 diff）、独立重跑全部验收命令、补触点登记与双账本并提交。
- **关键语义**：
  - 独立 `PhraseMxliffAdapter`（id `phrase_mxliff_1_2`，不扩展 XliffAdapter）：段模型平坦（一 trans-unit 一段，与 plain XLIFF 同形，无 seg-source/mrk 拆段），但 `m:` 方言携带独立状态契约（confirmed 工作流级别、group 上下文、locked 属性族），按 PB-086 同原则单独立 adapter；零行为变化复用 xliff-xml 层。
  - locked：file/trans-unit `translate="no"` 或 truthy `m:locked`（回落 plain `locked`；取值 1/true/yes/locked 不区分大小写）→ locked（旧仓 isLocked 一致）。
  - status：空 target → untranslated；truthy `m:confirmed`（非 ''/"0"/"false"）数值级别 ≥2 → reviewed、其余真值 → translated（偏差：旧三档单确认层，本仓四档拆 translated/reviewed，与 PB-086 conf 映射同原则）；无 confirmed 回退 `statusFromXliff`（偏差：旧完全忽略 state）。
  - context：trans-unit `<note>` → context.note；无 note 时经 `m:para-id` 查 group `<context context-type="x-key-note">` 兜底；`resname` → context.origin；`m:para-id` 仅身份元数据，绝不做 key（多个 trans-unit 可共享段落）。
  - detect 置信度不互抢：m 命名空间+.mxliff → 0.95（压 XliffAdapter 0.5）；m 命名空间+其他扩展名 → 0.7（显式 .xliff/.mqxliff 仍由 XliffAdapter 0.9 优先，扩展名优先降级同 PB-086）；仅 .mxliff 无命名空间 → 0.4（让位 plain XLIFF 0.5）；皆无 → 0。
  - 导出硬规则同族：未修改返回原字节、仅重写变更 target（缺失则创建于 source 后、自闭合展开）、非空写入 target 打 state="translated"、locked 拒绝、丢段/未知 key/源不匹配报错；`m:` 元数据（confirmed/modified-at/level-edited/locked/para-id/trans-origin）绝不回写（偏差：旧仓导出会打 confirmed 时间戳）、tag 与 `{n}` 占位符逐字往返（偏差：旧仓对配对 master XLIFF 做 rehydration，本票不做）。
- **改动文件**：
  - `packages/linguist-cat-formats/{package.json,src/{index.ts,adapters/{phrasemxliff.ts,phrasemxliff.test.ts}}}`（0.0.4）
  - `packages/shared/{package.json,src/types/linguist.ts}`（0.1.55；白名单加 'mxliff'）
  - `apps/electron/{package.json,src/main/lib/linguist/{format-registry.ts,project-ipc.ts,ipc-contract.test.ts}}`（0.15.32；注册第六个 adapter）
  - `docs/attribution/SOURCE_PROVENANCE.md`（m: 语义提取登记）
  - Proma 触点登记（3 条既有条目追加 PB-087）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：phrasemxliff.test.ts 14 例（detect 评分矩阵、registry 不互锁、locked/confirmed 级别映射、state 回退、group note 兜底、para-id 不作 key、missing id warning、harness round-trip、byte-stable 抽查、target 创建/自闭合展开、locked/丢段错误路径）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-formats` ✅ 120/120（新 14 + 既有 106 不回归）
  - `cd apps/electron && bun run test:linguist` ✅ 61/61；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - mxliff 字节被显式改名 `.xliff` 时按扩展名路由到 XliffAdapter（m: 元数据逐字保留但无语义映射）——刻意的"扩展名优先"降级，与 PB-086 同政策。
  - `m:` 元数据不回写；master XLIFF 配对 rehydration 不做（旧仓该能力依赖工作区配对文件，需求出现时单独立票）；真实客户 mxliff 兼容性未验证（旧仓真实样本按纪律未触碰，需用户提供脱敏样本）。
  - 打包 App 未重跑 smoke:pack（零新依赖、纯字节 adapter；打包验证随 G8 覆盖）。
- **rollback**：`git revert <PB-087 resultCommit>`

## PB-088：Phrase Bilingual DOCX Adapter

- **状态**：`integration_verified`
- **依赖**：PB-087 ✅
- **baseCommit**：`4d39e888`
- **resultCommit**：`SELF`
- **范围**：用户 2026-07-26 授权扩围（"实际项目里 Trados/Phrase 文件是常态需求"），Phrase (Memsource) bilingual DOCX 双语格式支持。多表 WordprocessingML 包：metadata/intro 表 + 内容表（逻辑列 [ID, ICU, #, Source, Target, Status, Comment]）。
- **施工记录**：Kimi 先行格式调研（旧仓写侧语义 + 第三方 OSS Supervertaler-Workbench 格式知识交叉验证列布局/段 id 形状/表检测；仅知识不抄码），Kimi coder subagent 施工，Kimi 复核 adapter 全文与接线 diff、独立重跑全部验收命令、补触点登记与双账本并提交。
- **关键语义**：
  - 独立 `PhraseDocxAdapter`（id `phrase_bilingual_docx_1`，extensions ['.docx']）：段行 = `<w:tr>` 内 ≥5 `<w:tc>` 且首格 trim 非空含 `:`（段 id 形状 `<base32>:<index>`）且非表头行（任一格含 `Source (xx)`/`Target (xx)` 字样）；key=cells[0]、source=cells[3]、target=cells[4]（`<w:t>` 拼接 + 实体解码，旧仓 cellText 语义）；重复 key 报错；8-grid 变体（Source 格 gridSpan=2）在原始 XML 层仍 7 格，正则扫描天然兼容。
  - status：空 target → untranslated；非空一律 draft（保守偏差：Phrase 状态码目录未公开文档化，不臆测；cells[5] 原值只读 surfaced 到 context.note=`Phrase status: <值>`）；locked 恒 false（灰底是列锁定非段锁定）；cells[2]（#）→ context.origin。
  - `{N}`/`{N>text<N}`/`<N}`/`{N><N}` 占位符逐字保留（同 PB-087 政策）。
  - detect：非 zip/无 word/document.xml/无 Phrase 段行形状 → 0（普通 DOCX 刻意不认领，落无 adapter 类型错误；xlsx 带 xl/ 条目天然不互抢）；命中形状 .docx → 0.9、其他扩展名 → 0.7。
  - 导出硬规则同 zip 族（PB-081）：无变更返回原字节；变更段只重写本行 cells[4]（旧仓 rewriteCellText 等价：首 `<w:t>` 写入+强制 xml:space="preserve"、其余清空、无 `<w:t>` 则 `</w:tc>` 前插入完整 run）；空串 target 合法；unknown key/丢段/source 不匹配报错；变更时 jszip DEFLATE 重打包只换 word/document.xml（容器字节形状可不同，内容等价，已文档化）。
- **改动文件**：
  - `packages/linguist-cat-formats/{package.json,src/{index.ts,adapters/{phrasedocx.ts,phrasedocx.test.ts}}}`（0.0.5）
  - `packages/shared/{package.json,src/types/linguist.ts}`（0.1.56；白名单加 'docx'）
  - `apps/electron/{package.json,src/main/lib/linguist/{format-registry.ts,project-ipc.ts,ipc-contract.test.ts}}`（0.15.33；注册第七个 adapter）
  - `docs/attribution/SOURCE_PROVENANCE.md`（旧仓写侧语义 + Supervertaler 格式知识参考登记）
  - Proma 触点登记（3 条既有条目追加 PB-088）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：phrasedocx.test.ts 14 例（detect 评分矩阵、registry 五 adapter 不互抢、段模型/表头跳过/非段行跳过、占位符逐字、实体解码、context 映射、重复 id、harness round-trip、byte-stable 抽查、target 重写/无 `<w:t>` 插入/xml:space/多空格、空串写入、错误路径）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-formats` ✅ 134/134（新 14 + 既有 120 不回归）
  - `cd apps/electron && bun run test:linguist` ✅ 61/61；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - Status 码目录未解读（非空 target 一律 draft 待人工分诊）；Comment 列不 surfaced；普通 DOCX 不支持（刻意）。
  - 正则扫描假定机器生成的 `w:` 前缀 WordprocessingML（同族取舍）；真实客户 Phrase DOCX 兼容性未验证（仅合成 fixture，真实样本需用户提供脱敏版）。
  - 打包 App 未重跑 smoke:pack（零新依赖；打包验证随 G8 覆盖）。
- **rollback**：`git revert <PB-088 resultCommit>`

## PB-083：Review Skill 和 Finding（Independent Critic）

- **状态**：`integration_verified`
- **依赖**：PB-071（QA Finding 体系）✅、PB-053（Proposal 人工审核链）✅
- **baseCommit**：`894d44f7`
- **resultCommit**：`SELF`
- **范围**：计划 Batch 8 PB-083，唯一硬约束"Review 只产生 Finding 或修订 Proposal，不能直接 Commit"。提取规格 docs/roadmap/LEGACY_EXTRACTION_SPEC.md PB-083 小节。
- **施工记录**：Kimi 先行集成侦察（skill 缝/工具工厂/store 现状/旧契约逐行），定身份派生与持久化设计；Kimi coder subagent 施工；Kimi 复核（验收独立重跑含 node --test 层、工具/ schema/仓储/skill diff 全看）、补 cat-core 版本 bump（subagent 遗漏，0.0.3→0.0.4）、触点登记与双账本并提交。
- **关键语义**：
  - cat-core 新增 `independent-critic.ts`（旧仓 222 行契约全量提取，行为逐字保真：类别五档、严重度三档与新仓 QaFindingSeverity 逐字一致、subject 单高风险段、独立性断言、canonical JSON sha256 完整性链、内容派生 artifactId/findingId、deepFreeze、targetedRepairScope 只圈范围）与 `evidence.ts`（write_policy 证据可引用判定随迁：6 条 audit-only 前缀正则 + 两函数）。
  - cat-store schema v5：`critic_artifacts(artifact_id PK, segment_id, created_at, artifact_json)` + 段索引；repository 幂等 insert（INSERT OR IGNORE）/getById/listBySegment，读取经 parseIndependentCriticArtifact 重验 hash；新增 `qaFindings.insertOpen`（不擦除既有 open findings 的追加写，供工具单事务组合）。
  - cat-tools 第九个工具 `cat_submit_critic_review`：模型入参仅 segmentId/candidateProposalId/findings[1~20]；**身份与哈希全部运行时派生**——critic=`session:<sessionId>`（无绑定会话直接拒写）、profileHash=评审 SKILL.md 字节 sha256（回退 `linguist-critic-profile:v1`，skill 字节经 electron 装配层注入，tools 包保持 Electron-free）；candidate 按 store proposal 行派生（不存在/跨项目/段不匹配拒绝；candidateHash=sha256(canonical{proposalId,segmentId,target,revision})；无 sessionId 的提案回退 `proposal:<id>` 合成身份）；同会话评审自己提案 → 契约独立性断言抛错（刻意闸门，拒绝后零落库）。
  - 落库：单事务双写 critic_artifacts + QA findings（code=`CRITIC_<CATEGORY>`、severity 透传、message=explanation、status open）；返回 artifactId/findingIds/qaFindingIds/repairScope；重复提交幂等。
  - 评审 Skill 资产 `resources/linguist-skills/project-reviewer/SKILL.md`（frontmatter 对齐 project-assistant）：只读、证据纪律（禁 tool trace）、不评审自己产出、修订只走人工审核 Proposal、绝不声称 QA 通过/写段/导出；extraResources 整目录自动随包。
  - "不能直接 Commit"结构性落实：工具无任何段/目标写路径；suggestedRepair 只是建议文本，修订经既有 cat_propose_translations 人工审核链。
- **改动文件**：
  - `packages/linguist-cat-core/{package.json,src/{index.ts,evidence.ts,evidence.test.ts,independent-critic.ts,independent-critic.test.ts}}`（0.0.4）
  - `packages/linguist-cat-store/{package.json,src/{index.ts,schema.ts,project-database.ts,repositories/{rows.ts,critic-artifacts.ts,qa-findings.ts},critic-artifacts.nodetest.ts,qa-findings.nodetest.ts}}`（0.0.9）
  - `packages/linguist-cat-tools/{package.json,src/{index.ts,types.ts,factory.ts,tools.nodetest.ts}}`（0.0.6）
  - `apps/electron/{package.json,src/main/lib/linguist/{session-cat-tools.ts,session-cat-tools.nodetest.ts}}`（0.15.34）
  - `resources/linguist-skills/project-reviewer/SKILL.md`（新）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-083 提取登记）
  - Proma 触点登记（1 条既有条目追加 PB-083）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：cat-core +20（critic 18：全部错误路径/独立性/hash 篡改/deepFreeze/确定性 + evidence 2）；cat-store +5（迁移升版/round-trip/幂等/按段查询 + insertOpen 1）；cat-tools +5（happy path 双写/同会话拒绝/proposal 不存在/audit-only 证据拒绝/空 findings 拒绝）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-{core,store,tools}` ✅ 69/69（bun 层）
  - `cd packages/linguist-cat-store && bun run test` ✅ 88/88（node --test 层，+5 不回归）
  - `cd packages/linguist-cat-tools && bun run test` ✅ 22/22（node --test 层，+5 不回归）
  - `cd apps/electron && bun run test:linguist` ✅ 61/61；`bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - 评审会话启动编排与技能注入切换未做（PB-082 Best 档负责）；当前能力=契约+工具+skill 资产，尚无自动触发路径。
  - subject.risk 恒 'high'（planIndependentCritic 已导出留给 PB-082 策略层）；无 sessionId 的旧提案用合成 candidate 身份（独立性退化为恒真，已文档化）。
  - QA UI 未加 critic 专用展示（finding 以 CRITIC_* code 出现在既有 QA 面板）；artifact JSON 无 UI 查看器。
  - 打包 App 未重跑 smoke:pack（随 G8 覆盖）。
- **rollback**：`git revert <PB-083 resultCommit>`

## PB-082：质量策略档 Fast / Balanced / Best（计划 §21）

- **状态**：`integration_verified`
- **依赖**：PB-040（常驻项目 Skill 注入缝）✅、PB-034（项目会话绑定/归档闸门）✅、PB-083（评审 Skill 与工具）✅
- **baseCommit**：`4854c863`
- **resultCommit**：`SELF`
- **范围**：计划 Batch 8 PB-082：三档质量策略（fast/balanced/best）存项目、按档切换注入策略 Skill、评审角色会话标记与发起编排；刻意不做模型 Router（用户显式选模型不变）。
- **施工记录**：Kimi 定设计决策（profile 存 project.json 可选字段缺省 balanced、normalize 不抛错、评审按钮全档可见、reviewer 经 AgentSessionMeta.linguistSessionRole 冻结标记、三个 strategy skill 目录、初始评审指令经既有 createForProject+sendMessage 编排、不做自动 critic 编排）；Kimi coder subagent 施工；Kimi 复核（验收独立重跑、quality-profile/project-skill/策略 skill/ProposalInbox/service diff 全看）、触点登记（7 条）与双账本并提交。
- **关键语义**：
  - cat-core `quality-profile.ts`：`LinguistQualityProfile` 三档 union；`normalizeQualityProfile`（absent/unknown → balanced，永不抛错，读取路径兜底，不回写）；`QUALITY_PROFILE_POLICIES` 策略表（fast：大批次打满 50 段/单轮/不逐段查 TM/TB；balanced：10~20 段/拿不准先查库；best：≤5~10 段/逐段查库+提案后请用户发起独立评审）；纯数据不做 Router。
  - 持久化：project.json 可选 `qualityProfile?`（PB-082 前旧文件无此键天然兼容；createProject 不写）；cat-store `setQualityProfile`（projects.json 索引 + project.json 双写、updatedAt 刷新；读取经 normalize 兜底）；归档拒绝落在服务层 LinguistProjectArchivedError（同 editSegment/runQa 模式；store 无 archived 错误码本票不新增——subagent 偏离记录，合理）。
  - IPC：shared 新增 `SET_QUALITY_PROFILE` 通道与线类型（LinguistQualityProfile 镜像重定义、LinguistProjectInfo.qualityProfile 必有值经 toProjectInfo 边界收敛）；project-ipc 三档字面量严格校验（INVALID_INPUT）；createForProject 请求 `role?: 'reviewer'`（session-ipc 只收 'reviewer' 字面量）；`ChatSessionInfo.role` 映射 assistant/reviewer。
  - 角色冻结：`AgentSessionMeta.linguistSessionRole?: 'reviewer'`（缺省=assistant 刻意不落库）；updateAgentSessionMeta 白名单不含该字段且展开 updates 后强制恢复原值（含 any 断言绕过，同 linguistProjectId 绑定冻结模式）。
  - Skill 注入矩阵（project-skill.ts，每次发送实时重解析）：普通会话 [] ；评审会话（role=reviewer）只注入 project-reviewer；普通项目会话注入 project-assistant + strategy-<profile>；missing [] ；archived 仍注入（发送被 PB-034 闸门阻断）；策略读取失败/缺 SKILL.md → 只注入 project-assistant；服务不可解析/常驻目录缺 SKILL.md → []（全 fail closed）。
  - 策略 Skill 资产三目录（frontmatter 对齐 project-assistant，extraResources 整目录随包）：各档工作方式（批次/查库/评审）+ 纪律重申（不直接写段/不声称 QA 通过/不导出）+ 不注册工具不扩权声明。
  - renderer：ProjectDetailPanel 三段选择器（radio + 当前档一句说明，归档禁用，IPC 响应就地刷新）；ProjectChatsSection 评审会话「评审」徽标；ProposalInbox pending 行「独立评审」按钮（全档可见、归档禁用、防重复点击、无渠道 toast）→ createForProject(role:'reviewer') → sendAgentMessage 评审指令（fire-and-forget，失败只 toast 会话仍可手动补发）→ 跳转新会话。
- **改动文件**：
  - `packages/linguist-cat-core/{package.json,src/{index.ts,project.ts,quality-profile.ts,quality-profile.test.ts}}`（0.0.5）
  - `packages/linguist-cat-store/{package.json,src/{project-index.ts,project-index.nodetest.ts}}`（0.0.10）
  - `packages/shared/{package.json,src/types/{linguist.ts,agent.ts}}`（0.1.57）
  - `apps/electron/{package.json,src/main/{ipc.ts,lib/agent-session-manager.ts,lib/linguist/{project-service.ts,project-ipc.ts,project-skill.ts,session-binding.ts,session-ipc.ts,session-cat-tools.ts,*.nodetest.ts,ipc-contract.test.ts}},src/preload/index.ts,src/renderer/features/linguist/projects/{ProjectDetailPanel.tsx,ProposalInbox.tsx,ProjectChatsSection.tsx,project-utils.ts,proposal-inbox-utils.ts,*.test.ts}}`（0.15.35）
  - `resources/linguist-skills/strategy-{fast,balanced,best}/SKILL.md`（新）
  - Proma 触点登记（7 条既有条目追加 PB-082）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：cat-core +4（normalize 兜底/策略表形状）；cat-store +4（setQualityProfile 双写/归档读取 normalize 兼容，另改 1 条 round-trip 断言）；electron main nodetest +4（service 归档拒绝/ipc 校验/session-binding role/session-ipc role）+ project-skill 重写 9 条注入矩阵 + ipc-contract 6→7 通道；renderer +5（project-utils 3、proposal-inbox-utils 2）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-{core,store,tools}` ✅ 73/73（bun 层）
  - `cd packages/linguist-cat-store && bun run test` ✅ 92/92（node --test 层）
  - `cd packages/linguist-cat-tools && bun run test` ✅ 22/22（node --test 层）
  - `cd apps/electron && bun run test:linguist` ✅ 67/67
  - `bun test apps/electron/src/renderer/features/linguist/projects` ✅ 41/41
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - 根 `bun test` 779 pass / 2 fail（PB-003 起既有 Electron named-export 环境失败，非本票引入）
- **knownLimitations**：
  - 策略档只改 guidance（批次/查库/评审要求），不切模型/参数（Router 刻意不做）；评审发起是人工按钮，无自动 critic 编排。
  - Fast/Balanced 档不强制评审（reviewPass 仅 best=true），但按钮全档可发起（策略决定是否要求，不限制能否）。
  - Best 档盲评验收（产出质量是否显著更好）属 PB-085，阻塞于真实 API Key + 人工盲评。
  - 打包 App 未重跑 smoke:pack（随 G8 覆盖）。
- **rollback**：`git revert <PB-082 resultCommit>`

## PB-084：Batch Consistency（批量一致性定点修复）

- **状态**：`integration_verified`
- **依赖**：PB-080（确定性 QA 4 码）✅、PB-083（CRITIC_ 3 码与评审行）✅、PB-053（Proposal 人工审核链）✅
- **baseCommit**：`ac6f8774`
- **resultCommit**：`SELF`
- **范围**：计划 Batch 8 PB-084：只检查并修复命中 Segment（repeated source / terminology / character names / punctuation / voice profile），禁止全 Batch 无差别重翻。提取规格 docs/roadmap/LEGACY_EXTRACTION_SPEC.md PB-084 小节。
- **施工记录**：Kimi 定设计决策（7 码集合=确定性 4 码 ∪ critic 3 码；evidenceSources/changeType 按规格丢弃；cat-core 投影 + 第十个工具 check-only/repair 两模式；不做 UI）；Kimi coder subagent 施工；Kimi 复核（验收独立重跑、batch-consistency 全文与 factory diff 全看）、provenance 登记、触点登记（1 条）与双账本并提交。
- **关键语义**：
  - cat-core `batch-consistency.ts`：`BATCH_CONSISTENCY_CODES` 7 码（INCONSISTENT_REPEATED_SOURCE/REQUIRED_TERM/FORBIDDEN_TERM/REPEATED_PUNCTUATION ∪ CRITIC_CONSISTENCY/CRITIC_VOICE/CRITIC_TERMINOLOGY）；`buildBatchConsistencyPass` 纯投影（只看 open+一致性码，不重查不重跑，authority='advisory_finding'/canCommit=false 烧死，deepFreeze）；按 source 分组，建议 target=组内 NFKC+trim 归一化非空 target 多数计票（平票取 compareSegments 序首个，归一化只用于计票、返回代表段原文）；锁定段参与计票（审校基准）但绝不生成 proposal；全空组只报告；引用缺失段的 finding 忽略不掀翻。
  - `targetedRepairProposalInputs`：只为「当前 target 与建议值归一化后不同」的未锁定段生成 CreateProposalInput（baseRevision 当前 revision，evidenceRefs 带该段 finding ids）；已一致段跳过 → 重跑幂等。
  - 工具 `cat_run_batch_consistency`（第 10 个）：check-only（默认）**零写库**——确定性 QA 用与 cat_run_qa 相同的 runQa 引擎内存重算，与库中 open findings（含 CRITIC_ 行）按内容派生 id 合并去重；刻意不走 store runProjectQa（它会 DELETE 所有 open findings 抹掉 critic 评审行）。repair：同款确定性硬门校验（锁定码除外）+ `db.proposals.insertPendingMany`（与 cat_propose_translations 同一仓储路径），绝不写段；单段违规/缺段记入 skipped（hard rule <CODE> / segment missing / no suggested target / already consistent 四档原因）不掀翻整批。
  - 幂等三重保障：已一致段投影层跳过；proposal id 内容派生（同输入同 id）；insertPendingMany 对相同 pending 行去重。nodetest 实测同态重跑 proposalIds 相同、无重复行。
  - 装配层零功能改动（工厂数组自动包含新工具），session-cat-tools 仅注释同步；renderer 零改动；shared/cat-store 未动。
- **改动文件**：
  - `packages/linguist-cat-core/{package.json,src/{index.ts,batch-consistency.ts,batch-consistency.test.ts}}`（0.0.6）
  - `packages/linguist-cat-tools/{package.json,src/{types.ts,factory.ts,index.ts,tools.nodetest.ts}}`（0.0.7）
  - `apps/electron/{package.json,src/main/lib/linguist/{session-cat-tools.ts,session-cat-tools.nodetest.ts}}`（0.15.36；仅注释同步）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-084 提取登记）
  - Proma 触点登记（1 条既有条目追加 PB-084）与双账本；零新依赖（bun.lock 不变）
- **TDD 实录**：cat-core +8（7 码过滤/分组/计票/平票/锁定投票不修复/全空组/缺失段忽略/幂等跳过）；cat-tools +4（check-only 零写库含 CRITIC_ 合并/repair 落 pending 同路径/硬门跳过/同态重跑幂等）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 10/10
  - `bun test packages/linguist-cat-{core,store,tools}` ✅ 81/81（bun 层）
  - `cd packages/linguist-cat-store && bun run test` ✅ 92/92（node --test 层）
  - `cd packages/linguist-cat-tools && bun run test` ✅ 26/26（node --test 层）
  - `cd apps/electron && bun run test:linguist` ✅ 67/67
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
- **knownLimitations**：
  - 组成员由 findings 驱动：runQa 跳过锁定段，锁定段只有被持久化 CRITIC_ finding 引用时才入组投票。
  - 单段组建议值=自身译文 → repair 不产生 proposal（already-consistent）；此类修复需模型经 cat_propose_translations 自拟译文。
  - character names 无独立确定性 code（由 CRITIC_CONSISTENCY 覆盖）；check-only 的 QA 是内存重算，不落库（库中 open 行不变）。
  - repair 报告 groups 未分页（规模受项目大小天然约束）；probe-cat-tools.ts 保持 PB-042 时代 8 工具探针清单（PB-083 同例，另票处理）。
  - 打包 App 未重跑 smoke:pack（随 G8 覆盖）。
- **rollback**：`git revert <PB-084 resultCommit>`

## G8 门禁：质量与格式扩展

- **状态**：`gate_blocked`（自动证据全绿；硬标准待 PB-085 人工盲评）
- **依赖**：PB-080 ✅、PB-081 ✅、PB-082 ✅、PB-083 ✅、PB-084 ✅、PB-086 ✅、PB-087 ✅、PB-088 ✅；PB-085 blocked（备料 `c5900116`）
- **baseCommit**：`7ab2af48`
- **resultCommit**：`SELF`
- **范围**：执行 Batch 8 Gate、生成 `docs/roadmap/G8_REPORT.md` 并更新双账本；另含一处探针文案修正（`2c355aa5`，PB-080 空态文案追平），没有产品代码改动。
- **门禁结果**：
  1. 自动化回归 ✅：typecheck 10/10；根 bun test 787 pass / 2 fail（仅 PB-003 起既有环境失败）；cat 包 bun 层 81/81；cat-store 92/92；cat-tools 26/26；test:linguist 67/67；renderer 41/41；boundaries 3/3。
  2. 打包与探针 ✅：smoke:pack PASS（0.15.36 未签名产物）；G0 18/18；probe-import 28/28（首轮 27/1 为空态文案过时断言，已追平并如实记录）；probe-cat-tools 21/21；PB-074 纵向 11 PASS / 0 FAIL / 2 MANUAL（同 G7 口径）。
  3. 硬标准 ⛔ BLOCKED：Balanced 可靠默认 + Best 可测收益需 PB-085 人工盲评（真实 API Key 三档产出 + 用户打分）；判定式已预写（备料 §3：Balanced 三维 ≥4 且 blocking ≤10%；Best 两维 +0.5 或 blocking 降 50%），不以 fake model 或自评冒充。
- **knownLimitations**：硬标准未判定；策略档不切模型参数；PB-086~088 真实客户样本未验证（合成 fixture）；仅 macOS arm64 未签名产物。
- **结论**：`gate_blocked`；详见 `docs/roadmap/G8_REPORT.md`。annotated tag `pb-g8-quality-strategies` 标记 Batch 8 代码状态；PB-085 完成后按预备判定式复核升级。Batch 9 与质量档无技术依赖，继续推进。
- **rollback**：`git reset --hard 7ab2af48`（仅撤销 gate 文档与探针修正）

## PB-090：Legacy Scanner（只读旧布局扫描 CLI）

- **状态**：`integration_verified`
- **依赖**：G8（代码状态）✅；docs/migration/CAT_EXTRACTION_MATRIX.md §5（布局蓝本）✅
- **baseCommit**：`755ea81f`
- **resultCommit**：`SELF`
- **范围**：计划 §22 PB-090：独立 CLI 直接读取旧目录副本（不启动旧 cat-server），输出 project list/health/source roots/internal uploads/assets/segments/TM/TB/proposals/chat presence/unsupported fields/digest；不得修改原数据。判定信号输出归本票，处置决策归 PB-091/092。
- **施工记录**：Kimi 派 explore subagent 完成布局侦察（旧仓源码行号级，未触 data/**）并定两项决策（包名 linguist-legacy-migration 用 MATRIX 预定位；chat presence 只报存在+条目数）；Kimi coder subagent 施工；Kimi 复核（验收独立重跑、bun.lock 偏离逐行核验、readOnly 红线 grep 核验）、provenance/触点登记与双账本并提交。
- **关键语义**：
  - 新包 `@linguist/legacy-migration@0.0.1`（零 npm 依赖，仅 devDep typescript；sha256 用 node:crypto 自写保持零 workspace 依赖）。
  - 版本 oracle：`data/.schema.json` 存在=v2 缺失=v1；读取优先级 SQLite 权威（authority-v1.json marker）→ read-cache JSON → legacy JSON，逐域标注 DataSource；authority 激活时严格不读 legacy JSON 为权威值（忠实旧仓 assertCatCoreLegacyAllowed 语义），legacy 文件仅作 digest/分叉证据。
  - 只读红线：SQLite 一律 `DatabaseSync(path, {readOnly:true})`；src 零写 API（grep 核验）；nodetest 含扫描前后目录快照逐字节相等 + 固定时钟两次 stdout 全等。
  - HealthSignal 13 码（sqlite-authority-active/sqlite-db-missing/sqlite-unreadable/sqlite-legacy-divergence/read-cache-missing-projection/orphan-project/orphan-sqlite-project/project-id-mismatch/root-missing/external-root-with-managed-uploads/internal-copy-only/invalid-permission-mode/file-unreadable），info|warning|error 三级；root-missing 降级 workspace-only 继续扫（旧仓同场景直接 ENOENT 崩溃，scanner 自 catch）。
  - UnsupportedField 五 scope（manifest/agent-settings/project-files/batch/segment）永不抛；invalid `full` permission 记信号+unsupported 不中断（blocker 原文要求）。
  - digest：关键文件（project.json/tm.json/termbase.json/chat.json/batches/*/batch.json/uploads/*）各自 sha256+bytes；项目 digest=按 relPath 排序三元组清单 JSON 的 sha256；segments/TM/TB 只报计数与 status 分布。
  - CLI 复刻 cat-store 模式：COMMANDS 表驱动、parseFlags 严格白名单（最小扩展 booleanFlags 支持 --json 免值）、stdout key:value+JSONL、stderr error[CODE]、exit 0/1/2/3、runCli(argv,io) 可注入（同步版）、invokedAsMain 守卫。
- **改动文件**：
  - `packages/linguist-legacy-migration/`（整包新写：package.json/tsconfig/test 两 loader/src{layout,model,sqlite-probe,scan,report,cli,index}.ts + scan/cli.nodetest.ts）（0.0.1）
  - `bun.lock`（登记新 workspace 包 + 同步 HEAD 既有但 lock 滞后的 5 个版本漂移：electron 0.15.36/cat-core 0.0.6/cat-formats 0.0.5/cat-store 0.0.10/cat-tools 0.0.7；漂移先于本票存在，frozen install 此前必失败；零依赖解析变化——subagent 偏离记录，Kimi 逐行核验接受）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-090 提取登记）
  - Proma 触点登记（bun.lock 1 条既有条目追加 PB-090）与双账本
- **TDD 实录**：13 例 node --test——六情形各一棵树（正常 v1/正常 v2+SQLite/invalid permission/root-missing+internal-copy-only×2/orphan 双向）+ digest 变更敏感 + read-cache 回退（authority 在 sqlite 损坏→source=read-cache+sqlite-unreadable+read-cache-missing-projection）+ 只读保证；cli.nodetest 6 例 spawnSync 真实子进程冒烟（含树快照与固定时钟重放）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 11/11（新增 @linguist/legacy-migration）
  - `cd packages/linguist-legacy-migration && bun run test` ✅ 13/13（node --test 层）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - bun.lock 偏离核验：HEAD package.json 五版本与 lock 同步值逐一比对一致，无依赖解析变化 ✅
- **knownLimitations**：
  - 未在真实旧数据上验证（铁律禁读 data/**，全部合成树）；真实复制样本验证归 G9。
  - SQLite 批量枚举 listBatches 为 O(全部 batch)（scanner 定位可接受）；read-cache 缺投影只发信号不重试。
  - chat presence 不校验 session 完整性（已决策）；quarantine 无旧仓 CAT 对应物，信号供 PB-091/092。
  - 根 AGENTS.md 包清单未登记 linguist-* 包（先于本票滞后，该文件声明经允许后修改）——未动，待用户统一处理。
- **rollback**：`git revert <PB-090 resultCommit>`

## PB-091：Legacy Project Import（旧项目导入新 Project）

- **状态**：`integration_verified`
- **依赖**：PB-090（scanner/布局/digest/sqlite-probe）✅
- **baseCommit**：`914f3d5c`
- **resultCommit**：`SELF`
- **范围**：计划 §22 PB-091：从旧数据副本导入新 Project；必保 Segment order/source/target/locked/revisions 最终语义/TM/TB/QA 状态/artifact references/source digest；不迁旧 Agent Runtime state。
- **施工记录**：Kimi 派 explore subagent（agent-50 恢复，带 PB-090 上下文）完成接入点侦察，定 12 项决策（confirmed→translated 不升 reviewed、proposals/QA 原件归档不入库、artifact=source blob+exports 复制、sidecar 回滚落点、确定性项目 id 幂等拒绝等）；Kimi coder subagent 施工；Kimi 复核（验收独立重跑、bun.lock 偏离核验、写路径仅落 target-root 核验）、provenance/触点登记与双账本并提交。
- **关键语义**：
  - 写库全走 store 公共 API（createProject/assets.insert/tmUnits.importMany/termEntries.importMany/qaFindings.insertOpen+transition/saveAssetSource），绕过 adapter 直建 Segment 行，不经 LinguistProjectService；提取走 PB-090 authority 链（sqlite→read-cache→legacy JSON，v2 cutover 项目迁权威投影）。
  - 段映射：数组序→ordinal；旧 id→key；新 id=deriveSegmentId(assetId,ordinal,key)；new/draft/confirmed→untranslated/draft/translated（未知→draft+计数）；locked 1:1；revision=0 无历史行；sourceHash=fnv1a64；duplicate*/originalTarget/rawSource/rawTarget/confirmationLevel/tuId/updatedAt 等→context.meta 保证据；unresolved* 6 导入期计算字段丢弃计数。
  - TM/TB：tm 五列直搬（origin 无 CHECK 原值）+9 字段丢弃计数；term 默认 allowed、term_history current→preferred/deprecated 系→deprecated、conflict→allowed+计数；override→preferred 合成条目、note 严格按旧 overrideToEntry 公式。
  - QA：每 batch 最新 report（generatedAt 最大）+ ledger review（findingId 键最新 wins）；blocker/warning/advisory→blocking/warning/info；ignore_with_reason/accepted_risk→waived（空 reason 回退文案因 store 强制非空）；fix_required/query→open；无 segmentId 丢弃计数；ledger 链验证失败→全部 open+仍归档（链不可信则 review 不可信）。
  - proposals 不入库（计划必保清单无；旧 set 模型与新 live CAS 不兼容）：原 JSON 归档 legacy-archive/proposals/+计数；exports/ 递归原样复制（sha256+path 入报告）；quality_decision_ledger.jsonl 只验后归档。
  - 三 source 情形：external 在→字节 sha256+blob；uploads 后缀匹配（多候选取数字前缀最大+歧义 note）；全丢→source_sha256=PB-090 batch.json digest 合成值+导出不可用标注（不伪造可运行项目）；paste 类直接丢失分支。
  - format_id 原样落库六项映射（xliff_2_0/未知值原样+exportUnavailable）；同 sourceFile 撞 asset id→后者 skipped+计数。
  - 幂等：确定性 projectId（seed 缺省 `legacy\0<projectId>`）→重复导入 targetConflict 拒写（CLI exit 4）；回滚：sidecar legacy-import.json 七字段+报告 rollback 两行；--dry-run 零写盘（冒烟验证 target 目录不存在）。
- **改动文件**：
  - `packages/linguist-legacy-migration/{package.json,bun.lock 联动,src/{extract,map,import,report-import}.ts 新增,src/{cli,index,layout,scan}.ts 修改,src/{map,import}.nodetest.ts 新增}`（0.0.2；新增 workspace 依赖 cat-core/cat-formats/cat-store）
  - `bun.lock`（workspace 依赖登记，+6 行，零 npm 解析变化）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-091 提取登记）
  - Proma 触点登记（bun.lock 1 条既有条目追加 PB-091）与双账本
- **TDD 实录**：+21 例（map 14：状态矩阵/format 7 映射/段列与派生 id/context 装配/TM 丢弃矩阵/history 分组/override note 公式 5 变体/QA severity/ledger 最新 wins/finding 全路径/最新报告 tie-break；import 7：大端到端三 source 情形+撞 id+QA waive/open/drop+归档逐字节+sidecar 七字段+readOnly 重开校验、dry-run 零写、重复导入拒绝、CLI exit 码、flag 覆盖、ledger 链 4 边界、无效 ledger→全开仍归档）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 11/11
  - `cd packages/linguist-legacy-migration && bun run test` ✅ 40/40（PB-090 既有 19 + 新增 21）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - 写路径核验：mkdir/writeFile 仅落 options.targetRoot（archive+sidecar），旧树只读 ✅
  - subagent 冒烟实录：dry-run 零写；实跑 new-project 落库；重复导入 exit 4；cat-store CLI 读回段计数与状态正确（Kimi 复核报告采信，测试层已覆盖同路径）
- **knownLimitations**：
  - 未在真实旧数据副本验证（归 G9）；governance SQLite 投影（proposals/ledger/checklist）未读——authority=sqlite 且文件层缺失时 QA/proposals 少迁（报告 notes 显示）。
  - createProject 后中途抛错留半成品目录，需按报告 rollback 手工回滚（未做自动回滚，与决策一致）。
  - dry-run 计数为投影值；batches/*/reports/*.md 渲染物未归档（proposals 原 JSON 已归档，可重渲染）。
  - 根 bun test 未全量跑（验收清单外；既有 2 条环境失败与本票无关）。
- **rollback**：`git revert <PB-091 resultCommit>`

## PB-092：损坏和跨 root Project（处置层）

- **状态**：`integration_verified`
- **依赖**：PB-090（信号层）✅、PB-091（导入层）✅
- **baseCommit**：`0f850304`（其间夹用户图标独立 commit，本票改动与其无交集）
- **resultCommit**：`SELF`
- **范围**：计划 §22 PB-092：六 Release Blocker 情形处置——invalid `full` permission、manifest root 已删除、external root + managed uploads、internal copy only、orphan project、quarantine。
- **施工记录**：Kimi 派 explore subagent（agent-50 恢复）完成差距分析，定 8 项决策（external-source 默认 copy 不强制、--salvage-orphan opt-in、quarantined 独立 disposition、blob-store 回退层、chat 三载体归档、chat-only 建 metadata-only 项目、invalid permission 只回声、拒绝报告化 exit 5）；Kimi coder subagent 施工；Kimi 复核（验收独立重跑、disposition.ts 全文审阅）、provenance/触点登记与双账本并提交。
- **关键语义**：
  - disposition 五值词表（imported/partial/archived-only/quarantined/error），推导纯函数优先级：quarantined > error > partial（任何降级）> archived-only（零 CAT 数据有归档）> imported；partial 压 archived-only（CAT 有损不许报成干净归档）；TM-only 项目归 imported。
  - external source 用户选择：`--external-source=copy|reference` 默认 copy；reference 不读 external 字节（测试断言产物 blob=uploads 字节、sourceSha256≠sha256(external)），路径记 sidecar.externalSourceRoot+报告。
  - v2 managed copy 恢复：extract 经 sqlite-probe 既有只读连接扩 kind='source' 读 source_refs 投影；resolveBatchSource 在 uploads 失败后按 sha256 读 CAS blob（读时重算 sha256+核字节数），命中→sourceResolution='blob-store' 真实字节落新 blob；篡改→lost+note。
  - orphan 路由纯函数：manifest 缺失/坏→默认 quarantined（零写盘+完整 ImportReport JSON on stdout+exit 5），--salvage-orphan 且 batch 带语言对→salvage（目录名为名+notes 标注）；orphan-sqlite（ghost）只 quarantined+evidence{readCacheHasProjections, blobStoreBlobs}；纯未知 id 仍 exit 3。
  - chat 三载体：chat.json 字节归档 legacy-archive/chat/、_pi_sessions 清单+行数、agent_events.jsonl 永不导入（hidden_reasoning_trace）；无 sessionId 行记 malformed_chat_session 计数；chat-only 项目（无 batch 且 TM/TB 空）建 metadata-only 项目 disposition=archived-only+sidecar archivedOnly:true（零 asset 不伪造可运行项目）。
  - invalid `full` permission：extract 增 agent_settings probe，导入永不阻断，invalid-permission-mode 信号回声（evidence.permissionMode='full'）。
  - ImportReport 增 disposition/refusal/signals/externalSource/chat 五组字段（version 保持 1 纯增量），PB-094 直接消费。
- **改动文件**：
  - `packages/linguist-legacy-migration/{package.json,src/{disposition.ts,disposition.nodetest.ts} 新增,src/{extract,import,sqlite-probe,scan,layout,report-import,cli,index}.ts 修改,src/{import,cli}.nodetest.ts 扩展}`（0.0.3；零新依赖，bun.lock 不变）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-092 提取登记）
  - Proma 触点登记（PROMA_CORE_TOUCHPOINTS.md 表格行+小节；JSON 零变化）与双账本
- **TDD 实录**：+30 例（disposition 14 纯函数推导/路由全分支；import +14 六情形端到端——invalid permission 不阻断+回声、root-missing→lost→partial、external copy/reference（未读断言）、internal copy v1 回归、v2 blob-store 真 SQLite fixture+篡改→lost、orphan 默认 quarantined 零写盘、salvage 建成、orphan-sqlite evidence、chat-only archived-only+逐字节归档、missing-locales quarantined；cli +2 子进程 exit 5/flag 校验）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 11/11
  - `cd packages/linguist-legacy-migration && bun run test` ✅ 70/70（40 既有 + 30 新增）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - subagent 冒烟实录：scan --json 双项目信号、import --dry-run、reference --json、orphan exit=5+quarantined 报告+target 零写入（测试层覆盖同路径，Kimi 采信）
- **knownLimitations**：
  - 未在真实旧数据副本验证（归 G9）；governance SQLite 投影（proposals/ledger/checklist）仍未读（债务未消，本票只新增 cat-core source_refs 一层）。
  - transcript 渲染与 _pi_sessions 字节归档归 PB-093；本票只保 chat.json 字节+presence/计数。
  - reference 模式 external 路径进 sidecar/报告（用户机器私有路径，用户可见——已决策）。
- **rollback**：`git revert <PB-092 resultCommit>`

## PB-093：Legacy Chat Transcript（旧聊天只读归档转录）

- **状态**：`integration_verified`
- **依赖**：PB-092（chat 三载体与报告骨架）✅
- **baseCommit**：`2188b465`
- **resultCommit**：`SELF`
- **范围**：计划 §22 PB-093：chat.json → 只读静态 transcript 归档（不迁入可继续会话）；_pi_sessions 字节逐字归档；报告纯增量供 PB-094 Verify。
- **施工记录**：Kimi 派 coder subagent（agent-54）施工；Kimi 复核（验收独立重跑、chat-transcript.ts 全文与 import/extract diff 审阅）、provenance/触点登记与双账本并提交。
- **关键语义**：
  - `renderChatTranscript` 纯渲染器（chat-transcript.ts）：零 Date.now/Math.random、archivedAt 全注入时钟，同输入字节全等（测试锁定+冒烟三方 sha256 一致）；PB-094 Verify 可重渲染比对 sha256。
  - 横幅声明只读归档（旧 Runtime/Tool/Prompt/Session 语义不兼容）；provenance 四元组（legacyProjectId/sourceDigest=PB-090 digest/archivedAt/generator）。
  - session 分组：Map 插入序保原行序，节按首行 ts 码元序、同 ts 按 sessionId 字典序；无 sessionId 行进「未分配会话」节（malformed_chat_session 口径不变）。
  - 五 kind：user/assistant→`### 用户/助手 · <ts>` verbatim（assistant 附 usage 行，固定七字段序、String(n) 无 locale）；tool→单行引用块 verbatim+toolCallId（旧 Runtime 单行摘要，args/result 从不入 chat.json，未虚构）；system/error 及域外 kind→标签行。
  - malformed（非对象/缺 ts/kind/text）→ tilde 围栏附录原文 JSON 逐行（JSON 行首永不可能是 ~~~，无法破栏）+malformedRows 计数；消息原文零 md 转义（notes 声明）。
  - 空数组/非数组→transcript=null 不落盘；transcript 计划在写盘前计算（dry-run/conflict 报告同样携带）。
  - _pi_sessions/*.jsonl 字节逐字归档 legacy-archive/chat/pi-sessions/（不解析不渲染，可含 thinking 属用户自有数据）；extract 保留 sha256+字节引用，写入的=哈希过的（消除 TOCTOU）。
  - 报告纯增量：`chat.transcript{path,sha256,bytes,sessions,rows,malformedRows,unassignedRows}|null`+`piSessionsArchived`；`ArchiveEntry.kind` 增 'chat-transcript'|'pi-session'；quarantined 报告 transcript=null/piSessionsArchived=0 与 PB-092 一致；版本 0.0.4。
- **改动文件**：
  - `packages/linguist-legacy-migration/{package.json,src/{chat-transcript.ts,chat-transcript.nodetest.ts} 新增,src/{extract,import,report-import,cli,index}.ts 修改,src/{import,cli}.nodetest.ts 扩展}`（0.0.4；零新依赖，bun.lock 不变）
  - `docs/attribution/SOURCE_PROVENANCE.md`（PB-093 提取登记）
  - Proma 触点登记（PROMA_CORE_TOUCHPOINTS.md 小节；JSON 零变化）与双账本
- **TDD 实录**：+9 例（渲染器 7：五 kind/usage 有无/session 分组排序与同 ts 平局/malformed+未分配/空数组→null/中文多字节+反引号+围栏透传/落盘逐字节 golden；import +5：transcript=null 主端到端、chat-only 断言扩展、sha256 入报告且与盘上一致、pi-session 逐字节含 thinking fixture、重复导入拒绝/dry-run 零写；cli +2：--json transcript 字段+text 模式行、无 chat 项目 transcript=null）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 11/11
  - `cd packages/linguist-legacy-migration && bun run test` ✅ 84/84（70 既有原位扩展 + 14 新增/扩展断言）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - subagent 冒烟实录（Kimi 采信，测试层覆盖同路径）：合成树 import --json（--now 钉死）exit 0；transcript.md/pi-sessions 落盘；手工重渲染 sha256 三方（re-render/report/on-disk）全等 MATCH:true；pi-session Buffer.compare 字节全等；旧树 4 原文件零改动。
- **knownLimitations**：
  - 未在真实旧数据副本验证（归 G9）；超大历史单文件渲染未分页（全量行驻留内存，留 G9 实测后定）。
  - renderer 查看器不在本票（仅静态 md 产物）；_pi_sessions 只归档不解析不渲染（票旨）。
  - 原文 verbatim 意味着含 ###/~~~ 的原文在 md 渲染器中可能影响排版（字节确定性不受影响，notes 已声明）。
  - transcript 无独立 written 字段（按票定接口形状）；governance SQLite 投影仍未读（PB-091 起既有债务）。
- **rollback**：`git revert <PB-093 resultCommit>`

## PB-094：Legacy Migration UI/Report（迁移向导）

- **状态**：`integration_verified`
- **依赖**：PB-090（扫描）✅、PB-091（导入）✅、PB-092（处置）✅、PB-093（transcript/verify 钩子）✅
- **baseCommit**：`1234ea91`
- **resultCommit**：`SELF`
- **范围**：计划 §22 PB-094：Electron 内迁移向导 Scan→Preview→Select→Import→Verify→Report；Batch 9 收官票。
- **施工记录**：Kimi 派 explore subagent（agent-50 恢复）完成 UI 落点侦察并定 7 项决策（整页替换非 Dialog、pickAndScan 合一、verify 并入 import、线类型投影、同步+setImmediate、targetRoot=service.rootDir、报告内存渲染）；Kimi 派 coder subagent（agent-55）施工；Kimi 复核（验收独立重跑、时钟钉住确定性枢纽/ipc 注册/ProjectsView diff 审阅）、触点登记与双账本并提交。
- **关键语义**：
  - 主进程编排 migration-service.ts：pickAndScan 时留存旧根为会话状态，import 只接受上次扫描出现过的 id（路径分隔符拒绝）——§7.4 renderer 永不提交路径结构性落实；degraded sqlite→STORE_SQLITE_UNAVAILABLE（picker 调用前拒绝，nodetest 断言 picker 0 次）。
  - 同步 importLegacyProject 循环 + 每项目 setImmediate 让出 + 进度事件（{projectId,phase:'import'|'verify',index,total}，逐项目两事件严格序）；PROGRESS 为 main→renderer 单向不注册 handle。
  - verify 并入 import 通道：①transcript-rerender（读 sidecar provenance+归档 chat.json 重渲染比 sha256；确定性前提=importSelected 每项目钉住单一时钟使 sidecar.importedAt===transcript archivedAt）②transcript-bytes（落盘字节比对抓写后篡改）③store 三项计数（readOnly 重开比对 assets/segments/tm/term/qa）④store-reopen 异常；零写入项目 skipped、targetConflict 跳过①②仍做幂等复验。
  - 通道 3 个：pickAndScan（picker+扫描合一，取消→{cancelled:true} 正常分支）、import（入参 id 列表+options，响应聚合报告）、progress（事件）；线类型 9 个为 UI 投影（无 digest/逐文件清单/sqlite 细节）。
  - renderer 六步整页向导（仿 selectedProjectIdAtom 切换，非 Dialog）：入口=ProjectsView 标题栏「迁移向导」次级按钮+EmptyState「从旧版迁移」；报告页 5 张 disposition 计数卡片（固定序，空组省略）+每项目行（tone 图标+chip+验证徽章+展开详情）+rollback 文本；报告不持久化。
  - degraded 入口形态：域内无 status 查询通道且 3 通道决策锁定→服务防御性错误码+wizard 整页阻断态（效果等同入口禁用，subagent 偏离记录，合理）。
- **改动文件**：
  - `apps/electron/src/main/lib/linguist/{migration-service,migration-ipc}.ts + 两 nodetest`（新建）
  - `apps/electron/src/renderer/features/linguist/migration/{MigrationWizard.tsx,migration-wizard-utils.ts,migration-wizard-utils.test.ts}`（新建）
  - `packages/shared/src/types/linguist.ts`（通道组+线类型；0.1.58）、`apps/electron/src/{main/ipc.ts,preload/index.ts}`（薄注册+typed API）、`apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx`（两入口+整页切换）、`apps/electron/package.json`（+devDep @linguist/legacy-migration；0.15.37）、`bun.lock`（workspace 登记+版本追平，+4/−3 零 npm 解析变化）
  - Proma 触点登记（JSON 5 条既有条目追加 PB-094 + MD 小节）与双账本；provenance 无新登记（零旧仓提取，全部新写消费迁移包既有导出）。
- **TDD 实录**：+22 例（service 8：投影形状/ScanRootError 映射/全链路+进度严格序/篡改两分支/targetConflict 复验/目录消失错误条目/INVALID_INPUT/degraded；ipc 8：cancelled/degraded 先于 picker/错目录/投影/11 校验负例/无扫描/happy path/INTERNAL 收敛；wizard-utils 6：步骤映射/百分比/分组序/标签色调/默认全选）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun run typecheck` ✅ 11/11
  - `cd apps/electron && bun run test:linguist` ✅ 83/83（migration 新测试 16 条）
  - `bun test`（根）✅ 793 pass / 2 fail（PB-093 起既有环境失败 agent-session-manager/channel-runtime-api-key，bun 直接加载 electron 主进程模块所致，与本票无关；wizard-utils 6/6 pass）
  - `bun run check:boundaries` ✅ 3/3；`git diff --check` ✅
  - `cd apps/electron && bun run build:main` ✅ dist/main.cjs 27.6mb，`grep -c linguist-legacy-import`=4（迁移包已束入）；build:preload ✅
- **knownLimitations**：
  - 单个超大项目导入仍同步阻塞主进程（每项目间 setImmediate 让出+进度事件缓解；决策既定未上 worker_threads）。
  - sqliteOnlyProjects（无目录的 SQLite 投影）不在向导列出/可选（扫描器单列；其导入永远 quarantine，覆盖属后续票）。
  - 报告仅内存渲染不持久化；中途退出不可找回（数据已落 targetRoot，重跑按 targetConflict 幂等拒绝）。
  - targetConflict 项目 verify 跳过 transcript 两检查项（设计上）；迁移运行中不可取消（wizard running 相位禁用退出并提示）。
  - 未在真实旧数据副本端到端验证（归 G9）；真机 smoke（隔离 HOME 走完向导）归 G9 环节。
- **rollback**：`git revert <PB-094 resultCommit>`

## G9 门禁：Legacy 数据迁移

- **状态**：`gate_blocked`（自动证据全绿；硬标准待用户在真实旧数据副本上复跑）
- **依赖**：PB-090 ✅、PB-091 ✅、PB-092 ✅、PB-093 ✅、PB-094 ✅
- **baseCommit**：`cfde479b`
- **resultCommit**：`SELF`
- **范围**：执行 Batch 9 Gate、生成 `docs/roadmap/G9_REPORT.md` 并更新双账本；没有产品代码改动。
- **门禁结果**：
  1. 自动化回归 ✅：typecheck 11/11；根 bun test 793 pass / 2 fail（仅 PB-003 起既有环境失败）；migration 包 84/84；test:linguist 83/83（含 migration 16）；boundaries 3/3；build:main PASS（迁移包束入 main.cjs）。
  2. 安全红线 ✅：scanner 源目录零写 API+扫描前后快照逐字节相等（PB-090 测试锁定）；quarantine 零写盘+exit 5（PB-092）；transcript 重渲染 sha256 三方一致与篡改两分支（PB-093/094）；确定性 projectId 幂等拒写+dry-run 零写（PB-091）。
  3. 硬标准 ⛔ BLOCKED：计划要求「在旧数据的复制样本上通过；绝不直接先改真实 data/**」。真实旧数据位于旧仓 data/**，按纪律不读不复制，只能由用户制作脱敏副本并提供路径；不以合成树冒充真实数据。复核协议（扫描→导入零 error→verify 全绿→三项人工抽查→副本前后逐字节相等）已预写于 G9_REPORT.md §6。
- **knownLimitations**：硬标准未判定；governance SQLite 投影未读（PB-091 起挂账）；sqliteOnlyProjects 不可选；超大项目同步阻塞；报告不持久化；真机 smoke 留副本复跑时一并执行。
- **结论**：`gate_blocked`；详见 `docs/roadmap/G9_REPORT.md`。annotated tag `pb-g9-legacy-migration` 标记 Batch 9 代码状态；用户提供副本后按 §6 协议复核升级。Batch 10 与迁移数据无技术依赖，继续推进。

## PB-082 修正（2026-07-27 用户决策）：全档逐段查库

- **状态**：`integration_verified`（跟随 PB-082 的语义修正）
- **baseCommit**：`a39d6da6`
- **resultCommit**：`SELF`
- **背景**：用户在客户端实测发现只有 Best 档逐段查 TM/TB，指出真实本地化译员每一段都必须参考项目资产（翻译/审校/proofreading 都靠资产确认准确性）——逐段查库是基线实践而非高档特权。用户拍板：三档全部逐段查库，档位差异只在批次大小/打磨轮次/独立评审。
- **改动**（5 文件）：cat-core `quality-profile.ts`（fast.consultTmTb false→true、fast/balanced guidance 文案、字段与策略表注释记录决策）与其测试断言；`strategy-fast`/`strategy-balanced` SKILL.md（frontmatter description+正文条改「逐段查库为全档基线」）；`project-utils.ts` 两档 UI 说明文案。`strategy-best` 本就逐段查库，零改动。
- **验证（实测）**：`bun test packages/linguist-cat-core/src/quality-profile.test.ts` ✅ 4/4；`bun test apps/electron/src/renderer/features/linguist/projects` ✅ 41/41；`bun run typecheck` ✅ 11/11。历史账本 PB-082 条目保留原文（历史记录不改写，以本条目为准）。

## PB-100：LA Design Tokens（设计令牌层）

- **状态**：`integration_verified`
- **依赖**：G9 ✅（Batch 10 首票）
- **baseCommit**：`72cce3f8`
- **resultCommit**：`SELF`
- **范围**：计划 §23 PB-100：建立 LA 自有 token 层（colors/typography/spacing/radius/elevation/motion/light-dark/reduced-motion）；不复制品牌资产；只建层不迁移组件。
- **施工记录**：仓内已有 2026-07-25 草案 `docs/design/LA_DESIGN_TOKENS_DRAFT.md`；Kimi 派 explore subagent（agent-50 恢复）核实草案与仓内现状全符并完成落点侦察，定 10 项决策；Kimi 派 coder subagent（agent-56）施工；Kimi 复核（验收独立重跑、token 增量与影响面审阅）、触点登记与双账本并提交。规格书 `THREE_APPS_PIXEL_SPEC.md` 为私人研究资料不入仓，token 值全部 LA 原创带来源标注。
- **关键语义**：
  - globals.css `@layer base` 尾部追加增量块（既有 2455 行零重排）：status success/warning/info 各三件套（本体+soft 浅底+foreground，HSL 三通道，:root/.dark 双套）、--foreground-faint、--scrim、--border-strong/--border-light（color-mix(in oklab) 从 foreground 派生 12%/5%）、--duration-instant/fast/normal/slow+--ease-standard/enter（仅 :root）、全局 reduced-motion 一条规则（duration→0.01ms、iteration→1、scroll-behavior auto；terminal 主题 3 处局部规则保留互补）。
  - tailwind.config.js theme.extend 增量：colors 增 status 三色+scrim+faint（HSL 通道+<alpha-value> 照既有写法）；fontSize 语义阶梯 badge 10/xs 11/sm 12/base 13/lg 14/heading-sm~xl 16/18/20/24——**base 刻意 16→13px**（对齐仓内 linguist 组件事实密度，全仓 text-base 9 处/text-lg 12 处/text-sm 283 处/text-xs 420 处统一缩档，用户 2026-07-27 拍板确认）；transitionDuration/TimingFunction 指向 motion 变量；safelist/keyframes/animation 不动。
  - 10 项决策（用户拍板/授权默认）：accent 主色不动待拍板；特殊主题去留归 PB-113；proma- 前缀键不改名；字体策略沿用；base=13px；spacing 不建独立层；composer 22px 不采用；status=success/warning/info/destructive（violet 评审色迁移归 PB-104）；reduced-motion 仅跟随系统；布局锚点归 PB-102。
  - 34 处 raw palette 状态色（amber/emerald/red/violet）不迁移——PB-101~104 逐域迁移到新 status 层，本票只建层。
- **改动文件**：
  - `apps/electron/src/renderer/styles/globals.css`（新触点，追加增量块）、`apps/electron/tailwind.config.js`（新触点，extend 增量）
  - `docs/design/LA_DESIGN_TOKENS.md`（正式版新建，草案保留不动）、`tests/design-tokens.test.ts`（37 条契约断言新建）
  - Proma 触点登记（JSON +2 新条目 + MD 小节）与双账本；provenance 无新登记（零旧仓提取，值为 LA 原创）。
- **TDD 实录**：+37 例契约断言（双套齐备 19/HSL 三通道格式 13 含派生豁免/全局 reduced-motion 非主题限定 3/safelist↔THEME_STYLES 同步 1/config↔css 变量交叉 1）。
- **验证（实测，Kimi 独立重跑）**：
  - `bun test tests/design-tokens.test.ts` ✅ 37/37
  - `bun test`（根）✅ 830 pass / 2 fail（PB-093 起既有环境失败，与本票无关）
  - `bun run typecheck` ✅ 11/11；`git diff --check` ✅
  - `cd apps/electron && bun run build` ✅ vite 15.26s（产物 CSS 双套 token 各 2 处、color-mix 4 处、reduced-motion 5 处）
  - `bun run check:boundaries`（commit 后复跑）✅ 3/3（两个新触点已登记）
- **knownLimitations**：
  - text-base 缩档影响 9 处 Proma 通用界面组件（spinner 默认尺寸注释失真，PB-101 迁移时一并修正）；fontSize 语义缩档为全仓统一视觉决策（用户已确认）。
  - 全局 reduced-motion 使 animate-spin 静止于首帧（97 处，视觉静态圆弧，功能无损；spinner→静态文案降级归 PB-101~104）。
  - 特殊主题未按主题微调 status 配色（dark 特殊主题吃 .dark 值行为正确）；--accent-soft 未建（待 accent 拍板）；34 处 raw palette 未迁移（归 PB-101~104）。
  - 测试为文本级断言非 CSS AST；多窗口样式注入路径未查（PB-105 矩阵覆盖次窗口时需补查）。
- **rollback**：`git revert <PB-100 resultCommit>`

## PB-095：项目资产六类（调研衍生插票，Batch 10 前）

- **日期**：2026-07-27
- **resultCommit**：`SELF`
- **范围**：用户 2026-07-27 拍板的六类资产骨架（Style Guide 规则行+✅❌/术语+句式（句式带审批流）/TM/Context/Tech Constraints/Game DNA），依据 `docs/research/LOCALIZATION_ASSET_TAXONOMY.md`；存储+每会话系统上下文注入+工具按需查询+管理 UI。TM 已有零改动。
- **施工记录**：explore subagent（agent-50 resume）侦察定落点与注入缝；Kimi 拍板（schema v6 单迁移全包、句式独立表、Context 只做存储+目录注入+按需读、注入预算数值、Context 检索归后续）；coder subagent（agent-59）施工；Kimi 独立验收并复核出图片显示链漏判（coder 称无先例，实际 `local-file-protocol.ts` proma-file:// token 门控正是先例），打回补课后复验全绿。
- **关键语义**：
  - schema v6 单迁移（照 v4 多语句先例）：style_guide_rules（group_key/rule_text/source_example/good/bad_example/screenshot_ref 预留）/sentence_patterns（draft_target+suggested_target 对照、status confirmed/pending/rejected 审批流）/context_docs（doc|image、blob_relpath+text_extract）/tech_constraints（length|rich_text|tag_note、scope 可空=全局、value_json）/voice_profiles（speaker/register/person/tone_markers/taboos JSON）五表 + term_entries ALTER 三列（module/category/image_ref 可空零回填）。
  - 注入矩阵（project-assets-prompt.ts，electron-free）：全量进上下文=Style Guide/Tech Constraints/Voice Profiles/Context 目录；工具按需=术语+句式/TM/Context 全文。预算硬顶+截断 note：100条/8k、50角色/6k、4k、40条/2k（Kimi 拍板值）。普通会话/missing 空串、archived 仍注入（发送闸门在 PB-034）、读取失败 fail closed。
  - 新工具 cat_search_sentence_patterns（query/textType/status+分页）与 cat_read_context_doc（字符分页，image 只回元数据）；cat_search_terms 响应扩三标注列。
  - 图片显示链：image 条目 previewUrl 经既有 registerPromaFilePath 下发（TTL 1h/500 条/realpath 围栏）；resolveContextDocBlobPath 双重 realpath 围栏在项目 blobs 目录内，越界/缺字节/内存库一律降级省略不抛错；仅 query 通道下发。
  - UI 四面板：StyleGuidePanel（分组+✅❌对照列）/VoiceProfilePanel（speaker 行编辑，编辑→更新/取消，修了无 id 创建路径幂等返回旧行的真 bug）/ContextDocsPanel（导入/note/图片内联显示）/SentencePatternsPanel（ReferenceManager 第三 tab，状态 chips+CSV 导入）。
- **验证（实测，Kimi 独立重跑）**：typecheck 11/11；根 bun test 845 pass/2 fail（既有环境失败零新增）；test:linguist 94/94；build:main 成功；git diff --check 干净；check:boundaries（commit 后复跑）。
- **knownLimitations**：
  - screenshot_ref 列已预留，IPC v1 不开放写入与显示；图片不入系统上下文（只进目录清单）。
  - Context 检索与 DOCX/PDF 抽取归后续票（纯文本/md 直存 ≤200k 字符）；tech_constraints 的 QA 消费归 PB-097；techConstraints 查询忽略 query 子串过滤。
  - 注入预算数值无既有依据可援引（Kimi 拍板）；renderer query 返回 items 有 `as LinguistXxxInfo[]` 强转（union 所致）。
- **rollback**：`git revert <PB-095 resultCommit>`

## PB-096：QA 契约对齐 + Xbench 类检查覆盖（调研衍生插票）

- **日期**：2026-07-27
- **resultCommit**：`SELF`
- **范围**：用户 2026-07-27 拍板「全盘采纳《通用缺陷等级》，硬性 QA 规则同时覆盖传统 Xbench 类检查」：severity 三值→L0-L4 五档、新增 disposition 四值与 issueType 29 枚举、术语 QA 接线修复、glossaryPolicy 三策略、批次 1 确定性检查迁移。
- **施工记录**：explore subagent（agent-57）侦察（旧仓 25 项 xbench-like 清单、接线缺口、迁移面）；Kimi 抽查核实关键声明（29 枚举逐行计数、runProjectQa 无参缺口、conflict 标志）；coder subagent（agent-64）施工；Kimi 独立验收（全套件重跑、id 派生不变抽查、v7 SQL 顺序审查）。
- **关键语义**：
  - 契约单一事实来源 `issue-type.ts`：29 枚举 + QA_CODE_ISSUE_MAPPING（code→issueType/severity/disposition，如 PLACEHOLDER/TAG=L0 defect、硬术语=L1、REQUIRED_TERM prefer 档=L2 needs_review、GLOSSARY_CONFLICT=L2 query、未知码兜底 other/L2/defect）。finding id 派生公式不变（segmentId+code+message），新字段不进 id，resolved/waived 历史不断链。
  - schema v7：qa_findings ADD issue_type/disposition + 按 code SQL 回填 severity 五值；迁移顺序刻意 disposition 先行（依赖旧三值判 info）；CRITIC_% 保留旧档映射（blocking→L1/warning→L2/info→L4）。
  - 术语接线修既有缺口（factory.ts:436/project-service.ts:772 无参调用）：term_entries→QaRunOptions；glossaryPolicy 项目级可选字段（qualityProfile 先例，normalize 回落 prefer 不回写）；forbidden 恒定 L1 阻断，preferred 按 strict=L1/prefer=L2 needs_review/off=L4 info 升降级；GLOSSARY_CONFLICT 独立成码恒 L2 query。
  - 批次 1 十五新码：NEWLINE/EDGE_WHITESPACE/DOUBLE_SPACE/UNPAIRED_SYMBOL/UNPAIRED_QUOTE/REPEATED_WORD/EMAIL/URL/ALPHANUMERIC/TARGET_SOURCE_INCONSISTENCY/FULLWIDTH_PUNCTUATION/RESIDUAL_CJK/GLOSSARY_CONFLICT/UPPERCASE/CAMELCASE（后两 opt-in）；既有 11 码 code/message 零改动。
  - critic 直产五档 severity+issueType（disposition=needs_review）；导出闸门改 open 的 L0+L1 计数；PB-091 mapQaSeverity 三值→五值（placeholder/tag/icu blocker 特判 L0），open/waived 不动。
- **验证（实测，Kimi 独立重跑）**：typecheck 11/11；根 bun test 862 pass/2 fail（既有环境失败零新增）；test:linguist 94/94；cat-store 112/112；cat-tools 29/29；legacy-migration 84/84；build:main 成功；diff --check 干净；check:boundaries（commit 后复跑）。
- **knownLimitations**：
  - 批次 2（tag profile 依赖项）待 PB-097；批次 3 拼写/checklist 不做（不引 nspell 新依赖）。
  - replaceForProject 重跑清 open CRITIC_ 行保留现状（既有已知坑+注释）；长度比检查保持默认开（防回归有意偏离简报）；迁移层旧蛇形码 issueType 落 other 兜底。
  - issue_type 以契约文件实际 29 条为准（用户口径 30 为记忆偏差，已对齐）。
- **rollback**：`git revert <PB-096 resultCommit>`

## PB-097：Tag profile 正则自识别引擎（调研衍生插票）

- **日期**：2026-07-27
- **resultCommit**：`SELF`
- **范围**：用户拍板「旧 LA tag 尝试不一定正确，按你的思路来」：内置族注册表+项目 tagProfile 手工登记、匹配→span 签名、round-trip 多重集守恒机器硬判、成对配平栈校验、QA 契约对接。编辑器锁定归后续批次。
- **施工记录**：explore subagent（agent-58）侦察（旧仓八缺陷清单+四层设计）；Kimi 抽查（无既有测试锁定调序=违规）；coder subagent（agent-65）施工；Kimi 独立验收（全套件重跑+调序/Grm/嵌套测试抽查）。
- **关键语义**：
  - 内置六族（全线性正则）：xml 成对（属性全量进签名）/bbcode 全族/brace-num/brace-named/printf 全族（%1$s/%.2f/%03d/%%）/escape；项目族优先级压内置族、编译 memoize、签名 `kind:familyId:骨架|排序属性多重集`（空值属性计入）。
  - tagProfile 挂 project.json 可选字段（normalizeTagProfile 绝不抛错不回写，同 qualityProfile/glossaryPolicy 先例）；targetLocales 激活条件（全串或 base 命中忽略大小写）。
  - 守恒算法：多重集比较不比顺序（用户拍板允许调序）；成对 tag 栈算法验配平+交叉嵌套 invalid；extra=missing 同罪；ICU 内 {N} 由 brace-num 族单独验（不被 withoutSpans 抹掉）。
  - 三新 violation code 按 PB-096 契约落 L0 defect（placeholders_variables/format_tags）；XML 守恒复用既有 TAG_SIGNATURE_MISMATCH；占位符族与既有宽松签名去重。
  - 旧仓八缺陷逐条修复对应见交接报告；校验链四处接线缺省=仅内置族，PB-052 既有测试零破坏。
- **验证（实测，Kimi 独立重跑）**：typecheck 11/11；根 bun test 879 pass/2 fail（既有零新增）；cat-core 102/102；cat-store 113/113；cat-tools 30/30；test:linguist 95/95；build:main 成功；diff --check 干净；check:boundaries（commit 后复跑）。
- **knownLimitations**：
  - ReDoS lint 保守（量词嵌套组 pattern 被拒，签名层兜底）；printf 散文误命中与旧仓同级；源不配平时跳过目标配对校验（有意设计）。
  - shared DTO 未加 tagProfile（直读 cat-core 类型）；编辑器 span 锁/LLM discovery/editSegment 拦截/tech_constraints QA 消费归后续。
- **rollback**：`git revert <PB-097 resultCommit>`

## PB-101：Thread 与 Composer 视觉精修（计划 §23）

- **日期**：2026-07-27
- **resultCommit**：`SELF`
- **范围**：计划 §23 PB-101 全项：user bubble / assistant document flow / Thinking live+collapsed / Tool group / Worked divider / Queue/Steer / model changed / recovery / max width / long thread virtualization。在 Proma 现有组件上优化，不重写数据层。
- **施工记录**：explore subagent（agent-66）侦察（组件清单/34 处口径对账/OpenWorker 吸收点/测试缝）；Kimi 拍板（Thinking 保留默认展开只补双态、虚拟化改 content-visibility 原生方案、Queue 只做视觉、raw palette 按域迁移）；coder subagent（agent-67）施工；Kimi 独立验收（全套件重跑+content-visibility/divider diff 审查）。
- **关键语义**：
  - Thinking 双态：live "Thinking…"静态圆点/完成 "Thought process"；虚线边框/max-h 5.6em/默认展开偏好全保留（OpenWorker 默认折叠不采用）。
  - Worked divider「Worked for Xs · N steps」与 Model changed divider「模型已切换：A → B」均纯派生（turn-divider-utils.ts 14 测试），不碰数据层。
  - 长线程：content-visibility:auto+contain-intrinsic-size 原生窗口化（isStreaming 不启用；StickToBottom/minimap 兼容性注释块；1000-turn 基线归 PB-105）。
  - raw palette 本域 22 站点迁移（retry 横幅 16 行/AgentView 提示条/Placeholder 徽章/tool-result 三文件）；豁免 3 条契约登记（diff 增删色/shell $ 绿）。
  - 契约测试 tests/no-raw-palette.test.ts（7 文件断言+豁免失效会红）。
- **验证（实测，Kimi 独立重跑）**：typecheck 11/11；根 bun test 901 pass/2 fail（既有零新增）；test:linguist 95/95；no-raw-palette 8/8；build:main 成功；diff --check 干净；check:boundaries（commit 后复跑）。
- **knownLimitations**：user bubble 共享组件 Chat 同生效；Thinking live 启发式判定；spinner 注释失真实际 4 行（简报口径 9 处混淆）；task-list/get 蓝绿同站点补全；bash stderr dark 对比度取舍；ProcessBlockGroup 无实际可改项；max-width/PermissionDeniedNotice/ContextUsageBadge/violet 归后续票。
- **rollback**：`git revert <PB-101 resultCommit>`

## PB-102 — Shell 与 Right Rail 精修（计划 §23）

- 日期：2026-07-26
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：Skills 一级入口降 footer；Right Rail 上下文编排（right-rail-policy 纯函数，projects/CAT 视图让位 CatContextRail）；Agent Rail「交付物」区（linguist.exports.list 只读通道 + DeliverablesSection，点击回走 PB-073 native Save）；6 个布局锚点 token（globals.css/tailwind 增量）；settings 14 + agent-skills 5 + chat 2 + diff 2 + session-preview 1 共 26 文件 raw palette 迁语义 token（6 条装饰豁免登记 no-raw-palette 契约）。
- 施工记录：explore 侦察 → coder 施工（40 文件：3 新 37 改）→ 我独立验收 + 审关键 diff（right-rail-policy/DeliverablesSection/listExportFiles/AppShell/no-raw-palette/LeftSidebar）→ 触点登记 67→93 → 双账本。
- 关键语义：§7.4 信任边界——renderer 只提交 projectId，主进程读 exports/ 目录返回 basename/大小/mtime + staging 文件名解析的 assetId，绝无路径；两套 Rail 不合并只编排；无绑定项目交付物整区不渲染。
- 验证：typecheck 11/11；根 bun test 934 pass / 2 fail（与 PB-003 起既有基线完全相同）；test:linguist 97/97（+2）；no-raw-palette 34/34（+26）；build:main/preload/renderer 全过；git diff --check 干净；right-rail-policy 6/6。
- knownLimitations：交付物仅 native Save 无「直接打开/Finder 显示」（需新通道留后续）；Skills 总数徽章随降级移除（更新点保留）；toolbar 高度/64rem 锚点本域无确定性命中未强行应用；projects/CAT 视图 Agent Rail 不再显示（票面要求的行为变化）；既有 blue-/orange- 不在五色契约内保留。
- rollback：git revert 本票 commit。

## PB-103 — Approval / Plan / Compaction 精修（计划 §23）

- 日期：2026-07-26
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：三交互横幅 inline 化（AgentMessages inlineBanner 插槽，复用 StickToBottom 滚动）；PermissionBanner 作用域摘要（permission-scope 纯函数）+ dangerLevel 文字徽章 + decisionReason 行；ExitPlanModeBanner 计划正文条件展示（toolInput.plan 非空才渲染，可折叠）；压缩 failed 态「重试压缩」接既有 handleCompact；审批族 raw palette 迁 token（PermissionBanner/ContextUsageBadge/SDKMessageRenderer/TaskProgressOverlay/TaskProgressCard + mention-suggestions 2 条装饰豁免）。
- 施工记录：explore 侦察（含 shared 契约预查：toolInput.plan 已在请求对象上，纯渲染条件）→ coder 施工（12 文件：2 新 10 改）→ 我独立验收 + 审关键 diff（permission-scope/AgentView 挂载/AgentMessages 插槽/ExitPlanModeBanner 计划区/no-raw-palette）→ 触点登记 93→100 → 双账本。
- 关键语义：composer 显隐（hasBannerOverlay/hasBlockingRequests）逐字未改，inline 仅改挂载位置；Plan 展示判定 `typeof toolInput.plan === 'string' && 非空`，无计划数据整区不出现；Model changed divider 与 error recovery 票面项由 PB-101/既有 _errorActions 体系覆盖，零重复建设。
- 验证：typecheck 11/11；根 bun test 957 pass / 2 fail（既有基线）；test:linguist 97/97；no-raw-palette 40/40（+6）；build:main/preload/renderer 全过；git diff --check 干净。
- knownLimitations：composer 显隐语义未改；PermissionDeniedNotice 只读；decisionReason/sdkDescription 相同不去重；inlineBanner 仅首次出现滚动；mention-suggestions violet 装饰图标一并豁免（小扩大）。
- rollback：git revert 本票 commit。

## PB-104 — CAT 视觉精修（计划 §23）

- 日期：2026-07-26
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：票面九项（row density 108→88 / source-target 层级 / proposal diff 豁免保持 / QA badges warning 计数 / term chips 冲突 warning / status 彩色徽章+Lock / batch action sticky / empty-loading-error 统一 / narrow viewport rail min-h 断点限定）+ violet 评审色 token 化（--review 三件套 + 两处迁移）+ linguist 域 raw palette 收尾（8 文件迁移 + 4 条 diff 豁免登记）。
- 施工记录：explore 侦察（与 PB-103 并行，精确行号对账修正既有粗扫数字）→ 我拍板九项落实方式 → coder 施工（14 文件全修改零新增）→ 我独立验收 + 审关键 diff（review token/globals/tailwind/CatWorkspace/grep 复核）→ 触点登记 100→101 → 双账本。
- 关键语义：review 语义色进 token 层（violet-500 色相族，light 258 60% 44% / dark 258 75% 70%）；diff 增删红绿保持视觉登记豁免（与 PB-101 ContentBlock 同语义先例）；票面九项全部落白名单 linguist 域，零数据层改动。
- 验证：typecheck 11/11；根 bun test 965 pass / 2 fail（既有基线）；test:linguist 97/97；no-raw-palette 48/48（+8）；build:main/preload/renderer 全过；git diff --check 干净；grep 复核仅剩 4 条豁免行；review token 进构建产物。
- knownLimitations：<1100px 无溢出为人工推理（真机截图归 PB-105）；ContextRail/QA 面板 error 无重试（无回调不建数据流）；编辑态超高既有行为；批量条 sticky 相对页面滚动；diff 红绿保持 raw（豁免）。
- rollback：git revert 本票 commit。

## PB-110 — CAT 安全审查（计划 §24）

- 日期：2026-07-26
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：八项安全证明（跨 Project 隔离/无任意 path/locked 拒写/stale revision 拒覆盖/export 不覆盖源/logs 无正文/archived·missing fail closed/malformed 无部分写入）。1~5、7 项经权威侦察确认既有强制点+测试已证明；本票补齐：工具级归档写拒绝测试、proposal-ipc 七通道归档腿、主进程 console SENTINEL 无正文钉住、三处 error.message 透传改 name/code 纪律、importAsset 两步次序对齐 blob 先行。
- 施工记录：explore 侦察（26KB 逐项证据报告，与 PB-105 并行）→ 我拍板五项缺口 → coder 施工（11 文件，与 PB-105 文件面不相交）→ 我独立验收 + 审关键 diff（importAsset 调换/warn 纪律）→ 0 触点 → 双账本。
- 关键语义：importAsset 崩溃窗口从「asset 行在、source blob 缺」（导出硬失败态）变为「孤儿 blob」（重导入幂等覆盖、危害低）；日志纪律对齐 ipc-envelope（未类型化错误只记 name/code，绝不透传 message）。
- 验证：typecheck 11/11；test:linguist 97→103/103；cat-store 114/114（+1）；cat-tools 30/30+10/10；cat-core 102/102；根 bun test 965/2 基线一致；git diff --check 干净。
- knownLimitations：archive 在途事务竞态（窄窗口无抓手）；exports//source/ symlink 面（本机威胁模型外）；原生 Save 自选目的地覆盖原文件（对话框语义）；Save 取消留 staging artifact（设计如此）。
- rollback：git revert 本票 commit。

## PB-111 — Backup / Restore（计划 §24）

- 日期：2026-07-26
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：票面七项全链路——全量目录备份（cat.db VACUUM INTO + project.json + source/ + blobs/ + manifest.json 全文件 sha256）、verifyBackup（逐文件校验+quick_check+只读打开 fail closed）、restore preview（摘要对比+schema+willMigrate）、整体替换 restore（pre-restore 快照+aside-staging 三段替换+失败自动回滚）、旧格式显式不兼容（STORE_BACKUP_LEGACY 仅预览降级）、UI（ProjectBackupsSection 备份区+恢复预览对话框）。
- 施工记录：explore 侦察（既有 backup.ts/句柄缓存/schema 机制/攻击面）→ 我拍板产物格式与 restore 语义 → coder 施工（17 文件，与 PB-105 并行文件面不相交）→ 我独立验收 + 审关键 diff（restore.ts 原子性/shared 契约/readBackupName 白名单）→ 触点 101（+0 新，3 追加）→ 双账本。
- 关键语义：verify 不过不动盘；任何 restore 失败从 pre-restore 快照回滚，快照始终保留；归档项目可备份可预览不可恢复；§7.4 坚守（renderer 只提交 projectId+backupName 白名单形状）。
- 验证：typecheck 11/11；根 967/2 基线；test:linguist 110/110（+7）；cat-store 125/125（+11）；no-raw-palette 49/49；build 三端全过；diff --check 干净。
- knownLimitations：quick_check 页级损坏无法真实模拟（垃圾字节用例覆盖）；restore 后项目名标题栏需重开；pre-restore 快照不可经 API 恢复；恢复中途 IO 错误非类型化码（回滚仍执行）；旧格式仅预览。
- rollback：git revert 本票 commit。

## PB-105 — 视觉、无障碍和性能矩阵（计划 §23，自动化部分）

- 日期：2026-07-27
- resultCommit：407cabd4
- 范围：39 项自动化矩阵探针（尺寸×主题 18 格、zoom200、reduced-motion、10k 网格、1000-turn 三格、axe 三视图）+ axe-core@4.12.1 + AppShell 窄视口防破版真实修复；证据 21 截图+2 JSON 入仓 docs/roadmap/g10-evidence/。
- 施工记录：explore 侦察（探针基础设施/播种/矩阵驱动方式/axe 可行性）→ coder 施工+5 轮打包实测 → 我独立验收（抽看 2 张截图确认真实渲染、复核 matrix-results.json 逐格、审 AppShell diff、版本同步 0.15.40）→ 触点 101（3 追加）→ 提交。
- 关键语义：G10 硬标准「不允许源码字符串截图」满足——playwright 驱动打包 .app 真实渲染；布局断言以 in-page 几何为准（zoom200 的 page.screenshot 是 CDP artifact，native capturePage 对照闭环）。
- 验证：矩阵 35 PASS / 1 FAIL（perf-1000turn-open 10.5s 带证据）/ 3 axe WARN；typecheck 11/11；根 967/2；test:linguist 110/110；no-raw-palette 49/49；boundaries 3/3。
- knownLimitations：1000-turn 首挂载 10.5s（React/markdown 成本，另立票）；axe 存量违反仅记录（建议专项票）；手工项（VoiceOver/keyboard/IME/drag-resize/DMG 真机）未执行。
- rollback：git revert 407cabd4。

## G10 — Batch 10 门禁：UI、性能、无障碍产品化

- 日期：2026-07-27
- 状态：**GATE PASSED**
- 报告：docs/roadmap/G10_REPORT.md；证据：docs/roadmap/g10-evidence/
- 硬标准「不允许以源码字符串截图替代真实渲染」：PASS（21 张真实渲染截图 + in-page 几何断言）。
- 票级：PB-100~105 全部 integration_verified。
- 记账：perf-1000turn-open FAIL 与 axe WARN 带证据入 G10_REPORT §7；手工项未执行如实记录。
- tag：pb-g10-productization（annotated）。

## PB-112 — Proma Upstream Sync Rehearsal（计划 §24）

- 日期：2026-07-27
- resultCommit：SELF（本票 commit 后回填见 git log）
- 范围：同步策略文档化（docs/architecture/UPSTREAM_SYNC.md：里程碑节奏、sync 分支纪律、只解登记触点冲突、G7 smoke 验证门）+ 首次演练执行。
- 施工记录：我亲自执行（git 操作不委托）：fetch upstream → 实测 upstream/main = 基线 702a8221（零前进，领先 0/91）→ sync/rehearsal-2026-07-27 分支 merge → Already up to date → 删分支 → 文档+账本。
- 关键语义：零增量干跑证明链路可用；触点登记簿未经实战检验（无冲突可解）；「冲突太多优先调 LA 边界不放弃同步」写入策略本体。
- 验证：ls-remote 实测；merge-base=基线；演练前后工作树零变化；check:boundaries 3/3。
- knownLimitations：登记簿未经真实冲突检验；upstream ErlichLiu/* 特性分支活跃但策略只跟 main。
- rollback：git revert（纯文档票）。

## PB-113：隐藏评估与图标/教程去品牌化（2026-07-27）

- 范围：①AppearanceSettings 13 个 Proma logo 图标变体并入 PROMA_PROMO_VISIBLE 门控（flag off 选择器仅剩 default/LA；png 不删；主进程 resolveAppIconPath 同名常量兜底，历史存储值解析回 icon.png 不改写存储；renderer 高亮兜底）；②教程品牌修正（Tab label「使用教程」、TUTORIAL_TAB_TITLE、附件文件名、教程 H1）。六项隐藏评估（Claude Runtime/remote bots/Automation/coding-only tools/特殊主题/settings 分区）结论全部维持隐藏不删，记档 FEATURE_FLAGS.md。
- 施工记录：coder subagent 施工（6 代码文件）；我独立验收 + 审 diff + 触点登记（4 新 + 2 追加，101→105）+ FEATURE_FLAGS.md 评估记档 + 版本 0.15.41。
- 验证：typecheck 11/11；根 bun test 967/2（基线一致）；test:linguist 110/110；no-raw-palette 49/49；build:renderer ✓。
- knownLimitations：tutorial.md 正文约 40 处品牌词另票；欢迎对话文案待拍板；主/渲双常量手工同步。
- rollback：git revert 本票 commit。

## PB-114：签名、公证和更新（2026-07-27）

- 范围：票面 11 项逐项裁定（PB114_RELEASE_READINESS.md）。实际改动：electron-builder.yml publish ErlichLiu/Proma → wangyu-sg/linguist-agent-public（update channel 解冻指 LA 公开仓）；win fileAssociations 显示名补改 LA；版本 0.15.42。
- 施工记录：我亲自执行（小改动+实测票）：侦察（explore subagent）→ 两处 yml 修改 → smoke:pack 全链路 → DMG 实测 → codesign/asar/Info.plist 验证 → 登记（+3 多票共改，105 不变）。
- 验证：smoke:pack ✓（runtime-deps 137）；产物 bundle id/0.15.42/asar+unpacked ✓；DMG 256MB+blockmap ✓；codesign adhoc（无凭据正确行为）。
- knownLimitations：Developer ID/公证 blocked（无凭据）；update channel 实通 blocked（公开仓未建，PB-116 后解）；app 级回滚不建设（allowDowngrade=false 刻意，fail-closed 防降级损坏）；release-notes 缺 34 篇另票。
- rollback：git revert 本票 commit。

## PB-115：公开发行治理（2026-07-27）

- 范围：票面 12 项全落地——AGPL LICENSE 原样已合规；NOTICE +Modifications/Source 两节；ATTRIBUTION +Modifications to Proma；SECURITY.md（Security Advisories 主渠道，7d/30d 目标）；CONTRIBUTING.md（DCO）；THIRD_PARTY_NOTICES.md（claude-agent-sdk 专有、4 Anthropic skills、Apache/MIT/OFL 各段、双许可选择记录）；SBOM.md + sbom-full.json（415 包实测）；license:scan 脚本+CI job；About 页 Source Code/Third-Party Notices 行；Proma 链接统一 proma-ai/Proma。
- 施工记录：explore 侦察 → 我拍板 5 项裁决 → coder 施工 → 我独立复跑 license:scan + 审全部 diff + 回退 user-agent.ts 三文件（UA 白名单）→ 登记（+5 既有追加，105 不变）→ 版本 0.15.43。
- 验证：license:scan 门禁通过（415 包，黑名单零命中）；typecheck 11/11；根 967/2；linguist 120/120；palette 49/49；build ✓；check:boundaries 3/3；复制核查零命中。
- knownLimitations：Anthropic 专有组件再分发依据待产品负责人最终确认；x64/win 平台包 SBOM 待查；更新回退 URL 仍指上游 releases（产品裁决）；上游原文链接有意保留；UA URL 保持旧值（白名单）；逐文件许可头另票。
- rollback：git revert 本票 commit。

## PB-089：CAT 资产源文件预览（2026-07-27，计划外增补票）

- 范围：linguist.project.previewAssetSource 通道（ast- id 校验、realpath 双重围栏、text/html/url 三态分派、200k 截断护栏）+ ProjectAssetsSection 预览按钮（归档不禁用）+ LinguistAssetPreview 对话框（DOMPurify 消毒）+ 10 例 nodetest。
- 施工记录：explore 侦察（选项 A 设计定型）→ 我拍板范围（pdf/tmx 不做、归档允许）→ coder 施工 → 我审 diff 补 DOMPurify → 联合验收 → 登记（+5 既有追加，105 不变）→ 版本 0.15.44。
- 验证：test:linguist 120/120；typecheck 11/11；根 967/2；palette 49/49；build ✓。
- knownLimitations：pdf/tmx 无内联预览（tmx 走 url 降级）；docx 无提取纯文本；50MB+ → INTERNAL；PB-089 编号为账本约定（计划无此号）。
- rollback：git revert 本票 commit。

## PB-116：公开镜像清洗（2026-07-27）

- 范围：候选分支 audit/proma-based-candidate-v1 推送至 wangyu-sg/linguist-agent-public（head 185eb161）；公共 main 未触碰。策略 = 基线 702a8221 原样历史 + LA squash 单 commit；清洗 = 删 5 张上游真实截图 + scrub 三组用户绝对路径；proma-logos 保留（上游自有+构建依赖，理由记档）。
- 施工记录：我亲自执行（git 重操作不委托）：预检复核 → ls-tree 核实命中项皆上游已公开 → worktree 建候选分支 → checkout main 树 → 清洗 → squash commit → 13 项自动检查 → 推送 → gh api 双向核验（分支 head/main 未动）→ 清理 worktree。
- 验证：13 项检查全过；scrub 零残留；推送与 main 未动均 gh api 实测。
- knownLimitations：README 死链待最终审计裁决；候选树未构建验证；合并公开 main 待 G11+用户批准。
- rollback：远端删分支 + 本地 git branch -D。

## PB-117：最终审计包（2026-07-27）

- 范围：docs/release/ 四报告（FINAL_PRODUCT_REPORT/FINAL_TEST_REPORT/KNOWN_LIMITATIONS/PUBLIC_MIRROR_MANIFEST），审计者速查块十项齐全；版本 0.15.45。
- 施工记录：我亲自归并（85 条账本实测数据，无 subagent 代笔最终审计）；数据全部可溯源到各票 verification。
- 验证：四报告数据与账本交叉核对；commit range 702a8221..HEAD=98。
- knownLimitations：静态快照，后续票落地后需修订。
- rollback：git revert 本票 commit。

## G11：Batch 11 门禁（2026-07-27）— gate_blocked

- 判据：无 P0/P1 ✅、G7 ✅、G10 ✅、signed/notarized 明确 blocked ✅、公开候选清洗 ✅（13 项全过+推送核验）；**G9 ❌（真实数据复跑未执行）**；合并公开 main 待用户最终审计。
- 判定：gate_blocked（唯一硬阻塞 G9；解除路径 G11_REPORT 在案）。annotated tag：pb-g11-release-audit。
- knownLimitations：G8 blocked（PB-085 盲评）属同一总账非票面判据；不伪造通过。

## PB-085：人工盲评（追记，2026-07-27）— blocked

- 状态：备料完成（c5900116 协议+双批+评分表+指标规格；72cce3f8 记录用户排期决策），执行 blocked。阻塞：真实 API Key + 用户人工评分。用户拍板：全部工单交付、app 流畅后执行。
- 影响：G8 硬判据悬置，G8 保持 gate_blocked；不伪造通过。
- 说明：此条目为账本追记（备料两 commit 早已入库），补齐计划票面覆盖（67/67）。

## G0：Batch 0 门禁（追记，2026-07-27）— gate_passed

- 说明：G0_BASELINE_REPORT.md 与 annotated tag pb-g0-proma-baseline 自 Batch 0 起在案；本条为补齐「G0–G11 逐票记录」的账本追记。基线 702a8221 冻结 + G0 冒烟 18/18。

## PB-090-followup：scanner 真零触碰修复（2026-07-27）

- 起因：G9 真实数据复跑（用户授权只读）实测抓出——readOnly 打开 WAL 库回写 -shm（SQLite 文档行为，非用户数据），违反「源树逐字节不动」硬承诺。
- 修复：sqlite-probe 打开前把 db/wal/shm 三件套拷入 mkdtemp 暂存目录，开暂存副本，close 清理；无法暂存则不开库（降级 read-cache）。
- 验证：84/84；typecheck 11/11；根 967/2；全新副本全协议复跑副本+原始双 1905 文件逐字节相等。
- knownLimitations：tmpdir 清理 best-effort。
- rollback：git revert。

## G9 升级 gate_passed + G11 连带升级（2026-07-27）

- 用户授权旧数据只读复跑（不出本机、不进公开镜像）。按 G9_REPORT §6 写死协议对真实副本（197MB/1905 文件）执行：scan exit 0 → 15/15 import（14 imported/1 partial 去重，0 error/0 quarantined）→ readOnly verify 全绿 + 幂等 exit=4 → 抽查 3 项目一致 → 首轮字节比对抓出 -shm 回写（PB-090-followup 修复 54af6dc0）→ 全新副本复跑副本+原始双 1905 逐字节相等。
- G9 升级 gate_passed（G9_REPORT §9）；G11 判据 3 转 PASS → G11 升级 gate_passed（合并公开 main 待用户最终审计，属流程要求非门禁失败）。
- 剩余 blocked：G8（PB-085 盲评，等 API Key + 用户评分）、签名/公证（凭据）。
