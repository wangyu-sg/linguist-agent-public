# Kimi K3 Linguist UX 审计（2026-08-10）

基线：`integration/la-proma-0.16.10`（34d73e27）。截图目录：`artifacts/ui-baseline/`（fixture 演示项目，无客户内容）。
方法：代码走读 + 真实运行截图。每条摩擦点给出对应文件与最小组件解法。

## 截图清单

见 `artifacts/ui-baseline/`：侧栏与项目行菜单、空项目、多批次项目、Segment Grid、Target 编辑态、Agent Rail、Agent Full、岗位菜单、导入、待查看建议、QA、Tag Profiles、项目设置、语言资产管理、准备交付、Side Answer、浅色/深色、窄窗口。

## 摩擦点（按影响排序）

1. **岗位名是中英混排的技术词**：新建会话菜单与 header pill 显示 `Translator`/`Reviewer`/`Proofreader`，toast 显示「当前角色：X」。
   文件：`renderer/features/linguist/session-binding/LinguistRoleMenu.tsx`
   解法：改 `LINGUIST_ROLE_OPTIONS` 文案为 通用项目 Agent/翻译/双语审校/目标语校对 + 计划给定的一句描述；toast 改「已切换为X」。不新增组件。

2. **岗位菜单在 rail 态重复出现两次**：`ProjectAgentRail` 顶部条（:416）与 `AgentHeader`（:130）各渲染一份 `LinguistRoleMenu`。
   解法：岗位菜单唯一归属 AgentHeader（会话 header）；rail 条保留快捷动作与展开控制。删除一处渲染，无新组件。

3. **Agent Full 信息行显示原始 role id**：`ProjectAgentRail.tsx:390` 把 `general` 等枚举值直接拼进 `role · 批次 · 已选 N 段`。
   解法：改用 `getLinguistRoleOption(role).shortLabel`。

4. **「本次运行」条把工程对象暴露给用户**：`Proposal {n}`、`Critic {n}`、撤销说明里的「待审 Proposal」。
   文件：`ProjectRunSummary.tsx:101-107,202-204,221`、`project-utils.ts:149`
   解法：显示文案改为 建议/评审记录（>0 才显示）；内部字段名不动。

5. **CAT 工具结果卡大面积落到默认 JSON 渲染**：`cat_accept_proposals`、`cat_import_*`、`cat_export_asset`、`cat_scan_unknown_tag_patterns`、`cat_save_tag_profile_candidate`、`cat_plan/create_consistency_*` 无摘要 case；旧 `cat_run_batch_consistency` 已废弃但 renderer 三处映射仍残留。
   文件：`components/agent/tool-result-renderers/cat-result.tsx`、`components/agent/tool-utils.ts`、`components/agent/tool-phrase.ts`
   解法：补白名单摘要 case（写回 N 段 / 导入分组计数 / 回读验证 N 段 / N 类疑似 Tag），删除旧名映射。

6. **底部 dock 的「提案」入口命名与定位**：计划要求 Proposal 降级为「待查看建议」。
   文件：`LinguistBottomDock.tsx:25`、`SegmentGrid.tsx`（行内 `Proposal 待审` pill）、`ContextEvidencePanel.tsx:283-287`
   解法：tab 改名「待查看建议」，pill 与面板标题中文化；路由与内部命名不动。

7. **导入后不会自动提示未知 Tag**：扫描 IPC（`linguist.projects.scanUnknownTags`）与 Tag Profiles 面板都在，但只有手动/设置页触发。
   文件：新增 `UnknownTagNotice`（挂在 Workbench 主区顶部）+ 复用 `TagProfilesPanel`
   解法：导入成功与项目 updatedAt 变化后在 renderer 侧触发扫描；发现疑似 Tag 显示非阻断提示条「发现 N 类疑似 Tag [查看][让 Agent 识别][忽略]」；不弹 Modal。「让 Agent 识别」把 pattern 证据写进当前项目会话任务（计划 §12.3 文案）。

8. **术语只能列表+删除**：`linguistReferencesUpsertTerm` IPC 与后端已就绪但 renderer 零调用；无新增/编辑/冲突视图。
   文件：`ReferenceManager.tsx`
   解法：术语库 tab 内补新增/行内编辑表单（复用现有 Input/Button primitives）、同 Source 多译法冲突区（前端按 term 归组 required/preferred）；「让 Agent 整理本批术语」按钮 = 向当前会话发自然语言任务，不建 Terminologist 角色。

9. **Target 编辑器光标可进入硬保护 Tag 内部**：现状是输入/删除被值级守卫静默拦下（体验滞后且无反馈）。
   文件：`TargetEditor.tsx` + 新增 `tag-atomic-utils.ts`
   解法：统一 span 来源（cat-core scanTags + 候选正则），onSelect 吸附/扩展、方向键跨越、Backspace/Delete 先整体选中 Tag 再按守卫决定可否删除；IME composition 期间不校正，compositionend 后吸附。（已完成）

10. **依赖 Codex 合同的缺口（本轮不做假入口）**：`cat_apply_translations`、术语 Agent 写入工具、Workbook mapping 持久化（记住映射/复用提示）、Voice/Exemplar Agent 工具与 Exemplar 存储、UI 侧文件夹导入（需主进程 picker 扩展）。UI 仅在真实 API 可达范围内施工，缺口列入交接。
