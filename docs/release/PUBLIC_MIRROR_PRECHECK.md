# 公开镜像清洗预检报告（PUBLIC_MIRROR_PRECHECK）

> **日期**：2026-07-25（扫描实际执行于 2026-07-26；扫描期间工作区有文档新增，已按最终快照复核）
> **依据**：《LA_PROMA_BASED_REBUILD_EXECUTION_PLAN_CN.md》v1.0，PB-116「公开镜像清洗」（计划约第 2395–2431 行）
> **扫描范围**：`/Users/<local>/Desktop/linguist-agent-next` 工作区；HEAD 范围「PB-073 之后」（按预检要求未执行任何 git 命令）；所有 Glob/Grep 均排除 `node_modules` 与 `.git`
> **性质**：**预检草案**。正式清洗、git 追踪状态核验、历史改写与候选分支 `audit/proma-based-candidate-v1` 推送，一律以 PB-116 为准。
> **方法**：只读 Glob/Grep + 截图逐张人工查看 + 密钥模式抽查（只看计数与形态，不读取、不引用任何疑似密钥内容）。本预检未修改任何已有文件，仅新建本报告。

---

## 0. 结论汇总

| # | 排除项 | 结论 |
|---|---|---|
| 1 | `data/**` | ✅ 干净 |
| 2 | `.env*` | ✅ 干净 |
| 3 | keys/tokens/credentials 命名文件 | ✅ 干净 |
| 4 | 客户文件 | ✅ 干净 |
| 5 | 真实项目文本 | ❌ **命中**（截图内含上游作者真实使用痕迹） |
| 6 | 私人评测 | ✅ 干净 |
| 7 | 本机绝对路径 | ❌ **命中** |
| 8 | reverse-engineering docs | ✅ 干净（1 个衍生文档需人工判断） |
| 9 | codex-teardown | ✅ 干净 |
| 10 | asar-src | ✅ 干净 |
| 11 | 原始闭源文案库 | ✅ 干净 |
| 12 | 第三方品牌资产 | ❌ **命中**（另有 4 类子项需人工判断） |
| 13 | raw logs | ✅ 干净 |
| 附 | 硬编码密钥抽查 | ✅ 干净（全部为占位符/测试用例/代码逻辑） |

**命中 3 项，需人工判断 4 类，其余干净。**

---

## 1. `data/**` — ✅ 干净

- `Glob: data/**` 无匹配，仓内无任何 `data/` 目录。

## 2. `.env*` — ✅ 干净

- `Glob: **/.env*` 无匹配。
- `.gitignore:23-28` 已覆盖 `.env`、`.env.local`、`.env.development.local` 等变体，防线在位。

## 3. keys/tokens/credentials 命名文件 — ✅ 干净

按文件名 find（`*key*`/`*token*`/`*credential*`/`*secret*`/`*password*`）命中均为正当代码文件：

- `packages/session-core/src/tokens.ts`（token 估算逻辑）
- `apps/electron/src/main/lib/channel-runtime-api-key.test.ts`（渠道密钥测试）
- `apps/electron/src/main/lib/agent-tool-token-estimator.ts`
- `apps/electron/src/renderer/components/settings/primitives/SettingsSecretInput.tsx`（密钥输入框组件）
- `apps/electron/out/.../@anthropic-ai/sdk/.../credentials.*` 等 —— 依赖包构建产物，`out/` 已被 `.gitignore:5` 覆盖

无任何私钥/证书/凭据存储文件。

## 4. 客户文件 — ✅ 干净

- `tests/linguist-fixtures/` 共 6 个 fixture（`mini_dialogue.csv`、`mini_game_ui.xliff`、`mini_items.json`、`placeholder_cases.xliff`、`sample.mqxliff`、`terminology.csv`），逐一抽查内容均为合成数据：文件头标注 `Linguist Agent synthetic fixture`、`no customer content`，版权字段为虚构主体 `Synth Studios`。
- 全仓无 `.tmx`/`.sdlxliff`/`.docx`/`.xlsx`/`.pdf`/`.po`/`.strings` 等真实项目文档（docx skill 内仅有 Python 脚本与 XSD schema）。

## 5. 真实项目文本 — ❌ 命中（截图）

`docs/assets/screenshots/` 5 张 PNG 逐张查看，均为上游 Proma 作者（Erlich）真实使用环境的截图，非合成演示：

- `proma-chat-demo.png`：侧栏可见真实个人会话标题（如「科幻小说创作需求」「咖啡店五一海报设计」「删除Codex授权」等）与置顶对话。
- `proma-agent-demo.png`：可见真实工作区（Dream / Proma-Dev / Proma-Comm）、会话「季度反馈分析与行动计划」及工作区文件名（`q2-feedback.csv`、`launch-context.md`、`release-note-draft.md`）。
- `proma-mcp-demo.png`、`proma-skills-demo.png`：同一真实环境叠加设置面板。
- `proma-typeless-input.png`：语音输入功能演示，内容较轻但同为 Proma 品牌 UI。

处理建议：**公开前删除这 5 张图，替换为 LA 品牌 + 合成数据的截图**；`README.en.md:66-93` 引用了全部 5 张，需同步改写。

## 6. 私人评测 — ✅ 干净

- 无任何 eval 报告/私人评测数据文件。
- `评测|private.?eval` 仅命中 `docs/roadmap/POST_G7_KICKOFF.md` 与 `docs/migration/CAT_EXTRACTION_MATRIX.md`，且均为对旧仓黑名单模块名（`private_eval` 等）的引用，非评测内容本体。

## 7. 本机绝对路径 — ❌ 命中

`/Users/<local>` 共 64 处，分布 7 个文件（均为施工/治理文档记录，含旧仓路径、冻结 tag、工单过程）：

| 文件 | 处数 |
|---|---|
| `docs/roadmap/execution-ledger.json` | 55 |
| `docs/roadmap/EXECUTION_LEDGER.md` | 3 |
| `docs/roadmap/LEGACY_EXTRACTION_SPEC.md` | 2 |
| `docs/migration/CAT_EXTRACTION_MATRIX.md` | 1 |
| `docs/architecture/DEV_BASELINE_REPORT.md` | 1 |
| `docs/attribution/PRIVATE_RESEARCH_POLICY.md` | 1 |
| `docs/release/PB115_COMPLIANCE_DRAFTS.md` | 1 |

另有**第三方真实用户路径**（更应 scrub）：

- `/Users/<user>/Workspace/Project/Proma/...` 1 处：`apps/electron/src/main/lib/agent-session-manager.ts`（疑为上游贡献者机器路径，出现在源码中）。
- `/Users/<author>/Documents/op7418` 5 处：`apps/electron/default-skills/guizang-ppt-skill/` 的 `SKILL.md`、`references/checklist.md`、`references/layouts-swiss.md`（2 处）、`references/swiss-layout-lock.md`（第三方 skill 作者本机路径）。

合法用途（不计命中）：测试假路径 `/Users/alice/Workspace/project`（`message.test.tsx`）、`/Users/a/b`（`pi-agent-bash.test.ts`）为跨平台路径用例。

处理建议：

- `docs/roadmap/`、`docs/migration/`、`docs/architecture/`、`docs/design/`、`docs/release/` 施工文档群整体**公开前 scrub 或排除**（按任务约定，这些路径属正常施工记录，此处列出待 PB-116 裁决）。
- `agent-session-manager.ts` 与 guizang-ppt-skill 中的真实用户路径**改写为占位符**（如 `/Users/you/...`）。

## 8. reverse-engineering docs — ✅ 干净（1 个衍生文档需人工判断）

- 仓内无逆向工程文档实体；`codex-teardown`/`asar-src`/逆向 字样仅作为**排除规则**出现于 `.gitignore:59-66`、`docs/attribution/PRIVATE_RESEARCH_POLICY.md` 及施工文档的过程记录。
- 需人工判断：`docs/design/LA_DESIGN_TOKENS_DRAFT.md` 自述为私人逆向规格书 `THREE_APPS_PIXEL_SPEC.md`（未入仓，已核实不存在）的**提炼衍生物**，自称「零品牌资产、只含提炼结论」。其性质介于「逆向文档」与「自有设计草案」之间，建议 PB-116 裁决：归入排除，或 scrub 来源标注后保留。

## 9. codex-teardown — ✅ 干净

- 目录不存在；仅 `.gitignore:64` 与政策/施工文档提及该名。

## 10. asar-src — ✅ 干净

- 目录不存在；全仓无 `*.asar` 文件（`.gitignore:65-66` 已预防性覆盖 `asar-src/` 与 `*.asar`）。

## 11. 原始闭源文案库 — ✅ 干净

- `THREE_APPS_PIXEL_SPEC.md`、`codex-ui-spec-full.md` 均核实不存在；无任何闭源应用文案/UI 字符串抽取物。
- 「闭源」字样仅出现于排除政策语境（`.gitignore` 注释、归因与施工文档）。

## 12. 第三方品牌资产 — ❌ 命中（另有子项需人工判断）

**命中：**

- `apps/electron/resources/proma-logos/`：整套 Proma 品牌 Logo 14 个文件（含 `iconTemplate*.png` 及 12 款配色变体）。
- `docs/assets/screenshots/proma-*.png`：5 张 Proma 品牌 UI 截图（同第 5 项）。
- `README.en.md:9`：引用上游作者个人图床海报链接（`img.erlich.fun`）。

**需人工判断：**

- `apps/electron/package.json`：`name` 仍为 `@proma/electron`、`author` 仍为上游作者（`docs/release/PB115_COMPLIANCE_DRAFTS.md` 已记录此不一致，归 PB-115/PB-113 裁决）。
- `proma-thinking/`：2 篇上游作者产品思考文章（`proma-2026-q1-thinking.md`、`proma-2026-q2-q3-thinking.md`），属上游文本转载，保留与否及署名方式待定。
- `apps/electron/default-skills/proma-coach/`：Proma 品牌内置 skill（功能性内容，品牌名残留）。
- `apps/electron/default-skills/guizang-ppt-skill/`：第三方作者（歸藏/op7418）的 PPT skill，附 `LICENSE`；需核查再分发许可并在 `THIRD_PARTY_NOTICES` 登记（PB-115）。
- `README.md`（5 处）/`README.en.md`（28 处）仍以 Proma 品牌叙述，重建品牌未落地；注意 PB-116 同时要求保留 Proma 历史与 attribution，品牌 scrub 与 attribution 保留需分开处理。

处理建议：Logo 与截图**删除/替换为 LA 自有资产**；第三方文本与 skill **许可证核查 + 登记**后决定去留；品牌元数据交 PB-115/PB-113。

## 13. raw logs — ✅ 干净

- `Glob: **/*.log` 无匹配；无 `logs/` 目录；`.gitignore:18-21` 已有 logs 规则。

---

## 附 A. 疑似硬编码密钥抽查 — ✅ 干净

按任务约定只列文件路径与模式，不引用任何匹配内容；逐个人工判定形态：

| 模式 | 命中文件 | 判定 |
|---|---|---|
| `sk-[A-Za-z0-9_-]{16,}`、`sk-ant`、`sk-proj` | `apps/electron/src/main/lib/channel-test-error.test.ts` | 脱敏单测的**占位假串**（配合 `[REDACTED]` 断言） |
| `sk-[A-Za-z0-9_-]{16,}` | `docs/migration/CAT_EXTRACTION_MATRIX.md` | **误报**（`task-aggregate-sqlite-v1` 词内匹配） |
| `ghp_` | `apps/electron/src/renderer/components/settings/McpServerForm.tsx` | UI placeholder **示例**（匹配串总长仅 7 字符，非真实 PAT 形态） |
| `-----BEGIN` | 无 | — |
| `AIza…`/`xox[bap]-`/`AKIA…` | 无 | — |
| `api[_-]?key`、`Bearer ` | 约 50 个源码/测试文件 | 均为渠道认证**代码逻辑**（适配器、表单、脱敏）；赋值形态抽查（`key/token/secret/password = "…"`）仅 3 处测试占位符：`channel-runtime-api-key.test.ts`（2 处）、`bridge-log-redaction.test.ts`（1 处） |
| GitHub Secrets | `.github/workflows/release.yml` | 仅引用 `${{ secrets.* }}` 上下文，无硬编码 |

结论：**未发现真实硬编码密钥**。

## 附 B. 流程性附注

1. **构建产物**：磁盘上存在 `apps/electron/out/`、`apps/electron/dist/`、`apps/electron/resources/bin/proma`（二进制内含 `/Users/` 构建路径字符串），均被 `.gitignore`（第 5、10 行）覆盖。本预检未执行 git，**追踪状态需 PB-116 用 `git status` / `git ls-files` 实际核验**。
2. **工作区在变动**：扫描期间 `docs/design/`、`docs/roadmap/LEGACY_EXTRACTION_SPEC.md`、`docs/release/PB115_COMPLIANCE_DRAFTS.md` 先后出现，本报告已按 2026-07-26 最终快照复核；**PB-116 执行当天应重跑本清单**。
3. **施工文档群**（`docs/roadmap/`、`docs/migration/`、`docs/architecture/`、`docs/design/`、`docs/release/`）含旧仓路径、内部分支/tag 名、工单过程记录，建议整体按「公开前 scrub 或排除」处理，策略由 PB-116 统一裁决。
4. PB-116 合规底线提醒：公开仓必须保留 Proma 历史、AGPL LICENSE 与 attribution（计划 2429 行），清洗时不得以 scrub 为名删除这些义务性内容。
