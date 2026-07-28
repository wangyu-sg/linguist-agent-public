# SBOM — 依赖清单与许可分布（PB-115）

## 生成方式与本次扫描结果（实测）

- 生成命令：`bun run license:scan`（`scripts/license-scan.mjs`，基于
  license-checker-rseidelsohn 5.0.1；生产依赖闭包，含传递依赖）
- 机器可读全量产物：`docs/release/sbom-full.json`（415 个第三方包，本文件
  不重复列举）
- 扫描日期：2026-07-27
- 扫描口径：root + `packages/*` + `apps/*` 共 12 个 workspace 的
  `dependencies` / `optionalDependencies` / `peerDependencies` 闭包；
  第一方 workspace 包（`@proma/*`、`@linguist/*`，AGPL-3.0 自家）不计入
  第三方统计。
- **第三方依赖总数：415 个**（含传递依赖、含同包多版本）

许可分布 summary（2026-07-27 实测）：

| License | 包数 |
|---|---|
| MIT | 271 |
| Apache-2.0 | 50 |
| ISC | 46 |
| BSD-3-Clause | 25 |
| BSD-2-Clause | 6 |
| BlueOak-1.0.0 | 5 |
| (MIT OR GPL-3.0-or-later) | 1（jszip，按 MIT 采用） |
| (MIT AND Zlib) | 1 |
| EPL-2.0 | 1（elkjs，mermaid 传递依赖，弱 copyleft） |
| Unlicense | 1 |
| (MPL-2.0 OR Apache-2.0) | 1（dompurify，按 Apache-2.0 采用） |
| MIT* / Apache-2.0* / BSD* | 各 1（license-checker 推断标注） |
| Custom（专有） | 2（@anthropic-ai/claude-agent-sdk 及其 darwin-arm64 平台包） |
| 0BSD | 1 |
| OFL-1.1 | 1（@fontsource-variable/inter） |

- 门禁黑名单（GPL-2.0* / GPL-3.0* / LGPL* / SSPL / Commons-Clause / BUSL /
  CC-BY-SA / UNLICENSED / UNKNOWN / Custom）：本次扫描**通过**，无未豁免
  命中；专有 `Custom` 命中为已登记的 `@anthropic-ai/claude-agent-sdk*`
  （豁免依据见 `THIRD_PARTY_NOTICES.md`）。
- 本平台（macOS arm64）未安装的可选平台包（linux/win32/darwin-x64 的
  claude-agent-sdk 平台包、@napi-rs/canvas、@mariozechner/clipboard 平台
  变体）未计入上表，详见扫描输出。

## 直接依赖清单（117 个）

盘点口径：root `package.json` + `packages/*/package.json` + `apps/*/package.json`
中 `dependencies` / `devDependencies` / `peerDependencies` /
`optionalDependencies` 的全部条目；`workspace:*` 内部包不计入外部依赖。
License 取自各依赖已安装副本的 `license` 字段；未标注或未能确认的写「待查」。

- 内部 workspace 包：11 个（`@proma/core`、`@proma/shared`、`@proma/session-core`、
  `@proma/ui`、`@proma/cli`、`@proma/electron`、`@linguist/cat-core`、
  `@linguist/cat-formats`、`@linguist/cat-store`、`@linguist/cat-tools`、
  `@linguist/legacy-migration`），随仓整体以 AGPL-3.0 发布。
- **外部直接依赖合计：117 个**（同一包在多类/多包中出现按一个计）。

| 包 | 声明版本范围 | 已安装版本 | License（声明） | 依赖类型 |
|---|---|---|---|---|
| @anthropic-ai/claude-agent-sdk | >=0.2.123 , 0.3.201 | 0.3.201 | 专有（package.json 写 "SEE LICENSE IN README.md"；LICENSE.md 为 © Anthropic PBC All rights reserved） | peer/dependencies |
| @anthropic-ai/claude-agent-sdk-darwin-arm64 | 0.3.201 | 0.3.201 | 专有（LICENSE.md 同上） | optional |
| @anthropic-ai/claude-agent-sdk-darwin-x64 | 0.3.201 | —（本平台未安装） | 待查 | optional |
| @anthropic-ai/claude-agent-sdk-win32-arm64 | 0.3.201 | —（本平台未安装） | 待查 | optional |
| @anthropic-ai/claude-agent-sdk-win32-x64 | 0.3.201 | —（本平台未安装） | 待查 | optional |
| @anthropic-ai/sdk | >=0.70.0 , ^0.93.0 | 0.93.0 | MIT | peer/dependencies |
| @earendil-works/pi-agent-core | 0.80.9 | 0.80.9 | MIT | dependencies |
| @earendil-works/pi-ai | 0.80.9 | 0.80.9 | MIT | dependencies |
| @earendil-works/pi-coding-agent | 0.80.9 | 0.80.9 | MIT | dev/dependencies |
| @emoji-mart/data | ^1.2.1 | 1.2.1 | MIT | dev |
| @emoji-mart/react | ^1.1.1 | 1.1.1 | MIT | dev |
| @fontsource-variable/inter | 5.2.8 | 5.2.8 | OFL-1.1 | dependencies |
| @larksuiteoapi/node-sdk | ^1.65.0 | 1.65.0 | MIT | dev |
| @modelcontextprotocol/sdk | >=1.0.0 , ^1.29.0 | 1.29.0 | MIT | peer/dependencies |
| @pierre/diffs | ^1.1.20 | 1.1.20 | Apache-2.0 | dependencies |
| @radix-ui/react-alert-dialog | ^1.1.15 | 1.1.15 | MIT | dev |
| @radix-ui/react-collapsible | ^1.1.12 | 1.1.12 | MIT | dev |
| @radix-ui/react-context-menu | ^2.2.16 | 2.2.16 | MIT | dev |
| @radix-ui/react-dialog | ^1.1.15 | 1.1.15 | MIT | dev |
| @radix-ui/react-dropdown-menu | ^2.1.16 | 2.1.16 | MIT | dev |
| @radix-ui/react-label | ^2.1.8 | 2.1.8 | MIT | dev |
| @radix-ui/react-popover | ^1.1.15 | 1.1.15 | MIT | dev |
| @radix-ui/react-scroll-area | ^1.2.10 | 1.2.10 | MIT | dev |
| @radix-ui/react-select | ^2.2.6 | 2.2.6 | MIT | dev |
| @radix-ui/react-separator | ^1.1.8 | 1.1.8 | MIT | dev |
| @radix-ui/react-slider | ^1.3.6 | 1.3.6 | MIT | dev |
| @radix-ui/react-slot | ^1.2.4 | 1.2.4 | MIT | dev |
| @radix-ui/react-switch | ^1.2.6 | 1.2.6 | MIT | dev |
| @radix-ui/react-tabs | ^1.1.13 | 1.1.13 | MIT | dev |
| @radix-ui/react-toast | ^1.2.15 | 1.2.15 | MIT | dev |
| @radix-ui/react-tooltip | ^1.2.8 | 1.2.8 | MIT | dev |
| @react-symbols/icons | ^1.3.1 | 1.3.1 | MIT | dev |
| @tailwindcss/typography | ^0.5.19 | 0.5.19 | MIT | dev |
| @tanstack/react-virtual | 3.14.7 | 3.14.7 | MIT | dependencies |
| @tiptap/core | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-code-block-lowlight | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-link | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-mention | ^3.19.0 | 3.20.0 | MIT | dev |
| @tiptap/extension-placeholder | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-table | 3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-table-cell | 3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-table-header | 3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-table-row | 3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-task-item | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-task-list | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/extension-underline | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/pm | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/react | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/starter-kit | ^3.19.0 | 3.19.0 | MIT | dev |
| @tiptap/suggestion | ^3.19.0 | 3.20.0 | MIT | dev |
| @types/adm-zip | ^0.5.8 | 0.5.8 | MIT | dev |
| @types/bun | latest | 1.3.6 | MIT | dev |
| @types/dompurify | ^3.2.0 | 3.2.0 | MIT | dev |
| @types/markdown-it | ^14.1.2 | 14.1.2 | MIT | dev |
| @types/node | ^20.0.0 | 20.19.30 | MIT | dev |
| @types/pdf-parse | ^1.1.5 | 1.1.5 | MIT | dev |
| @types/pngjs | ^6.0.5 | 6.0.5 | MIT | dev |
| @types/qrcode | ^1.5.6 | 1.5.6 | MIT | dev |
| @types/react | ^18.3.0 | 18.3.27 | MIT | dev |
| @types/react-dom | ^18.3.0 | 18.3.7 | MIT | dev |
| @types/uuid | ^11.0.0 | 11.0.0 | MIT | dev |
| @types/word-extractor | 1.0.6 | 1.0.6 | MIT | dev |
| @vitejs/plugin-react | ^4.3.4 | 4.7.0 | MIT | dev |
| @xmldom/xmldom | ^0.8.11 | 0.8.11 | MIT | dependencies |
| adm-zip | ^0.5.17 | 0.5.17 | MIT | dependencies |
| autoprefixer | ^10.4.20 | 10.4.23 | MIT | dev |
| beautiful-mermaid | 1.1.3 | 1.1.3 | MIT | dependencies |
| chokidar | ^5.0.0 | 5.0.0 | MIT | dev |
| class-variance-authority | 0.7.1 | 0.7.1 | Apache-2.0 | dev |
| clsx | ^2.1.1 | 2.1.1 | MIT | dev |
| cmdk | ^1.1.1 | 1.1.1 | MIT | dev |
| concurrently | ^9.2.1 | 9.2.1 | MIT | dev |
| dingtalk-stream-sdk-nodejs | ^2.0.4 | 2.0.4 | MIT | dev |
| dompurify | ^3.4.2 , ^3.4.5 | 3.4.2 | (MPL-2.0 OR Apache-2.0) | dev/dependencies |
| electron | ^39.5.1 | 39.5.1 | MIT | dev |
| electron-builder | ^25.1.8 | 25.1.8 | MIT | dev |
| electron-updater | ^6.7.3 | 6.7.3 | MIT | dev |
| electronmon | ^2.0.4 | 2.0.4 | ISC | dev |
| esbuild | ^0.24.0 | 0.24.2 | MIT | dev |
| highlight.js | ^11.11.1 | 11.11.1 | BSD-3-Clause | dependencies |
| iconv-lite | ^0.6.3 | 0.6.3 | MIT | dependencies |
| jotai | ^2.17.1 | 2.17.1 | MIT | dependencies |
| jszip | ^3.10.1 | 3.10.1 | (MIT OR GPL-3.0-or-later) | dev |
| katex | ^0.16 | 0.16.33 | MIT | dev |
| lowlight | ^3.3.0 | 3.3.0 | MIT | dev |
| lucide-react | ^0.460.0 | 0.460.0 | ISC | dev |
| mammoth | ^1.12.0 | 1.12.0 | BSD-2-Clause | dependencies |
| markdown-it | ^14.1.0 | 14.1.0 | MIT | dev |
| mermaid | 11.15.0 | 11.15.0 | MIT | dependencies |
| officeparser | 4.2.0 | 4.2.0 | MIT | dev |
| pdf-parse | 1.1.1 | 1.1.1 | MIT | dev |
| pdfjs-dist | ^4.10.38 | 4.10.38 | Apache-2.0 | dependencies |
| playwright-core | 1.62.0 | 1.62.0 | Apache-2.0 | dev |
| pngjs | ^7.0.0 | 7.0.0 | MIT | dev |
| postcss | ^8.4.49 | 8.5.6 | MIT | dev |
| qrcode | ^1.5.4 | 1.5.4 | MIT | dev |
| react | ^18.3.0 , ^18.3.1 | 18.3.1 | MIT | peer/dev |
| react-dom | ^18.3.0 , ^18.3.1 | 18.3.1 | MIT | peer/dev |
| react-markdown | ^10.1.0 | 10.1.0 | MIT | dev |
| rehype-katex | ^7 | 7.0.1 | MIT | dev |
| rehype-raw | ^7.0.0 | 7.0.0 | MIT | dev |
| remark-gfm | ^4.0.1 | 4.0.1 | MIT | dev |
| remark-math | ^6 | 6.0.0 | MIT | dev |
| shiki | ^3.22.0 | 3.22.0 | MIT | dependencies |
| sonner | ^2.0.7 | 2.0.7 | MIT | dev |
| tailwind-merge | ^2.5.5 | 2.6.0 | MIT | dev |
| tailwindcss | ^3.4.17 | 3.4.19 | MIT | dev |
| tailwindcss-animate | ^1.0.7 | 1.0.7 | MIT | dev |
| tiptap-markdown | ^0.9.0 | 0.9.0 | MIT | dev |
| typebox | 1.1.38 | 1.1.38 | MIT | dependencies |
| typescript | ^5.0.0 , ^5 | 5.9.3 | Apache-2.0 | dev/peer |
| undici | ^7.21.0 | 7.21.0 | MIT | dev |
| use-stick-to-bottom | ^1.1.2 | 1.1.2 | MIT | dev |
| vite | ^6.0.3 | 6.4.1 | MIT | dev |
| word-extractor | 1.0.4 | 1.0.4 | MIT | dev |
| ws | 8.19.0 | 8.19.0 | MIT | dev |
| zod | ^4.0.0 | 4.3.6 | MIT | dev |

备注：

- 上表为**直接依赖**（117 个）；传递依赖的全量清单见
  `docs/release/sbom-full.json`（`bun run license:scan` 生成）。
- `license-checker-rseidelsohn` 为 PB-115 新增的根 devDependency（MIT），
  仅作合规工具，不进入发行物，不计入上表。
- `@types/bun` 的版本范围为 `latest`，不可复现，建议后续锁版本（依赖
  卫生，非合规阻断项）。
- `optionalDependencies` 中非 darwin-arm64 平台包本机未安装，标「待查」。
