# 2026-09-06 优化实施记录

本记录对应《LA-下一轮实施方案-GPT-5.6-Luna-max-2026-09-06.md》，只记录实际落地与验证结果。

## 范围与提交

- 起始 SHA：`ddc6661cf859ac15a81f598cd075130b70c506b0`。
- 代码实施结束 SHA：`ab3d6ca108e3a99abb3d1690914abf47d361c6ef`。
- 实施代码提交：`feat(linguist): add read-only context and delivery summaries`。
- 发布准备提交：`c4952496`；发布流程修正依次为 `08d3019d`、`a94faaed` 和最终顺序修复 `9b16eb77`。
- 本轮固定 Proma 基线仍为 `v0.19.31`，基线提交 `7a3721d7cfe6e107b58c79e27a43fa463dac21ee`，正式合并提交 `b2c71810d750e55d737942d7c3855da36bc8ad59`。
- 实施阶段 App / Bun / Electron / Pi 为 `0.17.70` / `1.3.14` / `43.2.0` / `0.85.0`；发布准备将 App 提升为 `0.17.71`，CAT Schema 保持 `19`。
- CAT Tools 从 `0.0.38` 升至 `0.0.39`；Linguist Prompt 为 `3.1.4`；五个 Linguist Skill 为 `1.0.2`；`agent-collaboration` 为 `1.2.1`。

## 修改文件

- CAT Tools：`packages/linguist-cat-tools/src/{types,index,reference-tools,proposal-tools,project-tools,qa-tools,stage-tools,intake-tools,tools.nodetest}.ts` 及 `packages/linguist-cat-tools/package.json`、`bun.lock`。
- 主进程：`apps/electron/src/main/lib/linguist/{session-cat-tools,project-delivery,project-service,linguist-prompt-builder}.ts`。
- 定向测试：`apps/electron/src/main/lib/linguist/{evidence-workflow-v1,session-availability}.nodetest.ts`。
- Prompt 与岗位：`resources/linguist-roles/{general,translator,reviewer,proofreader}.md`、`apps/electron/default-skills/{localization-readiness,translator-brief,release-lqa,cultural-lqa,terminology-candidate-mining,agent-collaboration}/SKILL.md`。
- 构建事实：`apps/electron/src/renderer/lib/linguist-build-metadata.ts`。
- 发布流程与元数据：`.github/workflows/release.yml`、`CHANGELOG.md`、`apps/electron/package.json`、`bun.lock`。
- 状态文档：`CURRENT_FACTS_SIMPLE.md`、`docs/DOCS_INDEX.md`、`docs/HANDOFF.md`、`docs/architecture/{UPSTREAM_BASELINE.md,proma-baseline.json}` 以及本记录。
- 未修改 `README.md`、`AGENTS.md`、Proma 核心、CAT Core/Formats/Store/shared、数据库 Schema、Runtime/Provider/权限/Renderer 宿主和无关模块。

## 行为变化

- `cat_get_translation_context` 与 `cat_read_context_doc` 支持显式 `readOnly=true`。只读读取保留真实 Source/Target、规则、分页、参考和图片，跳过 Stage、Context 准备及 Evidence receipt；与 `stageScope` 或 `restartStage=true` 的冲突在任何业务副作用前失败。省略或传 `false` 保持原执行路径。
- `cat_apply_translations` 仅在 `apply` 分支准备 Stage；`proposal` 分支与 `cat_propose_translations` 不创建或替换专业 Stage，并继续使用可信委派范围、revision、locked、结构、事务和幂等校验。
- `cat_project_summary({})` 保持原概览。按绑定项目中的 `assetId` 与 `includeDelivery=true` 才投影现有 delivery preflight 和当前会话匹配的专业任务；该查询不运行持久化 QA、不生成 staging/export 文件、不保存文件，`qaFreshness` 固定为 `not-evaluated`，`verifiedExport` 固定为 `false`。
- 交付预检由 `ProjectDelivery.getDeliveryPreflight` 从原 `prepareDelivery` 连续逻辑抽出并复用；归档项目可读预检，真正导出仍拒绝归档。
- 九项 CAT 工具的关键操作说明和参数说明进入最终模型请求的 `description`/schema；对应重复 `promptGuidelines` 已移除。通用 Prompt、四岗位资源和五个 Linguist Skill 使用方案定稿；既有规则分页协议用于减少同一请求内重复规则，没有新增缓存。

## Touchpoint 账本

- 新增 Touchpoint：`0`。
- 删除 Touchpoint：`0`。
- 本轮只修改已登记的 Linguist CAT、Prompt、岗位/Skill 和事实文档路径；未扩大 `docs/architecture/proma-touchpoints.json`，未改变 Proma 固定基线或 CAT Schema。

## 实际验证

| 命令 | 结果 |
|---|---|
| `bun install --frozen-lockfile` | 通过；锁文件未产生无关变更，检查 1389 installs / 1521 packages。 |
| `bun run --cwd packages/linguist-cat-tools test` | 47 pass / 0 fail。覆盖只读状态链、Proposal 委派范围和窄摘要投影。 |
| `bun run typecheck` | 11 个 workspace 全部通过。 |
| `bun run test` | 377 pass / 0 fail：主集合 255、MCP 1、项目切换 1、协作 4、Store 57、CAT Tools 47、Stage 1、Delivery 3、Evidence 5、Host lifecycle 3。 |
| `node --test tests/linguist-fusion-architecture.test.mjs` | 14 pass / 0 fail。 |
| `bun run check:boundaries` | 4 pass / 0 fail；触点登记无新增/陈旧项。 |
| `node scripts/verify-host-seams.mjs` | `host seams verified: 12`。 |
| `bun test apps/electron/src/main/lib/linguist/linguist-prompt-builder.test.ts tests/linguist-build-metadata.test.ts tests/documentation-contract.test.ts` | 7 pass / 0 fail。 |
| 临时 HOME 下默认 Skill 同步检查 | 1 pass；active/inactive 旧目录均升级到 `1.0.2`，inactive 状态保留；临时测试文件已删除。 |
| `bun run electron:build` | 通过；主进程、Pi/Terminal runtime、preload、renderer、CLI、native helpers、资源和产品身份均完成构建。 |
| `bun run --cwd apps/electron smoke:pack` | 通过；未签名 macOS arm64 packaged artifact 完整性通过。 |
| `PATH=.../apps/electron/node_modules/.bin:$PATH bun run --cwd apps/electron smoke:vertical` | 通过：package、依赖恢复、Agent 19/19、Chat 19/19、项目切换、Linguist 21/21；报告为 `LF-003 PASS` 且 `coverage=partial`。 |
| `jq empty docs/architecture/proma-baseline.json && git diff --check` | 通过。 |

垂直冒烟第一次启动因此前打包步骤已经清空开发依赖而出现 `esbuild: command not found`，第二次先按脚本顺序恢复 `bun install --frozen-lockfile` 后通过；没有修改冒烟脚本。最终证据在 `apps/electron/out/smoke/vertical/vertical-smoke-report.json`，其中原生 Open/Save 对话框保持 `MANUAL/BLOCKED`，未折算为自动通过。

测试中的 Provider 捕获使用真实 Pi Agent → `streamSimple` → 本地 fake HTTP Provider 链和合成资料；它证明工具说明进入最终请求，不证明真实收费 Provider 的自主工具选择或语言质量。

## 未验证与剩余风险

- 未运行真实收费 Provider、真实 Keychain、人工双语/文化/语音质量、IME/VoiceOver、原生 Open/Save 人工操作、目标平台安装/自动更新，也未替换本机安装版。
- `delivery.qaFreshness` 有意保持 `not-evaluated`，`verifiedExport` 有意保持 `false`；只读摘要不等同交付资格或独立审校完成。
- 默认 Skill 升级仍按既有同名 bundled Skill 版本覆盖规则执行；用户自定义同名 Skill 的所有权改造不在本轮。
- 实施阶段（代码收口时）未创建 Tag 或 GitHub Release；随后按用户授权执行在线更新发布流程，不替换本机安装版；最终状态见下方 Release follow-up，未使用 reset credit。

## Release follow-up

- 发布目标：Linguist Agent `0.17.71`，Proma 固定基线仍为 `v0.19.31`；本次只提升 LA 应用版本，不伪造上游版本或改变 CAT Schema。
- 发布方式：提交版本号与 CHANGELOG 后推送 `main`，由现有 GitHub Actions 自动创建 tag、构建在线更新资产并创建 Release；不在本机安装构建产物。
- 最终提交为 `9b16eb77`，已推送到 `origin/main`；远端 `v0.17.71` Tag 指向 `bafb65f61ef80d482d9c7e7630eb82bba713b3e2`。
- GitHub Actions Release run `34011582164` 已完成 macOS arm64/x64、Windows x64 构建、`latest-mac.yml` 合并和公开步骤。
- [Linguist Agent 0.17.71 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.71) 已公开；已核对 `latest-mac.yml`、`latest.yml`、macOS arm64/x64 的 DMG/ZIP 和 Windows x64 EXE 资产，公开资产中无 blockmap。
- 本机安装版未替换；真实收费 Provider、人工语言质量、目标平台安装和实际在线更新消费仍未验证；未使用 reset credit。

## 2026-09-07 CI 证据更正

- Release run `34011582164` 的 package-verify 作业 `101428542096` 与后续 CI `34012237919` 的作业 `101430182998` 均仅输出 Bun 帮助，未执行四条预期脚本。撤回此前将其 success 视为 packaged/vertical 验证完成的结论；平台发布资产与本地验证属于独立证据。
- CI 改为在应用目录执行现有 `smoke:vertical`，清除该入口旧报告后要求本次 HEAD、六步状态和退出码均匹配，再上传报告与步骤日志；人工覆盖仍保持 partial。
- 修复提交 `7c20356d5852730dffaa7b70cd25104e907f4e23` 已推送。真实 CI [34078566618](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34078566618) 的 validate 通过；package-verify 作业 `101609855576` 实际执行后失败。
- 已下载 artifact `packaged-vertical-34078566618-1` 核验：`sourceHead` 匹配修复提交，`workingTreeDirty=false`；六步日志均存在且非空。package、workspace-deps、agent、chat、project-switch 为 passed，linguist-current 为 failed（exitCode=1）；`runStatus=failed`、`coverageStatus=partial`，Native Open/Save 保持 blocked。
- 新暴露失败：Linguist 探针点击原始行上下文时，语言资产浮层拦截指针导致超时。源码中 workspace 模式始终启用浮层，而 SegmentGrid 的让位 spacer 仅在 max-lg 显示，与现象吻合；产品布局修复和复验尚未完成。未使用强制点击或跳过断言。
- 本轮仅修复 CI 入口、报告门禁及证据保存，并更正事实文档；Touchpoint 新增/删除均为 0。本地定向测试 20 项、架构/公开身份 15 项、边界 4 项通过；报告门禁已验证拒绝旧 HEAD、失败和缺失步骤。
- 本次不修改应用版本、不重新发布或替换本机安装版。

## 2026-09-07 Linguist 浮层遮挡修复

- 独立修复提交 `209c2640523a7d5badc02aad11dab172fce22e23` 已推送。修改 `LinguistWorkbenchShell.tsx`，让网格主区域预留底部浮层实际高度；修改 `SegmentGrid.tsx`，删除旧 scroll-padding 和窄屏 spacer。workspace 全宽度生效，page 宽屏仍使用原有流式布局。Touchpoint 新增/删除均为 0，未修改 Proma 基线、CAT Schema 或版本。
- 保留原探针和点击断言。真实 CI [34080231269](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34080231269) 的 validate 与 macOS arm64 package-verify 均通过；后者作业 `101614439559` 实际运行 4 分 55 秒。
- 已下载 artifact `packaged-vertical-34080231269-1`：报告 `sourceHead` 匹配该修复提交，`workingTreeDirty=false`，六步均 passed/exitCode=0，六份日志非空；`runStatus=passed`，`coverageStatus=partial`。报告记录 app.asar SHA-256 为 `93487f22c8274e5bb7f727db093a86a9a083152b2a52d854f643bf757b7cbcbc`，未独立下载应用核对哈希。
- Linguist 日志为 21 PASS / 0 FAIL / 2 MANUAL，已走完项目定位、重启恢复、阶段确认、模型读取与 Proposal、QA 门禁、接受 Proposal、QA waiver、备份恢复与 Worker、导出重导入及最终交付状态恢复。Native Open/Save 仍为人工项；fake Provider 不构成真实语言质量证据。
- 本地 typecheck、9 项定向测试、15 项架构/公开身份检查、4 项边界检查与 diff 检查通过。未替换本机安装版、未发布新版本；该修复不在既有 0.17.71 发布包内。
