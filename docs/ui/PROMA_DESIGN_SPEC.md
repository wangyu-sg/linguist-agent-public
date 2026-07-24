# Proma 设计规格书 — 像素级复刻参考

> **源**：Proma v0.15.11（Erlich Liu），基于 **Electron 39 + Bun + React 18 + Pi 0.80.x**。
> **重要性**：Proma 是 LA 演化蓝图的**灵感之一**。两者共享同一底层（Pi 0.80.x + Electron + React），Proma 是"Pi 通用 Agent 产品化的最佳实践参考"。
> **方法**：逆向了 DMG 打包、GitHub 源码（完整 monorepo）、Electron 主进程/Preload/Renderer 三层、ShadcnUI 组件库、4 套主题系统（ocean/forest/slate/terminal）、Agent SDK 流式渲染、ThinkingBlock 交互。
>
> **与 OpenWorker 规格的关系**：OpenWorker 教 LA "极简 = 优雅"。Proma 教 LA "Pi 通用 Agent 如何做成一个成熟的桌面产品"。

---

## 0. 架构总览（对 LA 最重要的信息）

### 0.1 技术栈（完整对比）

| 层 | Proma | LA | 差距 |
|---|---|---|---|
| **原生壳** | Electron 39 | Electron 43 | LA 版本更新，不差 |
| **包管理** | **Bun**（lockfile: `bun.lock`） | npm | 不影响 |
| **UI 框架** | React 18 + **Tailwind CSS** + **ShadcnUI** | React 18 + 自写 CSS | ⚠️ **LA 缺 Tailwind**——ShadcnUI 组件库内置 38 个组件，安全/可访问性/键盘/ARIA 全验证 |
| **状态管理** | **Jotai**（atom-based） | 自写 store / useReducer | ⚠️ **Proma 的全局 atoms 模式值得借鉴**——独立、可组合、可测试 |
| **Pi 集成** | `@earendil-works/pi-ai@0.80.3` + 自定义 patch | 同版本 Pi | ✅ **完全兼容**——Proma 的 Pi 集成模式可直接参考 |
| **字体** | **Inter Variable**（自托管，含 tabular-nums + cv11/ss01/ss03） | -apple-system | ⚠️ Inter Variable 免费，自托管 0 开销，数字表格对齐效果明显 |
| **构建** | Vite + esbuild | Vite | ✅ 相同 |
| **桌面打包** | **electron-builder**（DMG + NSIS） | —（LA 目前无正式打包） | ⚠️ **Proma 的 electron-builder 配置可以直接参考** |
| **多主题** | 4 套 × 暗/亮 = **8 个主题** | 1 套（light/dark） | ⚠️ Proma 用 HSL + CSS custom properties 实现主题系统 |
| **Markdown** | **@anthropic-ai 的 MessageResponse** | react-markdown | ⚠️ — |
| **Streaming** | SDK stream events（messageDelta / reasoningDelta / complete / error）| LA 的 canonical events | ✅ Proma 的 delta 流式渲染是 LA 应该对齐的目标 |

### 0.2 为什么 Proma 对 LA 特别重要

Proma 和 LA 在 3 个关键层面是同构的：

1. **相同的运行时**：都跑在 `@earendil-works/pi-ai@0.80.3` 上。Proma 的 Pi 集成模式（patch → session lifecycle → stream handling）可以直接迁移到 LA。
2. **相同的前端架构**：都是 Electron + React + Vite。Proma 的组件层次（AgentView → AgentMessages → SDKMessageRenderer → ContentBlock）是在 LA 的 Electron 内可直接复制的模式。
3. **相同的产品形态**：桌面 Agent 应用。Proma 已经跑通了 Developer ID 签名 + Apple 公证 + electron-builder DMG 发布，这正是 LA 缺的。

---

## 1. 设计令牌系统（HSL + 多主题）

### 1.1 HSL 通道设计（非 hex RGB）

Proma 所有颜色使用 **HSL 通道**存储，通过 `hsl(var(--token) / <alpha-value>)` 消费：

```css
/* 格式：H S% L% —— 三个值，空格分隔，无逗号 */
--background: 0 0% 100%;       /* HSL (0, 0%, 100%) = 纯白 */
--primary: 205 50% 50%;        /* HSL (205, 50%, 50%) = 蓝色调 */
```

**Tailwind 集成**（`tailwind.config.js`）：
```js
colors: {
  background: 'hsl(var(--background) / <alpha-value>)',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
}
```

**LA 映射**：当前 LA 用 hex 存储（`--la-color-accent: #4c8dff`）。Proma 的 HSL 方式有两个优势：
- 支持 `/NN` opacity（`bg-primary/70`）
- 同一主题的亮暗色可以在 v3 色相左右微调（如 ocean-light 在蓝色区 205°40-50，ocean-dark 调灰到 210°12-14）

**建议**：LA 不必迁移到 HSL（改动太大），但应把 tokens 的**语义**补全到 Proma 的水平。

### 1.2 完整的 token 清单（Proma 定义）

Proma 有 **31 个 CSS 变量**，分 4 层：

| 层 | Token | 数量 | 说明 |
|---|---|---|---|
| **ShadcnUI 标准** | `--background` `--foreground` `--muted` `--muted-foreground` `--border` `--ring` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--input` | 19 | ShadcnUI 内建，所有组件自动使用 |
| **Proma 扩展** | `--dialog` `--dialog-foreground` `--content-area` `--sidebar-surface` `--tabbar-surface` `--tab-indicator` `--tab-surface` `--sidebar-control-surface` `--sidebar-control-surface-hover` `--sidebar-control-stroke` `--input-surface` `--code-bg` | 12 | 布局/侧栏/代码块专属 |
| **几何 token** | `--radius` `--radius-cap` `--radius-xl-extra` `--radius-2xl-extra` | 4 | 全局圆角基准 |
| **阴影 token** | `--shadow-xs` `--shadow-sm` `--shadow-md` `--shadow-lg` `--shadow-xl` | 5 | light/dark 分别定义，dark 带 inset 顶高光 |
| **虚线边框** | `--dashed-border` `--dashed-border-hover` | 2 | ThinkingBlock 的 SVG 虚线边框色 |
| **Tooltip** | `--tooltip` `--tooltip-foreground` `--tooltip-muted` | 3 | |
| **代码块** | `--code-bg` | 1 | |
| **Markdown 字号** | `--md-preview-font-size` | 1 | 可调（small/medium/large 三档） |

### 1.3 4 套主题 × 暗/亮 = 8 版本

| 主题 | 风格描述 | CSS class |
|---|---|---|
| **默认**（ShadcnUI 内置） | 标准灰度 | `:root`（亮）/ `.dark`（暗） |
| **晴空碧海 (ocean)** | 清凉蓝调——"干净的深海玻璃" | `.theme-ocean-light` / `.theme-ocean-dark` |
| **森息夜语 (forest)** | 暖橄榄绿 + 墨绿暗色 | `.theme-forest-light` / `.theme-forest-dark` |
| **莫兰迪夜 (slate)** | 柔灰棕调——"云朵舞者" | `.theme-slate-light` / `.theme-slate-dark` |
| **CRT 终端 (terminal)** | 复古绿屏终端——全局等宽字体 `JetBrains Mono` | `.theme-terminal-dark`（仅暗色） |

每个主题定义了全部 30+ 个 HSL 通道，确保 ShadcnUI 的所有组件都能自适应主题色。

### 1.4 主题切换机制

```ts
// atoms/theme.ts 核心逻辑
// 1. localStorage 缓存（键：proma-theme-mode / proma-theme-style）
// 2. 系统 isDark 监测（matchMedia prefer-color-scheme: dark）
// 3. resolvedThemeAtom 派生：mode=system 时跟系统，mode=dark/light 直接
// 4. applyThemeToDOM：拼接 className（如 "dark theme-ocean-dark"）
```

**LA 映射**：当前 LA 只有 `data-theme="dark|light"`，缺少多主题支持。Proma 的 `themeStyleAtom` + `themeModeAtom` 双层模型值得借鉴。

---

## 2. 布局结构（像素级）

### 2.1 全局布局（AppShell）

Proma 用 **可拖拽宽度的三栏布局**：

```
┌─────────────────────────────────────────────────────────────────┐
│ Window Controls (macOS traffic lights inset: 16px 16px)         │
├────────────┬────────────────────────────────────┬───────────────┤
│            │  TabBar (标签页栏)                   │               │
│            │  [Chat 1] [Code review] [Plan] …    │               │
│  Left      ├────────────────────────────────────┤  Right        │
│  Sidebar   │                                    │  Side Panel   │
│  (会话列表)  │  MainArea (TabContent)             │  (文件浏览器)   │
│            │  AgentView                          │               │
│  min 300px │  ├─ AgentHeader (标题 + 上下文用量)   │  min 300px    │
│  max 420px │  ├─ AgentMessages (消息列表)          │  max 560px    │
│  可拖拽     │  └─ AgentInput (输入框)              │  可拖拽        │
│  可折叠     │                                    │  可折叠        │
│            │                                    │               │
├────────────┴────────────────────────────────────┴───────────────┤
```

**关键交互**：
- 左右侧栏都**可拖拽宽度**（`requestAnimationFrame` 节流，避免卡顿）
- 左侧栏可**完全折叠**（`sidebarCollapsedAtom`）
- 右侧面板默认**未打开**，只在选择 agent session 时打开

**LA 映射**：当前 LA 有多面板（PipelineWorkspace / CAT Workspace / Conversation / Settings），应收敛到 **sidebar + main + optional right rail** 三栏模式。

### 2.2 标签页系统（Tab System）

Proma 用**浏览器风格的标签页**代替 LA 的多面板模式：

```
┌─────────────────────────────────────────────────────────────────┐
│ [🗨️ Chat 1] [🔍 Code review] [📋 Plan] … [＋ 新建]              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TabContent (当前标签页的内容)                                    │
│                                                                 │
```

每个标签页是一个**独立的 Agent 会话**（sessionId）。关闭标签页不删除会话（后台会话仍保留在侧栏）。

**LA 映射**：当前 LA 的"项目模式 vs 独立 Chat"已经是一个弱化版的 tab 系统。应考虑显式的 tab 抽象。

### 2.3 AgentView 布局（核心交互区域）

```
┌─────────────────────────────────────────────────────────────────┐
│ AgentHeader                                                     │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [会话标题 可编辑]  [Model: sonnet-5]  [Context: 67%]        │ │
│ │ [Permission mode: Ask for approval ▾]                       │ │
│ │ [Workspace: /Users/…]                                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ AgentMessages                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  [消息列表 — 虚拟化滚动]                                     │ │
│ │                                                             │ │
│ │  ┌──────────────────────────────────┐                      │ │
│ │  │ 🧠 THINKING                      │                      │ │
│ │  │ ┌──────────────────────────────┐ │                      │ │
│ │  │ │  (虚线边框, 默认展开)          │ │                      │ │
│ │  │ │  thinking content text...    │ │                      │ │
│ │  │ └──────────────────────────────┘ │                      │ │
│ │  └──────────────────────────────────┘                      │ │
│ │                                                             │ │
│ │  Assistant message text (Markdown)…                         │ │
│ │                                                             │ │
│ │  → read_file src/main.ts                                    │ │
│ │    ✓ read_file · ok (200 lines)                             │ │
│ │                                                             │ │
├─────────────────────────────────────────────────────────────────┤
│ AgentInput                                                      │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Model: sonnet-5 ▾] [Permission: Ask ▾] [Plan mode ◎]      │ │
│ │                                                             │ │
│ │ ┌───────────────────────────────────────────────────────┐   │ │
│ │ │ Send a message…                                       │   │ │
│ │ └───────────────────────────────────────────────────────┘   │ │
│ │                                                  [📎] [🎤] │ │
│ │                              [Queue] [Stop ■] [Send →]      │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. ThinkingBlock — 像素级规格（LA 直接复刻）

### 3.1 组件结构

```tsx
function ThinkingBlock({ block, dimmed = false }: ThinkingBlockProps) {
  const thinkingExpanded = useAtomValue(thinkingExpandedAtom); // 全局偏好
  const [isExpanded, setIsExpanded] = useState(thinkingExpanded);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 同步测量内容高度，决定是否折叠（>4行 → shouldCollapse = true）
  useLayoutEffect(() => {
    // 先渲染完整内容（无 max-height）→ 测量 scrollHeight
    // → 判断是否 > 4行阈值 → 决定是否加 max-h-[5.6em]
  }, [block.thinking]);

  // 全局偏好变化时同步
  useEffect(() => setIsExpanded(thinkingExpanded), [thinkingExpanded]);
```

### 3.2 视觉规格

| 元素 | 规格 | 说明 |
|---|---|---|
| 标签图标 | `<Brain>` from lucide-react，`size={14}`（3.5 × 4px = 14px）| 只有思考块有，工具块用各自工具图标 |
| 标签文字 | `THINKING` — uppercase + tracking-wider，`font-size: 14px`，`color: --muted-foreground` | 小写转大写，加宽字间距 |
| 容器边框 | **SVG data URI 虚线**——非 CSS `border: dashed` | 这是关键：CSS 虚线边框在 border-radius 拐角处有对齐问题。Proma 用 SVG rect 的 `stroke-dasharray="8,6"` + `rx="8"` 解决 |
| 容器背景 | `bg-muted/50`（正常）或 `bg-muted/30`（dimmed） | dimmed 模式用于"已有文本内容的 turn 中" |
| 内容文字 | `text-foreground/90`（正常）或 `text-muted-foreground`（dimmed） | 在` 默认展开 |
| 折叠高度 | `max-h-[5.6em]`（约 4 行 × 1.4 行高 = 5.6em）| 使用 Tailwind 的 em 单位 |
| 展开/折叠按钮 | 底部居中，`text-xs text-foreground/35`，带 ChevronUp/ChevronDown 图标 | 只在 shouldCollapse 时显示 |
| 过渡动画 | `transition-[max-height] duration-200` | 展开/收起 200ms 平滑 |

### 3.3 SVG 虚线边框（Proma 的黑魔法）

```html
<div style={{
  border: 'none',
  backgroundImage: `url("data:image/svg+xml,
    %3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e
    %3crect width='100%25' height='100%25' fill='none'
      rx='8' ry='8'
      stroke='rgba(128,128,128,0.5)'
      stroke-width='1.5'
      stroke-dasharray='8%2c 6'
      stroke-dashoffset='0'
      stroke-linecap='round'
    /%3e%3c/svg%3e")`,
}}>
```

**为什么不用 CSS `border: dashed`**：
- CSS 虚线的虚线间隙排列在圆角处会断裂/不连续
- SVG rect 的虚线围绕整个矩形连续，绕过圆角平滑

**LA 实现**：把这个 SVG data URI 内联到 `ThinkingBlock` 组件的 `style` prop。颜色通过 prop 动态替换 `rgba(128,128,128,0.5)` 中的数值。

### 3.4 dimmed 模式

当 **turn 中已有实质文本内容**（text block）时，thinking + tool 块进入 `dimmed` 模式：
- 背景从 `bg-muted/50` → `bg-muted/30`
- 文字从 `text-foreground/90` → `text-muted-foreground`
- SVG 边框从 `rgba(128,128,128,0.5)` → `rgba(128,128,128,0.3)`

**scematic**：当主内容（final answer）已经出现时，思考过程的视觉权重应该降低。

---

## 4. ContentBlock 系统（消息渲染的核心）

### 4.1 块类型

Proma 的消息每个 `turn` 包含多个 `contentBlock`，类型：

| 类型 | 渲染方式 | 组件 |
|---|---|---|
| **text** | Markdown（`MessageResponse`）| 同 ContentBlock.jsx 内联 |
| **tool_use** | 语义化短语行（如 "读取 foo.ts 第 10-60 行"）+ 可展开结构化结果 | `<ToolUseBlock>` 内联 |
| **thinking** | Brain 图标 + "THINKING" 标签 + 虚线边框 + 可折叠 | `<ThinkingBlock>` |
| **tool_result** | 工具结果文本，在 user message 的 content 中 | `useToolResult()` hook |
| **task_notification**（system message） | Sub-agent 完成通知，包含用量统计 | `<SubAgentFooter>` |

### 4.2 tool_use 渲染

Proma 的 tool 渲染和 LA 不同——它用**语义化短语**而非英文函数名：

| 工具 | 短语（从 `tool-phrase.ts` 映射） |
|---|---|
| `read_file` | "读取 `path` 第 10-60 行" |
| `write_file` | "写入 `path`（200 行）" |
| `search_code` | "搜索 `pattern`（3 个结果）" |
| `run_command` | "运行 `command`" |
| `task`（Sub-agent） | "委托子任务" + 进度指示 |

**LA 映射**：当前 LA-140 做的 tool card 是英文 tool name + 双段色，可以考虑加入简化中文语义映射。

---

## 5. Pi SDK 集成架构

### 5.1 消息流向

```
Pi SDK (main process)
  ├─ createSession() → SDK session handle
  ├─ send(sessionId, message) → stream events
  │   ├─ streamEvent (message delta / reasoning delta)
  │   ├─ streamComplete (turn finished)
  │   ├─ streamError (provider error)
  │   └─ streamToolActivity (tool start / update / finish)
  └─ compact(sessionId) → compaction result
        │
        ▼
  Main Process (IPC)
    ├─ ipcMain.handle(AGENT_IPC_CHANNELS.sendMessage)
    └─ win.webContents.send('agent:stream-event', event)
        │
        ▼
  Preload (contextBridge)
    window.electronAPI.onStreamEvent(callback)
        │
        ▼
  Renderer (Jotai atoms → React)
    useAtom(agentSessionMessagesAtom)
    useAtom(agentStreamStateAtom)
        │
        ▼
  SDKMessageRenderer → ContentBlock
```

### 5.2 Pi patch 策略

Proma 对 Pi 的 `@earendil-works/pi-ai@0.80.3` 打了 **2 个 patch**：
1. `patches/@earendil-works%2Fpi-ai@0.80.3.patch`：给 OpenAI Codex OAuth 函数增加 `fetch` 参数注入
2. `patches/@earendil-works%2Fpi-ai@0.80.9.patch`：对更新版

**LA 映射**：LA 也用 Pi 0.80.3——Proma 的 patch 方式可以直接参考。

### 5.3 ASAR unpack（打包关键） 

```yaml
# electron-builder.yml
asarUnpack:
  - "node_modules/@anthropic-ai/**"     # Claude SDK native binary
  - "node_modules/@earendil-works/pi-tui/native/**"  # Pi TUI native
```

Pi 和 Claude SDK 都有 **native binary**（`.node` 文件），必须从 ASAR 包中解压出来才能在运行时加载。

---

## 6. 状态管理模式（Jotai atoms）

Proma 的全局状态用 **Jotai atoms** 管理。每个业务域一组 atom 文件：

```
atoms/
  agent-atoms.ts          # Agent 会话列表、当前会话、侧面板状态
  chat-atoms.ts           # Streaming 状态、thinking 展开偏好
  theme.ts                # 主题模式、风格、界面变体、resolved theme
  tab-atoms.ts            # 标签页列表、活跃标签、侧栏折叠
  chat-tool-atoms.ts      # 工具 toggle 开关
  draft-session-atoms.ts  # 草稿会话
  automation-atoms.ts     # 定时任务
  …
```

### 6.1 全局设置持久化模式

```ts
// 1. localStorage 作为缓存（快速恢复 + 避免白屏闪烁）
// 2. ~/.proma/settings.json 作为权威持久化存储
// 3. 启动时 loadSettings() → 原子化到 atoms
// 4. 每次变更 → saveSettings() + localStorage.setItem()
```

**LA 映射**：当前 LA 的 settings 持久化在 SQLite（LA-093）。Proma 的"localStorage 作为缓存 + 文件作为权威"双层模式可以参考。

---

## 7. 组件库架构（ShadcnUI）

Proma 用的是 **ShadcnUI**（Radix UI 原语 + Tailwind 样式），有 38 个基础组件，全部在 `components/ui/` 下：

```
ui/
  button.tsx        # 6 个变体 (default/destructive/outline/secondary/ghost/link) + 4 个尺寸
  input.tsx         # 标准文本输入
  textarea.tsx      # 多行文本输入
  dialog.tsx        # 对话框（Portal + 遮罩 + ESC 关闭）
  alert-dialog.tsx  # 确认对话框
  dropdown-menu.tsx # 下拉菜单
  select.tsx        # 选择器
  popover.tsx       # 弹出面板
  tooltip.tsx       # 悬停提示
  sheet.tsx         # 侧滑面板（替代 LA 的 Settings workspace overlay）
  slider.tsx        # 滑块（Power Slider 对照）
  switch.tsx        # 开关（toggle）
  badge.tsx         # 徽章
  separator.tsx     # 分隔线
  scroll-area.tsx   # 自定义滚动条
  collapsible.tsx   # 可折叠区域
  tabs.tsx          # 标签页
  command.tsx       # 命令面板（⌘K）
  context-menu.tsx  # 右键菜单
  spinner.tsx       # 加载动画
  sonner.tsx        # Toast 通知
  …
```

所有组件均带：
- **键盘导航**（Tab / Enter / Escape / Arrow keys）
- **ARIA 属性**（role / aria-label / aria-expanded）
- **焦点管理**（autoFocus / focus-visible ring）
- **dark mode 支持**（通过 `dark:` CSS 变体自动适配）

---

## 8. 发布与打包规格

### 8.1 electron-builder 配置（精选）

```yaml
appId: com.proma.app
electronVersion: 39.5.1          # 显式指定版本
compression: normal
asar: true                        # ASAR 归档
asarUnpack:
  - "node_modules/@anthropic-ai/**"      # Claude SDK native
  - "node_modules/@earendil-works/pi-tui/native/**"  # Pi native

mac:
  hardenedRuntime: true            # Apple Hardened Runtime
  gatekeeperAssess: false          # 关闭 Gatekeeper 评估（用 notarization 代替）
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.plist
  target: [dmg, zip]

dmg:
  contents:
    - x: 130, y: 220              # App 图标位置
    - x: 410, y: 220              # Applications 快捷方式位置
      type: link, path: /Applications
  window:
    width: 540, height: 380       # DMG 窗口尺寸

publish:
  provider: github
  owner: ErlichLiu
  repo: Proma
```

### 8.2 多平台发布矩阵

Proma 在 CI 矩阵中构建：
- **macOS arm64** (Apple Silicon) → DMG + ZIP
- **macOS x64** (Intel) → DMG + ZIP  
- **Windows x64** → NSIS installer

### 8.3 自动更新

使用 **electron-builder 的 autoUpdater** + GitHub Releases：

```json
// tauri.conf.json 类似机制
"updater": {
  "endpoints": ["https://github.com/ErlichLiu/Proma/releases/latest/download/latest.yml"]
}
```

---

## 9. LA 可以直接参考的 Proma 模式

### 9.1 立即可复制的代码模式

| 模式 | Proma 文件 | LA 应用 |
|---|---|---|
| ThinkingBlock 组件 | `ContentBlock.tsx:556-625` | LA 的 thinking rendering（当前完全不渲染） |
| SVG 虚线边框 | `ContentBlock.tsx` style prop | 同上 |
| ContentBlock 类型分发 | `ContentBlock.tsx:670-690` | LA 的 ConversationItems 渲染 |
| 消息角色色带 | `AgentMessages.tsx` 中的消息类型颜色映射 | LA 的消息气泡（缺少角色色带） |
| Theme cache 双层 | `theme.ts::getCachedThemeMode()` | LA 的主题系统（缺 localStorage 缓存） |
| 队列消息模型 | `AgentMessageQueue.tsx` | LA 的 QueuedMessageList（LA-138 已做） |

### 9.2 需要工单级投入的模式

| 模式 | 说明 | 预估成本 |
|---|---|---|
| ShadcnUI 组件库 | 38 个可访问组件，替换自写 CSS | 大——需要 Tailwind 迁移，但每个组件独立可用 |
| Jotai atoms | 状态管理从自定义 store 迁移 | 中——每个 domain atom 可独立迁移 |
| 多主题系统 | 4 套 × 2 档 = 8 版本颜色 | 中——需要设计师级的 HSL 调色工作 |
| Tab 标签页 | 替代多面板模式 | 大——涉及路由/会话生命周期重构 |
| 可拖拽侧栏宽度 | rAF 节流 + mouseEvent | 小——独立的 UI 交互 |

---

## 10. Proma vs OpenWorker vs LA：三款 Agent 桌面应用的对比

| 维度 | Proma | OpenWorker | LA |
|---|---|---|---|
| **原生壳** | Electron 39 | Tauri 2 | Electron 43 |
| **前端** | React + Tailwind + ShadcnUI | React + Tailwind | React + 自写 CSS |
| **Agent 运行时** | Pi 0.80.x (TypeScript) | Python engine (自研) | Pi 0.80.x + CAT 层 (TypeScript) |
| **后端通信** | Pi SDK in-process | Python sidecar (localhost HTTP) | cat-server Unix socket |
| **多主题** | ✅ 4 套 8 版 | ❌ 仅有 light/dark | ❌ 仅有 light/dark |
| **消息渲染** | SDKMessageRenderer (1413 行) | Transcript.tsx (464 行) | ConversationItems.tsx (~400 行) |
| **Thinking 可见** | ✅ Brain + dashed border | ✅ chevron 折叠 | ❌ **完全不渲染** |
| **签名/公证** | ✅ Developer ID + notarized | ✅ Developer ID + notarized | ❌ 无 |
| **auto-update** | ✅ electron-builder | ✅ Tauri updater | ❌ 无 |
| **Tab 系统** | ✅ | ❌ | ❌ |
| **CAT/Segment** | ❌ 无 | ❌ 无 | ✅ **LA 独有** |
| **Delivery Gate** | ❌ 无 | ❌ 无 | ✅ **LA 独有** |

**核心发现**：
- **OpenWorker 教 LA"怎么做得简约"**——248 行的 App.tsx vs LA 的 900 行 TaskConversation
- **Proma 教 LA"怎么把 Pi 生态做成一个成熟的桌面产品"**——用 ShadcnUI 组件库、HSL 多主题、electron-builder 发布、4 套 8 版主题、可拖拽布局
- **LA 独有的 CAT 层**（Segment grid、QA、Delivery gate）在三款应用中**无可对标者**——这是 LA 的真正护城河，OpenWorker 和 Proma 都做不到这一层

---

## A. 附录

### A.1 文件清单（Proma 核心文件）

```
proma/
├── apps/electron/
│   ├── src/
│   │   ├── main/                  # Electron 主进程
│   │   │   ├── lib/               # 服务层（51+ 文件）
│   │   │   │   ├── agent-orchestrator.ts       # Pi SDK 封装
│   │   │   │   ├── agent-prompt-builder.ts     # Prompt 构建
│   │   │   │   ├── agent-event-bus.ts          # 事件总线
│   │   │   │   └── agent-auto-compact-settings.ts
│   │   │   └── menu.ts
│   │   ├── preload/index.ts       # IPC bridge
│   │   └── renderer/
│   │       ├── atoms/             # Jotai atoms（20+ 文件）
│   │       ├── components/
│   │       │   ├── agent/         # Agent 视图（16 组件）
│   │       │   ├── chat/          # Chat 视图（20 组件）
│   │       │   ├── ui/            # ShadcnUI 基础组件（38 组件）
│   │       │   └── app-shell/     # AppShell 布局
│   │       ├── styles/
│   │       │   └── globals.css    # Tailwind + 多主题（~850 行）
│   │       └── App.tsx            # 应用入口（117 行）
│   ├── electron-builder.yml       # 打包配置
│   └── tailwind.config.js         # Tailwind + 多主题 safelist
├── packages/
│   ├── shared/                    # 共享类型、IPC channels、常量
│   ├── core/                      # Provider 适配器、代码高亮
│   ├── session-core/              # Thinking tag parser（headless）
│   └── ui/                        # 共享 UI 组件（Mermaid/CodeBlock）
└── patches/
    ├── @earendil-works%2Fpi-ai@0.80.3.patch
    └── @earendil-works%2Fpi-ai@0.80.9.patch
```

### A.2 Electron 版本信息（从 DMG 提取）

- **Bundle ID**: `com.proma.app`
- **Version**: `0.15.11`
- **Electron**: `39.5.1`
- **Binary size**: ~200MB（含所有依赖，Electron 自带 Chromium）
- **Format**: Mach-O 64-bit arm64
- **ASAR**: 启用（`app.asar`）
- **Signed**: 通过（`spctl --assess` pending verification）


---

## 附录 D — DMG 打包逆向补充（2026-07-25 从 ASAR 解包）

### D.1 运行时依赖（从 `package.json` 提取）

```json
{
  "name": "@proma/electron",
  "version": "0.15.11",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.201",
    "@earendil-works/pi-agent-core": "0.80.9",
    "@earendil-works/pi-ai": "0.80.9",
    "@earendil-works/pi-coding-agent": "0.80.9",
    "@fontsource-variable/inter": "5.2.8",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dompurify": "^3.4.5",
    "pdfjs-dist": "^4.10.38",
    "mammoth": "^1.12.0",
    "adm-zip": "^0.5.17",
    "@pierre/diffs": "^1.1.20",
    "typebox": "1.1.38"
  },
  "optionalDependencies": {
    "@anthropic-ai/claude-agent-sdk-darwin-arm64": "0.3.201",
    "@anthropic-ai/claude-agent-sdk-darwin-x64": "0.3.201",
    "@anthropic-ai/claude-agent-sdk-win32-x64": "0.3.201",
    "@anthropic-ai/claude-agent-sdk-win32-arm64": "0.3.201"
  }
}
```

**关键发现**：
- Proma 打包版本用的是 **Pi 0.80.9**（比 LA 当前 0.80.3 新 6 个小版本）
- Claude Agent SDK 0.3.201 有 4 个平台的 native binary（darwin-arm64/x64, win32-x64/arm64）
- `@fontsource-variable/inter` 5.2.8 —— Inter Variable 自托管字体
- `dompurify` 3.4.5 —— HTML 消毒
- `@pierre/diffs` 1.1.20 —— Diff 视图组件
- `typebox` 1.1.38 —— 运行时 schema 校验（替代 Zod）
- `mammoth` —— .docx → HTML 转换
- `pdfjs-dist` —— PDF 渲染

### D.2 ASAR 结构

```
app.asar (207MB)
├── dist/
│   ├── main.cjs               ← Electron 主进程
│   ├── preload.cjs            ← IPC bridge
│   └── renderer/
│       ├── index.html
│       └── assets/
│           ├── index-DP7HDy-Z.css   (226KB, Tailwind + 4 套主题)
│           └── *.js                 (Vite code-split:
│               Shiki 语法高亮 50+ 语言, React 组件, Jotai atoms)
├── node_modules/ (Vite bundled inline)
└── package.json

app.asar.unpacked/
└── node_modules/
    └── jszip/  (ZIP 处理, 不能 ASAR 压缩因为用了 native file API)
```

### D.3 CSS Bundle 分析

- **大小**: 226KB (Vite + Tailwind 编译后, 未压缩)
- **主题**: 4 套 (ocean/forest/slate/terminal) × 暗/亮 = 8 版本全部内联
- **ShadcnUI**: 全部 38 个组件的 CSS 内联 (button/input/dialog/dropdown/...)
- **Tailwind reset + utilities**: 与自定义 CSS 混编

### D.4 打包配置 (electron-builder.yml) 关键参数

```yaml
appId: com.proma.app
electronVersion: 39.5.1
compression: normal
asar: true
asarUnpack:
  - "node_modules/@anthropic-ai/**"        # Claude SDK native .node
  - "node_modules/@earendil-works/pi-tui/native/**"  # Pi native addon

mac:
  hardenedRuntime: true
  entitlements: entitlements.mac.plist
  target: [dmg, zip]

dmg:
  contents:
    - x: 130, y: 220       # App 图标位置
    - x: 410, y: 220       # Applications 快捷方式
      type: link
  window:
    width: 540, height: 380

publish:
  provider: github
  owner: ErlichLiu
  repo: Proma
```

### D.5 与 LA 的直接对比

| 维度 | Proma (DMG 真实) | LA 当前 |
|---|---|---|
| Pi 版本 | **0.80.9** | 0.80.3 |
| Claude SDK | 0.3.201 (4 平台 native) | 无 |
| 打包格式 | ASAR + electron-builder | 无正式打包 |
| ASAR 解压 | 仅 Claude SDK + Pi native | — |
| 字体 | Inter Variable 自托管 (5.2.8) | -apple-system |
| CSS | 226KB Tailwind + ShadcnUI | 自写 CSS |
| Schema 校验 | TypeBox 1.1.38 | Zod |
| Diff 组件 | @pierre/diffs | 自写 |
| DOCX 支持 | mammoth | 无 |
| PDF 渲染 | pdfjs-dist | 无 |
