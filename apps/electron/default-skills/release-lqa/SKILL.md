---
name: release-lqa
description: 对当前 Linguist 项目的指定批次执行发布或交付前 LQA。用户要求 release LQA、发布前检查、交付验收或抽查完成批次时使用；汇总覆盖、QA、阻断、警告和未验证范围，但不代替 Reviewer 全量审校，也不自行导出。
group: linguist
version: "1.0.1"
---

# Release LQA

给出可审计的发布建议，不把抽查或自动 QA 冒充交付资格证明。

## 执行

1. **冻结检查范围。** 用 `cat_project_summary` 读取语言对与项目状态，用 `cat_list_assets` 分页列完指定批次；用户未指定时检查全部批次。对每个批次用 `cat_get_segments` 分页核对空译文、状态和锁定项。
   - 完成条件：每个纳入或排除的批次都有理由，Segment 分页覆盖与工具 `total` 一致；任何抽查都明确样本和未覆盖范围。
2. **读取 QA 证据。** 用 `cat_get_qa_findings` 分页读取全部 open 和 waived findings，并把 finding revision 与当前 Segment revision 对照。只有用户明确要求运行最新 QA 时才调用 `cat_run_qa`；先说明它会持久化 findings 但不会修改 Segment，完成后重新读取 findings。对范围内 Segment 分批调用 `cat_validate_terms`。
   - 完成条件：open、waived findings 和术语校验均读完；未运行新 QA、revision 已过期或调用中断时，必须写入未验证范围。
3. **复核交付风险。** 依据实际数据检查未翻译内容、结构/Tag/placeholder、术语、明显格式异常和跨 Segment 一致性。只有项目资料提供界面或图片上下文时才检查截断与图文关系。CAT 工具未暴露的阶段确认记录不得从 Segment status 推断。
   - 完成条件：每个发现都有 `assetId`、Segment、QA finding 或术语证据；阶段、视觉和人工语言审校的缺口均单列。
4. **形成建议。** 有未解决阻断或关键覆盖缺口时给 `not-ready`；只有非阻断警告时给 `ready-with-warnings`；范围完整且没有已知问题时才给 `ready`。这只是 LQA 建议，不等于 verified export 已通过。
   - 完成条件：结论能由阻断、警告和覆盖表直接推出，且每个阻断项都有最小修复动作。

## 输出

- **范围与覆盖**：语言对、批次、Segment 数、全量/抽查方法和未覆盖项。
- **建议结论**：`ready`、`ready-with-warnings` 或 `not-ready`，附证据摘要。
- **阻断 / 警告 / 已接受风险**：位置、证据、影响和最小动作。
- **未验证**：Reviewer 覆盖、视觉、真实设备或人工确认等没有证据的部分。

## 边界

- 检查阶段不得调用 `cat_export_asset`；只有用户另行明确要求导出时才进入交付流程。
- 不调用 `cat_confirm_segments`，不关闭或 waive QA finding，不修改译文或术语。
- 当前工具不能只读核对阶段覆盖、待处理 Proposal 或 delivery preflight；这些项目必须标记未验证。
- 不把抽查、自动 QA 或无上下文判断称为发布资格证明。
