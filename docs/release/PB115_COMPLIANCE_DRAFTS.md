# PB-115 公开发行治理 — 合规材料草案汇总

> **日期**：2026-07-25（实际起草于 2026-07-26）
> **依据**：《Linguist Agent：基于 Proma 的产品重建执行计划》v1.0（2026-07-25），PB-115「公开发行治理」（计划约第 2378–2393 行）
> **性质**：提前起草的文本草案。每一节开头的「草案」标注保留，正式文件（仓库根的 `LICENSE`/`NOTICE`/`ATTRIBUTION`/`SECURITY.md`/`CONTRIBUTING.md`/`THIRD_PARTY_NOTICES`、SBOM 产物等）在 Batch 11 的 PB-115 工单执行时落地。
> **起草方式**：基于 2026-07-26 对仓库 `/Users/<local>/Desktop/linguist-agent-next` 的实地核查（现有许可文件、全部 workspace `package.json`、全仓源码 grep、`docs/attribution/SOURCE_PROVENANCE.md` 登记复核）。

---

## 0. 现状核查结论（草案的事实基础）

- 仓库根已有：`LICENSE`（AGPL-3.0 全文，FSF 原文，未改动）、`NOTICE.md`、`ATTRIBUTION.md`；`README.md` 已链接这三个文件。
- `NOTICE.md` 声明：Linguist Agent Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors；上游 Proma Copyright (C) ErlichLiu and contributors，来源 `https://github.com/proma-ai/Proma`，基线 SHA `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（`docs/architecture/UPSTREAM_BASELINE.md`）。
- 不一致待 PB-115 处理：`README.md` 中 Proma 链接为 `https://github.com/ErlichLiu/Proma`，与 `NOTICE.md`/`ATTRIBUTION.md` 的 `proma-ai/Proma` 不一致（同一项目的不同 remote 路径，需统一）。
- `apps/electron/package.json` 的 `author` 字段仍为 `ErlichLiu <erlichliu@gmail.com>`（上游原样保留），品牌元数据是否调整属 PB-115/PB-113 范畴，草案不改。
- 无 `SECURITY.md`、无 `CONTRIBUTING.md`、无 SBOM、无 `THIRD_PARTY_NOTICES`。
- OpenWorker / openai/codex 复制核查：全仓 grep（排除 `node_modules`）+ `docs/attribution/SOURCE_PROVENANCE.md` 登记复核，**未发现任何从 `andrewyng/openworker` 或 `openai/codex` 复制的代码**（详见第 6 节）。

---

## 1. LICENSE（AGPL-3.0）

**草案——PB-115 工单时落地为正式文件。**

现状：仓库根 `LICENSE` 已是 GNU Affero General Public License v3（2007-11-19 版）完整原文，沿用上游 Proma 的同一许可证文件，未做任何改动。PB-115 时**继续保留该文件原样**，不替换、不增删。

要点（写入发布说明/官网时使用，不贴全文）：

- Linguist Agent 整体（含全部新增代码）以 AGPL-3.0 发布；这是 Proma（AGPL-3.0）衍生作品的义务，也是项目自身的发布选择。
- AGPL-3.0 相对 GPL-3.0 的关键差异是第 13 条：通过网络与软件交互的用户也必须能获得对应源码（见第 4 节 source link）。
- 全文唯一权威来源：仓库根 `LICENSE` 文件；规范文本另见 FSF 官方 <https://www.gnu.org/licenses/agpl-3.0.txt>。
- 新增源文件的许可头建议格式（供 CONTRIBUTING 引用）：

```text
Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors
SPDX-License-Identifier: AGPL-3.0-only
```

- 从上游 Proma 继承的文件：保留原版权头不动；有实质修改的文件在其后追加一行修改版权（见第 5 节 modification statement）。

---

## 2. NOTICE

**草案——PB-115 工单时落地为正式文件。**

现状评估：仓库根 `NOTICE.md` 内容已基本覆盖 PB-115 对 NOTICE 的要求（衍生关系、双方版权、上游来源与基线、第三方复制规则、闭源素材禁令）。PB-115 建议动作是**保留现文并做两处小改**（下方草案为修改后的建议全文，改动点用「← 新增/修改」标出）：

```text
# NOTICE

## Linguist Agent

Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors.

Linguist Agent is a derivative work of **Proma** and is licensed under the
GNU Affero General Public License, version 3 (AGPL-3.0). See `LICENSE`
for the full license text.

Linguist Agent contains modifications to Proma. See `ATTRIBUTION.md` and
the "Modifications" section below for a summary of changes.   ← 新增

This product is not a closed-source commercial product. All new code added
by the Linguist Agent project is released as part of the whole product under
AGPL-3.0.

## Upstream: Proma

- **Proma** — Copyright (C) ErlichLiu and contributors.
- Source: https://github.com/proma-ai/Proma
- License: GNU Affero General Public License, version 3 (AGPL-3.0)
- Upstream baseline pinned in `docs/architecture/UPSTREAM_BASELINE.md`
  (baseline SHA `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`).

The original Proma `LICENSE` file and all upstream copyright notices are
preserved unmodified. Proma copyright and license headers must not be
removed from any upstream file.

## Modifications                                                  ← 新增节

Linguist Agent modifies Proma. A summary of the modification categories
is maintained in `ATTRIBUTION.md`; every modified upstream file keeps the
original copyright header and adds a modification notice.

## Source code                                                    ← 新增节（AGPL §13）

The Corresponding Source of this application is available at:
https://github.com/wangyu-sg/linguist-agent-public

## Third-party code copied into this repository

（保留现文不变：OpenWorker MIT、openai/codex Apache-2.0 的条件性条款，
以及闭源桌面客户端素材禁令，见现 NOTICE.md 第 27–42 行。）
```

---

## 3. ATTRIBUTION（Proma 归属 + 修改声明）

**草案——PB-115 工单时落地为正式文件。**

现状评估：仓库根 `ATTRIBUTION.md` 已列出 Proma（产品底座）、旧 linguist-agent（同作者 CAT 域来源）、OpenWorker 与 openai/codex（仅参考、按需复制）四类来源及各自许可，并含「Not included」负面清单。PB-115 建议**保留现文，在其「Proma (product foundation)」一节末尾追加修改声明小节**：

```text
（追加到 ATTRIBUTION.md 的 Proma 一节）

### Modifications to Proma

Linguist Agent is a modified version of Proma. The main categories of
modification are:

- rebranding and packaging as Linguist Agent (product name, app id, icons,
  build configuration);
- addition of the CAT (computer-aided translation) capability packages
  under `packages/linguist-*` and their Electron integration
  (`apps/electron/src/main/lib/linguist/`, renderer CAT workspace);
- channel/provider, OAuth, and session-management changes maintained as
  in-repo commits on top of the upstream baseline
  (`docs/architecture/UPSTREAM_BASELINE.md`, baseline SHA
  `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`).

Per-file provenance, including every copy/adaptation from the legacy
linguist-agent repository, is registered in
`docs/attribution/SOURCE_PROVENANCE.md`.
```

说明：以上为**类别级**修改声明；逐文件事实以 git 历史（相对基线 SHA 的 diff）与 `SOURCE_PROVENANCE.md` 为准，草案不重复枚举，避免与代码漂移。

---

## 4. Source link 声明（AGPL §13）

**草案——PB-115 工单时落地为正式文件。**

义务：AGPL-3.0 第 13 条要求，通过网络与本软件交互的用户必须能以「无额外条件」的方式获取对应源码（Corresponding Source）。Linguist Agent 是桌面应用，但含网络交互功能（模型调用、更新检查），按从严口径履行。

草案文本（应用内「关于/About」页与设置页展示，发布页同步展示）：

```text
Linguist Agent is free software licensed under the GNU Affero General
Public License, version 3 (AGPL-3.0). It is a derivative work of Proma
(https://github.com/proma-ai/Proma).

The complete Corresponding Source Code of this application is available at:
https://github.com/wangyu-sg/linguist-agent-public
```

落地要求（PB-115 时执行，不在本草案内改动代码）：

- 应用内 About 页放置可点击的 "Source Code" 链接（指向上述公开仓，即 PB-116 的 `wangyu-sg/linguist-agent-public` 候选仓；仓未公开前链接目标以实际公开地址为准）；
- GitHub Release 页每次发布附同版本源码（tag + 源码归档）；
- 链接指向的源码必须与发布构建对应（同 tag/commit）。

---

## 5. Modification statement

**草案——PB-115 工单时落地为正式文件。**

分两层落地：

- **全局声明**：即第 2、3 节写入 `NOTICE.md` / `ATTRIBUTION.md` 的 "Modifications" 文本（衍生关系 + 修改类别 + 基线 SHA）。
- **逐文件声明**（写入 CONTRIBUTING 作为规则，PB-115 时对存量上游修改文件抽查补齐）：
  - 未修改的 Proma 上游文件：保持原版权头，一字不动；
  - 有实质修改的上游文件：保留原版权头，在其后追加：
    ```text
    Modifications Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors.
    ```
  - 全新文件：只挂 Linguist Agent 版权头（格式见第 1 节）。

---

## 6. OpenWorker MIT notice / Codex Apache notice

**草案——PB-115 工单时落地为正式文件。**

**结论：经核查未复制，当前不需要。**

核查过程（2026-07-26）：

- 全仓 grep（排除 `node_modules`）`openworker`：仅命中文档（`NOTICE.md`、`ATTRIBUTION.md`、`docs/attribution/SOURCE_PROVENANCE.md`、`docs/roadmap/*`），`apps/`、`packages/` 源码零命中；
- 全仓 grep `codex`：源码中的命中（如 `apps/electron/src/main/lib/codex-oauth-service.ts`、`pi-codex-*.ts`、`packages/shared/src/types/channel.ts`）经抽查均为 **Proma 上游自带的 OpenAI Codex 渠道/OAuth 支持**（经 `@earendil-works/pi-ai` SDK 内置流程实现），不是从 `openai/codex` 开源仓复制的代码；
- `docs/attribution/SOURCE_PROVENANCE.md` 逐条登记复核：自 PB-001 至今全部登记条目中，**没有任何一条 OpenWorker 或 openai/codex 复制记录**；两个来源在总表中标注为「仅按需 / 按需」参考。

因此 PB-115 时这两个 notice 的处理方式是：

- 不在发布物中附 OpenWorker MIT notice、Codex Apache notice（无复制即无义务）；
- **保留** `NOTICE.md` 与 `SOURCE_PROVENANCE.md` 中已有的条件性条款：未来一旦复制，触发对应义务——OpenWorker（MIT）保留版权头与 MIT 许可全文；openai/codex（Apache-2.0）保留许可证文本与任何 `NOTICE` 内容、每个修改文件加 "Modifications:" 说明、并在 `SOURCE_PROVENANCE.md` 先登记后合入；
- PB-115 执行时按上述同样方法复核一遍（复制窗口可能在本草案之后出现），以工单时点的核查结果为准。

---

## 7. SBOM 草案（直接依赖清单）

**草案——PB-115 工单时落地为正式文件。**

盘点口径：root `package.json` + `packages/*/package.json`（8 个）+ `apps/*/package.json`（cli、electron）中 `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` 的全部条目；`workspace:*` 内部包不计入外部依赖。License 取自各依赖已安装副本（`node_modules/<pkg>/package.json`）的 `license` 字段；未标注或未能确认的写「待查」，不臆测。

- 内部 workspace 包：10 个（`@proma/core`、`@proma/shared`、`@proma/session-core`、`@proma/ui`、`@proma/cli`、`@proma/electron`、`@linguist/cat-core`、`@linguist/cat-formats`、`@linguist/cat-store`、`@linguist/cat-tools`），均 AGPL-3.0（各 package.json 已声明 `AGPL-3.0-only` 或随仓整体）。
- **外部直接依赖合计：117 个**（同一包在多类/多包中出现按一个计）。

License 分布摘要：MIT 为主；Apache-2.0（`@pierre/diffs`、`class-variance-authority`、`pdfjs-dist`、`playwright-core`、`typescript`）；BSD-3-Clause（`highlight.js`）；BSD-2-Clause（`mammoth`）；ISC（`electronmon`、`lucide-react`）；OFL-1.1（`@fontsource-variable/inter`）；双许可 `(MPL-2.0 OR Apache-2.0)`（`dompurify`）、`(MIT OR GPL-3.0-or-later)`（`jszip`，按 MIT 采用，PB-115 时记录选择）；**专有许可（© Anthropic PBC, All rights reserved）**：`@anthropic-ai/claude-agent-sdk` 及其平台包——这是随应用分发的运行时依赖，再分发条款必须在 PB-115 重点复核（见第 8、11 节）。

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

注意事项（草案批注）：

- 上表为**直接依赖**（117 个）；传递依赖在 PB-115 用工具全量展开（见第 8 节）。
- `@types/bun` 的版本范围为 `latest`，不可复现，建议 PB-115 顺手锁版本（属于依赖卫生，非合规阻断项）。
- `optionalDependencies` 中非 darwin-arm64 平台包本机未安装，标「待查」；PB-115 在对应平台或按 registry 元数据补齐。

---

## 8. Dependency license scan 方案

**草案——PB-115 工单时落地为正式文件。**

目标：防止 copyleft/专有/未知许可的传递依赖随发行物流出，并自动生成 third-party notices 数据源。

- **工具**：主用 `license-checker`（Node 生态事实标准，支持 `--json` 导出与 `--failOn` 门禁）；备选/交叉验证用 GitHub `licensee`。SBOM 格式产物用 CycloneDX（`@cyclonedx/cdxgen`，对 bun workspace 支持需 PB-115 时验证；若不可用则以 `license-checker --json` 全量清单作为 SBOM 数据源，按第 7 节表结构落 `docs/release/SBOM.md`）。
- **跑法**：
  1. `bun install --frozen-lockfile` 后跑 `license-checker --production --json > sbom-prod.json`（发行物口径）与全量 `--json > sbom-full.json`；
  2. 门禁：`license-checker --failOn "<黑名单>"`——黑名单建议初值：`GPL-2.0*`、`GPL-3.0*`（`jszip` 双许可按 MIT 采用，用 `--excludePackages` 白名单豁免并注释原因）、`LGPL*`（待评估，初值先拦）、`CC-BY-SA*`、`UNKNOWN`、`UNLICENSED`、`SEE LICENSE*`（专有/自定义，需人工复核）；
  3. 已知需人工复核项写进扫描配置的注释：`@anthropic-ai/claude-agent-sdk*`（专有，Anthropic，再分发条款复核）、`@fontsource-variable/inter`（OFL-1.1 字体，随应用打包时需带 OFL 许可文本与版权声明）、`dompurify`（MPL-2.0 OR Apache-2.0，按 Apache-2.0 采用并记录）、`jszip`（按 MIT 采用并记录）。
- **时机**：
  - PB-115：首次全量扫描（含传递依赖），产出初版 SBOM + THIRD_PARTY_NOTICES；
  - 每次 release（`dist`/发 tag 前）：production 口径扫描 + 门禁，产物随 release 归档；
  - CI（依赖变更 PR）：`bun.lock` 变更的 PR 自动跑门禁扫描，新增 UNKNOWN/黑名单许可即失败；
  - 每次扫描结果与第 7 节直接依赖表对账（直接依赖数变化需人工确认原因）。

---

## 9. SECURITY.md 草案

**草案——PB-115 工单时落地为正式文件。**（仓库根新建 `SECURITY.md`）

```markdown
# Security Policy

## 支持版本

Linguist Agent 处于按票重建早期，仅最新 release 获得安全修复。

| 版本 | 支持状态 |
|---|---|
| 最新 release | ✅ 支持 |
| 更早版本 | ❌ 请升级 |

## 报告漏洞

请**不要**在公开 Issue 中报告安全漏洞。

- 首选：通过 GitHub 私有漏洞报告（Security Advisories → Report a vulnerability）
  提交到本仓库。
- 备用渠道：待补——安全联系邮箱在 PB-115 落地时由产品负责人确认后填入。

我们目标在 7 天内确认收到报告，30 天内给出修复或缓解方案（目标值，
非承诺；PB-115 落地时由产品负责人确认）。

## 范围与说明

- 本项目在本地存储用户的模型 API Key（经 Electron safeStorage 加密）与
  OAuth token；用户数据目录为 `~/.proma/`（开发版 `~/.proma-dev/`）。
  涉及这些凭据/数据的泄露风险属于高优先级。
- 第三方依赖的漏洞请同时向上游报告；我们会在依赖升级窗口内跟进。
```

---

## 10. CONTRIBUTING.md 草案

**草案——PB-115 工单时落地为正式文件。**（仓库根新建 `CONTRIBUTING.md`）

```markdown
# Contributing to Linguist Agent

## 许可

Linguist Agent 以 AGPL-3.0 发布（Proma 衍生作品）。提交贡献即表示你声明
有权提交该贡献，并同意你的贡献按 AGPL-3.0 作为整体产品的一部分发布。
本项目暂无 CLA/DCO（PB-115 落地时由产品负责人确认是否引入）。

## 来源与归属规则（强制）

- 不得删除任何上游 Proma 版权头与许可声明；
- 复制第三方代码前必须先在 `docs/attribution/SOURCE_PROVENANCE.md` 登记
  （来源仓@commit:路径 → 目标路径 → 许可证处置），先登记后合入；
- 复制 MIT/Apache-2.0 代码时保留原版权与许可全文（Apache-2.0 另需保留
  NOTICE 内容并在修改文件头加 "Modifications:" 说明）；
- 禁止引入任何闭源产品（含闭源桌面客户端）的代码、文案、图标、字体、
  文件/chunk/class 命名——见 `docs/attribution/PRIVATE_RESEARCH_POLICY.md`；
- 新文件许可头：`Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors`
  + `SPDX-License-Identifier: AGPL-3.0-only`；修改的上游文件保留原版权头
  并追加 `Modifications Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors.`。

## 开发流程

```bash
bun install --frozen-lockfile
bun run typecheck        # 各包 tsc --noEmit
bun test                 # 单元测试
bun run electron:dev     # 开发模式（数据写入 ~/.proma-dev）
```

- PR 前必须通过 typecheck 与 test；涉及 CAT 包（`packages/linguist-*`）的
  改动需跑对应 `bun run test`（node --test 套件）；
- 改动 `bun.lock` 的 PR 会触发依赖许可扫描门禁；
- 提交信息使用英文，祈使句，说明 why 而不只是 what。
```

（注：草案中提交流程/命令与现 `README.md` 一致；提交信息规范为常见惯例建议，PB-115 落地时可按实际团队约定删改。）

---

## 11. Third-party notices 汇总方式

**草案——PB-115 工单时落地为正式文件。**

汇总产物与生成方式：

- **`THIRD_PARTY_NOTICES.md`（仓库根，随发行物打包）**：由第 8 节的扫描产物自动生成（`license-checker --json` → 脚本渲染为「包名 / 版本 / 许可 / 许可全文或其官方链接」），人工维护以下特例段：
  - `@anthropic-ai/claude-agent-sdk`（专有）：单独小节说明其为 Anthropic 专有组件、按其 Legal Agreements 使用，PB-115 时确认再分发依据；
  - `@fontsource-variable/inter`（OFL-1.1）：附 OFL 许可文本与版权声明（字体随应用打包的硬性要求）；
  - `dompurify`：声明按 Apache-2.0 采用（MPL-2.0 OR Apache-2.0 双许可的选择记录）；
  - `jszip`：声明按 MIT 采用（MIT OR GPL-3.0-or-later 的选择记录）；
  - OpenWorker / openai/codex：按第 6 节结论，当前无复制、无 notice；未来复制后在此追加对应许可文本。
- **SBOM**：`docs/release/SBOM.md`（直接依赖表，第 7 节结构）+ `sbom-prod.json` / `sbom-full.json`（机器可读，随 release 归档）。
- **应用内**：About 页除 source link（第 4 节）外附 "Third-Party Notices" 入口，指向随包 `THIRD_PARTY_NOTICES.md`。
- 每个 release 的 notices 与构建同版本归档，保证「拿到的二进制必有对应 notices」。

---

## 附：本草案未做事项（留给 PB-115 工单）

- 未改动仓库任何已有文件（含 `README.md` 的 Proma 链接不一致、`apps/electron/package.json` 的 author 字段）；
- 未创建 `SECURITY.md` / `CONTRIBUTING.md` / `THIRD_PARTY_NOTICES.md`（文本已在第 9/10/11 节备好）；
- 未跑全量传递依赖扫描（工具与门禁方案见第 8 节）；
- 未在应用内加 source link / notices 入口（属代码改动，PB-115 范围）；
- 专有组件（`@anthropic-ai/claude-agent-sdk`）再分发条款的最终确认。

---

## PB-115 时点复核结论（2026-07-27）

本节为 PB-115 施工时点的复核记录，结论以本次核查为准（草案第 6 节为
2026-07-26 的前一次核查）。

### 1. OpenWorker / openai/codex 复制核查（重跑）

命令与命中数：

- `openworker`（大小写不敏感，全仓，排除 `node_modules`）：9 个文件命中，
  全部为文档（`NOTICE.md`、`ATTRIBUTION.md`、`THIRD_PARTY_NOTICES.md`、
  `docs/attribution/SOURCE_PROVENANCE.md`、`docs/roadmap/*`、
  `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`、本文件）；
  `apps/` + `packages/` 源码（`*.ts/tsx/js/mjs`）命中数 = **0**。
- `openai/codex`（同上口径）：`apps/` + `packages/` 源码命中数 = **0**；
  文档命中均为登记/条款性提及。
- 源码中 `codex` 字样命中（`apps/electron/src`、`packages/shared/src`、
  `packages/core/src`，如 `ChannelForm.tsx`、`codex-plan-quota.ts`、
  `agent-thinking-level.test.ts` 等）均为 Proma 上游自带的 OpenAI Codex
  渠道/plan 支持代码，非 `openai/codex` 开源仓复制物。

**结论：截至 2026-07-27，未从 `andrewyng/openworker` 或 `openai/codex`
复制任何代码，无 MIT/Apache-2.0 notice 义务；`NOTICE.md` 与
`SOURCE_PROVENANCE.md` 中的条件性条款继续保留。**

### 2. `packages/shared/src/utils/context-window.ts:19-39` 来源正当性

该处为 GPT-5.x 上下文窗口**数值常量**（272K/400K/372K）及本仓自写的
`inferCodexAlignedGPT5ContextWindow` 判定函数，注释「ChatGPT Codex 已
验证」标注的是数值的**观察来源**，非代码来源。数值事实（上下文窗口
大小）不受版权保护；函数实现、命名、注释均为本仓自写；不涉及
`PRIVATE_RESEARCH_POLICY` 禁止的客体（反编译文件名、chunk/class 名、
原始闭源文案、品牌资产、解包产物）。**判定：不与
PRIVATE_RESEARCH_POLICY 冲突，可保留。** 建议（非阻断）：公开发行前可
将该注释措辞调整为「公开产品行为观察值」，避免被误读为逆向产物。

### 3. PRIVATE_RESEARCH_POLICY「公开镜像前检查」（Batch 11 必跑项）

- `git grep -n "THREE_APPS_PIXEL_SPEC\|codex-ui-spec-full\|asar-src\|codex-teardown" -- . ':!.gitignore'`：
  有命中，但逐条核实均为**排除规则/政策文本/过程记录**中的字样引用
  （`PRIVATE_RESEARCH_POLICY.md` 自身、`docs/roadmap/*`、
  `docs/release/PUBLIC_MIRROR_PRECHECK.md`、
  `docs/design/LA_DESIGN_TOKENS_DRAFT.md` 的来源声明），仓内不存在
  私人研究资料实体文件。与 `PUBLIC_MIRROR_PRECHECK.md`（第 9/10 项
  「干净」）结论一致。
- `git log --diff-filter=A --name-only --pretty=format: | grep -iE "teardown|asar|pixel.spec|ui-spec-full"`：
  **零命中**（git 历史中从未加入过逆向产物文件）。
- `docs/design/LA_DESIGN_TOKENS_DRAFT.md` 的性质裁决（排除还是 scrub
  后保留）按 `PUBLIC_MIRROR_PRECHECK.md` 记录留给 PB-116。

### 4. 修改声明头抽查（相对基线 `702a8221`）

- 命令：`git diff 702a8221bdeb6f3db7dc514b8e93e2a5a52f68df --name-status -- apps/electron/src packages/shared`
  → 改动文件中 M（修改上游文件）77 个，其余为 A（新增）。
- 抽查方法：按 diff 行数取 top 40 文件逐一查看文件头（含 M 状态的
  `apps/electron/src/preload/index.ts`、`apps/electron/src/main/ipc.ts`
  等），并用 `grep -rl "Copyright"` 全量扫 `apps/electron/src`、
  `packages/shared/src`、`packages/core/src`。
- **事实：全仓源码无任何版权/许可头惯例**——`Copyright` 在源码目录
  零命中；上游 Proma 文件本身也不带版权头（如
  `apps/electron/src/main/index.ts`）；LA 新增文件一律以描述性
  docstring 开头。
- **结论与建议：仓内无既有许可头惯例，按 PB-115 裁决不批量改动**
  （避免 diff 噪音）。全局修改声明已由 `NOTICE.md`「Modifications」节
  与 `ATTRIBUTION.md`「Modifications to Proma」节覆盖，满足 AGPL-3.0
  §5(a) 的显著声明要求。若后续决定补逐文件头：优先给 77 个 M 状态
  上游修改文件追加 `Modifications Copyright (C) 2026 Henry Wang (wangyu-sg)
  and contributors.` 行，新增文件按 `CONTRIBUTING.md` 的许可头格式，
  建议以单独工单执行。
