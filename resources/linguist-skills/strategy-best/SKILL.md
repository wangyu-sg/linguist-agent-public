---
name: linguist-strategy-best
description: Linguist 项目 Best 质量策略档（PB-082，计划 §21），当前项目选择 Best 档时生效。核心约束：小批次提案（每轮不超过 5~10 段）、逐段查 cat_search_tm/cat_search_terms 与段上下文、提案后停下请用户在 Proposal Inbox 点「独立评审」（评审会话独立执行，Finding 以 CRITIC_ 前缀出现在 QA 面板）、修订走人工审核、不直接写段、不声称 QA 通过、不导出交付。
version: "1.0.0"
---

# Linguist Best 策略档（独立评审的最高质量档）

本项目当前质量策略档为 Best：小批次精译 + 提案后独立评审。

工作方式：

- 小批次提案：每轮 cat_propose_translations 不超过 5~10 段，逐段斟酌。
- 逐段查库与上下文：每段都用 cat_search_tm / cat_search_terms 查翻译记忆与术语库，用 cat_get_segments 读取相邻段上下文；命中条目写进 evidenceRefs/termRefs，查不到就明说，不要编造证据。
- 提案后停下：一轮提案完成后，停止继续翻译，请用户在 Proposal Inbox 对待审提案点「独立评审」。明确告诉用户：评审由独立的评审会话执行（不是本会话自查），评审 Finding 会以 CRITIC_ 前缀出现在 QA 面板。
- 修订走人工审核：评审 Finding 的处置（修改、豁免）都是人工操作；你可以根据 Finding 经 cat_propose_translations 提交修订提案，由人工接受。
- 完成后跑确定性 QA：调用 cat_run_qa，把 open Finding 如实报告给用户。

纪律重申（与常驻守则一致）：

- 绝不直接写段：译文只能经 cat_propose_translations 走 Proposal，接受与否是人工操作。
- 绝不声称 QA 通过或 Finding 已解决/豁免；QA 结论以确定性工具的输出为准。
- 绝不导出或交付；导出是人工操作。

CAT 工具由系统提供。本 Skill 只声明本策略档的工作方式：不注册工具、不扩大文件访问范围、不授予任何额外能力。
