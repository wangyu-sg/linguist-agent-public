# 维护周期验证记录

日期：2026-09-04。目标 App：0.17.70；状态：发布准备，尚未发布，真实 Provider 门禁未完成。

本报告是本次运行快照，不是第二份当前事实或 Touchpoint 清单。动态入口见 [CURRENT_FACTS_SIMPLE.md](../../CURRENT_FACTS_SIMPLE.md)。

## 实现边界

- 起点 `82735517`；固定 Proma `v0.19.26@bbf577a8eb768225fdf1ac49ab9ef07a11413b24` 未变。
- CAT Schema 保持 19；CAT 工具实际为 32，起点已是 32，方案写成 31 属漏记。本轮没有修改 `packages/` 或 `resources/linguist-roles/`。
- 最终 ledger：222 product-fork、49 temporary-deviation、8 host-seam、2 generated；总计 281。产品差异减少不等于删除安全措施；通用实现只有取得固定上游等价证据后才退役。
- App 版本、锁文件 workspace 版本和产品基线准备递增；Proma、Pi、CAT 包版本、Schema、数据根、App ID、更新源均未改。

## 分工作流记录

### A1 — `2f3b598e`

- 修改文件：下列 7 个文件。
- Touchpoint：删除 pi-mcp-tools.ts 产品触点 1 项。
- 行为变化：完整采用固定 Proma MCP 桥接，补齐 64 项失败缓存与最旧淘汰。
- 运行验证：同固定基线逐字 diff；真实 HTTP MCP 失败、冷却、淘汰、恢复及关闭；类型和边界。
- 尚存风险：只归还已确认等价或更优的文件。

<details>
<summary>精确修改文件</summary>

- `CHANGELOG.md`
- `apps/electron/src/main/lib/adapters/pi-mcp-tools.ts`
- `docs/HANDOFF.md`
- `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`
- `docs/architecture/proma-sync-policy.json`
- `docs/architecture/proma-touchpoints.json`
- `tests/pi-mcp-cooldown.test.ts`

</details>

### A2 — `4365d7af`

- 修改文件：下列 6 个文件。
- Touchpoint：51 项 product-fork 改为 temporary-deviation；未删除运行实现。
- 行为变化：通用差异明确本地来源及固定上游等价后退役条件；准备独立补丁。
- 运行验证：逐文件比较 LA / 固定上游及调用合同；上游补丁 apply --cached --check；boundary / Host Seam / replay。
- 尚存风险：上游补丁尚未对外提交，不能称已被上游接收。

<details>
<summary>精确修改文件</summary>

- `CHANGELOG.md`
- `docs/HANDOFF.md`
- `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`
- `docs/architecture/proma-sync-policy.json`
- `docs/architecture/proma-touchpoints.json`
- `docs/architecture/upstream-native-security.patch`

</details>

### D — `aa5290da`

- 修改文件：下列 10 个文件。
- Touchpoint：无增删。
- 行为变化：权威刷新、无主会话创建、代际竞态丢弃、设置成功落盘后统一可见状态。
- 运行验证：Jotai 真 Store 回归；实际窗口快捷切换、权威列表、无会话创建、活动 Tab、中央内容与持久化 Workspace。
- 尚存风险：延迟与失败由 Store 注入验证；窗口探针未制造真实网络故障。

<details>
<summary>精确修改文件</summary>

- `CHANGELOG.md`
- `apps/electron/src/renderer/hooks/useProjectActions.ts`
- `apps/electron/src/renderer/host/app-mode-registry.ts`
- `apps/electron/src/renderer/host/project-switch.test.ts`
- `apps/electron/src/renderer/host/project-switch.ts`
- `apps/electron/src/renderer/lib/agent-session-list.test.ts`
- `apps/electron/src/renderer/lib/agent-session-list.ts`
- `docs/HANDOFF.md`
- `docs/architecture/proma-touchpoints.json`
- `package.json`

</details>

### B — `e047c71b`

- 修改文件：下列 78 个文件。
- Touchpoint：新增 44 项身份产品触点；4 项已有临时偏差因产品身份改为 product-fork。
- 行为变化：统一启动、加载、引导、三模式、FAQ、截图和用户可见文案。
- 运行验证：身份合同、构建资源校验、隔离应用欢迎页与首章截图、目录包完整性。
- 尚存风险：无登录钥匙串的临时 HOME 曾出现 Keychain 阻塞；无凭据 smoke 不证明密钥存储。

<details>
<summary>精确修改文件</summary>

- `CHANGELOG.md`
- `apps/electron/package.json`
- `apps/electron/resources/startup-splash/index.html`
- `apps/electron/resources/startup-splash/linguist-mark-white.svg`
- `apps/electron/resources/startup-splash/proma-mark-white.svg`
- `apps/electron/src/main/index.ts`
- `apps/electron/src/main/lib/adapters/pi-builtin-tools.ts`
- `apps/electron/src/main/lib/agent-error-utils.ts`
- `apps/electron/src/main/lib/agent-orchestrator.ts`
- `apps/electron/src/main/lib/agent-service.ts`
- `apps/electron/src/main/lib/channel-manager.ts`
- `apps/electron/src/main/lib/feishu-message.ts`
- `apps/electron/src/main/lib/text-output-service.ts`
- `apps/electron/src/main/lib/voice-dictation-output-result.ts`
- `apps/electron/src/main/lib/workspace-memory-window.ts`
- `apps/electron/src/main/tray.ts`
- `apps/electron/src/renderer/App.tsx`
- `apps/electron/src/renderer/assets/onboarding/guide-agent-example.png`
- `apps/electron/src/renderer/assets/onboarding/guide-automation-calendar.png`
- `apps/electron/src/renderer/assets/onboarding/guide-automation-daily-code-quality.png`
- `apps/electron/src/renderer/assets/onboarding/guide-automation-yesterday-commit-review.png`
- `apps/electron/src/renderer/assets/onboarding/guide-automation.png`
- `apps/electron/src/renderer/assets/onboarding/guide-chat-example.png`
- `apps/electron/src/renderer/assets/onboarding/guide-linguist.png`
- `apps/electron/src/renderer/assets/onboarding/guide-memory-generate.png`
- `apps/electron/src/renderer/assets/onboarding/guide-memory.png`
- `apps/electron/src/renderer/assets/onboarding/guide-project-files-example.png`
- `apps/electron/src/renderer/assets/onboarding/guide-session-files-example.png`
- `apps/electron/src/renderer/assets/onboarding/guide-side-answer.png`
- `apps/electron/src/renderer/assets/onboarding/guide-subagent-delegation.png`
- `apps/electron/src/renderer/assets/onboarding/guide-subagent-summary.png`
- `apps/electron/src/renderer/assets/onboarding/guide-subagent-workspace.png`
- `apps/electron/src/renderer/assets/onboarding/guide-subagent.png`
- `apps/electron/src/renderer/assets/onboarding/guide-visual.png`
- `apps/electron/src/renderer/assets/onboarding/linguist-mark-white.svg`
- `apps/electron/src/renderer/assets/onboarding/proma-mark-white.svg`
- `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`
- `apps/electron/src/renderer/components/agent-skills/BuiltinMcpDetailSheet.tsx`
- `apps/electron/src/renderer/components/agent-skills/CredentialDialog.tsx`
- `apps/electron/src/renderer/components/agent-skills/WorkspaceMemoryTab.tsx`
- `apps/electron/src/renderer/components/agent-skills/WorkspaceMemoryWindowApp.tsx`
- `apps/electron/src/renderer/components/agent-skills/integration-catalog.ts`
- `apps/electron/src/renderer/components/agent-skills/workspaceMemoryInitPrompt.ts`
- `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- `apps/electron/src/renderer/components/app-shell/SearchDialog.tsx`
- `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`
- `apps/electron/src/renderer/components/automation/AutomationsListView.tsx`
- `apps/electron/src/renderer/components/browser/BrowserPanel.tsx`
- `apps/electron/src/renderer/components/environment/EnvironmentCheckDialog.tsx`
- `apps/electron/src/renderer/components/obsidian/obsidian-brand.tsx`
- `apps/electron/src/renderer/components/onboarding/AutomationGuideExamples.tsx`
- `apps/electron/src/renderer/components/onboarding/FileGuideExamples.tsx`
- `apps/electron/src/renderer/components/onboarding/MemoryGuideExamples.tsx`
- `apps/electron/src/renderer/components/onboarding/OnboardingView.tsx`
- `apps/electron/src/renderer/components/onboarding/SubagentGuideExamples.tsx`
- `apps/electron/src/renderer/components/onboarding/faq-content.ts`
- `apps/electron/src/renderer/components/planning/PlanningNativeSyncControl.tsx`
- `apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- `apps/electron/src/renderer/components/settings/DingTalkSettings.tsx`
- `apps/electron/src/renderer/components/settings/FeishuSettings.tsx`
- `apps/electron/src/renderer/components/settings/GeneralSettings.tsx`
- `apps/electron/src/renderer/components/settings/OnboardingSettings.tsx`
- `apps/electron/src/renderer/components/settings/PromaLogoSettings.tsx`
- `apps/electron/src/renderer/components/settings/SettingsPanel.tsx`
- `apps/electron/src/renderer/components/settings/VisionRelaySettings.tsx`
- `apps/electron/src/renderer/components/settings/VoiceInputSettings.tsx`
- `apps/electron/src/renderer/components/settings/WeChatSettings.tsx`
- `apps/electron/src/renderer/components/vault/VaultView.tsx`
- `apps/electron/src/renderer/host/linguist-extension.tsx`
- `config/la-electron-overlay.json`
- `config/product-identity.json`
- `docs/HANDOFF.md`
- `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`
- `docs/architecture/proma-touchpoints.json`
- `package.json`
- `scripts/verify-product-identity.mjs`
- `tests/product-identity-contract.test.ts`

</details>

### C — `4fdd0191`

- 修改文件：下列 14 个文件。
- Touchpoint：无增删。
- 行为变化：当前事实单一入口；纠正岗位锁定、发布定位与工具数量；稳定文档去除重复动态记账。
- 运行验证：文档合同对照 manifest、基线、Schema、工具常量；公开 Release 元数据只读核实。
- 尚存风险：公开产物存在不等于本机安装或自动更新验证。

<details>
<summary>精确修改文件</summary>

- `AGENTS.md`
- `CHANGELOG.md`
- `CURRENT_FACTS_SIMPLE.md`
- `README.en.md`
- `README.md`
- `TODO.md`
- `docs/DOCS_INDEX.md`
- `docs/DOCUMENTATION_MAINTENANCE.md`
- `docs/HANDOFF.md`
- `docs/release/KNOWN_LIMITATIONS.md`
- `docs/roadmap/LINGUIST_FUSION_CURRENT_REALITY.md`
- `docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md`
- `package.json`
- `tests/documentation-contract.test.ts`

</details>

### B 补修 — `0e6e8fb6`

- 修改文件：下列 2 个文件。
- Touchpoint：无增删。
- 行为变化：复制的飞书配置提示使用 LA 产品身份。
- 运行验证：定点身份合同。
- 尚存风险：未连接真实飞书账户。

<details>
<summary>精确修改文件</summary>

- `apps/electron/src/renderer/components/settings/FeishuSettings.tsx`
- `scripts/verify-product-identity.mjs`

</details>

### C 补修 — `71a54035`

- 修改文件：下列 1 个文件。
- Touchpoint：无增删。
- 行为变化：工程说明与原生绑定 Agent Tab + 右侧 CAT 实现一致。
- 运行验证：读取实际导航链；文档合同。
- 尚存风险：文档结论不替代后续窗口验证。

<details>
<summary>精确修改文件</summary>

- `AGENTS.md`

</details>

### D 补修 — `16a7207a`

- 修改文件：下列 1 个文件。
- Touchpoint：无增删。
- 行为变化：启动时复用已有项目恢复入口，恢复绑定会话右侧 CAT。
- 运行验证：修复前实际重启丢失面板；修复后隔离打包窗口恢复模式、会话、项目、Asset 与 Segment；类型和边界。
- 尚存风险：只覆盖当前宿主目录包。

<details>
<summary>精确修改文件</summary>

- `apps/electron/src/renderer/main.tsx`

</details>

### B 补修 — `55792ab4`

- 修改文件：下列 2 个文件。
- Touchpoint：无增删。
- 行为变化：更新提示两处替代文本使用 LA。
- 运行验证：定点身份合同。
- 尚存风险：不证明真实自动更新安装链。

<details>
<summary>精确修改文件</summary>

- `apps/electron/src/renderer/main.tsx`
- `scripts/verify-product-identity.mjs`

</details>

### E 自动门禁 — `1fd92eab`

- 修改文件：下列 6 个文件。
- Touchpoint：无增删。
- 行为变化：加入真实窗口切换，修正旧探针对当前产品的错误假设；打包后按冻结锁文件恢复探针依赖。
- 运行验证：实际 Agent / Chat / CAT 探针与状态链；根 test、类型及相关合同。
- 尚存风险：假模型不是方案要求的真实 Provider 四岗位链；原生 Open/Save 标为 MANUAL。

<details>
<summary>精确修改文件</summary>

- `CHANGELOG.md`
- `apps/electron/scripts/smoke/probe-pb074-e2e.ts`
- `apps/electron/scripts/smoke/probe-project-switch.ts`
- `apps/electron/scripts/smoke/run-vertical-smoke.ts`
- `package.json`
- `tests/packaged-vertical-smoke-contract.test.ts`

</details>

### B 补修 — `2cabbc33`

- 修改文件：下列 14 个文件。
- Touchpoint：新增 shortcut-defaults.ts 与 text-insertion-service.ts 两项产品触点。
- 行为变化：补正导航、系统权限和恢复提示；更新提示直接使用 LA 应用图标。
- 运行验证：身份、类型、边界、同步策略；最终目录包重跑。
- 尚存风险：历史配置路径和内部技术标识保留，未迁移持久化数据。

<details>
<summary>精确修改文件</summary>

- `apps/electron/src/main/ipc.ts`
- `apps/electron/src/main/lib/agent-session-manager.ts`
- `apps/electron/src/main/lib/linguist/project-service.ts`
- `apps/electron/src/main/lib/text-insertion-service.ts`
- `apps/electron/src/renderer/components/agent-skills/integration-catalog.ts`
- `apps/electron/src/renderer/components/planning/PlanningNativeSyncControl.tsx`
- `apps/electron/src/renderer/features/linguist/projects/ProjectRunSummary.tsx`
- `apps/electron/src/renderer/features/linguist/session-binding/binding-utils.ts`
- `apps/electron/src/renderer/lib/shortcut-defaults.ts`
- `apps/electron/src/renderer/main.tsx`
- `docs/architecture/PROMA_CORE_TOUCHPOINTS.md`
- `docs/architecture/proma-sync-policy.json`
- `docs/architecture/proma-touchpoints.json`
- `scripts/verify-product-identity.mjs`

</details>

## 最终门禁与证据范围

最终运行源 HEAD 为 `2cabbc33c1079eb8b48ff77d7eb16a066efd97bc`，构建时工作树包含本次发布版本元数据变更；未声称这是已发布 Tag 的洁净构建。

| 验证 | 实际结果与范围 |
|---|---|
| `bun install --frozen-lockfile` | 通过，依赖锁未升级。打包同步后再次恢复工作区依赖。 |
| `bun run typecheck` / `bun run test` | 全部配置门禁通过，0 failure；精确测试数量保留在日志。 |
| `bun run check:boundaries` | 通过，无未登记修改、无 stale 条目。 |
| `node --test tests/linguist-fusion-architecture.test.mjs` | 通过。 |
| `node scripts/verify-host-seams.mjs` / `node scripts/test-proma-sync-replay.mjs` | 通过；未扩大 Host Seam。 |
| `bun run electron:build` | 本周期已执行通过；最终 `smoke:pack` 又从最新源构建。 |
| `bun run smoke:pack` | 通过；最终由 `smoke:vertical` 调用构建同一目录包。 |
| `bun run smoke:vertical` | package / workspace-deps / agent / chat / project-switch / linguist-current 全部执行通过，合同覆盖仍为 partial。 |
| `bun run license:check` | 通过，SBOM 与锁定依赖闭包一致。 |
| `node scripts/verify-product-identity.mjs` | 通过；启动、引导、打包和定点 UI 文案合同一致。 |
| Release Notes 生成 | 从 Changelog 提取候选版本通过；未发布。 |
| 固定上游比对 | `pi-mcp-tools.ts` 与固定 Proma 文件逐字一致。 |

最终 macOS arm64 目录包 Info.plist：`0.17.70` / `Linguist Agent` / `com.linguistagent.app`。ASAR SHA-256：`d503129b93fc4c9a08514337e0d00c3fd42cc3ccc498b865f82286a6cd2d62b6`。

自动纵向记录结束时间：`2026-09-04T15:37:43.529Z`。原始机器报告位于忽略产物目录 `apps/electron/out/smoke/vertical/vertical-smoke-report.json`，各步日志在同目录。根门禁日志位于任务临时目录，文件前缀 `la-01770-final-`；未将包含本机绝对路径的原始日志提交。

### 发布准备（本报告所在提交）

- 修改文件：`apps/electron/package.json`、`bun.lock`、`docs/architecture/proma-baseline.json`、`CHANGELOG.md`、`CURRENT_FACTS_SIMPLE.md`、`docs/HANDOFF.md` 与本报告。
- Touchpoint：无增删。
- 行为变化：仅 App 版本递增与候选变更记录、验证状态更新。
- 运行验证：上述最终目录包及所有门禁；文档合同与版本一致性检查。
- 尚存风险：真实 Provider 门禁仍未完成，不能标记 release qualified。

真实 Provider 3–5 Segment 的 General → Translator → Reviewer → Proofreader → QA → verified export → re-import 尚未运行：缺独立临时测试配置。现有 PB-074 使用 7 段匿名 fixture 与本地假模型，只证明其明确执行的工具/Store/窗口链，不能冒充完整四岗位或语言质量证据。

原生 Open/Save 点选、IME、真实密钥存储、安装版哈希与自动更新链没有补记为通过。签名、公证、跨平台资格和日用证据沿用 TODO。未创建公开发布、Tag 或推送上游补丁。
