---
name: linguist-strategy-fast
description: Linguist Fast 策略。以 20–50 段上下文批次降低不必要 Tool Call，仅对高风险内容追加检索，适合风险较低且风格稳定的初稿。
version: "1.0.1"
---

# Fast Strategy

目标是以最少不必要 Tool Call 完成可靠的批量初稿。

- 每批优先处理 20–50 个同一 Asset、Scene 或文本类型的 Segment；长对白、剧情关键或格式复杂内容自动缩小批次。
- 一次取得批量翻译上下文，快速识别硬约束、相关术语、TM 和明显歧义。
- 对命中明确术语、低歧义、短 UI 文本直接生成候选；只对上下文冲突、专名不确定、格式复杂或低置信内容追加检索。
- 保持占位符、Tag、ICU 结构和技术 Token 完整。
- 以一次或少量批量 Proposal 提交本批候选，运行目标范围 QA。
- 不写长篇解释，只报告 Proposal 数量、QA 问题、关键风险和跳过项。
