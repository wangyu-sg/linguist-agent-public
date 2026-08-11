# Linguist Agent 当前实施状态

更新时间：2026-08-11

> `DONE` 表示实现和自动回归完成，不等于语言质量、真机人工或长期日用证据。

| 范围 | 状态 | 当前证据 |
|---|---|---|
| C0 Proma v0.17.1 基线 | DONE | `6094036d` 已由 `96155d1a` 正式 merge；Pi-only、三模式与独立数据根保留。 |
| C1 Workspace 双绑定 | DONE | CAT Project 有真实 Proma Workspace；Session、复制与分叉保持 `workspaceId + linguistProjectId`。 |
| C2 多岗位协作 | DONE | General 可选择性委派 Translator / Reviewer / Proofreader；子会话继承 Workspace / CAT Project 并冻结 Segment 范围。 |
| C3 审校决策 | DONE | `cat_confirm_segments` 记录 unchanged / corrected / blocked；101 段跨页覆盖有回归。 |
| C4 术语与规则分级 | DONE | Core evaluator + Store matcher 为单源；context / QA / write gate / export 共用；数字术语允许，普通数字/换行/token 为 QA。 |
| C5 Skills 与图片 | DONE | 五个 bundled Skill；受管 Context 图片通过既有工具作为 Pi ImageContent。 |
| Workbench 可见性 | DONE | 复用 Proma Skills / Memory UI；阶段覆盖、阻断和 QA 层级可见。 |
| Runtime 打包修复 | DONE | ESM-only Pi 包改为异步加载；修复产物 packaged vertical 全绿并已安装。 |
| VALID-001 | BLOCKED BY REAL SAMPLE | 需同模型、同 reasoning 的真实语言任务对照。 |
| VALID-002 | PARTIAL | 真实 Provider 单次请求已通过；代表性格式四岗位全链和 `verified` 交付仍未执行。 |
| VALID-003 | BLOCKED BY ELAPSED USE | 需从可用构建开始累计 14 个真实日用日。 |

## 自动化与产物

- 当前显示修复：Electron typecheck、根 `1518/1518`（`6884` assertions）、boundary `4/4`、fusion `9/9` 通过；上一完整 CAT 回归为 Electron Linguist `212/212`、CAT Store `230/230`、CAT Tools `42/42` 和 license scan 通过。
- 上一完整 macOS arm64 packaged vertical（`0.17.2`）：Agent `15/15`、Chat `19/19`、Linguist `21/21`，另有 `2 MANUAL`；LF-003 coverage `partial`。`0.17.3` 已通过 `smoke:pack` 与完整性校验。
- 安装版本 `0.17.3`；产物与安装 `app.asar` SHA-256 均为 `4cd09ad7161449ff3f41def2d924ae2afe973427842b9f3fa27c466b980c02b0`。
- SBOM：430 个第三方生产依赖，许可证门禁通过。

## 证据边界

真实 Provider 的 `REAL_PROVIDER_OK` 只证明请求路径可用；自动 smoke 只证明产品合同与产物可运行。真实翻译质量、Phrase / memoQ 互操作、Native Open/Save、IME、VoiceOver、完整键盘和 14 天日用仍保持 pending。
