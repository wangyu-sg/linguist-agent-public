# LA Design Tokens

- 日期：2026-07-26（PB-100 落地，正式版）
- 依据：LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md v1.0，PB-100（Batch 10）
- 前世：LA_DESIGN_TOKENS_DRAFT.md（草案，仅作历史参考保留，不再更新）
- 来源标注：每个值标注 **【规格书结论】**（三客户端逆向提炼的共性/做法）或 **【LA 自有调整】**（仓内现状沿用或新拟）
- 零品牌资产：不设品牌字族、不引入任何第三方签名色/品牌字体/Logo/商标字样/主题名称

---

## 0. 提炼原则

1. **语义分层**：颜色按 surface / text / border / accent / status 五层组织，不写"颜色值"，只写"用途"。【规格书结论：三家共识】
2. **HSL 通道存储**：变量存 `H S% L%` 三通道，消费处用 `hsl(var(--x) / <alpha>)`，获得透明度合成能力。【规格书结论：Proma；仓内已落地】
3. **派生用 color-mix**：边框、弱化文本、雾化背景等从 `--foreground` 用 `color-mix(in oklab, ...)` 派生（边框 8% / 强调边框 12% / 轻分隔 5% / 二级文本 65% / 雾化底 2.5%）。【规格书结论：Codex 插值比例表】
4. **light/dark 双套**：暗色不是反色，是独立调色；暗色阴影带 inset 顶高光制造"浮起"感。【规格书结论：Proma】
5. **零品牌资产**：accent 色相沿用仓内现状、待用户最终拍板（见 §8-①）。【LA 自有调整】

---

## 1. Colors（light / dark 双套）

### 1.1 Surface 层

| Token | Light | Dark | 来源 | PB-100 状态 |
|---|---|---|---|---|
| `--background`（侧栏锚点） | `0 0% 100%` | `0 0% 10%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--content-area`（主内容区） | `0 0% 100%` | `0 0% 7%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--card` | `0 0% 100%` | `0 0% 13%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--popover` | `0 0% 100%` | `0 0% 14%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--dialog` | `0 0% 100%` | `0 0% 16%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--input-surface` | `60 14.3% 98.6%` | `0 0% 9%` | 【LA 自有调整】沿用仓内现状 | 既有，不动 |
| `--scrim`（遮罩） | `30 6% 10%` | `0 0% 0%` | 遮罩语义【规格书结论】；HSL 三通道化【LA 自有调整】 | **PB-100 新增** |

`--scrim` 只存 HSL 三通道、不含 alpha；遮罩不透明度由消费处合成（如 `bg-scrim/50`），替代规格书中 `rgb(29 27 24 / 0.32)` / `rgb(0 0 0 / 0.5)` 的整值写法，与同文件其他变量格式一致。

**暗色亮度阶梯规律**：content-area(7%) < background(10%) < card(13%) < popover(14%) < dialog(16%)，用亮度层级表达浮起层级。【规格书结论】

### 1.2 Text 层

| Token | Light | Dark | 来源 | PB-100 状态 |
|---|---|---|---|---|
| `--foreground` | `0 0% 3.9%` | `0 0% 98%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--muted-foreground` | `0 0% 45.1%` | `0 0% 63.9%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--foreground-faint`（placeholder/三级文本） | `0 0% 62%` | `0 0% 45%` | 三级文本存在性【规格书结论：两家均有 faint/descriptionForeground 层级】；具体值【LA 自有调整】 | **PB-100 新增** |

派生规则：二级/弱化文本优先用 `color-mix(in oklab, var(--foreground) 65%, transparent)` 现算，而非新增固定变量。【规格书结论】

### 1.3 Border 层

| Token | Light | Dark | 来源 | PB-100 状态 |
|---|---|---|---|---|
| `--border` | `0 0% 89.8%` | `0 0% 22%` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--input` | = `--border` | = `--border` | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--border-strong`（派生） | `color-mix(in oklab, hsl(var(--foreground)) 12%, transparent)` | 同左（var 随主题解析） | 【规格书结论】 | **PB-100 新增** |
| `--border-light`（派生） | `color-mix(in oklab, hsl(var(--foreground)) 5%, transparent)` | 同左（var 随主题解析） | 【规格书结论】 | **PB-100 新增** |

`--border-strong` / `--border-light` 是**完整颜色值**（color-mix 派生），不是 HSL 三通道，不能用于 `hsl(var(--x) / <alpha>)` 写法；直接用 `border-color: var(--border-strong)` 消费。格式断言中这两个变量豁免三通道校验。

### 1.4 Accent 层（主色）

结构【规格书结论】；**具体色相沿用仓内现状，待用户拍板**（见 §8-①）：

| Token | 说明 | 来源 | PB-100 状态 |
|---|---|---|---|
| `--primary` / `--primary-foreground` | 主操作色及其上文字 | 【规格书结论】结构；取值沿用仓内现状（中性灰） | 既有，不动 |
| `--accent-soft`（浅底） | 选中态/高亮浅底 | 【规格书结论：两家均有 accent-soft 浅底】 | 未建，待 accent 拍板后一并定 |
| `--ring` | 焦点环，dark 下略亮于 primary 保持反馈感 | 【规格书结论】= 仓内现状 | 既有，不动 |
| `--tab-indicator` | 默认跟随 `--primary` | 【LA 自有调整】沿用仓内现状 | 既有，不动 |

规则：dark 下 accent 必须抬亮度/降饱和以保证对比度（色相可同族微调）。【规格书结论：两家暗色主题的共同做法】

### 1.5 Status 层（PB-100 新增 success / warning / info 三件套）

每色配三件套：本色、`--*-soft`（浅底）、`--*-foreground`（soft 上的可读文本色）。【规格书结论：soft 底色三件套模式】

| Token | Light | Dark | 来源 |
|---|---|---|---|
| `--success` | `152 45% 34%` | `152 45% 55%` | 语义色绿+浅底【规格书结论】；具体值【LA 自有调整】 |
| `--success-soft` | `152 40% 93%` | `152 30% 15%` | 【LA 自有调整】同族派生（浅底：light 高明度 / dark 低明度） |
| `--success-foreground` | `152 55% 22%` | `152 50% 72%` | 【LA 自有调整】同族派生（soft 上可读文本） |
| `--warning` | `32 90% 35%` | `38 85% 65%` | 琥珀语义【规格书结论】；具体值【LA 自有调整】 |
| `--warning-soft` | `38 90% 93%` | `35 45% 16%` | 【LA 自有调整】同族派生 |
| `--warning-foreground` | `32 85% 24%` | `38 80% 75%` | 【LA 自有调整】同族派生 |
| `--info` | `210 70% 42%` | `210 80% 68%` | 【LA 自有调整】中性蓝，LA 原创 |
| `--info-soft` | `210 70% 94%` | `210 45% 16%` | 【LA 自有调整】同族派生 |
| `--info-foreground` | `210 75% 28%` | `210 80% 78%` | 【LA 自有调整】同族派生 |
| `--destructive` | `0 84.2% 60.2%` | `0 55% 45%` | 【LA 自有调整】沿用仓内现状 | 既有，不动（PB-100 不重复定义） |

CAT 工作区专属语义（QA 通过/警告/失败、segment 状态、delivery gate）一律映射到本 status 层，不另立色相。【LA 自有调整】仓内既有 violet 评审色迁移到 status 层归 PB-104。

### 1.6 功能色

| Token | 值 | 来源 | PB-100 状态 |
|---|---|---|---|
| `--code-bg` | `210 13% 12%`（双主题相同） | 【LA 自有调整】沿用仓内现状 | 既有，不动 |
| `--tooltip` / `--tooltip-foreground` / `--tooltip-muted` | 深底浅字三件套 | 【LA 自有调整】沿用仓内现状 | 既有，不动 |
| `--dashed-border` / `--dashed-border-hover` | ThinkingBlock SVG 虚线边框色（SVG data-URI，`stroke-dasharray` + 圆角 rect） | 【规格书结论：SVG 虚线规避 CSS dashed 圆角断裂】 | 既有，不动 |

---

## 2. Typography

### 2.1 字族

| Token | 值 | 来源 | PB-100 状态 |
|---|---|---|---|
| `--font-sans` | `'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif` | 【LA 自有调整】沿用仓内现状（Inter Variable 为开源字体、自托管，非品牌资产） | 既有，不动 |
| `--font-mono` | `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace` | 【规格书结论】 | 既有，不动 |
| 品牌字族 | **不设立** | 【LA 自有调整：无品牌资产】 | — |
| `font-feature-settings` | `'cv11','ss01','ss03','tnum'`（数字表格对齐） | 【规格书结论】= 仓内现状 | 既有，不动 |

### 2.2 字号 / 行高阶梯（PB-100 落地：base = 13px，仓内事实密度）

Tailwind `fontSize` 增量（`apps/electron/tailwind.config.js`），**刻意覆盖默认值**——Tailwind 默认 `base` = 16px，仓内事实正文为 13px（信息密度优先的桌面 UI），故 `base` = 13px，`xs/sm/lg` 顺移一档。既有 `text-xs/sm/base/lg` 类自动吃新值。

| 档 | 字号 | 行高 | 用途 | 来源 |
|---|---|---|---|---|
| `badge` | 10px / 600 | 15px | 计数徽章 | 档位存在性【规格书结论】；并入 fontSize【LA 自有调整】 |
| `xs` | 11px | 1.33 | 最小标注 | 【规格书结论】 |
| `sm` | 12px | 1.43 | 侧栏/辅助文字 | 【规格书结论】 |
| `base` | 13px | 1.5 | 正文默认 | 【LA 自有调整】仓内事实密度（规格书结论为 14px，未采用） |
| `lg` | 14px | 1.56 | 强调正文 | 【LA 自有调整】顺移一档（规格书结论 16px 未采用） |
| `heading-sm/md/lg/xl` | 16 / 18 / 20 / 24px | 1.25 / 600 | 标题 | 【LA 自有调整】LA 原创阶梯 |
| `--md-preview-font-size` | 15px（small/medium/large 三档可调） | — | Markdown 预览正文 | 【LA 自有调整】沿用仓内现状，不动 |

### 2.3 字重 / 字距 / 行高档

- 字重：400 regular / 500 medium / 600 semibold / 700 bold。【规格书结论】
- 字距：tight `-0.025em`（标题）/ normal `0` / wide `+0.025em`（大写小标签）。【规格书结论】
- 行高档：tight 1.25 / snug 1.375 / normal 1.5 / relaxed 1.625。【规格书结论】

---

## 3. Spacing

- 基频 4px，阶梯：`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px`（即 Tailwind 0/1/2/3/4/5/6/8/10/12/16）。【规格书结论：两家 Tailwind 体系均沿用此阶梯；仓内事实标准】
- **PB-100 决策：不建独立 `--spacing-*` token 层**，继续用 Tailwind 默认阶梯（仓内现状，见 §8-⑥）。
- 布局高度锚点（toolbar 46px / toolbar-pane 40px / toolbar-sm 36px / 设置行 64px）【规格书结论：Codex 值】——**归 PB-102 处理**（见 §8-⑩）。
- 侧栏宽度策略（clamp 固定 vs 可拖拽 300–420px）——**归 PB-102 处理**（见 §8-⑩）。

---

## 4. Radius

| Token | 值 | 来源 | PB-100 状态 |
|---|---|---|---|
| `--radius`（基准） | `0.375rem`（6px） | 【LA 自有调整】沿用仓内现状 | 既有，不动 |
| 派生：sm / md / lg / xl / 2xl | `radius-4 / radius-2 / radius / radius+2 / radius+4` | 【LA 自有调整】沿用仓内 tailwind 派生公式 | 既有，不动 |
| `--radius-cap` | 6px（大圆角压平，ui-modern） | 【LA 自有调整】沿用仓内现状 | 既有，不动 |
| pill（badge/状态点） | `999px` 全圆 | 【规格书结论】 | 消费侧既有 |
| composer 单行圆角 22px | **不采用** | 【规格书结论】；PB-100 决策不采用，沿用 `--radius` 派生体系（见 §8-⑦） | — |

---

## 5. Elevation（阴影层级）

五档语义阴影，light/dark 双套，**dark 档额外带 inset 顶高光**弥补黑底缺乏自然阴影。【规格书结论；取值 = 仓内现状，直接沿用】PB-100 不动。

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `0 1px 1px 0 rgb(0 0 0 / 0.04)` | `0 1px 2px 0 rgb(0 0 0 / 0.4)` |
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0/0.05), 0 1px 1px 0 rgb(0 0 0/0.04)` | `0 1px 3px 0 rgb(0 0 0/0.5), inset 0 1px 0 0 hsl(0 0% 100%/0.06)` |
| `--shadow-md` | `0 4px 8px -2px rgb(0 0 0/0.08), 0 2px 4px -1px rgb(0 0 0/0.05), 0 0 0 1px rgb(0 0 0/0.04)` | `0 6px 16px -4px rgb(0 0 0/0.55), 0 2px 4px 0 rgb(0 0 0/0.35), inset 0 1px 0 0 hsl(0 0% 100%/0.08)` |
| `--shadow-lg` | `0 12px 24px -6px rgb(0 0 0/0.12), 0 4px 8px -2px rgb(0 0 0/0.06), 0 0 0 1px rgb(0 0 0/0.04)` | `0 16px 32px -8px rgb(0 0 0/0.6), 0 6px 12px -2px rgb(0 0 0/0.4), inset 0 1px 0 0 hsl(0 0% 100%/0.10)` |
| `--shadow-xl` | `0 24px 48px -12px rgb(0 0 0/0.18), 0 12px 24px -6px rgb(0 0 0/0.08), 0 0 0 1px rgb(0 0 0/0.05)` | `0 32px 64px -16px rgb(0 0 0/0.7), 0 16px 32px -8px rgb(0 0 0/0.5), inset 0 1px 0 0 hsl(0 0% 100%/0.12)` |

补充：composer 等"浮于内容之上"的主表面用最高档（映射到 `--shadow-xl`，无边框）。【规格书结论：Codex elevation-prominent 模式；映射关系为 LA 自有调整】

---

## 6. Motion（PB-100 落地）

### 6.1 时长（只在 `:root` 定义一次，不随主题变化）

| Token | 值 | 用途 | 来源 | PB-100 状态 |
|---|---|---|---|---|
| `--duration-instant` | 0ms | reduced motion / 拖拽跟手 | 【规格书结论】 | **已落地** |
| `--duration-fast` | 120ms | hover/淡入淡出微反馈 | 【LA 自有调整】沿用仓内现状（120/150ms 区间） | **已落地** |
| `--duration-normal` | 200ms | 展开折叠、模式切换 | 【规格书结论：ThinkingBlock max-height 200ms / mode switch 200ms】 | **已落地** |
| `--duration-slow` | 300ms | 面板滑入滑出、较大位移 | 【规格书结论】 | **已落地** |
| `--duration-emphasis` | 500–800ms | 入场强调（一次性） | 【规格书结论】 | 未建 token，需要时再加 |

Tailwind 侧：`transitionDuration` 增 `fast/normal/slow` 指向 `var(--duration-*)`；既有数字档（75/100/150/…）保留可用。

### 6.2 缓动（只在 `:root` 定义一次）

| Token | 值 | 来源 | PB-100 状态 |
|---|---|---|---|
| `--ease-standard` | `cubic-bezier(0.23, 1, 0.32, 1)` | 【规格书结论】 | **已落地** |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 【LA 自有调整】沿用仓内 popover 入场现状 | **已落地** |
| `--ease-in-out` | `ease-in-out` | 【规格书结论】 | CSS 内置关键字，不建变量 |

Tailwind 侧：`transitionTimingFunction` 增 `standard/enter` 指向 var。

### 6.3 Reduced motion 降级

1. **全局 `@media (prefers-reduced-motion: reduce)`（PB-100 已落地）**：`@layer base` 内一条文件级规则，所有 animation/transition duration → 0.01ms、无限循环动画 iteration-count → 1、scroll-behavior → auto。【规格书结论：Codex `data-reduced-motion` 全部归 0s 的做法】
2. 持续性视觉效果（辉光、屏闪、vignette、脉冲阴影）的移除仍由 terminal 主题既有的 3 处局部规则承担（保留不动）；后续主题若引入类似持续效果需同样处理。【规格书结论；仓内 terminal 主题已局部实践】
3. 功能态用瞬时状态切换表达（如 spinner → 静态"加载中"文本）——全局规则下 `animate-spin` 等动画首帧静止，组件迁移时在 PB-101~104 中补静态降级。【LA 自有调整】
4. **暴露方式：仅跟随系统 `prefers-reduced-motion`**，不提供应用内开关（见 §8-⑨）。

---

## 7. 落点文件（PB-100 实际）

| 落点 | 内容 | PB-100 状态 |
|---|---|---|
| `apps/electron/src/renderer/styles/globals.css`（`@layer base` 内 ".dark 块之后、特殊主题块之前"的 LA token 增量区块） | `--foreground-faint`、status 三色三件套、`--scrim`、`--border-strong/-light`、motion 变量（只 :root）、全局 reduced-motion 规则 | **已落地** |
| `apps/electron/tailwind.config.js` | colors 增 `foreground-faint`/`success`/`warning`/`info`（含 soft/foreground 子键）/`scrim`；`fontSize` 语义阶梯；`transitionDuration`/`transitionTimingFunction` 语义别名 | **已落地** |
| `apps/electron/src/renderer/atoms/theme.ts` | localStorage 持久化键含 `proma-` 前缀——**PB-100 决策不改名**（见 §8-③） | 不动 |
| `apps/electron/src/renderer/styles/globals.css` 7 个特殊主题 class | **PB-100 不动**，去留归 PB-113（见 §8-②） | 不动 |
| `packages/ui/`（code-block / mermaid-block / hooks） | 无 token 体系，继续消费 `--code-bg` 等语义变量即可，不新增 | 不动 |
| `packages/session-core/src/tokens.ts` | **与 design token 无关**（LLM 上下文 token 估算），勿混淆、勿动 | 不动 |
| 组件内 34 处 raw palette 状态色 | 迁移到 status 层归 PB-101~104，PB-100 只建 token 层 | 不动 |

---

## 8. PB-100 已决事项

1. **accent 主色色相不动，待用户拍板**：既有 `--primary` 保持仓内现状（中性灰），`--accent-soft` 暂不建；用户拍板 LA 自有色相后一并定义 light/dark 提亮版与 accent-soft。
2. **特殊主题去留归 PB-113**：仓内继承自 fork 上游的 4 套特殊主题（ocean/forest/slate/terminal 共 7 个 class）PB-100 原样保留、不改名不裁剪。
3. **`proma-` 前缀不改名**：localStorage 键、设置文件路径等含上游字样的持久化键维持现状，避免丢用户旧缓存；如未来清理需单独评估迁移窗口。
4. **字体策略沿用**：Inter Variable 继续自托管；中文回退栈（PingFang SC / Microsoft YaHei）维持现状。
5. **base 字号 = 13px**：按仓内事实密度定（规格书结论 14px 未采用）；md-preview 15px 独立变量不动。Tailwind 默认 `base`=16px 被刻意覆盖，影响面为既有 `text-base` 类（9 处）及 `text-xs/sm/lg` 顺移一档，属可接受的统一直接生效。
6. **spacing 不建独立 token 层**：继续用 Tailwind 默认 4px 基频阶梯，不引入 `--spacing-*` 变量。
7. **composer 22px 大圆角不采用**：沿用仓内 `--radius` 派生体系（基准 6px）。
8. **status 层 = success / warning / info / destructive**：CAT 工作区 QA / segment / delivery gate 状态一律映射本层；既有 violet 评审色的迁移归 PB-104。
9. **reduced motion 仅跟随系统**：只响应 `prefers-reduced-motion`，不提供应用内开关。
10. **布局锚点归 PB-102**：toolbar 46/40/36、设置行 64px、侧栏宽度策略（clamp vs 可拖拽）均不在 PB-100 落地。
