# LA Design Tokens 草案

> **⚠️ 草案 —— 仅供 PB-100 工单参考，正式实现以 Batch 10 开工为准。**
> **⚠️ 三客户端规格书（THREE_APPS_PIXEL_SPEC.md）为私人研究资料，其原文与其中任何第三方品牌资产（品牌色、品牌字体、Logo、商标字样、主题名称）均不入仓。本文件只含提炼后的 token 结论与 LA 自有取值。**

- 日期：2026-07-25
- 依据：LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md v1.0，PB-100（Batch 10）
- 来源标注：每个值标注 **【规格书结论】**（三客户端逆向提炼的共性/做法）或 **【LA 自有调整】**（仓内现状沿用或新拟）

---

## 0. 提炼原则

1. **语义分层**：颜色按 surface / text / border / accent / status 五层组织，不写"颜色值"，只写"用途"。【规格书结论：三家共识】
2. **HSL 通道存储**：变量存 `H S% L%` 三通道，消费处用 `hsl(var(--x) / <alpha>)`，获得透明度合成能力。【规格书结论：Proma；仓内已落地】
3. **派生用 color-mix**：边框、弱化文本、雾化背景等从 `--foreground` 用 `color-mix(in oklab, ...)` 派生（边框 8% / 强调边框 12% / 轻分隔 5% / 二级文本 65% / 雾化底 2.5%）。【规格书结论：Codex 插值比例表】
4. **light/dark 双套**：暗色不是反色，是独立调色；暗色阴影带 inset 顶高光制造"浮起"感。【规格书结论：Proma】
5. **零品牌资产**：不设品牌字族、不引入任何第三方签名色/主题配色/商标字样。accent 色相留待 PB-100 与用户确认（见 §8）。【LA 自有调整】

---

## 1. Colors（light / dark 双套）

### 1.1 Surface 层

| Token | Light | Dark | 来源 |
|---|---|---|---|
| `--background`（侧栏锚点） | `0 0% 100%` | `0 0% 10%` | 【规格书结论】= 仓内现状 |
| `--content-area`（主内容区） | `0 0% 100%` | `0 0% 7%` | 【规格书结论】= 仓内现状 |
| `--card` | `0 0% 100%` | `0 0% 13%` | 【规格书结论】= 仓内现状 |
| `--popover` | `0 0% 100%` | `0 0% 14%` | 【规格书结论】= 仓内现状 |
| `--dialog` | `0 0% 100%` | `0 0% 16%` | 【规格书结论】= 仓内现状 |
| `--input-surface` | `60 14.3% 98.6%` | `0 0% 9%` | 【LA 自有调整】沿用仓内现状 |
| `--scrim`（遮罩） | `rgb(29 27 24 / 0.32)` | `rgb(0 0 0 / 0.5)` | 【规格书结论】 |

**暗色亮度阶梯规律**：content-area(7%) < background(10%) < card(13%) < popover(14%) < dialog(16%)，用亮度层级表达浮起层级。【规格书结论】

### 1.2 Text 层

| Token | Light | Dark | 来源 |
|---|---|---|---|
| `--foreground` | `0 0% 3.9%` | `0 0% 98%` | 【规格书结论】= 仓内现状 |
| `--muted-foreground` | `0 0% 45.1%` | `0 0% 63.9%` | 【规格书结论】= 仓内现状 |
| `--foreground-faint`（placeholder/三级文本，新增） | `0 0% 62%` | `0 0% 45%` | 三级文本存在性【规格书结论：两家均有 faint/descriptionForeground 层级】；具体值【LA 自有调整】 |

派生规则：二级/弱化文本优先用 `color-mix(in oklab, var(--foreground) 65%, transparent)` 现算，而非新增固定变量。【规格书结论】

### 1.3 Border 层

| Token | Light | Dark | 来源 |
|---|---|---|---|
| `--border` | `0 0% 89.8%` | `0 0% 22%` | 【规格书结论】= 仓内现状 |
| `--input` | = `--border` | = `--border` | 【规格书结论】= 仓内现状 |
| `--border-strong`（派生） | `color-mix(oklab, fg 12%)` | 同左 | 【规格书结论】 |
| `--border-light`（派生） | `color-mix(oklab, fg 5%)` | 同左 | 【规格书结论】 |

### 1.4 Accent 层（主色）

结构【规格书结论】；**具体色相不在草案中预设**，见 §8 确认事项：

| Token | 说明 | 来源 |
|---|---|---|
| `--primary` / `--primary-foreground` | 主操作色及其上文字 | 【规格书结论】结构；取值待确认 |
| `--accent-soft`（浅底） | 选中态/高亮浅底 | 【规格书结论：两家均有 accent-soft 浅底】 |
| `--ring` | 焦点环，dark 下略亮于 primary 保持反馈感 | 【规格书结论】 |
| `--tab-indicator` | 默认跟随 `--primary` | 【LA 自有调整】沿用仓内现状 |

规则：dark 下 accent 必须抬亮度/降饱和以保证对比度（色相可同族微调）。【规格书结论：两家暗色主题的共同做法】

### 1.5 Status 层

| Token | Light | Dark | 来源 |
|---|---|---|---|
| `--success` | `hsl(152 45% 34%)` | `hsl(152 45% 55%)` | 语义色绿+浅底【规格书结论】；具体值【LA 自有调整】 |
| `--warning` | `hsl(32 90% 35%)` | `hsl(38 85% 65%)` | 琥珀语义【规格书结论】；具体值【LA 自有调整】 |
| `--destructive` | `0 84.2% 60.2%` | `0 55% 45%` | 【LA 自有调整】沿用仓内现状 |
| 每色配 `--*-soft`（浅底）与 `--*-foreground` | — | — | 【规格书结论：soft 底色三件套模式】 |

CAT 工作区专属语义（QA 通过/警告/失败、segment 状态、delivery gate）一律映射到本 status 层，不另立色相。【LA 自有调整】

### 1.6 功能色

| Token | 值 | 来源 |
|---|---|---|
| `--code-bg` | `210 13% 12%`（双主题相同） | 【LA 自有调整】沿用仓内现状 |
| `--tooltip` / `--tooltip-foreground` / `--tooltip-muted` | 深底浅字三件套 | 【LA 自有调整】沿用仓内现状 |
| `--dashed-border` / `--dashed-border-hover` | ThinkingBlock SVG 虚线边框色（SVG data-URI，`stroke-dasharray` + 圆角 rect） | 【规格书结论：SVG 虚线规避 CSS dashed 圆角断裂】 |

---

## 2. Typography

### 2.1 字族

| Token | 值 | 来源 |
|---|---|---|
| `--font-sans` | `'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif` | 【LA 自有调整】沿用仓内现状（Inter Variable 为开源字体、自托管，非品牌资产） |
| `--font-mono` | `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace` | 【规格书结论】 |
| 品牌字族 | **不设立** | 【LA 自有调整：无品牌资产】 |
| `font-feature-settings` | `'cv11','ss01','ss03','tnum'`（数字表格对齐） | 【规格书结论】= 仓内现状 |

### 2.2 字号 / 行高阶梯（base = 14px 桌面密度）

| 档 | 字号 | 行高 | 用途 | 来源 |
|---|---|---|---|---|
| `xs` | 11px | 1.33 | 最小标注 | 【规格书结论】 |
| `sm` | 12px | 1.43 | 侧栏/辅助文字 | 【规格书结论】 |
| `base` | 14px | 1.5 | 正文默认 | 【规格书结论】 |
| `lg` | 16px | 1.56 | 大段阅读 | 【规格书结论】 |
| `heading-sm/md/lg` | 18 / 20 / 24px | tight | 标题 | 【规格书结论】 |
| `xl` | 28px | 1.4 | 页面级标题 | 【规格书结论】 |
| `badge` | 10px / 600 / leading 15px / rounded-full | — | 计数徽章 | 【规格书结论】 |
| `--md-preview-font-size` | 15px（small/medium/large 三档可调） | — | Markdown 预览正文 | 【LA 自有调整】沿用仓内现状 |

### 2.3 字重 / 字距 / 行高档

- 字重：400 regular / 500 medium / 600 semibold / 700 bold。【规格书结论】
- 字距：tight `-0.025em`（标题）/ normal `0` / wide `+0.025em`（大写小标签）。【规格书结论】
- 行高档：tight 1.25 / snug 1.375 / normal 1.5 / relaxed 1.625。【规格书结论】

---

## 3. Spacing

- 基频 4px，阶梯：`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px`（即 Tailwind 0/1/2/3/4/5/6/8/10/12/16）。【规格书结论：两家 Tailwind 体系均沿用此阶梯；仓内事实标准】
- 布局高度锚点（作为布局 token 引入）：toolbar 46px / toolbar-pane 40px / toolbar-sm 36px / 设置行 64px。【规格书结论：Codex 值】；是否照搬或微调【LA 自有调整，见 §8】
- 侧栏宽度：`clamp(240px, 275px, min(520px, 100vw - 320px))` 或可拖拽 300–420px 两案并存。【规格书结论：两家不同做法】；取舍见 §8

---

## 4. Radius

| Token | 值 | 来源 |
|---|---|---|
| `--radius`（基准） | `0.375rem`（6px） | 【LA 自有调整】沿用仓内现状 |
| 派生：sm / md / lg / xl / 2xl | `radius-4 / radius-2 / radius / radius+2 / radius+4` | 【LA 自有调整】沿用仓内 tailwind 派生公式 |
| `--radius-cap` | 6px（大圆角压平，ui-modern） | 【LA 自有调整】沿用仓内现状 |
| pill（badge/状态点） | `999px` 全圆 | 【规格书结论】 |
| composer 单行圆角 | 22px | 【规格书结论】；是否采用见 §8 |

---

## 5. Elevation（阴影层级）

五档语义阴影，light/dark 双套，**dark 档额外带 inset 顶高光**弥补黑底缺乏自然阴影。【规格书结论；取值 = 仓内现状，直接沿用】

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `0 1px 1px 0 rgb(0 0 0 / 0.04)` | `0 1px 2px 0 rgb(0 0 0 / 0.4)` |
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0/0.05), 0 1px 1px 0 rgb(0 0 0/0.04)` | `0 1px 3px 0 rgb(0 0 0/0.5), inset 0 1px 0 0 hsl(0 0% 100%/0.06)` |
| `--shadow-md` | `0 4px 8px -2px rgb(0 0 0/0.08), 0 2px 4px -1px rgb(0 0 0/0.05), 0 0 0 1px rgb(0 0 0/0.04)` | `0 6px 16px -4px rgb(0 0 0/0.55), 0 2px 4px 0 rgb(0 0 0/0.35), inset 0 1px 0 0 hsl(0 0% 100%/0.08)` |
| `--shadow-lg` | `0 12px 24px -6px rgb(0 0 0/0.12), 0 4px 8px -2px rgb(0 0 0/0.06), 0 0 0 1px rgb(0 0 0/0.04)` | `0 16px 32px -8px rgb(0 0 0/0.6), 0 6px 12px -2px rgb(0 0 0/0.4), inset 0 1px 0 0 hsl(0 0% 100%/0.10)` |
| `--shadow-xl` | `0 24px 48px -12px rgb(0 0 0/0.18), 0 12px 24px -6px rgb(0 0 0/0.08), 0 0 0 1px rgb(0 0 0/0.05)` | `0 32px 64px -16px rgb(0 0 0/0.7), 0 16px 32px -8px rgb(0 0 0/0.5), inset 0 1px 0 0 hsl(0 0% 100%/0.12)` |

补充：composer 等"浮于内容之上"的主表面用最高档（映射到 `--shadow-xl`，无边框）。【规格书结论：Codex elevation-prominent 模式；映射关系为 LA 自有调整】

---

## 6. Motion

### 6.1 时长

| Token | 值 | 用途 | 来源 |
|---|---|---|---|
| `--duration-instant` | 0ms | reduced motion / 拖拽跟手 | 【规格书结论】 |
| `--duration-fast` | 120ms | hover/淡入淡出微反馈 | 【LA 自有调整】沿用仓内现状（120/150ms 区间） |
| `--duration-normal` | 200ms | 展开折叠、模式切换 | 【规格书结论：ThinkingBlock max-height 200ms / mode switch 200ms】 |
| `--duration-slow` | 300ms | 面板滑入滑出、较大位移 | 【规格书结论】 |
| `--duration-emphasis` | 500–800ms | 入场强调（一次性） | 【规格书结论】 |
| 拖拽中时长 | 降至 150ms | 拖拽跟手 | 【规格书结论】 |

### 6.2 缓动

| Token | 值 | 来源 |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.23, 1, 0.32, 1)` | 【规格书结论】 |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 【LA 自有调整】沿用仓内 popover 入场现状 |
| `--ease-in-out` | `ease-in-out` | 【规格书结论】 |

### 6.3 Reduced motion 降级

1. 全局 `@media (prefers-reduced-motion: reduce)`：所有 duration → 0（或 0.01ms），无限循环动画停止。【规格书结论：Codex `data-reduced-motion` 全部归 0s 的做法】
2. 同步移除持续性视觉效果（辉光、屏闪、vignette、脉冲阴影），不只停动画——对应畏光/视觉敏感用户。【规格书结论；仓内 terminal 主题已局部实践】
3. 功能态用瞬时状态切换表达（如 spinner → 静态"加载中"文本）。【LA 自有调整】
4. **现状缺口**：仓内 reduced-motion 处理是零散、按组件/按主题的，PB-100 需全局化为一条 base 层规则。【LA 自有调整】

---

## 7. 建议落点文件

新仓现有 token 体系：HSL 通道变量集中在 `globals.css` 的 `@layer base`（`:root` / `.dark` / 7 个特殊主题 class），Tailwind 通过 `hsl(var(--*))` 消费；几何与阴影 token 已变量化；**typography / spacing / motion 目前无 token，靠 Tailwind 默认值和内联值**。落点建议：

| 落点 | 内容 |
|---|---|
| `apps/electron/src/renderer/styles/globals.css`（@layer base 的 `:root` / `.dark` 区，约 73–185 行） | colors / radius / elevation 增量（faint 文本、status 三色、border-strong/light 派生、scrim）；新增 typography / spacing / motion 变量区 |
| `apps/electron/tailwind.config.js` | `theme.extend` 增映射：`fontSize` 阶梯、`transitionDuration` / `transitionTimingFunction` 指向 motion token；colors 增 status 三色 |
| `apps/electron/src/renderer/atoms/theme.ts` | token 无关，但 localStorage 持久化键含 `proma-` 前缀字样（`proma-theme-mode` 等），PB-100 时一并改名（品牌字样清理） |
| `packages/ui/`（code-block / mermaid-block / hooks） | 无 token 体系，继续消费 `--code-bg` 等语义变量即可，不新增 |
| `packages/session-core/src/tokens.ts` | **与 design token 无关**（LLM 上下文 token 估算），勿混淆、勿动 |
| （可选）`apps/electron/src/renderer/styles/tokens.css` | 若想让 token 与组件样式分离，可新建此文件集中承载，globals.css 只留组件样式。【LA 自有调整建议】 |

---

## 8. PB-100 开工时需与用户确认的事项

1. **LA accent 主色色相**：草案刻意不预设（避免任何第三方签名色）。需用户拍板 LA 自己的主色及 dark 提亮版。
2. **特殊主题去留**：仓内继承自 fork 上游的 4 套特殊主题（含中文主题名与 CRT 终端风格）是否保留、裁剪或改名——涉及上游品牌痕迹的界定。
3. **`proma-` 前缀清理范围**：localStorage 键、设置文件路径等含上游字样的持久化键，改名会丢用户旧缓存，需确认迁移窗口。
4. **字体策略**：Inter Variable 是否继续自托管；中文回退栈（PingFang SC / Microsoft YaHei）是否维持现状。
5. **base 字号**：14px（规格书结论）vs 仓内事实 15px（md-preview）——正文密度取舍。
6. **spacing 是否建独立 token 层**：引入 `--spacing-*` 变量，还是继续用 Tailwind 默认阶梯（仓内现状）。
7. **composer 22px 大圆角**是否采用，还是沿用仓内 `--radius` 派生体系。
8. **CAT 工作区状态色清单**：QA / segment / delivery gate 各需要几个语义状态，确认后映射到 status 层。
9. **reduced motion 的暴露方式**：仅跟随系统 `prefers-reduced-motion`，还是额外提供应用内开关。
10. **布局锚点值**：toolbar 46/40/36、侧栏宽度策略（clamp 固定 vs 可拖拽 300–420px）二选一。
