# Linguist Agent 当前事实

核验日期：2026-08-11（Asia/Shanghai）

本文只记录可由代码、manifest、测试或真实运行输出确认的事实。历史报告不得覆盖本文。

## Git 与基线

- 施工起点：`main@3f53e7b66c10734d88455ad65ded51acc46ab33e`。
- Proma 基线：`v0.17.1@6094036d3f6f4363c44ce8a11155ecd531a80aae`。
- 正式 merge：`96155d1ad2f131e10fd2f0a6998ec13573aa2ead`。
- 最终 main merge：`dd154b0dd75fa78217bd7eb1edda70678d79707b`；push 以 Git 回执为准。

## 版本

| 层 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App / Electron | `0.17.3` / `43.2.0` |
| React / Jotai / Vite | `18.3.1` / `2.20.2` / `6.4.3` |
| Shared | `0.1.95` |
| Agent Runtime | Pi `0.82.1`；不包含 Claude Agent SDK / Nowledge Runtime |
| CAT Core / Formats / Store / Tools | `0.0.21 / 0.0.10 / 0.0.37 / 0.0.34` |
| CAT schema / Tool count | `15` / `31` |

## 当前产品事实

- 产品仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Workbench；没有第二套 Agent、Chat、Session、权限、Planning、Preview 或 Collaboration。
- 每个 CAT 项目有真实 Proma Workspace。Linguist Session 同时绑定 `workspaceId + linguistProjectId`，因此直接继承 Workspace、Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue 和 Collaboration。
- General 可选择性委派 Translator、Reviewer 或 Proofreader。子会话继承同一 Workspace / CAT 项目，并在创建时冻结 Segment 范围；交接通过共享 CAT Store，不复制聊天正文。
- `cat_confirm_segments` 记录 Reviewer / Proofreader 的 `unchanged / corrected / blocked` 决策。Reviewer 必须覆盖冻结范围全部 Segment；101 段跨页覆盖已有回归。
- 术语上下文、QA、写回门禁和 verified export 共用 scope-aware evaluator。只有无冲突、明确适用的 required / forbidden 规则硬拦；数字、换行和普通 token 差异进入 QA。
- 五个最小本地化 Skill 随应用分发；受管 Context 图片沿用 `cat_read_context_doc` 作为 Pi 视觉内容，不新增 OCR 或图片服务。
- 项目 Agent 设置复用 Proma 原生 Skills / Memory UI；阶段覆盖和 QA 阻断层级在 Workbench 可见。
- 原生导入支持多文件或文件夹；Agent / 原生导出均支持 `verified` 与需明确确认的 `as-is`。Renderer 不接收任意路径。
- Prompt 保留单 Builder；Project Digest 暴露 `complete / partial / skipped / truncated`，失败对模型可见，project-data 有数据围栏。

## 验证事实

- 冻结依赖安装与 Electron typecheck 通过；根 `1518/1518`（`6884` assertions）、boundary `4/4`、fusion `9/9` 通过。上一完整 CAT 回归仍为 Electron Linguist `212/212`、CAT Store `230/230`、CAT Tools `42/42` 与许可证门禁通过。
- 上一完整 macOS arm64 packaged vertical（`0.17.2`）：Agent `15 PASS / 0 FAIL`、Chat `19 / 0`、Linguist `21 / 0 / 2 MANUAL`。本次仅改显示元数据的 `0.17.3` 已通过 `smoke:pack` 与产物完整性校验，未冒充重跑完整 vertical。
- 产物与本机 `/Applications/Linguist Agent.app` 均为 `0.17.3`，`app.asar` SHA-256 均为 `4cd09ad7161449ff3f41def2d924ae2afe973427842b9f3fa27c466b980c02b0`；安装后主进程已启动。旧 `0.17.2` 已移入废纸篓，可恢复。
- About 与 Linguist Diagnostics 现显示 Proma `v0.17.1@6094036d` 和正式 merge `96155d1a`；回归测试直接对照 `proma-baseline.json`，防止再次漂移。
- 已在真实用户 Provider 配置下用 `ChatGPT 订阅 (Codex) · GPT-5.6 Sol` 完成一次真实请求，得到精确响应 `REAL_PROVIDER_OK`。这只证明 Provider 请求路径可用，不等于四岗位语言质量验证。
- 启动崩溃 `ERR_PACKAGE_PATH_NOT_EXPORTED` 已从根因修复：主进程不再用 CJS `require()` 加载 ESM-only Pi 包；修复后的同一产物已通过 packaged vertical 并安装。
- SBOM 当前含 430 个第三方生产依赖；机读真源为 `docs/release/sbom-full.json`。

## 仍未取得的证据

- 同模型、同 reasoning 的真实语言任务对照。
- 真实 Provider 驱动代表性格式完成四岗位翻译 → 审校 → 校对 → `verified` 交付。
- 真实 Phrase / memoQ 平台互操作、Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

这些项目保持 pending，不得由单元测试、Fake Model 或 packaged smoke 冒充完成。
