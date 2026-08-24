# Linguist 模式 UX 审计（真实运行证据）

> 生成：2026-08-24，Kimi 实施轮。
> 性质：实施依据文档，不是最终成果。发现的问题直接修，修复后按「可验证结果」复测。

## 审计方法

- 环境：dev 模式 Electron（未签名二进制）+ fake model server + `mkdtemp` 临时 HOME 与 `--user-data-dir`，全程不触碰真实 `~/.linguist-agent-dev`。
- 预置：`settings.json` 跳过 Onboarding、`channels.json` 明文 fake key（`LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS=1`，避免 macOS Keychain 授权弹窗阻塞自动化）。
- 驱动脚本（可重复执行，已提交）：`apps/electron/scripts/smoke/ux-audit/run-ux-audit.ts`，运行方式 `node scripts/smoke/ux-audit/run-ux-audit.ts`（需先 `bun run dev:vite` 并完成 main/preload 构建）。
- 数据：经 `linguist-cat-store` CLI 导入 `mini_game_ui.xliff`（7 段）与 `locked_segments.xliff`（16 段）两个批次，并直写一条项目级 QA Finding（EMPTY_TARGET, L1）。
- 证据：`apps/electron/out/ux-audit/2026-08-24T16-49-03/`（gitignored，勿提交）。34 步截图 + axe-core 违规 + 焦点探针 + 布局探针，全部步骤通过、零 console 错误。
- 视口说明：dev 模式主进程默认 dock DevTools（`main/index.ts` 的 isDev 分支），实测独占约 555px 视口宽——早期轮次的「885px 常态」实为 DevTools 挤压，并非窗口管理约束。现脚本启动后即探测并关闭 DevTools，视口与 `setSize` 一致（默认 1440；S11b/S17 主动收窄验证浮层与窄窗口，S18 验证两档 200% zoom）。

## 正向证据（已可用，不要回退）

- 键盘行导航：↑↓ 切换片段可用，行 `aria-label` 完整（含序号、segmentId、源文/译文、状态、开放 QA）。
- IME：组合期间按 Enter 不会误触「确认翻译」弹窗，组合文本正常进入 textarea。
- `Cmd/Ctrl+S` 保存译文有 toast 反馈；未保存状态有「未保存」标记。
- Agent Rail 端到端可用：创建会话 → rail 打开 → 发送消息 → fake model 流式回复渲染。
- 角色会话（双语审校 / 目标语校对）可从侧栏创建并落入会话列表。
- 深色主题整链一致（侧栏 / 网格 / dock / 状态栏 / 交付面板），无破版。
- 批次导航（列表 + 搜索）与批次下拉切换可用。

## 修复状态总览（2026-08-24 复测）

复测证据：`out/ux-audit/2026-08-24T16-49-03/`（34 步，零 console 错误，全程无人值守——无 Onboarding 停留、无 Keychain 弹窗、DevTools 已关闭视口真实）。

已修复并复测通过：

- U-01 ✓：dock 浮层高度写入 `--bottom-dock-overlay-height`，编辑行展开后 `scrollIntoView` + `scroll-padding-bottom` 让位，「保存 / 取消 / 确认翻译并前进」完整可见。窄视口（885px，dock 浮层 regime）复测证据见 `out/ux-audit/2026-08-24T16-41-02/08-target-editing.png`；真实 1440 下 dock 为内联不遮挡（`16-49-03/08-target-editing.png`）。
- U-02 ✓（18-dock-QA、22-qa-finding-jump）：QA 面板默认项目级列表，「仅显示当前片段」降级为显式筛选；每条 finding 有「跳到片段」，点击后焦点落到对应网格行（探针记录目标行 aria-label 含该 finding 的 segmentId）。
- U-03 ✓（15-agent-rail-overlay-escape，真实 1100px 窄视口）：scrim 可见、点击关闭、ESC 关闭三探针全 true；含 rail 内「收起项目 Agent」按钮在内的任何关闭路径，焦点都回到头部 Agent 开关。
- U-04 ✓（31-zoom-200、32-zoom-200-narrow）：200% zoom 下等效 720px 时主区 387px 直接达标；等效 512px 时左栏强制折叠为图标栏，主区 419px。两档均 ≥320 且无页面级横向滚动。
- U-06 ✓（06-workbench-light）：状态栏只剩当前阶段计数 + 字符数 + 当前片段 + 快捷键提示（≤2 行），零值阶段不再铺开；批次名与整体进度收敛到头部。
- U-07 ✓（06-workbench-light）：无运行记录时「本次运行」折叠为一行提示，不再占黄金位置。
- U-09 ✓（06-workbench-light）：头部「本批次 · 已确认 0 / 7」，批次面板「项目状态（全项目）：已确认 0 / 23」，两处口径带明确前缀。
- U-11 ✓（05-project-created）：创建成功后焦点落到侧栏新项目的分组按钮（aria-label「折叠项目 UX 审计游戏 UI」——即该项目的侧栏入口），取消/Esc 回到「新建项目」触发按钮。
- U-12 ✓（08-target-editing）：textarea 按内容自适应（min 4 行、max 视口 40%，IME 组合期间跳过），长译文编辑无需内部滚动。
- U-13 ✓：STATUS 徽标 `title` 给出「阶段 · 口径 + 颜色含义」两行说明（单测覆盖同色不同义场景）。

审计侧收敛（非产品缺陷）：

- U-05：教程浮层 dismiss 本就走 `settings.json` 持久化（`tutorialBannerDismissed`），真实用户只弹一次；「每次启动弹出」是审计环境全新临时 HOME 的必然产物，已在审计预置中收敛。剩余差距仅是缺一个字面「不再显示」选项，位于 `components/tutorial/TutorialBanner.tsx`（Proma 核心路径），按分工留待 Codex 侧后续工单。

未修（留待后续）：

- U-08：三处批次入口语义不同（导航=浏览、工具栏下拉=快捷切换、头部=只读展示），合并涉及信息架构决策，本轮只统一了文案口径（U-09），入口合并留待专项。
- U-10：原生 inline tag 的 chip 化渲染涉及网格渲染层改造，本轮未动。
- U-14 / U-15 / U-16：全局 axe 项位于 Proma 核心组件与设计 token 层，按分工属 Codex 侧。最新聚合（34 步全量）：`color-contrast` serious ×34、`region` ×32、`landmark-main-is-top-level` ×25、`landmark-one-main` ×8、`aria-valid-attr-value` critical ×2、`aria-allowed-attr` critical ×1、`aria-input-field-name` serious ×1。

## 高严重度

### U-01 编辑态行操作区被语言资产面板浮层裁剪

- 位置：Workbench Segment Grid × Bottom Dock（`LinguistWorkbenchShell.tsx`：`max-lg` 断点下 dock 为绝对定位浮层）。
- 用户任务：编辑译文 → 保存 / 取消 / 确认并前进。
- 当前摩擦：窄视口（≤1024px；含早期被 dock 态 DevTools 挤压出的 885px）展开编辑行后，「⌘S 保存 / 取消 / 确认翻译并前进」按钮组一半被 dock 浮层盖住，只能盲操作或先手动关面板。证据：`08-target-editing.png`。
- 建议修法：dock 以浮层形态存在时，给主滚动区加 `scroll-padding-bottom`（等于 dock 高度），编辑行展开后 `scrollIntoView` 保证操作区完整可见；行扩展后触发虚拟列表重测量。
- 触 Proma 核心：否（`features/linguist/**`）。
- 可验证结果：885px 视口展开任意行，三个操作按钮完整可见且可点击（审计脚本步骤 08 复测）。

### U-02 QA Findings 面板默认只显示当前片段，与项目级 QA 结果互相矛盾

- 位置：Bottom Dock「QA」tab（`QaFindingsPanel.tsx`）。
- 用户任务：运行项目 QA → 逐条定位处理 finding。
- 当前摩擦：面板默认「仅显示当前片段」，当前片段无 finding 时显示「尚无符合筛选的 Findings」，而网格工具栏同时显示「下一个 QA 问题（1）」——同一屏幕两个互相矛盾的真相。面板上也没有任何「定位到片段」入口（探针 `qaJumpResult=no-candidate`，只有「运行项目 QA」按钮）。证据：`17-dock-QA.png`、`25-workbench-dark.png`。
- 建议修法：面板默认项目级列表；「仅当前片段」降级为显式筛选；每条 finding 提供定位按钮，点击后切换 `activeAssetId/activeSegmentId` 并把 grid 行滚动到可见。
- 触 Proma 核心：否。
- 可验证结果：CLI 直写一条 finding 后，打开 QA tab 即可看到该条并一键定位到对应行（审计脚本 S13 探针应记录到定位按钮）。

### U-03 窄视口 Agent Rail 浮层遮挡 dock/grid，无脱困路径

- 位置：Workbench Agent Rail（`max-xl` 断点下 `absolute right-0 z-20`，宽至 `calc(100%-3rem)`）。
- 用户任务：rail 对话后继续操作片段网格或语言资产面板。
- 当前摩擦：rail 浮层盖住 dock 左侧 Tab 与 grid 右列，无 scrim、不可 ESC、不可点击外部关闭；审计自动化两次被「intercepts pointer events」硬阻塞，真实用户同样无路可走（唯一能发现的是再点一次头部 Agent 开关）。证据：`14-agent-rail-reply.png`、`24-delivery-panel.png` + playwright 拦截日志。
- 建议修法：浮层模式下加半透明 scrim（点击关闭）、ESC 关闭、rail 头部显式关闭按钮。
- 触 Proma 核心：否。
- 可验证结果：885px 视口开 rail 后，点击 scrim 或按 ESC 可关闭；dock 全部 Tab 可点。

### U-04 200% Zoom 下主工作区被挤压至不可达

- 位置：全局 App Shell + Workbench。
- 用户任务：放大界面（低视力/演示场景）使用。
- 当前摩擦：zoomFactor=2（等效 CSS 宽 ~442px）时左侧栏不收起，主区被压到约 110px，且 `documentElement` 无横向滚动（探针 `pageHorizontalScroll=false`），网格事实上不可见不可达。证据：`30-zoom-200.png`。
- 建议修法：等效窄宽下左栏可折叠为图标栏（复用既有侧栏折叠能力）；或主区允许 `overflow-x` 兜底。
- 触 Proma 核心：是（AppShell 侧栏响应式行为，须按 `PROMA_CORE_TOUCHPOINTS.md` 登记）。
- 可验证结果：200% zoom 下主区可视宽 ≥320px 或可横向滚动到达。

## 中严重度

### U-05 教程浮层每次启动遮挡右下工作区

- 位置：「Linguist Agent 使用教程」浮层（右下 fixed）。
- 摩擦：每次全新启动都浮出，遮挡 rail 输入区、dock 与状态栏（`12/14/24/25` 多张截图均可见）；只有「立即学习 / 稍后再学」两个选择，没有「不再显示」。
- 修法：记住 dismiss 状态，仅在首次或从帮助入口主动打开时显示。
- 触核心：否。验证：关闭一次后重启不再浮出。

### U-06 状态栏三行全量零值铺开，且与头部/批次面板重复

- 位置：Workbench 状态栏（`本地化工作台状态栏`）。
- 摩擦：「已确认 0/7 · 翻译草稿 1 · 翻译 0/7·阻塞 0 · 审校 0/7·未修改 0·已修正 0·阻塞 0 · 校对 0/7·…」三行全为 0 也全部铺开；「已确认 0/7」与项目头部、「当前批次」与工具栏下拉重复。
- 修法：只渲染非零指标与当前阶段计数；重复信息收敛到一处。
- 触核心：否。验证：全新项目状态栏高度 ≤2 行。

### U-07 「本次运行」空面板长期占据主区右上黄金位置

- 位置：Workbench 主区右侧栏顶部。
- 摩擦：没有任何运行记录时仍以大块面板占位（「暂无可展示的 CAT 运行记录」），把批次内容挤到下方。
- 修法：空态折叠为一行提示或并入 dock「待查看建议」tab；有记录时才展开。
- 触核心：否。验证：无运行记录时主区首屏不再被空面板占位。

### U-08 批次选择入口三处重复

- 位置：批次导航列表 / 网格工具栏批次下拉 / 项目头部批次名。
- 摩擦：同一状态三处表达，窄视口下浪费宝贵横向空间，且选择后焦点/高亮规则不一致。
- 修法：导航列表为主；工具栏下拉仅在导航收起时渲染；头部只做只读显示。
- 触核心：否。验证：任一宽度下批次切换入口 ≤2 处。

### U-09 「已确认」计数口径混淆

- 位置：项目头部「已确认 0 / 7」（当前批次）vs 批次面板「项目状态：已确认 0 / 23」（全项目）。
- 摩擦：同名指标两个口径，用户无法判断进度。
- 修法：头部标注「本批次」，批次面板标注「全项目」。
- 触核心：否。验证：两处计数文案带明确范围前缀。

### U-10 原生 inline tag 裸露 XML 文本

- 位置：Segment Grid 源文/译文渲染。
- 摩擦：`<g id="1" ctype="bold">`、`<x id="1" equiv-text="{lives}"/>` 以原始字符串直接显示并撑高行；而 `{score}` 类占位符渲染为 chip，两套规则并存。
- 修法：统一 tag chip 化渲染（折叠为占位 chip，悬停/展开看原文），与既有占位符规则一致。
- 触核心：否。验证：含原生 tag 的 segment 行高与纯文本行一致，无 XML 字符串裸露。

### U-11 创建项目对话框关闭后焦点丢失

- 位置：新建项目对话框 → 创建完成。
- 摩擦：创建成功后焦点探针为 `none`（焦点落在 body），键盘用户迷失位置。
- 修法：创建完成后焦点落到「打开项目」按钮；取消/Esc 时焦点回到「新建项目」触发按钮。
- 触核心：否。验证：探针 `focusAfterCreate` 指向具体操作元素。

### U-12 编辑 textarea 默认高度局促

- 位置：Segment 行内编辑。
- 摩擦：多行译文只有约 3 行可视高度，长译文编辑频繁滚动。
- 修法：textarea 自适应内容高度（min 4 行、max 不超过视口 40%）。
- 触核心：否。验证：多行译文编辑时无需滚动即可看到全文（≤8 行内）。

### U-13 STATUS 列同色不同义、无图例

- 位置：Segment Grid STATUS 列。
- 摩擦：「待确认」同时以绿/紫两色出现（分别对应不同阶段语义），界面没有任何图例说明。
- 修法：徽标加 `title` 说明或状态栏给图例；或统一色板 + 阶段角标区分。
- 触核心：否。验证：任意状态颜色可在界面内查到含义。

## 全局壳问题（触 Proma 核心，须登记 touchpoint）

### U-14 axe critical：未命名按钮与非法 aria 属性值

- `button-name` ×1（全模式存在）、`aria-valid-attr-value` ×2（Agent 模式）、`aria-input-field-name` ×1（Agent composer，serious）。
- 修法：补 `aria-label` / 修正 aria 属性值；属于全局 Agent/Shell 组件，改动须走触点登记。
- 验证：axe 对应规则归零。

### U-15 axe serious：浅色主题对比度不足 ×9

- 位置：徽标 / 次要文本 / 禁用态（全模式）。
- 修法：按 token 调整对比度至 WCAG AA；属于设计 token 层，须登记。
- 验证：axe `color-contrast` 归零。

### U-16 axe moderate：landmark 与标题层级

- `landmark-main-is-top-level`（Workbench main 嵌套在 section 内）、`region`（多处未命名 region）、`heading-order`。
- 修法：main 提升为顶级 landmark、region 补 `aria-label`、标题层级连续。
- 验证：axe landmark/heading 规则归零。

## 不在本轮修复范围

- 早期轮次 `setSize` 实际生效宽度恒定少 555px 的问题已定位：dev 模式 dock 的 DevTools 挤压视口，属审计环境自身因素，已在脚本内探测并关闭，不作为产品缺陷。
- `docs/ux/` 之外的全局 Proma Chat/Agent 深度 UX 重构——本轮只做 Linguist 与收口必要的边界。
