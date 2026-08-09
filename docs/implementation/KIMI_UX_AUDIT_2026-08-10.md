# Kimi K3 Linguist UX 审计（2026-08-10）

基线：`integration/la-proma-0.16.10`（34d73e27）。方法：代码走读与本地 fixture 检查；本地截图不作为仓库证据。

## 摩擦点（按影响排序）

1. **岗位名是中英混排的技术词**：新建会话菜单与 header pill 显示 `Translator`/`Reviewer`/`Proofreader`，toast 显示「当前角色：X」。
   文件：`renderer/features/linguist/session-binding/LinguistRoleMenu.tsx`
   解法：改 `LINGUIST_ROLE_OPTIONS` 文案为 通用项目 Agent/翻译/双语审校/目标语校对 + 计划给定的一句描述；toast 改「已切换为X」。不新增组件。

2. **岗位菜单在 rail 态重复出现两次**：`ProjectAgentRail` 顶部条（:416）与 `AgentHeader`（:130）各渲染一份 `LinguistRoleMenu`。
   解法：岗位菜单唯一归属 AgentHeader（会话 header）；rail 条保留快捷动作与展开控制。删除一处渲染，无新组件。

3. **Agent Full 信息行显示原始 role id**：`ProjectAgentRail.tsx:390` 把 `general` 等枚举值直接拼进 `role · 批次 · 已选 N 段`。
   解法：改用 `getLinguistRoleOption(role).shortLabel`。

4. **「本次运行」条把工程对象暴露给用户**：`Proposal {n}` 与撤销说明里的「待审 Proposal」。
   文件：`ProjectRunSummary.tsx:101-107,202-204,221`、`project-utils.ts:149`
   解法：显示文案改为「建议」；已退出产品面的 Critic 统计不再投影到 UI。

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

9. **Target 编辑器缺少硬保护 Tag 的整单元导航反馈**：现状是输入/删除只在写入校验时被拦下（体验滞后）。
   文件：`TargetEditor.tsx` + 新增 `tag-atomic-utils.ts`
   解法：统一 span 来源（cat-core scanTags + 候选正则），onSelect 吸附/扩展、方向键跨越、Backspace/Delete 先整体选中 Tag；IME composition 期间不校正，compositionend 后吸附。最终写入仍由结构守恒规则 fail closed，因此不把它描述成不可变的原子编辑器。

10. **并行合同接线**：合并时接入当前的 `cat_apply_translations`、术语闭环、Workbook Mapping、Voice/Exemplar 与 `verified/as-is` 导出合同；没有保留 mock client、旧 API alias 或临时 feature flag。
