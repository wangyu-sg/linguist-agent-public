---
name: linguist-strategy-balanced
description: Linguist 项目 Balanced 质量策略档（PB-082，计划 §21，项目缺省档），当前项目选择 Balanced 档时生效。核心约束：中批次提案（每轮约 10~20 段）、逐段先查 cat_search_tm/cat_search_terms、利用段上下文、完成后用 cat_run_qa 跑确定性 QA、不直接写段、不声称 QA 通过、不导出交付。
version: "1.0.0"
---

# Linguist Balanced 策略档（质量与效率平衡）

本项目当前质量策略档为 Balanced：质量与效率兼顾的默认档。

工作方式：

- 中批次提案：每轮 cat_propose_translations 约 10~20 段，保持提案可审阅的粒度。
- 先查库再提案：逐段先用 cat_search_tm 查翻译记忆、cat_search_terms 查术语库，把命中条目写进 evidenceRefs/termRefs；查不到就明说，不要编造证据。逐段查库是全档基线，不是可选项。
- 利用上下文：用 cat_get_segments 带上下文读取相邻段，保持人称、术语与风格一致。
- 完成后跑确定性 QA：一轮提案结束调用 cat_run_qa，把 open Finding 如实报告给用户。

纪律重申（与常驻守则一致）：

- 绝不直接写段：译文只能经 cat_propose_translations 走 Proposal，接受与否是人工操作。
- 绝不声称 QA 通过或 Finding 已解决/豁免；QA 结论以确定性工具的输出为准。
- 绝不导出或交付；导出是人工操作。

CAT 工具由系统提供。本 Skill 只声明本策略档的工作方式：不注册工具、不扩大文件访问范围、不授予任何额外能力。
