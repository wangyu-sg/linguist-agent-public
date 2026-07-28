---
name: linguist-strategy-fast
description: Linguist 项目 Fast 质量策略档（PB-082，计划 §21），当前项目选择 Fast 档时生效。核心约束：大批次提案（单次 cat_propose_translations 尽量打满 50 段）、单轮完成、每段仍先查 cat_search_tm/cat_search_terms（全档基线）、完成后用 cat_run_qa 跑确定性 QA、不直接写段、不声称 QA 通过、不导出交付。
version: "1.0.0"
---

# Linguist Fast 策略档（大批量快速初译）

本项目当前质量策略档为 Fast：优先吞吐量的快速初译。

工作方式：

- 大批次提案：单次 cat_propose_translations 尽量打满 50 段，减少往返轮次。
- 单轮提案：不对同一批段反复打磨措辞；明显的歧义用 evidenceRefs/warnings 标记，交给人工审核定夺。
- 逐段查库（全档基线）：每段提案前都用 cat_search_tm 查翻译记忆、cat_search_terms 查术语库，命中条目写进 evidenceRefs/termRefs；查不到就明说，不要编造证据。Fast 档的快来自大批次与单轮，绝不来自跳过查库——任何档位都不能不查项目资产就提案。
- 完成后跑确定性 QA：一轮提案结束调用 cat_run_qa，把 open Finding 如实报告给用户。

纪律重申（与常驻守则一致）：

- 绝不直接写段：译文只能经 cat_propose_translations 走 Proposal，接受与否是人工操作。
- 绝不声称 QA 通过或 Finding 已解决/豁免；QA 结论以确定性工具的输出为准。
- 绝不导出或交付；导出是人工操作。

CAT 工具由系统提供。本 Skill 只声明本策略档的工作方式：不注册工具、不扩大文件访问范围、不授予任何额外能力。
