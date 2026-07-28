/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  // 主题 class 由运行时根据设置拼接到 <html>，Tailwind 无法从 TSX 静态扫描到。
  // 必须 safelist，否则 @layer base 中对应的 CSS 变量块会在构建时被裁掉。
  safelist: [
    'theme-ocean-light',
    'theme-ocean-dark',
    'theme-forest-light',
    'theme-forest-dark',
    'theme-slate-light',
    'theme-slate-dark',
    'theme-terminal-dark',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        dialog: {
          DEFAULT: 'hsl(var(--dialog))',
          foreground: 'hsl(var(--dialog-foreground))',
        },
        tooltip: {
          DEFAULT: 'hsl(var(--tooltip) / <alpha-value>)',
          foreground: 'hsl(var(--tooltip-foreground) / <alpha-value>)',
          muted: 'hsl(var(--tooltip-muted) / <alpha-value>)',
        },
        'content-area': 'hsl(var(--content-area) / <alpha-value>)',
        // ===== LA token additions (PB-100) =====
        // Tier-3 text + status colors, each with a soft surface and a
        // readable foreground on that soft surface. scrim alpha is composed
        // at the call site (e.g. `bg-scrim/50`).
        'foreground-faint': 'hsl(var(--foreground-faint) / <alpha-value>)',
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          soft: 'hsl(var(--success-soft) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          soft: 'hsl(var(--warning-soft) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          soft: 'hsl(var(--info-soft) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
        // review（PB-104）：评审语义状态色（建议待审/已审核/评审会话），对齐三件套结构
        review: {
          DEFAULT: 'hsl(var(--review) / <alpha-value>)',
          soft: 'hsl(var(--review-soft) / <alpha-value>)',
          foreground: 'hsl(var(--review-foreground) / <alpha-value>)',
        },
        scrim: 'hsl(var(--scrim) / <alpha-value>)',
      },
      // ===== 字体栈：Inter Variable 优先，回退 SF Pro Text / 系统中文字体 =====
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'PingFang SC',
          'Segoe UI',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
      },
      // ===== 圆角：覆写 shadcn 标准三档，全部由 --radius 派生 =====
      // 改一处 --radius 即可整站统一调圆角节奏，无需 grep 替换 300+ 处 rounded-*
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        DEFAULT: 'calc(var(--radius) - 2px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + var(--radius-xl-extra, 2px))',
        '2xl': 'calc(var(--radius) + var(--radius-2xl-extra, 4px))',
      },
      // ===== 阴影：覆写 Tailwind 内置的 sm/md/lg/xl/DEFAULT =====
      // 现有 78 处 shadow-md / shadow-lg 等代码无需改动，自动吃多层柔阴影 + 主题自适应
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-xl)',
      },
      // ===== LA semantic type scale (PB-100, LA-original) =====
      // Deliberately overrides Tailwind defaults: this app's de-facto body
      // text is 13px (information-dense desktop UI), so `base` = 13px rather
      // than the stock 16px; xs/sm/lg shift down one step to match. Existing
      // text-xs/sm/base/lg usages pick up the new sizes automatically.
      // heading-* adds a semibold title ramp absent from the Tailwind default.
      fontSize: {
        badge: ['10px', { lineHeight: '15px', fontWeight: '600' }],
        xs: ['11px', { lineHeight: '1.33' }],
        sm: ['12px', { lineHeight: '1.43' }],
        base: ['13px', { lineHeight: '1.5' }],
        lg: ['14px', { lineHeight: '1.56' }],
        'heading-sm': ['16px', { lineHeight: '1.25', fontWeight: '600' }],
        'heading-md': ['18px', { lineHeight: '1.25', fontWeight: '600' }],
        'heading-lg': ['20px', { lineHeight: '1.25', fontWeight: '600' }],
        'heading-xl': ['24px', { lineHeight: '1.25', fontWeight: '600' }],
      },
      // ===== Motion tokens (PB-100): semantic duration/easing via CSS vars =====
      // Stock numeric durations (75/100/150/...) stay available; these add
      // semantic aliases that resolve to the --duration-*/--ease-* variables.
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
      },
      // ===== 布局锚点（PB-102）：h-toolbar / w-sidebar / max-w-markdown-wide 等 =====
      spacing: {
        toolbar: 'var(--toolbar-h)',
        'toolbar-pane': 'var(--toolbar-pane-h)',
        'toolbar-sm': 'var(--toolbar-sm-h)',
        'settings-row': 'var(--settings-row-h)',
      },
      width: {
        sidebar: 'var(--sidebar-w)',
      },
      maxWidth: {
        'markdown-wide': 'var(--markdown-wide)',
      },
      keyframes: {
        'slide-in-from-top': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-out-to-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'preview-slide-out': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(100%)' },
        },
      },
      animation: {
        'in': 'slide-in-from-top 0.3s ease-out',
        'out': 'slide-out-to-right 0.2s ease-in',
        'preview-slide-out': 'preview-slide-out 0.25s ease-out forwards',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
}
