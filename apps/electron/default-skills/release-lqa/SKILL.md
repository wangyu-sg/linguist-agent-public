---
name: release-lqa
description: 在已绑定 Linguist 项目且 CAT 工具可用时，执行指定批次的交付前检查或解读已有 QA。用于“检查能否交付”“发布前 LQA”；不替代全量双语审校、不自动导出。按本次要求区分当前检查、旧报告解读和授权修复。
group: linguist
version: "1.0.2"
---

# 交付前 LQA

核实当前数据能支持什么交付结论，而不是读取一份旧报告就宣布验收完成。

## 先按用户要求执行

- “检查能否交付”：默认对每个纳入批次运行一次当前 `cat_run_qa`。它会保存 findings，不改译文或确认状态；无需再询问是否运行这项检查。
- “只看已有 QA/不运行新检查”：只读取旧结果，注明当前有效性未验证。
- “检查并修复”：可以在明确授权范围内修正 Target；未获授权的 waiver、解锁、术语政策变更和导出不包含在内。
- “完全只读/任何项目状态都不能写”：不刷新 inventory、不运行持久化 QA；Context 读取全部使用 `readOnly=true`，也不创建 Proposal 或阶段决定。

## 执行顺序

1. 复用已确定的语言对和批次范围；不足时用概览和分页批次目录补齐。全量、局部检查和抽查分别说明；不把检查少数样本称为全量语言审校。
2. 对每个纳入批次调用 `cat_project_summary`，传入 `assetId` 与 `includeDelivery=true`。读取 `delivery` 中的阶段、未确认数、待处理 Proposal、证据、blockers 和当前会话任务。此查询不创建任务、不确认、不生成导出文件。
3. 当前交付检查运行 `cat_run_qa`；本任务内刚成功运行、且此后没有修改该批次或相关规则时可复用这次结果，不重复运行。摘要中的 `qaFreshness=not-evaluated` 不能当 QA 新鲜度证明。旧记录为空也不等于已经运行且零问题。
4. 用 `cat_get_qa_findings` 分页读取需要的 open/waived 记录，按纳入范围的 Segment ID 对照；不要臆造不存在的 assetId 参数。对照 finding revision，旧 revision 不当成当前结论。需要时用 `cat_validate_terms` 补充术语检查。
5. 对有风险或需要人工语言判断的内容，取得完整 Source/Target 和必要参考。纯报告路径的 `cat_get_translation_context`、`cat_read_context_doc` 都使用 `readOnly=true`；规则和参考跟随返回位置续读。没有界面或图片证据时不声称已验证截断、图文动作或设备表现。
6. 获授权修复后重新运行受影响批次 QA，再读取只读摘要；使用现有修复/QA机制的真实结果，不自行关闭或 waive finding。仅为取得绿色状态而确认句段、缩小任务范围或跳过证据均不允许。

## 输出

先给建议：`ready`、`ready-with-warnings` 或 `not-ready`。随后只说明检查范围、当前 QA、重要阻断/警告、未验证项目和实际修复。

`ready` 只表示本次声明的交付前检查没有已知阻断，不等于独立 Reviewer 已全量完成，也不等于 verified export 已经执行。`delivery.ready` 是现有预检结果，必须结合 archived、currentTask 和未验证范围解释；`currentTask=null` 不代表本轮专业审校已完成，也不自动否定合法人工流程。

有真实 blocker、任务 pending/blocked/stale 或必要证据缺口时说明具体范围。只有非阻断警告时使用 `ready-with-warnings`。未执行的 round-trip、真实设备和人工语言资格明确写未验证。

## 导出边界

本 Skill 不把检查请求解释为导出、发送或发布授权。用户明确要求“检查并导出”，且目标可确定时才调用现有导出工具；verified 失败不自动改成 as-is。只做报告时不调用 `cat_confirm_segments`。
