# OpenWorker — Tauri GUI 桌面端 像素级规格书

> **GitHub**: https://github.com/andrewyng/openworker
> **版本**: v0.1.6, Tauri 2 + React 18 + Tailwind + FastAPI sidecar
> **本文件**: 从统一规格书 PART 1 提取，专注 Tauri GUI（DMG 实际运行的桌面端）

# PART 1 — OpenWorker (Tauri GUI 桌面端)

> **GitHub**：https://github.com/andrewyng/openworker
> **版本**：v0.1.6，Tauri 2 (Rust shell) + React 18 + Tailwind CSS + TypeScript + FastAPI sidecar
> **关键结论**：布局是 `grid 264px + 1fr` 的极简两栏——侧栏折叠/peek 机制代替复杂的多面板。设计 token 仅 25 个 CSS 变量。品牌字体 Manrope 自托管。Composer 将 model/mode/attachment/voice/unattended 全 inline 在一个组件里。Transcript 用 TurnGroup 将多步工具调用折叠为 "N steps" 一个披露组。ThinkingBlock 默认折叠。

---

## 1. 架构概览

```
OpenWorker.app (Tauri 2 Rust shell, ~5MB)
├── React 18 + Vite + Tailwind (surfaces/gui/)
├── FastAPI sidecar (PyInstaller onedir, 17MB)
│   └── localhost HTTP/WS 通信
└── 设计哲学: "单屏即全部" — 侧栏 + 主内容区 + 右侧 Rail
```

### 1.1 Tailwind 设计 token（25 个 CSS 变量，`styles.css` 定义）

#### Light (`:root`)
| Token | 值 | 语义 |
|---|---|---|
| `--paper` | `#f5f6f7` | 页面背景（"reads 'tool', not 'writing app'"） |
| `--panel` | `#ffffff` | 卡片/面板背景 |
| `--ink` | `#17191c` | 主文本 |
| `--muted` | `#5b616b` | 次要文本/元数据 |
| `--faint` | `#9aa1aa` | 极淡文本/placeholder |
| `--line` | `#e8eaed` | 分隔线 |
| `--line-strong` | `#d8dce1` | 强调分隔线 |
| `--accent` | `#2563eb` | 主色调（cobalt——"我们的签名色"） |
| `--accent-soft` | `#e9f0fd` | 强调色浅底 |
| `--ok` | `#2f7d57` | 成功 |
| `--ok-soft` | `#eef6f0` | 成功浅底 |
| `--ok-line` | `#cfe6d6` | 成功边框 |
| `--ok-dot` | `#3f9c5a` | 小状态点绿（比 --ok 更亮） |
| `--warn-ink` | `#b45309` | 警告文本 |
| `--warn-soft` | `#fef3c7` | 警告浅底 |
| `--danger` | `#b91c1c` | 错误/危险 |
| `--danger-soft` | `#f9e7e5` | 错误浅底 |
| `--teal-ink` | `#0f766e` | 连接器批准徽章 |
| `--solid` | `#e9ebf0` | 用户消息气泡背景（"柔和中性填充"） |
| `--on-solid` | `#1f2227` | 用户气泡文本 |
| `--glass` | `rgba(255,255,255,0.9)` | 毛玻璃 bar |
| `--glass-strong` | `rgba(255,255,255,0.96)` | |
| `--glass-soft` | `rgba(255,255,255,0.78)` | |
| `--scrim` | `rgba(29,27,24,0.32)` | 模态/门控遮罩 |
| `--check-a` | `#f0f1f3` | 图像查看器棋盘格 |
| `--check-b` | `#fafbfc` | 图像查看器棋盘格 |

#### Dark (`html[data-theme="dark"]`)
| Token | Dark 值 |
|---|---|
| `--paper` | `#131417` |
| `--panel` | `#1c1e22` |
| `--ink` | `#e6e8eb` |
| `--muted` | `#9aa1ab` |
| `--faint` | `#62686f` |
| `--line` | `#2a2d33` |
| `--line-strong` | `#3a3e46` |
| `--accent` | `#4c8dff`（"抬高了的 cobalt——保持 dark 面板上的对比度"） |
| `--accent-soft` | `#1c2a44` |
| `--ok` | `#58b07f` |
| `--solid` | `#2e3138` |
| `--scrim` | `rgba(0,0,0,0.5)` |

#### 品牌字体（自托管 Manrope woff2）
```css
@font-face {
  font-family: "Manrope";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("./fonts/manrope-700.woff2") format("woff2");
}
.brand-wordmark {
  font-family: "Manrope", -apple-system, system-ui, sans-serif;
  font-weight: 700;
  letter-spacing: -0.015em;   /* 品牌字间距 */
  white-space: nowrap;
}
```

#### 系统字体栈
```css
--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
--mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
--serif: var(--sans);  /* 标题已从 Palatino 衬线改为无衬线——"less editorial, more product" */
```

#### Tailwind 集成（`tailwind.config.js`）
```js
const tok = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${name})`
    : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

colors: {
  paper: tok("--paper"), panel: tok("--panel"), ink: tok("--ink"),
  muted: tok("--muted"), faint: tok("--faint"), line: tok("--line"),
  lineStrong: tok("--line-strong"), accent: tok("--accent"),
  accentSoft: tok("--accent-soft"), ok: tok("--ok"), okSoft: tok("--ok-soft"),
  danger: tok("--danger"), dangerSoft: tok("--danger-soft"),
  solid: tok("--solid"), onSolid: tok("--on-solid"),
  scrim: tok("--scrim"),
}
```

---

## 2. 全局布局

### 2.1 CSS Grid 主框架

```css
.app {
  display: grid;
  grid-template-columns: 264px 1fr;       /* 侧栏固定 264px + 主内容 flex */
  grid-template-rows: minmax(0, 1fr);      /* 填充视口高度 */
}
body {
  font-family: var(--sans);
  color: var(--ink);
  background: var(--paper);
  -webkit-font-smoothing: antialiased;
}
```

### 2.2 反白屏（Anti-flash）

```html
<!-- index.html <head> 内联，CSS 第一次 paint 前执行 -->
<script>
  try {
    var t = localStorage.getItem("openwork-theme");
    var dark = t === "dark" || (t !== "light"
      && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
</script>
```

### 2.3 导航侧栏（Sidebar.tsx, 1378 行）

```
┌────────────────────┐
│ OpenWorker (品牌词) │  ← Manrope 700, -0.015em
│ ┌────────────────┐ │
│ │ 🔷 Coworker    │ │  ← surface accordion
│ │ 💬 Chat        │ │     LiveDot (working/sleeping/idle)
│ │ 💻 Code        │ │     AttnBadge (计数圆形)
│ │ … personas     │ │     UnseenBadge (scheduled runs)
│ └────────────────┘ │
│ ─────────────────  │
│ Recent Sessions    │
│ ├─ session 1       │
│ ├─ session 2       │
│ └─ …               │
│ ─────────────────  │
│ Footer             │
│ ├─ ⚙ Settings      │
│ ├─ 📅 Scheduled    │
│ ├─ 🔌 Integrations │
│ ├─ 📋 Audit        │
│ └─ 📥 Inbox        │
└────────────────────┘

折叠: nav-collapsed 状态下侧栏不可见，鼠标移到左边缘触发 nav-hover-zone → nav-peek 浮层
快捷键: ⌘B 切换折叠
Badge: 10px 字号, 600 字重, rounded-full, px-1.5, leading-[15px], bg-faint/30
LiveDot: w-1.5 h-1.5 rounded-full bg-accent animate-pulse (工作中)
```

### 2.4 主内容区（App.tsx, 1715 行）

```
┌──────────────────────────────────────────┐
│ Top Bar (标题 + 模型信息 + 工作区路径)      │
├──────────────────────────────────────────┤
│                                          │
│  surface = "session"                     │
│  ┌────────────────────────────────────┐  │
│  │ SessionIntro (欢迎卡片)             │  │
│  │ Transcript (对话流)                 │  │
│  │ Composer (输入区)                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  surface = "scheduled" → ScheduledView   │
│  surface = "integrations" → IntegrationsView │
│  surface = "audit" → AuditView           │
│  surface = "inbox" → InboxView           │
│  surface = "settings" → SettingsView     │
│  surface = "persona" → PersonaView       │
│                                          │
│  RightRail (可选, 右侧面板)               │
│  └─ Access Section (文件夹 + 连接器)      │
│  └─ Artifacts List                       │
│  └─ TodoPanel                            │
└──────────────────────────────────────────┘
```

### 2.5 右侧面板（RightRail.tsx, 579 行）

```
RightRail:
  - AccessSection: 文件夹授权 + 连接器面板
  - TodoPanel: 模型输出的 Todo List
  - Artifact View: 文件内容预览（宽模式: min(62vw, 960px)）

打开/关闭: 点击 Artifacts 按钮或 ⌘R
宽度: 默认 ~332px 侧栏 + 可切换到 artifact-rail-w (62vw/960px)
```

---

## 3. 对话渲染系统

### 3.1 消息类型（types.ts）

```ts
type Item =
  | { kind: "user"; text: string; }
  | { kind: "assistant"; text: string; reasoning?: string; thinking?: string; }
  | { kind: "tool"; name: string; args: object; result?: string; status?: string; }
  | { kind: "approval"; name: string; args: object; reason: string; outcome: string; };
```

### 3.2 Transcript 组件（464 行）

```
Transcript → 遍历 items[]
  ├─ 用户消息: 右侧气泡, bg=--solid, text=--on-solid
  ├─ assistant 消息: 左侧, 普通文本 + 可选 Markdown
  │    └─ ThinkingBlock (如果有 reasoning 文本)
  └─ TurnGroup: 折叠组
       ├─ 标题: "N steps" 或 narration text
       ├─ 展开后: 每步一行 tool phrase
       └─ final assistant text 在组外独立渲染
```

### 3.3 ThinkingBlock 组件

```tsx
// Transcript.tsx:56-85, 完整 30 行组件
function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);  // 默认折叠
  return (
    <div className="thinking">
      <button className="thinking-head"
        onClick={() => setOpen(v => !v)}
        data-testid="thinking-toggle">
        <Icon name="chevronDown" size={12}
          className={"thinking-caret" + (open ? " open" : "")} />
        <span className={live ? "thinking-live" : undefined}>
          {live ? "Thinking…" : "Thought process"}
        </span>
      </button>
      {open && (
        <div className="thinking-body" data-testid="thinking-body">
          {text}
        </div>
      )}
    </div>
  );
}
```

**状态语义**：
- `live=true`: 正在流式接收 reasoning delta → 标签显示 "Thinking…" + 可能的 pulsing 动画
- `live=false`: 思考完成 → 标签显示 "Thought process"
- 默认折叠（`open` 初始 false），用户点击展开
- chevron 图标旋转表示展开状态

### 3.4 TurnGroup 折叠逻辑

```
TurnGroup: 将同一个 turn 内的全部活动折叠为一组

buildRows() 逻辑:
  - assistant text → narr row
  - tool 调用 → step row
  - approval → 配到同名的 tool row 上 (chip)
  - 没有对应 tool 的 approval → 单独的 "Wanted to …" ask row

渲染:
  - 折叠时: "N steps" + 首条 narration 摘要
  - 展开时: 每步一行 + 可展开的 tool details
  - final assistant 文本在组外独立渲染 (气泡形式)
```

---

## 4. Composer 输入区（665 行）

### 4.1 完整结构

```
┌─────────────────────────────────────────────────────┐
│ [Model picker ▼]  [Mode picker ▼]  [Unattended ◎]  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Ask the coder…                              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│ [📎 Attach]  [🎤 Voice]           [Send →] [Stop ■]│
└─────────────────────────────────────────────────────┘
```

### 4.2 权限模式选项

```ts
const PERMISSION_OPTIONS = [
  { value: "discuss", label: "Discuss",
    description: "Chat and explore — no edits or commands" },
  { value: "interactive", label: "Ask for approval",
    description: "Ask before edits and commands" },
  { value: "auto", label: "Full access",
    description: "Run everything without asking" },
];
// Plan + Custom 当前版本隐藏（owner ask 2026-07-22）
// Server 仍支持两者，picker 不显示
```

### 4.3 模型选择器

```
- 模型列表从 server 获取（无 hardcoded fallback）
- 冷启动显示 "Loading models…" disabled chip
- 模型 ID 去掉 provider 前缀显示（anthropic:claude-opus-4-8 → claude-opus-4-8）
- 完整 ID 在 hover tooltip 中显示
- 会话有历史后模型固定（不可切换），仅新会话可选

模型选择器集成在 mode 菜单旁边，一个组件解决
```

### 4.4 Unattended 模式

```
- Toggle 开关
- 开启后 agent 将审批请求发送到 Inbox 而非弹 modal
- 适合后台运行的自动化任务
```

### 4.5 附件系统

```ts
// 附件去重: name + payload size 作为 key
const attKey = (a: Attachment) =>
  a.kind === "text"
    ? `t:${a.name}:${a.text?.length ?? 0}`
    : `${a.kind[0]}:${a.name}:${a.data_url?.length ?? 0}`;

// 最多 8 个附件
const mergeAttachments = (cur, add) =>
  [...cur, ...add.filter(a => !seen.has(attKey(a)))].slice(0, 8);
```

### 4.6 Prefill 机制

```
- 外部组件可通过 prefill prop 向 Composer 注入文本+附件
- nonce 机制确保重复 prefill 可以再次生效
- resetKey 在切换会话时清除草稿
```

---

## 5. ApprovalCard 审批组件

```
┌──────────────────────────────────────┐
│  Permission required                 │
│  tool: bash                          │
│  args: command="rm -rf /"            │
│  reason: needs to clean up           │
│                                      │
│  [Approve once] [Always tool]        │
│  [Deny]         [Always cmd]         │
└──────────────────────────────────────┘
```

4 个决策按钮 + 键盘快捷键 `y/n/a/c`。

---

## 6. Inbox 系统

```
Inbox: 跨 sessions 的待审批项队列

状态:
  - pending: 等待用户响应
  - resolved: 已处理

可见性:
  - VIS_INBOX: 仅在 Inbox 页面显示（unattended sessions）
  - VIS_INLINE: 在原 session 内内联显示

Session 恢复时: reconcile_on_resume → 重新加载待处理项
孤儿清理: 已删除 session 的 pending item 自动 resolve
```

---

## 7. 字体系统

| 用途 | 字体 | 字重 | 特性 |
|---|---|---|---|
| 品牌词 | Manrope（自托管 woff2） | 700 | `letter-spacing: -0.015em` |
| 正文字体 | `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif` | 400 | |
| 等宽字体 | `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` | 400 | |
| Badge/徽章 | 继承 | 600 | `text-[10px] leading-[15px] rounded-full` |

---

## 8. DMG 打包流水线（5 步）

```
1. PyInstaller: Python → openworker-server (onedir: exe + _internal/)
2. Sign sidecar: codesign 每个 .so/.dylib file, --options runtime --timestamp
3. Tauri build: Rust shell + React webview + sidecar resources → OpenWorker.app
4. hdiutil: 压缩 DMG (UDZO, zlib-level=9), Finder AppleScript 样式化窗口
5. Notarize: xcrun notarytool submit → stapler staple → spctl verify

关键决策:
  - Onedir 而非 onefile: onefile 自解压 6-7s, onedir 直接加载 <0.5s
  - cp -RL 展开 Python.framework symlink (避免 notarization 3 次 reject)
  - rm -rf Python.framework (禁止 .framework 路径在 resources 内)
  - DMG 窗口: 640×423, 图标 96px, 位置 (172,190) (468,190)
  - 签名: Developer ID Application: rohit prasad (4D4TN54F7T)
  - Hardened runtime + notarized + stapled + Gatekeeper accepted
  - 自动更新: Tauri updater plugin


